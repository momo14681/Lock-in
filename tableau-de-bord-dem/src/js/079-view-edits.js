// =============================================================================
// Saisie des mises à jour de la DEM depuis le tableau de bord.
// Le tableau de bord ne modifie jamais le classeur : chaque saisie (fiche d'une TOT,
// bouton « Modifier ») rejoint une liste mémorisée sur ce PC. La liste se relit dans
// « Modifications à appliquer », puis s'exporte en fichier texte que la macro
// AppliquerModifsDEM (module VBA téléchargeable depuis la même vue) applique dans la
// DEM après contrôle : ligne retrouvée par feuille + affaire + REE + OT + TOT, et
// valeur actuelle inchangée depuis la saisie (sinon la modification est écartée).
// =============================================================================

const EDITS_TAB = "edits";
const EDIT_FIELDS = ["totPrete", "bpa", "ger", "bpd", "j0", "mc", "rdu", "regime", "observations"];
const EDIT_CODES = {
  totPrete: ["P", "R", "Renseigné"], bpa: ["P", "R", "F"], ger: [...GER_PRODUCED_CODES, ...GER_SIGNED_CODES, "R"], bpd: ["P", "R"], j0: ["Non renseigné"],
};
const EDIT_DATES = new Set(["totPrete", "bpa", "bpd", "j0"]);
const EDIT_FILE_HEAD = ["Feuille", "Ligne", "Cellule", "Champ", "Affaire", "REE", "OT", "TOT", "Ancienne valeur", "Nouvelle valeur", "Type", "Chargé", "Saisi le"];

let editsCache = null, editsYear = "", editMode = false, editError = "";

function editsKey() {
  return "dem-essais-modifications-" + activeDEM;
}

function editList() {
  if (!editsCache || editsYear !== activeDEM) {
    editsYear = activeDEM;
    try { editsCache = JSON.parse(localStorage.getItem(editsKey()) || "[]") || []; } catch (e) { editsCache = []; }
  }
  return editsCache;
}

function saveEdits(list) {
  editsCache = list;
  try { localStorage.setItem(editsKey(), JSON.stringify(list)); } catch (e) { /* liste gardée pour cette session seulement */ }
}

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Saisie → { type, value (fichier), label (affichage) } ou { error }.
function parseEditValue(key, input) {
  // Les observations gardent leurs retours à la ligne (sinon une fiche non touchée paraîtrait modifiée).
  const v = key === "observations"
    ? String(input ?? "").replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/\s+/g, " ").trim()).join("\n").trim()
    : String(input ?? "").replace(/\s+/g, " ").trim();
  if (!v) return { type: "vide", value: "", label: "" };
  if (EDIT_DATES.has(key)) {
    const d = parseExcelDate(v);
    if (d) return { type: "date", value: isoDate(d), label: formatDate(d) };
  }
  const codes = EDIT_CODES[key];
  if (codes) {
    const code = codes.find((c) => status(c) === status(v));
    if (code) return { type: "texte", value: code, label: code };
    return { error: `${names[key]} : saisir ${EDIT_DATES.has(key) ? "une date (jj/mm/aaaa) ou " : ""}${codes.join(", ")}.` };
  }
  return { type: "texte", value: v, label: v };
}

function editCell(t, key) {
  return address(t, key).split(":")[0];
}

function editId(t, key) {
  return `${t.id}#${key}`;
}

function pendingEdit(t, key) {
  return editList().find((e) => e.id === editId(t, key)) || null;
}

// État d'une modification face à la DEM chargée.
function editState(e) {
  const t = data?.tasks.find((x) => x.id === e.taskId);
  if (!t) return { code: "missing", label: "TOT introuvable dans la DEM", tone: "bad", t: null, current: "" };
  const current = t.orig?.[e.key] ?? "";
  if (status(current) === status(e.label)) return { code: "done", label: "Déjà dans la DEM", tone: "good", t, current };
  if (status(current) !== status(e.old)) return { code: "changed", label: "Cellule modifiée depuis la saisie", tone: "warn", t, current };
  return { code: "todo", label: "À appliquer", tone: "info", t, current };
}

function editCount() {
  return data ? editList().filter((e) => editState(e).code !== "done").length : editList().length;
}

// --- Fiche d'une TOT : formulaire de saisie -------------------------------------------

