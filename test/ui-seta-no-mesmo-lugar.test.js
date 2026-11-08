// Quem abre é quem fecha, no mesmo lugar (08/11/2026, pedido do dono: clicar para expandir e ter
// de clicar em outra região para recolher não é intuitivo). A posição foi medida no navegador, em
// Pra mim, Meus PRs e Panorama (mesmo x e y aberta e fechada); aqui ficam travadas as peças dela.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const RAIZ = path.join(import.meta.dirname, '..');
const css = fs.readFileSync(path.join(RAIZ, 'ui/app.css'), 'utf8');
const prontidao = fs.readFileSync(path.join(RAIZ, 'ui/telas/prontidao.js'), 'utf8');

test('no card aberto, a seta fica no canto da seta da linha compacta', () => {
  assert.match(css, /\.pr-linha \{[^}]*min-height: 48px; padding: 8px 10px 8px 14px/, 'a linha que define o canto');
  assert.match(css, /\.card \.pron-seta\[aria-expanded="true"\] \{ position: absolute; top: 8px; right: 10px; \}/);
  assert.match(css, /\.card:has\(\.pron-seta\[aria-expanded="true"\]\) \{ position: relative; \}/);
});

test('o conteúdo do card aberto não fica embaixo da seta', () => {
  assert.match(css, /\.decision-head,\n\.card\.mypr-card:has\([^)]*\) \.pr-actions,\n\.card\.pr-card:has\([^)]*\) \.pr-actions \{ padding-right: 38px; \}/);
  assert.match(css, /@media \(max-width: 820px\) \{\n  \.card\.pr-card:has\([^)]*\) \.pr-actions \{ padding-right: 0; \}\n  \.card\.pr-card:has\([^)]*\) \.info \{ padding-right: 38px; \}/, 'ações em linha própria: reserva no título');
});

test('na tela estreita a seta fechada também fica no canto', () => {
  assert.match(css, /\.pr-linha \.pron-seta \{ position: absolute; top: 7px; right: 10px; \}/);
});

test('o card da fila de execução recolhe pela mesma seta', () => {
  const telaRadar = fs.readFileSync(path.join(RAIZ, 'ui/telas/radar.js'), 'utf8');
  const radar = fs.readFileSync(path.join(RAIZ, 'ui/pure/radar.js'), 'utf8');
  assert.match(telaRadar, /queueWaitingCardHtml\(pr, \{ \.\.\.ctx, pronLado: setaDoCard\(pr\.key\) \}\)/);
  assert.match(radar, /Abrir PR ↗<\/a>\$\{ctx\.pronLado \|\| ''\}/);
});

test('no cartão da sessão, a seta aberta fica na mesma linha da fechada', () => {
  assert.match(prontidao, /<div class="sess-pron-aberta">\$\{faixaDe\(key\)\}\$\{setaDoCard\(key\)\}<\/div>/);
  assert.match(css, /\.sess-pron-aberta \{ display: flex; align-items: flex-start; gap: 8px; margin: 6px 0 2px; \}/);
  assert.match(css, /\.sess-pron-curta \{[^}]*margin: 6px 0 2px; \}/, 'as duas com a mesma margem');
  assert.match(css, /\.card \.sess-pron-aberta \.pron-seta\[aria-expanded="true"\] \{ position: static; \}/);
});

test('no Panorama aberto, o lugar dos pontos fica reservado, só na Compacta', () => {
  assert.match(prontidao, /ehCompacta\(\) \? `<span class="pron-pontos-reserva" aria-hidden="true">/);
  assert.match(css, /\.pron-pontos-reserva \{ display: contents; \}/);
  assert.match(css, /\.pron-pontos-reserva > \* \{ visibility: hidden; \}/);
});
