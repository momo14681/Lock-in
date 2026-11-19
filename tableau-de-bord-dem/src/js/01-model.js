// =============================================================================
// Modèle de données : lecture de la DEM et règles métier.
// Les règles sont reprises à l'identique de la V1.3 (seuls les libellés DI / REE
// sont lus en plus, pour l'affichage).
// =============================================================================

const TECHNICAL_SHEETS = ["CS0M", "CS1M", "CS1A", "CS2M", "CS2A", "CS3M", "CS3A", "CS4A", "CS4M", "CS8M", "CS9M"];
const IPE_SHEET = "Suivi modification IPE";
const GER_PRODUCED_CODES = ["P", "PS", "TS"];
const GER_SIGNED_CODES = ["PSR", "TSR", "PAR", "TAR"]; // posés par le coordo ; PAR / TAR : partiel / total avec réserve
const DAY_MS = 86_400_000;
const UNASSIGNED = "Non affecté";

// Colonnes de la DEM (lettre Excel) et libellés métier.
const fields = { affaire: "A", ree: "D", responsable: "M", mc: "I", ot: "J", tot: "K", rdu: "L", totPrete: "N", j0: "O", regime: "P", bpa: "Q", ger: "R", bpd: "S", observations: "V" };
const names = { affaire: "Affaire eDIM", ree: "REE", responsable: "Chargé d’essais SP", mc: "MC", ot: "OT", tot: "TOT", rdu: "RDU", totPrete: "TOT prête", j0: "J0", regime: "Régime", bpa: "BPA", ger: "GER/1N", bpd: "BPD", observations: "Observations" };

// Formateurs créés une seule fois : en créer un par appel (toLocaleDateString, new Intl…)
// coûte cher et figeait la page sur une grosse DEM.
const DATE_FR = new Intl.DateTimeFormat("fr-FR");
const DATE_FR_2D = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
const DATE_FR_SHORT = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" });
const DATETIME_FR = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" });
const COLLATOR_FR = new Intl.Collator("fr");
const COLLATOR_FR_NUM = new Intl.Collator("fr", { numeric: true });

// Rend la main au navigateur entre deux paquets de calcul (évite « page ne répond pas »).
function pauseForPaint() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function compact(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number") return value;
  return String(value).replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

function text(value) {
  const normalized = compact(value);
  if (normalized instanceof Date) return DATE_FR.format(normalized);
  if (typeof normalized === "number" && Number.isInteger(normalized)) return String(normalized);
  return String(normalized);
}

function status(value) {
  return text(value).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
}

function isNonBlank(value) {
  return text(value) !== "";
}

function startOfDay(value) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function validDate(y, m, d) {
  const candidate = new Date(y, m - 1, d);
  return candidate.getFullYear() === y && candidate.getMonth() === m - 1 && candidate.getDate() === d ? candidate : null;
}

function parseExcelDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return startOfDay(value);
  if (typeof value === "number" && Number.isFinite(value) && value > 20_000 && value < 80_000) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return new Date(parsed.y, parsed.m - 1, parsed.d);
  }
  if (typeof value !== "string") return null;
  const source = value.trim();
  if (!source) return null;

  let match = source.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (match) {
    const candidate = validDate(Number(match[3]), Number(match[2]), Number(match[1]));
    if (candidate) return candidate;
  }
  match = source.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2})$/);
  if (match) {
    const fullYear = Number(match[3]) >= 70 ? 1900 + Number(match[3]) : 2000 + Number(match[3]);
    const candidate = validDate(fullYear, Number(match[2]), Number(match[1]));
    if (candidate) return candidate;
  }
  match = source.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    const candidate = validDate(Number(match[1]), Number(match[2]), Number(match[3]));
    if (candidate) return candidate;
  }
  return null;
}

// Équivalences de saisie : « Prêt » en TOT prête vaut P ; une date en GER/1N vaut TSR.
// Circuit de validation : le chargé passe la cellule en P, le coordo valide (PRÊT en TOT prête,
// date du jour en BPA / BPD, PSR / TSR / PAR en GER/1N) ou renvoie en R.
// « PRÊT » et « Renseigné » en TOT prête valent une TOT prête faite, comme une date.
function totPreteDone(value) {
  return Boolean(parseExcelDate(value)) || /^(RENSEIGN|PRET)/.test(status(value));
}

function normalizeStatus(key, value) {
  if (key === "ger" && parseExcelDate(value)) return "TSR";
  return value;
}

