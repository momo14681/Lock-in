// =============================================================================
// Chargement du classeur et fichier source mémorisé (repris de la V1.3).
// Le fichier reste sur ce PC, dans ce profil de navigateur : jamais modifié.
// =============================================================================

function fillOwnerSelect(selected = "") {
  const owners = ownersList();
  if (selected && !owners.includes(selected)) owners.push(selected);
  $("owner").innerHTML = `<option value="">Tous les CE</option>` + owners.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
  $("owner").value = selected;
}

// Lecture du classeur dans un Worker (fil séparé) : sur une grosse DEM, la lecture prend
// plusieurs secondes et le navigateur affichait « Cette page ne répond pas ». Si le Worker
// est indisponible, lecture directe comme avant.
const WORKBOOK_OPTIONS = { type: "array", cellDates: true, cellFormula: true, sheets: [...TECHNICAL_SHEETS, IPE_SHEET, CRU_SHEET, "Pilotage", "Préparation"] };
// Le Worker ne renvoie que l'utile (valeur, type, formule de Pilotage / Préparation, texte des
// erreurs) : la recopie vers la page est d'autant plus courte.
const WORKER_HANDLER = `
;onmessage = (e) => {
  try {
    const wb = XLSX.read(e.data.bytes, e.data.options), sheets = {};
    for (const [name, sh] of Object.entries(wb.Sheets)) {
      const keepFormula = name === "Pilotage" || name === "Préparation", out = {};
      for (const key in sh) {
        const c = sh[key];
        if (key[0] === "!") { out[key] = c; continue; }
        const slim = { t: c.t, v: c.v };
        if (c.t === "e" && c.w) slim.w = c.w;
        if (keepFormula && c.f) slim.f = c.f;
        out[key] = slim;
      }
      sheets[name] = out;
    }
    postMessage({ ok: true, wb: { SheetNames: wb.SheetNames, Sheets: sheets } });
  } catch (err) { postMessage({ ok: false, error: String((err && err.message) || err) }); }
};`;

function readWorkbook(bytes) {
  const direct = () => XLSX.read(bytes, WORKBOOK_OPTIONS);
  const lib = document.getElementById("xlsxLib")?.textContent;
  if (!lib || typeof Worker === "undefined") return Promise.resolve().then(direct);
  return new Promise((resolve, reject) => {
    let url = "", worker = null, settled = false;
    const finish = (fn) => { if (settled) return; settled = true; worker?.terminate(); if (url) URL.revokeObjectURL(url); fn(); };
    const fallback = () => finish(() => { try { resolve(direct()); } catch (e) { reject(e); } });
    try {
      url = URL.createObjectURL(new Blob([lib, WORKER_HANDLER], { type: "text/javascript" }));
      worker = new Worker(url);
    } catch (e) { fallback(); return; }
    worker.onmessage = (e) => finish(() => (e.data?.ok ? resolve(e.data.wb) : reject(Error(e.data?.error || "Lecture du classeur impossible."))));
    worker.onerror = (e) => { e.preventDefault?.(); fallback(); };
    worker.onmessageerror = fallback;
    worker.postMessage({ bytes, options: WORKBOOK_OPTIONS });
  });
}

