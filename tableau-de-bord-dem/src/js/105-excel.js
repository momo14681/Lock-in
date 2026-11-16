// =============================================================================
// Complément Excel : le tableau de bord s'ouvre dans Excel (Teams, Excel en ligne ou
// bureau), lit la DEM ouverte et y écrit les saisies de la fiche TOT.
// La page est la même que le fichier HTML autonome ; seule la version « complément »
// charge office.js (voir build.mjs). Hors d'Excel, rien ici ne s'exécute.
// =============================================================================

let excelMode = false, excelReading = false, excelFileName = "";
const EXCEL_JOURNAL = "Journal appli";
const EXCEL_CELLS_PER_READ = 5000; // cellules par lecture (réponse Excel limitée à 5 Mo)
const EXCEL_MERGE_ROWS = 50; // lignes par lecture des cellules fusionnées (Excel refuse au-delà de 512 zones)
const EXCEL_REFRESH_MS = 5 * 60_000; // relecture au retour sur le volet si la dernière a plus de 5 min

function startExcel() {
  excelMode = true;
  document.body.classList.add("inExcel");
  const url = decodeURIComponent(Office.context?.document?.url || "");
  const name = url.split(/[\\/]/).pop().split("?")[0] || "DEM ouverte dans Excel";
  const year = name.match(/DEM[\s_-]*(2026|2027)\b/i)?.[1] || String(new Date().getFullYear());
  if (["2026", "2027"].includes(year)) activeDEM = year;
  $("demSelector").hidden = true;
  excelFileName = name;
  sourceStatus = "DEM ouverte dans Excel · lecture et écriture directes";
  updateSourceControls();
  return readFromExcel();
}

function readFromExcel({ preserveView = !!data } = {}) {
  if (excelReading) return Promise.resolve(false);
  excelReading = true;
  return loadFrom(readExcelWorkbook, { name: excelFileName }, { preserveView, resetIgnored: !preserveView })
    .then((ok) => { if (ok) lastChecked = new Date(); return ok; })
    .finally(() => { excelReading = false; updateSourceControls(); });
}

// --- Lecture : classeur au format SheetJS, comme la lecture d'un fichier -------------

// Cellule Excel → cellule SheetJS (dates en Date, erreurs avec leur texte).
function excelCell(value, type, format, formula) {
  if (type === "Empty" || value === "" || value == null) return null;
  let cell;
  if (type === "Error") cell = { t: "e", v: String(value), w: String(value) };
  else if (typeof value === "boolean") cell = { t: "b", v: value };
  else if (typeof value === "number") cell = format && format !== "General" && XLSX.SSF.is_date(format) ? { t: "d", v: excelDate(value) } : { t: "n", v: value };
  else cell = { t: "s", v: String(value) };
  if (typeof formula === "string" && formula[0] === "=") cell.f = formula.slice(1);
  return cell;
}

function excelDate(serial) {
  const u = new Date(Math.round((serial - 25569) * DAY_MS));
  return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), u.getUTCHours(), u.getUTCMinutes(), u.getUTCSeconds());
}

// Texte d'une cellule tel que la saisie le compare (même règle que t.orig à la lecture).
function excelText(cell) {
  return cell?.t === "e" ? (cell.w || "Erreur Excel") : cell?.v instanceof Date ? formatDate(cell.v) : String(cell?.v ?? "").trim();
}

async function readExcelWorkbook() {
  return Excel.run(async (ctx) => {
    const wanted = WORKBOOK_OPTIONS.sheets;
    const sheets = ctx.workbook.worksheets;
    sheets.load("items/name");
    await ctx.sync();
    const present = sheets.items.map((s) => s.name);
    const wb = { SheetNames: present, Sheets: {} };
    for (const name of wanted.filter((n) => present.includes(n) && n !== "Préparation")) {
      await pauseForPaint();
      wb.Sheets[name] = await readExcelSheet(ctx, sheets.getItem(name), name);
    }
    // Préparation : seules les cellules désignées par les formules de Pilotage (codes projet).
    if (present.includes("Préparation") && wb.Sheets.Pilotage) {
      const prep = { "!ref": "A1:A1" }, ws = sheets.getItem("Préparation"), refs = [];
      for (const c of Object.values(wb.Sheets.Pilotage)) {
        const m = String(c?.f || "").match(/Préparation!\$?([A-Z]+)\$?(\d+)/i);
        if (m) { const r = ws.getRange(m[1] + m[2]); r.load("values,valueTypes,numberFormat"); refs.push([m[1] + m[2], r]); }
      }
      await ctx.sync();
      for (const [addr, r] of refs) { const cell = excelCell(r.values[0][0], r.valueTypes[0][0], r.numberFormat[0][0]); if (cell) prep[addr] = cell; }
      wb.Sheets["Préparation"] = prep;
    }
    return wb;
  });
}

