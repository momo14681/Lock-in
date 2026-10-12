// =============================================================================
// Pilotage par tranche : indicateurs de la feuille « Pilotage » de la DEM, tranche
// par tranche (CS2M et CS4A par défaut), côte à côte. Mêmes règles de calcul que le
// reste du tableau de bord (TOT non annulées, filtre chargé du profil coordo).
// =============================================================================

const PILOT_TAB = "pilotage";
const PILOT_DEFAULT = ["CS2M", "CS4A"];
const PILOT_KEY = "dem-essais-pilotage-tranches";
const PILOT_ORDER = ["CS1M", "CS1A", "CS2M", "CS2A", "CS3M", "CS3A", "CS4M", "CS4A", "CS0M", "CS8M", "CS9M"];
const PILOT_MAX_WEEKS = 20; // au-delà, avancement par mois de J0
const PILOT_DOCS = [["totPrete", "EAM · TOT prête"], ["bpa", "BPA"], ["ger", "GER / 1N"], ["bpd", "BPD"]];

let pilotSheets = null; // tranches choisies (mémorisées sur ce PC)

function trancheLabel(s) {
  return `${s.slice(0, 3)} ${s.endsWith("A") ? "TEA" : "TEM"}`.replace(/^CS([089]) TEM$/, "CS$1");
}

function pilotAvailable() {
  const live = new Set(data.tasks.filter((t) => !t.cancelled).map((t) => t.sheet));
  return [...PILOT_ORDER, ...TECHNICAL_SHEETS.filter((s) => !PILOT_ORDER.includes(s))].filter((s) => live.has(s));
}

function pilotSelection() {
  const available = pilotAvailable();
  if (!pilotSheets) {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(PILOT_KEY) || "null"); } catch (e) { /* choix non mémorisé */ }
    pilotSheets = Array.isArray(saved) && saved.length ? saved : PILOT_DEFAULT;
  }
  const chosen = available.filter((s) => pilotSheets.includes(s));
  return chosen.length ? chosen : available.slice(0, 2);
}

function togglePilotSheet(sheet) {
  const current = pilotSelection();
  const next = current.includes(sheet) ? current.filter((s) => s !== sheet) : [...current, sheet];
  if (!next.length) return;
  pilotSheets = pilotAvailable().filter((s) => next.includes(s));
  try { localStorage.setItem(PILOT_KEY, JSON.stringify(pilotSheets)); } catch (e) { /* choix non mémorisé */ }
  render();
}

// TOT d'une tranche : le choix de tranches de la vue remplace le filtre « feuilles ».
function pilotTasks(sheet) {
  const owner = mode === "coordo" ? $("owner").value : "";
  return data.tasks.filter((t) => !t.cancelled && t.sheet === sheet && (!owner || t.responsable === owner));
}

// Chaîne documentaire, comme la feuille Pilotage : en attente de validation (P),
// à reprendre (R), produits et signés. Pour EAM, « signé » = TOT prête datée.
function docChain(ts) {
  const n = ts.length;
  return PILOT_DOCS.map(([key, label]) => {
    const P = documentRows(ts, "P", key).length, R = documentRows(ts, "R", key).length;
    let done, prod;
    if (key === "totPrete") {
      done = ts.filter((t) => classifyMilestone(t.cells?.totPrete?.v ?? t.totPrete) === "done").length;
      prod = ts.filter((t) => t.totReady).length;
    } else {
      ({ done, produced: prod } = milestoneStats(ts, key + "State"));
    }
    return { key, label, n, done, prod, P, R };
  });
}

function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const y = d.getUTCFullYear();
  return { year: y, week: Math.ceil(((d - Date.UTC(y, 0, 1)) / DAY_MS + 1) / 7) };
}

function mondayOf(date) {
  return addDays(startOfDay(date), -((date.getDay() + 6) % 7));
}

