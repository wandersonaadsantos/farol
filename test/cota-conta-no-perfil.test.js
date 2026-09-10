// Política 2 da spec 2026-09-10-justica-de-fila-entre-orgs: o teto de orçamento é do
// PERFIL Claude, não da conta. Duas contas GitHub apontando pro mesmo perfil dividem um
// teto único, e a de alto volume queimava a cota do dia sozinha: a outra era barrada no
// gate de enfileiramento sem NUNCA ter tido uma revisão.
//
// A cota dá a cada conta uma fatia do teto do dia (por peso, default igual). Mas ela
// SÓ MORDE QUANDO HÁ DISPUTA: sem outra conta esperando na fila, quem chegou é
// atendido até o teto duro do perfil, como sempre. É a regra do Wanderson escrita como
// código, e é o que mantém a política work-conserving (nenhum dólar do teto fica sem
// gastar guardando a vez de quem não chegou).
import os from 'node:os';
import path from 'node:path';
process.env.FAROL_HOME = process.env.FAROL_HOME || path.join(os.tmpdir(), 'farol-test-cota-' + process.pid);

import { test } from 'node:test';
import assert from 'node:assert/strict';
const usageMod = (await import('../lib/engine/usage.js')).default;

const HOJE = '2026-09-10';
const perfil = (extra = {}) => ({ id: 'p1', label: 'Principal', budgetDaily: 100, ...extra });

// sessão de gasto no formato real de usageSessions.sessions
const s = (account, costUsd, { profileId = 'p1', day = HOJE } = {}) => ({ account, costUsd, profileId, day });

// conta candidata à cota: quem é, quanto pesa, e se tem PR esperando AGORA
const conta = (user, { weight = 1, waiting = false } = {}) => ({ user, weight, waiting });

test('accountSpendInProfile soma só o gasto DAQUELA conta, naquele perfil, naquele dia', () => {
  const sessions = [
    s('biuder', 30), s('biuder', 10),
    s('pessoal', 5),
    s('biuder', 999, { profileId: 'outro' }),
    s('biuder', 999, { day: '2026-09-09' }),
  ];
  assert.equal(usageMod.accountSpendInProfile(sessions, 'p1', 'biuder', HOJE), 40);
  assert.equal(usageMod.accountSpendInProfile(sessions, 'p1', 'pessoal', HOJE), 5);
  assert.equal(usageMod.accountSpendInProfile(sessions, 'p1', 'ninguem', HOJE), 0);
});

test('accountSpendInProfile não diferencia caixa no login (o resto do app guarda minúsculo)', () => {
  assert.equal(usageMod.accountSpendInProfile([s('BiudER', 7)], 'p1', 'biuder', HOJE), 7);
});

test('cota divide o teto do dia igualmente entre as contas ativas do perfil', () => {
  const contas = [conta('biuder'), conta('pessoal')];
  const r = usageMod.quotaStatusFor(perfil(), [], contas, 'biuder', 0, HOJE);
  assert.equal(r.quota, 50);
});

test('peso assimétrico divide na proporção pedida', () => {
  const contas = [conta('biuder', { weight: 3 }), conta('pessoal', { weight: 1 })];
  assert.equal(usageMod.quotaStatusFor(perfil(), [], contas, 'biuder', 0, HOJE).quota, 75);
  assert.equal(usageMod.quotaStatusFor(perfil(), [], contas, 'pessoal', 0, HOJE).quota, 25);
});

test('conta abaixo da própria cota nunca é barrada, mesmo com disputa', () => {
  const contas = [conta('biuder'), conta('pessoal', { waiting: true })];
  const r = usageMod.quotaStatusFor(perfil(), [s('biuder', 20)], contas, 'biuder', 0, HOJE);
  assert.equal(r.blocked, false);
});

test('conta acima da cota COM outra esperando cede a vez', () => {
  const contas = [conta('biuder'), conta('pessoal', { waiting: true })];
  const r = usageMod.quotaStatusFor(perfil(), [s('biuder', 60)], contas, 'biuder', 0, HOJE);
  assert.equal(r.blocked, true);
  assert.deepEqual(r.cedendoPara, ['pessoal'], 'diz PRA QUEM cedeu, senão o toast mente igual ao de antes');
});

