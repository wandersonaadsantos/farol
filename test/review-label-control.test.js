import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test, beforeEach, after} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
const home=fs.mkdtempSync(path.join(os.tmpdir(),'farol-label-controls-')); process.env.FAROL_HOME=home;
const {command}=await import('../lib/engine/review-label-control.js');
const {addInProgressLabel}=await import('../lib/engine/review.js');
const {tirarPendentes,ARQUIVO}=await import('../lib/engine/labels-a-tirar.js');
const {Engine}=await import('../server.js');
const io=(await import('../lib/io.js')).default, originalRun=io.run;
const URL_PR='https://github.com/acme/app/pull/7';
const PR={key:'acme/app#7',repo:'acme/app',number:7,url:URL_PR,account:'me'};
let tags, calls, actor, engine;
function motor(){return {accountList:()=>[{user:'me',owners:['acme']}],primaryUser:()=> 'me',tokenFor:user=>user==='me'?'synthetic-token':'',ghEnv:user=>({ACTOR:user}),accountForPr:()=> 'me',isMuted:()=>false,activeReviews:new Map(),queue:[{...PR,labels:['me:revisando','colleague:revisando','bug'],outrosRevisando:['colleague']}],panorama:[],log(){},pushState(){}};}
async function run(_cmd,args,opts){
 calls.push(args);actor=opts.env.ACTOR;
 if(args[1]==='view')return {ok:true,stdout:JSON.stringify({labels:[...tags].map(name=>({name}))})};
 assert.equal(args[0],'pr');assert.equal(args[1],'edit');assert.equal(args[2],URL_PR);assert.equal(args[3],'--remove-label');
 tags.delete(args[4]);return {ok:true};
}
beforeEach(()=>{fs.rmSync(ARQUIVO,{recursive:true,force:true});tags=new Set(['me:revisando','colleague:revisando','bug','acrity:approved']);calls=[];actor='';engine=motor();});
after(()=>{io.run=originalRun;fs.rmSync(home,{recursive:true,force:true});});
const request=(action,label)=>command(engine,{action,url:URL_PR,label},run);
const pending=()=>Object.values(JSON.parse(fs.readFileSync(ARQUIVO,'utf8')));

