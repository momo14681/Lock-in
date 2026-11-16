// =============================================================================
// Vue « Chargé d'essais » : chacun pilote ses affaires.
// =============================================================================

const AFFAIRE_STATUS = {
  late: { label: "Prépa en retard", tone: "warn", rank: 0 },
  missing: { label: "À compléter", tone: "warn", rank: 1 },
  ongoing: { label: "En préparation", tone: "neutral", rank: 2 },
  ready: { label: "Prépa terminée", tone: "info", rank: 3 },
  done: { label: "Réalisée", tone: "good", rank: 4 },
  archived: { label: "BPD (archivée)", tone: "good", rank: 5 },
};

function milestoneStats(ts, key) {
  const done = ts.filter((t) => t[key] === "done").length;
  return { done, produced: ts.filter((t) => produced(t, key)).length };
}

// Regroupe des TOT par affaire (N° DI) avec leurs indicateurs d'avancement.
function affaireGroups(tasks, issueList = issues) {
  const today = data.today;
  const issueCount = new Map();
  for (const i of issueList) issueCount.set(i.t, (issueCount.get(i.t) || 0) + 1);
  const map = new Map();
  for (const t of tasks) {
    const key = t.affaire || "";
    if (!map.has(key)) map.set(key, { affaire: t.affaire, libelle: "", ts: [] });
    const g = map.get(key);
    g.ts.push(t);
    if (!g.libelle && t.libelle) g.libelle = t.libelle;
  }
  return [...map.values()].map((g) => {
    const ts = g.ts, n = ts.length;
    const j0s = ts.map((t) => t.j0).filter(Boolean).sort((a, b) => a - b);
    const pendingDue = ts.filter((t) => !t.prepComplete && t.prepDue && !isRealized(t)).map((t) => t.prepDue).sort((a, b) => a - b);
    Object.assign(g, {
      n,
      sheets: [...new Set(ts.map((t) => t.sheet))].sort(),
      rees: dossierCount(ts),
      prep: ts.filter((t) => t.prepComplete).length,
      realized: ts.filter(isRealized).length,
      overdue: ts.filter((t) => t.overdue).length,
      softLate: ts.filter((t) => t.softLate).length,
      dueSoon: ts.filter((t) => t.dueSoon).length,
      missing: ts.filter((t) => t.infoMissing).length,
      noJ0: ts.filter((t) => !t.j0).length,
      issues: ts.reduce((s, t) => s + (issueCount.get(t) || 0), 0),
      bpa: milestoneStats(ts, "bpaState"),
      ger: milestoneStats(ts, "gerState"),
      bpd: milestoneStats(ts, "bpdState"),
      nextJ0: j0s.find((d) => d >= today) || j0s[j0s.length - 1] || null,
      j0Min: j0s[0] || null,
      j0Max: j0s[j0s.length - 1] || null,
      nextDue: pendingDue[0] || null,
      owners: [...new Set(ts.map((t) => t.responsable))],
    });
    // Jalons de la feuille Pilotage : Gel M0 par TOT, BPA et BPD par REE.
    const ds = cepDossiers(ts);
    g.nRee = ds.length;
    g.gel = ts.filter(gelDone).length;
    g.bpaRee = ds.filter((d) => d.bpaDone).length;
    g.bpdRee = ds.filter((d) => d.bpdSigned).length;
    g.status = ts.every((t) => t.archived) ? "archived" : g.overdue ? "late" : g.missing ? "missing" : g.realized === n ? "done" : g.prep === n ? "ready" : "ongoing";
    return g;
  }).sort((a, b) => AFFAIRE_STATUS[a.status].rank - AFFAIRE_STATUS[b.status].rank
    || (a.nextDue || a.nextJ0 || Infinity) - (b.nextDue || b.nextJ0 || Infinity)
    || COLLATOR_FR_NUM.compare(a.affaire, b.affaire));
}

function j0Range(g) {
  if (!g.j0Min) return '<span class="muted">J0 absent</span>';
  const same = g.j0Min.getTime() === g.j0Max.getTime();
  return same ? formatDate(g.j0Min) : `${formatShortDate(g.j0Min)} → ${formatShortDate(g.j0Max)}`;
}

