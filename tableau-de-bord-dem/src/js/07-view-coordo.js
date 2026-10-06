// =============================================================================
// Vue « Coordo essais » : charge de l'équipe et corrections à faire dans la DEM.
// =============================================================================

const CHARGE_MODES = [["tasks", "TOT par statut"], ["phase", "REE TEM / AT"], ["dossiers", "REE"]];
const CHARGE_SORTS = [["total", "Total"], ["AT", "AT"], ["TEM", "TEM"], ["name", "Nom"]];
const CHARGE_UNIT = { tasks: "TOT", dossiers: "REE", phase: "REE" };

// Charge d'un chargé sur une phase, dans l'unité du mode choisi.
function phaseLoad(ts, phase) {
  const inPhase = ts.filter((t) => dossierPhase(t) === phase);
  return chargeMode === "tasks" ? inPhase.length : dossierCount(inPhase);
}

function chargeSegments(ts) {
  if (chargeMode === "dossiers") return [{ label: "REE", value: dossierCount(ts), color: STATE_COLORS[STATE.ready] }];
  if (chargeMode === "phase") {
    const phases = chargeSort === "TEM" ? ["TEM", "AT"] : ["AT", "TEM"];
    if (visible.some((t) => dossierKey(t) && dossierPhase(t) === "Non précisé")) phases.push("Non précisé");
    return phases.map((p) => ({ label: p, value: phaseLoad(ts, p), color: PHASE_COLORS[p] }));
  }
  return STATE_ORDER.map((s) => ({ label: s, value: ts.filter((t) => state(t) === s).length, color: STATE_COLORS[s] }));
}

function chargeGroups() {
  const groups = [...new Set(visible.map((t) => t.responsable))].filter((name) => !hiddenOwners.has(name)).map((name) => {
    const ts = visible.filter((t) => t.responsable === name);
    const segments = chargeSegments(ts);
    return { name, ts, segments, total: segments.reduce((s, x) => s + x.value, 0), AT: phaseLoad(ts, "AT"), TEM: phaseLoad(ts, "TEM") };
  });
  const byName = (a, b) => a.name.localeCompare(b.name, "fr", { numeric: true });
  const sorters = {
    total: (a, b) => b.total - a.total || byName(a, b),
    AT: (a, b) => b.AT - a.AT || b.total - a.total || byName(a, b),
    TEM: (a, b) => b.TEM - a.TEM || b.total - a.total || byName(a, b),
    name: byName,
  };
  return groups.sort(sorters[chargeSort] || sorters.total);
}

function chargeChart() {
  const groups = chargeGroups(), unit = CHARGE_UNIT[chargeMode];
  const max = Math.max(1, ...groups.map((g) => g.total));
  const sortKey = chargeSort === "AT" || chargeSort === "TEM" ? chargeSort : "";
  const rows = groups.map((g) => {
    const segs = g.segments.filter((s) => s.value > 0).map((s) => `<span class="seg" style="flex:${s.value} 1 0;background:${s.color}" data-tip="${fmt(s.value)} ${unit}\n${esc(s.label)} · ${esc(g.name)}" tabindex="0"></span>`).join("");
    return `<div class="chargeRow${sortKey && !g[sortKey] ? " dim" : ""}">
      <button type="button" class="ownerHide" data-hide="${esc(g.name)}" title="Masquer ${esc(g.name)} du graphique"><span>${esc(g.name)}</span><span class="x" aria-hidden="true">×</span></button>
      <div class="chargeTrack"><div class="chargeBar" style="width:${(g.total / max * 100).toFixed(2)}%">${segs}</div></div>
      <span class="chargeValue"><strong>${fmt(g.total)}</strong>${sortKey ? `<small class="sortValue phase-${sortKey}">${sortKey} ${fmt(g[sortKey])}</small>` : ""}</span>
    </div>`;
  }).join("");
  const hidden = [...hiddenOwners].map((name) => `<button type="button" class="restore" data-hide="${esc(name)}">+ ${esc(name)}</button>`).join("");
  const legendEntries = chargeMode === "dossiers" ? [] : chargeSegments(visible).map((s) => [s.label, s.color]);
  return `<div class="controlRow">${segment("chargeMode", CHARGE_MODES, chargeMode, { label: "Unité" })}
      <span class="controlLabel">Trier par charge</span>${segment("chargeSort", CHARGE_SORTS, chargeSort, { label: "Tri" })}</div>
    ${legendEntries.length ? legend(legendEntries) : ""}
    ${hidden ? `<div class="hiddenOwners"><span class="muted">Masqués :</span>${hidden}<button type="button" class="linkbutton" data-show-all>Tout réafficher</button></div>` : ""}
    <div class="chargeChart">${rows || emptyState("Aucun chargé affiché")}</div>
`;
}

