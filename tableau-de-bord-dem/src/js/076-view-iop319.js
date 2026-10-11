// =============================================================================
// Contrôle 1N / TSR : export EAM « IOP319 », fichier séparé de la DEM.
// Une TOT = un bloc de lignes (cellules fusionnées), une ligne par commentaire
// de clôture. Chaque TOT doit porter un commentaire « 1N » ET un commentaire
// « TSR » (colonne « Type Commentaire » ; « Etat du REE » n'est pas utilisée).
// =============================================================================

const IOP_TAB = "iop319";
const IOP_NO_STATUT = "Non renseigné";
const IOP_COLUMNS = {
  tranche: /^tr\.?$/, edim: /^reference edim/, intitule: /^intitule/, mc: /^n°\s*de la mc/, ot: /^n°\s*de l'ot/, ree: /^ree$/,
  tot: /^tot concernee/, description: /^description tache/, statut: /^statut$/, codeProjet: /^code projet/, charge: /^charge d'essais/,
  fin: /^date fin/, resultat: /^resultat/, commentType: /^type commentaire$/, auteur: /^auteur/, commentDate: /^date commentaire/, ecu: /^ecu$/,
};
const IOP_CHECKS = [["missing", "Incomplètes"], ["noTSR", "1N sans TSR"], ["no1N", "TSR sans 1N"], ["none", "Ni 1N ni TSR"], ["ok", "Complètes"], ["", "Toutes"]];
const IOP_CHECK_LABEL = { ok: "Complète", noTSR: "TSR manquant", no1N: "1N manquant", none: "1N et TSR manquants" };
const IOP_CHECK_TONE = { ok: "good", noTSR: "bad", no1N: "bad", none: "bad" };
const IOP_NO_ECU = "Non renseigné";
const IOP_COLS = { statut: 2, ecu: 3, check: 4 }; // index des colonnes filtrables du tableau

let iop = null;          // dernier export IOP319 lu (indépendant de la DEM)
let iopCheck = "missing";

