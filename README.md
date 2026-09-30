# 🧪 DataLab — application de traitement de données

Application web **100 % locale** (aucun serveur, aucune donnée envoyée) pour importer, nettoyer, transformer, analyser, visualiser et exporter des données tabulaires. **77 outils**, interface en français.

## Démarrage

Ouvrez simplement `index.html` dans un navigateur, ou servez le dossier :

```bash
python3 -m http.server 8000   # puis http://localhost:8000
```

Cliquez sur **✨ Exemple** pour charger un jeu de ventes contenant des erreurs volontaires (espaces, casse, doublons, dates hétérogènes, valeurs manquantes, valeurs aberrantes) à nettoyer, et un second jeu « vendeurs » pour tester les jointures.

## Fonctionnalités

### Import
- Fichiers **CSV, TSV, TXT, JSON / JSON Lines, Excel (xlsx, xls, xlsm), ODS** — glisser-déposer ou sélection multiple
- Détection automatique du séparateur, de l'encodage (UTF-8 / Windows-1252) et des types (nombres au format français `1 234,5` compris, codes à zéro initial préservés)
- Classeurs multi-feuilles : chaque feuille devient un jeu de données
- Coller depuis Excel / Google Sheets, chargement depuis une URL, JSON imbriqué aplati (`adresse.ville`)

### Outils (77), avec aperçu en direct avant application
| Catégorie | Outils |
|---|---|
| 🧹 **Nettoyage** (12) | doublons, lignes vides, colonnes vides, lignes incomplètes, remplissage des manquants (constante, moyenne, médiane, mode, précédente, suivante, interpolation), espaces, casse, rechercher/remplacer (regex), accents, caractères spéciaux, conversion de type, uniformisation des dates |
| 🏛️ **Colonnes** (15) | renommer (une / toutes : snake_case…), supprimer, sélectionner, dupliquer, déplacer, trier, fractionner, fusionner, **formule JavaScript**, modèle `{Col}`, colonne conditionnelle SI, constante, index/identifiant, extraction regex |
| 📋 **Lignes** (9) | filtre (16 opérateurs, 2 conditions ET/OU), filtre par formule, tri multi-colonnes, échantillonnage, Top/Flop N par groupe, suppression de plage, mélange, inversion, éclatement de listes |
| 🔢 **Numérique** (14) | opérations mathématiques, opérations entre colonnes, arrondi, normalisation min-max, z-score, discrétisation (largeur, quantiles, bornes), écrêtage, cumuls, différences/variations %, moyenne mobile, rang, part du total, one-hot, encodage numérique |
| 🔤 **Texte** (8) | longueur, sous-chaîne, padding, préfixe/suffixe, extraction de nombres, slug, nettoyage HTML, validation (e-mail, téléphone FR, code postal, URL, IBAN, regex) |
| 📅 **Dates** (4) | extraction (année, mois, trimestre, semaine ISO, jour de semaine, week-end…), écart entre dates, ajout de durée, calcul d'âge |
| 🔀 **Restructurer** (6) | grouper/agréger (14 agrégations), tableau croisé dynamique avec totaux, dépivoter, transposer, **jointures** (gauche, interne, droite, complète, anti), union |
| 📊 **Analyse** (9) | statistiques descriptives, fréquences, contingence + **khi²** et V de Cramér, corrélations Pearson/Spearman, **régression linéaire**, valeurs aberrantes (IQR / z-score), rapport des manquants, doublons, comparaison de groupes + **ANOVA** |

### Et aussi
- **Tableau** paginé : recherche, tri, édition de cellule (double-clic), ajout de ligne, menu d'actions par colonne (clic sur l'en-tête)
- **Profil** : type, taux de remplissage, statistiques, histogrammes et valeurs fréquentes par colonne
- **Graphiques** (12 types) : barres, barres horizontales/empilées, courbes, aires, nuage de points, secteurs, anneau, polaire, radar, histogramme, boîte à moustaches — export PNG
- **SQL** (AlaSQL) sur le jeu actuel (`data`) et les jeux enregistrés, jointures multi-tables
- **Annuler / rétablir** (Ctrl+Z / Ctrl+Y), historique des opérations
- **Recettes** : export des étapes en JSON et rejeu sur un nouveau fichier (automatisation d'un nettoyage récurrent)
- **Export** : CSV, CSV Excel français (`;` et décimales à virgule), TSV, Excel, ODS, JSON, JSON Lines, SQL, Markdown, HTML, XML, copie presse-papiers
- Sauvegarde automatique dans le navigateur, thème clair/sombre, interface adaptée au mobile

## Structure

```
index.html        interface
css/style.css     styles (thèmes clair et sombre)
js/core.js        moteur : outils, statistiques, import/export (sans dépendance, testable sous Node)
js/app.js         logique de l'interface
vendor/           PapaParse, Chart.js, AlaSQL, SheetJS (licences MIT / Apache-2.0)
tests/            tests unitaires du moteur
```

## Ajouter un outil

Chaque outil est une entrée déclarative de `js/core.js` ; le formulaire et l'aperçu sont générés automatiquement :

```js
{
  id: 'monOutil', name: 'Mon outil', desc: 'Ce que fait l\'outil.',
  params: [P.col(), P.num('n', 'Paramètre', 10)],
  run(d, p) { /* renvoie un nouveau { columns, rows } */ },
}
```

## Tests

```bash
npm test
```

## Note sur SheetJS

La page charge SheetJS 0.20.3 depuis le CDN officiel `cdn.sheetjs.com` ; hors ligne, elle se replie sur la copie embarquée `vendor/xlsx.full.min.js` (0.18.5, dernière version publiée sur npm, qui comporte des vulnérabilités connues lors de la lecture de fichiers malveillants). Pour un usage hors ligne avec des fichiers de provenance inconnue, remplacez ce fichier par la version 0.20.3 téléchargée sur https://cdn.sheetjs.com.
