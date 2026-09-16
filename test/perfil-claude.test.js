// Plano e chaves explícito (spec 7.A2), o comportamento. A tela sai do Claude Design; aqui
// se prova o que ela vai consumir: o teste do perfil como ATO EXPLÍCITO (nada é gravado),
// a origem de cada informação, o fim da queda silenciosa para o legado e a adoção guiada
// que só grava com confirmação. Nenhum `claude` real roda: o io.runShell é trocado.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-perfil-claude-'));
process.env.FAROL_HOME = path.join(BASE, 'farol');

import { test, after, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const io = (await import('../lib/io.js')).default;
const { Engine } = await import('../server.js');
const { problemasDePerfil, authFromProfile } = await import('../lib/engine/perfil-claude.js');
const { runtimeChecks } = await import('../ui/pure.js');
const { sessionExit } = await import('../lib/engine/session.js');
const { startServer } = await import('../lib/http-server.js');

const runShellReal = io.runShell;
let comandos = [];
let respostaStatus = null;

io.runShell = async (linha, opts) => {
  comandos.push({ linha, env: (opts && opts.env) || null });
  if (/^claude auth status --json$/.test(linha)) return respostaStatus;
  return runShellReal(linha, opts);
};

after(() => {
  io.runShell = runShellReal;
  try { fs.rmSync(BASE, { recursive: true, force: true }); } catch { /* best-effort */ }
});

beforeEach(() => {
  comandos = [];
  respostaStatus = null;
  // credencial da máquina plantada de propósito: o teste do perfil não pode herdá-la
  process.env.ANTHROPIC_API_KEY = 'sk-ant-da-maquina-nao-deve-vazar';
  process.env.ANTHROPIC_AUTH_TOKEN = 'token-da-maquina';
  process.env.GH_TOKEN = 'gh-da-maquina';
});

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  delete process.env.GH_TOKEN;
});

const DIR_A = path.join(BASE, 'claude-a');
fs.mkdirSync(DIR_A, { recursive: true });
fs.writeFileSync(path.join(DIR_A, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'lida@exemplo.com' } }));

function engineCom(config) {
  const e = new Engine();
  e.log = () => { };
  e.pushState = () => { };
  e.doctor = async () => ({});
  Object.assign(e.config, config);
  return e;
}

function configEmDisco() {
  const arq = path.join(process.env.FAROL_HOME, 'config.json');
  return fs.existsSync(arq) ? fs.readFileSync(arq, 'utf8') : '';
}

// --- queda silenciosa -----------------------------------------------------------

test('perfil padrão apontando para id que não existe é problema, não "usa o padrão"', () => {
  const p = problemasDePerfil({ claudeProfiles: [{ id: 'p1', label: 'A', dir: DIR_A }], claudeProfileId: 'sumiu', accounts: [] });
  assert.deepEqual(p, [{ escopo: 'padrao', user: '', profileId: 'sumiu', code: 'perfil-inexistente' }]);
});

test('override de conta para id inexistente é problema da conta', () => {
  const p = problemasDePerfil({ claudeProfiles: [{ id: 'p1', label: 'A', dir: DIR_A }], claudeProfileId: 'p1', accounts: [{ user: 'conta-x', claudeProfileId: 'apagado' }] });
  assert.deepEqual(p, [{ escopo: 'conta', user: 'conta-x', profileId: 'apagado', code: 'perfil-inexistente' }]);
});

test('id preenchido com a lista de perfis vazia também é problema (a cascata ignora o id)', () => {
  const p = problemasDePerfil({ claudeProfiles: [], claudeProfileId: 'p9', accounts: [] });
  assert.equal(p[0].code, 'perfil-inexistente');
});

test('perfil que existe mas não resolve (sem chave, sem pasta) é inválido', () => {
  const p = problemasDePerfil({ claudeProfiles: [{ id: 'k1', label: 'Chave', kind: 'apikey', apiKey: '' }], claudeProfileId: 'k1', accounts: [] });
  assert.equal(p[0].code, 'perfil-invalido');
});

test('configuração saudável não tem problema, e sem id nenhum também não', () => {
  assert.deepEqual(problemasDePerfil({ claudeProfiles: [{ id: 'p1', label: 'A', dir: DIR_A }], claudeProfileId: 'p1', accounts: [{ user: 'c', claudeProfileId: 'p1' }] }), []);
  assert.deepEqual(problemasDePerfil({ claudeProfiles: [], claudeProfileId: '', accounts: [{ user: 'c' }] }), []);
});

