// Courbe de charge cumulée, selon la date de début des essais (date début calculée de la CRU
// si renseignée, sinon J0 de la DEM).
// Pointillés = objectif : tous les essais (réalisés ou non) cumulés par date de début, sur toute
// la période ; trait plein = essais réalisés à leur date de fin (CRU), jusqu'à aujourd'hui. Le trait plein doit suivre
// les pointillés : l'écart entre les deux est le retard.
const LOAD_GRAINS = [["month", "Mois"], ["week", "Semaine"]];
let loadGrain = "month";
const LOAD_COLORS = { plan: "#FE5815", done: "#1057C8" };

function mondayOf(d) {
  const x = startOfDay(d);
  return addDays(x, -((x.getDay() + 6) % 7));
}

function isoWeek(d) {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const w1 = new Date(t.getFullYear(), 0, 4);
  return 1 + Math.round(((t - w1) / 86400000 - 3 + ((w1.getDay() + 6) % 7)) / 7);
}

function loadBuckets(ts, today) {
  let years = j0Period().years.slice();
  if (!years.length) years = [...new Set(ts.filter((t) => t.j0).map((t) => t.j0.getFullYear()))].sort((a, b) => a - b);
  if (!years.length) years = [today.getFullYear()];
  const first = years[0], last = years[years.length - 1], buckets = [];
  if (loadGrain === "week") {
    for (let d = mondayOf(new Date(first, 0, 1)); d <= new Date(last, 11, 31); d = addDays(d, 7)) {
      const w = isoWeek(d);
      buckets.push({ key: +d, start: d, end: addDays(d, 7), label: `S${w}`, long: `Semaine ${w} (${formatDate(d)})`, tick: w % 4 === 1, year: addDays(d, 3).getFullYear() });
    }
  } else {
    for (let y = first; y <= last; y++) for (let m = 0; m < 12; m++) {
      buckets.push({ key: `${y}-${m}`, start: new Date(y, m, 1), end: new Date(y, m + 1, 1), label: MONTHS[m], long: `${MONTHS_LONG[m]} ${y}`, tick: true, year: y });
    }
  }
  const rangeStart = buckets[0].start, rangeEnd = buckets[buckets.length - 1].end;
  const inRange = ts.filter((t) => t.j0 && t.j0 >= rangeStart && t.j0 < rangeEnd);
  const outside = ts.length - inRange.length;
  return { buckets, outside, inRange, rangeStart, rangeEnd };
}

// Graduation lisible : pas « rond » (1, 2, 2,5, 5 × 10ⁿ, entier) donnant 4 à 6 lignes,
// et un maximum juste au-dessus du total pour que la courbe occupe la hauteur.
function loadScale(total) {
  const raw = Math.max(1, total) / 5, p = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 2.5, 5, 10].map((k) => k * p).find((s) => s >= raw && Number.isInteger(s)) || 10 * p);
  const ticks = Math.max(1, Math.ceil(Math.max(1, total) / step));
  return { step, ticks, max: step * ticks };
}

function loadModel(ts, today) {
  const { buckets, outside, inRange, rangeStart, rangeEnd } = loadBuckets(ts, today);
  const starts = inRange.map((t) => +t.j0).sort((a, b) => a - b);
  // Date de réalisation : « Date fin » de l'essai dans la CRU (colonne W), ramenée à aujourd'hui au
  // plus tard ; à défaut, la date de début.
  const done = inRange.filter(isRealized);
  const noEnd = done.filter((t) => !t.endCru).length;
  const doneDates = done.map((t) => Math.min(+(t.endCru || t.j0), +today)).sort((a, b) => a - b);
  // Nombre de dates strictement avant d (recherche dichotomique).
  const before = (arr, d) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < +d) lo = m + 1; else hi = m; } return lo; };
  const planned = (d) => before(starts, d);
  const total = starts.length, doneNow = doneDates.length;
  const now = today < rangeStart ? rangeStart : today > rangeEnd ? rangeEnd : today;
  const dueNow = planned(addDays(now, 1)); // essais dont le début est passé (aujourd'hui compris)
  const lateNow = dueNow - doneNow; // négatif = en avance
  return { buckets, outside, rangeStart, rangeEnd, now, total, doneNow, dueNow, lateNow, noEnd, planned, doneBy: (d) => before(doneDates, d) };
}

