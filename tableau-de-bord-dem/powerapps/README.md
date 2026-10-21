# Appli Power Apps « Pilotage des essais »

Une appli canevas qui reprend le tableau de bord DEM : saisie et affichage au même endroit,
dans un onglet Teams, données partagées en direct.

| Fichier | Rôle |
|---|---|
| `ecrans/1-Accueil.pa.yaml` | Accueil : profil, chargé, 8 indicateurs cliquables, chargement des données |
| `ecrans/2-MesTOT.pa.yaml` | Mes TOT : recherche, filtre par état, une ligne par TOT |
| `ecrans/3-FicheTOT.pa.yaml` | Fiche d’une TOT : saisie de TOT prête, BPA, GER/1N, BPD, J0, MC, RDU, Régime, Observations, écrite directement dans la DEM |
| `ecrans/4-MonPilotage.pa.yaml` | Mon pilotage : lignes gelées, BPA faits, réalisés, BPD signés ; REE à passer en Gel M0 et BPA à faire (< 30 j, 30 à 90 j, plus tard) |
| `ecrans/5-Equipe.pa.yaml` | Équipe : avancement par chargé (toucher un nom ouvre ses TOT) |
| `App.Formulas.fr.txt` | Règles de lecture de la DEM, séparateurs français (« ; » et « ;; ») |
| `App.Formulas.txt` | Mêmes règles, séparateurs anglais (« , » et « ; ») |
| `src/generer.py` | Génère les écrans et la version française des formules (`python3 powerapps/src/generer.py`) |

## Pourquoi pas directement la DEM .xlsm

Le connecteur Excel de Power Apps ne lit que les fichiers **.xlsx** (ou .xlsb), et seulement
des données mises en **tableau** Excel (donc sans cellules fusionnées). Microsoft déconseille
aussi d’écrire dans le même fichier depuis l’appli et depuis Excel en même temps. La source de
l’appli est donc une table « DEM » créée depuis le tableau de bord, qui devient l’endroit où l’on
saisit.

## 1. Préparer les données (une fois)

1. Ouvrir le tableau de bord HTML (v26 ou plus) avec la DEM, puis **Exporter › Données pour
   l’appli Power Apps (Excel)**. On obtient `DEM_2026_PowerApps.xlsx` : une ligne par TOT,
   cellules fusionnées résolues, dates en texte jj/mm/aaaa, colonnes `Cle, Num, Feuille, Ligne,
   Affaire, Libelle, REE, LibelleREE, Titulaire, MC, OT, TOT, RDU, Charge, TOTPrete, J0, Regime,
   BPA, GER1N, BPD, Observations`.
2. Ouvrir ce fichier dans Excel, cliquer dans A1, **Ctrl+T** (cocher « Mon tableau comporte des
   en-têtes »), puis onglet **Création de tableau › Nom du tableau : `DEM`**.
3. Choisir où vivent les données :
   - **Excel (pour l’instant)** : enregistrer le fichier dans le dossier Teams de l’équipe
     (onglet *Fichiers* du canal). Ensuite, on ne le modifie plus à la main : toutes les saisies
     passent par l’appli.
   - **Liste SharePoint (plus tard, recommandé)** : dans le site SharePoint de l’équipe,
     *Nouveau › Liste › À partir d’Excel*, choisir le fichier. Types : `Num` et `Ligne` en
     *Nombre*, `Observations` en *Plusieurs lignes de texte*, tout le reste en *Une seule ligne
     de texte*. Nommer la liste `DEM`. Si la colonne *Titre* est obligatoire, la rendre
     facultative (Paramètres de la liste › Titre › Exiger des informations : Non).
     Passer d’Excel à la liste ne demande que de changer la source de données dans l’appli.

## 2. Créer l’appli

1. Aller sur **make.powerapps.com › Créer › Application vide › Application canevas vide**,
   format **Tablette**, nom « Pilotage des essais ».