function addDays(date, amount) {
  return new Date(date.getTime() + amount * DAY_MS);
}

function daysBetween(from, to) {
  return Math.round((startOfDay(to) - startOfDay(from)) / DAY_MS);
}

function formatDate(date) {
  return date ? DATE_FR_2D.format(date) : "—";
}

function formatShortDate(date) {
  return date ? DATE_FR_SHORT.format(date) : "—";
}

function formatFrenchDateTime(date) {
  return date ? DATETIME_FR.format(date) : "—";
}

function classifyMilestone(value, doneStatuses = [], allowDate = true, readyStatuses = ["P"]) {
  const normalized = status(value);
  if (allowDate && parseExcelDate(value)) return "done";
  if (doneStatuses.includes(normalized)) return "done";
  if (readyStatuses.includes(normalized)) return "ready";
  if (normalized === "R") return "rework";
  if (!normalized) return "empty";
  if (normalized === "ANNULE") return "cancelled";
  return "other";
}

function taskId(sheet, values) {
  return [sheet, values.affaire, values.ree, values.ot, values.tot].map((part) => status(part)).join("|");
}

function rowHasBusinessData(values) {
  return [values.affaire, values.ree, values.entreprise, values.responsable, values.chargeAffaires, values.mc, values.ot, values.tot, values.rdu, values.responsableSharePoint, values.totPrete, values.j0, values.regime, values.bpa, values.ger, values.bpd].some(isNonBlank);
}

// Colonnes recopiées depuis la ligne qui porte le REE quand elles sont vides sur une ligne
// de TOT du même REE (cellules fusionnées ou laissées vides) : A (affaire), D (REE), Q (BPA), S (BPD).
// Même règle que la feuille Pilotage (RECHERCHE sur la dernière ligne où le REE est rempli).
const REE_INHERITED = [0, 3, 16, 18];

