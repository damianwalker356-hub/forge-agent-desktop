import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { RNN, KEYS, encoder, parameterCount } from '../docs/rnn-core.js';
import { makeJob, nextWindow, advance, markdownExamples, describeFeedback, toolCallText } from '../docs/learning-data.js';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
test('full model has exactly 1,050,656 parameters', () => assert.equal(new RNN().parameterCount,1050656));
test('optimizer changes actual weights and fingerprints',async()=>{
 const n=new RNN({H:8}),a=encoder.encode('9+9=18'),before=await n.fingerprint(),r=n.train(a);
 assert.ok(r.changedParameters>0);assert.ok(r.deltaL2>0);assert.equal(n.steps,1);assert.notEqual(await n.fingerprint(),before);assert.ok(r.lossAfter<r.lossBefore);
});
test('finite-difference gradient checks for every parameter family',()=>{
 const n=new RNN({H:8}),a=encoder.encode('9+9'),saved=n.checkpoint();n.train(a);const gradients=Object.fromEntries(KEYS.map(k=>[k,n.grad[k].slice()]));const m=RNN.restore(saved),eps=.001;
 for(const k of KEYS){const ix=k==='E'?a[0]*m.H:0;const x=m[k][ix];m[k][ix]=x+eps;const plus=m.loss(a);m[k][ix]=x-eps;const minus=m.loss(a);m[k][ix]=x;assert.ok(Math.abs((plus-minus)/(2*eps)-gradients[k][ix])<.001,k);}
});
test('response-only training learns an actual answer without a lookup fallback',()=>{
 const n=new RNN({H:24}),job=makeJob({id:'pair',kind:'pair',prompt:'What is 9+9?',response:'18',passes:1}),w=nextWindow(job),before=n.loss(w.tokens,null,n.warm(w.warm));
 for(let i=0;i<600;i++)n.train(w.tokens,{initial:n.warm(w.warm),learningRate:.1});
 assert.ok(n.loss(w.tokens,null,n.warm(w.warm))<before/10);assert.equal(n.generate('What is 9+9?',10),'18');
});
test('every source byte target covered each pass, including tail and short input',()=>{
 for(const text of ['a','9+9=18','0123456789'.repeat(10)]){
 const j=makeJob({id:'a',text,passes:3}),coverage=Array(j.tokens.length).fill(0);while(j.status!=='trained'){const w=nextWindow(j);for(let k=j.cursor;k<w.end;k++)coverage[k]++;advance(j,w);}assert.deepEqual(coverage.slice(1),Array(j.tokens.length-1).fill(3));assert.equal(j.pass,3);
 }
});
test('pair windows target only answer and EOS, preserving prompt as context',()=>{const j=makeJob({id:'a',kind:'pair',prompt:'Question',response:'18'}),w=nextWindow(j);assert.equal(new TextDecoder().decode(w.tokens.slice(1)),'18\x03');assert.match(new TextDecoder().decode(w.warm),/Question/);});
test('Markdown preserves code and extracts explicit example pairs without evaluation',()=>{const md='# Skill\n```js\nthrow Error("never execute")\n```\n```forge-example\n{"prompt":"9+9?","response":"18"}\n```\n';assert.deepEqual(markdownExamples(md),[{prompt:'9+9?',response:'18'}]);const job=makeJob({id:'s',text:md});assert.match(new TextDecoder().decode(job.tokens),/throw Error/);});
test('invalid example blocks rejected rather than silently ignored',()=>assert.throws(()=>markdownExamples('```forge-example\nnot json\n```'),/Invalid JSON/));
test('negative feedback is not a positive answer label',()=>{assert.ok(describeFeedback('False'));assert.ok(describeFeedback('Wrong.'));assert.ok(!describeFeedback('18'));});
test('checkpoint restores exact weights and steps',async()=>{const n=new RNN({H:8});n.train(encoder.encode('example'));const m=RNN.restore(JSON.parse(JSON.stringify(n.checkpoint({json:true}))));assert.equal(m.steps,n.steps);assert.equal(await m.fingerprint(),await n.fingerprint());});
test('reject float32-overflowing checkpoint without accepting infinity',()=>{const n=new RNN({H:8}),c=n.checkpoint({json:true});c.E[0]=1e100;assert.throws(()=>RNN.restore(c),/Non-finite/);});
test('generation cannot change weights or update counter',async()=>{const n=new RNN({H:8}),before=await n.fingerprint();n.generate('9+9',4);assert.equal(n.steps,0);assert.equal(await n.fingerprint(),before);});
test('empty owner instruction is not default-populated by training data module',()=>{assert.deepEqual(markdownExamples('# My skill'),[]);assert.throws(()=>makeJob({id:'blank',text:''}),/Empty/);});
test('configurable hidden size and exact parameter formula',()=>{for(const H of [8,64,200,1024]){const n=new RNN({H});assert.equal(n.parameterCount,parameterCount(H));assert.equal(n.parameterCount,2*256*H+H*H+H+256);}assert.throws(()=>new RNN({H:7}),/hidden size/);assert.throws(()=>new RNN({H:1025}),/hidden size/);assert.throws(()=>new RNN({H:10.5}),/hidden size/);});
test('different seeds give different initial weights; same seed is reproducible',async()=>{const a=await new RNN({H:8,seed:1}).fingerprint(),b=await new RNN({H:8,seed:2}).fingerprint(),c=await new RNN({H:8,seed:1}).fingerprint();assert.notEqual(a,b);assert.equal(a,c);});
test('rules state conditions generation without changing weights',async()=>{const n=new RNN({H:16}),before=await n.fingerprint(),rules=n.warm(encoder.encode('Always answer in metres.\n'));const withRules=n.generate('How long?',6,{initial:rules}),without=n.generate('How long?',6);assert.equal(typeof withRules,'string');assert.equal(await n.fingerprint(),before);assert.ok(rules.length===16);void without;});
test('pair training with a rules state reproduces the answer under the same rules',()=>{const n=new RNN({H:24}),rules=n.warm(encoder.encode('# Rules\nAnswer tersely.\n')),job=makeJob({id:'p',kind:'pair',prompt:'Bore unit?',response:'mm',passes:1}),w=nextWindow(job);for(let i=0;i<500;i++)n.train(w.tokens,{initial:n.warm(w.warm,rules),learningRate:.1});assert.equal(n.generate('Bore unit?',8,{initial:rules}),'mm');});
test('tool call text is canonical JSON after the tool tag',()=>assert.equal(toolCallText('engine_displacement',{bore_mm:86,cylinders:4}),'[tool:engine_displacement] {"bore_mm":86,"cylinders":4}'));