test('consulta identifica todos os marcadores de revisão sem oferecer tags de terceiros',async()=>{
 const result=await request('list');assert.equal(result.ok,true);assert.deepEqual(result.labels,['me:revisando','colleague:revisando']);assert.equal(actor,'me');assert.equal(calls.length,1);assert.equal(tags.size,4);
});
test('remove tag de outro login usando a conta autorizada, preserva demais tags e atualiza o radar',async()=>{
 const result=await request('remove','colleague:revisando');assert.equal(result.ok,true,result.error);assert.deepEqual([...tags],['me:revisando','bug','acrity:approved']);assert.equal(actor,'me');assert.deepEqual(engine.queue[0].outrosRevisando,[]);assert.deepEqual(engine.queue[0].labels,['me:revisando','bug']);assert.deepEqual(pending(),[]);
});
test('remoção repetida é idempotente e não deleta a definição da label',async()=>{
 assert.equal((await request('remove','me:revisando')).ok,true);assert.equal((await request('remove','me:revisando')).ok,true);assert.equal(calls.filter(args=>args[1]==='edit').length,1);assert.equal(calls.some(args=>args[0]==='label'),false);
});
test('remover tag de revisão ativa não cancela nem reinsere o marcador na mesma sessão',async()=>{
 const session={keys:[PR.key],mode:'auto',cancelled:false};engine.activeReviews.set('s',session);
 assert.equal((await request('remove','me:revisando')).ok,true);assert.equal(session.cancelled,false);
 const before=calls.length;assert.equal(await addInProgressLabel(engine,PR,run),'');assert.equal(calls.length,before);assert.equal(engine.activeReviews.size,1);
});
test('erro depois de aplicar a remoção fica durável e retenta com a conta que fez a ação',async()=>{
 const uncertain=async(cmd,args,opts)=>{const result=await run(cmd,args,opts);return args[1]==='edit'?{ok:false,stderr:'network timeout'}:result;};
 const result=await command(engine,{action:'remove',url:URL_PR,label:'colleague:revisando'},uncertain);
 assert.equal(result.ok,false);assert.match(result.error,/pendente/);assert.equal(tags.has('colleague:revisando'),false);assert.equal(pending()[0].account,'me');
 const reboot=motor();await tirarPendentes(reboot,run);assert.deepEqual(pending(),[]);assert.equal(actor,'me');
});
test('token ausente, identidade ambígua, conta removida ou silenciada não produzem escrita',async()=>{
 for(const mutate of [e=>{e.tokenFor=()=>'';},e=>{e.accountList=()=>[{user:'a'},{user:'b'}];e.queue=[];},e=>{e.queue[0].account='deleted';},e=>{e.isMuted=()=>true;}]){
  engine=motor();mutate(engine);calls=[];const r=await request('remove','me:revisando');assert.equal(r.ok,false);assert.equal(calls.length,0);
 }
});
test('URLs e tags arbitrárias são recusadas antes de consultar o GitHub',async()=>{
 const urls=['http://github.com/acme/app/pull/7','https://evil.invalid/github.com/acme/app/pull/7','https://github.com.evil.invalid/acme/app/pull/7','https://me@github.com/acme/app/pull/7','https://github.com:8443/acme/app/pull/7','https://github.com/acme/app/pull/0','https://github.com/acme/app/pull/9007199254740993','https://github.com/acme/app/issues/7'];
 for(const url of urls)assert.equal((await command(engine,{action:'remove',url,label:'me:revisando'},run)).ok,false,url);
 for(const label of ['bug','acrity:approved','--remove-label=bug','me:revisando,bug','x\n:revisando','<img>:revisando',null,{}])assert.equal((await request('remove',label)).ok,false);
 assert.deepEqual(calls,[]);assert.equal(fs.existsSync(ARQUIVO),false);
});
test('consulta incompleta ou indisponível não é interpretada como lista vazia',async()=>{
 for(const response of [{ok:false,stderr:'forbidden'},{ok:true,stdout:'{}'},{ok:true,stdout:'{"labels":[null]}'},{ok:true,stdout:'not-json'}]){
  let count=0;const r=await command(engine,{action:'remove',url:URL_PR,label:'me:revisando'},async()=>{count++;return response;});assert.equal(r.ok,false);assert.equal(count,1);assert.equal(tags.has('me:revisando'),true);
 }
});
test('sem conseguir registrar a intenção em disco, nenhuma remoção é enviada',async()=>{
 fs.mkdirSync(ARQUIVO,{recursive:true});const r=await request('remove','me:revisando');assert.equal(r.ok,false);assert.match(r.error,/registrar/);assert.equal(calls.some(args=>args[1]==='edit'),false);
});
test('rota real exige autenticação e origem válida e aplica só a tag selecionada',async()=>{
 const e=new Engine();e.config.port=0;e.config.localAuth='exigir';
 e.config.accounts=[{user:'me',owners:['acme']}];e.tokenFor=()=> 'synthetic-token';e.ghEnv=user=>({ACTOR:user});e.pushState=()=>{};e.log=()=>{};
 const {startServer}=await import('../lib/http-server.js');const {emitirSessao}=await import('../lib/local-auth/sessoes.js');
 io.run=run;const server=startServer(e);await once(server,'listening');
 const endpoint=`http://127.0.0.1:${server.address().port}/api/review-labels`;
 const send=headers=>fetch(endpoint,{method:'POST',headers:{'x-farol':'1','content-type':'application/json',...headers},body:JSON.stringify({action:'remove',url:URL_PR,label:'me:revisando'})});
 try{
  assert.equal((await send({})).status,401);const token=emitirSessao('review-labels-test');
  assert.equal((await send({authorization:`Bearer ${token}`,origin:'https://external.invalid'})).status,403);assert.equal(tags.has('me:revisando'),true);
  const response=await send({authorization:`Bearer ${token}`});assert.equal(response.status,200);assert.equal((await response.json()).ok,true);assert.equal(tags.has('me:revisando'),false);assert.equal(tags.has('bug'),true);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));io.run=originalRun;}
});

test('identidade conhecida usa a grafia da conta configurada sem confundir caixa do login', async () => {
  engine.accountList = () => [{ user: 'Me', owners: ['acme'] }]; engine.tokenFor = user => user === 'Me' ? 'synthetic' : '';
  const result = await request('remove', 'me:revisando');
  assert.equal(result.ok, true, result.error); assert.equal(actor, 'Me');
});
test('remoção manual respeita a mesma sessão quando a URL usa outra caixa no nome do PR', async () => {
  const session = { keys: [PR.key.toUpperCase()], mode: 'auto', cancelled: false }; engine.activeReviews.set('s', session);
  assert.equal((await request('remove', 'me:revisando')).ok, true);
  const before = calls.length; assert.equal(await addInProgressLabel(engine, PR, run), '');
  assert.equal(calls.length, before); assert.equal(session.cancelled, false);
});