async function load(file, { preserveView = false, resetIgnored = true } = {}) {
  if (!file || busy) return false;
  const previousOwner = $("owner").value;
  busy = true;
  updateSourceControls();
  $("message").innerHTML = '<div class="notice">Lecture du classeur et vérification des données…</div>';
  try {
    if (!/\.(xlsx|xlsm)$/i.test(file.name)) throw Error("Choisissez le fichier Excel .xlsm ou .xlsx, pas un raccourci .url.");
    const bytes = await file.arrayBuffer();
    await new Promise((r) => setTimeout(r, 30));
    // Une seule lecture du classeur (auparavant deux), hors du fil de la page si possible.
    const wb = await readWorkbook(bytes);
    const result = await parseWorkbook(wb, file);
    result.ipe = readAssignments(wb.Sheets[IPE_SHEET]);
    for (const [i, t] of result.tasks.entries()) {
      if (i % 3000 === 2999) await pauseForPaint();
      const sheet = wb.Sheets[t.sheet];
      t.merges = sheet["!merges"] || [];
      t.cells = {};
      t.raw = {};
      for (const k of Object.keys(fields)) {
        const loc = address(t, k).split(":")[0], cell = sheet[loc], v = cell && cell.t !== "e" ? normalizeStatus(k, cell.v) : cell?.v;
        const c = v === cell?.v ? cell : { t: "s", v };
        t.cells[k] = c;
        t.raw[k] = c?.t === "e" ? (c.w || "Erreur Excel") : c?.v instanceof Date ? formatDate(c.v) : String(c?.v ?? "");
      }
    }
    await pauseForPaint();
    result.tasks.forEach(applyMissingInfo);
    if (!result.tasks.length) throw Error("Aucune TOT exploitable trouvée dans les feuilles techniques.");
    // Colonnes attendues : refuser un modèle décalé plutôt que publier des indicateurs faux.
    for (const name of result.availableSheets) {
      const sh = wb.Sheets[name];
      for (const [col, pattern] of [["D", /REE|PEE/i], ["J", /^OT$/i], ["K", /^TOT$/i], ["O", /J\s*0/i]]) {
        const v = String(sh[col + "1"]?.v || "").trim();
        if (!pattern.test(v)) throw Error(`Structure non reconnue : ${name}!${col}1 (« ${v} »). Le tableau de bord attend le modèle DEM actuel.`);
      }
    }
    const liveCounts = new Map();
    for (const t of result.tasks.filter((x) => !x.cancelled)) liveCounts.set(t.id, (liveCounts.get(t.id) || 0) + 1);
    result.tasks.forEach((t, i) => { t.duplicate = !t.cancelled && (liveCounts.get(t.id) || 0) > 1; t.index = i; });
    await pauseForPaint();
    result.cru = readCRU(wb.Sheets[CRU_SHEET]);
    result.projectCodes = readProjectCodes(wb.Sheets.Pilotage, wb.Sheets["Préparation"]);
    await pauseForPaint();
    linkCRU(result.cru, result.tasks.filter((t) => !t.cancelled));
    await pauseForPaint();

    data = result;
    data.fileName = file.name;
    if (!preserveView) {
      selectedSheets.clear();
      assignmentFilter = "missing"; page = 1; issueKind = ""; issueLevel = ""; documentType = ""; docCode = "P";
      showIgnored = false; taskFocus = ""; taskScope = null; teamLateOwner = "";
      expandedAffaires.clear();
      $("search").value = "";
    }
    if (resetIgnored) ignoredIssues.clear();
    fillOwnerSelect(preserveView ? previousOwner : "");
    if ($("detail").open) $("detail").close();
    $("workspace").classList.remove("hidden");
    $("drop").classList.add("hidden");
    $("source").textContent = `${file.name} · ${fmt(data.tasks.filter((t) => !t.cancelled).length)} TOT hors annulées · ${data.availableSheets.length} feuilles · importé le ${formatFrenchDateTime(data.analyzedAt)} · copie enregistrée le ${formatFrenchDateTime(new Date(file.lastModified))}.`;
    $("message").innerHTML = data.missingSheets.length ? `<div class="notice">Import partiel : feuilles absentes ${esc(data.missingSheets.join(", "))}. Les indicateurs couvrent uniquement les feuilles présentes.</div>` : "";
    render();
    return true;
  } catch (e) {
    $("message").innerHTML = `<div class="notice error">${esc(e.message)}${data ? " Le dernier import réussi reste affiché." : ""}</div>`;
    return false;
  } finally {
    busy = false;
    $("file").value = "";
    updateSourceControls();
  }
}

