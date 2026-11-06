"""HTTP server (stdlib http.server). Binds to localhost unless you set a token."""
import hmac, json, os, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from .graph import Agent
from .llm import make_llm
from .memory import Memory
from .ui import PAGE

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
MAX_BODY = 64 * 1024


def make_handler(agent, token):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _send(self, code, body, ctype="application/json"):
            data = body if isinstance(body, bytes) else (body if isinstance(body, str) else json.dumps(body)).encode()
            self.send_response(code)
            self.send_header("Content-Type", ctype + "; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(data)

        def _authed(self):
            if not token:
                return True
            got = self.headers.get("Authorization", "")
            return hmac.compare_digest(got.encode(), ("Bearer " + token).encode())

        def do_GET(self):
            if self.path in ("/", "/index.html"):
                return self._send(200, PAGE, "text/html")
            if self.path == "/api/health":
                return self._send(200, {"ok": True})
            if not self._authed():
                return self._send(401, {"error": "unauthorized"})
            if self.path == "/api/memory":
                return self._send(200, agent.mem.export_state())
            self._send(404, {"error": "not found"})

        def do_POST(self):
            if not self._authed():
                return self._send(401, {"error": "unauthorized"})
            if self.path != "/api/chat":
                return self._send(404, {"error": "not found"})
            n = int(self.headers.get("Content-Length", "0") or 0)
            if n > MAX_BODY:
                return self._send(413, {"error": "too large"})
            try:
                body = json.loads(self.rfile.read(n) or b"{}")
                msg, session = str(body["message"]).strip(), str(body.get("session", "default"))[:64]
                if not msg:
                    raise KeyError("message")
            except (ValueError, KeyError):
                return self._send(400, {"error": "need JSON with a non-empty message"})
            try:
                self._send(200, agent.run(session, msg))
            except Exception as e:
                self._send(500, {"error": "%s: %s" % (type(e).__name__, e)})
    return H


def build(db_path=None, llm=None):
    mem = Memory(db_path or os.path.join(ROOT, "data", "memory.db"))
    mem.seed_once(os.path.join(ROOT, "seed", "seed.json"))
    return Agent(mem, llm or make_llm())


def main():
    host = os.environ.get("FORGE_HOST", "127.0.0.1")
    port = int(os.environ.get("FORGE_PORT", "8787"))
    token = os.environ.get("FORGE_TOKEN", "")
    if host not in ("127.0.0.1", "localhost", "::1") and not token:
        sys.exit("Refusing to listen on %s without FORGE_TOKEN set. Set a long random token." % host)
    agent = build()
    srv = ThreadingHTTPServer((host, port), make_handler(agent, token))
    print("Forge Agent on http://%s:%d  (model backend: %s)" % (host, port, os.environ.get("FORGE_LLM", "ollama")), flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
