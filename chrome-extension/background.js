// Context menu: right-click on selected text to save as nugget
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "save-nugget",
    title: "💎 Sauvegarder comme nugget",
    contexts: ["selection"],
  });
  chrome.contextMenus.create({
    id: "analyze-page",
    title: "🔍 Analyser la page entière",
    contexts: ["page"],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "save-nugget" && info.selectionText) {
    // Send selected text to content script to show save dialog
    chrome.tabs.sendMessage(tab.id, {
      action: "show-save-dialog",
      text: info.selectionText,
      url: tab.url,
    });
  }
  if (info.menuItemId === "analyze-page") {
    chrome.tabs.sendMessage(tab.id, {
      action: "analyze-page",
      url: tab.url,
    });
  }
});