// --- Fichier mémorisé, profils DEM 2026 / 2027, lecture automatique --------------

const SOURCE_DB = "dem-coordos-local-v1", SOURCE_STORE = "preferences";
const SCHEDULE_ZONE = "Europe/Paris";
let sourceHandle = null, sourceRemembered = false, sourcePermission = "prompt", sourceStatus = "Choisissez le fichier Excel à mémoriser sur ce PC.";
let sourceSelecting = false, sourceReading = false, sourcePaused = false, sourceEpoch = 0, sourceStamp = null, lastChecked = null, lastScheduleSlot = "", scheduleTimer = null;
let activeDEM = "2026", profileSwitching = false, currentSessionFile = null;
const demProfiles = new Map();

function snapshotProfile() {
  tabByMode[mode] = tab;
  demProfiles.set(activeDEM, {
    handle: sourceHandle, remembered: sourceRemembered, permission: sourcePermission, status: sourceStatus, paused: sourcePaused, stamp: sourceStamp,
    lastChecked, lastScheduleSlot, auto: $("autoRefresh").checked, sessionFile: currentSessionFile, data,
    view: {
      tabByMode: { ...tabByMode }, page, issueKind, issueLevel, documentType, docCode, showIgnored, taskFocus, taskScope, chargeMode, chargeSort, assignmentFilter, teamLateOwner,
      sheets: [...selectedSheets], years: [...selectedJ0Years], hiddenOwners: [...hiddenOwners], ignored: [...ignoredIssues], expanded: [...expandedAffaires],
      owner: $("owner").value, search: $("search").value, sourceText: $("source").textContent, message: $("message").innerHTML,
    },
  });
}

function applyProfile(profile) {
  const p = profile || {}, v = p.view || {};
  sourceHandle = p.handle || null; sourceRemembered = !!p.remembered; sourcePermission = p.permission || "prompt";
  sourceStatus = p.status || `Choisissez le fichier DEM ${activeDEM} à mémoriser sur ce PC.`;
  sourcePaused = !!p.paused; sourceStamp = p.stamp || null; lastChecked = p.lastChecked || null; lastScheduleSlot = p.lastScheduleSlot || "";
  currentSessionFile = p.sessionFile || null; $("autoRefresh").checked = p.auto !== false;
  data = p.data || null;
  Object.assign(tabByMode, { ce: "mine", coordo: "overview" }, v.tabByMode || {});
  tab = tabByMode[mode];
  page = v.page || 1; issueKind = v.issueKind || ""; issueLevel = v.issueLevel || ""; documentType = v.documentType || ""; docCode = v.docCode || "P";
  showIgnored = !!v.showIgnored; taskFocus = v.taskFocus || ""; taskScope = v.taskScope || null;
  chargeMode = v.chargeMode || "tasks"; chargeSort = v.chargeSort || "total"; assignmentFilter = v.assignmentFilter ?? "missing"; teamLateOwner = v.teamLateOwner || "";
  for (const [set, values] of [[selectedSheets, v.sheets || []], [selectedJ0Years, v.years || [+activeDEM]], [hiddenOwners, v.hiddenOwners || []], [ignoredIssues, v.ignored || []], [expandedAffaires, v.expanded || []]]) {
    set.clear();
    values.forEach((x) => set.add(x));
  }
  fillOwnerSelect(v.owner || "");
  $("search").value = v.search || "";
  allIssues = []; issues = []; visible = [];
  $("source").textContent = v.sourceText || "";
  $("message").innerHTML = v.message || "";
  $("demSelector").value = activeDEM;
  updateJ0YearButtons();
  if ($("detail").open) $("detail").close();
  $("workspace").classList.toggle("hidden", !data);
  $("drop").classList.toggle("hidden", !!data);
  $("view").innerHTML = "";
  $("pdfExport").disabled = !data;
  $("pngExport").disabled = !data;
  $("pngRhythm").disabled = !data;
  renderChrome();
  if (data) render();
  updateSourceControls();
}