function buildTask(sheet, rowNumber, row, today, head = null, cruStart = null) {
  const values = {
    affaire: compact(row[0]),
    libelle: compact(row[1]),
    piece7: compact(row[2]),
    ree: compact(row[3]),
    entreprise: compact(row[4]),
    reeLibelle: compact(row[5]),
    responsable: compact(row[6]),
    chargeAffaires: compact(row[7]),
    mc: compact(row[8]),
    ot: compact(row[9]),
    tot: compact(row[10]),
    rdu: compact(row[11]),
    responsableSharePoint: compact(row[12]),
    totPrete: normalizeStatus("totPrete", compact(row[13])),
    j0: compact(row[14]),
    regime: compact(row[15]),
    bpa: compact(row[16]),
    ger: normalizeStatus("ger", compact(row[17])),
    bpd: compact(row[18]),
    edrt: compact(row[19]),
    observations: row[21] == null ? "" : String(row[21]).trim(),
  };

  if (!rowHasBusinessData(values) || ![values.affaire, values.ree, values.ot, values.tot].some(isNonBlank)) return null;
  // Ligne comptée pour les REE de la feuille Pilotage : REE, OT ou TOT renseigné sur la ligne elle-même.
  const reeLine = [values.ree, values.ot, values.tot].some(isNonBlank);
  if (head && head !== row) {
    const keys = { 0: "affaire", 3: "ree", 16: "bpa", 18: "bpd" };
    for (const i of REE_INHERITED) if (!isNonBlank(values[keys[i]])) values[keys[i]] = compact(head[i]);
  }

  // « Non renseigné dans SharePoint » (recopié depuis SharePoint) vaut « Non affecté ».
  // Chargé d’essais lu en colonne M (« Chargé d’essai SP »), sans distinguer prestataires et internes.
  const ownerText = text(values.responsableSharePoint);
  const responsable = !ownerText || /non renseign/i.test(ownerText.normalize("NFD").replace(/[\u0300-\u036f]/g, "")) ? UNASSIGNED : ownerText;
  // J0 retenu : « Date début calculée TOT » de la CRU si elle existe (≤ 2028), sinon J0 de la DEM.
  const j0Dem = parseExcelDate(values.j0), j0Cru = cruStart?.get(otTotKey(values.ot, values.tot)) || null;
  const j0Date = j0Cru || j0Dem;
  // « Non renseigné » : J0 inconnu assumé, ni à compléter ni à corriger.
  const j0Unknown = !j0Date && /^NON RENSEIGNE/.test(status(values.j0));
  const prepDue = j0Date ? addDays(j0Date, -30) : null;
  const totReady = totPreteDone(values.totPrete) || status(values.totPrete) === "P";
  // Un RDU manquant n'est pas bloquant : signalé à part, en « À vérifier ».
  const missingPrerequisites = ["mc", "ot", "tot"].filter((key) => !isNonBlank(values[key]));
  // Préparation terminée = TOT prête (date ou P), comme l'indicateur « TOT prête produits ».
  // MC, OT, TOT et RDU manquants restent signalés comme informations à compléter.
  const prepComplete = totReady;
  const bpaState = classifyMilestone(values.bpa);
  const gerState = classifyMilestone(values.ger, GER_SIGNED_CODES, false, GER_PRODUCED_CODES);
  const bpdState = classifyMilestone(values.bpd);
  const cancelled = [values.mc, values.ot, values.tot, values.rdu, values.totPrete, values.regime, values.bpa, values.ger, values.bpd]
    .some((value) => /ANNUL/.test(status(value)));
  // Une TOT marquée prête n'est jamais « en retard » : il reste seulement des informations à compléter.
  const overdue = !cancelled && !prepComplete && !totReady && Boolean(prepDue && prepDue < today);
  const dueSoon = !cancelled && !prepComplete && !totReady && Boolean(prepDue && prepDue >= today && prepDue <= addDays(today, 30));

  let prepState = "ongoing";
  if (cancelled) prepState = "cancelled";
  else if (prepComplete) prepState = "complete";
  else if (overdue) prepState = "overdue";
  else if (!j0Date) prepState = "missing-j0";
  else if (dueSoon) prepState = "due-soon";

  return {
    id: taskId(sheet, values),
    sheet,
    rowNumber,
    affaire: text(values.affaire),
    libelle: text(values.libelle),
    ree: text(values.ree),
    reeLibelle: text(values.reeLibelle),
    entreprise: text(values.entreprise),
    responsable,
    chargeAffaires: text(values.chargeAffaires),
    mc: text(values.mc),
    ot: text(values.ot),
    tot: text(values.tot),
    rdu: text(values.rdu),
    totPrete: text(values.totPrete),
    j0: j0Date,
    j0Label: formatDate(j0Date),
    j0Cru,
    j0Dem,
    prepDue,
    prepDueLabel: formatDate(prepDue),
    regime: text(values.regime),
    bpa: text(values.bpa),
    ger: text(values.ger),
    bpd: text(values.bpd),
    observations: values.observations,
    prepComplete,
    totReady,
    missingPrerequisites,
    rduMissing: !isNonBlank(values.rdu),
    j0Unknown,
    bpaState,
    gerState,
    bpdState,
    cancelled,
    reeLine,
    totValidated: totPreteDone(values.totPrete),
    overdue,
    dueSoon,
    prepState,
  };
}

async function parseWorkbook(input, fileMeta = {}, now = new Date()) {
  const today = startOfDay(now);
  // input : classeur déjà lu (chargement normal, lu une seule fois) ou octets du fichier.
  const workbook = input?.Sheets ? input : XLSX.read(input, {
    type: "array", cellDates: true, cellFormula: false, cellHTML: false, cellStyles: false, cellNF: false, dense: true, sheets: [...TECHNICAL_SHEETS, CRU_SHEET],
  });

  const missingSheets = TECHNICAL_SHEETS.filter((name) => !workbook.Sheets[name]);
  if (missingSheets.length === TECHNICAL_SHEETS.length) {
    throw new Error("Aucune feuille technique attendue n’a été trouvée dans ce classeur.");
  }

  const tasks = [];
  const cruStart = readCruStart(workbook.Sheets[CRU_SHEET]);
  for (const sheetName of TECHNICAL_SHEETS) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    await pauseForPaint();
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
    // Ligne qui porte le REE de chaque ligne : dernière ligne au-dessus (ou elle-même) où D est rempli.
    const heads = [];
    let lastHead = null;
    for (let r = 0; r < rows.length; r++) { if (isNonBlank(compact(rows[r]?.[3]))) lastHead = rows[r]; heads[r] = lastHead; }
    // Les cellules fusionnées portent la valeur de leur coin supérieur gauche.
    for (const merge of sheet["!merges"] || []) {
      const value = rows[merge.s.r]?.[merge.s.c];
      for (let r = merge.s.r; r <= merge.e.r && r < rows.length; r++) {
        for (let c = merge.s.c; c <= merge.e.c; c++) if (rows[r] && rows[r][c] == null) rows[r][c] = value;
      }
    }
    for (let index = 1; index < rows.length; index += 1) {
      const task = buildTask(sheetName, index + 1, rows[index], today, heads[index], cruStart);
      if (task) tasks.push(task);
    }
  }

  return {
    fileName: fileMeta.name || "Classeur importé",
    analyzedAt: new Date(),
    today,
    tasks,
    availableSheets: TECHNICAL_SHEETS.filter((name) => workbook.Sheets[name]),
    cruStartCount: cruStart.size,
    missingSheets,
  };
}

