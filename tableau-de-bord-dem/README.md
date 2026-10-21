# Pilotage des essais — tableau de bord DEM

Tableau de bord autonome (un seul fichier HTML, sans accès réseau) qui lit la DEM
(`.xlsm` / `.xlsx`) directement sur le PC. Le classeur n'est jamais modifié.

**Utilisation :** ouvrir `Tableau_de_bord_DEM.html` dans Edge ou Chrome, puis
« Choisir / changer le fichier ». Le fichier choisi est mémorisé sur ce PC et relu
automatiquement toutes les 30 minutes de 7 h à 20 h (comme en V1.3).

## Deux profils (bouton en haut de page)

Chaque profil a **4 onglets**, chacun répond à une question. Les listes détaillées
sont dans le menu déroulant à droite des onglets. Les filtres (feuilles, période)
sont repliés sous **Filtres**, les exports sous **Exporter**. Le fichier Excel et sa dernière vérification sont en petit en bas de page (menu **Fichier**), le bouton **Actualiser** dans le bandeau.

**Tableaux :** l'icône loupe ouvre une recherche propre au tableau ; les colonnes marquées d'une liste déroulante (statut, chargé, priorité, feuille, type…) se filtrent comme dans Excel, avec plusieurs choix cochables. Recherche et filtres portent sur toutes les lignes et sont repris dans les exports CSV et PDF.

**Chargé d'essais** (lu en colonne M « Chargé d’essai SP », sans distinction prestataire / interne ; le nom choisi est mémorisé sur le PC)

| Onglet | Question |
|---|---|
| Mes affaires | Où en sont mes affaires et que dois-je faire ? 4 chiffres, liste « À faire », une ligne par affaire (cliquer pour le détail REE / TOT). |
| Mon pilotage | La feuille Pilotage de la DEM pour moi : Gel M0 passé, BPA faits, essais réalisés, BPD signés ; Gel M0 à passer et BPA à faire (court terme < 30 j, moyen terme 30 à 90 j, plus tard) ; avancement par tranche ; mes affaires et REE. Gel M0 = J0 − 70 j, ligne gelée quand MC, OT, TOT, RDU et Régime sont renseignés ; BPA fait = date ou P sur toutes les lignes du REE (un REE reste dans « BPA à faire » tant qu’une ligne n’a pas son BPA) ; à préparer par le chargé si titulaire EDF ou BPA en F. |
| À corriger dans la DEM | Quelles cellules dois-je corriger ? |
| Équipe | Où en est l'équipe ? (même contenu que l'écran d'équipe) |
| *Mes listes…* | Mes TOT, mes documents P / R, **Modifications à appliquer** (voir plus bas) |

**Coordo essais**