// Avancement par semaine de J0 (arrêt de tranche), ou par mois si la tranche
// s'étale sur plus de PILOT_MAX_WEEKS semaines. Même format que buildTimeline.
function pilotTimeline(ts, today) {
  const period = j0Period();
  const dated = ts.filter((t) => t.j0 && (!period.years.length || period.years.includes(t.j0.getFullYear())));
  if (!dated.length) return buildTimeline(ts, period, today);
  const first = mondayOf(new Date(Math.min(...dated.map((t) => t.j0)))), last = mondayOf(new Date(Math.max(...dated.map((t) => t.j0))));
  const weeks = Math.round((last - first) / (7 * DAY_MS)) + 1;
  if (weeks > PILOT_MAX_WEEKS) return buildTimeline(ts, period, today);
  const empty = () => Object.fromEntries(TEAM_ORDER.map((s) => [s, 0]));
  const thisWeek = mondayOf(today).getTime();
  const buckets = [];
  for (let i = 0; i < weeks; i++) {
    const start = addDays(first, 7 * i), { week } = isoWeek(start);
    buckets.push({ key: String(mondayOf(start).getTime()), label: `S${week}`, long: `semaine ${week} (du ${formatShortDate(start)} au ${formatShortDate(addDays(start, 6))})`, counts: empty(), total: 0, current: mondayOf(start).getTime() === thisWeek });
  }
  const before = { key: "before", label: "Avant", long: `J0 avant le ${formatDate(first)}`, counts: empty(), total: 0, extra: true };
  const after = { key: "after", label: "Après", long: `J0 après le ${formatDate(addDays(last, 6))}`, counts: empty(), total: 0, extra: true };
  const none = { key: "none", label: "Sans J0", long: "J0 absent ou invalide", counts: empty(), total: 0, extra: true };
  const index = new Map(buckets.map((b) => [b.key, b]));
  for (const t of ts) {
    const bucket = !t.j0 ? none : t.j0 < first ? before : t.j0 >= addDays(last, 7) ? after : index.get(String(mondayOf(t.j0).getTime()));
    const s = teamState(t);
    if (!bucket || !(s in bucket.counts)) continue;
    bucket.counts[s]++;
    bucket.total++;
  }
  return {
    weekly: true,
    title: `S${isoWeek(first).week} à S${isoWeek(last).week}`,
    columns: [...(before.total ? [before] : []), ...buckets, ...(after.total ? [after] : []), ...(none.total ? [none] : [])],
  };
}

function pilotModel(sheet) {
  const ts = pilotTasks(sheet), n = ts.length, today = data.today;
  const j0s = ts.map((t) => t.j0).filter(Boolean).sort((a, b) => a - b);
  const pool = new Set(ts);
  const sheetIssues = (data.audit || []).filter((i) => pool.has(i.t) && !ignoredIssues.has(issueId(i)));
  const owners = [...new Set(ts.map((t) => t.responsable))].map((name) => {
    const mine = ts.filter((t) => t.responsable === name);
    return { name, ts: mine, n: mine.length, realized: mine.filter(isRealized).length, overdue: mine.filter((t) => t.overdue).length };
  }).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, "fr"));
  return {
    sheet, ts, n, label: trancheLabel(sheet), code: sheetProjectCodes().get(sheet) || "",
    ree: dossierCount(ts), j0Min: j0s[0] || null, j0Max: j0s[j0s.length - 1] || null,
    prepared: ts.filter((t) => t.prepComplete).length,
    realized: ts.filter(isRealized).length,
    overdue: ts.filter((t) => t.overdue).length,
    dueSoon: ts.filter((t) => t.dueSoon).length,
    bpdPending: ts.filter((t) => isRealized(t) && t.bpdState !== "done").length,
    unassigned: ts.filter((t) => t.responsable === UNASSIGNED).length,
    issues: sheetIssues.length,
    chain: docChain(ts),
    timeline: pilotTimeline(ts, today),
    owners,
  };
}

// --- Blocs d'affichage -------------------------------------------------------------

function pilotTag(m) {
  return `<span class="pilotTag phase-${dossierPhase({ sheet: m.sheet })}">${esc(m.label)}</span>`;
}

