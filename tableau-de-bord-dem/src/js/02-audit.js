// =============================================================================
// Contrôles de cohérence de la DEM (« signalements »). Règles V1.3 inchangées.
// =============================================================================

const LEVELS = ["Prioritaire", "À compléter", "À vérifier"];
const LEVEL_RANK = { Prioritaire: 0, "À compléter": 1, "À vérifier": 2 };
const LEVEL_TONE = { Prioritaire: "bad", "À compléter": "warn", "À vérifier": "neutral" };

// Période attendue des J0 (années sélectionnées dans les filtres).
const selectedJ0Years = new Set();
function j0Period() {
  const years = [...selectedJ0Years].sort((a, b) => a - b);
  return years.length
    ? { min: `${years[0]}-01-01`, max: `${years[years.length - 1]}-12-31`, years, label: years.length === 1 ? String(years[0]) : `${years[0]} à ${years[years.length - 1]}` }
    : { min: "", max: "", years, label: "Toutes les années" };
}

function isoDay(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

// Une valeur qui ressemble à une date ou un nombre mais n'est pas exploitable.
function formatProblem(t, key) {
  const cell = t.cells?.[key];
  const value = cell?.v ?? t.raw?.[key];
  const s = String(value ?? "").trim().toUpperCase();
  if (cell?.t === "e" || !s) return false;
  if (key !== "j0" && ["P", "R", ...(key === "ger" ? [...GER_PRODUCED_CODES, ...GER_SIGNED_CODES] : [])].includes(s)) return false;
  if (key !== "ger" && parseExcelDate(value)) return false;
  return typeof value === "number" || value instanceof Date || (/\d/.test(s) && /^[+\-\d\s.,/:]+$/.test(s));
}

function audit(tasks) {
  const out = [];
  const add = (t, kind, keys, reason, level = "À vérifier") => out.push({
    t, kind, keys, reason, level,
    cells: where(t, keys),
    value: keys.map((k) => names[k] + " : " + (t.raw[k] || "vide")).join(" · "),
  });

  for (const t of tasks) {
    if (t.cancelled) continue;
    if (t.infoMissing) add(t, "Infos manquantes", t.missingInfoKeys, `${t.bpdSigned ? "BPD signé" : t.totReady ? "TOT prête" : "GER/1N renseigné"}. À compléter : ${missingLabel(t)}.`, "À compléter");
    if (t.responsable === UNASSIGNED) add(t, "Non-affectation", ["responsable"], "Désigner un chargé d’essais ou une entreprise.", "À compléter");
    if (!t.affaire) add(t, "Identifiants", ["affaire"], "Renseigner la référence eDIM.", "À compléter");
    if (!t.ree) add(t, "Identifiants", ["ree"], "Renseigner le REE.", "À compléter");
    if (!t.j0 && !t.j0Unknown && !formatProblem(t, "j0")) add(t, "J0 absent / invalide", ["j0"], "Renseigner une date exploitable (ou « Non renseigné ») pour calculer J0 − 30.", "À compléter");
    if (t.rduMissing && (t.totReady || t.bpdSigned || String(t.ger || "").trim() !== "")) add(t, "RDU manquant", ["rdu"], "Le RDU n’est pas renseigné. À ajouter si possible.");
    // Prioritaire seulement si l'activité (J0) est encore à venir ; sinon simple mise à jour de la DEM.
    if (t.overdue) add(t, "Prépa en retard (échéance dépassée)", [...t.missingPrerequisites, ...(!t.totReady ? ["totPrete"] : []), "j0"], `Préparation attendue le ${t.prepDueLabel}. Compléter les informations ou confirmer le planning.`, t.j0 && data?.today && t.j0 >= data.today ? "Prioritaire" : "À compléter");
    if (t.duplicate) add(t, "TOT en double", ["ot", "tot"], `Même OT-TOT sur ${t.sameTot.length} lignes de la feuille (lignes ${t.sameTot.map((x) => x.rowNumber).join(", ")}) : comptée une seule fois. Vérifier avant toute suppression.`);

    for (const key of ["j0", "totPrete", "bpa", "ger", "bpd"]) {
      if (key === "j0" && t.j0Cru) continue; // J0 de la DEM non utilisé : date de la CRU retenue.
      if (formatProblem(t, key)) {
        add(t, "Format non conforme", [key], key === "ger"
          ? "Valeur numérique ou date non admise pour GER/1N. Utiliser P, PS, TS, PSR, TSR, TAR ou R."
          : "Date ou nombre au format non conforme. Vérifier le jour, le mois et l’année, puis saisir une date valide (ex. 21/07/2026).", "À compléter");
        continue;
      }
      if (key === "j0" || t.cells[key]?.t === "e") continue;
      const s = String(t.raw[key] ?? "").trim().toUpperCase();
      const known = ["P", "R", "ANNULE", "ANNULEE", "ANNULÉ", "ANNULÉE"].includes(s)
        || (key === "ger" ? [...GER_PRODUCED_CODES, ...GER_SIGNED_CODES].includes(s) : key === "totPrete" ? totPreteDone(t.cells[key]?.v) : parseExcelDate(t.cells[key]?.v));
      if (s && !known) add(t, "Statut à qualifier", [key], "Valeur non reconnue par les règles de lecture. Confirmer la signification.");
    }

    const bpa = parseExcelDate(t.cells.bpa?.v), bpd = parseExcelDate(t.cells.bpd?.v);
    if (bpa && bpd && bpd < bpa) add(t, "Chronologie", ["bpa", "bpd"], "La date BPD précède la date BPA. Vérifier la séquence métier.");
    for (const [key, c] of Object.entries(t.cells)) if (c?.t === "e") add(t, "Erreur Excel", [key], "La cellule contient une erreur Excel. Vérifier la formule dans le classeur.", "À compléter");
  }
  return out.sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || a.t.sheet.localeCompare(b.t.sheet) || a.t.rowNumber - b.t.rowNumber);
}

// Signalements ignorés : uniquement pour l'import en cours.
const ignoredIssues = new Set();
function issueId(i) {
  return JSON.stringify([i.t.sheet, i.t.rowNumber, i.kind, i.cells, i.value]);
}

// Champs en alerte (non ignorée) d'une TOT : affichés en rouge jusqu'à correction ou « Ignorer ».
// J0 n'est pas en faute dans « Prépa en retard » : il sert seulement à situer l'échéance.
let alertIndex = null, alertIndexFor = null;
function alertMap(t) {
  if (alertIndexFor !== data?.audit) {
    alertIndex = new Map(); alertIndexFor = data?.audit;
    for (const i of data?.audit || []) {
      if (ignoredIssues.has(issueId(i))) continue;
      const m = alertIndex.get(i.t) || new Map();
      for (const k of i.keys) if (!(k === "j0" && i.kind.startsWith("Prépa en retard"))) m.set(k, [...(m.get(k) || []), i.kind]);
      alertIndex.set(i.t, m);
    }
  }
  return alertIndex.get(t);
}
function alertOn(t, key) {
  return !!alertMap(t)?.has(key);
}
// Attributs à poser sur l'élément du champ : classe + infobulle.
function alertAttr(t, key, cls = "") {
  const kinds = alertMap(t)?.get(key);
  return kinds ? ` class="${cls ? cls + " " : ""}alertField" title="${esc([...new Set(kinds)].join(" · "))}"` : cls ? ` class="${cls}"` : "";
}
