// Courbe de charge : nombre d'essais (TOT) par mois ou par semaine de date de début
// (date début calculée de la CRU si renseignée, sinon J0 de la DEM).
// Trait plein = essais réalisés, pointillés = essais pas encore réalisés.
const LOAD_GRAINS = [["month", "Mois"], ["week", "Semaine"]];
let loadGrain = "month";
const LOAD_COLORS = { done: "#1057C8", todo: "#FE5815" };

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
  for (const b of buckets) { b.done = 0; b.todo = 0; }
  let outside = 0;
  const rangeStart = buckets[0].start, rangeEnd = buckets[buckets.length - 1].end;
  for (const t of ts) {
    if (!t.j0 || t.j0 < rangeStart || t.j0 >= rangeEnd) { outside++; continue; }
    const b = loadGrain === "week" ? buckets[Math.floor((mondayOf(t.j0) - rangeStart) / (7 * 86400000))] : buckets[(t.j0.getFullYear() - first) * 12 + t.j0.getMonth()];
    if (!b) { outside++; continue; }
    if (isRealized(t)) b.done++; else b.todo++;
  }
  return { buckets, outside };
}

// Pas de graduation entier (1, 2, 5, 10, 20…) : 4 lignes de grille, valeurs rondes.
function niceStep(v) {
  if (v <= 1) return 1;
  const p = 10 ** Math.floor(Math.log10(v)), n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

function loadCurveSvg(ts, today) {
  const { buckets, outside } = loadBuckets(ts, today);
  const narrow = window.innerWidth < 700, W = narrow ? 480 : 900, H = narrow ? 260 : 290, top = 16, bottom = 46, left = 34, right = 10;
  const plotW = W - left - right, plotH = H - top - bottom, n = buckets.length, slot = plotW / n;
  const max = 4 * niceStep(Math.max(1, ...buckets.map((b) => Math.max(b.done, b.todo))) / 4);
  const x = (i) => left + slot * (i + 0.5), y = (v) => top + plotH - (v / max) * plotH;
  const parts = [];
  for (let k = 0; k <= 4; k++) {
    const v = (max / 4) * k, yy = y(v);
    parts.push(`<line x1="${left}" x2="${W - right}" y1="${yy}" y2="${yy}" class="lcGrid${k ? "" : " base"}"/>`);
    parts.push(`<text x="${left - 6}" y="${yy + 4}" class="lcAxis" text-anchor="end">${fmt(v)}</text>`);
  }
  const ti = buckets.findIndex((b) => today >= b.start && today < b.end);
  if (ti >= 0) {
    const tx = left + slot * ti + slot * ((today - buckets[ti].start) / (buckets[ti].end - buckets[ti].start));
    parts.push(`<line x1="${tx}" x2="${tx}" y1="${top}" y2="${top + plotH}" class="lcToday"/><text x="${tx > W - 90 ? tx - 4 : tx + 4}" y="${top + 10}" class="lcTodayLabel" text-anchor="${tx > W - 90 ? "end" : "start"}">aujourd’hui</text>`);
  }
  let shownYear = buckets[0].year;
  buckets.forEach((b, i) => {
    if (!b.tick || (narrow && loadGrain === "week" && (parseInt(b.label.slice(1), 10) % 8 !== 1)) || (narrow && loadGrain === "month" && b.year !== buckets[0].year && i % 2)) return;
    parts.push(`<text x="${x(i)}" y="${top + plotH + 18}" class="lcAxis" text-anchor="middle">${esc(b.label)}</text>`);
    if (b.year !== shownYear) { shownYear = b.year; parts.push(`<text x="${x(i)}" y="${top + plotH + 36}" class="lcAxis" text-anchor="middle">${b.year}</text>`); }
  });
  const path = (key) => buckets.map((b, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(b[key]).toFixed(1)}`).join(" ");
  parts.push(`<path d="${path("todo")}" class="lcLine" stroke="${LOAD_COLORS.todo}" stroke-dasharray="6 5"/>`);
  parts.push(`<path d="${path("done")}" class="lcLine" stroke="${LOAD_COLORS.done}"/>`);
  if (loadGrain === "month") {
    buckets.forEach((b, i) => {
      if (b.todo) parts.push(`<circle cx="${x(i)}" cy="${y(b.todo)}" r="4" fill="${LOAD_COLORS.todo}" class="lcDot"/>`);
      if (b.done) parts.push(`<circle cx="${x(i)}" cy="${y(b.done)}" r="4" fill="${LOAD_COLORS.done}" class="lcDot"/>`);
    });
  }
  // Zones de survol : une par période, plus larges que les points.
  buckets.forEach((b, i) => parts.push(`<rect x="${left + slot * i}" y="${top}" width="${slot}" height="${plotH}" class="lcHit" data-tip="${esc(b.long)}\n${fmt(b.done)} réalisé${b.done > 1 ? "s" : ""} · ${fmt(b.todo)} à réaliser · ${fmt(b.done + b.todo)} au total" tabindex="-1"/>`));
  const key = `<div class="lcLegend"><span><svg width="28" height="10" aria-hidden="true"><line x1="0" x2="28" y1="5" y2="5" stroke="${LOAD_COLORS.done}" stroke-width="2.5"/></svg>Essais réalisés</span><span><svg width="28" height="10" aria-hidden="true"><line x1="0" x2="28" y1="5" y2="5" stroke="${LOAD_COLORS.todo}" stroke-width="2.5" stroke-dasharray="6 5"/></svg>Essais à réaliser</span></div>`;
  return { html: `${key}<svg class="loadCurve" viewBox="0 0 ${W} ${H}" role="img" aria-label="Courbe de charge : essais par ${loadGrain === "week" ? "semaine" : "mois"} de date de début">${parts.join("")}</svg>`, outside };
}

function loadCurvePanel(ts, today = data.today) {
  const { html, outside } = loadCurveSvg(ts, today);
  return panel("Courbe de charge", html, {
    sub: `Essais (TOT) par ${loadGrain === "week" ? "semaine" : "mois"} de date de début : date calculée de la CRU, sinon J0 de la DEM.${outside ? ` ${plural(outside, "TOT", "TOT")} sans date ou hors période non comptée${outside > 1 ? "s" : ""}.` : ""}`,
    actions: segment("loadGrain", LOAD_GRAINS, loadGrain, { label: "Pas de temps" }),
    cls: "loadPanel",
  });
}
