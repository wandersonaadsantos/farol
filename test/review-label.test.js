// Label de revisão em andamento (pedido do Thiago, 18/08/2026): quando a revisão
// headless de um PR começa, o PR ganha a label "<conta>:in-progress" no GitHub e a
// perde quando a sessão termina. O contrato aqui é o dos GUARDAS, que são o que dá
// pra provar sem rede: a composição do nome é pura; sem conta ou sem token o gh
// NUNCA é chamado (mesma raiz A1 do resto do engine: agir sem identidade provada é
// pior que não agir); e remoção sem label aplicada não toca o engine (a adição que
// falhou, inclusive porque a label não existe no repo, não gera remoção à toa).
// O caminho feliz (gh de verdade) é best-effort por construção e não tem teste de
// rede, como fetchPrFiles e afins.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { inProgressLabelFor, addInProgressLabel, removeInProgressLabel } = await import('../lib/engine/review.js');

test('inProgressLabelFor compõe "<conta>:in-progress" e vazio sem conta', () => {
  assert.equal(inProgressLabelFor('thiagocarvalho-dev'), 'thiagocarvalho-dev:in-progress');
  assert.equal(inProgressLabelFor('  x  '), 'x:in-progress');
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
  await removeInProgressLabel(e, { key: 'o/r#1', url: 'https://github.com/o/r/pull/1' }, 'thiagocarvalho-dev:in-progress');
  assert.equal(logs.length, 1);
  assert.equal(logs[0].level, 'WARN');
  assert.match(logs[0].msg, /thiagocarvalho-dev:in-progress/);
  assert.match(logs[0].msg, /o\/r#1/);
});
