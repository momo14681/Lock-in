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
  const { min, max } = j0Period();
  const add = (t, kind, keys, reason, level = "À vérifier") => out.push({
    t, kind, keys, reason, level,
    cells: where(t, keys),
    value: keys.map((k) => names[k] + " : " + (t.raw[k] || "vide")).join(" · "),
  });

  for (const t of tasks) {
    if (t.cancelled) continue;
    if (t.infoMissing) add(t, t.bpdSigned ? "Incomplet" : "Infos manquantes", t.missingInfoKeys, `${t.bpdSigned ? "BPD signé" : t.totReady ? "TOT prête" : "GER/1N renseigné"}. À compléter : ${missingLabel(t)}.`, "À compléter");
    if (t.responsable === UNASSIGNED) add(t, "Non-affectation", ["responsable"], "Désigner un chargé d’essais ou une entreprise.", "À compléter");
    if (!t.affaire) add(t, "Identifiants", ["affaire"], "Renseigner la référence eDIM.", "À compléter");
    if (!t.ree) add(t, "Identifiants", ["ree"], "Renseigner le REE.", "À compléter");
    if (!t.j0 && !formatProblem(t, "j0")) add(t, "J0 absent / invalide", ["j0"], "Renseigner une date exploitable pour calculer J0 − 30.", "À compléter");
    else if (t.j0) {
      const d = isoDay(t.j0);
      if ((min && d < min) || (max && d > max)) add(t, "J0 hors période", ["j0"], `Date hors de la période ${min || "sans début"} au ${max || "sans fin"}. Confirmer si l’activité est historique.`);
    }
    if (t.overdue) add(t, "Préparation en retard", [...t.missingPrerequisites, ...(!t.totReady ? ["totPrete"] : []), "j0"], `Préparation attendue le ${t.prepDueLabel}. Compléter les informations ou confirmer le planning.`, "Prioritaire");
    if (t.duplicate) add(t, "Doublon possible", ["affaire", "ree", "ot", "tot"], "Même combinaison feuille, affaire, REE, OT et TOT sur plusieurs lignes. Vérifier avant toute suppression.");

    for (const key of ["j0", "totPrete", "bpa", "ger", "bpd"]) {
      if (formatProblem(t, key)) {
        add(t, "Format non conforme", [key], key === "ger"
          ? "Valeur numérique ou date non admise pour GER/1N. Utiliser P, PS, TS, PSR, TSR ou R."
          : "Date ou nombre au format non conforme. Vérifier le jour, le mois et l’année, puis saisir une date valide (ex. 21/07/2026).", "À compléter");
        continue;
      }
      if (key === "j0" || t.cells[key]?.t === "e") continue;
      const s = String(t.raw[key] ?? "").trim().toUpperCase();
      const known = ["P", "R", "ANNULE", "ANNULEE", "ANNULÉ", "ANNULÉE"].includes(s)
        || (key === "ger" ? [...GER_PRODUCED_CODES, ...GER_SIGNED_CODES].includes(s) : parseExcelDate(t.cells[key]?.v));
      if (s && !known) add(t, "Statut à qualifier", [key], "Valeur non reconnue par les règles de lecture. Confirmer la signification.");
    }

    const prep = parseExcelDate(t.cells.totPrete?.v), bpa = parseExcelDate(t.cells.bpa?.v), bpd = parseExcelDate(t.cells.bpd?.v);
    if (prep && bpa && bpa < prep) add(t, "Chronologie", ["totPrete", "bpa"], "La date BPA précède la date TOT prête. Vérifier les deux dates.");
    if (bpa && bpd && bpd < bpa) add(t, "Chronologie", ["bpa", "bpd"], "La date BPD précède la date BPA. Vérifier la séquence métier.");
    if (prep && t.j0 && prep > t.j0) add(t, "Chronologie", ["totPrete", "j0"], "La préparation est datée après le début prévu de l’activité.");
    for (const [key, c] of Object.entries(t.cells)) if (c?.t === "e") add(t, "Erreur Excel", [key], "La cellule contient une erreur Excel. Vérifier la formule dans le classeur.", "À compléter");
  }
  return out.sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || a.t.sheet.localeCompare(b.t.sheet) || a.t.rowNumber - b.t.rowNumber);
}

// Signalements ignorés : uniquement pour l'import en cours.
const ignoredIssues = new Set();
function issueId(i) {
  return JSON.stringify([i.t.sheet, i.t.rowNumber, i.kind, i.cells, i.value]);
}