// Barre empilée des statuts des TOT (réalisé → en retard), avec infobulle.
function stateBar(ts, { width = "" } = {}) {
  const n = ts.length;
  if (!n) return '<span class="muted">—</span>';
  const counts = STATE_ORDER.map((s) => [s, ts.filter((t) => state(t) === s).length]).filter(([, c]) => c);
  const tipText = counts.map(([s, c]) => `${fmt(c)} ${s.toLowerCase()}`).join(" · ");
  return `<span class="stateBar"${width ? ` style="width:${width}"` : ""} data-tip="${fmt(n)} TOT\n${esc(tipText)}" tabindex="0">${counts.map(([s, c]) => `<span style="flex:${c} 1 0;background:${STATE_COLORS[s]}"></span>`).join("")}</span>`;
}

// Colonne « État » : le statut de l'affaire, puis ce qui reste à surveiller (sans le redire).
function affaireStateCell(g) {
  const st = AFFAIRE_STATUS[g.status], out = [badge(st.label, st.tone)];
  if (g.overdue) out.push(`<span class="softCount">${plural(g.overdue, "TOT", "TOT")}</span>`);
  else if (g.dueSoon) out.push(badge(`${fmt(g.dueSoon)} à boucler sous 30 j`, "warn"));
  if (g.softLate) out.push(`<span class="softCount" title="Arrêt de tranche : J0 indicatif, non compté en retard">${fmt(g.softLate)} échéance${g.softLate > 1 ? "s" : ""} J0 passée${g.softLate > 1 ? "s" : ""}</span>`);
  if (g.issues) out.push(`<span class="softCount">${plural(g.issues, "correction")}</span>`);
  return `<div class="stateCell">${out.join("")}</div>`;
}

function fracCell(a, b) {
  return b ? `<span class="cepFrac${a === b ? " full" : ""}">${fmt(a)}<span class="muted">/${fmt(b)}</span></span>` : '<span class="muted">—</span>';
}

function milestoneLine(t) {
  return [["BPA", t.bpa], ["GER", t.ger], ["BPD", t.bpd]].map(([k, v]) => `<span class="ms"><b>${k}</b> ${esc(v || "—")}</span>`).join("");
}

function affaireRow(g) {
  {
    const open = expandedAffaires.has(g.affaire);
    const row = `<tr class="affaireRow${open ? " open" : ""}">
      <td><button type="button" class="expander" data-expand="${esc(g.affaire)}" aria-expanded="${open}"><span class="chev" aria-hidden="true">›</span><span><strong>${esc(g.affaire || "Affaire manquante")}</strong><small>${esc(g.libelle || g.sheets.join(", "))}</small></span></button></td>
      <td>${j0Range(g)}</td>
      <td><div class="progressCell">${stateBar(g.ts)}<span>${fmt(g.realized)}/${fmt(g.n)} réalisées</span></div></td>
      <td class="num">${fracCell(g.gel, g.n)}</td><td class="num">${fracCell(g.bpaRee, g.nRee)}</td><td class="num">${fracCell(g.bpdRee, g.nRee)}</td>
      <td>${affaireStateCell(g)}</td></tr>`;
    if (!open) return row;
    const sub = g.ts.slice().sort((a, b) => COLLATOR_FR_NUM.compare(a.ree, b.ree) || a.rowNumber - b.rowNumber).map((t) => `<tr>
      <td><button type="button" class="linkbutton" data-task="${t.index}">REE ${esc(t.ree || "absent")}</button><small>TOT ${esc(t.tot || "—")} · ${esc(t.sheet)} ligne ${t.rowNumber}</small></td>
      <td>${t.j0Label}</td>
      <td>${t.missingInfoKeys.length && !isRealized(t) ? `<span class="missingKeys">Manque : ${esc(missingLabel(t))}</span>` : '<span class="muted">Préparation complète</span>'}</td>
      <td class="msCell">${milestoneLine(t)}</td>
      <td>${stateBadge(t)}</td>
      <td>${toolLinks(t.ot, t.tot)}</td></tr>`);
    return row + `<tr class="subRow"><td colspan="7">${table(["REE / TOT", "J0", "Préparation", "Documents", "Statut", "Liens"], sub, { cls: "compact", free: true })}</td></tr>`;
  }
}

function chooseMePanel() {
  const owners = ownersList().filter((n) => n !== UNASSIGNED);
  return `<section class="panel chooseMe"><h2>Qui êtes-vous ?</h2>
    <p class="muted">Choisissez votre nom tel qu’il apparaît dans la colonne « Chargé d’essai SP » de la DEM. Ce choix est mémorisé sur ce PC.</p>
    <div class="nameGrid">${owners.map((n) => `<button type="button" data-me="${esc(n)}">${esc(n)}</button>`).join("")}</div>
  </section>`;
}

