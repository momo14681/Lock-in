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
      done = ts.filter((t) => totPreteDone(t.cells?.totPrete?.v ?? t.totPrete)).length;
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
  if (weeks > PILOT_MAX_WEEKS) {
    // Par mois : on retire les premiers mois sans J0 (avant le début de la tranche).
    const tl = buildTimeline(ts, period, today), cols = tl.columns.slice();
    while (cols.length > 1 && !cols[0].extra && !cols[0].total && !cols[0].current) cols.shift();
    return { ...tl, columns: cols };
  }
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
  }).sort((a, b) => b.n - a.n || COLLATOR_FR.compare(a.name, b.name));
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
    kpi({ label: "Prépas en retard", value: fmt(m.overdue), sub: m.overdue ? "échéance J0 − 30 dépassée" : "aucune", tone: m.overdue ? "warn" : "good", go: m.overdue ? go("tasks:overdue") : "" }),
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
    { n: m.overdue, tone: "warn", title: "prépas en retard (échéance dépassée)", go: go("tasks:overdue") },
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
  return panel("Par chargé d’essais", table(["Chargé", { label: "TOT", cls: "num" }, "Réalisées", { label: "Prépa en retard", cls: "num" }], rows, { cls: "compact pilotOwners", free: true })
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
      <p class="muted">Indicateurs de la feuille Pilotage, tranche par tranche · ${esc(owner || "Tous les CE")} · ${esc(periodLabel())}</p></div>
      <div class="panelActions"><button type="button" data-png-preview="rythme">Voir le rythme de signature</button><button type="button" data-png-preview>Voir l’image télé</button><button type="button" class="accent" data-png>Télécharger l’image (PNG)</button></div></div>
    <div class="ecuChips pilotChips" role="group" aria-label="Tranches affichées">${chips}</div>
    ${row(pilotHead)}${row(pilotChain)}${row(pilotChart)}${row(pilotTodo)}${row(pilotOwners)}`;
  currentExport = () => {
    const head = ["Tranche", "Feuille", "Code projet", "REE", "TOT", "J0 début", "J0 fin", "Prépa terminée", "% prépa", "Réalisés", "% réalisés", "Prépas en retard", "À boucler < 30 j", "Réalisés sans BPD signé", "Sans chargé", "Corrections DEM",
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
      line("Prépas en retard", (m) => m.overdue), line("À boucler sous 30 jours", (m) => m.dueSoon), line("Réalisés sans BPD signé", (m) => m.bpdPending),
      line("TOT sans chargé", (m) => m.unassigned), line("Corrections DEM", (m) => m.issues),
      ...PILOT_DOCS.map(([, l], k) => line(`${l} : P / R · % produits / % signés`, (m) => { const c = m.chain[k]; return `${c.P} / ${c.R} · ${pct(c.prod, c.n)} / ${pct(c.done, c.n)}`; })),
    ],
  }];
  for (const m of models) {
    sections.push({ title: `${m.label} — avancement ${m.timeline.weekly ? "par semaine" : "par mois"} de J0`, headers: ["Période", "TOT", ...TEAM_ORDER, "% réalisés"],
      rows: m.timeline.columns.filter((c) => c.total).map((c) => [c.long, c.total, ...TEAM_ORDER.map((s) => c.counts[s]), pct(c.counts[STATE.realized] + c.counts[STATE.archived], c.total)]) });
    sections.push({ title: `${m.label} — par chargé d’essais`, headers: ["Chargé", "TOT", "Réalisées", "Prépa en retard"], rows: m.owners.map((o) => [o.name, o.n, `${o.realized} (${pct(o.realized, o.n)})`, o.overdue]) });
  }
  return sections;
}

// --- Image 16:9 pour la télé (1920 × 1080) ----------------------------------------------
// Pour la réunion de cadres, par tranche : prépa terminée, essais réalisés, BPD signés, puis
// % produits et % signés de TOT prête, BPA et BPD, comme l'équipe les présente d'habitude.
// Ni lignes DEM à compléter ni avancement par J0 ; les pourcentages restent calculés sur
// toutes les TOT de la tranche.

const PILOT_PNG_MAX = 3;
const PILOT_PNG_DOCS = [["totPrete", "TOT prête", "signées"], ["bpa", "BPA", "signés"], ["bpd", "BPD", "signés"]];

function drawPilotPNG(canvas) {
  canvas.width = 1920;
  canvas.height = 1080;
  const c = canvas.getContext("2d");
  if (!c) throw Error("Votre navigateur ne permet pas de créer cette image.");
  const k = pngKit(c), { roundRect, text, bar } = k;
  const chosen = pilotSelection(), models = chosen.slice(0, PILOT_PNG_MAX).map(pilotModel);
  const owner = mode === "coordo" ? $("owner").value : "";
  drawPNGHeader(k, `Pilotage des essais · ${models.map((m) => m.label).join(" · ")}`,
    `DEM ${activeDEM}  ·  ${owner || "Tous les CE"}${chosen.length > models.length ? `  ·  ${models.length} premières tranches sur ${chosen.length}` : ""}`,
    formatFrenchDateTime(data.analyzedAt));

  const n = models.length, gap = 28, left = 56, colW = (1920 - 2 * left - (n - 1) * gap) / n, narrow = colW < 800;
  const yTitle = 150, yKpi = 236, kpiH = 168, yCard = yKpi + kpiH + 20, yEnd = 1000, rowTop = yCard + 66, rowH = (yEnd - 16 - rowTop) / PILOT_PNG_DOCS.length;
  const figSize = narrow ? 58 : 84, figW = narrow ? 140 : 214, figGap = narrow ? 40 : 64, labelSize = narrow ? 32 : 42, barH = narrow ? 18 : 24;
  const signedInk = "#3D7F22";

  models.forEach((m, i) => {
    const x = left + i * (colW + gap), at = m.sheet.endsWith("A"), inner = colW - 56;

    // Titre de la tranche
    const titleW = 24 + text(m.label, x + 4, yTitle, { size: 50, weight: 400, color: at ? "#C2410C" : "#0C46A3", width: 420, min: 30 });
    text(`${[m.sheet, m.code].filter(Boolean).join(" · ")}  ·  ${fmt(m.ree)} REE  ·  ${fmt(m.n)} TOT`, x + 4 + titleW, yTitle + 22, { size: 24, color: PNG.muted, width: colW - titleW - 8, min: 14 });
    roundRect(x, yTitle + 64, colW, 5, 2.5, at ? "#FE5815" : "#1057C8");

    // Cartes : prépa terminée, essais réalisés, BPD signés
    const kGap = narrow ? 14 : 20, kW = (colW - 2 * kGap) / 3, bpd = m.chain.find((d) => d.key === "bpd");
    [["Prépa terminée", m.prepared, STATE_COLORS[STATE.ready]], ["Essais réalisés", m.realized, STATE_COLORS[STATE.realized]], ["BPD signés", bpd.done, DOC_COLORS.signed]]
      .forEach(([label, v, accent], j) => {
        const kx = x + j * (kW + kGap), pad = narrow ? 22 : 30;
        roundRect(kx, yKpi, kW, kpiH, 16, PNG.card);
        roundRect(kx, yKpi, 7, kpiH, 3.5, accent);
        text(label, kx + pad, yKpi + 18, { size: narrow ? 21 : 25, color: PNG.ink2, width: kW - pad - 14, min: 14 });
        text(pct(v, m.n), kx + pad, yKpi + 50, { size: narrow ? 54 : 66, weight: 300, width: kW - pad - 14, min: 30 });
        text(`${fmt(v)} / ${fmt(m.n)} TOT`, kx + pad, yKpi + (narrow ? 112 : 120), { size: narrow ? 18 : 21, color: PNG.muted, width: kW - pad - 14, min: 12 });
        bar(kx + pad, yKpi + kpiH - 20, kW - pad - 22, 8, [[ratio(v, m.n), accent]]);
      });

    // % produits et % signés : TOT prête, BPA, BPD
    roundRect(x, yCard, colW, yEnd - yCard, 18, PNG.card);
    const figX2 = x + colW - 28, figX1 = figX2 - figW - figGap;
    text("% produits", figX1, yCard + 22, { size: narrow ? 20 : 23, color: PNG.muted, align: "right", width: figW });
    text("% signés", figX2, yCard + 22, { size: narrow ? 20 : 23, color: signedInk, align: "right", width: figW });
    PILOT_PNG_DOCS.forEach(([key, label, signedWord], j) => {
      const d = m.chain.find((x2) => x2.key === key), y = rowTop + j * rowH, waiting = Math.max(0, d.prod - d.done);
      text(label, x + 28, y + (figSize - labelSize) / 2 + 6, { size: labelSize, weight: 400, width: figX1 - figW - x - 40, min: 22 });
      text(pct(d.prod, d.n), figX1, y, { size: figSize, weight: 300, color: PNG.ink, align: "right", width: figW, min: 40 });
      text(pct(d.done, d.n), figX2, y, { size: figSize, weight: 300, color: signedInk, align: "right", width: figW, min: 40 });
      const yBar = y + figSize + 14;
      bar(x + 28, yBar, inner, barH, [[ratio(d.done, d.n), DOC_COLORS.signed], [ratio(waiting, d.n), DOC_COLORS.waiting]]);
      text(`${fmt(d.done)} ${signedWord}  ·  ${fmt(waiting)} à signer  ·  ${fmt(d.n)} TOT`, x + 28, yBar + barH + 10, { size: narrow ? 19 : 21, color: PNG.muted, width: inner, min: 13 });
    });
  });

  // Légende des barres
  let lx = left;
  const ly = 1032;
  for (const [label, color] of [["signés", DOC_COLORS.signed], ["produits, à signer", DOC_COLORS.waiting], ["non produits", null]]) {
    if (color) roundRect(lx, ly + 4, 18, 18, 5, color);
    else { roundRect(lx, ly + 4, 18, 18, 5, "#c9d4df"); roundRect(lx + 1.5, ly + 5.5, 15, 15, 4, PNG.track); }
    lx += 28 + text(label, lx + 28, ly, { size: 22, color: PNG.ink2 }) + 36;
  }
  return canvas;
}