function iopNorm(v) {
  return String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’`]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
}

function iopCommentKind(v) {
  const s = status(v).replace(/[\s.]/g, "");
  if (s === "1N") return "1N";
  if (s === "TSR") return "TSR";
  return s;
}

// Recopie la valeur de la cellule haut-gauche dans toute la plage fusionnée.
function fillMerges(sh) {
  for (const m of sh["!merges"] || []) {
    const top = sh[XLSX.utils.encode_cell(m.s)];
    if (!top) continue;
    for (let r = m.s.r; r <= m.e.r; r++) for (let c = m.s.c; c <= m.e.c; c++) {
      if (r === m.s.r && c === m.s.c) continue;
      sh[XLSX.utils.encode_cell({ r, c })] = { ...top };
    }
  }
}

function readIOP(wb) {
  for (const name of wb.SheetNames) {
    const sh = wb.Sheets[name];
    if (!sh || !sh["!ref"]) continue;
    fillMerges(sh);
    const rows = XLSX.utils.sheet_to_json(sh, { header: 1, defval: null, raw: true, blankrows: true });
    const hi = rows.slice(0, 80).findIndex((r) => (r || []).some((v) => IOP_COLUMNS.tot.test(iopNorm(v))) && (r || []).some((v) => IOP_COLUMNS.commentType.test(iopNorm(v))));
    if (hi < 0) continue;
    const head = rows[hi].map(iopNorm);
    const col = Object.fromEntries(Object.entries(IOP_COLUMNS).map(([k, re]) => [k, head.findIndex((h) => re.test(h))]));
    const firstRow = XLSX.utils.decode_range(sh["!ref"]).s.r + 1; // numéro de ligne Excel de rows[0]
    const byTot = new Map();
    let last = "";
    rows.slice(hi + 1).forEach((r, i) => {
      if (!r) return;
      const get = (k) => (col[k] >= 0 ? r[col[k]] : null);
      const kind = iopCommentKind(get("commentType")), auteur = text(get("auteur")), resultat = String(get("resultat") ?? "").trim();
      let tot = text(get("tot"));
      if (!tot) { if (last && (kind || auteur)) tot = last; else return; }
      last = tot;
      const row = firstRow + hi + 1 + i;
      let item = byTot.get(tot);
      if (!item) {
        item = { tot, row, comments: [] };
        byTot.set(tot, item);
      }
      // Champs TOT : première valeur non vide rencontrée dans le bloc.
      for (const k of ["tranche", "edim", "mc", "ot", "ree", "description", "statut", "codeProjet", "charge", "ecu"]) if (!item[k]) item[k] = text(get(k));
      if (!item.intitule) item.intitule = String(get("intitule") ?? "").split(/\r?\n/)[0].trim();
      if (kind || auteur || resultat) {
        const c = { kind, auteur, resultat, date: parseExcelDate(get("commentDate")), fin: parseExcelDate(get("fin")), row };
        const sig = [c.kind, c.auteur, c.resultat, c.date?.getTime()].join("|");
        if (!item.comments.some((x) => [x.kind, x.auteur, x.resultat, x.date?.getTime()].join("|") === sig)) item.comments.push(c);
      }
    });
    const list = [...byTot.values()].map((t) => {
      const n1 = t.comments.filter((c) => c.kind === "1N"), tsr = t.comments.filter((c) => c.kind === "TSR");
      const fin = t.comments.map((c) => c.fin).filter(Boolean).sort((a, b) => b - a)[0] || null;
      const [ot, n] = t.tot.split("-");
      return {
        ...t, statut: t.statut || IOP_NO_STATUT, ecu: t.ecu || IOP_NO_ECU, n1, tsr, fin, key: otTotKey(ot || t.ot, n),
        others: t.comments.filter((c) => c.kind !== "1N" && c.kind !== "TSR"),
        check: n1.length && tsr.length ? "ok" : n1.length ? "noTSR" : tsr.length ? "no1N" : "none",
      };
    });
    if (!list.length) throw Error(`Aucune TOT trouvée sous l’en-tête (feuille « ${name} », ligne ${firstRow + hi}).`);
    return { sheet: name, headerRow: firstRow + hi, rows: list, missingCols: ["statut", "auteur"].filter((k) => col[k] < 0) };
  }
  throw Error("Colonnes « TOT concernée » et « Type Commentaire » introuvables : ce fichier ne ressemble pas à un export IOP319.");
}

// Rattache chaque TOT de l'IOP319 à la ligne DEM correspondante (chargé, feuille).
function linkIOP() {
  if (!iop?.rows) return;
  const index = new Map();
  for (const t of data?.tasks || []) { if (t.cancelled) continue; const k = otTotKey(t.ot, t.tot); if (k && !index.has(k)) index.set(k, t); }
  for (const r of iop.rows) {
    r.task = index.get(r.key) || null;
    r.owner = r.task ? r.task.responsable : "Hors DEM";
  }
}

async function importIOP(file) {
  if (!file) return;
  try {
    if (!/\.(xlsx|xlsm|xls)$/i.test(file.name)) throw Error("choisissez l’export au format Excel (.xlsx ou .xls).");
    // Dates lues en numéro de série Excel (sans conversion de fuseau horaire).
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    iop = { ...readIOP(wb), fileName: file.name, importedAt: new Date() };
    tableState.iop = { search: "", open: false, filters: {} };
    iopCheck = "missing";
    page = 1;
    $("message").innerHTML = iop.missingCols.length ? `<div class="notice">Export IOP319 lu, mais colonnes absentes : ${esc(iop.missingCols.join(", "))}.</div>` : "";
  } catch (e) {
    $("message").innerHTML = `<div class="notice error">Export IOP319 non lu : ${esc(e.message)}${iop ? " Le dernier export lu reste affiché." : ""}</div>`;
  } finally {
    $("iopFile").value = "";
  }
  render();
}

function openIOP() {
  if (mode !== "coordo") { tabByMode[mode] = tab; mode = "coordo"; savePrefs(); }
  navStack.length = 0;
  tab = tabByMode.coordo = IOP_TAB;
  page = 1;
}

function iopMatches(r, k = iopCheck) {
  return !k || (k === "missing" ? r.check !== "ok" : r.check === k);
}

function iopScoped() {
  const owner = $("owner").value;
  return owner ? iop.rows.filter((r) => r.owner === owner) : iop.rows;
}

// Pastilles « État de la TOT » et « ECU » : elles pilotent les filtres des colonnes du tableau.
function iopChosen(field) {
  return tableStateFor("iop").filters[IOP_COLS[field]] || [];
}
function iopPass(r, except = "") {
  return ["statut", "ecu"].every((f) => { const c = iopChosen(f); return f === except || !c.length || c.includes(r[f]); });
}

// TOT incomplètes dans le périmètre affiché (chargé, états et ECU choisis) : pour la synthèse.
function iopMissingCount() {
  if (!iop?.rows) return 0;
  linkIOP();
  return iopScoped().filter((r) => r.check !== "ok" && iopPass(r)).length;
}

function toggleIopChip(field, value) {
  const st = tableStateFor("iop"), col = IOP_COLS[field];
  if (!value) st.filters[col] = [];
  else {
    const set = new Set(st.filters[col] || []);
    if (set.has(value)) set.delete(value); else set.add(value);
    st.filters[col] = [...set];
  }
  page = 1;
  render();
}

// Une pastille par valeur, comptée pour le contrôle choisi et les autres filtres (valeurs à 0 conservées).
function iopChipGroup(scoped, field, { title, all, name, sort }) {
  const chosen = iopChosen(field);
  const counts = new Map([...new Set([...scoped.map((r) => r[field]), ...chosen])].map((x) => [x, 0]));
  for (const r of scoped) if (iopMatches(r) && iopPass(r, field)) counts.set(r[field], counts.get(r[field]) + 1);
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const chip = (value, label, n, on) => `<button type="button" class="ecuChip${on ? " on" : ""}" data-iop-${field}="${esc(value)}" aria-pressed="${on}"><span class="ecuName">${esc(label)}</span><span class="ecuCount">${fmt(n)}</span></button>`;
  return `<div class="field iopChipGroup"><span>${esc(title)}</span><div class="ecuChips" role="group" aria-label="Filtrer : ${esc(title)}">${chip("", all, total, !chosen.length)}${[...counts.entries()].sort(sort).map(([v, n]) => chip(v, name(v), n, chosen.includes(v))).join("")}</div></div>`;
}

function iopCommentCell(list, label) {
  if (!list.length) return `<td>${badge(label + " manquant", "bad", { icon: true })}</td>`;
  const c = list[list.length - 1];
  return `<td>${badge(label + (list.length > 1 ? ` ×${list.length}` : ""), "good", { icon: true, title: c.resultat })}<small>${esc(c.auteur || "Auteur non renseigné")}${c.date ? " · " + formatDate(c.date) : ""}</small></td>`;
}

function viewIOP() {
  const intro = `L’export IOP319 (EAM) liste les commentaires de clôture de chaque TOT. Le contrôle vérifie, pour chaque TOT, la présence d’un commentaire <strong>1N</strong> et d’un commentaire <strong>TSR</strong> dans la colonne « Type Commentaire ».`;
  if (!iop) {
    $("view").innerHTML = panel("Contrôle 1N / TSR · export IOP319",
      `<div class="drop iopDrop"><h2>Chargez un export IOP319</h2><p class="muted">Fichier Excel exporté d’EAM. Vous pouvez aussi le glisser-déposer sur cette page. Il est lu sur ce PC, jamais modifié ni envoyé.</p>
        <button type="button" class="primary" data-iop-import>Choisir l’export IOP319</button></div>`, { sub: intro });
    currentExport = null;
    return;
  }
  linkIOP();
  const scoped = iopScoped(), owner = $("owner").value;
  // Les cartes et le segment suivent les états et ECU choisis ; les pastilles suivent le contrôle choisi.
  const base = scoped.filter((r) => iopPass(r));
  const n = base.length, count = (k) => base.filter((r) => iopMatches(r, k)).length;
  const chips = iopChipGroup(scoped, "statut", { title: "État de la TOT", all: "Tous les états", name: (v) => v, sort: (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "fr") })
    + iopChipGroup(scoped, "ecu", { title: "ECU", all: "Tous les ECU", name: (v) => (v === IOP_NO_ECU ? "Sans ECU" : "ECU " + v), sort: (a, b) => ecuSort(a[0], b[0]) });
  const card = (k, label, sub, tone) => {
    const v = count(k), on = iopCheck === k;
    return `<button type="button" class="kpi tone-${v && tone !== "good" ? tone : "good"}${on ? " selected" : ""}" data-set="iopCheck:${k}" aria-pressed="${on}">
      <span class="kpiLabel">${esc(label)}</span><strong class="kpiValue">${fmt(v)}</strong><span class="kpiBar" aria-hidden="true"><span style="width:${(ratio(v, n) * 100).toFixed(1)}%;background:var(--${v && tone !== "good" ? tone : "good"})"></span></span><span class="kpiSub">${esc(sub)} · ${pct(v, n)}</span></button>`;
  };
  const kpis = card("ok", "Complètes", "1N et TSR présents", "good") + card("noTSR", "TSR manquant", "1N présent", "bad") + card("no1N", "1N manquant", "TSR présent", "bad") + card("none", "1N et TSR manquants", "aucun des deux", "bad");
  const items = scoped.filter((r) => iopMatches(r));
  const dt = dataTable({
    key: "iop", items,
    tools: `<button type="button" data-iop-import>Changer d’export</button><button type="button" class="ghost" data-iop-clear>Fermer l’export</button>`,
    columns: [
      { label: "Affaire / TOT", value: (r) => `${r.edim} ${r.tot} ${r.ree} ${r.intitule}` },
      { label: "Description", value: (r) => r.description },
      { label: "État TOT", value: (r) => r.statut, filter: true },
      { label: "ECU", value: (r) => r.ecu, filter: true },
      { label: "Contrôle", value: (r) => IOP_CHECK_LABEL[r.check], filter: true },
      { label: "1N", value: (r) => r.n1.map((c) => c.auteur).join(" ") },
      { label: "TSR", value: (r) => r.tsr.map((c) => c.auteur).join(" ") },
      { label: "Chargé d’essais (DEM)", value: (r) => r.owner, filter: true },
      { label: "Fin d’essai", value: (r) => (r.fin ? formatDate(r.fin) : "") },
      { label: "Liens", value: () => "" },
    ],
    row: (r) => `<tr>
      <td>${r.task ? `<button type="button" class="linkbutton" data-task="${r.task.index}">${esc(r.edim || "—")}</button>` : `<strong>${esc(r.edim || "—")}</strong>`}<small>TOT ${esc(r.tot)}${r.ree ? " · " + esc(r.ree) : ""}</small></td>
      <td class="cruDesc">${esc(r.description || r.intitule || "—")}${r.others.length ? `<small>Autres commentaires : ${esc(r.others.map((c) => c.kind || "sans type").join(", "))}</small>` : ""}</td>
      <td>${esc(r.statut)}</td>
      <td><span class="ecuTag">${esc(r.ecu === IOP_NO_ECU ? "—" : r.ecu)}</span></td>
      <td>${badge(IOP_CHECK_LABEL[r.check], IOP_CHECK_TONE[r.check])}</td>
      ${iopCommentCell(r.n1, "1N")}${iopCommentCell(r.tsr, "TSR")}
      <td>${r.task ? esc(r.owner) : `<span class="muted" title="OT / TOT non trouvée dans les feuilles techniques de la DEM">Hors DEM</span>`}</td>
      <td>${r.fin ? formatDate(r.fin) : '<span class="muted">—</span>'}</td>
      <td>${toolLinks(...r.tot.split("-"))}</td></tr>`,
    empty: iopCheck === "ok" ? "Aucune TOT complète pour ce périmètre." : "Aucune TOT incomplète pour ce périmètre : chaque TOT a son 1N et son TSR.",
  });
  currentRows = dt.rows;
  const checkLabel = IOP_CHECKS.find(([k]) => k === iopCheck)?.[1] || "Toutes";
  $("view").innerHTML = `<div class="viewHead"><div><h2 class="viewTitle">Contrôle 1N / TSR</h2>
      <p class="muted">${esc(iop.fileName)} · ${plural(iop.rows.length, "TOT", "TOT")} · lu le ${formatFrenchDateTime(iop.importedAt)}${owner ? " · " + esc(owner) : ""}</p></div></div>
    <div class="kpis kpis-4">${kpis}</div>
    ${panel(`${esc(checkLabel)} · ${fmt(dt.rows.length)} TOT`,
      `<div class="iopFilters">${chips}</div>
       <div class="controlRow">${segment("iopCheck", IOP_CHECKS, iopCheck, { label: "Contrôle", counts: count })}</div>${dt.html}`,
      { sub: `${intro} Feuille « ${esc(iop.sheet)} », en-tête ligne ${iop.headerRow}.` })}`;
  currentExport = () => downloadMatrix(
    ["Tranche", "Référence eDIM", "Intitulé", "TOT", "REE", "Description", "État TOT", "ECU", "Contrôle", "1N présent", "Auteur 1N", "Date 1N", "Résultat 1N", "TSR présent", "Auteur TSR", "Date TSR", "Résultat TSR", "Chargé d’essais (DEM)", "Fin d’essai", "Ligne IOP319", "Lien EAM", "Lien eDRT"],
    dt.rows.map((r) => {
      const ids = totIds(...r.tot.split("-")), a = r.n1[r.n1.length - 1], b = r.tsr[r.tsr.length - 1];
      return [r.tranche, r.edim, r.intitule, r.tot, r.ree, r.description, r.statut, r.ecu === IOP_NO_ECU ? "" : r.ecu, IOP_CHECK_LABEL[r.check], a ? "Oui" : "Non", a?.auteur || "", a ? formatDate(a.date) : "", a?.resultat || "", b ? "Oui" : "Non", b?.auteur || "", b ? formatDate(b.date) : "", b?.resultat || "", r.owner, r.fin ? formatDate(r.fin) : "", r.row, ids ? eamUrl(ids) : "", ids ? edrtUrl(ids) : ""];
    }),
    "Controle_1N_TSR_IOP319.csv");
}
