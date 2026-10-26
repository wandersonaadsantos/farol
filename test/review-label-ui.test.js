import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { instalarDom } from './helpers/dom-stub.js';
const home=fs.mkdtempSync(path.join(os.tmpdir(),'farol-label-ui-'));process.env.FAROL_HOME=home;
const { command }=await import('../lib/engine/review-label-control.js');
const io=(await import('../lib/io.js')).default, oldRun=io.run;
const {doc}=instalarDom(), $=selector=>doc.querySelector(selector);
const create=doc.createElement.bind(doc);
doc.createElement=tag=>{const node=create(tag),children=new Map();node.querySelector=selector=>{if(!children.has(selector))children.set(selector,create('button'));return children.get(selector);};return node;};
$('#reviewLabels').querySelectorAll=()=>[$('#reviewLabelsUrl'),$('#reviewLabelsInspect')];
let labels,calls,fail;
const engine={accountList:()=>[{user:'me',owners:['acme']}],primaryUser:()=> 'me',tokenFor:()=> 'synthetic',ghEnv:()=>({}),isMuted:()=>false,queue:[],activeReviews:new Map(),log(){},pushState(){}};
io.run=async(_cmd,args)=>{calls.push(args);if(fail)return {ok:false,stderr:'offline'};if(args[1]==='view')return{ok:true,stdout:JSON.stringify({labels:[...labels].map(name=>({name}))})};labels.delete(args.at(-1));return {ok:true};};
globalThis.fetch=async(url,options)=>{assert.equal(url,'/api/review-labels');return{json:()=>command(engine,JSON.parse(options.body))};};
const {initReviewLabels}=await import('../ui/telas/review-labels.js');initReviewLabels();
beforeEach(()=>{labels=new Set(['me:revisando','colleague:revisando','bug']);calls=[];fail=false;engine.labelsATirar={};$('#reviewLabelsUrl').value='https://github.com/acme/app/pull/7';$('#reviewLabelsUrl').oninput();});
after(()=>{io.run=oldRun;fs.rmSync(home,{recursive:true,force:true});});
const clickRemove=label=>$('#reviewLabelsList').onclick({target:{closest:()=>({dataset:{removeReviewLabel:label}})}});
test('consulta real oferece só as tags gerenciadas e informa a identidade usada',async()=>{
 await $('#reviewLabelsInspect').onclick();assert.match($('#reviewLabelsList').innerHTML,/me:revisando/);assert.match($('#reviewLabelsList').innerHTML,/colleague:revisando/);assert.doesNotMatch($('#reviewLabelsList').innerHTML,/>bug</);assert.match($('#reviewLabelsMessage').textContent,/conta me/);
});
test('cancelar a confirmação não remove a tag; confirmar remove apenas a selecionada',async()=>{
 await $('#reviewLabelsInspect').onclick();
 const cancel=clickRemove('colleague:revisando'),first=doc.body.children.at(-1);
 assert.match(first.innerHTML,/não cancela a revisão/);assert.equal($('#reviewLabelsUrl').disabled,true);
 first.querySelector('.modal-cancel').onclick();await cancel;assert.equal(labels.has('colleague:revisando'),true);assert.equal(calls.some(args=>args[1]==='edit'),false);
 const confirm=clickRemove('colleague:revisando'),second=doc.body.children.at(-1);second.querySelector('.modal-ok').onclick();await confirm;
 assert.equal(labels.has('colleague:revisando'),false);assert.equal(labels.has('bug'),true);assert.match($('#reviewLabelsMessage').textContent,/Tag removida/);assert.equal($('#reviewLabelsUrl').disabled,false);
});
test('falha mantém mensagem de erro e libera nova consulta; trocar URL limpa resultado anterior',async()=>{
 await $('#reviewLabelsInspect').onclick();fail=true;
 const operation=clickRemove('me:revisando');doc.body.children.at(-1).querySelector('.modal-ok').onclick();await operation;
 assert.match($('#reviewLabelsMessage').textContent,/Não foi possível/);assert.doesNotMatch($('#reviewLabelsMessage').textContent,/Tag removida/);assert.equal($('#reviewLabelsInspect').disabled,false);assert.equal(labels.has('me:revisando'),true);
 $('#reviewLabelsUrl').value='https://github.com/acme/other/pull/8';$('#reviewLabelsUrl').oninput();assert.equal($('#reviewLabelsList').innerHTML,'');assert.match($('#reviewLabelsMessage').textContent,/Consulte o PR/);
});
