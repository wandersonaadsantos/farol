// A licao aprendida num PR vale pro REPOSITORIO, nao so pra pessoa (23/09/2026).
//
// O historico de pushback ja entrava no prompt, mas filtrado por AUTOR
// (pushbacksFor(login)). Numa base como biudtech/infra-k8s, onde varias pessoas mexem
// nas mesmas convencoes, a licao que o autor A ensinou nao chegava na revisao do autor
// B. O caso real que motivou: em infra-k8s#151 o autor refutou o blocker porque o PR de
// que ele dependia ja tinha sido mesclado quatro minutos antes; e uma licao sobre
// aquele repositorio, nao sobre aquela pessoa.
//
// So entra o que foi CONFIRMADO e o que o Farol errou (author_right) ou errou em parte
// (mixed): licao e onde o app se enganou. E entra como CONTEXTO delimitado, nunca como
// ordem: texto escrito por terceiro no PR nao manda no revisor.
import os from 'node:os';
import path from 'node:path';
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-licoes-' + process.pid);

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { Engine } = await import('../server.js');
const pushbackMod = (await import('../lib/engine/pushback.js')).default;

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { } });

const AGORA = Date.parse('2026-09-21T19:00:00Z');
function engineCom(pushbacks) {
  const e = new Engine();
  e.pushbacks = pushbacks;
  return e;
}
const pb = (o) => ({ status: 'confirmed', source: 'auto', confidence: 'high', at: AGORA, ...o });

const BASE = {
  'biudtech/infra-k8s#151': pb({ author: 'alexpraxedes', outcome: 'mixed', note: 'o PR de que eu dependia já tinha sido mesclado' }),
  'biudtech/infra-k8s#120': pb({ author: 'outra', outcome: 'author_right', note: 'sync-wave 0 é o padrão do repo', at: AGORA - 1000 }),
  'biudtech/infra-k8s#99': pb({ author: 'outra', outcome: 'we_right', note: 'o autor acatou inteiro' }),
  'biudtech/infra-k8s#98': pb({ author: 'outra', outcome: 'author_right', note: 'ainda não confirmado', status: 'pending' }),
  'biudtech/biud-core#10': pb({ author: 'outra', outcome: 'author_right', note: 'de outro repositório' })
};

test('lições do repositório: só o confirmado em que o Farol se enganou, e só deste repo', () => {
  const e = engineCom(BASE);
  const l = pushbackMod.licoesDoRepo(e, 'biudtech/infra-k8s');
  const keys = l.map(x => x.key);
  assert.deepEqual(keys, ['biudtech/infra-k8s#151', 'biudtech/infra-k8s#120'], 'mais recente primeiro');
  assert.ok(!keys.some(k => /biud-core/.test(k)), 'outro repositório não ensina nada aqui');
  assert.ok(!keys.includes('biudtech/infra-k8s#99'), 'acerto do Farol não é lição de erro');
  assert.ok(!keys.includes('biudtech/infra-k8s#98'), 'pendente ainda não é lição');
});

test('o PR em revisão não ensina a si mesmo, e o que já veio pelo autor não repete', () => {
  const e = engineCom(BASE);
  const l = pushbackMod.licoesDoRepo(e, 'biudtech/infra-k8s',
    { excluirKey: 'biudtech/infra-k8s#151', excluirAutor: 'outra' });
  assert.deepEqual(l.map(x => x.key), [], 'sem repetir o que o bloco do autor já trouxe');
});

test('repo sem lição nenhuma devolve lista vazia, e o bloco some do prompt', () => {
  const e = engineCom(BASE);
  assert.deepEqual(pushbackMod.licoesDoRepo(e, 'biudtech/nada'), []);
  assert.equal(pushbackMod.licoesDoRepoBlock([]), '', 'bloco vazio não entra no prompt');
});

test('o bloco entra como CONTEXTO delimitado, nunca como ordem', () => {
  const e = engineCom(BASE);
  const texto = pushbackMod.licoesDoRepoBlock(pushbackMod.licoesDoRepo(e, 'biudtech/infra-k8s'));
  assert.match(texto, /biudtech\/infra-k8s#151/);
  assert.match(texto, /já tinha sido mesclado/);
  assert.match(texto, /contexto|não .*(ordem|instrução)/i, 'o bloco diz o que ele é');
  assert.match(texto, /confirm/i, 'e manda confirmar antes de reusar');
});

test('o prompt da revisão carrega as lições do repositório do PR', () => {
  const e = engineCom(BASE);
  e.personProfileBlock = () => '';
  e.reviewFormatBlock = () => '';
  const prompt = e.headlessPromptFor('https://github.com/biudtech/infra-k8s/pull/188', 'alguem');
  assert.match(prompt, /biudtech\/infra-k8s#120/, 'a lição de outra pessoa no mesmo repo chega');
});