// A prova da regra do Wanderson: "sem fila, o que chegar deve ser atendido".
test('conta acima da cota SEM ninguém esperando continua sendo atendida', () => {
  const contas = [conta('biuder'), conta('pessoal', { waiting: false })];
  const r = usageMod.quotaStatusFor(perfil(), [s('biuder', 60)], contas, 'biuder', 0, HOJE);
  assert.equal(r.blocked, false, 'cota sem disputa não pode deixar o teto do perfil sem gastar');
});

test('a outra conta só conta como disputa se ela própria ainda couber na cota dela', () => {
  const contas = [conta('biuder'), conta('pessoal', { waiting: true })];
  const sessions = [s('biuder', 60), s('pessoal', 60)];
  const r = usageMod.quotaStatusFor(perfil(), sessions, contas, 'biuder', 0, HOJE);
  assert.equal(r.blocked, false, 'as duas estouraram a cota: ninguém tem vez a receber, quem chegar é atendido');
});

test('a projeção do custo típico entra na conta, igual ao gate de orçamento', () => {
  const contas = [conta('biuder'), conta('pessoal', { waiting: true })];
  const semProjecao = usageMod.quotaStatusFor(perfil(), [s('biuder', 45)], contas, 'biuder', 0, HOJE);
  const comProjecao = usageMod.quotaStatusFor(perfil(), [s('biuder', 45)], contas, 'biuder', 10, HOJE);
  assert.equal(semProjecao.blocked, false);
  assert.equal(comProjecao.blocked, true, '45 + 10 estoura a cota de 50 antes de a sessão nascer');
});

test('perfil sem teto do dia não tem cota nenhuma: ninguém é barrado', () => {
  const contas = [conta('biuder'), conta('pessoal', { waiting: true })];
  const r = usageMod.quotaStatusFor(perfil({ budgetDaily: null }), [s('biuder', 9999)], contas, 'biuder', 0, HOJE);
  assert.equal(r.blocked, false);
  assert.equal(r.quota, null);
});

test('conta sozinha no perfil tem cota igual ao teto inteiro e nunca disputa', () => {
  const r = usageMod.quotaStatusFor(perfil(), [s('biuder', 99)], [conta('biuder')], 'biuder', 0, HOJE);
  assert.equal(r.quota, 100);
  assert.equal(r.blocked, false);
});

test('perfil Codex fica fora da cota, pelo mesmo motivo que fica fora do teto', () => {
  const contas = [conta('biuder'), conta('pessoal', { waiting: true })];
  const r = usageMod.quotaStatusFor(perfil({ kind: 'codex' }), [s('biuder', 90)], contas, 'biuder', 0, HOJE);
  assert.equal(r.blocked, false, 'o plano não informa custo por sessão; teto em US$ ali é falsa precisão');
});

test('peso torto (0, negativo, lixo) vira 1 em vez de zerar a cota de alguém', () => {
  const contas = [conta('biuder', { weight: 0 }), conta('pessoal', { weight: 'banana' })];
  const r = usageMod.quotaStatusFor(perfil(), [], contas, 'biuder', 0, HOJE);
  assert.equal(r.quota, 50, 'peso invalido nao pode zerar a cota e barrar a conta pra sempre');
});

test('conta fora da lista do perfil não recebe cota e não é barrada', () => {
  const r = usageMod.quotaStatusFor(perfil(), [], [conta('biuder')], 'estranha', 0, HOJE);
  assert.equal(r.blocked, false);
  assert.equal(r.quota, null);
});

test('sem contas nenhuma, não divide por zero', () => {
  const r = usageMod.quotaStatusFor(perfil(), [], [], 'biuder', 0, HOJE);
  assert.equal(r.blocked, false);
  assert.equal(Number.isFinite(r.quota) || r.quota === null, true);
});

