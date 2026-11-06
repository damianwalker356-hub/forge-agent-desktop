import { encoder, promptText, EOS } from './rnn-core.js';
export const MAX_EXAMPLE_BYTES = 131072;
// A training job is one owner-supplied example: either free text (next-byte modelling of the whole document)
// or a prompt/response pair (loss applied only to the response bytes and the end-of-sequence byte).
export function makeJob({ id, text, prompt, response, kind = 'text', name = '', passes = 3 }) {
  if (!Number.isInteger(passes) || passes < 1 || passes > 200) throw Error("Passes must be 1–200");
  let tokens, responseStart = 1;
  if (kind === 'pair') {
    if (typeof prompt !== 'string' || !prompt.trim() || typeof response !== 'string' || !response.trim()) throw Error('A prompt/response example needs both a question and the response');
    const prefix = encoder.encode(promptText(prompt)); responseStart = prefix.length;
    tokens = encoder.encode(promptText(prompt) + response + String.fromCharCode(EOS));
  } else if (kind === 'text') {
    if (typeof text !== 'string' || !text.trim()) throw Error('Empty learning material');
    tokens = encoder.encode(text + '\n');
  } else throw Error('Unknown example kind');
  if (tokens.length > MAX_EXAMPLE_BYTES) throw Error(`Learning example exceeds ${MAX_EXAMPLE_BYTES.toLocaleString()} bytes; nothing truncated`);
  return { id, kind, name: String(name).slice(0, 200), tokens, responseStart, passes, pass: 0, cursor: responseStart, updates: 0, status: 'queued', createdAt: new Date().toISOString() };
}
// Sequential coverage: every target byte after responseStart is visited once per pass, including the final short window.
export function nextWindow(job) {
  const end = Math.min(job.tokens.length, job.cursor + 32), start = job.cursor - 1;
  const warmStart = job.kind === 'pair' ? 0 : Math.max(0, start - 64); // pairs warm through the full prompt
  return { tokens: job.tokens.slice(start, end), warm: job.tokens.slice(warmStart, start), targets: end - job.cursor, end };
}
export function advance(job, window) {
  job.cursor = window.end; job.updates++;
  if (job.cursor >= job.tokens.length) { job.pass++; job.cursor = job.responseStart; }
  job.status = job.pass >= job.passes ? 'trained' : 'queued';
}
// Explicit prompt/response examples embedded in Markdown. Code in other fences is plain training text and is never executed here.
export function markdownExamples(text) {
  const examples = [];
  for (const match of text.matchAll(/^```forge-example\s*\n([\s\S]*?)^```\s*$/gm)) {
    let o; try { o = JSON.parse(match[1]); } catch { throw Error('Invalid JSON inside forge-example block'); }
    const list = Array.isArray(o) ? o : [o];
    for (const item of list) {
      if (!item || typeof item.prompt !== 'string' || !item.prompt.trim() || typeof item.response !== 'string' || !item.response.trim()) throw Error('forge-example requires nonempty prompt and response strings');
      examples.push({ prompt: item.prompt, response: item.response });
    }
  }
  return examples;
}
export function describeFeedback(text) {
  return /^(false|wrong|incorrect|no|bad)[.!\s]*$/i.test(text.trim());
}
// Canonical text the model is taught to emit when it wants a skill tool to run. Parsed by tool-calls.js.
export function toolCallText(name, input) { return `[tool:${name}] ${JSON.stringify(input)}`; }
