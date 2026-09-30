// O bloqueio do GitHub tem que APARECER. Antes disto ele existia só no farol.log, e a
// tela seguia exibindo o panorama velho como se fosse o de agora: 38 bloqueios medidos no
// aparelho do Wanderson em poucos dias, nenhum visível para quem olhava o painel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusBannerHtml } from '../ui/pure/contas.js';
import limiteGh from '../lib/engine/limite-gh.js';

const contaOk = { account: { user: 'ana', tokenOk: true }, status: 'idle' };

test('sem bloqueio, o aviso não existe', () => {
  assert.equal(statusBannerHtml({ ...contaOk, buscasPausadas: [] }), '');
  assert.equal(statusBannerHtml(contaOk), '');
});

test('com bloqueio, a tela diz qual conta e até quando', () => {
  const html = statusBannerHtml({ ...contaOk, buscasPausadas: [{ conta: 'ana', ate: Date.now() + 120_000 }] });
  assert.match(html, /Buscas pausadas/);
  assert.match(html, /@ana/);
  assert.match(html, /último retrato/, 'tem que dizer que o que está na tela é retrato velho');
});

test('duas contas bloqueadas aparecem as duas', () => {
  const html = statusBannerHtml({
    ...contaOk,
    buscasPausadas: [{ conta: 'ana', ate: Date.now() + 60_000 }, { conta: 'bia', ate: Date.now() + 90_000 }],
  });
  assert.match(html, /@ana/);
  assert.match(html, /@bia/);
});

// O bloqueio muda como ler TODO o resto da tela, então ele vem antes do aviso de falha
// da última checagem, que é justamente o que o limite costuma provocar.
test('o aviso de bloqueio vem antes do de falha na checagem', () => {
  const html = statusBannerHtml({
    account: { user: 'ana', tokenOk: true }, status: 'error', error: 'gh search falhou',
    buscasPausadas: [{ conta: 'ana', ate: Date.now() + 60_000 }],
  });
  assert.match(html, /Buscas pausadas/);
  assert.doesNotMatch(html, /Falha na última checagem/);
});

/* ---------- a projeção que alimenta a tela ---------- */

test('buscasPausadas projeta as contas paradas, e só elas', () => {
  const agora = 1_000_000;
  const engine = { limitesDeBuscaGh: new Map([['ana', agora + 60_000], ['bia', agora - 1]]) };
  const fora = limiteGh.buscasPausadas(engine, agora);
  assert.deepEqual(fora, [{ conta: 'ana', ate: agora + 60_000 }],
    'prazo vencido não é bloqueio: a conta volta a buscar sozinha');
});

test('buscasPausadas devolve lista vazia quando ninguém está parado', () => {
  assert.deepEqual(limiteGh.buscasPausadas({}), []);
});

test('buscasPausadas ordena pela conta que volta primeiro', () => {
  const agora = 1_000_000;
  const engine = { limitesDeBuscaGh: new Map([['ana', agora + 90_000], ['bia', agora + 30_000]]) };
  assert.deepEqual(limiteGh.buscasPausadas(engine, agora).map(x => x.conta), ['bia', 'ana']);
});
