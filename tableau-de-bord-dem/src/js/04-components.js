// =============================================================================
// Composants d'affichage réutilisables (chaînes HTML, valeurs échappées).
// Les interactions passent par des attributs data-* traités par délégation
// (voir 10-main.js) : data-task, data-go, data-set, data-ignore, data-page…
// =============================================================================

const TONE_ICON = { good: "✓", info: "◆", neutral: "○", warn: "▲", bad: "●" };

function badge(label, tone = "neutral", { icon = false, title = "" } = {}) {
  return `<span class="badge tone-${tone}"${title ? ` title="${esc(title)}"` : ""}>${icon ? `<span aria-hidden="true">${TONE_ICON[tone] || ""}</span>` : ""}${esc(label)}</span>`;
}

function stateBadge(t) {
  const s = state(t);
  return badge(s, STATE_TONE[s] || "neutral");
}

function tip(label, content) {
  return `<span class="help"><button type="button" class="helpButton" aria-label="${esc(label)} : ${esc(content)}">?</button><span class="helpText" role="tooltip">${esc(content)}</span></span>`;
}

// Carte indicateur. `go` rend la carte cliquable (navigation data-go).
function kpi({ label, value, sub = "", tone = "", go = "", bar = null, hint = "" }) {
  const tag = go ? "button" : "div";
  const meterHtml = bar ? `<span class="kpiBar" aria-hidden="true"><span style="width:${(bar.ratio * 100).toFixed(1)}%;background:${bar.color}"></span></span>` : "";
  return `<${tag} ${go ? `type="button" data-go="${esc(go)}"` : ""} class="kpi${tone ? " tone-" + tone : ""}"${hint ? ` title="${esc(hint)}"` : ""}>
    <span class="kpiLabel">${esc(label)}</span><strong class="kpiValue">${esc(value)}</strong>${meterHtml}<span class="kpiSub">${esc(sub)}</span></${tag}>`;
}

// Mini-jauge : `done` en couleur pleine, `extra` (produit non signé) en clair.
function meter(done, total, { extra = 0, color = "var(--good)", tipText = "", showLabel = true } = {}) {
  if (!total) return '<span class="muted">—</span>';
  const a = ratio(done, total) * 100, b = ratio(extra, total) * 100;
  return `<span class="meter" ${tipText ? `data-tip="${esc(tipText)}" tabindex="0"` : ""}>
    <span class="meterTrack"><span style="width:${a.toFixed(1)}%;background:${color}"></span>${extra ? `<span class="meterExtra" style="width:${b.toFixed(1)}%;background:${color}"></span>` : ""}</span>
    ${showLabel ? `<span class="meterLabel">${fmt(done)}<span class="muted">/${fmt(total)}</span></span>` : ""}</span>`;
}