function checkDEMFile(file) {
  const match = file.name.match(/DEM[\s_-]*(2026|2027)\b/i);
  if (match && match[1] !== activeDEM) throw Error(`Le fichier sélectionné concerne DEM ${match[1]}. Choisissez DEM ${activeDEM} ou changez le sélecteur en haut à droite.`);
}

async function activateProfileSource() {
  if (!sourceHandle) { armSchedule(); return true; }
  profileSwitching = true;
  updateSourceControls();
  try {
    sourcePermission = await sourceHandle.queryPermission({ mode: "read" });
    sourceStatus = sourcePermission === "granted" ? "Vérification du fichier…" : "Fichier mémorisé · cliquez sur Rouvrir pour autoriser sa lecture.";
  } catch (e) {
    sourcePermission = "prompt";
    sourceStatus = "Fichier mémorisé · cliquez sur Rouvrir pour autoriser sa lecture.";
  } finally {
    profileSwitching = false;
    updateSourceControls();
  }
  if (sourcePermission === "granted") return readSource();
  armSchedule();
  return false;
}

async function switchDEM(year) {
  if (!["2026", "2027"].includes(String(year)) || busy || sourceSelecting || sourceReading || profileSwitching) { $("demSelector").value = activeDEM; return false; }
  if (String(year) === activeDEM) return true;
  snapshotProfile(); stopSchedule(); sourceEpoch++;
  activeDEM = String(year);
  profileSwitching = true;
  applyProfile(demProfiles.get(activeDEM));
  try { await storedSource("put", activeDEM, "activeDEM"); } catch (e) { /* La sélection de fichier reste possible pour cette session. */ }
  finally { profileSwitching = false; updateSourceControls(); }
  await activateProfileSource();
  return true;
}

async function refreshSource() {
  if (busy || sourceReading || sourceSelecting || profileSwitching) return false;
  if (sourceHandle) return authorizeSource();
  if (currentSessionFile) {
    const ok = await load(currentSessionFile, { preserveView: !!data, resetIgnored: false });
    if (ok) { lastChecked = new Date(); sourceStatus = "Import manuel · fichier disponible pour cette session."; }
    updateSourceControls();
    return ok;
  }
  return chooseSource();
}

const persistentPicker = typeof window.showOpenFilePicker === "function";
const parisFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: SCHEDULE_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
function parisParts(date) {
  const p = Object.fromEntries(parisFormatter.formatToParts(date).map((x) => [x.type, x.value]));
  return { year: +p.year, month: +p.month, day: +p.day, minutes: +p.hour * 60 + +p.minute, key: `${p.year}-${p.month}-${p.day}` };
}
// Lecture automatique toutes les 30 minutes, de 7 h à 20 h (heure de Paris).
function scheduledSlot(now = new Date()) {
  const p = parisParts(now);
  if (p.minutes < 420 || p.minutes > 1200) return "";
  return `${p.key}/${Math.floor(p.minutes / 30) * 30}`;
}
function parisInstant(year, month, day, minutes) {
  const target = Date.UTC(year, month - 1, day, Math.floor(minutes / 60), minutes % 60);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const p = parisParts(new Date(guess)), shown = Date.UTC(p.year, p.month - 1, p.day, Math.floor(p.minutes / 60), p.minutes % 60);
    guess += target - shown;
  }
  return new Date(guess);
}
function nextScheduledRead(now = new Date()) {
  const p = parisParts(now);
  if (p.minutes < 420) return parisInstant(p.year, p.month, p.day, 420);
  if (p.minutes < 1200) return parisInstant(p.year, p.month, p.day, (Math.floor(p.minutes / 30) + 1) * 30);
  const tomorrow = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  return parisInstant(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate(), 420);
}
function sourceTime(date) {
  return new Intl.DateTimeFormat("fr-FR", { timeZone: SCHEDULE_ZONE, dateStyle: "short", timeStyle: "short" }).format(date);
}
function fileStamp(file) {
  return JSON.stringify([file.name, file.size, file.lastModified, parisParts(new Date()).key]);
}
function sourceDB() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) { reject(Error("Mémorisation indisponible")); return; }
    const request = window.indexedDB.open(SOURCE_DB, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(SOURCE_STORE)) request.result.createObjectStore(SOURCE_STORE); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || Error("Mémorisation refusée"));
    request.onblocked = () => reject(Error("Mémorisation bloquée"));
  });
}
async function storedSource(operation, handle, key = "source:" + activeDEM) {
  const db = await sourceDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(SOURCE_STORE, operation === "get" ? "readonly" : "readwrite"), store = tx.objectStore(SOURCE_STORE);
      let result = null;
      const request = operation === "get" ? store.get(key) : operation === "put" ? store.put(handle, key) : store.delete(key);
      request.onsuccess = () => { result = request.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || Error("Mémorisation refusée"));
      tx.onabort = () => reject(tx.error || Error("Mémorisation interrompue"));
    });
  } finally {
    db.close();
  }
}

