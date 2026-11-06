// Runs skill tool code with no access to the page, storage or network.
// Layering: sandboxed opaque-origin <iframe sandbox="allow-scripts"> with a strict CSP → inside it a Worker built from a
// blob: URL (falls back to a data: URL worker for engines where blob workers fail in opaque origins). A timeout
// terminates the worker and removes the iframe. Results must survive structured cloning and are capped in size.
export const DEFAULT_TIMEOUT_MS = 2000, MAX_RESULT_BYTES = 65536;
const CSP = "default-src 'none'; script-src 'unsafe-inline' blob: data:; worker-src blob: data:";
// Source executed inside the worker: the tool's code is appended after this prologue.
function workerSource(code) {
  return `'use strict';
const __logs = [];
const console = { log: (...a) => { if (__logs.length < 50) __logs.push(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')); }, warn() {}, error() {} };
self.onmessage = (event) => {
  try {
    const run = (function () { ${code}\n; if (typeof run !== 'function') throw Error('forge-tool did not define run(input)'); return run; })();
    Promise.resolve(run(JSON.parse(event.data))).then(result => {
      if (result === undefined) throw Error('run(input) returned undefined');
      const json = JSON.stringify(result);
      if (json === undefined) throw Error('run(input) must return JSON-serialisable data');
      if (json.length > ${MAX_RESULT_BYTES}) throw Error('Result exceeds ${MAX_RESULT_BYTES} bytes');
      postMessage({ ok: true, result: JSON.parse(json), logs: __logs });
    }).catch(fail);
  } catch (error) { fail(error); }
  function fail(error) { postMessage({ ok: false, error: String(error && error.message || error), logs: __logs }); }
};`;
}
// Page running inside the sandboxed iframe. It only relays messages between the parent and the worker.
function frameSource(nonce) {
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${CSP}"><script>
'use strict';
const nonce = ${JSON.stringify(nonce)};
let worker = null, mode = null;
function start(source) {
  try { worker = new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))); mode = 'blob-worker'; }
  catch (e1) {
    try { worker = new Worker('data:text/javascript;charset=utf-8,' + encodeURIComponent(source)); mode = 'data-worker'; }
    catch (e2) { parent.postMessage({ nonce, ok: false, unsupported: true, error: 'Workers unavailable in sandboxed frame: ' + (e2 && e2.message) }, '*'); return false; }
  }
  worker.onerror = (e) => parent.postMessage({ nonce, ok: false, error: 'Worker error: ' + (e && e.message || 'script failed to load'), mode }, '*');
  worker.onmessage = (e) => parent.postMessage({ nonce, mode, ...e.data }, '*');
  return true;
}
addEventListener('message', (e) => {
  if (e.source !== parent || !e.data || e.data.nonce !== nonce) return;
  if (e.data.type === 'run') { if (start(e.data.source)) worker.postMessage(e.data.input); }
  if (e.data.type === 'abort' && worker) { worker.terminate(); worker = null; }
});
parent.postMessage({ nonce, ready: true }, '*');
</script>`;
}
export function sandboxAvailable() { return typeof document !== 'undefined' && typeof Worker !== 'undefined'; }
// Execute `code` (must define run(input)) with `input` (JSON object). Resolves { ok, result|error, logs, mode, milliseconds }.
export function runTool(code, input, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!sandboxAvailable()) return Promise.resolve({ ok: false, error: 'This browser cannot run skill tools (no DOM or Worker support).', unsupported: true, logs: [] });
  return new Promise(resolve => {
    const nonce = crypto.randomUUID(), frame = document.createElement('iframe'), started = performance.now();
    frame.setAttribute('sandbox', 'allow-scripts'); frame.setAttribute('aria-hidden', 'true'); frame.hidden = true; frame.style.display = 'none';
    frame.srcdoc = frameSource(nonce);
    let done = false, timer = null;
    const finish = payload => {
      if (done) return; done = true; clearTimeout(timer); removeEventListener('message', onMessage);
      try { frame.contentWindow?.postMessage({ nonce, type: 'abort' }, '*'); } catch {}
      frame.remove(); resolve({ logs: [], ...payload, milliseconds: performance.now() - started });
    };
    const onMessage = event => {
      if (event.source !== frame.contentWindow || !event.data || event.data.nonce !== nonce) return;
      if (event.data.ready) { frame.contentWindow.postMessage({ nonce, type: 'run', source: workerSource(code), input: JSON.stringify(input ?? {}) }, '*'); return; }
      finish(event.data);
    };
    addEventListener('message', onMessage);
    timer = setTimeout(() => finish({ ok: false, timedOut: true, error: `Tool exceeded ${timeoutMs} ms and was terminated` }), timeoutMs);
    document.body.appendChild(frame);
  });
}
// Confirms the sandbox works in this browser and that the isolation holds (network, storage and DOM must be unreachable).
export async function probeSandbox() {
  const code = `function run(input) {
    const checks = {};
    checks.noLocalStorage = typeof localStorage === 'undefined';
    checks.noIndexedDB = typeof indexedDB === 'undefined' || (() => { try { indexedDB.open('forge-probe'); return false; } catch (e) { return true; } })();
    checks.noDocument = typeof document === 'undefined' && typeof window === 'undefined';
    checks.noRemoteImport = (() => { try { importScripts(${JSON.stringify(new URL('seed.js', location.href).href)}); return false; } catch (e) { return true; } })();
    const net = typeof fetch !== 'function' ? Promise.resolve(true) : fetch(${JSON.stringify(location.origin + '/')}).then(() => false, () => true);
    return net.then(blocked => { checks.networkBlocked = blocked; return { sum: input.a + input.b, checks }; });
  }`;
  const r = await runTool(code, { a: 2, b: 3 }, { timeoutMs: 4000 });
  if (!r.ok) return { ok: false, error: r.error, unsupported: Boolean(r.unsupported), mode: r.mode || null };
  const checks = r.result.checks, isolated = Object.values(checks).every(Boolean);
  return { ok: r.result.sum === 5 && isolated, mode: r.mode, checks, milliseconds: r.milliseconds, error: isolated ? null : 'Isolation check failed: ' + Object.entries(checks).filter(([, v]) => !v).map(([k]) => k).join(', ') };
}
