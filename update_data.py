#!/usr/bin/env python3
"""Download latest ANR DGDS (depuis 2010) files from data.gouv.fr and rebuild web/data.json."""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

try:
    import pandas as pd
except ImportError:
    print("pandas required: pip/conda install pandas openpyxl", file=sys.stderr)
    sys.exit(1)

ROOT = Path(__file__).resolve().parent
RAW_DIR = ROOT / "raw"
WEB_DIR = ROOT / "web"
DATASET_API = (
    "https://www.data.gouv.fr/api/1/datasets/"
    "anr-01-projets-anr-dos-et-dgds-detail-des-projets-et-des-partenaires/"
)
DATASET_PAGE = (
    "https://www.data.gouv.fr/datasets/"
    "anr-01-projets-anr-dos-et-dgds-detail-des-projets-et-des-partenaires"
)

UA = "ANR-explorer-update/1.0 (+local; data.gouv.fr reuse)"


def http_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.load(resp)


def download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    print(f"  ↓ {url}")
    with urllib.request.urlopen(req, timeout=600) as resp, open(tmp, "wb") as out:
        while True:
            chunk = resp.read(1024 * 1024)
            if not chunk:
                break
            out.write(chunk)
    tmp.replace(dest)
    print(f"  → {dest.name} ({dest.stat().st_size / 1e6:.1f} Mo)")


def pick_resource(resources: list[dict], kind: str, prefer_format: str = "csv") -> dict:
    """kind: 'projets' | 'partenaires' — pick depuis-2010 resource."""
    candidates = []
    for r in resources:
        title = (r.get("title") or "").lower()
        fmt = (r.get("format") or "").lower()
        if "depuis-2010" not in title:
            continue
        if kind == "projets" and "partenaires" in title:
            continue
        if kind == "partenaires" and "partenaires" not in title:
            continue
        if kind == "projets" and "projets" not in title:
            continue
        if fmt not in {"csv", "xlsx"}:
            continue
        candidates.append(r)
    if not candidates:
        raise SystemExit(f"No depuis-2010 {kind} resource found on data.gouv.fr")

    def score(r: dict) -> tuple:
        fmt = (r.get("format") or "").lower()
        pref = 0 if fmt == prefer_format else 1
        return (pref, -(pd.Timestamp(r.get("last_modified") or 0).timestamp() if r.get("last_modified") else 0))

    candidates.sort(key=score)
    return candidates[0]


def year_of(x) -> int | None:
    if pd.isna(x):
        return None
    m = re.search(r"(20\d{2})", str(x))
    return int(m.group(1)) if m else None


def clean(x):
    if pd.isna(x):
        return None
    if isinstance(x, float) and math.isnan(x):
        return None
    if isinstance(x, (int, float)):
        return x
    s = str(x).strip()
    return s if s and s.lower() != "nan" else None


def money(x):
    try:
        return None if pd.isna(x) else float(x)
    except Exception:
        return None


def read_table(path: Path) -> pd.DataFrame:
    if path.suffix.lower() == ".csv":
        return pd.read_csv(path, low_memory=False)
    return pd.read_excel(path)


