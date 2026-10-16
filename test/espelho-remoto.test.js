import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createECDH } from 'node:crypto';
import { snapshotEspelho, fragmentar, recompor } from '../lib/sync/espelho.js';
import { assistir, cicloEspelho, anexarEspelhos } from '../lib/engine/sync-espelho.js';
import { espelhoDaSessaoHtml } from '../ui/pure/espelho.js';
const T = 1800000000000, OP = 'a'.repeat(32);
function motores() {
  const material = { id: randomBytes(32).toString('base64'), enc: { g1: randomBytes(32).toString('base64') } };
  const arvore = {}, requests = [];
  const client = {
    async put(p, no) {
      const id = p.split('/').at(-1), old = arvore[id];
      assert.ok(no.enc.length <= 2048, 'mesmo teto da regra publicada');
      assert.deepEqual(Object.keys(no).sort(), ['dev','enc','t0','v','x']);
      if (old) { assert.equal(old.dev, no.dev); assert.equal(old.t0, no.t0); }
      arvore[id] = structuredClone(no); requests.push(no); return { ok: true };
    },
    async del(p) { delete arvore[p.split('/').at(-1)]; return { ok: true }; },
  };
  const base = { uid: 'u1', material, cur: 'g1', client };
  const origem = { sync: { ...base, deviceId: 'windows', andamento: new Map([['local1', { opId: OP, t0: T }]]) }, activeReviews: new Map([['local1',{ startedAt: T-60000, model: 'Opus', agents: { a: { label:'leitor',done:false } }, fase: 'modelo' }]]), activity: new Map([['local1', [{ t:T,k:'text',text:'Conferi os critérios do card e o código.',s:'card' },{t:T+1,k:'tool',text:'Bash · Executar os testes de contrato',s:'verificacao',a:'leitor'}]]]) };
  const op = { opId: OP, dev: 'windows', situacao: 'viva' };
  const leitor = { sync: { ...base, deviceId: 'hostinger', andamentoRemoto: [op] } };
  return { origem, leitor, arvore, requests, op };
}
test('espelho sob demanda atravessa cifra real, preserva texto, ferramenta, agente e etapa', async () => {
  const {origem,leitor,arvore,requests,op}=motores();
  await cicloEspelho(origem, arvore, T);
  assert.equal(requests.length, 0, 'sem observador não transmite logs');
  assert.equal(assistir(leitor,{opId:OP},T).ok,true);
  await cicloEspelho(leitor,arvore,T);
  await cicloEspelho(origem,arvore,T+1);
  const [lido]=anexarEspelhos(leitor,[op],arvore,T+2);
  assert.equal(lido.espelho.estado,'completo');
  assert.deepEqual(lido.espelho.feed,snapshotEspelho(origem.activeReviews.get('local1'),origem.activity.get('local1'),T+1).feed);
  assert.equal(lido.espelho.startedAt,T-60000);
  assert.equal(lido.espelho.agentsLive,1);
  assert.ok(!JSON.stringify(arvore).includes('critérios do card'));
  const html=espelhoDaSessaoHtml(lido,T+2);
  assert.match(html,/Conferi os critérios do card/);
  assert.match(html,/Executar os testes de contrato/);
  assert.match(html,/leitor/);
  const chaveReal=leitor.sync.espelho.assistir.get(OP).chave;
  const intrusa=createECDH('prime256v1');intrusa.generateKeys();
  leitor.sync.espelho.assistir.get(OP).chave=intrusa;
  assert.notEqual(anexarEspelhos(leitor,[op],arvore,T+2)[0].espelho?.estado,'completo','a chave compartilhada sozinha não abre o espelho de outro observador');
  leitor.sync.espelho.assistir.get(OP).chave=chaveReal;
  const ids=[...origem.sync.espelho.publicados.values()][0].ids;
  delete arvore[ids[0]];
  assert.equal(anexarEspelhos(leitor,[op],arvore,T+3)[0].espelho.estado,'incompleto');
});
test('fecha observação e deixa de transmitir; sessão finalizada limpa os fragmentos',async()=>{
  const {origem,leitor,arvore}=motores();
  assistir(leitor,{opId:OP},T);await cicloEspelho(leitor,arvore,T);await cicloEspelho(origem,arvore,T+1);
  origem.activeReviews.clear();origem.sync.andamento.clear();await cicloEspelho(origem,arvore,T+2);
  assert.equal(origem.sync.espelho.publicados.size,0);
  assert.equal(assistir(leitor,{opId:'../../users/outra'},T).ok,false);
  assistir(leitor,{opId:OP,aberto:false},T);await cicloEspelho(leitor,arvore,T+40000);
  await cicloEspelho(origem,arvore,T+40000);assert.equal(origem.sync.espelho.publicados.size,0);
});
test('120 linhas unicode e conteúdo hostil recompõem integralmente sem HTML executável',()=>{
  const v=snapshotEspelho({startedAt:T},Array.from({length:120},(_,i)=>({t:T+i,k:'text',text:'😀'.repeat(90)+'<script>alert(1)</script>'})),T);
  const f=fragmentar(v);assert.deepEqual(recompor({...f,partes:f.partes.length},f.partes),v);
  const html=espelhoDaSessaoHtml({situacao:'viva',espelho:{...v,estado:'completo',venceEm:T+150000}},T);
  assert.ok(!html.includes('<script>'));assert.match(html,/&lt;script&gt;/);
  assert.equal(recompor({hash:'errado',partes:f.partes.length},f.partes),null);
});
test('credenciais são ocultadas, mas descrições comuns não somem',()=>{
  const v=snapshotEspelho({},[{text:'Bearer abc.def.123 token=senha ghp_1234567890abcdef Bash · Conferir contrato',k:'tool'}],T);
  assert.ok(!v.feed[0].text.includes('abc.def.123'));assert.ok(!v.feed[0].text.includes('ghp_123'));
  assert.match(v.feed[0].text,/Conferir contrato/);
});
