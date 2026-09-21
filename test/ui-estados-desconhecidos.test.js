// O QUE A TELA NÃO SABE, ELA NÃO AFIRMA (20/09/2026).
//
// Três afirmações medidas no código da sincronização, todas do mesmo tipo: a ausência de
// dado sendo lida como negação.
//
//   1. "Ninguém administra este conjunto ainda" saía sempre que o campo `admin` não existia
//      na projeção. Mas o engine OMITE o campo de propósito quando não sabe quem administra
//      (o comentário de sync-telas.js diz: "a tela não pode ler promessa de autoridade num
//      objeto vazio"). A tela lia a ausência como negação e afirmava um fato sobre o
//      conjunto inteiro — e quem lê conclui que pode virar admin sem depor ninguém, o que
//      cria geração nova e invalida tudo o que o anterior assinou.
//   2. e 3. `PEND` e `LIVE` nascem vazios no Radar e são pintados assim que o
//      compartilhamento fica ligado, ANTES de qualquer evento SSE: "Nada precisa de você em
//      nenhum outro aparelho" e "Nenhuma análise rodando em outro aparelho agora" apareciam
//      antes de o Farol ter lido qualquer coisa. E a faixa que existiria para avisar se
//      cala justamente nesse caso, porque `andamentoAtrasado` devolve `atrasada: false`
//      quando `at === 0`. `REVISOES` já tinha `estado: 'inicial'`; as outras duas não.
process.env.TZ = 'America/Sao_Paulo';

import { test } from 'node:test';
import assert from 'node:assert/strict';
const P = await import('../ui/pure.js');

const AGORA = Date.UTC(2026, 8, 20, 16, 0, 0);

/* ---------- 1: ninguém administra x não sei quem administra ---------- */

function admin(opcoes) {
  return P.aparelhosAdminHtml(null, { devices: [], agora: AGORA, ...opcoes });
}

test('sem ter lido o admin, a tela NÃO afirma que ninguém administra', () => {
  const html = admin({ adminLido: 0, status: 'conectado' });
  assert.equal(html.includes('Ninguém administra'), false, 'ausência de leitura não é ausência de admin');
  assert.match(html, /ainda não conseguiu ler quem administra/);
});

// Os dois estados sao opostos e o selo era o MESMO cinza para os dois: "nao se sabe" (nao li)
// e "sem admin" (li, e nao ha admin). Quem le rapido so tem o selo, entao ele tem de separar.
test('o selo de ainda não ter lido não se confunde com o de não haver admin', () => {
  const semLeitura = admin({ adminLido: 0, status: 'conectado' });
  const lido = admin({ adminLido: AGORA - 5000, status: 'conectado' });
  assert.match(semLeitura, /ainda não li/, 'o selo de ausência de leitura usa o vocabulário das outras telas');
  assert.equal(semLeitura.includes('sem admin'), false, 'ausência de leitura não pode usar o selo de não haver admin');
  assert.match(lido, /sem admin/);
  assert.equal(lido.includes('ainda não li'), false);
  const selo = (h) => (/<span class="sync-chip ([a-z]+)">/.exec(h) || [])[1];
  assert.notEqual(selo(semLeitura), selo(lido), 'os dois estados não podem ter a mesma cor de selo');
});

test('desconectado, a tela diz que não sabe, e diz por quê', () => {
  const html = admin({ adminLido: 0, status: 'sem-credencial' });
  assert.equal(html.includes('Ninguém administra'), false);
  assert.match(html, /este aparelho não está conectado/);
});

test('com a leitura feita e nenhum admin, aí sim a tela afirma', () => {
  const html = admin({ adminLido: AGORA - 5000, status: 'conectado' });
  assert.match(html, /Ninguém administra este conjunto ainda/);
});

test('sem saber, o botão de virar admin não promete depor ninguém', () => {
  const html = admin({ adminLido: 0, status: 'conectado' });
  assert.equal(html.includes('O admin anterior perde a autoridade'), false, 'não dá para falar de um admin que não se sabe se existe');
});

// O admin conhecido é o LOCAL e está sem batimento: ele não é um terceiro, e o texto que
// oferece a promoção falava de "o admin anterior" quando o anterior é ele mesmo.
test('admin local sem batimento: o texto não trata este aparelho como um terceiro', () => {
  const html = P.aparelhosAdminHtml(
    { deviceId: 'dEu', souEu: true, fresca: false, generation: 7, ultimoBatimentoEm: AGORA - 12 * 60000 },
    { devices: [], agora: AGORA, adminLido: AGORA, status: 'conectado' },
  );
  assert.match(html, /Este aparelho é o admin da geração 7/);
  assert.equal(html.includes('O admin anterior perde a autoridade'), false, 'o admin anterior é ele mesmo');
  assert.match(html, /a autoridade deste aparelho recomeça na geração 8/);
});