| Onglet | Question |
|---|---|
| Synthèse | Qui est chargé, et qui doit corriger la DEM ? 4 chiffres, histogramme de charge, corrections par chargé. |
| Pilotage par tranche | Où en sont les tranches suivies (CS2M et CS4A par défaut, puces pour en ajouter) ? Côte à côte : préparation, réalisés, BPD signés, prépas en retard ; documents EAM / BPA / GER / BPD (P, R, % produits, % signés, comme la feuille Pilotage) ; avancement par semaine de J0 (par mois si la tranche dépasse 20 semaines) ; points à traiter et charge par chargé. Chaque nombre ouvre la liste limitée à la tranche. |
| À corriger dans la DEM | Toutes les corrections, filtrables par chargé, priorité et type. |
| Équipe | Avancement global, retards de préparation, documents. |
| *Autres listes…* | **Modifications à appliquer** (voir plus bas), répartition par chargé, toutes les TOT, documents P / R, affectations SharePoint, **Contrôle 1N / TSR** (export EAM IOP319 chargé ou glissé à part : indicateur Conforme / Non conforme si chaque TOT a un commentaire 1N et un TSR, PAR ou TAR ; puis comparaison avec la DEM, qui doit avoir la TOT en TSR dans GER/1N et le 1N fait, c’est-à-dire une date dans BPD ; BPD en P = 1N en cours ; une TOT à l’état PRÊT sans 1N ni TSR n’est pas encore réalisée et n’est pas signalée), **TOT par ECU** (feuille CRU : une ligne par TOT avec son dernier commentaire, compteurs et filtre par ECU, chargé repris de la DEM quand l'OT / TOT y figure) |

**Histogramme de charge :** unité *TOT par statut*, *REE TEM / AT* ou *REE* ; tri par
charge **Total, AT, TEM** ou nom. Avec le tri AT, le segment AT est placé en premier et
la valeur AT affichée à côté du total. Cliquer sur un nom le retire du graphique.

## Saisir des modifications dans la DEM

Le tableau de bord ne modifie jamais la DEM lui-même (fichier hors ligne, sans accès à
Teams). La saisie se fait en deux temps :

1. **Saisie** : dans la fiche d'une TOT, « Modifier cette ligne » permet de changer
   TOT prête, BPA, GER/1N, BPD, J0, MC, RDU, Régime et Observations (dates au format
   jj/mm/aaaa ou codes P, R, F, TSR, TAR…). Les saisies sont mémorisées sur le PC
   (navigateur) et listées dans **Modifications à appliquer**, avec leur état :
   à appliquer, déjà dans la DEM, la DEM a changé depuis la saisie, ligne introuvable.
2. **Application** : « Télécharger le fichier pour la DEM » produit un fichier texte
   (`Modifications_DEM_<année>_….txt`, UTF-8, tabulations). Dans Excel **bureau**, la DEM
   ouverte, la macro `AppliquerModifsDEM` (« Télécharger la macro Excel », à importer une
   fois par Alt+F11 › Fichier › Importer un fichier, dans PERSONAL.XLSB ou dans la DEM)
   lit ce fichier, retrouve chaque ligne par Affaire / REE / OT / TOT (même si des lignes
   ont été insérées), n'écrit que si la cellule contient encore l'ancienne valeur, montre
   un aperçu et demande confirmation, puis ouvre un compte rendu. La DEM n'est pas
   enregistrée par la macro : relire puis enregistrer.

Source de la macro : `src/vba/AppliquerModifsDEM.bas` (embarquée dans le HTML au build).

## Écran d'équipe (export PNG 1920 × 1080)

Bouton « Écran d'équipe (PNG) » (ou « Aperçu de l'écran » dans l'onglet
*Avancement équipe*). L'image couvre toujours toute l'équipe (en profil coordo,
seul le filtre « Chargé d'essais » la restreint) :

- essais réalisés, préparation documentaire terminée, prépas en retard, échéances sous 30 jours ;
- **avancement par mois de J0** sur la période choisie (statut des TOT de chaque mois, mois en cours repéré) ;
- **retards de préparation documentaire** : REE en retard (échéances les plus récentes d'abord, avec le chargé et ce qui manque) et nombre de TOT en retard par chargé ;
- avancement BPA, GER/1N, BPD (produits / signés).

## Image du pilotage pour la télé (PNG 1920 × 1080)

Dans l'onglet *Pilotage par tranche* : « Télécharger l'image (PNG) » ou « Voir l'image
télé » (aussi dans Exporter). Pensée pour la réunion de cadres : pour chaque tranche
choisie (3 au plus, côte à côte), trois cartes (prépa terminée, essais réalisés, BPD
signés) puis **% produits et % signés de TOT prête, BPA et BPD**,
avec une barre signés / produits à signer / non produits et les nombres (signés, à
signer, TOT). Ni lignes DEM à compléter ni avancement par J0 ; les pourcentages sont
calculés sur toutes les TOT de la tranche.

## Rythme de signature (PNG 1920 × 1080)

Bouton « Voir le rythme de signature » (onglets *Avancement équipe* et *Pilotage par
tranche*) ou Exporter › « Rythme de signature (PNG) ». Courbe du cumul, semaine par
semaine sur 26 semaines, des dates TOT prête, BPA et BPD renseignées, en % des TOT, avec
le gain des 4 dernières semaines. Une courbe pour l'équipe, ou une par tranche choisie.
Les dates sont fiables, pas le J0 : rien ne dépend du J0. Une ligne signée sans date
n'est pas comptée.

## Règles de calcul (identiques à la V1.3)

- **Réalisé** : GER/1N signé (PSR, TSR ou TAR, ou une date).
- **Équivalences de saisie** : « Prêt » (ou « Prête ») en TOT prête vaut P ; « Renseigné » vaut une TOT prête faite (comme une date) ; une date en GER/1N vaut TSR.
- **Préparation terminée** : « TOT prête » renseignée (date ou P), donc égale au % de TOT prête produites. MC, OT ou TOT manquants restent signalés en informations à compléter.
- **TOT prête mais MC, OT ou TOT manquant** : jamais « en retard », compté en « infos manquantes » (à compléter).
- **Documents P** : à valider par les coordos (onglet coordo) ; **R** : à reprendre par le chargé d'essais.
- **Échéance de préparation** : J0 − 30 jours ; **en retard** si dépassée sans préparation terminée.
- **Période** : années de J0 attendues (colonnes du graphique mensuel). Pas d'alerte « J0 hors période ».
- **J0 « Non renseigné »** : J0 inconnu assumé, ni à compléter ni à corriger.
- **RDU manquant** : simple alerte « À vérifier », ne compte pas en informations manquantes.
- **GER/1N « TAR »** (total avec réserve) : signé, comme PSR et TSR.

Les indicateurs ont été comparés à la V1.3 sur `DEM_2026_1.xlsm` : mêmes valeurs
(TOT, affaires, REE, préparation, réalisés, retards, non affectées, 676 signalements,
charge par chargé, états du REE). Seul l'arrondi d'affichage passe à l'entier (83 % au lieu de 82,7 %).

## Police et charte EDF

La page utilise la police **EDF 2020** et la palette EDF (bleu `#001A70`, bleu électrique
`#1057C8`, orange `#FE5815`). La police appartient à EDF : elle **n'est pas versionnée**
(dépôt public). Pour l'embarquer, placer `EDF2020W01-Light.woff2`, `-Regular.woff2` et
`-Bold.woff2` dans `fonts-edf/` (ignoré par Git) puis lancer `node build.mjs` : le fichier
`Tableau_de_bord_DEM_EDF.html` (également ignoré) est produit pour l'usage interne.
Sans ce dossier, la page utilise EDF 2020 si elle est installée sur le PC, sinon Work Sans.

## Modifier le code

Le fichier HTML est **généré** : modifier les sources puis reconstruire.

```
node build.mjs     # Node 18+ ; produit Tableau_de_bord_DEM.html
```

| Chemin | Rôle |
|---|---|
| `src/template.html` | Structure de la page (en-tête, filtres, onglets) |
| `src/styles.css` | Mise en forme et couleurs |
| `src/js/01-model.js` | Lecture de la DEM et règles métier |
| `src/js/02-audit.js` | Contrôles de cohérence (signalements) |
| `src/js/03-state.js` | Profils, onglets, filtres, préférences |
| `src/js/04-components.js` | Composants d'affichage (indicateurs, jauges, tableaux, infobulles) |
| `src/js/05-view-ce.js` | Vue « Mes affaires » |
| `src/js/06-view-lists.js` | Listes : TOT, corrections, documents, regroupements |
| `src/js/07-view-coordo.js` | Synthèse, histogramme de charge, répartition, affectations IPE |
| `src/js/076-view-iop319.js` | Contrôle 1N / TSR (export EAM IOP319) |
| `src/js/077-view-pilotage.js` | Pilotage par tranche |
| `src/js/078-view-ce-pilotage.js` | Mon pilotage (chargé d’essais) |
| `src/js/079-view-edits.js` | Saisie des modifications et fichier pour la macro |
| `src/js/08-view-team.js` | Avancement équipe et image PNG |
| `src/js/09-exports.js` | Exports CSV et PDF |
| `src/js/10-source.js` | Chargement, fichier mémorisé, DEM 2026 / 2027 |
| `src/js/11-main.js` | Rendu, navigation, démarrage |
| `src/vba/AppliquerModifsDEM.bas` | Macro Excel qui applique les modifications dans la DEM |
| `vendor/` | SheetJS, pdf-lib, fontkit, police Work Sans (repris de la V1.3) |
