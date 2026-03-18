const API_BASE_KEY = "sng_api_base";

document.addEventListener("DOMContentLoaded", async () => {
  const apiBaseInput = document.getElementById("api-base");
  const statusEl = document.getElementById("status");
  const statsEl = document.getElementById("stats");

  // Load saved API base
  chrome.storage.local.get(API_BASE_KEY, (data) => {
    apiBaseInput.value = data[API_BASE_KEY] || "https://seo.swipego.app";
  });

  // Save API base on change
  apiBaseInput.addEventListener("change", () => {
    const val = apiBaseInput.value.trim().replace(/\/+$/, "");
    chrome.storage.local.set({ [API_BASE_KEY]: val });
    showStatus("info", "URL sauvegardée");
  });

  // Test connection
  document.getElementById("btn-test").addEventListener("click", async () => {
    const base = apiBaseInput.value.trim().replace(/\/+$/, "");
    showStatus("info", "⏳ Test en cours...");

    try {
      const res = await fetch(`${base}/api/sites`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const sites = await res.json();
      showStatus("success", `✅ Connecté ! ${sites.length} site(s) trouvé(s)`);
      statsEl.textContent = sites.map((s) => s.domain).join(", ");
    } catch (e) {
      showStatus("error", `❌ Erreur : ${e.message}`);
    }
  });

  // Analyze page button
  document.getElementById("btn-analyze").addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { action: "analyze-page", url: tab.url });
      window.close();
    }
  });

  // Save selection button
  document.getElementById("btn-save-selection").addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      // Get selected text from the page
      chrome.scripting.executeScript(
        {
          target: { tabId: tab.id },
          func: () => window.getSelection()?.toString() || "",
        },
        (results) => {
          const text = results?.[0]?.result;
          if (text && text.trim()) {
            chrome.tabs.sendMessage(tab.id, {
              action: "show-save-dialog",
              text: text.trim(),
              url: tab.url,
            });
            window.close();
          } else {
            showStatus("error", "Sélectionnez du texte sur la page d'abord");
          }
        }
      );
    }
  });

  function showStatus(type, msg) {
    statusEl.className = `status ${type}`;
    statusEl.textContent = msg;
  }
});
