const PROXY = "/api/proxy?url=";
const SKIP = /^(data:|blob:|javascript:|mailto:|tel:|about:|#)/i;

/* ---------- 内部アドレス宛てを拒否 ---------- */
function blockedHost(h) {
  h = h.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (h.includes(":")) return h === "::1" || h === "::" || /^f[cd]/.test(h) || h.startsWith("fe80") || h.startsWith("::ffff:");
  return false;
}

/* ---------- URL書き換え ---------- */
function rw(u, base) {
  if (!u) return u;
  u = u.trim();
  if (SKIP.test(u)) return u;
  try { return PROXY + encodeURIComponent(new URL(u, base).href); } catch { return u; }
}
function rwSrcset(v, base) {
  return v.split(",").map(part => {
    const [u, ...rest] = part.trim().split(/\s+/);
    return [rw(u, base), ...rest].join(" ");
  }).join(", ");
}
function rwCss(css, base) {
  return css
    .replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (m, q, u) => `url(${q}${rw(u, base)}${q})`)
    .replace(/@import\s+(['"])(.*?)\1/gi, (m, q, u) => `@import ${q}${rw(u, base)}${q}`);
}
const esc = s => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/* ---------- Cookie中継 ---------- */
function buildCookie(request, host) {
  const out = [];
  (request.headers.get("cookie") || "").split(/;\s*/).forEach(c => {
    const i = c.indexOf("=");
    if (i < 0) return;
    const m = c.slice(0, i).match(/^__px_(.+?)__(.+)$/);
    if (m && (host === m[1] || host.endsWith("." + m[1]))) out.push(m[2] + c.slice(i));
  });
  return out.join("; ");
}
function convertSetCookie(sc, host) {
  const parts = sc.split(";").map(x => x.trim());
  const first = parts.shift();
  const eq = first.indexOf("=");
  if (eq < 1) return null;
  let dom = host;
  const attrs = [];
  for (const p of parts) {
    const [k, ...r] = p.split("=");
    const key = k.toLowerCase();
    const v = r.join("=");
    if (key === "domain") {
      const d = v.replace(/^\./, "").toLowerCase();
      if (host === d || host.endsWith("." + d)) dom = d;
    } else if (key === "expires" || key === "max-age") attrs.push(k + "=" + v);
    else if (key === "httponly") attrs.push("HttpOnly");
  }
  return `__px_${dom}__${first.slice(0, eq)}=${first.slice(eq + 1)}; Path=/; SameSite=Lax; Secure` +
    (attrs.length ? "; " + attrs.join("; ") : "");
}

/* ---------- ブラウザ側で動的リクエスト/Cookieを書き換えるスクリプト ---------- */
function clientScript(base) {
  return `<script>(function(){
var BASE=${JSON.stringify(base).replace(/</g, "\\u003c")},P=${JSON.stringify(PROXY)};
var SKIP=/^(data:|blob:|javascript:|mailto:|tel:|about:|#)/i;
function px(u){
  if(typeof u!=="string"||!u||SKIP.test(u)||u.indexOf("/api/proxy?url=")===0) return u;
  try{return P+encodeURIComponent(new URL(u,window.__PXBASE||BASE).href)}catch(e){return u}
}
var of=window.fetch;
window.fetch=function(i,o){
  if(typeof i==="string") i=px(i);
  else if(i&&i.url) i=new Request(px(i.url),i);
  return of.call(this,i,o);
};
var ox=XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open=function(m,u){arguments[1]=px(String(u));return ox.apply(this,arguments)};
var sa=Element.prototype.setAttribute;
Element.prototype.setAttribute=function(n,v){
  if(/^(src|href|poster)$/i.test(n)) v=px(String(v));
  return sa.call(this,n,v);
};
[[HTMLImageElement,"src"],[HTMLScriptElement,"src"],[HTMLMediaElement,"src"],
 [HTMLSourceElement,"src"],[HTMLLinkElement,"href"],[HTMLIFrameElement,"src"]].forEach(function(p){
  var d=Object.getOwnPropertyDescriptor(p[0].prototype,p[1]);
  if(!d||!d.set) return;
  Object.defineProperty(p[0].prototype,p[1],{get:d.get,set:function(v){d.set.call(this,px(String(v)))}});
});
var H=new URL(BASE).hostname.toLowerCase();
var cd=Object.getOwnPropertyDescriptor(Document.prototype,"cookie");
if(cd&&cd.get){Object.defineProperty(document,"cookie",{configurable:true,
get:function(){
  var out=[];
  cd.get.call(document).split(/;\\s*/).forEach(function(c){
    var i=c.indexOf("=");if(i<0)return;
    var m=c.slice(0,i).match(/^__px_(.+?)__(.+)$/);
    if(m&&(H===m[1]||H.endsWith("."+m[1]))) out.push(m[2]+c.slice(i));
  });
  return out.join("; ");
},
set:function(v){
  var parts=String(v).split(";"),nv=parts.shift().trim(),eq=nv.indexOf("=");
  if(eq<1)return;
  var dom=H,rest=[];
  parts.forEach(function(p){
    var t=p.trim();
    if(/^domain=/i.test(t)){var d=t.slice(7).replace(/^\\./,"").toLowerCase();if(H===d||H.endsWith("."+d))dom=d;}
    else if(/^(path|samesite)=/i.test(t)||/^secure$/i.test(t)){}
    else if(t)rest.push(t);
  });
  cd.set.call(document,"__px_"+dom+"__"+nv.slice(0,eq)+"="+nv.slice(eq+1)+"; path=/; SameSite=Lax; Secure"+(rest.length?"; "+rest.join("; "):""));
}});}
var wo=window.open;
window.open=function(u){arguments[0]=px(u);return wo.apply(this,arguments)};
})();</script>`;
}

/* ---------- HTML書き換え (HTMLRewriter) ---------- */
function rewriteHtml(response, targetHref) {
  let base = targetHref;
  const attrs = ["src", "href", "poster", "data-src", "data-href", "data-poster"];
  let cssBuf = "";

  return new HTMLRewriter()
    .on("html", { element(el) { el.prepend(clientScript(targetHref), { html: true }); } })
    .on("base[href]", {
      element(el) {
        try { base = new URL(el.getAttribute("href"), base).href; } catch {}
        el.replace(`<script>window.__PXBASE=${JSON.stringify(base).replace(/</g, "\\u003c")}</script>`, { html: true });
      },
    })
    .on("meta[http-equiv]", {
      element(el) {
        if ((el.getAttribute("http-equiv") || "").toLowerCase() === "content-security-policy") el.remove();
      },
    })
    .on("*", {
      element(el) {
        if (el.tagName === "base") return;
        for (const a of attrs) {
          const v = el.getAttribute(a);
          if (v != null) el.setAttribute(a, rw(v, base));
        }
        for (const a of ["srcset", "data-srcset"]) {
          const v = el.getAttribute(a);
          if (v) el.setAttribute(a, rwSrcset(v, base));
        }
        const st = el.getAttribute("style");
        if (st) el.setAttribute("style", rwCss(st, base));
        el.removeAttribute("integrity");
        el.removeAttribute("crossorigin");
        el.removeAttribute("nonce");
      },
    })
    .on("form", {
      element(el) {
        const a = el.getAttribute("action");
        if (a && SKIP.test(a.trim())) return;
        let u;
        try { u = new URL(a || "", base); } catch { u = new URL(base); }
        if ((el.getAttribute("method") || "get").toLowerCase() === "post") {
          el.setAttribute("action", PROXY + encodeURIComponent(u.href));
        } else {
          u.search = ""; u.hash = "";
          el.setAttribute("action", "/api/proxy");
          el.prepend(`<input type="hidden" name="__purl" value="${esc(u.href)}">`, { html: true });
        }
      },
    })
    .on("style", {
      text(t) {
        cssBuf += t.text;
        t.remove();
        if (t.lastInTextNode) {
          t.after(rwCss(cssBuf, base), { html: true });
          cssBuf = "";
        }
      },
    })
    .transform(response);
}

/* ---------- ハンドラ ---------- */
async function handleProxy(request) {
  try {
    const reqUrl = new URL(request.url);
    const sp = reqUrl.searchParams;
    let raw = sp.get("url");
    const purl = sp.get("__purl"); // GETフォーム送信
    if (purl) {
      try {
        const t = new URL(purl);
        for (const [k, v] of sp) if (k !== "__purl") t.searchParams.append(k, v);
        raw = t.href;
      } catch { return new Response("invalid form url", { status: 400 }); }
    }
    if (!raw) return new Response("url parameter required", { status: 400 });

    let target;
    try { target = new URL(raw); } catch { return new Response("invalid url", { status: 400 }); }
    if (!/^https?:$/.test(target.protocol) || blockedHost(target.hostname) || target.hostname === reqUrl.hostname)
      return new Response("blocked", { status: 403 });

    const method = ["POST", "HEAD"].includes(request.method) ? request.method : "GET";
    const headers = new Headers({
      "user-agent": request.headers.get("user-agent") || "Mozilla/5.0",
      accept: request.headers.get("accept") || "*/*",
      "accept-language": request.headers.get("accept-language") || "ja,en;q=0.8",
      referer: target.origin + "/",
    });
    if (request.headers.get("range")) headers.set("range", request.headers.get("range"));
    const ck = buildCookie(request, target.hostname.toLowerCase());
    if (ck) headers.set("cookie", ck);

    let body;
    if (method === "POST") {
      const ct = request.headers.get("content-type");
      if (ct) headers.set("content-type", ct);
      headers.set("origin", target.origin);
      body = await request.arrayBuffer();
    }

    const upstream = await fetch(target.href, { method, headers, body, redirect: "manual" });

    const out = new Headers();
    const sc = upstream.headers.getSetCookie ? upstream.headers.getSetCookie() : [];
    for (const c of sc) {
      const v = convertSetCookie(c, target.hostname.toLowerCase());
      if (v) out.append("Set-Cookie", v);
    }

    // リダイレクトもプロキシ経由に
    const loc = upstream.headers.get("location");
    if (upstream.status >= 300 && upstream.status < 400 && loc) {
      out.set("Location", rw(loc, target.href));
      return new Response(null, { status: upstream.status, headers: out });
    }

    const type = upstream.headers.get("content-type") || "";
    if (type) out.set("Content-Type", type);
    out.set("Access-Control-Allow-Origin", "*");

    if (/text\/html/i.test(type)) {
      const dest = request.headers.get("sec-fetch-dest");
      if (!dest || dest === "document") {
        out.append("Set-Cookie", `__pxlast=${encodeURIComponent(target.origin)}; Path=/; SameSite=Lax; Secure; Max-Age=86400`);
      }
      return rewriteHtml(new Response(upstream.body, { status: upstream.status, headers: out }), target.href);
    }
    if (/text\/css/i.test(type)) {
      const css = rwCss(await upstream.text(), target.href);
      out.set("Content-Type", "text/css; charset=utf-8");
      return new Response(css, { status: upstream.status, headers: out });
    }

    // 画像 / JS / mp4 など: ストリーミング転送
    for (const h of ["content-range", "accept-ranges", "cache-control", "etag", "last-modified"]) {
      const v = upstream.headers.get(h);
      if (v) out.set(h, v);
    }
    const len = upstream.headers.get("content-length");
    if (len && !upstream.headers.get("content-encoding")) out.set("Content-Length", len);
    return new Response(method === "HEAD" ? null : upstream.body, { status: upstream.status, headers: out });
  } catch (e) {
    return new Response("Proxy error: " + e.message, { status: 502 });
  }
}

/* ---------- 相対パスの漏れ対策: 直前のサイトを推測してプロキシへ転送 ---------- */
function guessOrigin(request) {
  const ref = request.headers.get("referer");
  if (ref) {
    try {
      const r = new URL(ref);
      if (r.pathname === "/api/proxy") {
        const t = r.searchParams.get("url") || r.searchParams.get("__purl");
        if (t) return new URL(t).origin;
      }
    } catch {}
  }
  const m = (request.headers.get("cookie") || "").match(/(?:^|;\s*)__pxlast=([^;]+)/);
  if (m) {
    try { return decodeURIComponent(m[1]); } catch {}
  }
  return null;
}

/* ---------- Workers エントリポイント ---------- */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/proxy") return handleProxy(request);

    const res = await env.ASSETS.fetch(request); // public/ の静的ファイル
    if (res.status !== 404) return res;

    const origin = guessOrigin(request);
    if (!origin) return res;
    const dest = url.origin + PROXY + encodeURIComponent(origin + url.pathname + url.search);
    return Response.redirect(dest, request.method === "GET" || request.method === "HEAD" ? 302 : 307);
  },
};
