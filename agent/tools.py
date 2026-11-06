"""Agent tools. Standard library only (urllib, ipaddress, html)."""
import html, ipaddress, json, os, re, socket, subprocess, urllib.parse, urllib.request

UA = "Mozilla/5.0 (X11; Linux x86_64) ForgeAgent/1.0"
MAX_BYTES = 2_000_000
WORKSPACE = os.path.abspath(os.environ.get("FORGE_WORKSPACE", os.path.join(os.path.dirname(__file__), "..", "workspace")))


def _check_url(url):
    p = urllib.parse.urlparse(url)
    if p.scheme not in ("http", "https") or not p.hostname:
        raise ValueError("only http(s) URLs are allowed")
    if os.environ.get("FORGE_ALLOW_LOCAL") == "1":
        return
    for info in socket.getaddrinfo(p.hostname, None):
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            raise ValueError("blocked: URL resolves to a private/local address")


def _get(url, data=None, timeout=20):
    _check_url(url)
    req = urllib.request.Request(url, data=data, headers={"User-Agent": UA, "Accept-Language": "en"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read(MAX_BYTES)
        charset = r.headers.get_content_charset() or "utf-8"
    return raw.decode(charset, errors="replace")


def html_to_text(page):
    page = re.sub(r"(?is)<(script|style|noscript|svg|head).*?</\1>", " ", page)
    page = re.sub(r"(?s)<!--.*?-->", " ", page)
    page = re.sub(r"(?i)<(br|/p|/div|/li|/h\d|/tr)[^>]*>", "\n", page)
    page = re.sub(r"<[^>]+>", " ", page)
    page = html.unescape(page)
    page = re.sub(r"[ \t\r\f\v]+", " ", page)
    return re.sub(r"\n\s*\n+", "\n", page).strip()


def fetch_url(url, max_chars=6000):
    return html_to_text(_get(url))[: int(max_chars)]


def parse_ddg(page):
    out = []
    for m in re.finditer(r'class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>.*?class="result__snippet"[^>]*>(.*?)</a>', page, re.S):
        href = html.unescape(m.group(1))
        q = urllib.parse.parse_qs(urllib.parse.urlparse(href).query)
        if "uddg" in q:
            href = q["uddg"][0]
        out.append({"title": html_to_text(m.group(2)), "url": href, "snippet": html_to_text(m.group(3))})
    return out


def web_search(query, n=5):
    searx = os.environ.get("FORGE_SEARXNG")  # optional self-hosted SearXNG, e.g. http://127.0.0.1:8888
    if searx:
        os.environ.setdefault("FORGE_ALLOW_LOCAL", "1")
        res = json.loads(_get(searx.rstrip("/") + "/search?format=json&q=" + urllib.parse.quote(query)))
        hits = [{"title": r.get("title"), "url": r.get("url"), "snippet": r.get("content", "")} for r in res.get("results", [])]
    else:
        hits = parse_ddg(_get("https://html.duckduckgo.com/html/", data=urllib.parse.urlencode({"q": query}).encode()))
    if not hits:
        return "no results (search engine may have blocked the request; try FORGE_SEARXNG)"
    return "\n".join("%d. %s\n   %s\n   %s" % (i + 1, h["title"], h["url"], h["snippet"]) for i, h in enumerate(hits[: int(n)]))


def _safe_path(rel):
    p = os.path.abspath(os.path.join(WORKSPACE, rel))
    if p != WORKSPACE and not p.startswith(WORKSPACE + os.sep):
        raise ValueError("path escapes workspace")
    return p


def list_files(path="."):
    return "\n".join(sorted(os.listdir(_safe_path(path)))) or "(empty)"


def read_file(path, max_chars=8000):
    with open(_safe_path(path), errors="replace") as f:
        return f.read(int(max_chars))


def write_file(path, content):
    p = _safe_path(path)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w") as f:
        f.write(content)
    return "wrote %d bytes to %s" % (len(content), path)


def run_shell(cmd, timeout=30):
    if os.environ.get("FORGE_ALLOW_SHELL") != "1":
        return "shell tool is disabled. Set FORGE_ALLOW_SHELL=1 to enable (runs commands inside the workspace folder)."
    r = subprocess.run(cmd, shell=True, cwd=WORKSPACE, capture_output=True, text=True, timeout=min(int(timeout), 120))
    return ("exit %d\n" % r.returncode + r.stdout + r.stderr)[:6000]


REGISTRY = {
    "web_search": (web_search, '{"query": str}  search the internet'),
    "fetch_url": (fetch_url, '{"url": str}  read a web page as text'),
    "list_files": (list_files, '{"path": str}  list workspace folder'),
    "read_file": (read_file, '{"path": str}  read a workspace file'),
    "write_file": (write_file, '{"path": str, "content": str}  write a workspace file'),
    "run_shell": (run_shell, '{"cmd": str}  run a shell command in the workspace (off by default)'),
}


def describe():
    return "\n".join("- %s %s" % (k, v[1]) for k, v in REGISTRY.items())


def call(name, args):
    if name not in REGISTRY:
        return "error: unknown tool %r" % name
    try:
        return str(REGISTRY[name][0](**args))[:8000]
    except Exception as e:
        return "error: %s: %s" % (type(e).__name__, e)
