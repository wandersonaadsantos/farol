// Invariante 4, a régua de ORIGEM: de onde a revisão saiu decide se ela pode postar sozinha.
//
// Por que este arquivo existe. Numa auditoria de 17/08/2026 eu removi a trava
// `pr.requested === false` das duas funções de gate e rodei a suíte inteira:
//
//   shouldAutoApprove  -> 2 testes reprovaram   (a trava estava guardada)
//   shouldAutoReject   -> 1249 passando, 0 falhando   (ninguém percebeu)
//
// As duas metades ficam aqui juntas, e de propósito: separadas foi como uma delas ficou
// sem guarda.
//
// A régua mudou em 18/10/2026 (a decisão sem mesa). Regra do dono: "Se foi configurado pra
// aprovar sozinho ele aprova sozinho, se foi configurado pra reprovar sozinho ele reprova
// sozinho, sem depender da minha ação." Clique no Panorama, URL colada, pedido do aparelho
// admin, comando remoto e distribuição entre aparelhos são TODOS o dono mandando revisar, e
// saem pela política da conta como a fila. O que continua sem postar sozinho é a origem
// desconhecida: um objeto de PR sem marca nenhuma (desfecho-automatico.js, origemDoDono).
// Runner nativo, ZERO deps.
import os from 'node:os';
import path from 'node:path';
process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-inv4-'));

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { Engine } = await import('../server.js');
const { provenResult } = await import('./helpers/technical-proof.js');


after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const PR = { key: 'acme/api#1', repo: 'acme/api', number: 1, url: 'u', author: 'alice' };

// envelope APROVÁVEL: veredito + payload no formato que o gate exige, análise
// completa, card comprovado e nada que trave (sem contestação, sem lacuna).
const aprovavel = () => provenResult({
  analysisStatus: 'complete', coverage: { total: 1, reviewed: ['a.ts'], missing: [] }, alcance: [{ alterado: 'a.ts', chamadores: [], semChamador: 'fixture sintética sem consumidor' }], verdict: 'approve', decision: 'auto_approve', cardMet: true,
  payloads: { approve: { event: 'APPROVE', body: 'ok' } },
});
// envelope REPROVÁVEL: mesma régua, do outro lado.
const reprovavel = () => ({
  analysisStatus: 'complete', coverage: { total: 1, reviewed: ['a.ts'], missing: [] }, alcance: [{ alterado: 'a.ts', chamadores: [], semChamador: 'fixture sintética sem consumidor' }], verdict: 'request_changes', cardMet: true,
  payloads: { request_changes: { event: 'REQUEST_CHANGES', body: 'tem um blocker aqui' } },
});

// engine com a política mais PERMISSIVA possível: se algo ainda barrar, foi a trava
// de origem, que é o que se quer provar.
function enginePermissivo() {
  const e = new Engine();
  e.config = { ...e.config, autoApproveAll: true };
  e.accountForPr = () => 'conta';
  e.approvePolicyFor = () => 'approve';
  e.rejectPolicyFor = () => 'request_changes';
  return e;
}

// as marcas que cada caminho de lançamento carimba no PR
const ORIGENS_DO_DONO = {
  fila: { requested: true },
  'clique no Panorama ou URL colada': { requested: false, manual: true },
  'pedido do aparelho admin': { viaAdmin: true },
  'comando remoto (repetir, tomar, transferir)': { viaComando: true },
  'distribuição entre aparelhos': { viaComando: true, viaDistribuicao: true },
  'pendência relançada (reconferência técnica)': { origemDono: true },
};

for (const [origem, marcas] of Object.entries(ORIGENS_DO_DONO)) {
  test(`origem do dono (${origem}): aprova e reprova pela política da conta`, () => {
    const e = enginePermissivo();
    assert.deepEqual(e.shouldAutoApprove({ ...PR, ...marcas }, aprovavel()), { ok: true, motivo: null });
    assert.equal(e.shouldAutoReject({ ...PR, ...marcas }, reprovavel()), true);
  });
}

test('origem desconhecida (nenhuma marca): nada sai sozinho, dos dois lados na MESMA execução', () => {
  // guarda contra a assimetria que a auditoria achou: alguém proteger um lado e esquecer o outro
  const e = enginePermissivo();
  const semCampo = { ...PR };
  assert.deepEqual(e.shouldAutoApprove(semCampo, aprovavel()), { ok: false, motivo: 'origem_desconhecida' });
  assert.equal(e.shouldAutoReject(semCampo, reprovavel()), false);
  // `requested: false` sozinho também não é marca de dono: o clique carimba `manual`
  assert.equal(e.shouldAutoApprove({ ...PR, requested: false }, aprovavel()).ok, false);
  assert.equal(e.shouldAutoReject({ ...PR, requested: false }, reprovavel()), false);
  // marca com valor que não é o booleano verdadeiro não conta
  assert.equal(e.shouldAutoApprove({ ...PR, manual: 'sim', viaAdmin: 1 }, aprovavel()).ok, false);
});

test('a política da conta continua mandando: origem do dono com a conta esperando você não posta', () => {
  const e = enginePermissivo();
  e.approvePolicyFor = () => 'wait';
  e.rejectPolicyFor = () => 'wait';
  assert.deepEqual(e.shouldAutoApprove({ ...PR, manual: true }, aprovavel()), { ok: false, motivo: 'politica' });
  assert.equal(e.shouldAutoReject({ ...PR, manual: true }, reprovavel()), false);
});

/* ---------- APPROVE em branco não sai sozinho (31/08/2026) ----------
   Assimetria achada no check-up: `shouldAutoReject` exige `hasPublicFinding` (corpo ou
   inline), e o approve exigia só o evento ser APPROVE. Uma aprovação em branco sairia
   pro PR assinada por você, sem uma palavra, e seria gravada como auto_approved.
   Medido antes de fechar: os 12 auto-approves mais recentes têm corpo de 651 a 2886
   caracteres, então exigir corpo não segura nada que hoje passa. Clique manual não
   passa por aqui e continua livre. */
test('auto-approve exige corpo ou comentário: aprovação em branco vira decisão sua', () => {
  const e = enginePermissivo();
  const vazio = { ...aprovavel(), payloads: { approve: { event: 'APPROVE', body: '   ', comments: [] } } };
  assert.deepEqual(e.shouldAutoApprove({ ...PR, requested: true }, vazio), { ok: false, motivo: 'sem_texto' });
});

test('inline sem corpo basta: o achado está escrito, só que na linha', () => {
  const e = enginePermissivo();
  const soInline = { ...aprovavel(), payloads: { approve: { event: 'APPROVE', body: '', comments: [{ path: 'a.js', line: 1, body: 'olha isto' }] } } };
  assert.equal(e.shouldAutoApprove({ ...PR, requested: true }, soInline).ok, true);
});
