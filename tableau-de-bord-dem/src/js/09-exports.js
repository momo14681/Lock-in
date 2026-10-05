// =============================================================================
// Exports CSV et PDF de la vue affichée.
// =============================================================================

function downloadBytes(bytes, mime, name) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// CSV « ; » avec BOM pour Excel ; les valeurs commençant par = + @ - sont neutralisées.
function downloadMatrix(headers, rows, name) {
  const quote = (v) => '"' + String(/^[=+@\-\t\r]/.test(String(v ?? "")) ? "'" + v : v ?? "").replaceAll('"', '""') + '"';
  downloadBytes("﻿" + [headers, ...rows].map((r) => r.map(quote).join(";")).join("\r\n"), "text/csv;charset=utf-8", name);
}

// --- Contenu du PDF selon la vue --------------------------------------------------

function indicatorSection(rows) {
  return { title: "Indicateurs", headers: ["Indicateur", "Valeur"], widths: [.65, .35], rows };
}

function reportModel() {
  const sections = [];
  let title = TABS[mode].find((t) => t.id === tab)?.label || "Vue";
  const ts = visible, n = ts.length;
  const realized = ts.filter(isRealized).length, prepared = ts.filter((t) => t.prepComplete).length;

  if (tab === "mine") {
    title = `Mes affaires — ${me || "chargé non choisi"}`;
    const groups = affaireGroups(ts);
    sections.push(indicatorSection([["Affaires", groups.length], ["REE", dossierCount(ts)], ["TOT", n], ["Préparation documentaire", pct(prepared, n)], ["Essais réalisés", pct(realized, n)], ["Prépas en retard", ts.filter((t) => t.overdue).length], ["Échéances sous 30 jours", ts.filter((t) => t.dueSoon).length], ["Corrections DEM", issues.length]]));
    sections.push({ title: "Suivi par affaire", headers: ["Affaire", "Libellé DI", "TOT", "J0", "Prépa", "BPA signés", "GER/1N signés", "BPD signés", "Statut"], widths: [.13, .25, .05, .13, .08, .08, .09, .08, .11],
      rows: groups.map((g) => [g.affaire, g.libelle, g.n, g.j0Min ? (g.j0Max - g.j0Min ? `du ${formatDate(g.j0Min)} au ${formatDate(g.j0Max)}` : formatDate(g.j0Min)) : "—", `${g.prep}/${g.n}`, `${g.bpa.done}/${g.n}`, `${g.ger.done}/${g.n}`, `${g.bpd.done}/${g.n}`, AFFAIRE_STATUS[g.status].label]) });
  } else if (tab === "overview") {
    title = "Synthèse coordination";
    sections.push(indicatorSection([["TOT", n], ["Affaires", countUnique(ts, (t) => t.affaire)], ["REE", dossierCount(ts)], ["Préparation", pct(prepared, n)], ["Essais réalisés", pct(realized, n)], ["Non affectées", ts.filter((t) => t.responsable === UNASSIGNED).length], ["Prépas en retard", ts.filter((t) => t.overdue).length], ["Corrections DEM", issues.length]]));
    const sortLabel = CHARGE_SORTS.find(([k]) => k === chargeSort)?.[1] || "";
    sections.push({ title: `Charge par chargé — ${CHARGE_MODES.find(([k]) => k === chargeMode)?.[1]} · tri : ${sortLabel}${hiddenOwners.size ? " (masquage appliqué)" : ""}`, headers: ["Chargé", ...chargeSegments(visible).map((s) => s.label), "Total", "AT", "TEM"], rows: chargeGroups().map((g) => [g.name, ...g.segments.map((s) => s.value), g.total, g.AT, g.TEM]) });
    sections.push({ title: "Corrections DEM par type", headers: ["Contrôle", "Nombre"], widths: [.8, .2], rows: [...new Set(issues.map((i) => i.kind))].map((k) => [k, issues.filter((i) => i.kind === k).length]).sort((a, b) => b[1] - a[1]) });
    sections.push({ title: "Corrections DEM par chargé", headers: ["Chargé", "Nombre"], widths: [.8, .2], rows: [...new Set(issues.map((i) => i.t.responsable))].map((k) => [k, issues.filter((i) => i.t.responsable === k).length]).sort((a, b) => b[1] - a[1]) });
    sections.push({ title: "États du REE", headers: ["État du REE", "Produits", "Part produits", "Signés", "Part signés"], rows: [["BPA", "bpaState"], ["GER/1N", "gerState"], ["BPD", "bpdState"]].map(([label, k]) => { const s = milestoneStats(ts, k); return [label, s.produced, pct(s.produced, n), s.done, pct(s.done, n)]; }) });
  } else if (tab === "team") {
    const m = teamModel();
    title = "Avancement de l’équipe";
    sections.push(indicatorSection([["TOT", m.n], ["Essais réalisés", `${pct(m.realized, m.n)} (${m.realized})`], ["Préparation documentaire terminée", `${pct(m.prepared, m.n)} (${m.prepared})`], ["Prépas en retard (TOT)", m.overdue], ["REE en retard de préparation", m.late.length], ["Échéances sous 30 jours", m.dueSoon]]));
    sections.push({ title: `Avancement par mois de J0 — ${m.timeline.title}`, headers: ["Période", "TOT", ...STATE_ORDER, "% réalisés"], rows: m.timeline.columns.map((c) => [c.long, c.total, ...STATE_ORDER.map((s) => c.counts[s]), pct(c.counts[STATE.realized], c.total)]) });
    sections.push({ title: "Retards de préparation documentaire", headers: ["Affaire / REE", "Chargé", "Échéance prépa", "J0", "Retard", "TOT", "Manque"], widths: [.2, .15, .12, .11, .08, .06, .28], rows: m.late.map((g) => [`${g.affaire} / ${g.ree} (${g.phase})`, g.owners.join(", "), formatDate(g.prepDue), formatDate(g.j0), `${g.late} j`, g.ts.length, g.missing.join(", ")]) });
    sections.push({ title: "Avancement par chargé", headers: ["Chargé", "TOT", "Réalisés", "Prépa terminée", "Prépas en retard", "Échéances < 30 j"], rows: m.owners.map((o) => [o.name, o.n, `${o.realized} (${pct(o.realized, o.n)})`, `${o.prepared} (${pct(o.prepared, o.n)})`, o.overdue, o.dueSoon]) });
  } else if (tab === "owners") {
    sections.push({ title, headers: ["Chargé", "Affaires", "REE", "TOT", "Prépa terminée", "Réalisés", "Retards", "Infos manq.", "Corrections"], rows: ownerStats().map((s) => [s.name, s.affaires, s.ree, s.n, s.prep, s.realized, s.overdue, s.missing, s.issues]) });
  } else if (tab === "assignments") {
    const m = assignmentModel();
    title = "Affectations SharePoint — " + (assignmentLabels[assignmentFilter] || "Toutes");
    sections.push({ title, headers: m.headers, rows: m.rows, widths: [.17, .08, .09, .16, .3, .2] });
    if (data.ipe?.error) sections.push({ title: "Source indisponible", headers: ["Information"], rows: [[data.ipe.error]] });
  } else if (tab === "affaires" || tab === "dossiers") {
    const m = groupData(tab);
    title = tab === "affaires" ? "Affaires" : "REE";
    sections.push({ title, headers: m.headers, rows: m.rows, widths: [.2, .11, .25, .1, .12, .11, .11] });
  } else if (tab === "issues") {
    title = (showIgnored ? "Signalements ignorés" : "Corrections à faire dans la DEM") + (issueKind ? " — " + issueKind : "") + (issueLevel ? " — " + issueLevel : "");
    sections.push({ title, headers: ["Priorité / contrôle", "Affaire / REE", "Chargé", "Cellules", "Valeur", "Action"], widths: [.14, .16, .1, .14, .2, .26],
      rows: issueRows().map((i) => [`${i.level} · ${i.kind}`, `${i.t.affaire} / ${i.t.ree}`, i.t.responsable, `${i.t.sheet}!${i.cells}`, i.value, i.reason + (observations(i.t) ? " — Obs. : " + observations(i.t) : "")]) });
  } else if (tab === "documents") {
    title = (docCode === "P" ? "Documents prêts à valider (P)" : "Documents à reprendre (R)") + (documentType ? " — " + names[documentType] : "");
    sections.push({ title, headers: ["Affaire / REE", "Chargé", "OT / TOT", "Document", "Cellule", "Observations"], widths: [.2, .13, .14, .1, .1, .33],
      rows: documentRows(visible, docCode, documentType).map((i) => [`${i.t.affaire} / ${i.t.ree}`, i.t.responsable, `${i.t.ot} / ${i.t.tot}`, `${i.kind} : ${i.value}`, `${i.t.sheet}!${i.cells}`, observations(i.t)]) });
  } else {
    title = taskTitle() + (taskFocus ? " — " + TASK_FOCUS.find(([k]) => k === taskFocus)?.[1] : "");
    sections.push({ title, headers: ["Affaire / REE", "Chargé", "Feuille / ligne", "OT / TOT", "J0", "Statut", "BPA", "GER/1N", "BPD"], widths: [.19, .13, .1, .14, .09, .12, .08, .07, .08],
      rows: taskRows().map((t) => [`${t.affaire} / ${t.ree}`, t.responsable, `${t.sheet} / ${t.rowNumber}`, `${t.ot} / ${t.tot}`, t.j0Label, state(t), t.bpa, t.ger, t.bpd]) });
  }
  return {
    title, sections,
    source: data?.fileName || "",
    date: formatFrenchDateTime(data?.analyzedAt),
    filters: [`DEM ${activeDEM}`, tab === "assignments" ? "IPE : toutes les feuilles, tous les CE" : tab === "team" ? teamModel().scope : scopeLabel(), periodLabel()].join(" · "),
    ignored: allIssues.filter((i) => ignoredIssues.has(issueId(i))).length,
  };
}

