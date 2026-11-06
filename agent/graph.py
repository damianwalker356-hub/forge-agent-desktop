"""State-graph agent loop (LangGraph-style, no dependency).
Nodes: recall -> think -> (act -> think)* -> learn -> respond. State is checkpointed to SQLite at every node."""
import json, re
from . import tools

MAX_STEPS = 6
TOOL_RE = re.compile(r"^TOOL:\s*(\w+)\s*(\{.*\})\s*$", re.M)
REM_RE = re.compile(r'<remember\s+kind="(preference|decision|fact)"\s+key="([^"]+)">(.*?)</remember>', re.S)

SYSTEM = """You are Forge Agent, a persistent assistant for Damian's engineering and simulation projects.
You are direct and give correct answers, not reassurance. If you do not know, say so.
To use a tool, reply with exactly one line and nothing else:
TOOL: <name> {{json arguments}}
Available tools:
{tools}
After an OBSERVATION arrives, either call another tool or answer.
To save something worth remembering across sessions, put <remember kind="preference|decision|fact" key="short_key">value</remember> in your final answer.

KNOWN FACTS, PREFERENCES AND DECISIONS:
{facts}

OPEN ITEMS:
{items}

RELEVANT PAST MESSAGES:
{recalled}
{final}"""

HELP = """Commands (work without any model):
/remember key = value   save a fact
/pref key = value       save a preference
/decide key = value     lock in a decision
/todo title             add an open item
/done T1                close an item
/forget key             delete a fact
/memory                 show everything I know
/help                   this list"""


class Agent:
    def __init__(self, memory, llm):
        self.mem, self.llm = memory, llm

    # ---------- deterministic commands ----------
    def command(self, text):
        t = text.strip()
        if not t.startswith("/"):
            return None
        cmd, _, rest = t.partition(" ")
        cmd = cmd.lower()
        try:
            if cmd in ("/remember", "/pref", "/decide"):
                key, sep, val = rest.partition("=")
                if not sep:
                    return "Use: %s key = value" % cmd
                kind = {"/remember": "fact", "/pref": "preference", "/decide": "decision"}[cmd]
                self.mem.remember(kind, key, val)
                return "Saved %s: %s" % (kind, key.strip())
            if cmd == "/todo":
                return "Added %s" % self.mem.add_item(rest) if rest.strip() else "Use: /todo title"
            if cmd == "/done":
                return "Closed %s" % rest.strip().upper() if self.mem.set_item(rest, "done") else "No such item"
            if cmd == "/forget":
                return "Forgot %s" % rest.strip() if self.mem.forget(rest) else "No such key"
            if cmd == "/memory":
                return self._facts_text() + "\n\nOpen items:\n" + self._items_text()
            return HELP
        except ValueError as e:
            return "error: %s" % e

    def _facts_text(self):
        f = self.mem.facts()
        return "\n".join("- [%s] %s: %s" % (x["kind"], x["key"], x["value"]) for x in f) or "(nothing saved yet)"

    def _items_text(self):
        i = self.mem.items()
        return "\n".join("- %s [%s] %s" % (x["id"], x["status"], x["title"]) for x in i) or "(none)"

    # ---------- graph ----------
    def run(self, session, text):
        self.mem.add_message(session, "user", text)
        out = self.command(text)
        if out is not None:
            self.mem.add_message(session, "assistant", out)
            return {"answer": out, "trace": ["command"]}
        state = {"session": session, "user": text, "scratch": [], "steps": 0, "trace": [], "answer": None, "pending": None}
        node = "recall"
        while node != "end":
            self.mem.checkpoint(session, node, {k: v for k, v in state.items() if k != "context"})
            state["trace"].append(node)
            node = getattr(self, "n_" + node)(state)
        return {"answer": state["answer"], "trace": state["trace"]}

    def n_recall(self, s):
        hits = self.mem.search(s["user"], s["session"])
        s["recalled"] = "\n".join("- (%s) %s" % (h["role"], h["content"][:200].replace("\n", " ")) for h in hits) or "(none)"
        return "think"

    def n_think(self, s):
        final = "" if s["steps"] < MAX_STEPS else "\nTool budget used up. Answer now without calling tools."
        system = SYSTEM.format(tools=tools.describe(), facts=self._facts_text(), items=self._items_text(),
                               recalled=s["recalled"], final=final)
        history = self.mem.recent(s["session"], 10)[:-1]  # exclude the message we just stored
        msgs = [{"role": "system", "content": system}] + history + [{"role": "user", "content": s["user"]}]
        for role, content in s["scratch"]:
            msgs.append({"role": role, "content": content})
        try:
            out = self.llm.chat(msgs)
        except Exception as e:
            s["answer"] = ("I could not reach the language model (%s: %s). Slash commands still work. "
                           "Check that Ollama or your model server is running." % (type(e).__name__, e))
            return "respond"
        m = TOOL_RE.search(out)
        if m and not final:
            try:
                s["pending"] = (m.group(1), json.loads(m.group(2)))
                s["scratch"].append(("assistant", m.group(0)))
                return "act"
            except json.JSONDecodeError:
                s["scratch"] += [("assistant", m.group(0)), ("user", "OBSERVATION: tool arguments were not valid JSON. Try again.")]
                s["steps"] += 1
                return "think"
        s["answer"] = out
        return "learn"

    def n_act(self, s):
        name, args = s["pending"]
        result = tools.call(name, args)
        s["steps"] += 1
        s["trace"].append("tool:" + name)
        s["scratch"].append(("user", "OBSERVATION [%s]: %s" % (name, result)))
        return "think"

    def n_learn(self, s):
        for kind, key, val in REM_RE.findall(s["answer"] or ""):
            try:
                self.mem.remember(kind, key, val, "agent")
            except ValueError:
                pass
        s["answer"] = REM_RE.sub("", s["answer"] or "").strip()
        return "respond"

    def n_respond(self, s):
        self.mem.add_message(s["session"], "assistant", s["answer"])
        return "end"
