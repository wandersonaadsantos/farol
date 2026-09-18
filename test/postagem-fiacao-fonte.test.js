// As cinco vias de postagem se identificam ao funil (CT-POST, tabela "As vias com o controle
// comum"). Nenhuma via é declarada coberta sem esta trava e o teste de comportamento dela.
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const RAIZ = path.join(import.meta.dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

test('revisão automática: as duas postagens passam via revisao com o handle e lançam perda de coordenação', () => {
  const fonte = ler('lib/engine/review.js');
  // as retentativas passageiras (postarComRetentativas) reconferem o lease antes de cada nova tentativa
  assert.equal((fonte.match(/\{ via: 'revisao', handle: coord \}\),\n\s+\{ antes: \(\) => pararSeLeasePerdido\(coord\) \}\);\n\s+lancarSePossePerdida\(post\);/g) || []).length, 2);
});

test('reenvio, clique e sessão se identificam', () => {
  const fonte = ler('lib/engine/decision.js');
  for (const via of ['reenvio', 'clique', 'sessao']) assert.ok(fonte.includes(`{ via: '${via}' }`), `via ${via}`);
});

test('co-assinatura coordenada: âncora obrigatória e recuo proibido', () => {
  const fonte = ler('lib/engine/coassinatura-coordenada.js');
  assert.ok(fonte.includes("{ via: 'coassinatura', handle, commitIdObrigatorio: head, recuoPermitido: false }"));
});

test('nenhuma outra chamada a postReview em lib/ fora das vias conhecidas', () => {
  const conhecidas = new Map([
    ['lib/engine/review.js', 2], ['lib/engine/decision.js', 3], ['lib/engine/skip-review.js', 1], ['lib/engine/coassinatura-coordenada.js', 1],
  ]);
  const dir = path.join(RAIZ, 'lib', 'engine');
  for (const nome of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const rel = `lib/engine/${nome}`;
    const achadas = (ler(rel).match(/engine\.postReview\(/g) || []).length;
    assert.equal(achadas, conhecidas.get(rel) || 0, rel);
  }
});
