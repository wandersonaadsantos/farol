// Vazio e 0 são coisas opostas no teto, e a tela tem que dizer isso antes de salvar.
// Vazio é sem teto; 0 é teto de verdade, que pausa a revisão automática do perfil. Em
// 23/10/2026 o dono pôs 0 no perfil de trabalho querendo tirar o limite, e as revisões
// pararam com "o orçamento estourou" sem que nada na tela avisasse a diferença.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { budgetEditorHtml } from '../ui/pure/contas.js';

const perfil = { id: 'p1', label: 'Trabalho', dir: '/tmp/p1' };

test('os campos de teto dizem que vazio é sem teto', () => {
  const html = budgetEditorHtml(perfil, null);
  assert.match(html, /placeholder="Teto por dia \(US\$, vazio = sem teto\)"/);
  assert.match(html, /placeholder="Teto total \(US\$, vazio = sem teto\)"/);
});

test('a tela explica que 0 pausa a revisão automática', () => {
  const html = budgetEditorHtml(perfil, null);
  assert.match(html, /0 pausa a revisão automática deste perfil/);
  assert.match(html, /clique manual continua valendo/);
});

test('com teto 0 valendo hoje, a linha do gasto diz que está pausado', () => {
  const html = budgetEditorHtml({ ...perfil, budgetDaily: 0 }, { today: 3, capHoje: 0, capOrigem: 'base' });
  assert.match(html, /teto 0: revisão automática pausada/);
});

test('sem teto, a linha do gasto segue dizendo sem teto', () => {
  const html = budgetEditorHtml(perfil, { today: 3, capHoje: null });
  assert.match(html, /\(sem teto\)/);
  assert.doesNotMatch(html, /pausada/);
});