test('o snapshot leva os problemas, e o Diagnóstico mostra um check por problema', () => {
  const e = engineCom({ claudeProfiles: [{ id: 'p1', label: 'A', dir: DIR_A }], claudeProfileId: 'sumiu', accounts: [] });
  const s = e.snapshot();
  assert.equal(s.claudePerfis.problemas.length, 1);
  const checks = runtimeChecks({}, {}, s.claudePerfis);
  const alvo = checks.find((c) => c.label === 'Perfil de assinatura');
  assert.ok(alvo, 'check presente');
  assert.equal(alvo.ok, false);
  assert.match(alvo.detail, /não existe/);
  assert.doesNotMatch(alvo.detail, /usa o padrão/i);
  assert.equal(alvo.goto, 'sys:plans:#claudeProfilesManager');
});

test('sem problema, nenhum check de perfil aparece', () => {
  assert.equal(runtimeChecks({}, {}, { problemas: [] }).some((c) => c.label === 'Perfil de assinatura'), false);
  assert.equal(runtimeChecks({}, {}).some((c) => c.label === 'Perfil de assinatura'), false);
});

test('a resolução real usa a mesma regra de perfil utilizável', () => {
  assert.equal(authFromProfile({ id: 'k', kind: 'apikey', apiKey: '' }), null);
  assert.deepEqual(authFromProfile({ id: 'p', dir: DIR_A }), { kind: 'dir', id: 'p', dir: DIR_A });
  const e = engineCom({ claudeProfiles: [{ id: 'p1', label: 'A', dir: DIR_A }], claudeProfileId: 'p1', accounts: [] });
  assert.equal(e.resolveClaudeAuth('qualquer').dir, DIR_A);
});

// --- teste explícito do perfil --------------------------------------------------

test('testar um perfil de assinatura consulta o CLI naquele diretório e marca o que foi validado', async () => {
  const e = engineCom({ claudeProfiles: [{ id: 'p1', label: 'Trabalho', dir: DIR_A }], claudeProfileId: 'p1', accounts: [] });
  const antes = configEmDisco();
  respostaStatus = { ok: true, code: 0, stdout: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'validada@exemplo.com', subscriptionType: 'max' }), stderr: '' };
  const r = await e.claudeTestarPerfil({ profileId: 'p1' });
  assert.equal(r.ok, true);
  assert.equal(r.escreveu, false);
  assert.equal(configEmDisco(), antes, 'testar não grava a configuração');
  const c = r.perfil.campos;
  assert.deepEqual(c.configDir, { valor: DIR_A, origem: 'informado' });
  assert.deepEqual(c.login, { valor: true, origem: 'validado' });
  assert.deepEqual(c.email, { valor: 'validada@exemplo.com', origem: 'validado' });
  assert.deepEqual(c.tipoAuth, { valor: 'claude.ai', origem: 'validado' });
  assert.equal(c.plano.valor, null, 'o nome do plano não é exposto, mesmo quando o CLI manda algo');
  assert.equal(c.plano.origem, 'desconhecido');
  assert.match(c.plano.motivo, /não é detectável/);
  assert.equal(r.perfil.label, 'Trabalho');
  const chamada = comandos.find((x) => x.linha === 'claude auth status --json');
  assert.ok(chamada, 'o CLI foi consultado');
  assert.equal(chamada.env.CLAUDE_CONFIG_DIR, DIR_A);
  // a chave e o token estavam NO AMBIENTE deste processo (o beforeEach os planta): sem a
  // limpeza da sessão de login, o teste do perfil responderia pela credencial da máquina
  assert.equal(chamada.env.ANTHROPIC_API_KEY, undefined, 'credencial da máquina não vaza para o teste');
  assert.equal(chamada.env.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.equal(chamada.env.GH_TOKEN, undefined);
});

