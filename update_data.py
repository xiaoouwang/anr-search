#!/usr/bin/env python3
"""Download latest ANR DGDS + DGPIE (depuis 2010) from data.gouv.fr and rebuild web/data.json."""

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

SOURCES = {
    "DGDS": {
        "slug": "anr-01-projets-anr-dos-et-dgds-detail-des-projets-et-des-partenaires",
        "label": "DGDS",
        "hint": "Plan d'action / science",
    },
    "DGPIE": {
        "slug": "anr-02-projets-anr-dgpie-detail-des-projets-et-des-partenaires",
        "label": "DGPIE",
        "hint": "Investissements d'avenir (PIA)",
    },
}

UA = "ANR-explorer-update/1.0 (+local; data.gouv.fr reuse)"


def dataset_api(slug: str) -> str:
    return f"https://www.data.gouv.fr/api/1/datasets/{slug}/"


def dataset_page(slug: str) -> str:
    return f"https://www.data.gouv.fr/datasets/{slug}"


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


def pick_resource(resources: list[dict], kind: str, prefer_format: str = "xlsx") -> dict:
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
        raise SystemExit(f"No depuis-2010 {kind} resource found")

    def score(r: dict) -> tuple:
        fmt = (r.get("format") or "").lower()
        pref = 0 if fmt == prefer_format else 1
        ts = pd.Timestamp(r.get("last_modified") or 0).timestamp() if r.get("last_modified") else 0
        return (pref, -ts)

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


def col(df: pd.DataFrame, *names: str):
    """Return first matching column name, or None."""
    for n in names:
        if n in df.columns:
            return n
    return None


def read_table(path: Path) -> pd.DataFrame:
    if path.suffix.lower() == ".csv":
        return pd.read_csv(path, low_memory=False)
    return pd.read_excel(path)


def build_records(proj_path: Path, part_path: Path, source: str) -> list[dict]:
    print(f"Reading {source}…")
    proj = read_table(proj_path)
    part = read_table(part_path)

    c_code = col(proj, "Projet.Code_Decision")
    c_titre = col(proj, "Projet.Titre.Francais")
    c_edition = col(proj, "AAP.Edition", "Action.Edition")
    c_programme = col(proj, "Programme.Acronyme", "Action.Titre.Francais")
    c_montant = col(proj, "Projet.Montant.AF.Aide_allouee.ANR", "Projet.Aide_allouee")
    c_t0 = col(proj, "Projet.T0 scientifique", "Projet.Date_debut")
    c_doi = col(proj, "Projet.DOI")

    if not c_code or not c_titre:
        raise SystemExit(f"{source}: missing Projet.Code_Decision / Projet.Titre.Francais")

    proj_map = {}
    for _, r in proj.iterrows():
        code = clean(r[c_code])
        if not code:
            continue
        edition = clean(r[c_edition]) if c_edition else None
        t0 = r[c_t0] if c_t0 else None
        proj_map[code] = {
            "titre": clean(r[c_titre]),
            "edition": edition,
            "annee": year_of(edition) or year_of(t0),
            "programme": clean(r[c_programme]) if c_programme else None,
            "montant_projet": money(r[c_montant]) if c_montant else None,
            "doi": clean(r[c_doi]) if c_doi else None,
        }

    p_code = col(part, "Projet.Code_Decision")
    p_acro = col(part, "Projet.Acronyme")
    p_coord = col(part, "Projet.Partenaire.Est_coordinateur")
    p_org = col(part, "Projet.Partenaire.Nom_organisme")
    p_cat = col(part, "Projet.Partenaire.Categorie_organisme")
    p_nom = col(part, "Projet.Partenaire.Responsable_scientifique.Nom")
    p_prenom = col(part, "Projet.Partenaire.Responsable_scientifique.Prenom")
    p_ville = col(part, "Projet.Partenaire.Adresse.Ville")
    p_region = col(part, "Projet.Partenaire.Adresse.Region")
    p_aide = col(part, "Projet.Partenaire.Aide_allouee.ANR")
    p_edition = col(part, "Action.Edition", "AAP.Edition")

    if not p_code:
        raise SystemExit(f"{source}: missing Projet.Code_Decision in partenaires")

    records = []
    for _, r in part.iterrows():
        code = clean(r[p_code])
        meta = proj_map.get(code, {})
        titre = meta.get("titre") or ""
        if len(titre) > 160:
            titre = titre[:160].rsplit(" ", 1)[0] + "…"
        edition = meta.get("edition") or (clean(r[p_edition]) if p_edition else None)
        annee = meta.get("annee") or year_of(edition)
        coord_val = r[p_coord] if p_coord else False
        records.append(
            {
                "s": source,
                "c": code,
                "a": clean(r[p_acro]) if p_acro else None,
                "t": titre or None,
                "y": annee,
                "e": edition,
                "p": meta.get("programme"),
                "m": meta.get("montant_projet"),
                "d": meta.get("doi"),
                "k": 1 if (pd.notna(coord_val) and bool(coord_val)) else 0,
                "o": clean(r[p_org]) if p_org else None,
                "g": clean(r[p_cat]) if p_cat else None,
                "n": clean(r[p_nom]) if p_nom else None,
                "f": clean(r[p_prenom]) if p_prenom else None,
                "v": clean(r[p_ville]) if p_ville else None,
                "r": clean(r[p_region]) if p_region else None,
                "h": money(r[p_aide]) if p_aide else None,
            }
        )
    print(f"  {source}: {len(records)} partner rows, {len(proj_map)} projects")
    return records


