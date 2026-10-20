// Cadeia de perfis (20/10/2026): a ordem em que as assinaturas pagam a revisão, com troca
// automática quando uma chega ao limite do plano e volta ao prioritário depois do reset.
// Pedido do dono: "Caso estourou a conta Gemini X, salva quando volta o limite e vai direto
// pra Gemini Y, e assim por diante, e segue a prioridade de qual vai consumir primeiro."
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-cadeia-'));

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const { Engine } = await import('../server.js');
const { LIMITE_PLANO_FILE } = await import('../lib/paths.js');
const cadeiaMod = (await import('../lib/engine/cadeia-perfis.js')).default;
const { comPerfilDaSessao } = await import('../lib/engine/limite-na-cadeia.js');
const { classify } = await import('../lib/log-taxonomy.js');
const pushback = await import('../lib/engine/pushback.js');
const prov = (await import('../lib/engine/provedores.js')).default;
const { runClaudeStream } = await import('../lib/engine/session.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { } });

const MSG_LIMITE = "claude saiu com código 1: You've hit your limit · resets 5:50pm";
const prDe = (key) => ({ key, url: `https://github.com/${key.replace('#', '/pull/')}` });

const X = { id: 'gx', label: 'Gemini X', dir: '/perfis/x' };
const Y = { id: 'gy', label: 'Gemini Y', dir: '/perfis/y' };
const Z = { id: 'cmax', label: 'Claude Max BIUD', kind: 'codex' };

function engineCom(config) {
  try { fs.rmSync(LIMITE_PLANO_FILE, { force: true }); } catch { }
  const e = new Engine();
  e.log = () => { };
  e.pushState = () => { };
  e.doctor = async () => ({});
  e.saveConfig = () => { };
  e.accountForPr = () => 'eu';
  e.isMuted = () => false;
  e.tokens = { eu: 't1' };
  e.bloqueadoPorHistorico = async () => ({ bloqueado: false, head: '', quem: [], decisivos: [] });
  e.prState = async () => 'OPEN';
  e.config.accounts = [{ user: 'eu', owners: ['o'] }];
  e.config.claudeProfiles = [X, Y, Z];
  e.config.cadeiaPerfis = config.cadeia;
  e.config.claudeProfileId = '';
  cadeiaMod.reconciliar(e.config);
  return e;
}

const TODOS_LIGADOS = [{ id: 'gx', ativo: true }, { id: 'gy', ativo: true }, { id: 'cmax', ativo: true }];

const MSG_OAUTH = 'Failed to authenticate: OAuth session expired and could not be refreshed';

function sessaoSemLogin(e, usados) {
  e.runHeadlessReview = async () => {
    const auth = e.resolveClaudeAuth('eu');
    usados.push(auth.id);
    throw Object.assign(new Error(MSG_OAUTH), { perfilDaSessao: auth, sessionId: 'sid-do-perfil-anterior' });
  };
}

test('OAuth expirado avança pelos perfis ligados até Codex, sem estacionar nem retomar SID de outro perfil', async () => {
  const e = engineCom({ cadeia: TODOS_LIGADOS });
  const usados = [];
  sessaoSemLogin(e, usados);
  const pr = { ...prDe('o/r#801'), retomarSid: 'sid-antigo' };
  await e.runOneHeadless(pr, 'eu');
  assert.equal(e.resolveClaudeAuth('eu').id, 'gy');
  assert.equal(e.autoReviewParked.has(pr.key), false);
  assert.equal(e.retryAfterNet.get(pr.key).pr.retomarSid, '');
  assert.equal(e.retryAfterNet.get(pr.key).notBefore, null);
  assert.equal(cadeiaMod.cadeiaParaTela(e).entradas[0].estado, 'sem-login');
  assert.equal(e.limitesDePlano.size, 0, 'login expirado não inventa cota nem hora de reset');
  await e.runOneHeadless(e.retryAfterNet.get(pr.key).pr, 'eu');
  assert.equal(e.resolveClaudeAuth('eu').id, 'cmax');
  e.runHeadlessReview = async () => { usados.push(e.resolveClaudeAuth('eu').id); };
  await e.runOneHeadless(e.retryAfterNet.get(pr.key).pr, 'eu');
  assert.deepEqual(usados, ['gx', 'gy', 'cmax']);
  assert.equal(e.retryAfterNet.has(pr.key), false);
});

test('OAuth expirado sem alternativa pronta estaciona, sem loop nem transbordar conta fixa', async () => {
  for (const fixo of [false, true]) {
    const e = engineCom({ cadeia: fixo ? TODOS_LIGADOS : [{ id: 'gx', ativo: true }] });
    if (fixo) e.config.accounts[0].claudeProfileId = 'gx';
    sessaoSemLogin(e, []);
    await e.runOneHeadless(prDe('o/r#802'), 'eu');
    assert.equal(e.autoReviewParked.has('o/r#802'), true);
    assert.equal(e.retryAfterNet.has('o/r#802'), false);
  }
});

test('fallback OAuth não escolhe perfil desligado, limitado, sem login ou alias da credencial vencida', async () => {
  const e = engineCom({ cadeia: TODOS_LIGADOS });
  e.config.claudeProfiles.push({ ...X, id: 'alias' });
  e.config.cadeiaPerfis.splice(1, 0, { id: 'alias', ativo: true });
  e.limitesDePlano.set('dir:/perfis/y', { ate: Date.now() + 3600e3, em: Date.now() });
  e.doctorInfo = { codexChatGPT: false };
  sessaoSemLogin(e, []);
  await e.runOneHeadless(prDe('o/r#803'), 'eu');
  assert.equal(e.autoReviewParked.has('o/r#803'), true);
  assert.equal(e.retryAfterNet.has('o/r#803'), false);
  assert.equal(cadeiaMod.cadeiaParaTela(e).entradas.find(a => a.id === 'alias').estado, 'sem-login');
});

test('doctor local pronto não apaga falha OAuth; credencial renovada e sucesso real restauram a prioridade', async () => {
  const e = engineCom({ cadeia: TODOS_LIGADOS });
  const dir = fs.mkdtempSync(path.join(process.env.FAROL_HOME, 'perfil-'));
  e.config.claudeProfiles[0] = { ...X, dir };
  sessaoSemLogin(e, []);
  await e.runOneHeadless(prDe('o/r#804'), 'eu');
  e.doctorInfo = { claudeAuth: [{ id: 'gx', ready: true }, { id: 'gy', ready: true }] };
  assert.equal(e.resolveClaudeAuth('eu').id, 'gy');
  fs.writeFileSync(path.join(dir, '.credentials.json'), '{}');
  assert.equal(e.resolveClaudeAuth('eu').id, 'gx');
  await e.runOneHeadless(prDe('o/r#804'), 'eu');
  assert.equal(e.resolveClaudeAuth('eu').id, 'gy');
  await comPerfilDaSessao(e, Promise.resolve({}), { kind: 'dir', id: X.id, dir });
  assert.equal(e.resolveClaudeAuth('eu').id, 'gx');
});

test('erros de autenticação genéricos e cancelamento não acionam fallback OAuth', async () => {
  for (const erro of [new Error('HTTP 401'), Object.assign(new Error(MSG_OAUTH), { cancelled: true })]) {
    const e = engineCom({ cadeia: TODOS_LIGADOS });
    e.runHeadlessReview = async () => { throw Object.assign(erro, { perfilDaSessao: e.resolveClaudeAuth('eu') }); };
    await e.runOneHeadless(prDe('o/r#805'), 'eu');
    assert.equal(e.resolveClaudeAuth('eu').id, 'gx');
    assert.equal(e.retryAfterNet.has('o/r#805'), false);
  }
});

test('erro OAuth do processo real chega à fila e a próxima tentativa usa outro ambiente de autenticação', async () => {
  const e = engineCom({ cadeia: TODOS_LIGADOS });
  fs.mkdirSync(path.join(process.env.FAROL_HOME, 'workspace'), { recursive: true });
  process.env.FAROL_HEADLESS_CMD = `node -e "const expired=process.env.CLAUDE_CONFIG_DIR.includes('/x');console.log(JSON.stringify({type:'result',is_error:expired,result:expired?'OAuth session expired and could not be refreshed':process.env.CLAUDE_CONFIG_DIR}))"`;
  let resultado;
  e.runHeadlessReview = async () => { resultado = await runClaudeStream(e, 'x', { account: 'eu', id: 'oauth-processo' }); };
  try {
    await e.runOneHeadless(prDe('o/r#806'), 'eu');
    assert.equal(e.autoReviewParked.has('o/r#806'), false);
    const retry = e.retryAfterNet.get('o/r#806');
    assert.ok(retry);
    await e.runOneHeadless(retry.pr, 'eu');
    assert.equal(resultado.text, '/perfis/y');
    assert.equal(e.retryAfterNet.has('o/r#806'), false);
  } finally { delete process.env.FAROL_HEADLESS_CMD; }
});

// a sessão de mentira usa o perfil que a cadeia escolheu naquele instante, como o
// runProvedor, e o primeiro perfil bate no limite
function sessaoQueEstouraEm(e, ids, usados) {
  e.runHeadlessReview = async () => {
    const auth = e.resolveClaudeAuth('eu');
    usados.push(auth.id);
    if (ids.includes(auth.id)) throw Object.assign(new Error(MSG_LIMITE), { perfilDaSessao: auth });
  };
}

test('o primeiro perfil estoura: o limite fica nele, a cadeia segue para o próximo e o PR volta sem clique', async () => {
  const e = engineCom({ cadeia: TODOS_LIGADOS });
  const toasts = [];
  e.on('toast', (t) => toasts.push(t.text));
  const usados = [];
  sessaoQueEstouraEm(e, ['gx'], usados);
  assert.equal(e.resolveClaudeAuth('eu').id, 'gx', 'antes de estourar, o principal paga');

  await e.runOneHeadless(prDe('o/r#1'), 'eu');
  assert.deepEqual(usados, ['gx']);
  assert.equal(e.resolveClaudeAuth('eu').id, 'gy', 'Gemini X no limite: a conta passa a usar Gemini Y');
  assert.equal(e.limiteDoPlanoAte('eu'), 0, 'há perfil livre, então a conta não está no limite');
  const guardado = e.retryAfterNet.get('o/r#1');
  assert.equal(guardado.notBefore, null, 'o PR relança no próximo ciclo, no perfil seguinte');
  assert.deepEqual(e.retryTargets(new Set(), new Set()).map((p) => p.key), ['o/r#1']);
  assert.match(toasts.at(-1), /O perfil "Gemini X" chegou ao limite do plano até 17:50\. Retomo o\/r#1 no perfil "Gemini Y"/);

  // o relançamento roda no Gemini Y e dá certo
  await e.runOneHeadless(guardado.pr, 'eu');
  assert.deepEqual(usados, ['gx', 'gy']);
  assert.equal(e.retryAfterNet.has('o/r#1'), false);

  // passado o reset, o principal volta a ser o escolhido sozinho
  const ate = e.limitesDePlano.get('dir:/perfis/x').ate;
  assert.equal(cadeiaMod.authDaConta(e, 'eu', ate - 1).id, 'gy');
  assert.equal(cadeiaMod.authDaConta(e, 'eu', ate).id, 'gx', 'reset passou: a prioridade volta para Gemini X');
});

test('todos no limite: o PR espera o PRIMEIRO reset, sem estacionar e sem abrir sessão', async () => {
  const e = engineCom({ cadeia: TODOS_LIGADOS });
  const agora = Date.now();
  e.limitesDePlano.set('dir:/perfis/x', { ate: agora + 3 * 3600e3, em: agora });
  e.limitesDePlano.set('dir:/perfis/y', { ate: agora + 3600e3, em: agora });
  e.limitesDePlano.set('codex:', { ate: agora + 2 * 3600e3, em: agora });
  assert.equal(e.resolveClaudeAuth('eu').id, 'gy', 'o de reset mais cedo');
  assert.equal(e.limiteDoPlanoAte('eu'), agora + 3600e3);
  let abriu = 0;
  e.runHeadlessReview = async () => { abriu++; };
  await e.runOneHeadless(prDe('o/r#2'), 'eu');
  assert.equal(abriu, 0, 'nenhuma sessão paga enquanto todos estão no limite');
  assert.equal(e.autoReviewParked.has('o/r#2'), false, 'nada estaciona');
  assert.equal(e.retryAfterNet.get('o/r#2').notBefore, agora + 3600e3);
  const tela = cadeiaMod.cadeiaParaTela(e, agora);
  assert.equal(tela.todosNoLimite, true);
  assert.deepEqual(tela.entradas.map((x) => x.estado), ['limite', 'limite', 'limite']);
});

test('limite sem hora: prazo estimado, visível, e a cadeia segue igual', async () => {
  const e = engineCom({ cadeia: TODOS_LIGADOS });
  e.runHeadlessReview = async () => {
    const auth = e.resolveClaudeAuth('eu');
    throw Object.assign(new Error("claude saiu com código 1: You've hit your limit"), { perfilDaSessao: auth });
  };
  await e.runOneHeadless(prDe('o/r#3'), 'eu');
  const tela = cadeiaMod.cadeiaParaTela(e);
  const x = tela.entradas.find((i) => i.id === 'gx');
  assert.equal(x.estado, 'limite');
  assert.equal(x.estimado, true);
  assert.equal(tela.entradas.find((i) => i.id === 'gy').estado, 'em-uso');
});

test('o limite trava o perfil que a sessão USOU, mesmo que a conta já resolva para outro', async () => {
  const e = engineCom({ cadeia: TODOS_LIGADOS });
  // outra sessão travou o Gemini X enquanto esta rodava no Gemini X também; a falha desta
  // chega depois e não pode travar o Gemini Y, que é para onde a conta já resolve
  e.runHeadlessReview = async () => {
    const auth = e.resolveClaudeAuth('eu');
    e.limitesDePlano.set('dir:/perfis/x', { ate: Date.now() + 3600e3, em: Date.now() });
    throw Object.assign(new Error(MSG_LIMITE), { perfilDaSessao: auth });
  };
  await e.runOneHeadless(prDe('o/r#4'), 'eu');
  assert.equal(e.limitesDePlano.has('dir:/perfis/y'), false);
  assert.equal(e.resolveClaudeAuth('eu').id, 'gy');
});

test('a sessão real estampa na falha a assinatura que usou (runProvedor, os dois ramos)', async () => {
  const e = engineCom({ cadeia: TODOS_LIGADOS });
  fs.mkdirSync(path.join(process.env.FAROL_HOME, 'workspace'), { recursive: true });
  process.env.FAROL_HEADLESS_CMD = `node -e "console.log(JSON.stringify({type:'result', is_error:true, result:'You have hit your limit', usage:{input_tokens:1,output_tokens:1}, total_cost_usd:0}))"`;
  try {
    await assert.rejects(() => runClaudeStream(e, 'x', { account: 'eu', id: 'a-cadeia' }), (err) => {
      assert.deepEqual(err.perfilDaSessao, { kind: 'dir', id: 'gx', dir: '/perfis/x' });
      assert.equal('apiKey' in err.perfilDaSessao, false, 'a chave nunca viaja no erro');
      return true;
    });
  } finally {
    delete process.env.FAROL_HEADLESS_CMD;
  }
  const erro = new Error('x');
  await assert.rejects(comPerfilDaSessao(e, Promise.reject(erro), { kind: 'apikey', id: 'k', apiKey: 'segredo' }));
  assert.deepEqual(erro.perfilDaSessao, { kind: 'apikey', id: 'k', dir: '' });
});

/* ---------- o que não pode ficar mais permissivo ---------- */

test('migração: a cadeia nasce do perfil padrão, ligado, e os outros perfis desligados', () => {
  const config = { claudeProfiles: [X, Y, Z], claudeProfileId: 'gy' };
  cadeiaMod.reconciliar(config);
  assert.deepEqual(config.cadeiaPerfis, [{ id: 'gy', ativo: true }, { id: 'gx', ativo: false }, { id: 'cmax', ativo: false }]);
  assert.equal(config.claudeProfileId, 'gy');
  const semPadrao = { claudeProfiles: [X], claudeProfileId: '' };
  cadeiaMod.reconciliar(semPadrao);
  assert.deepEqual(semPadrao.cadeiaPerfis, [{ id: 'gx', ativo: false }], 'sem padrão, ninguém passa a gastar');
  assert.equal(semPadrao.claudeProfileId, '');
  // idempotente
  const de2 = structuredClone(config);
  cadeiaMod.reconciliar(de2);
  assert.deepEqual(de2, config);
});

test('instalação existente sobe com o mesmo perfil de antes (boot do Engine)', () => {
  fs.writeFileSync(path.join(process.env.FAROL_HOME, 'config.json'), JSON.stringify({ claudeProfiles: [X, Y], claudeProfileId: 'gx', accounts: [{ user: 'eu', owners: ['o'] }] }));
  try {
    const e = new Engine();
    assert.deepEqual(e.config.cadeiaPerfis, [{ id: 'gx', ativo: true }, { id: 'gy', ativo: false }]);
    assert.equal(e.resolveClaudeAuth('eu').id, 'gx');
  } finally {
    fs.rmSync(path.join(process.env.FAROL_HOME, 'config.json'), { force: true });
  }
});

test('perfil novo entra desligado, perfil removido sai, e o padrão é sempre o primeiro ligado', () => {
  const e = engineCom({ cadeia: [{ id: 'gx', ativo: true }] });
  assert.deepEqual(e.config.cadeiaPerfis.map((c) => c.ativo), [true, false, false]);
  e.updateSettings({ cadeiaPerfis: [{ id: 'cmax', ativo: true }, { id: 'gx', ativo: true }, { id: 'nao-existe', ativo: true }] });
  assert.deepEqual(e.config.cadeiaPerfis, [{ id: 'cmax', ativo: true }, { id: 'gx', ativo: true }, { id: 'gy', ativo: false }]);
  assert.equal(e.config.claudeProfileId, 'cmax');
  e.updateSettings({ claudeProfiles: [X, Y] });
  assert.deepEqual(e.config.cadeiaPerfis, [{ id: 'gx', ativo: true }, { id: 'gy', ativo: false }]);
  assert.equal(e.config.claudeProfileId, 'gx');
});

test('conta com perfil próprio usa só ele: não transborda para a cadeia', () => {
  const e = engineCom({ cadeia: TODOS_LIGADOS });
  e.config.accounts = [{ user: 'eu', owners: ['o'], claudeProfileId: 'gx' }];
  e.limitesDePlano.set('dir:/perfis/x', { ate: Date.now() + 3600e3, em: Date.now() });
  assert.equal(e.resolveClaudeAuth('eu').id, 'gx');
  assert.ok(e.limiteDoPlanoAte('eu') > 0, 'a conta espera o reset do perfil dela, como antes');
});

test('orçamento estourado não troca de perfil: a automação pausa como antes', () => {
  const e = engineCom({ cadeia: TODOS_LIGADOS });
  e.profileBudgetStatus = (p) => ({ blocked: p.id === 'gx' });
  assert.equal(e.resolveClaudeAuth('eu').id, 'gx');
  assert.equal(e.budgetBlockedFor('eu').id, 'gx');
});

test('perfil sem login (pelo último diagnóstico) é pulado enquanto houver outro pronto', () => {
  const e = engineCom({ cadeia: TODOS_LIGADOS });
  e.doctorInfo = { claudeAuth: [{ id: 'gx', ready: false }, { id: 'gy', ready: true }] };
  assert.equal(e.resolveClaudeAuth('eu').id, 'gy');
  assert.equal(cadeiaMod.cadeiaParaTela(e).entradas[0].estado, 'sem-login');
  e.doctorInfo = { claudeAuth: [{ id: 'gx', ready: false }, { id: 'gy', ready: false }, { id: 'cmax', ready: false }] };
  assert.equal(e.resolveClaudeAuth('eu').id, 'gx', 'ninguém pronto: tenta o primeiro e mostra a falha, como a cadeia de um perfil só');
});

test('cadeia sem perfil ligado cai no login legado da máquina, como antes', () => {
  const e = engineCom({ cadeia: [] });
  e.config.claudeConfigDir = '';
  assert.deepEqual(e.resolveClaudeAuth('eu'), { kind: 'dir', id: '', dir: '' });
});

/* ---------- modelo por provedor ---------- */

test('cada perfil tem um provedor, e o modelo de um nunca vale para o outro', () => {
  assert.equal(prov.provedorDoPerfil(X).id, 'claude');
  assert.equal(prov.provedorDoPerfil({ kind: 'maquina' }).id, 'claude');
  assert.equal(prov.provedorDoPerfil({ kind: 'apikey' }).id, 'claude');
  assert.equal(prov.provedorDoPerfil(Z).id, 'codex');
  assert.equal(prov.provedorDoKind('agy').id, 'agy', 'o agy saiu dos reservados e roda (20/10/2026)');
  const config = { reviewModel: 'opus', reviewEffort: 'high', codexReviewModel: 'opus', codexReviewEffort: 'max', agyReviewModel: 'opus', agyReviewEffort: 'max' };
  assert.deepEqual(prov.modeloDoProvedor(config, 'claude'), { modelo: 'opus', esforco: 'high' });
  assert.deepEqual(prov.modeloDoProvedor(config, 'codex'), { modelo: '', esforco: '' }, 'alias do Claude não entra na linha do Codex');
  // alias do Claude e esforço max ficam fora do agy: o modelo cai no padrão medido
  assert.deepEqual(prov.modeloDoProvedor(config, 'agy'), { modelo: 'gemini-3.8-flash-high', esforco: '' });
  const tela = prov.provedoresParaTela(config);
  assert.deepEqual(tela.ativos.map((p) => p.id), ['claude', 'codex', 'agy']);
  assert.deepEqual(tela.reservados.map((p) => p.id), []);
});

test('o limite de cada provedor é lido pela tabela única de falhas', () => {
  const agora = new Date(2026, 9, 20, 12, 0).getTime();
  const lido = prov.limiteDaMensagem('codex', "You've hit your usage limit · resets 5:50pm", agora);
  assert.equal(lido.limite, true);
  assert.equal(new Date(lido.ate).getHours(), 17);
  assert.deepEqual(prov.limiteDaMensagem('claude', 'ECONNRESET', agora), { limite: false, ate: null });
  assert.deepEqual(prov.limiteDaMensagem('claude', "You've hit your limit", agora), { limite: true, ate: null });
});

/* ---------- revisão do PR #263 ---------- */

test('sessão que conclui libera o perfil que ELA usou, não o que a conta resolve agora', async () => {
  const e = engineCom({ cadeia: TODOS_LIGADOS });
  // duas sessões começaram no Gemini X; uma estourou e travou o X, a conta já resolve para o Y
  e.limitesDePlano.set('dir:/perfis/x', { ate: Date.now() + 3600e3, em: Date.now(), estimado: true });
  e.limitesDePlano.set('dir:/perfis/y', { ate: Date.now() + 1800e3, em: Date.now() });
  await comPerfilDaSessao(e, Promise.resolve({ text: 'ok' }), { kind: 'dir', id: 'gx', dir: '/perfis/x' });
  assert.equal(e.limitesDePlano.has('dir:/perfis/x'), false, 'a outra sessão no X concluiu: o X voltou');
  assert.equal(e.limitesDePlano.has('dir:/perfis/y'), true, 'o Y continua no limite dele');
  assert.equal(e.resolveClaudeAuth('eu').id, 'gx');
});

test('a cota do Codex é limite do plano: a cadeia troca de perfil em vez de estacionar', async () => {
  // a mensagem que lib/codex/stream.js monta (erroDeCotaCodex)
  const msg = 'codex: cota do plano atingida; resets 5:50pm';
  assert.equal(classify(msg).kind, 'espera-reset');
  assert.equal(new Date(prov.limiteDaMensagem('codex', msg).ate).getHours(), 17);
  const e = engineCom({ cadeia: [{ id: 'cmax', ativo: true }, { id: 'gx', ativo: true }, { id: 'gy', ativo: false }] });
  e.runHeadlessReview = async () => {
    throw Object.assign(new Error(msg), { perfilDaSessao: { kind: 'codex', id: 'cmax', dir: '' } });
  };
  await e.runOneHeadless(prDe('o/r#9'), 'eu');
  assert.equal(e.autoReviewParked.has('o/r#9'), false);
  assert.equal(e.retryAfterNet.get('o/r#9').notBefore, null);
  assert.equal(e.resolveClaudeAuth('eu').id, 'gx');
});

test('perfis Codex dividem a mesma cota: o limite de um vale para todos', () => {
  const e = engineCom({ cadeia: [] });
  e.config.claudeProfiles = [{ id: 'c1', label: 'Codex 1', kind: 'codex' }, { id: 'c2', label: 'Codex 2', kind: 'codex' }, X];
  e.config.cadeiaPerfis = [{ id: 'c1', ativo: true }, { id: 'c2', ativo: true }, { id: 'gx', ativo: true }];
  e.limitesDePlano.set('codex:', { ate: Date.now() + 3600e3, em: Date.now() });
  assert.equal(e.resolveClaudeAuth('eu').id, 'gx', 'o segundo Codex é o mesmo login esgotado: a cadeia pula para o Gemini X');
});

test('Codex sem login no plano ChatGPT é pulado enquanto houver outro pronto', () => {
  const e = engineCom({ cadeia: [{ id: 'cmax', ativo: true }, { id: 'gx', ativo: true }, { id: 'gy', ativo: false }] });
  e.doctorInfo = { codexChatGPT: false, claudeAuth: [{ id: 'cmax', ready: true }, { id: 'gx', ready: true }] };
  assert.equal(e.resolveClaudeAuth('eu').id, 'gx');
  assert.equal(cadeiaMod.cadeiaParaTela(e).entradas[0].estado, 'sem-login');
});

test('reset citado pelo provedor substitui o prazo estimado, mesmo mais cedo', async () => {
  const e = engineCom({ cadeia: TODOS_LIGADOS });
  const { registrarLimite } = await import('../lib/engine/limite-plano.js');
  const agora = Date.now();
  const auth = { kind: 'dir', id: 'gx', dir: '/perfis/x' };
  registrarLimite(e, 'eu', agora + 3600e3, agora, { auth, estimado: true });
  registrarLimite(e, 'eu', agora + 600e3, agora, { auth });
  assert.deepEqual(e.limitesDePlano.get('dir:/perfis/x'), { ate: agora + 600e3, em: agora, estimado: false });
  // e um novo palpite não desfaz o reset confirmado
  registrarLimite(e, 'eu', agora + 300e3, agora, { auth, estimado: true });
  assert.equal(e.limitesDePlano.get('dir:/perfis/x').ate, agora + 600e3);
});

test('trocar de perfil não gasta o teto de tentativas, nem estaciona com perfil livre', async () => {
  const e = engineCom({ cadeia: TODOS_LIGADOS });
  e.retryAfterNet.set('o/r#10', { tries: 12, pr: prDe('o/r#10'), notBefore: null });
  sessaoQueEstouraEm(e, ['gx'], []);
  await e.runOneHeadless(prDe('o/r#10'), 'eu');
  assert.equal(e.autoReviewParked.has('o/r#10'), false, 'com o Gemini Y livre, o PR não estaciona');
  assert.equal(e.retryAfterNet.get('o/r#10').tries, 12, 'a troca não conta como tentativa');
  assert.equal(e.limitesDePlano.has('dir:/perfis/x'), true, 'o limite do X fica registrado mesmo no teto');
});

test('pushback sem hora de reset trava o perfil usado por prazo estimado e deixa a cadeia seguir', () => {
  const e = engineCom({ cadeia: TODOS_LIGADOS });
  const agora = Date.now();
  const ate = pushback.default.esperarResetDePlano(e, "sessão retornou erro: You've hit your limit", agora, 'eu', { kind: 'dir', id: 'gx', dir: '/perfis/x' });
  assert.equal(ate, agora + 3600e3);
  assert.equal(e.limitesDePlano.get('dir:/perfis/x').estimado, true);
  assert.equal(pushback.default.esperandoResetDePlano(e, agora), false, 'a varredura não para inteira: o próximo perfil atende');
  assert.equal(e.resolveClaudeAuth('eu').id, 'gy');
});
