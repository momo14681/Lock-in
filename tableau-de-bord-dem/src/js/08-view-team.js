// =============================================================================
// Avancement de l'équipe : vue partagée par les deux profils, et image 16:9
// pour l'écran de l'équipe (export PNG).
// =============================================================================

const MONTHS = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep", "Oct", "Nov", "Déc"];
const MONTHS_LONG = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

// Sur l'écran d'équipe, « DEM incomplète » et « Infos manquantes » sont regroupées :
// ce sont surtout des lignes Excel à mettre à jour, pas des retards d'essais.
const TEAM_INCOMPLETE = "DEM à compléter";
const TEAM_ORDER = [STATE.realized, STATE.ready, STATE.ongoing, TEAM_INCOMPLETE];
const TEAM_COLORS = { [STATE.realized]: STATE_COLORS[STATE.realized], [STATE.ready]: STATE_COLORS[STATE.ready], [STATE.ongoing]: STATE_COLORS[STATE.ongoing], [TEAM_INCOMPLETE]: STATE_COLORS[STATE.missing] };
function teamState(t) {
  const s = state(t);
  return s === STATE.missing || s === STATE.late ? TEAM_INCOMPLETE : s;
}

// Colonnes du graphique d'avancement : mois (ou années) de J0 de la période,
// plus « Avant », « Après » et « Sans J0 » lorsqu'ils contiennent des TOT.
function buildTimeline(ts, period, today) {
  let years = period.years.slice();
  if (!years.length) years = [...new Set(ts.filter((t) => t.j0).map((t) => t.j0.getFullYear()))].sort((a, b) => a - b);
  if (!years.length) years = [today.getFullYear()];
  const first = years[0], last = years[years.length - 1];
  const monthly = last - first <= 1;
  const buckets = [];
  const empty = () => Object.fromEntries(TEAM_ORDER.map((s) => [s, 0]));
  if (monthly) {
    for (let y = first; y <= last; y++) for (let m = 0; m < 12; m++) {
      buckets.push({ key: `${y}-${m}`, label: MONTHS[m], long: `${MONTHS_LONG[m]} ${y}`, year: y, month: m, counts: empty(), total: 0, current: today.getFullYear() === y && today.getMonth() === m, past: y < today.getFullYear() || (y === today.getFullYear() && m < today.getMonth()) });
    }
  } else {
    for (let y = first; y <= last; y++) buckets.push({ key: `${y}`, label: String(y), long: String(y), year: y, counts: empty(), total: 0, current: today.getFullYear() === y, past: y < today.getFullYear() });
  }
  const before = { key: "before", label: "Avant", long: `J0 avant ${first}`, counts: empty(), total: 0, extra: true };
  const after = { key: "after", label: "Après", long: `J0 après ${last}`, counts: empty(), total: 0, extra: true };
  const none = { key: "none", label: "Sans J0", long: "J0 absent ou invalide", counts: empty(), total: 0, extra: true };
  const index = new Map(buckets.map((b) => [b.key, b]));
  for (const t of ts) {
    let bucket = none;
    if (t.j0) {
      const y = t.j0.getFullYear();
      bucket = y < first ? before : y > last ? after : index.get(monthly ? `${y}-${t.j0.getMonth()}` : `${y}`);
    }
    const s = teamState(t);
    if (!(s in bucket.counts)) continue;
    bucket.counts[s]++;
    bucket.total++;
  }
  return {
    monthly,
    title: monthly ? (first === last ? String(first) : `${first} – ${last}`) : `${first} – ${last}`,
    columns: [...(before.total ? [before] : []), ...buckets, ...(after.total ? [after] : []), ...(none.total ? [none] : [])],
  };
}

// REE dont la préparation est en retard, les échéances les plus récentes d'abord
// (ce sont celles dont le J0 est le plus proche ou à venir).
function lateGroups(ts, today) {
  const groups = new Map();
  for (const t of ts.filter((x) => x.overdue)) {
    const key = dossierKey(t) || JSON.stringify([t.affaire, t.sheet, t.rowNumber]);
    if (!groups.has(key)) groups.set(key, { affaire: t.affaire, ree: t.ree, phase: dossierPhase(t), sheet: t.sheet, owners: new Set(), ts: [], missing: new Set(), prepDue: t.prepDue, j0: t.j0 });
    const g = groups.get(key);
    g.ts.push(t);
    g.owners.add(t.responsable);
    t.missingInfoKeys.forEach((k) => g.missing.add(names[k]));
    if (t.prepDue < g.prepDue) { g.prepDue = t.prepDue; g.j0 = t.j0; }
  }
  return [...groups.values()].map((g) => ({ ...g, owners: [...g.owners], missing: [...g.missing], late: daysBetween(g.prepDue, today) }))
    .sort((a, b) => b.prepDue - a.prepDue || a.affaire.localeCompare(b.affaire, "fr", { numeric: true }));
}