def build_payload(pairs: list[tuple[str, Path, Path]]) -> dict:
    records: list[dict] = []
    for source, proj_path, part_path in pairs:
        records.extend(build_records(proj_path, part_path, source))

    facets = {
        "sources": sorted({row["s"] for row in records if row["s"]}),
        "annees": sorted({row["y"] for row in records if row["y"]}),
        "regions": sorted({row["r"] for row in records if row["r"]}, key=lambda s: s.lower()),
        "categories": sorted({row["g"] for row in records if row["g"]}, key=lambda s: s.lower()),
        "programmes": sorted({row["p"] for row in records if row["p"]}, key=lambda s: s.lower()),
        "villes": sorted({row["v"] for row in records if row["v"]}, key=lambda s: s.lower()),
    }
    return {"facets": facets, "rows": records}


def local_paths(source_key: str, fmt: str) -> tuple[Path, Path]:
    slug = source_key.lower()
    return (
        RAW_DIR / f"{slug}-depuis-2010-projets.{fmt}",
        RAW_DIR / f"{slug}-depuis-2010-partenaires.{fmt}",
    )


def resolve_existing_paths(source_key: str, prefer_fmt: str, state_entry: dict) -> tuple[Path, Path]:
    fmt = (state_entry.get("projets") or {}).get("format") or prefer_fmt
    proj, part = local_paths(source_key, fmt)
    # Legacy DGDS names from earlier versions
    if source_key == "DGDS" and (not proj.exists() or not part.exists()):
        legacy_proj = RAW_DIR / f"depuis-2010-projets.{fmt}"
        legacy_part = RAW_DIR / f"depuis-2010-partenaires.{fmt}"
        if legacy_proj.exists() and legacy_part.exists():
            return legacy_proj, legacy_part
    if not proj.exists() or not part.exists():
        raise SystemExit(f"raw/ files missing for {source_key} — run without --rebuild first")
    return proj, part


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--format", choices=["csv", "xlsx"], default="xlsx")
    parser.add_argument("--force", action="store_true", help="Re-download and rebuild")
    parser.add_argument("--rebuild", action="store_true", help="Rebuild from raw/ only")
    args = parser.parse_args()

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    WEB_DIR.mkdir(parents=True, exist_ok=True)
    state_path = RAW_DIR / "download_state.json"

    prev = {}
    if state_path.exists():
        prev = json.loads(state_path.read_text(encoding="utf-8"))

    pairs: list[tuple[str, Path, Path]] = []
    meta_sources: dict = {}
    downloaded = False

    if args.rebuild and not args.force:
        print("Rebuilding from local raw/ (no remote check)…")
        for key in SOURCES:
            entry = prev.get(key) or {}
            proj_path, part_path = resolve_existing_paths(key, args.format, entry)
            pairs.append((key, proj_path, part_path))
            meta_sources[key] = entry
    else:
        state: dict = {}
        for key, cfg in SOURCES.items():
            api = dataset_api(cfg["slug"])
            print(f"Fetching {key} metadata…")
            print(f"  {api}")
            meta = http_json(api)
            resources = meta.get("resources") or []
            proj_res = pick_resource(resources, "projets", prefer_format=args.format)
            part_res = pick_resource(resources, "partenaires", prefer_format=args.format)
            print(f"  projets:     {proj_res['title']} ({proj_res['format']})")
            print(f"  partenaires: {part_res['title']} ({part_res['format']})")

            proj_path, part_path = local_paths(key, proj_res["format"])
            # partenaires format should match; if mismatch, use each resource's format
            if part_res["format"] != proj_res["format"]:
                part_path = local_paths(key, part_res["format"])[1]

            def needs_download(kind: str, res: dict, path: Path) -> bool:
                if args.force or not path.exists():
                    return True
                old = ((prev.get(key) or {}).get(kind)) or {}
                return old.get("last_modified") != res.get("last_modified") or old.get("id") != res.get("id")

            src_state = {"dataset_last_modified": meta.get("last_modified"), "page": dataset_page(cfg["slug"])}
            for kind, res, path in (
                ("projets", proj_res, proj_path),
                ("partenaires", part_res, part_path),
            ):
                url = res.get("latest") or res.get("url")
                if needs_download(kind, res, path):
                    download(url, path)
                    downloaded = True
                else:
                    print(f"  skip {path.name} (unchanged)")
                src_state[kind] = {
                    "id": res.get("id"),
                    "title": res.get("title"),
                    "last_modified": res.get("last_modified"),
                    "format": res.get("format"),
                    "url": url,
                }
            state[key] = src_state
            meta_sources[key] = src_state
            pairs.append((key, proj_path, part_path))

        state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

        data_json = WEB_DIR / "data.json"
        if not downloaded and not args.force and data_json.exists():
            # Still rebuild if schema/source set changed (no s field yet)
            try:
                sample = json.loads(data_json.read_text(encoding="utf-8"))
                rows = sample.get("rows") or []
                if rows and "s" in rows[0] and "sources" in (sample.get("facets") or {}):
                    print("Nothing changed on data.gouv.fr — data.json left as-is.")
                    print("Use --force or --rebuild to regenerate anyway.")
                    return
                print("Existing data.json lacks dual-source schema — rebuilding.")
            except Exception:
                pass

    payload = build_payload(pairs)
    out = WEB_DIR / "data.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    counts = {}
    for row in payload["rows"]:
        counts[row["s"]] = counts.get(row["s"], 0) + 1

    meta_out = {
        "sources": {
            key: {
                "label": SOURCES[key]["label"],
                "hint": SOURCES[key]["hint"],
                "page": dataset_page(SOURCES[key]["slug"]),
                "api": dataset_api(SOURCES[key]["slug"]),
                "dataset_last_modified": (meta_sources.get(key) or {}).get("dataset_last_modified"),
                "projets": (meta_sources.get(key) or {}).get("projets"),
                "partenaires": (meta_sources.get(key) or {}).get("partenaires"),
                "rows": counts.get(key, 0),
            }
            for key in SOURCES
        },
        "built_at": datetime.now(timezone.utc).isoformat(),
        "rows": len(payload["rows"]),
        "data_json_mb": round(out.stat().st_size / 1e6, 2),
    }
    (WEB_DIR / "meta.json").write_text(
        json.dumps(meta_out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    print(f"Wrote {out} ({meta_out['data_json_mb']} Mo, {meta_out['rows']} rows) {counts}")
    print(f"Wrote {WEB_DIR / 'meta.json'}")
    print("Done.")


if __name__ == "__main__":
    main()
