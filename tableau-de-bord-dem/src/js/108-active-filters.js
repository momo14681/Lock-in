// Filtres actifs : bandeau sous les onglets, chaque filtre avec sa croix, et « Tout effacer ».
// Un clic dans un tableau (tranche, chargé, affaire) peut poser un filtre : il reste visible ici.
function defaultJ0Years() {
  return [+activeDEM];
}

function activeFilterChips() {
  const chips = [];
  for (const s of selectedSheets) chips.push({ label: `Feuille ${s}`, clear: `sheet:${s}` });
  const years = [...selectedJ0Years].sort();
  if (years.join() !== defaultJ0Years().join()) chips.push({ label: `J0 ${years.length ? years.join(", ") : "toutes années"}`, clear: "j0" });
  if (mode === "coordo" && $("owner").value) chips.push({ label: `Chargé : ${$("owner").value}`, clear: "owner" });
  if (tab === "tasks" && taskScope) chips.push({ label: `Affaire ${taskScope.affaire || "manquante"}${taskScope.kind === "dossiers" ? " / REE " + taskScope.ree : ""}`, clear: "scope" });
  for (const b of $("view").querySelectorAll("[data-table-reset]")) {
    const st = tableState[b.dataset.tableReset];
    if (!st) continue;
    const values = Object.values(st.filters || {}).flat();
    const parts = [...(st.search ? [`« ${st.search} »`] : []), ...values.slice(0, 2), ...(values.length > 2 ? [`+${values.length - 2}`] : [])];
    chips.push({ label: `Tableau : ${parts.join(", ")}`, clear: `table:${b.dataset.tableReset}` });
  }
  return chips;
}

function renderActiveFilters() {
  const chips = activeFilterChips(), box = $("activeFilters");
  box.hidden = !chips.length;
  box.innerHTML = chips.length
    ? `<span class="activeFiltersLabel">Filtré par</span>${chips.map((c) => `<button type="button" class="filterChip" data-clear-filter="${esc(c.clear)}" title="Retirer ce filtre">${esc(c.label)}<span aria-hidden="true">×</span></button>`).join("")}${chips.length > 1 ? '<button type="button" class="filterClearAll" data-clear-filter="all">Tout effacer</button>' : ""}`
    : "";
}

function clearFilter(spec) {
  const cut = spec.indexOf(":"), kind = cut < 0 ? spec : spec.slice(0, cut), arg = cut < 0 ? "" : spec.slice(cut + 1);
  if (kind === "sheet") selectedSheets.delete(arg);
  if (kind === "j0" || kind === "all") { selectedJ0Years.clear(); defaultJ0Years().forEach((y) => selectedJ0Years.add(y)); updateJ0YearButtons(); }
  if (kind === "owner") $("owner").value = "";
  if (kind === "scope") taskScope = null;
  if (kind === "table") tableState[arg] = { search: "", open: false, filters: {} };
  if (kind === "all") {
    for (const b of $("view").querySelectorAll("[data-table-reset]")) tableState[b.dataset.tableReset] = { search: "", open: false, filters: {} };
    return resetFilters();
  }
  page = 1;
  render();
}
