// =============================================================================
// Modèle de données : lecture de la DEM et règles métier.
// Les règles sont reprises à l'identique de la V1.3 (seuls les libellés DI / REE
// sont lus en plus, pour l'affichage).
// =============================================================================

const TECHNICAL_SHEETS = ["CS0M", "CS1M", "CS1A", "CS2M", "CS2A", "CS3M", "CS3A", "CS4A", "CS4M", "CS8M", "CS9M"];
const IPE_SHEET = "Suivi modification IPE";
const PROVIDER_NAMES = new Set(["EKIUM", "SOM"]);
const GER_PRODUCED_CODES = ["P", "PS", "TS"];
const GER_SIGNED_CODES = ["PSR", "TSR"];
const DAY_MS = 86_400_000;
const UNASSIGNED = "Non affecté";

// Colonnes de la DEM (lettre Excel) et libellés métier.
const fields = { affaire: "A", ree: "D", responsable: "G", mc: "I", ot: "J", tot: "K", rdu: "L", totPrete: "N", j0: "O", regime: "P", bpa: "Q", ger: "R", bpd: "S", observations: "V" };
const names = { affaire: "Affaire eDIM", ree: "REE", responsable: "Chargé d’essais", mc: "MC", ot: "OT", tot: "TOT", rdu: "RDU", totPrete: "TOT prête", j0: "J0", regime: "Régime", bpa: "BPA", ger: "GER/1N", bpd: "BPD", observations: "Observations" };

function compact(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number") return value;
  return String(value).replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

function text(value) {
  const normalized = compact(value);
  if (normalized instanceof Date) return normalized.toLocaleDateString("fr-FR");
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

function addDays(date, amount) {
  return new Date(date.getTime() + amount * DAY_MS);
}

function daysBetween(from, to) {
  return Math.round((startOfDay(to) - startOfDay(from)) / DAY_MS);
}

function formatDate(date) {
  return date ? new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date) : "—";
}

function formatShortDate(date) {
  return date ? new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" }).format(date) : "—";
}

function formatFrenchDateTime(date) {
  return date ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(date) : "—";
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

function buildTask(sheet, rowNumber, row, today) {
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
    totPrete: compact(row[13]),
    j0: compact(row[14]),
    regime: compact(row[15]),
    bpa: compact(row[16]),
    ger: compact(row[17]),
    bpd: compact(row[18]),
    edrt: compact(row[19]),
    observations: row[21] == null ? "" : String(row[21]).trim(),
  };

  if (!rowHasBusinessData(values) || ![values.affaire, values.ree, values.ot, values.tot].some(isNonBlank)) return null;

  // « Non renseigné dans SharePoint » (recopié depuis SharePoint) vaut « Non affecté ».
  const ownerText = text(values.responsable);
  const responsable = !ownerText || /non renseign/i.test(ownerText.normalize("NFD").replace(/[\u0300-\u036f]/g, "")) ? UNASSIGNED : ownerText;
  const j0Date = parseExcelDate(values.j0);
  const prepDue = j0Date ? addDays(j0Date, -30) : null;
  const totReady = Boolean(parseExcelDate(values.totPrete)) || status(values.totPrete) === "P";
  const missingPrerequisites = ["mc", "ot", "tot", "rdu"].filter((key) => !isNonBlank(values[key]));
  const prepComplete = missingPrerequisites.length === 0 && totReady;
  const bpaState = classifyMilestone(values.bpa);
  const gerState = classifyMilestone(values.ger, GER_SIGNED_CODES, false, GER_PRODUCED_CODES);
  const bpdState = classifyMilestone(values.bpd);
  const cancelled = [values.mc, values.ot, values.tot, values.rdu, values.totPrete, values.regime, values.bpa, values.ger, values.bpd]
    .some((value) => /^ANNULEE?S?$/.test(status(value)));
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
    responsableType: responsable === UNASSIGNED ? UNASSIGNED : PROVIDER_NAMES.has(status(responsable)) ? "Prestataire" : "Interne",
    chargeAffaires: text(values.chargeAffaires),
    mc: text(values.mc),
    ot: text(values.ot),
    tot: text(values.tot),
    rdu: text(values.rdu),
    totPrete: text(values.totPrete),
    j0: j0Date,
    j0Label: formatDate(j0Date),
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
    bpaState,
    gerState,
    bpdState,
    cancelled,
    overdue,
    dueSoon,
    prepState,
  };
}

