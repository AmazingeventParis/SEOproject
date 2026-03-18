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
    chrome.storage.local.set({ [PREFS_KEY]: prefs });
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
      // Try cache
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

  // ==================== SAVE DIALOG (for selected text) ====================
  async function showSaveDialog(text, url) {
    const panel = createOverlay();
    const sites = await fetchSites();
    const prefs = await getPrefs();

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
          <label>Site</label>
          <select id="sng-site">
            <option value="">-- Tous les sites --</option>
            ${sites.map((s) => `<option value="${s.id}" ${s.id === prefs.site_id ? "selected" : ""}>${s.name} (${s.domain})</option>`).join("")}
          </select>
        </div>
        <div class="sng-field">
          <label>Persona</label>
          <select id="sng-persona">
            <option value="">-- Aucun --</option>
          </select>
        </div>
        <div class="sng-field">
          <label>Tags (Entrée pour ajouter)</label>
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

    const tags = [];
    const siteSelect = panel.querySelector("#sng-site");
    const personaSelect = panel.querySelector("#sng-persona");

    // Load personas when site changes
    async function loadPersonas() {
      const siteId = siteSelect.value;
      const personas = await fetchPersonas(siteId);
      personaSelect.innerHTML =
        '<option value="">-- Aucun --</option>' +
        personas.map((p) => `<option value="${p.id}" ${p.id === prefs.persona_id ? "selected" : ""}>${p.name} (${p.role})</option>`).join("");
    }

    siteSelect.addEventListener("change", loadPersonas);
    loadPersonas();

    // Tags
    const tagInput = panel.querySelector("#sng-tag-input");
    const tagsContainer = panel.querySelector("#sng-tags");

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

    // Save
    panel.querySelector("#sng-save").addEventListener("click", async () => {
      const content = panel.querySelector("#sng-content").value.trim();
      if (!content) return;

      const msgEl = panel.querySelector("#sng-msg");
      msgEl.innerHTML = '<div class="sng-status loading">⏳ Sauvegarde en cours...</div>';

      const base = await getApiBase();
      const body = {
        content,
        source_type: "url",
        source_ref: url || null,
        site_id: siteSelect.value || null,
        persona_id: personaSelect.value || null,
        tags: tags.length > 0 ? tags : undefined,
      };

      // Save prefs
      savePrefs({ site_id: siteSelect.value, persona_id: personaSelect.value });

      try {
        const res = await fetch(`${base}/api/nuggets`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Erreur serveur");
        }

        msgEl.innerHTML = '<div class="sng-status success">✅ Nugget sauvegardé !</div>';
        showToast("💎 Nugget sauvegardé !");
        setTimeout(removeOverlay, 1500);
      } catch (e) {
        msgEl.innerHTML = `<div class="sng-status error">❌ ${escapeHtml(e.message)}</div>`;
      }
    });

    panel.querySelector("#sng-close").addEventListener("click", removeOverlay);
  }

  // ==================== ANALYZE PAGE (AI extraction) ====================
  async function showAnalyzePage(url) {
    const panel = createOverlay();
    const sites = await fetchSites();
    const prefs = await getPrefs();

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
        <div class="sng-field">
          <label>Site</label>
          <select id="sng-site">
            <option value="">-- Tous les sites --</option>
            ${sites.map((s) => `<option value="${s.id}" ${s.id === prefs.site_id ? "selected" : ""}>${s.name} (${s.domain})</option>`).join("")}
          </select>
        </div>
        <div class="sng-field">
          <label>Persona</label>
          <select id="sng-persona">
            <option value="">-- Aucun --</option>
          </select>
        </div>
        <button class="sng-btn sng-btn-primary" id="sng-extract">🤖 Extraire les pépites</button>
        <div id="sng-results" style="margin-top:16px"></div>
      </div>
    `;

    const siteSelect = panel.querySelector("#sng-site");
    const personaSelect = panel.querySelector("#sng-persona");

    async function loadPersonas() {
      const siteId = siteSelect.value;
      const personas = await fetchPersonas(siteId);
      personaSelect.innerHTML =
        '<option value="">-- Aucun --</option>' +
        personas.map((p) => `<option value="${p.id}" ${p.id === prefs.persona_id ? "selected" : ""}>${p.name} (${p.role})</option>`).join("");
    }

    siteSelect.addEventListener("change", loadPersonas);
    loadPersonas();

    panel.querySelector("#sng-close").addEventListener("click", removeOverlay);

    // Extract button
    panel.querySelector("#sng-extract").addEventListener("click", async () => {
      const topic = panel.querySelector("#sng-topic").value.trim();
      const msgEl = panel.querySelector("#sng-msg");
      const resultsEl = panel.querySelector("#sng-results");

      // Save prefs
      savePrefs({
        site_id: siteSelect.value,
        persona_id: personaSelect.value,
        topic,
      });

      msgEl.innerHTML = '<div class="sng-status loading">🤖 Analyse IA en cours... (10-30 secondes)</div>';
      resultsEl.innerHTML = "";

      // Get page text content
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
        const nuggets = data.nuggets || [];

        if (nuggets.length === 0) {
          msgEl.innerHTML = '<div class="sng-status error">Aucune pépite trouvée sur cette page.</div>';
          return;
        }

        msgEl.innerHTML = `<div class="sng-status success">✅ ${nuggets.length} pépites trouvées</div>`;

        // Render nuggets with checkboxes
        resultsEl.innerHTML = `
          <div class="sng-count">${nuggets.length} pépites extraites — sélectionnez celles à sauvegarder</div>
          ${nuggets.map((n, i) => `
            <div class="sng-nugget-card selected">
              <label>
                <input type="checkbox" data-i="${i}" checked />
                <span>${escapeHtml(n.content)}</span>
              </label>
              <div class="sng-tags" style="margin-top:6px;margin-left:24px">
                ${(n.tags || []).map((t) => `<span class="sng-tag">${escapeHtml(t)}</span>`).join("")}
              </div>
            </div>
          `).join("")}
          <button class="sng-btn sng-btn-primary" id="sng-save-all">💾 Sauvegarder la sélection</button>
        `;

        // Toggle card style on checkbox change
        resultsEl.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
          cb.addEventListener("change", () => {
            cb.closest(".sng-nugget-card").classList.toggle("selected", cb.checked);
          });
        });

        // Save selected
        resultsEl.querySelector("#sng-save-all").addEventListener("click", async () => {
          const checkboxes = resultsEl.querySelectorAll('input[type="checkbox"]:checked');
          const selected = Array.from(checkboxes).map((cb) => nuggets[parseInt(cb.dataset.i)]);

          if (selected.length === 0) {
            showToast("Sélectionnez au moins une pépite", true);
            return;
          }

          msgEl.innerHTML = `<div class="sng-status loading">⏳ Sauvegarde de ${selected.length} pépites...</div>`;

          let saved = 0;
          let errors = 0;

          for (const nugget of selected) {
            try {
              const res = await fetch(`${base}/api/nuggets`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  content: nugget.content,
                  source_type: "url",
                  source_ref: url || null,
                  site_id: siteSelect.value || null,
                  persona_id: personaSelect.value || null,
                  tags: nugget.tags || [],
                }),
              });
              if (res.ok) saved++;
              else errors++;
            } catch {
              errors++;
            }
          }

          if (errors === 0) {
            msgEl.innerHTML = `<div class="sng-status success">✅ ${saved} pépites sauvegardées !</div>`;
            showToast(`💎 ${saved} pépites sauvegardées !`);
          } else {
            msgEl.innerHTML = `<div class="sng-status error">⚠️ ${saved} sauvegardées, ${errors} erreurs</div>`;
          }
        });
      } catch (e) {
        msgEl.innerHTML = `<div class="sng-status error">❌ ${escapeHtml(e.message)}</div>`;
      }
    });
  }

  // ==================== UTILITIES ====================

  function extractPageText() {
    // Get the main content, excluding nav, footer, sidebar, ads
    const selectorsToRemove = [
      "nav", "header", "footer", "aside",
      '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
      ".sidebar", ".nav", ".menu", ".footer", ".header", ".ad", ".ads",
      ".cookie", ".popup", ".modal", "#comments", ".comments",
      "script", "style", "noscript", "iframe",
    ];

    // Clone body to avoid modifying the actual page
    const clone = document.body.cloneNode(true);

    selectorsToRemove.forEach((sel) => {
      clone.querySelectorAll(sel).forEach((el) => el.remove());
    });

    // Try to find main content area
    const mainContent =
      clone.querySelector("main") ||
      clone.querySelector("article") ||
      clone.querySelector('[role="main"]') ||
      clone.querySelector(".post-content") ||
      clone.querySelector(".entry-content") ||
      clone.querySelector(".article-content") ||
      clone;

    let text = mainContent.innerText || mainContent.textContent || "";
    // Clean up whitespace
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
