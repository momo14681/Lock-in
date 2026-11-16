// =============================================================================
// Saisie dans la DEM depuis le tableau de bord (volet Excel uniquement).
// La fiche d'une TOT propose « Modifier cette ligne » et la frise des jalons.
// Chaque saisie passe par un écran de confirmation, puis est écrite directement
// dans la DEM ouverte (105-excel.js) : ligne retrouvée par affaire + REE + OT + TOT,
// et cellule inchangée depuis la lecture, sinon rien n'est écrit.
// Hors d'Excel (fichier HTML ouvert seul), le tableau de bord reste en lecture.
// =============================================================================

const EDIT_FIELDS = ["totPrete", "bpa", "ger", "bpd", "j0", "mc", "rdu", "regime", "observations"];
const EDIT_CODES = {
  totPrete: ["P", "R", "PRÊT", "Renseigné"], bpa: ["P", "R", "F"], ger: [...GER_PRODUCED_CODES, ...GER_SIGNED_CODES, "R"], bpd: ["P", "R"], j0: ["Non renseigné"],
};
const EDIT_DATES = new Set(["totPrete", "bpa", "bpd", "j0"]);

// editConfirm : saisies en attente de confirmation ; editDraft : valeurs tapées, pour revenir au formulaire.
let editMode = false, editError = "", editConfirm = null, editDraft = null;

function resetEdit() {
  editMode = false; editError = ""; editConfirm = null; editDraft = null;
}

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Saisie → { type, value (écrite), label (affichage) } ou { error }.
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

function makeEdit(t, key, parsed) {
  return {
    id: `${t.id}#${key}`, taskId: t.id, key, sheet: t.sheet, row: t.rowNumber, cell: editCell(t, key),
    affaire: t.affaire, ree: t.ree, ot: t.orig?.ot ?? t.ot, tot: t.orig?.tot ?? t.tot, owner: t.responsable,
    old: t.orig?.[key] ?? "", type: parsed.type, value: parsed.value, label: parsed.label, at: new Date().toISOString(),
  };
}

// --- Frise des quatre jalons (fiche d'une TOT) ---------------------------------------
// Actions rapides selon le profil :
// - chargé d'essais : « Passer en P » quand la cellule est vide ou en R ;
// - coordo : sur une cellule en P, valider (PRÊT pour la TOT prête, date du jour pour BPA / BPD,
//   PSR / TSR / PAR pour le GER/1N) ou renvoyer en R.
const MILESTONES = [["totPrete", "TOT prête"], ["bpa", "BPA"], ["ger", "GER / 1N"], ["bpd", "BPD"]];

function milestoneDone(t, key) {
  return key === "totPrete" ? totPreteDone(t.raw[key]) : t[key + "State"] === "done";
}

function milestoneActions(t, key) {
  if (!excelMode || t.cancelled || milestoneDone(t, key)) return [];
  const s = status(t.raw[key]);
  if (mode === "ce") return !s || s === "R" ? [["P", "Passer en P"]] : [];
  const waiting = s === "P" || (key === "ger" && GER_PRODUCED_CODES.includes(s));
  if (!waiting) return [];
  const validate = key === "totPrete" ? [["PRÊT", "PRÊT"]] : key === "ger" ? [["PSR", "PSR"], ["TSR", "TSR"], ["PAR", "PAR"]] : [[formatDate(data.today), "Valider aujourd’hui"]];
  return [...validate, ["R", "R"]];
}

function milestoneTrack(t) {
  const steps = MILESTONES.map(([k, label]) => {
    const done = milestoneDone(t, k), value = String(t.raw[k] ?? "").trim();
    const actions = milestoneActions(t, k).map(([v, text]) => `<button type="button" data-milestone="${k}" data-value="${esc(v)}"${v === "R" ? ' title="À reprendre par le chargé d’essais"' : ""}>${esc(text)}</button>`).join("");
    return `<li class="${done ? "done" : value ? "started" : ""}"><span class="msLabel">${label}</span><strong>${esc(value || "à faire")}</strong>${actions ? `<span class="msActions">${actions}</span>` : ""}</li>`;
  }).join("");
  return `<ol class="msTrack" aria-label="Jalons de la TOT">${steps}</ol>`;
}

