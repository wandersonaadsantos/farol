// Os avisos nativos prontos (lib/engine/avisos-nativos.js): o motor que roda como sidecar das
// cascas nativas entrega pelo SSE o título, o corpo e o destino de cada notificação, o
// contador do Dock e as cores da janela. Os textos são os do main.js, e os casos deste arquivo
// viram test/fixtures/casca/eventos.json, o contrato de paridade das duas cascas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { avisoDe, badgeDe, cascaDe } from '../lib/engine/avisos-nativos.js';
import { parseJson } from '../lib/io.js';

const ID = 'a'.repeat(64);
// A hora do caso é a do relógio LOCAL (é assim que o quietNow lê), e vai na fixture como
// texto, nunca como epoch: o epoch de "meio-dia" muda com o fuso de quem roda o teste.
const HORA = '12:00';
function agoraDe(hora) {
  const [h, m] = hora.split(':').map(Number);
  return new Date(2026, 9, 28, h, m).getTime();
}
const SILENCIO = { voiceQuietEnabled: true, voiceQuietStart: '11:00', voiceQuietEnd: '13:00' };

const CASOS = [
  { nome: 'new-prs um na fila automática', evento: 'new-prs', payload: { items: [{ key: 'o/r#1', title: 'T', url: 'u' }], total: 1, auto: true }, config: {} },
  { nome: 'new-prs um pedindo revisão', evento: 'new-prs', payload: { items: [{ key: 'o/r#1', title: 'T', url: 'u' }], total: 1, auto: false }, config: {} },
  { nome: 'new-prs vários pedindo revisão', evento: 'new-prs', payload: { items: [{ key: 'o/r#1', title: 'A', url: 'u1' }, { key: 'o/r#2', title: 'B', url: 'u2' }], total: 2, auto: false }, config: {} },
  { nome: 'new-prs vários na fila automática', evento: 'new-prs', payload: { items: [{ key: 'o/r#1', title: 'A', url: 'u1' }, { key: 'o/r#2', title: 'B', url: 'u2' }], total: 2, auto: true }, config: {} },
  { nome: 'auto-approved sem ressalvas', evento: 'auto-approved', payload: { pr: { key: 'o/r#1', url: 'u' }, result: { card: 'CARD-1' }, points: [] }, config: {} },
  { nome: 'auto-approved sem card', evento: 'auto-approved', payload: { pr: { key: 'o/r#1', url: 'u' }, result: {} }, config: {} },
  { nome: 'auto-approved com 2 ressalvas', evento: 'auto-approved', payload: { pr: { key: 'o/r#1', url: 'u' }, result: {}, points: [{ text: 'cobertura parcial', kind: 'caveat' }, 'outra'] }, config: {} },
  { nome: 'auto-rejected com motivo', evento: 'auto-rejected', payload: { pr: { key: 'o/r#1', url: 'u' }, result: { reasons: [{ text: 'teste quebrado', kind: 'bloqueio' }] } }, config: {} },
  { nome: 'auto-rejected sem reasons', evento: 'auto-rejected', payload: { pr: { key: 'o/r#1', url: 'u' }, result: {} }, config: {} },
  { nome: 'auto-commented', evento: 'auto-commented', payload: { pr: { key: 'o/r#1', url: 'u' } }, config: {} },
  { nome: 'tool-done kudos', evento: 'tool-done', payload: { name: 'kudos', label: 'Kudos' }, config: {} },
  { nome: 'tool-done diagnóstico', evento: 'tool-done', payload: { name: 'pr-health', label: 'Diagnóstico do Farol' }, config: {} },
  { nome: 'intervention de PR fora do silêncio', evento: 'intervention', payload: { id: ID, kind: 'decision', title: 'Decisão', body: 'o/r#1 espera você', speech: 'fala', target: { type: 'pr', url: 'https://github.com/o/r/pull/1', account: 'eu' }, notifiedAt: 1 }, config: {} },
  { nome: 'intervention de sistema no silêncio', evento: 'intervention', payload: { id: ID, kind: 'access', title: 'Acesso', body: 'token', speech: 'fala', target: { type: 'system', section: 'accounts' }, notifiedAt: 1 }, config: SILENCIO },
  { nome: 'intervention inválida', evento: 'intervention', payload: { id: 'x' }, config: {} },
  { nome: 'meu-pr-base um PR', evento: 'meu-pr-base', payload: { titulo: 'PR em conflito', tituloSistema: 'PR em conflito', url: 'u1', corpo: 'o/r#1: em conflito com main. Atualize a branch antes do merge.', itens: [{ key: 'o/r#1', url: 'u1', texto: 't' }] }, config: {} },
  { nome: 'meu-pr-base agrupado', evento: 'meu-pr-base', payload: { titulo: '2 PRs seus', tituloSistema: '2 PRs precisam de você por causa da base', url: '', corpo: 'r#1 em conflito com main; r#2 superado pela base.', itens: [{ key: 'o/r#1', url: 'u1', texto: 'a' }, { key: 'o/r#2', url: 'u2', texto: 'b' }] }, config: {} },
  { nome: 'evento desconhecido', evento: 'state', payload: {}, config: {} },
].map(c => ({ ...c, hora: HORA }));