async function readExcelSheet(ctx, ws, name) {
  const used = ws.getUsedRangeOrNullObject(true);
  used.load("rowIndex,columnIndex,rowCount,columnCount");
  await ctx.sync();
  const sheet = {};
  if (used.isNullObject) { sheet["!ref"] = "A1:A1"; return sheet; }
  const technical = TECHNICAL_SHEETS.includes(name);
  // Seules les colonnes utiles : A à V des feuilles techniques, B à D des lignes 1 à 30 de
  // Pilotage, au plus 80 colonnes ailleurs (CRU, Suivi modification IPE).
  const pilotage = name === "Pilotage";
  const lastRow = Math.min(used.rowIndex + used.rowCount, pilotage ? 30 : Infinity);
  const lastCol = technical ? 21 : pilotage ? 3 : Math.min(79, used.columnIndex + used.columnCount - 1);
  const colName = XLSX.utils.encode_col(lastCol);
  sheet["!ref"] = `A1:${colName}${lastRow}`;
  const keepFormula = pilotage;
  // Lecture par tranches : Excel limite la taille d'une réponse (5 Mo en ligne). Une tranche
  // refusée est coupée en deux, jusqu'à une ligne.
  const read = async (start, end) => {
    const range = ws.getRange(`A${start}:${colName}${end}`);
    range.load(keepFormula ? "values,valueTypes,numberFormat,formulas" : "values,valueTypes,numberFormat");
    try { await ctx.sync(); }
    catch (e) {
      if (start === end) throw e;
      const mid = Math.floor((start + end) / 2);
      await read(start, mid);
      await read(mid + 1, end);
      return;
    }
    range.values.forEach((row, i) => row.forEach((v, c) => {
      const cell = excelCell(v, range.valueTypes[i][c], range.numberFormat[i][c], keepFormula ? range.formulas[i][c] : null);
      if (cell) sheet[XLSX.utils.encode_cell({ r: start - 1 + i, c })] = cell;
    }));
  };
  const step = Math.max(20, Math.floor(EXCEL_CELLS_PER_READ / (lastCol + 1)));
  for (let start = 1; start <= lastRow; start += step) await read(start, Math.min(lastRow, start + step - 1));
  if (technical) sheet["!merges"] = await excelMerges(ctx, ws, lastRow, colName);
  return sheet;
}

// Cellules fusionnées, lues par tranches de 50 lignes, 20 tranches par échange ; si Excel
// refuse (trop de zones), chaque tranche est relue seule et coupée en deux autant que nécessaire.
async function excelMerges(ctx, ws, lastRow, colName) {
  const chunks = [], out = [];
  for (let start = 1; start <= lastRow; start += EXCEL_MERGE_ROWS) chunks.push([start, Math.min(lastRow, start + EXCEL_MERGE_ROWS - 1)]);
  const queue = (a, b) => { const z = ws.getRange(`A${a}:${colName}${b}`).getMergedAreasOrNullObject(); z.load("address"); return z; };
  const read = async (a, b) => {
    try { const z = queue(a, b); await ctx.sync(); out.push(...mergeList(z)); }
    catch (err) { if (a === b) return; const m = Math.floor((a + b) / 2); await read(a, m); await read(m + 1, b); }
  };
  for (let i = 0; i < chunks.length; i += 20) {
    const group = chunks.slice(i, i + 20);
    try {
      const zones = group.map(([a, b]) => queue(a, b));
      await ctx.sync();
      zones.forEach((z) => out.push(...mergeList(z)));
    } catch (e) {
      for (const [a, b] of group) await read(a, b);
    }
  }
  return out;
}

function mergeList(zones) {
  if (zones.isNullObject || !zones.address) return [];
  return zones.address.split(",").map((a) => a.split("!").pop().replace(/\$/g, "").trim()).filter(Boolean)
    .map((a) => XLSX.utils.decode_range(a.includes(":") ? a : `${a}:${a}`));
}

// --- Écriture des saisies ---------------------------------------------------------------

