// Quem pediu a revisão automática e quando (B1): leitura única da timeline, provas da decisão,
// cartão da sessão e aviso nativo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import io from '../lib/io.js';
import { ultimoPedidoDeRevisao } from '../lib/engine/gh-queries.js';
import { registrarPedidoDaSessao } from '../lib/engine/pedido-de-revisao.js';
import { provasDaDecisao } from '../lib/engine/provas-da-decisao.js';
import { avisoDe } from '../lib/engine/avisos-nativos.js';
import { sessionCardHtml } from '../ui/pure/sessao.js';
import { fmtClock } from '../ui/pure/comum.js';

const PR = { key: 'o/r#7', repo: 'o/r', number: 7, url: 'https://github.com/o/r/pull/7' };
const engineDe = () => ({ accountForPr: () => 'Eu', tokenFor: () => 'tok', ghEnv: () => ({}) });

async function comGh(stdout, ok, fn) {
  const original = io.run;
  const chamadas = [];
  io.run = async (cmd, args) => { chamadas.push([cmd, args]); return { ok, code: ok ? 0 : 1, stdout, stderr: '' }; };
  try { return await fn(chamadas); } finally { io.run = original; }
}

test('ultimoPedidoDeRevisao devolve o último pedido para a conta, sem caixa, e null em falha', async () => {
  const linhas = [
    { por: 'ana', em: '2026-11-05T10:00:00Z', rev: 'eu' },
    { por: 'bot', em: '2026-11-05T12:00:00Z', rev: 'outra' },
    { por: 'bia', em: '2026-11-05T11:00:00Z', rev: 'EU' },
  ].map((l) => JSON.stringify(l)).join('\n');
  await comGh(linhas, true, async (chamadas) => {
    assert.deepEqual(await ultimoPedidoDeRevisao(engineDe(), PR), { por: 'bia', em: '2026-11-05T11:00:00Z', time: false });
    assert.equal(chamadas.length, 1);
    assert.deepEqual(chamadas[0][1].slice(0, 3), ['api', 'repos/o/r/issues/7/timeline?per_page=100', '--paginate']);
  });
  await comGh(JSON.stringify({ por: 'cia', em: '2026-11-05T13:00:00Z', time: 'back' }), true, async () => {
    assert.deepEqual(await ultimoPedidoDeRevisao(engineDe(), PR), { por: 'cia', em: '2026-11-05T13:00:00Z', time: true });
  });
  await comGh('', false, async () => assert.equal(await ultimoPedidoDeRevisao(engineDe(), PR), null));
  await comGh('', true, async () => assert.equal(await ultimoPedidoDeRevisao(engineDe(), PR), null));
});

test('registrarPedidoDaSessao guarda o pedido, avisa e não lê em revisão manual', async () => {
  const emitidos = [];
  const engine = { ...engineDe(), activeReviews: new Map([['a1', {}]]), emit: (e, p) => emitidos.push([e, p]), pushState() {} };
  await comGh(JSON.stringify({ por: 'ana', em: '2026-11-05T10:00:00Z', rev: 'eu' }), true, async (chamadas) => {
    await registrarPedidoDaSessao(engine, 'a1', { ...PR, manual: true });
    assert.equal(chamadas.length, 0);
    const pr = { ...PR };
    await registrarPedidoDaSessao(engine, 'a1', pr);
    assert.equal(engine.activeReviews.get('a1').pedido.por, 'ana');
    assert.equal(pr.pedido.por, 'ana');
    assert.deepEqual(emitidos.map((e) => e[0]), ['toast', 'review-started']);
    assert.match(emitidos[0][1].text, /pedida por @ana às /);
  });
});

test('provasDaDecisao carrega pedido quando o result tem, e null quando não tem', () => {
  const pedido = { por: 'ana', em: '2026-11-05T10:00:00Z', time: false };
  assert.deepEqual(provasDaDecisao({ pedido }).pedido, pedido);
  assert.equal(provasDaDecisao({}).pedido, null);
  assert.equal(provasDaDecisao({ pedido: { por: 1 } }).pedido, null);
});

test('sessionCardHtml mostra "pedida por" com menção navegável e hora quando há pedido', () => {
  const em = '2026-11-05T10:00:00Z';
  const html = sessionCardHtml({ id: 'a1', label: 'x', pedido: { por: 'ana', em, time: false } }, '');
  assert.match(html, /session-requested/);
  assert.match(html, /pedida por .*github\.com\/ana/s);
  assert.ok(html.includes(fmtClock(Date.parse(em))));
  assert.match(sessionCardHtml({ id: 'a1', label: 'x', pedido: { por: 'eqp', em, time: true } }, ''), /pedida por um time/);
  assert.doesNotMatch(sessionCardHtml({ id: 'a1', label: 'x' }, ''), /pedida por|não identificado/);
  assert.match(sessionCardHtml({ id: 'a1', label: 'x', pedido: null }, ''), /pedido não identificado/);
});

test('avisoDe("review-started") monta o aviso silencioso com o pedido', () => {
  const em = '2026-11-05T10:00:00Z';
  assert.deepEqual(avisoDe('review-started', { pr: PR, pedido: { por: 'ana', em, time: false } }), {
    titulo: 'Revisão automática iniciada', corpo: `o/r#7, pedida por @ana às ${fmtClock(Date.parse(em))}`, url: PR.url, pr: 'o/r#7', silencioso: true,
  });
  assert.equal(avisoDe('review-started', { pr: PR, pedido: null }).corpo, 'o/r#7, pedido não identificado');
});