const caso = (nome) => CASOS.find(c => c.nome === nome);
const calcular = (c) => avisoDe(c.evento, c.payload, { config: c.config, agora: agoraDe(c.hora) });
const aviso = (nome) => calcular(caso(nome));

test('new-prs: um PR na fila automática', () => {
  assert.deepEqual(aviso('new-prs um na fila automática'), { titulo: 'Farol · PR novo, na fila da revisão automática', corpo: 'o/r#1: T', url: 'u', pr: 'o/r#1', silencioso: false });
  assert.equal(aviso('new-prs um pedindo revisão').titulo, 'Farol · PR aguardando sua revisão');
});

test('new-prs: vários PRs juntam as chaves com  ·  e não levam url', () => {
  assert.deepEqual(aviso('new-prs vários pedindo revisão'), { titulo: 'Farol · 2 PRs aguardando sua revisão', corpo: 'o/r#1  ·  o/r#2', url: null, pr: null, silencioso: false });
  assert.equal(aviso('new-prs vários na fila automática').titulo, 'Farol · 2 PRs novos, na fila da revisão automática');
});

test('auto-approved sem ressalvas', () => {
  assert.deepEqual(aviso('auto-approved sem ressalvas'), { titulo: 'Farol · aprovado sem ressalvas ✅', corpo: 'o/r#1 (CARD-1): revisão completa, nenhum ponto de atenção. APPROVE postado.', url: 'u', pr: 'o/r#1', silencioso: false });
  assert.equal(aviso('auto-approved sem card').corpo, 'o/r#1 (sem card): revisão completa, nenhum ponto de atenção. APPROVE postado.');
});

test('auto-approved com 2 ressalvas', () => {
  assert.deepEqual(aviso('auto-approved com 2 ressalvas'), { titulo: 'Farol · aprovado com ressalvas ⚠️', corpo: 'o/r#1: APPROVE postado. Ressalva: cobertura parcial (+1). Detalhes em Revisões recentes.', url: 'u', pr: 'o/r#1', silencioso: false });
});

test('auto-rejected: o primeiro motivo, ou ver relatório sem reasons', () => {
  assert.equal(aviso('auto-rejected com motivo').corpo, 'o/r#1: mudanças pedidas. Motivo: teste quebrado');
  assert.deepEqual(aviso('auto-rejected sem reasons'), { titulo: 'Farol · reprovado 🔴', corpo: 'o/r#1: mudanças pedidas. Motivo: ver relatório', url: 'u', pr: 'o/r#1', silencioso: false });
});

test('auto-commented', () => {
  assert.deepEqual(aviso('auto-commented'), { titulo: 'Farol · comentado 💬', corpo: 'o/r#1: o PR é da própria conta que revisa, então a revisão saiu como comentário.', url: 'u', pr: 'o/r#1', silencioso: false });
});

