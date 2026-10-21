// =============================================================================
// Page de garde d'une TOT, sans macro dans la DEM : même règle que les macros
// LaunchPdGFromDoubleClick / Generer_PageDeGarde. La ligne CRU du REE est retrouvée
// (REE qui contient le code et finit par le préfixe de la feuille, même affaire eDIM sur
// 9 caractères), puis le modèle PdG_Type.xlsm est rempli et téléchargé.
// Le modèle (logos, chemins internes) n'est jamais intégré à la page : chacun le choisit
// une fois, il est mémorisé dans ce navigateur.
// =============================================================================

const PDG_TEMPLATE_KEY = "pdgTemplate";
const PDG_SHEET = "xl/worksheets/sheet1.xml"; // onglet « PdG » du modèle
const PDG_HEADERS = {
  ree: "REE", edim: "Référence eDIM", intitule: "Intitulé", projet: "Code Projet", mc: "N°de la MC", tot: "TOT concernée",
  ot: "N° de l'OT", rdu: "RDU", ecu: "ECU", pee: "PEE", indicePee: "Indice PEE", indiceRee: "Indice REE",
};
let pdgTemplate = null, pdgPendingTask = null;

// --- Fonctions texte des macros ---------------------------------------------------------

function pdgTrim(s) {
  return String(s ?? "").replace(/[\r\n\t ]/g, " ").replace(/^ +| +$/g, "");
}
function pdgClean(s) {
  return String(s ?? "").replace(/[^0-9A-Za-z]/g, "");
}
const vbLeft = (s, n) => String(s).slice(0, Math.max(0, n));
const vbRight = (s, n) => (n <= 0 ? "" : String(s).slice(-n));
function pdgDistinct(list) {
  const seen = new Set(), out = [];
  for (const v of list.map(pdgTrim).filter(Boolean)) if (!seen.has(v.toLowerCase())) { seen.add(v.toLowerCase()); out.push(v); }
  return out.join(", ");
}
function pdgReeCore(txt) {
  const up = txt.toUpperCase(), p1 = up.indexOf("REE"), p2 = up.indexOf("PNP");
  return p1 < 0 || p2 < 0 || p2 <= p1 + 3 ? "" : txt.slice(p1 + 3, p2).trim();
}
function pdgOwner(txt) {
  const s = String(txt ?? ""), p = s.indexOf(" - ");
  return (p >= 0 ? s.slice(0, p) : s).trim();
}

// --- Lecture de la feuille CRU (appelée au chargement de la DEM) ---------------------------

function readPdgSource(sh) {
  if (!sh) return { error: "Feuille « CRU » absente de la DEM.", rows: [] };
  const grid = XLSX.utils.sheet_to_json(sh, { header: 1, defval: null, raw: true });
  const text = (v) => (v instanceof Date ? formatDate(v) : pdgTrim(v));
  // En-têtes cherchés dans les 3 premières lignes, comme la macro.
  const col = {};
  for (const [k, h] of Object.entries(PDG_HEADERS)) {
    const target = h.toLowerCase();
    for (let r = 0; r < 3 && col[k] === undefined; r++) {
      const c = (grid[r] || []).findIndex((v) => pdgTrim(v).toLowerCase() === target);
      if (c >= 0) col[k] = c;
    }
  }
  const missing = Object.keys(PDG_HEADERS).filter((k) => col[k] === undefined);
  if (missing.length) return { error: `Colonnes introuvables dans CRU : ${missing.map((k) => PDG_HEADERS[k]).join(", ")}.`, rows: [] };
  const rows = grid.slice(1).map((r, i) => Object.fromEntries([["row", i + 2], ...Object.keys(PDG_HEADERS).map((k) => [k, text(r?.[col[k]])])]));
  return { rows };
}

// --- Valeurs de la page de garde ----------------------------------------------------------