function pilotHead(m, cols) {
  const span = m.j0Min ? (m.j0Min.getTime() === m.j0Max.getTime() ? `J0 le ${formatDate(m.j0Min)}` : `J0 du ${formatDate(m.j0Min)} au ${formatDate(m.j0Max)}`) : "J0 absents";
  const go = (spec) => `in:${m.sheet}:${spec}`;
  const kpis = [
    kpi({ label: "Préparation terminée", value: pct(m.prepared, m.n), sub: `${fmt(m.prepared)} / ${fmt(m.n)} TOT`, bar: { ratio: ratio(m.prepared, m.n), color: STATE_COLORS[STATE.ready] }, go: go("tasks:prepared") }),
    kpi({ label: "Essais réalisés", value: pct(m.realized, m.n), sub: `${fmt(m.realized)} / ${fmt(m.n)} TOT`, bar: { ratio: ratio(m.realized, m.n), color: STATE_COLORS[STATE.realized] }, go: go("tasks:realized") }),
    kpi({ label: "BPD signés", value: pct(m.chain[3].done, m.n), sub: `${fmt(m.chain[3].done)} / ${fmt(m.n)} TOT`, bar: { ratio: ratio(m.chain[3].done, m.n), color: DOC_COLORS.signed } }),
    kpi({ label: "Lignes DEM incomplètes", value: fmt(m.overdue), sub: m.overdue ? "échéance J0 − 30 dépassée" : "aucune", tone: m.overdue ? "warn" : "good", go: m.overdue ? go("tasks:overdue") : "" }),
  ].join("");
  return `<section class="panel pilotHeadPanel">
    <div class="panelHead"><div><h2 class="pilotTitle">${pilotTag(m)}</h2>
      <p class="panelSub">${esc([m.sheet, m.code].filter(Boolean).join(" · "))} · ${fmt(m.ree)} REE · ${fmt(m.n)} TOT · ${esc(span)}</p></div></div>
    <div class="kpis ${cols > 1 ? "kpis-2" : "kpis-4"} pilotKpis">${kpis}</div></section>`;
}

function pilotChain(m) {
  const rows = m.chain.map((c) => {
    const waiting = Math.max(0, c.prod - c.done), none = Math.max(0, c.n - c.prod);
    const count = (v, code, tone) => v ? `<button type="button" class="pilotCount tone-${tone}" data-go="in:${m.sheet}:docs:${code}|${c.key}" title="Voir les ${fmt(v)} ${names[c.key]} « ${code} »">${fmt(v)}</button>` : '<span class="muted">—</span>';
    return `<tr><th scope="row">${esc(c.label)}</th>
      <td class="barCell"><span class="docBar" data-tip="${esc(c.label)} · ${fmt(c.n)} TOT\n${fmt(c.done)} ${c.key === "totPrete" ? "prêtes (datées)" : "signés"} · ${fmt(waiting)} ${c.key === "totPrete" ? "en attente de validation" : "à signer"} · ${fmt(none)} non produits" tabindex="0">
        <span style="flex:${c.done} 1 0;background:${DOC_COLORS.signed}"></span><span style="flex:${waiting} 1 0;background:${DOC_COLORS.waiting}"></span><span style="flex:${none} 1 0;background:${DOC_COLORS.none}"></span></span></td>
      <td class="num">${count(c.P, "P", "info")}</td><td class="num">${count(c.R, "R", "warn")}</td>
      <td class="num pctCell tone-${pctTone(c.prod, c.n)}">${pct(c.prod, c.n)}</td><td class="num pctCell tone-${pctTone(c.done, c.n)}">${pct(c.done, c.n)}</td></tr>`;
  }).join("");
  return panel("Documents", `<div class="tableWrap free"><table class="pilotChain">
      <thead><tr><th>Étape</th><th>Avancement</th><th class="num" title="Documents en attente de validation par les coordos">À valider (P)</th><th class="num" title="Documents à reprendre par le chargé d’essais">À reprendre (R)</th><th class="num">% produits</th><th class="num">% signés</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    ${legend([["signés (EAM : TOT prête datée)", DOC_COLORS.signed], ["produits, à signer", DOC_COLORS.waiting], ["non produits", DOC_COLORS.none]])}`,
  { cls: "pilotPanel", actions: pilotTag(m) });
}

