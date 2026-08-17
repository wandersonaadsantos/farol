// Lições de reviews reais precisam EXISTIR no protocolo semeado. Origem medida:
// 12 achados de um PR real verificados um a um (8 corretos, 3 parciais, 1 com fato
// desatualizado) deram os 4 erros de precisão do agente; 2 pushbacks confirmados
// (autor tinha razão) deram as regras de calibração do CLAUDE.md. O prepareHome
// re-sincroniza o workspace a cada boot a partir destes arquivos, então perder uma
// frase aqui é perder a lição em TODA cópia instalada no próximo update.
import path from 'node:path';
import fs from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATE_DIR } from '../lib/paths.js';

const agente = fs.readFileSync(path.join(TEMPLATE_DIR, '.claude', 'agents', 'pr-reviewer.md'), 'utf8');
const protocolo = fs.readFileSync(path.join(TEMPLATE_DIR, 'CLAUDE.md'), 'utf8');

test('agente pr-reviewer carrega as 4 lições de precisão do achado', () => {
  assert.match(agente, /## Precisão do achado/, 'a seção existe');
  assert.match(agente, /Estado final, não intermediário/, 'lição 1: diff acumulado, não commit isolado');
  assert.match(agente, /Remédio afirmado exige contra-exemplo/, 'lição 2: remédio vem com o que NÃO cobre');
  assert.match(agente, /Raio real do buraco/, 'lição 3: escopo medido, não generalizado');
  assert.match(agente, /Gate configurado não é doutrina do time/, 'lição 4: required check real vs disciplina');
});

test('agente pr-reviewer lista os anti-padrões espelho das lições', () => {
  assert.match(agente, /padrão JÁ existente e aceito no repo/, 'padrão do repo não vira blocker');
  assert.match(agente, /fora do diff, vira 🟡 no máximo/, 'exigência de processo não bloqueia');
});

test('protocolo do workspace carrega as calibrações vindas de pushback confirmado', () => {
  assert.match(protocolo, /mesma causa raiz e distingui-los não mudaria o tratamento/, 'idioma deliberado: throw dentro do try');
  assert.match(protocolo, /Padrão existente do repo e exigência fora do diff/, 'item 10 existe');
  assert.match(protocolo, /nunca condição de aprovação/, 'processo fora do diff não condiciona approve');
});
