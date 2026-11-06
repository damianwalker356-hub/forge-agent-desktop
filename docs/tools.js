// Browser tools. A static page can only read sites that allow cross-origin access (CORS).
const ENT = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };
export function decode(s) {
  return s.replace(/&(amp|lt|gt|quot|nbsp|#39);/g, (m) => ENT[m]).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));
}
export function htmlToText(page) {
  return decode(page
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t\r\f\v]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}
export function parseDdg(page) {
  const out = [];
  const re = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(page))) {
    let href = decode(m[1]);
    try {
      const u = new URL(href.startsWith("//") ? "https:" + href : href);
      if (u.searchParams.get("uddg")) href = u.searchParams.get("uddg");
    } catch (_) {}
    out.push({ title: htmlToText(m[2]), url: href, snippet: htmlToText(m[3]) });
  }
  return out;
}

export function createTools({ fetchFn = (...a) => fetch(...a), getProxy = () => "" } = {}) {
  async function get(url, { json = false, viaProxy = false } = {}) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 15000);
    try {
      const target = viaProxy ? getProxy() + encodeURIComponent(url) : url;
      const r = await fetchFn(target, { signal: ctl.signal });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return json ? r.json() : r.text();
    } finally { clearTimeout(timer); }
  }
  const wiki = (params) => get("https://en.wikipedia.org/w/api.php?" + new URLSearchParams({ format: "json", formatversion: "2", origin: "*", ...params }), { json: true });

  const REG = {
    wiki_search: ['{"query": str}  search Wikipedia (works in the browser)', async ({ query }) => {
      const d = await wiki({ action: "query", list: "search", srsearch: query, srlimit: "5" });
      const hits = d.query?.search || [];
      if (!hits.length) return "no Wikipedia results";
      return hits.map((h, i) => `${i + 1}. ${h.title}\n   https://en.wikipedia.org/wiki/${encodeURIComponent(h.title.replace(/ /g, "_"))}\n   ${htmlToText(h.snippet)}`).join("\n");
    }],
    wiki_page: ['{"title": str}  read the intro of a Wikipedia article', async ({ title }) => {
      const d = await wiki({ action: "query", prop: "extracts", exintro: "1", explaintext: "1", redirects: "1", titles: title });
      const p = d.query?.pages?.[0];
      if (!p || p.missing) return "no such Wikipedia page";
      return (p.extract || "(empty)").slice(0, 3500);
    }],
    web_search: ['{"query": str}  general web search (needs a proxy, see /proxy; otherwise Wikipedia only)', async ({ query }) => {
      if (!getProxy()) return "(no proxy set, searched Wikipedia only)\n" + await REG.wiki_search[1]({ query });
      const hits = parseDdg(await get("https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query), { viaProxy: true }));
      if (!hits.length) return "no results (the proxy or search engine may have blocked the request)";
      return hits.slice(0, 5).map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}\n   ${h.snippet}`).join("\n");
    }],
    fetch_url: ['{"url": str}  read a web page as text (only sites that allow browser access, or via /proxy)', async ({ url }) => {
      if (!/^https?:\/\//i.test(url)) throw new Error("only http(s) URLs");
      let page;
      try { page = await get(url); }
      catch (e) {
        if (!getProxy()) throw new Error("the browser blocked this request (CORS) or it failed: " + e.message + ". Set a proxy with /proxy or use /wiki.");
        page = await get(url, { viaProxy: true });
      }
      return htmlToText(page).slice(0, 3500);
    }],
  };
  return {
    describe: () => Object.entries(REG).map(([k, v]) => `- ${k} ${v[0]}`).join("\n"),
    async call(name, args) {
      if (!REG[name]) return `error: unknown tool ${name}`;
      try { return String(await REG[name][1](args || {})).slice(0, 4000); }
      catch (e) { return `error: ${e.message}`; }
    },
  };
}