test('três contas: a estourada cede pras duas que ainda cabem, e diz o nome das duas', () => {
  const contas = [conta('biuder'), conta('pessoal', { waiting: true }), conta('lab', { waiting: true })];
  const r = usageMod.quotaStatusFor(perfil(), [s('biuder', 40)], contas, 'biuder', 0, HOJE);
  assert.ok(Math.abs(r.quota - 100 / 3) < 1e-9, `cota de um terço, veio ${r.quota}`);
  assert.equal(r.blocked, true);
  assert.deepEqual(r.cedendoPara.sort(), ['lab', 'pessoal']);
});

// --- fiação no engine: peso persistido e disputa lida da fila VIVA ---

const { parseAccounts } = await import('../lib/parse.js');

test('parseAccounts guarda o peso e recusa peso que zeraria a cota', () => {
  const [a] = parseAccounts([{ user: 'biuder', owners: ['biudtech'], budgetWeight: 3 }]);
  assert.equal(a.budgetWeight, 3);
  for (const torto of [0, -2, 'banana', null]) {
    const [b] = parseAccounts([{ user: 'x', owners: [], budgetWeight: torto }]);
    assert.equal(b.budgetWeight, undefined, `peso ${JSON.stringify(torto)} não pode ser persistido`);
  }
});

// contasDoPerfil é quem transforma a fila VIVA em "quem está esperando", e é essa
// leitura que faz a cota morder só quando há disputa de verdade. Chamado no protótipo
// pra não subir um Engine inteiro (o método não usa nada além do que o stub fornece).
const { Engine } = await import('../server.js');

function engineContas({ queue = [], contas = [], perfilDe = {} } = {}) {
  return {
    queue,
    accountList: () => contas,
    accountForPr: (pr) => pr.acct,
    isMuted: (u) => contas.some(c => c.user === u && c.muted),
    autoReviewFor: (u) => contas.some(c => c.user === u && c.autoReview !== false),
    tokenFor: () => 'tok',
    autoReviewParked: new Set(),
    skipComentado: {},
    profileOfAccount: (u) => perfilDe[u] || null,
  };
}

test('contasDoPerfil marca como esperando só quem tem PR elegível na fila agora', () => {
  const e = engineContas({
    queue: [{ key: 'biudtech/app#1', acct: 'biuder' }],
    contas: [{ user: 'biuder' }, { user: 'pessoal' }],
    perfilDe: { biuder: { id: 'p1' }, pessoal: { id: 'p1' } },
  });
  const r = Engine.prototype.contasDoPerfil.call(e, 'p1');
  assert.deepEqual(r.map(c => [c.user, c.waiting]), [['biuder', true], ['pessoal', false]]);
});

test('contasDoPerfil não conta como espera o PR estacionado nem o que saiu de cena', () => {
  const e = engineContas({
    queue: [{ key: 'org/app#1', acct: 'pessoal' }, { key: 'org/app#2', acct: 'pessoal' }],
    contas: [{ user: 'biuder' }, { user: 'pessoal' }],
    perfilDe: { biuder: { id: 'p1' }, pessoal: { id: 'p1' } },
  });
  e.autoReviewParked = new Set(['org/app#1']);
  e.skipComentado = { 'org/app#2': true };
  const r = Engine.prototype.contasDoPerfil.call(e, 'p1');
  assert.equal(r.find(c => c.user === 'pessoal').waiting, false, 'fila que não vai rodar não é disputa');
});

test('contasDoPerfil só junta quem divide o MESMO perfil, e ignora silenciada e sem auto-review', () => {
  const e = engineContas({
    queue: [],
    contas: [{ user: 'biuder' }, { user: 'pessoal' }, { user: 'outra' }, { user: 'quieta', muted: true }, { user: 'manual', autoReview: false }],
    perfilDe: { biuder: { id: 'p1' }, pessoal: { id: 'p1' }, outra: { id: 'p2' }, quieta: { id: 'p1' }, manual: { id: 'p1' } },
  });
  const r = Engine.prototype.contasDoPerfil.call(e, 'p1');
  assert.deepEqual(r.map(c => c.user), ['biuder', 'pessoal'], 'quem não revisa sozinho não encolhe a fatia de quem revisa');
});
