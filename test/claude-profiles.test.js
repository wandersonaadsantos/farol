'use strict';
// Perfis de assinatura Claude por conta: resolver + claudeAuthInfo parametrizado.
// Segue o padrão de boot.test.js (Engine real contra FAROL_HOME temporário).
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const HOME = path.join(os.tmpdir(), 'farol-test-claude-profiles-' + process.pid);
process.env.FAROL_HOME = HOME;

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { Engine } = require('../server.js');

after(() => { try { fs.rmSync(HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

test('resolveClaudeConfigDir: sem profiles, cai no legado (claudeConfigDir)', () => {
  const engine = new Engine();
  engine.config.claudeConfigDir = 'C:\\legado';
  engine.config.claudeProfiles = [];
  assert.equal(engine.resolveClaudeConfigDir('alice'), 'C:\\legado');
  assert.equal(engine.resolveClaudeConfigDir(undefined), 'C:\\legado');
});

test('resolveClaudeConfigDir: com profiles, sem override de conta, usa o padrão global', () => {
  const engine = new Engine();
  engine.config.claudeConfigDir = 'C:\\legado'; // não deve ser usado
  engine.config.claudeProfiles = [
    { id: 'trabalho', label: 'BIUD Trabalho', dir: 'C:\\biud-trabalho' },
    { id: 'pessoal', label: 'Pessoal Max', dir: 'C:\\pessoal' }
  ];
  engine.config.claudeProfileId = 'pessoal';
  engine.config.accounts = [{ user: 'alice', owners: ['x'] }]; // sem claudeProfileId próprio
  assert.equal(engine.resolveClaudeConfigDir('alice'), 'C:\\pessoal');
});

test('resolveClaudeConfigDir: com profiles, override por conta vence o padrão global', () => {
  const engine = new Engine();
  engine.config.claudeProfiles = [
    { id: 'trabalho', label: 'BIUD Trabalho', dir: 'C:\\biud-trabalho' },
    { id: 'pessoal', label: 'Pessoal Max', dir: 'C:\\pessoal' }
  ];
  engine.config.claudeProfileId = 'pessoal';
  engine.config.accounts = [{ user: 'bob', owners: ['biudtech'], claudeProfileId: 'trabalho' }];
  assert.equal(engine.resolveClaudeConfigDir('bob'), 'C:\\biud-trabalho');
});

test('resolveClaudeConfigDir: id aponta pra perfil inexistente, cai no legado', () => {
  const engine = new Engine();
  engine.config.claudeConfigDir = 'C:\\legado';
  engine.config.claudeProfiles = [{ id: 'trabalho', label: 'BIUD Trabalho', dir: 'C:\\biud-trabalho' }];
  engine.config.claudeProfileId = 'id-que-nao-existe';
  engine.config.accounts = [{ user: 'carol', owners: [] }];
  assert.equal(engine.resolveClaudeConfigDir('carol'), 'C:\\legado');
});

test('resolveClaudeConfigDir: perfil encontrado mas com dir vazio/ausente cai no legado', () => {
  const engine = new Engine();
  engine.config.claudeConfigDir = 'C:\\legado';
  engine.config.claudeProfiles = [{ id: 'quebrado', label: 'Sem dir', dir: '' }];
  engine.config.claudeProfileId = 'quebrado';
  assert.equal(engine.resolveClaudeConfigDir('qualquer'), 'C:\\legado');
});

test('resolveClaudeConfigDir: sem user informado usa o padrão global/legado normalmente', () => {
  const engine = new Engine();
  engine.config.claudeProfiles = [{ id: 'p1', label: 'P1', dir: 'C:\\p1' }];
  engine.config.claudeProfileId = 'p1';
  assert.equal(engine.resolveClaudeConfigDir(), 'C:\\p1');
});

// resolveConfigDirForLogin: dir de um perfil ESPECÍFICO pelo id, pra "abrir sessão de
// login" sem depender de conta GitHub nenhuma (é uma escolha direta de assinatura, não
// uma revisão de PR) - ver Fix 2 (sessão de login dedicada).
test('resolveConfigDirForLogin: profileId encontrado devolve o dir daquele perfil', () => {
  const engine = new Engine();
  engine.config.claudeProfiles = [{ id: 'p1', label: 'P1', dir: 'C:\\p1' }];
  assert.equal(engine.resolveConfigDirForLogin('p1'), 'C:\\p1');
});

test('resolveConfigDirForLogin: profileId vazio ou nao encontrado cai no legado', () => {
  const engine = new Engine();
  engine.config.claudeConfigDir = 'C:\\legado';
  engine.config.claudeProfiles = [{ id: 'p1', label: 'P1', dir: 'C:\\p1' }];
  assert.equal(engine.resolveConfigDirForLogin(''), 'C:\\legado');
  assert.equal(engine.resolveConfigDirForLogin('id-que-nao-existe'), 'C:\\legado');
});

test('resolveConfigDirForLogin: perfil encontrado mas sem dir cai no legado', () => {
  const engine = new Engine();
  engine.config.claudeConfigDir = 'C:\\legado';
  engine.config.claudeProfiles = [{ id: 'quebrado', label: 'Sem dir', dir: '' }];
  assert.equal(engine.resolveConfigDirForLogin('quebrado'), 'C:\\legado');
});

test('ghEnv: injeta CLAUDE_CONFIG_DIR do perfil da conta', () => {
  const engine = new Engine();
  engine.config.claudeProfiles = [
    { id: 'trabalho', label: 'BIUD Trabalho', dir: 'C:\\biud-trabalho' },
    { id: 'pessoal', label: 'Pessoal Max', dir: 'C:\\pessoal' }
  ];
  engine.config.claudeProfileId = 'pessoal';
  engine.config.accounts = [
    { user: 'bob', owners: ['biudtech'], claudeProfileId: 'trabalho' },
    { user: 'alice', owners: ['lovelace-eng'] }
  ];
  assert.equal(engine.ghEnv('bob').CLAUDE_CONFIG_DIR, 'C:\\biud-trabalho');
  assert.equal(engine.ghEnv('alice').CLAUDE_CONFIG_DIR, 'C:\\pessoal');
});

test('ghEnv: sem profiles, comportamento legado (claudeConfigDir global ou nenhum)', () => {
  const engine = new Engine();
  engine.config.claudeProfiles = [];
  engine.config.claudeConfigDir = '';
  assert.equal('CLAUDE_CONFIG_DIR' in engine.ghEnv('qualquer'), false);
  engine.config.claudeConfigDir = 'C:\\legado';
  assert.equal(engine.ghEnv('qualquer').CLAUDE_CONFIG_DIR, 'C:\\legado');
});

const fsMod = require('node:fs');

test('claudeAuthInfo: sem argumento, comportamento legado (lê config.claudeConfigDir)', () => {
  const engine = new Engine();
  engine.config.claudeConfigDir = '';
  const info = engine.claudeAuthInfo();
  assert.equal(info.configDir, null);
  assert.equal(info.ready, true); // sem dir próprio, assume ok (padrão da máquina)
});

test('claudeAuthInfo: dir explícito sem .credentials.json reporta SEM LOGIN', () => {
  const engine = new Engine();
  const dir = path.join(HOME, 'perfil-sem-login');
  fsMod.mkdirSync(dir, { recursive: true });
  const info = engine.claudeAuthInfo(dir);
  assert.equal(info.configDir, dir);
  assert.equal(info.ready, false);
  assert.equal(info.account, null);
});

test('claudeAuthInfo: dir explícito com .credentials.json reporta ready', () => {
  const engine = new Engine();
  const dir = path.join(HOME, 'perfil-logado');
  fsMod.mkdirSync(dir, { recursive: true });
  fsMod.writeFileSync(path.join(dir, '.credentials.json'), '{}');
  fsMod.writeFileSync(path.join(dir, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'x@biud.com.br' } }));
  const info = engine.claudeAuthInfo(dir);
  assert.equal(info.ready, true);
  assert.equal(info.account, 'x@biud.com.br');
});

test('allClaudeAuthInfo: sem profiles, devolve 1 entrada sintética "Padrão"', () => {
  const engine = new Engine();
  engine.config.claudeProfiles = [];
  const all = engine.allClaudeAuthInfo();
  assert.equal(all.length, 1);
  assert.equal(all[0].id, '');
  assert.equal(all[0].label, 'Padrão');
});

test('allClaudeAuthInfo: com profiles, devolve a entrada legado "" primeiro, depois 1 por perfil, na ordem', () => {
  const engine = new Engine();
  engine.config.claudeProfiles = [
    { id: 'a', label: 'A', dir: path.join(HOME, 'a') },
    { id: 'b', label: 'B', dir: path.join(HOME, 'b') }
  ];
  const all = engine.allClaudeAuthInfo();
  // entrada '' sempre presente (fix da revisão final): sem ela, o badge de quem usa o
  // padrão global vazio ("Padrão da máquina") não tinha nenhum dado do doctor pra mostrar.
  assert.deepEqual(all.map(x => x.id), ['', 'a', 'b']);
  assert.deepEqual(all.map(x => x.label), ['Padrão', 'A', 'B']);
  assert.equal(all.find(x => x.id === 'a').configDir, path.join(HOME, 'a'));
});

test('allClaudeAuthInfo: com profiles e claudeProfileId vazio, a entrada "" reflete o fallback legado (fix 1b/bonus)', () => {
  const engine = new Engine();
  engine.config.claudeConfigDir = 'C:\\legado-visivel';
  engine.config.claudeProfiles = [{ id: 'a', label: 'A', dir: path.join(HOME, 'a') }];
  engine.config.claudeProfileId = '';
  const all = engine.allClaudeAuthInfo();
  const legacyEntry = all.find(x => x.id === '');
  assert.ok(legacyEntry, 'entrada "" existe mesmo com perfis salvos');
  // mesma lógica de claudeAuthInfo() sem argumento: lê o claudeConfigDir legado.
  assert.equal(legacyEntry.configDir, 'C:\\legado-visivel');
});

test('updateSettings: persiste claudeProfiles e claudeProfileId globais', () => {
  const engine = new Engine();
  engine.updateSettings({
    claudeProfiles: [
      { id: 'trabalho', label: 'BIUD Trabalho', dir: 'C:\\biud-trabalho' },
      { id: 'sem-dir', label: 'Incompleto', dir: '' } // descartado (sem dir)
    ],
    claudeProfileId: 'trabalho'
  });
  assert.deepEqual(engine.config.claudeProfiles, [{ id: 'trabalho', label: 'BIUD Trabalho', dir: 'C:\\biud-trabalho' }]);
  assert.equal(engine.config.claudeProfileId, 'trabalho');
});

test('updateSettings: persiste claudeProfileId por conta via accounts[]', () => {
  const engine = new Engine();
  engine.updateSettings({
    accounts: [{ user: 'bob', owners: ['biudtech'], claudeProfileId: 'trabalho' }]
  });
  assert.equal(engine.config.accounts[0].claudeProfileId, 'trabalho');
  assert.equal(engine.accountList()[0].claudeProfileId, 'trabalho');
  const snap = engine.snapshot();
  assert.equal(snap.accounts[0].claudeProfileId, 'trabalho');
});

test('updateSettings: accounts sozinho NÃO redispara doctor (allClaudeAuthInfo não lê accounts)', async () => {
  const engine = new Engine();
  let doctorCalls = 0;
  const originalDoctor = engine.doctor.bind(engine);
  engine.doctor = (...args) => { doctorCalls++; return originalDoctor(...args); };
  engine.updateSettings({ accounts: [{ user: 'dave', owners: [] }] });
  await new Promise(r => setTimeout(r, 30));
  assert.equal(doctorCalls, 0, 'editar accounts não deveria recalcular doctor - achado da revisão final');
});

test('updateSettings: claudeProfiles/claudeProfileId continuam disparando doctor normalmente', async () => {
  const engine = new Engine();
  let doctorCalls = 0;
  const originalDoctor = engine.doctor.bind(engine);
  engine.doctor = (...args) => { doctorCalls++; return originalDoctor(...args); };
  engine.updateSettings({ claudeProfileId: 'x' });
  await new Promise(r => setTimeout(r, 30));
  assert.equal(doctorCalls, 1);
});

test('boot com config.json malformado (claudeProfiles string, claudeProfileId número): normaliza no construtor, não crasha (execução real em processo novo)', () => {
  // processo próprio (não o deste arquivo de teste): CONFIG_FILE/HOME são consts de
  // módulo lidas no require, então só um processo novo prova o boot real com o
  // config.json malformado já em disco ANTES do require('../server.js').
  const { execFileSync } = require('node:child_process');
  const badHome = path.join(os.tmpdir(), 'farol-test-malformed-boot-' + process.pid + '-' + Date.now());
  fsMod.mkdirSync(badHome, { recursive: true });
  fsMod.writeFileSync(path.join(badHome, 'config.json'), JSON.stringify({
    claudeProfiles: 'abc', // string, não array: .find/.map lançariam TypeError sem o fix
    claudeProfileId: 123,  // número: sem o fix, ficaria cru (não é o crash em si, mas deve normalizar)
  }));
  const script = `
    process.env.FAROL_HOME = ${JSON.stringify(badHome)};
    const { Engine } = require(${JSON.stringify(path.join(__dirname, '..', 'server.js'))});
    const e = new Engine();
    const dir = e.resolveClaudeConfigDir('qualquer');
    const auth = e.allClaudeAuthInfo();
    const env = e.ghEnv('qualquer');
    console.log(JSON.stringify({
      claudeProfiles: e.config.claudeProfiles,
      claudeProfileId: e.config.claudeProfileId,
      dir, authLen: auth.length, hasEnv: 'CLAUDE_CONFIG_DIR' in env,
    }));
  `;
  let out;
  try {
    out = execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  } finally {
    fsMod.rmSync(badHome, { recursive: true, force: true });
  }
  const parsed = JSON.parse(out.trim().split('\n').pop());
  assert.deepEqual(parsed.claudeProfiles, [], 'claudeProfiles malformado (string) normaliza pra []');
  assert.equal(parsed.claudeProfileId, '123', 'claudeProfileId normaliza pra string');
  assert.equal(parsed.dir, '', 'resolveClaudeConfigDir não lança, cai no legado vazio');
  assert.equal(parsed.authLen, 1, 'allClaudeAuthInfo não lança, devolve só a entrada legado');
});

test('claudeAuthInfo: defesa em profundidade contra dir não-string (segunda camada, além da normalização de entrada)', () => {
  // claudeAuthInfo(dir) pode ser chamado com qualquer coisa por código futuro (não só
  // pelos caminhos normalizados via construtor/updateSettings) — o String(dir) extra
  // é a defesa em profundidade barata citada no Fix 1: mesmo um `dir` chegando como
  // objeto/array não deve lançar "trim is not a function".
  const engine = new Engine();
  assert.doesNotThrow(() => engine.claudeAuthInfo({ nested: true }));
  assert.doesNotThrow(() => engine.claudeAuthInfo(['array', 'dir']));
});

test('updateSettings: recalcula allClaudeAuthInfo quando claudeProfiles muda', async () => {
  const engine = new Engine();
  const dir = path.join(HOME, 'perfil-novo-sem-login');
  fsMod.mkdirSync(dir, { recursive: true });
  engine.updateSettings({ claudeProfiles: [{ id: 'novo', label: 'Novo', dir }], claudeProfileId: 'novo' });
  // doctor() é assíncrono (dispara subprocessos gh/claude); espera terminar antes de checar
  await new Promise(r => setTimeout(r, 50));
  while (!engine.doctorInfo) await new Promise(r => setTimeout(r, 20));
  const entry = engine.doctorInfo.claudeAuth.find(x => x.id === 'novo');
  assert.ok(entry, 'perfil novo aparece no doctorInfo.claudeAuth após updateSettings');
  assert.equal(entry.ready, false); // dir sem .credentials.json
});

// Fix 3: remover um perfil com 2+ contas referenciando ele podia deixar referência
// órfã, porque o listener cp-remove (ui/app.js) disparava N PATCHes fire-and-forget
// separados (accounts por conta afetada + claudeProfileId + claudeProfiles), sem
// garantia de ordem de chegada — o PATCH mais antigo/parcial podia processar por
// último e sobrescrever o array accounts inteiro, restaurando o id removido. O fix
// (só no front) passou a mandar UM ÚNICO patch combinado. Este teste prova que o
// backend (updateSettings, síncrono, sem await no meio) sempre suportou esse patch
// combinado atomicamente — documentando que o padrão "um patch só" é seguro.
test('updateSettings: patch combinado (claudeProfiles+claudeProfileId+accounts) é atômico', () => {
  const engine = new Engine();
  engine.updateSettings({
    claudeProfiles: [{ id: 'p1', label: 'P1', dir: 'C:\\p1' }],
    claudeProfileId: 'p1',
    accounts: [
      { user: 'alice', owners: [], claudeProfileId: 'p1' },
      { user: 'bob', owners: [], claudeProfileId: 'p1' }
    ]
  });
  // agora remove p1 num ÚNICO patch (simulando o novo comportamento do front)
  engine.updateSettings({
    claudeProfiles: [],
    claudeProfileId: '',
    accounts: [
      { user: 'alice', owners: [] }, // já sem claudeProfileId, como o front calcularia
      { user: 'bob', owners: [] }
    ]
  });
  assert.equal(engine.config.claudeProfileId, '');
  assert.equal(engine.config.accounts.find(a => a.user === 'alice').claudeProfileId, undefined);
  assert.equal(engine.config.accounts.find(a => a.user === 'bob').claudeProfileId, undefined);
});
