// Label de revisão em andamento (pedido do Thiago, 18/08/2026): quando a revisão
// headless de um PR começa, o PR ganha a label "<conta>:revisando" no GitHub e a
// perde quando a sessão termina. Desde 19/08/2026 (pedido do Thiago), label que não
// existe no repo é CRIADA pelo Farol (gh label create) e a adição é retentada UMA
// vez. Em 28/08/2026 a label morreu de manhã (v2.53.9, trocada por refs git) e
// VOLTOU à tarde por decisão do Wanderson: a visibilidade pro time é desejada, o
// proibido é texto público não-humanizado. O contrato aqui é o dos GUARDAS e da
// SEQUÊNCIA de chamadas, provados com um runner injetado (sem rede): a composição
// do nome é pura; sem conta ou sem token o gh NUNCA é chamado (mesma raiz A1 do
// resto do engine: agir sem identidade provada é pior que não agir); e remoção sem
// label aplicada não toca o engine (a adição que falhou não gera remoção à toa).
// O caminho com gh de verdade é best-effort por construção e não tem teste de
// rede, como fetchPrFiles e afins. O repoDoPr usado pela criação vem de
// review-signal.js e o teste dele mora em test/review-signal.test.js (não duplique).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { inProgressLabelFor, addInProgressLabel, removeInProgressLabel } = await import('../lib/engine/review.js');

test('inProgressLabelFor compõe "<conta>:revisando" e vazio sem conta', () => {
  assert.equal(inProgressLabelFor('thiagocarvalho-dev'), 'thiagocarvalho-dev:revisando');
  assert.equal(inProgressLabelFor('  x  '), 'x:revisando');
  assert.equal(inProgressLabelFor(''), '');
  assert.equal(inProgressLabelFor(null), '');
  assert.equal(inProgressLabelFor(undefined), '');
});

// engine mínimo que EXPLODE se o gh for alcançado: ghEnv é a última parada antes
// do io.run, então um guard furado vira falha alta aqui, não chamada de rede.
function engineQueNaoPodeRodarGh({ account, token }) {
  return {
    accountForPr: () => account,
    tokenFor: () => token,
    ghEnv: () => { throw new Error('ghEnv não podia ser alcançado neste teste'); },
    log: () => { throw new Error('log não podia ser alcançado neste teste'); },
  };
}

test('addInProgressLabel sem conta resolvida não roda gh e devolve vazio', async () => {
  const e = engineQueNaoPodeRodarGh({ account: '', token: 'tok' });
  const label = await addInProgressLabel(e, { key: 'o/r#1', url: 'https://github.com/o/r/pull/1' });
  assert.equal(label, '');
});

test('addInProgressLabel sem token da conta não roda gh e devolve vazio', async () => {
  const e = engineQueNaoPodeRodarGh({ account: 'thiagocarvalho-dev', token: null });
  const label = await addInProgressLabel(e, { key: 'o/r#1', url: 'https://github.com/o/r/pull/1' });
  assert.equal(label, '');
});

test('addInProgressLabel sem url do PR não roda gh e devolve vazio', async () => {
  const e = engineQueNaoPodeRodarGh({ account: 'thiagocarvalho-dev', token: 'tok' });
  const label = await addInProgressLabel(e, { key: 'o/r#1', url: '' });
  assert.equal(label, '');
});

// engine mínimo pro caminho com runner injetado: o gh nunca é alcançado de
// verdade, quem responde é o fake, que grava a sequência de comandos.
function engineComGh() {
  return {
    accountForPr: () => 'thiagocarvalho-dev',
    tokenFor: () => 'tok',
    ghEnv: () => ({ GH_TOKEN: 'tok' }),
    log: () => {},
  };
}
const PR = { key: 'o/r#1', url: 'https://github.com/o/r/pull/1', repo: 'o/r' };

