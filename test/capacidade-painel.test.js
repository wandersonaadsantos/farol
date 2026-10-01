// Controle do celular (28/09/2026), parte 4: o painel do aparelho.
//
// A capacidade (`live/deviceStatus`) passa a levar a política efetiva de cada conta e as
// últimas falhas, e o admin a lê como painel. As provas de tamanho cifram de VERDADE
// contra lib/sync/envelope.js, com o nó, o campo e o esquema que o motor usa.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-capacidade-painel-'));
process.env.FAROL_HOME = BASE;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { Engine } = await import('../server.js');
const publicacao = (await import('../lib/engine/sync-publicacao.js')).default;
const painel = (await import('../lib/engine/sync-painel.js')).default;
const telas = (await import('../lib/engine/sync-telas.js')).default;
const capacidade = (await import('../lib/sync/capacidade.js')).default;
const envelope = (await import('../lib/sync/envelope.js')).default;
const kek = (await import('../lib/sync/kek.js')).default;
const { acctTag, prTag } = await import('../lib/sync/tags.js');

after(() => { try { fs.rmSync(BASE, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ } });

const T = 1_800_000_000_000;
const CONTAS = [
  { user: 'conta-um', owners: ['a'], autoReview: true, onClean: 'approve', onCaveats: 'approve', onReject: 'request_changes' },
  { user: 'conta-dois', owners: ['b'], autoReview: false, muted: true, onClean: 'wait', onReject: 'wait' },
  { user: 'c'.repeat(39), owners: ['c'], onCaveats: 'wait' },
  { user: 'd'.repeat(39), owners: ['d'], onCaveats: 'approve' },
];

function motor() {
  const e = new Engine();
  e.log = () => { };
  e.pushState = () => { };
  e.updateSettings({ accounts: CONTAS });
  e.sync.material = kek.novoMaterial();
  e.sync.cur = 'g1';
  e.sync.uid = 'u1';
  e.sync.deviceId = 'dCel';
  e.sync.deviceName = 'ç'.repeat(40);
  e.doctorInfo = { claude: '1.0.0', ghAuth: true };
  e.tokenFor = () => 'token';
  const falha = (i, classe, ref) => ({ id: `f${i}`, at: T + i, kind: 'review', account: 'conta-um', ref, classe, motivo: `stderr com segredo ghp_${'x'.repeat(30)} ${i}`, sessionId: `s${i}` });
  e.falhasSessao = [
    falha(1, 'desconhecido', 'a/r#1'), falha(2, 'rede', 'a/r#2'), falha(3, 'coordenacao-indisponivel', 'o'.repeat(39) + '/' + 'r'.repeat(100) + '#999999'),
    falha(4, 'skip-permissions-root', 'Kudos'), falha(5, 'provedor-indisponivel', 'a/r#5'),
  ];
  return e;
}

function kIdDe(e) { return kek.bufferDe(e.sync.material.id); }

function cifrar(e, c) {
  return envelope.cifrar({
    uid: 'u1', caminho: `live/deviceStatus/${'d'.repeat(40)}`, campo: capacidade.CAMPO, no: 'live/deviceStatus', esquema: capacidade.ESQUEMA,
    cur: 'g1', material: e.sync.material, r: 1, dados: { c },
  });
}

test('a capacidade leva a política de cada conta, na ordem das contas', () => {
  const e = motor();
  const c = publicacao.capacidadeDe(e, { aceitarAdmin: true });
  assert.equal(c.politicas.length, c.contas.length);
  const kId = kIdDe(e);
  const porConta = Object.fromEntries(c.contas.map((tag, i) => [tag, c.politicas[i]]));
  assert.deepEqual(porConta[acctTag(kId, 'conta-um')], [true, false, 'approve', 'approve', 'request_changes']);
  assert.deepEqual(porConta[acctTag(kId, 'conta-dois')], [false, true, 'wait', 'wait', 'wait']);
  // a política mora só na conta (30/09/2026): o que sai é o que a conta tem gravado, e a
  // conta que chegou sem um campo o recebeu por extenso na gravação
  assert.deepEqual(porConta[acctTag(kId, 'c'.repeat(39))], [true, false, 'approve', 'wait', 'wait']);
  assert.deepEqual(porConta[acctTag(kId, 'd'.repeat(39))], [true, false, 'approve', 'approve', 'wait']);
});

// O campo `paralelismo` não mudou de nome (o agendador do admin e a frota em versão antiga o
// leem como o total do aparelho); desde 30/09/2026 o valor vem do teto TOTAL, e não mais do
// limite por conta, que virava total quando o compartilhamento ligava.
test('a capacidade publica o TOTAL do aparelho: o teto total, ou a soma dos limites por conta', () => {
  const e = motor();
  e.updateSettings({ parallelReviews: 1, globalParallelReviews: 0 });
  assert.equal(publicacao.capacidadeDe(e, { aceitarAdmin: true }).paralelismo, 4, 'sem teto total: quatro contas, uma por conta');
  e.updateSettings({ parallelReviews: 2 });
  assert.equal(publicacao.capacidadeDe(e, { aceitarAdmin: true }).paralelismo, 8);
  e.updateSettings({ globalParallelReviews: 3 });
  assert.equal(publicacao.capacidadeDe(e, { aceitarAdmin: true }).paralelismo, 3, 'com teto total, é ele, e o limite por conta não entra');
  e.updateSettings({ parallelReviews: 4 });
  assert.equal(publicacao.capacidadeDe(e, { aceitarAdmin: true }).paralelismo, 3);
  // leitor de versão antiga: o painel continua recebendo um número de 1 para cima
  assert.equal(capacidade.painelDaCapacidade(publicacao.capacidadeDe(e, { aceitarAdmin: true })).paralelismo, 3);
});

test('a capacidade leva só as 3 falhas mais recentes, com classe, instante e o PR como tag, sem texto livre', () => {
  const e = motor();
  const c = publicacao.capacidadeDe(e, { aceitarAdmin: true });
  const kId = kIdDe(e);
  assert.deepEqual(c.falhas, [
    ['provedor-indisponivel', T + 5, prTag(kId, 'a/r#5')],
    ['skip-permissions-root', T + 4, ''],
    ['coordenacao-indisponivel', T + 3, prTag(kId, 'o'.repeat(39) + '/' + 'r'.repeat(100) + '#999999')],
  ]);
  const claro = JSON.stringify(c);
  for (const proibido of ['ghp_', 'stderr', 'Kudos', 'a/r#5']) assert.equal(claro.includes(proibido), false, proibido);
});

test('a capacidade cifrada cabe no teto de 2048 com 4 contas, 3 falhas e o maior nome de aparelho', () => {
  const e = motor();
  e.admissao = { reservas: new Map([['r1', { grupo: 'g'.repeat(32) }], ['r2', { grupo: 'h'.repeat(32) }]]) };
  const c = publicacao.capacidadeDe(e, { aceitarAdmin: true });
  assert.equal(c.contas.length, 4);
  assert.equal(c.contasComToken.length, 4);
  assert.equal(c.falhas.length, 3);
  const r = cifrar(e, c);
  assert.equal(r.ok, true, `a capacidade estoura o teto: ${r.motivo}`);
  assert.ok(r.enc.length <= 2048, `${r.enc.length} > 2048`);
});

test('o painel projeta a capacidade por extenso e descarta o que não é do vocabulário', () => {
  const tag = 'a'.repeat(32);
  const p = capacidade.painelDaCapacidade({
    pausado: true, paralelismo: 3, iaPronta: true, aceitarAdmin: false, contas: [tag, 'lixo'], contasComToken: [tag],
    politicas: [[true, false, 'approve', 'wait', 'nao-existe']], falhas: [['rede', T, tag], ['<script>', T, tag], ['rede', 'x', 'nao-tag']],
    admissao: { total: 2 }, nome: 'não vai', ramLivre: 'alta',
  });
  assert.deepEqual(p, {
    pausado: true, paralelismo: 3, ocupadas: 2, iaPronta: true, aceitarAdmin: false, contasComToken: [tag],
    contas: [{ acctTag: tag, politica: { autoReview: true, muted: false, onClean: 'approve', onCaveats: 'wait', onReject: null } }],
    falhas: [{ classe: 'rede', at: T, prTag: tag }, { classe: 'rede', at: 0, prTag: '' }],
  });
  assert.equal(capacidade.painelDaCapacidade({}).aceitarAdmin, null, 'aparelho antigo sem o campo não vira recusa nem aceite');
  assert.equal(capacidade.painelDaCapacidade({ contas: [tag] }).contas[0].politica, null, 'sem política publicada, nada inventado');
});

test('o admin lê o painel dos outros aparelhos, com o nome das contas que conhece, e falha não apaga', async () => {
  const cel = motor();
  const c = publicacao.capacidadeDe(cel, { aceitarAdmin: true });
  const enc = envelope.cifrar({
    uid: 'u1', caminho: 'live/deviceStatus/dCel', campo: capacidade.CAMPO, no: 'live/deviceStatus', esquema: capacidade.ESQUEMA,
    cur: 'g1', material: cel.sync.material, r: 1, dados: { c },
  }).enc;
  const pc = new Engine();
  pc.log = () => { };
  pc.pushState = () => { };
  pc.updateSettings({ accounts: [{ user: 'conta-um', owners: ['a'] }], sync: { enabled: true, shared: { enabled: true }, databaseUrl: 'http://127.0.0.1:1', apiKey: 'k', projectId: 'p' } });
  Object.assign(pc.sync, { material: cel.sync.material, cur: 'g1', uid: 'u1', deviceId: 'dPc' });
  pc.sync.devices = { dCel: { name: 'Celular', farolVersion: '2.65.0', lastSeenAt: T, contract: 2, keyReady: true } };
  // o nome de uma conta que o computador não tem chega pela linha do Panorama do celular
  pc.sync.listasRemotas = { estado: 'ligada', escopos: new Map([['panorama/x', { scope: acctTag(kIdDe(cel), 'conta-dois'), conta: '', nomeRemoto: 'conta-dois' }]]) };
  let falhar = false;
  pc.sync.client = { get: async () => (falhar ? { ok: false } : { ok: true, data: { dCel: { v: 1, u: T, enc }, dPc: { v: 1, u: T, enc: 'e1.g1.x.y.z' } } }) };
  const cfg = pc.config.sync;
  assert.equal((await painel.lerPaineis(pc, cfg, { agora: T })).leu, true);
  const proj = telas.projecaoDasTelas(pc).paineis;
  assert.equal(proj.aparelhos.length, 1, 'este aparelho não é painel de si mesmo');
  const [a] = proj.aparelhos;
  assert.equal(a.deviceId, 'dCel');
  assert.equal(a.nome, 'Celular');
  assert.equal(a.versao, '2.65.0');
  assert.equal(a.aceitarAdmin, true);
  assert.equal(a.iaPronta, true);
  assert.equal(a.falhas.length, 3);
  const porNome = Object.fromEntries(a.contas.map((x) => [x.nome, x]));
  assert.deepEqual(porNome['conta-um'].politica, { autoReview: true, muted: false, onClean: 'approve', onCaveats: 'approve', onReject: 'request_changes' });
  assert.equal(porNome['conta-um'].temToken, true);
  assert.equal(porNome['conta-dois'].nomeConhecido, true, 'o nome veio da linha remota');
  assert.equal(a.contas.filter((x) => !x.nomeConhecido).length, 2, 'as outras aparecem pela tag curta');
  // cadência: antes do intervalo não relê; forçado relê, e a leitura que falha mantém a visão
  assert.equal((await painel.lerPaineis(pc, cfg, { agora: T + 1 })).leu, false);
  falhar = true;
  assert.equal((await painel.lerPaineis(pc, cfg, { agora: T + 2, forcar: true })).ok, false);
  assert.equal(telas.projecaoDasTelas(pc).paineis.aparelhos.length, 1);
  assert.equal(telas.projecaoDasTelas(pc).paineis.lidoEm, T);
});

// A capacidade é o que o agendador e o teto do grupo leem: se o painel a fizer passar do
// teto, quem sai é o painel, nunca ela.
test('capacidade que passaria do teto perde primeiro as falhas e depois as políticas, e continua subindo', async () => {
  const e = motor();
  const reservas = Array.from({ length: 6 }, (_, i) => [`r${i}`, { grupo: String(i).padStart(32, 'g') }]);
  e.admissao = { reservas: new Map(reservas) };
  const puts = [];
  e.sync.client = { put: async (_p, v) => { puts.push(v); return { ok: true }; } };
  e.sync.devices = { dOutro: { contract: 2, keyReady: true, lastSeenAt: Date.now() } };
  const cfg = { enabled: true, shared: { enabled: true }, aceitarAdmin: true };
  const cheia = publicacao.capacidadeDe(e, cfg);
  assert.equal(cifrar(e, cheia).ok, false, 'a premissa: inteira ela não cabe');
  const r = await publicacao.publicarCapacidade(e, cfg);
  assert.equal(r.ok, true, r.motivo);
  assert.equal(puts.length, 1);
  const aberta = capacidade.abrirCapacidade({ uid: 'u1', material: e.sync.material, dev: 'dCel', no: puts[0] });
  assert.ok(aberta, 'a capacidade subiu e abre');
  assert.deepEqual(aberta.c.falhas, []);
  assert.equal(Object.keys(aberta.c.consumo.grupos).length, 6, 'o que o teto do grupo lê nunca é cortado');
});