// À venir : REE dont le J0 tombe dans les `days` prochains jours (non réalisés).
function upcomingGroups(ts, today, days = 60) {
  const limit = addDays(today, days), groups = new Map();
  for (const t of ts.filter((x) => x.j0 && x.j0 >= today && x.j0 <= limit && !isRealized(x))) {
    const key = dossierKey(t) || JSON.stringify([t.affaire, t.sheet, t.rowNumber]);
    if (!groups.has(key)) groups.set(key, { affaire: t.affaire, ree: t.ree, phase: dossierPhase(t), owners: new Set(), ts: [], j0: t.j0 });
    const g = groups.get(key);
    g.ts.push(t); g.owners.add(t.responsable);
    if (t.j0 < g.j0) g.j0 = t.j0;
  }
  return [...groups.values()].map((g) => {
    const status = g.ts.some((t) => teamState(t) === TEAM_INCOMPLETE) ? TEAM_INCOMPLETE : g.ts.every((t) => t.prepComplete) ? STATE.ready : STATE.ongoing;
    return { ...g, owners: [...g.owners], inDays: daysBetween(today, g.j0), status };
  }).sort((a, b) => a.j0 - b.j0 || a.affaire.localeCompare(b.affaire, "fr", { numeric: true }));
}

// L'écran d'équipe couvre toujours toute l'équipe ; seul le filtre chargé du
// profil coordo (choix explicite) le restreint.
function teamOwner() {
  return mode === "coordo" ? $("owner").value : "";
}

function teamModel() {
  const ts = filteredBy(teamOwner()), n = ts.length, today = data.today;
  const period = j0Period();
  const late = lateGroups(ts, today);
  const lateByOwner = new Map();
  for (const t of ts.filter((x) => x.overdue)) lateByOwner.set(t.responsable, (lateByOwner.get(t.responsable) || 0) + 1);
  const owners = [...new Set(ts.map((t) => t.responsable))].map((name) => {
    const mine = ts.filter((t) => t.responsable === name);
    return { name, n: mine.length, realized: mine.filter(isRealized).length, prepared: mine.filter((t) => t.prepComplete).length, overdue: mine.filter((t) => t.overdue).length, dueSoon: mine.filter((t) => t.dueSoon).length };
  }).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, "fr"));
  return {
    ts, n, today,
    realized: ts.filter(isRealized).length,
    prepared: ts.filter((t) => t.prepComplete).length,
    overdue: ts.filter((t) => t.overdue).length,
    dueSoon: ts.filter((t) => t.dueSoon).length,
    missing: ts.filter((t) => t.infoMissing).length,
    timeline: buildTimeline(ts, period, today),
    late,
    upcoming: upcomingGroups(ts, today),
    upcomingTot: ts.filter((t) => t.j0 && t.j0 >= today && t.j0 <= addDays(today, 60) && !isRealized(t)).length,
    lateByOwner: [...lateByOwner.entries()].sort((a, b) => b[1] - a[1]),
    owners,
    milestones: [["BPA", "bpaState"], ["GER / 1N", "gerState"], ["BPD", "bpdState"]].map(([label, key]) => ({ label, ...milestoneStats(ts, key) })),
    dem: activeDEM,
    period: periodLabel(),
    scope: [selectedSheets.size ? [...selectedSheets].join(" · ") : "Toutes les feuilles", teamOwner() || "Tous les CE", $("search").value.trim() ? "Recherche : " + $("search").value.trim() : ""].filter(Boolean).join(" · "),
    source: data.fileName,
    importDate: formatFrenchDateTime(data.analyzedAt),
    todayLabel: formatDate(today),
  };
}

// --- Graphique SVG (vue HTML) ----------------------------------------------------------