function pilotChart(m) {
  const tl = m.timeline;
  const title = tl.weekly ? `Avancement par semaine de J0 · ${tl.title}` : `Avancement par mois de J0 · ${tl.title}`;
  return panel(esc(title), legend(TEAM_ORDER.map((s) => [s, TEAM_COLORS[s]])) + timelineSvg(tl), { cls: "pilotPanel", actions: pilotTag(m) });
}

function pilotTodo(m) {
  const go = (spec) => `in:${m.sheet}:${spec}`;
  const items = [
    { n: m.overdue, tone: "warn", title: "lignes DEM incomplètes (échéance dépassée)", go: go("tasks:overdue") },
    { n: m.dueSoon, tone: "warn", title: "préparations à boucler sous 30 jours", go: go("tasks:dueSoon") },
    { n: m.bpdPending, tone: "info", title: "essais réalisés, BPD pas encore signé", go: go("tasks:bpdPending") },
    { n: m.chain.reduce((s, c) => s + c.P, 0), tone: "info", title: "documents à valider (P)", go: go("docs:P") },
    { n: m.chain.reduce((s, c) => s + c.R, 0), tone: "warn", title: "documents à reprendre (R)", go: go("docs:R") },
    { n: m.unassigned, tone: "warn", title: "TOT sans chargé d’essais", go: go("tasks:unassigned") },
    { n: m.issues, tone: "neutral", title: "corrections à faire dans la DEM", go: go("tab:issues") },
  ].filter((i) => i.n);
  const body = items.length
    ? `<ul class="todo">${items.map((i) => `<li><button type="button" data-go="${esc(i.go)}" class="todoItem tone-${i.tone}"><span class="todoCount">${fmt(i.n)}</span><span class="todoText">${esc(i.title)}</span><span class="todoGo" aria-hidden="true">›</span></button></li>`).join("")}</ul>`
    : emptyState("Rien à traiter", "Toutes les TOT de cette tranche sont à jour.");
  return panel("À traiter", body, { cls: "pilotPanel todoPanel", actions: pilotTag(m) });
}

function pilotOwners(m) {
  const rows = m.owners.map((o) => `<tr>
    <td><button type="button" class="linkbutton" data-go="${esc(`in:${m.sheet}:owner-tasks:${o.name}`)}">${esc(o.name)}</button></td>
    <td class="num">${fmt(o.n)}</td>
    <td><div class="progressCell">${stateBar(o.ts)}<span>${fmt(o.realized)}/${fmt(o.n)}</span></div></td>
    <td class="num">${o.overdue ? badge(fmt(o.overdue), "warn") : '<span class="muted">—</span>'}</td></tr>`);
  return panel("Par chargé d’essais", table(["Chargé", { label: "TOT", cls: "num" }, "Réalisées", { label: "DEM incomplète", cls: "num" }], rows, { cls: "compact pilotOwners", free: true })
    + legend(STATE_ORDER.map((s) => [s, STATE_COLORS[s]])),
    { cls: "pilotPanel", actions: pilotTag(m) });
}

