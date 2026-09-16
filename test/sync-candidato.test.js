// Candidato à distribuição e escolha do agendador (7.C5, anexo S3): tudo puro.
//
// Dois casos carregam o contrato: o candidato NÃO leva `requested` (CT-FIO: quem decide se
// a revisão foi pedida a mim é o executor, com a credencial dele), e a ordem que a escolha
// produz com um aparelho só é a MESMA que o escalonador local produz hoje. Divergir com uma
// org só significa rodízio regredido.
import os from 'node:os';
import path from 'node:path';
process.env.FAROL_HOME = process.env.FAROL_HOME || path.join(os.tmpdir(), 'farol-test-candidato-' + process.pid);

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

const candidato = (await import('../lib/sync/candidato.js')).default;
const escolha = (await import('../lib/engine/escolha.js')).default;
const reviewMod = (await import('../lib/engine/review.js')).default;

const K = randomBytes(32);
const T = 1_800_000_000_000;
const TTL = 240 * 1000;

function pr(n, extra = {}) {
  return { key: `dono/repo#${n}`, headSha: `sha${n}`, title: 'Titulo secreto', author: 'alguem', requested: true, peso: 900, ...extra };
}

test('o candidato é ponteiro: tags, rascunho, rodada e TTL, e nada mais', () => {
  const c = candidato.candidatoDe(pr(1), { kId: K, conta: 'minha-conta', agora: T, ttlMs: TTL });
  assert.deepEqual(Object.keys(c).sort(), ['acctTag', 'isDraft', 'itemId', 'matTag', 'orgTag', 'prTag', 'publishedAt', 'rodadaAutomatica', 'ttl']);
  assert.equal(c.ttl, T + TTL);
  assert.equal(c.rodadaAutomatica, true);
  const cru = JSON.stringify(c);
  for (const proibido of ['requested', 'peso', 'Titulo', 'alguem', 'dono/repo', 'sha1']) {
    assert.equal(cru.includes(proibido), false, proibido);
  }
});

test('clique manual não é rodada automática, e rascunho viaja', () => {
  const c = candidato.candidatoDe(pr(1, { manual: true, isDraft: true }), { kId: K, conta: 'c', agora: T, ttlMs: TTL });
  assert.equal(c.rodadaAutomatica, false);
  assert.equal(c.isDraft, true);
});

test('sem PR ou sem head não existe candidato: o head é parte da identidade', () => {
  assert.equal(candidato.candidatoDe({ key: 'a/b#1' }, { kId: K, agora: T, ttlMs: TTL }), null);
  assert.equal(candidato.candidatoDe({ headSha: 'x' }, { kId: K, agora: T, ttlMs: TTL }), null);
});

test('head novo é item novo, e o mesmo head é o mesmo item', () => {
  const a = candidato.candidatoDe(pr(1), { kId: K, conta: 'c', agora: T, ttlMs: TTL });
  const igual = candidato.candidatoDe(pr(1), { kId: K, conta: 'c', agora: T + 5, ttlMs: TTL });
  const outroHead = candidato.candidatoDe(pr(1, { headSha: 'sha-novo' }), { kId: K, conta: 'c', agora: T, ttlMs: TTL });
  assert.equal(a.itemId, igual.itemId);
  assert.notEqual(a.itemId, outroHead.itemId);
});

// S3-4: a org agrupa entre aparelhos e contas, inclusive caixa diferente e owner pessoal.
test('a org é a mesma entre contas e caixas diferentes', () => {
  const a = candidato.candidatoDe({ key: 'BiudTech/app#1', headSha: 'h' }, { kId: K, conta: 'conta-a', agora: T, ttlMs: TTL });
  const b = candidato.candidatoDe({ key: 'biudtech/outro#9', headSha: 'h2' }, { kId: K, conta: 'conta-b', agora: T, ttlMs: TTL });
  assert.equal(a.orgTag, b.orgTag);
  assert.notEqual(a.acctTag, b.acctTag);
  assert.notEqual(a.orgTag, candidato.orgTag(K, 'outra-org'));
});

test('o nome do owner é apresentação, e não entra no ponteiro', () => {
  assert.equal(candidato.nomeDoOwner(pr(1)), 'dono');
  assert.equal(candidato.nomeDoOwner({}), '');
  const c = candidato.candidatoDe(pr(1), { kId: K, conta: 'c', agora: T, ttlMs: TTL });
  assert.equal(JSON.stringify(c).includes('dono'), false);
});

// S3, passo 3.
test('o mesmo PR publicado por dois aparelhos vira UM item com dois publicadores', () => {
  const c1 = candidato.candidatoDe(pr(1), { kId: K, conta: 'c', agora: T + 10, ttlMs: TTL });
  const c2 = candidato.candidatoDe(pr(1), { kId: K, conta: 'c', agora: T, ttlMs: TTL });
  const c3 = candidato.candidatoDe(pr(2), { kId: K, conta: 'c', agora: T, ttlMs: TTL });
  const itens = candidato.fundir({ dA: [c1, c3], dB: [c2] }, { agora: T + 20 });
  const fundido = itens.find((i) => i.itemId === c1.itemId);
  assert.deepEqual(fundido.publicadores, ['dA', 'dB']);
  assert.equal(fundido.publishedAt, T, 'vale a chegada mais antiga');
  assert.equal(itens.length, 2);
});

