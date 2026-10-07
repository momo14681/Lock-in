// =============================================================================
// TOT par ECU : feuille « CRU » (extraction des TOT, une ligne par commentaire).
// Une ligne par TOT (dernier commentaire conservé), toutes valeurs d'ECU.
// =============================================================================

const CRU_SHEET = "CRU";
const CRU_NO_ECU = "Non renseigné";

// Colonnes cherchées par leur titre (repli sur la position du modèle actuel).
const CRU_COLUMNS = {
  edim: [/^r[ée]f[ée]rence edim/i, 0], intitule: [/^intitul/i, 1], codeProjet: [/^code projet/i, 2], ree: [/^ree$/i, 11], tot: [/^tot concern/i, 16],
  description: [/^description t[âa]che/i, 17], statut: [/^statut$/i, 18], debut: [/^date d[ée]but/i, 19], fin: [/^date fin/i, 21],
  resultat: [/^r[ée]sultat/i, 22], ecu: [/^ecu$/i, 26], rdu: [/^rdu$/i, 28], commentType: [/^type commentaire/i, 29],
  auteur: [/^auteur/i, 30], commentDate: [/^date commentaire/i, 31],
};

// Clé commune DEM / CRU : OT sans zéros de tête + numéro de TOT.
function otTotKey(ot, tot) {
  const o = String(ot ?? "").replace(/\D/g, "").replace(/^0+/, ""), n = parseInt(String(tot ?? "").replace(/\D/g, ""), 10);
  return o && Number.isFinite(n) ? `${o}-${n}` : "";
}

function readCRU(sh) {
  if (!sh) return { error: `Feuille « ${CRU_SHEET} » absente du classeur.`, rows: [] };
  const rows = XLSX.utils.sheet_to_json(sh, { header: 1, defval: null, raw: true });
  const head = (rows[0] || []).map((v) => String(v ?? "").trim());
  const col = Object.fromEntries(Object.entries(CRU_COLUMNS).map(([k, [re, fallback]]) => {
    const found = head.findIndex((h) => re.test(h));
    return [k, found >= 0 ? found : fallback];
  }));
  if (!/ecu/i.test(head[col.ecu] || "") || !/tot/i.test(head[col.tot] || "")) return { error: `Colonnes « ECU » ou « TOT concernée » introuvables dans la feuille ${CRU_SHEET}.`, rows: [] };
  const byTot = new Map();
  rows.slice(1).forEach((r, i) => {
    const tot = text(r?.[col.tot]);
    if (!tot) return;
    const get = (k) => r[col[k]];
    const item = {
      row: i + 2, tot, edim: text(get("edim")), codeProjet: text(get("codeProjet")), intitule: text(get("intitule")).split(/\r?\n/)[0], ree: text(get("ree")),
      description: text(get("description")), statut: text(get("statut")) || "—",
      debut: parseExcelDate(get("debut")), fin: parseExcelDate(get("fin")),
      resultat: String(get("resultat") ?? "").trim(), ecu: text(get("ecu")) || CRU_NO_ECU, rdu: text(get("rdu")),
      commentType: text(get("commentType")), auteur: text(get("auteur")), commentDate: parseExcelDate(get("commentDate")),
      comments: 1,
    };
    const [ot, n] = tot.split("-");
    item.key = otTotKey(ot, n);
    const prev = byTot.get(tot);
    if (!prev) byTot.set(tot, item);
    else {
      // Plusieurs commentaires pour une même TOT : on garde le plus récent.
      const keep = (item.commentDate || 0) >= (prev.commentDate || 0) ? item : prev;
      keep.comments = prev.comments + 1;
      if (keep.ecu === CRU_NO_ECU) keep.ecu = item.ecu !== CRU_NO_ECU ? item.ecu : prev.ecu;
      byTot.set(tot, keep);
    }
  });
  return { rows: [...byTot.values()] };
}

// Rattache chaque TOT de la CRU à la ligne DEM correspondante (chargé, feuille).
function linkCRU(cru, tasks) {
  const index = new Map();
  for (const t of tasks) { const k = otTotKey(t.ot, t.tot); if (k && !index.has(k)) index.set(k, t); }
  for (const r of cru.rows) {
    r.task = index.get(r.key) || null;
    r.owner = r.task ? r.task.responsable : "Hors DEM";
  }
}