function updateSourceControls() {
  const working = busy || sourceSelecting || sourceReading || profileSwitching;
  $("sourceFile").textContent = sourceHandle?.name || data?.fileName || `DEM ${activeDEM} · aucun fichier sélectionné`;
  $("demSelector").value = activeDEM;
  $("demSelector").disabled = working;
  $("sourceState").textContent = sourceStatus;
  $("sourceChange").textContent = sourceHandle || currentSessionFile ? "Changer le fichier" : `Choisir DEM ${activeDEM}`;
  $("sourceChange").disabled = working;
  $("sourceRefresh").disabled = working || (!sourceHandle && !currentSessionFile);
  $("autoRefresh").disabled = !sourceHandle;
  const active = sourceHandle && sourcePermission === "granted" && !sourcePaused && $("autoRefresh").checked;
  $("sourceSchedule").textContent = active ? `Prochaine lecture : ${sourceTime(nextScheduledRead())}`
    : sourcePaused ? "Lecture automatique en pause"
    : sourceHandle && sourcePermission !== "granted" ? "Lecture automatique suspendue : autorisation requise"
    : sourceHandle ? "Lecture automatique désactivée" : "Lecture automatique : sélectionnez un fichier";
  $("sourceLastCheck").textContent = lastChecked ? `· vérifié le ${sourceTime(lastChecked)}` : "";
  $("sourceDot").className = "sourceDot " + (working ? "busy" : active ? "ok" : data ? "idle" : "off");
  for (const id of ["import", "choose", "clear", "reopen"]) $(id).disabled = working;
  updateDropPanel(working);
}

// Écran d'accueil : la DEM mémorisée se rouvre en un clic (le navigateur exige ce clic
// pour autoriser de nouveau la lecture ; inutile de rechercher le fichier).
function updateDropPanel(working) {
  const h = sourceHandle;
  $("reopen").hidden = !h;
  if (h) $("reopen").textContent = working ? "Lecture en cours…" : `Rouvrir ${h.name}`;
  $("choose").className = h ? "" : "primary";
  $("choose").textContent = h ? "Choisir un autre fichier" : `Choisir le fichier Excel de la DEM ${activeDEM}`;
  $("dropTitle").textContent = h ? `DEM ${activeDEM} mémorisée sur ce PC` : `Ouvrez la DEM ${activeDEM} pour commencer`;
  $("dropText").textContent = h
    ? (sourcePermission === "granted" ? "Le fichier est mémorisé : cliquez pour le relire." : "Le fichier est mémorisé : un clic suffit pour autoriser de nouveau sa lecture, inutile de le rechercher.")
    : "Le fichier reste sur ce PC : il est lu, jamais modifié ni envoyé. Il sera mémorisé pour les prochaines ouvertures.";
  const hint = h ? "Si le navigateur propose « Autoriser à chaque visite », choisissez-le : la DEM s’ouvrira alors toute seule." : !persistentPicker ? "Ce navigateur ne permet pas de mémoriser le fichier : utilisez Edge ou Chrome." : "";
  $("dropHint").textContent = hint;
  $("dropHint").hidden = !hint;
}

