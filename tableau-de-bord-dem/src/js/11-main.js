// =============================================================================
// Rendu, navigation et liaisons d'évènements.
// =============================================================================

const VIEWS = {
  mine: viewMine, overview: viewOverview, owners: viewOwners, issues: viewIssues, assignments: viewAssignments,
  documents: viewDocuments, tasks: viewTasks, team: viewTeam, affaires: viewGroups, dossiers: viewGroups,
};

function renderChrome() {
  document.body.dataset.mode = mode;
  document.querySelectorAll("[data-mode]").forEach((b) => {
    const active = b.dataset.mode === mode;
    b.classList.toggle("active", active);
    b.setAttribute("aria-pressed", String(active));
  });
  $("ownerField").hidden = mode !== "coordo";
  $("headerSub").textContent = data ? `DEM ${activeDEM} · données au ${formatDate(data.today)}` : `DEM ${activeDEM}`;
  if (!data) return;
  $("sheetButtons").innerHTML = ["", ...new Set([...data.availableSheets, ...selectedSheets])].map((s) => {
    const active = s ? selectedSheets.has(s) : !selectedSheets.size;
    return `<button type="button" data-sheet="${esc(s)}" class="${active ? "active" : ""}${s ? " phase-" + dossierPhase({ sheet: s }) : ""}" aria-pressed="${active}"${s ? ` title="${esc(s)} · ${dossierPhase({ sheet: s }) === "AT" ? "AT (arrêt de tranche)" : "TEM"}"` : ""}>${esc(s || "Toutes")}${s && !data.availableSheets.includes(s) ? " (absente)" : ""}</button>`;
  }).join("");
  const main = TABS[mode].map((t) => {
    const active = t.id === tab || (t.id === "overview" && HIDDEN_TABS[mode].includes(tab));
    const count = t.count ? t.count() : null;
    return `<button type="button" data-tab="${t.id}" class="${active ? "active" : ""}" aria-current="${active ? "page" : "false"}">${esc(t.label)}${count ? ` <span class="count">${fmt(count)}</span>` : ""}</button>`;
  }).join("");
  const moreActive = MORE_TABS[mode].some((t) => t.id === tab);
  const more = `<select class="moreTabs${moreActive ? " active" : ""}" data-change="moreTab" aria-label="Autres listes">
      <option value="">${mode === "ce" ? "Mes listes…" : "Autres listes…"}</option>
      ${MORE_TABS[mode].map((t) => `<option value="${t.id}" ${t.id === tab ? "selected" : ""}>${esc(t.label)}</option>`).join("")}</select>`;
  $("tabs").innerHTML = main + more;
  // Filtres actifs : signalés sur le bouton « Filtres » repliable.
  const active = selectedSheets.size + (j0Period().label === String(+activeDEM) ? 0 : 1);
  $("filterCount").hidden = !active;
  $("filterCount").textContent = active;
}

function render() {
  if (!data) { renderChrome(); return; }
  const allowed = [...TABS[mode].map((t) => t.id), ...MORE_TABS[mode].map((t) => t.id), ...HIDDEN_TABS[mode]];
  if (!allowed.includes(tab)) tab = tabByMode[mode] = TABS[mode][0].id;
  visible = filtered();
  data.audit = audit(data.tasks.filter((t) => !t.cancelled));
  const inScope = new Set(visible);
  allIssues = data.audit.filter((i) => inScope.has(i.t));
  issues = allIssues.filter((i) => !ignoredIssues.has(issueId(i)));
  currentExport = null;
  currentRows = null;
  renderChrome();
  (VIEWS[tab] || viewTasks)();
  $("pdfExport").disabled = false;
  $("pngExport").disabled = false;
  $("csvExport").disabled = !currentExport;
  restoreTableFocus();
}

