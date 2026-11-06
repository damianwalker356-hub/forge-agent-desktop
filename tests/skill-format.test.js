import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { parseSkill, parseFrontMatter, validateInput, matches, renderOutput, codeHash } from '../docs/skill-format.js';
import { parseToolCall } from '../docs/skill-registry-parse.js';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const SKILL = `---
name: engine-displacement
version: 2
description: Swept displacement.
tool: engine_displacement
output_format: "Displacement: {displacement_liters:3} L"
---
# Engine displacement
Text for the owner.
\`\`\`forge-schema
{ "bore_mm": { "type": "number", "min": 1 }, "stroke_mm": { "type": "number", "min": 1 }, "cylinders": { "type": "integer", "min": 1, "max": 64 }, "note": { "type": "string", "required": false, "maxLength": 8 } }
\`\`\`
\`\`\`forge-tool
function run(input) { const cc = Math.PI / 4 * input.bore_mm ** 2 * input.stroke_mm * input.cylinders / 1000; return { displacement_cc: cc, displacement_liters: cc / 1000 }; }
\`\`\`
\`\`\`forge-tests
[ { "name": "bp", "prompt": "Displacement of 83x85 four?", "input": { "bore_mm": 83, "stroke_mm": 85, "cylinders": 4 }, "expected": { "displacement_liters": 1.839 }, "absolute_tolerance": 0.001 },
  { "input": { "bore_mm": 0, "stroke_mm": 1, "cylinders": 1 }, "expect_error": true } ]
\`\`\`
\`\`\`forge-example
{ "prompt": "Displacement of a 4 cylinder 86 by 86?", "response": "[tool:engine_displacement] {\\"bore_mm\\":86,\\"stroke_mm\\":86,\\"cylinders\\":4}" }
\`\`\`
`;
test('front matter parses scalars and lists without executing anything', () => {
  const { meta, body } = parseFrontMatter('---\nname: x\npermissions: [network, "fs"]\n---\nbody');
  assert.deepEqual(meta, { name: 'x', permissions: ['network', 'fs'] }); assert.equal(body, 'body');
});
test('skill parses tool, schema, tests, examples and derived tool-call pairs', () => {
  const s = parseSkill(SKILL);
  assert.equal(s.name, 'engine-displacement'); assert.equal(s.version, '2'); assert.equal(s.kind, 'tool');
  assert.equal(s.tool.name, 'engine_displacement'); assert.match(s.tool.code, /function run/);
  assert.deepEqual(Object.keys(s.tool.schema), ['bore_mm', 'stroke_mm', 'cylinders', 'note']);
  assert.equal(s.tests.length, 2); assert.equal(s.tests[0].tolerance, 0.001); assert.equal(s.tests[1].expectError, true); assert.equal(s.tests[1].name, 'test 2');
  assert.equal(s.examples.length, 1); assert.deepEqual(s.toolExamples, [{ prompt: 'Displacement of 83x85 four?', response: '[tool:engine_displacement] {"bore_mm":83,"stroke_mm":85,"cylinders":4}' }]);
  assert.ok(!/forge-tool/.test(s.instructions) && /Text for the owner/.test(s.instructions));
  assert.deepEqual(s.warnings, []);
});
test('skill name falls back to the file name and must be well formed', () => {
  assert.equal(parseSkill('# plain notes', { filename: 'My-Notes.md' }).name, 'my-notes');
  assert.throws(() => parseSkill('# plain notes', { filename: 'bad name!.md' }), /Skill name/);
  assert.equal(parseSkill('# plain notes', { filename: 'notes.md' }).kind, 'reference');
});
test('tool without tests warns; tests without tool reject; two tools reject', () => {
  const noTests = parseSkill('---\nname: a\n---\n```forge-tool\nfunction run(i){return 1}\n```\n');
  assert.ok(noTests.warnings.some(w => /forge-tests/.test(w)));
  assert.throws(() => parseSkill('---\nname: a\n---\n```forge-tests\n[{"input":{},"expected":1}]\n```\n'), /no forge-tool/);
  assert.throws(() => parseSkill('---\nname: a\n---\n```forge-tool\nfunction run(){}\n```\n```forge-tool\nfunction run(){}\n```\n'), /one forge-tool/);
  assert.throws(() => parseSkill('---\nname: a\n---\n```forge-tool\nconst x = 1\n```\n'), /define function run/);
});
test('permissions and foreign runtimes are flagged', () => {
  const s = parseSkill('---\nname: a\npermissions: [network]\nruntime: python\n---\n```forge-tool\nfunction run(){return 1}\n```\n```forge-tests\n[{"input":{},"expected":1}]\n```\n');
  assert.ok(s.warnings.some(w => /permissions/.test(w))); assert.ok(s.warnings.some(w => /Runtime python/.test(w)));
});
test('input validation rejects unknown, missing, wrong-typed and out-of-range values', () => {
  const schema = parseSkill(SKILL).tool.schema;
  assert.deepEqual(validateInput(schema, { bore_mm: 86, stroke_mm: 86, cylinders: 4 }), { bore_mm: 86, stroke_mm: 86, cylinders: 4 });
  assert.throws(() => validateInput(schema, { bore_mm: 86, stroke_mm: 86, cylinders: 4, extra: 1 }), /Unknown input field/);
  assert.throws(() => validateInput(schema, { bore_mm: 86, stroke_mm: 86 }), /Missing required input: cylinders/);
  assert.throws(() => validateInput(schema, { bore_mm: '86', stroke_mm: 86, cylinders: 4 }), /finite number/);
  assert.throws(() => validateInput(schema, { bore_mm: 86, stroke_mm: 86, cylinders: 4.5 }), /integer/);
  assert.throws(() => validateInput(schema, { bore_mm: 0, stroke_mm: 86, cylinders: 4 }), /≥ 1/);
  assert.throws(() => validateInput(schema, { bore_mm: 86, stroke_mm: 86, cylinders: 4, note: 'too long note' }), /exceeds 8 bytes/);
});
test('expected values compare as a subset with tolerance', () => {
  assert.equal(matches({ a: 1.0005, b: 'x' }, { a: 1 }, 0.001), null);
  assert.match(matches({ a: 1.1 }, { a: 1 }, 0.001), /expected 1, got 1.1/);
  assert.match(matches({ a: 1 }, { b: 1 }), /b: expected number/);
  assert.equal(matches([1, 2], [1, 2]), null); assert.match(matches([1], [1, 2]), /array mismatch/);
});
test('output template renders fixed decimals and marks missing keys', () => {
  assert.equal(renderOutput('D: {displacement_liters:3} L {missing}', { displacement_liters: 1.83912 }), 'D: 1.839 L {missing?}');
  assert.equal(renderOutput(null, {}), null);
});
test('code hash is stable SHA-256 hex', async () => { const h = await codeHash('function run(){}'); assert.match(h, /^[0-9a-f]{64}$/); assert.equal(h, await codeHash('function run(){}')); });
test('model output tool calls parse, tolerate trailing bytes and report bad JSON', () => {
  assert.deepEqual(parseToolCall('[tool:engine_displacement] {"bore_mm":86,"stroke_mm":86,"cylinders":4}').input, { bore_mm: 86, stroke_mm: 86, cylinders: 4 });
  assert.deepEqual(parseToolCall('[tool:x] {"a":{"b":1}} trailing noise}').input, { a: { b: 1 } });
  assert.equal(parseToolCall('plain answer'), null);
  assert.match(parseToolCall('[tool:x] {"a":}').error, /Invalid JSON/);
  assert.equal(parseToolCall('[tool:Bad Name] {}'), null);
});