function stopSchedule() {
  if (scheduleTimer !== null) clearTimeout(scheduleTimer);
  scheduleTimer = null;
}
function armSchedule() {
  stopSchedule();
  updateSourceControls();
  if (!sourceHandle || sourcePermission !== "granted" || sourcePaused || !$("autoRefresh").checked) return;
  const delay = Math.min(60000, Math.max(1000, nextScheduledRead().getTime() - Date.now()));
  scheduleTimer = setTimeout(async () => { scheduleTimer = null; await checkSchedule(); armSchedule(); }, delay);
}
async function checkSchedule(now = new Date()) {
  if (!sourceHandle || sourcePaused || !$("autoRefresh").checked || sourcePermission !== "granted" || busy || sourceReading || sourceSelecting || profileSwitching) return false;
  const slot = scheduledSlot(now);
  if (!slot || slot === lastScheduleSlot) return false;
  lastScheduleSlot = slot;
  return readSource({ automatic: true });
}

async function readSource({ force = false } = {}) {
  if (!sourceHandle || busy || sourceReading || sourceSelecting || profileSwitching) return false;
  sourceReading = true;
  sourcePaused = false;
  updateSourceControls();
  try {
    sourcePermission = await sourceHandle.queryPermission({ mode: "read" });
    if (sourcePermission !== "granted") { sourceStatus = "Fichier mémorisé · cliquez sur Rouvrir pour autoriser sa lecture."; return false; }
    // Nouvelle copie du fichier à chaque vérification : il a pu changer sur le disque.
    const file = await sourceHandle.getFile();
    checkDEMFile(file);
    const stamp = fileStamp(file);
    if (!force && data && stamp === sourceStamp) {
      $("message").innerHTML = data.missingSheets.length ? `<div class="notice">Import partiel : feuilles absentes ${esc(data.missingSheets.join(", "))}. Les indicateurs couvrent uniquement les feuilles présentes.</div>` : "";
      lastChecked = new Date();
      sourceStatus = `${sourceRemembered ? "Fichier mémorisé sur ce PC" : "Fichier sélectionné pour cette session"} · copie inchangée`;
      lastScheduleSlot = scheduledSlot(lastChecked);
      return true;
    }
    const ok = await load(file, { preserveView: !!data, resetIgnored: sourceStamp !== stamp });
    if (!ok) { sourceStatus = data ? "Lecture échouée · les derniers indicateurs restent affichés." : "Lecture échouée · choisissez un autre fichier."; return false; }
    sourceStamp = stamp;
    lastChecked = new Date();
    lastScheduleSlot = scheduledSlot(lastChecked);
    sourceStatus = sourceRemembered ? "Fichier mémorisé sur ce PC" : "Sélection pour cette session · mémorisation indisponible";
    return true;
  } catch (e) {
    if (e.name === "NotAllowedError" || e.name === "SecurityError") { sourcePermission = "prompt"; sourceStatus = "Lecture non autorisée · cliquez sur Actualiser."; }
    else if (e.name === "NotFoundError") sourceStatus = "Fichier introuvable · cliquez sur Changer le fichier.";
    else sourceStatus = `Lecture impossible : ${e.message || "fichier indisponible"}.`;
    $("message").innerHTML = `<div class="notice error">${esc(sourceStatus)}${data ? " Les derniers indicateurs restent affichés." : ""}</div>`;
    return false;
  } finally {
    sourceReading = false;
    armSchedule();
  }
}

