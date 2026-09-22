// O limite do plano do Claude é da ASSINATURA, não do PR (relato de 21/09/2026).
//
// A v2.62.9 fez cada PR esperar o reset depois de bater no limite. Medido na timeline do
// GitHub logo depois: um aparelho já na v2.62.9 abriu revisão em 12 PRs diferentes em 34
// segundos (23:53:49 a 23:54:23 UTC), e cada uma morreu em ~4 s. A espera era guardada POR
// PR: o primeiro descobria o limite e os outros onze tinham de bater nele para descobrir
// também, cada um pondo e tirando a label <conta>:revisando. E a espera morava só em
// memória: o reinício para instalar a própria correção a apagou, e a fila inteira saiu de
// novo às 23:53.
//
// O limite agora vale para a assinatura inteira (duas contas do GitHub no mesmo perfil do
// Claude dividem a mesma cota), fica em disco, e o PR que chega na vez durante o limite nem
// abre sessão. Clique manual continua passando (invariante 4).
import os from 'node:os';
import path from 'node:path';
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-limite-conta-' + process.pid);

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { Engine } = await import('../server.js');
const { LIMITE_PLANO_FILE } = await import('../lib/paths.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { } });

const MSG_LIMITE = "claude saiu com código 1: You've hit your limit · resets 5:50pm";
const prDe = (key, extra) => ({ key, url: `https://github.com/${key.replace('#', '/pull/')}`, ...extra });

// 'eu' e 'colega' usam o MESMO perfil do Claude; 'outra' usa outro
function engineBase() {
  try { fs.rmSync(LIMITE_PLANO_FILE, { force: true }); } catch { }
  const e = new Engine();
  e.accountForPr = (pr) => pr.account || 'eu';
  e.isMuted = () => false;
  e.tokens = { eu: 't1', colega: 't2', outra: 't3' };
  e.log = () => { };
  e.bloqueadoPorHistorico = async () => ({ bloqueado: false, head: '', quem: [], decisivos: [] });
  e.resolveClaudeAuth = (u) => ({ kind: 'dir', id: '', dir: u === 'outra' ? '/perfis/b' : '/perfis/a' });
  e.prState = async () => 'OPEN';
  return e;
}

async function estourarLimite(e) {
  e.runHeadlessReview = async () => { throw new Error(MSG_LIMITE); };
  await e.runOneHeadless(prDe('o/r#1'), 'eu');
}

test('o primeiro PR que bate no limite trava a assinatura inteira até o reset', async () => {
  const e = engineBase();
  await estourarLimite(e);
  const ate = e.limiteDoPlanoAte('eu');
  assert.ok(ate > Date.now(), 'o limite da assinatura ficou registrado com a hora do reset');
  assert.equal(new Date(ate).getHours(), 17);
  assert.equal(new Date(ate).getMinutes(), 50);
});

test('com a assinatura no limite, o próximo PR NÃO abre sessão (e a label não entra)', async () => {
  const e = engineBase();
  await estourarLimite(e);
  let abriu = 0;
  e.runHeadlessReview = async () => { abriu++; };
  await e.runOneHeadless(prDe('o/r#2'), 'eu');
  assert.equal(abriu, 0, 'abrir a sessão é o que punha a label no PR, e ela morreria em segundos');
  const guardado = e.retryAfterNet.get('o/r#2');
  assert.ok(guardado, 'o PR não some: espera o reset');
  assert.equal(guardado.notBefore, e.limiteDoPlanoAte('eu'));
  assert.equal(guardado.tries, 0, 'esperar o limite não gasta tentativa: nada falhou neste PR');
  assert.equal(e.autoReviewParked.has('o/r#2'), false, 'limite de janela não estaciona');
  assert.ok(e.queue.some((p) => p.key === 'o/r#2'), 'o card continua visível na fila');
});

test('outra conta do GitHub no MESMO perfil do Claude também espera: a cota é a mesma', async () => {
  const e = engineBase();
  await estourarLimite(e);
  assert.ok(e.limiteDoPlanoAte('colega') > Date.now());
  let abriu = 0;
  e.runHeadlessReview = async () => { abriu++; };
  await e.runOneHeadless(prDe('o/r#3', { account: 'colega' }), 'colega');
  assert.equal(abriu, 0);
});

test('conta em OUTRO perfil do Claude não é afetada', async () => {
  const e = engineBase();
  await estourarLimite(e);
  assert.equal(e.limiteDoPlanoAte('outra'), 0);
  let abriu = 0;
  e.runHeadlessReview = async () => { abriu++; };
  await e.runOneHeadless(prDe('o/r#4', { account: 'outra' }), 'outra');
  assert.equal(abriu, 1);
});

test('clique manual atravessa o limite (invariante 4), e sessão que dá certo libera a assinatura', async () => {
  const e = engineBase();
  await estourarLimite(e);
  let abriu = 0;
  e.runHeadlessReview = async () => { abriu++; };
  await e.runOneHeadless(prDe('o/r#5', { manual: true }), 'eu');
  assert.equal(abriu, 1, 'quem mandou revisar foi você: talvez a cota tenha voltado antes, ou você comprou uso extra');
  assert.equal(e.limiteDoPlanoAte('eu'), 0, 'a sessão que funcionou prova que a cota voltou');
});

test('o limite sobrevive a reinício: o Farol que reabre não dispara a fila inteira de novo', async () => {
  const e = engineBase();
  await estourarLimite(e);
  const ate = e.limiteDoPlanoAte('eu');
  const depois = new Engine();
  depois.resolveClaudeAuth = e.resolveClaudeAuth;
  assert.equal(depois.limiteDoPlanoAte('eu'), ate, 'o reinício para instalar a correção apagava a espera');
});

test('limite vencido não sobrevive: ao carregar, o que já passou é descartado', async () => {
  const e = engineBase();
  fs.mkdirSync(path.dirname(LIMITE_PLANO_FILE), { recursive: true });
  fs.writeFileSync(LIMITE_PLANO_FILE, JSON.stringify({ 'dir:/perfis/a': { ate: Date.now() - 1000, em: Date.now() - 5000 } }));
  const depois = new Engine();
  depois.resolveClaudeAuth = e.resolveClaudeAuth;
  assert.equal(depois.limiteDoPlanoAte('eu'), 0);
});

test('o relançamento também respeita o limite da assinatura, mesmo com a espera do PR vencida', async () => {
  const e = engineBase();
  await estourarLimite(e);
  // um PR cuja espera própria já passou (ou que nem tinha hora) não volta enquanto a assinatura está no limite
  e.retryAfterNet.set('o/r#6', { tries: 1, pr: prDe('o/r#6'), notBefore: null });
  assert.deepEqual(e.retryTargets(new Set(), new Set()).map((p) => p.key), []);
});

test('limite sem hora de reset não trava a assinatura: sem hora não dá para saber até quando', async () => {
  const e = engineBase();
  e.runHeadlessReview = async () => { throw new Error("claude saiu com código 1: You've hit your limit"); };
  await e.runOneHeadless(prDe('o/r#7'), 'eu');
  assert.equal(e.limiteDoPlanoAte('eu'), 0);
});

test('a fila automática não enfileira PR de assinatura no limite (mesmo lugar do gate de orçamento)', () => {
  const fonte = fs.readFileSync(path.join(import.meta.dirname, '..', 'server.js'), 'utf8');
  const i = fonte.indexOf('const toReview = this.queue.filter(');
  assert.ok(i >= 0);
  const filtro = fonte.slice(i, fonte.indexOf('});', i));
  assert.match(filtro, /this\.limiteDoPlanoAte\(acct\)/, 'sem este filtro a fila enfileiraria e só o gate da boca seguraria');
});

/* ---------- a varredura de pushback e as revisões dividem o mesmo fato ---------- */

test('limite descoberto por uma revisão também segura a varredura de pushback daquela assinatura', async () => {
  const e = engineBase();
  await estourarLimite(e);
  const pushback = await import('../lib/engine/pushback.js');
  e.panorama = [prDe('o/r#8'), prDe('o/r#9', { account: 'outra' })];
  const acts = { 'o/r#8': { kind: 'request_changes' }, 'o/r#9': { kind: 'request_changes' } };
  const alvos = pushback.default.pushbackTargets(e, acts).map((p) => p.key);
  assert.equal(alvos.includes('o/r#8'), false, 'a assinatura no limite não abre sessão de pushback');
  assert.equal(alvos.includes('o/r#9'), true, 'a outra assinatura segue sendo varrida: o filtro é por assinatura, não geral');
});

test('limite com hora descoberto pelo pushback vale para as revisões da mesma assinatura', async () => {
  const e = engineBase();
  const pushback = await import('../lib/engine/pushback.js');
  pushback.default.esperarResetDePlano(e, "sessão retornou erro: You've hit your weekly limit · resets 2am", Date.now(), 'eu');
  assert.ok(e.limiteDoPlanoAte('eu') > Date.now(), 'o pushback registra na assinatura, não num campo só dele');
  assert.equal(Number(e.pushbackEsperaAte) || 0, 0, 'com hora citada não há segunda cópia do mesmo fato');
  let abriu = 0;
  e.runHeadlessReview = async () => { abriu++; };
  await e.runOneHeadless(prDe('o/r#10'), 'eu');
  assert.equal(abriu, 0, 'a revisão da mesma assinatura espera o reset que o pushback descobriu');
});
