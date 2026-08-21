// Esta é a borda do recurso, e ela guarda dois valores perigosos.
//
// O `id` vira nome de arquivo (config do mcp e cache do card) e entra numa linha
// de shell: o runClaudeStream faz extraArgs.join(' ') (session.js:610) e passa a
// linha pra cmd.exe /d /s /c e pra /bin/sh -lc. Defesa é allowlist de formato,
// não escaping, e é REJEITAR, não sanear: sanear em silêncio faz `a b` e `a-b`
// colidirem no mesmo arquivo.
//
// A `baseUrl` é o destino REAL pra onde o header Basic com o token viaja. Checar
// só o esquema deixa https://a.atlassian.net@evil.com passar, e o fetch resolve
// isso como host evil.com.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJiraSites, siteForOwner, maskJiraSites } from '../lib/jira/sites.js';

test('parseJiraSites normaliza e descarta o inválido', () => {
  const saida = parseJiraSites([
    { id: 's1', label: ' Empresa A ', baseUrl: 'https://a.atlassian.net/', owners: ['OrgA', ' orgb '], projectKeys: ['ab', 'cd'] },
    { id: 's2', baseUrl: 'http://inseguro.atlassian.net' },
    { id: '', baseUrl: 'https://semid.atlassian.net' },
    { id: 's1', baseUrl: 'https://duplicado.atlassian.net' },
    'lixo',
  ]);
  assert.equal(saida.length, 1);
  assert.deepEqual(saida[0], {
    id: 's1',
    label: 'Empresa A',
    baseUrl: 'https://a.atlassian.net',
    owners: ['orga', 'orgb'],
    projectKeys: ['AB', 'CD'],
  });
});

test('id fora da allowlist é descartado: ele vira nome de arquivo e linha de shell', () => {
  assert.deepEqual(parseJiraSites([{ id: 'a & calc', baseUrl: 'https://a.atlassian.net' }]), []);
  assert.deepEqual(parseJiraSites([{ id: '../../fuga', baseUrl: 'https://a.atlassian.net' }]), []);
  assert.deepEqual(parseJiraSites([{ id: 'a'.repeat(65), baseUrl: 'https://a.atlassian.net' }]), []);
});

test('parseJiraSites recusa baseUrl que desvia o destino do header Basic', () => {
  for (const url of ['https://a.atlassian.net@evil.com', 'https://user:senha@a.atlassian.net', 'https://a.atlassian.net?x=1', 'https://a.atlassian.net#frag', 'https://a.atlassian.net/rest']) {
    assert.deepEqual(parseJiraSites([{ id: 's1', baseUrl: url }]), [], url);
  }
});

test('baseUrl com porta explícita continua cadastrável', () => {
  const saida = parseJiraSites([{ id: 's1', baseUrl: 'https://jira.interno:8443' }]);
  assert.equal(saida[0].baseUrl, 'https://jira.interno:8443');
});

test('parseJiraSites usa o host como rótulo quando não vem rótulo', () => {
  const saida = parseJiraSites([{ id: 's1', baseUrl: 'https://a.atlassian.net' }]);
  assert.equal(saida[0].label, 'a.atlassian.net');
  assert.deepEqual(saida[0].owners, []);
});

test('parseJiraSites aceita entrada não-array sem quebrar', () => {
  assert.deepEqual(parseJiraSites(null), []);
  assert.deepEqual(parseJiraSites('x'), []);
});

test('siteForOwner acha sem diferenciar maiúscula e devolve null sem fallback', () => {
  const sites = parseJiraSites([
    { id: 's1', baseUrl: 'https://a.atlassian.net', owners: ['orga'] },
    { id: 's2', baseUrl: 'https://b.atlassian.net', owners: ['orgb'] },
  ]);
  assert.equal(siteForOwner(sites, 'OrgB').id, 's2');
  assert.equal(siteForOwner(sites, 'orga').id, 's1');
  assert.equal(siteForOwner(sites, 'orgc'), null, 'org sem site NÃO pode cair em fallback');
  assert.equal(siteForOwner(sites, ''), null);
  assert.equal(siteForOwner(null, 'orga'), null);
});

test('maskJiraSites marca a credencial sem jamais expor valor', () => {
  const sites = parseJiraSites([{ id: 's1', baseUrl: 'https://a.atlassian.net', owners: ['orga'] }]);
  const visivel = maskJiraSites(sites, (id) => id === 's1');
  assert.equal(visivel[0].hasCredential, true);
  assert.deepEqual(Object.keys(visivel[0]).sort(), ['baseUrl', 'hasCredential', 'id', 'label', 'owners', 'projectKeys']);
});