function loadCurveSvg(m) {
  const { buckets, rangeStart, rangeEnd, now } = m;
  const narrow = window.innerWidth < 700, W = narrow ? 480 : 900, H = narrow ? 260 : 300;
  const top = 18, bottom = 46, left = 40, right = narrow ? 76 : 104;
  const plotW = W - left - right, plotH = H - top - bottom;
  const scale = loadScale(m.total), max = scale.max;
  const x = (d) => left + ((d - rangeStart) / (rangeEnd - rangeStart)) * plotW, y = (v) => top + plotH - (v / max) * plotH;
  const pt = (d, v) => `${x(d).toFixed(1)},${y(v).toFixed(1)}`;
  const parts = [];
  for (let k = 0; k <= scale.ticks; k++) {
    const v = scale.step * k, yy = y(v);
    parts.push(`<line x1="${left}" x2="${left + plotW}" y1="${yy}" y2="${yy}" class="lcGrid${k ? "" : " base"}"/>`);
    parts.push(`<text x="${left - 6}" y="${yy + 4}" class="lcAxis" text-anchor="end">${fmt(v)}</text>`);
  }
  // Graduations : mois (milieu du mois) ou semaines, années sous l'axe.
  let shownYear = buckets[0].year;
  buckets.forEach((b, i) => {
    if (!b.tick || (narrow && loadGrain === "week" && parseInt(b.label.slice(1), 10) % 8 !== 1) || (narrow && loadGrain === "month" && i % 2)) return;
    const cx = loadGrain === "week" ? x(b.start) : x(new Date((+b.start + +b.end) / 2));
    parts.push(`<text x="${cx}" y="${top + plotH + 18}" class="lcAxis" text-anchor="middle">${esc(b.label)}</text>`);
    if (b.year !== shownYear) { shownYear = b.year; parts.push(`<text x="${cx}" y="${top + plotH + 36}" class="lcAxis" text-anchor="middle">${b.year}</text>`); }
  });
  const showToday = m.now > rangeStart && m.now < rangeEnd;
  if (showToday) {
    const tx = x(now);
    parts.push(`<line x1="${tx}" x2="${tx}" y1="${top}" y2="${top + plotH}" class="lcToday"/><text x="${tx > left + plotW - 80 ? tx - 4 : tx + 4}" y="${top + 10}" class="lcTodayLabel" text-anchor="${tx > left + plotW - 80 ? "end" : "start"}">aujourd’hui</text>`);
  }
  // Objectif : cumul de tous les essais par date de début.
  const ends = buckets.map((b) => b.end);
  const planPts = [pt(rangeStart, 0), ...ends.map((d) => pt(d, m.planned(d)))];
  parts.push(`<polyline points="${planPts.join(" ")}" class="lcLine" stroke="${LOAD_COLORS.plan}" stroke-dasharray="6 5"/>`);
  // Réalisé : trait plein jusqu'à aujourd'hui.
  const pastEnds = ends.filter((d) => d < now);
  const donePts = [pt(rangeStart, 0), ...pastEnds.map((d) => pt(d, m.doneBy(d))), pt(now, m.doneNow)];
  parts.push(`<polyline points="${donePts.join(" ")}" class="lcLine" stroke="${LOAD_COLORS.done}"/>`);
  parts.push(`<circle cx="${x(now)}" cy="${y(m.doneNow)}" r="4.5" fill="${LOAD_COLORS.done}" class="lcDot"/>`);
  // Étiquettes directes en bout de courbe.
  const endX = left + plotW + 6, labels = [[m.total, `${fmt(m.total)} au total`, "plan"], [m.doneNow, `${fmt(m.doneNow)} faits`, "done"]];
  if (Math.abs(y(m.total) - y(m.doneNow)) < 14) labels[1][0] = null;
  parts.push(`<text x="${endX}" y="${y(m.total) + 4}" class="lcEnd">${labels[0][1]}</text>`);
  if (labels[1][0] !== null) parts.push(`<text x="${showToday ? x(now) + 8 : endX}" y="${y(m.doneNow) + (y(m.doneNow) - y(m.planned(now)) < 14 ? 16 : 4)}" class="lcEnd">${labels[1][1]}</text>`);
  // Zones de survol par période.
  buckets.forEach((b) => {
    const d = b.end, past = d <= now;
    const tip = `${esc(b.long)} (fin)\nobjectif ${fmt(m.planned(d))} essais${past ? ` · ${fmt(m.doneBy(d))} réalisés · écart ${fmt(m.planned(d) - m.doneBy(d))}` : ` · ${fmt(Math.max(0, m.planned(d) - m.doneNow))} encore à réaliser d’ici là`}`;
    parts.push(`<rect x="${x(b.start)}" y="${top}" width="${Math.max(1, x(b.end) - x(b.start))}" height="${plotH}" class="lcHit" data-tip="${tip}" tabindex="-1"/>`);
  });
  const line = (c, dash = "") => `<svg width="28" height="10" aria-hidden="true"><line x1="0" x2="28" y1="5" y2="5" stroke="${c}" stroke-width="2.5"${dash ? ` stroke-dasharray="${dash}"` : ""}/></svg>`;
  const key = `<div class="lcLegend"><span>${line(LOAD_COLORS.plan, "6 5")}À réaliser (tous les essais, cumul)</span><span>${line(LOAD_COLORS.done)}Réalisés (cumul)</span></div>`;
  return `${key}<svg class="loadCurve" viewBox="0 0 ${W} ${H}" role="img" aria-label="Courbe de charge cumulée : essais à réaliser et essais réalisés">${parts.join("")}</svg>`;
}

function loadCurvePanel(ts, today = data.today) {
  const m = loadModel(ts, today);
  const status = `Aujourd’hui : ${fmt(m.doneNow)} essais réalisés sur ${fmt(m.dueNow)} à réaliser, ${m.lateNow > 0 ? `écart de ${plural(m.lateNow, "essai")}` : m.lateNow < 0 ? `${plural(-m.lateNow, "essai")} d’avance` : "pas d’écart"}.`;
  return panel("Courbe de charge", loadCurveSvg(m), {
    sub: `${status} À réaliser : date de début (CRU, sinon J0). Réalisés : date fin de l’essai (CRU)${m.noEnd ? `, ou date de début pour ${plural(m.noEnd, "essai")} sans date fin` : ""}.${m.outside ? ` ${plural(m.outside, "TOT", "TOT")} sans date ou hors période non comptée${m.outside > 1 ? "s" : ""}.` : ""}`,
    actions: segment("loadGrain", LOAD_GRAINS, loadGrain, { label: "Pas de temps" }),
    cls: "loadPanel",
  });
}
