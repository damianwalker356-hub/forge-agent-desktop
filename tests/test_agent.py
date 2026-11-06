import json, os, sys, tempfile, threading, unittest, urllib.request, urllib.error
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ["FORGE_LLM"] = "mock"
from agent import tools
from agent.memory import Memory
from agent.graph import Agent
from agent.llm import MockLLM
from agent.server import make_handler
from http.server import ThreadingHTTPServer


class T(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.db = os.path.join(self.d, "m.db")
        self.agent = Agent(Memory(self.db), MockLLM())

    def test_commands_persist_across_restart(self):
        self.agent.run("s1", "/decide rods = forged 4340")
        self.agent.run("s1", "/todo fix pipes")
        a2 = Agent(Memory(self.db), MockLLM())          # new process equivalent
        out = a2.run("s2", "/memory")["answer"]
        self.assertIn("rods", out); self.assertIn("T1", out)

    def test_cross_session_recall(self):
        self.agent.run("s1", "the turbo manifold flange cracked at 22 psi")
        mem = Memory(self.db)
        hits = mem.search("turbo manifold flange", session="s2")
        self.assertTrue(hits and "flange" in hits[0]["content"])

    def test_tool_loop_and_checkpoints(self):
        tools.REGISTRY["web_search"] = (lambda query: "1. canned result for " + query, "")
        r = self.agent.run("s1", "search: navier stokes stencil")
        self.assertIn("tool:web_search", r["trace"])
        self.assertIn("canned result", r["answer"])
        cp = self.agent.mem.last_checkpoint("s1")
        self.assertEqual(cp["node"], "respond")

    def test_agent_learns_from_remember_tag(self):
        r = self.agent.run("s1", "remember-test")
        self.assertNotIn("<remember", r["answer"])
        self.assertIn("test_pref", [f["key"] for f in self.agent.mem.facts()])

    def test_validation(self):
        self.assertIn("error", self.agent.run("s", "/remember = x")["answer"])
        with self.assertRaises(ValueError):
            self.agent.mem.remember("nonsense", "k", "v")

    def test_ssrf_and_path_guards(self):
        self.assertIn("blocked", tools.call("fetch_url", {"url": "http://127.0.0.1:8787/"}))
        self.assertIn("error", tools.call("fetch_url", {"url": "file:///etc/passwd"}))
        self.assertIn("escapes", tools.call("read_file", {"path": "../../etc/passwd"}))
        self.assertIn("disabled", tools.call("run_shell", {"cmd": "id"}))

    def test_html_and_ddg_parsing(self):
        page = ('<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fx">Title <b>One</b></a>'
                '<a class="result__snippet" href="#">Snip &amp; more</a>')
        r = tools.parse_ddg(page)
        self.assertEqual(r[0]["url"], "https://example.com/x"); self.assertEqual(r[0]["snippet"], "Snip & more")
        self.assertEqual(tools.html_to_text("<script>x()</script><p>Hi&nbsp;there</p>"), "Hi\xa0there")

    def test_seed_only_once(self):
        seed = os.path.join(self.d, "seed.json")
        json.dump({"openItems": [{"id": "P1", "title": "x"}]}, open(seed, "w"))
        m = Memory(self.db)
        self.assertEqual(m.seed_once(seed), 1); self.assertEqual(m.seed_once(seed), 0)

    def test_http_server_and_auth(self):
        srv = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(self.agent, "secret"))
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        base = "http://127.0.0.1:%d" % srv.server_port
        self.assertIn(b"Forge Agent", urllib.request.urlopen(base + "/").read())
        req = lambda tok: urllib.request.Request(base + "/api/chat", json.dumps({"message": "hello", "session": "w"}).encode(),
                                                 {"Authorization": "Bearer " + tok, "Content-Type": "application/json"})
        with self.assertRaises(urllib.error.HTTPError) as cm: urllib.request.urlopen(req("wrong"))
        self.assertEqual(cm.exception.code, 401)
        self.assertIn("mock reply", json.loads(urllib.request.urlopen(req("secret")).read())["answer"])
        bad = urllib.request.Request(base + "/api/chat", b"{}", {"Authorization": "Bearer secret"})
        with self.assertRaises(urllib.error.HTTPError) as cm: urllib.request.urlopen(bad)
        self.assertEqual(cm.exception.code, 400)
        srv.shutdown()

    def test_llm_down_degrades_gracefully(self):
        class Dead:
            def chat(self, m): raise ConnectionError("refused")
        a = Agent(Memory(self.db), Dead())
        self.assertIn("could not reach", a.run("s", "hi")["answer"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
