/**
 * DEM_PowerApps : lecture et écriture de la DEM pour l'appli Power Apps « Pilotage des essais ».
 * Script Office appelé par le flux Power Automate « DEM_PowerApps » (action Exécuter un script).
 * Fonctionne sur la DEM telle quelle (.xlsm accepté, cellules fusionnées, mise en forme intacte).
 *
 *   action "lire"   : renvoie {lu, lignes: [...]}, une ligne par TOT des feuilles CSxx.
 *   action "ecrire" : donnees = {feuille, ligne, affaire, ree, ot, tot, utilisateur,
 *                     champs: [{colonne, ancienne, nouvelle}]}. Retrouve la ligne par
 *                     Affaire / REE / OT / TOT, n'écrit que si chaque cellule contient encore
 *                     l'ancienne valeur (sinon rien n'est écrit), renvoie {ok, message, ligne}.
 * Si la DEM contient une feuille « Journal appli », chaque écriture y est ajoutée.
 */

const FEUILLES: string[] = ["CS0M", "CS1M", "CS1A", "CS2M", "CS2A", "CS3M", "CS3A", "CS4A", "CS4M", "CS8M", "CS9M"];
const DERNIERE_COLONNE: string = "V";
const NB_COLONNES: number = 22;
// Colonne de la DEM (0 = A) pour chaque champ de l'appli.
const COLONNES: { [champ: string]: number } = {
  Affaire: 0, Libelle: 1, REE: 3, Titulaire: 4, LibelleREE: 5, MC: 8, OT: 9, TOT: 10, RDU: 11,
  Charge: 12, TOTPrete: 13, J0: 14, Regime: 15, BPA: 16, GER1N: 17, BPD: 18, Observations: 21,
};
// Colonnes où un nombre est une date Excel (affichée jj/mm/aaaa quel que soit le format de la cellule).
const DATES: string[] = ["TOTPrete", "J0", "BPA", "GER1N", "BPD"];
const MODIFIABLES: string[] = ["TOTPrete", "BPA", "GER1N", "BPD", "J0", "MC", "RDU", "Regime", "Observations"];

interface Champ { colonne: string; ancienne: string; nouvelle: string; }
interface Demande { feuille: string; ligne: number; affaire: string; ree: string; ot: string; tot: string; utilisateur: string; champs: Champ[]; }

function main(workbook: ExcelScript.Workbook, action: string, donnees: string): string {
  if (action === "lire") return lire(workbook);
  if (action === "ecrire") return ecrire(workbook, JSON.parse(donnees) as Demande);
  return JSON.stringify({ ok: false, message: "Action inconnue : " + action });
}

// --- Lecture ------------------------------------------------------------------------------

function lire(workbook: ExcelScript.Workbook): string {
  const lignes: { [champ: string]: string | number }[] = [];
  for (const nom of FEUILLES) {
    const ws: ExcelScript.Worksheet | undefined = workbook.getWorksheet(nom);
    if (!ws) continue;
    const grille: string[][] = lireFeuille(ws);
    grille.forEach((t: string[], i: number) => {
      if (!["Affaire", "REE", "OT", "TOT"].some((k: string) => t[COLONNES[k]] !== "")) return;
      const o: { [champ: string]: string | number } = { Cle: nom + "-" + (i + 2), Num: lignes.length + 1, Feuille: nom, Ligne: i + 2 };
      for (const k of Object.keys(COLONNES)) o[k] = t[COLONNES[k]];
      lignes.push(o);
    });
  }
  return JSON.stringify({ lu: new Date().toISOString(), lignes: lignes });
}

// Textes A2:V(dernière ligne) d'une feuille, cellules fusionnées recopiées depuis leur coin
// supérieur gauche, dates des colonnes de dates en jj/mm/aaaa.
function lireFeuille(ws: ExcelScript.Worksheet): string[][] {
  const utilisee: ExcelScript.Range | undefined = ws.getUsedRange(true);
  if (!utilisee) return [];
  const derniere: number = utilisee.getRowIndex() + utilisee.getRowCount();
  if (derniere < 2) return [];
  const plage: ExcelScript.Range = ws.getRange("A2:" + DERNIERE_COLONNE + derniere);
  const textes: string[][] = plage.getTexts();
  const valeurs: (string | number | boolean)[][] = plage.getValues();
  const grille: string[][] = textes.map((ligne: string[], r: number) => ligne.map((txt: string, c: number) => texte(valeurs[r][c], txt, c)));
  const fusions: ExcelScript.RangeAreas | undefined = plage.getMergedAreasOrNullObject();
  if (fusions) {
    const zones: ExcelScript.Range[] = fusions.getAreas();
    for (const zone of zones) {
      const r0: number = zone.getRowIndex() - 1;
      const c0: number = zone.getColumnIndex();
      if (r0 < 0 || c0 >= NB_COLONNES) continue;
      const v: string = grille[r0][c0];
      for (let r = r0; r < Math.min(r0 + zone.getRowCount(), grille.length); r++) {
        for (let c = c0; c < Math.min(c0 + zone.getColumnCount(), NB_COLONNES); c++) grille[r][c] = v;
      }
    }
  }
  return grille;
}

