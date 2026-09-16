// Admissão local DESLIGADA (CT-COMPAT): com o compartilhamento desligado o escalonador é
// o de hoje, teto POR CONTA. Nasce verde antes da C4 e continua verde depois; é o contraste
// com o critério da C4 ("três contas com teto 1 abrem UMA sessão"), que só vale ligado.
import os from 'node:os';
import path from 'node:path';
process.env.FAROL_HOME = process.env.FAROL_HOME || path.join(os.tmpdir(), 'farol-test-admissao-off-' + process.pid);

import { test } from 'node:test';
import assert from 'node:assert/strict';
const reviewMod = (await import('../lib/engine/review.js')).default;

function engineSched(sync, prs) {
  return {
    config: { parallelReviews: 1, sync },
    headlessQueue: [...prs],
    headlessBusyAccounts: new Map(),
    ran: [],
    accountForPr: (pr) => pr.acct,
    headlessAcct(pr) { return reviewMod.headlessAcct(this, pr); },
    runOneHeadless(pr, acct) { this.ran.push(`${pr.key}@${acct}`); },
  };
}

const prs = [{ key: 'a/x#1', acct: 'c1' }, { key: 'b/x#2', acct: 'c2' }, { key: 'c/x#3', acct: 'c3' }];

for (const [nome, sync] of [['sem sync', undefined], ['sync ligado e compartilhamento desligado', { enabled: true, shared: { enabled: false } }]]) {
  test(`${nome}: três contas com teto 1 rodam três, como hoje`, () => {
    const e = engineSched(sync, prs);
    reviewMod.processHeadless(e);
    assert.equal(e.ran.length, 3);
    assert.equal(e.admissao, undefined, 'nenhuma reserva existe desligado');
  });
}