function detail(t) {
  const controls = (data.audit || []).filter((i) => i.t === t);
  $("detail").classList.remove("wideDialog");
  $("detailTitle").textContent = `${t.affaire || "Affaire manquante"} · REE ${t.ree || "absent"}`;
  $("detailBody").innerHTML = `<p class="detailIntro">${stateBadge(t)} <span class="muted">${esc(t.sheet)} · ligne ${t.rowNumber} · ${esc(t.responsable)}</span></p>
    ${t.libelle || t.reeLibelle ? `<p class="muted">${esc([t.libelle, t.reeLibelle].filter(Boolean).join(" — "))}</p>` : ""}
    <div class="detailGrid">${Object.keys(fields).map((k) => `<div class="${k === "observations" ? "full" : ""}"><span>${names[k]} <span class="loc">${esc(address(t, k))}</span></span><strong>${esc(t.raw[k] || "—")}</strong></div>`).join("")}
      <div><span>Échéance de préparation</span><strong>${t.prepDueLabel}</strong></div></div>
    <h3>Contrôles sur cette TOT</h3>
    ${controls.map((i) => `<div class="detailIssue">${badge(i.level, LEVEL_TONE[i.level])} <strong>${esc(i.kind)}</strong><p>${esc(i.reason)}</p><span class="loc">${esc(t.sheet)}!${esc(i.cells)}</span> ${ignoreButton(i)}</div>`).join("") || "<p class=\"muted\">Aucun signalement dans le périmètre actuel.</p>"}`;
  $("detail").dataset.task = t.index;
  if (!$("detail").open) $("detail").showModal();
}

// --- Navigation ---------------------------------------------------------------------

function go(spec) {
  const cut = spec.indexOf(":");
  const kind = cut < 0 ? spec : spec.slice(0, cut), arg = cut < 0 ? "" : spec.slice(cut + 1);
  if (kind === "tab") return setTab(arg);
  if (kind === "tasks") return openTasks(arg.split("|")[0]);
  if (kind === "issues") { tableState.issues = { search: "", open: false, filters: arg ? { [mode === "coordo" ? 4 : 3]: arg } : {} }; return openIssues(""); }
  if (kind === "issues-level") { tableState.issues = { search: "", open: false, filters: { 0: arg } }; showIgnored = false; return openIssues(""); }
  if (kind === "issues-owner") { if (mode === "coordo") $("owner").value = arg; issueKind = ""; issueLevel = ""; showIgnored = false; return setTab("issues"); }
  if (kind === "documents") { docCode = arg || "P"; documentType = ""; return setTab("documents"); }
  if (kind === "groups") { tab = tabByMode[mode] = arg; page = 1; return render(); }
}

const SETTABLE = {
  taskFocus: (v) => { taskFocus = v; },
  issueLevel: (v) => { issueLevel = v; },
  chargeMode: (v) => { chargeMode = v; },
  chargeSort: (v) => { chargeSort = v; },
  assignmentFilter: (v) => { assignmentFilter = v; },
  docCode: (v) => { docCode = v; },
  documentType: (v) => { documentType = v; },
  teamLateOwner: (v) => { teamLateOwner = v; },
};

function onClick(e) {
  document.querySelectorAll("details.menu[open]").forEach((m) => {
    if (!m.contains(e.target) || (e.target.closest("button") && !m.classList.contains("filterMenu"))) m.open = false;
  });
  const el = e.target.closest("button, [data-go]");
  if (!el || el.disabled) return;
  const d = el.dataset;
  if (d.task !== undefined) return detail(data.tasks[+d.task]);
  if (d.go !== undefined) { if ($("detail").open) $("detail").close(); return go(d.go); }
  if (d.set !== undefined) {
    const cut = d.set.indexOf(":"), key = d.set.slice(0, cut);
    if (SETTABLE[key]) { SETTABLE[key](d.set.slice(cut + 1)); page = 1; render(); }
    return;
  }
  if (d.ignore !== undefined) {
    e.stopPropagation();
    if (ignoredIssues.has(d.ignore)) ignoredIssues.delete(d.ignore); else ignoredIssues.add(d.ignore);
    render();
    if ($("detail").open && $("detail").dataset.task) detail(data.tasks[+$("detail").dataset.task]);
    return;
  }
  if (d.page !== undefined) { page += d.page === "next" ? 1 : -1; render(); $("view").scrollIntoView({ block: "start" }); return; }
  if (d.hide !== undefined) { if (hiddenOwners.has(d.hide)) hiddenOwners.delete(d.hide); else hiddenOwners.add(d.hide); return render(); }
  if (d.showAll !== undefined) { hiddenOwners.clear(); return render(); }
  if (d.expand !== undefined) { if (expandedAffaires.has(d.expand)) expandedAffaires.delete(d.expand); else expandedAffaires.add(d.expand); return render(); }
  if (d.expandAll !== undefined) {
    if (d.expandAll === "open") visible.forEach((t) => expandedAffaires.add(t.affaire)); else expandedAffaires.clear();
    return render();
  }
  if (d.export !== undefined) return currentExport?.();
  if (d.png !== undefined) return exportPNG();
  if (d.pngPreview !== undefined) return previewPNG();
  if (d.me !== undefined) return setMe(d.me);
  if (d.owner !== undefined) { $("owner").value = d.owner; page = 1; return render(); }
  if (d.ownerTasks !== undefined) { $("owner").value = d.ownerTasks; return openTasks(""); }
  if (d.tableToggle !== undefined) {
    const st = tableStateFor(d.tableToggle);
    st.open = !(st.open || st.search);
    if (!st.open) st.search = "";
    tableFocus = st.open ? d.tableToggle : null;
    page = 1;
    return render();
  }
  if (d.tableReset !== undefined) { tableState[d.tableReset] = { search: "", open: false, filters: {} }; tableFocus = null; page = 1; return render(); }
  if (d.toggleLate !== undefined) { showAllLate = !showAllLate; return render(); }
  if (d.toggleIgnored !== undefined) { showIgnored = !showIgnored; page = 1; return render(); }
  if (d.group !== undefined) return openGroup(+d.group);
  if (d.tab !== undefined) return setTab(d.tab);
  if (d.sheet !== undefined) return toggleSheet(d.sheet);
  if (d.mode !== undefined) return setMode(d.mode);
}

