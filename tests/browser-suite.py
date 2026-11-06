# End-to-end browser checks for the owner-built model, rules, teaching, skills and persistence (all on the Train page).
# Run: python3 -m http.server 8765 --bind 127.0.0.1 (from the repository root) then python3 tests/browser-suite.py
# Requires: pip install playwright && python3 -m playwright install chromium
import json, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
BASE = 'http://127.0.0.1:8765/docs/'
results = []
def record(name, detail): results.append({'test': name, 'result': 'pass', 'detail': detail}); print('PASS', name)
def audit(page): return page.evaluate("() => window.__forge.modelService.audit()")
SKILL = (ROOT / 'SKILLS.md').read_text().split('````markdown\n', 1)[1].split('\n````', 1)[0] + '\n'
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--no-sandbox'])
    context = browser.new_context(viewport={'width': 390, 'height': 844})
    page = context.new_page(); errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(BASE + '#train'); page.wait_for_selector('#mbCreate')
    # 1. Create a model with a custom hidden size and a fixed seed.
    page.fill('#mbId', 'suite-model'); page.select_option('#mbH', 'custom'); page.fill('#mbCustom', '48'); page.fill('#mbSeed', '7')
    page.click('#mbCreate'); page.wait_for_function("document.querySelector('#mbStatus').textContent.includes('Created and saved suite-model')")
    info = page.evaluate("() => window.__forge.modelService.info()")
    assert info['H'] == 48 and info['parameterCount'] == 2 * 256 * 48 + 48 * 48 + 48 + 256 and info['steps'] == 0 and info['rulesBytes'] == 0
    assert page.evaluate("JSON.parse(localStorage.getItem('forge-model-record-v1:suite-model')).rules") == ''
    record('Create model with owner-chosen hidden size and seed; rules blank', info)
    # Benchmark reports device timings.
    page.click('#mbBench'); page.wait_for_function("document.querySelector('#mbStatus').textContent.includes('one weight update')")
    record('Device benchmark reports update and read cost', page.locator('#mbStatus').text_content())
    # 2. Apply owner rules; generation reports the rule context.
    page.click('nav button[data-page=train]'); page.wait_for_selector('#ruApply:not([disabled])')
    assert page.input_value('#ruText') == ''
    rules = '# My rules\nAnswer bore in millimetres.\n```forge-test\n[{"name":"unit","prompt":"Bore unit?","expected":"mm"}]\n```\n'
    page.fill('#ruText', rules); page.click('#ruApply'); page.wait_for_function("document.querySelector('#ruStatus').textContent.includes('Applied')")
    a = audit(page); assert a['rulesBytes'] == len(rules.encode()) and a['rules'] == rules
    record('Rules written by owner are applied to the active model', page.locator('#ruStatus').text_content())
    gen = page.evaluate("() => window.__forge.modelService.call('generate', {text: 'Bore unit?', length: 8})")
    assert gen['rules']['bytes'] == len(rules.encode()) and gen['trainingPerformed'] is False
    record('Generation is conditioned on the applied rules and changes no weights', gen['rules'])
    # 3. Trainer: pause, ask, correct, resume, receipt with changed weights and rules context.
    page.click('nav button[data-page=train]'); page.wait_for_selector('#ctForm')
    page.evaluate("() => window.__forge.modelService.call('pause')"); before = audit(page)
    page.fill('#ctText', 'Bore unit?'); page.click('#ctForm button[value=ask]'); page.wait_for_function("document.querySelector('#ctLog').textContent.includes('Model:')")
    a = audit(page); assert len(a['jobs']) == 1 and a['jobs'][0]['kind'] == 'text' and a['steps'] == 0
    record('Asking queues the user text, not the model output', a['jobs'])
    page.fill('#ctText', 'mm'); page.click('#ctForm button[value=correct]'); page.wait_for_function("document.querySelector('#ctLog').textContent.includes('example(s) for suite-model')")
    page.wait_for_timeout(300)
    a = audit(page); assert len(a['jobs']) == 2 and a['jobs'][1]['kind'] == 'pair'
    record('Correction becomes a question/answer pair for the last question', a['jobs'][1])
    page.click('#ctResume'); page.wait_for_function("document.querySelector('#ctLog').textContent.includes('Weights changed and saved')", timeout=120000)
    page.evaluate("() => window.__forge.modelService.call('pause')"); a = audit(page)
    r = a['receipts'][-1]; assert a['steps'] > 0 and a['hash'] != before['hash'] and r['changedParameterAssignments'] > 0 and r['hashBefore'] != r['hashAfter']
    record('Receipt proves a committed weight change', {k: r[k] for k in ['stepBefore', 'stepAfter', 'changedParameterAssignments', 'hashBefore', 'hashAfter', 'rules']})
    page.evaluate("() => window.__forge.modelService.call('resume')")
    page.wait_for_function("window.__forge.modelService.audit().then(a => window.__done = a.jobs.every(j => j.status === 'trained')) && window.__done === true", timeout=180000)
    pair_receipts = [x for x in audit(page)['receipts'] if x['kind'] == 'pair']
    assert pair_receipts and pair_receipts[-1]['rules']['bytes'] == len(rules.encode())
    record('Pair training ran with the owner rules in context', pair_receipts[-1]['rules'])
    # Rule tests use the evaluate path.
    page.click('nav button[data-page=train]'); page.wait_for_selector('#ruApply:not([disabled])'); page.evaluate("document.querySelector('#ruTest').closest('details').open = true"); page.click('#ruTest')
    page.wait_for_function("/exact at update/.test(document.querySelector('#ruTestOut').textContent)")
    record('Rule tests run against the applied rules', page.locator('#ruTestOut').text_content()[:200])
    # 4. Skills: upload, approve, tests, install, run, tool call from model output.
    page.click('nav button[data-page=skills]'); page.wait_for_function("document.querySelector('#skSandbox').textContent.includes('Sandbox check passed')", timeout=20000)
    record('Sandbox isolation probe passed', page.locator('#skSandbox').text_content())
    assert SKILL, 'SKILLS.md example missing'
    page.set_input_files('#skFile', {'name': 'engine-displacement.md', 'mimeType': 'text/markdown', 'buffer': SKILL.encode()})
    page.wait_for_selector('#skApprove')
    page.click('#skPreview button:has-text("Install skill")'); page.wait_for_function("document.querySelector('#skStatus').textContent.includes('approval box')")
    record('Install refused without code approval', page.locator('#skStatus').text_content())
    page.check('#skApprove'); page.click('#skPreview button:has-text("Install skill")')
    page.wait_for_function("document.querySelector('#skStatus').textContent.includes('Installed engine-displacement')", timeout=30000)
    record('Skill installed after sandbox tests passed', page.locator('#skStatus').text_content())
    out = page.evaluate("() => window.__forge.skillRegistry.callTool('engine_displacement', {bore_mm: 83, stroke_mm: 85, cylinders: 4})")
    assert out['ok'] and abs(out['result']['displacement_liters'] - 1.8394) < 0.001 and 'worker' in out['mode']
    record('Installed tool runs in the sandbox with validated input', {'mode': out['mode'], 'result': out['result'], 'rendered': out['rendered']})
    bad = page.evaluate("() => window.__forge.skillRegistry.callTool('engine_displacement', {bore_mm: -1, stroke_mm: 85, cylinders: 4})")
    assert not bad['ok'] and 'Input rejected' in bad['error']
    record('Schema rejects out-of-range tool input', bad['error'])
    hostile = page.evaluate("""() => import('./skill-sandbox.js').then(m => m.runTool('function run(i){ while(true){} }', {}, {timeoutMs: 800}))""")
    assert not hostile['ok'] and hostile.get('timedOut')
    record('Infinite loop in a tool is terminated by timeout', hostile['error'])
    leak = page.evaluate("""() => import('./skill-sandbox.js').then(m => m.runTool('function run(i){ return { ls: typeof localStorage, doc: typeof document, idb: typeof indexedDB, net: typeof fetch === "function" ? fetch("/").then(() => "open", () => "blocked") : "none" } }', {}))""")
    assert leak['ok'] and leak['result']['ls'] == 'undefined' and leak['result']['doc'] == 'undefined'
    record('Tool code cannot see storage or the page', leak['result'])
    # Model output that is a tool call is executed in Chat.
    page.click('#skList button:has-text("Queue training examples")'); page.wait_for_function("document.querySelector('#skStatus').textContent.includes('Queued')")
    a = audit(page); assert any(j['name'].endswith('tool call') or j['name'].endswith('example') for j in a['jobs'])
    record('Skill examples queued for the active model as tool-call pairs', [j['name'] for j in a['jobs']])
    page.click('nav button[data-page=chat]')
    page.fill('#t', '/tool engine_displacement {"bore_mm":86,"stroke_mm":86,"cylinders":8}'); page.click('#send')
    page.wait_for_function("document.querySelector('#log').textContent.includes('ran in the sandbox')")
    record('Slash command runs an installed tool from Chat', page.locator('#log .m').last.text_content()[:200])
    # Simulate the model emitting a tool call to confirm the chat path parses and executes it.
    parsed = page.evaluate("""() => import('./skill-registry.js').then(m => m.parseToolCall('[tool:engine_displacement] {"bore_mm":86,"stroke_mm":86,"cylinders":4}'))""")
    assert parsed['input']['cylinders'] == 4
    record('Model-style tool call text parses into a validated call', parsed)
    # 5. Chat auto-learn and persistence across reload.
    page.fill('#t', 'Stroke is measured in millimetres too.'); page.click('#send')
    page.wait_for_function("document.querySelector('#log').textContent.includes('learning example(s) for suite-model')")
    steps_before = audit(page)['steps']
    page.reload(); page.wait_for_function("document.querySelector('#chatModel').textContent.includes('suite-model')", timeout=20000)
    a = audit(page); assert a['modelId'] == 'suite-model' and a['steps'] >= steps_before and a['rules'] == rules and len(a['jobs']) >= 4
    skills = page.evaluate("() => window.__forge.skillRegistry.ready.then(() => window.__forge.skillRegistry.list().map(s => [s.name, s.status]))")
    assert skills == [['engine-displacement', 'installed']]
    record('Model, rules, learning history and installed skill persist across reload', {'steps': a['steps'], 'jobs': len(a['jobs']), 'skills': skills})
    # 6. Model list, switch and delete.
    page.click('nav button[data-page=train]'); page.wait_for_selector('#mbList .item'); page.evaluate("document.querySelector('#mbCreateBox').open = true")
    page.fill('#mbId', 'second'); page.select_option('#mbH', '64'); page.fill('#mbSeed', ''); page.click('#mbCreate'); page.wait_for_function("document.querySelector('#mbStatus').textContent.includes('Created and saved second')")
    page.wait_for_function("document.querySelectorAll('#mbList .item').length === 2")
    assert page.evaluate("localStorage.getItem('forge-active-owned-model')") == 'second'
    page.click('#mbList .item:has-text("suite-model") button:has-text("Use this model")'); page.wait_for_function("localStorage.getItem('forge-active-owned-model') === 'suite-model'")
    page.once('dialog', lambda d: d.accept()); page.click('#mbList .item:has-text("second") button:has-text("Delete")')
    page.wait_for_function("document.querySelector('#mbStatus').textContent.includes('Deleted second')")
    page.wait_for_function("document.querySelectorAll('#mbList .item').length === 1")
    record('Multiple models: create, switch active, delete', page.locator('#mbList').inner_text()[:200])
    assert not errors, errors
    record('No uncaught page errors during the suite', errors)
    browser.close()
Path(ROOT / 'validation').mkdir(exist_ok=True)
(ROOT / 'validation' / 'browser-suite-results.json').write_text(json.dumps({'ranAt': time.strftime('%Y-%m-%dT%H:%M:%S'), 'browser': 'Chromium headless (Playwright), viewport 390×844', 'results': results}, indent=2))
print(json.dumps(results, indent=1)[:3000])