function timelineSvg(tl) {
  const cols = tl.columns, W = 900, H = 400, top = 34, bottom = 52, left = 4, right = 4;
  const plotH = H - top - bottom, slot = (W - left - right) / cols.length, barW = Math.min(46, slot * 0.66);
  const parts = [];
  cols.forEach((c, i) => {
    const x = left + i * slot + (slot - barW) / 2, cx = x + barW / 2;
    if (c.current) parts.push(`<rect x="${left + i * slot + 2}" y="${top - 30}" width="${slot - 4}" height="${plotH + 30 + 46}" rx="8" class="tlNow"/>`);
    parts.push(`<rect x="${x}" y="${top}" width="${barW}" height="${plotH}" rx="4" class="tlTrack"/>`);
    let y = top + plotH;
    const segs = TEAM_ORDER.filter((s) => c.counts[s] > 0);
    segs.forEach((s, k) => {
      const h = c.counts[s] / c.total * plotH;
      const gap = k < segs.length - 1 ? 2 : 0;
      const isTop = k === segs.length - 1;
      const hh = Math.max(0.5, h - gap);
      y -= h;
      const shape = isTop
        ? `<path d="M${x},${y + hh} V${y + Math.min(4, hh)} Q${x},${y} ${x + Math.min(4, hh)},${y} H${x + barW - Math.min(4, hh)} Q${x + barW},${y} ${x + barW},${y + Math.min(4, hh)} V${y + hh} Z"`
        : `<rect x="${x}" y="${y + gap}" width="${barW}" height="${hh}"`;
      parts.push(`${shape} fill="${TEAM_COLORS[s]}" data-tip="${fmt(c.counts[s])} TOT · ${pct(c.counts[s], c.total)}\n${esc(s)} · ${esc(c.long)}" tabindex="0"/>`);
    });
    const done = c.counts[STATE.realized], doneH = c.total ? done / c.total * plotH : 0;
    if (doneH >= 22 && c.total) parts.push(`<text x="${cx}" y="${top + plotH - doneH / 2 + 5}" class="tlIn">${Math.round(done / c.total * 100)}%</text>`);
    parts.push(`<text x="${cx}" y="${top - 10}" class="tlN">${c.total ? fmt(c.total) : "–"}</text>`);
    parts.push(`<text x="${cx}" y="${top + plotH + 22}" class="tlLabel${c.current ? " now" : ""}">${esc(c.label)}</text>`);
    if (c.current) parts.push(`<text x="${cx}" y="${top + plotH + 42}" class="tlToday">aujourd’hui</text>`);
    else if (tl.monthly && c.month === 0 && tl.columns.filter((x) => x.month === 0).length > 1) parts.push(`<text x="${cx}" y="${top + plotH + 42}" class="tlYear">${c.year}</text>`);
  });
  return `<svg class="timeline" viewBox="0 0 ${W} ${H}" role="img" aria-label="Avancement des TOT par mois de J0">${parts.join("")}</svg>`;
}

const TEAM_TONE = { [TEAM_INCOMPLETE]: "warn", [STATE.ready]: "info", [STATE.ongoing]: "neutral" };

function upcomingTable(list, limit) {
  return dataTable({
    key: "upcoming", items: list, paged: false, free: true, empty: "Aucun J0 dans les 60 prochains jours.", limit,
    columns: [
      { label: "Affaire", value: (g) => `${g.affaire} ${g.ree}` },
      { label: "Chargé", value: (g) => g.owners.join(", "), filter: true },
      { label: "J0", value: (g) => `${MONTHS_LONG[g.j0.getMonth()]} ${g.j0.getFullYear()}`, filter: true },
      { label: "Préparation", value: (g) => g.status, filter: true },
    ],
    row: (g) => `<tr>
      <td><strong>${esc(g.affaire || "Affaire manquante")}</strong><small>REE ${esc(g.ree || "absent")} · ${esc(g.phase)}</small></td>
      <td>${esc(g.owners.join(", "))}</td>
      <td>${formatDate(g.j0)}<small>dans ${plural(g.inDays, "jour")}</small></td>
      <td>${badge(g.status, TEAM_TONE[g.status] || "neutral")}</td></tr>`,
  });
}

let showAllLate = false;

