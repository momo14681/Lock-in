# Complément Excel « Pilotage des essais »

Le tableau de bord DEM ouvert dans Excel (Teams, Excel en ligne ou bureau) : il lit la DEM
ouverte et y écrit les saisies des fiches TOT. Cette page ne contient aucune donnée :
tout est lu dans le classeur ouvert.

Fichiers générés par `node build.mjs` (dossier `tableau-de-bord-dem`) :
`index.html` (la page), `manifest.xml` (à charger dans Excel), icônes.
Version publique : sans les liens EAM / eDRT (adresses internes).

## Installer (chaque utilisateur, une fois)

1. Télécharger `manifest.xml`.
2. Ouvrir la DEM dans Excel en ligne (Teams › Fichiers › Ouvrir dans le navigateur).
3. Accueil › Compléments › Plus de compléments › Mes compléments › Charger mon complément ›
   choisir `manifest.xml`.
4. Le bouton « Tableau de bord » apparaît dans l'onglet Accueil. Élargir le volet en tirant
   son bord gauche.

## Fonctionnement

- Lecture : feuilles CSxx, CRU, Suivi modification IPE, Pilotage, Préparation, cellules
  fusionnées comprises. Relecture par « Actualiser », après chaque enregistrement et au
  retour sur le volet après 5 min.
- Écriture : la fiche TOT écrit directement dans la DEM. Avant d'écrire, la ligne est
  vérifiée (Affaire, REE, OT, TOT) et chaque cellule doit contenir encore l'ancienne valeur ;
  sinon rien n'est écrit. Dates écrites comme vraies dates Excel.
- Journal (facultatif) : si la DEM contient une feuille `Journal appli`, chaque écriture y
  est ajoutée (date, chargé, feuille, cellule, champ, ancienne et nouvelle valeur).
