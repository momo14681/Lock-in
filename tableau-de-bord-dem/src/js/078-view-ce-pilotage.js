// =============================================================================
// « Mon pilotage » (profil chargé d'essais) : la feuille Pilotage de la DEM pour
// un chargé, regroupée sur un écran. Règles reprises des formules de la feuille :
// - Gel M0 = J0 − 70 jours ; une ligne est gelée quand MC, OT, TOT, RDU et Régime
//   sont renseignés (colonne « TOT restant à préparer ») ;
// - BPA fait = date ou P, compté par REE (affaire + REE + tranche) ; « préparable »
//   par le chargé si le titulaire est EDF ou si le BPA est en F ;
// - échéances : Gel M0 à moins de 30 j / 30 à 90 j / au-delà, BPA selon le J0
//   (moins de 30 j / 30 à 90 j / au-delà). Les dates dépassées restent « court terme ».
// Réalisés et BPD signés suivent les règles du reste du tableau de bord.
// =============================================================================

const CEP_TAB = "cePilotage";
const GEL_M0_DAYS = 70;
const GEL_KEYS = ["mc", "ot", "tot", "rdu", "regime"];
const CEP_WINDOWS = [["short", "Court terme"], ["mid", "Moyen terme"], ["later", "Plus tard"]];
const CEP_COLORS = { gel: "#1057C8", bpa: "#0C7C8C", realized: "#509E2F", bpd: "#3D7F22" };

let cepGelWindow = "short", cepBpaWindow = "short";

function gelDone(t) {
  return GEL_KEYS.every((k) => isNonBlank(t[k]));
}

function bpaDone(t) {
  return t.bpaState === "done" || status(t.bpa) === "P";
}

function bpaPreparable(t) {
  return status(t.entreprise) === "EDF" || status(t.bpa) === "F";
}

// Échéance relative à aujourd'hui : court terme (< 30 j, dépassé compris), moyen (30 à 90 j), plus tard.
function cepWindow(date, today) {
  if (!date) return "none";
  const d = daysBetween(today, date);
  return d < 30 ? "short" : d < 90 ? "mid" : "later";
}

// REE du chargé : une entrée par affaire + REE + tranche (clé de la feuille Pilotage).
function cepDossiers(ts) {
  const map = new Map();
  for (const t of ts) {
    if (!t.ree) continue;
    const key = `${t.sheet}|${t.affaire}|${t.ree}`;
    let d = map.get(key);
    if (!d) map.set(key, d = { key, sheet: t.sheet, affaire: t.affaire, libelle: t.libelle, ree: t.ree, reeLibelle: t.reeLibelle, entreprise: t.entreprise, ts: [] });
    d.ts.push(t);
    if (!d.libelle && t.libelle) d.libelle = t.libelle;
    if (!d.entreprise && t.entreprise) d.entreprise = t.entreprise;
  }
  for (const d of map.values()) {
    const j0s = d.ts.map((t) => t.j0).filter(Boolean).sort((a, b) => a - b);
    d.j0 = j0s[0] || null;
    d.bpaDone = d.ts.some(bpaDone);
    d.bpaPreparable = d.ts.some(bpaPreparable);
    d.bpdSigned = d.ts.some((t) => t.bpdState === "done");
    d.pendingGel = d.ts.filter((t) => !gelDone(t));
    const gelJ0 = d.pendingGel.map((t) => t.j0).filter(Boolean).sort((a, b) => a - b)[0] || null;
    d.gelDate = gelJ0 ? addDays(gelJ0, -GEL_M0_DAYS) : null;
    d.missing = [...new Set(d.pendingGel.flatMap((t) => GEL_KEYS.filter((k) => !isNonBlank(t[k]))))];
  }
  return [...map.values()];
}

function cepStats(ts, dossiers) {
  const n = ts.length, ree = dossiers.length;
  return {
    n, ree,
    gel: ts.filter(gelDone).length,
    bpa: dossiers.filter((d) => d.bpaDone).length,
    realized: ts.filter(isRealized).length,
    bpd: dossiers.filter((d) => d.bpdSigned).length,
  };
}

