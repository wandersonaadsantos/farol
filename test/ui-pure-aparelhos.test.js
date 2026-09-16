// As funções PURAS da seção Sistema > Aparelhos (ui/pure/aparelhos.js). Sem DOM: cada uma
// recebe a projeção `statusForUi`, a config e o que a tela leu sob demanda, e devolve HTML.
//
// O que está em jogo aqui não é layout, é o que a tela AFIRMA:
//   - proteção desligada nunca aparece como ativa (admin sem sinal de vida, chave de
//     limpeza desligada ou não verificável, consentimento retirado);
//   - falha nunca se disfarça de vazio (carregando, vazio, falha com motivo, indisponível
//     e desligado são cinco saídas diferentes);
//   - ato destrutivo só aparece onde ele de fato pode acontecer.
process.env.TZ = 'America/Sao_Paulo';

import { test } from 'node:test';
import assert from 'node:assert/strict';
const P = await import('../ui/pure.js');

const AGORA = Date.parse('2026-09-16T12:00:00-03:00');

function aparelho(extra = {}) {
  return { deviceId: 'dEu', name: 'Notebook de teste', platform: 'Windows', farolVersion: '2.60.0', lastSeenAt: AGORA, retiredAt: 0, euMesmo: true, ...extra };
}

function sync(extra = {}) {
  return {
    enabled: true, shared: true, status: 'conectado', deviceId: 'dEu', deviceName: 'Notebook de teste',
    devices: [aparelho()], coberturaPostagem: [], admin: null, designacaoAdmin: null, ...extra,
  };
}

/* ---------- garantia não coberta ---------- */

test('aparelhosContasNaoCobertas: a conta sai da cobertura, e o nome casa com o do aparelho', () => {
  const cobertura = [
    { account: 'acme-exemplo', coberta: false, naoCobertaPor: ['Desktop antigo'] },
    { account: 'outra-exemplo', coberta: true, naoCobertaPor: [] },
  ];
  const velho = aparelho({ deviceId: 'dVelho', name: 'Desktop antigo', euMesmo: false });
  assert.deepEqual(P.aparelhosContasNaoCobertas(cobertura, velho), ['acme-exemplo']);
  assert.deepEqual(P.aparelhosContasNaoCobertas(cobertura, aparelho()), []);
  assert.deepEqual(P.aparelhosContasNaoCobertas(null, aparelho()), [], 'sem cobertura lida, nada é afirmado');
});

test('aparelhosContasNaoCobertas: aparelho sem nome é identificado pelo id, como o engine faz', () => {
  const cobertura = [{ account: 'acme-exemplo', coberta: false, naoCobertaPor: ['dSemNome'] }];
  const sem = aparelho({ deviceId: 'dSemNome', name: '', euMesmo: false });
  assert.deepEqual(P.aparelhosContasNaoCobertas(cobertura, sem), ['acme-exemplo']);
});

/* ---------- lista de aparelhos ---------- */

test('aparelhosListaHtml: nome, sistema, versão e visto, com "este" e sem ação de aposentar em quem já está aposentado', () => {
  const lista = [
    aparelho(),
    aparelho({ deviceId: 'dVelho', name: 'Desktop antigo', platform: 'Linux', farolVersion: '2.58.2', euMesmo: false }),
    aparelho({ deviceId: 'dCel', name: 'Celular de teste', platform: 'Android', retiredAt: AGORA, euMesmo: false }),
  ];
  const html = P.aparelhosListaHtml(lista, { cobertura: [{ account: 'acme-exemplo', coberta: false, naoCobertaPor: ['Desktop antigo'] }], agora: AGORA, souAdmin: true, admin: { deviceId: 'dVelho', souEu: false, fresca: true, generation: 3 } });
  assert.match(html, /Notebook de teste/);
  assert.match(html, /Windows/);
  assert.match(html, /v2\.58\.2/);
  assert.match(html, />este</);
  assert.match(html, /garantia não coberta/);
  assert.match(html, /aposentado/);
  assert.match(html, /data-apar-reativar="dCel"/);
  assert.ok(!html.includes('data-apar-aposentar="dCel"'), 'aparelho aposentado não recebe de novo o botão de aposentar');
  assert.match(html, /data-apar-aposentar="dVelho"/);
  assert.match(html, /data-apar-politica="dVelho"/, 'o admin pode publicar política de outro aparelho');
});

test('aparelhosListaHtml: versão ausente é "desconhecida", nunca vazio', () => {
  const html = P.aparelhosListaHtml([aparelho({ farolVersion: '' })], { agora: AGORA });
  assert.match(html, /desconhecida/);
});

test('aparelhosListaHtml: sem aparelho nenhum, diz que a lista está vazia e não some', () => {
  const html = P.aparelhosListaHtml([], { agora: AGORA });
  assert.match(html, /Nenhum aparelho/);
});

test('aparelhosListaHtml: quem não é admin não recebe o botão de política', () => {
  const html = P.aparelhosListaHtml([aparelho()], { agora: AGORA, souAdmin: false });
  assert.ok(!html.includes('data-apar-politica'), 'política publicada só pelo admin da geração vigente');
});

