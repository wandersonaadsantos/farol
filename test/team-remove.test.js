// Remoção de membro do Time (removeTeamMember, lib/engine/decision.js). Os
// contratos que importam: (1) o login vira nome de arquivo, então formato fora
// do login do GitHub é RECUSADO antes de montar caminho (traversal morre na
// allowlist); (2) a remoção é da PESSOA inteira (dossiê + destaques + perfil +
// pushbacks), mas SÓ dela: linha de destaque de outra pessoa fica intocada;
// (3) idempotente: remover quem não tem nada devolve ok sem inventar erro.
import os from 'node:os';
import path from 'node:path';
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-teamrm-' + process.pid);

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { Engine } = await import('../server.js');
const { STATE_DIR } = await import('../lib/paths.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { } });

function seed() {
  const dir = path.join(STATE_DIR, 'authors');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'fulano.md'), '# fulano (Fulano Silva)\n\n## 2026-06-01 · acme/app#1 · APPROVE\n- ganho: x\n');
  fs.writeFileSync(path.join(dir, 'beltrana.md'), '# beltrana\n\n## 2026-06-02 · acme/app#2 · APPROVE\n- ganho: y\n');
  fs.writeFileSync(path.join(STATE_DIR, 'highlights.md'),
    '# Destaques\n\n- 2026-06-01 · @fulano · [acme/app#1](https://github.com/acme/app/pull/1) — mandou bem\n'
    + '- 2026-06-02 · @beltrana · [acme/app#2](https://github.com/acme/app/pull/2) — também\n'
    + '- 2026-06-03 · @Fulano · [acme/app#3](https://github.com/acme/app/pull/3) — caixa diferente, mesma pessoa\n');
  const e = new Engine();
  e.config.people = { fulano: { papel: 'senior' }, beltrana: { papel: 'pleno' } };
  e.pushbacks = {
    'acme/app#1': { author: 'fulano', outcome: 'we_right', at: 'x', source: 'manual', status: 'confirmed' },
    'acme/app#2': { author: 'beltrana', outcome: 'mixed', at: 'y', source: 'manual', status: 'confirmed' },
  };
  e.pushState = () => {};
  return e;
}

test('remove a pessoa inteira e SÓ ela: dossiê, destaques (caso-insensível), perfil e pushbacks', () => {
  const e = seed();
  const r = e.removeTeamMember('fulano');
  assert.deepEqual(r, { ok: true, removed: true });
  assert.ok(!fs.existsSync(path.join(STATE_DIR, 'authors', 'fulano.md')), 'dossiê da pessoa saiu');
  assert.ok(fs.existsSync(path.join(STATE_DIR, 'authors', 'beltrana.md')), 'dossiê de outra pessoa fica');
  const hl = fs.readFileSync(path.join(STATE_DIR, 'highlights.md'), 'utf8');
  assert.doesNotMatch(hl, /fulano/i, 'destaques da pessoa saíram, inclusive com caixa diferente');
  assert.match(hl, /beltrana/, 'destaque de outra pessoa fica');
  assert.match(hl, /# Destaques/, 'cabeçalho do arquivo fica');
  assert.equal(e.config.people.fulano, undefined, 'perfil configurado saiu');
  assert.ok(e.config.people.beltrana, 'perfil de outra pessoa fica');
  assert.equal(e.pushbacks['acme/app#1'], undefined, 'pushback da pessoa saiu');
  assert.ok(e.pushbacks['acme/app#2'], 'pushback de outra pessoa fica');
});

test('login fora do formato do GitHub é recusado antes de tocar arquivo (traversal morre aqui)', () => {
  const e = seed();
  for (const ruim of ['../beltrana', 'a/b', 'a\\b', '.', '..', '', '  ', 'a'.repeat(40), '-comeca', 'termina-', 'com espaco']) {
    const r = e.removeTeamMember(ruim);
    assert.equal(r.ok, false, `aceitou login inválido: ${JSON.stringify(ruim)}`);
  }
  assert.ok(fs.existsSync(path.join(STATE_DIR, 'authors', 'beltrana.md')), 'nenhum arquivo foi tocado');
});

test('remover quem não tem nada é ok (idempotente), com removed=false pra UI distinguir', () => {
  const e = seed();
  const r = e.removeTeamMember('ninguem');
  assert.equal(r.ok, true, 'ausência não é erro');
  assert.equal(r.removed, false, 'mas diz que nada foi apagado');
});
