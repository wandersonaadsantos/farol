// A revisão automática só começa com 100% dos checks OBRIGATÓRIOS verdes.
//
// PEDIDO DO GUILHERME (31/08/2026), com dois desperdícios medidos por ele em campo:
// (1) o Farol começa a revisar, alguém clica em "Update branch", entra commit novo e a
// sessão inteira vira lixo; (2) o Farol aprova e a pipe quebra depois, e o ciclo de
// correção custa outra revisão. Decisão do Wanderson: a régua é 100% dos obrigatórios
// verdes, e quem tem pressa continua tendo o botão Revisar, que atravessa sem esperar.
//
// OBRIGATÓRIOS, e não todos: o `sonar` do engine-ai é cronicamente vermelho e não é
// exigido. Exigir tudo verde nunca revisaria aquele repositório.
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { checksExigidosVerdes, textoDosChecks } = await import('../lib/engine/checks-exigidos.js');

const run = (name, conclusion, over = {}) => ({
  name, conclusion, status: 'COMPLETED', startedAt: '2026-08-31T10:00:00Z', ...over,
});

test('todos os obrigatórios verdes libera', () => {
  const rollup = [run('lint', 'SUCCESS'), run('test', 'SUCCESS'), run('sonar', 'FAILURE')];
  const r = checksExigidosVerdes(rollup, ['lint', 'test']);
  assert.equal(r.pronto, true, 'o sonar e vermelho e nao e exigido: nao segura');
  assert.deepEqual(r.faltando, []);
});

test('obrigatório vermelho segura, e diz qual', () => {
  const r = checksExigidosVerdes([run('lint', 'SUCCESS'), run('test', 'FAILURE')], ['lint', 'test']);
  assert.equal(r.pronto, false);
  assert.deepEqual(r.faltando, [{ nome: 'test', estado: 'vermelho' }]);
});

test('obrigatório ainda rodando segura', () => {
  const rollup = [run('lint', null, { status: 'IN_PROGRESS', conclusion: null })];
  const r = checksExigidosVerdes(rollup, ['lint']);
  assert.deepEqual(r.faltando, [{ nome: 'lint', estado: 'rodando' }]);
});

test('obrigatório que nem começou segura: é o caso do Update branch', () => {
  const r = checksExigidosVerdes([run('lint', 'SUCCESS')], ['lint', 'build']);
  assert.deepEqual(r.faltando, [{ nome: 'build', estado: 'ausente' }]);
});

test('skipped e neutral contam como verde, igual ao GitHub', () => {
  const rollup = [run('lint', 'SKIPPED'), run('test', 'NEUTRAL')];
  assert.equal(checksExigidosVerdes(rollup, ['lint', 'test']).pronto, true);
});

/* ---------- o mesmo check aparece mais de uma vez, e isso é o caso comum ---------- */
// Medido no biud-frontend#860: `deploy` aparece DUAS vezes no rollup, FAILURE de 28/08
// e SUCCESS de 31/08, porque o job foi relançado. Contar as duas manteria o PR travado
// para sempre por uma falha que já foi corrigida.

test('rodada mais recente vence a antiga do mesmo check', () => {
  const rollup = [
    run('deploy', 'FAILURE', { startedAt: '2026-08-28T02:35:32Z' }),
    run('deploy', 'SUCCESS', { startedAt: '2026-08-31T13:29:55Z' }),
  ];
  assert.equal(checksExigidosVerdes(rollup, ['deploy']).pronto, true);
});

test('e o contrário também: verde velho não salva vermelho novo', () => {
  const rollup = [
    run('deploy', 'SUCCESS', { startedAt: '2026-08-28T02:35:32Z' }),
    run('deploy', 'FAILURE', { startedAt: '2026-08-31T13:29:55Z' }),
  ];
  assert.deepEqual(checksExigidosVerdes(rollup, ['deploy']).faltando, [{ nome: 'deploy', estado: 'vermelho' }]);
});

test('sem horário, a última entrada da lista vale (ordem do gh)', () => {
  const rollup = [
    run('deploy', 'FAILURE', { startedAt: null }),
    run('deploy', 'SUCCESS', { startedAt: null }),
  ];
  assert.equal(checksExigidosVerdes(rollup, ['deploy']).pronto, true);
});

/* ---------- falta de dado NUNCA segura ---------- */

