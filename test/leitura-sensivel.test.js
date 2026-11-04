// O detector só registra: não reprova nada, e arquivo do PR ou do workspace não gera aviso.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-leitura-sensivel-'));
process.env.FAROL_HOME = FAROL_HOME;
const { caminhoSensivel } = await import('../lib/engine/leitura-sensivel.js');
const { observarLeitura } = await import('../lib/engine/read-evidence.js');

const POSIX = { home: '/home/ana', plataforma: 'linux' };
const WINDOWS = { home: 'C:\\Users\\ana', plataforma: 'win32' };
const MAC = { home: '/Users/ana', plataforma: 'darwin' };

test('POSIX: a lista fechada de credenciais do home avisa', () => {
  for (const relativo of ['.ssh/id_rsa', '.ssh/config', '.aws/credentials', '.gnupg/private-keys-v1.d/a.key', '.config/gh/hosts.yml',
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

function montar(session = { keys: ['o/r#7'] }) {
  const linhas = [];
  const engine = { config: {}, activeReviews: new Map([['s1', session]]), log: (nivel, texto) => linhas.push({ nivel, texto }) };
  return { engine, linhas, session };
}
const ler = (file_path, name = 'Read') => ({ type: 'tool_use', name, input: { file_path } });
const NO_HOME = relativo => path.join(os.homedir(), relativo);

test('a leitura gera UM aviso por sessão e caminho, com a chave do PR e sem conteúdo', () => {
  const { engine, linhas, session } = montar();
  const opts = { id: 's1' };
  observarLeitura(engine, opts, ler(NO_HOME('.ssh/id_rsa')));
  observarLeitura(engine, opts, ler(NO_HOME('.ssh/id_rsa')));
  observarLeitura(engine, opts, ler(NO_HOME('.aws/credentials')));
  assert.deepEqual(linhas.map(l => l.nivel), ['WARN', 'WARN']);
  assert.match(linhas[0].texto, /o\/r#7/);
  assert.ok(linhas[0].texto.includes(NO_HOME('.ssh/id_rsa')));
  assert.equal(session.filesRead, undefined, 'sem escopo, nada vira cobertura');
  // outra sessão é outra contagem
  observarLeitura(engine, { id: 's1' }, ler(NO_HOME('.ssh/id_rsa')));
  assert.equal(linhas.length, 3);
});

test('o aviso sai também nos modos em que a regra do Read não credita', () => {
  for (const [config, opts] of [[{ reviewBatchedReads: true }, { id: 's1' }], [{}, { id: 's1', selfIsolation: { root: '/x' } }]]) {
    const { engine, linhas } = montar();
    engine.config = config;
    observarLeitura(engine, opts, ler(NO_HOME('.ssh/id_rsa')));
    assert.equal(linhas.length, 1);
  }
});

test('só Read conta, e sessão sem PR ainda registra', () => {
  const { engine, linhas } = montar();
  observarLeitura(engine, { id: 's1' }, ler(NO_HOME('.ssh/id_rsa'), 'Write'));
  assert.equal(linhas.length, 0);
  observarLeitura(engine, { id: 'outra' }, ler(NO_HOME('.ssh/id_rsa')));
  assert.match(linhas[0].texto, /sem PR/);
});

test('arquivo do escopo do PR continua cobertura e não avisa, mesmo sob pasta de credencial', () => {
  const scopeRoot = NO_HOME('.ssh/escopo-de-teste-inexistente');
  const { engine, linhas, session } = montar({ keys: ['o/r#7'], scopeRoot, filesRead: new Set() });
  observarLeitura(engine, { id: 's1' }, ler(path.join(scopeRoot, 'src/a.js')));
  assert.equal(linhas.length, 0);
  assert.deepEqual([...session.filesRead], ['src/a.js']);
});

test('engine sem log e entrada torta não derrubam a sessão nem mudam o crédito', () => {
  const scopeRoot = path.join(FAROL_HOME, 'escopo');
  const session = { scopeRoot, filesRead: new Set() };
  const engine = { config: {}, activeReviews: new Map([['s1', session]]) };
  assert.doesNotThrow(() => observarLeitura(engine, { id: 's1' }, ler(NO_HOME('.ssh/id_rsa'))));
  assert.doesNotThrow(() => observarLeitura(engine, { id: 's1' }, { name: 'Read' }));
  observarLeitura(engine, { id: 's1' }, ler(path.join(scopeRoot, 'a.js')));
  assert.deepEqual([...session.filesRead], ['a.js']);
});