test('candidato vencido não entra na fusão', () => {
  const c = candidato.candidatoDe(pr(1), { kId: K, conta: 'c', agora: T, ttlMs: TTL });
  assert.deepEqual(candidato.fundir({ dA: [c] }, { agora: T + TTL + 1 }), []);
  assert.equal(candidato.vivo(c, T + TTL - 1), true);
});

// --- escolha -------------------------------------------------------------------------

function item(id, orgTag, publishedAt, publicadores = ['dA']) {
  return { itemId: id, orgTag, publishedAt, publicadores };
}

const APTO = { apto: true, teto: 2, ocupadas: 0, prioridade: 0 };

test('onde: só publicador apto, não pausado e com vaga', () => {
  const i = item('i1', 'org1', T, ['dA', 'dB', 'dC', 'dD']);
  const aparelhos = { dA: { ...APTO, apto: false }, dB: { ...APTO, pausado: true }, dC: { ...APTO, ocupadas: 2 }, dD: APTO };
  assert.equal(escolha.escolherOnde(i, aparelhos, { agora: T }).dev, 'dD');
});

test('onde: quem recusou este item neste head espera a janela passar', () => {
  const i = item('i1', 'org1', T, ['dA', 'dB']);
  const aparelhos = { dA: APTO, dB: { ...APTO, prioridade: 5 } };
  const recusas = { i1: { dA: T + 1000 } };
  assert.equal(escolha.escolherOnde(i, aparelhos, { agora: T, recusas }).dev, 'dB');
  assert.equal(escolha.escolherOnde(i, aparelhos, { agora: T + 2000, recusas }).dev, 'dA', 'passada a espera, ele volta');
});

test('onde: prioridade vence, e empate vai para quem tem mais folga', () => {
  const i = item('i1', 'org1', T, ['dA', 'dB']);
  assert.equal(escolha.escolherOnde(i, { dA: { ...APTO, prioridade: 1 }, dB: { ...APTO, prioridade: 0 } }, { agora: T }).dev, 'dB');
  assert.equal(escolha.escolherOnde(i, { dA: { ...APTO, teto: 4, ocupadas: 1 }, dB: { ...APTO, teto: 2, ocupadas: 1 } }, { agora: T }).dev, 'dA');
});

test('nenhum aparelho apto não trava a fila: o item fica com motivo e o próximo sai', () => {
  const travado = item('i1', 'org1', T, ['dX']);
  const bom = item('i2', 'org2', T + 1, ['dA']);
  const r = escolha.escolher([travado, bom], { dA: APTO }, { agora: T });
  assert.equal(r.item.itemId, 'i2');
  assert.deepEqual(r.semAparelho, [{ itemId: 'i1', motivo: 'sem-aparelho-apto' }]);
});

test('qual: org nunca atendida fura a fila da que acabou de rodar', () => {
  const antiga = item('i1', 'orgA', T);
  const nova = item('i2', 'orgB', T + 10);
  const r = escolha.escolher([antiga, nova], { dA: APTO }, { agora: T, ultimaDaOrg: { orgA: 7 } });
  assert.equal(r.item.itemId, 'i2');
});

test('qual: entre duas orgs já atendidas, ganha a que esperou mais', () => {
  const r = escolha.escolher([item('i1', 'orgA', T), item('i2', 'orgB', T + 1)], { dA: APTO }, { agora: T, ultimaDaOrg: { orgA: 9, orgB: 2 } });
  assert.equal(r.item.itemId, 'i2');
});

test('qual: mesma org resolve pela ordem de chegada', () => {
  const r = escolha.escolher([item('i2', 'orgA', T + 5), item('i1', 'orgA', T)], { dA: APTO }, { agora: T, ultimaDaOrg: { orgA: 1 } });
  assert.equal(r.item.itemId, 'i1');
});

// O caso que prova que o rodízio não regrediu: mesma entrada, mesma ordem do escalonador
// local de hoje, e a função pura roda SEM engine.
test('com um aparelho só, a ordem é a mesma do escalonador de hoje', () => {
  const prs = [
    { key: 'orgA/x#1', acct: 'c1' }, { key: 'orgB/y#2', acct: 'c1' }, { key: 'orgA/x#3', acct: 'c1' },
  ];
  const local = {
    config: { parallelReviews: 4 },
    headlessQueue: [...prs],
    headlessBusyAccounts: new Map(),
    orgLastStart: new Map([['orga', { seq: 5 }]]),
    ran: [],
    accountForPr: (p) => p.acct,
    headlessAcct(p) { return reviewMod.headlessAcct(this, p); },
    runOneHeadless(p) { this.ran.push(p.key); },
  };
  reviewMod.processHeadless(local);

  const itens = prs.map((p, i) => item(p.key, p.key.split('/')[0].toLowerCase(), T + i));
  const ultimaDaOrg = { orga: 5 };
  const saida = [];
  const restantes = [...itens];
  while (restantes.length) {
    const r = escolha.escolher(restantes, { dA: { ...APTO, teto: 4 } }, { agora: T, ultimaDaOrg });
    if (!r.item) break;
    saida.push(r.item.itemId);
    ultimaDaOrg[r.item.orgTag] = (Math.max(0, ...Object.values(ultimaDaOrg)) || 0) + 1;
    restantes.splice(restantes.indexOf(r.item), 1);
  }
  assert.deepEqual(saida, local.ran, 'a ordem distribuída é a ordem local de hoje');
});
