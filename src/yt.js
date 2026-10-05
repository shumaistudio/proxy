// YouTube専用ハンドラ (APIキー不要): 検索=Webページ解析 / 再生=Worker経由でストリーム中継
const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const CONSENT = "CONSENT=YES+cb; SOCS=CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg"; // 同意画面を回避

// 他サイトからの利用を防ぐ
const forbidden = request => {
  const s = request.headers.get("sec-fetch-site");
  return s && s !== "same-origin" && s !== "none";
};

/* ---------- 検索: 検索結果ページ(ytInitialData)を解析 ---------- */
const txt = x => x?.simpleText ?? x?.runs?.map(r => r.text).join("") ?? "";
function walk(o, f) {
  if (Array.isArray(o)) o.forEach(x => walk(x, f));
  else if (o && typeof o === "object") {
    if (o.videoRenderer) f(o.videoRenderer);
    for (const k in o) walk(o[k], f);
  }
}
export function parseResults(html) {
  const m = html.match(/ytInitialData\s*=\s*(\{.+?\});\s*<\/script>/s);
  if (!m) return null;
  const items = [], seen = new Set();
  walk(JSON.parse(m[1]), v => {
    if (!v.videoId || seen.has(v.videoId)) return;
    seen.add(v.videoId);
    items.push({
      id: v.videoId, title: txt(v.title), channel: txt(v.ownerText),
      length: txt(v.lengthText), views: txt(v.viewCountText), date: txt(v.publishedTimeText),
    });
  });
  return items.slice(0, 24);
}

export async function handleYtSearch(request) {
  if (forbidden(request)) return json({ error: "forbidden" }, 403);
  const q = (new URL(request.url).searchParams.get("q") || "").trim().slice(0, 200);
  if (!q) return json({ error: "q required" }, 400);
  const r = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&hl=ja&gl=JP`, {
    headers: { "user-agent": UA, "accept-language": "ja,en;q=0.8", cookie: CONSENT },
    cf: { cacheTtl: 300, cacheEverything: true },
  });
  const items = parseResults(await r.text());
  if (!items) return json({ error: "parse_failed", message: "検索結果ページを解析できませんでした(ボット判定/同意画面の可能性)" }, 502);
  return json({ items });
}

/* ---------- 再生: InnerTube player API で動画URLを取得し、Workerが中継 ---------- */
// クライアント情報は古くなると拒否されることがあります(その場合は更新が必要)
const CLIENTS = [
  { name: "ANDROID_VR", ver: "1.60.19", num: 28,
    ua: "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
    extra: { deviceMake: "Oculus", deviceModel: "Quest 3", osName: "Android", osVersion: "12L", androidSdkVersion: 32 } },
  { name: "IOS", ver: "20.10.4", num: 5,
    ua: "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
    extra: { deviceMake: "Apple", deviceModel: "iPhone16,2", osName: "iPhone", osVersion: "18.3.2.22D82" } },
];

async function player(id, c) {
  const r = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
    method: "POST",
    headers: {
      "content-type": "application/json", "user-agent": c.ua, origin: "https://www.youtube.com", cookie: CONSENT,
      "x-youtube-client-name": String(c.num), "x-youtube-client-version": c.ver,
    },
    body: JSON.stringify({
      context: { client: { clientName: c.name, clientVersion: c.ver, hl: "ja", gl: "JP", ...c.extra } },
      videoId: id, contentCheckOk: true, racyCheckOk: true,
    }),
  });
  return r.json();
}

const cache = new Map(); // isolate内の簡易キャッシュ (URLは取得元IPに紐づくため短時間のみ)
async function getStream(id, force) {
  const c = cache.get(id);
  if (!force && c && c.exp > Date.now()) return c;
  for (const cl of CLIENTS) {
    let d;
    try { d = await player(id, cl); } catch { continue; }
    const fm = (d.streamingData?.formats || []).filter(f => f.url); // 映像+音声が一体のもの
    if (!fm.length) continue;
    const f = fm.find(x => x.itag === 22) || fm.find(x => x.itag === 18) || fm.sort((a, b) => (b.height || 0) - (a.height || 0))[0];
    const v = { url: f.url, ua: cl.ua, exp: Date.now() + 10 * 60e3 };
    cache.set(id, v);
    return v;
  }
  throw new Error("再生可能な形式を取得できませんでした");
}

export async function handleYtStream(request) {
  if (forbidden(request)) return new Response("forbidden", { status: 403 });
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!/^[\w-]{11}$/.test(id)) return new Response("bad id", { status: 400 });
  try {
    const range = request.headers.get("range");
    const go = src => fetch(src.url, { headers: { "user-agent": src.ua, ...(range ? { range } : {}) } });
    let src = await getStream(id, false);
    let up = await go(src);
    if (up.status === 403) { src = await getStream(id, true); up = await go(src); }
    const out = new Headers();
    for (const h of ["content-type", "content-length", "content-range", "accept-ranges"]) {
      const v = up.headers.get(h); if (v) out.set(h, v);
    }
    return new Response(up.body, { status: up.status, headers: out });
  } catch (e) {
    return new Response("stream error: " + e.message, { status: 502 });
  }
}

/* ---------- 診断: /api/yt/debug?id=動画ID ---------- */
export async function handleYtDebug(request) {
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!/^[\w-]{11}$/.test(id)) return json({ error: "bad id" }, 400);
  const res = [];
  for (const cl of CLIENTS) {
    try {
      const d = await player(id, cl), s = d.streamingData || {};
      res.push({
        client: cl.name, status: d.playabilityStatus?.status, reason: d.playabilityStatus?.reason,
        muxed: (s.formats || []).length, muxedWithUrl: (s.formats || []).filter(f => f.url).length,
        adaptive: (s.adaptiveFormats || []).length, hls: !!s.hlsManifestUrl,
      });
    } catch (e) { res.push({ client: cl.name, error: e.message }); }
  }
  let streamHead = null;
  try {
    const src = await getStream(id, true);
    const r = await fetch(src.url, { headers: { "user-agent": src.ua, range: "bytes=0-1" } });
    streamHead = { status: r.status, type: r.headers.get("content-type") };
  } catch (e) { streamHead = { error: e.message }; }
  return json({ clients: res, streamHead });
}
