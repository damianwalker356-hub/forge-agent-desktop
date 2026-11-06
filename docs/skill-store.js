// Installed skills live in their own IndexedDB database, separate from model weights. A skill record is the
// Markdown source plus the owner's approval and the test report that justified installing it.
const DB = 'forge-skills-v1', STORE = 'skills';
export const STATUS = { INSTALLED: 'installed', DISABLED: 'disabled' };
export function openSkillStore() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'name' }); };
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error || Error('Skill store failed to open'));
  });
}
function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode), store = t.objectStore(STORE); let out;
    t.oncomplete = () => resolve(out); t.onerror = () => reject(t.error || Error('Skill store transaction failed')); t.onabort = () => reject(t.error || Error('Skill store transaction aborted'));
    const r = fn(store); if (r) r.onsuccess = () => { out = r.result; };
  });
}
export const listSkills = db => tx(db, 'readonly', s => s.getAll()).then(rows => (rows || []).sort((a, b) => a.name.localeCompare(b.name)));
export const getSkill = (db, name) => tx(db, 'readonly', s => s.get(name)).then(r => r || null);
export const putSkill = (db, record) => tx(db, 'readwrite', s => s.put(record));
export const removeSkill = (db, name) => tx(db, 'readwrite', s => s.delete(name));