test('CLI sem login (código 1 com JSON) é resposta válida: login falso, validado', async () => {
  const e = engineCom({ claudeProfiles: [{ id: 'p1', label: 'A', dir: DIR_A }], claudeProfileId: 'p1', accounts: [] });
  respostaStatus = { ok: false, code: 1, stdout: JSON.stringify({ loggedIn: false, authMethod: 'none' }), stderr: '' };
  const r = await e.claudeTestarPerfil({ profileId: 'p1' });
  assert.deepEqual(r.perfil.campos.login, { valor: false, origem: 'validado' });
  assert.deepEqual(r.perfil.campos.email, { valor: 'lida@exemplo.com', origem: 'detectado' }, 'o e-mail do arquivo continua como detectado, não validado');
});

test('CLI que não responde vira inferência do arquivo, nunca validação', async () => {
  const e = engineCom({ claudeProfiles: [{ id: 'p1', label: 'A', dir: DIR_A }], claudeProfileId: 'p1', accounts: [] });
  respostaStatus = { ok: false, code: 'ENOENT', stdout: '', stderr: 'claude não encontrado' };
  const r = await e.claudeTestarPerfil({ profileId: 'p1' });
  assert.equal(r.ok, true);
  assert.equal(r.perfil.campos.login.origem, 'inferido');
  assert.equal(r.perfil.campos.tipoAuth.origem, 'desconhecido');
  assert.equal(r.perfil.campos.email.origem, 'detectado');
  assert.match(r.perfil.aviso, /não respondeu/);
});