function texte(valeur: string | number | boolean, affiche: string, colonne: number): string {
  const estDate: boolean = DATES.some((k: string) => COLONNES[k] === colonne);
  if (estDate && typeof valeur === "number" && valeur > 0) return dateTexte(valeur);
  return String(affiche ?? "").trim();
}

function dateTexte(serie: number): string {
  const d: Date = new Date(Math.round((serie - 25569) * 86400000));
  const deux = (n: number): string => (n < 10 ? "0" : "") + n;
  return deux(d.getUTCDate()) + "/" + deux(d.getUTCMonth() + 1) + "/" + d.getUTCFullYear();
}

function dateSerie(jjmmaaaa: string): number {
  const m: RegExpExecArray | null = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(jjmmaaaa);
  return m ? Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])) / 86400000 + 25569 : 0;
}

function norme(s: string): string {
  return String(s ?? "").replace(/\s+/g, " ").trim().toUpperCase();
}

// --- Écriture -----------------------------------------------------------------------------

function ecrire(workbook: ExcelScript.Workbook, d: Demande): string {
  const ws: ExcelScript.Worksheet | undefined = workbook.getWorksheet(d.feuille);
  if (!ws) return reponse(false, "Feuille " + d.feuille + " absente de la DEM.", 0);
  const grille: string[][] = lireFeuille(ws);
  const correspond = (t: string[]): boolean => t !== undefined && norme(t[COLONNES.Affaire]) === norme(d.affaire) && norme(t[COLONNES.REE]) === norme(d.ree)
    && norme(t[COLONNES.OT]) === norme(d.ot) && norme(t[COLONNES.TOT]) === norme(d.tot);

  // Ligne attendue d'abord, sinon recherche dans toute la feuille (lignes insérées depuis la lecture).
  let index: number = correspond(grille[d.ligne - 2]) ? d.ligne - 2 : -1;
  if (index < 0) {
    const trouvees: number[] = grille.map((t: string[], i: number) => (correspond(t) ? i : -1)).filter((i: number) => i >= 0);
    if (trouvees.length !== 1) return reponse(false, trouvees.length ? "Plusieurs lignes ont cette affaire, ce REE, cet OT et cette TOT." : "Ligne introuvable dans la DEM : actualisez l'appli.", 0);
    index = trouvees[0];
  }
  const t: string[] = grille[index];

  const conflits: string[] = [];
  const aEcrire: Champ[] = [];
  for (const champ of d.champs) {
    if (!MODIFIABLES.includes(champ.colonne)) return reponse(false, "Colonne non modifiable : " + champ.colonne, index + 2);
    const actuelle: string = t[COLONNES[champ.colonne]];
    if (norme(actuelle) === norme(champ.nouvelle)) continue;
    if (norme(actuelle) !== norme(champ.ancienne)) conflits.push(champ.colonne + " (" + (actuelle || "vide") + " dans la DEM)");
    else aEcrire.push(champ);
  }
  if (conflits.length) return reponse(false, "Modifié entre-temps par quelqu'un d'autre : " + conflits.join(", ") + ". Rien n'a été écrit, actualisez l'appli.", index + 2);

  const journal: ExcelScript.Worksheet | undefined = workbook.getWorksheet("Journal appli");
  for (const champ of aEcrire) {
    let cellule: ExcelScript.Range = ws.getCell(index + 1, COLONNES[champ.colonne]);
    const fusion: ExcelScript.RangeAreas | undefined = cellule.getMergedAreasOrNullObject();
    if (fusion) cellule = fusion.getAreas()[0].getCell(0, 0);
    const serie: number = DATES.includes(champ.colonne) ? dateSerie(champ.nouvelle) : 0;
    if (champ.nouvelle === "") {
      cellule.clear(ExcelScript.ClearApplyTo.contents);
    } else if (serie > 0) {
      if (cellule.getNumberFormat() === "General") cellule.setNumberFormat("dd/mm/yyyy");
      cellule.setValue(serie);
    } else {
      // Un texte qui commence par « = » reste du texte, jamais une formule.
      cellule.setValue(/^[=+@]/.test(champ.nouvelle) ? "'" + champ.nouvelle : champ.nouvelle);
    }
    if (journal) {
      const suivante: number = (journal.getUsedRange(true)?.getRowCount() ?? 0) + 1;
      journal.getRange("A" + suivante + ":G" + suivante).setValues([[new Date().toISOString(), d.utilisateur, d.feuille, cellule.getAddress(), champ.colonne, champ.ancienne, champ.nouvelle]]);
    }
  }
  return reponse(true, aEcrire.length ? aEcrire.length + " cellule(s) écrite(s) dans la DEM." : "Rien à écrire : la DEM contient déjà ces valeurs.", index + 2);
}

function reponse(ok: boolean, message: string, ligne: number): string {
  return JSON.stringify({ ok: ok, message: message, ligne: ligne });
}