function table(head, rows, { cls = "", empty = "Aucun résultat pour ce périmètre.", free = false } = {}) {
  const th = head.map((h) => typeof h === "string" ? `<th>${h}</th>` : `<th class="${h.cls || ""}">${h.label}</th>`).join("");
  const body = rows.join("") || `<tr><td colspan="${head.length}" class="emptyCell">${esc(empty)}</td></tr>`;
  return `<div class="tableWrap${free ? " free" : ""}"><table class="${cls}"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function paginate(rows) {
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  page = Math.min(Math.max(1, page), pages);
  return { slice: rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), pages, total: rows.length };
}

function pager({ pages, total }) {
  if (pages <= 1) return `<div class="pagination"><span class="muted">${plural(total, "ligne")}</span></div>`;
  return `<div class="pagination"><span class="muted">${plural(total, "ligne")}</span>
    <button type="button" data-page="prev" ${page === 1 ? "disabled" : ""}>‹ Précédent</button>
    <span>Page ${page} / ${pages}</span>
    <button type="button" data-page="next" ${page === pages ? "disabled" : ""}>Suivant ›</button></div>`;
}

// Bouton-filtre (segment) qui modifie une variable d'état via data-set.
function segment(variable, options, current, { label = "", counts = null } = {}) {
  return `<div class="segmented" role="group"${label ? ` aria-label="${esc(label)}"` : ""}>${options.map(([value, text]) => {
    const active = value === current;
    const count = counts ? ` <span class="count">${fmt(counts(value))}</span>` : "";
    return `<button type="button" data-set="${variable}:${esc(value)}" class="${active ? "active" : ""}" aria-pressed="${active}">${esc(text)}${count}</button>`;
  }).join("")}</div>`;
}

function panel(title, body, { sub = "", actions = "", cls = "", help = "" } = {}) {
  return `<section class="panel ${cls}">
    <div class="panelHead"><div><h2>${title}${help ? " " + help : ""}</h2>${sub ? `<p class="panelSub">${sub}</p>` : ""}</div>${actions ? `<div class="panelActions">${actions}</div>` : ""}</div>
    ${body}</section>`;
}

// L'export CSV passe par le menu « Exporter » de la barre d'onglets.
function exportButton() {
  return "";
}

function taskLink(t) {
  return `<button type="button" class="linkbutton" data-task="${t.index}">${esc(t.affaire || "Affaire manquante")}</button><small>REE ${esc(t.ree || "absent")} · ${esc(t.sheet)} · ligne ${t.rowNumber}</small>`;
}

function observationCell(t) {
  const value = observations(t);
  return `<td class="observation">${value ? esc(value) : '<span class="muted">—</span>'}</td>`;
}

function emptyState(title, content = "") {
  return `<div class="emptyState"><strong>${esc(title)}</strong>${content ? `<p>${content}</p>` : ""}</div>`;
}

function legend(entries) {
  return `<div class="legend">${entries.map(([label, color]) => `<span><i style="background:${color}"></i>${esc(label)}</span>`).join("")}</div>`;
}

// Infobulle unique, positionnée près du pointeur ou de l'élément ciblé.
function initTooltip() {
  const tipEl = $("tooltip");
  const place = (x, y) => {
    const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    tipEl.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, x + 14)) + "px";
    tipEl.style.top = Math.max(8, y - h - 12 < 8 ? y + 18 : y - h - 12) + "px";
  };
  const show = (el, x, y) => {
    tipEl.replaceChildren(...el.dataset.tip.split("\n").map((line, i) => {
      const node = document.createElement(i === 0 ? "strong" : "span");
      node.textContent = line;
      return node;
    }));
    tipEl.hidden = false;
    place(x, y);
  };
  document.addEventListener("pointermove", (e) => {
    const el = e.target.closest?.("[data-tip]");
    if (!el) { tipEl.hidden = true; return; }
    show(el, e.clientX, e.clientY);
  });
  document.addEventListener("focusin", (e) => {
    const el = e.target.closest?.("[data-tip]");
    if (!el) return;
    const r = el.getBoundingClientRect();
    show(el, r.left + r.width / 2, r.top);
  });
  document.addEventListener("focusout", () => { tipEl.hidden = true; });
  document.addEventListener("scroll", () => { tipEl.hidden = true; }, true);
}

// --- Tableau filtrable : loupe (recherche) + filtre par colonne ----------------------
// columns : [{ label, value: (item) => texte (recherche/filtre), filter: true|false, cls }]
// row : (item) => "<tr>…</tr>". La recherche et les filtres s'appliquent à toutes les
// lignes, avant la pagination. L'état est conservé par tableau (clé `key`).
const tableState = {};
let tableFocus = null;
let openColFilter = null; // menu de filtre resté ouvert pendant qu'on coche

const ICON_SEARCH = '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M15.5 15.5 21 21" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';

function tableStateFor(key) {
  return (tableState[key] ||= { search: "", open: false, filters: {} });
}

function filterRows(key, columns, items) {
  const st = tableStateFor(key);
  const q = st.search.trim().toLowerCase();
  return items.filter((it) => columns.every((c, i) => !c.filter || !st.filters[i]?.length || st.filters[i].includes(String(c.value(it) ?? "")))
    && (!q || columns.some((c) => c.value && String(c.value(it) ?? "").toLowerCase().includes(q))));
}

function dataTable({ key, columns, items, row, paged = true, cls = "", empty = "Aucun résultat.", free = false, tools = "", limit = Infinity }) {
  const st = tableStateFor(key);
  const rows = filterRows(key, columns, items);
  const p = paged ? paginate(rows) : { slice: rows.slice(0, limit), pages: 1, total: rows.length };
  const active = st.search.trim() || Object.values(st.filters).some((v) => v?.length);
  const head = columns.map((c, i) => {
    if (!c.filter) return { label: c.label, cls: c.cls };
    const values = [...new Set(items.map((it) => String(c.value(it) ?? "")))].filter(Boolean).sort((a, b) => a.localeCompare(b, "fr", { numeric: true }));
    // Filtre à choix multiples : cases à cocher dans un petit menu déroulant.
    const chosen = st.filters[i] || [];
    const id = `${key}:${i}`;
    const summary = !chosen.length ? "Tous" : chosen.length === 1 ? chosen[0] : `${chosen.length} choix`;
    const menu = `<details class="menu colMenu${chosen.length ? " on" : ""}" data-col-menu="${esc(id)}"${openColFilter === id ? " open" : ""}>
        <summary title="Filtrer ${esc(c.label)}">${esc(summary)}</summary>
        <div class="menuBody colMenuBody">
          <button type="button" class="ghost" data-table-clear="${esc(id)}">Tout afficher</button>
          ${values.map((v) => `<label class="check"><input type="checkbox" data-table-check="${esc(id)}" value="${esc(v)}" ${chosen.includes(v) ? "checked" : ""}> ${esc(v)}</label>`).join("")}
        </div></details>`;
    return { label: `<span class="thLabel">${c.label}</span>${menu}`, cls: (c.cls || "") + " filterable" };
  });
  const bar = `<div class="tableTools">
      <button type="button" class="iconButton${st.open || st.search ? " on" : ""}" data-table-toggle="${esc(key)}" title="Rechercher dans ce tableau" aria-label="Rechercher dans ce tableau">${ICON_SEARCH}</button>
      ${st.open || st.search ? `<input type="search" class="tableSearch" data-table-search="${esc(key)}" value="${esc(st.search)}" placeholder="Rechercher dans ce tableau…">` : ""}
      ${active ? `<span class="muted">${plural(rows.length, "résultat")} sur ${fmt(items.length)}</span><button type="button" class="ghost" data-table-reset="${esc(key)}">Effacer</button>` : ""}
      <span class="toolsRight">${tools}</span></div>`;
  return { rows, html: bar + table(head, p.slice.map(row), { cls, empty: active ? "Aucun résultat pour cette recherche ou ce filtre." : empty, free }) + (paged ? pager(p) : "") };
}

// Après un nouveau rendu, rend le focus au champ de recherche en cours de saisie.
function restoreTableFocus() {
  if (!tableFocus) return;
  const input = document.querySelector(`[data-table-search="${CSS.escape(tableFocus)}"]`);
  if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
}

// Les menus de filtre sont dans des tableaux défilants : on les place au-dessus de la page.
function positionColMenus() {
  document.querySelectorAll(".colMenu[open]").forEach((menu) => {
    const r = menu.querySelector("summary").getBoundingClientRect(), body = menu.querySelector(".colMenuBody");
    body.style.top = Math.min(r.bottom + 4, window.innerHeight - 120) + "px";
    body.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 240)) + "px";
    body.style.maxHeight = Math.max(160, window.innerHeight - r.bottom - 24) + "px";
  });
}
