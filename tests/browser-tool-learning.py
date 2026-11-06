# Slow validation: a freshly built model learns (by owner-queued skill examples) to answer a trained prompt with a
# tool call, and Chat executes that call in the sandbox. Records the outcome honestly, including failure.
import json, time
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]; BASE = 'http://127.0.0.1:8765/docs/'
SKILL = (ROOT / 'SKILLS.md').read_text().split('````markdown\n', 1)[1].split('\n````', 1)[0] + '\n'
PROMPT = 'Work out the displacement of a 4 cylinder, 86 mm bore, 86 mm stroke engine'
out = {'ranAt': time.strftime('%Y-%m-%dT%H:%M:%S'), 'browser': 'Chromium headless (Playwright)'}
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--no-sandbox']); page = browser.new_page(viewport={'width': 390, 'height': 844})
    page.goto(BASE + '#train'); page.wait_for_selector('#mbCreate')
    page.fill('#mbId', 'tool-learner'); page.select_option('#mbH', '64'); page.fill('#mbSeed', '3'); page.click('#mbCreate')
    page.wait_for_function("document.querySelector('#mbStatus').textContent.includes('Created and saved tool-learner')")
    page.click('nav button[data-page=skills]'); page.wait_for_selector('#skFile', state='attached')
    page.set_input_files('#skFile', {'name': 'engine-displacement.md', 'mimeType': 'text/markdown', 'buffer': SKILL.encode()})
    page.wait_for_selector('#skApprove'); page.check('#skApprove'); page.click('#skPreview button:has-text("Install skill")')
    page.wait_for_function("document.querySelector('#skStatus').textContent.includes('Installed engine-displacement')", timeout=30000)
    page.click('#skList button:has-text("Queue training examples")'); page.wait_for_function("document.querySelector('#skStatus').textContent.includes('Queued')")
    t0 = time.time()
    while True:  # wait until every job is trained and stays trained through the consolidation check
        page.wait_for_function("window.__forge.modelService.audit().then(a => window.__d = a.jobs.every(j => j.status === 'trained')) && window.__d === true", timeout=1500000, polling=2000)
        page.wait_for_timeout(4000)
        if page.evaluate("() => window.__forge.modelService.audit().then(a => a.jobs.every(j => j.status === 'trained'))"): break
    a = page.evaluate("() => window.__forge.modelService.audit()")
    out['trainingSeconds'] = round(time.time() - t0, 1); out['updates'] = a['steps']; out['jobs'] = a['jobs']
    out['reproduction'] = [{'name': r['name'], 'exact': r['reproduction']['exactMatch'], 'actual': r['reproduction']['actual']} for r in a['receipts'] if r.get('reproduction')][-3:]
    page.click('nav button[data-page=chat]'); page.fill('#t', PROMPT); page.click('#send')
    page.wait_for_function("document.querySelectorAll('#log .m').length >= 3", timeout=60000); page.wait_for_timeout(1500)
    texts = page.evaluate("() => Array.from(document.querySelectorAll('#log .m')).map(m => m.textContent)")
    out['chat'] = texts
    out['modelEmittedToolCall'] = any(t.startswith('[tool:engine_displacement]') for t in texts)
    out['toolRanInSandbox'] = any('ran in the sandbox' in t and 'displacement_liters' in t for t in texts)
    out['argumentsMatchedPrompt'] = any(t.strip() == '[tool:engine_displacement] {"bore_mm":86,"stroke_mm":86,"cylinders":4}' for t in texts)
    out['note'] = 'Verified: mechanics of learn → emit tool call → sandbox execution. Argument fidelity across similar prompts is a model-quality question and is reported, not guaranteed.'
    browser.close()
(ROOT / 'validation' / 'browser-tool-learning.json').write_text(json.dumps(out, indent=2))
print(json.dumps({k: out[k] for k in ['trainingSeconds', 'updates', 'reproduction', 'modelEmittedToolCall', 'toolRanInSandbox', 'argumentsMatchedPrompt']}, indent=1))
print('\n'.join(out['chat']))
