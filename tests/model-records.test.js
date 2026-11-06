import test from 'node:test';import assert from 'node:assert/strict';import{recordKey,readRecord,createRecord,saveRecord}from'../docs/model-records.js';
function storage(){const m=new Map();return{getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v)};}
test('new records have no supplied rules',()=>{const s=storage(),r=createRecord(s,'model_A');assert.equal(r.draft,'');assert.equal(r.rules,'');assert.deepEqual(r.history,[]);assert.equal(readRecord(s,'model_A').modelId,'model_A');});
test('different models remain isolated',()=>{const s=storage();let a=createRecord(s,'A');createRecord(s,'B');a=saveRecord(s,a,'owner text',true);assert.equal(readRecord(s,'A').rules,'owner text');assert.equal(readRecord(s,'B').rules,'');assert.notEqual(recordKey('A'),recordKey('B'));});
test('draft does not assign rules',()=>{const s=storage(),r=createRecord(s,'A');saveRecord(s,r,'draft');assert.equal(readRecord(s,'A').rules,'');});
test('old global rules are not copied or deleted',()=>{const s=storage();s.setItem('forge-owner-rules-v1','legacy');createRecord(s,'A');assert.equal(readRecord(s,'A').rules,'');assert.equal(s.getItem('forge-owner-rules-v1'),'legacy');});
test('stale sequential saves rejected',()=>{const s=storage(),r=createRecord(s,'A');saveRecord(s,r,'one');assert.throws(()=>saveRecord(s,r,'two'),/Reload/);});
test('duplicate create cannot overwrite',()=>{const s=storage();createRecord(s,'A');assert.throws(()=>createRecord(s,'A'),/already exists/);});
test('invalid identifiers and oversized text rejected',()=>{assert.throws(()=>recordKey('../A'));const s=storage(),r=createRecord(s,'A');assert.throws(()=>saveRecord(s,r,'é'.repeat(32769)),/limit/);});
test('storage failures propagate without pretending success',()=>{const s=storage(),r=createRecord(s,'A');const failing={getItem:s.getItem,setItem:()=>{throw Error('quota');}};assert.throws(()=>saveRecord(failing,r,'new'),/quota/);assert.equal(readRecord(s,'A').draft,'');});
test('history is bounded to twenty assignments',()=>{const s=storage();let r=createRecord(s,'A');for(let i=0;i<21;i++)r=saveRecord(s,r,String(i),true);assert.equal(r.history.length,20);assert.equal(r.rules,'20');});
