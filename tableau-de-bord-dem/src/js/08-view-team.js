// =============================================================================
// Avancement de l'équipe : vue partagée par les deux profils, et image 16:9
// pour l'écran de l'équipe (export PNG).
// =============================================================================

const MONTHS = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep", "Oct", "Nov", "Déc"];
const MONTHS_LONG = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

// Colonnes du graphique d'avancement : mois (ou années) de J0 de la période,
// plus « Avant », « Après » et « Sans J0 » lorsqu'ils contiennent des TOT.
function buildTimeline(ts, period, today) {
  let years = period.years.slice();
  if (!years.length) years = [...new Set(ts.filter((t) => t.j0).map((t) => t.j0.getFullYear()))].sort((a, b) => a - b);
  if (!years.length) years = [today.getFullYear()];
  const first = years[0], last = years[years.length - 1];
  const monthly = last - first <= 1;
  const buckets = [];
  const empty = () => Object.fromEntries(STATE_ORDER.map((s) => [s, 0]));
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
    const s = state(t);
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
  const cols = tl.columns, W = 1400, H = 340, top = 34, bottom = 52, left = 8, right = 8;
  const plotH = H - top - bottom, slot = (W - left - right) / cols.length, barW = Math.min(56, slot * 0.6);
  const parts = [];
  cols.forEach((c, i) => {
    const x = left + i * slot + (slot - barW) / 2, cx = x + barW / 2;
    if (c.current) parts.push(`<rect x="${left + i * slot + 2}" y="${top - 30}" width="${slot - 4}" height="${plotH + 30 + 46}" rx="8" class="tlNow"/>`);
    parts.push(`<rect x="${x}" y="${top}" width="${barW}" height="${plotH}" rx="4" class="tlTrack"/>`);
    let y = top + plotH;
    const segs = STATE_ORDER.filter((s) => c.counts[s] > 0);
    segs.forEach((s, k) => {
      const h = c.counts[s] / c.total * plotH;
      const gap = k < segs.length - 1 ? 2 : 0;
      const isTop = k === segs.length - 1;
      const hh = Math.max(0.5, h - gap);
      y -= h;
      const shape = isTop
        ? `<path d="M${x},${y + hh} V${y + Math.min(4, hh)} Q${x},${y} ${x + Math.min(4, hh)},${y} H${x + barW - Math.min(4, hh)} Q${x + barW},${y} ${x + barW},${y + Math.min(4, hh)} V${y + hh} Z"`
        : `<rect x="${x}" y="${y + gap}" width="${barW}" height="${hh}"`;
      parts.push(`${shape} fill="${STATE_COLORS[s]}" data-tip="${fmt(c.counts[s])} TOT · ${pct(c.counts[s], c.total)}\n${esc(s)} · ${esc(c.long)}" tabindex="0"/>`);
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

function lateTable(late, limit = Infinity) {
  const rows = late.slice(0, limit).map((g) => `<tr>
    <td><strong>${esc(g.affaire || "Affaire manquante")}</strong><small>REE ${esc(g.ree || "absent")} · ${esc(g.phase)} · ${esc(g.sheet)}</small></td>
    <td>${esc(g.owners.join(", "))}</td>
    <td>${formatDate(g.prepDue)}<small>J0 ${formatDate(g.j0)}</small></td>
    <td class="num"><strong class="lateDays">+${fmt(g.late)} j</strong></td>
    <td class="num">${fmt(g.ts.length)}</td>
    <td><span class="missingKeys">${esc(g.missing.join(", ") || "—")}</span></td></tr>`);
  return table(["Affaire / REE", "Chargé", "Échéance prépa", { label: "Retard", cls: "num" }, { label: "TOT", cls: "num" }, "Manque"], rows, { empty: "Aucune préparation en retard sur ce périmètre." });
}

function viewTeam() {
  const m = teamModel();
  const lateRee = m.late.length;
  const lateOwnersFilter = teamLateOwner && m.late.some((g) => g.owners.includes(teamLateOwner)) ? teamLateOwner : "";
  const lateShown = lateOwnersFilter ? m.late.filter((g) => g.owners.includes(lateOwnersFilter)) : m.late;
  const p = paginate(lateShown);
  const kpis = [
    kpi({ label: "Essais réalisés", value: pct(m.realized, m.n), sub: `${fmt(m.realized)} / ${fmt(m.n)} TOT · GER/1N signé`, bar: { ratio: ratio(m.realized, m.n), color: STATE_COLORS[STATE.realized] } }),
    kpi({ label: "Préparation documentaire terminée", value: pct(m.prepared, m.n), sub: `${fmt(m.prepared)} / ${fmt(m.n)} TOT`, bar: { ratio: ratio(m.prepared, m.n), color: STATE_COLORS[STATE.ready] } }),
    kpi({ label: "Prépas en retard", value: fmt(m.overdue), sub: `TOT · ${plural(lateRee, "REE", "REE")} · échéance J0 − 30 dépassée`, tone: m.overdue ? "bad" : "good" }),
    kpi({ label: "Échéances sous 30 jours", value: fmt(m.dueSoon), sub: "TOT à préparer dans le mois", tone: m.dueSoon ? "warn" : "" }),
  ].join("");
  const ownerFilter = m.lateByOwner.length ? `<div class="ownerChips"><span class="muted">Par chargé :</span>${[["", "Tous", m.overdue], ...m.lateByOwner.map(([n, c]) => [n, n, c])].map(([value, label, c]) => `<button type="button" data-set="teamLateOwner:${esc(value)}" class="${value === lateOwnersFilter ? "active" : ""}" aria-pressed="${value === lateOwnersFilter}">${esc(label)} <span class="count">${fmt(c)}</span></button>`).join("")}</div>` : "";
  const ownerRows = m.owners.map((o) => `<tr><td>${esc(o.name)}</td><td class="num">${fmt(o.n)}</td>
    <td>${meter(o.realized, o.n, { color: STATE_COLORS[STATE.realized] })}</td>
    <td>${meter(o.prepared, o.n, { color: STATE_COLORS[STATE.ready] })}</td>
    <td class="num">${o.overdue ? badge(fmt(o.overdue), "bad") : '<span class="muted">0</span>'}</td>
    <td class="num">${o.dueSoon ? badge(fmt(o.dueSoon), "warn") : '<span class="muted">0</span>'}</td></tr>`);

  $("view").innerHTML = `<div class="viewHead"><div><h2 class="viewTitle">Avancement de l’équipe</h2><p class="muted">DEM ${esc(m.dem)} · ${esc(m.period)} · ${esc(m.scope)} · données au ${esc(m.todayLabel)}</p></div>
      <div class="panelActions"><button type="button" data-png-preview>Aperçu de l’écran</button><button type="button" class="accent" data-png>Exporter l’écran d’équipe (PNG)</button></div></div>
    <div class="kpis kpis-4 hero">${kpis}</div>
    ${panel(`Avancement par mois de J0 · ${esc(m.timeline.title)}`, `${legend(STATE_ORDER.map((s) => [s, STATE_COLORS[s]]))}${timelineSvg(m.timeline)}`,
      { sub: "Répartition des TOT selon leur statut pour chaque mois de J0 · nombre de TOT au-dessus de chaque colonne · % de réalisés dans la partie verte", cls: "timelinePanel" })}
    <div class="split even">
      ${panel(`Retards de préparation documentaire · ${fmt(lateRee)} REE`, `${ownerFilter}${lateTable(p.slice)}${pager(p)}`,
        { sub: "REE dont l’échéance J0 − 30 est dépassée sans préparation complète · échéances les plus récentes en premier (J0 le plus proche)", cls: "latePanel", actions: exportButton("Exporter en CSV") })}
      ${panel("Avancement par chargé d’essais", table(["Chargé", { label: "TOT", cls: "num" }, "Réalisés", "Prépa terminée", { label: "Retards", cls: "num" }, { label: "< 30 j", cls: "num" }], ownerRows, { cls: "compact" }), { sub: esc(m.scope) })}
    </div>
    ${panel("Avancement des états du REE", milestoneCards(m.ts), { sub: "Produits (clair) et signés (foncé)" })}`;
  currentExport = () => downloadMatrix(["Affaire", "REE", "Phase", "Feuille", "Chargés", "Échéance prépa", "J0", "Retard (jours)", "TOT", "Informations manquantes"],
    lateShown.map((g) => [g.affaire, g.ree, g.phase, g.sheet, g.owners.join(", "), formatDate(g.prepDue), formatDate(g.j0), g.late, g.ts.length, g.missing.join(", ")]),
    "Retards_preparation.csv");
}

// --- Image 16:9 pour l'écran de l'équipe ---------------------------------------------

const PNG = {
  bg: "#eef2f6", navy: "#0c2444", card: "#ffffff", ink: "#102842", ink2: "#3e5368", muted: "#62788c", track: "#e3eaf1",
  font: (weight, size) => `${weight} ${size}px "Work Sans", Arial, sans-serif`,
};

function drawPNG(canvas, m) {
  canvas.width = 1920;
  canvas.height = 1080;
  const c = canvas.getContext("2d");
  if (!c) throw Error("Votre navigateur ne permet pas de créer cette image.");

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

  // Fond et bandeau
  c.fillStyle = PNG.bg; c.fillRect(0, 0, 1920, 1080);
  const grad = c.createLinearGradient(0, 0, 1920, 0);
  grad.addColorStop(0, "#0c2444"); grad.addColorStop(1, "#163e61");
  c.fillStyle = grad; c.fillRect(0, 0, 1920, 132);
  c.fillStyle = "#34c4af"; c.fillRect(0, 0, 12, 132);
  text("Avancement des essais", 56, 24, { size: 50, weight: 700, color: "#ffffff", width: 1000 });
  text(`DEM ${m.dem}  ·  ${m.period}  ·  ${m.scope}`, 58, 88, { size: 24, color: "#b9cde0", width: 1180 });
  text(`Données au ${m.todayLabel}`, 1864, 28, { size: 32, weight: 700, color: "#ffffff", width: 600, align: "right" });
  text(`Import du ${m.importDate}`, 1864, 78, { size: 21, color: "#9eb5ca", width: 600, align: "right" });

  // Rangée 1 : indicateurs
  const y1 = 156, h1 = 196;
  function card(x, w, label, value, sub, { accent, valueColor = PNG.ink, ratioValue = null, icon = "" }) {
    roundRect(x, y1, w, h1, 18, PNG.card);
    roundRect(x, y1, 8, h1, 4, accent);
    text(label, x + 32, y1 + 22, { size: 27, weight: 600, color: PNG.ink2, width: w - 56 });
    const vw = text(value, x + 32, y1 + 58, { size: 76, weight: 700, color: valueColor, width: w - 56, min: 40 });
    if (icon) text(icon, x + 32 + vw + 14, y1 + 76, { size: 34, color: accent });
    text(sub, x + 32, y1 + 146, { size: 22, color: PNG.muted, width: w - 56 });
    if (ratioValue !== null) bar(x + 32, y1 + 178, w - 64, 8, [[ratioValue, accent]]);
  }
  card(56, 640, "Essais réalisés", pct(m.realized, m.n), `${fmt(m.realized)} / ${fmt(m.n)} TOT · GER/1N signé`, { accent: STATE_COLORS[STATE.realized], ratioValue: ratio(m.realized, m.n) });
  card(720, 560, "Préparation documentaire terminée", pct(m.prepared, m.n), `${fmt(m.prepared)} / ${fmt(m.n)} TOT prêtes`, { accent: STATE_COLORS[STATE.ready], ratioValue: ratio(m.prepared, m.n) });
  card(1304, 268, "Prépas en retard", fmt(m.overdue), `TOT · ${plural(m.late.length, "REE", "REE")}`, { accent: m.overdue ? STATE_COLORS[STATE.late] : STATE_COLORS[STATE.realized], valueColor: m.overdue ? "#b3303e" : PNG.ink, icon: m.overdue ? "●" : "✓" });
  card(1596, 268, "Échéances < 30 j", fmt(m.dueSoon), "TOT à préparer", { accent: m.dueSoon ? STATE_COLORS[STATE.missing] : "#b9c6d4", icon: m.dueSoon ? "▲" : "" });

  // Rangée 2 gauche : avancement par mois de J0
  const y2 = 376, h2 = 456, tx = 56, tw = 1120;
  roundRect(tx, y2, tw, h2, 18, PNG.card);
  text(`Avancement par mois de J0 · ${m.timeline.title}`, tx + 32, y2 + 24, { size: 30, weight: 700, width: tw - 64 });
  let lx = tx + 32;
  for (const s of STATE_ORDER) {
    roundRect(lx, y2 + 76, 18, 18, 4, STATE_COLORS[s]);
    lx += 26 + text(s, lx + 26, y2 + 73, { size: 21, color: PNG.ink2 }) + 30;
  }
  const cols = m.timeline.columns, plotTop = y2 + 152, plotH = 218, slot = (tw - 64) / cols.length, barW = Math.min(52, slot * 0.68);
  cols.forEach((col, i) => {
    const x = tx + 32 + i * slot + (slot - barW) / 2, cx = x + barW / 2;
    if (col.current) roundRect(tx + 32 + i * slot + 2, plotTop - 40, slot - 4, plotH + 104, 10, "#e8f0f8");
    roundRect(x, plotTop, barW, plotH, 5, "#edf1f5");
    let y = plotTop + plotH;
    const segs = STATE_ORDER.filter((s) => col.counts[s] > 0);
    segs.forEach((s, k) => {
      const h = col.counts[s] / col.total * plotH, gap = k < segs.length - 1 ? 2 : 0;
      y -= h;
      const isTop = k === segs.length - 1;
      c.fillStyle = STATE_COLORS[s];
      if (isTop) roundRect(x, y, barW, Math.max(1, h - gap), Math.min(5, h / 2), STATE_COLORS[s]);
      else c.fillRect(x, y + gap, barW, Math.max(0.5, h - gap));
    });
    const done = col.counts[STATE.realized], doneH = col.total ? done / col.total * plotH : 0;
    if (doneH >= 30) text(`${Math.round(done / col.total * 100)}%`, cx, plotTop + plotH - doneH / 2 - 11, { size: 19, weight: 700, color: "#ffffff", align: "center", width: barW + 6, min: 13 });
    text(col.total ? fmt(col.total) : "–", cx, plotTop - 32, { size: 21, weight: 600, color: PNG.ink2, align: "center", width: slot - 4, min: 13 });
    text(col.label, cx, plotTop + plotH + 12, { size: 21, weight: col.current ? 700 : 500, color: col.current ? PNG.ink : PNG.muted, align: "center", width: slot - 2, min: 12 });
    if (col.current) text("aujourd’hui", cx, plotTop + plotH + 40, { size: 16, weight: 600, color: "#3570cc", align: "center", width: slot + 20, min: 11 });
    else if (m.timeline.monthly && col.month === 0 && cols.filter((x2) => x2.month === 0).length > 1) text(String(col.year), cx, plotTop + plotH + 40, { size: 17, color: PNG.muted, align: "center", width: slot });
  });

  // Rangée 2 droite : retards de préparation documentaire
  const rx = 1200, rw = 664;
  roundRect(rx, y2, rw, h2, 18, PNG.card);
  roundRect(rx, y2, rw, 8, 4, m.overdue ? STATE_COLORS[STATE.late] : STATE_COLORS[STATE.realized]);
  text("Retards de préparation documentaire", rx + 32, y2 + 26, { size: 29, weight: 700, width: rw - 64 });
  text(m.late.length ? `${plural(m.late.length, "REE", "REE")} · ${fmt(m.overdue)} TOT · échéances les plus récentes d’abord` : "Aucune préparation en retard", rx + 32, y2 + 66, { size: 20, color: PNG.muted, width: rw - 64 });
  const shown = m.late.slice(0, 5), rowH = 54;
  shown.forEach((g, i) => {
    const y = y2 + 102 + i * rowH;
    if (i) { c.fillStyle = "#e6ecf2"; c.fillRect(rx + 32, y - 6, rw - 64, 1); }
    text(`${g.affaire || "Affaire manquante"}  ·  ${g.ree || "REE absent"}`, rx + 32, y, { size: 22, weight: 700, width: 420, min: 15 });
    text(`${g.phase} · ${g.owners.join(", ")}${g.missing.length ? " · manque " + g.missing.join(", ") : ""}`, rx + 32, y + 26, { size: 17, color: PNG.muted, width: 430, min: 13 });
    text(`+${fmt(g.late)} j`, rx + rw - 32, y + 2, { size: 25, weight: 700, color: "#b3303e", align: "right", width: 150 });
    text(`J0 ${formatShortDate(g.j0)}`, rx + rw - 32, y + 30, { size: 16, color: PNG.muted, align: "right", width: 150 });
  });
  if (!shown.length) text("✓  Toutes les préparations échues sont complètes.", rx + 32, y2 + 120, { size: 24, color: "#0d7a59", width: rw - 64 });
  if (m.late.length > shown.length) text(`+ ${plural(m.late.length - shown.length, "autre REE", "autres REE")} en retard`, rx + 32, y2 + 102 + shown.length * rowH, { size: 18, weight: 600, color: PNG.ink2, width: rw - 64 });
  if (m.lateByOwner.length) {
    // Autant de chargés que la largeur le permet, le reste résumé en « +N ».
    c.font = PNG.font(600, 18);
    let line = "Par chargé :", shownOwners = 0;
    for (const [name, n] of m.lateByOwner) {
      const next = `${line}${shownOwners ? "  ·" : ""}  ${name} ${n}`;
      const restLabel = shownOwners + 1 < m.lateByOwner.length ? `  ·  +${m.lateByOwner.length - shownOwners - 1} autres` : "";
      if (c.measureText(next + restLabel).width > rw - 64) break;
      line = next;
      shownOwners++;
    }
    if (shownOwners < m.lateByOwner.length) line += `  ·  +${m.lateByOwner.length - shownOwners} autres`;
    roundRect(rx + 16, y2 + h2 - 58, rw - 32, 42, 10, "#f1f5f9");
    text(line, rx + 32, y2 + h2 - 47, { size: 18, weight: 600, color: PNG.ink2, width: rw - 64, min: 14 });
  }

  // Rangée 3 : états du REE
  const y3 = 856, h3 = 160, mw = 586;
  m.milestones.forEach((ms, i) => {
    const x = 56 + i * (mw + 25);
    roundRect(x, y3, mw, h3, 18, PNG.card);
    text(ms.label, x + 32, y3 + 18, { size: 28, weight: 700, width: 200 });
    const pw = text(pct(ms.produced, m.n), x + 32, y3 + 56, { size: 46, weight: 700, width: 200 });
    text("produits", x + 32 + pw + 12, y3 + 76, { size: 21, color: PNG.muted });
    const sw = text("signés", x + mw - 32, y3 + 76, { size: 21, color: PNG.muted, align: "right" });
    text(pct(ms.done, m.n), x + mw - 32 - sw - 12, y3 + 56, { size: 46, weight: 700, color: "#0d7a59", align: "right", width: 200 });
    bar(x + 32, y3 + 124, mw - 64, 14, [[ratio(ms.done, m.n), STATE_COLORS[STATE.realized]], [ratio(Math.max(0, ms.produced - ms.done), m.n), "rgba(20,147,108,.35)"]]);
  });

  text(`Source : ${m.source}  ·  Réalisé = GER/1N signé (PSR, TSR)  ·  Préparation terminée = MC, OT, TOT, RDU renseignés et TOT prête  ·  Échéance de préparation = J0 − 30 jours`, 56, 1036, { size: 18, color: PNG.muted, width: 1808, min: 13 });
  return canvas;
}

async function renderPNG() {
  if (document.fonts) { await document.fonts.load('700 50px "Work Sans"'); await document.fonts.ready; }
  return drawPNG(document.createElement("canvas"), teamModel());
}

async function exportPNG() {
  if (!data) return;
  const button = $("pngExport");
  button.disabled = true;
  button.textContent = "Création du PNG…";
  try {
    const canvas = await renderPNG();
    const blob = await new Promise((resolve, reject) => canvas.toBlob((b) => b ? resolve(b) : reject(Error("Image PNG non créée.")), "image/png"));
    downloadBytes(blob, "image/png", `Ecran_equipe_essais_DEM${activeDEM}_${new Date().toISOString().slice(0, 10)}.png`);
  } catch (e) {
    $("message").innerHTML = `<div class="notice error">Export PNG impossible : ${esc(e.message)}</div>`;
  } finally {
    button.disabled = !data;
    button.textContent = "Écran d’équipe (PNG)";
  }
}

async function previewPNG() {
  if (!data) return;
  try {
    const canvas = await renderPNG();
    $("detailTitle").textContent = "Aperçu de l’écran d’équipe (1920 × 1080)";
    $("detailBody").innerHTML = `<img class="pngPreview" alt="Aperçu de l’image exportée pour l’écran de l’équipe" src="${canvas.toDataURL("image/png")}"><p class="muted">Même périmètre que la vue « Avancement équipe ». <button type="button" class="accent" data-png>Télécharger le PNG</button></p>`;
    $("detail").classList.add("wideDialog");
    if (!$("detail").open) $("detail").showModal();
  } catch (e) {
    $("message").innerHTML = `<div class="notice error">Aperçu impossible : ${esc(e.message)}</div>`;
  }
}
