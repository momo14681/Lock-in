// =============================================================================
// Composants d'affichage réutilisables (chaînes HTML, valeurs échappées).
// Les interactions passent par des attributs data-* traités par délégation
// (voir 10-main.js) : data-task, data-go, data-set, data-ignore, data-page…
// =============================================================================

const TONE_ICON = { good: "✓", info: "◆", neutral: "○", warn: "▲", bad: "●" };

function badge(label, tone = "neutral", { icon = true, title = "" } = {}) {
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