function viewTeam() {
  const m = teamModel();
  const st = tableStateFor("upcoming");
  const filtering = st.search || Object.values(st.filters).some((v) => v?.length);
  const up = upcomingTable(m.upcoming, showAllLate || filtering ? Infinity : 10);
  const kpis = [
    kpi({ label: "Essais réalisés", value: pct(m.realized, m.n), sub: `${fmt(m.realized)} / ${fmt(m.n)} TOT`, bar: { ratio: ratio(m.realized, m.n), color: STATE_COLORS[STATE.realized] } }),
    kpi({ label: "Préparation terminée", value: pct(m.prepared, m.n), sub: `${fmt(m.prepared)} / ${fmt(m.n)} TOT`, bar: { ratio: ratio(m.prepared, m.n), color: STATE_COLORS[STATE.ready] } }),
    kpi({ label: "J0 dans les 60 jours", value: fmt(m.upcomingTot), sub: `TOT · ${plural(m.upcoming.length, "REE", "REE")} à venir` }),
    kpi({ label: "À préparer sous 30 jours", value: fmt(m.dueSoon), sub: "échéance J0 − 30 proche", tone: m.dueSoon ? "warn" : "" }),
  ].join("");
  const more = !filtering && up.rows.length > 10
    ? `<button type="button" class="ghost" data-toggle-late>${showAllLate ? "Afficher les 10 prochains" : `Afficher les ${fmt(up.rows.length)} REE à venir`}</button>` : "";
  $("view").innerHTML = `<div class="viewHead"><div><h2 class="viewTitle">Avancement de l’équipe</h2><p class="muted">${esc(m.period)} · ${esc(m.scope)}</p></div>
      <div class="panelActions"><button type="button" data-png-preview="rythme">Voir le rythme de signature</button><button type="button" data-png-preview>Voir l’écran d’équipe</button><button type="button" class="accent" data-png>Télécharger l’image (PNG)</button></div></div>
    <div class="kpis kpis-4 hero">${kpis}</div>
    <div class="split even">
      ${panel("Avancement par mois de J0", `${legend(TEAM_ORDER.map((s) => [s, TEAM_COLORS[s]]))}${timelineSvg(m.timeline)}`, { cls: "timelinePanel" })}
      ${panel(`À venir · J0 dans les 60 jours`, `${up.html}${more}`, { cls: "latePanel" })}
    </div>
    ${panel("Documents des REE", milestoneCards(m.ts))}`;
  currentExport = () => downloadMatrix(["Affaire", "REE", "Phase", "Chargés", "J0", "Dans (jours)", "TOT", "Préparation"],
    up.rows.map((g) => [g.affaire, g.ree, g.phase, g.owners.join(", "), formatDate(g.j0), g.inDays, g.ts.length, g.status]),
    "J0_a_venir.csv");
}

// --- Image 16:9 pour l'écran de l'équipe ---------------------------------------------

const PNG = {
  bg: "#eef2f6", navy: "#001A70", card: "#ffffff", ink: "#001A70", ink2: "#3A4A6B", muted: "#5E6B85", track: "#e3eaf1",
  // EDF 2020 n'a que 300 / 400 / 700 : on reste en léger ou normal.
  font: (weight, size) => `${weight >= 600 ? 400 : weight === 500 ? 400 : weight} ${size}px "EDF 2020", "Work Sans", Arial, sans-serif`,
};

// Outils de dessin partagés par les images 16:9 (écran d'équipe, pilotage par tranche).
function pngKit(c) {
  function roundRect(x, y, w, h, r, color) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    c.fillStyle = color;
    c.beginPath();
    c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y);
    c.closePath(); c.fill();
  }
  // Texte ajusté : réduit la taille jusqu'à `min`, puis tronque avec « … ».
  function text(value, x, y, { size = 26, weight = 500, color = PNG.ink, width = Infinity, align = "left", min = 16 } = {}) {
    let v = String(value ?? "");
    c.textAlign = align; c.textBaseline = "top"; c.fillStyle = color;
    c.font = PNG.font(weight, size);
    while (size > min && c.measureText(v).width > width) { size--; c.font = PNG.font(weight, size); }
    if (c.measureText(v).width > width) {
      while (v.length > 1 && c.measureText(v + "…").width > width) v = v.slice(0, -1);
      v += "…";
    }
    c.fillText(v, x, y);
    return c.measureText(v).width;
  }
  function bar(x, y, w, h, parts) {
    roundRect(x, y, w, h, h / 2, PNG.track);
    let cx = x;
    for (const [value, color] of parts) {
      const pw = w * Math.max(0, Math.min(1, value));
      if (pw > 0.5) { roundRect(cx, y, pw, h, Math.min(h / 2, pw / 2), color); cx += pw; }
    }
  }
  return { c, roundRect, text, bar };
}

// Bandeau commun des images : titre, périmètre, date des données.
function drawPNGHeader(k, title, sub, importDate) {
  const { c, text } = k;
  c.fillStyle = PNG.bg; c.fillRect(0, 0, 1920, 1080);
  const grad = c.createLinearGradient(0, 0, 1920, 0);
  grad.addColorStop(0, "#001A70"); grad.addColorStop(1, "#0B2A8C");
  c.fillStyle = grad; c.fillRect(0, 0, 1920, 132);
  c.fillStyle = "#FE5815"; c.fillRect(0, 0, 12, 132);
  text(title, 56, 24, { size: 50, weight: 700, color: "#ffffff", width: 1180 });
  text(sub, 58, 88, { size: 24, color: "#C7D2EE", width: 1180 });
  text(`Import du ${importDate}`, 1864, 52, { size: 22, color: "#A9B6DA", width: 600, align: "right" });
}