test('aparelhosListaHtml: escapa o nome do aparelho', () => {
  const html = P.aparelhosListaHtml([aparelho({ name: '<img src=x>' })], { agora: AGORA });
  assert.ok(!html.includes('<img src=x>'));
  assert.match(html, /&lt;img/);
});

/* ---------- administração ---------- */

test('aparelhosAdminHtml: sem admin conhecido não promete autoridade nenhuma', () => {
  const html = P.aparelhosAdminHtml(null, { devices: [aparelho()] });
  assert.match(html, /Ninguém administra/);
  assert.match(html, /id="aparSenhaAdmin"/);
  assert.ok(!html.includes('sem sinal de vida'));
});

test('aparelhosAdminHtml: admin sem sinal de vida aparece como NÃO valendo', () => {
  const html = P.aparelhosAdminHtml({ deviceId: 'dVelho', generation: 3, souEu: false, fresca: false }, { devices: [aparelho({ deviceId: 'dVelho', name: 'Desktop antigo', euMesmo: false })] });
  assert.match(html, /admin sem sinal de vida/);
  assert.match(html, /Desktop antigo/);
  assert.match(html, /geração 3/);
  assert.match(html, /id="aparTornarAdmin"/);
});

test('aparelhosAdminHtml: este aparelho é o admin, e aí não se oferece virar admin de novo', () => {
  const html = P.aparelhosAdminHtml({ deviceId: 'dEu', generation: 4, souEu: true, fresca: true }, { devices: [aparelho()] });
  assert.match(html, /Este aparelho é o admin/);
  assert.ok(!html.includes('id="aparTornarAdmin"'), 'quem já é admin da geração vigente não vira admin de novo');
});

test('aparelhosDesignacaoHtml: sem pedido não rende nada; com pedido, pede a senha DESTE aparelho', () => {
  assert.equal(P.aparelhosDesignacaoHtml(null), '');
  const html = P.aparelhosDesignacaoHtml({ desde: AGORA }, AGORA);
  assert.match(html, /senha/i);
  assert.match(html, /id="aparAceitarDesignacao"/);
});

/* ---------- consentimento ---------- */

test('aparelhosConsentimentoHtml: reflete sync.aceitarAdmin e não liga sozinho', () => {
  assert.match(P.aparelhosConsentimentoHtml({ aceitarAdmin: true }), /id="setSyncAceitarAdmin"[^>]*checked/);
  const off = P.aparelhosConsentimentoHtml({ aceitarAdmin: false });
  assert.ok(!/id="setSyncAceitarAdmin"[^>]*checked/.test(off));
  assert.ok(!/id="setSyncAceitarAdmin"[^>]*checked/.test(P.aparelhosConsentimentoHtml(null)), 'sem config, o consentimento não se presume dado');
});

/* ---------- política de um aparelho ---------- */

test('aparelhoPoliticaHtml: teto só de 1 a 4, tipos da allowlist e recusa com motivo', () => {
  const html = P.aparelhoPoliticaHtml(aparelho({ deviceId: 'dVelho', name: 'Desktop antigo', euMesmo: false }), { recusa: 'a política não foi assinada pelo admin vigente' });
  assert.match(html, /Desktop antigo/);
  for (const n of ['1', '2', '3', '4']) assert.match(html, new RegExp(`value="${n}"`));
  assert.ok(!html.includes('value="5"'), 'o teto de paralelismo vai só até 4');
  for (const t of ['review', 'self', 'pushback', 'chat', 'tool']) assert.match(html, new RegExp(`value="${t}"`));
  assert.match(html, /a política não foi assinada pelo admin vigente/);
  assert.match(html, /id="aparPublicarPolitica"/);
});

test('aparelhoPoliticaHtml: sem aparelho escolhido, nada de formulário', () => {
  assert.equal(P.aparelhoPoliticaHtml(null, {}), '');
});

/* ---------- navegadores pareados ---------- */

test('aparelhosNavegadoresHtml: os cinco estados são distintos', () => {
  assert.match(P.aparelhosNavegadoresHtml({ estado: 'carregando' }), /carregando/i);
  assert.match(P.aparelhosNavegadoresHtml({ estado: 'nao-exigida' }), /não exige credencial/i);
  assert.match(P.aparelhosNavegadoresHtml({ estado: 'falha', motivo: 'o servidor não respondeu' }), /o servidor não respondeu/);
  assert.match(P.aparelhosNavegadoresHtml({ estado: 'ok', sessoes: [] }), /Nenhum navegador/);
  const html = P.aparelhosNavegadoresHtml({ estado: 'ok', sessoes: [{ id: 'abc123', rotulo: 'Chrome do celular', criadoEm: AGORA, ultimoUsoEm: AGORA, atual: true }] }, AGORA);
  assert.match(html, /Chrome do celular/);
  assert.match(html, /este navegador/);
  assert.match(html, /data-apar-revogar-sessao="abc123"/);
});

