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
const { pruneWorkspaceTmp, workspaceTmpDir, pruneWorkspaceRaiz } = await import('../lib/engine/workspace-tmp.js');
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

/* ---------- a RAIZ do workspace também acumula, e ela tem coisa que não pode sair ----

   Medido em 31/08/2026, depois da poda do tmp/: sobraram 331 MB em 16.638 arquivos na
   raiz, sendo 152 MB só no `_pr849/`, mais os `biud-esg-*`, `_esg204`, `esg208`. É o
   mesmo rascunho de sessão do tmp/, só que largado um nível acima.

   A diferença que muda o desenho: na raiz moram `state/` (dados do usuário), o
   protocolo (`CLAUDE.md`, `prompts/`, `.claude/`) e o `tmp/`, que tem poda própria.
   Por isso a regra aqui é de PRESERVAÇÃO, e a lista do que preservar é DERIVADA do que
   o app semeia (o workspace-template), nunca curada à mão: lista curada envelheceria
   calada no dia em que o template ganhasse um arquivo novo, e o app apagaria o próprio
   protocolo. */

function raizDeTeste() { return path.join(process.env.FAROL_HOME, 'workspace'); }

function semearRaiz(nome, idadeDias, { dir = true } = {}) {
  const base = raizDeTeste();
  fs.mkdirSync(base, { recursive: true });
  const alvo = path.join(base, nome);
  if (dir) { fs.mkdirSync(alvo, { recursive: true }); fs.writeFileSync(path.join(alvo, 'x'), 'x'); }
  else fs.writeFileSync(alvo, 'x');
  const q = new Date(Date.now() - idadeDias * DIA);
  fs.utimesSync(alvo, q, q);
  return alvo;
}

function templateFalso(...nomes) {
  const t = path.join(process.env.FAROL_HOME, 'template-' + nomes.join('-'));
  fs.mkdirSync(t, { recursive: true });
  for (const n of nomes) fs.writeFileSync(path.join(t, n), 'x');
  return t;
}

function limparRaiz() {
  try { fs.rmSync(raizDeTeste(), { recursive: true, force: true }); } catch { }
}

test('apaga rascunho velho da raiz e preserva o que o app semeia', () => {
  limparRaiz();
  const tpl = templateFalso('CLAUDE.md', 'prompts');
  const lixo = semearRaiz('_pr849', 30);
  const protocolo = semearRaiz('CLAUDE.md', 30, { dir: false });
  const prompts = semearRaiz('prompts', 30);
  assert.equal(pruneWorkspaceRaiz(TEMPOS.TMP_SESSAO_MAX_AGE_MS, Date.now(), tpl), 1);
  assert.equal(fs.existsSync(lixo), false);
  assert.equal(fs.existsSync(protocolo), true, 'o protocolo é do app e nunca sai');
  assert.equal(fs.existsSync(prompts), true);
});

test('state e tmp nunca saem, por mais velhos que estejam', () => {
  limparRaiz();
  const tpl = templateFalso('CLAUDE.md');
  const state = semearRaiz('state', 900);
  const tmp = semearRaiz('tmp', 900);
  assert.equal(pruneWorkspaceRaiz(TEMPOS.TMP_SESSAO_MAX_AGE_MS, Date.now(), tpl), 0);
  assert.equal(fs.existsSync(state), true, 'state é dado do usuário');
  assert.equal(fs.existsSync(tmp), true, 'tmp tem poda própria');
});

test('TEMPLATE ILEGÍVEL não apaga nada: sem saber o que preservar, não se apaga', () => {
  limparRaiz();
  const lixo = semearRaiz('_pr849', 30);
  const protocolo = semearRaiz('CLAUDE.md', 30, { dir: false });
  assert.equal(pruneWorkspaceRaiz(TEMPOS.TMP_SESSAO_MAX_AGE_MS, Date.now(), path.join(process.env.FAROL_HOME, 'nao-existe')), 0);
  assert.equal(fs.existsSync(lixo), true, 'na dúvida, não apaga');
  assert.equal(fs.existsSync(protocolo), true);
});

test('rascunho recente na raiz continua onde está', () => {
  limparRaiz();
  const tpl = templateFalso('CLAUDE.md');
  const novo = semearRaiz('_pr999', 1);
  assert.equal(pruneWorkspaceRaiz(TEMPOS.TMP_SESSAO_MAX_AGE_MS, Date.now(), tpl), 0);
  assert.equal(fs.existsSync(novo), true);
});

test('a poda da raiz também roda no boot, junto das outras', () => {
  assert.match(FONTE, /wsTmpMod\.pruneWorkspaceRaiz\(\)/);
  assert.match(FONTE, /try \{ wsTmpMod\.pruneWorkspaceRaiz\(\); \} catch/);
});
