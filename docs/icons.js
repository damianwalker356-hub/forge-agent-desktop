// Inline SVG icon set (stroke icons, 24-unit grid) and a helper that builds a labelled icon button.
// Every icon button carries a visible text label; icons are decorative (aria-hidden).
const P = {
  chat: '<path d="M4 5h16v11H8l-4 4z"/>',
  forge: '<path d="M8 7l-5 5 5 5M16 7l5 5-5 5M13 4l-2 16"/>',
  train: '<path d="M12 3L2 8l10 5 10-5-10-5z"/><path d="M6 10v5c0 2 3 4 6 4s6-2 6-4v-5"/><path d="M22 8v6"/>',
  skills: '<path d="M10 3h4v3a2 2 0 1 0 4 0v0h3v4h-3a2 2 0 1 0 0 4h3v4h-4v-3a2 2 0 1 0-4 0v3H6v-4a2 2 0 1 0 0-4V3h4z"/>',
  tutorial: '<path d="M4 4h7a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4zM20 4h-7a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h7z"/>',
  send: '<path d="M3 11l18-8-8 18-2-8z"/>',
  upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 20h16"/>',
  memory: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7M12 17h.01"/>',
  run: '<path d="M7 4l13 8-13 8z"/>',
  download: '<path d="M12 4v12m-5-5 5 5 5-5M4 20h16"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
  check: '<path d="M4 12l5 5L20 7"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  resume: '<path d="M7 4l13 8-13 8z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  teach: '<path d="M4 20h4l11-11-4-4L4 16z"/><path d="M13 7l4 4"/>',
  ask: '<path d="M4 5h16v11h-7l-5 4v-4H4z"/><path d="M10 9.5a2 2 0 1 1 2.8 1.8c-.5.3-.8.7-.8 1.2M12 14h.01"/>',
  correct: '<path d="M3 12l4 4L17 6"/><path d="M21 12v7H3v-3"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  gauge: '<path d="M4 15a8 8 0 1 1 16 0"/><path d="M12 15l4-5"/><path d="M3 19h18"/>',
  folder: '<path d="M3 6h6l2 2h10v11H3z"/>',
  book: '<path d="M4 4h12a3 3 0 0 1 3 3v13H7a3 3 0 0 0-3 3z"/><path d="M4 17h15"/>',
  wrench: '<path d="M14.5 6.5a4 4 0 0 0 5 5L10 21l-3-3 9.5-9.5z"/><path d="M14.5 6.5L17 4l3 3-2.5 2.5"/>',
  import: '<path d="M12 4v12m-5-5 5 5 5-5"/><path d="M4 20h16"/>',
  export: '<path d="M12 16V4m-5 5 5-5 5 5"/><path d="M4 20h16"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
};
export function icon(name, size = 20) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size);
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.8');
  s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = P[name] || P.help; s.classList.add('ico');
  return s;
}
// iconButton('run', 'Run', { id, class, onclick, type, title, value }) -> <button><svg/><span>Run</span></button>
export function iconButton(name, label, attrs = {}) {
  const b = document.createElement('button');
  b.type = attrs.type || 'button';
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'type' || v === undefined || v === null || v === false) continue;
    if (k === 'class') b.className = 'ib ' + v; else if (k === 'onclick') b.addEventListener('click', v); else if (v === true) b.setAttribute(k, ''); else b.setAttribute(k, v);
  }
  if (!attrs.class) b.className = 'ib';
  const span = document.createElement('span'); span.textContent = label;
  b.append(icon(name), span);
  return b;
}
// Decorate the shell navigation: each nav button gets its icon above the label.
export function decorateNav() {
  for (const b of document.querySelectorAll('nav [data-page]')) {
    const label = b.textContent.trim(); b.textContent = '';
    const span = document.createElement('span'); span.textContent = label;
    b.append(icon(b.dataset.page, 22), span);
  }
}
