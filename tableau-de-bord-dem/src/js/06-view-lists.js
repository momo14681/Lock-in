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

function needsMe() {
  if (mode === "ce" && !me) { $("view").innerHTML = chooseMePanel(); return true; }
  return false;
}

function showOwnerColumn() {
  return mode === "coordo";
}

function viewTasks() {
  if (needsMe()) return;
  const rows = taskRows(), p = paginate(rows), owner = showOwnerColumn();
  const base = visible.filter(scopeTest);
  const focusOptions = TASK_FOCUS.filter(([key]) => mode === "coordo" || key !== "unassigned").map(([key, label]) => [key, label]);
  const body = p.slice.map((t) => `<tr>
    <td>${taskLink(t)}</td>
    ${owner ? `<td>${esc(t.responsable)}</td>` : ""}
    <td>OT ${esc(t.ot || "—")}<small>TOT ${esc(t.tot || "absente")}</small></td>
    <td>${t.j0Label}<small>Prépa : ${t.prepDueLabel}</small></td>
    <td>${stateBadge(t)}${t.infoMissing || (t.missingInfoKeys.length && !t.prepComplete && !isRealized(t)) ? `<small class="missingKeys">À compléter : ${esc(missingLabel(t))}</small>` : ""}</td>
    <td>${esc(t.bpa || "—")}</td><td>${esc(t.ger || "—")}</td><td>${esc(t.bpd || "—")}</td></tr>`);
  const scopeNote = taskScope ? ` <button type="button" class="linkbutton" data-go="tasks:${esc(taskFocus)}|clear">Retirer le filtre affaire</button>` : "";
  $("view").innerHTML = panel(`${esc(taskTitle())} · ${fmt(rows.length)}`,
    `${segment("taskFocus", focusOptions, taskFocus, { label: "Filtrer les TOT", counts: (key) => base.filter(focusTest(key)).length })}
     ${table(["Affaire / REE", ...(owner ? ["Chargé"] : []), "OT / TOT", "J0 / échéance prépa", "Statut", "BPA", "GER/1N", "BPD"], body)}${pager(p)}`,
    { sub: esc(scopeLabel()) + scopeNote, actions: exportButton() });
  currentExport = () => downloadMatrix(
    ["Affaire", "Libellé DI", "REE", "Chargé", "Feuille", "Ligne", "OT", "TOT", "J0", "Échéance prépa", "Statut", "À compléter", "BPA", "GER/1N", "BPD", "Observations"],
    rows.map((t) => [t.affaire, t.libelle, t.ree, t.responsable, t.sheet, t.rowNumber, t.ot, t.tot, t.j0Label, t.prepDueLabel, state(t), t.missingInfoKeys.length && !isRealized(t) ? missingLabel(t) : "", t.bpa, t.ger, t.bpd, observations(t)]),
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
  // Répartition des signalements actifs par chargé, hors filtre chargé.
  const pool = new Set(filteredBy(""));
  const active = data.audit.filter((i) => pool.has(i.t) && !ignoredIssues.has(issueId(i)));
  const counts = new Map();
  for (const i of active) counts.set(i.t.responsable, (counts.get(i.t.responsable) || 0) + 1);
  const current = $("owner").value;
  const chips = [["", "Tous", active.length], ...[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => [n, n, c])];
  return `<div class="ownerChips" role="group" aria-label="Signalements par chargé"><span class="muted">Par chargé :</span>${chips.map(([value, label, c]) => `<button type="button" data-owner="${esc(value)}" class="${value === current ? "active" : ""}" aria-pressed="${value === current}">${esc(label)} <span class="count">${fmt(c)}</span></button>`).join("")}</div>`;
}

function viewIssues() {
  if (needsMe()) return;
  const rows = issueRows(), p = paginate(rows), owner = showOwnerColumn();
  const pool = allIssues.filter((i) => ignoredIssues.has(issueId(i)) === showIgnored && (!issueKind || i.kind === issueKind));
  const kinds = [...new Set([...allIssues.map((i) => i.kind), ...(issueKind ? [issueKind] : [])])].sort((a, b) => a.localeCompare(b, "fr"));
  const ignoredCount = allIssues.filter((i) => ignoredIssues.has(issueId(i))).length;
  const controls = `<div class="controlRow">
      ${segment("issueLevel", [["", "Toutes priorités"], ...LEVELS.map((l) => [l, l])], issueLevel, { label: "Priorité", counts: (lvl) => pool.filter((i) => !lvl || i.level === lvl).length })}
      <label class="inlineField">Contrôle <select data-change="issueKind"><option value="">Tous les contrôles</option>${kinds.map((k) => `<option ${k === issueKind ? "selected" : ""} value="${esc(k)}">${esc(k)}</option>`).join("")}</select></label>
      <button type="button" data-toggle-ignored>${showIgnored ? "Voir les signalements actifs" : `Voir les ignorés (${fmt(ignoredCount)})`}</button>
      ${tip("Ignorer un signalement", "Ignoré uniquement pour cet import (réactivable). Les données et les indicateurs ne changent pas.")}
    </div>`;
  const body = p.slice.map((i) => `<tr>
    <td>${badge(i.level, LEVEL_TONE[i.level])}<small>${esc(i.kind)}</small></td>
    <td>${taskLink(i.t)}</td>
    ${owner ? `<td>${esc(i.t.responsable)}</td>` : ""}
    <td><span class="loc">${esc(i.t.sheet)}!${esc(i.cells)}</span></td>
    <td class="valueCell">${esc(i.value)}</td>
    <td>${esc(i.reason)}${observations(i.t) ? `<small class="obs">Obs. : ${esc(observations(i.t))}</small>` : ""}</td>
    <td>${ignoreButton(i)}</td></tr>`);
  const title = showIgnored ? "Signalements ignorés" : mode === "ce" ? "Mes corrections à faire dans la DEM" : "Corrections à faire dans la DEM";
  $("view").innerHTML = panel(`${title} · ${fmt(rows.length)}`,
    `${mode === "coordo" ? ownerChips() : ""}${controls}
     ${table(["Priorité / contrôle", "Affaire / REE", ...(owner ? ["Chargé"] : []), "Cellule(s) à corriger", "Valeur constatée", "Action proposée", ""], body, { empty: showIgnored ? "Aucun signalement ignoré." : "Aucun signalement : la DEM est cohérente sur ce périmètre." })}${pager(p)}`,
    { sub: `${esc(scopeLabel())} · ${esc(periodLabel())} · cliquez sur l’affaire pour voir toute la ligne Excel`, actions: exportButton() });
  currentExport = () => downloadMatrix(
    ["Priorité", "Contrôle", "Affaire", "REE", "Chargé", "Feuille", "Ligne", "Cellules", "Valeur", "Action", "Observations"],
    rows.map((i) => [i.level, i.kind, i.t.affaire, i.t.ree, i.t.responsable, i.t.sheet, i.t.rowNumber, i.cells, i.value, i.reason, observations(i.t)]),
    "Corrections_DEM.csv");
}

// --- Documents P / R -----------------------------------------------------------------

function viewDocuments() {
  if (needsMe()) return;
  const rows = documentRows(visible, docCode, documentType), p = paginate(rows), owner = showOwnerColumn();
  const typeOptions = [["", "Tous"], ["totPrete", "TOT prête"], ["bpa", "BPA"], ["ger", "GER/1N"], ["bpd", "BPD"]];
  const body = p.slice.map((i) => `<tr>
    <td>${taskLink(i.t)}</td>
    ${owner ? `<td>${esc(i.t.responsable)}</td>` : ""}
    <td>OT ${esc(i.t.ot || "—")}<small>TOT ${esc(i.t.tot || "—")}</small></td>
    <td><strong>${esc(i.kind)}</strong></td>
    <td>${badge(`${i.level} · ${i.value}`, docCode === "R" ? "warn" : "info")}</td>
    <td><span class="loc">${esc(i.t.sheet)}!${esc(i.cells)}</span></td>
    ${observationCell(i.t)}</tr>`);
  $("view").innerHTML = panel(`${docCode === "R" ? "Documents à reprendre (R)" : "Documents prêts à valider (P)"} · ${fmt(rows.length)}`,
    `<div class="controlRow">${segment("docCode", [["P", "Prêts à valider (P)"], ["R", "À reprendre (R)"]], docCode, { label: "État", counts: (code) => documentRows(visible, code, documentType).length })}
      ${segment("documentType", typeOptions, documentType, { label: "Document", counts: (type) => documentRows(visible, docCode, type).length })}</div>
     ${table(["Affaire / REE", ...(owner ? ["Chargé"] : []), "OT / TOT", "Document", "État", "Cellule", "Observations"], body)}${pager(p)}`,
    { sub: `${esc(scopeLabel())} · P : produit, en attente de validation ou de signature · R : retourné pour non-conformité`, actions: exportButton() });
  currentExport = () => downloadMatrix(
    ["Affaire", "REE", "Chargé", "Feuille", "OT", "TOT", "Document", "Valeur", "Cellule", "Observations"],
    rows.map((i) => [i.t.affaire, i.t.ree, i.t.responsable, i.t.sheet, i.t.ot, i.t.tot, i.kind, i.value, i.cells, observations(i.t)]),
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
  const model = groupModelCache = groupData(tab), p = paginate(model.rows);
  const offset = (page - 1) * PAGE_SIZE;
  const body = p.slice.map((r, index) => `<tr><td><button type="button" class="linkbutton" data-group="${offset + index}">${esc(r[0] || "Affaire manquante")}</button></td>${r.slice(1).map((v, i) => `<td class="${i >= 2 ? "num" : ""}">${esc(v)}</td>`).join("")}</tr>`);
  $("view").innerHTML = panel(`${fmt(model.groups.length)} ${tab === "affaires" ? "affaires" : "REE"}`,
    table(model.headers.map((h, i) => i >= 3 ? { label: h, cls: "num" } : h), body) + pager(p),
    { sub: esc(scopeLabel()) + " · cliquez pour voir les TOT", actions: exportButton() });
  currentExport = () => downloadMatrix(model.headers, model.rows, tab === "affaires" ? "Affaires_Essais.csv" : "REE_Essais.csv");
}

function openGroup(index) {
  const g = groupModelCache?.groups[index];
  if (g) openTasks("", { kind: g.kind, affaire: g.affaire, ree: g.ree, phase: g.phase });
}
