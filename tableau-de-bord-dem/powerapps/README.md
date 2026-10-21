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
| `DEM_PowerApps.osts.ts` | Script Office qui lit et écrit la vraie DEM (à créer dans Excel, onglet Automatiser) |
| `Formules_a_remplacer.fr.txt` | Les 3 formules qui changent si l’appli est déjà installée avec l’ancienne source Excel |
| `src/generer.py` | Génère les écrans et la version française des formules (`python3 powerapps/src/generer.py`) |

## Principe : la vraie DEM, sans copie

L’appli lit et écrit **la DEM elle-même** (le .xlsm sur Teams, mise en forme, cellules
fusionnées, cases à cocher et macros intactes) à travers un **script Office** exécuté par un
**flux Power Automate**. Le connecteur Excel « tableau » n’est pas utilisé : il refuse les .xlsm
et les cellules fusionnées, et il est lent.

- **Lecture** : un seul appel lit les feuilles CSxx et renvoie une ligne par TOT (colonnes utiles
  seulement, cellules fusionnées résolues, dates en jj/mm/aaaa).
- **Écriture** : la fiche TOT envoie les champs modifiés avec leur ancienne valeur. Le script
  retrouve la ligne par Affaire / REE / OT / TOT (même si des lignes ont été insérées), vérifie
  que chaque cellule contient encore l’ancienne valeur et sinon n’écrit rien. Les dates sont
  écrites comme de vraies dates Excel.
- **Journal (facultatif)** : si la DEM contient une feuille nommée `Journal appli`, chaque
  écriture y est ajoutée (date, auteur, feuille, cellule, champ, ancienne et nouvelle valeur).
  Utile car dans l’historique des versions, les écritures apparaissent au nom du propriétaire
  du flux.

## 1. Script Office (une fois)

1. Ouvrir la DEM **dans le navigateur** (Teams › Fichiers › … › Ouvrir dans le navigateur).
2. Onglet **Automatiser › Nouveau script**. Tout effacer, coller le contenu de
   `DEM_PowerApps.osts.ts`, renommer le script `DEM_PowerApps`, **Enregistrer le script**.
   (Le script n’a pas besoin d’être lancé à la main.)

## 2. Flux Power Automate (une fois)

Sur **make.powerautomate.com › Créer › Flux de cloud instantané**, nom `DEM_PowerApps`,
déclencheur **Power Apps (V2)** (« Lors de l’appel par Power Apps »).

1. Déclencheur : ajouter deux entrées de type **Texte** : `action` et `donnees`.
2. Action **Excel Online (Business) › Exécuter un script** :
   Emplacement = site SharePoint de l’équipe Teams, Bibliothèque = Documents, Fichier = la DEM,
   Script = `DEM_PowerApps`, puis `action` et `donnees` = les entrées du déclencheur
   (contenu dynamique).
3. Action **Répondre à une application ou à un flux Power Apps** : une sortie **Texte** nommée
   `resultat`, valeur = `result` de « Exécuter un script » (contenu dynamique).
4. Enregistrer.

Le flux s’exécute avec la connexion de celui qui l’a créé : les membres de l’équipe n’ont rien à
installer, mais l’appli doit être partagée avec eux.

## 3. Créer l’appli

1. Aller sur **make.powerapps.com › Créer › Application vide › Application canevas vide**,
   format **Tablette**, nom « Pilotage des essais ».
2. **Paramètres › Général › Limite de lignes de données : 2000.**
3. Volet **Power Automate** (icône à gauche) › **Ajouter un flux** › `DEM_PowerApps`.
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
   le canal de l’équipe. Partager l’appli avec l’équipe (*Partager*) ; le flux écrit avec les droits
   de son créateur.

## 3 bis. Appli déjà installée avec l’ancienne source

1. Volet **Données** : supprimer la source `DEM` (table Excel).
2. Volet **Power Automate** (icône à gauche) › **Ajouter un flux** › `DEM_PowerApps`.
3. Remplacer les 3 formules indiquées dans `Formules_a_remplacer.fr.txt`.
4. Le fichier `DEM_2026_PowerApps.xlsx` ne sert plus : on peut le supprimer.

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

- Un appel de script est limité à 120 s, 5 Mo de réponse, 3 appels par 10 s et 1 600 par jour
  et par utilisateur (largement suffisant pour une équipe). Une écriture peut mettre quelques
  secondes à apparaître dans la DEM ouverte par d’autres.
- Microsoft signale que certains .xlsm, surtout avec des contrôles ActiveX ou de formulaire,
  peuvent ne pas fonctionner avec le script : si les cases à cocher de la DEM sont de ce type,
  tester la lecture avant de déployer.
- Les données restent en mémoire pendant la session ; « Actualiser » relit la DEM.
- Écrans et formules non testés dans Power Apps Studio : envoyer une capture de la première
  erreur rencontrée pour correction.

Sources : [fichiers .xlsm dans Power Automate](https://learn.microsoft.com/office/dev/scripts/develop/macros-power-automate),
[limites des scripts Office](https://learn.microsoft.com/office/dev/scripts/testing/platform-limits),
[connecteur Excel Online (Business)](https://learn.microsoft.com/connectors/excelonlinebusiness),
[connexion à Excel depuis Power Apps](https://learn.microsoft.com/power-apps/maker/canvas-apps/connections/connection-excel),
[code YAML des applis canevas](https://learn.microsoft.com/power-apps/maker/canvas-apps/power-apps-yaml),
[affichage et collage du code](https://learn.microsoft.com/power-apps/maker/canvas-apps/code-view).