function cepModel() {
  const ts = visible, today = data.today;
  const dossiers = cepDossiers(ts);
  const sheets = PILOT_ORDER.filter((s) => ts.some((t) => t.sheet === s));
  for (const s of new Set(ts.map((t) => t.sheet))) if (!sheets.includes(s)) sheets.push(s);
  const bySheet = sheets.map((sheet) => {
    const st = ts.filter((t) => t.sheet === sheet), ds = dossiers.filter((d) => d.sheet === sheet);
    return { sheet, ...cepStats(st, ds) };
  });
  const gel = dossiers.filter((d) => d.pendingGel.length).map((d) => ({ d, date: d.gelDate, win: cepWindow(d.gelDate, today) }));
  const bpa = dossiers.filter((d) => !d.bpaDone).map((d) => ({ d, date: d.j0, win: cepWindow(d.j0, today) }));
  return { ts, today, dossiers, bySheet, total: cepStats(ts, dossiers), gel, bpa };
}

// --- Blocs d'affichage -------------------------------------------------------------

function cepTag(sheet) {
  return `<span class="pilotTag phase-${dossierPhase({ sheet })}">${esc(trancheLabel(sheet))}</span>`;
}

function cepDue(date, today) {
  if (!date) return '<span class="muted">J0 absent</span>';
  const d = daysBetween(today, date);
  const when = d < 0 ? `dépassé de ${fmt(-d)} j` : d === 0 ? "aujourd’hui" : `dans ${fmt(d)} j`;
  return `<span class="cepDate">${formatDate(date)}</span><small class="${d < 0 ? "cepLate" : "muted"}">${when}</small>`;
}

function cepDossierCell(d) {
  return `<button type="button" class="linkbutton" data-task="${d.ts[0].index}">${esc(d.affaire || "Affaire manquante")} · REE ${esc(d.ree)}</button><small>${esc(d.libelle || d.reeLibelle || "")}</small>`;
}

function cepList(kind, items, current, today) {
  const counts = Object.fromEntries([...CEP_WINDOWS.map(([w]) => [w, 0]), ["none", 0]]);
  for (const i of items) counts[i.win]++;
  const windows = counts.none ? [...CEP_WINDOWS, ["none", "Sans J0"]] : CEP_WINDOWS;
  const win = windows.some(([w]) => w === current) ? current : "short";
  const variable = kind === "gel" ? "cepGelWindow" : "cepBpaWindow";
  const chosen = items.filter((i) => i.win === win).sort((a, b) => (a.date || Infinity) - (b.date || Infinity) || COLLATOR_FR_NUM.compare(a.d.affaire, b.d.affaire));
  const rows = chosen.map(({ d, date }) => `<tr>
      <td>${cepDossierCell(d)}</td>
      <td>${cepTag(d.sheet)}</td>
      <td>${cepDue(date, today)}</td>
      <td>${kind === "gel"
        ? `<span class="missingKeys">${esc(d.missing.map((k) => names[k]).join(", "))}</span>`
        : `${esc(d.entreprise || "—")}<small class="muted">${d.bpaPreparable ? "à préparer" : "fait par le titulaire"}</small>`}</td></tr>`);
  const head = ["REE", "Tranche", kind === "gel" ? "Gel M0" : "J0", kind === "gel" ? "Manque" : "Titulaire"];
  const empty = win === "short" ? "Rien à court terme." : "Rien sur cette période.";
  return segment(variable, windows, win, { label: "Échéance", counts: (w) => counts[w] })
    + table(head, rows, { cls: "compact cepList", free: true, empty });
}

function cepMeterCell(done, total, color, unit) {
  return `<td>${meter(done, total, { color, tipText: `${fmt(done)} / ${fmt(total)} ${unit} · ${pct(done, total)}`, showLabel: false })}<span class="cepPct">${pct(done, total)}</span></td>`;
}

function cepSheets(m) {
  const rows = m.bySheet.map((s) => `<tr>
      <td>${cepTag(s.sheet)}</td>
      <td class="num">${fmt(s.ree)}</td><td class="num">${fmt(s.n)}</td>
      ${cepMeterCell(s.gel, s.n, CEP_COLORS.gel, "TOT")}
      ${cepMeterCell(s.bpa, s.ree, CEP_COLORS.bpa, "REE")}
      ${cepMeterCell(s.realized, s.n, CEP_COLORS.realized, "TOT")}
      ${cepMeterCell(s.bpd, s.ree, CEP_COLORS.bpd, "REE")}</tr>`);
  return table(["Tranche", { label: "REE", cls: "num" }, { label: "TOT", cls: "num" }, "Gel M0", "BPA", "Réalisés", "BPD signés"], rows, { cls: "compact cepSheets", free: true });
}