function barList(entries, { go, color = "var(--ink-3)", empty = "Aucun signalement." } = {}) {
  if (!entries.length) return emptyState(empty);
  const peak = Math.max(1, ...entries.map((e) => e.n));
  return `<ul class="barList">${entries.map((e) => `<li><button type="button" data-go="${esc(go(e))}">
      <span class="barListLabel">${esc(e.label)}</span>
      <span class="barListTrack"><span style="width:${(e.n / peak * 100).toFixed(1)}%;background:${e.color || color}"></span></span>
      <strong>${fmt(e.n)}</strong></button></li>`).join("")}</ul>`;
}

function signalPanel() {
  const byOwner = [...new Set(issues.map((i) => i.t.responsable))].map((n) => {
    const list = issues.filter((i) => i.t.responsable === n);
    return { label: n, n: list.length, color: list.some((i) => i.level === "Prioritaire") ? STATE_COLORS[STATE.late] : STATE_COLORS[STATE.missing] };
  }).sort((a, b) => b.n - a.n);
  const urgent = issues.filter((i) => i.level === "Prioritaire").length;
  return panel(`Qui doit corriger la DEM ? · ${fmt(issues.length)}`,
    `${legend([[`avec au moins une correction prioritaire (${fmt(urgent)})`, STATE_COLORS[STATE.late]], ["sans correction prioritaire", STATE_COLORS[STATE.missing]]])}
     ${barList(byOwner.slice(0, 10), { go: (e) => "issues-owner:" + e.label })}
     ${byOwner.length > 10 ? `<p class="muted">+ ${plural(byOwner.length - 10, "autre chargé", "autres chargés")}</p>` : ""}`,
    { cls: "signalPanel", actions: `<button type="button" data-go="tab:issues">Tout voir ›</button>` });
}

// Couleurs des documents : signés / produits en attente de signature / non produits.
const DOC_COLORS = { signed: STATE_COLORS[STATE.realized], waiting: STATE_COLORS[STATE.missing], none: "#dfe6ee" };

function milestoneCards(ts) {
  const n = ts.length;
  return `<div class="milestones">${[["BPA", "bpaState"], ["GER / 1N", "gerState"], ["BPD", "bpdState"]].map(([label, key]) => {
    const { done, produced: prod } = milestoneStats(ts, key);
    const waiting = Math.max(0, prod - done), none = Math.max(0, n - prod);
    const part = (v, color, text) => `<span class="docPart"><i style="background:${color}"></i><b>${pct(v, n)}</b> ${text}</span>`;
    return `<section class="milestone">
      <h3>${label}</h3>
      <span class="docBar" data-tip="${fmt(done)} signés · ${fmt(waiting)} à signer · ${fmt(none)} non produits\nsur ${fmt(n)} TOT" tabindex="0">
        <span style="flex:${done} 1 0;background:${DOC_COLORS.signed}"></span><span style="flex:${waiting} 1 0;background:${DOC_COLORS.waiting}"></span><span style="flex:${none} 1 0;background:${DOC_COLORS.none}"></span></span>
      <div class="docParts">${part(done, DOC_COLORS.signed, "signés")}${part(waiting, DOC_COLORS.waiting, "à signer")}${part(none, DOC_COLORS.none, "non produits")}</div>
    </section>`;
  }).join("")}</div>`;
}

