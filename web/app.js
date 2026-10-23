(() => {
  const PAGE_SIZE = 50;
  const FACET_VISIBLE = 100;
  const ORG_CHIP_VISIBLE = 80;

  let rows = [];
  let facets = {
    sources: [],
    annees: [],
    regions: [],
    categories: [],
    programmes: [],
    villes: [],
  };
  let baseFiltered = [];
  let filtered = [];
  /** @type {{ name: string, count: number }[]} */
  let orgOptions = [];
  /** @type {Map<string, { regions: string[], partenaires: { organisme: string, region: string|null, ville: string|null, coordinateur: boolean }[] }>} */
  let projectIndex = new Map();
  let page = 0;

  const SOURCE_HINT = {
    DGDS: "Plan d’action / science",
    DGPIE: "Investissements d’avenir (PIA)",
  };

  /** @type {Record<string, Set<string>>} */
  const selected = {
    sources: new Set(),
    annees: new Set(),
    regions: new Set(),
    categories: new Set(),
    programmes: new Set(),
    villes: new Set(),
    organismes: new Set(),
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    q: $("q"),
    coordOnly: $("coord-only"),
    sort: $("sort"),
    reset: $("reset"),
    exportBtn: $("export"),
    status: $("status"),
    list: $("list"),
    pager: $("pager"),
    prev: $("prev"),
    next: $("next"),
    pageInfo: $("page-info"),
    totalCount: $("total-count"),
    dataMeta: $("data-meta"),
    heroStats: $("hero-stats"),
    statRows: $("stat-rows"),
    statProjets: $("stat-projets"),
    statAide: $("stat-aide"),
    activeChips: $("active-chips"),
    orgPostfilter: $("org-postfilter"),
    orgPostMeta: $("org-post-meta"),
    orgPostSearch: $("org-post-search"),
    orgPostChips: $("org-post-chips"),
    orgPostClear: $("org-post-clear"),
    detail: $("detail"),
    dTitle: $("d-title"),
    dBody: $("d-body"),
  };

  const expand = (r) => ({
    source: r.s || "DGDS",
    code: r.c,
    acronyme: r.a,
    titre: r.t,
    annee: r.y,
    edition: r.e,
    programme: r.p,
    montant_projet: r.m,
    doi: r.d,
    coordinateur: !!r.k,
    organisme: r.o,
    categorie: r.g,
    resp_nom: r.n,
    resp_prenom: r.f,
    ville: r.v,
    region: r.r,
    aide_partenaire: r.h,
  });

  const projectKey = (raw) => `${raw.s || "DGDS"}|${raw.c || ""}`;

  const euro = (n) => {
    if (n == null || Number.isNaN(n)) return "—";
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0,
    }).format(n);
  };

  const norm = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();

  const escapeHtml = (s) =>
    String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");

  /** Build a resolvable DOI URL from a bare DOI, doi:…, or existing http(s) URL. */
  const doiUrl = (raw) => {
    if (!raw) return null;
    const s = String(raw).trim();
    if (!s) return null;
    if (/^https?:\/\//i.test(s)) return s;
    const bare = s.replace(/^doi:\s*/i, "").replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
    return `https://doi.org/${bare}`;
  };

  function renderFacet(name, values, { searchable = false, grid = false } = {}) {
    const root = document.getElementById(`facet-${name}`);
    if (!root) return;

    const searchEl = document.querySelector(`.facet-search[data-search="${name}"]`);
    const q = searchable && searchEl ? norm(searchEl.value.trim()) : "";

    const selectedVals = [...selected[name]];
    let candidates = values;
    if (q) candidates = values.filter((v) => norm(v).includes(q));

    const pinned = selectedVals.filter((v) => values.includes(v) || true);
    const rest = candidates.filter((v) => !selected[name].has(String(v)));
    const shown = [
      ...pinned.map(String),
      ...rest.map(String).slice(0, FACET_VISIBLE),
    ];
    // de-dupe preserving order
    const seen = new Set();
    const uniqueShown = shown.filter((v) => (seen.has(v) ? false : (seen.add(v), true)));

    root.className = grid ? "check-grid" : `check-list${searchable ? " tall" : ""}`;
    root.innerHTML = uniqueShown
      .map((v) => {
        const checked = selected[name].has(v) ? "checked" : "";
        return `<label><input type="checkbox" data-facet="${name}" value="${escapeHtml(v)}" ${checked} /><span>${escapeHtml(v)}</span></label>`;
      })
      .join("");

    if (searchable && !q && rest.length > FACET_VISIBLE) {
      root.insertAdjacentHTML(
        "beforeend",
        `<p class="hint">${rest.length - FACET_VISIBLE} autres — affinez la recherche ci-dessus</p>`
      );
    } else if (searchable && q && rest.length > FACET_VISIBLE) {
      root.insertAdjacentHTML(
        "beforeend",
        `<p class="hint">${rest.length - FACET_VISIBLE} autres correspondances non affichées</p>`
      );
    }

    if (name === "villes") updateVillesBulk(q, candidates);
  }

  function matchingVilles(q) {
    if (!q) return [];
    return facets.villes.filter((v) => norm(v).includes(q));
  }

  function updateVillesBulk(q, candidates) {
    const bulk = document.getElementById("villes-bulk");
    const countEl = document.getElementById("villes-match-count");
    if (!bulk || !countEl) return;
    const matches = candidates || matchingVilles(q);
    if (q && matches.length) {
      bulk.hidden = false;
      countEl.textContent = String(matches.length);
    } else {
      bulk.hidden = true;
    }
  }

  function selectAllFilteredVilles() {
    const searchEl = document.querySelector('.facet-search[data-search="villes"]');
    const q = norm(searchEl?.value.trim() || "");
    const matches = matchingVilles(q);
    if (!matches.length) return;
    for (const v of matches) selected.villes.add(String(v));
    renderFacet("villes", facets.villes, { searchable: true });
    renderActiveChips();
    applyFilters();
  }

  function selectAllSources() {
    selected.sources = new Set(facets.sources.length ? facets.sources : ["DGDS", "DGPIE"]);
  }

  function renderSourcesFacet() {
    const root = $("facet-sources");
    if (!root) return;
    const values = facets.sources.length ? facets.sources : ["DGDS", "DGPIE"];
    root.innerHTML = values
      .map((v) => {
        const checked = selected.sources.has(v) ? "checked" : "";
        const hint = SOURCE_HINT[v] ? ` — ${SOURCE_HINT[v]}` : "";
        return `<label><input type="checkbox" data-facet="sources" value="${escapeHtml(v)}" ${checked} /> ${escapeHtml(v)}<span class="muted-inline">${escapeHtml(hint)}</span></label>`;
      })
      .join("");
  }

  function renderAllFacets() {
    renderSourcesFacet();
    renderFacet("annees", facets.annees.map(String), { grid: true });
    renderFacet("regions", facets.regions);
    renderFacet("categories", facets.categories);
    renderFacet("programmes", facets.programmes, { searchable: true });
    renderFacet("villes", facets.villes, { searchable: true });
    renderActiveChips();
  }

  function renderActiveChips() {
    const chips = [];
    const push = (facet, label, values) => {
      for (const v of values) {
        chips.push(
          `<span class="chip">${label}: ${escapeHtml(v)} <button type="button" data-remove-facet="${facet}" data-value="${encodeURIComponent(v)}">×</button></span>`
        );
      }
    };
    const allSources =
      !facets.sources.length ||
      (selected.sources.size === facets.sources.length &&
        facets.sources.every((s) => selected.sources.has(s)));
    if (selected.sources.size && !allSources) {
      push("sources", "Source", selected.sources);
    }
    push("annees", "Année", selected.annees);
    push("regions", "Région", selected.regions);
    push("categories", "Catégorie", selected.categories);
    push("programmes", "Programme", selected.programmes);
    push("villes", "Ville", selected.villes);
    push("organismes", "Organisme", selected.organismes);
    if (els.coordOnly.checked) {
      chips.push(
        `<span class="chip">Coordinateur <button type="button" data-remove-coord="1">×</button></span>`
      );
    }
    els.activeChips.hidden = chips.length === 0;
    els.activeChips.innerHTML = chips.join("");
  }

  function matchesPrimary(raw) {
    const q = norm(els.q.value.trim());
    const tokens = q ? q.split(/\s+/).filter(Boolean) : [];
    const row = expand(raw);
    // Empty source selection = none; partial = filter; all selected = no filter
    if (selected.sources.size === 0) return false;
    if (
      facets.sources.length &&
      selected.sources.size < facets.sources.length &&
      !selected.sources.has(row.source)
    ) {
      return false;
    }
    if (selected.annees.size && (row.annee == null || !selected.annees.has(String(row.annee)))) return false;
    if (selected.regions.size && !selected.regions.has(row.region || "")) return false;
    if (selected.categories.size && !selected.categories.has(row.categorie || "")) return false;
    if (selected.programmes.size && !selected.programmes.has(row.programme || "")) return false;
    if (selected.villes.size && !selected.villes.has(row.ville || "")) return false;
    if (els.coordOnly.checked && !row.coordinateur) return false;
    if (tokens.length) {
      const hay = norm(
        [
          row.source,
          row.acronyme,
          row.titre,
          row.organisme,
          row.resp_nom,
          row.resp_prenom,
          row.programme,
          row.ville,
          row.region,
          row.code,
        ].join(" ")
      );
      if (!tokens.every((t) => hay.includes(t))) return false;
    }
    return true;
  }

  function buildOrgOptions(list) {
    const counts = new Map();
    for (const raw of list) {
      const name = raw.o;
      if (!name) continue;
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "fr"));
  }

  function renderOrgPostfilter() {
    // Drop org selections that vanished after primary filters changed
    const available = new Set(orgOptions.map((o) => o.name));
    for (const name of [...selected.organismes]) {
      if (!available.has(name)) selected.organismes.delete(name);
    }

    const sourceNarrow =
      facets.sources.length > 0 && selected.sources.size > 0 && selected.sources.size < facets.sources.length;
    const hasPrimary =
      sourceNarrow ||
      selected.annees.size ||
      selected.regions.size ||
      selected.categories.size ||
      selected.programmes.size ||
      selected.villes.size ||
      els.coordOnly.checked ||
      norm(els.q.value.trim());

    // Show post-filter once the primary result set is manageable, or any primary filter is on
    const show = baseFiltered.length > 0 && (hasPrimary || orgOptions.length <= 200);
    els.orgPostfilter.hidden = !show;
    if (!show) {
      selected.organismes.clear();
      return;
    }

    els.orgPostMeta.textContent = `(${orgOptions.length.toLocaleString("fr-FR")} organismes · ${baseFiltered.length.toLocaleString("fr-FR")} lignes)`;

    const q = norm(els.orgPostSearch.value.trim());
    const pinned = orgOptions.filter((o) => selected.organismes.has(o.name));
    const rest = orgOptions.filter((o) => {
      if (selected.organismes.has(o.name)) return false;
      return !q || norm(o.name).includes(q);
    });
    const shown = [...pinned, ...rest.slice(0, ORG_CHIP_VISIBLE)];

    els.orgPostChips.innerHTML =
      shown
        .map((o) => {
          const active = selected.organismes.has(o.name) ? "active" : "";
          return `<button type="button" class="chip toggle ${active}" data-org="${encodeURIComponent(o.name)}">${escapeHtml(o.name)} <span class="count">(${o.count})</span></button>`;
        })
        .join("") +
      (rest.length > ORG_CHIP_VISIBLE
        ? `<span class="hint">${(rest.length - ORG_CHIP_VISIBLE).toLocaleString("fr-FR")} autres — affinez la recherche</span>`
        : "");
  }

  function applyFilters() {
    baseFiltered = rows.filter(matchesPrimary);
    orgOptions = buildOrgOptions(baseFiltered);
    renderOrgPostfilter();

    if (selected.organismes.size) {
      filtered = baseFiltered.filter((raw) => selected.organismes.has(raw.o || ""));
    } else {
      filtered = baseFiltered;
    }

    sortFiltered();
    page = 0;
    renderActiveChips();
    render();
  }

  function sortFiltered() {
    const mode = els.sort.value;
    const cmpStr = (a, b) =>
      String(a || "").localeCompare(String(b || ""), "fr", { sensitivity: "base" });
    filtered.sort((ra, rb) => {
      const a = expand(ra);
      const b = expand(rb);
      if (mode === "annee-desc") return (b.annee || 0) - (a.annee || 0) || cmpStr(a.acronyme, b.acronyme);
      if (mode === "annee-asc") return (a.annee || 0) - (b.annee || 0) || cmpStr(a.acronyme, b.acronyme);
      if (mode === "aide-desc") return (b.aide_partenaire || 0) - (a.aide_partenaire || 0);
      if (mode === "org") return cmpStr(a.organisme, b.organisme);
      if (mode === "region") return cmpStr(a.region, b.region) || cmpStr(a.acronyme, b.acronyme);
      return cmpStr(a.acronyme, b.acronyme);
    });
  }

  function buildProjectIndex() {
    const map = new Map();
    for (const raw of rows) {
      const code = raw.c;
      if (!code) continue;
      const key = projectKey(raw);
      if (!map.has(key)) map.set(key, { regionSet: new Set(), partenaires: [], seenOrg: new Set() });
      const entry = map.get(key);
      if (raw.r) entry.regionSet.add(raw.r);
      const orgKey = raw.o || "";
      if (orgKey && !entry.seenOrg.has(orgKey)) {
        entry.seenOrg.add(orgKey);
        entry.partenaires.push({
          organisme: orgKey,
          region: raw.r || null,
          ville: raw.v || null,
          coordinateur: !!raw.k,
        });
      } else if (orgKey && raw.k) {
        const p = entry.partenaires.find((x) => x.organisme === orgKey);
        if (p) p.coordinateur = true;
      }
    }
    projectIndex = new Map();
    for (const [code, entry] of map) {
      projectIndex.set(code, {
        regions: [...entry.regionSet].sort((a, b) => a.localeCompare(b, "fr")),
        partenaires: entry.partenaires.sort((a, b) => {
          if (a.coordinateur !== b.coordinateur) return a.coordinateur ? -1 : 1;
          return a.organisme.localeCompare(b.organisme, "fr");
        }),
      });
    }
  }

  function projectMeta(rawOrKey) {
    const key = typeof rawOrKey === "string" ? rawOrKey : projectKey(rawOrKey);
    return projectIndex.get(key) || { regions: [], partenaires: [] };
  }

  function renderStats() {
    const projets = new Set(filtered.map((r) => projectKey(r)).filter((k) => !k.endsWith("|"))).size;
    const aide = filtered.reduce((s, r) => s + (r.h || 0), 0);
    els.statRows.textContent = filtered.length.toLocaleString("fr-FR");
    els.statProjets.textContent = projets.toLocaleString("fr-FR");
    els.statAide.textContent = euro(aide);
    els.heroStats.hidden = false;
  }

  function render() {
    renderStats();
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (page >= totalPages) page = totalPages - 1;
    const start = page * PAGE_SIZE;
    const slice = filtered.slice(start, start + PAGE_SIZE);

    if (!filtered.length) {
      els.status.hidden = false;
      els.status.textContent = "Aucun résultat pour ces filtres.";
      els.list.innerHTML = "";
      els.pager.hidden = true;
      return;
    }

    els.status.hidden = true;
    els.list.innerHTML = slice
      .map((raw, i) => {
        const row = expand(raw);
        const idx = start + i;
        const resp = [row.resp_prenom, row.resp_nom].filter(Boolean).join(" ");
        const meta = projectMeta(raw);
        const sourceClass = row.source === "DGPIE" ? "source-dgpie" : "source-dgds";
        const regionBadges = meta.regions
          .map((r) => {
            const highlight = r === row.region ? "badge" : "badge mute";
            return `<span class="${highlight}">${escapeHtml(r)}</span>`;
          })
          .join("");
        const partnersLine = meta.partenaires
          .map((p) => {
            const mark = p.coordinateur ? "★ " : "";
            const loc = [p.ville, p.region].filter(Boolean).join(", ");
            const current = p.organisme === row.organisme ? "current" : "";
            return `<span class="partner ${current}">${mark}${escapeHtml(p.organisme)}${loc ? ` <em>(${escapeHtml(loc)})</em>` : ""}</span>`;
          })
          .join("");
        return `
          <article class="card" data-idx="${idx}" tabindex="0" role="button">
            <div class="card-top">
              <span class="acro">${escapeHtml(row.acronyme || "—")}</span>
              <span class="badge ${sourceClass}">${escapeHtml(row.source)}</span>
              ${row.annee ? `<span class="badge">${row.annee}</span>` : ""}
              ${regionBadges}
              ${row.coordinateur ? `<span class="badge gold">Coordinateur</span>` : ""}
              ${row.programme ? `<span class="badge mute">${escapeHtml(row.programme)}</span>` : ""}
            </div>
            <h3>${escapeHtml(row.titre || "Sans titre")}</h3>
            <p class="meta">
              ${escapeHtml(row.organisme || "Organisme inconnu")}
              ${row.ville ? ` · ${escapeHtml(row.ville)}` : ""}
              ${resp ? ` · ${escapeHtml(resp)}` : ""}
              ${row.aide_partenaire != null ? ` · ${euro(row.aide_partenaire)}` : ""}
            </p>
            ${
              meta.partenaires.length
                ? `<div class="partners"><span class="partners-label">Partenaires du projet (${meta.partenaires.length})</span><div class="partners-list">${partnersLine}</div></div>`
                : ""
            }
          </article>`;
      })
      .join("");

    els.pager.hidden = filtered.length <= PAGE_SIZE;
    els.pageInfo.textContent = `Page ${page + 1} / ${totalPages} · ${filtered.length.toLocaleString("fr-FR")} lignes`;
    els.prev.disabled = page === 0;
    els.next.disabled = page >= totalPages - 1;
  }

  function openDetail(raw) {
    const row = expand(raw);
    const meta = projectMeta(raw);
    els.dTitle.textContent = row.acronyme || "Projet";
    const fields = [
      ["Catégorie ANR", row.source],
      ["Titre", row.titre],
      ["Code décision", row.code],
      ["Année / édition", [row.annee, row.edition].filter(Boolean).join(" · ")],
      ["Programme", row.programme],
      ["Montant projet ANR", euro(row.montant_projet)],
      ["Régions du projet", meta.regions.join(" · ") || null],
      ["Organisme", row.organisme],
      ["Catégorie", row.categorie],
      ["Région", row.region],
      ["Ville", row.ville],
      ["Responsable", [row.resp_prenom, row.resp_nom].filter(Boolean).join(" ")],
      ["Aide partenaire", euro(row.aide_partenaire)],
      ["Coordinateur", row.coordinateur ? "Oui" : "Non"],
      ["DOI", row.doi],
    ];
    const partnersHtml = meta.partenaires.length
      ? `<div class="partners detail-partners">
          <span class="partners-label">Tous les partenaires (${meta.partenaires.length})</span>
          <ul class="partner-ul">
            ${meta.partenaires
              .map((p) => {
                const loc = [p.ville, p.region].filter(Boolean).join(" · ");
                return `<li>${p.coordinateur ? "<strong>★ </strong>" : ""}${escapeHtml(p.organisme)}${loc ? ` <span class="meta">— ${escapeHtml(loc)}</span>` : ""}</li>`;
              })
              .join("")}
          </ul>
        </div>`
      : "";
    els.dBody.innerHTML = `
      <div class="detail-grid">
        ${fields
          .filter(([, v]) => v != null && v !== "" && v !== "—")
          .map(
            ([k, v]) =>
              `<div><span class="k">${escapeHtml(k)}</span><span>${
                k === "DOI" && v
                  ? `<a href="${escapeHtml(doiUrl(v))}" target="_blank" rel="noreferrer">${escapeHtml(v)}</a>`
                  : escapeHtml(v)
              }</span></div>`
          )
          .join("")}
      </div>
      ${partnersHtml}`;
    els.detail.showModal();
  }

  function exportCsv() {
    const cols = [
      "source", "code", "acronyme", "titre", "annee", "edition", "programme",
      "montant_projet", "organisme", "categorie", "region", "ville",
      "resp_prenom", "resp_nom", "coordinateur", "aide_partenaire", "doi",
    ];
    const lines = [cols.join(";")];
    for (const raw of filtered) {
      const row = expand(raw);
      lines.push(
        cols
          .map((c) => {
            let v = row[c];
            if (v == null) v = "";
            if (typeof v === "boolean") v = v ? "Oui" : "Non";
            return `"${String(v).replaceAll('"', '""')}"`;
          })
          .join(";")
      );
    }
    const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ANR_filtre_${filtered.length}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function clearFacet(name) {
    if (name === "sources") {
      selectAllSources();
      renderSourcesFacet();
      applyFilters();
      return;
    }
    selected[name].clear();
    if (
      name === "programmes" ||
      name === "villes" ||
      name === "annees" ||
      name === "regions" ||
      name === "categories"
    ) {
      renderAllFacets();
    }
    if (name === "organismes" && els.orgPostSearch) els.orgPostSearch.value = "";
    applyFilters();
  }

  function bind() {
    let qTimer;
    els.q.addEventListener("input", () => {
      clearTimeout(qTimer);
      qTimer = setTimeout(applyFilters, 180);
    });

    document.querySelector(".filters").addEventListener("change", (e) => {
      const t = e.target;
      if (t.matches('input[type="checkbox"][data-facet]')) {
        const facet = t.dataset.facet;
        if (t.checked) selected[facet].add(t.value);
        else selected[facet].delete(t.value);
        renderActiveChips();
        applyFilters();
      }
    });

    document.querySelectorAll(".facet-search").forEach((input) => {
      input.addEventListener("input", () => {
        const name = input.dataset.search;
        if (name === "programmes") renderFacet("programmes", facets.programmes, { searchable: true });
        if (name === "villes") renderFacet("villes", facets.villes, { searchable: true });
      });
    });

    document.getElementById("villes-select-all")?.addEventListener("click", selectAllFilteredVilles);

    document.querySelectorAll(".clear-facet").forEach((btn) => {
      btn.addEventListener("click", () => clearFacet(btn.dataset.clear));
    });

    els.coordOnly.addEventListener("change", applyFilters);
    els.sort.addEventListener("change", applyFilters);

    els.orgPostChips.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-org]");
      if (!btn) return;
      const name = decodeURIComponent(btn.dataset.org);
      if (selected.organismes.has(name)) selected.organismes.delete(name);
      else selected.organismes.add(name);
      applyFilters();
    });

    els.orgPostSearch.addEventListener("input", () => renderOrgPostfilter());
    els.orgPostClear.addEventListener("click", () => clearFacet("organismes"));

    els.activeChips.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      if (btn.dataset.removeCoord) {
        els.coordOnly.checked = false;
        applyFilters();
        return;
      }
      const facet = btn.dataset.removeFacet;
      const value = btn.dataset.value != null ? decodeURIComponent(btn.dataset.value) : null;
      if (facet && value != null) {
        selected[facet].delete(value);
        renderAllFacets();
        applyFilters();
      }
    });

    els.reset.addEventListener("click", () => {
      els.q.value = "";
      els.coordOnly.checked = false;
      els.sort.value = "annee-desc";
      if (els.orgPostSearch) els.orgPostSearch.value = "";
      document.querySelectorAll(".facet-search").forEach((i) => (i.value = ""));
      Object.values(selected).forEach((s) => s.clear());
      selectAllSources();
      renderAllFacets();
      applyFilters();
    });

    els.exportBtn.addEventListener("click", exportCsv);
    els.prev.addEventListener("click", () => {
      page -= 1;
      render();
      window.scrollTo({ top: els.list.offsetTop - 20, behavior: "smooth" });
    });
    els.next.addEventListener("click", () => {
      page += 1;
      render();
      window.scrollTo({ top: els.list.offsetTop - 20, behavior: "smooth" });
    });

    els.list.addEventListener("click", (e) => {
      const card = e.target.closest(".card");
      if (!card) return;
      openDetail(filtered[Number(card.dataset.idx)]);
    });
    els.list.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const card = e.target.closest(".card");
      if (!card) return;
      e.preventDefault();
      openDetail(filtered[Number(card.dataset.idx)]);
    });
  }

  function formatFrDate(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }

  async function loadMeta() {
    if (!els.dataMeta) return;
    try {
      const res = await fetch("meta.json");
      if (!res.ok) return;
      const meta = await res.json();
      const built = formatFrDate(meta.built_at);
      const bits = [];
      if (built) bits.push(`données régénérées le ${built}`);
      const sources = meta.sources || {};
      const links = Object.entries(sources)
        .map(([key, info]) => {
          const href = info.page || "#";
          const n = info.rows != null ? ` (${Number(info.rows).toLocaleString("fr-FR")})` : "";
          return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(key)}</a>${n}`;
        })
        .join(" · ");
      if (links) bits.push(links);
      else if (meta.source_page) {
        bits.push(
          `<a href="${escapeHtml(meta.source_page)}" target="_blank" rel="noopener">source ANR</a>`
        );
      }
      if (!bits.length) return;
      els.dataMeta.hidden = false;
      els.dataMeta.innerHTML = bits.join(" · ");
    } catch {
      /* optional */
    }
  }

  async function boot() {
    bind();
    try {
      const res = await fetch("data.json");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = await res.json();
      facets = {
        sources: payload.facets?.sources || [],
        annees: payload.facets?.annees || [],
        regions: payload.facets?.regions || [],
        categories: payload.facets?.categories || [],
        programmes: payload.facets?.programmes || [],
        villes: payload.facets?.villes || [],
      };
      rows = payload.rows;
      selectAllSources();
      els.totalCount.textContent = rows.length.toLocaleString("fr-FR");
      buildProjectIndex();
      renderAllFacets();
      applyFilters();
      loadMeta();
    } catch (err) {
      els.status.hidden = false;
      els.status.innerHTML = `
        Impossible de charger <code>data.json</code>.<br />
        Dans <code>anr/web</code> : <code>python3 -m http.server 8877 --bind 127.0.0.1</code><br />
        puis ouvrez <code>http://localhost:8877</code>.
        <br /><small>${escapeHtml(String(err))}</small>`;
    }
  }

  boot();
})();
