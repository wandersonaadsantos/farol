// As cinco vias de postagem se identificam ao funil (CT-POST, tabela "As vias com o controle
// comum"). Nenhuma via é declarada coberta sem esta trava e o teste de comportamento dela.
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const RAIZ = path.join(import.meta.dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

// Desde 18/10/2026 o desfecho mora em desfecho-da-revisao.js, com UMA boca de postagem
// (postarReconstruindo) para o APPROVE, o REQUEST_CHANGES e os caminhos da decisão sem mesa.
test('revisão automática: toda postagem passa via revisao com o handle e lança perda de coordenação', () => {
  const fonte = ler('lib/engine/desfecho-da-revisao.js');
  // as retentativas passageiras (postarComRetentativas) reconferem o lease antes de cada nova tentativa
  assert.equal((fonte.match(/\{ via: 'revisao', handle: coord \}\),\n\s+\{ antes: \(\) => pararSeLeasePerdido\(coord\) \}\);/g) || []).length, 1);
  const chamadas = (fonte.match(/await postarReconstruindo\(engine, ctx, /g) || []).length;
  assert.equal(chamadas, 3, 'approve, request_changes da sessão e os caminhos novos');
  assert.equal((fonte.match(/await postarReconstruindo\(engine, ctx, [^\n]+\n\s+lancarSePossePerdida\(post\);/g) || []).length, chamadas,
    'cada postagem confere a posse logo depois');
});

test('reenvio, clique e sessão se identificam', () => {
  const fonte = ler('lib/engine/decision.js');
  for (const via of ['reenvio', 'clique', 'sessao']) assert.ok(fonte.includes(`{ via: '${via}' }`), `via ${via}`);
});

// 30/09/2026: sexta via. A aprovação que esperava o CI posta quando ele fecha verde, sem
// handle de lease (como o reenvio) e ancorada no head que a sessão leu.
test('espera do CI se identifica e ancora no head lido', () => {
  const fonte = ler('lib/engine/espera-ci.js');
  assert.ok(fonte.includes('postarReconstruindo(engine, pr, { ...item.payloads.approve, commit_id: item.headSha })'));
  assert.ok(fonte.includes("engine.postReview(pr, payload, { via: 'espera-ci' })"));
  assert.ok(fonte.includes("engine.postReview(pr, novo, { via: 'espera-ci' })"), 'a reconstrução usa a mesma via');
});

test('co-assinatura coordenada: âncora obrigatória e recuo proibido', () => {
  const fonte = ler('lib/engine/coassinatura-coordenada.js');
  assert.ok(fonte.includes("{ via: 'coassinatura', handle, commitIdObrigatorio: head, recuoPermitido: false }"));
});

test('nenhuma outra chamada a postReview em lib/ fora das vias conhecidas', () => {
  const conhecidas = new Map([
    ['lib/engine/desfecho-da-revisao.js', 1], ['lib/engine/decision.js', 3], ['lib/engine/skip-review.js', 1], ['lib/engine/coassinatura-coordenada.js', 1],
    ['lib/engine/espera-ci.js', 2], ['lib/engine/espera-pr-proprio.js', 1],
  ]);
  const dir = path.join(RAIZ, 'lib', 'engine');
  for (const nome of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const rel = `lib/engine/${nome}`;
    const achadas = (ler(rel).match(/engine\.postReview\(/g) || []).length;
    assert.equal(achadas, conhecidas.get(rel) || 0, rel);
  }
});
