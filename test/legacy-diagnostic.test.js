import test, { after } from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const home=fs.mkdtempSync(path.join(os.tmpdir(),'farol-legacy-diagnostic-'));
process.env.FAROL_HOME=home;
const { classifyLegacy }=await import('../tools/diagnosticar-legados.js');
after(()=>fs.rmSync(home,{recursive:true,force:true}));
const id='review-fixture', request={repo:'org/repo',head:'a'.repeat(40)};
const empty={records:[],inflight:[],sessions:[]};
test('resultado histórico fora da árvore não é consumidor ativo nem prova de término de processos',()=>{
 const records=[{status:'posted',technicalReview:{privateEvidence:'/private/'+id+'-result.json'}}];
 assert.equal(classifyLegacy(id,request,{...empty,records},true),'historical-result-reference');
 assert.equal(classifyLegacy(id,request,empty,true),'insufficient-information');
});
test('consumidor explícito, candidato por versão e retomada são fatos diferentes',()=>{
 assert.equal(classifyLegacy(id,request,{...empty,sessions:[{snapshot:'/private/'+id}]},false),'active-consumer-confirmed');
 const pr={key:'org/repo#1',headSha:request.head};
 assert.equal(classifyLegacy(id,request,{...empty,sessions:[pr]},false),'active-consumer-candidate');
 assert.equal(classifyLegacy(id,request,{...empty,inflight:[{...pr,retomarSid:'session-valid-123'}]},false),'resumable-checkpoint-candidate');
 assert.equal(classifyLegacy(id,request,{...empty,inflight:[pr]},false),'insufficient-information');
});

