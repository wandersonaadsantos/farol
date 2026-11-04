// O detector só registra: não reprova nada, e arquivo do PR ou do workspace não gera aviso.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-leitura-sensivel-'));
process.env.FAROL_HOME = FAROL_HOME;
const { caminhoSensivel, TETO_DE_CAMINHOS } = await import('../lib/engine/leitura-sensivel.js');
const { ARQUIVO_DE_MEDICOES } = await import('../lib/engine/medicoes-leitura.js');
const { observarLeitura } = await import('../lib/engine/read-evidence.js');

const POSIX = { home: '/home/ana', plataforma: 'linux' };
const WINDOWS = { home: 'C:\\Users\\ana', plataforma: 'win32' };
const MAC = { home: '/Users/ana', plataforma: 'darwin' };

test('POSIX: a lista fechada de credenciais do home avisa', () => {
  for (const relativo of ['.git-credentials', '.ssh/id_rsa', '.ssh/config', '.aws/credentials', '.gnupg/private-keys-v1.d/a.key', '.config/gh/hosts.yml',
    '.codex/auth.json', '.claude/.credentials.json', '.claude-trabalho/.credentials.json', '.farol/sync-credentials.json', '.farol/jira-credentials.json']) {
    assert.equal(caminhoSensivel(`/home/ana/${relativo}`, POSIX), `/home/ana/${relativo}`, relativo);
  }
});

test('Windows: as mesmas pastas, em qualquer caixa e nas três grafias do caminho', () => {
  for (const relativo of ['.ssh\\id_rsa', '.aws\\credentials', '.gnupg\\a', '.config\\gh\\hosts.yml', '.codex\\auth.json', '.claude\\.credentials.json', '.farol\\sync-credentials.json']) {
    assert.ok(caminhoSensivel(`C:\\Users\\ana\\${relativo}`, WINDOWS), relativo);
  }
  assert.ok(caminhoSensivel('c:/users/ANA/.SSH/id_rsa', WINDOWS));
  assert.ok(caminhoSensivel('/c/Users/ana/.ssh/id_rsa', WINDOWS));
  assert.ok(caminhoSensivel('\\\\?\\C:\\Users\\ana\\.ssh\\id_rsa', WINDOWS));
  assert.ok(caminhoSensivel('C:\\Users\\ana\\projeto\\..\\.ssh\\id_rsa', WINDOWS));
  assert.ok(caminhoSensivel('C:\\Users\\ana\\.git-credentials', WINDOWS));
});

test('Windows: a forma curta do home ancora igual, nos dois sentidos', () => {
  const longo = { home: 'C:\\Users\\wanderson', plataforma: 'win32' };
  assert.ok(caminhoSensivel('C:\\Users\\WANDER~1\\.ssh\\id_rsa', longo));
  assert.ok(caminhoSensivel('C:\\Users\\WANDER~1\\.git-credentials', longo));
  assert.ok(caminhoSensivel('c:/users/wander~2/.aws/credentials', longo));
  assert.ok(caminhoSensivel('C:\\Users\\wanderson\\.ssh\\id_rsa', { home: 'C:\\Users\\WANDER~1', plataforma: 'win32' }));
  assert.ok(caminhoSensivel('C:\\Users\\WANDER~1\\Contas\\T\\.credentials.json', { ...longo, perfis: [{ dir: 'C:\\Users\\wanderson\\Contas\\T' }] }));
  // outra pessoa, forma curta que não é prefixo, e a mesma grafia fora do Windows não ancoram
  assert.equal(caminhoSensivel('C:\\Users\\MARIA~1\\.ssh\\id_rsa', longo), null);
  assert.equal(caminhoSensivel('C:\\Users\\WANDER~1\\projeto\\.ssh\\id_rsa', longo), null);
  assert.equal(caminhoSensivel('/home/ana~1/.ssh/id_rsa', POSIX), null);
});

test('caixa só é dobrada onde o sistema de arquivos dobra', () => {
  assert.ok(caminhoSensivel('/Users/ana/.SSH/id_rsa', MAC));
  assert.equal(caminhoSensivel('/home/ana/.SSH/id_rsa', POSIX), null);
});

