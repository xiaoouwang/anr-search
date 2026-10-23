# ANR Search

Explorateur web des projets et partenaires ANR (depuis 2010), toutes régions.

- **Site** : [https://xiaoouwang.github.io/anr-search/](https://xiaoouwang.github.io/anr-search/)
- **Source données** : [ANR_01 sur data.gouv.fr](https://www.data.gouv.fr/datasets/anr-01-projets-anr-dos-et-dgds-detail-des-projets-et-des-partenaires) ([API](https://www.data.gouv.fr/api/1/datasets/anr-01-projets-anr-dos-et-dgds-detail-des-projets-et-des-partenaires/))

## Mise à jour automatique (GitHub)

Chaque lundi (et à la demande via *Actions → Update ANR data & deploy Pages → Run workflow*), un workflow :

1. Télécharge les fichiers *depuis-2010* via l’API data.gouv.fr
2. Régénère `web/data.json` et `web/meta.json`
3. Commit les changements s’il y en a
4. Déploie le dossier `web/` sur **GitHub Pages**

## Local

```bash
pip install -r requirements.txt
python update_data.py --format xlsx   # optionnel si data.json est déjà là
cd web && python3 -m http.server 8877 --bind 127.0.0.1
```

Ouvrir [http://localhost:8877](http://localhost:8877).

Détails des filtres : [web/README.md](web/README.md).
