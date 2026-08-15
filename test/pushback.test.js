'use strict';
// Cobre o gate de ressalva do reviewActions() que o scan de pushback usa pra decidir
// alvo: pushback só vale pra bloqueio (request_changes) ou aprovação COM ressalva.
// Aprovação limpa (sem motivo e com card comprovado) NÃO marca caveats, então fica de
// fora do scan. Ressalva = mesmos pontos do attentionPoints (card não comprovado OU
// algum motivo/attention listado). Runner nativo, ZERO deps.
const os = require('node:os');
const path = require('node:path');
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-pushback-' + process.pid);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

// espião no run do gh: pushback.js destrutura io.run no LOAD (mesma pegadinha
// documentada em gh-queries-capped.test.js), então o patch precisa existir ANTES do
// require do server. Por padrão devolve ok vazio (nenhum gh real roda neste arquivo);
// os testes de detectAuthorPushback (G4) trocam ghImpl por um stub concreto.
const io = require('../lib/io');
let ghImpl = null;
io.run = (cmd, args, opts) => ghImpl
  ? ghImpl(cmd, args, opts)
  : Promise.resolve({ ok: true, code: 0, stdout: '', stderr: '' });

const { Engine } = require('../server.js');
// o gate DE VERDADE, importado do módulo. Antes este arquivo tinha uma cópia manual da
// regra ("espelha o gate de scanPushbacks"), então testava o teste: a regra podia mudar
// no pushback.js e a suíte seguia verde validando a cópia velha.
const { isPushbackTarget, pushbackTargets, detectAuthorPushback } = require('../lib/engine/pushback');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { } });

function engineWith(resolved, pending = []) {
  const e = new Engine();
  e.decisions = { resolved, pending };
  return e;
}

const eligible = isPushbackTarget;

test('aprovação limpa: sem caveats e fora do scan de pushback', () => {
  const e = engineWith([
    { key: 'o/r#1', status: 'auto_approved', action: 'approve', reasons: [], cardMet: true, resolvedAt: 1 },
  ]);
  const a = e.reviewActions()['o/r#1'];
  assert.equal(a.kind, 'approve');
  assert.equal(a.caveats, false);
  assert.equal(eligible(a), false, 'aprovação limpa não é alvo de pushback');
});

test('aprovação com ressalva (motivo, card não comprovado ou attention): vira alvo', () => {
  const e = engineWith([
    { key: 'o/r#2', status: 'auto_approved', action: 'approve', reasons: ['confira o edge X'], cardMet: true, resolvedAt: 1 },
    { key: 'o/r#3', status: 'posted', action: 'approve', reasons: [], cardMet: false, resolvedAt: 1 },
    { key: 'o/r#4', status: 'auto_approved', action: 'approve', attention: ['ponto de atenção'], resolvedAt: 1 },
  ]);
  const acts = e.reviewActions();
  assert.equal(acts['o/r#2'].caveats, true, 'motivo listado = ressalva');
  assert.equal(acts['o/r#3'].caveats, true, 'card não comprovado = ressalva');
  assert.equal(acts['o/r#4'].caveats, true, 'attention preenchido = ressalva');
  for (const k of ['o/r#2', 'o/r#3', 'o/r#4']) assert.equal(eligible(acts[k]), true, `${k} é alvo`);
});

test('bloqueio (request_changes) é sempre alvo, independente de caveats', () => {
  const e = engineWith([
    { key: 'o/r#5', status: 'auto_rejected', action: 'request_changes', reasons: ['quebra o build'], resolvedAt: 1 },
  ]);
  const a = e.reviewActions()['o/r#5'];
  assert.equal(a.kind, 'request_changes');
  assert.equal(eligible(a), true, 'bloqueio é alvo de pushback');
});

test('pendente (ainda na sua mesa, nada postado) não é alvo', () => {
  const e = engineWith([], [{ key: 'o/r#6', createdAt: 1 }]);
  const a = e.reviewActions()['o/r#6'];
  assert.equal(a.kind, 'pending');
  assert.equal(eligible(a), false, 'sem review postado não há pushback');
});

/* ---------- pushbackTargets: quem entra no scan deste ciclo ----------
   É o gate que decide gastar (ou não) uma sessão do Claude por PR. Estava sem teste
   nenhum: só o predicado de elegibilidade era coberto, e por cópia. */

