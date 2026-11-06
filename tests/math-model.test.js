import test from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{parse,predict,cases,evaluate,train}from'../docs/math-core.js';
const model=JSON.parse(readFileSync(new URL('../docs/math-checkpoint.json',import.meta.url)));
test('held-out accuracy is independently recomputed',()=>{const d=cases(model);assert.equal(d.train.length,1600);assert.equal(d.test.length,400);assert.equal(evaluate(model,d.test).exactMatches,400);});
test('whole supported domain passes after rounding',()=>{const d=[];for(let op=0;op<2;op++)for(let a=0;a<100;a++)for(let b=0;b<100;b++)d.push({op,a,b});assert.equal(evaluate(model,d).exactMatches,20000);});
test('accepted natural and symbolic formats',()=>{assert.equal(predict(model,'What is 17 plus 25?').answer,42);assert.equal(predict(model,'9 minus 14').answer,-5);assert.equal(predict(model,'99+99').answer,198);});
test('unsupported requests never fall back to a calculator',()=>{for(const s of ['100+2','3*4','explain calculus','2+3+4','-2+3','2.5+3'])assert.throws(()=>parse(s));});
test('inference actually depends on learned weights',()=>{const zero=JSON.parse(JSON.stringify(model));zero.weights=[[0,0,0],[0,0,0]];assert.equal(predict(zero,'17+25').answer,0);});
test('retraining reproduces held-out performance and preserves source',async()=>{const original=JSON.stringify(model);const m=await train(model,{yieldFn:async()=>{}});assert.equal(evaluate(m,cases(m).test).exactMatches,400);assert.equal(JSON.stringify(model),original);});
test('cancelled training leaves the model untouched',async()=>{const original=JSON.stringify(model);await assert.rejects(()=>train(model,{cancelled:()=>true}),/cancelled/);assert.equal(JSON.stringify(model),original);});
