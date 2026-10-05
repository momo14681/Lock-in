# Pilotage des essais — tableau de bord DEM

Tableau de bord autonome (un seul fichier HTML, sans accès réseau) qui lit la DEM
(`.xlsm` / `.xlsx`) directement sur le PC. Le classeur n'est jamais modifié.

**Utilisation :** ouvrir `Tableau_de_bord_DEM.html` dans Edge ou Chrome, puis
« Choisir / changer le fichier ». Le fichier choisi est mémorisé sur ce PC et relu
automatiquement toutes les 30 minutes de 7 h à 20 h (comme en V1.3).

## Deux profils (bouton en haut de page)

### Chargé d'essais — « je pilote mes affaires »
Le nom choisi est mémorisé sur le PC.

| Onglet | Contenu |
|---|---|
| Mes affaires | Indicateurs personnels, liste **À traiter** par priorité (retards, échéances sous 30 j, infos manquantes, corrections DEM, documents P / R, J0 absents), suivi **par affaire** (prépa, BPA, GER/1N, BPD signés / produits, points d'attention). Cliquer sur une affaire affiche ses REE et TOT. Comparaison « moi / équipe ». |
| Mes corrections | Signalements sur mes TOT, avec la **cellule Excel à corriger**. |
| Mes documents P / R | BPA, GER/1N, BPD, TOT prête prêts à valider ou à reprendre. |
| Mes TOT | Liste filtrable (retard, échéance < 30 j, infos manquantes, J0 absent…). |
| Avancement équipe | Avancement global de toute l'équipe (voir ci-dessous). |

### Coordo essais — « charge et corrections »

| Onglet | Contenu |
|---|---|
| Synthèse | Indicateurs, **histogramme de charge** par chargé, corrections DEM par priorité, par type et par chargé, états du REE. |
| Répartition par chargé | Tableau complet par chargé (affaires, REE TEM / AT, prépa, réalisés, retards, corrections). |
| Corrections DEM | Tous les signalements : filtres par chargé, priorité et type de contrôle, cellules à corriger, « Ignorer » pour l'import en cours. |
| Affectations SharePoint | Feuille « Suivi modification IPE » (inchangé). |
| Documents P / R, Toutes les TOT, Avancement équipe | Comme pour le profil CE, sur tout le périmètre. |

**Histogramme de charge :** unité *TOT par statut*, *REE* ou *REE TEM / AT* ; tri par
**charge totale, charge AT, charge TEM** ou nom. Avec le tri AT, le segment AT est
placé en premier (aligné à gauche) et la valeur AT est affichée à côté du total ;
les chargés sans AT sont estompés. Cliquer sur un nom le masque du graphique.

## Écran d'équipe (export PNG 1920 × 1080)

Bouton « Écran d'équipe (PNG) » (ou « Aperçu de l'écran » dans l'onglet
*Avancement équipe*). L'image couvre toujours toute l'équipe (en profil coordo,
seul le filtre « Chargé d'essais » la restreint) :

- essais réalisés, préparation documentaire terminée, prépas en retard, échéances sous 30 jours ;
- **avancement par mois de J0** sur la période choisie (statut des TOT de chaque mois, mois en cours repéré) ;
- **retards de préparation documentaire** : REE en retard (échéances les plus récentes d'abord, avec le chargé et ce qui manque) et nombre de TOT en retard par chargé ;
- avancement BPA, GER/1N, BPD (produits / signés).

## Règles de calcul (identiques à la V1.3)

- **Réalisé** : GER/1N signé (PSR ou TSR).
- **Préparation terminée** : MC, OT, TOT, RDU renseignés et « TOT prête » (date ou P).
- **Échéance de préparation** : J0 − 30 jours ; **en retard** si dépassée sans préparation terminée.
- **Période** : années de J0 attendues (contrôle « J0 hors période » et colonnes du graphique mensuel).

Les indicateurs ont été comparés à la V1.3 sur `DEM_2026_1.xlsm` : mêmes valeurs
(TOT, affaires, REE, préparation, réalisés, retards, non affectées, 676 signalements,
charge par chargé, états du REE). Seul l'arrondi d'affichage passe à l'entier (83 % au lieu de 82,7 %).

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
| `src/js/08-view-team.js` | Avancement équipe et image PNG |
| `src/js/09-exports.js` | Exports CSV et PDF |
| `src/js/10-source.js` | Chargement, fichier mémorisé, DEM 2026 / 2027 |
| `src/js/11-main.js` | Rendu, navigation, démarrage |
| `vendor/` | SheetJS, pdf-lib, fontkit, police Work Sans (repris de la V1.3) |