// --- Moteur PDF (pdf-lib, A4 paysage, police embarquée) ---------------------------

async function makePDF(model) {
  const { PDFDocument, rgb } = PDFLib;
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(PDF_REGULAR, { subset: true }), bold = await pdf.embedFont(PDF_BOLD, { subset: true });
  const clean = (value) => [...String(value ?? "").replace(/[  ]/g, " ").replace(/[\r\n\t]+/g, " ")].map((ch) => { try { font.encodeText(ch); return ch; } catch { return "?"; } }).join("");
  const wrap = (value, width, size = 9) => {
    const lines = [];
    let line = "";
    for (const word of clean(value).split(" ")) {
      if (font.widthOfTextAtSize((line ? line + " " : "") + word, size) <= width) { line += (line ? " " : "") + word; continue; }
      if (line) lines.push(line);
      line = "";
      for (const ch of word) {
        if (font.widthOfTextAtSize(line + ch, size) > width && line) { lines.push(line); line = ""; }
        line += ch;
      }
    }
    if (line || !lines.length) lines.push(line);
    return lines;
  };
  const navy = rgb(.055, .15, .26), ink = rgb(.1, .19, .29), muted = rgb(.35, .43, .51), pale = rgb(.93, .96, .98);
  let p, y;
  const put = (v, x, yy, size = 9, f = font, color = ink) => p.drawText(clean(v), { x, y: yy, size, font: f, color });
  function newPage() {
    p = pdf.addPage([842, 595]);
    p.drawRectangle({ x: 0, y: 539, width: 842, height: 56, color: navy });
    put("Pilotage des essais", 32, 561, 17, bold, rgb(1, 1, 1));
    y = 521;
    for (const line of wrap(model.title, 778, 12)) { put(line, 32, y, 12, bold); y -= 15; }
    for (const line of wrap(model.source + " · Import : " + model.date, 778, 9)) { put(line, 32, y, 9, font, muted); y -= 12; }
    for (const line of wrap(model.filters, 778, 9)) { put(line, 32, y, 9, font, muted); y -= 12; }
    y -= 12;
  }
  newPage();
  for (const section of model.sections) {
    const widths = (section.widths || section.headers.map(() => 1 / section.headers.length)).map((w) => 778 * w);
    const headerLines = section.headers.map((v, i) => wrap(v, widths[i] - 12, 9));
    const hh = Math.max(...headerLines.map((l) => l.length)) * 12 + 12;
    const heading = () => {
      const titleLines = wrap(section.title, 778, 11);
      if (y < titleLines.length * 14 + hh + 65) newPage();
      for (const line of titleLines) { put(line, 32, y, 11, bold); y -= 14; }
      y -= 5;
      p.drawRectangle({ x: 32, y: y - hh, width: 778, height: hh, color: navy });
      let x = 32;
      headerLines.forEach((lines, i) => { lines.forEach((line, j) => put(line, x + 6, y - 14 - j * 12, 9, bold, rgb(1, 1, 1))); x += widths[i]; });
      y -= hh;
    };
    heading();
    if (!section.rows.length) { put("Aucun résultat.", 38, y - 17, 9, font, muted); y -= 30; }
    for (let index = 0; index < section.rows.length; index++) {
      const lines = section.rows[index].map((v, i) => wrap(v, widths[i] - 12, 9));
      let remaining = Math.max(...lines.map((l) => l.length)), offset = 0;
      while (remaining > 0) {
        if (y < 70) { newPage(); heading(); }
        let capacity = Math.floor((y - 43 - 12) / 12);
        if (remaining <= 34 && remaining > capacity) { newPage(); heading(); capacity = Math.floor((y - 43 - 12) / 12); }
        const count = Math.max(1, Math.min(remaining, capacity)), height = count * 12 + 12;
        p.drawRectangle({ x: 32, y: y - height, width: 778, height, color: index % 2 === 0 ? pale : rgb(1, 1, 1) });
        let x = 32;
        lines.forEach((cell, i) => { cell.slice(offset, offset + count).forEach((line, j) => put(line, x + 6, y - 14 - j * 12)); x += widths[i]; });
        y -= height; remaining -= count; offset += count;
        if (remaining > 0) { newPage(); heading(); }
      }
    }
    y -= 22;
  }
  const pages = pdf.getPages();
  for (let i = 0; i < pages.length; i++) {
    p = pages[i];
    put(`${i + 1} / ${pages.length}`, 750, 20, 9, font, muted);
    put(`${model.ignored} signalement(s) ignoré(s) pour cet import`, 32, 20, 8, font, muted);
  }
  pdf.setTitle("Pilotage Essais - " + model.title);
  pdf.setCreator("Tableau de bord Pilotage des essais");
  return await pdf.save();
}

async function exportPDF() {
  if (!data) return;
  const b = $("pdfExport");
  b.disabled = true;
  b.textContent = "Préparation du PDF…";
  try {
    const bytes = await makePDF(reportModel());
    downloadBytes(bytes, "application/pdf", "Pilotage_Essais_" + new Date().toISOString().slice(0, 10) + ".pdf");
  } catch (e) {
    $("message").innerHTML = `<div class="notice error">Export PDF impossible : ${esc(e.message)}</div>`;
  } finally {
    b.disabled = !data;
    b.textContent = "Cette vue en PDF";
  }
}
