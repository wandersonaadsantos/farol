// Cobre a discordância de review de terceiro (campo `contested`): normalização com
// descarte do que não tem prova, e o destino dela no gate.
// Até 30/09/2026 a contestação NUNCA auto-postava por padrão (chave `autoApproveContested`,
// desligada). Pedido do dono naquele dia: "se é pra aprovar automaticamente, ele realmente
// aprova, sem desculpas pra passar por um approve humano". A chave morreu e a discordância é
// SEMPRE ponto de atenção: cai em "com ressalvas" e a política da conta decide. Reprovar
// sozinho por cima de uma discordância continua passando por você, e a discordância segue
// fora do texto do PR.
// Runner nativo, ZERO deps.
import os from 'node:os';
import path from 'node:path';
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-contested-' + process.pid);

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { Engine } = await import('../server.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { } });

const PR = { key: 'o/r#1', repo: 'o/r', number: 1, url: 'https://github.com/o/r/pull/1', requested: true };

function approvableResult(extra) {
  return {
    analysisStatus: 'complete', coverage: { total: 1, reviewed: ['a.ts'], missing: [] }, alcance: [{ alterado: 'a.ts', chamadores: [], semChamador: 'fixture sintética sem consumidor' }], verdict: 'approve', decision: 'auto_approve', cardMet: true, reasons: [],
    payloads: { approve: { event: 'APPROVE', body: 'ok' } },
    ...extra
  };
}

function engineWithPolicy(policy) {
  const e = new Engine();
  // política mais permissiva possível: se o gate deixar passar, é bug
  e.config.autoApproveAll = true;
  e.config.accounts = [];
  e.approvePolicyFor = () => policy;
  e.rejectPolicyFor = () => 'request_changes';
  e.accountForPr = () => 'alguem';
  return e;
}

// 30/09/2026: a política da conta é a ÚNICA coisa que decide entre postar e esperar você, e
// ela responde por CLASSE (limpo = nenhum ponto de atenção; com ressalvas = um ou mais).
function enginePorClasse(limpo, comRessalvas) {
  const e = engineWithPolicy('approve');
  e.approvePolicyFor = (_conta, semPontos) => (semPontos ? limpo : comRessalvas);
  return e;
}

test('contestação com prova é ressalva: aprova quando a conta aprova com ressalvas, espera quando ela manda esperar', () => {
  const comContest = approvableResult({
    contested: [{ source: 'Acrity', claim: 'ref não é setado', label: 'falso_positivo', evidence: 'Arquivo.tsx:172 seta o ref' }]
  });
  assert.deepEqual(enginePorClasse('approve', 'approve').shouldAutoApprove(PR, comContest), { ok: true, motivo: null },
    'conta que aprova com ressalvas aprova, sem chave extra nenhuma');
  assert.deepEqual(enginePorClasse('approve', 'wait').shouldAutoApprove(PR, comContest), { ok: false, motivo: 'politica' },
    'conta que espera nas ressalvas espera, e o motivo é a política');
  assert.deepEqual(enginePorClasse('approve', 'wait').shouldAutoApprove(PR, approvableResult()), { ok: true, motivo: null },
    'sem contestação o mesmo resultado é limpo');
});

test('contestação também bloqueia o auto-reject (opt-in de reprovar sozinho)', () => {
  const e = engineWithPolicy('approve');
  const rej = {
    analysisStatus: 'complete', coverage: { total: 1, reviewed: ['a.ts'], missing: [] }, alcance: [{ alterado: 'a.ts', chamadores: [], semChamador: 'fixture sintética sem consumidor' }], verdict: 'request_changes', decision: 'needs_decision', reasons: ['blocker'],
    payloads: { request_changes: { event: 'REQUEST_CHANGES', body: 'x' } }
  };
  assert.equal(e.shouldAutoReject(PR, rej), true, 'sem contestação, a conta opt-in reprova sozinha');

  rej.contested = [{ source: 'Sonar', claim: 'y', label: 'pre_existente', evidence: 'diff vazio em services/' }];
  assert.equal(e.shouldAutoReject(PR, rej), false, 'com contestação, passa pelo humano');
});

test('contestação SEM prova é descartada (não vale como contestação, não bloqueia)', () => {
  const e = engineWithPolicy('approve');
  const semProva = approvableResult({
    contested: [
      { source: 'Acrity', claim: 'discordo', label: 'falso_positivo', evidence: '' },      // sem prova
      { source: 'Acrity', claim: 'discordo', label: 'falso_positivo' },                     // sem campo
      { source: 'Acrity', claim: 'discordo', label: 'acho_que_nao', evidence: 'algo' },     // rótulo inválido
      'texto solto'                                                                          // formato inválido
    ]
  });
  assert.deepEqual(e.contestations(semProva), [], 'nada disso conta como contestação');
  assert.equal(e.shouldAutoApprove(PR, semProva).ok, true, 'sem contestação válida, o fluxo normal segue');
});

test('os 4 rótulos válidos são aceitos quando têm prova', () => {
  const e = engineWithPolicy('approve');
  const labels = ['falso_positivo', 'fora_de_escopo', 'pre_existente', 'criterio_nao_vigente'];
  for (const label of labels) {
    const r = approvableResult({ contested: [{ source: 'X', claim: 'c', label, evidence: 'prova' }] });
    assert.equal(e.contestations(r).length, 1, `rótulo ${label} é válido`);
    assert.equal(enginePorClasse('approve', 'wait').shouldAutoApprove(PR, r).motivo, 'politica', `rótulo ${label} põe o resultado em "com ressalvas"`);
  }
});

test('contestação entra nos pontos de atenção com rótulo em português e a prova', () => {
  const e = engineWithPolicy('wait');
  const r = approvableResult({
    contested: [{ source: 'Acrity', claim: 'upload sem validar tipo', label: 'fora_de_escopo', evidence: 'PR declara BAIXA fora de escopo' }]
  });
  const pts = e.attentionPoints(r);
  assert.equal(pts.length, 1);
  assert.match(pts[0].text, /fora do escopo pactuado/, 'traduz o rótulo pra tela');
  assert.match(pts[0].text, /upload sem validar tipo/, 'mostra o apontamento');
  assert.match(pts[0].text, /PR declara BAIXA fora de escopo/, 'mostra a prova');
  assert.equal(pts[0].kind, 'gate', 'discordância é anotação do app, não achado sobre o código');
});

test('sem o campo contested, nada muda no comportamento antigo', () => {
  const e = engineWithPolicy('approve');
  const r = approvableResult();
  assert.deepEqual(e.contestations(r), []);
  assert.deepEqual(e.attentionPoints(r), [], 'aprovação limpa segue limpa');
  assert.equal(e.shouldAutoApprove(PR, r).ok, true);
});

test('o protocolo de terceiros é injetado no prompt headless, com a barra e o silêncio', () => {
  const e = new Engine();
  const block = e.thirdPartyReviewBlock();
  assert.match(block, /INDEPENDENTE/, 'manda revisar independente primeiro');
  assert.match(block, /ADOTE/, 'manda adotar o achado real que passou por nós');
  assert.match(block, /FIQUE CALADO/, 'manda calar na dúvida');
  for (const label of ['falso_positivo', 'fora_de_escopo', 'pre_existente', 'criterio_nao_vigente']) {
    assert.ok(block.includes(label), `documenta o rótulo ${label}`);
  }
  assert.match(block, /NUNCA conteste/, 'lista o que nunca se contesta');
});

/* ---------- retorno estruturado: o MOTIVO da recusa (Onda 7, M7) ----------
   O gate devolvia só um boolean e o bloco de transparência do runHeadlessReview
   tinha que ADIVINHAR por que a aprovação automática não saiu, e adivinhava sempre
   "política da conta", mesmo quando o bloqueio veio de contestação ou cobertura.
   Contrato novo: { ok, motivo }, com o motivo nomeado. */

test('contestação e cobertura deixaram de ser motivo de recusa: o motivo é sempre a política', () => {
  const e = enginePorClasse('approve', 'wait');
  const contestado = approvableResult({
    contested: [{ source: 'Acrity', claim: 'x', label: 'falso_positivo', evidence: 'Arquivo.tsx:10' }]
  });
  assert.deepEqual(e.shouldAutoApprove(PR, contestado), { ok: false, motivo: 'politica' });
  const comLacuna = approvableResult({ coverage: { total: 3, reviewed: ['a.ts'], missing: ['b.ts', 'c.ts'] } });
  assert.deepEqual(e.shouldAutoApprove(PR, comLacuna), { ok: false, motivo: 'politica' });
  assert.ok(e.attentionPoints(comLacuna).some(p => /cobertura da leitura tem 2 pendência/.test(p.text)), 'a lacuna aparece como ressalva');
});

test('shouldAutoApprove expõe o motivo da recusa: política da conta', () => {
  const e = engineWithPolicy('wait');
  assert.deepEqual(e.shouldAutoApprove(PR, approvableResult()), { ok: false, motivo: 'politica' });
});

test('shouldAutoApprove expõe o motivo da recusa: clique no panorama e não-aprovável', () => {
  const e = engineWithPolicy('approve');
  assert.deepEqual(e.shouldAutoApprove({ ...PR, requested: false }, approvableResult()),
    { ok: false, motivo: 'clique' });
  assert.deepEqual(e.shouldAutoApprove(PR, approvableResult({ verdict: 'request_changes' })),
    { ok: false, motivo: 'nao_aprovavel' });
});

test('shouldAutoApprove aprovando devolve ok true e motivo nulo', () => {
  const e = engineWithPolicy('approve');
  assert.deepEqual(e.shouldAutoApprove(PR, approvableResult()), { ok: true, motivo: null });
});

/* ---------- a chave autoApproveContested morreu (30/09/2026) ----------
   De 16/08 (biud-frontend#767) a 30/09/2026 a discordância travava o approve por padrão e
   uma chave em Sistema > Automação a liberava. Agora ela é sempre ressalva, e a chave não
   existe mais em lugar nenhum: nem na tabela de preferências, nem no engine. */

test('a contestação nunca passa por cima da política de ressalvas, e também nunca a contorna para esperar', () => {
  const r = approvableResult({
    contested: [{ source: 'Acrity', claim: 'x', label: 'fora_de_escopo', evidence: 'prova' }]
  });
  for (const lixo of [true, false, undefined]) {
    const aprova = enginePorClasse('wait', 'approve');
    aprova.config.autoApproveContested = lixo;
    assert.equal(aprova.shouldAutoApprove(PR, r).ok, true, `config antiga ${lixo} não muda nada: ressalva aprova`);
    const espera = enginePorClasse('approve', 'wait');
    espera.config.autoApproveContested = lixo;
    assert.equal(espera.shouldAutoApprove(PR, r).motivo, 'politica', `config antiga ${lixo} não muda nada: ressalva espera`);
  }
});

test('contestação junto de cobertura e checkpoint: tudo ressalva, e o clique segue sem postar', () => {
  const contested = [{ source: 'Acrity', claim: 'x', label: 'pre_existente', evidence: 'prova' }];
  const tudo = approvableResult({ contested, coverage: { total: 3, reviewed: ['a.ts'], missing: ['b.ts'] }, verificationCheckpoint: { malformed: true } });
  assert.deepEqual(enginePorClasse('wait', 'approve').shouldAutoApprove(PR, tudo), { ok: true, motivo: null });
  assert.equal(enginePorClasse('wait', 'approve').attentionPoints(tudo).length, 3, 'uma ressalva visível para cada coisa');
  assert.equal(enginePorClasse('approve', 'approve').shouldAutoApprove({ ...PR, requested: false }, tudo).motivo, 'clique');
});

test('a chave autoApproveContested não existe mais: nem preferência, nem método do engine', async () => {
  const { SETTINGS } = await import('../lib/settings.js');
  assert.equal(SETTINGS.some(x => x.key === 'autoApproveContested'), false);
  assert.equal(typeof new Engine().contestedPolicy, 'undefined');
  const r = new Engine().updateSettings({ autoApproveContested: true }, 'teste');
  assert.deepEqual(r.ignoradas, ['autoApproveContested'], 'a tela antiga que mandar a chave é avisada, não obedecida');
});

test('reprovar sozinho por cima de uma discordância continua passando por você', () => {
  const e = engineWithPolicy('approve');
  const rej = {
    analysisStatus: 'complete', coverage: { total: 1, reviewed: ['a.ts'], missing: [] }, alcance: [{ alterado: 'a.ts', chamadores: [], semChamador: 'fixture sintética sem consumidor' }], verdict: 'request_changes', decision: 'needs_decision', reasons: ['blocker'],
    contested: [{ source: 'Sonar', claim: 'y', label: 'pre_existente', evidence: 'diff vazio' }],
    payloads: { request_changes: { event: 'REQUEST_CHANGES', body: 'x' } }
  };
  assert.equal(e.shouldAutoReject(PR, rej), false);
});