test('repositório sem check obrigatório revisa na hora, como sempre', () => {
  assert.equal(checksExigidosVerdes([], []).pronto, true);
  assert.equal(checksExigidosVerdes(null, null).pronto, true);
});

test('rollup ilegível com exigência conhecida não bloqueia: sem prova, não segura', () => {
  assert.equal(checksExigidosVerdes(null, ['lint']).pronto, true);
});

test('check de status legado (context em vez de name) é entendido', () => {
  const rollup = [{ context: 'ci/legado', state: 'SUCCESS' }];
  assert.equal(checksExigidosVerdes(rollup, ['ci/legado']).pronto, true);
  const vermelho = [{ context: 'ci/legado', state: 'FAILURE' }];
  assert.deepEqual(checksExigidosVerdes(vermelho, ['ci/legado']).faltando, [{ nome: 'ci/legado', estado: 'vermelho' }]);
});

/* ---------- fiação: o gate entra na boca única do lançamento automático ---------- */
const skip = (await import('../lib/engine/skip-review.js')).default;

const LIVRE = { bloqueado: false, head: 'sha', quem: [], decisivos: [] };
const PR = { key: 'o/r#1', repo: 'o/r', number: 1, url: 'https://github.com/o/r/pull/1' };

function engineFalso(extra = {}) {
  return {
    toasts: [],
    emit(_, p) { this.toasts.push(p); },
    bloqueadoPorHistorico: async () => LIVRE,
    bloqueadoPorChecks: async () => ({ bloqueado: false, faltando: [] }),
    ...extra,
  };
}

test('obrigatório faltando segura o automático e avisa que o botão vale', async () => {
  const e = engineFalso({ bloqueadoPorChecks: async () => ({ bloqueado: true, faltando: [{ nome: 'test', estado: 'rodando' }] }) });
  assert.equal(await skip.bloqueiaAutomatico(e, { ...PR }), true);
  assert.match(e.toasts[0].text, /esperando os checks obrigatórios/);
  assert.match(e.toasts[0].text, /test \(ainda rodando\)/);
  assert.match(e.toasts[0].text, /botão Revisar continua valendo/);
});

test('clique manual atravessa sem consultar nada: é a saída de quem tem pressa', async () => {
  const e = engineFalso({
    bloqueadoPorHistorico: async () => { throw new Error('clique não podia consultar histórico'); },
    bloqueadoPorChecks: async () => { throw new Error('clique não podia consultar checks'); },
  });
  assert.equal(await skip.bloqueiaAutomatico(e, { ...PR, manual: true }), false);
});

test('checks verdes deixam passar', async () => {
  const e = engineFalso();
  assert.equal(await skip.bloqueiaAutomatico(e, { ...PR }), false);
  assert.equal(e.toasts.length, 0);
});

test('histórico decisivo continua vencendo, e nem chega a olhar os checks', async () => {
  const e = engineFalso({
    bloqueadoPorHistorico: async () => ({ bloqueado: true, head: 'sha', quem: ['ana'], decisivos: [{ quem: 'ana', state: 'APPROVED' }] }),
    bloqueadoPorChecks: async () => { throw new Error('não devia consultar checks com o histórico já segurando'); },
  });
  assert.equal(await skip.bloqueiaAutomatico(e, { ...PR }), true);
});

test('o aviso não se repete no mesmo estado, e volta quando a pipe anda', async () => {
  let faltando = [{ nome: 'test', estado: 'rodando' }];
  const e = engineFalso({ bloqueadoPorChecks: async () => ({ bloqueado: true, faltando }) });
  await skip.bloqueiaAutomatico(e, { ...PR });
  await skip.bloqueiaAutomatico(e, { ...PR });
  assert.equal(e.toasts.length, 1, 'mesmo estado não repete o toast a cada ciclo');
  faltando = [{ nome: 'build', estado: 'vermelho' }];
  await skip.bloqueiaAutomatico(e, { ...PR });
  assert.equal(e.toasts.length, 2, 'o que falta mudou: é informação nova, não repetição');
});

test('a lista do aviso é cortada, pra o toast não virar parede', () => {
  const muitos = ['a', 'b', 'c', 'd', 'e'].map(nome => ({ nome, estado: 'rodando' }));
  const t = textoDosChecks('o/r#1', muitos);
  assert.match(t, /e mais 2/);
  assert.equal(textoDosChecks('o/r#1', []), '');
});
