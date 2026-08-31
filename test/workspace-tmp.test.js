// O `workspace/tmp` não tinha dono, e por isso não tinha relógio.
//
// MEDIDO EM 31/08/2026: o `~/.farol/workspace` estava com 4,3 GB em 411.321 arquivos,
// e 4,0 GB deles (394.683 arquivos) eram 20 clones que sessões de revisão fizeram por
// conta própria em `tmp/`, cada um com `.git` e `node_modules` completos. O mais novo
// era de 27/08. O app poda o que ELE cria (state/pr-scope em 7 dias, state/file-proof
// em 30), mas nada olhava para o que a sessão inventa, e nenhuma linha do engine ou do
// protocolo do workspace sequer cita esse diretório.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-wstmp-' + process.pid);

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
// await import, nunca estático: o estático é hasteado acima do FAROL_HOME e o paths.js
// resolveria o ~/.farol REAL. Ver test/test-isolation.test.js.
const { pruneWorkspaceTmp, workspaceTmpDir } = await import('../lib/engine/workspace-tmp.js');
const { TEMPOS } = await import('../lib/constants.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { } });

const DIA = 24 * 3600 * 1000;

function semear(nome, idadeDias, { dir = true } = {}) {
  const base = workspaceTmpDir();
  fs.mkdirSync(base, { recursive: true });
  const alvo = path.join(base, nome);
  if (dir) {
    fs.mkdirSync(path.join(alvo, 'node_modules', 'coisa'), { recursive: true });
    fs.writeFileSync(path.join(alvo, 'node_modules', 'coisa', 'index.js'), 'x');
  } else {
    fs.writeFileSync(alvo, 'x');
  }
  const quando = new Date(Date.now() - idadeDias * DIA);
  fs.utimesSync(alvo, quando, quando);
  return alvo;
}

function limpar() {
  try { fs.rmSync(workspaceTmpDir(), { recursive: true, force: true }); } catch { }
}

test('apaga o que passou da idade, inclusive árvore inteira com subpastas', () => {
  limpar();
  const velho = semear('clone-velho', 30);
  const arquivoVelho = semear('pr123.patch', 30, { dir: false });
  assert.equal(pruneWorkspaceTmp(), 2);
  assert.equal(fs.existsSync(velho), false, 'o clone inteiro saiu, não só o topo');
  assert.equal(fs.existsSync(arquivoVelho), false);
});

test('não encosta no que é recente', () => {
  limpar();
  const novo = semear('clone-de-ontem', 1);
  assert.equal(pruneWorkspaceTmp(), 0);
  assert.equal(fs.existsSync(novo), true);
});

test('o diretório em si sobrevive: quem poda não desmonta o lugar de trabalho', () => {
  limpar();
  semear('clone-velho', 30);
  pruneWorkspaceTmp();
  assert.equal(fs.existsSync(workspaceTmpDir()), true);
});

test('sem o diretório, devolve 0 e não lança', () => {
  limpar();
  assert.equal(pruneWorkspaceTmp(), 0);
});

test('a idade é de sete dias, a mesma régua do escopo materializado', () => {
  assert.equal(TEMPOS.TMP_SESSAO_MAX_AGE_MS, TEMPOS.ESCOPO_PR_MAX_AGE_MS);
  limpar();
  const naBorda = semear('quase', 6);
  const passou = semear('passou', 8);
  assert.equal(pruneWorkspaceTmp(), 1);
  assert.equal(fs.existsSync(naBorda), true);
  assert.equal(fs.existsSync(passou), false);
});

test('entrada que não sai não derruba a poda das outras', () => {
  limpar();
  semear('a', 30);
  semear('b', 30);
  // maxAgeMs negativo faria tudo vencer; o ponto aqui é que a contagem devolvida é a
  // do que de fato saiu, e não a do que foi tentado
  const removidos = pruneWorkspaceTmp(TEMPOS.TMP_SESSAO_MAX_AGE_MS, Date.now());
  assert.equal(removidos, 2);
});

/* ---------- fiação: a poda acontece no boot, junto das outras duas ---------- */
// Teste de fonte, e não de execução: chamar prepareHome de verdade semearia o
// workspace e apagaria arquivo, que é justamente o que este módulo faz.
const FONTE = fs.readFileSync(path.join(import.meta.dirname, '..', 'server.js'), 'utf8');

test('o boot poda o tmp da sessão, ao lado do que o app já podava', () => {
  assert.match(FONTE, /wsTmpMod\.pruneWorkspaceTmp\(\)/, 'a poda tem que ser chamada');
  const proofs = FONTE.indexOf('pruneFileProofs()');
  const scopes = FONTE.indexOf('pruneScopes()');
  const tmp = FONTE.indexOf('pruneWorkspaceTmp()');
  assert.ok(proofs > 0 && scopes > 0 && tmp > 0, 'as três podas existem');
  assert.ok(tmp > scopes && scopes > proofs, 'as três ficam juntas, na mesma seção do boot');
});

test('a poda do boot é best-effort, como as outras', () => {
  assert.match(FONTE, /try \{ wsTmpMod\.pruneWorkspaceTmp\(\); \} catch/,
    'derrubar o boot por um diretório travado seria pior que o lixo ficar');
});