// TOT cochées « traitées » (passées FINI / CLÔTURÉ dans EAM) : masquées de la liste.
// Mémorisées sur ce PC, par DEM, pour survivre aux actualisations de la CRU.
const CRU_DONE_KEY = "dem-essais-cru-traitees-v1:";
let showDoneCru = false;
function cruDone() {
  try { return new Set(JSON.parse(localStorage.getItem(CRU_DONE_KEY + activeDEM) || "[]")); } catch (e) { return new Set(); }
}
function setCruDone(tot, done) {
  const set = cruDone();
  if (done) set.add(tot); else set.delete(tot);
  try { localStorage.setItem(CRU_DONE_KEY + activeDEM, JSON.stringify([...set])); }
  catch (e) { $("message").innerHTML = `<div class="notice error">Impossible de mémoriser la sélection sur ce PC (stockage du navigateur indisponible).</div>`; }
}

// TOT non actives d'après le statut CRU : masquables en un clic (choix mémorisé sur le PC).
const CRU_INACTIVE = new Set(["FINI", "CLOTURE", "SUSPENDU", "FERME"]);
const CRU_HIDE_INACTIVE_KEY = "dem-essais-cru-masquer-inactives-v1";
function isInactiveCru(r) {
  return CRU_INACTIVE.has(status(r.statut));
}
function hideInactiveCru() {
  try { return localStorage.getItem(CRU_HIDE_INACTIVE_KEY) === "1"; } catch (e) { return false; }
}
function toggleHideInactiveCru() {
  try { localStorage.setItem(CRU_HIDE_INACTIVE_KEY, hideInactiveCru() ? "0" : "1"); } catch (e) { /* choix non mémorisé */ }
  page = 1;
  render();
}

function ecuSort(a, b) {
  const na = parseInt(a, 10), nb = parseInt(b, 10);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  if (Number.isFinite(na)) return -1;
  if (Number.isFinite(nb)) return 1;
  return a.localeCompare(b, "fr");
}

