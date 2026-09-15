// C0, defeito 6 (spec 7.C0 e seção 11): a tela e o firebase/README.md prometiam que o
// repositório nunca é enviado, mas o SHA do commit sobe em claro no lease e no recibo, o
// nome do aparelho sobe como hostname, e perfil e modelo sobem no consumo.
//
// O teste lê os campos REAIS dos quatro payloads e exige que cada um esteja numa das três
// categorias abaixo, e que a frase da tela e do README nomeie cada categoria. Campo novo
// num payload sem categoria reprova: a frase não pode envelhecer calada.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-privacidade-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { buildLease } = await import('../lib/sync/lease.js');
const { buildReceipt } = await import('../lib/sync/receipts.js');
const { payloadFor } = await import('../lib/sync/outbox.js');
const { presencaDe } = await import('../lib/engine/sync.js');

after(() => {
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});

const CLARO = {
  headSha: /SHA do commit/i, materialVersion: /SHA do commit/i,
  name: /nome do aparelho/i, platform: /sistema operacional/i, farolVersion: /versão do Farol/i,
  model: /modelo/i, profileId: /perfil/i, costUsd: /custo/i,
  inputTokens: /tokens/i, outputTokens: /tokens/i, cacheReadTokens: /tokens/i, cacheCreationTokens: /tokens/i,
};
const RESUMO = { accountHash: /resumo SHA-256 sem chave/i, refHash: /resumo SHA-256 sem chave/i };
const TECNICOS = [
  'leaseId', 'deviceId', 'operationKind', 'acquiredAt', 'heartbeatAt', 'expiresAt', 'completedAt', 'lastVerifiedAt',
  'outcome', 'publicationState', 'reviewId', 'lastSeenAt', 'at', 'day', 'kind', 'costSource', 'status', 'localId',
];
const NUNCA = [/prompt/i, /diff/i, /relatório/i, /título/i];

function camposReais() {
  const lease = buildLease({ leaseId: 'L', deviceId: 'd', operationKind: 'review', headSha: 'abc', nowMs: 1, farolVersion: '1' });
  const recibo = buildReceipt({ operationKind: 'review', materialVersion: 'abc', deviceId: 'd', leaseId: 'L', nowMs: 1, outcome: 'completed', publicationState: 'pending', reviewId: '', farolVersion: '1' });
  const presenca = presencaDe({ deviceName: 'Mesa' });
  const consumo = payloadFor({ at: 1, kind: 'review', account: 'eu', ref: 'o/r#1', model: 'm', profileId: 'p' }, 'd', '1');
  return [...new Set([lease, recibo, presenca, consumo].flatMap((o) => Object.keys(o)))].sort();
}

function normalizar(texto) {
  return texto.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

function fraseDaTela() {
  const html = fs.readFileSync(new URL('../ui/index.html', import.meta.url), 'utf8');
  const inicio = html.indexOf('id="sys-sync"');
  assert.ok(inicio > 0, 'a seção de sincronização existe');
  const fim = html.indexOf('<div class="sys-section"', inicio + 1);
  return normalizar(html.slice(inicio, fim));
}

function fraseDoReadme() {
  return normalizar(fs.readFileSync(new URL('../firebase/README.md', import.meta.url), 'utf8'));
}

test('todo campo que sobe tem categoria: em claro, resumo sem chave ou identificador e horário', () => {
  const categorizados = [...Object.keys(CLARO), ...Object.keys(RESUMO), ...TECNICOS].sort();
  assert.deepEqual(camposReais(), categorizados);
});

for (const [rotulo, ler] of [['tela', fraseDaTela], ['firebase/README.md', fraseDoReadme]]) {
  test(`a frase da ${rotulo} nomeia o que sobe em claro, o que sobe como resumo e o que nunca sai`, () => {
    const texto = ler();
    for (const [campo, re] of Object.entries({ ...CLARO, ...RESUMO })) assert.match(texto, re, `${campo} precisa ser nomeado`);
    assert.match(texto, /nome da máquina/i, 'o nome do aparelho é o hostname quando vazio');
    assert.match(texto, /identificadores e horários/i);
    for (const re of NUNCA) assert.match(texto, re);
  });
}
