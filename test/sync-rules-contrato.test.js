// As regras publicadas são GERADAS: o JSON no disco precisa ser byte a byte o que o
// gerador produz a partir do template, e as validações legadas precisam continuar
// idênticas às de hoje (anexo C1, "Estratégia de regras", regra de ouro dos nós legados).
//
// Estes casos são ESTÁTICOS: o dublê do banco não avalia regra (decisão 8 da spec), então
// o que se prova aqui é o texto publicado. O comportamento no servidor fica no roteiro
// manual do firebase/README.md.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const RAIZ = path.join(import.meta.dirname, '..');
const REGRAS = path.join(RAIZ, 'firebase', 'database.rules.json');
const TEMPLATE = path.join(RAIZ, 'firebase', 'database.rules.template.json');

const texto = fs.readFileSync(REGRAS, 'utf8');
const regras = JSON.parse(texto).rules.users.$uid;

test('o arquivo publicado é exatamente o que o gerador produz', () => {
  const gerado = execFileSync(process.execPath, [path.join(RAIZ, 'tools', 'sync-rules.js'), '--stdout'], { encoding: 'utf8' });
  assert.equal(gerado, texto, 'rode `node tools/sync-rules.js` e comite o resultado');
});

test('o template usa macro e o publicado não deixou nenhuma por expandir', () => {
  assert.equal(/@[A-Z]/.test(texto), false, 'sobrou macro no arquivo publicado');
  assert.ok(fs.readFileSync(TEMPLATE, 'utf8').includes('@U@'), 'o template usa macro');
});

test('a raiz perdeu o .write: o apagão de /users/{uid} deixa de existir', () => {
  assert.equal(regras['.write'], undefined);
  assert.equal(regras['.read'], 'auth != null && auth.uid == $uid');
});

test('as validações legadas continuam byte a byte as de hoje', () => {
  assert.equal(regras.leases.$acct.$pr['.validate'], "newData.hasChildren(['leaseId', 'deviceId', 'operationKind', 'expiresAt']) && newData.child('expiresAt').isNumber() && newData.child('expiresAt').val() > now && newData.child('expiresAt').val() <= now + 300000 && (!data.exists() || data.child('expiresAt').val() <= now || (data.child('leaseId').val() == newData.child('leaseId').val() && data.child('deviceId').val() == newData.child('deviceId').val()))");
  assert.equal(regras.receipts.$acct.$pr.$fp['.validate'], "newData.hasChildren(['operationKind', 'materialVersion', 'deviceId', 'completedAt', 'outcome', 'publicationState']) && newData.child('completedAt').isNumber()");
  assert.equal(regras.usageEvents.$device.$event['.validate'], "newData.hasChildren(['at', 'kind', 'costUsd']) && newData.child('at').isNumber()");
  assert.equal(regras.dailyRounds.$acct.$pr.$day['.validate'], "$day.matches(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/) && newData.child('dayPolicy').val() == 'America/Sao_Paulo'");
});

test('cada nó legado ganhou concessão própria, já que a raiz não concede mais', () => {
  for (const no of ['leases', 'receipts', 'dailyRounds', 'devices', 'usageEvents']) {
    assert.equal(regras[no]['.write'], 'auth != null && auth.uid == $uid', no);
  }
});

test('keyring: exige senha recente e rev monotônico', () => {
  const w = regras.keyring['.write'];
  assert.ok(w.includes("auth.token.firebase.sign_in_provider == 'password'"));
  assert.ok(w.includes('auth.token.auth_time * 1000 + 300000 > now'), 'o *1000 é o que faz o caso positivo passar');
  assert.ok(w.includes("newData.child('rev').val() == data.child('rev').val() + 1"));
  assert.equal(regras.keyring.slots.$s['.validate'], "$s.matches(/^(pw|pp)$/)");
});

test('só os nós listados têm concessão de escrita: nó novo sem regra é negado por construção', () => {
  const comEscrita = Object.keys(regras).filter((k) => regras[k] && regras[k]['.write']);
  assert.deepEqual(comEscrita.sort(), ['dailyRounds', 'devices', 'keyring', 'leases', 'receipts', 'usageEvents']);
});

test('a sonda depende desta assimetria: rulesProbe concede em v2/{aparelho} e em mais nada', () => {
  assert.equal(regras.rulesProbe['.write'], undefined, 'o pai não pode conceder, senão a sonda nunca detecta regra velha');
  assert.equal(regras.rulesProbe.v2.$dev['.write'], 'auth != null && auth.uid == $uid');
  assert.equal(regras.rulesProbe.v1, undefined, 'v1 não existe no template: é o caminho que as regras novas negam');
});