// Barres empilées d'avancement par période de J0 (mois ou semaines).
function drawPNGTimeline(k, tl, left, width, plotTop, plotH) {
  const { c, roundRect, text } = k;
  const cols = tl.columns, slot = width / cols.length, barW = Math.min(52, slot * 0.68);
  cols.forEach((col, i) => {
    const x = left + i * slot + (slot - barW) / 2, cx = x + barW / 2;
    if (col.current) roundRect(left + i * slot + 2, plotTop - 40, slot - 4, plotH + 104, 10, "#e8f0f8");
    roundRect(x, plotTop, barW, plotH, 5, "#edf1f5");
    let y = plotTop + plotH;
    const segs = TEAM_ORDER.filter((s) => col.counts[s] > 0);
    segs.forEach((s, k2) => {
      const h = col.counts[s] / col.total * plotH, gap = k2 < segs.length - 1 ? 2 : 0;
      y -= h;
      const isTop = k2 === segs.length - 1;
      c.fillStyle = TEAM_COLORS[s];
      if (isTop) roundRect(x, y, barW, Math.max(1, h - gap), Math.min(5, h / 2), TEAM_COLORS[s]);
      else c.fillRect(x, y + gap, barW, Math.max(0.5, h - gap));
    });
    const done = col.counts[STATE.realized], doneH = col.total ? done / col.total * plotH : 0;
    if (doneH >= 30) text(`${Math.round(done / col.total * 100)}%`, cx, plotTop + plotH - doneH / 2 - 11, { size: 19, weight: 700, color: "#ffffff", align: "center", width: barW + 6, min: 13 });
    text(col.total ? fmt(col.total) : "–", cx, plotTop - 32, { size: 21, weight: 600, color: PNG.ink2, align: "center", width: slot - 4, min: 13 });
    text(col.label, cx, plotTop + plotH + 12, { size: 21, weight: col.current ? 700 : 500, color: col.current ? PNG.ink : PNG.muted, align: "center", width: slot - 2, min: 12 });
    if (col.current) text("aujourd’hui", cx, plotTop + plotH + 40, { size: 16, weight: 600, color: "#1057C8", align: "center", width: slot + 20, min: 11 });
    else if (tl.monthly && col.month === 0 && cols.filter((x2) => x2.month === 0).length > 1) text(String(col.year), cx, plotTop + plotH + 40, { size: 17, color: PNG.muted, align: "center", width: slot });
  });
}

