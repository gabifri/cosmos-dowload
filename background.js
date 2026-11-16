// Service worker : convertit les images en PNG et télécharge images + vidéos dans un dossier.
const notify = (m) => chrome.runtime.sendMessage(m).catch(() => {});

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function fetchImageAsPng(urls) {
  let lastErr;
  for (const url of urls) {
    try {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const blob = await res.blob();
      if (!blob.type.startsWith("image/")) throw new Error("pas une image: " + blob.type);
      const bmp = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bmp.width, bmp.height);
      canvas.getContext("2d").drawImage(bmp, 0, 0);
      const png = await canvas.convertToBlob({ type: "image/png" });
      return "data:image/png;base64," + toBase64(await png.arrayBuffer());
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("échec");
}

async function pickVideoUrl(urls) {
  for (const url of urls) {
    try {
      const r = await fetch(url, { method: "HEAD", credentials: "include" });
      const ct = r.headers.get("content-type") || "";
      if (r.ok && /mpegurl|dash/i.test(ct)) continue; // flux segmenté : non téléchargeable tel quel
      if (r.ok) return { url, ext: /webm/i.test(ct) ? "webm" : "mp4" };
    } catch {}
  }
  return urls[0] ? { url: urls[0], ext: "mp4" } : null;
}

let busy = false;
async function downloadAll({ items, name }) {
  if (busy) return;
  busy = true;
  const total = items.length;
  let done = 0, failed = 0;
  const pad = String(total).length < 3 ? 3 : String(total).length;
  const folder = `Cosmos - ${name}`;
  chrome.action.setBadgeBackgroundColor({ color: "#111111" });

  const queue = items.map((it, i) => ({ ...it, n: String(i + 1).padStart(pad, "0") }));
  const worker = async () => {
    while (queue.length) {
      const it = queue.shift();
      try {
        if (it.type === "image") {
          const dataUrl = await fetchImageAsPng(it.urls);
          await chrome.downloads.download({ url: dataUrl, filename: `${folder}/${it.n}.png`, conflictAction: "uniquify" });
        } else {
          const v = await pickVideoUrl(it.urls);
          if (!v) throw new Error("pas d'URL");
          await chrome.downloads.download({ url: v.url, filename: `${folder}/${it.n}.${v.ext}`, conflictAction: "uniquify" });
        }
      } catch (e) {
        failed++;
        console.warn("Échec", folder, it.n, it.type, String(e));
      }
      done++;
      chrome.action.setBadgeText({ text: String(done) });
      notify({ type: "progress", phase: "download", done, total, failed });
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  chrome.action.setBadgeText({ text: failed ? "!" : "OK" });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 8000);
  notify({ type: "done", total, failed, folder });
  busy = false;
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "download") downloadAll(msg);
});