// engine com um panorama e os marcadores de scan, sem tocar em rede
function engineComPanorama(resolved, panorama, scanned = {}, muted = []) {
  const e = engineWith(resolved);
  e.panorama = panorama;
  e.pushbackScanned = scanned;
  e.isMuted = (user) => muted.includes(user);
  e.accountForPr = (pr) => pr.account || 'eu';
  return e;
}

const RESOLVIDOS = [
  { key: 'o/r#1', status: 'auto_approved', action: 'approve', reasons: [], cardMet: true, resolvedAt: 1 },      // limpo
  { key: 'o/r#2', status: 'auto_approved', action: 'approve', reasons: ['confira X'], cardMet: true, resolvedAt: 1 }, // com ressalva
  { key: 'o/r#3', status: 'auto_rejected', action: 'request_changes', reasons: ['quebra'], resolvedAt: 1 },     // bloqueio
];

test('pushbackTargets: só entram ressalva e bloqueio, aprovação limpa fica de fora', () => {
  const e = engineComPanorama(RESOLVIDOS, [
    { key: 'o/r#1', updatedAt: '2026-08-01T10:00:00Z' },
    { key: 'o/r#2', updatedAt: '2026-08-01T10:00:00Z' },
    { key: 'o/r#3', updatedAt: '2026-08-01T10:00:00Z' },
    { key: 'o/r#9', updatedAt: '2026-08-01T10:00:00Z' },   // sem ação registrada
  ]);
  const alvos = pushbackTargets(e, e.reviewActions()).map(p => p.key);
  assert.deepEqual(alvos, ['o/r#2', 'o/r#3']);
});

test('pushbackTargets: conta silenciada nunca entra', () => {
  const e = engineComPanorama(RESOLVIDOS,
    [{ key: 'o/r#2', account: 'silenciada', updatedAt: '2026-08-01T10:00:00Z' },
    { key: 'o/r#3', account: 'eu', updatedAt: '2026-08-01T10:00:00Z' }],
    {}, ['silenciada']);
  assert.deepEqual(pushbackTargets(e, e.reviewActions()).map(p => p.key), ['o/r#3']);
});

test('pushbackTargets: PR já escaneado e sem novidade não reentra', () => {
  // o marcador evita reprocessar o mesmo PR ciclo após ciclo (cada um custa uma sessão)
  const e = engineComPanorama(RESOLVIDOS,
    [{ key: 'o/r#2', updatedAt: '2026-08-01T10:00:00Z' }],
    { 'o/r#2': '2026-08-01T10:00:00Z' });
  assert.deepEqual(pushbackTargets(e, e.reviewActions()), []);
});

test('pushbackTargets: PR escaneado que teve novidade depois reentra', () => {
  const e = engineComPanorama(RESOLVIDOS,
    [{ key: 'o/r#2', updatedAt: '2026-08-01T12:00:00Z' }],
    { 'o/r#2': '2026-08-01T10:00:00Z' });
  assert.deepEqual(pushbackTargets(e, e.reviewActions()).map(p => p.key), ['o/r#2']);
});

test('pushbackTargets: sem updatedAt, PR já escaneado não reentra', () => {
  // updatedAt ausente não pode ser lido como "mudou": reentraria em todo ciclo
  const e = engineComPanorama(RESOLVIDOS,
    [{ key: 'o/r#2' }],
    { 'o/r#2': '2026-08-01T10:00:00Z' });
  assert.deepEqual(pushbackTargets(e, e.reviewActions()), []);
});

test('pushbackTargets: panorama vazio ou ausente não quebra', () => {
  const e = engineComPanorama(RESOLVIDOS, []);
  assert.deepEqual(pushbackTargets(e, e.reviewActions()), []);
  e.panorama = undefined;
  assert.deepEqual(pushbackTargets(e, e.reviewActions()), []);
});

test('pushbackTargets: registro manual confirmado fica fora do scan (manual prevalece)', () => {
  const e = engineComPanorama(RESOLVIDOS,
    [{ key: 'o/r#2', updatedAt: '2026-08-01T12:00:00Z' },
    { key: 'o/r#3', updatedAt: '2026-08-01T12:00:00Z' }]);
  e.pushbacks = { 'o/r#2': { author: 'alice', outcome: 'author_right', source: 'manual', status: 'confirmed', at: 1 } };
  assert.deepEqual(pushbackTargets(e, e.reviewActions()).map(p => p.key), ['o/r#3']);
});