// --- Règles complémentaires (V1.3) ------------------------------------------

function applyMissingInfo(t) {
  t.missingInfoKeys = [...t.missingPrerequisites, ...(!t.totReady ? ["totPrete"] : [])];
  t.bpdSigned = !!parseExcelDate(t.cells?.bpd?.v ?? t.bpd);
  if (t.bpdSigned) {
    for (const k of ["affaire", "ree", "responsable", "j0", "bpa", "ger"]) {
      const missing = k === "j0" ? !t.j0 && !t.j0Unknown : k === "responsable" ? (!t.responsable || t.responsable === UNASSIGNED) : !String(t[k] ?? "").trim();
      if (missing) t.missingInfoKeys.push(k);
    }
    for (const [k, c] of Object.entries(t.cells || {})) if (c?.t === "e" && !["regime", "observations"].includes(k)) t.missingInfoKeys.push(k);
    t.missingInfoKeys = [...new Set(t.missingInfoKeys)];
  }
  t.infoMissing = !t.cancelled && (t.bpdSigned ? t.missingInfoKeys.length > 0 : t.missingInfoKeys.length > 0 && (t.totReady || String(t.ger || "").trim() !== ""));
  if (t.bpdSigned || t.infoMissing) {
    t.overdue = false;
    t.dueSoon = false;
    t.prepState = t.infoMissing ? "missing-info" : "realized";
  }
  // Arrêts de tranche (feuilles CSxA) : le J0 y est indicatif. L'échéance dépassée
  // reste visible, en gris, mais ne compte pas comme un retard.
  t.softLate = false;
  if (t.overdue && dossierPhase(t) === "AT") {
    t.overdue = false;
    t.softLate = true;
    t.prepState = "ongoing";
  }
  return t;
}

function missingLabel(t) {
  return t.missingInfoKeys.map((k) => names[k]).join(", ");
}

// Production cumulative : un état signé ou à reprendre a déjà été produit.
function produced(t, key) {
  if (t.cancelled) return false;
  const field = key.replace("State", "");
  const value = t.cells?.[field]?.v ?? t[field];
  const code = String(value ?? "").trim().toUpperCase();
  return field === "ger"
    ? GER_PRODUCED_CODES.includes(code) || GER_SIGNED_CODES.includes(code) || code === "R"
    : code === "P" || code === "R" || t[key] === "done";
}

// --- Une TOT = une chaîne OT-TOT unique dans la feuille -------------------------------
// Zéros de tête ignorés (0718238-14 = 718238-14), comme VALEUR() dans la feuille Pilotage.
// Une ligne sans OT ou sans TOT (ou TOT = 0) n'est pas une TOT ; une TOT sur plusieurs lignes compte une fois.
function totPart(v) {
  const s = text(v).trim();
  if (!s) return "";
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? String(n) : status(s);
}

function applyTotKeys(tasks) {
  const first = new Map(), count = new Map();
  for (const t of tasks) {
    const ot = totPart(t.ot), tot = totPart(t.tot);
    t.totKey = `${t.sheet}|${ot}-${tot}`;
    t.active = !t.cancelled && !!ot && !!tot && tot !== "0";
    if (!t.active) { t.counted = false; continue; }
    count.set(t.totKey, (count.get(t.totKey) || 0) + 1);
    if (!first.has(t.totKey)) first.set(t.totKey, t);
    t.counted = first.get(t.totKey) === t;
  }
  for (const t of tasks) {
    t.duplicate = t.active && count.get(t.totKey) > 1;
    t.sameTot = t.duplicate ? tasks.filter((x) => x.active && x.totKey === t.totKey) : null;
  }
}

// Un REE dont le BPD est daté est archivé : ses TOT comptent aussi comme réalisées.
function isRealized(t) {
  return !t.cancelled && (t.gerState === "done" || !!t.archived);
}

