// Re-pedido de revisao no MESMO head nao abre sessao nova (24/09/2026).
//
// Caso medido em biudtech/engine-ai#273: a conta aprovou o head a34f3adc as 12:32; as
// 12:59 o autor re-pediu revisao sem commit novo; as 13:03 o Farol abriu uma sessao
// inteira (12 minutos) e nao postou nada, e as 13:29 abriu OUTRA. O `requested` volta a
// true, o PR reentra na fila automatica, e a trava de "eu ja revisei este head" so roda
// DENTRO do decide(), depois da sessao ja ter custado: ela conclui `already_reviewed` e
// nao posta. Duas a tres sessoes pagas para chegar em "isto ja esta revisado".
//
// A conferencia passa a acontecer ANTES de abrir a sessao. Tres limites que o caso trava:
// clique manual sempre revisa (invariante 4), falta de dado nunca cala um round (rede que
// falha abre a sessao), e head novo nunca e pulado.
import os from 'node:os';
import path from 'node:path';
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-ja-revisei-' + process.pid);

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { Engine } = await import('../server.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const HEAD = 'a34f3adc9f1e';
const PR = {
  key: 'biudtech/engine-ai#273', repo: 'biudtech/engine-ai', number: 273,
  url: 'https://github.com/biudtech/engine-ai/pull/273', requested: true, author: 'alguem',
};

function motor({ estados, head = HEAD }) {
  const e = new Engine();
  e.log = () => { };
  e.accountForPr = () => 'conta';
  e.isMuted = () => false;
  e.tokens = { conta: 'tok' };
  e.prState = async () => 'OPEN';
  e.bloqueadoPorHistorico = async () => ({ bloqueado: false, head: '', quem: [], decisivos: [] });
  e.headSha = async () => head;
  e.myReviewStates = async () => estados;
  e.sessoes = 0;
  e.runHeadlessReview = async () => { e.sessoes++; };
  e.toasts = [];
  e.on('toast', (t) => e.toasts.push(t.text));
  return e;
}

test('já aprovei ESTE head: o re-pedido não abre sessão nenhuma', async () => {
  const e = motor({ estados: ['APPROVED'] });
  e.queue.push({ ...PR });
  await e.runOneHeadless({ ...PR }, 'conta');
  assert.equal(e.sessoes, 0, 'a sessão custava 12 minutos para concluir o que o gh já respondia');
  assert.ok(!e.queue.some(p => p.key === PR.key), 'e o PR sai da fila automática');
  assert.equal(e.seen.has(PR.key), true);
  assert.ok(e.toasts.some(t => /já (tinha )?(aprovei|aprovado|revis)/i.test(t)), e.toasts.join(' | '));
});

test('a vaga da conta é liberada: a fila não trava atrás do PR pulado', async () => {
  // o pulo acontece ANTES da sessão, então quem libera a vaga é o próprio ramo do pulo.
  // Sem isso a conta ficaria ocupada para sempre por uma revisão que nunca aconteceu, e
  // nenhum outro PR daquela conta rodaria de novo.
  const e = motor({ estados: ['APPROVED'] });
  e.headlessBusyAccounts.set('conta', 1);
  await e.runOneHeadless({ ...PR }, 'conta');
  assert.equal(e.headlessBusyAccounts.get('conta'), undefined, 'a vaga volta para a conta');
});

test('já pedi mudanças NESTE head: mesma coisa', async () => {
  const e = motor({ estados: ['CHANGES_REQUESTED'] });
  await e.runOneHeadless({ ...PR }, 'conta');
  assert.equal(e.sessoes, 0);
});

test('head sem review meu: a revisão acontece, como sempre', async () => {
  const e = motor({ estados: [] });
  await e.runOneHeadless({ ...PR }, 'conta');
  assert.equal(e.sessoes, 1);
});

test('clique MANUAL sempre revisa, mesmo já tendo aprovado o head (invariante 4)', async () => {
  const e = motor({ estados: ['APPROVED'] });
  await e.runOneHeadless({ ...PR, manual: true }, 'conta');
  assert.equal(e.sessoes, 1, 'clique nunca é bloqueado por gate automático');
});

test('falta de dado NUNCA cala um round: gh que não responde abre a sessão', async () => {
  const semResposta = motor({ estados: null });
  await semResposta.runOneHeadless({ ...PR }, 'conta');
  assert.equal(semResposta.sessoes, 1, 'null é "não deu para confirmar", não é "já revisei"');

  const semHead = motor({ estados: ['APPROVED'], head: '' });
  await semHead.runOneHeadless({ ...PR }, 'conta');
  assert.equal(semHead.sessoes, 1, 'sem head não dá para dizer de qual rodada o review é');
});

test('erro na conferência não derruba a revisão: ela roda', async () => {
  const e = motor({ estados: ['APPROVED'] });
  e.myReviewStates = async () => { throw new Error('fetch failed'); };
  await e.runOneHeadless({ ...PR }, 'conta');
  assert.equal(e.sessoes, 1);
});
