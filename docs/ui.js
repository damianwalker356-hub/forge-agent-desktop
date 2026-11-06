// Shell: page navigation and the chat composer (attachments are held until Send).
import { $, setStatus, readTextFiles } from './page-utils.js';
import { decorateNav, iconButton, icon } from './icons.js';
export const PAGES = ['chat', 'forge', 'train', 'skills', 'tutorial'];
// Older links and bookmarks used separate Models / Trainer / Rules pages; they are one Train page now.
const LEGACY = { models: 'train', trainer: 'train', rules: 'train' };
const input = $('t'), form = $('f');
let attachments = [], reading = false;
export function showPage(page) {
  page = LEGACY[page] || page;
  if (!PAGES.includes(page)) page = 'chat';
  for (const section of document.querySelectorAll('main>section')) section.hidden = section.dataset.screen !== page;
  for (const b of document.querySelectorAll('[data-page]')) { if (b.dataset.page === page) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }
  if (location.hash !== '#' + page) history.replaceState(null, '', '#' + page);
  window.scrollTo(0, 0);
  document.dispatchEvent(new CustomEvent('forge:page', { detail: { page } }));
}
decorateNav();
for (const b of document.querySelectorAll('[data-page]')) b.onclick = () => showPage(b.dataset.page);
// Composer buttons get their icons; the send button only appears once there is something to send.
$('upload').replaceChildren(icon('upload'), Object.assign(document.createElement('span'), { textContent: 'Upload' })); $('upload').className = 'ib';
$('send').replaceChildren(icon('send'), Object.assign(document.createElement('span'), { textContent: 'Send' })); $('send').className = 'ib primary';
$('chatTools').append(iconButton('memory', 'Memory', { id: 'mem', class: 'quiet', title: 'Show what the agent remembers' }), iconButton('help', 'Help', { id: 'help', class: 'quiet', title: 'Show chat commands' }), iconButton('train', 'Train your model', { class: 'quiet', onclick: () => showPage('train') }));
window.addEventListener('hashchange', () => showPage(location.hash.slice(1)));
function refresh() {
  input.placeholder = attachments.length ? '' : 'Ask your model, or paste text to teach it';
  form.classList.toggle('has-content', Boolean(input.value.trim() || attachments.length));
  const list = $('attachmentList'); list.replaceChildren();
  attachments.forEach((a, i) => {
    const chip = document.createElement('span'); chip.className = 'attachment'; chip.append(document.createTextNode(a.name));
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove'; remove.setAttribute('aria-label', 'Remove ' + a.name);
    remove.onclick = () => { attachments.splice(i, 1); refresh(); }; chip.append(remove); list.append(chip);
  });
}
input.addEventListener('input', refresh);
$('upload').onclick = () => $('chatFiles').click();
$('chatFiles').onchange = async e => {
  if (reading) return; reading = true; $('upload').disabled = true;
  try {
    const next = await readTextFiles(e.target.files, { maxFiles: 3, maxTotalBytes: 8192 });
    attachments = next; setStatus($('attachmentStatus'), next.length ? `${next.length} file(s) attached. They are sent to your model with the next message and queued as learning material when automatic learning is on. Uploading code never executes it.` : '', 'regular');
  } catch (x) { setStatus($('attachmentStatus'), x.message, 'error'); }
  finally { reading = false; $('upload').disabled = false; e.target.value = ''; refresh(); }
};
// Returns { message, files } or null when there is nothing to send.
export function takeSubmission(text) {
  const message = text.trim();
  if (reading) { setStatus($('attachmentStatus'), 'Wait for file reading to finish.', 'caution'); return null; }
  if (!message && !attachments.length) return null;
  if (attachments.length && message.startsWith('/')) { setStatus($('attachmentStatus'), 'Remove attachments before running a slash command.', 'error'); return null; }
  const files = attachments; attachments = []; setStatus($('attachmentStatus'), '', 'regular'); refresh();
  return { message, files };
}
showPage(location.hash.slice(1)); refresh();
