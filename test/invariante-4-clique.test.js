// Invariante 4, a metade que ninguém estava guardando: revisão iniciada por CLIQUE
// nunca auto-posta.
//
// Por que este arquivo existe. Numa auditoria de 17/08/2026 eu removi a trava
// `pr.requested === false` das duas funções de gate e rodei a suíte inteira:
//
//   shouldAutoApprove  -> 2 testes reprovaram   (a trava estava guardada)
//   shouldAutoReject   -> 1249 passando, 0 falhando   (ninguém percebeu)
//
// Ou seja: dava pra apagar a trava do lado do REQUEST_CHANGES, passar em `npm test`,
// no `npm run lint` e no CI dos três sistemas, e o Farol passaria a pedir mudanças
// sozinho num PR que a pessoa só clicou pra ver. Isso é o oposto do que o invariante
// 4 promete, e é o tipo de regressão que só aparece em produção, no PR de alguém.
//
// As duas metades ficam aqui juntas, e de propósito: separadas foi como uma delas
// ficou sem guarda. Runner nativo, ZERO deps.
import os from 'node:os';
import path from 'node:path';
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-inv4-' + process.pid);

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { Engine } = await import('../server.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const PR = { key: 'acme/api#1', repo: 'acme/api', number: 1, url: 'u', author: 'alice' };

// envelope APROVÁVEL: veredito + payload no formato que o gate exige, análise
// completa, card comprovado e nada que trave (sem contestação, sem lacuna).
const aprovavel = () => ({
  analysisStatus: 'complete', verdict: 'approve', decision: 'auto_approve', cardMet: true,
  payloads: { approve: { event: 'APPROVE', body: 'ok' } },
});
// envelope REPROVÁVEL: mesma régua, do outro lado.
const reprovavel = () => ({
  analysisStatus: 'complete', verdict: 'request_changes', cardMet: true,
  payloads: { request_changes: { event: 'REQUEST_CHANGES', body: 'tem um blocker aqui' } },
});

// engine com a política mais PERMISSIVA possível: se algo ainda barrar, foi a trava
// do clique, que é o que se quer provar.
function enginePermissivo() {
  const e = new Engine();
  e.config = { ...e.config, autoApproveAll: true, autoApproveContested: true };
  e.accountForPr = () => 'conta';
  e.approvePolicyFor = () => 'approve';
  e.rejectPolicyFor = () => 'request_changes';
  e.contestedPolicy = () => 'approve';
  return e;
}

test('APPROVE: com tudo liberado, o clique ainda barra', () => {
  const e = enginePermissivo();
  assert.deepEqual(e.shouldAutoApprove({ ...PR, requested: true }, aprovavel()), { ok: true, motivo: null },
    'controle: pedido a mim, com política permissiva, passa');
  assert.deepEqual(e.shouldAutoApprove({ ...PR, requested: false }, aprovavel()), { ok: false, motivo: 'clique' },
    'iniciado por clique NUNCA auto-posta, por mais permissiva que seja a conta');
});

test('REQUEST_CHANGES: com tudo liberado, o clique ainda barra', () => {
  // esta é a que faltava: mesma prova, do lado do reject
  const e = enginePermissivo();
  assert.equal(e.shouldAutoReject({ ...PR, requested: true }, reprovavel()), true,
    'controle: pedido a mim, com a conta optando por reprovar sozinho, passa');
  assert.equal(e.shouldAutoReject({ ...PR, requested: false }, reprovavel()), false,
    'iniciado por clique NUNCA auto-posta, nem pra pedir mudanças');
});

test('a trava vale pros dois lados na MESMA execução', () => {
  // guarda contra a assimetria que a auditoria achou: alguém proteger um lado e
  // esquecer o outro de novo
  const e = enginePermissivo();
  const clique = { ...PR, requested: false };
  assert.equal(e.shouldAutoApprove(clique, aprovavel()).ok, false);
  assert.equal(e.shouldAutoReject(clique, reprovavel()), false);
});

test('requested ausente (undefined) não é tratado como clique', () => {
  // a trava é `=== false` de propósito: PR vindo de caminho que não carimba o campo
  // não pode ser rebaixado por acidente. Trava o contrato pra quem mexer no gate.
  const e = enginePermissivo();
  const semCampo = { ...PR };
  assert.equal(e.shouldAutoApprove(semCampo, aprovavel()).ok, true);
  assert.equal(e.shouldAutoReject(semCampo, reprovavel()), true);
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