test('tool-done kudos e diagnóstico', () => {
  assert.deepEqual(aviso('tool-done kudos'), { titulo: 'Farol · Kudos', corpo: 'Kudos prontos pra copiar na aba Destaques.', url: null, pr: null, silencioso: false });
  assert.equal(aviso('tool-done diagnóstico').corpo, 'Relatório disponível na aba Sistema.');
});

test('intervention usa interventionEvent, silencioso = quietNow(config) e pr do alvo', () => {
  assert.deepEqual(aviso('intervention de PR fora do silêncio'), { titulo: 'Farol · Decisão', corpo: 'o/r#1 espera você', url: null, pr: 'o/r#1', silencioso: false });
  assert.deepEqual(aviso('intervention de sistema no silêncio'), { titulo: 'Farol · Acesso', corpo: 'token', url: null, pr: null, silencioso: true });
});

test('intervention inválida devolve null', () => {
  assert.equal(aviso('intervention inválida'), null);
});

test('meu-pr-base: título sem Farol, e o agrupado usa a url do primeiro item', () => {
  assert.deepEqual(aviso('meu-pr-base um PR'), { titulo: 'PR em conflito', corpo: 'o/r#1: em conflito com main. Atualize a branch antes do merge.', url: 'u1', pr: 'o/r#1', silencioso: false });
  const a = aviso('meu-pr-base agrupado');
  assert.equal(a.titulo, '2 PRs precisam de você por causa da base');
  assert.equal(a.url, 'u1');
  assert.equal(a.pr, 'o/r#1');
});

test('evento desconhecido devolve null', () => {
  assert.equal(avisoDe('state', {}, { config: {} }), null);
  assert.equal(avisoDe('needs-decision', {}, { config: {} }), null);
});

test('badgeDe conta pendências que esperam você', () => {
  assert.deepEqual(badgeDe({ decisions: { pending: [{}, { esperaCi: true }, { esperaProva: true }] } }), { contador: 1, rotulo: '1 decisão esperando você' });
  assert.deepEqual(badgeDe({ decisions: { pending: [{}, {}, null] } }), { contador: 2, rotulo: '2 decisões esperando você' });
  assert.deepEqual(badgeDe({}), { contador: 0, rotulo: '' });
  assert.deepEqual(badgeDe(null), { contador: 0, rotulo: '' });
});

test('cascaDe projeta badge, ocupado, autostart e cores', () => {
  const engine = { activeReviews: new Map([['a1', {}]]), config: { autostart: true, theme: 'light' }, snapshot: () => ({ decisions: { pending: [{}] } }) };
  assert.deepEqual(cascaDe(engine), { badge: { contador: 1, rotulo: '1 decisão esperando você' }, ocupado: true, autostart: true, cores: { bg: '#f4f6f9', symbol: '#1c2536' } });
  const parado = { activeReviews: new Map(), config: {}, snapshot: () => ({}) };
  assert.deepEqual(cascaDe(parado), { badge: { contador: 0, rotulo: '' }, ocupado: false, autostart: false, cores: { bg: '#0b0e14', symbol: '#e7ecf5' } });
  // snapshot e config explícitos valem sobre os do engine (o state e o settings-changed os trazem)
  assert.equal(cascaDe(parado, { snapshot: { decisions: { pending: [{}, {}] } } }).badge.contador, 2);
  assert.equal(cascaDe(parado, { config: { autostart: true } }).autostart, true);
});

test('as fixtures de paridade das cascas refletem os casos deste arquivo', () => {
  const casos = CASOS.map(c => ({ ...c, esperado: calcular(c) }));
  const arquivo = path.join(import.meta.dirname, 'fixtures', 'casca', 'eventos.json');
  if (process.env.FAROL_ATUALIZAR_FIXTURES === '1') {
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    fs.writeFileSync(arquivo, JSON.stringify(casos, null, 2) + '\n');
  }
  assert.deepEqual(parseJson(fs.readFileSync(arquivo, 'utf8')), casos, 'rode com FAROL_ATUALIZAR_FIXTURES=1 para regravar');
});
