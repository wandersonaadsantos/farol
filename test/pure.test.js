'use strict';
// Rede de proteção do Farol: funções puras exportadas pelo server.js.
// Runner nativo do Node (node --test), ZERO dependências. Ver docs/QUALITY.md.
// FAROL_HOME temporário por segurança (o require não toca disco, mas fixar o
// home garante que nenhum teste esbarre no ~/.farol real).
const os = require('node:os');
const path = require('node:path');
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-pure-' + process.pid);

const { test } = require('node:test');
const assert = require('node:assert/strict');
const farol = require('../server.js');
const { modelLabel, isPermanentBranch, parseAccounts, parseProjectReviewers, parseDefaultReviewers,
  normalizeClaudeProfiles, sanitizeClaudeDir } = farol;

test('modelLabel: família + versão pontuada', () => {
  assert.equal(modelLabel('claude-opus-4-8'), 'Opus 4.8');
  assert.equal(modelLabel('claude-sonnet-4-5'), 'Sonnet 4.5');
  assert.equal(modelLabel('claude-3-5-haiku'), 'Haiku 3.5');
});

test('modelLabel: família sem versão devolve só a família', () => {
  assert.equal(modelLabel('haiku'), 'Haiku');
});

test('modelLabel: vazio e desconhecido', () => {
  assert.equal(modelLabel(''), '');
  assert.equal(modelLabel(null), '');
  assert.equal(modelLabel('gpt-4o'), 'gpt-4o'); // sem família conhecida devolve cru
});

test('isPermanentBranch: nomes canônicos e vazio são permanentes', () => {
  for (const b of ['main', 'master', 'develop', 'release', 'hml', 'hmg', 'staging', 'production']) {
    assert.equal(isPermanentBranch(b), true, b);
  }
  assert.equal(isPermanentBranch(''), true);
  assert.equal(isPermanentBranch(null), true);
  assert.equal(isPermanentBranch('DEVELOP'), true); // case-insensitive
});

test('isPermanentBranch: famílias versionadas de ambiente', () => {
  for (const b of ['release/1.2', 'release_1.2', 'hmg-v1.2', 'hml-x', 'env/prod', 'homolog-2']) {
    assert.equal(isPermanentBranch(b), true, b);
  }
});

test('isPermanentBranch: branches descartáveis', () => {
  for (const b of ['feat/x', 'fix/y', 'task-123', 'hotfix/z', 'bugfix/w', 'chore/deps']) {
    assert.equal(isPermanentBranch(b), false, b);
  }
});

test('parseAccounts: texto "login: org1, org2" e a ordem preservada', () => {
  const out = parseAccounts('alice: biudtech, foo\nbob');
  assert.deepEqual(out, [
    { user: 'alice', owners: ['biudtech', 'foo'] },
    { user: 'bob', owners: [] },
  ]);
});

test('parseAccounts: array normalizado, metadados e políticas válidas', () => {
  const out = parseAccounts([
    { user: 'a', owners: ['x', 'y'], muted: true, onClean: 'approve', onReject: 'request_changes', label: 'Trabalho' },
    { user: '', owners: ['z'] }, // sem user: descartado
  ]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { user: 'a', owners: ['x', 'y'], label: 'Trabalho', muted: true, onClean: 'approve', onReject: 'request_changes' });
});

test('parseAccounts: valores de política inválidos são ignorados', () => {
  const [acct] = parseAccounts([{ user: 'a', owners: [], onClean: 'lol', onReject: 'nope' }]);
  assert.equal('onClean' in acct, false);
  assert.equal('onReject' in acct, false);
});

test('parseAccounts: claudeProfileId é preservado quando presente e string não-vazia', () => {
  const out = parseAccounts([
    { user: 'a', owners: [], claudeProfileId: 'trabalho' },
    { user: 'b', owners: [], claudeProfileId: '' },
    { user: 'c', owners: [] }
  ]);
  assert.equal(out[0].claudeProfileId, 'trabalho');
  assert.equal('claudeProfileId' in out[1], false);
  assert.equal('claudeProfileId' in out[2], false);
});

test('normalizeClaudeProfiles: não-array vira [] (string, número, objeto, null)', () => {
  assert.deepEqual(normalizeClaudeProfiles('abc'), []);
  assert.deepEqual(normalizeClaudeProfiles(123), []);
  assert.deepEqual(normalizeClaudeProfiles({ not: 'array' }), []);
  assert.deepEqual(normalizeClaudeProfiles(null), []);
});

test('normalizeClaudeProfiles: dir com aspa dupla ou newline é descartado (id+dir inválido)', () => {
  const out = normalizeClaudeProfiles([
    { id: 'a', label: 'A', dir: 'C:\\ok\\path' },
    { id: 'b', label: 'B', dir: 'C:\\bad" && calc.exe' },
    { id: 'c', label: 'C', dir: 'C:\\bad\nlinha2' },
    { id: 'd', label: 'D', dir: { nested: true } }, // dir não-string também é descartado
  ]);
  assert.deepEqual(out.map(p => p.id), ['a']); // só o válido sobrevive
});

test('sanitizeClaudeDir: rejeita aspas duplas e quebras de linha, aceita o resto', () => {
  assert.equal(sanitizeClaudeDir('C:\\ok'), 'C:\\ok');
  assert.equal(sanitizeClaudeDir('C:\\bad"quote'), '');
  assert.equal(sanitizeClaudeDir('C:\\bad\r\nline'), '');
  assert.equal(sanitizeClaudeDir(null), '');
  assert.doesNotThrow(() => sanitizeClaudeDir({ obj: true }));
});

test('sanitizeClaudeDir: tira aspas duplas que envolvem o valor inteiro (Copiar como caminho do Windows)', () => {
  assert.equal(sanitizeClaudeDir('"C:\\Users\\voce\\.claude"'), 'C:\\Users\\voce\\.claude');
  // aspas no MEIO continuam rejeitadas (não é o mesmo caso)
  assert.equal(sanitizeClaudeDir('C:\\bad"quote\\path'), '');
  assert.equal(sanitizeClaudeDir('"C:\\bad"quote"'), ''); // aspas extras além do par externo: ainda rejeita
});

test('parseProjectReviewers: texto "owner/repo: pessoas" e objeto passthrough', () => {
  assert.deepEqual(parseProjectReviewers('biudtech/biud-frontend: alice, biudtech/time'), {
    'biudtech/biud-frontend': ['alice', 'biudtech/time'],
  });
  assert.deepEqual(parseProjectReviewers({ 'o/r': ['a', 'b'] }), { 'o/r': ['a', 'b'] });
  assert.deepEqual(parseProjectReviewers('linha sem repo valido'), {}); // sem owner/repo: ignora
});

test('parseDefaultReviewers: chave é a org (sem barra)', () => {
  assert.deepEqual(parseDefaultReviewers('biudtech: alice, bob'), { biudtech: ['alice', 'bob'] });
  assert.deepEqual(parseDefaultReviewers({ org: ['x'] }), { org: ['x'] });
});
