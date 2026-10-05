// =============================================================================
// Vue « Chargé d'essais » : chacun pilote ses affaires.
// =============================================================================

const AFFAIRE_STATUS = {
  late: { label: "Prépa en retard", tone: "bad", rank: 0 },
  missing: { label: "À compléter", tone: "warn", rank: 1 },
  ongoing: { label: "En préparation", tone: "neutral", rank: 2 },
  ready: { label: "Prépa terminée", tone: "info", rank: 3 },
  done: { label: "Réalisée", tone: "good", rank: 4 },
};

function milestoneStats(ts, key) {
  const done = ts.filter((t) => t[key] === "done").length;
  return { done, produced: ts.filter((t) => produced(t, key)).length };
}

// Regroupe des TOT par affaire (N° DI) avec leurs indicateurs d'avancement.
function affaireGroups(tasks, issueList = issues) {
  const today = data.today;
  const issueCount = new Map();
  for (const i of issueList) issueCount.set(i.t, (issueCount.get(i.t) || 0) + 1);
  const map = new Map();
  for (const t of tasks) {
    const key = t.affaire || "";
    if (!map.has(key)) map.set(key, { affaire: t.affaire, libelle: "", ts: [] });
    const g = map.get(key);
    g.ts.push(t);
    if (!g.libelle && t.libelle) g.libelle = t.libelle;
  }
  return [...map.values()].map((g) => {
    const ts = g.ts, n = ts.length;
    const j0s = ts.map((t) => t.j0).filter(Boolean).sort((a, b) => a - b);
    const pendingDue = ts.filter((t) => !t.prepComplete && t.prepDue && !isRealized(t)).map((t) => t.prepDue).sort((a, b) => a - b);
    Object.assign(g, {
      n,
      sheets: [...new Set(ts.map((t) => t.sheet))].sort(),
      rees: dossierCount(ts),
      prep: ts.filter((t) => t.prepComplete).length,
      realized: ts.filter(isRealized).length,
      overdue: ts.filter((t) => t.overdue).length,
      dueSoon: ts.filter((t) => t.dueSoon).length,
      missing: ts.filter((t) => t.infoMissing).length,
      noJ0: ts.filter((t) => !t.j0).length,
      issues: ts.reduce((s, t) => s + (issueCount.get(t) || 0), 0),
      bpa: milestoneStats(ts, "bpaState"),
      ger: milestoneStats(ts, "gerState"),
      bpd: milestoneStats(ts, "bpdState"),
      nextJ0: j0s.find((d) => d >= today) || j0s[j0s.length - 1] || null,
      j0Min: j0s[0] || null,
      j0Max: j0s[j0s.length - 1] || null,
      nextDue: pendingDue[0] || null,
      owners: [...new Set(ts.map((t) => t.responsable))],
    });
    g.status = g.overdue ? "late" : g.missing ? "missing" : g.realized === n ? "done" : g.prep === n ? "ready" : "ongoing";
    return g;
  }).sort((a, b) => AFFAIRE_STATUS[a.status].rank - AFFAIRE_STATUS[b.status].rank
    || (a.nextDue || a.nextJ0 || Infinity) - (b.nextDue || b.nextJ0 || Infinity)
    || a.affaire.localeCompare(b.affaire, "fr", { numeric: true }));
}

function j0Range(g) {
  if (!g.j0Min) return '<span class="muted">J0 absent</span>';
  const same = g.j0Min.getTime() === g.j0Max.getTime();
  return same ? formatDate(g.j0Min) : `${formatShortDate(g.j0Min)} → ${formatShortDate(g.j0Max)}`;
}

function milestoneMeter(stats, n, label) {
  const extra = Math.max(0, stats.produced - stats.done);
  return meter(stats.done, n, {
    extra, color: STATE_COLORS[STATE.realized],
    tipText: `${fmt(stats.done)} signés sur ${fmt(n)}\n${label} · ${fmt(stats.produced)} produits (signés, prêts ou à reprendre)`,
  });
}

function attentionBadges(g) {
  const out = [];
  if (g.overdue) out.push(badge(`${fmt(g.overdue)} en retard`, "bad"));
  if (g.dueSoon) out.push(badge(`${fmt(g.dueSoon)} sous 30 j`, "warn"));
  if (g.missing) out.push(badge(`${fmt(g.missing)} infos manquantes`, "warn"));
  if (g.issues) out.push(badge(`${plural(g.issues, "correction")}`, "info"));
  return out.join(" ") || '<span class="muted">—</span>';
}