function onTableInput(e) {
  const key = e.target.dataset?.tableSearch;
  if (key === undefined) return;
  tableStateFor(key).search = e.target.value;
  tableFocus = key;
  page = 1;
  render();
}

function onChange(e) {
  const tf = e.target.dataset?.tableFilter;
  if (tf !== undefined) {
    const cut = tf.lastIndexOf(":");
    tableStateFor(tf.slice(0, cut)).filters[tf.slice(cut + 1)] = e.target.value;
    page = 1;
    return render();
  }
  const key = e.target.dataset?.change;
  if (key === "me") return setMe(e.target.value);
  if (key === "issueKind") { issueKind = e.target.value; page = 1; render(); }
  if (key === "moreTab" && e.target.value) setTab(e.target.value);
}

// --- Démarrage ----------------------------------------------------------------------

function init() {
  initTooltip();
  const prefs = readPrefs();
  if (TABS[prefs.mode]) mode = prefs.mode;
  me = typeof prefs.me === "string" ? prefs.me : "";
  tab = tabByMode[mode];
  selectedJ0Years.add(+activeDEM);
  updateJ0YearButtons();

  document.addEventListener("click", onClick);
  document.addEventListener("change", onChange);
  document.addEventListener("input", onTableInput);
  $("search").addEventListener("input", () => { page = 1; render(); });
  $("owner").addEventListener("change", () => { page = 1; render(); });
  document.querySelectorAll("[data-j0-year]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); toggleJ0Year(+b.dataset.j0Year); }));
  $("reset").onclick = resetFilters;
  $("clear").onclick = closeWorkbook;
  $("closeDetail").onclick = () => $("detail").close();
  $("detail").addEventListener("close", () => { delete $("detail").dataset.task; });
  $("pdfExport").onclick = exportPDF;
  $("pngExport").onclick = exportPNG;

  $("sourceChange").onclick = chooseSource;
  $("sourceRefresh").onclick = refreshSource;
  $("demSelector").onchange = (e) => switchDEM(e.target.value);
  $("autoRefresh").onchange = () => { lastScheduleSlot = scheduledSlot(); armSchedule(); };
  for (const id of ["choose", "import"]) $(id).onclick = chooseSource;
  $("file").onchange = (e) => manualImport(e.target.files[0]);
  document.addEventListener("dragover", (e) => { e.preventDefault(); $("drop").classList.add("over"); });
  document.addEventListener("dragleave", () => $("drop").classList.remove("over"));
  document.addEventListener("drop", (e) => { e.preventDefault(); $("drop").classList.remove("over"); manualImport(e.dataTransfer.files[0]); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkSchedule().finally(armSchedule); });
  window.addEventListener("focus", () => { checkSchedule().finally(armSchedule); });

  renderChrome();
  updateSourceControls();
  restoreSource();
}

init();
