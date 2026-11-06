// Forge skill format: one Markdown file that carries instructions, a tool implementation, its input schema,
// tests, and optional training examples. Parsing never executes anything. See SKILLS.md in the repository.
import { markdownExamples, toolCallText } from './learning-data.js';
export const SKILL_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const MAX_SKILL_BYTES = 262144, MAX_TOOL_CODE_BYTES = 65536, SUPPORTED_RUNTIME = 'forge-js';
const enc = new TextEncoder();
function fences(text, lang) {
  const out = []; const re = new RegExp('^```' + lang + '[ \\t]*\\n([\\s\\S]*?)^```[ \\t]*$', 'gm');
  for (const m of text.matchAll(re)) out.push(m[1]);
  return out;
}
// Minimal front matter: `key: value` lines and `key: [a, b]` lists between leading --- markers. Not full YAML.
export function parseFrontMatter(text) {
  const m = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const raw of m[1].split('\n')) {
    const line = raw.trim(); if (!line || line.startsWith('#')) continue;
    const i = line.indexOf(':'); if (i < 1) throw Error('Front matter line is not key: value → ' + line);
    const key = line.slice(0, i).trim(), value = line.slice(i + 1).trim();
    if (/^\[.*\]$/.test(value)) meta[key] = value.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    else meta[key] = value.replace(/^["']|["']$/g, '');
  }
  return { meta, body: text.slice(m[0].length) };
}
const TYPES = new Set(['number', 'integer', 'string', 'boolean']);
export function validateSchema(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) throw Error('forge-schema must be a JSON object of field definitions');
  const fields = Object.entries(schema);
  if (fields.length > 32) throw Error('A tool schema may declare at most 32 fields');
  for (const [name, def] of fields) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name)) throw Error('Invalid schema field name: ' + name);
    if (!def || typeof def !== 'object' || !TYPES.has(def.type)) throw Error(`Field ${name}: type must be number, integer, string or boolean`);
    for (const k of ['min', 'max']) if (def[k] !== undefined && !Number.isFinite(def[k])) throw Error(`Field ${name}: ${k} must be a finite number`);
    if (def.maxLength !== undefined && !(Number.isInteger(def.maxLength) && def.maxLength > 0)) throw Error(`Field ${name}: maxLength must be a positive integer`);
    if (def.enum !== undefined && (!Array.isArray(def.enum) || !def.enum.length)) throw Error(`Field ${name}: enum must be a nonempty array`);
  }
  return schema;
}
// Validates tool input against the schema. Unknown fields are rejected; nothing is coerced silently except numeric strings are NOT accepted.
export function validateInput(schema, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Tool input must be a JSON object');
  for (const key of Object.keys(input)) if (!(key in schema)) throw Error('Unknown input field: ' + key);
  const clean = {};
  for (const [name, def] of Object.entries(schema)) {
    const v = input[name];
    if (v === undefined) { if (def.required === false) { if ('default' in def) clean[name] = def.default; continue; } throw Error('Missing required input: ' + name); }
    if (def.type === 'number' && !(typeof v === 'number' && Number.isFinite(v))) throw Error(`${name} must be a finite number`);
    if (def.type === 'integer' && !Number.isSafeInteger(v)) throw Error(`${name} must be an integer`);
    if (def.type === 'string' && typeof v !== 'string') throw Error(`${name} must be a string`);
    if (def.type === 'boolean' && typeof v !== 'boolean') throw Error(`${name} must be true or false`);
    if (typeof v === 'number') { if (def.min !== undefined && v < def.min) throw Error(`${name} must be ≥ ${def.min}`); if (def.max !== undefined && v > def.max) throw Error(`${name} must be ≤ ${def.max}`); }
    if (typeof v === 'string' && def.maxLength !== undefined && enc.encode(v).length > def.maxLength) throw Error(`${name} exceeds ${def.maxLength} bytes`);
    if (def.enum && !def.enum.includes(v)) throw Error(`${name} must be one of ${def.enum.join(', ')}`);
    clean[name] = v;
  }
  return clean;
}
// Expected values in tests may be a subset of the result's keys. Numbers compare within an absolute tolerance.
export function matches(actual, expected, tolerance = 1e-9, path = '') {
  if (typeof expected === 'number') { if (typeof actual !== 'number' || !Number.isFinite(actual)) return path + ': expected number, got ' + JSON.stringify(actual); return Math.abs(actual - expected) <= tolerance ? null : `${path}: expected ${expected}, got ${actual} (tolerance ${tolerance})`; }
  if (expected === null || typeof expected !== 'object') return Object.is(actual, expected) ? null : `${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
  if (Array.isArray(expected)) { if (!Array.isArray(actual) || actual.length !== expected.length) return path + ': array mismatch'; for (let i = 0; i < expected.length; i++) { const r = matches(actual[i], expected[i], tolerance, `${path}[${i}]`); if (r) return r; } return null; }
  if (!actual || typeof actual !== 'object') return path + ': expected object';
  for (const [k, v] of Object.entries(expected)) { const r = matches(actual[k], v, tolerance, path ? path + '.' + k : k); if (r) return r; }
  return null;
}
// Output template such as "Displacement: {displacement_liters:3} L" → fixed decimals when :n is given.
export function renderOutput(template, result) {
  if (!template) return null;
  return template.replace(/\{([A-Za-z_][A-Za-z0-9_]*)(?::(\d))?\}/g, (_, key, digits) => {
    const v = result?.[key]; if (v === undefined) return '{' + key + '?}';
    return typeof v === 'number' && digits !== undefined ? v.toFixed(Number(digits)) : typeof v === 'object' ? JSON.stringify(v) : String(v);
  });
}
export function parseSkill(markdown, { filename = '' } = {}) {
  if (typeof markdown !== 'string' || !markdown.trim()) throw Error('Empty skill file');
  if (enc.encode(markdown).length > MAX_SKILL_BYTES) throw Error('Skill file exceeds 256 KiB; nothing truncated');
  const { meta, body } = parseFrontMatter(markdown);
  const warnings = [];
  const name = String(meta.name || filename.replace(/\.md$/i, '')).trim().toLowerCase();
  if (!SKILL_NAME.test(name)) throw Error('Skill name must be 1–64 lowercase letters, digits, hyphens or underscores (front matter name: or file name)');
  const runtime = meta.runtime || SUPPORTED_RUNTIME;
  const permissions = Array.isArray(meta.permissions) ? meta.permissions : meta.permissions ? [meta.permissions] : [];
  const code = fences(body, 'forge-tool'), schemas = fences(body, 'forge-schema'), tests = fences(body, 'forge-tests');
  if (code.length > 1) throw Error('A skill may contain one forge-tool block');
  if (schemas.length > 1 || tests.length > 1) throw Error('A skill may contain at most one forge-schema and one forge-tests block');
  let tool = null;
  if (code.length) {
    if (enc.encode(code[0]).length > MAX_TOOL_CODE_BYTES) throw Error('Tool code exceeds 64 KiB');
    if (!/function\s+run\s*\(/.test(code[0])) throw Error('forge-tool must define function run(input)');
    const toolName = String(meta.tool || name).toLowerCase();
    if (!SKILL_NAME.test(toolName)) throw Error('Invalid tool name');
    let schema = {};
    if (schemas.length) { try { schema = validateSchema(JSON.parse(schemas[0])); } catch (e) { throw Error('forge-schema: ' + e.message); } }
    else warnings.push('No forge-schema block: the tool accepts no input fields.');
    tool = { name: toolName, code: code[0], schema, outputFormat: meta.output_format || null, runtime, permissions };
    if (runtime !== SUPPORTED_RUNTIME) warnings.push(`Runtime ${runtime} is not supported by this application; only ${SUPPORTED_RUNTIME} tools can run.`);
    if (permissions.length) warnings.push('Requested permissions are not available to skills: ' + permissions.join(', ') + '. Tools run with no network, no storage and no DOM access.');
  }
  let testCases = [];
  if (tests.length) {
    let parsed; try { parsed = JSON.parse(tests[0]); } catch { throw Error('forge-tests must be valid JSON'); }
    if (!Array.isArray(parsed) || !parsed.length || parsed.length > 100) throw Error('forge-tests must be an array of 1–100 cases');
    testCases = parsed.map((t, i) => {
      if (!t || typeof t !== 'object' || !t.input || typeof t.input !== 'object') throw Error(`Test ${i + 1}: needs an input object`);
      if (!('expected' in t) && !t.expect_error) throw Error(`Test ${i + 1}: needs expected or expect_error`);
      if (t.prompt !== undefined && typeof t.prompt !== 'string') throw Error(`Test ${i + 1}: prompt must be a string`);
      return { name: t.name || `test ${i + 1}`, input: t.input, expected: t.expected, expectError: Boolean(t.expect_error), tolerance: Number.isFinite(t.absolute_tolerance) ? t.absolute_tolerance : 1e-9, prompt: t.prompt };
    });
    if (!tool) throw Error('forge-tests present but no forge-tool block to test');
  } else if (tool) warnings.push('No forge-tests block: the tool cannot be verified and will not be installable.');
  const examples = markdownExamples(body);
  // Tests that carry a natural-language prompt double as training pairs: prompt → canonical tool call.
  const toolExamples = tool ? testCases.filter(t => t.prompt).map(t => ({ prompt: t.prompt, response: toolCallText(tool.name, t.input) })) : [];
  const instructions = body.replace(/^```(forge-tool|forge-schema|forge-tests|forge-example)[ \t]*\n[\s\S]*?^```[ \t]*$/gm, '').trim();
  const kind = tool ? 'tool' : examples.length ? 'examples' : 'reference';
  return { name, version: String(meta.version || '1'), description: String(meta.description || ''), kind, tool, tests: testCases, examples, toolExamples, instructions, warnings, bytes: enc.encode(markdown).length, raw: markdown };
}
export async function codeHash(code) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(code));
  return Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, '0')).join('');
}