// BPA et BPD se font par REE (affaire + REE, dans une feuille), qui peut porter plusieurs TOT.
function reeKey(t) {
  return !t.cancelled && t.ree ? `${t.sheet}|${t.affaire}|${status(t.ree).replace(/\s+/g, "")}` : "";
}

// Regroupe les TOT par REE et marque « archivée » chaque TOT d'un REE dont une ligne a une date en BPD.
function applyReeMilestones(tasks) {
  const groups = new Map();
  for (const t of tasks) {
    t.reeTasks = [t];
    t.archived = false;
    const k = reeKey(t);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  for (const ts of groups.values()) {
    const archived = ts.some((t) => !!parseExcelDate(t.cells?.bpd?.v ?? t.bpd));
    for (const t of ts) {
      t.reeTasks = ts;
      t.archived = archived;
      if (archived) { t.overdue = false; t.dueSoon = false; t.softLate = false; }
    }
  }
}

// Statut d'avancement d'une TOT (ordre d'évaluation de la V1.3).
const STATE = { archived: "BPD (archivée)", realized: "Réalisé", missing: "Infos manquantes", ready: "Prépa terminée", late: "Prépa en retard", ongoing: "En préparation", cancelled: "Annulée" };
function state(t) {
  return t.cancelled ? STATE.cancelled : t.archived ? STATE.archived : isRealized(t) ? STATE.realized : t.infoMissing ? STATE.missing : t.prepComplete ? STATE.ready : t.overdue ? STATE.late : STATE.ongoing;
}

// Ordre d'empilement des graphiques : de l'acquis vers ce qui bloque.
const STATE_ORDER = [STATE.archived, STATE.realized, STATE.ready, STATE.ongoing, STATE.missing, STATE.late];
const STATE_COLORS = {
  [STATE.archived]: "#2B6620",
  [STATE.realized]: "#509E2F",
  [STATE.ready]: "#1057C8",
  [STATE.ongoing]: "#b9c6d4",
  [STATE.missing]: "#EBA000",
  [STATE.late]: "#E3262D",
};
const STATE_TONE = { [STATE.archived]: "good", [STATE.realized]: "good", [STATE.ready]: "info", [STATE.ongoing]: "neutral", [STATE.missing]: "warn", [STATE.late]: "warn", [STATE.cancelled]: "neutral" };
const PHASE_COLORS = { TEM: "#1057C8", AT: "#FE5815", "Non précisé": "#b9c6d4" };

function observations(t) {
  return t.raw?.observations ?? t.observations ?? "";
}

function dossierPhase(t) {
  return t.sheet?.endsWith("M") ? "TEM" : t.sheet?.endsWith("A") ? "AT" : "Non précisé";
}

function dossierKey(t) {
  return !t.cancelled && t.ree ? JSON.stringify([t.affaire, t.ree, dossierPhase(t)]) : "";
}

function countUnique(ts, selector) {
  return new Set(ts.map(selector).filter(Boolean)).size;
}

function dossierCount(ts) {
  return countUnique(ts, dossierKey);
}

// Adresse Excel d'un champ (plage complète si la cellule est fusionnée).
function address(t, key) {
  const cell = fields[key] + t.rowNumber;
  const pos = XLSX.utils.decode_cell(cell);
  const merge = (t.merges || []).find((m) => pos.r >= m.s.r && pos.r <= m.e.r && pos.c >= m.s.c && pos.c <= m.e.c);
  return merge ? XLSX.utils.encode_range(merge) : cell;
}

function where(t, keys) {
  return [...new Set(keys.map((k) => address(t, k)))].join(", ");
}

// Valeurs P (à valider) / R (à reprendre) des états du REE.
function documentRows(tasks, code, type = "") {
  return tasks.filter((t) => !t.cancelled).flatMap((t) => ["totPrete", "bpa", "ger", "bpd"]
    .filter((k) => {
      const value = String(t.raw?.[k] ?? t[k] ?? "").trim().toUpperCase();
      return (!type || k === type) && (code === "P" && k === "ger" ? GER_PRODUCED_CODES.includes(value) : value === code);
    })
    .map((k) => ({
      t, key: k, kind: names[k], cells: where(t, [k]),
      value: String(t.raw?.[k] ?? t[k] ?? "").trim().toUpperCase(),
      level: code === "R" ? "À reprendre" : "À valider",
    })));
}
