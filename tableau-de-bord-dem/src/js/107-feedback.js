// Idée / bug : fenêtre de saisie, puis message prêt dans la messagerie (mailto).
// L'adresse est assemblée ici pour ne pas apparaître en clair dans la page publiée.
const FEEDBACK_TO = ["mohamed.el-kourachi", ["edf", "fr"].join(".")].join("@");
let feedbackKind = "Amélioration";

const feedbackContext = () => [
  `Profil : ${mode === "coordo" ? "Coordo essais" : "Chargé d’essais"}`,
  `Écran : ${document.querySelector("[data-tab][aria-current=page]")?.firstChild?.textContent?.trim() || tab}`,
  `Ouvert dans : ${excelMode ? "complément Excel" : "fichier HTML"}`,
  `Date : ${new Date().toLocaleString("fr-FR")}`,
].join("\n");

const feedbackMessage = () => {
  const text = $("feedbackText").value.trim();
  return {
    text,
    subject: `[Pilotage des essais] ${feedbackKind}`,
    body: `${text}\n\n---\n${feedbackContext()}`,
  };
};

function updateFeedback() {
  const { text, subject, body } = feedbackMessage();
  const send = $("feedbackSend");
  send.setAttribute("aria-disabled", text ? "false" : "true");
  send.href = text
    ? `mailto:${FEEDBACK_TO}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body.replace(/\n/g, "\r\n"))}`
    : "#";
  $("feedbackCopy").disabled = !text;
}

function openFeedback() {
  $("feedbackNote").textContent = "";
  updateFeedback();
  $("feedback").showModal();
  $("feedbackText").focus();
}

$("feedbackOpen").onclick = openFeedback;
$("closeFeedback").onclick = () => $("feedback").close();
$("feedbackText").addEventListener("input", updateFeedback);
$("feedbackKind").addEventListener("click", (event) => {
  const button = event.target.closest("[data-fb-kind]");
  if (!button) return;
  feedbackKind = button.dataset.fbKind;
  for (const b of $("feedbackKind").querySelectorAll("[data-fb-kind]")) {
    const on = b === button;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", String(on));
  }
  updateFeedback();
});
$("feedbackSend").addEventListener("click", (event) => {
  if (!feedbackMessage().text) { event.preventDefault(); return; }
  $("feedbackNote").textContent = "Ta messagerie s’ouvre avec le message prêt. Il ne reste qu’à cliquer sur Envoyer. Si rien ne s’ouvre, utilise Copier le message.";
});
$("feedbackCopy").onclick = async () => {
  const { subject, body } = feedbackMessage();
  const all = `À : ${FEEDBACK_TO}\nObjet : ${subject}\n\n${body}`;
  try {
    await navigator.clipboard.writeText(all);
  } catch {
    const area = document.createElement("textarea");
    area.value = all; document.body.append(area); area.select();
    document.execCommand("copy"); area.remove();
  }
  $("feedbackNote").textContent = `Message copié. Colle-le dans un mail à ${FEEDBACK_TO}.`;
};