function milestoneSet(t, key, value) {
  const parsed = parseEditValue(key, value);
  if (parsed.error) return;
  editConfirm = [makeEdit(t, key, parsed)];
  detail(t);
}

// --- Formulaire « Modifier cette ligne » -----------------------------------------------

function editForm(t) {
  const rows = EDIT_FIELDS.map((k) => {
    const current = t.orig?.[k] ?? "", shown = editDraft?.[k] ?? current, codes = EDIT_CODES[k] || [];
    const options = [...(EDIT_DATES.has(k) ? [formatDate(data.today)] : []), ...codes].map((o) => `<option value="${esc(o)}"></option>`).join("");
    const input = k === "observations"
      ? `<textarea data-edit-field="${k}" rows="2">${esc(shown)}</textarea>`
      : `<input type="text" data-edit-field="${k}" value="${esc(shown)}" ${options ? `list="editList-${k}"` : ""} placeholder="${EDIT_DATES.has(k) ? "jj/mm/aaaa" : ""}${codes.length ? (EDIT_DATES.has(k) ? " ou " : "") + codes.join(", ") : ""}">${options ? `<datalist id="editList-${k}">${options}</datalist>` : ""}`;
    return `<label class="editRow${k === "observations" ? " full" : ""}"><span>${names[k]} <span class="loc">${esc(editCell(t, k))}</span></span>${input}<small class="muted">Dans la DEM : ${esc(current || "vide")}</small></label>`;
  }).join("");
  return `<div class="editIntro"><strong>Modifier cette ligne</strong><p class="muted">Les valeurs modifiées sont écrites dans la DEM après confirmation, si personne ne les a changées entre-temps.</p></div>
    ${editError ? `<div class="notice error">${esc(editError)}</div>` : ""}
    <div class="editGrid">${rows}</div>
    <div class="editActions"><button type="button" class="accent" data-edit-save>Enregistrer…</button><button type="button" class="ghost" data-edit-cancel>Annuler</button></div>`;
}

// Lit le formulaire : rien n'est écrit ici, les champs modifiés partent en confirmation.
function saveEditForm(t) {
  const entries = [], errors = [], draft = {};
  document.querySelectorAll("#detailBody [data-edit-field]").forEach((el) => {
    const key = el.dataset.editField;
    draft[key] = el.value;
    const parsed = parseEditValue(key, el.value);
    if (parsed.error) { errors.push(parsed.error); return; }
    if (status(parsed.label) !== status(t.orig?.[key] ?? "")) entries.push(makeEdit(t, key, parsed));
  });
  editDraft = draft;
  if (errors.length) { editError = errors.join(" "); detail(t); return; }
  if (!entries.length) { editError = "Aucune valeur modifiée."; detail(t); return; }
  editError = "";
  editConfirm = entries;
  detail(t);
}

// --- Confirmation avant écriture --------------------------------------------------------

function editConfirmPanel(t) {
  const n = editConfirm.length;
  return `<div class="editIntro"><strong>Écrire dans la DEM ?</strong>
      <p class="muted">${esc(t.sheet)} · ligne ${t.rowNumber} · ${plural(n, "cellule")}</p></div>
    <ul class="confirmList">${editConfirm.map((e) => `<li><span>${esc(names[e.key])} <span class="loc">${esc(e.cell)}</span></span>
      <span class="confirmChange"><span class="muted">${esc(e.old || "vide")}</span> → <strong>${esc(e.label || "vide")}</strong></span></li>`).join("")}</ul>
    <div class="editActions"><button type="button" class="accent" data-edit-confirm>Écrire dans la DEM</button><button type="button" class="ghost" data-edit-back>Annuler</button></div>`;
}

function editAction(d) {
  const current = () => data.tasks[+$("detail").dataset.task];
  if (d.editStart !== undefined) { resetEdit(); editMode = true; return detail(data.tasks[+d.editStart]), true; }
  if (d.editCancel !== undefined) { resetEdit(); return detail(current()), true; }
  if (d.editSave !== undefined) return saveEditForm(current()), true;
  if (d.milestone !== undefined) return milestoneSet(current(), d.milestone, d.value), true;
  if (d.editBack !== undefined) { editConfirm = null; return detail(current()), true; }
  if (d.editConfirm !== undefined) {
    const entries = editConfirm, t = current();
    editConfirm = null;
    return applyExcelEdits(entries, t), true;
  }
  return false;
}