test('o que parece credencial e não é a do aparelho segue sem aviso', () => {
  const nao = [
    '/home/ana/.farol/workspace/state/pr-scope/o%2Fr%231/.ssh/id_rsa',
    '/home/ana/.farol/workspace/credentials.json',
    '/home/ana/.farol/config.json',
    '/home/ana/.farol/credentials/x.js',
    '/home/ana/projeto/.git-credentials',
    '/home/ana/.git-credentials/x',
    '/home/ana/projeto/.ssh/config',
    '/home/ana/projeto/.credentials.json',
    '/home/ana/projeto/src/credentials.js',
    '/home/ana/.sshfoo/config',
    '/home/ana/.config/ghost/x',
    '/home/ana/.codex/config.toml',
    '/home/ana/.claude/settings.json',
    '/home/ana/.claudia/.credentials.json',
    '/home/bia/.ssh/id_rsa',
    '/etc/ssh/ssh_host_rsa_key',
    '.ssh/id_rsa',
    '~/.ssh/id_rsa',
    '',
  ];
  for (const caminho of nao) assert.equal(caminhoSensivel(caminho, POSIX), null, caminho);
  for (const valor of [null, undefined, 42, {}, '/home/ana/.ssh/a\0b']) assert.equal(caminhoSensivel(valor, POSIX), null);
  // no Windows, caminho sem unidade não dá para ancorar, e POSIX não lê caminho do Windows
  assert.equal(caminhoSensivel('\\Users\\ana\\.ssh\\id_rsa', WINDOWS), null);
  assert.equal(caminhoSensivel('C:\\Users\\ana\\.ssh\\id_rsa', POSIX), null);
  assert.equal(caminhoSensivel('C:\\Users\\ana\\projeto\\.ssh\\id_rsa', WINDOWS), null);
});

test('perfil do Claude com pasta de qualquer nome vale pela lista da config', () => {
  const perfis = [{ id: 'a', dir: '/home/ana/contas/trabalho' }, { id: 'b' }, null];
  assert.ok(caminhoSensivel('/home/ana/contas/trabalho/.credentials.json', { ...POSIX, perfis }));
  assert.equal(caminhoSensivel('/home/ana/contas/trabalho/settings.json', { ...POSIX, perfis }), null);
  assert.equal(caminhoSensivel('/home/ana/contas/outro/.credentials.json', { ...POSIX, perfis }), null);
  assert.equal(caminhoSensivel('/opt/perfil/.credentials.json', { ...POSIX, perfis: [{ dir: '/opt/perfil' }] }), null, 'fora do home não entra');
  assert.ok(caminhoSensivel('C:\\Users\\ana\\Contas\\T\\.credentials.json', { ...WINDOWS, perfis: [{ dir: 'c:/users/ana/contas/t' }] }));
});

const medicoes = () => {
  try { return fs.readFileSync(ARQUIVO_DE_MEDICOES, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); }
  catch { return []; }
};
function montar(session = { keys: ['o/r#7'] }) {
  fs.rmSync(ARQUIVO_DE_MEDICOES, { force: true });
  const linhas = [];
  const engine = { config: {}, activeReviews: new Map([['s1', session]]), log: (nivel, texto) => linhas.push({ nivel, texto }) };
  return { engine, linhas, session };
}
const ler = (file_path, name = 'Read') => ({ type: 'tool_use', name, input: { file_path } });
const NO_HOME = relativo => path.join(os.homedir(), relativo);