function viewPilotage() {
  const chosen = pilotSelection(), available = pilotAvailable();
  const models = chosen.map(pilotModel), cols = models.length;
  const chips = available.map((s) => {
    const on = chosen.includes(s), n = pilotTasks(s).length;
    return `<button type="button" class="ecuChip${on ? " on" : ""}" data-pilot-sheet="${esc(s)}" aria-pressed="${on}" title="${on ? "Retirer" : "Ajouter"} ${esc(s)}"><span class="ecuName">${esc(trancheLabel(s))}</span><span class="ecuCount">${fmt(n)}</span></button>`;
  }).join("");
  const row = (fn) => `<div class="pilotRow" style="--pilot-cols:${cols}">${models.map((m) => `<div class="pilotCell">${fn(m, cols)}</div>`).join("")}</div>`;
  const owner = mode === "coordo" ? $("owner").value : "";
  $("view").innerHTML = `<div class="viewHead"><div><h2 class="viewTitle">Pilotage par tranche</h2>
      <p class="muted">Indicateurs de la feuille Pilotage, tranche par tranche · ${esc(owner || "Tous les CE")} · ${esc(periodLabel())}</p></div></div>
    <div class="ecuChips pilotChips" role="group" aria-label="Tranches affichées">${chips}</div>
    ${row(pilotHead)}${row(pilotChain)}${row(pilotChart)}${row(pilotTodo)}${row(pilotOwners)}`;
  currentExport = () => {
    const head = ["Tranche", "Feuille", "Code projet", "REE", "TOT", "J0 début", "J0 fin", "Prépa terminée", "% prépa", "Réalisés", "% réalisés", "Lignes DEM incomplètes", "À boucler < 30 j", "Réalisés sans BPD signé", "Sans chargé", "Corrections DEM",
      ...PILOT_DOCS.flatMap(([, l]) => [`${l} à valider (P)`, `${l} à reprendre (R)`, `${l} % produits`, `${l} % signés`])];
    const rows = models.map((m) => [m.label, m.sheet, m.code, m.ree, m.n, formatDate(m.j0Min), formatDate(m.j0Max), m.prepared, pct(m.prepared, m.n), m.realized, pct(m.realized, m.n), m.overdue, m.dueSoon, m.bpdPending, m.unassigned, m.issues,
      ...m.chain.flatMap((c) => [c.P, c.R, pct(c.prod, c.n), pct(c.done, c.n)])]);
    downloadMatrix(head, rows, `Pilotage_${chosen.join("_")}.csv`);
  };
}

// Sections du PDF : un tableau d'indicateurs (une colonne par tranche), puis le détail.
function pilotReportSections() {
  const models = pilotSelection().map(pilotModel);
  const line = (label, f) => [label, ...models.map(f)];
  const sections = [{
    title: "Indicateurs par tranche", headers: ["Indicateur", ...models.map((m) => `${m.label} (${m.sheet})`)],
    rows: [
      line("Code projet", (m) => m.code || "—"), line("REE", (m) => m.ree), line("TOT", (m) => m.n),
      line("J0", (m) => (m.j0Min ? `${formatDate(m.j0Min)} → ${formatDate(m.j0Max)}` : "—")),
      line("Préparation terminée", (m) => `${pct(m.prepared, m.n)} (${m.prepared})`), line("Essais réalisés", (m) => `${pct(m.realized, m.n)} (${m.realized})`),
      line("Lignes DEM incomplètes", (m) => m.overdue), line("À boucler sous 30 jours", (m) => m.dueSoon), line("Réalisés sans BPD signé", (m) => m.bpdPending),
      line("TOT sans chargé", (m) => m.unassigned), line("Corrections DEM", (m) => m.issues),
      ...PILOT_DOCS.map(([, l], k) => line(`${l} : P / R · % produits / % signés`, (m) => { const c = m.chain[k]; return `${c.P} / ${c.R} · ${pct(c.prod, c.n)} / ${pct(c.done, c.n)}`; })),
    ],
  }];
  for (const m of models) {
    sections.push({ title: `${m.label} — avancement ${m.timeline.weekly ? "par semaine" : "par mois"} de J0`, headers: ["Période", "TOT", ...TEAM_ORDER, "% réalisés"],
      rows: m.timeline.columns.filter((c) => c.total).map((c) => [c.long, c.total, ...TEAM_ORDER.map((s) => c.counts[s]), pct(c.counts[STATE.realized], c.total)]) });
    sections.push({ title: `${m.label} — par chargé d’essais`, headers: ["Chargé", "TOT", "Réalisées", "DEM incomplète"], rows: m.owners.map((o) => [o.name, o.n, `${o.realized} (${pct(o.realized, o.n)})`, o.overdue]) });
  }
  return sections;
}
