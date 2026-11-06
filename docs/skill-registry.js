// Main-thread registry of installed skills. Installation requires: owner approval of the shown code, every
// forge-tests case passing in the sandbox, and a sandbox mode that actually isolates the code.
import { parseSkill, validateInput, matches, renderOutput, codeHash } from './skill-format.js';
import { runTool, probeSandbox } from './skill-sandbox.js';
import { openSkillStore, listSkills, getSkill, putSkill, removeSkill, STATUS } from './skill-store.js';
import { toolCallText } from './learning-data.js';
import { parseToolCall } from './skill-registry-parse.js';
export { parseToolCall };
export async function runSkillTests(parsed, { timeoutMs } = {}) {
  if (!parsed.tool) return { total: 0, passed: 0, results: [], ok: false, error: 'No tool to test' };
  const results = [];
  for (const test of parsed.tests) {
    let input; const started = performance.now();
    try { input = validateInput(parsed.tool.schema, test.input); }
    catch (e) { results.push({ name: test.name, ok: test.expectError, stage: 'input', error: e.message }); continue; }
    const run = await runTool(parsed.tool.code, input, { timeoutMs });
    if (!run.ok) { results.push({ name: test.name, ok: test.expectError, stage: 'run', error: run.error, logs: run.logs, mode: run.mode, unsupported: run.unsupported }); continue; }
    if (test.expectError) { results.push({ name: test.name, ok: false, stage: 'compare', error: 'Expected an error, got ' + JSON.stringify(run.result), actual: run.result }); continue; }
    const mismatch = matches(run.result, test.expected, test.tolerance);
    results.push({ name: test.name, ok: !mismatch, stage: 'compare', error: mismatch, actual: run.result, expected: test.expected, logs: run.logs, mode: run.mode, milliseconds: performance.now() - started });
  }
  const passed = results.filter(r => r.ok).length;
  return { total: results.length, passed, ok: passed === results.length && results.length > 0, results, mode: results.find(r => r.mode)?.mode || null };
}
class SkillRegistry extends EventTarget {
  constructor() { super(); this.db = null; this.cache = new Map(); this.ready = this.reload(); this.ready.catch(() => {}); this.sandbox = null; }
  async reload() {
    this.db ||= await openSkillStore();
    this.cache = new Map((await listSkills(this.db)).map(r => [r.name, r]));
    this.dispatchEvent(new Event('change')); return this.list();
  }
  list() { return Array.from(this.cache.values()); }
  get(name) { return this.cache.get(name) || null; }
  enabledTools() { return this.list().filter(r => r.status === STATUS.INSTALLED && r.tool).map(r => ({ skill: r.name, tool: r.tool.name, description: r.description, schema: r.tool.schema })); }
  findTool(toolName) { return this.list().find(r => r.status === STATUS.INSTALLED && r.tool?.name === toolName) || null; }
  async checkSandbox() { this.sandbox ||= await probeSandbox(); return this.sandbox; }
  // Install (or replace) a skill. `approvedCodeHash` must equal the hash of the code the owner was shown.
  async install(markdown, { filename = '', approvedCodeHash = null, timeoutMs } = {}) {
    await this.ready;
    const parsed = parseSkill(markdown, { filename });
    let report = null, hash = null;
    if (parsed.tool) {
      hash = await codeHash(parsed.tool.code);
      if (approvedCodeHash !== hash) throw Error('Code was not approved: review the tool code and approve it before installing');
      if (parsed.tool.runtime !== 'forge-js') throw Error('Unsupported runtime ' + parsed.tool.runtime);
      if (parsed.tool.permissions.length) throw Error('Skills requesting permissions cannot be installed: ' + parsed.tool.permissions.join(', '));
      const sandbox = await this.checkSandbox();
      if (!sandbox.ok) throw Error('Sandbox unavailable or not isolated in this browser; tools are not installed. ' + (sandbox.error || ''));
      if (!parsed.tests.length) throw Error('A tool skill needs a forge-tests block; untested tools are not installed');
      report = await runSkillTests(parsed, { timeoutMs });
      if (!report.ok) throw Object.assign(Error(`${report.total - report.passed} of ${report.total} tests failed; skill not installed`), { report });
    }
    const existing = this.cache.get(parsed.name), now = new Date().toISOString();
    const record = { name: parsed.name, version: parsed.version, description: parsed.description, kind: parsed.kind, source: markdown, bytes: parsed.bytes,
      tool: parsed.tool ? { name: parsed.tool.name, schema: parsed.tool.schema, outputFormat: parsed.tool.outputFormat, codeHash: hash } : null,
      instructions: parsed.instructions, examples: parsed.examples.length, toolExamples: parsed.toolExamples.length, testReport: report ? { total: report.total, passed: report.passed, mode: report.mode, at: now } : null,
      status: STATUS.INSTALLED, approvedAt: parsed.tool ? now : null, installedAt: now, replacedAt: existing ? now : null, createdAt: existing?.createdAt || now };
    await putSkill(this.db, record); this.cache.set(record.name, record); this.dispatchEvent(new Event('change'));
    return { record, report, parsed };
  }
  async setEnabled(name, enabled) {
    await this.ready; const r = this.cache.get(name); if (!r) throw Error('No such skill');
    const next = { ...r, status: enabled ? STATUS.INSTALLED : STATUS.DISABLED, updatedAt: new Date().toISOString() };
    await putSkill(this.db, next); this.cache.set(name, next); this.dispatchEvent(new Event('change')); return next;
  }
  async remove(name) { await this.ready; if (!this.cache.has(name)) throw Error('No such skill'); await removeSkill(this.db, name); this.cache.delete(name); this.dispatchEvent(new Event('change')); }
  // Training pairs that teach the model to emit the canonical call for a skill's prompts (explicit owner action).
  trainingExamples(name) {
    const r = this.cache.get(name); if (!r) throw Error('No such skill');
    const parsed = parseSkill(r.source, { filename: r.name + '.md' });
    return [...parsed.examples.map(p => ({ ...p, kind: 'pair', name: `${r.name} example`, passes: 150 })), ...parsed.toolExamples.map(p => ({ ...p, kind: 'pair', name: `${r.name} tool call`, passes: 150 }))];
  }
  // Execute an installed tool by name with validated input. Returns a structured outcome; never throws for tool failures.
  async callTool(toolName, input, { timeoutMs } = {}) {
    await this.ready;
    const skill = this.findTool(toolName);
    if (!skill) return { ok: false, tool: toolName, error: this.list().some(r => r.tool?.name === toolName) ? `Tool ${toolName} is disabled` : `No installed skill provides tool ${toolName}` };
    let clean; try { clean = validateInput(skill.tool.schema, input); } catch (e) { return { ok: false, tool: toolName, skill: skill.name, error: 'Input rejected: ' + e.message, input }; }
    const parsed = parseSkill(skill.source, { filename: skill.name + '.md' });
    if (await codeHash(parsed.tool.code) !== skill.tool.codeHash) return { ok: false, tool: toolName, skill: skill.name, error: 'Stored code no longer matches the approved hash; reinstall the skill' };
    const run = await runTool(parsed.tool.code, clean, { timeoutMs });
    if (!run.ok) return { ok: false, tool: toolName, skill: skill.name, error: run.error, logs: run.logs, mode: run.mode, input: clean, call: toolCallText(toolName, clean) };
    return { ok: true, tool: toolName, skill: skill.name, input: clean, result: run.result, rendered: renderOutput(skill.tool.outputFormat, run.result), logs: run.logs, mode: run.mode, milliseconds: run.milliseconds, call: toolCallText(toolName, clean) };
  }
}
export const skillRegistry = new SkillRegistry();