test('pushbackTargets: registro automático NÃO tira do scan (auto pode ser revisto)', () => {
  const e = engineComPanorama(RESOLVIDOS,
    [{ key: 'o/r#2', updatedAt: '2026-08-01T12:00:00Z' }],
    { 'o/r#2': '2026-08-01T10:00:00Z' });
  e.pushbacks = { 'o/r#2': { author: 'alice', outcome: 'we_right', source: 'auto', status: 'confirmed', at: 1 } };
  assert.deepEqual(pushbackTargets(e, e.reviewActions()).map(p => p.key), ['o/r#2']);
});

// gate de orçamento por perfil de chave de API (finding 2 do fix wave de 04/08/2026):
// mesmo budgetBlockedFor do toReview/retryTargets, pra o scan de pushback (1 sessão
// Claude por PR classificado) não gastar tokens de conta pausada por estouro.
test('pushbackTargets: conta com perfil de orçamento estourado fica de fora do scan', () => {
  const e = engineComPanorama(RESOLVIDOS,
    [{ key: 'o/r#2', account: 'bob', updatedAt: '2026-08-01T10:00:00Z' }]);
  e.config.accounts = [{ user: 'bob', owners: ['x'] }];
  const { localDay } = require('../lib/engine/usage');
  e.config.claudeProfiles = [{ id: 'p1', label: 'P1', kind: 'apikey', apiKey: 'sk-1', baseUrl: '', budgetDaily: 1 }];
  e.config.claudeProfileId = 'p1';
  e.usage.byProfileDay = { [`p1|${localDay()}`]: { sessions: 1, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 1 } };
  assert.deepEqual(pushbackTargets(e, e.reviewActions()), []);
});

test('pushbackTargets: conta com perfil dentro do orçamento segue elegível pro scan', () => {
  const e = engineComPanorama(RESOLVIDOS,
    [{ key: 'o/r#2', account: 'bob', updatedAt: '2026-08-01T10:00:00Z' }]);
  e.config.accounts = [{ user: 'bob', owners: ['x'] }];
  e.config.claudeProfiles = [{ id: 'p1', label: 'P1', kind: 'apikey', apiKey: 'sk-1', baseUrl: '', budgetDaily: 100 }];
  e.config.claudeProfileId = 'p1';
  assert.deepEqual(pushbackTargets(e, e.reviewActions()).map(p => p.key), ['o/r#2']);
});

test('scanPushbacks não sobrescreve registro manual nem quando ele chega DURANTE o scan', async () => {
  // corrida real: você marca à mão enquanto a classificação está em voo
  const e = engineComPanorama(RESOLVIDOS, [{ key: 'o/r#2', updatedAt: '2026-08-01T10:00:00Z' }]);
  e.config.autoPushback = true;
  e.savePushbackScanned = () => { };
  e.savePushbacks = () => { };
  e.log = () => { };
  e.emit = () => { };
  e.detectAuthorPushback = async () => ({ marker: 'm', hadActivity: true });
  e.classifyPushback = async () => {
    e.pushbacks['o/r#2'] = { author: 'alice', outcome: 'author_right', source: 'manual', status: 'confirmed', at: 1 };
    return { isPushback: true, outcome: 'we_right', confidence: 'high', note: 'x' };
  };
  await e.scanPushbacks();
  assert.equal(e.pushbacks['o/r#2'].source, 'manual', 'o registro manual sobreviveu');
  assert.equal(e.pushbacks['o/r#2'].outcome, 'author_right', 'o desfecho marcado à mão prevalece');
});

test('scanPushbacks: falha transitória da classificação NÃO grava o marcador (reentra no próximo ciclo)', async () => {
  const e = engineComPanorama(RESOLVIDOS, [{ key: 'o/r#2', updatedAt: '2026-08-01T10:00:00Z' }]);
  e.config.autoPushback = true;
  e.savePushbackScanned = () => { };
  e.log = () => { };
  e.detectAuthorPushback = async () => ({ marker: '2026-08-01T09:00:00Z', hadActivity: true });
  e.classifyPushback = async () => null; // sessão caiu (rede, limite do plano)
  await e.scanPushbacks();
  assert.equal(e.pushbackScanned['o/r#2'], undefined, 'sem marcador, o alvo volta no próximo ciclo');
  assert.deepEqual(pushbackTargets(e, e.reviewActions()).map(p => p.key), ['o/r#2'], 'e de fato reentra');
});

