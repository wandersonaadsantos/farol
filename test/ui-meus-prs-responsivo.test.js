// O título do card de Meus PRs chegou a 15 px com a janela em 820 px (09/11/2026): as peças da
// linha têm de ceder largura ao título, e a medição real foi feita no Electron. Aqui fica a regra.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const css = fs.readFileSync(path.join(import.meta.dirname, '..', 'ui/app.css'), 'utf8');

test('o título tem base própria, para os botões descerem quando não couberem ao lado', () => {
  assert.match(css, /\.mypr-top \.info \{ flex: 1 1 320px; min-width: 0; \}/);
  assert.match(css, /\.mypr-top \.pr-actions \{ flex: 0 1 auto; max-width: 100%; \}/);
  assert.match(css, /^\.section-head, \.row-actions, \.deliv-controls, \.mypr-top,[^{]*\{ flex-wrap: wrap; \}/m, 'sem wrap as ações não descem');
});

test('o título reserva o lugar da seta em qualquer largura', () => {
  assert.match(css, /^\.card\.mypr-card:has\(\.pron-seta\[aria-expanded="true"\]\) \.info \{ padding-right: 38px; \}/m);
});

test('na janela estreita, as faixas ficam em linha própria, abaixo das ações', () => {
  const estreita = css.match(/@media \(max-width: 720px\) \{\n  \/\* o aviso sobe[\s\S]*?\n\}/)[0];
  assert.match(estreita, /\.mypr-card \.pr-actions \{ order: 3;/);
  assert.match(estreita, /\.mypr-card \.pron-bloco, \.mypr-card \.aa-faixa \{ order: 3; flex: 1 1 100%; min-width: 0; \}/);
});