test('adição que funciona de primeira não cria label nenhuma', async () => {
  const chamadas = [];
  const run = async (cmd, args) => { chamadas.push(args.slice(0, 2).join(' ')); return { ok: true }; };
  const label = await addInProgressLabel(engineComGh(), PR, run);
  assert.equal(label, 'thiagocarvalho-dev:revisando');
  assert.deepEqual(chamadas, ['pr edit']);
});

test('label inexistente é criada no repo e a adição é retentada uma vez', async () => {
  const chamadas = [];
  const run = async (cmd, args) => {
    chamadas.push(args);
    // 1ª adição falha (label não existe), criação ok, 2ª adição ok
    if (args[0] === 'pr' && chamadas.filter(c => c[0] === 'pr').length === 1) return { ok: false, stderr: "'thiagocarvalho-dev:revisando' not found" };
    return { ok: true };
  };
  const label = await addInProgressLabel(engineComGh(), PR, run);
  assert.equal(label, 'thiagocarvalho-dev:revisando');
  assert.deepEqual(chamadas.map(c => c.slice(0, 2).join(' ')), ['pr edit', 'label create', 'pr edit']);
  const create = chamadas[1];
  assert.equal(create[2], 'thiagocarvalho-dev:revisando');
  assert.equal(create[create.indexOf('--repo') + 1], 'o/r');
  // a descrição não pode citar o Farol nem automação (autor não sabe que é bot)
  const desc = create[create.indexOf('--description') + 1];
  assert.doesNotMatch(desc, /farol|autom|bot/i);
});

test('criação que falha devolve vazio sem terceira tentativa', async () => {
  const chamadas = [];
  const run = async (cmd, args) => { chamadas.push(args.slice(0, 2).join(' ')); return { ok: false, stderr: 'boom' }; };
  const label = await addInProgressLabel(engineComGh(), PR, run);
  assert.equal(label, '');
  assert.deepEqual(chamadas, ['pr edit', 'label create']);
});

test('retentativa que falha depois da criação devolve vazio (best-effort)', async () => {
  const chamadas = [];
  const run = async (cmd, args) => {
    chamadas.push(args.slice(0, 2).join(' '));
    return { ok: args[0] === 'label' };
  };
  const label = await addInProgressLabel(engineComGh(), PR, run);
  assert.equal(label, '');
  assert.deepEqual(chamadas, ['pr edit', 'label create', 'pr edit']);
});

test('PR sem repo resolvível não tenta criar label', async () => {
  const chamadas = [];
  const run = async (cmd, args) => { chamadas.push(args.slice(0, 2).join(' ')); return { ok: false }; };
  const label = await addInProgressLabel(engineComGh(), { key: 'estranho', url: 'https://github.com/o/r/pull/1' }, run);
  assert.equal(label, '');
  assert.deepEqual(chamadas, ['pr edit']);
});

test('removeInProgressLabel sem label aplicada é no-op (não toca o engine)', async () => {
  const e = engineQueNaoPodeRodarGh({ account: 'thiagocarvalho-dev', token: 'tok' });
  await removeInProgressLabel(e, { key: 'o/r#1', url: 'https://github.com/o/r/pull/1' }, '');
});

test('falha na remoção nunca sobe: vira WARN no log', async () => {
  const logs = [];
  const e = {
    accountForPr: () => 'thiagocarvalho-dev',
    // ghEnv explode simulando o token sumindo entre a adição e a remoção (flake do
    // keyring): a remoção não pode derrubar o finally da revisão por causa disso.
    ghEnv: () => { throw new Error('conta sem token no gh'); },
    log: (level, msg) => logs.push({ level, msg }),
  };
  await removeInProgressLabel(e, { key: 'o/r#1', url: 'https://github.com/o/r/pull/1' }, 'thiagocarvalho-dev:revisando');
  assert.equal(logs.length, 1);
  assert.equal(logs[0].level, 'WARN');
  assert.match(logs[0].msg, /thiagocarvalho-dev:revisando/);
  assert.match(logs[0].msg, /o\/r#1/);
});
