'use strict';
// Cache dos candidatos a reviewer (selfpr.reviewerCandidates): um byOrg inteiramente
// vazio é sintoma de falha total do gh (rede caída, token vencido), e cachear isso
// por 1 hora deixava o seletor de reviewers vazio até o TTL vencer (B9). O gate de
// cachear é a função pura temCandidatos, testável sem rede (o run do gh é capturado
// no require do selfpr e não dá pra stubar depois; mesmo caminho do pushbackTargets:
// extrai o gate síncrono). Runner nativo, ZERO deps.
const os = require('node:os');
const path = require('node:path');
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-revcands-' + process.pid);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { temCandidatos } = require('../lib/engine/selfpr');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { } });

test('byOrg com algum membro ou time cacheia', () => {
  assert.equal(temCandidatos({ acme: { members: ['alice'], teams: [] } }), true);
  assert.equal(temCandidatos({ acme: { members: [], teams: [{ id: 'acme/dev', name: 'Dev' }] } }), true);
  assert.equal(temCandidatos({ vazia: { members: [], teams: [] }, acme: { members: ['alice'], teams: [] } }), true,
    'basta uma org com dado');
});

test('byOrg inteiramente vazio NÃO cacheia (falha total do gh não vale 1 hora de cache)', () => {
  assert.equal(temCandidatos({ acme: { members: [], teams: [] } }), false,
    'org de verdade tem pelo menos você como membro: tudo vazio = falha');
  assert.equal(temCandidatos({}), false, 'sem org nenhuma');
  assert.equal(temCandidatos(null), false, 'entrada nula não explode');
});