function affaireRows(groups, { showOwner = false } = {}) {
  return groups.map((g) => {
    const open = expandedAffaires.has(g.affaire);
    const st = AFFAIRE_STATUS[g.status];
    const row = `<tr class="affaireRow${open ? " open" : ""}">
      <td><button type="button" class="expander" data-expand="${esc(g.affaire)}" aria-expanded="${open}"><span class="chev" aria-hidden="true">›</span><span><strong>${esc(g.affaire || "Affaire manquante")}</strong><small>${esc(g.libelle || "Libellé DI non renseigné")}</small></span></button>
        <div class="sheetTags">${g.sheets.map((s) => `<span class="tag phase-${dossierPhase({ sheet: s })}">${esc(s)}</span>`).join("")}</div></td>
      ${showOwner ? `<td>${esc(g.owners.join(", "))}</td>` : ""}
      <td class="num">${fmt(g.n)}<small>${plural(g.rees, "REE", "REE")}</small></td>
      <td>${j0Range(g)}${g.nextDue ? `<small>Prépa due : ${formatDate(g.nextDue)}</small>` : ""}</td>
      <td>${meter(g.prep, g.n, { color: STATE_COLORS[STATE.ready], tipText: `${fmt(g.prep)} TOT prêtes sur ${fmt(g.n)}\nPréparation documentaire (MC, OT, TOT, RDU et TOT prête)` })}</td>
      <td>${milestoneMeter(g.bpa, g.n, "BPA")}</td>
      <td>${milestoneMeter(g.ger, g.n, "GER/1N")}</td>
      <td>${milestoneMeter(g.bpd, g.n, "BPD")}</td>
      <td class="attention">${attentionBadges(g)}</td>
      <td>${badge(st.label, st.tone)}</td></tr>`;
    if (!open) return row;
    const sub = g.ts.slice().sort((a, b) => a.ree.localeCompare(b.ree, "fr", { numeric: true }) || a.rowNumber - b.rowNumber).map((t) => `<tr>
      <td><button type="button" class="linkbutton" data-task="${t.index}">${esc(t.ree || "REE absent")}</button><small>${esc(t.reeLibelle || "")}</small></td>
      <td>${esc(t.sheet)} · l.${t.rowNumber}</td>
      <td>OT ${esc(t.ot || "—")}<small>TOT ${esc(t.tot || "—")}</small></td>
      <td>${t.j0Label}<small>Prépa : ${t.prepDueLabel}</small></td>
      <td>${t.missingInfoKeys.length && !isRealized(t) ? `<span class="missingKeys">${esc(missingLabel(t))}</span>` : '<span class="muted">—</span>'}</td>
      <td>${esc(t.bpa || "—")}</td><td>${esc(t.ger || "—")}</td><td>${esc(t.bpd || "—")}</td>
      <td>${stateBadge(t)}</td></tr>`);
    const colspan = showOwner ? 10 : 9;
    return row + `<tr class="subRow"><td colspan="${colspan}">${table(["REE", "Feuille", "OT / TOT", "J0 / prépa", "À compléter", "BPA", "GER/1N", "BPD", "Statut"], sub, { cls: "compact" })}</td></tr>`;
  });
}

function affaireTableHead(showOwner) {
  return ["Affaire", ...(showOwner ? ["Chargé"] : []), { label: "TOT", cls: "num" }, "J0", "Prépa doc.", "BPA signés", "GER/1N signés", "BPD signés", "Points d’attention", "Statut"];
}

function chooseMePanel() {
  const owners = ownersList().filter((n) => n !== UNASSIGNED);
  const internal = owners.filter((n) => !PROVIDER_NAMES.has(status(n)));
  const providers = owners.filter((n) => PROVIDER_NAMES.has(status(n)));
  return `<section class="panel chooseMe"><h2>Qui êtes-vous ?</h2>
    <p class="muted">Choisissez votre nom tel qu’il apparaît dans la colonne « Chargé d’essais » de la DEM. Ce choix est mémorisé sur ce PC.</p>
    <div class="nameGrid">${internal.map((n) => `<button type="button" data-me="${esc(n)}">${esc(n)}</button>`).join("")}</div>
    ${providers.length ? `<p class="muted">Prestataires</p><div class="nameGrid">${providers.map((n) => `<button type="button" data-me="${esc(n)}">${esc(n)}</button>`).join("")}</div>` : ""}
  </section>`;
}

