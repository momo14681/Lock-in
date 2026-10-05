// =============================================================================
// Listes détaillées partagées par les deux profils : TOT, corrections DEM,
// documents P / R, regroupements par affaire ou REE.
// =============================================================================

const TASK_FOCUS = [
  ["", "Toutes", () => true],
  ["overdue", "Prépa en retard", (t) => t.overdue],
  ["dueSoon", "Échéance < 30 j", (t) => t.dueSoon],
  ["missing", "Infos manquantes", (t) => t.infoMissing],
  ["noJ0", "J0 absent", (t) => !t.j0],
  ["prepared", "Prépa terminée", (t) => t.prepComplete],
  ["realized", "Réalisées", isRealized],
  ["unassigned", "Non affectées", (t) => t.responsable === UNASSIGNED],
];

function focusTest(key) {
  return (TASK_FOCUS.find((f) => f[0] === key) || TASK_FOCUS[0])[2];
}

function scopeTest(t) {
  return !taskScope || (t.affaire === taskScope.affaire && (taskScope.kind === "affaires" || (t.ree === taskScope.ree && dossierPhase(t) === taskScope.phase)));
}

function taskRows() {
  const test = focusTest(taskFocus);
  return visible.filter((t) => scopeTest(t) && test(t));
}

function taskTitle() {
  if (taskScope) return `TOT · ${taskScope.affaire || "Affaire manquante"}${taskScope.kind === "dossiers" ? " / " + taskScope.ree + " / " + taskScope.phase : ""}`;
  return mode === "ce" ? "Mes TOT" : "Toutes les TOT";
}

function backToMine() {
  return mode === "ce" ? `<button type="button" class="ghost" data-go="tab:mine">‹ Mes affaires</button>` : "";
}

function needsMe() {
  if (mode === "ce" && !me) { $("view").innerHTML = chooseMePanel(); return true; }
  return false;
}

function showOwnerColumn() {
  return mode === "coordo";
}

function viewTasks() {
  if (needsMe()) return;
  const owner = showOwnerColumn(), base = visible.filter(scopeTest);
  const focusOptions = TASK_FOCUS.filter(([key, , test]) => (mode === "coordo" || key !== "unassigned") && (!key || key === taskFocus || base.some(test))).map(([key, label]) => [key, label]);
  const columns = [
    { label: "Affaire / REE", value: (t) => `${t.affaire} ${t.ree} ${t.ot} ${t.tot} ${t.libelle}` },
    ...(owner ? [{ label: "Chargé", value: (t) => t.responsable, filter: true }] : []),
    { label: "Feuille", value: (t) => t.sheet, filter: true },
    { label: "J0", value: (t) => (t.j0 ? `${MONTHS_LONG[t.j0.getMonth()]} ${t.j0.getFullYear()}` : "J0 absent"), filter: true },
    { label: "Statut", value: state, filter: true },
    { label: "Documents", value: (t) => `${t.bpa} ${t.ger} ${t.bpd}` },
  ];
  const dt = dataTable({
    key: "tasks", columns, items: taskRows(),
    row: (t) => `<tr>
      <td>${taskLink(t)}</td>
      ${owner ? `<td>${esc(t.responsable)}</td>` : ""}
      <td>${esc(t.sheet)}</td>
      <td>${t.j0Label}<small>Prépa : ${t.prepDueLabel}</small></td>
      <td>${stateBadge(t)}${t.missingInfoKeys.length && !t.prepComplete && !isRealized(t) ? `<small class="missingKeys">Manque : ${esc(missingLabel(t))}</small>` : ""}</td>
      <td class="msCell">${milestoneLine(t)}</td></tr>`,
  });
  const scopeNote = taskScope ? ` <button type="button" class="linkbutton" data-go="tasks:${esc(taskFocus)}|clear">Retirer le filtre affaire</button>` : "";
  currentRows = dt.rows;
  $("view").innerHTML = panel(`${esc(taskTitle())} · ${fmt(dt.rows.length)}`,
    `${segment("taskFocus", focusOptions, taskFocus, { label: "Filtrer les TOT", counts: (key) => base.filter(focusTest(key)).length })}${dt.html}`,
    { sub: scopeNote, actions: backToMine() });
  currentExport = () => downloadMatrix(
    ["Affaire", "Libellé DI", "REE", "Chargé", "Feuille", "Ligne", "OT", "TOT", "J0", "Échéance prépa", "Statut", "À compléter", "BPA", "GER/1N", "BPD", "Observations"],
    dt.rows.map((t) => [t.affaire, t.libelle, t.ree, t.responsable, t.sheet, t.rowNumber, t.ot, t.tot, t.j0Label, t.prepDueLabel, state(t), t.missingInfoKeys.length && !isRealized(t) ? missingLabel(t) : "", t.bpa, t.ger, t.bpd, observations(t)]),
    "TOT_Essais.csv");
}

