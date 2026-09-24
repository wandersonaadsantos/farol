// O prompt nao pode nomear uma pessoa fixa como dona da voz (23/09/2026).
//
// O Farol roda na maquina de varias pessoas, e a sessao escreve com a conta de QUEM a
// instalou. Mesmo assim o protocolo mandava "escreva como o Wanderson escreveria",
// "tom do Wanderson", "expliquem pro Wanderson", e o chat dizia "conversa ao vivo com o
// Wanderson". Na instalacao do Gabriel, a sessao recebia ordem de escrever com a voz de
// quem nao assina o review, e de falar com uma pessoa que nao esta na conversa. E a
// mesma familia do @Gabrielk5 citando @Gabrielk5: o app sabia tudo sobre o PR e nada
// sobre quem opera o app.
//
// A regra e sobre o que a SESSAO LE. Comentario de codigo continua podendo registrar de
// quem foi a decisao e quando: ali o nome e historia do repositorio, e quem le e quem
// mantem o Farol, nao o modelo que vai escrever um review.
import os from 'node:os';
import path from 'node:path';
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-sem-dono-' + process.pid);

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { Engine } = await import('../server.js');
const prompt = (await import('../lib/engine/review-prompt.js')).default;
const chat = (await import('../lib/engine/chat.js')).default;

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { } });

const NOME = /wanderson/i;
const leia = (...p) => fs.readFileSync(path.join(...p), 'utf8');

test('o protocolo da revisão não nomeia dono nenhum', () => {
  assert.doesNotMatch(leia('workspace-template', 'prompts', 'pr-review-auto.md'), NOME);
});

test('o CLAUDE.md do workspace (que a sessão lê) também não', () => {
  assert.doesNotMatch(leia('workspace-template', 'CLAUDE.md'), NOME);
});

test('o protocolo da autoanálise também não', () => {
  assert.doesNotMatch(leia('workspace-template', 'prompts', 'self-review.md'), NOME);
});

test('o prompt MONTADO da revisão não nomeia dono nenhum', () => {
  const e = new Engine();
  e.accountForPr = () => 'Gabrielk5';
  const p = e.headlessPromptFor('https://github.com/o/r/pull/1', 'outro');
  assert.doesNotMatch(p, NOME, 'inclui perfil do autor, formato do review e review de terceiros');
});

test('o preâmbulo do chat não nomeia dono nenhum, nos dois modos', () => {
  const e = new Engine();
  e.accountForPr = () => 'Gabrielk5';
  assert.doesNotMatch(chat.chatPreamble(e, 'o/r#1', 'https://github.com/o/r/pull/1', false), NOME);
  assert.doesNotMatch(chat.chatPreamble(e, 'o/r#1', 'https://github.com/o/r/pull/1', true), NOME);
});

/* ---------- o que entra no lugar ---------- */

test('a voz passa a ser a de quem escreve, em segunda pessoa', () => {
  const b = prompt.reviewFormatBlock(new Engine());
  assert.match(b, /como você escreveria/i, 'a voz é de quem assina, e quem assina o bloco de identidade já nomeou');
  assert.match(b, /\*\*Tom:\*\*/, 'o tom da casa continua, sem dono');
});

test('a decisão humana continua exigida, sem depender de um nome', () => {
  const b = prompt.thirdPartyReviewBlock();
  assert.match(b, /decisão humana|nunca sai sozinha/i);
  assert.doesNotMatch(b, NOME);
});

test('o nome continua livre em comentário de código: a trava é só sobre o que a sessão lê', () => {
  // review-prompt.js registra em comentário de quem foi a decisão de 29/07/2026, e isso
  // é história do repositório. Se este caso quebrar, alguém varreu o fonte inteiro em vez
  // de varrer o que vira prompt.
  assert.match(leia('lib', 'engine', 'review-prompt.js'), NOME);
});
