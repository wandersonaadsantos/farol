// Inventário das rotas /api (A4, spec 7.A4): toda rota que o servidor roteia tem classe.
// Rota nova sem classe reprova aqui. A lista do servidor é DERIVADA do fonte, com o mesmo
// extrator do test/ui-contract.test.js, para não virar tabela curada que envelhece.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CLASSES, PUBLICAS, classeDaRota, rotaPublicaDeAutenticacao, todasAsRotas } from '../lib/local-auth/inventario.js';

const SERVERJS = fs.readFileSync(path.join(import.meta.dirname, '..', 'lib', 'http-server.js'), 'utf8');
function rotasServidas() {
  return new Set([...SERVERJS.matchAll(/p === '(\/api\/[^']+)'/g)].map(m => m[1]));
}

test('o extrator de rotas não está cego', () => {
  const servidas = rotasServidas();
  assert.ok(servidas.has('/api/decide'));
  assert.ok(servidas.size >= 46, `esperava pelo menos 46 rotas, achei ${servidas.size}`);
});

test('toda rota servida tem classe no inventário', () => {
  const semClasse = [...rotasServidas()].filter(r => !classeDaRota(r));
  assert.deepEqual(semClasse, [], `rota sem classe (classifique em lib/local-auth/inventario.js conforme a spec 7.A4): ${semClasse.join(', ')}`);
});

test('nenhuma rota aparece em duas classes', () => {
  const todas = todasAsRotas();
  assert.equal(new Set(todas).size, todas.length);
});

// O número é tripwire de rota nova entrando sem classe. Ele muda quando o conjunto de
// rotas muda de propósito: a C1 tirou /api/sync/erase-remote e acrescentou /api/sync/unlock
// e /api/sync/new-epoch (46 virou 47), a C2a acrescentou /api/sync/admin (47 virou 48) e a
// C2b acrescentou grupo, vínculo, aparelho, chave de limpeza, limpeza e revogação
// (48 virou 54), a C3c acrescentou /api/sync/seen (54 virou 55)
// a C3d acrescentou a lista e o corpo das revisões (55 virou 57), e a C3g a medição e o
// envio do histórico local (57 virou 59), e a C6 acrescentou /api/sync/command
// (59 virou 60). O contrato das telas (B2) acrescentou desfecho de comando, publicar
// política, aviso da tomada, estado da chave de limpeza e as sessões da A4 (60 virou 66). O diagnóstico unificado (A3) acrescentou /api/diagnostics (66 virou 67). O plano e chaves (A2) acrescentou testar perfil e adotar o legado (67 virou 69). As divergências de Aparelhos acrescentaram a leitura da política publicada e a recusa da designação (69 virou 71). A transferência pela tela acrescentou /api/sync/transfer-targets, leitura sensível porque lista os aparelhos com o que cada um consegue fazer (71 virou 72).
// As listas remotas (Panorama e Meus PRs de outros aparelhos) acrescentaram /api/sync/lists (72 virou 73).
// A edição de conta por operação acrescentou /api/accounts/edit, na mesma classe de /api/settings (73 virou 74).
// A exportação do chat acrescentou /api/chat/export, leitura sensível como /api/chat: leva a conversa inteira (74 virou 75).
test('as classes da spec cobrem os 75 caminhos, e as públicas são só as duas de autenticação', () => {
  const naoPublicas = Object.entries(CLASSES).filter(([c]) => c !== 'autenticacao-publica').flatMap(([, rotas]) => rotas);
  assert.equal(naoPublicas.length, 75);
  assert.deepEqual(CLASSES['autenticacao-publica'].slice().sort(), ['/api/auth/pair', '/api/auth/status']);
  assert.deepEqual(Object.keys(CLASSES).sort(), ['autenticacao-publica', 'demais', 'destrutiva', 'escreve-github', 'evento', 'leitura-baixo-risco', 'leitura-sensivel', 'recebe-segredo', 'sessao-paga']);
});

test('toda rota inventariada existe no servidor (sem classe morta)', () => {
  const servidas = rotasServidas();
  const mortas = todasAsRotas().filter(r => !servidas.has(r));
  assert.deepEqual(mortas, [], `rota inventariada que o servidor não roteia: ${mortas.join(', ')}`);
});

test('a exceção pública depende do método', () => {
  assert.deepEqual({ ...PUBLICAS }, { '/api/auth/pair': 'POST', '/api/auth/status': 'GET' });
  assert.equal(rotaPublicaDeAutenticacao('POST', '/api/auth/pair'), true);
  assert.equal(rotaPublicaDeAutenticacao('GET', '/api/auth/status'), true);
  assert.equal(rotaPublicaDeAutenticacao('GET', '/api/auth/pair'), false);
  assert.equal(rotaPublicaDeAutenticacao('POST', '/api/auth/status'), false);
  assert.equal(rotaPublicaDeAutenticacao('GET', '/api/state'), false);
});
