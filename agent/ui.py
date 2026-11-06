PAGE = r"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Forge Agent</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}
body{margin:0;background:#0f1115;color:#e6e8ee;font:16px/1.45 -apple-system,system-ui,sans-serif;display:flex;flex-direction:column;height:100dvh}
header{padding:10px 14px;border-bottom:1px solid #232733;display:flex;gap:8px;align-items:center}
header b{flex:1}button{background:#2a3350;color:#e6e8ee;border:0;border-radius:8px;padding:9px 13px;font-size:15px}
#log{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:10px}
.m{max-width:92%;padding:9px 12px;border-radius:12px;white-space:pre-wrap;word-wrap:break-word}
.u{align-self:flex-end;background:#2a3350}.a{align-self:flex-start;background:#1b1f2b}.s{align-self:center;color:#8b93a7;font-size:13px}
form{display:flex;gap:8px;padding:10px 12px calc(10px + env(safe-area-inset-bottom));border-top:1px solid #232733}
textarea{flex:1;background:#1b1f2b;color:#e6e8ee;border:1px solid #2c3347;border-radius:10px;padding:10px;font:inherit;resize:none;height:46px}
</style></head><body>
<header><b>Forge Agent</b><button id="mem">Memory</button><button id="tok">Token</button></header>
<div id="log"></div>
<form id="f"><textarea id="t" placeholder="Message, or /help"></textarea><button>Send</button></form>
<script>
const log=document.getElementById('log'),t=document.getElementById('t');
let token=localStorage.getItem('forge_token')||'';
const session=localStorage.getItem('forge_session')||(crypto.randomUUID?crypto.randomUUID():String(Date.now()));
localStorage.setItem('forge_session',session);
function add(cls,txt){const d=document.createElement('div');d.className='m '+cls;d.textContent=txt;log.appendChild(d);log.scrollTop=log.scrollHeight;return d}
async function api(path,body){const r=await fetch(path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:body?JSON.stringify(body):undefined});
 if(r.status===401){add('s','Unauthorized. Tap Token and enter your access token.');throw 0}return r.json()}
document.getElementById('tok').onclick=()=>{const v=prompt('Access token',token);if(v!==null){token=v.trim();localStorage.setItem('forge_token',token)}};
document.getElementById('mem').onclick=async()=>{try{const j=await api('/api/chat',{session,message:'/memory'});add('s',j.answer)}catch(e){}};
document.getElementById('f').onsubmit=async e=>{e.preventDefault();const m=t.value.trim();if(!m)return;t.value='';add('u',m);const w=add('s','thinking...');
 try{const j=await api('/api/chat',{session,message:m});w.className='m a';w.textContent=j.answer;if(j.trace&&j.trace.some(x=>x.startsWith('tool:')))add('s','tools: '+j.trace.filter(x=>x.startsWith('tool:')).join(', '))}catch(x){if(x!==0)w.textContent='Request failed.'}};
t.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&innerWidth>700){e.preventDefault();document.getElementById('f').requestSubmit()}});
add('s','Forge Agent ready. Type /help for memory commands.');
</script></body></html>"""
