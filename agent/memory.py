"""Persistent memory: SQLite (stdlib only). Survives restarts. Thread-safe."""
import json, os, re, sqlite3, threading, time

SCHEMA = """
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY AUTOINCREMENT, session TEXT, role TEXT, content TEXT, t REAL);
CREATE TABLE IF NOT EXISTS facts(key TEXT PRIMARY KEY, kind TEXT, value TEXT, source TEXT, t REAL);
CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY, title TEXT, status TEXT, notes TEXT, t REAL);
CREATE TABLE IF NOT EXISTS checkpoints(id INTEGER PRIMARY KEY AUTOINCREMENT, session TEXT, node TEXT, state TEXT, t REAL);
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
CREATE INDEX IF NOT EXISTS idx_msg_session ON messages(session, id);
"""
KINDS = ("preference", "decision", "fact")
_word = re.compile(r"[a-z0-9]{3,}")


def _tokens(s):
    return set(_word.findall(s.lower()))


class Memory:
    def __init__(self, path):
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        self.lock = threading.RLock()
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.executescript(SCHEMA)
        self.db.commit()

    def _run(self, sql, args=()):
        with self.lock:
            cur = self.db.execute(sql, args)
            self.db.commit()
            return cur

    def _all(self, sql, args=()):
        with self.lock:
            return [dict(r) for r in self.db.execute(sql, args).fetchall()]

    # messages
    def add_message(self, session, role, content):
        self._run("INSERT INTO messages(session,role,content,t) VALUES(?,?,?,?)", (session, role, content, time.time()))

    def recent(self, session, n=8):
        rows = self._all("SELECT role,content FROM messages WHERE session=? ORDER BY id DESC LIMIT ?", (session, n))
        return rows[::-1]

    def search(self, query, session=None, k=4, skip_recent=8):
        q = _tokens(query)
        if not q:
            return []
        rows = self._all("SELECT id,session,role,content FROM messages ORDER BY id DESC LIMIT 3000")
        recent_ids = {r["id"] for r in rows if r["session"] == session}
        recent_ids = set(sorted(recent_ids, reverse=True)[:skip_recent])
        scored = []
        for r in rows:
            if r["id"] in recent_ids:
                continue
            s = len(q & _tokens(r["content"]))
            if s:
                scored.append((s, r["id"], r))
        scored.sort(key=lambda x: (-x[0], -x[1]))
        return [x[2] for x in scored[:k]]

    # facts / preferences / decisions
    def remember(self, kind, key, value, source="user"):
        if kind not in KINDS:
            raise ValueError("kind must be one of %s" % (KINDS,))
        key, value = key.strip()[:120], value.strip()[:2000]
        if not key or not value:
            raise ValueError("key and value required")
        self._run("INSERT INTO facts(key,kind,value,source,t) VALUES(?,?,?,?,?) "
                  "ON CONFLICT(key) DO UPDATE SET kind=excluded.kind,value=excluded.value,source=excluded.source,t=excluded.t",
                  (key, kind, value, source, time.time()))

    def forget(self, key):
        return self._run("DELETE FROM facts WHERE key=?", (key.strip(),)).rowcount

    def facts(self):
        return self._all("SELECT key,kind,value,source FROM facts ORDER BY kind,key")

    # open items
    def add_item(self, title, notes=""):
        n = self._all("SELECT COUNT(*) c FROM items")[0]["c"] + 1
        iid = "T%d" % n
        while self._all("SELECT 1 FROM items WHERE id=?", (iid,)):
            n += 1
            iid = "T%d" % n
        self._run("INSERT INTO items VALUES(?,?,?,?,?)", (iid, title.strip()[:200], "open", notes, time.time()))
        return iid

    def set_item(self, iid, status):
        return self._run("UPDATE items SET status=?,t=? WHERE id=?", (status, time.time(), iid.strip().upper())).rowcount

    def items(self, include_done=False):
        sql = "SELECT id,title,status,notes FROM items" + ("" if include_done else " WHERE status!='done'") + " ORDER BY t"
        return self._all(sql)

    # checkpoints (LangGraph-style: state saved at every node transition)
    def checkpoint(self, session, node, state):
        self._run("INSERT INTO checkpoints(session,node,state,t) VALUES(?,?,?,?)",
                  (session, node, json.dumps(state, default=str)[:20000], time.time()))

    def last_checkpoint(self, session):
        r = self._all("SELECT node,state,t FROM checkpoints WHERE session=? ORDER BY id DESC LIMIT 1", (session,))
        return r[0] if r else None

    # seed / export
    def import_state(self, data):
        n = 0
        for d in data.get("decisions", []):
            self.remember("decision", d["key"], "%s (%s)" % (d["value"], d.get("reason", "")), "seed"); n += 1
        for k, v in data.get("preferences", {}).items():
            self.remember("preference", k, str(v), "seed"); n += 1
        for it in data.get("openItems", []):
            self._run("INSERT OR IGNORE INTO items VALUES(?,?,?,?,?)",
                      (it["id"], it["title"], it.get("status", "open"), it.get("notes", ""), time.time())); n += 1
        return n

    def seed_once(self, path):
        if not os.path.exists(path):
            return 0
        if self._all("SELECT 1 FROM meta WHERE key='seeded'"):
            return 0
        with open(path) as f:
            n = self.import_state(json.load(f))
        self._run("INSERT OR REPLACE INTO meta VALUES('seeded','1')")
        return n

    def export_state(self):
        return {"facts": self.facts(), "items": self.items(True)}