// Actions propres aux coordos (valider les « P », affecter les TOT).
function coordoTodo(ts) {
  const items = [
    { n: documentRows(ts, "P").length, tone: "info", title: "documents à valider (P)", go: "documents:P" },
    { n: ts.filter((t) => t.responsable === UNASSIGNED).length, tone: "warn", title: "TOT sans chargé d’essais", go: "tasks:unassigned" },
  ].filter((i) => i.n);
  if (!items.length) return "";
  return `<div class="todoStrip"><span class="todoStripLabel">À faire</span>${items.map((i) => `<button type="button" data-go="${i.go}" class="todoItem tone-${i.tone}"><span class="todoCount">${fmt(i.n)}</span><span class="todoText">${esc(i.title)}</span><span class="todoGo" aria-hidden="true">›</span></button>`).join("")}</div>`;
}

function viewOverview() {
  const ts = visible, n = ts.length;
  const realized = ts.filter(isRealized).length, prepared = ts.filter((t) => t.prepComplete).length;
  const overdue = ts.filter((t) => t.overdue).length;
  const kpis = [
    kpi({ label: "Préparation terminée", value: pct(prepared, n), sub: `${fmt(prepared)} / ${fmt(n)} TOT`, bar: { ratio: ratio(prepared, n), color: STATE_COLORS[STATE.ready] }, go: "tasks:prepared" }),
    kpi({ label: "Essais réalisés", value: pct(realized, n), sub: `${fmt(realized)} / ${fmt(n)} TOT`, bar: { ratio: ratio(realized, n), color: STATE_COLORS[STATE.realized] }, go: "tasks:realized" }),
    kpi({ label: "Lignes DEM incomplètes", value: fmt(overdue), sub: "échéance J0 − 30 dépassée", tone: overdue ? "bad" : "good", go: "tasks:overdue" }),
    kpi({ label: "À corriger dans la DEM", value: fmt(issues.length), sub: `${plural(new Set(issues.map((i) => i.t)).size, "TOT concernée", "TOT concernées")}`, tone: issues.length ? "warn" : "good", go: "tab:issues" }),
  ].join("");
  $("view").innerHTML = `<div class="viewHead"><div><h2 class="viewTitle">Synthèse</h2>
      <p class="muted">${fmt(n)} TOT · <button type="button" class="linkbutton" data-go="groups:affaires">${fmt(countUnique(ts, (t) => t.affaire))} affaires</button> · <button type="button" class="linkbutton" data-go="groups:dossiers">${fmt(dossierCount(ts))} REE</button> · ${esc(scopeLabel())}</p></div></div>
    <div class="kpis kpis-4">${kpis}</div>
    ${coordoTodo(ts)}
    <div class="split wide">${panel("Charge par chargé d’essais", chargeChart(), { cls: "chargePanel" })}${signalPanel()}</div>`;
  currentExport = () => downloadMatrix(["Chargé", ...chargeSegments(visible).map((s) => s.label), "Total", "AT", "TEM"],
    chargeGroups().map((g) => [g.name, ...g.segments.map((s) => s.value), g.total, g.AT, g.TEM]), "Charge_par_charge.csv");
}

// --- Répartition par chargé ------------------------------------------------------------

function ownerStats() {
  const pool = new Set(visible);
  const issueCount = new Map();
  for (const i of issues) if (pool.has(i.t)) issueCount.set(i.t.responsable, (issueCount.get(i.t.responsable) || 0) + 1);
  return [...new Set(visible.map((t) => t.responsable))].map((name) => {
    const ts = visible.filter((t) => t.responsable === name);
    return {
      name, ts, n: ts.length,
      type: name === UNASSIGNED ? UNASSIGNED : PROVIDER_NAMES.has(status(name)) ? "Prestataire" : "Interne",
      affaires: countUnique(ts, (t) => t.affaire),
      ree: dossierCount(ts), reeTEM: dossierCount(ts.filter((t) => dossierPhase(t) === "TEM")), reeAT: dossierCount(ts.filter((t) => dossierPhase(t) === "AT")),
      prep: ts.filter((t) => t.prepComplete).length, realized: ts.filter(isRealized).length,
      overdue: ts.filter((t) => t.overdue).length, missing: ts.filter((t) => t.infoMissing).length,
      issues: issueCount.get(name) || 0,
      bpa: milestoneStats(ts, "bpaState"), ger: milestoneStats(ts, "gerState"), bpd: milestoneStats(ts, "bpdState"),
    };
  }).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, "fr"));
}

