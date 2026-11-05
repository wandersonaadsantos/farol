// PR em conflito com a base não abre sessão automática (C2): o gate lê `mergeable` uma vez
// por mudança do PR, só CONFLICTING segura, falta de dado nunca segura e o clique atravessa.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { seguraPorConflito, limparConflito, marcarConflito } = await import('../lib/engine/espera-conflito.js');
const P = await import('../ui/pure.js');

const PR = { key: 'acme/api#7', url: 'https://github.com/acme/api/pull/7', updatedAt: '2026-11-05T10:00:00Z', headSha: 'h1' };
const fake = (config = {}) => { const toasts = []; return { config, toasts, emit: (n, p) => { if (n === 'toast') toasts.push(p); } }; };
const leitor = (...vals) => { const f = async () => { f.n++; return vals.length > 1 ? vals.shift() : vals[0]; }; f.n = 0; return f; };

test('CONFLICTING segura, UNKNOWN e null não seguram, MERGEABLE limpa a marca', async () => {
  const e = fake();
  assert.equal(await seguraPorConflito(e, PR, { agora: 5, ler: leitor('CONFLICTING') }), true);
  assert.deepEqual(e.esperaConflito[PR.key], { at: 5, head: 'h1', updatedAt: PR.updatedAt });
  for (const v of ['UNKNOWN', null]) {
    const e2 = fake();
    assert.equal(await seguraPorConflito(e2, PR, { agora: 1, ler: leitor(v) }), false);
    assert.equal(e2.esperaConflito?.[PR.key], undefined);
  }
  assert.equal(await seguraPorConflito(e, { ...PR, updatedAt: 'novo' }, { agora: 9, ler: leitor('MERGEABLE') }), false);
  assert.equal(e.esperaConflito[PR.key], undefined);
});

test('a leitura é reaproveitada enquanto o updatedAt não muda', async () => {
  const e = fake(); const ler = leitor('CONFLICTING');
  for (let i = 0; i < 3; i++) assert.equal(await seguraPorConflito(e, PR, { agora: i, ler }), true);
  assert.equal(ler.n, 1);
  await seguraPorConflito(e, { ...PR, updatedAt: 'outro' }, { agora: 4, ler });
  assert.equal(ler.n, 2);
});

test('toast sai uma vez por PR e head', async () => {
  const e = fake(); const ler = leitor('CONFLICTING');
  await seguraPorConflito(e, PR, { agora: 1, ler });
  await seguraPorConflito(e, { ...PR, updatedAt: 'x' }, { agora: 2, ler });
  assert.equal(e.toasts.length, 1);
  assert.match(e.toasts[0].text, /^⏸ acme\/api#7: em conflito com a base; a revisão automática abre quando o conflito for resolvido\.$/);
  await seguraPorConflito(e, { ...PR, updatedAt: 'y', headSha: 'h2' }, { agora: 3, ler });
  assert.equal(e.toasts.length, 2);
});

test('clique manual atravessa e a chave em false desliga', async () => {
  const ler = leitor('CONFLICTING');
  assert.equal(await seguraPorConflito(fake(), { ...PR, manual: true }, { agora: 1, ler }), false);
  assert.equal(await seguraPorConflito(fake({ aguardarMergeavelParaRevisar: false }), PR, { agora: 1, ler }), false);
  assert.equal(ler.n, 0);
});

test('marcar e limpar são a via da tarefa seguinte', () => {
  const e = fake();
  marcarConflito(e, PR.key, 'h1', 3, 'u1');
  assert.deepEqual(e.esperaConflito[PR.key], { at: 3, head: 'h1', updatedAt: 'u1' });
  limparConflito(e, PR.key);
  assert.equal(e.esperaConflito[PR.key], undefined);
});

test('queueCardHtml mostra a nota de conflito quando há espera', () => {
  const MARK = { style: '', varStyle: '', dim: '', chip: '', dot: '', acct: { label: 'acme' } };
  const pr = { ...PR, title: 't', author: 'alice' };
  const com = P.queueCardHtml(pr, { people: {}, mark: MARK, esperaConflito: { [PR.key]: { at: 1, head: 'h1' } } });
  assert.match(com, /Em conflito com a base: a revisão automática abre quando o conflito for resolvido\. O botão Revisar não espera\./);
  assert.doesNotMatch(P.queueCardHtml(pr, { people: {}, mark: MARK }), /Em conflito com a base/);
});