// --- Corrections DEM -------------------------------------------------------------

function issueRows() {
  return allIssues.filter((i) => ignoredIssues.has(issueId(i)) === showIgnored && (!issueKind || i.kind === issueKind) && (!issueLevel || i.level === issueLevel));
}

function ignoreButton(i) {
  const ignored = ignoredIssues.has(issueId(i));
  return `<button type="button" class="ignoreAction" data-ignore="${esc(issueId(i))}">${ignored ? "Réactiver" : "Ignorer"}</button>`;
}

function ownerChips() {
  // Qui doit corriger : signalements actifs par chargé, hors filtre chargé.
  const pool = new Set(filteredBy(""));
  const counts = new Map();
  for (const i of data.audit) if (pool.has(i.t) && !ignoredIssues.has(issueId(i))) counts.set(i.t.responsable, (counts.get(i.t.responsable) || 0) + 1);
  const current = $("owner").value;
  const chips = [["", "Tous"], ...[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => [n, `${n} ${fmt(c)}`])];
  return `<div class="ownerChips" role="group" aria-label="Chargé">${chips.map(([value, label]) => `<button type="button" data-owner="${esc(value)}" class="${value === current ? "active" : ""}" aria-pressed="${value === current}">${esc(label)}</button>`).join("")}</div>`;
}

function viewIssues() {
  if (needsMe()) return;
  const ignoredCount = allIssues.filter((i) => ignoredIssues.has(issueId(i))).length;
  const columns = [
    { label: "Priorité", value: (i) => i.level, filter: true },
    { label: "Affaire", value: (i) => `${i.t.affaire} ${i.t.ree}` },
    ...(mode === "coordo" ? [{ label: "Chargé", value: (i) => i.t.responsable, filter: true }] : []),
    { label: "Cellule Excel", value: (i) => i.t.sheet, filter: true },
    { label: "Problème", value: (i) => i.kind, filter: true },
    { label: "", value: (i) => `${i.reason} ${i.value}` },
  ];
  const dt = dataTable({
    key: "issues" + (showIgnored ? "-ignored" : ""), columns, items: issueRows(),
    empty: showIgnored ? "Aucun signalement ignoré." : "Rien à corriger : la DEM est cohérente.",
    tools: `<button type="button" class="ghost" data-toggle-ignored>${showIgnored ? "‹ Revenir aux corrections" : `Ignorées (${fmt(ignoredCount)})`}</button>`,
    row: (i) => `<tr>
      <td>${badge(i.level, LEVEL_TONE[i.level])}</td>
      <td><button type="button" class="linkbutton" data-task="${i.t.index}">${esc(i.t.affaire || "Affaire manquante")}</button><small>REE ${esc(i.t.ree || "absent")}</small></td>
      ${mode === "coordo" ? `<td>${esc(i.t.responsable)}</td>` : ""}
      <td><span class="loc">${esc(i.t.sheet)} ! ${esc(i.cells)}</span></td>
      <td><strong class="issueKind">${esc(i.kind)}</strong><span class="issueReason">${esc(i.reason)}</span></td>
      <td><button type="button" class="ignoreAction" data-ignore="${esc(issueId(i))}" title="Masquer ce signalement pour cet import">${ignoredIssues.has(issueId(i)) ? "Réactiver" : "Ignorer"}</button></td></tr>`,
  });
  currentRows = dt.rows;
  const title = showIgnored ? "Signalements ignorés" : "À corriger dans la DEM";
  $("view").innerHTML = panel(`${title} · ${fmt(dt.rows.length)}`, dt.html, {});
  currentExport = () => downloadMatrix(
    ["Priorité", "Contrôle", "Affaire", "REE", "Chargé", "Feuille", "Ligne", "Cellules", "Valeur", "Action", "Observations"],
    dt.rows.map((i) => [i.level, i.kind, i.t.affaire, i.t.ree, i.t.responsable, i.t.sheet, i.t.rowNumber, i.cells, i.value, i.reason, observations(i.t)]),
    "Corrections_DEM.csv");
}

// --- Documents P / R -----------------------------------------------------------------