test('scanPushbacks: sem atividade do autor, o marcador grava e não gasta sessão', async () => {
  const e = engineComPanorama(RESOLVIDOS, [{ key: 'o/r#2', updatedAt: '2026-08-01T10:00:00Z' }]);
  e.config.autoPushback = true;
  e.savePushbackScanned = () => { };
  e.log = () => { };
  let classificou = false;
  e.detectAuthorPushback = async () => ({ marker: '2026-08-01T09:00:00Z', hadActivity: false });
  e.classifyPushback = async () => { classificou = true; return null; };
  await e.scanPushbacks();
  assert.equal(e.pushbackScanned['o/r#2'], '2026-08-01T09:00:00Z', 'marcador salvo');
  assert.equal(classificou, false, 'sem atividade não gasta sessão');
});

test('scanPushbacks: classificação respondida (mesmo "none") grava o marcador', async () => {
  const e = engineComPanorama(RESOLVIDOS, [{ key: 'o/r#2', updatedAt: '2026-08-01T10:00:00Z' }]);
  e.config.autoPushback = true;
  e.savePushbackScanned = () => { };
  e.log = () => { };
  e.detectAuthorPushback = async () => ({ marker: '2026-08-01T09:00:00Z', hadActivity: true });
  e.classifyPushback = async () => ({ isPushback: false, outcome: 'none', confidence: 'high', note: '' });
  await e.scanPushbacks();
  assert.equal(e.pushbackScanned['o/r#2'], '2026-08-01T09:00:00Z', 'a sessão respondeu: não reprocessa');
});

test('scanPushbacks respeita o opt-in autoPushback', async () => {
  const e = engineComPanorama(RESOLVIDOS, [{ key: 'o/r#2', updatedAt: '2026-08-01T10:00:00Z' }]);
  e.config.autoPushback = false;
  let chamou = false;
  e.detectAuthorPushback = async () => { chamou = true; return null; };
  await e.scanPushbacks();
  assert.equal(chamou, false, 'desligado não gasta nem a checagem barata do gh');
});

test('scanPushbacks para em 2 classificações por ciclo', async () => {
  // teto de custo: cada classificação é uma sessão do Claude
  const resolvidos = [];
  const panorama = [];
  for (let i = 1; i <= 5; i++) {
    resolvidos.push({ key: `o/r#${i}`, status: 'auto_rejected', action: 'request_changes', reasons: ['x'], resolvedAt: 1 });
    panorama.push({ key: `o/r#${i}`, updatedAt: '2026-08-01T10:00:00Z' });
  }
  const e = engineComPanorama(resolvidos, panorama);
  e.config.autoPushback = true;
  e.savePushbackScanned = () => { };
  e.log = () => { };
  let classificados = 0;
  e.detectAuthorPushback = async () => ({ marker: 'm', hadActivity: true });
  e.classifyPushback = async () => { classificados++; return null; };
  await e.scanPushbacks();
  assert.equal(classificados, 2, 'no máximo 2 sessões do Claude por ciclo');
});

test('scanPushbacks não roda duas vezes ao mesmo tempo', async () => {
  const e = engineComPanorama(RESOLVIDOS, [{ key: 'o/r#2', updatedAt: '2026-08-01T10:00:00Z' }]);
  e.config.autoPushback = true;
  e.pushbackScanning = true;   // simula um scan em voo
  let chamou = false;
  e.detectAuthorPushback = async () => { chamou = true; return null; };
  await e.scanPushbacks();
  assert.equal(chamou, false);
});

/* ---------- G4: scan só reclassifica com comentário NOVO do autor ----------
   Sem isso, um comentário de TERCEIRO avançava o updatedAt do PR (o gate barato de
   pushbackTargets) pra sempre, e a MESMA thread era reclassificada (sessão Claude
   paga) a cada ciclo, porque hadActivity só olhava "autor falou depois do MEU review",
   nunca depois do marcador do ciclo anterior. Aqui o gh de verdade é stubado por
   endpoint (padrão do gh-queries-capped.test.js/account-identity.test.js), pra exercitar
   detectAuthorPushback de ponta a ponta, não uma cópia da regra. */

