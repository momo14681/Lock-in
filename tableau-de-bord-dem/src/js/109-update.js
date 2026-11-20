// Mise à jour du complément sans le réinstaller.
// Excel (surtout Bureau) garde la page en mémoire, parfois sans la recharger quand on ferme
// et rouvre le volet. La page compare donc sa version à version.txt (jamais en cache) au
// démarrage, à chaque retour du volet au premier plan et toutes les 30 minutes ; si une
// version plus récente est publiée, elle se recharge d'elle-même.
const APP_VERSION = "@@APP_VERSION@@";
const ONLINE_ADDIN = APP_VERSION !== "local" && /^https?:$/.test(location.protocol);

function addinBusy() {
  return busy || !!editConfirm || editMode || [...document.querySelectorAll("dialog")].some((d) => d.open);
}

let lastUpdateCheck = 0;
async function checkAddinUpdate() {
  if (!ONLINE_ADDIN || addinBusy() || Date.now() - lastUpdateCheck < 60 * 1000) return;
  lastUpdateCheck = Date.now();
  try {
    const r = await fetch(`version.txt?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return;
    const v = (await r.text()).trim();
    // Déjà rechargée pour cette version mais servie en ancienne version (cache) : pas de boucle.
    const asked = new URLSearchParams(location.search).get("v");
    if (/^[0-9a-f]{6,40}$/.test(v) && v !== APP_VERSION && v !== asked) location.replace(`app.html?v=${encodeURIComponent(v)}`);
  } catch (e) { /* hors ligne : on garde la version en cours */ }
}

if (ONLINE_ADDIN) {
  $("appVersion").hidden = false;
  $("appVersion").textContent = `version ${APP_VERSION.slice(0, 7)}`;
  $("addinReload").hidden = false;
  $("addinReload").onclick = () => location.replace(`index.html?t=${Date.now()}`);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkAddinUpdate(); });
  window.addEventListener("focus", checkAddinUpdate);
  setInterval(checkAddinUpdate, 30 * 60 * 1000);
  checkAddinUpdate();
}
