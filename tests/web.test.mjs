import test from "node:test";
import assert from "node:assert/strict";
import { Memory, MemBackend } from "../docs/memory.js";
import { Agent } from "../docs/agent.js";
import { MockLLM } from "../docs/llm.js";
import { createTools, htmlToText, parseDdg } from "../docs/tools.js";
import { SEED } from "../docs/seed.js";

const mk = async (backend = new MemBackend(), llm = new MockLLM(), tools) => {
  const mem = await new Memory(backend).init();
  return { mem, backend, agent: new Agent(mem, llm, tools || createTools({ fetchFn: async () => { throw new TypeError("blocked"); } })) };
};

test("commands persist across a restart", async () => {
  const { agent, mem, backend } = await mk();
  await agent.run("s1", "/decide rods = forged 4340");
  await agent.run("s1", "/todo fix pipes");
  await mem.flush();
  const b = await mk(backend);
  const out = (await b.agent.run("s2", "/memory")).answer;
  assert.match(out, /rods/); assert.match(out, /T1/);
});

test("recall across sessions", async () => {
  const { agent, mem } = await mk();
  await agent.run("s1", "the turbo manifold flange cracked at 22 psi");
  const hits = mem.search("turbo manifold flange", "s2");
  assert.ok(hits.length && /flange/.test(hits[0].content));
});

test("tool loop calls a tool and answers from the observation", async () => {
  const fetchFn = async () => ({ ok: true, json: async () => ({ query: { search: [{ title: "Navier-Stokes equations", snippet: 'the <span class="searchmatch">fluid</span> equations' }] } }) });
  const { agent } = await mk(new MemBackend(), new MockLLM(), createTools({ fetchFn }));
  const r = await agent.run("s1", "lookup: navier stokes");
  assert.ok(r.trace.includes("tool:wiki_search"));
  assert.match(r.answer, /Navier-Stokes equations/);
});

test("agent learns from remember tags and strips them", async () => {
  const { agent, mem } = await mk();
  const r = await agent.run("s1", "remember-test");
  assert.doesNotMatch(r.answer, /<remember/);
  assert.ok(mem.facts().some((f) => f.key === "test_pref"));
});

test("validation and errors", async () => {
  const { agent, mem } = await mk();
  assert.match((await agent.run("s", "/remember = x")).answer, /error/);
  assert.throws(() => mem.remember("nonsense", "k", "v"));
  assert.match((await agent.run("s", "/import not json")).answer, /error/);
});

test("model failure degrades gracefully; no model gives guidance", async () => {
  const { agent } = await mk(new MemBackend(), { chat: async () => { throw new Error("gpu lost"); } });
  assert.match((await agent.run("s", "hi")).answer, /model failed/);
  const n = await mk(new MemBackend(), null);
  assert.match((await n.agent.run("s", "hi")).answer, /not loaded/);
  assert.match((await n.agent.run("s", "/help")).answer, /Commands/);
});

test("seed applies once; export/import round trip", async () => {
  const { mem, backend } = await mk();
  assert.equal(mem.importSeed(SEED), 7); assert.equal(mem.importSeed(SEED), 0);
  await mem.remember("fact", "car", "1994 MX-5"); await mem.flush();
  const dump = JSON.stringify(mem.exportState());
  const fresh = await mk();
  assert.ok(fresh.mem.importState(JSON.parse(dump)) >= 7);
  assert.ok(fresh.mem.facts().some((f) => f.key === "car"));
});

test("fetch_url explains CORS failures; proxy path works", async () => {
  const blocked = createTools({ fetchFn: async () => { throw new TypeError("Load failed"); } });
  assert.match(await blocked.call("fetch_url", { url: "https://example.com" }), /CORS/);
  const seen = [];
  const proxied = createTools({ getProxy: () => "https://p.example/?u=", fetchFn: async (u) => { seen.push(u); if (!u.startsWith("https://p.example")) throw new TypeError("x"); return { ok: true, text: async () => "<p>Hello &amp; welcome</p>" }; } });
  assert.equal(await proxied.call("fetch_url", { url: "https://example.com/a" }), "Hello & welcome");
  assert.equal(seen[1], "https://p.example/?u=" + encodeURIComponent("https://example.com/a"));
});

test("html and ddg parsing", () => {
  assert.equal(htmlToText("<script>x()</script><p>Hi&nbsp;there &#65;</p>"), "Hi there A");
  const page = '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fx">Title <b>One</b></a><a class="result__snippet" href="#">Snip &amp; more</a>';
  const r = parseDdg(page);
  assert.equal(r[0].url, "https://example.com/x"); assert.equal(r[0].snippet, "Snip & more");
});
