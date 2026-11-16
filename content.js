// Injecté dans la page Cosmos : fait défiler le tableau, collecte les médias, les envoie au background.
(() => {
  if (window.__cosmosDL) return;
  window.__cosmosDL = { running: false, cancel: false };
  const state = window.__cosmosDL;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const SIZE_PARAMS = ["w", "h", "width", "height", "q", "quality", "dpr", "fit", "resize", "size"];

  const abs = (u) => { try { return new URL(u, location.href).href; } catch { return null; } };

  // Version "taille originale" probable d'une URL de CDN (on retire les paramètres de redimensionnement).
  function upgrade(url) {
    try {
      const u = new URL(url);
      let changed = false;
      for (const p of SIZE_PARAMS) if (u.searchParams.has(p)) { u.searchParams.delete(p); changed = true; }
      return changed ? u.href : null;
    } catch { return null; }
  }
  const FORMAT_PARAMS = ["format", "fm", "f", "auto", "crop", "fit", "blur", "dpr", "w", "h", "q", "width", "height", "quality", "size", "resize"];
  const keyOf = (url) => {
    try {
      const u = new URL(url);
      for (const p of FORMAT_PARAMS) u.searchParams.delete(p);
      u.hash = "";
      return u.href;
    } catch { return url; }
  };

  function bestFromSrcset(srcset) {
    let best = null, bestW = -1;
    for (const part of srcset.split(",")) {
      const [u, d] = part.trim().split(/\s+/);
      if (!u) continue;
      const w = d ? parseFloat(d) : 1;
      if (w > bestW) { bestW = w; best = u; }
    }
    return best;
  }

  const found = new Map(); // clé -> { type, urls[] }
  const posters = new Set();

  const bigEnough = (el) => {
    const r = el.getBoundingClientRect();
    return r.width >= 100 && r.height >= 100;
  };
  const inChrome = (el) => !!el.closest("header, nav, footer, [role='navigation'], [role='dialog'] ");

  let sc = null; // conteneur qui défile
  function docRect(el) {
    const r = el.getBoundingClientRect();
    const base = sc && sc !== (document.scrollingElement || document.documentElement) ? sc.getBoundingClientRect().top : 0;
    const st = sc ? sc.scrollTop : 0;
    return { y: r.top - base + st, b: r.bottom - base + st };
  }

  function add(type, rawUrls, el) {
    const urls = [];
    for (const raw of rawUrls) {
      const a = abs(raw);
      if (!a || a.startsWith("data:") || a.startsWith("blob:")) continue;
      const up = type === "image" ? upgrade(a) : null;
      if (up && !urls.includes(up)) urls.push(up);
      if (!urls.includes(a)) urls.push(a);
    }
    if (!urls.length) return;
    const key = keyOf(urls[urls.length - 1]);
    const pos = el ? docRect(el) : { y: 0, b: 0 };
    const cur = found.get(key);
    if (cur) { cur.y = pos.y; cur.b = pos.b; } else found.set(key, { type, urls, y: pos.y, b: pos.b });
  }

  // Conteneur des éléments du tableau (repéré dans le DOM de Cosmos) ; les recommandations sont dans une <section> à part.
  const scopeRoot = () => document.querySelector('[data-allow-rectangle-selection="true"]');

  function collect() {
    const root = scopeRoot() || document;
    // Vidéos
    root.querySelectorAll("video").forEach((v) => {
      if (inChrome(v)) return;
      const srcs = [];
      if (v.currentSrc) srcs.push(v.currentSrc);
      if (v.getAttribute("src")) srcs.push(v.getAttribute("src"));
      v.querySelectorAll("source").forEach((s) => s.src && srcs.push(s.src));
      if (v.poster) posters.add(keyOf(abs(v.poster) || v.poster));
      const mp4 = srcs.filter((s) => !s.startsWith("blob:"));
      if (mp4.length) add("video", mp4, v);
    });
    // Images
    root.querySelectorAll("img").forEach((img) => {
      if (inChrome(img) || !bigEnough(img)) return;
      const cands = [];
      const ss = img.getAttribute("srcset");
      if (ss) { const b = bestFromSrcset(ss); if (b) cands.push(b); }
      if (img.currentSrc) cands.push(img.currentSrc);
      if (img.getAttribute("src")) cands.push(img.getAttribute("src"));
      for (const a of ["data-src", "data-original"]) if (img.getAttribute(a)) cands.push(img.getAttribute(a));
      const dss = img.getAttribute("data-srcset");
      if (dss) { const b = bestFromSrcset(dss); if (b) cands.push(b); }
      const clean = cands.filter((c) => c && !/\.svg(\?|$)/i.test(c));
      if (clean.length) add("image", clean, img);
    });
    // <picture><source srcset>
    root.querySelectorAll("picture source[srcset]").forEach((s) => {
      const img = s.parentElement.querySelector("img");
      if (img && (inChrome(img) || !bigEnough(img))) return;
      const b = bestFromSrcset(s.getAttribute("srcset"));
      if (b) add("image", [b], img || s);
    });
  }

  // Limite verticale (en px depuis le haut de la page) au-delà de laquelle ce sont des recommandations.
  function headingCutoff() {
    if (!found.size) return null;
    const firstY = Math.min(...[...found.values()].map((i) => i.y));
    let best = null;
    document.querySelectorAll("h1,h2,h3,h4,h5,h6,[role='heading']").forEach((h) => {
      if (inChrome(h) || !h.textContent.trim()) return;
      if (h.querySelector("img,video") || (h.parentElement && h.parentElement.querySelectorAll("img,video").length > 0 && h.parentElement.querySelectorAll("img,video").length < 3)) return; // légende d'une carte
      const y = docRect(h).y;
      if (y > firstY + 200 && (best === null || y < best)) best = y;
    });
    return best;
  }
  function gapCutoff() {
    const arr = [...found.values()].sort((a, b) => a.y - b.y);
    let maxB = -Infinity;
    for (const it of arr) {
      if (maxB !== -Infinity && it.y - maxB > 90) return it.y - 1;
      maxB = Math.max(maxB, it.b);
    }
    return null;
  }
  function currentCutoff() {
    const root = scopeRoot();
    if (root && state.manualCutoff == null) return { y: docRect(root).b + 2, how: "conteneur du tableau" };
    if (state.manualCutoff != null) return { y: state.manualCutoff, how: "manuel" };
    const h = headingCutoff(); if (h !== null) return { y: h, how: "titre de section" };
    const g = gapCutoff(); if (g !== null) return { y: g, how: "espace entre sections" };
    return { y: null, how: "aucune limite détectée" };
  }

  function getScroller() {
    const root = document.scrollingElement || document.documentElement;
    if (root.scrollHeight > window.innerHeight + 50) return root;
    let best = null, area = 0;
    document.querySelectorAll("*").forEach((el) => {
      const cs = getComputedStyle(el);
      if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 100) {
        const a = el.clientWidth * el.clientHeight;
        if (a > area) { area = a; best = el; }
      }
    });
    return best || root;
  }

  const send = (msg) => { try { chrome.runtime.sendMessage(msg).catch(() => {}); } catch {} };

  function boardName() {
    let slug = location.pathname.split("/").filter(Boolean).pop() || "tableau";
    try { slug = decodeURIComponent(slug); } catch {}
    return slug.replace(/[\\/:*?"<>|\u0000-\u001f\u007f-\u009f]+/g, "_").replace(/[. ]+$/, "").slice(0, 60) || "tableau";
  }

  async function run() {
    if (state.running) return;
    state.running = true; state.cancel = false; state.finish = false;
    found.clear(); posters.clear();
    try {
      sc = getScroller();
      sc.scrollTo(0, 0);
      await sleep(600);
      let stable = 0, lastH = -1, stuck = 0, iter = 0;
      const t0 = Date.now();
      while (!state.cancel && !state.finish && iter++ < 1500 && Date.now() - t0 < 4 * 60 * 1000) {
        collect();
        send({ type: "progress", phase: "scan", count: found.size });
        const top0 = sc.scrollTop;
        sc.scrollBy(0, Math.max(300, window.innerHeight * 0.7));
        await sleep(300);
        collect();
        await sleep(300);
        collect();
        stuck = sc.scrollTop === top0 ? stuck + 1 : 0;
        const rootEl = scopeRoot();
        const bottomY = rootEl ? docRect(rootEl).b : sc.scrollHeight;
        const atBottom = rootEl
          ? sc.scrollTop + window.innerHeight >= bottomY - 4
          : sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 4;
        if (atBottom || stuck >= 2) {
          await sleep(600); // laisse le temps au chargement infini
          collect();
          const h = Math.round(rootEl ? docRect(rootEl).b : sc.scrollHeight);
          if (h === lastH) stable++; else stable = 0; // seule la hauteur compte, pas le nombre d'éléments
          lastH = h;
          if (stable >= 2 || stuck >= 3) break;
        } else stable = 0;
        const c = currentCutoff();
        const margin = c.how === "espace entre sections" ? 3 : 1.2;
        if (c.y !== null && sc.scrollTop > c.y + window.innerHeight * margin) break;
      }
      sc.scrollTo(0, 0);
      if (state.cancel) { send({ type: "done", cancelled: true }); return; }

      // On enlève les miniatures de vidéos (posters) déjà couvertes par la vidéo elle-même
      collect();
      const cut = currentCutoff();
      let items = [...found.values()].filter((it) => it.type === "video" || !posters.has(keyOf(it.urls[it.urls.length - 1])));
      const before = items.length;
      if (cut.y !== null) items = items.filter((it) => it.y < cut.y);
      send({ type: "progress", phase: "scan-done", count: items.length, excluded: before - items.length, how: cut.how });
      send({ type: "download", items, name: boardName() });
    } finally {
      state.running = false;
    }
  }

  function pickMode() {
    sc = getScroller();
    const bar = document.createElement("div");
    bar.textContent = "Clique sur la PREMIÈRE image des recommandations (Échap pour annuler)";
    bar.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#111;color:#fff;padding:12px;text-align:center;font:14px system-ui;";
    document.body.appendChild(bar);
    const done = (msg) => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
      bar.textContent = msg; setTimeout(() => bar.remove(), 3500);
    };
    const onKey = (e) => { if (e.key === "Escape") done("Annulé."); };
    const onClick = (e) => {
      const el = document.elementsFromPoint(e.clientX, e.clientY).find((x) => x.matches("img,video"));
      if (!el) return;
      e.preventDefault(); e.stopPropagation();
      state.manualCutoff = docRect(el).y - 4;
      done("Limite enregistrée ✔ — rouvre l'extension et clique sur « Tout télécharger ».");
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "pick") pickMode();
    if (msg?.type === "reset-limit") state.manualCutoff = null;
    if (msg?.type === "start") run();
    if (msg?.type === "cancel") state.cancel = true;
    if (msg?.type === "finish") state.finish = true;
  });
})();