def build_payload(proj_path: Path, part_path: Path) -> dict:
    print("Reading tables…")
    proj = read_table(proj_path)
    part = read_table(part_path)

    # Normalize column access (CSV/XLSX should share names)
    needed_proj = [
        "Projet.Code_Decision",
        "AAP.Edition",
        "Projet.Titre.Francais",
        "Programme.Acronyme",
        "Projet.Montant.AF.Aide_allouee.ANR",
        "Projet.T0 scientifique",
        "Projet.DOI",
    ]
    missing = [c for c in needed_proj if c not in proj.columns]
    if missing:
        raise SystemExit(f"Missing project columns: {missing}")

    proj_map = {}
    for _, r in proj.iterrows():
        code = clean(r["Projet.Code_Decision"])
        if not code:
            continue
        edition = clean(r["AAP.Edition"])
        proj_map[code] = {
            "titre": clean(r["Projet.Titre.Francais"]),
            "edition": edition,
            "annee": year_of(edition) or year_of(r["Projet.T0 scientifique"]),
            "programme": clean(r["Programme.Acronyme"]),
            "montant_projet": money(r["Projet.Montant.AF.Aide_allouee.ANR"]),
            "doi": clean(r["Projet.DOI"]),
        }

    records = []
    for _, r in part.iterrows():
        code = clean(r.get("Projet.Code_Decision"))
        meta = proj_map.get(code, {})
        titre = meta.get("titre") or ""
        if len(titre) > 160:
            titre = titre[:160].rsplit(" ", 1)[0] + "…"
        records.append(
            {
                "c": code,
                "a": clean(r.get("Projet.Acronyme")),
                "t": titre or None,
                "y": meta.get("annee"),
                "e": meta.get("edition"),
                "p": meta.get("programme"),
                "m": meta.get("montant_projet"),
                "d": meta.get("doi"),
                "k": 1
                if (
                    pd.notna(r.get("Projet.Partenaire.Est_coordinateur"))
                    and bool(r.get("Projet.Partenaire.Est_coordinateur"))
                )
                else 0,
                "o": clean(r.get("Projet.Partenaire.Nom_organisme")),
                "g": clean(r.get("Projet.Partenaire.Categorie_organisme")),
                "n": clean(r.get("Projet.Partenaire.Responsable_scientifique.Nom")),
                "f": clean(r.get("Projet.Partenaire.Responsable_scientifique.Prenom")),
                "v": clean(r.get("Projet.Partenaire.Adresse.Ville")),
                "r": clean(r.get("Projet.Partenaire.Adresse.Region")),
                "h": money(r.get("Projet.Partenaire.Aide_allouee.ANR")),
            }
        )

    facets = {
        "annees": sorted({row["y"] for row in records if row["y"]}),
        "regions": sorted({row["r"] for row in records if row["r"]}, key=lambda s: s.lower()),
        "categories": sorted({row["g"] for row in records if row["g"]}, key=lambda s: s.lower()),
        "programmes": sorted({row["p"] for row in records if row["p"]}, key=lambda s: s.lower()),
        "villes": sorted({row["v"] for row in records if row["v"]}, key=lambda s: s.lower()),
    }
    return {"facets": facets, "rows": records}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--format",
        choices=["csv", "xlsx"],
        default="csv",
        help="Preferred download format (default: csv)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-download and rebuild even if local files already match",
    )
    parser.add_argument(
        "--rebuild",
        action="store_true",
        help="Rebuild data.json from raw/ without checking remote changes",
    )
    args = parser.parse_args()

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    WEB_DIR.mkdir(parents=True, exist_ok=True)
    state_path = RAW_DIR / "download_state.json"

    prev = {}
    if state_path.exists():
        prev = json.loads(state_path.read_text(encoding="utf-8"))

    if args.rebuild and not args.force:
        # Use last known format / paths from state, or default to csv.
        fmt_p = (prev.get("projets") or {}).get("format") or args.format
        fmt_a = (prev.get("partenaires") or {}).get("format") or args.format
        proj_path = RAW_DIR / f"depuis-2010-projets.{fmt_p}"
        part_path = RAW_DIR / f"depuis-2010-partenaires.{fmt_a}"
        if not proj_path.exists() or not part_path.exists():
            raise SystemExit("raw/ files missing — run without --rebuild first")
        print("Rebuilding from local raw/ (no remote check)…")
        proj_res = prev.get("projets") or {}
        part_res = prev.get("partenaires") or {}
        meta = {"last_modified": None}
        downloaded = False
    else:
        print("Fetching dataset metadata…")
        print(f"  {DATASET_API}")
        meta = http_json(DATASET_API)
        resources = meta.get("resources") or []

        proj_res = pick_resource(resources, "projets", prefer_format=args.format)
        part_res = pick_resource(resources, "partenaires", prefer_format=args.format)

        print(f"Selected projets:     {proj_res['title']} ({proj_res['format']})")
        print(f"Selected partenaires: {part_res['title']} ({part_res['format']})")

        # Stable local names; remote dated filenames change each release.
        proj_path = RAW_DIR / f"depuis-2010-projets.{proj_res['format']}"
        part_path = RAW_DIR / f"depuis-2010-partenaires.{part_res['format']}"

        def needs_download(kind: str, res: dict, path: Path) -> bool:
            if args.force or not path.exists():
                return True
            old = prev.get(kind) or {}
            return old.get("last_modified") != res.get("last_modified") or old.get("id") != res.get("id")

        state = {}
        downloaded = False
        for kind, res, path in (
            ("projets", proj_res, proj_path),
            ("partenaires", part_res, part_path),
        ):
            url = res.get("latest") or res.get("url")
            if needs_download(kind, res, path):
                download(url, path)
                downloaded = True
            else:
                print(f"  skip {path.name} (unchanged since {res.get('last_modified')})")
            state[kind] = {
                "id": res.get("id"),
                "title": res.get("title"),
                "last_modified": res.get("last_modified"),
                "format": res.get("format"),
                "url": url,
            }
        state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

        data_json = WEB_DIR / "data.json"
        if not downloaded and not args.force and data_json.exists():
            print("Nothing changed on data.gouv.fr — data.json left as-is.")
            print("Use --force or --rebuild to regenerate anyway.")
            return

    payload = build_payload(proj_path, part_path)
    out = WEB_DIR / "data.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    built_at = datetime.now(timezone.utc).isoformat()
    meta_out = {
        "source_page": DATASET_PAGE,
        "source_api": DATASET_API,
        "dataset_last_modified": meta.get("last_modified"),
        "projets_resource": {
            "title": proj_res.get("title"),
            "format": proj_res.get("format"),
            "last_modified": proj_res.get("last_modified"),
            "url": proj_res.get("latest") or proj_res.get("url"),
            "id": proj_res.get("id"),
        },
        "partenaires_resource": {
            "title": part_res.get("title"),
            "format": part_res.get("format"),
            "last_modified": part_res.get("last_modified"),
            "url": part_res.get("latest") or part_res.get("url"),
            "id": part_res.get("id"),
        },
        "built_at": built_at,
        "rows": len(payload["rows"]),
        "data_json_mb": round(out.stat().st_size / 1e6, 2),
    }
    (WEB_DIR / "meta.json").write_text(
        json.dumps(meta_out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    print(f"Wrote {out} ({meta_out['data_json_mb']} Mo, {meta_out['rows']} rows)")
    print(f"Wrote {WEB_DIR / 'meta.json'}")
    print("Done. Reload http://localhost:8877")


if __name__ == "__main__":
    main()