test('a leitura grava UM registro por sessão e caminho, com a chave do PR, e nada no log', () => {
  const { engine, linhas, session } = montar();
  const opts = { id: 's1' };
  observarLeitura(engine, opts, ler(NO_HOME('.ssh/id_rsa')));
  observarLeitura(engine, opts, ler(NO_HOME('.ssh/id_rsa')));
  observarLeitura(engine, opts, ler(NO_HOME('.aws/credentials')));
  const lidas = medicoes();
  assert.deepEqual(lidas.map(m => m.tipo), ['leitura-sensivel', 'leitura-sensivel']);
  assert.equal(lidas[0].pr, 'o/r#7');
  assert.equal(lidas[0].sessao, 's1');
  assert.equal(lidas[0].caminho, NO_HOME('.ssh/id_rsa'));
  assert.deepEqual(Object.keys(lidas[0]).sort(), ['caminho', 'em', 'pr', 'sessao', 'tipo'], 'só caminho e identificação');
  assert.deepEqual(linhas, [], 'medição não entra no farol.log');
  assert.equal(session.filesRead, undefined, 'sem escopo, nada vira cobertura');
  // outra sessão é outra contagem
  observarLeitura(engine, { id: 's1' }, ler(NO_HOME('.ssh/id_rsa')));
  assert.equal(medicoes().length, 3);
});

test('caminhos distintos têm teto por sessão, com um registro único de que o teto chegou', () => {
  const { engine } = montar();
  const opts = { id: 's1' };
  for (let i = 0; i < TETO_DE_CAMINHOS + 20; i++) observarLeitura(engine, opts, ler(NO_HOME(`.ssh/chave-${i}`)));
  observarLeitura(engine, opts, ler(NO_HOME('.ssh/chave-0')));
  const lidas = medicoes();
  assert.equal(lidas.filter(m => m.tipo === 'leitura-sensivel').length, TETO_DE_CAMINHOS);
  assert.deepEqual(lidas.filter(m => m.tipo === 'leitura-sensivel-teto').map(m => m.teto), [TETO_DE_CAMINHOS]);
});

test('o registro sai também nos modos em que a regra do Read não credita', () => {
  for (const [config, opts] of [[{ reviewBatchedReads: true }, { id: 's1' }], [{}, { id: 's1', selfIsolation: { root: '/x' } }]]) {
    const { engine } = montar();
    engine.config = config;
    observarLeitura(engine, opts, ler(NO_HOME('.ssh/id_rsa')));
    assert.equal(medicoes().length, 1);
  }
});

test('só Read conta, e sessão sem PR ainda registra', () => {
  const { engine } = montar();
  observarLeitura(engine, { id: 's1' }, ler(NO_HOME('.ssh/id_rsa'), 'Write'));
  assert.equal(medicoes().length, 0);
  observarLeitura(engine, { id: 'outra' }, ler(NO_HOME('.ssh/id_rsa')));
  assert.equal(medicoes()[0].pr, null);
});

test('arquivo do escopo do PR continua cobertura e não registra, mesmo sob pasta de credencial', () => {
  const scopeRoot = NO_HOME('.ssh/escopo-de-teste-inexistente');
  const { engine, session } = montar({ keys: ['o/r#7'], scopeRoot, filesRead: new Set() });
  observarLeitura(engine, { id: 's1' }, ler(path.join(scopeRoot, 'src/a.js')));
  assert.equal(medicoes().length, 0);
  assert.deepEqual([...session.filesRead], ['src/a.js']);
});

test('entrada torta e arquivo de medições inacessível não derrubam a sessão nem mudam o crédito', () => {
  const scopeRoot = path.join(FAROL_HOME, 'escopo');
  const session = { scopeRoot, filesRead: new Set() };
  const engine = { config: {}, activeReviews: new Map([['s1', session]]) };
  fs.rmSync(ARQUIVO_DE_MEDICOES, { force: true });
  fs.mkdirSync(ARQUIVO_DE_MEDICOES, { recursive: true });
  assert.doesNotThrow(() => observarLeitura(engine, { id: 's1' }, ler(NO_HOME('.ssh/id_rsa'))));
  assert.doesNotThrow(() => observarLeitura(engine, { id: 's1' }, { name: 'Read' }));
  observarLeitura(engine, { id: 's1' }, ler(path.join(scopeRoot, 'a.js')));
  assert.deepEqual([...session.filesRead], ['a.js']);
  fs.rmSync(ARQUIVO_DE_MEDICOES, { recursive: true, force: true });
});