function drawPNG(canvas, m) {
  canvas.width = 1920;
  canvas.height = 1080;
  const c = canvas.getContext("2d");
  if (!c) throw Error("Votre navigateur ne permet pas de créer cette image.");

  const { roundRect, text, bar } = pngKit(c);

  drawPNGHeader({ c, text }, "Avancement des essais", `DEM ${m.dem}  ·  ${m.scope}`, m.importDate);

  // Rangée 1 : indicateurs
  const y1 = 156, h1 = 196;
  function card(x, w, label, value, sub, { accent, valueColor = PNG.ink, ratioValue = null, icon = "" }) {
    roundRect(x, y1, w, h1, 18, PNG.card);
    roundRect(x, y1, 8, h1, 4, accent);
    text(label, x + 32, y1 + 22, { size: 27, weight: 600, color: PNG.ink2, width: w - 56 });
    const vw = text(value, x + 32, y1 + 58, { size: 80, weight: 300, color: valueColor, width: w - 56, min: 40 });
    if (icon) text(icon, x + 32 + vw + 14, y1 + 76, { size: 34, color: accent });
    text(sub, x + 32, y1 + 146, { size: 22, color: PNG.muted, width: w - 56 });
    if (ratioValue !== null) bar(x + 32, y1 + 178, w - 64, 8, [[ratioValue, accent]]);
  }
  card(56, 640, "Essais réalisés", pct(m.realized, m.n), `${fmt(m.realized)} / ${fmt(m.n)} TOT · GER/1N signé`, { accent: STATE_COLORS[STATE.realized], ratioValue: ratio(m.realized, m.n) });
  card(720, 560, "Préparation documentaire terminée", pct(m.prepared, m.n), `${fmt(m.prepared)} / ${fmt(m.n)} TOT prêtes`, { accent: STATE_COLORS[STATE.ready], ratioValue: ratio(m.prepared, m.n) });
  card(1304, 268, "J0 sous 60 jours", fmt(m.upcomingTot), `TOT · ${plural(m.upcoming.length, "REE", "REE")}`, { accent: STATE_COLORS[STATE.ready] });
  card(1596, 268, "À préparer < 30 j", fmt(m.dueSoon), "TOT", { accent: m.dueSoon ? STATE_COLORS[STATE.missing] : "#b9c6d4" });

  // Rangée 2 gauche : avancement par mois de J0
  const y2 = 376, h2 = 456, tx = 56, tw = 1120;
  roundRect(tx, y2, tw, h2, 18, PNG.card);
  text(`Avancement par mois de J0 · ${m.timeline.title}`, tx + 32, y2 + 24, { size: 30, weight: 700, width: tw - 64 });
  let lx = tx + 32;
  for (const s of TEAM_ORDER) {
    roundRect(lx, y2 + 76, 18, 18, 4, TEAM_COLORS[s]);
    lx += 26 + text(s, lx + 26, y2 + 73, { size: 21, color: PNG.ink2 }) + 30;
  }
  drawPNGTimeline({ c, roundRect, text }, m.timeline, tx + 32, tw - 64, y2 + 152, 218);

  // Rangée 2 droite : à venir (J0 des 60 prochains jours)
  const rx = 1200, rw = 664;
  roundRect(rx, y2, rw, h2, 18, PNG.card);
  roundRect(rx, y2, rw, 8, 4, STATE_COLORS[STATE.ready]);
  text("À venir : J0 des 60 prochains jours", rx + 32, y2 + 26, { size: 29, width: rw - 64 });
  text(m.upcoming.length ? `${plural(m.upcoming.length, "REE", "REE")} · ${plural(m.upcomingTot, "TOT", "TOT")} · du plus proche au plus lointain` : "Aucun J0 dans les 60 prochains jours", rx + 32, y2 + 66, { size: 20, color: PNG.muted, width: rw - 64 });
  const shown = m.upcoming.slice(0, 6), rowH = 54;
  shown.forEach((g, i) => {
    const y = y2 + 104 + i * rowH;
    if (i) { c.fillStyle = "#e6ecf2"; c.fillRect(rx + 32, y - 6, rw - 64, 1); }
    text(`${g.affaire || "Affaire manquante"}  ·  ${g.ree || "REE absent"}`, rx + 32, y, { size: 22, width: 420, min: 15 });
    roundRect(rx + 32, y + 30, 12, 12, 3, TEAM_COLORS[g.status]);
    text(`${g.status} · ${g.phase} · ${g.owners.join(", ")}`, rx + 52, y + 27, { size: 17, color: PNG.muted, width: 410, min: 13 });
    text(`J0 ${formatShortDate(g.j0)}`, rx + rw - 32, y + 2, { size: 23, align: "right", width: 170 });
    text(`dans ${plural(g.inDays, "jour")}`, rx + rw - 32, y + 30, { size: 16, color: PNG.muted, align: "right", width: 170 });
  });
  if (m.upcoming.length > shown.length) text(`+ ${plural(m.upcoming.length - shown.length, "autre REE", "autres REE")} à venir`, rx + 32, y2 + 104 + shown.length * rowH, { size: 18, color: PNG.ink2, width: rw - 64 });

  // Rangée 3 : états du REE
  const y3 = 856, h3 = 160, mw = 586;
  m.milestones.forEach((ms, i) => {
    const x = 56 + i * (mw + 25);
    roundRect(x, y3, mw, h3, 18, PNG.card);
    const waiting = Math.max(0, ms.produced - ms.done), none = Math.max(0, m.n - ms.produced);
    text(ms.label, x + 32, y3 + 18, { size: 28, weight: 700, width: 200 });
    text(`${pct(ms.done, m.n)} signés`, x + mw - 32, y3 + 18, { size: 28, weight: 700, color: "#3D7F22", align: "right", width: 320 });
    bar(x + 32, y3 + 66, mw - 64, 22, [[ratio(ms.done, m.n), DOC_COLORS.signed], [ratio(waiting, m.n), DOC_COLORS.waiting]]);
    let lx2 = x + 32;
    for (const [v, color, label] of [[ms.done, DOC_COLORS.signed, "signés"], [waiting, DOC_COLORS.waiting, "à signer"], [none, "#c9d4df", "non produits"]]) {
      roundRect(lx2, y3 + 110, 16, 16, 4, color);
      lx2 += 24 + text(`${pct(v, m.n)} ${label}`, lx2 + 24, y3 + 107, { size: 19, color: PNG.ink2 }) + 20;
    }
  });

  return canvas;
}