test('testar perfil que não existe devolve erro, sem cair no padrão', async () => {
  const e = engineCom({ claudeProfiles: [{ id: 'p1', label: 'A', dir: DIR_A }], claudeProfileId: 'p1', accounts: [] });
  const r = await e.claudeTestarPerfil({ profileId: 'apagado' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'perfil-inexistente');
  assert.equal(comandos.length, 0, 'nada roda para um perfil que não existe');
});

test('perfil de chave de API: nada roda, a chave nunca sai e a origem é informado', async () => {
  const e = engineCom({ claudeProfiles: [{ id: 'k1', label: 'Chave', kind: 'apikey', apiKey: 'sk-ant-segredo-de-teste-123456', baseUrl: '' }], claudeProfileId: 'k1', accounts: [] });
  const r = await e.claudeTestarPerfil({ profileId: 'k1' });
  assert.equal(r.ok, true);
  assert.equal(comandos.length, 0);
  assert.equal(JSON.stringify(r).includes('sk-ant-segredo'), false);
  assert.deepEqual(r.perfil.campos.tipoAuth, { valor: 'chave-de-api', origem: 'informado' });
  assert.equal(r.perfil.campos.login.origem, 'desconhecido');
});

test('sem id, o teste é do padrão da máquina, com a pasta como inferida', async () => {
  const e = engineCom({ claudeProfiles: [], claudeProfileId: '', claudeConfigDir: '', accounts: [] });
  respostaStatus = { ok: true, code: 0, stdout: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' }), stderr: '' };
  const r = await e.claudeTestarPerfil({});
  assert.equal(r.perfil.id, '');
  assert.equal(r.perfil.campos.configDir.origem, 'inferido');
  assert.equal(r.perfil.campos.email.origem === 'validado', false, 'sem e-mail na resposta, não há e-mail validado');
});

// --- adoção guiada do legado ----------------------------------------------------

test('adotar sem confirmar só mostra a prévia e não grava nada', async () => {
  const e = engineCom({ claudeProfiles: [], claudeProfileId: '', claudeConfigDir: DIR_A, accounts: [] });
  const antes = configEmDisco();
  const r = e.claudeAdotarLegado({});
  assert.equal(r.ok, true);
  assert.equal(r.escreveu, false);
  assert.equal(r.precisaConfirmar, true);
  assert.equal(r.perfil.dir, DIR_A);
  assert.deepEqual(e.config.claudeProfiles, []);
  assert.equal(configEmDisco(), antes);
});

test('adotar com confirmação cria o perfil e o marca como padrão', async () => {
  const e = engineCom({ claudeProfiles: [], claudeProfileId: '', claudeConfigDir: DIR_A, accounts: [] });
  const r = e.claudeAdotarLegado({ confirmar: true, label: 'Minha assinatura' });
  assert.equal(r.ok, true);
  assert.equal(r.escreveu, true);
  assert.equal(e.config.claudeProfiles.length, 1);
  assert.equal(e.config.claudeProfiles[0].dir, DIR_A);
  assert.equal(e.config.claudeProfiles[0].label, 'Minha assinatura');
  assert.equal(e.config.claudeProfileId, e.config.claudeProfiles[0].id);
  assert.match(configEmDisco(), /Minha assinatura/);
});

test('confirmação que não é true literal não grava', () => {
  const e = engineCom({ claudeProfiles: [], claudeProfileId: '', claudeConfigDir: DIR_A, accounts: [] });
  assert.equal(e.claudeAdotarLegado({ confirmar: 'sim' }).escreveu, false);
  assert.deepEqual(e.config.claudeProfiles, []);
});

test('quem já tem perfil ou usa o padrão da máquina não tem o que adotar', () => {
  const comPerfil = engineCom({ claudeProfiles: [{ id: 'p1', label: 'A', dir: DIR_A }], claudeProfileId: 'p1', accounts: [] });
  assert.equal(comPerfil.claudeAdotarLegado({ confirmar: true }).code, 'ja-tem-perfis');
  const semPasta = engineCom({ claudeProfiles: [], claudeProfileId: '', claudeConfigDir: '', accounts: [] });
  const r = semPasta.claudeAdotarLegado({ confirmar: true });
  assert.equal(r.code, 'padrao-da-maquina');
  assert.deepEqual(semPasta.config.claudeProfiles, []);
});

// --- selo depois do login ---------------------------------------------------------

function engineDeSessao() {
  return {
    activeReviews: new Map(),
    doctorChamado: 0,
    doctor() { this.doctorChamado++; return Promise.resolve({}); },
    log() { }, emit() { }, pushState() { }, checkNow() { }, unsee() { },
  };
}

test('no macOS e no Linux, o fim da sessão de login reatualiza o doctor (o selo muda sem clique)', () => {
  const e = engineDeSessao();
  e.activeReviews.set('t1', { id: 't1', keys: [], label: 'Login do Claude', mode: 'terminal', login: true });
  sessionExit(e, 't1');
  assert.equal(e.doctorChamado, 1);
});

test('sessão de revisão que termina não dispara o doctor', () => {
  const e = engineDeSessao();
  e.activeReviews.set('t2', { id: 't2', keys: [], label: 'Revisão', mode: 'terminal' });
  sessionExit(e, 't2');
  assert.equal(e.doctorChamado, 0);
});

// --- as rotas --------------------------------------------------------------------

test('as rotas fazem o mesmo que as fachadas, e a adoção pela rota exige confirmação literal', async () => {
  const e = engineCom({ claudeProfiles: [], claudeProfileId: '', claudeConfigDir: DIR_A, accounts: [] });
  e.config.port = 0;
  const server = await new Promise((resolve, reject) => {
    const s = startServer(e, (url, err) => (err ? reject(err) : resolve(s)));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  // node:http, não fetch: o agente com keep-alive do fetch segura socket e o
  // --test-force-exit da suíte derruba o processo com assert do libuv no Windows
  const pedir = (rota, corpo) => new Promise((resolve, reject) => {
    const dados = JSON.stringify(corpo);
    const req = http.request(base + rota, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-farol': '1', 'Content-Length': Buffer.byteLength(dados), Connection: 'close' },
    }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve(JSON.parse(d)));
    });
    req.on('error', reject);
    req.end(dados);
  });
  try {
    respostaStatus = { ok: true, code: 0, stdout: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' }), stderr: '' };
    const teste = await pedir('/api/claude/profile-test', {});
    assert.equal(teste.ok, true);
    assert.equal(teste.escreveu, false);

    const semConfirmar = await pedir('/api/claude/profile-adopt', { label: 'X' });
    assert.equal(semConfirmar.escreveu, false);
    assert.equal(semConfirmar.precisaConfirmar, true);
    assert.deepEqual(e.config.claudeProfiles, [], 'a rota sem confirmação não grava nada');

    const valorQualquer = await pedir('/api/claude/profile-adopt', { confirmar: 'sim', label: 'X' });
    assert.equal(valorQualquer.escreveu, false, 'confirmação que não é true literal não grava');
    assert.deepEqual(e.config.claudeProfiles, []);

    const confirmado = await pedir('/api/claude/profile-adopt', { confirmar: true, label: 'Pela rota' });
    assert.equal(confirmado.escreveu, true);
    assert.equal(e.config.claudeProfiles.length, 1);
    assert.equal(e.config.claudeProfiles[0].label, 'Pela rota');
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(() => resolve()));
  }
});
