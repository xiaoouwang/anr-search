# ANR Search

Explorateur web des **projets et partenaires ANR** (depuis 2010), toutes régions : **DGDS** (Plan d’action) et **DGPIE** (Investissements d’avenir / PIA / France 2030).

| | |
|---|---|
| **Site en ligne** | [https://xiaoouwang.github.io/anr-search/](https://xiaoouwang.github.io/anr-search/) |
| **Dépôt** | [https://github.com/xiaoouwang/anr-search](https://github.com/xiaoouwang/anr-search) |
| **Auteur** | [Xiaoou Wang](https://xiaoouwang.github.io/) — [ingénieur en humanités numériques](https://mshs.univ-cotedazur.fr/services/humanites-numeriques), MSHS Sud-Est, Université Côte d’Azur |

---

## Utiliser l’application

1. Ouvrir le [site](https://xiaoouwang.github.io/anr-search/) (ou la version locale, voir plus bas).
2. Choisir la **catégorie ANR** : DGDS, DGPIE, ou les deux.
3. Affiner avec années, régions, programmes, villes, organismes, « Coordinateur uniquement », recherche texte.
4. Cliquer une carte pour ouvrir la fiche : DOI (si présent), **fiche ANR** (`https://anr.fr/Projet-{code}`), recherches Google (code / titre).
5. Exporter le résultat filtré en CSV.

---

## Sources de données (data.gouv.fr)

Les données officielles viennent de l’[Agence nationale de la recherche](https://anr.fr/) publiées sur data.gouv.fr.

### Jeux de données

| Catégorie | Jeu data.gouv.fr | Page | API JSON |
|-----------|------------------|------|----------|
| **DGDS** | ANR_01 — Projets ANR DOS et DGDS | [page](https://www.data.gouv.fr/datasets/anr-01-projets-anr-dos-et-dgds-detail-des-projets-et-des-partenaires) | [`/api/1/datasets/anr-01-…/`](https://www.data.gouv.fr/api/1/datasets/anr-01-projets-anr-dos-et-dgds-detail-des-projets-et-des-partenaires/) |
| **DGPIE** | ANR_02 — Projets ANR DGPIE | [page](https://www.data.gouv.fr/datasets/anr-02-projets-anr-dgpie-detail-des-projets-et-des-partenaires) | [`/api/1/datasets/anr-02-…/`](https://www.data.gouv.fr/api/1/datasets/anr-02-projets-anr-dgpie-detail-des-projets-et-des-partenaires/) |

### Ressources utilisées

Pour chaque jeu, le script sélectionne les fichiers dont le titre contient **`depuis-2010`**, en paire **projets** + **partenaires** (formats `xlsx` ou `csv`).

- Téléchargement via l’URL stable data.gouv.fr :  
  `https://www.data.gouv.fr/api/1/datasets/r/{resource_id}`  
  (champ `latest` de chaque ressource dans la réponse API — toujours la dernière version).
- Documentation API portail : [guides.data.gouv.fr — datasets](https://guides.data.gouv.fr/api-de-data.gouv.fr/reference/datasets).

Exemple de requête métadonnées :

```bash
curl -sS "https://www.data.gouv.fr/api/1/datasets/anr-01-projets-anr-dos-et-dgds-detail-des-projets-et-des-partenaires/" \
  | python -m json.tool | head
```

Licence des données : [ODbL](https://opendatacommons.org/licenses/odbl/) (voir chaque fiche data.gouv.fr).

---

## Mise à jour automatique (GitHub Actions)

Le workflow [`.github/workflows/update-and-deploy.yml`](.github/workflows/update-and-deploy.yml) :

| Déclencheur | Effet |
|-------------|--------|
| **Chaque lundi** 05:00 UTC | Télécharge les dernières ressources, régénère `data.json` / `meta.json`, commit si changement, déploie Pages |
| **Actions → Run workflow** | Idem, à la demande |
| **Push sur `main`** | Redéploie Pages (sans re-télécharger les données sauf schedule / dispatch) |

Fichiers produits côté site :

- `web/data.json` — lignes partenaires compactes + facettes
- `web/meta.json` — dates de mise à jour **par source** (DGDS / DGPIE) et liens data.gouv.fr

Pages : [https://xiaoouwang.github.io/anr-search/](https://xiaoouwang.github.io/anr-search/) (source = GitHub Actions).

---

## Installer et lancer en local

Prérequis : Python 3.10+, `pip`.

```bash
git clone https://github.com/xiaoouwang/anr-search.git
cd anr-search
pip install -r requirements.txt
```

### Régénérer les données

```bash
python update_data.py --format xlsx          # défaut recommandé (fichiers plus légers)
python update_data.py --format csv
python update_data.py --force                # forcer re-téléchargement + rebuild
python update_data.py --rebuild              # rebuild depuis raw/ sans vérifier le distant
```

Le script :

1. Interroge les deux API datasets ci-dessus
2. Choisit les ressources *depuis-2010* projets + partenaires
3. Télécharge dans `raw/` (état dans `raw/download_state.json` pour éviter les téléchargements inutiles)
4. Fusionne et écrit `web/data.json` + `web/meta.json`

### Servir l’interface

```bash
cd web
python3 -m http.server 8877 --bind 127.0.0.1
```

Ouvrir [http://127.0.0.1:8877](http://127.0.0.1:8877).

> Le navigateur ne charge pas `data.json` via `file://` : un petit serveur HTTP est obligatoire.

---

## Structure du dépôt

```
anr-search/
├── update_data.py          # téléchargement API + construction data.json
├── requirements.txt        # pandas, openpyxl
├── .github/workflows/      # update hebdo + deploy Pages
├── raw/                    # caches locaux (gitignored)
└── web/                    # site statique déployé
    ├── index.html
    ├── app.js
    ├── app.css
    ├── data.json
    └── meta.json
```

Champ `s` dans chaque ligne de `data.json` : `"DGDS"` ou `"DGPIE"`.

### Repérer les nouveaux projets

Mettre la date de mise à jour du jeu data.gouv.fr sur chaque carte ne distinguerait pas les projets déjà connus des nouveaux. À la place :

- `web/first_seen.json` mémorise la **date de première apparition** de chaque code (`SOURCE|CODE` → `YYYY-MM-DD`)
- chaque ligne a `fs` (cette date) et `n` (`1` = apparu lors du dernier rafraîchissement)
- badge **Nouveau** + filtre « Nouveaux projets uniquement »

Au premier déploiement de cette fonctionnalité, tous les projets existants sont enregistrés sans badge « Nouveau » ; seuls les codes absents du registre au prochain `update_data.py` seront marqués.

---

## Réutiliser / adapter

1. Forker le dépôt (ou cloner).
2. Activer **GitHub Pages** : Settings → Pages → Source = **GitHub Actions**.
3. Adapter éventuellement les slugs dans `update_data.py` (`SOURCES`).
4. Lancer une fois *Actions → Update ANR data & deploy Pages → Run workflow*.
5. Le site sera sur `https://<user>.github.io/<repo>/`.

Pour un cron local à la place de GitHub Actions :

```cron
0 6 * * 1 cd /chemin/vers/anr-search && python update_data.py --format xlsx >> update.log 2>&1
```

---

## Liens utiles

- [anr.fr](https://anr.fr/) — site de l’Agence (fiches projet : `https://anr.fr/Projet-{code}`)
- [Service Humanités numériques — MSHS Sud-Est](https://mshs.univ-cotedazur.fr/services/humanites-numeriques)
- [Page perso](https://xiaoouwang.github.io/) · [GitHub](https://github.com/xiaoouwang)
