// Persistent memory for the browser. State lives in IndexedDB on your device.
const KINDS = ["preference", "decision", "fact"];
const words = (s) => new Set(String(s).toLowerCase().match(/[a-z0-9]{3,}/g) || []);
const MAX_MESSAGES = 2000;

export class MemBackend {
  constructor(initial = null) { this.data = initial; }
  async load() { return this.data ? JSON.parse(JSON.stringify(this.data)) : null; }
  async save(obj) { this.data = JSON.parse(JSON.stringify(obj)); }
}

export class IDBBackend {
  constructor(name = "forge-agent") { this.name = name; }
  _open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(this.name, 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async load() {
    const db = await this._open();
    return new Promise((res, rej) => {
      const q = db.transaction("kv").objectStore("kv").get("state");
      q.onsuccess = () => res(q.result || null);
      q.onerror = () => rej(q.error);
    });
  }
  async save(obj) {
    const db = await this._open();
    return new Promise((res, rej) => {
      const t = db.transaction("kv", "readwrite");
      t.objectStore("kv").put(obj, "state");
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
    });
  }
}

export class Memory {
  constructor(backend) {
    this.backend = backend;
    this.s = { messages: [], facts: {}, items: [], meta: {} };
    this._p = Promise.resolve();
    this._id = 0;
  }
  async init() {
    const d = await this.backend.load();
    if (d) this.s = { messages: d.messages || [], facts: d.facts || {}, items: d.items || [], meta: d.meta || {} };
    this._id = this.s.messages.reduce((m, x) => Math.max(m, x.id || 0), 0);
    return this;
  }
  _save() {
    const snap = JSON.parse(JSON.stringify(this.s));
    this._p = this._p.then(() => this.backend.save(snap)).catch((e) => console.error("save failed", e));
    return this._p;
  }
  flush() { return this._p; }

  addMessage(session, role, content) {
    this.s.messages.push({ id: ++this._id, session, role, content: String(content).slice(0, 4000), t: Date.now() });
    if (this.s.messages.length > MAX_MESSAGES) this.s.messages.splice(0, this.s.messages.length - MAX_MESSAGES);
    return this._save();
  }
  recent(session, n = 8) { return this.s.messages.filter((m) => m.session === session).slice(-n); }
  search(query, session, k = 4, skipRecent = 8) {
    const q = words(query);
    if (!q.size) return [];
    const skip = new Set(this.recent(session, skipRecent).map((m) => m.id));
    const scored = [];
    for (const m of this.s.messages) {
      if (skip.has(m.id)) continue;
      let sc = 0;
      for (const w of words(m.content)) if (q.has(w)) sc++;
      if (sc) scored.push([sc, m.id, m]);
    }
    scored.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
    return scored.slice(0, k).map((x) => x[2]);
  }

  remember(kind, key, value, source = "user") {
    if (!KINDS.includes(kind)) throw new Error("kind must be one of " + KINDS.join(", "));
    key = String(key).trim().slice(0, 120); value = String(value).trim().slice(0, 2000);
    if (!key || !value) throw new Error("key and value required");
    this.s.facts[key] = { kind, value, source, t: Date.now() };
    return this._save();
  }
  forget(key) {
    key = String(key).trim();
    if (!(key in this.s.facts)) return false;
    delete this.s.facts[key];
    this._save();
    return true;
  }
  facts() {
    return Object.entries(this.s.facts).map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key));
  }

  addItem(title) {
    let n = this.s.items.length + 1;
    while (this.s.items.some((i) => i.id === "T" + n)) n++;
    const id = "T" + n;
    this.s.items.push({ id, title: String(title).trim().slice(0, 200), status: "open", t: Date.now() });
    this._save();
    return id;
  }
  setItem(id, status) {
    const it = this.s.items.find((i) => i.id === String(id).trim().toUpperCase());
    if (!it) return false;
    it.status = status; it.t = Date.now();
    this._save();
    return true;
  }
  items(includeDone = false) { return this.s.items.filter((i) => includeDone || i.status !== "done"); }

  importSeed(seed) {
    if (this.s.meta.seeded) return 0;
    let n = 0;
    for (const d of seed.decisions || []) { this.s.facts[d.key] = { kind: "decision", value: `${d.value} (${d.reason || ""})`, source: "seed", t: Date.now() }; n++; }
    for (const [k, v] of Object.entries(seed.preferences || {})) { this.s.facts[k] = { kind: "preference", value: String(v), source: "seed", t: Date.now() }; n++; }
    for (const it of seed.openItems || []) { if (!this.s.items.some((x) => x.id === it.id)) { this.s.items.push({ status: "open", t: Date.now(), ...it }); n++; } }
    this.s.meta.seeded = true;
    this._save();
    return n;
  }
  exportState() { return { version: 1, facts: this.s.facts, items: this.s.items }; }
  importState(obj) {
    if (!obj || typeof obj !== "object") throw new Error("not a backup object");
    let n = 0;
    for (const [k, v] of Object.entries(obj.facts || {})) { if (KINDS.includes(v.kind) && v.value) { this.s.facts[k] = v; n++; } }
    for (const it of obj.items || []) { if (it.id && it.title && !this.s.items.some((x) => x.id === it.id)) { this.s.items.push(it); n++; } }
    this._save();
    return n;
  }
}
