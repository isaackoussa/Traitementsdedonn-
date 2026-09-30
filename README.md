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

## 🔐 Accès protégé (comme Anglais 365)

On entre avec son **e-mail + un code à 6 chiffres** envoyé par Brevo, sans mot de passe.
- Code valable 10 minutes, 5 essais maximum, 30 s entre deux envois ; seule l'empreinte du code est stockée.
- Session de 6 mois par appareil, bouton 👤 pour se déconnecter.
- E-mail de bienvenue à la création du compte et ajout du contact dans Brevo (liste `BREVO_LIST_ID` facultative).
- **Console admin** sur `/#admin` (clé `ADMIN_KEY`) : comptes, dernière visite, nombre d'ouvertures, **blocage / déblocage** d'un compte.
- Les fichiers de données ne quittent jamais le navigateur : le serveur ne stocke que les comptes (Netlify Blobs).

## Déploiement (GitHub → Netlify)
1. Relie un site Netlify à ce dépôt ; `netlify.toml` règle tout (build `npm run build` → `dist/`, fonctions dans `netlify/functions`).
2. Dans Netlify → Project configuration → **Environment variables**, ajoute :
   - `BREVO_API_KEY` : ta clé API Brevo (tu peux réutiliser celle d'Anglais 365) ;
   - `MAIL_FROM` : l'adresse expéditrice validée dans Brevo ;
   - `ADMIN_KEY` : un mot de passe long pour la console admin ;
   - facultatif : `MAIL_FROM_NAME`, `BREVO_LIST_ID`, `APP_URL` ;
   - seulement en cas d'erreur « MissingBlobsEnvironmentError » : `NETLIFY_SITE_ID` et `NETLIFY_BLOBS_TOKEN`.
3. Redéploie.

Tant que `BREVO_API_KEY` et `MAIL_FROM` ne sont pas configurées, personne ne peut se connecter : c'est voulu. En local sans serveur (`npm start` ou fichier ouvert directement), l'écran de connexion propose **« Continuer en local »** pour tester l'app ; avec `netlify dev` et `MAIL_DRY_RUN=1` (voir `.env.example`), les codes s'affichent dans le terminal.

## Structure

```
index.html        interface
icon.svg, *.png   icône de l'app (+ manifest.webmanifest : installable sur mobile)
css/style.css     styles (thèmes clair et sombre)
js/auth.js        barrière d'accès (e-mail + code) et console admin
js/core.js        moteur : outils, statistiques, import/export (sans dépendance, testable sous Node)
js/app.js         logique de l'interface
netlify/          fonctions serveur : envoi/vérification du code, session, admin (Brevo + Netlify Blobs)
scripts/build.mjs copie les fichiers du site dans dist/
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
npm install
npm test           # moteur de traitement
npm run typecheck  # fonctions serveur
```

## Note sur SheetJS

La page charge SheetJS 0.20.3 depuis le CDN officiel `cdn.sheetjs.com` ; hors ligne, elle se replie sur la copie embarquée `vendor/xlsx.full.min.js` (0.18.5, dernière version publiée sur npm, qui comporte des vulnérabilités connues lors de la lecture de fichiers malveillants). Pour un usage hors ligne avec des fichiers de provenance inconnue, remplacez ce fichier par la version 0.20.3 téléchargée sur https://cdn.sheetjs.com.
