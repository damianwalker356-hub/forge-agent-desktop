// IndexedDB persistence for owner-built models. Every write is a revision-checked transaction:
// success is only reported after the transaction commits, and a stale tab cannot overwrite a newer revision.
const DB = 'forge-owned-learning-v1';
export function validId(id) { if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw Error('Model ID: 1–64 letters, digits, underscores or hyphens'); return id; }
export async function openStore() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('models', { keyPath: 'modelId' });
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    request.onblocked = () => reject(Error('Model storage is blocked by another open tab'));
  });
}
export function readModel(db, id) {
  validId(id); return new Promise((resolve, reject) => {
    const tx = db.transaction('models', 'readonly'), request = tx.objectStore('models').get(id);
    let value; request.onsuccess = () => { value = request.result || null; };
    tx.oncomplete = () => resolve(value); tx.onerror = tx.onabort = () => reject(tx.error || Error('Storage read failed'));
  });
}
// Summaries only (no weights), for the Model builder list.
export function listModels(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('models', 'readonly'), request = tx.objectStore('models').getAll();
    let rows = [];
    request.onsuccess = () => { rows = (request.result || []).map(r => ({ modelId: r.modelId, H: r.checkpoint?.H, parameterCount: r.checkpoint?.H ? 2 * 256 * r.checkpoint.H + r.checkpoint.H * r.checkpoint.H + r.checkpoint.H + 256 : 0, steps: r.checkpoint?.steps, revision: r.revision, createdAt: r.createdAt, updatedAt: r.updatedAt, examples: r.jobs?.length || 0, rulesBytes: r.rules ? new TextEncoder().encode(r.rules).length : 0 })); };
    tx.oncomplete = () => resolve(rows); tx.onerror = tx.onabort = () => reject(tx.error || Error('Storage list failed'));
  });
}
export function deleteModel(db, id, expectedRevision) {
  validId(id); return new Promise((resolve, reject) => {
    const tx = db.transaction('models', 'readwrite'), store = tx.objectStore('models');
    let conflict = false, missing = false;
    const request = store.get(id);
    request.onsuccess = () => {
      if (!request.result) { missing = true; tx.abort(); return; }
      if (request.result.revision !== expectedRevision) { conflict = true; tx.abort(); return; }
      store.delete(id);
    };
    tx.oncomplete = () => resolve(true);
    tx.onerror = tx.onabort = () => reject(missing ? Error('No such model') : conflict ? Error('This model changed in another tab. Reload before deleting.') : tx.error || Error('Delete transaction failed'));
  });
}
export function commitModel(db, record, expectedRevision) {
  validId(record.modelId); return new Promise((resolve, reject) => {
    const tx = db.transaction('models', 'readwrite'), store = tx.objectStore('models');
    let conflict = false;
    const request = store.get(record.modelId);
    request.onsuccess = () => {
      if ((request.result?.revision ?? -1) !== expectedRevision) { conflict = true; tx.abort(); return; }
      store.put({ ...record, revision: expectedRevision + 1 });
    };
    tx.oncomplete = () => resolve(expectedRevision + 1);
    tx.onerror = tx.onabort = () => reject(conflict ? Error('This model changed in another tab. Reload before continuing; no overwrite performed.') : tx.error || Error('Checkpoint transaction failed'));
  });
}