async function parseWorkbook(input, fileMeta = {}, now = new Date()) {
  const today = startOfDay(now);
  const workbook = XLSX.read(input, {
    type: "array", cellDates: true, cellFormula: false, cellHTML: false, cellStyles: false, cellNF: false, dense: true, sheets: TECHNICAL_SHEETS,
  });

  const missingSheets = TECHNICAL_SHEETS.filter((name) => !workbook.Sheets[name]);
  if (missingSheets.length === TECHNICAL_SHEETS.length) {
    throw new Error("Aucune feuille technique attendue n’a été trouvée dans ce classeur.");
  }

  const tasks = [];
  for (const sheetName of TECHNICAL_SHEETS) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
    // Les cellules fusionnées portent la valeur de leur coin supérieur gauche.
    for (const merge of sheet["!merges"] || []) {
      const value = rows[merge.s.r]?.[merge.s.c];
      for (let r = merge.s.r; r <= merge.e.r && r < rows.length; r++) {
        for (let c = merge.s.c; c <= merge.e.c; c++) if (rows[r] && rows[r][c] == null) rows[r][c] = value;
      }
    }
    for (let index = 1; index < rows.length; index += 1) {
      const task = buildTask(sheetName, index + 1, rows[index], today);
      if (task) tasks.push(task);
    }
  }

  return {
    fileName: fileMeta.name || "Classeur importé",
    analyzedAt: new Date(),
    today,
    tasks,
    availableSheets: TECHNICAL_SHEETS.filter((name) => workbook.Sheets[name]),
    missingSheets,
  };
}

// --- Règles complémentaires (V1.3) ------------------------------------------

function applyMissingInfo(t) {
  t.missingInfoKeys = [...t.missingPrerequisites, ...(!t.totReady ? ["totPrete"] : [])];
  t.bpdSigned = !!parseExcelDate(t.cells?.bpd?.v ?? t.bpd);
  if (t.bpdSigned) {
    for (const k of ["affaire", "ree", "responsable", "j0", "bpa", "ger"]) {
      const missing = k === "j0" ? !t.j0 : k === "responsable" ? (!t.responsable || t.responsable === UNASSIGNED) : !String(t[k] ?? "").trim();
      if (missing) t.missingInfoKeys.push(k);
    }
    for (const [k, c] of Object.entries(t.cells || {})) if (c?.t === "e" && !["regime", "observations"].includes(k)) t.missingInfoKeys.push(k);
    t.missingInfoKeys = [...new Set(t.missingInfoKeys)];
  }
  t.infoMissing = !t.cancelled && (t.bpdSigned ? t.missingInfoKeys.length > 0 : !t.prepComplete && (t.totReady || String(t.ger || "").trim() !== ""));
  if (t.bpdSigned || t.infoMissing) {
    t.overdue = false;
    t.dueSoon = false;
    t.prepState = t.infoMissing ? "missing-info" : "realized";
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

function isRealized(t) {
  return !t.cancelled && t.gerState === "done";
}

// Statut d'avancement d'une TOT (ordre d'évaluation de la V1.3).
const STATE = { realized: "Réalisé", missing: "Infos manquantes", ready: "Prépa terminée", late: "DEM incomplète", ongoing: "En préparation", cancelled: "Annulée" };
function state(t) {
  return t.cancelled ? STATE.cancelled : isRealized(t) ? STATE.realized : t.infoMissing ? STATE.missing : t.prepComplete ? STATE.ready : t.overdue ? STATE.late : STATE.ongoing;
}

// Ordre d'empilement des graphiques : de l'acquis vers ce qui bloque.
const STATE_ORDER = [STATE.realized, STATE.ready, STATE.ongoing, STATE.missing, STATE.late];
const STATE_COLORS = {
  [STATE.realized]: "#509E2F",
  [STATE.ready]: "#1057C8",
  [STATE.ongoing]: "#b9c6d4",
  [STATE.missing]: "#EBA000",
  [STATE.late]: "#E3262D",
};
const STATE_TONE = { [STATE.realized]: "good", [STATE.ready]: "info", [STATE.ongoing]: "neutral", [STATE.missing]: "warn", [STATE.late]: "warn", [STATE.cancelled]: "neutral" };
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