// --- Image « rythme de signature » (1920 × 1080) -----------------------------------------
// Cumul, semaine par semaine, des TOT prêtes, BPA et BPD signés d'après leurs dates (fiables,
// contrairement au J0), en % des TOT. Une ligne signée sans date n'est pas comptée.

const RHYTHM_WEEKS = 26;
const RHYTHM_SERIES = [["totPrete", "TOT prêtes", "#1057C8"], ["bpa", "BPA signés", "#FE5815"], ["bpd", "BPD signés", "#4E9A2E"]];

function rhythmSeries(ts, today) {
  const start = mondayOf(addDays(today, -7 * (RHYTHM_WEEKS - 1)));
  return {
    start,
    series: RHYTHM_SERIES.map(([key, label, color]) => {
      const dates = ts.map((t) => parseExcelDate(t.cells?.[key]?.v)).filter((d) => d && d <= today);
      const points = Array.from({ length: RHYTHM_WEEKS }, (_, w) => { const end = addDays(start, 7 * w + 7); return dates.filter((d) => d < end).length; });
      return { key, label, color, points, last: points[RHYTHM_WEEKS - 1], gain: points[RHYTHM_WEEKS - 1] - points[RHYTHM_WEEKS - 5] };
    }),
  };
}

// groups : [{ label, ts, color }], 3 au plus côte à côte.
function drawRhythmPNG(canvas, title, sub, groups) {
  canvas.width = 1920;
  canvas.height = 1080;
  const c = canvas.getContext("2d");
  if (!c) throw Error("Votre navigateur ne permet pas de créer cette image.");
  const k = pngKit(c), { roundRect, text } = k;
  drawPNGHeader(k, title, sub, formatFrenchDateTime(data.analyzedAt));
  const n = groups.length, gap = 28, left = 56, colW = (1920 - 2 * left - (n - 1) * gap) / n, y = 156, h = 1000 - y;
  groups.forEach((g, i) => {
    const x = left + i * (colW + gap), total = g.ts.length, { start, series } = rhythmSeries(g.ts, data.today);
    roundRect(x, y, colW, h, 18, PNG.card);
    const tw = text(g.label, x + 30, y + 24, { size: 44, weight: 400, color: g.color, width: colW - 220, min: 26 });
    text(`${fmt(total)} TOT`, x + 30 + tw + 20, y + 40, { size: 24, color: PNG.muted });
    series.forEach((s, j) => {
      const ly = y + 100 + j * 40;
      roundRect(x + 30, ly + 5, 20, 20, 5, s.color);
      const lw = text(`${s.label}  ${pct(s.last, total)}`, x + 62, ly, { size: 25, color: PNG.ink, width: colW - 260 });
      text(s.gain > 0 ? `+${fmt(s.gain)} en 4 semaines` : "stable sur 4 semaines", x + 62 + lw + 22, ly + 3, { size: 21, color: PNG.muted, width: colW - lw - 110, min: 13 });
    });
    const px = x + 96, pw = colW - 136, py = y + 250, ph = h - 320;
    for (const f of [0, 0.25, 0.5, 0.75, 1]) {
      const gy = py + ph - f * ph;
      c.fillStyle = f ? "#e9eef3" : "#c9d4df"; c.fillRect(px, gy, pw, f ? 1 : 2);
      text(`${Math.round(f * 100)} %`, px - 14, gy - 11, { size: 19, color: PNG.muted, align: "right" });
    }
    for (let w = 0; w < RHYTHM_WEEKS; w += n > 2 ? 5 : 4) text(`S${isoWeek(addDays(start, 7 * w)).week}`, px + w / (RHYTHM_WEEKS - 1) * pw, py + ph + 14, { size: 19, color: PNG.muted, align: "center" });
    for (const s of series) {
      const X = (w) => px + w / (RHYTHM_WEEKS - 1) * pw, Y = (v) => py + ph - (total ? v / total : 0) * ph;
      c.strokeStyle = s.color; c.lineWidth = 4; c.lineJoin = "round"; c.lineCap = "round";
      c.beginPath(); s.points.forEach((v, w) => (w ? c.lineTo(X(w), Y(v)) : c.moveTo(X(w), Y(v)))); c.stroke();
      c.fillStyle = s.color; c.beginPath(); c.arc(X(RHYTHM_WEEKS - 1), Y(s.last), 8, 0, 2 * Math.PI); c.fill();
    }
  });
  text("Cumul des dates TOT prête, BPA et BPD renseignées dans la DEM, en % des TOT.", left, 1030, { size: 21, color: PNG.muted, width: 1808 });
  return canvas;
}