function viewCRU() {
  const cru = data.cru;
  if (!cru || cru.error) { $("view").innerHTML = panel("TOT par ECU", `<p>${esc(cru?.error || "Feuille CRU non lue.")}</p>`); return; }
  const owner = $("owner").value, done = cruDone();
  const byOwner = owner ? cru.rows.filter((r) => r.owner === owner) : cru.rows;
  const hideInactive = hideInactiveCru();
  const inactiveCount = byOwner.filter((r) => isInactiveCru(r) && !done.has(r.tot)).length;
  const scoped = hideInactive ? byOwner.filter((r) => !isInactiveCru(r)) : byOwner;
  const hiddenCount = scoped.filter((r) => done.has(r.tot)).length;
  if (!hiddenCount) showDoneCru = false;
  const items = scoped.filter((r) => done.has(r.tot) === showDoneCru);
  const counts = new Map();
  for (const r of items) counts.set(r.ecu, (counts.get(r.ecu) || 0) + 1);
  const st = tableStateFor("cru"), ecuCol = 3;
  const chosen = st.filters[ecuCol] || [];
  const chips = [...counts.entries()].sort((a, b) => ecuSort(a[0], b[0])).map(([ecu, n]) => {
    const on = chosen.includes(ecu);
    return `<button type="button" class="ecuChip${on ? " on" : ""}" data-ecu="${esc(ecu)}" aria-pressed="${on}"><span class="ecuName">${ecu === CRU_NO_ECU ? "Sans ECU" : "ECU " + esc(ecu)}</span><span class="ecuCount">${fmt(n)}</span></button>`;
  }).join("");
  const dt = dataTable({
    key: "cru", items,
    tools: `${showDoneCru ? "" : `<button type="button" class="inactiveToggle${hideInactive ? " on" : ""}" data-cru-hide-inactive aria-pressed="${hideInactive}" title="TOT au statut FINI, CLÔTURÉ, SUSPENDU ou FERMÉ dans la feuille CRU">${hideInactive ? `Afficher les TOT non actives (${fmt(inactiveCount)})` : `Masquer les TOT non actives (${fmt(inactiveCount)})`}</button>`}${hiddenCount ? `<button type="button" class="ghost" data-cru-show-done>${showDoneCru ? "‹ Revenir aux TOT à suivre" : `Cochées (${fmt(hiddenCount)})`}</button>` : ""}`,
    columns: [
      { label: "Traitée", value: () => "" },
      { label: "Affaire / TOT", value: (r) => `${r.edim} ${r.tot} ${r.ree} ${r.intitule}` },
      { label: "Description", value: (r) => r.description },
      { label: "ECU", value: (r) => r.ecu, filter: true },
      { label: "Statut", value: (r) => r.statut, filter: true },
      { label: "Chargé (DEM)", value: (r) => r.owner, filter: true },
      { label: "Début", value: (r) => (r.debut ? `${MONTHS_LONG[r.debut.getMonth()]} ${r.debut.getFullYear()}` : "Sans date"), filter: true },
      { label: "Dernier commentaire", value: (r) => `${r.commentType} ${r.auteur} ${r.resultat}` },
      { label: "Liens", value: () => "" },
    ],
    row: (r) => `<tr${showDoneCru ? ' class="doneRow"' : ""}>
      <td class="checkCell"><input type="checkbox" class="doneCheck" data-cru-done="${esc(r.tot)}" ${showDoneCru ? "checked" : ""} title="${showDoneCru ? "Décocher pour réafficher cette TOT" : "Cocher une fois la TOT passée FINI ou CLÔTURÉ : elle sera masquée"}" aria-label="TOT ${esc(r.tot)} traitée"></td>
      <td>${r.task ? `<button type="button" class="linkbutton" data-task="${r.task.index}">${esc(r.edim || "—")}</button>` : `<strong>${esc(r.edim || "—")}</strong>`}<small>TOT ${esc(r.tot)}${r.ree ? " · REE " + esc(r.ree) : ""}</small></td>
      <td class="cruDesc">${esc(r.description || r.intitule || "—")}</td>
      <td><span class="ecuTag">${esc(r.ecu === CRU_NO_ECU ? "—" : r.ecu)}</span></td>
      <td>${esc(r.statut)}</td>
      <td>${r.task ? esc(r.owner) : `<span class="muted" title="OT / TOT non trouvée dans les feuilles techniques de la DEM">Hors DEM</span>`}</td>
      <td>${r.debut ? formatDate(r.debut) : '<span class="muted">—</span>'}</td>
      <td>${r.commentType || r.resultat ? `${r.commentType ? `<strong>${esc(r.commentType)}</strong> ` : ""}${r.commentDate ? formatDate(r.commentDate) : ""}<small class="obs">${esc(r.resultat || r.auteur)}</small>` : '<span class="muted">—</span>'}</td>
      <td>${toolLinks(...r.tot.split("-"))}</td></tr>`,
  });
  currentRows = dt.rows;
  $("view").innerHTML = panel(`${showDoneCru ? "TOT masquées (traitées)" : "TOT par ECU"} · ${fmt(dt.rows.length)}`,
    `<div class="ecuChips" role="group" aria-label="Filtrer par ECU">${chips}</div>${dt.html}`,
    { sub: `Feuille « ${CRU_SHEET} » · une ligne par TOT (dernier commentaire)${hideInactive && !showDoneCru ? " · TOT actives uniquement (PRÊT, EN PRÉPA, EN COURS…)" : ""}${owner ? " · " + esc(owner) : ""}` });
  currentExport = () => downloadMatrix(
    ["Référence eDIM", "Intitulé", "TOT", "REE", "Description", "ECU", "Statut", "Chargé (DEM)", "Début", "Fin", "RDU", "Type commentaire", "Auteur", "Date commentaire", "Résultat", "Ligne CRU", "Lien EAM", "Lien eDRT"],
    dt.rows.map((r) => { const ids = totIds(...r.tot.split("-")); return [r.edim, r.intitule, r.tot, r.ree, r.description, r.ecu, r.statut, r.owner, formatDate(r.debut), formatDate(r.fin), r.rdu, r.commentType, r.auteur, formatDate(r.commentDate), r.resultat, r.row, ids ? eamUrl(ids) : "", ids ? edrtUrl(ids) : ""]; }),
    "TOT_par_ECU.csv");
}

function toggleEcu(ecu) {
  const st = tableStateFor("cru"), set = new Set(st.filters[3] || []);
  if (set.has(ecu)) set.delete(ecu); else set.add(ecu);
  st.filters[3] = [...set];
  page = 1;
  render();
}
