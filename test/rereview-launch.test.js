// Task 5: launchReReviews fecha o ciclo. Complementa test/rereview.test.js (que ja
// cobre o pulo de push trivial e a fiacao basica) com o que faltava: a ancora nova
// {head, dia, rodadas} (em vez do head cru lido de staleInfo, que e undefined no
// gatilho B), o knownHead vindo de pr._headRound (cobre os dois gatilhos) e o aviso
// de teto diario.
import test from 'node:test';
import assert from 'node:assert';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-relaunch-'));
const { Engine } = await import('../server.js');
const { MAX_RODADAS_AUTO_DIA, diaLocal } = await import('../lib/engine/review.js');
const { TEMPOS } = await import('../lib/constants.js');

const H1 = 'a'.repeat(40), H2 = 'b'.repeat(40);
// tempos relativos ao Date.now() real: launchReReviews usa Date.now() por dentro,
// entao nao da pra semear um AGORA fixo, so garantir que os carimbos ja passaram
// do debounce de head quieto.
const QUIETO = Date.now() - TEMPOS.HEAD_QUIETO_MS - 1000;
const HOJE = diaLocal(Date.now());

function engineBase() {
  const e = Object.create(Engine.prototype);
  e.panorama = [{ key: 'acme/r#1', repo: 'acme/r', number: 1, url: 'u', isDraft: false }];
  e.staleInfo = {};
  e.headQuietoDesde = {};
  e.reReviewLaunched = {};
  e.decisions = { pending: [], resolved: [] };
  e.autoReviewParked = new Set();
  e.retryAfterNet = new Map();
  e.skipComentado = {};
  e.accountForPr = () => 'conta';
  e.isMuted = () => false;
  e.autoReviewFor = () => true;
  e.tokenFor = () => 'tok';
  e.budgetBlockedFor = () => false;
  e.outrosRevisando = () => [];
  e.headlessQueue = [];
  e.activeReviews = new Map();
  e.saveReReviewLaunched = () => {};
  e.log = () => {};
  // sem prova salva: launchReReviews nao chega a chamar fetchPrFiles no caminho
  // comum, mas o stub existe pra garantir que, se chamar, o teste denuncia (o
  // brief pede exatamente esse stub: 'sem prova' significa que nunca deveria ir
  // ao gh sem prova em disco).
  e.fetchPrFiles = async () => { throw new Error('sem prova'); };
  return e;
}

test('relançamento grava âncora nova {head, dia, rodadas} e passa knownHead do gatilho', async () => {
  const enfileirados = [];
  const e = engineBase();
  e.enqueueHeadless = (p) => enfileirados.push(p);
  e.emit = () => {};
  e.staleInfo['acme/r#1'] = { stale: true, head: H2, lastState: 'CHANGES_REQUESTED' };
  e.headQuietoDesde['acme/r#1'] = { head: H2, at: QUIETO };
  e.reReviewLaunched['acme/r#1'] = { head: H1, dia: HOJE, rodadas: 1 };

  await e.launchReReviews();

  const a = e.reReviewLaunched['acme/r#1'];
  assert.equal(a.head, H2);
  assert.equal(a.rodadas, 2);
  assert.equal(enfileirados.length, 1);
  assert.equal(enfileirados[0].knownHead, H2);
  assert.equal(enfileirados[0].requested, true);
});

test('gatilho B (pendência stale_head): knownHead vem do blockedHead', async () => {
  const enfileirados = [];
  const e = engineBase();
  e.enqueueHeadless = (p) => enfileirados.push(p);
  e.emit = () => {};
  e.decisions.pending.push({ key: 'acme/r#1', blockedKind: 'stale_head', blockedHead: H2, createdAt: QUIETO });

  await e.launchReReviews();

  assert.equal(enfileirados.length, 1);
  assert.equal(enfileirados[0].knownHead, H2);
});

test('toast de relançamento não menciona mais só pedido de mudanças', async () => {
  const eventos = [];
  const e = engineBase();
  e.enqueueHeadless = () => {};
  e.emit = (ev, dados) => eventos.push({ ev, dados });
  e.staleInfo['acme/r#1'] = { stale: true, head: H2, lastState: 'APPROVED' };
  e.headQuietoDesde['acme/r#1'] = { head: H2, at: QUIETO };

  await e.launchReReviews();

  const toast = eventos.find(x => x.ev === 'toast');
  assert.ok(toast, 'toast de relançamento tem que sair');
  assert.ok(!/pedido de mudanças/.test(toast.dados.text));
  assert.match(toast.dados.text, /commit novo depois da sua revisão/);
});

test('teto esgotado avisa UMA vez por PR por dia e nunca enfileira', async () => {
  const enfileirados = [];
  const eventos = [];
  const e = engineBase();
  e.enqueueHeadless = (p) => enfileirados.push(p);
  e.emit = (ev, dados) => eventos.push({ ev, dados });
  e.staleInfo['acme/r#1'] = { stale: true, head: H2, lastState: 'CHANGES_REQUESTED' };
  e.headQuietoDesde['acme/r#1'] = { head: H2, at: QUIETO };
  e.reReviewLaunched['acme/r#1'] = { head: H1, dia: HOJE, rodadas: MAX_RODADAS_AUTO_DIA };

  await e.launchReReviews();
  await e.launchReReviews();

  const avisos = eventos.filter(x => x.ev === 'toast' && /rodadas automáticas/.test(x.dados.text));
  assert.equal(avisos.length, 1);
  assert.equal(enfileirados.length, 0);
});