function rhythmTarget() {
  if (tab === PILOT_TAB) {
    const sheets = pilotSelection().slice(0, PILOT_PNG_MAX);
    return { draw: () => drawRhythmPNG(document.createElement("canvas"), `Rythme de signature · ${sheets.map(trancheLabel).join(" · ")}`,
        `DEM ${activeDEM}  ·  ${(mode === "coordo" && $("owner").value) || "Tous les CE"}  ·  ${RHYTHM_WEEKS} dernières semaines`,
        sheets.map((sh) => ({ label: trancheLabel(sh), ts: pilotTasks(sh), color: sh.endsWith("A") ? "#C2410C" : "#0C46A3" }))),
      name: `Rythme_${sheets.join("_")}`, title: "Aperçu du rythme de signature par tranche (1920 × 1080)", note: "Mêmes tranches et même chargé que la vue « Pilotage par tranche »." };
  }
  const m = teamModel();
  return { draw: () => drawRhythmPNG(document.createElement("canvas"), "Rythme de signature", `DEM ${activeDEM}  ·  ${m.scope}  ·  ${RHYTHM_WEEKS} dernières semaines`, [{ label: "Équipe", ts: m.ts, color: "#0C46A3" }]),
    name: "Rythme_equipe", title: "Aperçu du rythme de signature de l’équipe (1920 × 1080)", note: "Même périmètre que la vue « Avancement équipe »." };
}

// L'onglet « Pilotage par tranche » exporte sa propre image ; sinon, l'écran d'équipe.
// kind « rythme » : courbe du rythme de signature, sur le même périmètre.
function pngTarget(kind = "") {
  if (kind === "rythme") return rhythmTarget();
  return tab === PILOT_TAB
    ? { draw: () => drawPilotPNG(document.createElement("canvas")), name: `Pilotage_${pilotSelection().slice(0, PILOT_PNG_MAX).join("_")}`, title: "Aperçu de l’image du pilotage par tranche (1920 × 1080)", note: "Mêmes tranches et même chargé que la vue « Pilotage par tranche »." }
    : { draw: () => drawPNG(document.createElement("canvas"), teamModel()), name: "Ecran_equipe_essais", title: "Aperçu de l’écran d’équipe (1920 × 1080)", note: "Même périmètre que la vue « Avancement équipe »." };
}

function pngMenuLabel() {
  return tab === PILOT_TAB ? "Image du pilotage pour la télé (PNG)" : "Image pour l’écran d’équipe (PNG)";
}

async function renderPNG(kind = "") {
  if (document.fonts) { await Promise.all(['300 50px "EDF 2020"', '400 50px "EDF 2020"', '400 50px "Work Sans"'].map((f) => document.fonts.load(f).catch(() => null))); await document.fonts.ready; }
  return pngTarget(kind).draw();
}

async function exportPNG(kind = "") {
  if (!data) return;
  const button = kind === "rythme" ? $("pngRhythm") : $("pngExport"), label = button.textContent;
  button.disabled = true;
  button.textContent = "Création du PNG…";
  try {
    const canvas = await renderPNG(kind);
    const blob = await new Promise((resolve, reject) => canvas.toBlob((b) => b ? resolve(b) : reject(Error("Image PNG non créée.")), "image/png"));
    downloadBytes(blob, "image/png", `${pngTarget(kind).name}_DEM${activeDEM}_${new Date().toISOString().slice(0, 10)}.png`);
  } catch (e) {
    $("message").innerHTML = `<div class="notice error">Export PNG impossible : ${esc(e.message)}</div>`;
  } finally {
    button.disabled = !data;
    button.textContent = kind === "rythme" ? label : pngMenuLabel();
  }
}

async function previewPNG(kind = "") {
  if (!data) return;
  try {
    const canvas = await renderPNG(kind);
    const target = pngTarget(kind);
    $("detailTitle").textContent = target.title;
    $("detailBody").innerHTML = `<img class="pngPreview" alt="${esc(target.title)}" src="${canvas.toDataURL("image/png")}"><p class="muted">${esc(target.note)} <button type="button" class="accent" data-png="${kind}">Télécharger le PNG</button></p>`;
    $("detail").classList.add("wideDialog");
    if (!$("detail").open) $("detail").showModal();
  } catch (e) {
    $("message").innerHTML = `<div class="notice error">Aperçu impossible : ${esc(e.message)}</div>`;
  }
}
