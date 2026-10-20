// A sessão do Antigravity CLI de ponta a ponta, com o `agy` falso (test/helpers/agy-falso.js)
// no lugar do binário: o despacho do runProvedor, a conferência de login, conta e cota antes
// da sessão, a troca de perfil pela cadeia, o limite com a hora do /usage, o consumo e a
// retomada recusada. Nada aqui chama o agy de verdade nem a rede.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-agy-sessao-'));
process.env.FAROL_AGY_CMD = path.join(import.meta.dirname, 'helpers', 'agy-falso.js');
const REGISTRO = path.join(process.env.FAROL_HOME, 'registro-agy.jsonl');
process.env.AGY_FALSO_REGISTRO = REGISTRO;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
const { AGY_DIR, WORKSPACE, IS_WIN } = await import('../lib/paths.js');
const usage = (await import('../lib/engine/usage.js')).default;
const cadeia = await import('../lib/engine/cadeia-perfis.js');
const { runProvedor } = await import('../lib/engine/session.js');
const { aposLimite } = await import('../lib/engine/limite-na-cadeia.js');
const { classify } = await import('../lib/log-taxonomy.js');
const { killTree } = await import('../lib/engine/session.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const AMBIENTE_FALSO = ['AGY_FALSO_CENARIO', 'AGY_FALSO_CONTA', 'AGY_FALSO_CHAVEIRO', 'AGY_FALSO_COTA', 'AGY_FALSO_RESET', 'AGY_FALSO_RETOMA', 'AGY_FALSO_ESGOTADOS', 'AGY_FALSO_ZERA_APOS'];
beforeEach(() => {
  for (const k of AMBIENTE_FALSO) delete process.env[k];
  try { fs.rmSync(REGISTRO, { force: true }); } catch { /* primeiro teste */ }
});

function logar(id) {
  const cli = path.join(AGY_DIR, id, '.gemini', 'antigravity-cli');
  fs.mkdirSync(cli, { recursive: true });
  fs.writeFileSync(path.join(cli, 'antigravity-oauth-token'), '{"token":"falso"}');
}

function registro() {
  try { return fs.readFileSync(REGISTRO, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
}

function engineCom(perfis, ordem) {
  const e = {
    config: { claudeProfiles: perfis, cadeiaPerfis: ordem, accounts: [], agyReviewModel: 'gemini-3.8-flash-high' },
    running: new Map(), activeReviews: new Map(), limitesDePlano: new Map(), chats: {}, decisions: { pending: [], resolved: [] },
    usage: usage.defaultUsage(), usageSessions: { sessions: [] },
    ghEnv: () => ({ ...process.env, GH_TOKEN: 'gho_da_conta', GEMINI_API_KEY: 'chave-herdada' }),
    log() { }, pushState() { }, emit() { }, accountForPr: () => 'eu',
  };
  e.resolveClaudeAuth = (u) => cadeia.authDaConta(e, u);
  e.recordUsage = (...a) => usage.recordUsage(e, ...a);
  e.killTree = (pid) => killTree(e, pid);
  return e;
}

const X = { id: 'gx', label: 'Gemini X', kind: 'agy', email: 'eu@exemplo.com' };
const Y = { id: 'gy', label: 'Gemini Y', kind: 'agy' };
const OPTS = { id: 'a-agy1', account: 'eu', ref: 'o/r#1', operationKind: 'review' };

test('revisão no agy: resultado do último passo, ambiente da pasta, protocolo e consumo sem contar duas vezes', async () => {
  logar('gx');
  const e = engineCom([X], [{ id: 'gx', ativo: true }]);
  const res = await runProvedor(e, 'revise o PR', OPTS);
  const env = JSON.parse(res.text);
  assert.equal(env.protocolo.prReviewer, 'dispensado');
  assert.equal(res.sessionId, 'c0ffee00-0000-4000-8000-000000000001');
  const regs = registro();
  const sessao = regs.find((r) => r.modo === 'sessao');
  assert.ok(regs.findIndex((r) => r.modo === 'usage') < regs.findIndex((r) => r.modo === 'sessao'), 'a cota é lida antes da sessão');
  assert.equal(sessao.home, path.join(AGY_DIR, 'gx'), 'a home do agy é a pasta do perfil');
  assert.equal(sessao.env.SSH_CLIENT, 'farol 0 0');
  assert.equal(sessao.env.GH_TOKEN, 'gho_da_conta');
  assert.equal(sessao.env.GEMINI_API_KEY, undefined, 'a chave herdada não chega ao filho');
  if (IS_WIN) assert.notEqual(sessao.env.HOME, path.join(AGY_DIR, 'gx'), 'no Windows só o USERPROFILE muda');
  assert.ok(sessao.args.includes('--dangerously-skip-permissions'));
  assert.deepEqual(sessao.args.slice(sessao.args.indexOf('--model'), sessao.args.indexOf('--model') + 2), ['--model', 'gemini-3.8-flash-high']);
  const prompt = JSON.parse(regs.find((r) => r.modo === 'prompt').entrada.trim());
  assert.match(prompt.message.content, /^revise o PR/);
  assert.match(prompt.message.content, /"prReviewer": "dispensado"/, 'o prompt dispensa o pr-reviewer');
  const regras = fs.readdirSync(path.join(WORKSPACE, '.agents', 'rules')).filter((n) => n.startsWith('farol-protocolo-'));
  assert.ok(regras.length >= 2);
  for (const n of regras) assert.ok(fs.statSync(path.join(WORKSPACE, '.agents', 'rules', n)).size < 24000);
  const linha = e.usageSessions.sessions.at(-1);
  assert.equal(linha.inputTokens, 300, 'o total do result, sem somar os passos (100 + 200) por cima');
  assert.equal(linha.outputTokens, 30);
  assert.equal(linha.thinkingTokens, 15);
  assert.equal(linha.cacheReadTokens, 150);
  assert.equal(linha.costSource, 'desconhecido');
  assert.equal(linha.profileId, 'gx');
  assert.equal(linha.model, 'gemini-3.8-flash-high');
});

test('print timeout: SUCCESS vazio vira falha transitória', async () => {
  logar('gx');
  process.env.AGY_FALSO_CENARIO = 'timeout';
  const e = engineCom([X], [{ id: 'gx', ativo: true }]);
  await assert.rejects(runProvedor(e, 'p', OPTS), (err) => {
    assert.equal(classify(err.message).id, 'agy-print-timeout');
    assert.equal(err.perfilDaSessao.kind, 'agy');
    return true;
  });
});

test('cota no meio: AGY_ERROR com saída 3 vira limite com a hora do /usage, e a cadeia segue', async () => {
  logar('gx'); logar('gy');
  process.env.AGY_FALSO_CENARIO = 'cota';
  const e = engineCom([X, Y], [{ id: 'gx', ativo: true }, { id: 'gy', ativo: true }]);
  // o /usage antes da sessão diz que há cota; o que confirma depois da falha diz que zerou
  process.env.AGY_FALSO_ZERA_APOS = '1';
  process.env.AGY_FALSO_RESET = '2099-10-27T07:45:34Z';
  const err = await runProvedor(e, 'p', OPTS).catch((x) => x);
  assert.ok(err instanceof Error);
  assert.equal(classify(err.message).kind, 'espera-reset', err.message);
  assert.equal(err.limitePlano.ate, Date.parse('2099-10-27T07:45:34Z'));
  assert.match(err.message, /resets \w{3} \d{1,2} at/);
  const r = aposLimite(e, { key: 'o/r#1' }, err, err.message);
  assert.equal(r.notBefore, null, 'o Y está livre: relança no próximo ciclo, nele');
  assert.equal(r.ate, Date.parse('2099-10-27T07:45:34Z'));
  assert.equal(e.resolveClaudeAuth('eu').id, 'gy');
});

test('/usage esgotado antes: a cadeia pula para o próximo perfil sem abrir sessão no esgotado', async () => {
  logar('gx'); logar('gy');
  process.env.AGY_FALSO_ESGOTADOS = 'gx';
  process.env.AGY_FALSO_RESET = '2099-10-27T07:45:34Z';
  const e = engineCom([X, Y], [{ id: 'gx', ativo: true }, { id: 'gy', ativo: true }]);
  const res = await runProvedor(e, 'p', OPTS);
  assert.ok(res.text.includes('"decision"'));
  const sessoes = registro().filter((r) => r.modo === 'sessao');
  assert.equal(sessoes.length, 1, 'uma sessão só');
  assert.equal(sessoes[0].home, path.join(AGY_DIR, 'gy'), 'no perfil seguinte');
  assert.ok(e.limitesDePlano.get('agy:gx:gemini').ate === Date.parse('2099-10-27T07:45:34Z'), 'o X fica no limite até o reset do /usage');
});

test('todos esgotados: falha de limite com a hora, sem sessão nenhuma', async () => {
  logar('gx');
  process.env.AGY_FALSO_COTA = '0';
  process.env.AGY_FALSO_RESET = '2099-10-27T07:45:34Z';
  const e = engineCom([X], [{ id: 'gx', ativo: true }]);
  const err = await runProvedor(e, 'p', OPTS).catch((x) => x);
  assert.equal(classify(err.message).kind, 'espera-reset');
  assert.equal(err.limitePlano.ate, Date.parse('2099-10-27T07:45:34Z'));
  assert.equal(registro().filter((r) => r.modo === 'sessao').length, 0);
});

test('conta errada na pasta: falha permanente antes da sessão', async () => {
  logar('gx');
  process.env.AGY_FALSO_CONTA = 'outra@exemplo.com';
  const e = engineCom([X], [{ id: 'gx', ativo: true }]);
  const err = await runProvedor(e, 'p', OPTS).catch((x) => x);
  assert.equal(classify(err.message).id, 'agy-conta-trocada');
  assert.equal(classify(err.message).kind, 'permanente');
  assert.ok(!err.message.includes('outra@exemplo.com'), 'o e-mail não vai para a mensagem');
  assert.equal(registro().filter((r) => r.modo === 'sessao').length, 0);
});

test('token que não veio da pasta (chaveiro) também é conta errada', async () => {
  logar('gx');
  process.env.AGY_FALSO_CHAVEIRO = '1';
  const e = engineCom([X], [{ id: 'gx', ativo: true }]);
  const err = await runProvedor(e, 'p', OPTS).catch((x) => x);
  assert.equal(classify(err.message).id, 'agy-conta-trocada');
});

test('perfil sem login: falha permanente sem abrir nada', async () => {
  const e = engineCom([{ id: 'novo1', label: 'Novo', kind: 'agy' }], [{ id: 'novo1', ativo: true }]);
  const err = await runProvedor(e, 'p', OPTS).catch((x) => x);
  assert.equal(classify(err.message).id, 'agy-sem-login');
  assert.equal(registro().length, 0, 'nem o /usage roda sem o arquivo do token');
});

test('chat: --resume vira --conversation; id que o agy não conhece é retomada recusada', async () => {
  logar('gx');
  const e = engineCom([X], [{ id: 'gx', ativo: true }]);
  const pedida = 'c0ffee00-0000-4000-8000-0000000000aa';
  const ok = await runProvedor(e, 'oi', { ...OPTS, id: 'c-agy1', operationKind: 'chat', extraArgs: ['--resume', pedida] });
  assert.equal(ok.sessionId, pedida);
  assert.ok(registro().find((r) => r.modo === 'sessao').args.includes('--conversation'));
  process.env.AGY_FALSO_RETOMA = '0';
  const err = await runProvedor(e, 'oi', { ...OPTS, id: 'c-agy2', operationKind: 'chat', extraArgs: ['--resume', pedida] }).catch((x) => x);
  assert.match(err.message, /no conversation .* to resume/, 'a frase que o chat e a retomada já tratam como "recomece sem retomar"');
});

test('sessão sem result (saída 2) é falha passageira, e a tentativa fica registrada como erro', async () => {
  logar('gx');
  process.env.AGY_FALSO_CENARIO = 'sem-result';
  const e = engineCom([X], [{ id: 'gx', ativo: true }]);
  const err = await runProvedor(e, 'p', OPTS).catch((x) => x);
  assert.equal(classify(err.message).kind, 'transitorio', err.message);
  const linha = e.usageSessions.sessions.at(-1);
  assert.equal(linha.status, 'erro');
  assert.equal(linha.costSource, 'desconhecido');
});

test('print timeout registra a linha de consumo como erro, não como ok', async () => {
  logar('gx');
  process.env.AGY_FALSO_CENARIO = 'timeout';
  const e = engineCom([X], [{ id: 'gx', ativo: true }]);
  await runProvedor(e, 'p', OPTS).catch(() => null);
  assert.equal(e.usageSessions.sessions.at(-1).status, 'erro');
});

test('Testar perfil: o /usage resumido, a conta mascarada, e nada gravado nem registrado', async () => {
  logar('gx');
  process.env.AGY_FALSO_ESGOTADOS = 'gx';
  const { testarPerfil } = await import('../lib/engine/perfil-claude.js');
  const e = engineCom([X], [{ id: 'gx', ativo: true }]);
  const antes = JSON.stringify(e.config);
  const r = await testarPerfil(e, { profileId: 'gx' });
  assert.equal(r.ok, true);
  assert.equal(r.escreveu, false);
  assert.equal(r.perfil.campos.login.valor, true);
  assert.equal(r.perfil.campos.email.valor, 'eu***@exemplo.com');
  assert.equal(r.perfil.campos.contaConfere.valor, 'confere');
  assert.match(r.perfil.campos.cota.valor, /Gemini Models 0% \(volta /);
  assert.equal(JSON.stringify(e.config), antes, 'a configuração não muda');
  assert.equal(e.limitesDePlano.size, 0, 'testar não registra limite');
});

test('cadeia: perfil agy com o grupo do modelo, e o limite de um grupo não trava o outro', () => {
  const e = engineCom([X], [{ id: 'gx', ativo: true }]);
  assert.deepEqual(e.resolveClaudeAuth('eu'), { kind: 'agy', id: 'gx', grupo: 'gemini' });
  e.limitesDePlano.set('agy:gx:gemini', { ate: Date.now() + 3600e3, em: Date.now() });
  assert.equal(cadeia.cadeiaParaTela(e).entradas[0].estado, 'limite');
  e.config.agyReviewModel = 'claude-sonnet-4-6';
  assert.deepEqual(e.resolveClaudeAuth('eu'), { kind: 'agy', id: 'gx', grupo: '3p' });
  assert.equal(cadeia.cadeiaParaTela(e).entradas[0].estado, 'em-uso', 'no outro balde a conta está livre');
});
