# ANR Search

Explorateur web des projets et partenaires ANR (depuis 2010), **DGDS** et **DGPIE**, toutes régions.

- **Site** : [https://xiaoouwang.github.io/anr-search/](https://xiaoouwang.github.io/anr-search/)
- **DGDS** : [ANR_01](https://www.data.gouv.fr/datasets/anr-01-projets-anr-dos-et-dgds-detail-des-projets-et-des-partenaires) (Plan d’action)
- **DGPIE** : [ANR_02](https://www.data.gouv.fr/datasets/anr-02-projets-anr-dgpie-detail-des-projets-et-des-partenaires) (Investissements d’avenir / PIA)

Sur la page, filtrez **DGDS**, **DGPIE**, ou les deux.

## Mise à jour automatique (GitHub)

Chaque lundi (et via *Actions → Run workflow*), le workflow :

1. Télécharge les fichiers *depuis-2010* des deux jeux via l’API data.gouv.fr
2. Régénère `web/data.json` et `web/meta.json`
3. Commit s’il y a des changements
4. Déploie `web/` sur GitHub Pages

## Local

```bash
pip install -r requirements.txt
python update_data.py --format xlsx
cd web && python3 -m http.server 8877 --bind 127.0.0.1
```

Ouvrir [http://localhost:8877](http://localhost:8877).
