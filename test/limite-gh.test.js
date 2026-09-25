// Limite de requisicoes do GitHub: o Farol PARA de buscar ate renovar (23/09/2026).
//
// Medido no farol.log do Wanderson: 312 linhas de `gh search falhou` com
// "API rate limit already exceeded for user ID 95881233", 297 delas num unico dia.
// Duas causas somadas:
//
// (a) a taxonomia nao reconhecia o texto REAL do GraphQL. A regex cobria
//     "API rate limit exceeded" e "rate limit exceeded for", e a mensagem do gh diz
//     "rate limit ALREADY exceeded for user ID": caia em desconhecido -> permanente,
//     o oposto do que a classe rate-limit-github promete.
// (b) a busca que falha so logava e devolvia null, sem memoria nenhuma. A cada ciclo
//     de polling as ~7 buscas da conta saiam de novo, todas batiam no limite ja
//     estourado, e cada tentativa ainda consome cota: o Farol prolongava o proprio
//     bloqueio e entupia o log que o Diagnostico le.
import os from 'node:os';
import path from 'node:path';
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-limitegh-' + process.pid);

const io = (await import('../lib/io.js')).default;
const LIMITE = 'GraphQL: API rate limit already exceeded for user ID 95881233.';
let respostaBusca = { ok: true, code: 0, stdout: '[]', stderr: '' };
let respostaReset = { ok: false, code: 1, stdout: '', stderr: 'sem resposta' };
let chamadas = [];
io.run = async (cmd, args) => {
  chamadas.push(args.join(' '));
  if (args[0] === 'api' && args[1] === 'rate_limit') return respostaReset;
  return respostaBusca;
};

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { Engine } = await import('../server.js');
const limiteGh = (await import('../lib/engine/limite-gh.js')).default;
const { classify } = await import('../lib/log-taxonomy.js');
const { operationChecks } = await import('../ui/pure/sistema.js');
const { TEMPOS } = await import('../lib/constants.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { } });

beforeEach(() => {
  chamadas = [];
  respostaBusca = { ok: true, code: 0, stdout: '[]', stderr: '' };
  respostaReset = { ok: false, code: 1, stdout: '', stderr: 'sem resposta' };
});

function engine() {
  const e = new Engine();
  e.tokens = { eu: 'tok', outra: 'tok2' };
  e.logs = [];
  e.log = (level, msg) => e.logs.push({ level, msg });
  return e;
}

test('a taxonomia reconhece o texto REAL do limite do GitHub', () => {
  const c = classify(`gh search falhou (wandersonaadsantos: --owner acme): ${LIMITE}`);
  assert.equal(c.id, 'rate-limit-github', 'o "already" no meio da frase nao pode virar falha desconhecida');
  assert.equal(c.kind, 'transitorio', 'e espera, nao defeito permanente');
});

test('sem reset conhecido, a espera e a padrao; com reset do gh, e a hora dele', () => {
  const agora = 1_000_000;
  assert.equal(limiteGh.esperaAte(0, agora), agora + TEMPOS.LIMITE_GH_ESPERA_SEM_HORA_MS);
  assert.equal(limiteGh.esperaAte(agora - 1, agora), agora + TEMPOS.LIMITE_GH_ESPERA_SEM_HORA_MS,
    'reset no passado nao serve de prazo');
  assert.equal(limiteGh.esperaAte(agora + 60_000, agora), agora + 60_000);
});

test('busca que bate no limite entra em espera e loga UMA linha', async () => {
  const e = engine();
  respostaBusca = { ok: false, code: 1, stdout: '', stderr: LIMITE };
  const r = await e.searchPRs(['--owner', 'acme'], 'eu');
  assert.equal(r, null, 'falha de busca continua devolvendo null (o check preserva o que sabia)');
  assert.ok(limiteGh.emEspera(e, 'eu'), 'a conta fica em espera');
  const linhas = e.logs.filter(l => /limite de requisi/i.test(l.msg));
  assert.equal(linhas.length, 1, 'uma linha por janela de espera, nao uma por tentativa');
  assert.match(linhas[0].msg, /@eu/, 'a linha diz de QUAL conta e o limite');
});

test('em espera, a busca seguinte nem chama o gh', async () => {
  const e = engine();
  respostaBusca = { ok: false, code: 1, stdout: '', stderr: LIMITE };
  await e.searchPRs(['--owner', 'acme'], 'eu');
  chamadas = [];
  e.logs = [];
  const r = await e.searchPRs(['--owner', 'outra-org'], 'eu');
  assert.equal(r, null);
  assert.deepEqual(chamadas, [], 'nenhuma requisicao: tentar de novo so prolonga o bloqueio');
  assert.deepEqual(e.logs, [], 'e nenhum ruido novo no log');
});

test('a espera e POR CONTA: a outra continua buscando', async () => {
  const e = engine();
  respostaBusca = { ok: false, code: 1, stdout: '', stderr: LIMITE };
  await e.searchPRs(['--owner', 'acme'], 'eu');
  respostaBusca = { ok: true, code: 0, stdout: '[]', stderr: '' };
  chamadas = [];
  const r = await e.searchPRs(['--owner', 'acme'], 'outra');
  assert.deepEqual(r, [], 'a conta sem limite busca normalmente');
  assert.equal(chamadas.length, 1);
});

test('vencido o prazo a conta volta a buscar, e o registro sai sozinho', async () => {
  const e = engine();
  respostaBusca = { ok: false, code: 1, stdout: '', stderr: LIMITE };
  await e.searchPRs(['--owner', 'acme'], 'eu');
  const ate = limiteGh.limiteAte(e, 'eu');
  assert.ok(ate > Date.now(), 'a espera tem prazo: travar sem prazo pararia a conta pra sempre');
  respostaBusca = { ok: true, code: 0, stdout: '[]', stderr: '' };
  chamadas = [];
  const r = await e.searchPRs(['--owner', 'acme'], 'eu', ate + 1);
  assert.deepEqual(r, [], 'passado o prazo, a busca acontece de novo');
  assert.equal(chamadas.length, 1);
  assert.equal(limiteGh.limiteAte(e, 'eu', ate + 1), 0, 'e o registro vencido nao fica no caminho');
});

test('cota esgotada: o prazo vem do reset REAL do gh', async () => {
  const e = engine();
  const resetSeg = Math.floor(Date.now() / 1000) + 900;
  respostaBusca = { ok: false, code: 1, stdout: '', stderr: LIMITE };
  respostaReset = { ok: true, code: 0, stdout: `0 ${resetSeg}\n`, stderr: '' };
  await e.searchPRs(['--owner', 'acme'], 'eu');
  assert.equal(limiteGh.limiteAte(e, 'eu'), resetSeg * 1000, 'o prazo e a hora que o GitHub informou');
  assert.ok(chamadas.some(c => /^api rate_limit/.test(c)), 'consulta o endpoint de cota, que nao consome cota');
});

// 25/09/2026: uma conta ficou parada das 14:40 as 15:25 com 8 de 5000 usados. A
// recusa foi de rajada, e o prazo era o fim da janela de uma hora, que nao tem relacao.
test('cota com saldo: foi rajada, e a espera e curta, nao o reset da janela', async () => {
  const e = engine();
  const agora = Date.now();
  const resetSeg = Math.floor(agora / 1000) + 2700;
  respostaBusca = { ok: false, code: 1, stdout: '', stderr: 'You have exceeded a secondary rate limit.' };
  respostaReset = { ok: true, code: 0, stdout: `4992 ${resetSeg}\n`, stderr: '' };
  await e.searchPRs(['--owner', 'acme'], 'eu', agora);
  assert.equal(limiteGh.limiteAte(e, 'eu', agora), agora + TEMPOS.LIMITE_GH_ESPERA_RAJADA_MS);
  assert.ok(TEMPOS.LIMITE_GH_ESPERA_RAJADA_MS < 10 * 60 * 1000, 'rajada nao pode cegar a conta por um ciclo inteiro');
});

test('o prazo pela cota, sem rede', () => {
  const agora = 1_000_000;
  assert.equal(limiteGh.prazoPelaCota(null, agora), agora + TEMPOS.LIMITE_GH_ESPERA_SEM_HORA_MS,
    'gh sem resposta: nao sabemos, espera padrao');
  assert.equal(limiteGh.prazoPelaCota({ restante: 8, resetMs: agora + 3_000_000 }, agora),
    agora + TEMPOS.LIMITE_GH_ESPERA_RAJADA_MS);
  assert.equal(limiteGh.prazoPelaCota({ restante: 0, resetMs: agora + 60_000 }, agora), agora + 60_000);
});

test('a linha do log leva o que o gh disse, para separar rajada de cota esgotada', async () => {
  const e = engine();
  respostaBusca = { ok: false, code: 1, stdout: '', stderr: `${LIMITE}\nsegunda linha` };
  await e.searchPRs(['--owner', 'acme'], 'eu');
  const linha = e.logs.find(l => /limite de requisi/i.test(l.msg)).msg;
  assert.ok(linha.includes(`O gh disse: ${LIMITE}`));
  assert.ok(!linha.includes('segunda linha'), 'so a primeira linha, para nao entupir o log');
});

test('o Diagnostico mostra a conta parada no limite, com hora', () => {
  const ate = new Date('2026-09-23T15:40:00').getTime();
  const checks = operationChecks([{ user: 'eu', owners: ['acme'], tokenOk: true, limiteGhAte: ate }]);
  const c = checks.find(x => x.label === 'Monitoramento de @eu');
  assert.equal(c.ok, false, 'conta parada no limite nao pode aparecer verde');
  assert.match(c.detail, /limite de requisi/i);
  assert.match(c.detail, /15:40/, 'diz ate quando');
});
