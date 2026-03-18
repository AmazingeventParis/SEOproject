// SEO Nugget Grabber - Content Script
(function () {
  const API_BASE_KEY = "sng_api_base";
  const SITES_CACHE_KEY = "sng_sites";
  const PERSONAS_CACHE_KEY = "sng_personas";
  const PREFS_KEY = "sng_prefs";

  let overlay = null;

  function getApiBase() {
    return new Promise((resolve) => {
      chrome.storage.local.get(API_BASE_KEY, (data) => {
        resolve(data[API_BASE_KEY] || "https://seo.swipego.app");
      });
    });
  }

  function getPrefs() {
    return new Promise((resolve) => {
      chrome.storage.local.get(PREFS_KEY, (data) => {
        resolve(data[PREFS_KEY] || {});
      });
    });
  }

  function savePrefs(prefs) {
    return new Promise((resolve) => {
      chrome.storage.local.get(PREFS_KEY, (data) => {
        chrome.storage.local.set({ [PREFS_KEY]: { ...(data[PREFS_KEY] || {}), ...prefs } }, resolve);
      });
    });
  }

  async function fetchSites() {
    const base = await getApiBase();
    try {
      const res = await fetch(`${base}/api/sites`);
      if (!res.ok) throw new Error("Failed to fetch sites");
      const sites = await res.json();
      chrome.storage.local.set({ [SITES_CACHE_KEY]: sites });
      return sites;
    } catch (e) {
      return new Promise((resolve) => {
        chrome.storage.local.get(SITES_CACHE_KEY, (data) => resolve(data[SITES_CACHE_KEY] || []));
      });
    }
  }

  async function fetchPersonas(siteId) {
    if (!siteId) return [];
    const base = await getApiBase();
    try {
      const res = await fetch(`${base}/api/personas?site_id=${siteId}`);
      if (!res.ok) throw new Error("Failed to fetch personas");
      const personas = await res.json();
      chrome.storage.local.set({ [PERSONAS_CACHE_KEY]: personas });
      return personas;
    } catch (e) {
      return new Promise((resolve) => {
        chrome.storage.local.get(PERSONAS_CACHE_KEY, (data) => resolve(data[PERSONAS_CACHE_KEY] || []));
      });
    }
  }

  function showToast(msg, isError = false) {
    let toast = document.getElementById("sng-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "sng-toast";
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.background = isError ? "#991b1b" : "#166534";
    toast.classList.add("sng-visible");
    setTimeout(() => toast.classList.remove("sng-visible"), 3000);
  }

  function removeOverlay() {
    if (overlay) {
      overlay.classList.add("sng-hidden");
      setTimeout(() => {
        if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
        overlay = null;
      }, 300);
    }
  }

  function createOverlay() {
    removeOverlay();
    overlay = document.createElement("div");
    overlay.id = "sng-overlay";
    document.body.appendChild(overlay);
    return overlay;
  }

  // ==================== SHARED: Site checkboxes + persona + tags ====================

  function renderSiteCheckboxes(sites, selectedIds) {
    return sites.map((s) => `
      <label class="sng-site-check">
        <input type="checkbox" value="${s.id}" ${selectedIds.includes(s.id) ? "checked" : ""} />
        <span>${escapeHtml(s.name)}</span>
        <small style="color:#94a3b8">${escapeHtml(s.domain)}</small>
      </label>
    `).join("");
  }

  function setupTagInput(tagInput, tagsContainer, initialTags) {
    const tags = [...initialTags];

    function renderTags() {
      tagsContainer.innerHTML = tags
        .map((t, i) => `<span class="sng-tag">${escapeHtml(t)}<button data-i="${i}">&times;</button></span>`)
        .join("");
      tagsContainer.querySelectorAll("button").forEach((btn) => {
        btn.addEventListener("click", () => {
          tags.splice(parseInt(btn.dataset.i), 1);
          renderTags();
        });
      });
    }

    tagInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && tagInput.value.trim()) {
        e.preventDefault();
        const tag = tagInput.value.trim().toLowerCase();
        if (!tags.includes(tag)) {
          tags.push(tag);
          renderTags();
        }
        tagInput.value = "";
      }
    });

    renderTags();
    return { getTags: () => [...tags] };
  }

  function getCheckedSiteIds(container) {
    return Array.from(container.querySelectorAll('.sng-site-check input:checked')).map((cb) => cb.value);
  }

  // Save one nugget per checked site (or once with site_id=null if none checked)
  async function saveNuggetToSites({ content, siteIds, personaId, tags, sourceRef }) {
    const base = await getApiBase();
    let saved = 0;
    let errors = 0;

    const targets = siteIds.length > 0 ? siteIds : [null];

    for (const siteId of targets) {
      try {
        const res = await fetch(`${base}/api/nuggets`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content,
            source_type: "url",
            source_ref: sourceRef || null,
            site_id: siteId,
            persona_id: personaId || null,
            tags: tags.length > 0 ? tags : undefined,
          }),
        });
        if (res.ok) saved++;
        else errors++;
      } catch {
        errors++;
      }
    }

    return { saved, errors };
  }

  // ==================== SAVE DIALOG (for selected text) ====================
  async function showSaveDialog(text, url) {
    const panel = createOverlay();
    const sites = await fetchSites();
    const prefs = await getPrefs();
    const selectedSiteIds = prefs.site_ids || (prefs.site_id ? [prefs.site_id] : []);

    panel.innerHTML = `
      <div class="sng-header">
        <h2>💎 Sauvegarder un nugget</h2>
        <button class="sng-close" id="sng-close">&times;</button>
      </div>
      <div class="sng-body">
        <div id="sng-msg"></div>
        <div class="sng-field">
          <label>Contenu</label>
          <textarea id="sng-content">${escapeHtml(text)}</textarea>
        </div>
        <div class="sng-field">
          <label>Sites (cocher un ou plusieurs)</label>
          <div id="sng-sites" class="sng-site-list">
            ${renderSiteCheckboxes(sites, selectedSiteIds)}
          </div>
        </div>
        <div class="sng-field">
          <label>Persona (optionnel)</label>
          <select id="sng-persona">
            <option value="">-- Aucun --</option>
          </select>
        </div>
        <div class="sng-field">
          <label>Tags (Entree pour ajouter)</label>
          <input id="sng-tag-input" placeholder="ex: isolation, renovation..." />
          <div class="sng-tags" id="sng-tags"></div>
        </div>
        <div class="sng-field">
          <label>Source</label>
          <input id="sng-source" value="${escapeHtml(url || "")}" readonly style="color:#94a3b8" />
        </div>
        <button class="sng-btn sng-btn-primary" id="sng-save">💾 Sauvegarder</button>
      </div>
    `;

    const personaSelect = panel.querySelector("#sng-persona");
    const sitesContainer = panel.querySelector("#sng-sites");
    const tagCtrl = setupTagInput(
      panel.querySelector("#sng-tag-input"),
      panel.querySelector("#sng-tags"),
      []
    );

    // Load personas for first checked site
    async function loadPersonas() {
      const checkedIds = getCheckedSiteIds(sitesContainer);
      const firstSiteId = checkedIds[0] || "";
      const personas = await fetchPersonas(firstSiteId);
      personaSelect.innerHTML =
        '<option value="">-- Aucun --</option>' +
        personas.map((p) => `<option value="${p.id}" ${p.id === prefs.persona_id ? "selected" : ""}>${p.name} (${p.role})</option>`).join("");
    }

    sitesContainer.addEventListener("change", loadPersonas);
    loadPersonas();

    // Save
    panel.querySelector("#sng-save").addEventListener("click", async () => {
      const content = panel.querySelector("#sng-content").value.trim();
      if (!content) return;

      const siteIds = getCheckedSiteIds(sitesContainer);
      if (siteIds.length === 0) {
        showToast("Cochez au moins un site", true);
        return;
      }

      const msgEl = panel.querySelector("#sng-msg");
      msgEl.innerHTML = '<div class="sng-status loading">⏳ Sauvegarde en cours...</div>';

      savePrefs({ site_ids: siteIds, persona_id: personaSelect.value });

      const { saved, errors } = await saveNuggetToSites({
        content,
        siteIds,
        personaId: personaSelect.value,
        tags: tagCtrl.getTags(),
        sourceRef: url,
      });

      if (errors === 0) {
        msgEl.innerHTML = `<div class="sng-status success">✅ Nugget sauvegarde sur ${saved} site(s) !</div>`;
        showToast(`💎 Nugget sauvegarde sur ${saved} site(s) !`);
        setTimeout(removeOverlay, 1500);
      } else {
        msgEl.innerHTML = `<div class="sng-status error">⚠️ ${saved} OK, ${errors} erreur(s)</div>`;
      }
    });

    panel.querySelector("#sng-close").addEventListener("click", removeOverlay);
  }

  // ==================== ANALYZE PAGE (AI extraction) ====================
  async function showAnalyzePage(url) {
    const panel = createOverlay();
    const sites = await fetchSites();
    const prefs = await getPrefs();
    const selectedSiteIds = prefs.site_ids || (prefs.site_id ? [prefs.site_id] : []);

    panel.innerHTML = `
      <div class="sng-header">
        <h2>🔍 Analyser la page</h2>
        <button class="sng-close" id="sng-close">&times;</button>
      </div>
      <div class="sng-body">
        <div id="sng-msg"></div>
        <div class="sng-field">
          <label>Sujet cible (optionnel)</label>
          <input id="sng-topic" placeholder="ex: isolation thermique, pompe a chaleur..." value="${escapeHtml((prefs.topic || ""))}" />
        </div>
        <button class="sng-btn sng-btn-primary" id="sng-extract">🤖 Extraire les pepites</button>

        <div id="sng-results" style="margin-top:16px"></div>

        <div id="sng-save-section" style="display:none">
          <div class="sng-divider"></div>
          <h3 style="font-size:13px;font-weight:700;margin-bottom:10px;color:#475569">Ou sauvegarder ?</h3>
          <div class="sng-field">
            <label>Sites (cocher un ou plusieurs)</label>
            <div id="sng-sites" class="sng-site-list">
              ${renderSiteCheckboxes(sites, selectedSiteIds)}
            </div>
          </div>
          <div class="sng-field">
            <label>Persona (optionnel)</label>
            <select id="sng-persona">
              <option value="">-- Aucun --</option>
            </select>
          </div>
          <div class="sng-field">
            <label>Tags supplementaires (Entree pour ajouter)</label>
            <input id="sng-tag-input" placeholder="ex: isolation, renovation..." />
            <div class="sng-tags" id="sng-tags"></div>
          </div>
          <button class="sng-btn sng-btn-primary" id="sng-save-all">💾 Sauvegarder la selection</button>
        </div>
      </div>
    `;

    const personaSelect = panel.querySelector("#sng-persona");
    const sitesContainer = panel.querySelector("#sng-sites");
    const saveSection = panel.querySelector("#sng-save-section");

    // Load personas for first checked site
    async function loadPersonas() {
      const checkedIds = getCheckedSiteIds(sitesContainer);
      const firstSiteId = checkedIds[0] || "";
      const personas = await fetchPersonas(firstSiteId);
      personaSelect.innerHTML =
        '<option value="">-- Aucun --</option>' +
        personas.map((p) => `<option value="${p.id}" ${p.id === prefs.persona_id ? "selected" : ""}>${p.name} (${p.role})</option>`).join("");
    }

    sitesContainer.addEventListener("change", loadPersonas);
    loadPersonas();

    const tagCtrl = setupTagInput(
      panel.querySelector("#sng-tag-input"),
      panel.querySelector("#sng-tags"),
      []
    );

    panel.querySelector("#sng-close").addEventListener("click", removeOverlay);

    let extractedNuggets = [];

    // Extract button
    panel.querySelector("#sng-extract").addEventListener("click", async () => {
      const topic = panel.querySelector("#sng-topic").value.trim();
      const msgEl = panel.querySelector("#sng-msg");
      const resultsEl = panel.querySelector("#sng-results");

      savePrefs({ topic });

      msgEl.innerHTML = '<div class="sng-status loading">🤖 Analyse IA en cours... (10-30 secondes)</div>';
      resultsEl.innerHTML = "";
      saveSection.style.display = "none";

      const pageContent = extractPageText();
      const base = await getApiBase();

      try {
        const res = await fetch(`${base}/api/nuggets/web-extract`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: pageContent,
            url: url || undefined,
            topic: topic || undefined,
          }),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Erreur serveur");
        }

        const data = await res.json();
        extractedNuggets = data.nuggets || [];

        if (extractedNuggets.length === 0) {
          msgEl.innerHTML = '<div class="sng-status error">Aucune pepite trouvee sur cette page.</div>';
          return;
        }

        msgEl.innerHTML = `<div class="sng-status success">✅ ${extractedNuggets.length} pepites trouvees — selectionnez puis sauvegardez</div>`;

        // Render nuggets with checkboxes
        resultsEl.innerHTML = `
          <div class="sng-count">${extractedNuggets.length} pepites extraites</div>
          ${extractedNuggets.map((n, i) => `
            <div class="sng-nugget-card selected">
              <label>
                <input type="checkbox" class="sng-nugget-cb" data-i="${i}" checked />
                <span>${escapeHtml(n.content)}</span>
              </label>
              <div class="sng-tags" style="margin-top:6px;margin-left:24px">
                ${(n.tags || []).map((t) => `<span class="sng-tag">${escapeHtml(t)}</span>`).join("")}
              </div>
            </div>
          `).join("")}
        `;

        // Toggle card style
        resultsEl.querySelectorAll(".sng-nugget-cb").forEach((cb) => {
          cb.addEventListener("change", () => {
            cb.closest(".sng-nugget-card").classList.toggle("selected", cb.checked);
          });
        });

        // Show save section (sites + persona + tags)
        saveSection.style.display = "block";

      } catch (e) {
        msgEl.innerHTML = `<div class="sng-status error">❌ ${escapeHtml(e.message)}</div>`;
      }
    });

    // Save selected nuggets
    panel.querySelector("#sng-save-all").addEventListener("click", async () => {
      const siteIds = getCheckedSiteIds(sitesContainer);
      if (siteIds.length === 0) {
        showToast("Cochez au moins un site", true);
        return;
      }

      const checkedBoxes = panel.querySelectorAll(".sng-nugget-cb:checked");
      const selected = Array.from(checkedBoxes).map((cb) => extractedNuggets[parseInt(cb.dataset.i)]);

      if (selected.length === 0) {
        showToast("Selectionnez au moins une pepite", true);
        return;
      }

      const msgEl = panel.querySelector("#sng-msg");
      const extraTags = tagCtrl.getTags();
      const personaId = personaSelect.value;

      savePrefs({ site_ids: siteIds, persona_id: personaId });

      const totalOps = selected.length * siteIds.length;
      msgEl.innerHTML = `<div class="sng-status loading">⏳ Sauvegarde de ${selected.length} pepites sur ${siteIds.length} site(s)... (${totalOps} operations)</div>`;

      let saved = 0;
      let errors = 0;

      for (const nugget of selected) {
        // Merge AI tags + user extra tags (no duplicates)
        const allTags = [...new Set([...(nugget.tags || []), ...extraTags])];

        const result = await saveNuggetToSites({
          content: nugget.content,
          siteIds,
          personaId,
          tags: allTags,
          sourceRef: url,
        });
        saved += result.saved;
        errors += result.errors;
      }

      if (errors === 0) {
        msgEl.innerHTML = `<div class="sng-status success">✅ ${saved} nuggets sauvegardes !</div>`;
        showToast(`💎 ${saved} nuggets sauvegardes !`);
      } else {
        msgEl.innerHTML = `<div class="sng-status error">⚠️ ${saved} OK, ${errors} erreur(s)</div>`;
      }
    });
  }

  // ==================== UTILITIES ====================

  function extractPageText() {
    const selectorsToRemove = [
      "nav", "header", "footer", "aside",
      '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
      ".sidebar", ".nav", ".menu", ".footer", ".header", ".ad", ".ads",
      ".cookie", ".popup", ".modal", "#comments", ".comments",
      "script", "style", "noscript", "iframe",
    ];

    const clone = document.body.cloneNode(true);
    selectorsToRemove.forEach((sel) => {
      clone.querySelectorAll(sel).forEach((el) => el.remove());
    });

    const mainContent =
      clone.querySelector("main") ||
      clone.querySelector("article") ||
      clone.querySelector('[role="main"]') ||
      clone.querySelector(".post-content") ||
      clone.querySelector(".entry-content") ||
      clone.querySelector(".article-content") ||
      clone;

    let text = mainContent.innerText || mainContent.textContent || "";
    text = text.replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
    return text;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ==================== MESSAGE LISTENER ====================
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "show-save-dialog") {
      showSaveDialog(msg.text, msg.url);
    }
    if (msg.action === "analyze-page") {
      showAnalyzePage(msg.url);
    }
  });
})();