function cepAffaires(m) {
  const groups = new Map();
  for (const d of m.dossiers) {
    const key = `${d.sheet}|${d.affaire}`;
    if (!groups.has(key)) groups.set(key, { sheet: d.sheet, affaire: d.affaire, libelle: d.libelle, ds: [] });
    groups.get(key).ds.push(d);
  }
  const items = [...groups.values()].map((g) => {
    const ts = g.ds.flatMap((d) => d.ts), j0s = ts.map((t) => t.j0).filter(Boolean).sort((a, b) => a - b);
    return { ...g, ts, j0: j0s.find((x) => x >= m.today) || j0s[j0s.length - 1] || null, gel: ts.filter(gelDone).length, bpa: g.ds.filter((d) => d.bpaDone).length, realized: ts.filter(isRealized).length, bpd: g.ds.filter((d) => d.bpdSigned).length };
  }).sort((a, b) => PILOT_ORDER.indexOf(a.sheet) - PILOT_ORDER.indexOf(b.sheet) || (a.j0 || Infinity) - (b.j0 || Infinity) || COLLATOR_FR_NUM.compare(a.affaire, b.affaire));
  const frac = (a, b) => `<span class="cepFrac${a === b ? " full" : ""}">${fmt(a)}<span class="muted">/${fmt(b)}</span></span>`;
  return dataTable({
    key: "cep-affaires", items, paged: false, cls: "compact cepAffaires", free: true, empty: "Aucune affaire affectée.",
    columns: [
      { label: "Affaire", value: (g) => `${g.affaire} ${g.libelle} ${g.ds.map((d) => d.ree).join(" ")}` },
      { label: "Tranche", value: (g) => trancheLabel(g.sheet), filter: true },
      { label: "REE", value: (g) => g.ds.map((d) => d.ree).join(" ") },
      { label: "J0", value: (g) => (g.j0 ? formatDate(g.j0) : "") },
      { label: "Gel M0", cls: "num" }, { label: "BPA", cls: "num" }, { label: "Réalisés", cls: "num" }, { label: "BPD", cls: "num" },
    ],
    row: (g) => `<tr>
      <td><button type="button" class="linkbutton" data-go="${esc("affaire:" + g.affaire)}">${esc(g.affaire || "Affaire manquante")}</button><small>${esc(g.libelle || "")}</small></td>
      <td>${cepTag(g.sheet)}</td>
      <td class="cepRees">${g.ds.map((d) => `<button type="button" class="cepRee" data-task="${d.ts[0].index}" title="${esc(d.reeLibelle || "REE " + d.ree)}">${esc(d.ree)}</button>`).join("")}</td>
      <td>${g.j0 ? formatDate(g.j0) : '<span class="muted">—</span>'}</td>
      <td class="num">${frac(g.gel, g.ts.length)}</td><td class="num">${frac(g.bpa, g.ds.length)}</td>
      <td class="num">${frac(g.realized, g.ts.length)}</td><td class="num">${frac(g.bpd, g.ds.length)}</td></tr>`,
  });
}

