const $ = (id) => document.getElementById(id);
const go = $("go"), cancel = $("cancel"), status = $("status"), bar = document.querySelector(".bar"), fill = $("fill");
let tabId = null;

function busy(on) { go.disabled = on; cancel.hidden = !on; $("finish").hidden = !on; bar.hidden = !on; }

chrome.runtime.onMessage.addListener((m) => {
  if (m.type === "progress") {
    if (m.phase === "scan") status.textContent = `Défilement du tableau… ${m.count} éléments trouvés`;
    if (m.phase === "scan-done") status.textContent = `${m.count} éléments du tableau` + (m.excluded ? ` (${m.excluded} recommandations ignorées)` : "") + ` — limite : ${m.how}`;
    if (m.phase === "download") {
      fill.style.width = `${Math.round((m.done / m.total) * 100)}%`;
      status.textContent = `Téléchargement ${m.done}/${m.total}` + (m.failed ? ` (${m.failed} échec)` : "");
    }
  }
  if (m.type === "done") {
    busy(false);
    status.textContent = m.cancelled ? "Annulé." :
      `Terminé : ${m.total - m.failed}/${m.total} fichiers dans Téléchargements/${m.folder}`;
  }
});

go.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/^https?:/.test(tab.url)) { status.textContent = "Ouvre d'abord une page de tableau Cosmos."; return; }
  tabId = tab.id;
  busy(true); fill.style.width = "0%"; status.textContent = "Démarrage…";
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    await chrome.tabs.sendMessage(tabId, { type: "start" });
  } catch (e) {
    busy(false); status.textContent = "Impossible d'agir sur cette page : " + e.message;
  }
});
$("pick").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/^https?:/.test(tab.url)) return;
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
  await chrome.tabs.sendMessage(tab.id, { type: "pick" });
  window.close();
});
cancel.addEventListener("click", () => { if (tabId) chrome.tabs.sendMessage(tabId, { type: "cancel" }); });

$("finish").addEventListener("click", () => { if (tabId) chrome.tabs.sendMessage(tabId, { type: "finish" }); });