test('admin de OUTRO aparelho sem batimento: o texto da promoção continua o de sempre', () => {
  const html = P.aparelhosAdminHtml(
    { deviceId: 'dB', souEu: false, fresca: false, generation: 7, ultimoBatimentoEm: AGORA - 12 * 60000 },
    { devices: [{ deviceId: 'dB', name: 'Celular' }], agora: AGORA, adminLido: AGORA, status: 'conectado' },
  );
  assert.match(html, /O admin anterior perde a autoridade/);
});

/* ---------- 2 e 3: antes da primeira leitura, nada de zero afirmado ---------- */

test('pendências: antes da primeira leitura a tela diz que ainda não leu', () => {
  const html = P.pendenciasCompartilhadasHtml([], { estado: 'inicial' });
  assert.equal(html.includes('Nada precisa de você em nenhum outro aparelho'), false);
  assert.match(html, /ainda não leu/);
});

test('pendências: leitura concluída e vazia é ausência de verdade', () => {
  const html = P.pendenciasCompartilhadasHtml([], { estado: 'lido' });
  assert.match(html, /Nada precisa de você em nenhum outro aparelho/);
});

test('operações: antes da primeira leitura a tela não afirma que nada roda', () => {
  const html = P.operacoesRemotasHtml([], { estado: 'inicial' });
  assert.equal(html.includes('Nenhuma análise rodando em outro aparelho agora'), false);
  assert.match(html, /ainda não leu/);
});

test('operações: leitura concluída e vazia é ausência de verdade', () => {
  assert.match(P.operacoesRemotasHtml([], { estado: 'lido' }), /Nenhuma análise rodando em outro aparelho agora/);
});

test('sem estado informado, o comportamento antigo vale: lista vazia é vazio', () => {
  assert.match(P.operacoesRemotasHtml([], {}), /Nenhuma análise rodando em outro aparelho agora/);
  assert.match(P.pendenciasCompartilhadasHtml([], {}), /Nada precisa de você em nenhum outro aparelho/);
});

/* ---------- at === 0 não é informação atualizada ---------- */

test('andamentoAtrasado: sem leitura nenhuma, a faixa diz isso em vez de se calar', () => {
  const r = P.andamentoAtrasado(0, AGORA, { estado: 'inicial' });
  assert.equal(r.atrasada, true, 'at === 0 não pode significar "em dia"');
  assert.match(r.texto, /ainda não leu/);
});

test('andamentoAtrasado: leitura recente segue sem faixa', () => {
  assert.equal(P.andamentoAtrasado(AGORA - 1000, AGORA, { estado: 'lido' }).atrasada, false);
});

test('andamentoAtrasado: leitura velha continua acusando a idade', () => {
  const r = P.andamentoAtrasado(AGORA - 10 * 60000, AGORA, { estado: 'lido' });
  assert.equal(r.atrasada, true);
  assert.match(r.texto, /Leitura atrasada/);
});

test('andamentoAtrasadoHtml: falha continua vencendo a idade', () => {
  const html = P.andamentoAtrasadoHtml(0, AGORA, AGORA - 2000, { estado: 'inicial' });
  assert.match(html, /leitura falhou/);
  assert.match(html, /Nenhuma leitura anterior deu certo/);
});

/* ---------- uma derivação só de "sou o admin" ---------- */

test('aparelhosSouAdmin e comandoPermitido respondem a MESMA regra, caso a caso', () => {
  const casos = [
    null,
    { souEu: true, fresca: true },
    { souEu: true, fresca: false },
    { souEu: false, fresca: true },
    { souEu: false, fresca: false },
    { souEu: true },
    { fresca: true },
  ];
  for (const admin of casos) {
    assert.equal(P.aparelhosSouAdmin(admin), P.comandoPermitido({ admin }).pode, JSON.stringify(admin));
  }
});

test('comandoPermitido continua dando o motivo de cada recusa, que é o que a tela mostra', () => {
  assert.match(P.comandoPermitido({ admin: null }).motivo, /nenhum aparelho admin é conhecido/);
  assert.match(P.comandoPermitido({ admin: { souEu: false, fresca: true } }).motivo, /este não é o admin/);
  assert.match(P.comandoPermitido({ admin: { souEu: true, fresca: false } }).motivo, /sem sinal fresco/);
  assert.equal(P.comandoPermitido({ admin: { souEu: true, fresca: true } }).motivo, '');
});
