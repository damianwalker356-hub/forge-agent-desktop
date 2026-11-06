// State-graph agent loop: recall -> think -> (act -> think)* -> learn -> respond.
const MAX_STEPS = 3;
const TOOL_RE = /^TOOL:\s*(\w+)\s*(\{.*\})\s*$/m;
const HELP = `Commands (work without the model):
/remember key = value   save a fact
/pref key = value       save a preference
/decide key = value     lock in a decision
/todo title             add an open item
/done T1                close an item
/forget key             delete a fact
/memory                 show everything I know
/wiki query             search Wikipedia
/search query           web search (needs /proxy, else Wikipedia)
/fetch url              read a page (CORS limits apply)
/proxy [prefix|off]     set or show a CORS proxy prefix
/export                 print a backup of facts and items
/import {json}          restore from a backup
/skills                 list installed skill tools
/tool name {json}       run an installed skill tool directly
/help                   this list`;

export class Agent {
  constructor(mem, llm, tools) { this.mem = mem; this.llm = llm; this.tools = tools; this.settings = {}; }

  factsText() {
    const f = this.mem.facts().slice(0, 25);
    return f.map((x) => `- [${x.kind}] ${x.key}: ${x.value.slice(0, 200)}`).join("\n") || "(nothing saved yet)";
  }
  itemsText() {
    return this.mem.items().slice(0, 15).map((x) => `- ${x.id} [${x.status}] ${x.title}`).join("\n") || "(none)";
  }

  async command(text) {
    const t = text.trim();
    if (!t.startsWith("/")) return null;
    const sp = t.indexOf(" ");
    const cmd = (sp < 0 ? t : t.slice(0, sp)).toLowerCase();
    const rest = sp < 0 ? "" : t.slice(sp + 1).trim();
    try {
      if (["/remember", "/pref", "/decide"].includes(cmd)) {
        const i = rest.indexOf("=");
        if (i < 0) return `Use: ${cmd} key = value`;
        const kind = { "/remember": "fact", "/pref": "preference", "/decide": "decision" }[cmd];
        this.mem.remember(kind, rest.slice(0, i), rest.slice(i + 1));
        return `Saved ${kind}: ${rest.slice(0, i).trim()}`;
      }
      if (cmd === "/todo") return rest ? `Added ${this.mem.addItem(rest)}` : "Use: /todo title";
      if (cmd === "/done") return this.mem.setItem(rest, "done") ? `Closed ${rest.toUpperCase()}` : "No such item";
      if (cmd === "/forget") return this.mem.forget(rest) ? `Forgot ${rest}` : "No such key";
      if (cmd === "/memory") return `${this.factsText()}\n\nOpen items:\n${this.itemsText()}`;
      if (cmd === "/wiki") return rest ? await this.tools.call("wiki_search", { query: rest }) : "Use: /wiki query";
      if (cmd === "/search") return rest ? await this.tools.call("web_search", { query: rest }) : "Use: /search query";
      if (cmd === "/fetch") return rest ? await this.tools.call("fetch_url", { url: rest }) : "Use: /fetch url";
      if (cmd === "/proxy") {
        if (!rest) return this.settings.getProxy?.() ? "Proxy: " + this.settings.getProxy() : "No proxy set.";
        this.settings.setProxy?.(rest === "off" ? "" : rest);
        return rest === "off" ? "Proxy cleared." : "Proxy set.";
      }
      if (cmd === "/export") return JSON.stringify(this.mem.exportState());
      if (cmd === "/import") return `Imported ${this.mem.importState(JSON.parse(rest))} entries.`;
      return HELP;
    } catch (e) { return "error: " + e.message; }
  }

  system(recalled, final) {
    return `You are Forge Agent, a persistent assistant for Damian's engineering and simulation projects. Be direct and correct. If you do not know, say so.
To look something up, reply with exactly one line and nothing else:
TOOL: <name> {json arguments}
Tools:
${this.tools.describe()}
After an OBSERVATION, answer using it.
To save something for future sessions, include <remember kind="preference|decision|fact" key="short_key">value</remember> in your answer.

KNOWN:
${this.factsText()}

OPEN ITEMS:
${this.itemsText()}

PAST MESSAGES:
${recalled}${final ? "\nNo more tools. Answer now." : ""}`;
  }

  async run(session, text, onToken) {
    this.mem.addMessage(session, "user", text);
    const cmd = await this.command(text);
    if (cmd !== null) { this.mem.addMessage(session, "assistant", cmd); return { answer: cmd, trace: ["command"] }; }
    if (!this.llm) {
      const a = "The agent model is not loaded. Normal messages go to the model you built (Train page); slash commands (/help) work without one.";
      return { answer: a, trace: ["no-model"] };
    }
    const trace = ["recall"];
    const recalled = this.mem.search(text, session, 3).map((h) => `- (${h.role}) ${h.content.slice(0, 160).replace(/\n/g, " ")}`).join("\n") || "(none)";
    const hist = this.mem.recent(session, 7).slice(0, -1).map((m) => ({ role: m.role, content: m.content.slice(0, 600) }));
    const scratch = [];
    let steps = 0, answer = "";
    for (;;) {
      const final = steps >= MAX_STEPS;
      const msgs = [{ role: "system", content: this.system(recalled, final) }, ...hist, { role: "user", content: text }, ...scratch];
      let out;
      try { out = await this.llm.chat(msgs, onToken); }
      catch (e) { answer = `The model failed (${e.message}). Slash commands still work.`; break; }
      trace.push("think");
      const m = final ? null : TOOL_RE.exec(out);
      if (!m) { answer = out; break; }
      steps++;
      let args;
      try { args = JSON.parse(m[2]); }
      catch (_) { scratch.push({ role: "assistant", content: m[0] }, { role: "user", content: "OBSERVATION: tool arguments were not valid JSON. Try again." }); continue; }
      const res = await this.tools.call(m[1], args);
      trace.push("tool:" + m[1]);
      scratch.push({ role: "assistant", content: m[0] }, { role: "user", content: `OBSERVATION [${m[1]}]: ${res}` });
    }
    trace.push("learn");
    const re = /<remember\s+kind="(preference|decision|fact)"\s+key="([^"]+)">([\s\S]*?)<\/remember>/g;
    for (const [, kind, key, val] of answer.matchAll(re)) { try { this.mem.remember(kind, key, val, "agent"); } catch (_) {} }
    answer = answer.replace(re, "").trim();
    this.mem.addMessage(session, "assistant", answer);
    trace.push("respond");
    return { answer, trace };
  }
}
