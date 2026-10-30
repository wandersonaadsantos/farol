// Busca do Sistema (índice, filtro) e seções que somem com a sincronização desligada.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SYS_INDEX, buscarNoSistema, secoesOcultasDoSistema } from '../ui/pure/sistema-busca.js';

const html = fs.readFileSync(new URL('../ui/index.html', import.meta.url), 'utf8');

test('a busca por "orçamento" acha Plano e chaves antes de Grupos', () => {
  const hits = buscarNoSistema(SYS_INDEX, 'orçamento', () => '');
  const secs = hits.map((h) => h.sec);
  assert.ok(secs.includes('plans'));
  assert.ok(secs.indexOf('plans') < secs.indexOf('groups'));
});

test('consulta vazia não devolve nada', () => {
  assert.deepEqual(buscarNoSistema(SYS_INDEX, '  ', () => ''), []);
});

test('todo alvo "#id" do índice existe no index.html', () => {
  for (const e of SYS_INDEX) {
    if (!e.at.startsWith('#')) continue;
    assert.ok(html.includes(`id="${e.at.slice(1)}"`), `alvo ${e.at} sem id no index.html`);
  }
});

test('seções da sincronização somem com ela desligada ou ausente', () => {
  assert.deepEqual(secoesOcultasDoSistema({ sync: { enabled: false } }), ['devices', 'groups']);
  assert.deepEqual(secoesOcultasDoSistema({}), ['devices', 'groups']);
  assert.deepEqual(secoesOcultasDoSistema(undefined), ['devices', 'groups']);
  assert.deepEqual(secoesOcultasDoSistema({ sync: { enabled: true } }), []);
});