function editForm(t) {
  const rows = EDIT_FIELDS.map((k) => {
    const p = pendingEdit(t, k), current = t.orig?.[k] ?? "", codes = EDIT_CODES[k] || [];
    const options = [...(EDIT_DATES.has(k) ? [formatDate(data.today)] : []), ...codes].map((o) => `<option value="${esc(o)}"></option>`).join("");
    const input = k === "observations"
      ? `<textarea data-edit-field="${k}" rows="2">${esc(p ? p.label : current)}</textarea>`
      : `<input type="text" data-edit-field="${k}" value="${esc(p ? p.label : current)}" ${options ? `list="editList-${k}"` : ""} placeholder="${EDIT_DATES.has(k) ? "jj/mm/aaaa" : ""}${codes.length ? (EDIT_DATES.has(k) ? " ou " : "") + codes.join(", ") : ""}">${options ? `<datalist id="editList-${k}">${options}</datalist>` : ""}`;
    return `<label class="editRow${k === "observations" ? " full" : ""}"><span>${names[k]} <span class="loc">${esc(editCell(t, k))}</span></span>${input}<small class="muted">Dans la DEM : ${esc(current || "vide")}</small></label>`;
  }).join("");
  const intro = excelMode ? "Les valeurs modifiées sont écrites directement dans la DEM, si personne ne les a changées entre-temps."
    : "Vos saisies rejoignent « Modifications à appliquer ». La DEM n’est modifiée qu’au passage de la macro.";
  return `<div class="editIntro"><strong>Modifier cette ligne</strong><p class="muted">${intro}</p></div>
    ${editError ? `<div class="notice error">${esc(editError)}</div>` : ""}
    <div class="editGrid">${rows}</div>
    <div class="editActions"><button type="button" class="accent" data-edit-save>${excelMode ? "Enregistrer dans la DEM" : "Ajouter aux modifications"}</button><button type="button" class="ghost" data-edit-cancel>Annuler</button></div>`;
}

function editPendingNote(t) {
  const list = EDIT_FIELDS.map((k) => pendingEdit(t, k)).filter(Boolean);
  if (!list.length) return "";
  return `<div class="editPending"><strong>${plural(list.length, "modification")} en attente pour cette ligne</strong>
    <ul>${list.map((e) => `<li>${esc(names[e.key])} : ${esc(e.old || "vide")} → <b>${esc(e.label || "vide")}</b></li>`).join("")}</ul></div>`;
}

function saveEditForm(t) {
  const list = editList().slice(), errors = [];
  let added = 0;
  document.querySelectorAll("#detailBody [data-edit-field]").forEach((el) => {
    const key = el.dataset.editField, current = t.orig?.[key] ?? "", id = editId(t, key);
    const parsed = parseEditValue(key, el.value);
    if (parsed.error) { errors.push(parsed.error); return; }
    const i = list.findIndex((e) => e.id === id);
    const same = status(parsed.label) === status(current);
    if (same) { if (i >= 0) list.splice(i, 1); return; }
    const entry = {
      id, taskId: t.id, key, sheet: t.sheet, row: t.rowNumber, cell: editCell(t, key),
      affaire: t.affaire, ree: t.ree, ot: t.orig?.ot ?? t.ot, tot: t.orig?.tot ?? t.tot, owner: t.responsable,
      old: current, type: parsed.type, value: parsed.value, label: parsed.label, at: new Date().toISOString(),
    };
    if (i >= 0) list[i] = entry; else list.push(entry);
    added++;
  });
  if (errors.length) { editError = errors.join(" "); detail(t); return; }
  // Dans Excel : écriture directe des champs de cette ligne.
  if (excelMode) { applyExcelEdits(list.filter((e) => e.taskId === t.id && !editList().includes(e)), t); return; }
  editError = "";
  editMode = false;
  saveEdits(list);
  render();
  detail(t);
  if (added) $("message").innerHTML = `<div class="notice">${plural(added, "modification")} ajoutée${added > 1 ? "s" : ""} à « Modifications à appliquer ».</div>`;
}

// --- Vue « Modifications à appliquer » ------------------------------------------------