function viewOwners() {
  const stats = ownerStats();
  const signed = (s, n) => `${fmt(s.done)} <span class="muted">/ ${fmt(s.produced)}</span>`;
  const dt = dataTable({
    key: "owners", items: stats, paged: false,
    columns: [
      { label: "Chargé / entreprise", value: (s) => s.name },
      { label: "Type", value: (s) => s.type, filter: true },
      { label: "Affaires", cls: "num", value: (s) => s.affaires },
      { label: "REE", cls: "num", value: (s) => s.ree },
      { label: "TOT", cls: "num", value: (s) => s.n },
      { label: "Prépa terminée", value: () => "" },
      { label: "Réalisés", value: () => "" },
      { label: "Retards", cls: "num", value: (s) => s.overdue },
      { label: "Corrections", cls: "num", value: (s) => s.issues },
    ],
    row: (s) => `<tr>
      <td><button type="button" class="linkbutton" data-owner-tasks="${esc(s.name)}">${esc(s.name)}</button></td>
      <td>${esc(s.type)}</td>
      <td class="num">${fmt(s.affaires)}</td>
      <td class="num">${fmt(s.ree)}<small>TEM ${fmt(s.reeTEM)} · AT ${fmt(s.reeAT)}</small></td>
      <td class="num">${fmt(s.n)}</td>
      <td>${meter(s.prep, s.n, { color: STATE_COLORS[STATE.ready] })}</td>
      <td>${meter(s.realized, s.n, { color: STATE_COLORS[STATE.realized] })}</td>
      <td class="num">${s.overdue ? badge(fmt(s.overdue), "bad") : '<span class="muted">0</span>'}</td>
      <td class="num">${s.issues ? `<button type="button" class="linkbutton" data-go="issues-owner:${esc(s.name)}">${fmt(s.issues)}</button>` : '<span class="muted">0</span>'}</td></tr>`,
  });
  $("view").innerHTML = panel("Répartition par chargé d’essais", dt.html, {});
  currentExport = () => downloadMatrix(
    ["Chargé", "Type", "Affaires", "REE", "REE TEM", "REE AT", "TOT", "Prépa terminée", "Réalisés", "Lignes DEM incomplètes", "Infos manquantes", "Corrections DEM", "BPA signés", "BPA produits", "GER/1N signés", "GER/1N produits", "BPD signés", "BPD produits"],
    dt.rows.map((s) => [s.name, s.type, s.affaires, s.ree, s.reeTEM, s.reeAT, s.n, s.prep, s.realized, s.overdue, s.missing, s.issues, s.bpa.done, s.bpa.produced, s.ger.done, s.ger.produced, s.bpd.done, s.bpd.produced]),
    "Repartition_par_charge.csv");
}

// --- Affectations SharePoint (feuille « Suivi modification IPE ») ------------------------

function normalizedIPE(v) {
  return String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’]/g, "'").trim().toLowerCase();
}

function assignmentState(v) {
  const s = normalizedIPE(v);
  return !s || /^(?:-|—|n\/a|na|non affecte[e]?|a affecter)$/.test(s) || s.includes("en attente d'affectation") ? "missing" : s.includes("pas besoin") ? "exempt" : "assigned";
}

