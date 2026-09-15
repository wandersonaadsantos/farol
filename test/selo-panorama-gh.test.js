// C0, defeito 5 (spec 7.C0): selos do Panorama divergiam entre aparelhos. O selo saía do
// histórico LOCAL e, sem registro local, `reviewedByMe` virava "aprovado": um
// CHANGES_REQUESTED postado por outro aparelho aparecia aqui como aprovado e parado.
// Agora o selo usa o último estado decisivo meu no GitHub (staleInfo[key].lastState, que
// o refreshStaleStates já busca). O teste roda dois ciclos do refreshStaleStates, passa
// pelo snapshot e renderiza o HTML, o caminho inteiro até a tela.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-selo-gh-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../ui/pure.js';

const { Engine } = await import('../server.js');

after(() => {
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});

const KEY = 'acme/api#7';
const HEAD = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const MARK = { style: '', varStyle: '', dim: '', chip: '', dot: '', acct: { label: 'acme' } };
const prDe = (extra = {}) => ({ key: KEY, url: 'https://github.com/acme/api/pull/7', repo: 'acme/api', number: 7, title: 'Corrige o gate', author: 'alice', updatedAt: '2026-09-15T10:00:00Z', reviewedByMe: true, ...extra });

function ctxDo(snap) {
  return { mark: MARK, actions: snap.reviewActions, staleStates: snap.staleStates, reviewStatesGh: snap.reviewStatesGh, todasContas: false, chats: {}, running: new Set(), waiting: [] };
}

test('CHANGES_REQUESTED postado por outro aparelho aparece como "aguardando o autor", e o selo acompanha o GitHub a cada ciclo', async () => {
  const e = new Engine();
  e.pushState = () => { };
  e.panorama = [prDe()];
  e.decisions = { pending: [], resolved: [] };        // este aparelho nunca postou nada
  let estado = 'CHANGES_REQUESTED';
  e.staleForReview = async () => ({ stale: false, head: HEAD, lastState: estado });

  await e.refreshStaleStates();
  const s1 = e.snapshot();
  assert.deepEqual(s1.reviewStatesGh, { [KEY]: 'CHANGES_REQUESTED' });
  const html1 = P.panoramaRowHtml(prDe(), ctxDo(s1));
  assert.match(html1, /aguardando o autor/);
  assert.match(html1, /você pediu mudanças/);
  assert.doesNotMatch(html1, /você aprovou/);
  assert.doesNotMatch(html1, /act-review/, 'mudanças pedidas e parado: não oferece revisão paga');

  estado = 'APPROVED';
  await e.refreshStaleStates();
  const s2 = e.snapshot();
  assert.deepEqual(s2.reviewStatesGh, { [KEY]: 'APPROVED' });
  const html2 = P.panoramaRowHtml(prDe(), ctxDo(s2));
  assert.match(html2, /nada a fazer/);
  assert.match(html2, /você aprovou/);
});

test('reviewStatesGh só projeta PR do panorama e só estado decisivo', async () => {
  const e = new Engine();
  e.panorama = [prDe()];
  e.staleInfo = {
    [KEY]: { stale: false, head: HEAD, lastState: '' },
    'fora/do#1': { stale: false, head: HEAD, lastState: 'APPROVED' },
  };
  assert.deepEqual(e.reviewStatesGhParaUi(), {});
});

test('pendência na mesa deste aparelho vence o GitHub; sem estado nenhum, revisado não finge aprovação', () => {
  const base = { mark: MARK, actions: {}, staleStates: {}, reviewStatesGh: {}, todasContas: false, chats: {}, running: new Set(), waiting: [] };
  const pendente = P.panoramaRowHtml(prDe(), { ...base, actions: { [KEY]: { kind: 'pending' } }, reviewStatesGh: { [KEY]: 'APPROVED' } });
  assert.match(pendente, /aguardando você/);
  const semEstado = P.panoramaRowHtml(prDe(), base);
  assert.match(semEstado, /revisado por você/);
  assert.doesNotMatch(semEstado, /você aprovou|nada a fazer/);
  assert.doesNotMatch(semEstado, /act-review/, 'sem estado conhecido também não convida a revisão paga');
});

test('reviewChip: o estado do GitHub vence o histórico local, e nome de protótipo não vira selo', () => {
  const pr = prDe();
  assert.match(P.reviewChip(pr, { [KEY]: { kind: 'approve' } }, { [KEY]: 'CHANGES_REQUESTED' }), /você pediu mudanças/);
  assert.match(P.reviewChip(pr, {}, { [KEY]: 'constructor' }), /revisado por você/);
  assert.match(P.reviewChip(pr, { [KEY]: { kind: 'comment' } }), /você comentou/, 'sem estado do GitHub o histórico local complementa');
});
