// O repositório das avaliações técnicas é do alvo, gravado pelo motor (21/11/2026).
//
// Num PR real de 21/11/2026 a sessão devolveu as avaliações de julgamento com repositoryId
// igual ao id numérico do GitHub. A ferramenta exige texto e só aproveita a avaliação cujo
// repositoryId é igual ao do alvo (o nome dono/repo que o motor passa em runAudit). Ela recusou
// todas por formato, e o relatório virou "execução não concluída", perdendo até a violação de
// supressão que a primeira auditoria já tinha confirmado: a tela mostrava a falha de execução ao
// lado do achado bloqueante. O motor passa a gravar o repositório do alvo em toda avaliação.
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { comRepositorioDoAlvo } = await import('../lib/technical-review/worker.js');
const { technicalPrompt } = await import('../lib/technical-review/prompt.js');

test('o id numérico do GitHub vira o nome do alvo', () => {
  const [a] = comRepositorioDoAlvo([{ repositoryId: 1316206139, rule: 'core.x', verdict: 'conforme' }], 'org/repo-real');
  assert.equal(a.repositoryId, 'org/repo-real');
  assert.equal(a.rule, 'core.x');
  assert.equal(a.verdict, 'conforme');
});

test('avaliação sem repositoryId, ou com outro nome, recebe o do alvo', () => {
  const saida = comRepositorioDoAlvo([{ rule: 'a' }, { repositoryId: 'outro/repo', rule: 'b' }], 'org/repo');
  assert.deepEqual(saida.map(a => a.repositoryId), ['org/repo', 'org/repo']);
});

test('entrada que não é objeto segue como veio, para a ferramenta recusar com o motivo dela', () => {
  assert.deepEqual(comRepositorioDoAlvo([null, 'texto', [1]], 'org/repo'), [null, 'texto', [1]]);
  assert.deepEqual(comRepositorioDoAlvo(undefined, 'org/repo'), []);
});

test('a avaliação original não é alterada', () => {
  const original = { repositoryId: 7, rule: 'a' };
  comRepositorioDoAlvo([original], 'org/repo');
  assert.equal(original.repositoryId, 7);
});

test('o prompt diz que o repositoryId é o nome do alvo, nunca o id numérico', () => {
  const p = technicalPrompt({ repo: 'org/repo', base: 'b'.repeat(40), head: 'a'.repeat(40), toolHome: '/f', snapshot: '/m',
    profile: {}, objections: [], initial: { rules: [], findings: [], excerpt: '', changeSet: {} } });
  assert.match(p, /repositoryId é o texto "org\/repo"/);
  assert.match(p, /nunca o id numérico do GitHub/);
});
