// Small DOM helpers shared by the pages. Colour meaning across the app:
// white = regular/user text, green = model output or a completed operation, red = error, yellow = warning or heavy work.
export const $ = id => document.getElementById(id);
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v; else if (k === 'text') node.textContent = v; else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v); else if (v === true) node.setAttribute(k, ''); else node.setAttribute(k, v);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) node.append(child);
  return node;
}
export function setStatus(node, text, tone = 'regular') { node.textContent = text; node.dataset.tone = tone; node.hidden = !text; }
export function download(data, filename) {
  const url = URL.createObjectURL(new Blob([typeof data === 'string' ? data : JSON.stringify(data)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export const TEXT_FILE = /\.(txt|md|json|csv|yaml|yml|js|py|log)$/i;
// Reads up to `maxFiles` UTF-8 text files, rejecting binaries and over-size selections. Nothing is truncated.
export async function readTextFiles(fileList, { maxFiles = 3, maxTotalBytes = 65536, maxFileBytes = maxTotalBytes } = {}) {
  const picked = Array.from(fileList || []);
  if (!picked.length) return [];
  if (picked.length > maxFiles) throw Error(`Choose at most ${maxFiles} files`);
  const out = []; let total = 0;
  for (const f of picked) {
    if (!TEXT_FILE.test(f.name)) throw Error(`Unsupported file ${f.name}. Use text, Markdown, JSON, CSV, YAML or code files; PDF, images and binaries are not read.`);
    if (f.size > maxFileBytes) throw Error(`${f.name} exceeds ${maxFileBytes.toLocaleString()} bytes`);
    total += f.size; if (total > maxTotalBytes) throw Error(`Combined files exceed ${maxTotalBytes.toLocaleString()} bytes; nothing truncated`);
    let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(await f.arrayBuffer()); } catch { throw Error(`${f.name} is not valid UTF-8 text`); }
    if (text.includes('\u0000')) throw Error(`Binary content rejected: ${f.name}`);
    out.push({ name: f.name, text });
  }
  return out;
}
export const fmt = n => Number(n).toLocaleString();
export const short = hash => (hash || '').slice(0, 12);
export function receiptText(r) {
  const w = r.windows?.at(-1);
  return `Weights changed and saved — model ${r.modelId}; updates ${r.stepBefore} → ${r.stepAfter}; ${fmt(r.targets)} byte targets; `
    + (w ? `last-window loss ${w.lossBefore.toFixed(4)} → ${w.lossAfter.toFixed(4)}; ` : '')
    + `${fmt(r.changedParameterAssignments)} changed parameter assignments; hash ${short(r.hashBefore)} → ${short(r.hashAfter)}. `
    + `${r.name}: pass ${r.pass}/${r.passes}.`
    + (r.rules?.bytes ? ` Rules context: ${fmt(r.rules.bytes)} bytes (state from update ${r.rules.stateStep}).` : '')
    + (r.reproduction ? ` Training-example answer: ${JSON.stringify(r.reproduction.actual)}; exact match: ${r.reproduction.exactMatch}.` : '')
    + (r.stopReason ? ` ${r.stopReason}. Reproducing a training example is not generalisation.` : r.status === 'trained' ? ' Scheduled passes complete; test the answer separately.' : '');
}