function meSelector() {
  const owners = ownersList();
  const options = (me && !owners.includes(me) ? [me, ...owners] : owners).map((n) => `<option ${n === me ? "selected" : ""} value="${esc(n)}">${esc(n)}</option>`).join("");
  return `<label class="meSelect"><span>Vue de</span><select data-change="me" aria-label="Chargé d’essais"><option value="">— Choisir —</option>${options}</select></label>`;
}

function viewMine() {
  if (!me) { $("view").innerHTML = chooseMePanel(); return; }
  const ts = visible, n = ts.length, team = filteredBy("");
  const groups = affaireGroups(ts);
  const realized = ts.filter(isRealized).length, prepared = ts.filter((t) => t.prepComplete).length;
  const overdue = ts.filter((t) => t.overdue).length;
  const teamPct = (f) => pct(team.filter(f).length, team.length);
  const kpis = [
    kpi({ label: "Préparation terminée", value: pct(prepared, n), sub: `équipe : ${teamPct((t) => t.prepComplete)}`, bar: { ratio: ratio(prepared, n), color: STATE_COLORS[STATE.ready] }, go: "tasks:prepared" }),
    kpi({ label: "Essais réalisés", value: pct(realized, n), sub: `équipe : ${teamPct(isRealized)}`, bar: { ratio: ratio(realized, n), color: STATE_COLORS[STATE.realized] }, go: "tasks:realized" }),
    kpi({ label: "Prépas en retard", value: fmt(overdue), sub: overdue ? "échéance J0 − 30 dépassée" : "aucune", tone: overdue ? "warn" : "good", go: "tasks:overdue" }),
    kpi({ label: "À corriger dans la DEM", value: fmt(issues.length), sub: issues.length ? "cellules à vérifier" : "rien à corriger", tone: issues.length ? "warn" : "good", go: "tab:issues" }),
  ].join("");
  const head = `<div class="viewHead"><div><h2 class="viewTitle">Mes affaires</h2><p class="muted">${plural(groups.length, "affaire")} · ${plural(n, "TOT", "TOT")}</p></div>${meSelector()}</div>`;
  const tableHtml = n
    ? dataTable({
      key: "mine", items: groups, row: affaireRow, paged: false, cls: "affaires", free: true,
      columns: [
        { label: "Affaire", value: (g) => `${g.affaire} ${g.libelle} ${g.ts.map((t) => t.ree).join(" ")}` },
        { label: "J0", value: (g) => (g.nextJ0 ? `${MONTHS_LONG[g.nextJ0.getMonth()]} ${g.nextJ0.getFullYear()}` : "J0 absent"), filter: true },
        { label: "Avancement", value: (g) => `${g.realized}/${g.n}` },
        { label: "Gel M0", cls: "num", value: (g) => ratio(g.gel, g.n), hint: "TOT gelées : MC, OT, TOT, RDU et Régime renseignés" },
        { label: "BPA", cls: "num", value: (g) => ratio(g.bpaRee, g.nRee), hint: "REE dont le BPA est daté ou en P" },
        { label: "BPD", cls: "num", value: (g) => ratio(g.bpdRee, g.nRee), hint: "REE dont le BPD est signé" },
        { label: "État", value: (g) => AFFAIRE_STATUS[g.status].label, filter: true },
      ],
    }).html
    : emptyState("Aucune TOT pour ce chargé", "Vérifiez les filtres.");
  $("view").innerHTML = `${head}<div class="kpis kpis-4">${kpis}</div>
    ${panel("Avancement par affaire", `${legend(STATE_ORDER.map((s) => [s, STATE_COLORS[s]]))}${tableHtml}`, { sub: "Gel M0 par TOT · BPA et BPD par REE" })}`;
  currentExport = () => downloadMatrix(
    ["Affaire", "Libellé DI", "Feuilles", "TOT", "REE", "J0 min", "J0 max", "Prochaine échéance prépa", "Prépa terminée", "Réalisées", "TOT gelées (Gel M0)", "REE avec BPA", "REE avec BPD signé", "BPA signés", "GER/1N signés", "BPD signés", "Prépas en retard", "Infos manquantes", "Corrections DEM", "Statut"],
    groups.map((g) => [g.affaire, g.libelle, g.sheets.join(" "), g.n, g.rees, formatDate(g.j0Min), formatDate(g.j0Max), formatDate(g.nextDue), g.prep, g.realized, g.gel, g.bpaRee, g.bpdRee, g.bpa.done, g.ger.done, g.bpd.done, g.overdue, g.missing, g.issues, AFFAIRE_STATUS[g.status].label]),
    `Mes_affaires_${me.replace(/[^\p{L}\p{N}_-]+/gu, "_")}.csv`);
}
