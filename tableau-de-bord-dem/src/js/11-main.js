// =============================================================================
// Rendu, navigation et liaisons d'évènements.
// =============================================================================

const VIEWS = {
  mine: viewMine, cePilotage: viewCePilotage, overview: viewOverview, owners: viewOwners, issues: viewIssues, assignments: viewAssignments,
  documents: viewDocuments, cru: viewCRU, pilotage: viewPilotage, iop319: viewIOP, tasks: viewTasks, team: viewTeam, affaires: viewGroups, dossiers: viewGroups,
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
  const moreTabs = MORE_TABS[mode];
  const moreActive = moreTabs.some((t) => t.id === tab);
  const more = `<select class="moreTabs${moreActive ? " active" : ""}" data-change="moreTab" aria-label="Autres listes">
      <option value="">${mode === "ce" ? "Mes listes…" : "Autres listes…"}</option>
      ${moreTabs.map((t) => `<option value="${t.id}" ${t.id === tab ? "selected" : ""}>${esc(t.label)}</option>`).join("")}</select>`;
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
  alertIndexFor = null;
  const inScope = new Set(filteredLinesBy(ownerScope()));
  allIssues = data.audit.filter((i) => inScope.has(i.t));
  issues = allIssues.filter((i) => !ignoredIssues.has(issueId(i)));
  currentExport = null;
  currentRows = null;
  renderChrome();
  (VIEWS[tab] || viewTasks)();
  $("pdfExport").disabled = false;
  $("pngExport").disabled = false;
  $("pngRhythm").disabled = false;
  $("pngExport").textContent = pngMenuLabel();
  $("csvExport").disabled = !currentExport;
  $("view").insertAdjacentHTML("afterbegin", backBar());
  $("view").querySelectorAll("tbody tr:not(.subRow)").forEach((tr) => {
    if (tr.querySelector("[data-expand], [data-task], [data-group], [data-owner-tasks], [data-go]")) tr.classList.add("rowLink");
  });
  renderActiveFilters();
  restoreTableFocus();
  positionColMenus();
}

// Fiche en lecture : seuls les champs renseignés, sans adresse de cellule (réservée à « Modifier »).
// Les quatre jalons sont dans la frise au-dessus.
function detailFields(t) {
  const keys = Object.keys(fields).filter((k) => !MILESTONES.some(([m]) => m === k));
  const filled = keys.filter((k) => String(t.raw[k] ?? "").trim()), empty = keys.filter((k) => !filled.includes(k));
  return `<div class="detailGrid">${filled.map((k) => `<div${alertAttr(t, k, k === "observations" ? "full" : "")}><span>${k === "j0" && t.j0Cru ? "J0 de la DEM (remplacé par la CRU)" : names[k]}</span><strong>${esc(t.raw[k])}</strong></div>`).join("")}
      ${t.j0Cru ? `<div><span>Date début calculée TOT (CRU)</span><strong>${formatDate(t.j0Cru)}</strong></div>` : ""}
      <div><span>Échéance de préparation${t.j0Cru ? " (début CRU − 30 j)" : ""}</span><strong>${t.prepDueLabel}</strong></div></div>
    ${empty.length ? `<p class="muted detailEmpty">Non renseigné : ${empty.map((k) => `<span${alertAttr(t, k)}>${esc(names[k])}</span>`).join(", ")}</p>` : ""}`;
}

function detail(t) {
  const controls = (data.audit || []).filter((i) => i.t === t);
  $("detail").classList.remove("wideDialog");
  $("detailTitle").textContent = `${t.affaire || "Affaire manquante"} · REE ${t.ree || "absent"}`;
  $("detailBody").innerHTML = editConfirm ? editConfirmPanel(t) : editMode ? editForm(t) : `<p class="detailIntro">${stateBadge(t)} <span class="muted">${esc(t.sheet)} · ligne ${t.rowNumber} · ${esc(t.responsable)}</span> ${toolLinks(t.ot, t.tot)} ${excelMode ? `<button type="button" class="editStart" data-edit-start="${t.index}">Modifier cette ligne</button>` : ""} <button type="button" class="editStart" data-pdg="${t.index}" title="Remplit le modèle PdG_Type à partir de la feuille CRU">Page de garde</button></p>
    <p id="pdgNote" hidden></p>
    ${excelMode ? "" : '<p class="muted detailEmpty">Lecture seule : pour modifier la DEM, ouvrez le tableau de bord dans le volet Excel.</p>'}
    ${t.libelle || t.reeLibelle ? `<p class="muted">${esc([t.libelle, t.reeLibelle].filter(Boolean).join(" — "))}</p>` : ""}
    ${milestoneTrack(t)}
    ${detailFields(t)}
    <h3>Contrôles sur cette TOT</h3>
    ${controls.map((i) => `<div class="detailIssue">${badge(i.level, LEVEL_TONE[i.level])} <strong>${esc(i.kind)}</strong><p>${esc(i.reason)}</p><span class="loc">${esc(t.sheet)}!${esc(i.cells)}</span> ${ignoreButton(i)}</div>`).join("") || "<p class=\"muted\">Aucun signalement dans le périmètre actuel.</p>"}`;
  $("detail").dataset.task = t.index;
  if (!$("detail").open) $("detail").showModal();
}