function pdgValues(t) {
  const src = data.pdg;
  if (!src || src.error) throw Error(src?.error || "Feuille CRU non lue : actualisez la DEM.");
  const code = pdgTrim(t.orig?.ree ?? t.ree), refEDIM = pdgTrim(t.orig?.affaire ?? t.affaire), suffix = t.sheet.toUpperCase().slice(0, 3);
  if (!code) throw Error("REE vide sur cette ligne.");
  const row = src.rows.find((r) => {
    const ree = r.ree.toUpperCase();
    return ree.includes(code.toUpperCase()) && ree.endsWith(suffix) && vbLeft(pdgClean(r.edim), 9) === vbLeft(pdgClean(refEDIM), 9);
  });
  if (!row) throw Error(`Aucune ligne de CRU pour le REE « ${code} » avec l’affaire « ${refEDIM} ».`);
  const reeKey = pdgClean(row.ree);
  const totList = pdgDistinct(src.rows.filter((r) => pdgClean(r.ree) === reeKey).map((r) => r.tot));
  const tot2 = totList ? pdgDistinct(totList.split(",").map((p) => vbRight(p.trim(), 2))) : "";
  const core = pdgReeCore(row.ree), d4 = vbRight(vbLeft(row.edim, 10), 9);
  return {
    file: `PdG_${pdgClean(core)}_${vbLeft(vbRight(pdgClean(row.edim), 10), 8)}.xlsm`,
    cells: {
      D4: d4, D5: vbRight(vbLeft(row.mc, 10), 5), D6: row.ot, AJ10: row.ot, J6: tot2, AP10: tot2, J4: row.intitule,
      W1: vbLeft(row.rdu, 13), I3: vbLeft(row.ree, 3), M3: core, O3: vbLeft(vbRight(row.edim, 10), 8), S3: vbLeft(vbRight(row.edim, 2), 1),
      T3: vbRight(row.ree, 3), AA3: row.indiceRee, Y6: row.projet, E8: row.ecu, B10: row.pee, F45: pdgOwner(t.orig?.responsable ?? t.responsable),
      P38: row.pee, Z38: row.indicePee, AC46: d4, AW46: `${core}[${row.indiceRee}]`, AM3: vbLeft(row.projet, 1),
    },
  };
}

// --- Remplissage du modèle (.xlsm = archive zip) ---------------------------------------------

const PDG_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

function pdgFile(cfb, path) {
  const f = XLSX.CFB.find(cfb, "/" + path);
  if (!f) throw Error(`Modèle de page de garde non reconnu (${path} absent).`);
  return f;
}
const pdgRead = (cfb, path) => new TextDecoder().decode(pdgFile(cfb, path).content);
function pdgWrite(cfb, path, xml) {
  pdgFile(cfb, path).content = new TextEncoder().encode(xml);
}

// Écrit une valeur comme le fait la macro (Range.Value = texte) : un texte numérique devient
// un nombre, une chaîne vide vide la cellule ; la formule éventuelle est remplacée.
function pdgSetCell(doc, sheetData, ref, value) {
  const { r, c } = XLSX.utils.decode_cell(ref);
  const rows = [...sheetData.getElementsByTagNameNS(PDG_NS, "row")];
  let row = rows.find((x) => +x.getAttribute("r") === r + 1);
  if (!row) {
    row = doc.createElementNS(PDG_NS, "row");
    row.setAttribute("r", r + 1);
    sheetData.insertBefore(row, rows.find((x) => +x.getAttribute("r") > r + 1) || null);
  }
  const cells = [...row.getElementsByTagNameNS(PDG_NS, "c")];
  let cell = cells.find((x) => x.getAttribute("r") === ref);
  if (!cell) {
    cell = doc.createElementNS(PDG_NS, "c");
    cell.setAttribute("r", ref);
    row.insertBefore(cell, cells.find((x) => XLSX.utils.decode_cell(x.getAttribute("r")).c > c) || null);
  }
  while (cell.firstChild) cell.removeChild(cell.firstChild);
  cell.removeAttribute("t");
  const v = String(value ?? "");
  if (!v) return;
  if (/^-?\d+([.,]\d+)?$/.test(v.trim())) {
    const n = doc.createElementNS(PDG_NS, "v");
    n.textContent = String(Number(v.trim().replace(",", ".")));
    cell.appendChild(n);
    return;
  }
  cell.setAttribute("t", "inlineStr");
  const is = doc.createElementNS(PDG_NS, "is"), tx = doc.createElementNS(PDG_NS, "t");
  tx.setAttribute("xml:space", "preserve");
  tx.textContent = v;
  is.appendChild(tx);
  cell.appendChild(is);
}