function readAssignments(sh) {
  if (!sh) return { error: `Feuille « ${IPE_SHEET} » absente.`, groups: [] };
  const rows = XLSX.utils.sheet_to_json(sh, { header: 1, defval: "" });
  const h = (rows[0] || []).map(normalizedIPE);
  const find = (s) => h.findIndex((v) => v.includes(s));
  const ref = find("reference edim"), aff = find("tranche affaire tome"), owner = h.findIndex((v) => v === "charge d'essais"), phase = find("etat tranche"), year = find("annee pt");
  if (ref < 0 || aff < 0 || owner < 0 || phase < 0) return { error: "Colonnes IPE non reconnues : référence, affaire, état tranche ou chargé d’essais.", groups: [] };
  const groups = new Map();
  rows.slice(1).forEach((r, index) => {
    const reference = String(r[ref] || "").trim();
    const affaire = String(r[aff] || reference.replace(/_[MA]$/, "")).trim();
    if (!affaire) return;
    const modeCode = String(r[phase] || reference.match(/_([MA])$/)?.[1] || "").trim().toUpperCase();
    const key = JSON.stringify([affaire, modeCode]);
    if (!groups.has(key)) groups.set(key, { affaire, mode: modeCode, rows: [], sheet: /^[0-9]/.test(affaire) && ["M", "A"].includes(modeCode) ? "CS" + affaire[0] + modeCode : "" });
    groups.get(key).rows.push({ row: index + 2, reference, owner: String(r[owner] || "").trim(), state: assignmentState(r[owner]), year: String(r[year] || ""), cell: XLSX.utils.encode_cell({ r: index + 1, c: owner }) });
  });
  return {
    groups: [...groups.values()].map((g) => ({
      ...g,
      status: g.rows.some((r) => r.state === "assigned") ? (g.rows.some((r) => r.state === "missing") ? "partial" : "assigned") : g.rows.some((r) => r.state === "missing") ? "missing" : "exempt",
    })),
  };
}

const assignmentLabels = { missing: "Sans chargé", partial: "Affectation partielle", exempt: "Pas besoin — à confirmer", assigned: "Affectée" };
const assignmentTones = { missing: "bad", partial: "warn", exempt: "info", assigned: "good" };

function assignmentGroups() {
  const q = $("search").value.trim().toLowerCase();
  return (data.ipe?.groups || []).filter((g) => !q || [g.affaire, ...g.rows.map((r) => r.owner + " " + r.reference)].join(" ").toLowerCase().includes(q));
}

function assignmentModel() {
  const groups = assignmentGroups().filter((g) => !assignmentFilter || g.status === assignmentFilter);
  return {
    groups,
    headers: ["Affaire eDIM", "TEM / AT", "Année PT", "Statut IPE", "Chargé / valeur saisie", "Cellules IPE"],
    rows: groups.map((g) => [g.affaire, g.mode === "M" ? "TEM" : g.mode === "A" ? "AT" : "Non précisé", [...new Set(g.rows.map((r) => r.year))].join(", "), assignmentLabels[g.status], [...new Set(g.rows.map((r) => r.owner || "(vide)"))].join(" · "), g.rows.map((r) => r.cell).join(", ")]),
  };
}

function viewAssignments() {
  if (data.ipe?.error) { $("view").innerHTML = panel("Affectations SharePoint", `<p>${esc(data.ipe.error)}</p>`); currentExport = null; return; }
  const m = assignmentModel(), all = assignmentGroups();
  const items = m.groups.map((g, i) => ({ g, r: m.rows[i] }));
  const dt = dataTable({
    key: "assignments", items,
    columns: [
      { label: "Affaire eDIM", value: (x) => x.r[0] },
      { label: "TEM / AT", value: (x) => x.r[1], filter: true },
      { label: "Année PT", value: (x) => x.r[2], filter: true },
      { label: "Statut IPE", value: (x) => x.r[3] },
      { label: "Chargé / valeur saisie", value: (x) => x.r[4], filter: true },
      { label: "Cellules IPE", value: (x) => x.r[5] },
    ],
    row: (x) => `<tr><td><strong>${esc(x.r[0])}</strong></td><td>${esc(x.r[1])}</td><td>${esc(x.r[2])}</td><td>${badge(x.r[3], assignmentTones[x.g.status])}</td><td>${esc(x.r[4])}</td><td class="loc">${esc(x.r[5])}</td></tr>`,
  });
  const options = [["missing", "Sans chargé"], ["partial", "Partielles"], ["exempt", "À confirmer"], ["assigned", "Affectées"], ["", "Toutes"]];
  $("view").innerHTML = panel(`Affectations SharePoint · ${fmt(dt.rows.length)} affaires / phases`,
    `<div class="controlRow">${segment("assignmentFilter", options, assignmentFilter, { label: "Statut IPE", counts: (k) => all.filter((g) => !k || g.status === k).length })}</div>${dt.html}`, {});
  currentExport = () => downloadMatrix(m.headers, dt.rows.map((x) => x.r), "Affectation_SharePoint.csv");
}