// entries : saisies de la fiche TOT (même forme que la liste « Modifications à appliquer »).
// Vérifie d'abord que chaque ligne est toujours la même TOT (Affaire, REE, OT, TOT) et que
// chaque cellule contient encore l'ancienne valeur ; sinon rien n'est écrit.
async function writeEditsToExcel(entries) {
  if (!entries.length) return { ok: true, written: 0 };
  const result = await Excel.run(async (ctx) => {
    const checks = [];
    const read = (sheet, cell) => { const r = ctx.workbook.worksheets.getItem(sheet).getRange(cell); r.load("values,valueTypes,numberFormat"); return r; };
    const text = (r) => excelText(excelCell(r.values[0][0], r.valueTypes[0][0], r.numberFormat[0][0]));
    for (const e of entries) {
      const t = data.tasks.find((x) => x.id === e.taskId);
      if (!t) return { ok: false, message: "TOT introuvable : actualisez." };
      const identity = ["affaire", "ree", "ot", "tot"].map((k) => ({ k, range: read(t.sheet, editCell(t, k)), expected: t.orig?.[k] ?? "" }));
      checks.push({ e, t, identity, target: read(t.sheet, e.cell) });
    }
    await ctx.sync();
    const conflicts = [];
    for (const c of checks) {
      if (c.identity.some((i) => status(text(i.range)) !== status(i.expected))) {
        return { ok: false, message: `La ligne ${c.t.rowNumber} de ${c.t.sheet} a changé depuis la lecture (ligne insérée ou supprimée). Rien n’a été écrit : actualisez puis recommencez.` };
      }
      const current = text(c.target);
      c.skip = status(current) === status(c.e.label);
      if (!c.skip && status(current) !== status(c.e.old)) conflicts.push(`${names[c.e.key]} (${current || "vide"} dans la DEM)`);
    }
    if (conflicts.length) return { ok: false, message: `Modifié entre-temps dans la DEM : ${conflicts.join(", ")}. Rien n’a été écrit : actualisez puis recommencez.` };
    const journal = ctx.workbook.worksheets.getItemOrNullObject(EXCEL_JOURNAL);
    const journalUsed = journal.getUsedRangeOrNullObject(true);
    journalUsed.load("rowIndex,rowCount");
    await ctx.sync();
    let next = journal.isNullObject ? 0 : journalUsed.isNullObject ? 1 : journalUsed.rowIndex + journalUsed.rowCount + 1;
    const who = mode === "ce" && me ? me : "";
    let written = 0;
    for (const c of checks.filter((x) => !x.skip)) {
      const r = c.target, e = c.e;
      if (e.type === "vide") r.clear("Contents");
      else if (e.type === "date") {
        const [y, m, d] = e.value.split("-").map(Number);
        if (r.numberFormat[0][0] === "General") r.numberFormat = [["dd/mm/yyyy"]];
        r.values = [[Date.UTC(y, m - 1, d) / DAY_MS + 25569]];
      } else r.values = [[/^[=+\-@]/.test(e.value) ? "'" + e.value : e.value]];
      if (next) journal.getRange(`A${next}:G${next}`).values = [[new Date().toISOString(), who, e.sheet, e.cell, names[e.key], e.old, e.label]], next++;
      written++;
    }
    await ctx.sync();
    return { ok: true, written };
  });
  return result;
}

// Enregistre les saisies, relit la DEM et affiche le résultat.
async function applyExcelEdits(entries, t = null) {
  $("message").innerHTML = '<div class="notice">Écriture dans la DEM…</div>';
  // Fiche figée pendant l'écriture et la relecture : pas de deuxième saisie sur des valeurs périmées.
  if ($("detail").open) $("detailBody").innerHTML = '<p class="muted">Écriture dans la DEM…</p>';
  let res;
  try { res = await writeEditsToExcel(entries); }
  catch (e) { res = { ok: false, message: `Écriture impossible : ${e.message || e}. Rien n’a été écrit.` }; }
  if (!res.ok) {
    editError = res.message; editConfirm = null;
    $("message").innerHTML = `<div class="notice error">${esc(res.message)}</div>`;
    if (t) { editMode = true; detail(t); }
    return false;
  }
  resetEdit();
  // La relecture ferme la fiche : on la rouvre sur la ligne à jour.
  const taskId = t?.id, wasOpen = $("detail").open;
  await readFromExcel({ preserveView: true });
  const fresh = taskId && data?.tasks.find((x) => x.id === taskId);
  if (fresh && wasOpen) detail(fresh);
  $("message").innerHTML = `<div class="notice">${res.written ? `${plural(res.written, "cellule")} écrite${res.written > 1 ? "s" : ""} dans la DEM.` : "Rien à écrire : la DEM contient déjà ces valeurs."}</div>`;
  return true;
}