function viewEdits() {
  const list = editList(), rows = list.map((e) => ({ e, s: editState(e) }));
  const count = (c) => rows.filter((r) => r.s.code === c).length;
  const todo = count("todo");
  const dt = dataTable({
    key: "edits", items: rows, paged: false, cls: "compact editsTable", free: true,
    empty: "Aucune modification saisie. Ouvrez une TOT (clic sur une affaire ou un REE) puis « Modifier cette ligne ».",
    columns: [
      { label: "TOT", value: (r) => `${r.e.affaire} ${r.e.ree} ${r.e.ot} ${r.e.tot}` },
      { label: "Champ", value: (r) => names[r.e.key], filter: true },
      { label: "Dans la DEM", value: (r) => (r.s.t ? r.s.current : r.e.old) },
      { label: "Nouvelle valeur", value: (r) => r.e.label },
      { label: "État", value: (r) => r.s.label, filter: true },
      { label: "Chargé", value: (r) => r.e.owner, filter: true },
      { label: "", value: () => "" },
    ],
    row: ({ e, s }) => `<tr>
      <td>${s.t ? `<button type="button" class="linkbutton" data-task="${s.t.index}">${esc(e.affaire || "Affaire manquante")} · REE ${esc(e.ree || "—")}</button>` : `<strong>${esc(e.affaire)} · REE ${esc(e.ree)}</strong>`}<small>TOT ${esc(e.ot)}-${esc(e.tot)} · ${esc(e.sheet)}!${esc(e.cell)}</small></td>
      <td>${esc(names[e.key])}</td>
      <td>${esc((s.t ? s.current : e.old) || "vide")}</td>
      <td><b class="editNew">${esc(e.label || "vide")}</b></td>
      <td>${badge(s.label, s.tone)}</td>
      <td>${esc(e.owner)}</td>
      <td><button type="button" class="ghost" data-edit-remove="${esc(e.id)}" title="Retirer cette modification">Retirer</button></td></tr>`,
  });
  const steps = excelMode ? `<ol class="editSteps">
      <li>Dans Excel, la fiche d’une TOT écrit directement dans la DEM : cette liste ne garde que les saisies faites hors d’Excel.</li>
      <li>« Écrire dans la DEM » les applique toutes, après contrôle de chaque cellule.</li>
    </ol>` : `<ol class="editSteps">
      <li>Ouvrez une TOT puis « Modifier cette ligne » : vos saisies s’ajoutent ici (mémorisées sur ce PC).</li>
      <li>Relisez la liste, puis « Télécharger le fichier pour la DEM ».</li>
      <li>Dans Excel (application de bureau), ouvrez la DEM et lancez la macro <b>AppliquerModifsDEM</b> : elle montre ce qui sera écrit, demande confirmation, puis produit un compte rendu.</li>
    </ol>`;
  $("view").innerHTML = `<div class="viewHead"><div><h2 class="viewTitle">Modifications à appliquer</h2>
      <p class="muted">DEM ${esc(activeDEM)} · ${plural(list.length, "modification")} · ${fmt(todo)} à appliquer</p></div>
      <div class="panelActions">
        ${excelMode ? `<button type="button" class="accent" data-edits-write ${todo ? "" : "disabled"}>Écrire dans la DEM</button>`
          : `<button type="button" class="accent" data-edits-export ${todo ? "" : "disabled"}>Télécharger le fichier pour la DEM</button>
        <button type="button" data-edits-macro>Télécharger la macro Excel</button>`}
      </div></div>
    ${panel("Comment ça marche", steps)}
    ${panel("Liste des modifications", dt.html, { actions: `${count("done") ? `<button type="button" class="ghost" data-edits-purge>Retirer les ${fmt(count("done"))} déjà dans la DEM</button>` : ""}${list.length ? '<button type="button" class="ghost" data-edits-clear>Tout effacer</button>' : ""}` })}`;
  currentExport = () => downloadMatrix(["Feuille", "Cellule", "Affaire", "REE", "OT", "TOT", "Champ", "Dans la DEM", "Nouvelle valeur", "État", "Chargé"],
    rows.map(({ e, s }) => [e.sheet, e.cell, e.affaire, e.ree, e.ot, e.tot, names[e.key], s.t ? s.current : e.old, e.label, s.label, e.owner]), `Modifications_DEM_${activeDEM}.csv`);
}

// Fichier lu par la macro : texte UTF-8, une modification par ligne, champs séparés par des tabulations.
function exportEdits() {
  const clean = (v) => String(v ?? "").replace(/\\/g, "\\\\").replace(/\t/g, " ").replace(/\r?\n/g, "\\n");
  const list = editList().filter((e) => editState(e).code === "todo");
  if (!list.length) return;
  const now = new Date();
  const lines = [
    ["DEM_MODIFICATIONS", "1", activeDEM, data?.fileName || "", now.toISOString()].join("\t"),
    EDIT_FILE_HEAD.join("\t"),
    ...list.map((e) => [e.sheet, e.row, e.cell, names[e.key], e.affaire, e.ree, e.ot, e.tot, e.old, e.value, e.type, e.owner, e.at.slice(0, 10)].map(clean).join("\t")),
  ];
  const who = (mode === "ce" && me ? me : "coordo").replace(/[^\p{L}\p{N}_-]+/gu, "_");
  const stamp = `${isoDate(now)}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  downloadBytes("﻿" + lines.join("\r\n") + "\r\n", "text/plain;charset=utf-8", `Modifications_DEM_${activeDEM}_${who}_${stamp}.txt`);
}

function editAction(d) {
  if (d.editStart !== undefined) { editMode = true; editError = ""; return detail(data.tasks[+d.editStart]), true; }
  if (d.editCancel !== undefined) { editMode = false; editError = ""; return detail(data.tasks[+$("detail").dataset.task]), true; }
  if (d.editSave !== undefined) return saveEditForm(data.tasks[+$("detail").dataset.task]), true;
  if (d.editRemove !== undefined) { saveEdits(editList().filter((e) => e.id !== d.editRemove)); render(); return true; }
  if (d.editsPurge !== undefined) { saveEdits(editList().filter((e) => editState(e).code !== "done")); render(); return true; }
  if (d.editsClear !== undefined) {
    if (confirm("Effacer toutes les modifications saisies sur ce PC pour cette DEM ?")) { saveEdits([]); render(); }
    return true;
  }
  if (d.editsExport !== undefined) return exportEdits(), true;
  if (d.editsWrite !== undefined) return applyExcelEdits(editList().filter((e) => editState(e).code === "todo")), true;
  if (d.editsMacro !== undefined) {
    // L'éditeur VBA importe les .bas en Windows-1252 : le module n'utilise que des caractères Latin-1.
    const src = VBA_MACRO.replace(/\r?\n/g, "\r\n");
    downloadBytes(Uint8Array.from(src, (c) => c.charCodeAt(0) & 255), "text/plain", "AppliquerModifsDEM.bas");
    return true;
  }
  return false;
}