function meSelector() {
  const owners = ownersList();
  const options = (me && !owners.includes(me) ? [me, ...owners] : owners).map((n) => `<option ${n === me ? "selected" : ""} value="${esc(n)}">${esc(n)}</option>`).join("");
  return `<label class="meSelect"><span>Vue de</span><select data-change="me" aria-label="Chargé d’essais"><option value="">— Choisir —</option>${options}</select></label>`;
}

function todoItems(ts, myIssues) {
  const overdue = ts.filter((t) => t.overdue), dueSoon = ts.filter((t) => t.dueSoon), missing = ts.filter((t) => t.infoMissing);
  const noJ0 = ts.filter((t) => !t.j0), rework = documentRows(ts, "R"), ready = documentRows(ts, "P");
  const affairesOf = (list) => countUnique(list, (t) => t.affaire);
  return [
    { n: overdue.length, tone: "bad", title: "Préparations en retard", desc: `${plural(affairesOf(overdue), "affaire")} · l’échéance J0 − 30 est dépassée : compléter MC, OT, TOT, RDU ou « TOT prête ».`, go: "tasks:overdue" },
    { n: dueSoon.length, tone: "warn", title: "Préparations à boucler sous 30 jours", desc: `${plural(affairesOf(dueSoon), "affaire")} · échéance J0 − 30 dans le mois.`, go: "tasks:dueSoon" },
    { n: missing.length, tone: "warn", title: "Informations manquantes", desc: "GER/1N renseigné ou BPD signé alors que des informations de préparation manquent.", go: "tasks:missing" },
    { n: myIssues.length, tone: "info", title: "Corrections à faire dans la DEM", desc: "Formats, statuts non reconnus, chronologie, J0 hors période… avec la cellule à corriger.", go: "tab:issues" },
    { n: rework.length, tone: "warn", title: "Documents à reprendre (R)", desc: "BPA, GER/1N, BPD ou TOT prête retournés pour reprise.", go: "documents:R" },
    { n: ready.length, tone: "info", title: "Documents prêts à valider (P)", desc: "En attente de validation ou de signature.", go: "documents:P" },
    { n: noJ0.length, tone: "neutral", title: "TOT sans J0 exploitable", desc: "Sans J0, l’échéance de préparation ne peut pas être calculée.", go: "tasks:noJ0" },
  ].filter((item) => item.n > 0);
}

function todoPanel(ts, myIssues) {
  const items = todoItems(ts, myIssues);
  const body = items.length
    ? `<ul class="todo">${items.map((i) => `<li><button type="button" data-go="${i.go}" class="todoItem tone-${i.tone}">
        <span class="todoCount">${fmt(i.n)}</span><span class="todoText"><strong>${esc(i.title)}</strong><span>${esc(i.desc)}</span></span><span class="todoGo" aria-hidden="true">›</span></button></li>`).join("")}</ul>`
    : emptyState("Aucune action en attente", "Toutes vos TOT du périmètre sont à jour.");
  return panel("À traiter", body, { sub: "Par ordre de priorité · cliquez pour ouvrir la liste correspondante", cls: "todoPanel" });
}

function teamMiniPanel(myTs) {
  const team = filteredBy("");
  const n = team.length, mine = myTs.length;
  const row = (label, myValue, teamValue, color) => `<div class="compareRow">
      <span>${esc(label)}</span>
      <div class="compareBars">
        <span class="compareLine"><b>Moi</b><span class="meterTrack"><span style="width:${(myValue * 100).toFixed(1)}%;background:${color}"></span></span><em>${Math.round(myValue * 100)} %</em></span>
        <span class="compareLine"><b>Équipe</b><span class="meterTrack"><span style="width:${(teamValue * 100).toFixed(1)}%;background:var(--ink-3)"></span></span><em>${Math.round(teamValue * 100)} %</em></span>
      </div></div>`;
  const body = `${row("Essais réalisés", ratio(myTs.filter(isRealized).length, mine), ratio(team.filter(isRealized).length, n), STATE_COLORS[STATE.realized])}
    ${row("Préparation documentaire", ratio(myTs.filter((t) => t.prepComplete).length, mine), ratio(team.filter((t) => t.prepComplete).length, n), STATE_COLORS[STATE.ready])}
    <p class="muted teamLate">Équipe : <strong>${fmt(team.filter((t) => t.overdue).length)}</strong> TOT en retard de préparation · <strong>${fmt(n)}</strong> TOT au total</p>
    <button type="button" class="linkbutton" data-go="tab:team">Voir l’avancement de l’équipe ›</button>`;
  return panel("Mon avancement / l’équipe", body, { sub: "Mêmes feuilles et recherche, tous les chargés", cls: "teamMini" });
}