// --- Navigation ---------------------------------------------------------------------

// --- Historique : bouton « ‹ Retour » vers l'écran précédent -------------------------
const navStack = [];

function viewLabel() {
  const t = [...TABS[mode], ...MORE_TABS[mode]].find((x) => x.id === tab);
  if (tab === "tasks") return taskTitle();
  if (tab === "affaires") return "Affaires";
  if (tab === "dossiers") return "REE";
  return t ? t.label : "écran précédent";
}

function pushNav() {
  navStack.push({ mode, tab, taskFocus, taskScope, docCode, page, owner: $("owner").value, sheets: [...selectedSheets], tables: JSON.stringify(tableState), label: viewLabel(), scroll: window.scrollY });
  if (navStack.length > 30) navStack.shift();
}

function goBack() {
  const s = navStack.pop();
  if (!s) return;
  mode = s.mode; tab = tabByMode[mode] = s.tab; taskFocus = s.taskFocus; taskScope = s.taskScope; docCode = s.docCode; page = s.page;
  $("owner").value = s.owner;
  selectedSheets.clear();
  (s.sheets || []).forEach((x) => selectedSheets.add(x));
  for (const k of Object.keys(tableState)) delete tableState[k];
  Object.assign(tableState, JSON.parse(s.tables));
  render();
  window.scrollTo(0, s.scroll || 0);
}

function backBar() {
  const prev = navStack[navStack.length - 1];
  return prev ? `<div class="backBar"><button type="button" class="backButton" data-back>‹ Retour à « ${esc(prev.label)} »</button></div>` : "";
}

function go(spec) {
  const cut = spec.indexOf(":");
  const kind = cut < 0 ? spec : spec.slice(0, cut), arg = cut < 0 ? "" : spec.slice(cut + 1);
  if (kind === "tab") return setTab(arg);
  if (kind === "tasks") return openTasks(arg.split("|")[0]);
  if (kind === "issues") { tableState.issues = { search: "", open: false, filters: arg ? { [mode === "coordo" ? 4 : 3]: [arg] } : {} }; return openIssues(""); }
  if (kind === "issues-level") { tableState.issues = { search: "", open: false, filters: { 0: [arg] } }; showIgnored = false; return openIssues(""); }
  if (kind === "issues-owner") { if (mode === "coordo") $("owner").value = arg; issueKind = ""; issueLevel = ""; showIgnored = false; return setTab("issues"); }
  if (kind === "documents") { docCode = arg || "P"; documentType = ""; return setTab("documents"); }
  if (kind === "groups") { tab = tabByMode[mode] = arg; page = 1; return render(); }
  if (kind === "in") {
    // Depuis le pilotage par tranche : la liste ouverte est limitée à cette feuille.
    const sep = arg.indexOf(":");
    selectedSheets.clear();
    selectedSheets.add(arg.slice(0, sep));
    return go(arg.slice(sep + 1));
  }
  if (kind === "docs") {
    const [code, key] = arg.split("|");
    docCode = code || "P"; documentType = "";
    const docCol = showOwnerColumn() ? 2 : 1;
    tableState["documents-" + docCode] = { search: "", open: false, filters: key ? { [docCol]: [names[key]] } : {} };
    return setTab("documents");
  }
  if (kind === "affaire") { expandedAffaires.add(arg); return setTab("mine"); }
  if (kind === "owner-tasks") { $("owner").value = arg; return openTasks(""); }
  if (kind === "iop") { iopCheck = arg; tab = tabByMode[mode] = IOP_TAB; page = 1; return render(); }
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
  iopCheck: (v) => { iopCheck = v; },
  cepGelWindow: (v) => { cepGelWindow = v; },
  cepBpaWindow: (v) => { cepBpaWindow = v; },
};

