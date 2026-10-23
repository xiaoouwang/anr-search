# Explorateur ANR (toutes régions)

Interface web pour filtrer l’ensemble des projets / partenaires ANR (fusion des deux tables).

- En ligne : [https://xiaoouwang.github.io/anr-search/](https://xiaoouwang.github.io/anr-search/)
- Sources : [ANR_01 DGDS](https://www.data.gouv.fr/datasets/anr-01-projets-anr-dos-et-dgds-detail-des-projets-et-des-partenaires) · [ANR_02 DGPIE](https://www.data.gouv.fr/datasets/anr-02-projets-anr-dgpie-detail-des-projets-et-des-partenaires)

## Lancer en local

```bash
cd web
python3 -m http.server 8877 --bind 127.0.0.1
```

Ouvrir : [http://localhost:8877](http://localhost:8877)

> Le navigateur ne charge pas `data.json` via `file://`.

## Mise à jour des données

Sur GitHub, un workflow hebdomadaire (voir le README racine) fait la même chose que :

```bash
python update_data.py --format xlsx
```

Options locales : `--force`, `--rebuild`, `--format csv|xlsx`.

## Filtres (multi-sélection)

- Recherche texte
- **Années**, **régions**, **catégories**, **programmes**, **villes** : cases à cocher (plusieurs choix)
- **Organismes** : barre de chips *après* filtrage (organismes présents dans le résultat courant)
- Coordinateur uniquement
- Tri + export CSV du résultat filtré

Les listes longues (villes, programmes) se filtrent via le champ de recherche au-dessus des cases.
