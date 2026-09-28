// Decisão com o review completo (Task 8, 28/09/2026). O admin vê, em outro aparelho, o
// review inteiro de uma pendência (corpo e inlines por arquivo de cada ação possível) e
// decide com quatro ações; o aparelho dono posta com a conta e os gates dele.
//
// As provas de tamanho cifram de VERDADE contra lib/sync/envelope.js, com o mesmo nó,
// esquema e extras que o motor usa: estimativa de bytes à parte não prova teto nenhum.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-decisao-remota-'));
process.env.FAROL_HOME = BASE;
after(() => { try { fs.rmSync(BASE, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ } });

const pendencia = (await import('../lib/sync/pendencia.js')).default;
const historico = (await import('../lib/sync/historico.js')).default;
const comando = (await import('../lib/sync/comando.js')).default;
const envelope = (await import('../lib/sync/envelope.js')).default;
const kek = (await import('../lib/sync/kek.js')).default;
const comandos = (await import('../lib/engine/sync-comandos.js')).default;
const P = await import('../ui/pure.js');
const decisionMod = (await import('../lib/engine/decision.js')).default;
const { decisionForUi } = await import('../lib/engine/public-review.js');

const K = randomBytes(32);
const MATERIAL = kek.novoMaterial();
const UID = 'u1';
const DEV = 'd'.repeat(32);
const T = 'a'.repeat(32);

function payload(event, body, comments = []) {
  return { event, body, comments };
}

const ITEM = {
  id: 'i1', key: 'acme-exemplo/app-web#41', pr: { account: 'eu', repo: 'acme-exemplo/app-web', number: 41 },
  verdict: 'request_changes', createdAt: 1_700_000_000_000,
  reasons: [{ text: 'falta teste do rodapé', kind: 'content' }],
  payloads: {
    approve: payload('APPROVE', 'Pode seguir.'),
    request_changes: payload('REQUEST_CHANGES', 'Precisa de ajuste.', [{ path: 'src/a.js', line: 3, body: 'aqui quebra', side: 'RIGHT', extra: 'x' }]),
    comment: payload('COMMENT', 'Só uma nota.'),
  },
};

/* ---------- 1. a pendência leva reviewId e as ações ---------- */

test('projetarPendencia leva o reviewId do corpo e as ações que têm payload, mais pular', () => {
  const p = pendencia.projetarPendencia(ITEM, { kId: K, dev: 'd1' });
  assert.equal(p.reviewId, historico.reviewIdDe(K, 'd1', ITEM.id));
  assert.deepEqual(p.acoes, ['approve', 'request_changes', 'comment', 'skip']);
  const soAprovar = pendencia.projetarPendencia({ ...ITEM, payloads: { approve: ITEM.payloads.approve, lixo: {} } }, { kId: K, dev: 'd1' });
  assert.deepEqual(soAprovar.acoes, ['approve', 'skip']);
  const semDev = pendencia.projetarPendencia(ITEM, { kId: K });
  assert.equal(semDev.reviewId, '', 'sem aparelho não existe reviewId de verdade');
});

// Revisão final (28/09/2026): o pior caso é o ESCAPADO. Aspas e barras pesam dois bytes no
// JSON do envelope, e caractere de controle pesa seis (\u0001).
test('a pendência cifrada cabe no nó mesmo com 10 motivos de 300 caracteres acentuados ou escapados', () => {
  for (const ch of ['x', 'ç', '"', '\\', '\u0001', '"ç\\']) {
    const reasons = Array.from({ length: 10 }, () => ({ text: ch.repeat(300), kind: 'content' }));
    const p = pendencia.projetarPendencia({ ...ITEM, blockedKind: 'stale_head', reasons }, { kId: K, dev: DEV });
    assert.ok(p.motivos.length >= 1);
    const r = envelope.cifrar({
      uid: UID, caminho: `live/pending/${'f'.repeat(32)}`, campo: 'pendencia', no: 'live/pending', esquema: 'pend1',
      cur: 'g1', material: MATERIAL, r: 1, extras: [1_700_000_000_000, DEV], dados: { p },
    });
    assert.equal(r.ok, true, `motivos de ${JSON.stringify(ch)} estouram o teto: ${r.motivo}`);
    assert.equal(p.motivos.length + p.motivosOmitidos, 10, 'o que não coube é contado');
  }
});

/* ---------- 2. o comando decidir aceita as quatro ações, e reject por compatibilidade ---------- */

test('sanearComando: decidir aceita as quatro ações e reject; ação desconhecida não', () => {
  for (const acao of ['approve', 'request_changes', 'comment', 'skip', 'reject']) {
    assert.deepEqual(comando.sanearComando({ tipo: 'decidir', args: { itemId: T, acao } }), { tipo: 'decidir', args: { itemId: T, acao } }, acao);
  }
  assert.equal(comando.sanearComando({ tipo: 'decidir', args: { itemId: T, acao: 'apagar' } }), null);
});

/* ---------- 3. o executor traduz reject para request_changes ---------- */

test('executor: reject de um admin antigo vira request_changes no decide', async () => {
  const kId = kek.bufferDe(MATERIAL.id);
  const chamadas = [];
  const engine = {
    sync: { material: MATERIAL, deviceId: DEV },
    decisions: { pending: [{ id: 'i1' }] },
    decide: async (id, acao) => { chamadas.push([id, acao]); return { ok: true }; },
  };
  const itemId = pendencia.itemIdDe(kId, DEV, 'i1');
  const r1 = await comandos.executar(engine, {}, 'c1', { tipo: 'decidir', args: { itemId, acao: 'reject' } }, 1);
  const r2 = await comandos.executar(engine, {}, 'c2', { tipo: 'decidir', args: { itemId, acao: 'comment' } }, 1);
  assert.equal(r1.estado, 'aplicado');
  assert.equal(r2.estado, 'aplicado');
  assert.deepEqual(chamadas, [['i1', 'request_changes'], ['i1', 'comment']]);
});

/* ---------- 4. o corpo do histórico leva os payloads saneados ---------- */

test('corpo do histórico leva o corpo e os inlines de cada ação, sem campo fora da lista', () => {
  const corpo = historico.corpoDe({ id: 'i1', reportMarkdown: 'r', payloads: { cru: true } }, ITEM.payloads);
  assert.equal(corpo.payloads.approve.body, 'Pode seguir.');
  assert.equal(corpo.payloads.approve.event, 'APPROVE');
  assert.deepEqual(corpo.payloads.request_changes.comments, [{ path: 'src/a.js', line: 3, body: 'aqui quebra' }]);
  assert.equal(corpo.cortado, undefined);
  assert.equal(historico.corpoDe({ id: 'i1' }).payloads, undefined, 'sem payloads, o corpo segue como antes');
});

function payloadsGigantes(ch = 'x') {
  const inlines = Array.from({ length: 80 }, (_, i) => ({ path: `src/arquivo-${i}.js`, line: i + 1, body: ch.repeat(2000) }));
  return {
    approve: payload('APPROVE', ch.repeat(20000), inlines),
    request_changes: payload('REQUEST_CHANGES', ch.repeat(20000), inlines),
    comment: payload('COMMENT', ch.repeat(20000), inlines),
  };
}

test('payload gigante é cortado, marcado, e o corpo cifrado cabe no nó de corpos', () => {
  for (const ch of ['x', 'ç']) {
    const ui = { id: 'i1', key: ITEM.key, reportMarkdown: ch.repeat(4000), reasons: [{ text: ch.repeat(300), kind: 'content' }] };
    const corpo = historico.corpoDe(ui, payloadsGigantes(ch));
    assert.equal(corpo.cortado, true);
    assert.ok(corpo.payloads.approve.body.length <= 12000);
    const r = envelope.cifrar({
      uid: UID, caminho: `reviewBodies/${T}/1700000000000`, campo: 'corpo', no: 'reviewBodies', esquema: 'rb1',
      cur: 'g1', material: MATERIAL, r: 1_700_000_000_000, dados: { c: corpo },
    });
    assert.equal(r.ok, true, `corpo de "${ch}" estoura o teto: ${r.motivo}`);
  }
});

test('review de tamanho comum chega inteiro, sem corte', () => {
  const inlines = Array.from({ length: 20 }, (_, i) => ({ path: `src/c-${i}.js`, line: i + 1, body: 'z'.repeat(400) }));
  const corpo = historico.corpoDe({ id: 'i1', reportMarkdown: 'r'.repeat(3000) }, {
    approve: payload('APPROVE', 'a'.repeat(6000)),
    request_changes: payload('REQUEST_CHANGES', 'b'.repeat(6000), inlines),
    comment: payload('COMMENT', 'c'.repeat(6000)),
  });
  assert.equal(corpo.cortado, undefined);
  assert.equal(corpo.payloads.request_changes.comments.length, 20);
  assert.equal(corpo.payloads.comment.body.length, 6000);
});

test('o corte tira primeiro os inlines de comentar, depois os de pedir mudanças', () => {
  const inlines = Array.from({ length: 60 }, (_, i) => ({ path: `src/b-${i}.js`, line: i, body: 'y'.repeat(200) }));
  const corpo = historico.corpoDe({ id: 'i1' }, {
    approve: payload('APPROVE', 'ok', inlines),
    request_changes: payload('REQUEST_CHANGES', 'muda', inlines),
    comment: payload('COMMENT', 'nota', inlines),
  });
  assert.equal(corpo.cortado, true);
  assert.equal(corpo.payloads.comment.comments.length, 0);
  assert.equal(corpo.payloads.request_changes.comments.length, 60, 'pedir mudanças mantém os inlines enquanto couber');
  assert.equal(corpo.payloads.approve.comments.length, 60);
});

/* ---------- 5. a tela ---------- */

test('pendência mostra os motivos por extenso e o botão Ver review completo', () => {
  const p = {
    itemId: 'ab12', dev: 'dOutro', aparelho: 'Desktop antigo', at: 1, visto: false, veredito: 'request_changes',
    motivos: [{ text: 'falta <teste>', kind: 'content' }], bloqueio: '', reviewId: 'c'.repeat(32), acoes: ['approve', 'comment', 'skip'],
  };
  const html = P.pendenciasCompartilhadasHtml([p], { podeComandar: true });
  assert.match(html, /<ul class="md-motivos">/);
  assert.match(html, /falta &lt;teste&gt;/);
  assert.match(html, /Ver review completo/);
  assert.match(html, new RegExp(`data-review="${'c'.repeat(32)}"`));
  assert.doesNotMatch(P.pendenciasCompartilhadasHtml([{ ...p, reviewId: '' }], {}), /Ver review completo/);
});

test('motivos omitidos aparecem no card: a lista parcial nunca parece completa', () => {
  const p = { itemId: 'ab12', dev: 'dOutro', veredito: 'request_changes', motivos: [{ text: 'falta teste', kind: 'content' }], acoes: ['skip'] };
  assert.match(P.pendenciasCompartilhadasHtml([{ ...p, motivosOmitidos: 3 }], {}), /\+3 motivos no review completo/);
  assert.match(P.pendenciasCompartilhadasHtml([{ ...p, motivosOmitidos: 3 }], {}), /4 motivos registrados/, 'a contagem do card soma os omitidos');
  assert.match(P.pendenciasCompartilhadasHtml([{ ...p, motivosOmitidos: 1 }], {}), /\+1 motivo no review completo/);
  assert.match(P.pendenciasCompartilhadasHtml([{ ...p, motivos: [], motivosOmitidos: 2 }], {}), /\+2 motivos no review completo/, 'mesmo sem nenhum motivo que coube');
  for (const nada of [0, undefined, -4, 'x', '<b>']) {
    assert.doesNotMatch(P.pendenciasCompartilhadasHtml([{ ...p, motivosOmitidos: nada }], {}), /no review completo/, String(nada));
  }
});

test('as opções da decisão são só as ações que a pendência oferece', () => {
  assert.deepEqual(P.opcoesDaDecisao(['approve', 'comment', 'skip']).map((o) => o.valor), ['skip', 'comment', 'approve']);
  assert.deepEqual(P.opcoesDaDecisao(['approve', 'request_changes', 'comment', 'skip']).map((o) => o.rotulo), ['Pular', 'Só comentar', 'Pedir mudanças', 'Aprovar']);
  assert.deepEqual(P.opcoesDaDecisao(undefined).map((o) => o.valor), ['reject', 'approve'], 'pendência de versão antiga mantém as duas de antes');
  assert.deepEqual(P.opcoesDaDecisao(['apagar', 'skip']).map((o) => o.valor), ['skip']);
});

test('a revisão aberta mostra cada ação com o corpo e os inlines por arquivo', () => {
  const revisao = {
    key: 'acme-exemplo/app-web#41', reportMarkdown: 'resumo', cortado: true,
    payloads: {
      request_changes: { event: 'REQUEST_CHANGES', body: 'Precisa <de> ajuste.', comments: [{ path: 'src/a.js', line: 3, body: 'quebra' }, { path: 'src/a.js', line: 9, body: 'outra' }, { path: 'src/b.js', line: 1, body: 'nota b' }] },
      approve: { event: 'APPROVE', body: 'Pode seguir.', comments: [] },
    },
  };
  const { corpo } = P.revisaoAbertaHtml({ found: true, revisao });
  assert.match(corpo, /Pedir mudanças/);
  assert.match(corpo, /Aprovar/);
  assert.match(corpo, /Precisa &lt;de&gt; ajuste/);
  assert.equal((corpo.match(/src\/a\.js/g) || []).length, 1, 'os inlines do mesmo arquivo ficam juntos');
  assert.match(corpo, /src\/b\.js/);
  assert.match(corpo, /linha 9/);
  assert.match(corpo, /cortad/);
});

// Fix round 1: o último degrau do corte tira os payloads inteiros. O corpo chega com
// `cortado: true` e sem `payloads`, e a tela tem de avisar mesmo assim: review cortado nunca
// pode parecer completo.
test('corte total: sem payloads no corpo, a revisão aberta avisa que o texto não coube', () => {
  const corpo = historico.corpoDe({ id: 'i1', key: ITEM.key, reportMarkdown: 'x'.repeat(33950) }, { approve: payload('APPROVE', 'Pode seguir.') });
  assert.equal(corpo.cortado, true);
  assert.equal(corpo.payloads, undefined, 'o último degrau do corte tirou os payloads');
  const { corpo: html } = P.revisaoAbertaHtml({ found: true, revisao: corpo });
  assert.match(html, /O texto do review não coube no envio cifrado/);
  assert.match(html, /decida no aparelho dono/);
  const parcial = P.payloadsDaRevisaoHtml({ cortado: true, payloads: { approve: { event: 'APPROVE', body: 'ok', comments: [] } } });
  assert.match(parcial, /chegou cortado aqui/, 'corte parcial mantém a frase dele');
  assert.doesNotMatch(parcial, /não coube no envio cifrado/);
  assert.equal(P.payloadsDaRevisaoHtml({ reportMarkdown: 'r' }), '', 'sem corte e sem payloads, nada muda');
});

/* ---------- 5. revisão final (28/09/2026): a decisão remota fica registrada no executor ---------- */

function executorReal() {
  const toasts = [];
  const engine = {
    sync: { material: MATERIAL, deviceId: DEV },
    decisions: { pending: [{ ...ITEM, status: 'pending' }], resolved: [] },
    resolveIntoHistory(i) { decisionMod.resolveIntoHistory(this, i); },
    saveDecisions() { },
    log() { },
    emit(ev, p) { if (ev === 'toast') toasts.push(p.text); },
    decide(id, acao, opcoes) { return decisionMod.decide(this, id, acao, opcoes); },
  };
  return { engine, toasts, itemId: pendencia.itemIdDe(kek.bufferDe(MATERIAL.id), DEV, ITEM.id) };
}

test('pular pelo admin: um aviso só, que diz que foi o admin, e o histórico registra', async () => {
  const { engine, toasts, itemId } = executorReal();
  const r = await comandos.executar(engine, {}, 'c1', { tipo: 'decidir', args: { itemId, acao: 'skip' } }, 1);
  assert.equal(r.estado, 'aplicado');
  assert.equal(toasts.length, 1, toasts.join(' | '));
  assert.match(toasts[0], /O admin decidiu pular em acme-exemplo\/app-web#41/);
  assert.match(toasts[0], /nada foi postado/);
  assert.equal(engine.decisions.resolved[0].status, 'skipped');
  assert.equal(engine.decisions.resolved[0].viaAdmin, true);
  assert.equal(decisionForUi(engine.decisions.resolved[0]).viaAdmin, true, 'a tela do executor recebe a marca');
});

test('pular pelo próprio dono continua com o aviso de sempre, sem marca de admin', async () => {
  const { engine, toasts } = executorReal();
  assert.equal((await engine.decide(ITEM.id, 'skip')).ok, true);
  assert.deepEqual(toasts, [`${ITEM.key} pulado, nada foi postado.`]);
  assert.equal(engine.decisions.resolved[0].viaAdmin, undefined);
});

test('postar pelo admin também fica registrado no histórico do executor', async () => {
  const { engine, itemId } = executorReal();
  engine.decide = async (id, acao) => {
    const i = engine.decisions.pending.findIndex((d) => d.id === id);
    const [item] = engine.decisions.pending.splice(i, 1);
    engine.resolveIntoHistory({ ...item, status: 'posted', action: acao });
    return { ok: true };
  };
  await comandos.executar(engine, {}, 'c1', { tipo: 'decidir', args: { itemId, acao: 'approve' } }, 1);
  assert.equal(engine.decisions.resolved[0].viaAdmin, true);
});

test('a linha do histórico diz que a decisão veio do admin', () => {
  const base = { id: 'i1', key: ITEM.key, status: 'posted', action: 'approve', resolvedAt: 1_700_000_000_000, pr: { url: 'https://github.com/acme-exemplo/app-web/pull/41', title: 't' } };
  const ctx = { pushbacks: {}, chip: '', chatBadge: '', agora: 1_700_000_000_000 };
  assert.match(P.resolvedRow({ ...base, viaAdmin: true }, ctx), /decidido pelo admin/);
  assert.doesNotMatch(P.resolvedRow(base, ctx), /decidido pelo admin/);
});