function onClick(e) {
  document.querySelectorAll("details.menu[open]").forEach((m) => {
    if (!m.contains(e.target) || (e.target.closest("button") && !m.classList.contains("filterMenu") && !m.classList.contains("colMenu"))) m.open = false;
  });
  const col = e.target.closest?.(".colMenu");
  if (!col) openColFilter = null;
  else if (e.target.closest("summary")) openColFilter = col.open ? null : col.dataset.colMenu;
  // Ligne de tableau entièrement cliquable : déclenche l'action principale de la ligne.
  if (!e.target.closest("button, a, input, select, label, summary, details")) {
    const tr = e.target.closest("tr.rowLink");
    const main = tr?.querySelector("[data-expand], [data-task], [data-group], [data-owner-tasks], [data-go]");
    if (main) { main.click(); return; }
  }
  const el = e.target.closest("button, [data-go]");
  if (!el || el.disabled) return;
  const d = el.dataset;
  if (d.task !== undefined) { resetEdit(); return detail(data.tasks[+d.task]); }
  if (editAction(d)) return;
  if (pdgAction(d)) return;
  if (d.back !== undefined) return goBack();
  if (d.go !== undefined) { if ($("detail").open) $("detail").close(); pushNav(); return go(d.go); }
  if (d.set !== undefined) {
    const cut = d.set.indexOf(":"), key = d.set.slice(0, cut);
    if (SETTABLE[key]) { SETTABLE[key](d.set.slice(cut + 1)); page = 1; render(); }
    return;
  }
  if (d.clearFilter !== undefined) { clearFilter(d.clearFilter); return; }
  if (d.ignore !== undefined) {
    e.stopPropagation();
    if (ignoredIssues.has(d.ignore)) ignoredIssues.delete(d.ignore); else ignoredIssues.add(d.ignore);
    alertIndexFor = null;
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
  if (d.png !== undefined) return exportPNG(d.png);
  if (d.pngPreview !== undefined) return previewPNG(d.pngPreview);
  if (d.me !== undefined) return setMe(d.me);
  if (d.owner !== undefined) { $("owner").value = d.owner; page = 1; return render(); }
  if (d.ownerTasks !== undefined) { pushNav(); $("owner").value = d.ownerTasks; return openTasks(""); }
  if (d.tableToggle !== undefined) {
    const st = tableStateFor(d.tableToggle);
    st.open = !(st.open || st.search);
    if (!st.open) st.search = "";
    tableFocus = st.open ? d.tableToggle : null;
    page = 1;
    return render();
  }
  if (d.tableClear !== undefined) {
    const cut = d.tableClear.lastIndexOf(":");
    tableStateFor(d.tableClear.slice(0, cut)).filters[d.tableClear.slice(cut + 1)] = [];
    openColFilter = null;
    page = 1;
    return render();
  }
  if (d.tableReset !== undefined) { tableState[d.tableReset] = { search: "", open: false, filters: {} }; tableFocus = null; page = 1; return render(); }
  if (d.ecu !== undefined) return toggleEcu(d.ecu);
  if (d.pilotSheet !== undefined) return togglePilotSheet(d.pilotSheet);
  if (d.sheetOnly !== undefined) { selectedSheets.clear(); selectedSheets.add(d.sheetOnly); page = 1; return render(); }
  if (d.iopImport !== undefined) return $("iopFile").click();
  if (d.iopClear !== undefined) { iop = null; tableState.iop = { search: "", open: false, filters: {} }; $("message").innerHTML = ""; page = 1; return render(); }
  if (d.iopStatut !== undefined) return toggleIopChip("statut", d.iopStatut);
  if (d.iopEcu !== undefined) return toggleIopChip("ecu", d.iopEcu);
  if (d.cruHideInactive !== undefined) return toggleHideInactiveCru();
  if (d.cruShowDone !== undefined) { showDoneCru = !showDoneCru; page = 1; return render(); }
  if (d.toggleLate !== undefined) { showAllLate = !showAllLate; return render(); }
  if (d.toggleIgnored !== undefined) { showIgnored = !showIgnored; page = 1; return render(); }
  if (d.group !== undefined) { pushNav(); return openGroup(+d.group); }
  if (d.tab !== undefined) { navStack.length = 0; return setTab(d.tab); }
  if (d.sheet !== undefined) return toggleSheet(d.sheet);
  if (d.mode !== undefined) { navStack.length = 0; return setMode(d.mode); }
}

function onTableInput(e) {
  const key = e.target.dataset?.tableSearch;
  if (key === undefined) return;
  tableStateFor(key).search = e.target.value;
  tableFocus = key;
  page = 1;
  render();
}

// Un menu ouvert près d'un bord (volet Excel étroit, barre d'outils repliée à gauche)
// est décalé pour rester entièrement dans la fenêtre.
function keepMenuInView(e) {
  const menu = e.target;
  if (!menu.matches?.("details.menu") || !menu.open) return;
  const body = menu.querySelector(".menuBody"), width = document.documentElement.clientWidth, margin = 8;
  if (!body) return;
  body.style.transform = "";
  body.style.maxWidth = `${width - 2 * margin}px`;
  const r = body.getBoundingClientRect();
  const dx = r.left < margin ? margin - r.left : r.right > width - margin ? width - margin - r.right : 0;
  if (dx) body.style.transform = `translateX(${Math.round(dx)}px)`;
}

function onChange(e) {
  if (e.target.dataset.msChoice) { milestoneChoice[e.target.dataset.msChoice] = e.target.value; return detail(data.tasks[+$("detail").dataset.task]); }
  if (e.target.dataset?.cruDone !== undefined) { setCruDone(e.target.dataset.cruDone, e.target.checked); return render(); }
  const tc = e.target.dataset?.tableCheck;
  if (tc !== undefined) {
    const cut = tc.lastIndexOf(":"), st = tableStateFor(tc.slice(0, cut)), col = tc.slice(cut + 1);
    const set = new Set(st.filters[col] || []);
    if (e.target.checked) set.add(e.target.value); else set.delete(e.target.value);
    st.filters[col] = [...set];
    openColFilter = tc;
    page = 1;
    return render();
  }
  const key = e.target.dataset?.change;
  if (key === "me") return setMe(e.target.value);
  if (key === "issueKind") { issueKind = e.target.value; page = 1; render(); }
  if (key === "moreTab" && e.target.value) { navStack.length = 0; setTab(e.target.value); }
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
  // « toggle » ne remonte pas : écoute en capture.
  document.addEventListener("toggle", keepMenuInView, true);
  document.addEventListener("input", onTableInput);
  document.addEventListener("toggle", (e) => { if (e.target.classList?.contains("colMenu")) positionColMenus(); }, true);
  window.addEventListener("resize", positionColMenus);
  document.addEventListener("scroll", (e) => { if (!e.target.closest?.(".colMenuBody")) positionColMenus(); }, true);
  $("search").addEventListener("input", () => { page = 1; render(); });
  $("owner").addEventListener("change", () => { page = 1; render(); });
  document.querySelectorAll("[data-j0-year]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); toggleJ0Year(+b.dataset.j0Year); }));
  $("reset").onclick = resetFilters;
  $("clear").onclick = closeWorkbook;
  $("closeDetail").onclick = () => $("detail").close();
  // L'évènement arrive en différé : ignoré si la fiche a été rouverte entre-temps (après une écriture).
  $("detail").addEventListener("close", () => { if ($("detail").open) return; delete $("detail").dataset.task; resetEdit(); });
  $("pdfExport").onclick = exportPDF;
  $("pngExport").onclick = () => exportPNG();
  $("pngRhythm").onclick = () => exportPNG("rythme");

  $("sourceChange").onclick = chooseSource;
  $("sourceRefresh").onclick = refreshSource;
  $("demSelector").onchange = (e) => switchDEM(e.target.value);
  $("autoRefresh").onchange = () => { lastScheduleSlot = scheduledSlot(); armSchedule(); };
  for (const id of ["choose", "import"]) $(id).onclick = chooseSource;
  $("reopen").onclick = refreshSource;
  $("file").onchange = (e) => manualImport(e.target.files[0]);
  $("iopFile").onchange = (e) => importIOP(e.target.files[0]);
  document.addEventListener("dragover", (e) => { e.preventDefault(); $("drop").classList.add("over"); });
  document.addEventListener("dragleave", () => $("drop").classList.remove("over"));
  document.addEventListener("drop", (e) => {
    e.preventDefault(); $("drop").classList.remove("over");
    const f = e.dataTransfer.files[0], isIOP = /IOP\s*[-_]?\s*319/i.test(f?.name || "");
    // Export IOP319 : glissé sur sa vue, ou reconnu à son nom. Il nécessite une DEM ouverte.
    if (f && data && ((mode === "coordo" && tab === IOP_TAB) || isIOP)) { openIOP(); return importIOP(f); }
    if (isIOP) { $("message").innerHTML = `<div class="notice">Ouvrez d’abord la DEM, puis déposez l’export IOP319 (profil Coordo essais › Autres listes › Contrôle 1N / TSR).</div>`; return; }
    manualImport(f);
  });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkSchedule().finally(armSchedule); });
  window.addEventListener("focus", () => { checkSchedule().finally(armSchedule); });

  renderChrome();
  updateSourceControls();
  loadPdgTemplate();
  // Version complément : office.js est chargé ; dans Excel, la DEM ouverte remplace le fichier.
  if (window.Office?.onReady) Office.onReady((info) => (info?.host === Office.HostType.Excel ? startExcel() : restoreSource()));
  else restoreSource();
}

init();