function viewMine() {
  if (!me) { $("view").innerHTML = chooseMePanel(); return; }
  const ts = visible, n = ts.length;
  const groups = affaireGroups(ts);
  const realized = ts.filter(isRealized).length, prepared = ts.filter((t) => t.prepComplete).length;
  const overdue = ts.filter((t) => t.overdue).length, dueSoon = ts.filter((t) => t.dueSoon).length;
  const lateAffaires = groups.filter((g) => g.overdue).length;
  const kpis = [
    kpi({ label: "Mes affaires", value: fmt(groups.length), sub: `${plural(dossierCount(ts), "REE", "REE")} · ${plural(n, "TOT", "TOT")}`, go: "tasks:" }),
    kpi({ label: "Préparation documentaire", value: pct(prepared, n), sub: `${fmt(prepared)} / ${fmt(n)} TOT prêtes`, bar: { ratio: ratio(prepared, n), color: STATE_COLORS[STATE.ready] }, go: "tasks:prepared" }),
    kpi({ label: "Essais réalisés", value: pct(realized, n), sub: `${fmt(realized)} / ${fmt(n)} TOT · GER/1N signé`, bar: { ratio: ratio(realized, n), color: STATE_COLORS[STATE.realized] }, go: "tasks:realized" }),
    kpi({ label: "Prépas en retard", value: fmt(overdue), sub: overdue ? `${plural(lateAffaires, "affaire")} concernée${lateAffaires > 1 ? "s" : ""}` : "aucun retard", tone: overdue ? "bad" : "good", go: "tasks:overdue" }),
    kpi({ label: "Échéances sous 30 j", value: fmt(dueSoon), sub: "préparations à boucler", tone: dueSoon ? "warn" : "", go: "tasks:dueSoon" }),
    kpi({ label: "Corrections DEM", value: fmt(issues.length), sub: "signalements sur mes TOT", tone: issues.length ? "warn" : "good", go: "tab:issues" }),
  ].join("");

  const head = `<div class="viewHead"><div><h2 class="viewTitle">Mes affaires</h2><p class="muted">${esc(scopeLabel())} · ${esc(periodLabel())}</p></div>${meSelector()}</div>`;
  const table_ = n
    ? table(affaireTableHead(false), affaireRows(groups), { cls: "affaires", free: true })
    : emptyState("Aucune TOT pour ce chargé dans le périmètre", "Vérifiez les filtres de feuilles et la recherche.");
  const allOpen = groups.length && groups.every((g) => expandedAffaires.has(g.affaire));
  const actions = `<button type="button" data-expand-all="${allOpen ? "close" : "open"}">${allOpen ? "Tout replier" : "Tout déplier"}</button>${exportButton()}`;
  $("view").innerHTML = `${head}<div class="kpis kpis-6">${kpis}</div>
    <div class="split">${todoPanel(ts, issues)}${teamMiniPanel(ts)}</div>
    ${panel(`Suivi par affaire · ${plural(groups.length, "affaire")}`, `${legend([["Signés", STATE_COLORS[STATE.realized]], ["Produits, non signés", "rgba(20,147,108,.35)"]])}${table_}`,
      { sub: "Triées par urgence : retards, informations manquantes, puis prochaines échéances. Cliquez sur une affaire pour voir ses REE et TOT.", actions })}`;
  currentExport = () => downloadMatrix(
    ["Affaire", "Libellé DI", "Feuilles", "TOT", "REE", "J0 min", "J0 max", "Prochaine échéance prépa", "Prépa terminée", "BPA signés", "BPA produits", "GER/1N signés", "GER/1N produits", "BPD signés", "BPD produits", "Prépas en retard", "Infos manquantes", "Corrections DEM", "Statut"],
    groups.map((g) => [g.affaire, g.libelle, g.sheets.join(" "), g.n, g.rees, formatDate(g.j0Min), formatDate(g.j0Max), formatDate(g.nextDue), g.prep, g.bpa.done, g.bpa.produced, g.ger.done, g.ger.produced, g.bpd.done, g.bpd.produced, g.overdue, g.missing, g.issues, AFFAIRE_STATUS[g.status].label]),
    `Mes_affaires_${me.replace(/[^\p{L}\p{N}_-]+/gu, "_")}.csv`);
}