// gh stubado por endpoint: reviews (meu último review), issues/comments e
// pulls/comments (comentários do autor, já filtrados > myAt, como o jq real devolveria).
function stubGhPushback(pr, myAt, comentariosDoAutor) {
  return async (cmd, args) => {
    const apiPath = (args && args[1]) || '';
    if (apiPath.endsWith(`/pulls/${pr.number}/reviews`)) {
      return { ok: true, code: 0, stdout: myAt, stderr: '' };
    }
    if (apiPath.endsWith(`/issues/${pr.number}/comments`)) {
      return { ok: true, code: 0, stdout: JSON.stringify(comentariosDoAutor), stderr: '' };
    }
    if (apiPath.endsWith(`/pulls/${pr.number}/comments`)) {
      return { ok: true, code: 0, stdout: '[]', stderr: '' };
    }
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };
}

function engineParaG4(pr, marcadorAnterior) {
  const resolved = [{ key: pr.key, status: 'auto_rejected', action: 'request_changes', reasons: ['x'], resolvedAt: 1 }];
  const e = engineComPanorama(resolved, [pr], { [pr.key]: marcadorAnterior });
  e.tokens = { [pr.account]: 'tok' };
  e.token = 'tok';
  e.config.autoPushback = true;
  e.savePushbackScanned = () => { };
  e.log = () => { };
  e.emit = () => { };
  return e;
}

test('scan não reclassifica quando a única novidade é de terceiro (updatedAt avançou, autor calado)', async () => {
  // marcador do ciclo anterior = último comentário do autor (10h); updatedAt do PR
  // avançou pra 11h (comentário de um colega); os comentários do autor devolvidos
  // pelo gh são todos <= 10h (nenhum é novidade de verdade).
  const pr = { key: 'acme/app#7', repo: 'acme/app', number: 7, account: 'wanderson', author: 'alice', updatedAt: '2026-08-15T11:00:00Z' };
  const marcador = '2026-08-15T10:00:00Z';
  ghImpl = stubGhPushback(pr, '2026-08-15T08:00:00Z', ['2026-08-15T09:00:00Z', '2026-08-15T10:00:00Z']);
  const e = engineParaG4(pr, marcador);

  const det = await detectAuthorPushback(e, pr, marcador);
  assert.equal(det.hadActivity, false, 'nenhum comentário do autor é posterior ao marcador');

  let chamadasClassify = 0;
  e.classifyPushback = async () => { chamadasClassify++; return null; };
  await e.scanPushbacks();
  assert.equal(chamadasClassify, 0, 'updatedAt avançar por comentário de terceiro não gasta sessão Claude');
});

test('comentário novo do autor depois do marcador reclassifica normalmente', async () => {
  // mesmo setup, mas o gh devolve um comentário do autor às 12h (depois do marcador)
  const pr = { key: 'acme/app#8', repo: 'acme/app', number: 8, account: 'wanderson', author: 'alice', updatedAt: '2026-08-15T12:00:00Z' };
  const marcador = '2026-08-15T10:00:00Z';
  ghImpl = stubGhPushback(pr, '2026-08-15T08:00:00Z', ['2026-08-15T09:00:00Z', '2026-08-15T10:00:00Z', '2026-08-15T12:00:00Z']);
  const e = engineParaG4(pr, marcador);

  const det = await detectAuthorPushback(e, pr, marcador);
  assert.equal(det.hadActivity, true, 'comentário às 12h é novidade real do autor');
  assert.equal(det.marker, '2026-08-15T12:00:00Z');

  let chamadasClassify = 0;
  e.classifyPushback = async () => {
    chamadasClassify++;
    return { isPushback: true, outcome: 'we_right', confidence: 'high', note: 'x' };
  };
  await e.scanPushbacks();
  assert.equal(chamadasClassify, 1, 'reclassifica exatamente uma vez');
  assert.equal(e.pushbackScanned[pr.key], '2026-08-15T12:00:00Z', 'marcador avança pro novo comentário');
});
