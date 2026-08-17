// lib/workspace.js: leitura dos artefatos que o Claude escreve no workspace (destaques,
// dossiês por autor, log de falhas). Estava com ZERO teste, apesar de as três funções
// serem servidas direto em /api/highlights, /api/team e /api/log, ou seja, tudo que a
// aba Destaques e a aba Time mostram passa por aqui.
//
// São parsers de markdown escrito por um modelo, então a forma real varia. O que estes
// testes travam é o contrato: nunca lançar (arquivo ausente, vazio, malformado devolvem
// lista vazia em vez de derrubar a rota) e extrair os campos do formato esperado.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = path.join(os.tmpdir(), 'farol-test-workspace-' + process.pid);
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
const { STATE_DIR, LOG_FILE } = await import('../lib/paths.js');
const { parseHighlights, parseTeam, tailLog } = await import('../lib/workspace.js');

after(() => { try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const HIGHLIGHTS = path.join(STATE_DIR, 'highlights.md');
const AUTHORS = path.join(STATE_DIR, 'authors');

beforeEach(() => {
  fs.rmSync(STATE_DIR, { recursive: true, force: true });
  fs.mkdirSync(STATE_DIR, { recursive: true });
});

/* ---------- parseHighlights ---------- */

test('parseHighlights: sem arquivo devolve lista vazia, não lança', () => {
  // a rota /api/highlights é chamada em toda troca de aba: lançar aqui derruba a tela
  assert.deepEqual(parseHighlights(), []);
});

test('parseHighlights: arquivo vazio devolve lista vazia', () => {
  fs.writeFileSync(HIGHLIGHTS, '');
  assert.deepEqual(parseHighlights(), []);
});

test('parseHighlights: extrai data, autor, referência, link e texto', () => {
  fs.writeFileSync(HIGHLIGHTS,
    '# Destaques\n\n' +
    '- 2026-07-28 · @alice · [acme/app#10](https://github.com/acme/app/pull/10) — separou bem o caso de borda\n');
  const [h] = parseHighlights();
  assert.equal(h.date, '2026-07-28');
  assert.equal(h.author, 'alice', 'o @ sai do login');
  assert.equal(h.ref, 'acme/app#10');
  assert.equal(h.url, 'https://github.com/acme/app/pull/10');
  assert.equal(h.text, 'separou bem o caso de borda');
});

test('parseHighlights: devolve do mais novo pro mais antigo', () => {
  // o arquivo é append-only (o mais novo no fim), a tela mostra o mais novo no topo
  fs.writeFileSync(HIGHLIGHTS,
    '- 2026-07-01 · @alice · [a#1](u1) — primeiro\n' +
    '- 2026-07-02 · @bob · [b#2](u2) — segundo\n' +
    '- 2026-07-03 · @carol · [c#3](u3) — terceiro\n');
  assert.deepEqual(parseHighlights().map(h => h.author), ['carol', 'bob', 'alice']);
});

test('parseHighlights: linha sem os 3 campos vira texto cru, sem quebrar', () => {
  fs.writeFileSync(HIGHLIGHTS, '- anotação solta sem separador\n');
  const [h] = parseHighlights();
  assert.equal(h.text, 'anotação solta sem separador');
  assert.equal(h.author, null);
});

test('parseHighlights: ignora o que não é item de lista', () => {
  fs.writeFileSync(HIGHLIGHTS, '# Título\n\nUm parágrafo solto.\n\n- 2026-07-01 · @alice · [a#1](u1) — vale\n');
  assert.equal(parseHighlights().length, 1);
});

test('parseHighlights: sem link, ainda extrai autor e texto', () => {
  fs.writeFileSync(HIGHLIGHTS, '- 2026-07-01 · @alice · comentou bem no PR\n');
  const [h] = parseHighlights();
  assert.equal(h.author, 'alice');
  assert.equal(h.url, null);
  assert.equal(h.text, 'comentou bem no PR');
});

/* ---------- parseTeam ---------- */

test('parseTeam: sem diretório devolve lista vazia, não lança', () => {
  assert.deepEqual(parseTeam(), []);
});

test('parseTeam: lê o dossiê, o nome do título e os blocos de review', () => {
  fs.mkdirSync(AUTHORS, { recursive: true });
  fs.writeFileSync(path.join(AUTHORS, 'alice.md'),
    '# alice (Alice Souza)\n\n' +
    '## 2026-07-28 · acme/app#10 · aprovado\n' +
    '- separou bem o caso de borda\n' +
    '- cobertura boa\n\n' +
    '## 2026-07-20 · acme/app#4 · pediu mudanças\n' +
    '- faltou tratar erro de rede\n');
  const [p] = parseTeam();
  assert.equal(p.login, 'alice');
  assert.equal(p.name, 'Alice Souza');
  assert.equal(p.entries.length, 2);
  assert.equal(p.entries[0].date, '2026-07-28');
  assert.equal(p.entries[0].ref, 'acme/app#10');
  assert.equal(p.entries[0].verdict, 'aprovado');
  assert.deepEqual(p.entries[0].bullets, ['separou bem o caso de borda', 'cobertura boa']);
});

test('parseTeam: sem nome no título, cai no login', () => {
  fs.mkdirSync(AUTHORS, { recursive: true });
  fs.writeFileSync(path.join(AUTHORS, 'bob.md'), '# bob\n\n## 2026-07-01 · a#1 · aprovado\n- ok\n');
  assert.equal(parseTeam()[0].name, 'bob');
});

test('parseTeam: ordena por review mais recente', () => {
  fs.mkdirSync(AUTHORS, { recursive: true });
  fs.writeFileSync(path.join(AUTHORS, 'antigo.md'), '# antigo\n\n## 2026-01-01 · a#1 · ok\n- x\n');
  fs.writeFileSync(path.join(AUTHORS, 'recente.md'), '# recente\n\n## 2026-07-30 · b#2 · ok\n- y\n');
  assert.deepEqual(parseTeam().map(p => p.login), ['recente', 'antigo']);
});

test('parseTeam: dossiê sem nenhum bloco não quebra a ordenação', () => {
  fs.mkdirSync(AUTHORS, { recursive: true });
  fs.writeFileSync(path.join(AUTHORS, 'vazio.md'), '# vazio\n');
  fs.writeFileSync(path.join(AUTHORS, 'cheio.md'), '# cheio\n\n## 2026-07-30 · b#2 · ok\n- y\n');
  const team = parseTeam();
  assert.equal(team.length, 2);
  assert.equal(team[0].login, 'cheio', 'quem tem review vem antes de quem não tem');
  assert.deepEqual(team.find(p => p.login === 'vazio').entries, []);
});

test('parseTeam: ignora arquivo que não é .md', () => {
  fs.mkdirSync(AUTHORS, { recursive: true });
  fs.writeFileSync(path.join(AUTHORS, 'alice.md'), '# alice\n\n## 2026-07-30 · b#2 · ok\n- y\n');
  fs.writeFileSync(path.join(AUTHORS, 'notas.txt'), 'nada a ver');
  assert.deepEqual(parseTeam().map(p => p.login), ['alice']);
});

/* ---------- tailLog ---------- */

test('tailLog: sem arquivo devolve lista vazia, não lança', () => {
  assert.deepEqual(tailLog(), []);
});

test('tailLog: devolve as últimas N linhas, sem as vazias', () => {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.writeFileSync(LOG_FILE, ['l1', 'l2', '', 'l3', 'l4', ''].join('\n'));
  assert.deepEqual(tailLog(2), ['l3', 'l4']);
  assert.deepEqual(tailLog(), ['l1', 'l2', 'l3', 'l4']);
});

test('tailLog: pedir mais linhas do que existe devolve tudo', () => {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.writeFileSync(LOG_FILE, 'unica\n');
  assert.deepEqual(tailLog(500), ['unica']);
});

test('tailLog: aceita CRLF (log gravado no Windows)', () => {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.writeFileSync(LOG_FILE, 'a\r\nb\r\nc\r\n');
  assert.deepEqual(tailLog(), ['a', 'b', 'c']);
});
