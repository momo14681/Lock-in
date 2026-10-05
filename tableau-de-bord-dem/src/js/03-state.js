// =============================================================================
// État de l'interface, préférences et périmètre filtré.
// =============================================================================

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => Number(n || 0).toLocaleString("fr-FR");
const PAGE_SIZE = 50;

function pct(n, total) {
  return total ? (100 * n / total).toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " %" : "—";
}
function ratio(n, total) {
  return total ? Math.max(0, Math.min(1, n / total)) : 0;
}
function plural(n, one, many = one + "s") {
  return `${fmt(n)} ${n > 1 ? many : one}`;
}

// --- Profils et onglets ----------------------------------------------------------

// Onglets principaux (une question par écran) et listes secondaires.
const TABS = {
  ce: [
    { id: "mine", label: "Mes affaires" },
    { id: "issues", label: "À corriger dans la DEM", count: () => activeIssueCount(me) },
    { id: "team", label: "Équipe" },
  ],
  coordo: [
    { id: "overview", label: "Synthèse" },
    { id: "issues", label: "À corriger dans la DEM", count: () => activeIssueCount($("owner").value) },
    { id: "team", label: "Équipe" },
  ],
};
const MORE_TABS = {
  ce: [{ id: "tasks", label: "Mes TOT" }, { id: "documents", label: "Mes documents à reprendre (R)" }],
  coordo: [{ id: "owners", label: "Répartition par chargé" }, { id: "tasks", label: "Toutes les TOT" }, { id: "documents", label: "Documents à valider (P) / à reprendre (R)" }, { id: "assignments", label: "Affectations SharePoint" }],
};
const HIDDEN_TABS = { coordo: ["affaires", "dossiers"], ce: [] };

let data = null;
let mode = "ce";
let me = "";
const tabByMode = { ce: "mine", coordo: "overview" };
let tab = "mine";
let page = 1;
let busy = false;

// Listes et filtres internes aux vues.
let issueKind = "", issueLevel = "", showIgnored = false;
let taskFocus = "", taskScope = null;
let chargeMode = "tasks", chargeSort = "total";
let assignmentFilter = "missing";
let docCode = "P", documentType = "";
let teamLateOwner = "";
const hiddenOwners = new Set();
const selectedSheets = new Set();
const expandedAffaires = new Set();

// Résultats du dernier rendu et export CSV de la vue affichée.
let visible = [], allIssues = [], issues = [];
let currentExport = null;
let currentRows = null; // lignes affichées (après recherche et filtres), pour le PDF

// --- Préférences locales (ce PC, ce navigateur) ------------------------------------

const PREF_KEY = "dem-essais-preferences-v2";
function readPrefs() {
  try { return JSON.parse(localStorage.getItem(PREF_KEY) || "{}") || {}; } catch (e) { return {}; }
}
function savePrefs() {
  try { localStorage.setItem(PREF_KEY, JSON.stringify({ mode, me })); } catch (e) { /* Préférence non mémorisée : sans conséquence. */ }
}

function setMode(next) {
  if (!TABS[next] || next === mode) return;
  tabByMode[mode] = tab;
  mode = next;
  tab = tabByMode[mode];
  page = 1;
  savePrefs();
  render();
}

function setTab(next) {
  tab = next;
  tabByMode[mode] = next;
  page = 1;
  if (next === "tasks") { taskFocus = ""; taskScope = null; }
  render();
}

function setMe(name) {
  me = name;
  expandedAffaires.clear();
  page = 1;
  savePrefs();
  render();
}

// --- Périmètre ---------------------------------------------------------------------

function sheetMatches(sheet) {
  return !selectedSheets.size || selectedSheets.has(sheet);
}

// Chargé appliqué aux vues : le CE choisi (vues personnelles) ou le filtre coordo.
function ownerScope() {
  if (mode === "ce") return tab === "team" ? "" : me;
  return $("owner").value;
}

function searchMatches(t, q) {
  return !q || [t.affaire, t.libelle, t.ree, t.tot, t.ot, t.responsable, t.sheet].join(" ").toLowerCase().includes(q);
}

function filteredBy(owner) {
  if (!data) return [];
  const q = $("search").value.trim().toLowerCase();
  return data.tasks.filter((t) => !t.cancelled && sheetMatches(t.sheet) && (!owner || t.responsable === owner) && searchMatches(t, q));
}

function filtered() {
  return filteredBy(ownerScope());
}

// Signalements actifs d'un chargé (ou de tous), indépendamment de l'onglet affiché.
function activeIssueCount(owner) {
  if (!data?.audit || (mode === "ce" && !owner)) return 0;
  const pool = new Set(filteredBy(owner));
  return data.audit.filter((i) => pool.has(i.t) && !ignoredIssues.has(issueId(i))).length;
}

function ownersList() {
  return [...new Set((data?.tasks || []).filter((t) => !t.cancelled).map((t) => t.responsable))].sort((a, b) => a.localeCompare(b, "fr", { numeric: true }));
}

function scopeLabel() {
  const owner = ownerScope();
  return [
    selectedSheets.size ? [...selectedSheets].join(" · ") : "Toutes les feuilles",
    owner || (mode === "ce" && tab !== "team" ? "Aucun chargé choisi" : "Tous les CE"),
    $("search").value.trim() ? "Recherche : " + $("search").value.trim() : "",
  ].filter(Boolean).join(" · ");
}

function periodLabel() {
  const p = j0Period();
  return p.years.length ? `Période J0 ${p.label}` : "Toutes les années de J0";
}

function toggleSheet(sheet) {
  if (!sheet) selectedSheets.clear();
  else if (selectedSheets.has(sheet)) selectedSheets.delete(sheet);
  else selectedSheets.add(sheet);
  page = 1;
  issueKind = "";
  render();
}

function updateJ0YearButtons() {
  document.querySelectorAll("[data-j0-year]").forEach((b) => {
    const active = selectedJ0Years.has(+b.dataset.j0Year);
    b.classList.toggle("active", active);
    b.setAttribute("aria-pressed", String(active));
  });
}

function toggleJ0Year(year) {
  if (selectedJ0Years.has(year)) selectedJ0Years.delete(year);
  else selectedJ0Years.add(year);
  updateJ0YearButtons();
  page = 1;
  render();
}

function resetFilters() {
  selectedSheets.clear();
  $("search").value = "";
  $("owner").value = "";
  issueKind = "";
  issueLevel = "";
  documentType = "";
  taskFocus = "";
  taskScope = null;
  teamLateOwner = "";
  page = 1;
  render();
}

function openIssues(kind = "", owner = null) {
  if (owner !== null && mode === "coordo") $("owner").value = owner;
  issueKind = kind;
  issueLevel = "";
  showIgnored = false;
  setTab("issues");
}

function openTasks(focus = "", scope = null) {
  taskFocus = focus;
  taskScope = scope;
  tab = tabByMode[mode] = "tasks";
  page = 1;
  render();
}