function viewDocuments() {
  if (needsMe()) return;
  // Les documents « P » sont validés par les coordos : un chargé ne voit que ses « R ».
  if (mode === "ce") docCode = "R";
  const owner = showOwnerColumn();
  const columns = [
    { label: "Affaire / REE", value: (i) => `${i.t.affaire} ${i.t.ree} ${i.t.ot} ${i.t.tot}` },
    ...(owner ? [{ label: "Chargé", value: (i) => i.t.responsable, filter: true }] : []),
    { label: "Document", value: (i) => i.kind, filter: true },
    { label: "Cellule", value: (i) => i.t.sheet, filter: true },
    { label: "Observations", value: (i) => observations(i.t) },
  ];
  const dt = dataTable({
    key: "documents-" + docCode, columns, items: documentRows(visible, docCode),
    row: (i) => `<tr>
      <td>${taskLink(i.t)}</td>
      ${owner ? `<td>${esc(i.t.responsable)}</td>` : ""}
      <td>${badge(`${i.kind} · ${i.value}`, docCode === "R" ? "warn" : "info")}</td>
      <td><span class="loc">${esc(i.t.sheet)} ! ${esc(i.cells)}</span></td>
      ${observationCell(i.t)}</tr>`,
  });
  currentRows = dt.rows;
  $("view").innerHTML = panel(`${docCode === "R" ? (mode === "ce" ? "Mes documents à reprendre (R)" : "Documents à reprendre par les CE (R)") : "Documents à valider par les coordos (P)"} · ${fmt(dt.rows.length)}`,
    `${mode === "coordo" ? `<div class="controlRow">${segment("docCode", [["P", "À valider (P)"], ["R", "À reprendre par les CE (R)"]], docCode, { label: "État", counts: (code) => documentRows(visible, code).length })}</div>` : ""}${dt.html}`,
    { actions: backToMine() });
  currentExport = () => downloadMatrix(
    ["Affaire", "REE", "Chargé", "Feuille", "OT", "TOT", "Document", "Valeur", "Cellule", "Observations"],
    dt.rows.map((i) => [i.t.affaire, i.t.ree, i.t.responsable, i.t.sheet, i.t.ot, i.t.tot, i.kind, i.value, i.cells, observations(i.t)]),
    docCode === "P" ? "Documents_a_valider.csv" : "Documents_a_reprendre.csv");
}

// --- Regroupements (cartes Affaires / REE de la synthèse coordo) -------------------

function groupsFor(kind, rows = visible) {
  const groups = new Map();
  for (const t of rows) {
    if (kind === "affaires" ? !t.affaire : !t.ree) continue;
    const key = kind === "affaires" ? t.affaire : dossierKey(t);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, { kind, affaire: t.affaire, ree: kind === "dossiers" ? t.ree : "", phase: kind === "dossiers" ? dossierPhase(t) : "", ts: [] });
    groups.get(key).ts.push(t);
  }
  return [...groups.values()].sort((a, b) => (a.affaire + " " + a.ree).localeCompare(b.affaire + " " + b.ree, "fr", { numeric: true }));
}

function groupData(kind) {
  const groups = groupsFor(kind);
  return {
    groups,
    headers: [kind === "affaires" ? "Affaire" : "Affaire / REE / phase", "Feuilles", "Chargés", "TOT", "Prépa terminée", "Réalisés", "Retard"],
    rows: groups.map((g) => [g.affaire + (kind === "dossiers" ? " / " + g.ree + " / " + g.phase : ""), [...new Set(g.ts.map((t) => t.sheet))].join(", "), [...new Set(g.ts.map((t) => t.responsable))].join(", "), g.ts.length, g.ts.filter((t) => t.prepComplete).length, g.ts.filter(isRealized).length, g.ts.filter((t) => t.overdue).length]),
  };
}

let groupModelCache = null;
function viewGroups() {
  const model = groupModelCache = groupData(tab);
  const items = model.groups.map((g, index) => ({ g, index, r: model.rows[index] }));
  const columns = [
    { label: model.headers[0], value: (x) => x.r[0] },
    { label: model.headers[1], value: (x) => x.r[1], filter: true },
    { label: model.headers[2], value: (x) => x.r[2] },
    ...model.headers.slice(3).map((h, k) => ({ label: h, cls: "num", value: (x) => x.r[3 + k] })),
  ];
  const dt = dataTable({
    key: "groups-" + tab, columns, items,
    row: (x) => `<tr><td><button type="button" class="linkbutton" data-group="${x.index}">${esc(x.r[0] || "Affaire manquante")}</button></td>${x.r.slice(1).map((v, i) => `<td class="${i >= 2 ? "num" : ""}">${esc(v)}</td>`).join("")}</tr>`,
  });
  $("view").innerHTML = panel(`${fmt(dt.rows.length)} ${tab === "affaires" ? "affaires" : "REE"}`, dt.html, {});
  currentExport = () => downloadMatrix(model.headers, dt.rows.map((x) => x.r), tab === "affaires" ? "Affaires_Essais.csv" : "REE_Essais.csv");
}

function openGroup(index) {
  const g = groupModelCache?.groups[index];
  if (g) openTasks("", { kind: g.kind, affaire: g.affaire, ree: g.ree, phase: g.phase });
}