2. **Paramètres › Général › Limite de lignes de données : 2000.**
3. **Données › Ajouter des données** :
   - Excel : *Excel Online (Business)* › site Teams de l’équipe › bibliothèque *Documents* ›
     dossier du canal › fichier › cocher la table **DEM**.
   - Liste : *SharePoint* › site › liste **DEM**.
   La source doit s’appeler `DEM` dans le volet *Données* (la renommer sinon).
4. **Coller les écrans**, dans l’ordre 1 à 5. Pour chacun : ouvrir le fichier `.pa.yaml` dans le
   Bloc-notes, tout copier, puis dans l’arborescence de Power Apps cliquer sur les **…** de
   `Screen1 › Coller`. Un nouvel écran apparaît (scrAccueil, scrTOT…). Des erreurs rouges sont
   normales tant que tout n’est pas collé. À la fin, supprimer `Screen1`.
   Si le collage est refusé, autoriser le presse-papiers pour make.powerapps.com dans le
   navigateur.
5. **Formules** : sélectionner **App** dans l’arborescence, choisir la propriété **Formulas**
   dans la liste déroulante en haut à gauche, et coller tout `App.Formulas.fr.txt` (navigateur
   en français, séparateur « ; ») ou `App.Formulas.txt` (navigateur en anglais).
6. Toujours sur **App**, propriété **StartScreen** : `scrAccueil`.
7. **Aperçu (F5)** : l’accueil charge les données et reconnaît le chargé d’après le nom du
   compte Microsoft (sinon le choisir dans la liste).
8. **Enregistrer › Publier**, puis **Publier › Ajouter à Teams** pour l’épingler en onglet dans
   le canal de l’équipe. Partager l’appli avec l’équipe (*Partager*) ; chacun doit avoir le
   droit de modifier le fichier ou la liste DEM.

## Règles reprises du tableau de bord

- TOT prête faite : date, P, Prêt ou Renseigné. GER/1N signé : PSR, TSR, TAR ou une date.
- État d’une TOT, dans cet ordre : Annulée, Réalisé (GER/1N signé), Infos manquantes,
  Prépa terminée (TOT prête), Prépa en retard (J0 − 30 j passé, TOT pas prête), En préparation.
- J0 « Non renseigné » accepté ; RDU manquant non bloquant.
- Gel M0 = J0 − 70 j ; ligne gelée quand MC, OT, TOT, RDU et Régime sont renseignés.
- BPA fait = date ou P ; un REE reste dans « BPA à faire » tant qu’une de ses TOT n’a pas son
  BPA ; « à préparer par moi » si titulaire EDF ou BPA en F.
- Chargé = colonne M « Chargé d’essai SP » (« Non renseigné » = Non affecté).

## Limites connues

- Avec Excel comme source : 2 000 lignes au plus, une écriture peut mettre jusqu’à 30 s à être
  visible des autres, et le fichier peut rester verrouillé quelques minutes après une
  écriture. Power Apps peut ajouter une colonne cachée `__PowerAppsId__` au tableau : c’est
  normal. Une liste SharePoint lève ces limites (pour plus de 2 000 lignes, remplacer dans
  l’accueil `ClearCollect(colSrc, DEM)` par le chargement par tranches indiqué dans
  `src/generer.py`).
- Les écrans et formules n’ont pas pu être testés dans Power Apps Studio : envoyer une capture
  de la première erreur rencontrée pour correction.

Sources : [connecteur Excel Online (Business)](https://learn.microsoft.com/connectors/excelonlinebusiness),
[connexion à Excel depuis Power Apps](https://learn.microsoft.com/power-apps/maker/canvas-apps/connections/connection-excel),
[code YAML des applis canevas](https://learn.microsoft.com/power-apps/maker/canvas-apps/power-apps-yaml),
[affichage et collage du code](https://learn.microsoft.com/power-apps/maker/canvas-apps/code-view).
