// =============================================================================
// « Mon pilotage » (profil chargé d'essais) : la feuille Pilotage de la DEM pour
// un chargé, regroupée sur un écran. Règles reprises des formules de la feuille :
// - Gel M0 = J0 − 70 jours ; une ligne est gelée quand MC, OT, TOT, RDU et Régime
//   sont renseignés (colonne « TOT restant à préparer ») ;
// - BPA fait = date ou P, compté par REE (affaire + REE + tranche) ; « préparable »
//   par le chargé si le titulaire est EDF ou si le BPA est en F. Comme dans les
//   listes de la feuille, un REE reste « à faire » tant qu'une de ses lignes n'a pas son BPA ;
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
    // Lignes sans BPA (ni date ni P) : le REE apparaît dans « BPA à faire », au J0 le plus proche.
    d.pendingBpa = d.ts.filter((t) => !bpaDone(t));
    d.bpaDone = !d.pendingBpa.length;
    d.bpaJ0 = d.pendingBpa.map((t) => t.j0).filter(Boolean).sort((a, b) => a - b)[0] || null;
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
  const bpa = dossiers.filter((d) => d.pendingBpa.length).map((d) => ({ d, date: d.bpaJ0, win: cepWindow(d.bpaJ0, today) }));
  return { ts, today, dossiers, bySheet, total: cepStats(ts, dossiers), gel, bpa };
}

// --- Blocs d'affichage -------------------------------------------------------------

function cepTag(sheet) {
  return `<span class="pilotTag phase-${dossierPhase({ sheet })}">${esc(trancheLabel(sheet))}</span>`;
}

// Sur un arrêt de tranche (feuille CSxA) le J0 est indicatif : une date dépassée reste grise.
function cepDue(date, today, sheet = "") {
  if (!date) return '<span class="muted">J0 absent</span>';
  const d = daysBetween(today, date), soft = dossierPhase({ sheet }) === "AT";
  const when = d < 0 ? `dépassé de ${fmt(-d)} j` : d === 0 ? "aujourd’hui" : `dans ${fmt(d)} j`;
  return `<span class="cepDate">${formatDate(date)}</span><small class="${d < 0 && !soft ? "cepLate" : "muted"}"${d < 0 && soft ? ' title="Arrêt de tranche : J0 indicatif"' : ""}>${when}</small>`;
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
      <td>${cepDue(date, today, d.sheet)}</td>
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

function viewCePilotage() {
  if (!me) { $("view").innerHTML = chooseMePanel(); return; }
  const m = cepModel(), t = m.total;
  const prep = m.dossiers.filter((d) => !d.bpaDone && d.bpaPreparable).length;
  const kpis = [
    kpi({ label: "Gel M0 passé", value: pct(t.gel, t.n), sub: `${fmt(t.gel)} / ${fmt(t.n)} TOT`, bar: { ratio: ratio(t.gel, t.n), color: CEP_COLORS.gel }, hint: "MC, OT, TOT, RDU et Régime renseignés" }),
    kpi({ label: "BPA faits", value: pct(t.bpa, t.ree), sub: `${fmt(t.bpa)} / ${fmt(t.ree)} REE · ${fmt(prep)} à préparer`, bar: { ratio: ratio(t.bpa, t.ree), color: CEP_COLORS.bpa }, hint: "BPA daté ou en P. À préparer : titulaire EDF ou BPA en F" }),
    kpi({ label: "BPD signés", value: pct(t.bpd, t.ree), sub: `${fmt(t.bpd)} / ${fmt(t.ree)} REE`, bar: { ratio: ratio(t.bpd, t.ree), color: CEP_COLORS.bpd } }),
  ].join("");
  const affaires = countUnique(m.ts, (x) => x.affaire);
  const head = `<div class="viewHead"><div><h2 class="viewTitle">Mon pilotage</h2><p class="muted">${plural(affaires, "affaire")} · ${fmt(t.ree)} REE · ${plural(t.n, "TOT", "TOT")}</p></div>${meSelector()}</div>`;
  $("view").innerHTML = `${head}<div class="kpis kpis-3">${kpis}</div>
    <div class="split even cepSplit">
      ${panel("Gel M0 à passer", cepList("gel", m.gel, cepGelWindow, m.today), { sub: "Gel M0 = J0 − 70 j · court terme : moins de 30 j, moyen terme : 30 à 90 j" })}
      ${panel("BPA à faire", cepList("bpa", m.bpa, cepBpaWindow, m.today), { sub: "selon le J0 · court terme : moins de 30 j, moyen terme : 30 à 90 j" })}
    </div>
    ${panel("Avancement par tranche", cepSheets(m), { actions: `<button type="button" data-go="tab:mine">Détail par affaire ›</button>` })}`;
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