/* ---------- limpeza e revogação ---------- */

test('aparelhosLimpezaHtml: chave desligada não oferece limpar, e só o admin liga', () => {
  const desligada = P.aparelhosLimpezaHtml({ estado: 'desligada' }, { souAdmin: true });
  assert.match(desligada, /desligada/);
  assert.match(desligada, /id="aparLigarLimpeza"/);
  assert.ok(!desligada.includes('id="aparLimpar"'), 'com a chave desligada não existe limpeza a fazer');
  const semAdmin = P.aparelhosLimpezaHtml({ estado: 'desligada' }, { souAdmin: false });
  assert.ok(!semAdmin.includes('id="aparLigarLimpeza"'), 'a chave de limpeza é do admin da geração vigente');
});

test('aparelhosLimpezaHtml: ligada oferece limpar com a senha, e nomeia o que nunca é apagado', () => {
  const html = P.aparelhosLimpezaHtml({ estado: 'ligada' }, { souAdmin: true });
  assert.match(html, /id="aparLimpar"/);
  assert.match(html, /chaveiro/);
  assert.match(html, /recibos/);
});

test('aparelhosLimpezaHtml: "desligada ou não verificável" não vira "ligada" nem "desligada"', () => {
  const html = P.aparelhosLimpezaHtml({ estado: 'desligada-ou-nao-verificavel' }, { souAdmin: true });
  assert.match(html, /não dá para confirmar/i);
  assert.ok(!html.includes('id="aparLimpar"'), 'sem confirmação da chave, a limpeza não é oferecida');
});

test('aparelhosLimpezaHtml: carregando e falha são estados próprios, e nenhum deles é "desligada"', () => {
  assert.match(P.aparelhosLimpezaHtml({ estado: 'carregando' }, {}), /carregando/i);
  const falha = P.aparelhosLimpezaHtml({ estado: 'falha', motivo: 'não deu para ler a chave de limpeza agora' }, {});
  assert.match(falha, /não deu para ler a chave de limpeza agora/);
  assert.ok(!falha.includes('id="aparLimpar"'));
});

test('aparelhosLimpezaHtml: com o compartilhamento desligado, a limpeza não se aplica', () => {
  const html = P.aparelhosLimpezaHtml({ estado: 'compartilhamento-desligado' }, { souAdmin: true });
  assert.match(html, /compartilhamento/);
  assert.ok(!html.includes('id="aparLigarLimpeza"'));
});

test('aparelhosLimpezaHtml: revogar o conjunto está sempre à mão, com o que ele NÃO faz', () => {
  const html = P.aparelhosLimpezaHtml({ estado: 'desligada' }, {});
  assert.match(html, /id="aparRevogar"/);
  assert.match(html, /não cancela/i);
});

/* ---------- a seção inteira ---------- */

test('aparelhosSouAdmin: ser o dono da geração não basta, precisa de batimento recente', () => {
  assert.equal(P.aparelhosSouAdmin({ deviceId: 'dEu', souEu: true, fresca: true }), true);
  assert.equal(P.aparelhosSouAdmin({ deviceId: 'dEu', souEu: true, fresca: false }), false);
  assert.equal(P.aparelhosSouAdmin({ deviceId: 'dOutro', souEu: false, fresca: true }), false);
  assert.equal(P.aparelhosSouAdmin(null), false);
});

test('aparelhosSecaoHtml: admin sem sinal de vida não recebe botão de política nem chave de limpeza', () => {
  const html = P.aparelhosSecaoHtml({
    sync: sync({ admin: { deviceId: 'dEu', generation: 2, souEu: true, fresca: false } }),
    cfg: { enabled: true }, auth: { estado: 'nao-exigida' }, limpeza: { estado: 'desligada' }, agora: AGORA,
  });
  assert.ok(!html.includes('data-apar-politica'));
  assert.ok(!html.includes('id="aparLigarLimpeza"'));
});

test('aparelhosSecaoHtml: sincronização desligada mostra o desligado, e não uma lista vazia', () => {
  const html = P.aparelhosSecaoHtml({ sync: sync({ enabled: false }), cfg: { enabled: false } });
  assert.match(html, /desligada/);
  assert.match(html, /data-goto="sys:sync"/);
  assert.ok(!html.includes('data-apar-aposentar'), 'sem sincronização não existe aparelho a administrar');
});

test('aparelhosSecaoHtml: ligada monta lista, administração, consentimento, navegadores e limpeza', () => {
  const html = P.aparelhosSecaoHtml({
    sync: sync({ admin: { deviceId: 'dEu', generation: 2, souEu: true, fresca: true } }),
    cfg: { enabled: true, aceitarAdmin: true },
    auth: { estado: 'ok', sessoes: [] },
    limpeza: { estado: 'ligada' },
    agora: AGORA,
  });
  assert.match(html, /Notebook de teste/);
  assert.match(html, /Este aparelho é o admin/);
  assert.match(html, /setSyncAceitarAdmin/);
  assert.match(html, /Nenhum navegador/);
  assert.match(html, /id="aparLimpar"/);
});
