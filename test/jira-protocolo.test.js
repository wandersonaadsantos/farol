// O protocolo do workspace é produto, não código: ele é re-sincronizado da fonte
// a cada boot. Se continuar mandando o modelo buscar o card num site fixo, a
// revisão de uma org de outra empresa vai atrás do Jira errado.
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const RAIZ = path.join(import.meta.dirname, '..');
const PROTOCOLO = fs.readFileSync(path.join(RAIZ, 'workspace-template', 'CLAUDE.md'), 'utf8');
const SELF = fs.readFileSync(path.join(RAIZ, 'workspace-template', 'prompts', 'self-review.md'), 'utf8');

test('nenhum dos dois fixa mais um site do Jira', () => {
  for (const [nome, texto] of [['CLAUDE.md', PROTOCOLO], ['self-review.md', SELF]]) {
    assert.ok(!/[a-z0-9-]+\.atlassian\.net/i.test(texto), `${nome} ainda cita um site fixo do Jira`);
  }
});

test('a revisão sabe que o card já vem lido pelo Farol', () => {
  assert.ok(/lido pelo Farol/i.test(PROTOCOLO));
});

// ANTES do P0b a autoanálise NÃO recebia o bloco do card: ela mandava o modelo caçar a
// chave e chamar getJiraIssue sozinho. Isso foi invertido de propósito, porque o card é
// entrada de uma decisão e precisa vir do app: determinismo, cache, escopo de tenant e o
// guard de "isto é dado, não instrução" que só o cardBlock aplica.
test('a autoanálise recebe o card PRÉ-LIDO pelo app e não sai buscando sozinha', () => {
  assert.ok(/j[áa] vem lido pelo Farol/i.test(SELF), 'o card entra pelo Farol');
  assert.ok(/N[ãa]o busque de novo/i.test(SELF));
  assert.ok(!/extraia a chave do card/i.test(SELF), 'não sobrou instrução de caçar a chave');
});

test('a regra de card não verificável continua nos dois', () => {
  assert.ok(/n[ãa]o[- ]verific[áa]vel/i.test(PROTOCOLO));
  assert.ok(/n[ãa]o[- ]verific[áa]vel/i.test(SELF));
});

test('o protocolo da revisão instrui o caso da seção de card ausente', () => {
  assert.match(PROTOCOLO, /n[ãa]o\s+aparecer/i);
  assert.ok(/getJiraIssue/.test(PROTOCOLO), 'sem a seção, o modelo precisa saber que lê o card ele mesmo');
});

// Os dois testes abaixo travam o que o passo 2 promete nos caminhos NÃO escopados
// (revisão pelo terminal, ou prompt sem a seção de card): lá a ferramenta do Jira
// exige cloudId e alcança um tenant que pode ser de outra empresa.
test('o protocolo exige o cloudId quando a ferramenta não vem escopada', () => {
  assert.ok(/cloudId/.test(PROTOCOLO), 'sem a seção de card, chamar getJiraIssue sem cloudId é recusado no schema');
  assert.ok(/getAccessibleAtlassianResources/.test(PROTOCOLO), 'o modelo precisa saber como descobrir o site');
});

test('card lido fora do caminho escopado só vale se for da organização do PR', () => {
  assert.match(PROTOCOLO, /[Cc]onfirme[^\n]*organiza[çc][ãa]o dona deste PR/,
    'a mesma chave existe em mais de um tenant: sem confirmar a origem, o card é não-verificável');
});

/* ---------- P0b: o que o prompt da autoanálise passou a mandar ---------- */

test('a regra de git virou "não mutar", não "não executar"', () => {
  assert.match(SELF, /n[ãa]o mutar/i, 'o alvo é a mutação');
  assert.match(SELF, /Inspe[çc][ãa]o com git é permitida/i);
  assert.match(SELF, /tempor[áa]rio descart[áa]vel|clone ou diret[óo]rio tempor[áa]rio/i);
});

test('o prompt manda ler o escopo materializado, e não substituir por gh pr diff', () => {
  assert.match(SELF, /ferramenta `Read`, um por vez/i);
  assert.match(SELF, /comprova cobertura/i);
});

test('o prompt diz que coverageLimitations só SUBTRAI, e não existe campo que some', () => {
  assert.match(SELF, /coverageLimitations/);
  assert.match(SELF, /s[óo] SUBTRAI|só SUBTRAI cobertura/i);
  assert.match(SELF, /Nada que voc[êe] escreva no JSON aumenta isso/i);
});

test('o prompt fixa o enum de verdict e proíbe a coerção que o parser recusa', () => {
  assert.match(SELF, /"approvable"\s*\|\s*"needs_work"|exatamente `"approvable"` ou `"needs_work"`/);
  assert.match(SELF, /aus[êe]ncia n[ãa]o [ée] o mesmo que\s*\n?\s*vazio|ausência não é o mesmo que/i);
});

test('a autoanálise participa do protocolo de verificação (era exclusivo da revisão)', () => {
  assert.match(SELF, /FAROL_CHECKPOINT/);
  assert.match(SELF, /claim-verifier/);
  assert.match(SELF, /Nunca escreva o arquivo de checkpoint/i, 'quem grava continua sendo o app');
});

test('o subagente sabe ler do escopo quando ele existe, e só cai no patch quando não existe', () => {
  const AGENTE = fs.readFileSync(path.join(RAIZ, 'workspace-template', '.claude', 'agents', 'pr-reviewer.md'), 'utf8');
  assert.match(AGENTE, /RAIZ DE ESCOPO/, 'o subagente precisa saber que a raiz pode existir');
  assert.match(AGENTE, /um arquivo por vez/i);
  assert.match(AGENTE, /Sem raiz de escopo/i, 'a revisão comum não pode ser afetada');
  assert.match(AGENTE, /n[ãa]o prova nada sobre arquivo nenhum/i);
});

test('a autoanálise repassa a raiz do escopo pro subagente (senão ninguém abre os arquivos)', () => {
  assert.match(SELF, /RAIZ DO ESCOPO/);
  assert.match(SELF, /A leitura do subagente conta pra cobertura/i);
});