function fillPdgTemplate(bytes, cells) {
  const cfb = XLSX.CFB.read(new Uint8Array(bytes), { type: "array" });
  const doc = new DOMParser().parseFromString(pdgRead(cfb, PDG_SHEET), "application/xml");
  const sheetData = doc.getElementsByTagNameNS(PDG_NS, "sheetData")[0];
  if (!sheetData) throw Error("Modèle de page de garde non reconnu (onglet PdG illisible).");
  for (const [ref, v] of Object.entries(cells)) pdgSetCell(doc, sheetData, ref, v);
  pdgWrite(cfb, PDG_SHEET, new XMLSerializer().serializeToString(doc));
  // Formules du modèle (Etat, n° de tranche…) recalculées à l'ouverture ; la chaîne de calcul
  // est retirée, sinon Excel signale des cellules qui n'ont plus de formule.
  pdgWrite(cfb, "xl/workbook.xml", pdgRead(cfb, "xl/workbook.xml").replace(/<calcPr\b([^>]*?)\s*\/>/, (m, a) => `<calcPr${a.replace(/\s*fullCalcOnLoad="[^"]*"/, "")} fullCalcOnLoad="1"/>`));
  if (XLSX.CFB.find(cfb, "/xl/calcChain.xml")) {
    XLSX.CFB.utils.cfb_del(cfb, "/xl/calcChain.xml");
    pdgWrite(cfb, "xl/_rels/workbook.xml.rels", pdgRead(cfb, "xl/_rels/workbook.xml.rels").replace(/<Relationship [^>]*Target="[^"]*calcChain\.xml"[^>]*\/>/, ""));
    pdgWrite(cfb, "[Content_Types].xml", pdgRead(cfb, "[Content_Types].xml").replace(/<Override [^>]*PartName="\/xl\/calcChain\.xml"[^>]*\/>/, ""));
  }
  return XLSX.CFB.write(cfb, { fileType: "zip", type: "array", compression: true });
}

// --- Modèle mémorisé et commandes ----------------------------------------------------------

function loadPdgTemplate() {
  storedSource("get", null, PDG_TEMPLATE_KEY).then((t) => { if (t?.bytes) pdgTemplate = t; }).catch(() => {});
}

function choosePdgTemplate(t = null) {
  pdgPendingTask = t;
  let input = $("pdgFile");
  if (!input) {
    input = Object.assign(document.createElement("input"), { type: "file", id: "pdgFile", accept: ".xlsm,.xlsx", hidden: true });
    input.onchange = async () => {
      const f = input.files[0];
      input.value = "";
      if (!f) return;
      pdgTemplate = { name: f.name, bytes: await f.arrayBuffer() };
      try { await storedSource("put", pdgTemplate, PDG_TEMPLATE_KEY); } catch (e) { /* gardé pour cette session */ }
      pdgNotice(`Modèle de page de garde enregistré : ${esc(f.name)}.`);
      if (pdgPendingTask) generatePdg(pdgPendingTask);
      pdgPendingTask = null;
    };
    document.body.appendChild(input);
  }
  input.click();
}

// Message dans la fiche TOT si elle est ouverte (sinon sous l'en-tête).
function pdgNotice(html, error = false) {
  const note = $("detail").open && $("pdgNote");
  if (note) { note.hidden = false; note.className = `notice${error ? " error" : ""}`; note.innerHTML = html; }
  else $("message").innerHTML = `<div class="notice${error ? " error" : ""}">${html}</div>`;
}

function generatePdg(t) {
  if (!pdgTemplate) { choosePdgTemplate(t); return; }
  try {
    const { file, cells } = pdgValues(t);
    downloadBytes(fillPdgTemplate(pdgTemplate.bytes, cells), "application/vnd.ms-excel.sheet.macroEnabled.12", file);
    pdgNotice(`Page de garde téléchargée : ${esc(file)}.`);
  } catch (e) {
    pdgNotice(`Page de garde : ${esc(e.message || e)}`, true);
  }
}

function pdgAction(d) {
  if (d.pdg !== undefined) return generatePdg(data.tasks[+d.pdg]), true;
  if (d.pdgTemplate !== undefined) return choosePdgTemplate(), true;
  return false;
}