function viewCePilotage() {
  if (!me) { $("view").innerHTML = chooseMePanel(); return; }
  const m = cepModel(), t = m.total;
  const prep = m.dossiers.filter((d) => !d.bpaDone && d.bpaPreparable).length;
  const kpis = [
    kpi({ label: "Gel M0 passé", value: pct(t.gel, t.n), sub: `${fmt(t.gel)} / ${fmt(t.n)} TOT`, bar: { ratio: ratio(t.gel, t.n), color: CEP_COLORS.gel }, hint: "MC, OT, TOT, RDU et Régime renseignés" }),
    kpi({ label: "BPA faits", value: pct(t.bpa, t.ree), sub: `${fmt(t.bpa)} / ${fmt(t.ree)} REE · ${fmt(prep)} à préparer`, bar: { ratio: ratio(t.bpa, t.ree), color: CEP_COLORS.bpa }, hint: "BPA daté ou en P. À préparer : titulaire EDF ou BPA en F" }),
    kpi({ label: "Essais réalisés", value: pct(t.realized, t.n), sub: `${fmt(t.realized)} / ${fmt(t.n)} TOT`, bar: { ratio: ratio(t.realized, t.n), color: CEP_COLORS.realized }, go: "tasks:realized" }),
    kpi({ label: "BPD signés", value: pct(t.bpd, t.ree), sub: `${fmt(t.bpd)} / ${fmt(t.ree)} REE`, bar: { ratio: ratio(t.bpd, t.ree), color: CEP_COLORS.bpd } }),
  ].join("");
  const affaires = countUnique(m.ts, (x) => x.affaire);
  const head = `<div class="viewHead"><div><h2 class="viewTitle">Mon pilotage</h2><p class="muted">${plural(affaires, "affaire")} · ${fmt(t.ree)} REE · ${plural(t.n, "TOT", "TOT")}</p></div>${meSelector()}</div>`;
  $("view").innerHTML = `${head}<div class="kpis kpis-4">${kpis}</div>
    <div class="split even cepSplit">
      ${panel("Gel M0 à passer", cepList("gel", m.gel, cepGelWindow, m.today), { sub: "Gel M0 = J0 − 70 j · court terme : moins de 30 j, moyen terme : 30 à 90 j" })}
      ${panel("BPA à faire", cepList("bpa", m.bpa, cepBpaWindow, m.today), { sub: "selon le J0 · court terme : moins de 30 j, moyen terme : 30 à 90 j" })}
    </div>
    ${panel("Avancement par tranche", cepSheets(m))}
    ${panel("Mes affaires et REE", cepAffaires(m).html)}`;
  currentExport = () => downloadMatrix(
    ["Tranche", "Affaire", "Libellé DI", "REE", "Titulaire", "J0", "TOT", "Gel M0 (date)", "TOT gelées", "Manque pour le Gel M0", "BPA fait", "BPD signé"],
    m.dossiers.map((d) => [trancheLabel(d.sheet), d.affaire, d.libelle, d.ree, d.entreprise, formatDate(d.j0), d.ts.length, formatDate(d.gelDate), d.ts.length - d.pendingGel.length, d.missing.map((k) => names[k]).join(", "), d.bpaDone ? "oui" : "non", d.bpdSigned ? "oui" : "non"]),
    `Mon_pilotage_${me.replace(/[^\p{L}\p{N}_-]+/gu, "_")}.csv`);
}

function cePilotageReportSections() {
  const m = cepModel(), t = m.total;
  const win = (items, w) => items.filter((i) => i.win === w).length;
  return [
    indicatorSection([["REE", t.ree], ["TOT", t.n], ["Gel M0 passé", `${pct(t.gel, t.n)} (${t.gel} TOT)`], ["BPA faits", `${pct(t.bpa, t.ree)} (${t.bpa} REE)`], ["Essais réalisés", `${pct(t.realized, t.n)} (${t.realized})`], ["BPD signés", `${pct(t.bpd, t.ree)} (${t.bpd} REE)`],
      ["Gel M0 à passer : court / moyen terme", `${win(m.gel, "short")} / ${win(m.gel, "mid")}`], ["BPA à faire : court / moyen terme", `${win(m.bpa, "short")} / ${win(m.bpa, "mid")}`]]),
    { title: "Gel M0 à passer (court et moyen terme)", headers: ["Affaire / REE", "Tranche", "Gel M0", "Manque"], widths: [.36, .14, .2, .3],
      rows: m.gel.filter((i) => i.win === "short" || i.win === "mid").sort((a, b) => a.date - b.date).map(({ d, date }) => [`${d.affaire} / ${d.ree}`, trancheLabel(d.sheet), formatDate(date), d.missing.map((k) => names[k]).join(", ")]) },
    { title: "BPA à faire (court et moyen terme)", headers: ["Affaire / REE", "Tranche", "J0", "Titulaire"], widths: [.36, .14, .2, .3],
      rows: m.bpa.filter((i) => i.win === "short" || i.win === "mid").sort((a, b) => a.date - b.date).map(({ d, date }) => [`${d.affaire} / ${d.ree}`, trancheLabel(d.sheet), formatDate(date), d.entreprise || "—"]) },
    { title: "Avancement par tranche", headers: ["Tranche", "REE", "TOT", "Gel M0", "BPA", "Réalisés", "BPD signés"],
      rows: m.bySheet.map((s) => [trancheLabel(s.sheet), s.ree, s.n, pct(s.gel, s.n), pct(s.bpa, s.ree), pct(s.realized, s.n), pct(s.bpd, s.ree)]) },
  ];
}