async function chooseSource() {
  if (busy || sourceSelecting || sourceReading || profileSwitching) return;
  if (!persistentPicker) { $("file").click(); return; }
  sourceEpoch++;
  sourceSelecting = true;
  updateSourceControls();
  try {
    const options = { id: "dem-coordos-" + activeDEM, multiple: false, types: [{ description: "Classeur Excel", accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"], "application/vnd.ms-excel.sheet.macroEnabled.12": [".xlsm"] } }] };
    let handle;
    try { [handle] = await window.showOpenFilePicker(sourceHandle ? { ...options, startIn: sourceHandle } : options); }
    catch (e) { if (e.name !== "TypeError" || !sourceHandle) throw e; [handle] = await window.showOpenFilePicker(options); }
    const file = await handle.getFile();
    checkDEMFile(file);
    if (!await load(file)) return;
    sourceEpoch++; currentSessionFile = null; sourceHandle = handle; sourcePermission = "granted"; sourcePaused = false;
    sourceStamp = fileStamp(file); lastChecked = new Date(); lastScheduleSlot = scheduledSlot(lastChecked); $("autoRefresh").checked = true;
    try { await storedSource("put", handle); await storedSource("put", activeDEM, "activeDEM"); sourceRemembered = true; sourceStatus = "Fichier mémorisé sur ce PC"; keepStorage(); }
    catch (e) { sourceRemembered = false; sourceStatus = "Sélection pour cette session · mémorisation indisponible"; }
  } catch (e) {
    if (e.name !== "AbortError") sourceStatus = `Sélection impossible : ${e.message || "autorisation refusée"}.`;
  } finally {
    sourceSelecting = false;
    armSchedule();
  }
}

// Demande au navigateur de ne pas effacer la mémorisation pour libérer de la place.
function keepStorage() {
  try { navigator.storage?.persist?.().catch(() => {}); } catch (e) { /* sans conséquence */ }
}

async function authorizeSource() {
  if (!sourceHandle || busy || sourceReading || sourceSelecting || profileSwitching) return;
  // La demande d'autorisation doit partir directement du clic de l'utilisateur.
  let permission;
  try { permission = sourceHandle.requestPermission({ mode: "read" }); }
  catch (e) { sourceStatus = "Autorisation indisponible · choisissez de nouveau le fichier."; updateSourceControls(); return; }
  sourceSelecting = true;
  updateSourceControls();
  try {
    sourcePermission = await permission;
    sourceStatus = sourcePermission === "granted" ? "Lecture autorisée" : "Lecture non autorisée · cliquez sur Actualiser ou changez de fichier.";
  } catch (e) {
    sourceStatus = "Lecture non autorisée · cliquez sur Actualiser ou changez de fichier.";
  } finally {
    sourceSelecting = false;
    updateSourceControls();
  }
  if (sourcePermission === "granted") await readSource({ force: true });
  else armSchedule();
}

async function manualImport(file) {
  if (!file || busy || sourceReading || sourceSelecting || profileSwitching) return false;
  try { checkDEMFile(file); } catch (e) { $("message").innerHTML = `<div class="notice error">${esc(e.message)}</div>`; return false; }
  sourceEpoch++;
  if (!await load(file)) return false;
  lastChecked = new Date(); sourcePaused = false;
  // Le fichier déposé est la DEM mémorisée : on garde la mémorisation et la relecture automatique.
  if (sourceHandle && sourceHandle.name === file.name) {
    currentSessionFile = file;
    sourceStamp = fileStamp(file);
    try { sourcePermission = await sourceHandle.queryPermission({ mode: "read" }); } catch (e) { sourcePermission = "prompt"; }
    sourceStatus = sourcePermission === "granted" ? "Fichier mémorisé sur ce PC" : "Fichier mémorisé · cliquez sur Actualiser pour activer la relecture automatique.";
    lastScheduleSlot = scheduledSlot(lastChecked);
    armSchedule();
    return true;
  }
  // Autre fichier : lu pour cette session ; la DEM mémorisée reste enregistrée pour les prochaines ouvertures.
  const remembered = sourceRemembered ? sourceHandle?.name : "";
  currentSessionFile = file;
  stopSchedule();
  sourceHandle = null; sourceRemembered = false; sourceStamp = null; sourcePermission = "prompt";
  sourceStatus = !persistentPicker ? "Import manuel · la mémorisation nécessite Edge ou Chrome avec accès aux fichiers autorisé."
    : remembered ? `Import manuel pour cette session · la DEM mémorisée (${remembered}) sera rouverte la prochaine fois. Pour mémoriser ce fichier à la place : Fichier › Changer le fichier.`
    : "Import manuel · choisissez le fichier (Fichier › Changer le fichier) pour le mémoriser et le relire automatiquement.";
  try { await storedSource("put", activeDEM, "activeDEM"); } catch (e) { /* sans conséquence */ }
  updateSourceControls();
  return true;
}

async function restoreSource() {
  const epoch = sourceEpoch;
  try {
    const [savedYear, h2026, h2027, legacy] = await Promise.all([storedSource("get", null, "activeDEM"), storedSource("get", null, "source:2026"), storedSource("get", null, "source:2027"), storedSource("get", null, "source")]);
    if (epoch !== sourceEpoch) return;
    if (h2026) demProfiles.set("2026", { handle: h2026, remembered: true });
    if (h2027) demProfiles.set("2027", { handle: h2027, remembered: true });
    const legacyYear = legacy?.name?.match(/202[67]/)?.[0] || "2026";
    if (legacy && !demProfiles.has(legacyYear)) {
      demProfiles.set(legacyYear, { handle: legacy, remembered: true });
      try { await storedSource("put", legacy, "source:" + legacyYear); await storedSource("delete", null, "source"); } catch (e) { /* Conserver l'ancienne source si la migration est bloquée. */ }
    }
    if (epoch !== sourceEpoch) return;
    activeDEM = ["2026", "2027"].includes(savedYear) ? savedYear : legacy ? legacyYear : "2026";
    applyProfile(demProfiles.get(activeDEM));
    if (!persistentPicker) { sourceStatus = "Import manuel · la mémorisation nécessite Edge ou Chrome avec accès aux fichiers autorisé."; updateSourceControls(); return; }
    await activateProfileSource();
  } catch (e) {
    if (epoch === sourceEpoch) { sourceStatus = "Mémorisation indisponible · vous pouvez choisir un fichier pour cette session."; updateSourceControls(); }
  }
}

function closeWorkbook() {
  sourcePaused = true;
  stopSchedule();
  $("pdfExport").disabled = true;
  $("pngExport").disabled = true;
  $("pngRhythm").disabled = true;
  data = null; issues = []; allIssues = []; visible = [];
  $("workspace").classList.add("hidden");
  $("drop").classList.remove("hidden");
  $("view").innerHTML = "";
  $("message").innerHTML = "";
  sourceStatus = sourceHandle ? "Fichier mémorisé · cliquez sur Rouvrir pour reprendre." : "Aucun classeur ouvert";
  renderChrome();
  updateSourceControls();
  // Après un import manuel, on repropose la DEM mémorisée sur ce PC.
  if (!sourceHandle && persistentPicker) {
    const epoch = sourceEpoch;
    storedSource("get").then((h) => {
      if (!h || data || sourceHandle || epoch !== sourceEpoch) return;
      sourceHandle = h; sourceRemembered = true; sourcePermission = "prompt"; currentSessionFile = null;
      sourceStatus = "Fichier mémorisé · cliquez sur Rouvrir pour reprendre.";
      updateSourceControls();
    }).catch(() => {});
  }
}
