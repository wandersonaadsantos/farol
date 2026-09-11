# Sincronização entre dispositivos: plano de implementação

Gerado por máquina a partir de commits já provados verdes (`gerador/gerar-plano.mjs`), e
conferido pelo executor perfeito: aplicar este plano sobre a base reproduz, tarefa a
tarefa, exatamente a árvore que o protótipo provou.

**Como executar.** Uma tarefa por vez, na ordem. Em cada uma: aplique as mudanças
EXATAMENTE como escritas, rode os testes indicados e depois `npm run check && npm run
lint && npm test`. Só passe para a próxima com os três verdes. Um commit por tarefa, com
a mensagem indicada, sem trailer de co-autoria e sem mencionar IA.

**Onde colar.** Arquivo NOVO entra inteiro, com o conteúdo literal. Arquivo QUE JÁ EXISTE
entra como pares "localize este trecho / troque por este": o trecho a localizar aparece
uma única vez no arquivo naquele momento, e isso foi PROVADO na geração. Não reescreva o
arquivo inteiro, não reformate, não mude nada que o plano não peça.

**Escreva os arquivos com a ferramenta de escrita de arquivo, não por heredoc de shell.**
O conteúdo tem sequências como `\u0000` que o shell interpreta: `bash`, `cat <<EOF` e
amigos transformam a barra invertida antes de o arquivo existir, e aí o hash nunca bate. A
ferramenta que grava o conteúdo direto (Write, ou equivalente do seu ambiente) copia byte
a byte e é a única forma confiável aqui.

**Sequência de escape é TEXTO, não atalho.** Onde o bloco mostra `\u2014`, `\u0000` ou
qualquer `\u` seguido de quatro dígitos, escreva esses seis caracteres, um a um. NÃO os
troque pelo caractere que eles representam, mesmo sabendo qual é: o JavaScript fica
equivalente, a suíte fica verde, e ainda assim a árvore deixa de ser a que foi provada.
Cada arquivo criado vem com uma conferência por hash logo abaixo; rode-a antes de seguir.

**O contrato** (`docs/superpowers/plans/2026-09-10-sync-00-contrato.md`) explica as
decisões. Leia a seção "Atualização pós-protótipo" antes de começar: é onde estão os
pontos em que o contrato original estava errado.

### Tarefa T01: Constantes, taxonomia de erros e regras do banco

Todo o recurso pendura número de tempo e código de falha nestes dois arquivos. Eles vêm primeiro porque nada mais compila sem eles, e porque as regras do banco (firebase/) declaram os MESMOS tetos: o teste das constantes confere um contra o outro, então os dois nascem juntos ou a primeira tarefa já nasce mentindo.

**Arquivos:**
- Criar: `firebase/README.md`
- Criar: `firebase/database.rules.json`
- Criar: `firebase/firebase.json`
- Modificar: `lib/constants.js`
- Criar: `lib/sync/errors.js`
- Criar: `test/sync-constants.test.js`
- Criar: `test/sync-errors.test.js`

- [ ] **Passo 1: escrever o teste**

Crie `test/sync-constants.test.js` com EXATAMENTE este conteúdo:

```js
// lib/constants.js, objeto SYNC: o lar dos tempos e tetos da sincronização entre
// dispositivos, e a coerência dele com firebase/database.rules.json (as regras são
// JSON puro, sem como importar a constante, então o número se repete lá e é aqui que
// os dois são obrigados a concordar).
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import constants, { SYNC, TEMPOS } from '../lib/constants.js';

const REGRAS_PATH = path.join(import.meta.dirname, '..', 'firebase', 'database.rules.json');

test('SYNC: lease sem renovação vence ANTES do teto que as regras aceitam', () => {
  assert.ok(SYNC.LEASE_TTL_MS < SYNC.LEASE_TTL_MAX_MS);
  assert.ok(SYNC.HEARTBEAT_MS < SYNC.LEASE_TTL_MS, 'o heartbeat precisa renovar antes de o lease vencer');
});

test('SYNC: tempos e tetos são números positivos', () => {
  for (const k of ['LEASE_TTL_MS', 'LEASE_TTL_MAX_MS', 'HEARTBEAT_MS', 'PRESENCE_TICK_MS', 'TOKEN_MARGIN_MS',
    'REQUEST_TIMEOUT_MS', 'STREAM_RECONNECT_MS', 'STREAM_RECONNECT_MAX_MS', 'ESPERA_ALHEIO_MS', 'RECEIPT_TTL_MS',
    'ROUNDS_TTL_MS', 'ORPHAN_AFTER_MS', 'DAILY_ROUNDS_MAX', 'OUTBOX_BATCH', 'OUTBOX_MAX_REJEICOES', 'STREAM_IDLE_MS',
    'FAXINA_MS', 'FAXINA_MAX_PRS']) {
    assert.equal(typeof SYNC[k], 'number', k);
    assert.ok(Number.isFinite(SYNC[k]) && SYNC[k] > 0, k);
  }
  assert.equal(SYNC.PRESENCE_TICK_MS, 5 * 60000);
  assert.equal(SYNC.RECEIPT_TTL_MS, 180 * TEMPOS.DIA_MS);
  assert.equal(SYNC.ROUNDS_TTL_MS, 8 * TEMPOS.DIA_MS);
  assert.ok(SYNC.STREAM_RECONNECT_MS < SYNC.STREAM_RECONNECT_MAX_MS);
  // o banco manda keep-alive a cada ~30 s: a vigia tolera perder dois antes de derrubar
  assert.equal(SYNC.STREAM_IDLE_MS, 90 * 1000);
  assert.equal(SYNC.FAXINA_MS, TEMPOS.DIA_MS, 'uma faxina de retenção por dia');
  assert.equal(SYNC.FAXINA_MAX_PRS, 200);
  // a remoção antecipada de recibo por ausência do panorama saiu do MVP (D17): a
  // expiração de 180 dias cobre, e a constante sem uso não pode ficar sugerindo o contrário
  assert.equal(SYNC.PRUNE_STRIKES, undefined);
});

test('SYNC: textos de infra', () => {
  for (const k of ['IDENTITY_TOOLKIT_URL', 'SECURE_TOKEN_URL', 'CREDENTIALS_FILE', 'DEVICE_FILE', 'OUTBOX_FILE', 'DAY_TZ']) {
    assert.equal(typeof SYNC[k], 'string', k);
    assert.ok(SYNC[k].length > 0, k);
  }
  assert.match(SYNC.IDENTITY_TOOLKIT_URL, /^https:\/\//);
  assert.match(SYNC.SECURE_TOKEN_URL, /^https:\/\//);
  assert.equal(SYNC.DAY_TZ, 'America/Sao_Paulo');
});

test('SYNC viaja no export default e no nomeado', () => {
  assert.equal(constants.SYNC, SYNC);
});

function regras() {
  return JSON.parse(fs.readFileSync(REGRAS_PATH, 'utf8')).rules.users.$uid;
}

test('regras do banco: o teto de expiresAt do lease é SYNC.LEASE_TTL_MAX_MS', () => {
  const validate = regras().leases.$acct.$pr['.validate'];
  const tetos = [...validate.matchAll(/now \+ (\d+)/g)].map((m) => Number(m[1]));
  assert.deepEqual(tetos, [SYNC.LEASE_TTL_MAX_MS], 'um único teto, igual à constante');
  assert.ok(SYNC.LEASE_TTL_MS < SYNC.LEASE_TTL_MAX_MS, 'lease recém-escrito cabe no teto das regras');
});

test('regras do banco: dayPolicy das rodadas é SYNC.DAY_TZ', () => {
  const validate = regras().dailyRounds.$acct.$pr.$day['.validate'];
  const m = /newData\.child\('dayPolicy'\)\.val\(\) == '([^']+)'/.exec(validate);
  assert.ok(m, 'a regra confere dayPolicy');
  assert.equal(m[1], SYNC.DAY_TZ);
});

test('regras do banco: leitura e escrita só do próprio uid', () => {
  const u = regras();
  assert.equal(u['.read'], 'auth != null && auth.uid == $uid');
  assert.equal(u['.write'], 'auth != null && auth.uid == $uid');
});

test('firebase.json aponta as regras e fixa as portas do emulador', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'firebase', 'firebase.json'), 'utf8'));
  assert.equal(cfg.database.rules, 'database.rules.json');
  assert.equal(cfg.emulators.database.port, 9000);
  assert.equal(cfg.emulators.auth.port, 9099);
});

test('SYNC: o login do emulador aponta para a porta do Auth que o firebase.json fixa', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'firebase', 'firebase.json'), 'utf8'));
  const origem = `http://127.0.0.1:${cfg.emulators.auth.port}`;
  assert.equal(SYNC.AUTH_EMULATOR_IDENTITY_URL, `${origem}/identitytoolkit.googleapis.com/v1`);
  assert.equal(SYNC.AUTH_EMULATOR_TOKEN_URL, `${origem}/securetoken.googleapis.com/v1/token`);
});
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('test/sync-constants.test.js')).digest('hex').slice(0,16))"
```

Esperado: `ae2cec6507a0d821`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

Crie `test/sync-errors.test.js` com EXATAMENTE este conteúdo:

```js
// lib/sync/errors.js: a taxonomia de falha da sincronização entre dispositivos.
// Mesmo motivo de lib/jira/errors.js: quem chama decide (esperar, pedir login de
// novo, avisar) por um código estável, nunca por regex em cima do texto do Firebase.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import errors, { SYNC_CODES, MOTIVOS, SyncError, codeFromStatus, codeFromIdentityMessage, motivoDe } from '../lib/sync/errors.js';

test('SYNC_CODES: os doze códigos do contrato, cada um com frase própria', () => {
  assert.deepEqual(Object.values(SYNC_CODES).sort(), [
    'config_invalida', 'conflito', 'credencial_invalida', 'desligado', 'falha_interna', 'indisponivel',
    'muitas_tentativas', 'nao_autorizado', 'nao_encontrado', 'resposta_invalida', 'sem_credencial', 'timeout',
  ]);
  for (const code of Object.values(SYNC_CODES)) {
    assert.equal(typeof MOTIVOS[code], 'string', `${code} sem frase`);
    assert.equal(motivoDe(code), MOTIVOS[code]);
    assert.doesNotMatch(MOTIVOS[code], /\u2014/, `${code}: frase com travessão`);
  }
});

test('motivoDe: código desconhecido cai numa frase genérica, nunca undefined', () => {
  assert.equal(motivoDe('nao_existe'), 'falha desconhecida ao falar com o Firebase');
  assert.equal(motivoDe(undefined), 'falha desconhecida ao falar com o Firebase');
});

test('SyncError: é Error, carrega nome e código', () => {
  const e = new SyncError(SYNC_CODES.CONFLITO, 'x mudou');
  assert.ok(e instanceof Error);
  assert.equal(e.name, 'SyncError');
  assert.equal(e.code, 'conflito');
  assert.equal(e.message, 'x mudou');
});

test('codeFromStatus: o mapa do REST do banco', () => {
  assert.equal(codeFromStatus(401), 'nao_autorizado');
  assert.equal(codeFromStatus(404), 'nao_encontrado');
  assert.equal(codeFromStatus(412), 'conflito');
  for (const s of [500, 502, 503, 504, 599]) assert.equal(codeFromStatus(s), 'indisponivel', String(s));
  for (const s of [400, 403, 409, 418, 0, undefined]) assert.equal(codeFromStatus(s), 'resposta_invalida', String(s));
});

test('codeFromIdentityMessage: credencial recusada em todas as grafias do Identity Toolkit', () => {
  for (const m of ['EMAIL_NOT_FOUND', 'INVALID_PASSWORD', 'INVALID_LOGIN_CREDENTIALS', 'USER_DISABLED',
    'USER_NOT_FOUND', 'TOKEN_EXPIRED', 'INVALID_REFRESH_TOKEN']) {
    assert.equal(codeFromIdentityMessage(m), 'credencial_invalida', m);
  }
});

test('codeFromIdentityMessage: compara pelo prefixo antes de " : "', () => {
  assert.equal(codeFromIdentityMessage('TOO_MANY_ATTEMPTS_TRY_LATER : Too many unsuccessful login attempts.'), 'muitas_tentativas');
  assert.equal(codeFromIdentityMessage('USER_DISABLED : The user account has been disabled.'), 'credencial_invalida');
  assert.equal(codeFromIdentityMessage('TOO_MANY_ATTEMPTS_TRY_LATER'), 'muitas_tentativas');
});

test('codeFromIdentityMessage: chave web inválida é config, resto é resposta inesperada', () => {
  assert.equal(codeFromIdentityMessage('API key not valid. Please pass a valid API key.'), 'config_invalida');
  assert.equal(codeFromIdentityMessage('api KEY NOT valid'), 'config_invalida');
  assert.equal(codeFromIdentityMessage('OPERATION_NOT_ALLOWED'), 'resposta_invalida');
  assert.equal(codeFromIdentityMessage(''), 'resposta_invalida');
  assert.equal(codeFromIdentityMessage(undefined), 'resposta_invalida');
});

test('export default carrega o mesmo contrato dos nomeados', () => {
  assert.equal(errors.SyncError, SyncError);
  assert.equal(errors.codeFromStatus, codeFromStatus);
  assert.equal(errors.codeFromIdentityMessage, codeFromIdentityMessage);
  assert.equal(errors.motivoDe, motivoDe);
  assert.equal(errors.SYNC_CODES, SYNC_CODES);
});
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('test/sync-errors.test.js')).digest('hex').slice(0,16))"
```

Esperado: `018f4a91faec6839`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.
Este arquivo tem sequências de escape que a transcrição costuma normalizar sem querer. Se o hash não bater na segunda tentativa, PARE de transcrever e materialize-o com o comando abaixo, que grava os bytes exatos:

```bash
node -e "require('fs').writeFileSync('test/sync-errors.test.js', Buffer.from(process.argv[1],'base64'))" Ly8gbGliL3N5bmMvZXJyb3JzLmpzOiBhIHRheG9ub21pYSBkZSBmYWxoYSBkYSBzaW5jcm9uaXphw6fDo28gZW50cmUgZGlzcG9zaXRpdm9zLgovLyBNZXNtbyBtb3Rpdm8gZGUgbGliL2ppcmEvZXJyb3JzLmpzOiBxdWVtIGNoYW1hIGRlY2lkZSAoZXNwZXJhciwgcGVkaXIgbG9naW4gZGUKLy8gbm92bywgYXZpc2FyKSBwb3IgdW0gY8OzZGlnbyBlc3TDoXZlbCwgbnVuY2EgcG9yIHJlZ2V4IGVtIGNpbWEgZG8gdGV4dG8gZG8gRmlyZWJhc2UuCmltcG9ydCB7IHRlc3QgfSBmcm9tICdub2RlOnRlc3QnOwppbXBvcnQgYXNzZXJ0IGZyb20gJ25vZGU6YXNzZXJ0L3N0cmljdCc7CmltcG9ydCBlcnJvcnMsIHsgU1lOQ19DT0RFUywgTU9USVZPUywgU3luY0Vycm9yLCBjb2RlRnJvbVN0YXR1cywgY29kZUZyb21JZGVudGl0eU1lc3NhZ2UsIG1vdGl2b0RlIH0gZnJvbSAnLi4vbGliL3N5bmMvZXJyb3JzLmpzJzsKCnRlc3QoJ1NZTkNfQ09ERVM6IG9zIGRvemUgY8OzZGlnb3MgZG8gY29udHJhdG8sIGNhZGEgdW0gY29tIGZyYXNlIHByw7NwcmlhJywgKCkgPT4gewogIGFzc2VydC5kZWVwRXF1YWwoT2JqZWN0LnZhbHVlcyhTWU5DX0NPREVTKS5zb3J0KCksIFsKICAgICdjb25maWdfaW52YWxpZGEnLCAnY29uZmxpdG8nLCAnY3JlZGVuY2lhbF9pbnZhbGlkYScsICdkZXNsaWdhZG8nLCAnZmFsaGFfaW50ZXJuYScsICdpbmRpc3Bvbml2ZWwnLAogICAgJ211aXRhc190ZW50YXRpdmFzJywgJ25hb19hdXRvcml6YWRvJywgJ25hb19lbmNvbnRyYWRvJywgJ3Jlc3Bvc3RhX2ludmFsaWRhJywgJ3NlbV9jcmVkZW5jaWFsJywgJ3RpbWVvdXQnLAogIF0pOwogIGZvciAoY29uc3QgY29kZSBvZiBPYmplY3QudmFsdWVzKFNZTkNfQ09ERVMpKSB7CiAgICBhc3NlcnQuZXF1YWwodHlwZW9mIE1PVElWT1NbY29kZV0sICdzdHJpbmcnLCBgJHtjb2RlfSBzZW0gZnJhc2VgKTsKICAgIGFzc2VydC5lcXVhbChtb3Rpdm9EZShjb2RlKSwgTU9USVZPU1tjb2RlXSk7CiAgICBhc3NlcnQuZG9lc05vdE1hdGNoKE1PVElWT1NbY29kZV0sIC9cdTIwMTQvLCBgJHtjb2RlfTogZnJhc2UgY29tIHRyYXZlc3PDo29gKTsKICB9Cn0pOwoKdGVzdCgnbW90aXZvRGU6IGPDs2RpZ28gZGVzY29uaGVjaWRvIGNhaSBudW1hIGZyYXNlIGdlbsOpcmljYSwgbnVuY2EgdW5kZWZpbmVkJywgKCkgPT4gewogIGFzc2VydC5lcXVhbChtb3Rpdm9EZSgnbmFvX2V4aXN0ZScpLCAnZmFsaGEgZGVzY29uaGVjaWRhIGFvIGZhbGFyIGNvbSBvIEZpcmViYXNlJyk7CiAgYXNzZXJ0LmVxdWFsKG1vdGl2b0RlKHVuZGVmaW5lZCksICdmYWxoYSBkZXNjb25oZWNpZGEgYW8gZmFsYXIgY29tIG8gRmlyZWJhc2UnKTsKfSk7Cgp0ZXN0KCdTeW5jRXJyb3I6IMOpIEVycm9yLCBjYXJyZWdhIG5vbWUgZSBjw7NkaWdvJywgKCkgPT4gewogIGNvbnN0IGUgPSBuZXcgU3luY0Vycm9yKFNZTkNfQ09ERVMuQ09ORkxJVE8sICd4IG11ZG91Jyk7CiAgYXNzZXJ0Lm9rKGUgaW5zdGFuY2VvZiBFcnJvcik7CiAgYXNzZXJ0LmVxdWFsKGUubmFtZSwgJ1N5bmNFcnJvcicpOwogIGFzc2VydC5lcXVhbChlLmNvZGUsICdjb25mbGl0bycpOwogIGFzc2VydC5lcXVhbChlLm1lc3NhZ2UsICd4IG11ZG91Jyk7Cn0pOwoKdGVzdCgnY29kZUZyb21TdGF0dXM6IG8gbWFwYSBkbyBSRVNUIGRvIGJhbmNvJywgKCkgPT4gewogIGFzc2VydC5lcXVhbChjb2RlRnJvbVN0YXR1cyg0MDEpLCAnbmFvX2F1dG9yaXphZG8nKTsKICBhc3NlcnQuZXF1YWwoY29kZUZyb21TdGF0dXMoNDA0KSwgJ25hb19lbmNvbnRyYWRvJyk7CiAgYXNzZXJ0LmVxdWFsKGNvZGVGcm9tU3RhdHVzKDQxMiksICdjb25mbGl0bycpOwogIGZvciAoY29uc3QgcyBvZiBbNTAwLCA1MDIsIDUwMywgNTA0LCA1OTldKSBhc3NlcnQuZXF1YWwoY29kZUZyb21TdGF0dXMocyksICdpbmRpc3Bvbml2ZWwnLCBTdHJpbmcocykpOwogIGZvciAoY29uc3QgcyBvZiBbNDAwLCA0MDMsIDQwOSwgNDE4LCAwLCB1bmRlZmluZWRdKSBhc3NlcnQuZXF1YWwoY29kZUZyb21TdGF0dXMocyksICdyZXNwb3N0YV9pbnZhbGlkYScsIFN0cmluZyhzKSk7Cn0pOwoKdGVzdCgnY29kZUZyb21JZGVudGl0eU1lc3NhZ2U6IGNyZWRlbmNpYWwgcmVjdXNhZGEgZW0gdG9kYXMgYXMgZ3JhZmlhcyBkbyBJZGVudGl0eSBUb29sa2l0JywgKCkgPT4gewogIGZvciAoY29uc3QgbSBvZiBbJ0VNQUlMX05PVF9GT1VORCcsICdJTlZBTElEX1BBU1NXT1JEJywgJ0lOVkFMSURfTE9HSU5fQ1JFREVOVElBTFMnLCAnVVNFUl9ESVNBQkxFRCcsCiAgICAnVVNFUl9OT1RfRk9VTkQnLCAnVE9LRU5fRVhQSVJFRCcsICdJTlZBTElEX1JFRlJFU0hfVE9LRU4nXSkgewogICAgYXNzZXJ0LmVxdWFsKGNvZGVGcm9tSWRlbnRpdHlNZXNzYWdlKG0pLCAnY3JlZGVuY2lhbF9pbnZhbGlkYScsIG0pOwogIH0KfSk7Cgp0ZXN0KCdjb2RlRnJvbUlkZW50aXR5TWVzc2FnZTogY29tcGFyYSBwZWxvIHByZWZpeG8gYW50ZXMgZGUgIiA6ICInLCAoKSA9PiB7CiAgYXNzZXJ0LmVxdWFsKGNvZGVGcm9tSWRlbnRpdHlNZXNzYWdlKCdUT09fTUFOWV9BVFRFTVBUU19UUllfTEFURVIgOiBUb28gbWFueSB1bnN1Y2Nlc3NmdWwgbG9naW4gYXR0ZW1wdHMuJyksICdtdWl0YXNfdGVudGF0aXZhcycpOwogIGFzc2VydC5lcXVhbChjb2RlRnJvbUlkZW50aXR5TWVzc2FnZSgnVVNFUl9ESVNBQkxFRCA6IFRoZSB1c2VyIGFjY291bnQgaGFzIGJlZW4gZGlzYWJsZWQuJyksICdjcmVkZW5jaWFsX2ludmFsaWRhJyk7CiAgYXNzZXJ0LmVxdWFsKGNvZGVGcm9tSWRlbnRpdHlNZXNzYWdlKCdUT09fTUFOWV9BVFRFTVBUU19UUllfTEFURVInKSwgJ211aXRhc190ZW50YXRpdmFzJyk7Cn0pOwoKdGVzdCgnY29kZUZyb21JZGVudGl0eU1lc3NhZ2U6IGNoYXZlIHdlYiBpbnbDoWxpZGEgw6kgY29uZmlnLCByZXN0byDDqSByZXNwb3N0YSBpbmVzcGVyYWRhJywgKCkgPT4gewogIGFzc2VydC5lcXVhbChjb2RlRnJvbUlkZW50aXR5TWVzc2FnZSgnQVBJIGtleSBub3QgdmFsaWQuIFBsZWFzZSBwYXNzIGEgdmFsaWQgQVBJIGtleS4nKSwgJ2NvbmZpZ19pbnZhbGlkYScpOwogIGFzc2VydC5lcXVhbChjb2RlRnJvbUlkZW50aXR5TWVzc2FnZSgnYXBpIEtFWSBOT1QgdmFsaWQnKSwgJ2NvbmZpZ19pbnZhbGlkYScpOwogIGFzc2VydC5lcXVhbChjb2RlRnJvbUlkZW50aXR5TWVzc2FnZSgnT1BFUkFUSU9OX05PVF9BTExPV0VEJyksICdyZXNwb3N0YV9pbnZhbGlkYScpOwogIGFzc2VydC5lcXVhbChjb2RlRnJvbUlkZW50aXR5TWVzc2FnZSgnJyksICdyZXNwb3N0YV9pbnZhbGlkYScpOwogIGFzc2VydC5lcXVhbChjb2RlRnJvbUlkZW50aXR5TWVzc2FnZSh1bmRlZmluZWQpLCAncmVzcG9zdGFfaW52YWxpZGEnKTsKfSk7Cgp0ZXN0KCdleHBvcnQgZGVmYXVsdCBjYXJyZWdhIG8gbWVzbW8gY29udHJhdG8gZG9zIG5vbWVhZG9zJywgKCkgPT4gewogIGFzc2VydC5lcXVhbChlcnJvcnMuU3luY0Vycm9yLCBTeW5jRXJyb3IpOwogIGFzc2VydC5lcXVhbChlcnJvcnMuY29kZUZyb21TdGF0dXMsIGNvZGVGcm9tU3RhdHVzKTsKICBhc3NlcnQuZXF1YWwoZXJyb3JzLmNvZGVGcm9tSWRlbnRpdHlNZXNzYWdlLCBjb2RlRnJvbUlkZW50aXR5TWVzc2FnZSk7CiAgYXNzZXJ0LmVxdWFsKGVycm9ycy5tb3Rpdm9EZSwgbW90aXZvRGUpOwogIGFzc2VydC5lcXVhbChlcnJvcnMuU1lOQ19DT0RFUywgU1lOQ19DT0RFUyk7Cn0pOwo=
```

Depois rode a conferência de novo: agora ela bate.

- [ ] **Passo 2: rodar e ver falhar**

```bash
node --test --test-force-exit test/sync-constants.test.js test/sync-errors.test.js
```

Esperado: FALHA. SYNC não é exportado de lib/constants.js.

- [ ] **Passo 3: implementar**

Crie `firebase/README.md` com EXATAMENTE este conteúdo:

````markdown
# Sincronização entre dispositivos: configuração do Firebase

Esta pasta guarda o que o Farol precisa do lado do Firebase para coordenar análises e
consolidar consumo entre os seus aparelhos:

| arquivo | papel |
|---|---|
| `database.rules.json` | regras do Realtime Database: cada usuário só lê e escreve a própria árvore, lease tem validade máxima e rodada do dia exige o fuso de Brasília |
| `firebase.json` | aponta as regras e fixa as portas do emulador (banco em 9000, Auth em 9099) |

O recurso é opcional e nasce desligado. Com ele desligado, nada desta pasta é usado e o
Farol se comporta exatamente como antes.

O Farol fala com o Firebase só por REST, sem SDK e sem pacote npm. As regras são defesa
em profundidade: o cliente já faz a coordenação certa sem elas (lease e recibo usam
escrita condicionada por ETag), mas são elas que impedem outro usuário de ler a sua
árvore e um relógio adiantado de criar um lease que nunca vence.

## O que sobe para o banco

- **Presença do aparelho** (`users/{uid}/devices/{deviceId}`): nome, sistema, versão do
  Farol e o horário da última vez em que o aparelho foi visto (carimbo do servidor).
- **Coordenação de análise** (`leases`, `receipts`, `dailyRounds`): quem está revisando
  qual PR agora, o que já foi concluído e quantas rodadas automáticas o PR teve no dia.
- **Eventos de consumo** (`usageEvents`), só com a consolidação ligada: tokens, custo,
  modelo e tipo de cada sessão.

Conta do GitHub e PR sobem só como hash SHA-256. Título, repositório, número de PR e
texto de revisão nunca saem do aparelho.

## Configurar (uma vez, no console do Firebase)

1. Em <https://console.firebase.google.com>, crie um projeto (o plano gratuito basta).
2. Em **Realtime Database**, crie o banco em **modo bloqueado**. Anote a URL que aparece
   no topo da aba Dados. Ela tem uma destas formas:
   - `https://<seu-projeto>-default-rtdb.<região>.firebasedatabase.app`
   - `https://<seu-projeto>-default-rtdb.firebaseio.com`
3. Na aba **Regras** do mesmo banco, apague o conteúdo e cole o arquivo
   `database.rules.json` desta pasta inteiro. Clique em **Publicar**.
   Alternativa pela linha de comando, com o `firebase-tools` instalado na sua máquina
   (ele NÃO entra no repositório do Farol), a partir desta pasta:

   ```
   firebase deploy --only database --project <seu-projeto>
   ```

4. Em **Authentication**, aba **Método de login**, habilite **E-mail/senha**.
5. Na aba **Usuários**, clique em **Adicionar usuário** e crie UM usuário com o seu
   e-mail e uma senha. É o mesmo usuário em todos os seus aparelhos: é isso que faz os
   aparelhos se enxergarem.
6. Em **Configurações do projeto** (engrenagem), aba **Geral**, copie a **Chave de API
   da Web** e o **ID do projeto**. A chave web não é segredo (a documentação do Firebase
   diz isso): quem protege os dados são as regras do passo 3 e o login do passo 5.

## Configurar em cada aparelho (no Farol)

1. Abra **Sistema > Sincronização entre dispositivos**.
2. Cole a chave web, a URL do banco e o ID do projeto. Dê um nome ao aparelho (é o que
   os outros aparelhos vão mostrar; vazio usa o nome da máquina).
3. Ligue a sincronização e salve.
4. Entre com o e-mail e a senha do usuário criado no passo 5 acima.

A senha é usada uma vez, no login, e descartada. O que fica no aparelho é só o token de
renovação, em `~/.farol/sync-credentials.json`, fora do `config.json` e com permissão
restrita ao seu usuário. A identidade do aparelho fica em
`~/.farol/workspace/state/sync-device.json`.

Coordenação de análises e consolidação de consumo são dois interruptores separados, e
os dois dependem da chave geral estar ligada.

## Sair, desligar e apagar

- **Sair deste aparelho** apaga o token de renovação local. O aparelho para de falar com
  o Firebase até um novo login.
- **Desligar a sincronização** para tudo e não apaga nada, nem local nem remoto.
- **Apagar dados sincronizados** apaga a sua árvore inteira no banco
  (`users/{uid}`). Credencial e identidade locais ficam; se o aparelho continuar ligado,
  a presença dele volta a aparecer no próximo ciclo.

Para parar de usar o recurso de vez: apague os dados sincronizados, desligue a
sincronização em cada aparelho e, se quiser, apague o projeto no console do Firebase.

## Validação manual com o emulador (Fase 5)

O CI do Farol não roda o emulador (ele exige Java e o `firebase-tools`, e o Farol não
adiciona dependência ao repositório). A bateria automática usa um dublê em processo
(`test/helpers/fake-rtdb.js` e `test/helpers/fake-identity.js`). Esta validação é
manual, feita uma vez por mudança relevante nas regras ou no protocolo.

Pré-requisitos, instalados na sua máquina e fora do repositório: o `firebase-tools`
(`npm install -g firebase-tools`) e o Java na versão que ele pedir ao subir os emuladores.

### Parte 1: as regras no emulador

1. A partir desta pasta, suba os emuladores do banco e do Auth:

   ```
   firebase emulators:start --only database,auth --project farol-local
   ```

2. Crie o usuário de teste no emulador de Auth (qualquer chave serve no emulador):

   ```
   curl -s -X POST "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=chave-local" \
     -H "Content-Type: application/json" \
     -d '{"email":"teste@exemplo.com","password":"senha-de-teste","returnSecureToken":true}'
   ```

   Guarde o `idToken` e o `localId` (o uid) da resposta.

3. Confira as regras com o banco do emulador (`ns=farol-local` escolhe o banco do
   projeto local):
   - escrita em `users/<uid>/devices/x` com `?auth=<idToken>` é aceita;
   - a mesma escrita em `users/<outro-uid>/devices/x` é recusada;
   - um lease com `expiresAt` acima de agora mais 300000 ms é recusado;
   - um nó de `dailyRounds` com `dayPolicy` diferente de `America/Sao_Paulo` é recusado.

   Exemplo de escrita:

   ```
   curl -s -X PUT "http://127.0.0.1:9000/users/<uid>/devices/x.json?ns=farol-local&auth=<idToken>" \
     -H "Content-Type: application/json" -d '{"name":"teste"}'
   ```

### Parte 2: dois Farols no mesmo usuário

Roda inteira offline, contra os emuladores da Parte 1. O login segue o banco: quando a
URL do banco é a do emulador (http em `127.0.0.1` ou `localhost`), o Farol faz login e
renova o token no emulador de Auth (`127.0.0.1:9099`, a porta que o `firebase.json`
fixa) em vez do Auth de produção. Com qualquer outra URL o login vai para o Firebase de
verdade.

1. Prepare duas pastas de dados separadas, uma por instância, cada uma com um
   `config.json` que troca a porta e desliga a revisão automática. Primeira instância:

   ```
   {"port": 47180, "autoReview": false}
   ```

   Segunda instância: o mesmo, com `"port": 47181`.

2. Suba cada instância com a pasta dela (`FAROL_HOME=<pasta-1> node server.js` e
   `FAROL_HOME=<pasta-2> node server.js`, em terminais separados).
3. Em cada uma, configure a sincronização como na seção "Configurar em cada aparelho",
   com estes valores e nomes de aparelho diferentes:
   - chave web: `chave-local` (o emulador aceita qualquer chave);
   - URL do banco: `http://127.0.0.1:9000`;
   - ID do projeto: `farol-local`.
4. Faça login nas duas com o usuário criado no passo 2 da Parte 1 e confira:
   - as duas aparecem na lista de aparelhos uma da outra;
   - sair de uma apaga só a credencial dela;
   - desligar uma não apaga nada no banco;
   - apagar os dados sincronizados esvazia a árvore do usuário no banco.
````

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('firebase/README.md')).digest('hex').slice(0,16))"
```

Esperado: `d0718484b96a64f4`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

Crie `firebase/database.rules.json` com EXATAMENTE este conteúdo:

```json
{
  "rules": {
    "users": {
      "$uid": {
        ".read": "auth != null && auth.uid == $uid",
        ".write": "auth != null && auth.uid == $uid",
        "leases": {
          "$acct": {
            "$pr": {
              ".validate": "newData.hasChildren(['leaseId', 'deviceId', 'operationKind', 'expiresAt']) && newData.child('expiresAt').isNumber() && newData.child('expiresAt').val() > now && newData.child('expiresAt').val() <= now + 300000 && (!data.exists() || data.child('expiresAt').val() < now || data.child('leaseId').val() == newData.child('leaseId').val())"
            }
          }
        },
        "receipts": {
          "$acct": {
            "$pr": {
              "$fp": {
                ".validate": "newData.hasChildren(['operationKind', 'materialVersion', 'deviceId', 'completedAt', 'outcome', 'publicationState']) && newData.child('completedAt').isNumber()"
              }
            }
          }
        },
        "dailyRounds": {
          "$acct": {
            "$pr": {
              "$day": {
                ".validate": "$day.matches(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/) && newData.child('dayPolicy').val() == 'America/Sao_Paulo'"
              }
            }
          }
        },
        "usageEvents": {
          "$device": {
            "$event": {
              ".validate": "newData.hasChildren(['at', 'kind', 'costUsd']) && newData.child('at').isNumber()"
            }
          }
        }
      }
    }
  }
}
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('firebase/database.rules.json')).digest('hex').slice(0,16))"
```

Esperado: `76d158cb9c490e8c`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

Crie `firebase/firebase.json` com EXATAMENTE este conteúdo:

```json
{
  "database": {
    "rules": "database.rules.json"
  },
  "emulators": {
    "database": {
      "port": 9000
    },
    "auth": {
      "port": 9099
    },
    "ui": {
      "enabled": false
    },
    "singleProjectMode": true
  }
}
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('firebase/firebase.json')).digest('hex').slice(0,16))"
```

Esperado: `2e0c9743cc03347f`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

Em `lib/constants.js`, aplique as 1 substituições abaixo, NA ORDEM. Cada trecho "localize" aparece exatamente uma vez no arquivo no momento em que você aplica aquela substituição; copie-o sem mudar espaço nem acento.

1. Localize:

```js
  MCP_SERVER_NAME: 'farol-jira',
};

export default { DEFAULT_PORT, TEMPOS, JIRA };
export { DEFAULT_PORT, TEMPOS, JIRA };
```

   Troque por:

```js
  MCP_SERVER_NAME: 'farol-jira',
};

// Sincronização entre dispositivos (Firebase RTDB por REST). Nomes MAIÚSCULOS de
// propósito: `tempoMagico` casa `ttl:`/`timeout:` minúsculos, e o lar do número é aqui.
// LEASE_TTL_MS < LEASE_TTL_MAX_MS: as regras do banco (firebase/database.rules.json)
// recusam expiresAt acima de now + LEASE_TTL_MAX_MS, então um relógio adiantado no
// cliente não produz lease imortal.
const DIA_MS = 24 * HORA_MS;
const SYNC = {
  LEASE_TTL_MS: 120 * 1000,          // validade de um lease sem renovação
  LEASE_TTL_MAX_MS: 300 * 1000,      // teto que as regras aceitam para expiresAt - now
  HEARTBEAT_MS: 30 * 1000,           // renovação do lease (bem abaixo do TTL)
  PRESENCE_TICK_MS: HORA_MS / 12,    // carimbo de lastSeenAt no máximo a cada 5 min
  TOKEN_MARGIN_MS: HORA_MS / 12,     // renova o ID token 5 min antes de vencer
  REQUEST_TIMEOUT_MS: 15 * 1000,     // teto de UMA chamada REST
  STREAM_RECONNECT_MS: 5 * 1000,     // espera mínima antes de reabrir o SSE
  STREAM_RECONNECT_MAX_MS: HORA_MS / 60, // teto do backoff do SSE (1 min)
  STREAM_IDLE_MS: 90 * 1000,         // sem nada no SSE por isto (o banco manda keep-alive a cada ~30 s), a conexão está morta
  ESPERA_ALHEIO_MS: 120 * 1000,      // quanto o toReview pula um PR cujo lease é de outro aparelho
  RECEIPT_TTL_MS: 180 * DIA_MS,      // rede de segurança dos recibos
  ROUNDS_TTL_MS: 8 * DIA_MS,         // poda de dailyRounds
  FAXINA_MS: DIA_MS,                 // retenção do banco (dailyRounds velho, recibo vencido) roda uma vez por dia
  FAXINA_MAX_PRS: 200,               // nós de PR visitados por faxina, pra ela nunca segurar o tick
  ORPHAN_AFTER_MS: 7 * DIA_MS,       // recibo pending/failed de aparelho sem atividade vira "órfão" na tela
  DAILY_ROUNDS_MAX: 3,               // fonte única do teto de rodadas automáticas por PR/dia (review.js lê daqui)
  OUTBOX_BATCH: 50,                  // eventos por PATCH multi-path
  OUTBOX_MAX_REJEICOES: 5,           // recusa do próprio evento (400/413) repetida move para "rejeitado"
  IDENTITY_TOOLKIT_URL: 'https://identitytoolkit.googleapis.com/v1',
  SECURE_TOKEN_URL: 'https://securetoken.googleapis.com/v1/token',
  // emulador do Auth (porta fixada em firebase/firebase.json): ele serve as duas APIs
  // com o host de produção como prefixo de caminho. Só vale com o banco do emulador.
  AUTH_EMULATOR_IDENTITY_URL: 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1',
  AUTH_EMULATOR_TOKEN_URL: 'http://127.0.0.1:9099/securetoken.googleapis.com/v1/token',
  CREDENTIALS_FILE: 'sync-credentials.json', // em ~/.farol/, FORA do config.json
  DEVICE_FILE: 'sync-device.json',           // em state/
  OUTBOX_FILE: 'sync-outbox.json',           // em state/
  DAY_TZ: 'America/Sao_Paulo',               // dia canônico do teto compartilhado
};

export default { DEFAULT_PORT, TEMPOS, JIRA, SYNC };
export { DEFAULT_PORT, TEMPOS, JIRA, SYNC };
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('lib/constants.js')).digest('hex').slice(0,16))"
```

Esperado: `9ce526b5111a49cc`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

Crie `lib/sync/errors.js` com EXATAMENTE este conteúdo:

```js
// Taxonomia de falha da sincronização entre dispositivos. Existe pelo mesmo motivo
// de lib/jira/errors.js: quem chama (esperar, pedir login de novo, avisar na tela)
// decide por um código estável, nunca por regex em cima da mensagem do Firebase.
//
// `desligado` e `sem_credencial` não são falha do Firebase: são o recurso que
// ninguém ligou ou o login que ninguém fez. `falha_interna` é o Farol montando a
// operação errado, e apresentar isso como indisponibilidade mandaria quem opera
// investigar o fornecedor errado.
//
// Todo código novo entra nos DOIS objetos, senão a frase nunca aparece.
const SYNC_CODES = {
  DESLIGADO: 'desligado',
  SEM_CREDENCIAL: 'sem_credencial',
  CONFIG_INVALIDA: 'config_invalida',
  CREDENCIAL_INVALIDA: 'credencial_invalida',
  MUITAS_TENTATIVAS: 'muitas_tentativas',
  NAO_AUTORIZADO: 'nao_autorizado',
  NAO_ENCONTRADO: 'nao_encontrado',
  CONFLITO: 'conflito',
  TIMEOUT: 'timeout',
  INDISPONIVEL: 'indisponivel',
  RESPOSTA_INVALIDA: 'resposta_invalida',
  FALHA_INTERNA: 'falha_interna',
};

const MOTIVOS = {
  desligado: 'a sincronização entre dispositivos está desligada',
  sem_credencial: 'nenhum login do Firebase foi feito neste aparelho',
  config_invalida: 'a chave web ou a URL do banco estão incompletas ou inválidas',
  credencial_invalida: 'o Firebase recusou o e-mail e a senha, ou o login expirou; entre de novo',
  muitas_tentativas: 'o Firebase bloqueou tentativas de login por excesso; aguarde e tente de novo',
  nao_autorizado: 'o Firebase recusou a operação (token vencido ou regras do banco)',
  nao_encontrado: 'o banco informado não existe',
  conflito: 'outro aparelho alterou o mesmo registro antes desta escrita',
  timeout: 'o Firebase não respondeu no tempo esperado',
  indisponivel: 'o Firebase está indisponível ou sem rede',
  resposta_invalida: 'o Firebase respondeu em formato inesperado',
  falha_interna: 'o Farol falhou ao montar a operação, não foi o Firebase',
};

class SyncError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SyncError';
    this.code = code;
  }
}

// O RTDB responde 401 tanto para token vencido quanto para regra que recusa a
// escrita; 412 é o CAS por ETag que perdeu a corrida.
function codeFromStatus(status) {
  if (status === 401) return SYNC_CODES.NAO_AUTORIZADO;
  if (status === 404) return SYNC_CODES.NAO_ENCONTRADO;
  if (status === 412) return SYNC_CODES.CONFLITO;
  if (status >= 500 && status <= 599) return SYNC_CODES.INDISPONIVEL;
  return SYNC_CODES.RESPOSTA_INVALIDA;
}

const CREDENCIAL_RECUSADA = new Set([
  'EMAIL_NOT_FOUND', 'INVALID_PASSWORD', 'INVALID_LOGIN_CREDENTIALS', 'USER_DISABLED',
  'USER_NOT_FOUND', 'TOKEN_EXPIRED', 'INVALID_REFRESH_TOKEN',
]);

// O Identity Toolkit às vezes acrescenta prosa depois do código
// ("TOO_MANY_ATTEMPTS_TRY_LATER : Too many unsuccessful..."), então a comparação
// é pelo prefixo; a prosa muda de versão para versão e o código não.
function codeFromIdentityMessage(msg) {
  const texto = String(msg || '');
  const prefixo = texto.split(' : ')[0].trim();
  if (CREDENCIAL_RECUSADA.has(prefixo)) return SYNC_CODES.CREDENCIAL_INVALIDA;
  if (prefixo === 'TOO_MANY_ATTEMPTS_TRY_LATER') return SYNC_CODES.MUITAS_TENTATIVAS;
  if (/API key not valid/i.test(texto)) return SYNC_CODES.CONFIG_INVALIDA;
  return SYNC_CODES.RESPOSTA_INVALIDA;
}

function motivoDe(code) {
  return MOTIVOS[code] || 'falha desconhecida ao falar com o Firebase';
}

const MOTIVO_CONECTANDO = 'a conexão com o Firebase ainda está sendo estabelecida';

// Resposta única para "não dá pra falar com o banco agora". Estava duplicada em
// lib/engine/sync.js e lib/engine/sync-usage.js, e as duas respondiam sem_credencial
// no estado 'conectando': a quem ACABOU de entrar, a tela dizia "nenhum login do
// Firebase foi feito neste aparelho" e mandava entrar de novo numa conta em que ele
// já estava. Conexão em andamento é indisponibilidade passageira, não falta de login.
function falhaSemConexao(rt) {
  const r = rt || {};
  const code = r.lastError && r.lastError.code;
  if (code) return { ok: false, code, motivo: motivoDe(code) };
  if (r.status === 'conectando') return { ok: false, code: SYNC_CODES.INDISPONIVEL, motivo: MOTIVO_CONECTANDO };
  return { ok: false, code: SYNC_CODES.SEM_CREDENCIAL, motivo: motivoDe(SYNC_CODES.SEM_CREDENCIAL) };
}

export default { SYNC_CODES, MOTIVOS, SyncError, codeFromStatus, codeFromIdentityMessage, motivoDe, falhaSemConexao };
export { SYNC_CODES, MOTIVOS, SyncError, codeFromStatus, codeFromIdentityMessage, motivoDe, falhaSemConexao };
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('lib/sync/errors.js')).digest('hex').slice(0,16))"
```

Esperado: `a3e7a3df6e485de3`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

- [ ] **Passo 4: rodar e ver passar**

```bash
node --test --test-force-exit test/sync-constants.test.js test/sync-errors.test.js
```

Esperado: PASSA, 0 falhas.

- [ ] **Passo 5: gate e commit**

```bash
npm run check && npm run lint && npm test
```

Esperado: `fail 0` e `gate de qualidade: sem regressão`. Se algo falhar, PARE e relate; não mexa em outro arquivo para fazer passar.

```bash
git add firebase/README.md firebase/database.rules.json firebase/firebase.json lib/constants.js lib/sync/errors.js test/sync-constants.test.js test/sync-errors.test.js
git commit -m "feat(sync): constantes de infra, taxonomia de erros e regras do Realtime Database"
```


### Tarefa T02: Chaves: hash de conta e PR, fingerprint e dia de Brasília

O nome do repositório e o título do PR NUNCA sobem para o banco. O que sobe é hash, e é aqui que ele é derivado, junto do fingerprint da operação e do dia canônico de Brasília, que é o corte compartilhado do teto diário entre aparelhos em fusos diferentes.

**Arquivos:**
- Criar: `lib/sync/keys.js`
- Criar: `test/sync-keys.test.js`

- [ ] **Passo 1: escrever o teste**

Crie `test/sync-keys.test.js` com EXATAMENTE este conteúdo:

```js
// lib/sync/keys.js: as chaves derivadas que sobem para o banco. Texto legível de
// PR ou de conta nunca sobe (só o hash), e o dia do teto compartilhado é o civil de
// Brasília, igual nos dois aparelhos, qualquer que seja o fuso de cada processo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import keys, {
  sha256Hex, accountHash, canonicalPrKey, prHash, operationFingerprint,
  brasiliaDay, nextBrasiliaDayStartMs, eventIdFor, novoId, assertRtdbKey,
} from '../lib/sync/keys.js';
import { SyncError } from '../lib/sync/errors.js';

const HEX64 = /^[0-9a-f]{64}$/;
const sha = (t) => createHash('sha256').update(t).digest('hex');

test('sha256Hex: 64 hex, igual ao node:crypto', () => {
  assert.match(sha256Hex('x'), HEX64);
  assert.equal(sha256Hex('abc'), sha('abc'));
});

test('accountHash: prefixo acct:, login aparado e em minúsculas', () => {
  assert.equal(accountHash('Fulano'), sha('acct:fulano'));
  assert.equal(accountHash('  FULANO '), accountHash('fulano'));
  assert.equal(accountHash(undefined), sha('acct:'));
});

test('canonicalPrKey: owner/repo em minúsculas e número inteiro', () => {
  assert.equal(canonicalPrKey('Acme/Repo#7'), 'acme/repo#7');
  assert.equal(canonicalPrKey('acme/repo#007'), 'acme/repo#7');
  for (const ruim of ['', 'acme/repo', 'acme#7', 'a/b/c#1', 'acme/repo#x', 'acme /repo#1', null, undefined]) {
    assert.equal(canonicalPrKey(ruim), '', String(ruim));
  }
});

test('prHash: mesma chave para grafias diferentes do mesmo PR; vazio quando não é PR', () => {
  assert.equal(prHash('Acme/Repo#7'), prHash('acme/repo#7'));
  assert.equal(prHash('acme/repo#7'), sha('pr:acme/repo#7'));
  assert.notEqual(prHash('acme/repo#7'), prHash('acme/repo#8'));
  assert.equal(prHash('lixo'), '');
});

test('operationFingerprint: kind + 32 hex do sha da versão material', () => {
  const fp = operationFingerprint('review', 'abc123');
  assert.equal(fp, `review_${sha('abc123').slice(0, 32)}`);
  assert.match(operationFingerprint('self', 'x'), /^self_[0-9a-f]{32}$/);
  assert.match(operationFingerprint('pushback', 'm1'), /^pushback_[0-9a-f]{32}$/);
  assert.notEqual(operationFingerprint('review', 'a'), operationFingerprint('self', 'a'));
});

test('operationFingerprint: kind inválido ou versão vazia lança SyncError de falha interna', () => {
  for (const kind of ['chat', 'tool', '', undefined, 'Review']) {
    assert.throws(() => operationFingerprint(kind, 'abc'), (e) => e instanceof SyncError && e.code === 'falha_interna', String(kind));
  }
  for (const mv of ['', null, undefined]) {
    assert.throws(() => operationFingerprint('review', mv), (e) => e instanceof SyncError && e.code === 'falha_interna', String(mv));
  }
});

test('brasiliaDay: a virada do dia é às 03:00 UTC (UTC-3), não à meia-noite UTC', () => {
  assert.equal(brasiliaDay(Date.UTC(2026, 8, 10, 2, 59, 59)), '2026-09-09');
  assert.equal(brasiliaDay(Date.UTC(2026, 8, 10, 3, 0, 0)), '2026-09-10');
  assert.equal(brasiliaDay(Date.UTC(2026, 8, 10, 3, 0, 0), 'UTC'), '2026-09-10');
  assert.equal(brasiliaDay(Date.UTC(2026, 8, 10, 2, 0, 0), 'UTC'), '2026-09-10');
});

test('nextBrasiliaDayStartMs: devolve exatamente o primeiro instante do dia seguinte', () => {
  const inicio = Date.UTC(2026, 8, 10, 3, 0, 0);
  assert.equal(nextBrasiliaDayStartMs(Date.parse('2026-09-09T15:00:00Z')), inicio);
  assert.equal(nextBrasiliaDayStartMs(Date.parse('2026-09-09T15:00:30.500Z')), inicio, 'fora do minuto redondo');
  assert.equal(nextBrasiliaDayStartMs(Date.UTC(2026, 8, 10, 2, 59, 59)), inicio, 'um segundo antes da virada');
  assert.equal(nextBrasiliaDayStartMs(inicio), Date.UTC(2026, 8, 11, 3, 0, 0), 'no instante da virada é o dia de depois');
  assert.equal(nextBrasiliaDayStartMs(Date.UTC(2026, 8, 9, 3, 0, 0) + 1), inicio);
});

test('nextBrasiliaDayStartMs: vale em outro fuso passado explicitamente', () => {
  assert.equal(nextBrasiliaDayStartMs(Date.UTC(2026, 8, 9, 15, 0, 0), 'UTC'), Date.UTC(2026, 8, 10, 0, 0, 0));
});

const SESSAO = {
  at: 1757500000000, id: 's1', kind: 'review', ref: 'acme/repo#7', model: 'sonnet',
  inputTokens: 10, outputTokens: 20, cacheReadTokens: 3, cacheCreationTokens: 4, costUsd: 0.5,
};

test('eventIdFor: estável para os mesmos campos imutáveis', () => {
  assert.match(eventIdFor(SESSAO, 'dev-1'), HEX64);
  assert.equal(eventIdFor({ ...SESSAO }, 'dev-1'), eventIdFor(SESSAO, 'dev-1'));
  assert.equal(eventIdFor({ ...SESSAO, status: 'erro' }, 'dev-1'), eventIdFor(SESSAO, 'dev-1'), 'status não entra: correção de desfecho reenvia o mesmo evento');
});

test('eventIdFor: sensível a cada token, ao custo, ao aparelho e à identidade da sessão', () => {
  const base = eventIdFor(SESSAO, 'dev-1');
  assert.notEqual(eventIdFor(SESSAO, 'dev-2'), base);
  for (const [k, v] of [['inputTokens', 11], ['outputTokens', 21], ['cacheReadTokens', 4], ['cacheCreationTokens', 5],
    ['costUsd', 0.51], ['at', SESSAO.at + 1], ['id', 's2'], ['kind', 'self'], ['ref', 'acme/repo#8'], ['model', 'opus']]) {
    assert.notEqual(eventIdFor({ ...SESSAO, [k]: v }, 'dev-1'), base, k);
  }
});

test('novoId: UUID v4 diferente a cada chamada', () => {
  const a = novoId();
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(novoId(), a);
});

test('assertRtdbKey: recusa os caracteres proibidos pelo RTDB, vazio e controle', () => {
  for (const ruim of ['a.b', 'a$b', 'a#b', 'a[b', 'a]b', 'a/b', '', 'a\u0000b', 'a\nb', 'a\u007fb', 'x'.repeat(769)]) {
    assert.throws(() => assertRtdbKey(ruim), (e) => e instanceof SyncError && e.code === 'falha_interna', JSON.stringify(ruim.slice(0, 10)));
  }
  assert.throws(() => assertRtdbKey('é'.repeat(385)), SyncError, '770 bytes em UTF-8 passam do teto mesmo com 385 caracteres');
});

test('assertRtdbKey: aceita hex, _ , - e o fingerprint', () => {
  for (const ok of [sha('x'), 'review_abc', 'a-b', '2026-09-10', operationFingerprint('review', 'h'), 'x'.repeat(768)]) {
    assert.doesNotThrow(() => assertRtdbKey(ok), ok.slice(0, 10));
  }
});

test('export default carrega o mesmo contrato dos nomeados', () => {
  assert.equal(keys.prHash, prHash);
  assert.equal(keys.brasiliaDay, brasiliaDay);
  assert.equal(keys.assertRtdbKey, assertRtdbKey);
});
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('test/sync-keys.test.js')).digest('hex').slice(0,16))"
```

Esperado: `8cbf723467193e9b`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.
Este arquivo tem sequências de escape que a transcrição costuma normalizar sem querer. Se o hash não bater na segunda tentativa, PARE de transcrever e materialize-o com o comando abaixo, que grava os bytes exatos:

```bash
node -e "require('fs').writeFileSync('test/sync-keys.test.js', Buffer.from(process.argv[1],'base64'))" Ly8gbGliL3N5bmMva2V5cy5qczogYXMgY2hhdmVzIGRlcml2YWRhcyBxdWUgc29iZW0gcGFyYSBvIGJhbmNvLiBUZXh0byBsZWfDrXZlbCBkZQovLyBQUiBvdSBkZSBjb250YSBudW5jYSBzb2JlIChzw7MgbyBoYXNoKSwgZSBvIGRpYSBkbyB0ZXRvIGNvbXBhcnRpbGhhZG8gw6kgbyBjaXZpbCBkZQovLyBCcmFzw61saWEsIGlndWFsIG5vcyBkb2lzIGFwYXJlbGhvcywgcXVhbHF1ZXIgcXVlIHNlamEgbyBmdXNvIGRlIGNhZGEgcHJvY2Vzc28uCmltcG9ydCB7IHRlc3QgfSBmcm9tICdub2RlOnRlc3QnOwppbXBvcnQgYXNzZXJ0IGZyb20gJ25vZGU6YXNzZXJ0L3N0cmljdCc7CmltcG9ydCB7IGNyZWF0ZUhhc2ggfSBmcm9tICdub2RlOmNyeXB0byc7CmltcG9ydCBrZXlzLCB7CiAgc2hhMjU2SGV4LCBhY2NvdW50SGFzaCwgY2Fub25pY2FsUHJLZXksIHBySGFzaCwgb3BlcmF0aW9uRmluZ2VycHJpbnQsCiAgYnJhc2lsaWFEYXksIG5leHRCcmFzaWxpYURheVN0YXJ0TXMsIGV2ZW50SWRGb3IsIG5vdm9JZCwgYXNzZXJ0UnRkYktleSwKfSBmcm9tICcuLi9saWIvc3luYy9rZXlzLmpzJzsKaW1wb3J0IHsgU3luY0Vycm9yIH0gZnJvbSAnLi4vbGliL3N5bmMvZXJyb3JzLmpzJzsKCmNvbnN0IEhFWDY0ID0gL15bMC05YS1mXXs2NH0kLzsKY29uc3Qgc2hhID0gKHQpID0+IGNyZWF0ZUhhc2goJ3NoYTI1NicpLnVwZGF0ZSh0KS5kaWdlc3QoJ2hleCcpOwoKdGVzdCgnc2hhMjU2SGV4OiA2NCBoZXgsIGlndWFsIGFvIG5vZGU6Y3J5cHRvJywgKCkgPT4gewogIGFzc2VydC5tYXRjaChzaGEyNTZIZXgoJ3gnKSwgSEVYNjQpOwogIGFzc2VydC5lcXVhbChzaGEyNTZIZXgoJ2FiYycpLCBzaGEoJ2FiYycpKTsKfSk7Cgp0ZXN0KCdhY2NvdW50SGFzaDogcHJlZml4byBhY2N0OiwgbG9naW4gYXBhcmFkbyBlIGVtIG1pbsO6c2N1bGFzJywgKCkgPT4gewogIGFzc2VydC5lcXVhbChhY2NvdW50SGFzaCgnRnVsYW5vJyksIHNoYSgnYWNjdDpmdWxhbm8nKSk7CiAgYXNzZXJ0LmVxdWFsKGFjY291bnRIYXNoKCcgIEZVTEFOTyAnKSwgYWNjb3VudEhhc2goJ2Z1bGFubycpKTsKICBhc3NlcnQuZXF1YWwoYWNjb3VudEhhc2godW5kZWZpbmVkKSwgc2hhKCdhY2N0OicpKTsKfSk7Cgp0ZXN0KCdjYW5vbmljYWxQcktleTogb3duZXIvcmVwbyBlbSBtaW7DunNjdWxhcyBlIG7Dum1lcm8gaW50ZWlybycsICgpID0+IHsKICBhc3NlcnQuZXF1YWwoY2Fub25pY2FsUHJLZXkoJ0FjbWUvUmVwbyM3JyksICdhY21lL3JlcG8jNycpOwogIGFzc2VydC5lcXVhbChjYW5vbmljYWxQcktleSgnYWNtZS9yZXBvIzAwNycpLCAnYWNtZS9yZXBvIzcnKTsKICBmb3IgKGNvbnN0IHJ1aW0gb2YgWycnLCAnYWNtZS9yZXBvJywgJ2FjbWUjNycsICdhL2IvYyMxJywgJ2FjbWUvcmVwbyN4JywgJ2FjbWUgL3JlcG8jMScsIG51bGwsIHVuZGVmaW5lZF0pIHsKICAgIGFzc2VydC5lcXVhbChjYW5vbmljYWxQcktleShydWltKSwgJycsIFN0cmluZyhydWltKSk7CiAgfQp9KTsKCnRlc3QoJ3BySGFzaDogbWVzbWEgY2hhdmUgcGFyYSBncmFmaWFzIGRpZmVyZW50ZXMgZG8gbWVzbW8gUFI7IHZhemlvIHF1YW5kbyBuw6NvIMOpIFBSJywgKCkgPT4gewogIGFzc2VydC5lcXVhbChwckhhc2goJ0FjbWUvUmVwbyM3JyksIHBySGFzaCgnYWNtZS9yZXBvIzcnKSk7CiAgYXNzZXJ0LmVxdWFsKHBySGFzaCgnYWNtZS9yZXBvIzcnKSwgc2hhKCdwcjphY21lL3JlcG8jNycpKTsKICBhc3NlcnQubm90RXF1YWwocHJIYXNoKCdhY21lL3JlcG8jNycpLCBwckhhc2goJ2FjbWUvcmVwbyM4JykpOwogIGFzc2VydC5lcXVhbChwckhhc2goJ2xpeG8nKSwgJycpOwp9KTsKCnRlc3QoJ29wZXJhdGlvbkZpbmdlcnByaW50OiBraW5kICsgMzIgaGV4IGRvIHNoYSBkYSB2ZXJzw6NvIG1hdGVyaWFsJywgKCkgPT4gewogIGNvbnN0IGZwID0gb3BlcmF0aW9uRmluZ2VycHJpbnQoJ3JldmlldycsICdhYmMxMjMnKTsKICBhc3NlcnQuZXF1YWwoZnAsIGByZXZpZXdfJHtzaGEoJ2FiYzEyMycpLnNsaWNlKDAsIDMyKX1gKTsKICBhc3NlcnQubWF0Y2gob3BlcmF0aW9uRmluZ2VycHJpbnQoJ3NlbGYnLCAneCcpLCAvXnNlbGZfWzAtOWEtZl17MzJ9JC8pOwogIGFzc2VydC5tYXRjaChvcGVyYXRpb25GaW5nZXJwcmludCgncHVzaGJhY2snLCAnbTEnKSwgL15wdXNoYmFja19bMC05YS1mXXszMn0kLyk7CiAgYXNzZXJ0Lm5vdEVxdWFsKG9wZXJhdGlvbkZpbmdlcnByaW50KCdyZXZpZXcnLCAnYScpLCBvcGVyYXRpb25GaW5nZXJwcmludCgnc2VsZicsICdhJykpOwp9KTsKCnRlc3QoJ29wZXJhdGlvbkZpbmdlcnByaW50OiBraW5kIGludsOhbGlkbyBvdSB2ZXJzw6NvIHZhemlhIGxhbsOnYSBTeW5jRXJyb3IgZGUgZmFsaGEgaW50ZXJuYScsICgpID0+IHsKICBmb3IgKGNvbnN0IGtpbmQgb2YgWydjaGF0JywgJ3Rvb2wnLCAnJywgdW5kZWZpbmVkLCAnUmV2aWV3J10pIHsKICAgIGFzc2VydC50aHJvd3MoKCkgPT4gb3BlcmF0aW9uRmluZ2VycHJpbnQoa2luZCwgJ2FiYycpLCAoZSkgPT4gZSBpbnN0YW5jZW9mIFN5bmNFcnJvciAmJiBlLmNvZGUgPT09ICdmYWxoYV9pbnRlcm5hJywgU3RyaW5nKGtpbmQpKTsKICB9CiAgZm9yIChjb25zdCBtdiBvZiBbJycsIG51bGwsIHVuZGVmaW5lZF0pIHsKICAgIGFzc2VydC50aHJvd3MoKCkgPT4gb3BlcmF0aW9uRmluZ2VycHJpbnQoJ3JldmlldycsIG12KSwgKGUpID0+IGUgaW5zdGFuY2VvZiBTeW5jRXJyb3IgJiYgZS5jb2RlID09PSAnZmFsaGFfaW50ZXJuYScsIFN0cmluZyhtdikpOwogIH0KfSk7Cgp0ZXN0KCdicmFzaWxpYURheTogYSB2aXJhZGEgZG8gZGlhIMOpIMOgcyAwMzowMCBVVEMgKFVUQy0zKSwgbsOjbyDDoCBtZWlhLW5vaXRlIFVUQycsICgpID0+IHsKICBhc3NlcnQuZXF1YWwoYnJhc2lsaWFEYXkoRGF0ZS5VVEMoMjAyNiwgOCwgMTAsIDIsIDU5LCA1OSkpLCAnMjAyNi0wOS0wOScpOwogIGFzc2VydC5lcXVhbChicmFzaWxpYURheShEYXRlLlVUQygyMDI2LCA4LCAxMCwgMywgMCwgMCkpLCAnMjAyNi0wOS0xMCcpOwogIGFzc2VydC5lcXVhbChicmFzaWxpYURheShEYXRlLlVUQygyMDI2LCA4LCAxMCwgMywgMCwgMCksICdVVEMnKSwgJzIwMjYtMDktMTAnKTsKICBhc3NlcnQuZXF1YWwoYnJhc2lsaWFEYXkoRGF0ZS5VVEMoMjAyNiwgOCwgMTAsIDIsIDAsIDApLCAnVVRDJyksICcyMDI2LTA5LTEwJyk7Cn0pOwoKdGVzdCgnbmV4dEJyYXNpbGlhRGF5U3RhcnRNczogZGV2b2x2ZSBleGF0YW1lbnRlIG8gcHJpbWVpcm8gaW5zdGFudGUgZG8gZGlhIHNlZ3VpbnRlJywgKCkgPT4gewogIGNvbnN0IGluaWNpbyA9IERhdGUuVVRDKDIwMjYsIDgsIDEwLCAzLCAwLCAwKTsKICBhc3NlcnQuZXF1YWwobmV4dEJyYXNpbGlhRGF5U3RhcnRNcyhEYXRlLnBhcnNlKCcyMDI2LTA5LTA5VDE1OjAwOjAwWicpKSwgaW5pY2lvKTsKICBhc3NlcnQuZXF1YWwobmV4dEJyYXNpbGlhRGF5U3RhcnRNcyhEYXRlLnBhcnNlKCcyMDI2LTA5LTA5VDE1OjAwOjMwLjUwMFonKSksIGluaWNpbywgJ2ZvcmEgZG8gbWludXRvIHJlZG9uZG8nKTsKICBhc3NlcnQuZXF1YWwobmV4dEJyYXNpbGlhRGF5U3RhcnRNcyhEYXRlLlVUQygyMDI2LCA4LCAxMCwgMiwgNTksIDU5KSksIGluaWNpbywgJ3VtIHNlZ3VuZG8gYW50ZXMgZGEgdmlyYWRhJyk7CiAgYXNzZXJ0LmVxdWFsKG5leHRCcmFzaWxpYURheVN0YXJ0TXMoaW5pY2lvKSwgRGF0ZS5VVEMoMjAyNiwgOCwgMTEsIDMsIDAsIDApLCAnbm8gaW5zdGFudGUgZGEgdmlyYWRhIMOpIG8gZGlhIGRlIGRlcG9pcycpOwogIGFzc2VydC5lcXVhbChuZXh0QnJhc2lsaWFEYXlTdGFydE1zKERhdGUuVVRDKDIwMjYsIDgsIDksIDMsIDAsIDApICsgMSksIGluaWNpbyk7Cn0pOwoKdGVzdCgnbmV4dEJyYXNpbGlhRGF5U3RhcnRNczogdmFsZSBlbSBvdXRybyBmdXNvIHBhc3NhZG8gZXhwbGljaXRhbWVudGUnLCAoKSA9PiB7CiAgYXNzZXJ0LmVxdWFsKG5leHRCcmFzaWxpYURheVN0YXJ0TXMoRGF0ZS5VVEMoMjAyNiwgOCwgOSwgMTUsIDAsIDApLCAnVVRDJyksIERhdGUuVVRDKDIwMjYsIDgsIDEwLCAwLCAwLCAwKSk7Cn0pOwoKY29uc3QgU0VTU0FPID0gewogIGF0OiAxNzU3NTAwMDAwMDAwLCBpZDogJ3MxJywga2luZDogJ3JldmlldycsIHJlZjogJ2FjbWUvcmVwbyM3JywgbW9kZWw6ICdzb25uZXQnLAogIGlucHV0VG9rZW5zOiAxMCwgb3V0cHV0VG9rZW5zOiAyMCwgY2FjaGVSZWFkVG9rZW5zOiAzLCBjYWNoZUNyZWF0aW9uVG9rZW5zOiA0LCBjb3N0VXNkOiAwLjUsCn07Cgp0ZXN0KCdldmVudElkRm9yOiBlc3TDoXZlbCBwYXJhIG9zIG1lc21vcyBjYW1wb3MgaW11dMOhdmVpcycsICgpID0+IHsKICBhc3NlcnQubWF0Y2goZXZlbnRJZEZvcihTRVNTQU8sICdkZXYtMScpLCBIRVg2NCk7CiAgYXNzZXJ0LmVxdWFsKGV2ZW50SWRGb3IoeyAuLi5TRVNTQU8gfSwgJ2Rldi0xJyksIGV2ZW50SWRGb3IoU0VTU0FPLCAnZGV2LTEnKSk7CiAgYXNzZXJ0LmVxdWFsKGV2ZW50SWRGb3IoeyAuLi5TRVNTQU8sIHN0YXR1czogJ2Vycm8nIH0sICdkZXYtMScpLCBldmVudElkRm9yKFNFU1NBTywgJ2Rldi0xJyksICdzdGF0dXMgbsOjbyBlbnRyYTogY29ycmXDp8OjbyBkZSBkZXNmZWNobyByZWVudmlhIG8gbWVzbW8gZXZlbnRvJyk7Cn0pOwoKdGVzdCgnZXZlbnRJZEZvcjogc2Vuc8OtdmVsIGEgY2FkYSB0b2tlbiwgYW8gY3VzdG8sIGFvIGFwYXJlbGhvIGUgw6AgaWRlbnRpZGFkZSBkYSBzZXNzw6NvJywgKCkgPT4gewogIGNvbnN0IGJhc2UgPSBldmVudElkRm9yKFNFU1NBTywgJ2Rldi0xJyk7CiAgYXNzZXJ0Lm5vdEVxdWFsKGV2ZW50SWRGb3IoU0VTU0FPLCAnZGV2LTInKSwgYmFzZSk7CiAgZm9yIChjb25zdCBbaywgdl0gb2YgW1snaW5wdXRUb2tlbnMnLCAxMV0sIFsnb3V0cHV0VG9rZW5zJywgMjFdLCBbJ2NhY2hlUmVhZFRva2VucycsIDRdLCBbJ2NhY2hlQ3JlYXRpb25Ub2tlbnMnLCA1XSwKICAgIFsnY29zdFVzZCcsIDAuNTFdLCBbJ2F0JywgU0VTU0FPLmF0ICsgMV0sIFsnaWQnLCAnczInXSwgWydraW5kJywgJ3NlbGYnXSwgWydyZWYnLCAnYWNtZS9yZXBvIzgnXSwgWydtb2RlbCcsICdvcHVzJ11dKSB7CiAgICBhc3NlcnQubm90RXF1YWwoZXZlbnRJZEZvcih7IC4uLlNFU1NBTywgW2tdOiB2IH0sICdkZXYtMScpLCBiYXNlLCBrKTsKICB9Cn0pOwoKdGVzdCgnbm92b0lkOiBVVUlEIHY0IGRpZmVyZW50ZSBhIGNhZGEgY2hhbWFkYScsICgpID0+IHsKICBjb25zdCBhID0gbm92b0lkKCk7CiAgYXNzZXJ0Lm1hdGNoKGEsIC9eWzAtOWEtZl17OH0tWzAtOWEtZl17NH0tNFswLTlhLWZdezN9LVs4OWFiXVswLTlhLWZdezN9LVswLTlhLWZdezEyfSQvKTsKICBhc3NlcnQubm90RXF1YWwobm92b0lkKCksIGEpOwp9KTsKCnRlc3QoJ2Fzc2VydFJ0ZGJLZXk6IHJlY3VzYSBvcyBjYXJhY3RlcmVzIHByb2liaWRvcyBwZWxvIFJUREIsIHZhemlvIGUgY29udHJvbGUnLCAoKSA9PiB7CiAgZm9yIChjb25zdCBydWltIG9mIFsnYS5iJywgJ2EkYicsICdhI2InLCAnYVtiJywgJ2FdYicsICdhL2InLCAnJywgJ2FcdTAwMDBiJywgJ2FcbmInLCAnYVx1MDA3ZmInLCAneCcucmVwZWF0KDc2OSldKSB7CiAgICBhc3NlcnQudGhyb3dzKCgpID0+IGFzc2VydFJ0ZGJLZXkocnVpbSksIChlKSA9PiBlIGluc3RhbmNlb2YgU3luY0Vycm9yICYmIGUuY29kZSA9PT0gJ2ZhbGhhX2ludGVybmEnLCBKU09OLnN0cmluZ2lmeShydWltLnNsaWNlKDAsIDEwKSkpOwogIH0KICBhc3NlcnQudGhyb3dzKCgpID0+IGFzc2VydFJ0ZGJLZXkoJ8OpJy5yZXBlYXQoMzg1KSksIFN5bmNFcnJvciwgJzc3MCBieXRlcyBlbSBVVEYtOCBwYXNzYW0gZG8gdGV0byBtZXNtbyBjb20gMzg1IGNhcmFjdGVyZXMnKTsKfSk7Cgp0ZXN0KCdhc3NlcnRSdGRiS2V5OiBhY2VpdGEgaGV4LCBfICwgLSBlIG8gZmluZ2VycHJpbnQnLCAoKSA9PiB7CiAgZm9yIChjb25zdCBvayBvZiBbc2hhKCd4JyksICdyZXZpZXdfYWJjJywgJ2EtYicsICcyMDI2LTA5LTEwJywgb3BlcmF0aW9uRmluZ2VycHJpbnQoJ3JldmlldycsICdoJyksICd4Jy5yZXBlYXQoNzY4KV0pIHsKICAgIGFzc2VydC5kb2VzTm90VGhyb3coKCkgPT4gYXNzZXJ0UnRkYktleShvayksIG9rLnNsaWNlKDAsIDEwKSk7CiAgfQp9KTsKCnRlc3QoJ2V4cG9ydCBkZWZhdWx0IGNhcnJlZ2EgbyBtZXNtbyBjb250cmF0byBkb3Mgbm9tZWFkb3MnLCAoKSA9PiB7CiAgYXNzZXJ0LmVxdWFsKGtleXMucHJIYXNoLCBwckhhc2gpOwogIGFzc2VydC5lcXVhbChrZXlzLmJyYXNpbGlhRGF5LCBicmFzaWxpYURheSk7CiAgYXNzZXJ0LmVxdWFsKGtleXMuYXNzZXJ0UnRkYktleSwgYXNzZXJ0UnRkYktleSk7Cn0pOwo=
```

Depois rode a conferência de novo: agora ela bate.

- [ ] **Passo 2: rodar e ver falhar**

```bash
node --test --test-force-exit test/sync-keys.test.js
```

Esperado: FALHA. Cannot find module lib/sync/keys.js.

- [ ] **Passo 3: implementar**

Crie `lib/sync/keys.js` com EXATAMENTE este conteúdo:

```js
// Chaves que sobem para o banco da sincronização entre dispositivos. Puro: sem
// estado, sem IO, sem rede.
//
// Conta e PR sobem só como SHA-256 hex: o banco é do usuário, mas o texto legível
// de PR (org, repositório, número) não precisa sair do aparelho para coordenar, e
// hex é chave válida no RTDB sem escape nenhum.
import { createHash, randomUUID } from 'node:crypto';
import { SYNC, TEMPOS } from '../constants.js';
import { SyncError, SYNC_CODES } from './errors.js';

const TIPOS_COORDENADOS = ['review', 'self', 'pushback'];
const PR_KEY_RE = /^([^/#\s]+)\/([^/#\s]+)#(\d+)$/;
// o RTDB recusa estes caracteres em chave (e controle); 768 bytes é o teto dele
const PROIBIDO_EM_CHAVE = /[.$#[\]/\u0000-\u001f\u007f]/;
const MAX_BYTES_CHAVE = 768;
// busca da virada do dia: passo grosso de 15 min e refino de 1 min. Os fusos em
// uso têm deslocamento em minutos inteiros, então a virada cai num minuto redondo.
const PASSO_GROSSO_MS = TEMPOS.HORA_MS / 4;
const MINUTO_MS = TEMPOS.HORA_MS / 60;
// 26 horas de passos grossos: cobre o dia de 25 horas de um fuso com horário de
// verão, com folga. Sem teto, um fuso inválido giraria para sempre.
const MAX_PASSOS_GROSSOS = 26 * 4;

function sha256Hex(texto) {
  return createHash('sha256').update(String(texto)).digest('hex');
}

function accountHash(login) {
  return sha256Hex('acct:' + String(login || '').trim().toLowerCase());
}

function canonicalPrKey(key) {
  const m = PR_KEY_RE.exec(String(key || '').trim());
  if (!m) return '';
  return `${m[1].toLowerCase()}/${m[2].toLowerCase()}#${Number(m[3])}`;
}

function prHash(key) {
  const canonica = canonicalPrKey(key);
  return canonica ? sha256Hex('pr:' + canonica) : '';
}

function falhaInterna(msg) {
  return new SyncError(SYNC_CODES.FALHA_INTERNA, msg);
}

function operationFingerprint(kind, materialVersion) {
  if (!TIPOS_COORDENADOS.includes(kind)) throw falhaInterna(`tipo de operação sem coordenação: ${String(kind)}`);
  const versao = materialVersion === null || materialVersion === undefined ? '' : String(materialVersion);
  if (!versao) throw falhaInterna('versão material vazia: a coordenação exige saber o que foi analisado');
  return `${kind}_${sha256Hex(versao).slice(0, 32)}`;
}

// en-CA formata como AAAA-MM-DD; o Intl do Node traz o ICU completo, então o fuso
// nomeado resolve igual em qualquer aparelho, independente do fuso do processo.
function brasiliaDay(ms, tz = SYNC.DAY_TZ) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  return fmt.format(new Date(ms));
}

function nextBrasiliaDayStartMs(ms, tz = SYNC.DAY_TZ) {
  const hoje = brasiliaDay(ms, tz);
  let t = Math.floor(ms / MINUTO_MS) * MINUTO_MS;
  for (let i = 0; i < MAX_PASSOS_GROSSOS && brasiliaDay(t + PASSO_GROSSO_MS, tz) === hoje; i++) t += PASSO_GROSSO_MS;
  while (brasiliaDay(t + MINUTO_MS, tz) === hoje) t += MINUTO_MS;
  return t + MINUTO_MS;
}

// Só campos IMUTÁVEIS da sessão entram: o status muda na correção de desfecho e
// reenvia o MESMO evento, que é o que torna a outbox idempotente.
function eventIdFor(sessao, deviceId) {
  const s = sessao || {};
  return sha256Hex([
    deviceId, s.at, s.id || '', s.kind, s.ref || '', s.model || '',
    s.inputTokens | 0, s.outputTokens | 0, s.cacheReadTokens | 0, s.cacheCreationTokens | 0,
    Number(s.costUsd) || 0,
  ].join('|'));
}

function novoId() {
  return randomUUID();
}

function assertRtdbKey(segmento) {
  const s = String(segmento === null || segmento === undefined ? '' : segmento);
  if (!s) throw falhaInterna('segmento de caminho vazio');
  if (Buffer.byteLength(s, 'utf8') > MAX_BYTES_CHAVE) throw falhaInterna('segmento de caminho acima de 768 bytes');
  if (PROIBIDO_EM_CHAVE.test(s)) throw falhaInterna('segmento de caminho com caractere proibido pelo banco');
  return s;
}

export default {
  sha256Hex, accountHash, canonicalPrKey, prHash, operationFingerprint,
  brasiliaDay, nextBrasiliaDayStartMs, eventIdFor, novoId, assertRtdbKey,
};
export {
  sha256Hex, accountHash, canonicalPrKey, prHash, operationFingerprint,
  brasiliaDay, nextBrasiliaDayStartMs, eventIdFor, novoId, assertRtdbKey,
};
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('lib/sync/keys.js')).digest('hex').slice(0,16))"
```

Esperado: `1250c68a6028b1d2`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.
Este arquivo tem sequências de escape que a transcrição costuma normalizar sem querer. Se o hash não bater na segunda tentativa, PARE de transcrever e materialize-o com o comando abaixo, que grava os bytes exatos:

```bash
node -e "require('fs').writeFileSync('lib/sync/keys.js', Buffer.from(process.argv[1],'base64'))" Ly8gQ2hhdmVzIHF1ZSBzb2JlbSBwYXJhIG8gYmFuY28gZGEgc2luY3Jvbml6YcOnw6NvIGVudHJlIGRpc3Bvc2l0aXZvcy4gUHVybzogc2VtCi8vIGVzdGFkbywgc2VtIElPLCBzZW0gcmVkZS4KLy8KLy8gQ29udGEgZSBQUiBzb2JlbSBzw7MgY29tbyBTSEEtMjU2IGhleDogbyBiYW5jbyDDqSBkbyB1c3XDoXJpbywgbWFzIG8gdGV4dG8gbGVnw612ZWwKLy8gZGUgUFIgKG9yZywgcmVwb3NpdMOzcmlvLCBuw7ptZXJvKSBuw6NvIHByZWNpc2Egc2FpciBkbyBhcGFyZWxobyBwYXJhIGNvb3JkZW5hciwgZQovLyBoZXggw6kgY2hhdmUgdsOhbGlkYSBubyBSVERCIHNlbSBlc2NhcGUgbmVuaHVtLgppbXBvcnQgeyBjcmVhdGVIYXNoLCByYW5kb21VVUlEIH0gZnJvbSAnbm9kZTpjcnlwdG8nOwppbXBvcnQgeyBTWU5DLCBURU1QT1MgfSBmcm9tICcuLi9jb25zdGFudHMuanMnOwppbXBvcnQgeyBTeW5jRXJyb3IsIFNZTkNfQ09ERVMgfSBmcm9tICcuL2Vycm9ycy5qcyc7Cgpjb25zdCBUSVBPU19DT09SREVOQURPUyA9IFsncmV2aWV3JywgJ3NlbGYnLCAncHVzaGJhY2snXTsKY29uc3QgUFJfS0VZX1JFID0gL14oW14vI1xzXSspXC8oW14vI1xzXSspIyhcZCspJC87Ci8vIG8gUlREQiByZWN1c2EgZXN0ZXMgY2FyYWN0ZXJlcyBlbSBjaGF2ZSAoZSBjb250cm9sZSk7IDc2OCBieXRlcyDDqSBvIHRldG8gZGVsZQpjb25zdCBQUk9JQklET19FTV9DSEFWRSA9IC9bLiQjW1xdL1x1MDAwMC1cdTAwMWZcdTAwN2ZdLzsKY29uc3QgTUFYX0JZVEVTX0NIQVZFID0gNzY4OwovLyBidXNjYSBkYSB2aXJhZGEgZG8gZGlhOiBwYXNzbyBncm9zc28gZGUgMTUgbWluIGUgcmVmaW5vIGRlIDEgbWluLiBPcyBmdXNvcyBlbQovLyB1c28gdMOqbSBkZXNsb2NhbWVudG8gZW0gbWludXRvcyBpbnRlaXJvcywgZW50w6NvIGEgdmlyYWRhIGNhaSBudW0gbWludXRvIHJlZG9uZG8uCmNvbnN0IFBBU1NPX0dST1NTT19NUyA9IFRFTVBPUy5IT1JBX01TIC8gNDsKY29uc3QgTUlOVVRPX01TID0gVEVNUE9TLkhPUkFfTVMgLyA2MDsKLy8gMjYgaG9yYXMgZGUgcGFzc29zIGdyb3Nzb3M6IGNvYnJlIG8gZGlhIGRlIDI1IGhvcmFzIGRlIHVtIGZ1c28gY29tIGhvcsOhcmlvIGRlCi8vIHZlcsOjbywgY29tIGZvbGdhLiBTZW0gdGV0bywgdW0gZnVzbyBpbnbDoWxpZG8gZ2lyYXJpYSBwYXJhIHNlbXByZS4KY29uc3QgTUFYX1BBU1NPU19HUk9TU09TID0gMjYgKiA0OwoKZnVuY3Rpb24gc2hhMjU2SGV4KHRleHRvKSB7CiAgcmV0dXJuIGNyZWF0ZUhhc2goJ3NoYTI1NicpLnVwZGF0ZShTdHJpbmcodGV4dG8pKS5kaWdlc3QoJ2hleCcpOwp9CgpmdW5jdGlvbiBhY2NvdW50SGFzaChsb2dpbikgewogIHJldHVybiBzaGEyNTZIZXgoJ2FjY3Q6JyArIFN0cmluZyhsb2dpbiB8fCAnJykudHJpbSgpLnRvTG93ZXJDYXNlKCkpOwp9CgpmdW5jdGlvbiBjYW5vbmljYWxQcktleShrZXkpIHsKICBjb25zdCBtID0gUFJfS0VZX1JFLmV4ZWMoU3RyaW5nKGtleSB8fCAnJykudHJpbSgpKTsKICBpZiAoIW0pIHJldHVybiAnJzsKICByZXR1cm4gYCR7bVsxXS50b0xvd2VyQ2FzZSgpfS8ke21bMl0udG9Mb3dlckNhc2UoKX0jJHtOdW1iZXIobVszXSl9YDsKfQoKZnVuY3Rpb24gcHJIYXNoKGtleSkgewogIGNvbnN0IGNhbm9uaWNhID0gY2Fub25pY2FsUHJLZXkoa2V5KTsKICByZXR1cm4gY2Fub25pY2EgPyBzaGEyNTZIZXgoJ3ByOicgKyBjYW5vbmljYSkgOiAnJzsKfQoKZnVuY3Rpb24gZmFsaGFJbnRlcm5hKG1zZykgewogIHJldHVybiBuZXcgU3luY0Vycm9yKFNZTkNfQ09ERVMuRkFMSEFfSU5URVJOQSwgbXNnKTsKfQoKZnVuY3Rpb24gb3BlcmF0aW9uRmluZ2VycHJpbnQoa2luZCwgbWF0ZXJpYWxWZXJzaW9uKSB7CiAgaWYgKCFUSVBPU19DT09SREVOQURPUy5pbmNsdWRlcyhraW5kKSkgdGhyb3cgZmFsaGFJbnRlcm5hKGB0aXBvIGRlIG9wZXJhw6fDo28gc2VtIGNvb3JkZW5hw6fDo286ICR7U3RyaW5nKGtpbmQpfWApOwogIGNvbnN0IHZlcnNhbyA9IG1hdGVyaWFsVmVyc2lvbiA9PT0gbnVsbCB8fCBtYXRlcmlhbFZlcnNpb24gPT09IHVuZGVmaW5lZCA/ICcnIDogU3RyaW5nKG1hdGVyaWFsVmVyc2lvbik7CiAgaWYgKCF2ZXJzYW8pIHRocm93IGZhbGhhSW50ZXJuYSgndmVyc8OjbyBtYXRlcmlhbCB2YXppYTogYSBjb29yZGVuYcOnw6NvIGV4aWdlIHNhYmVyIG8gcXVlIGZvaSBhbmFsaXNhZG8nKTsKICByZXR1cm4gYCR7a2luZH1fJHtzaGEyNTZIZXgodmVyc2FvKS5zbGljZSgwLCAzMil9YDsKfQoKLy8gZW4tQ0EgZm9ybWF0YSBjb21vIEFBQUEtTU0tREQ7IG8gSW50bCBkbyBOb2RlIHRyYXogbyBJQ1UgY29tcGxldG8sIGVudMOjbyBvIGZ1c28KLy8gbm9tZWFkbyByZXNvbHZlIGlndWFsIGVtIHF1YWxxdWVyIGFwYXJlbGhvLCBpbmRlcGVuZGVudGUgZG8gZnVzbyBkbyBwcm9jZXNzby4KZnVuY3Rpb24gYnJhc2lsaWFEYXkobXMsIHR6ID0gU1lOQy5EQVlfVFopIHsKICBjb25zdCBmbXQgPSBuZXcgSW50bC5EYXRlVGltZUZvcm1hdCgnZW4tQ0EnLCB7IHRpbWVab25lOiB0eiwgeWVhcjogJ251bWVyaWMnLCBtb250aDogJzItZGlnaXQnLCBkYXk6ICcyLWRpZ2l0JyB9KTsKICByZXR1cm4gZm10LmZvcm1hdChuZXcgRGF0ZShtcykpOwp9CgpmdW5jdGlvbiBuZXh0QnJhc2lsaWFEYXlTdGFydE1zKG1zLCB0eiA9IFNZTkMuREFZX1RaKSB7CiAgY29uc3QgaG9qZSA9IGJyYXNpbGlhRGF5KG1zLCB0eik7CiAgbGV0IHQgPSBNYXRoLmZsb29yKG1zIC8gTUlOVVRPX01TKSAqIE1JTlVUT19NUzsKICBmb3IgKGxldCBpID0gMDsgaSA8IE1BWF9QQVNTT1NfR1JPU1NPUyAmJiBicmFzaWxpYURheSh0ICsgUEFTU09fR1JPU1NPX01TLCB0eikgPT09IGhvamU7IGkrKykgdCArPSBQQVNTT19HUk9TU09fTVM7CiAgd2hpbGUgKGJyYXNpbGlhRGF5KHQgKyBNSU5VVE9fTVMsIHR6KSA9PT0gaG9qZSkgdCArPSBNSU5VVE9fTVM7CiAgcmV0dXJuIHQgKyBNSU5VVE9fTVM7Cn0KCi8vIFPDsyBjYW1wb3MgSU1VVMOBVkVJUyBkYSBzZXNzw6NvIGVudHJhbTogbyBzdGF0dXMgbXVkYSBuYSBjb3JyZcOnw6NvIGRlIGRlc2ZlY2hvIGUKLy8gcmVlbnZpYSBvIE1FU01PIGV2ZW50bywgcXVlIMOpIG8gcXVlIHRvcm5hIGEgb3V0Ym94IGlkZW1wb3RlbnRlLgpmdW5jdGlvbiBldmVudElkRm9yKHNlc3NhbywgZGV2aWNlSWQpIHsKICBjb25zdCBzID0gc2Vzc2FvIHx8IHt9OwogIHJldHVybiBzaGEyNTZIZXgoWwogICAgZGV2aWNlSWQsIHMuYXQsIHMuaWQgfHwgJycsIHMua2luZCwgcy5yZWYgfHwgJycsIHMubW9kZWwgfHwgJycsCiAgICBzLmlucHV0VG9rZW5zIHwgMCwgcy5vdXRwdXRUb2tlbnMgfCAwLCBzLmNhY2hlUmVhZFRva2VucyB8IDAsIHMuY2FjaGVDcmVhdGlvblRva2VucyB8IDAsCiAgICBOdW1iZXIocy5jb3N0VXNkKSB8fCAwLAogIF0uam9pbignfCcpKTsKfQoKZnVuY3Rpb24gbm92b0lkKCkgewogIHJldHVybiByYW5kb21VVUlEKCk7Cn0KCmZ1bmN0aW9uIGFzc2VydFJ0ZGJLZXkoc2VnbWVudG8pIHsKICBjb25zdCBzID0gU3RyaW5nKHNlZ21lbnRvID09PSBudWxsIHx8IHNlZ21lbnRvID09PSB1bmRlZmluZWQgPyAnJyA6IHNlZ21lbnRvKTsKICBpZiAoIXMpIHRocm93IGZhbGhhSW50ZXJuYSgnc2VnbWVudG8gZGUgY2FtaW5obyB2YXppbycpOwogIGlmIChCdWZmZXIuYnl0ZUxlbmd0aChzLCAndXRmOCcpID4gTUFYX0JZVEVTX0NIQVZFKSB0aHJvdyBmYWxoYUludGVybmEoJ3NlZ21lbnRvIGRlIGNhbWluaG8gYWNpbWEgZGUgNzY4IGJ5dGVzJyk7CiAgaWYgKFBST0lCSURPX0VNX0NIQVZFLnRlc3QocykpIHRocm93IGZhbGhhSW50ZXJuYSgnc2VnbWVudG8gZGUgY2FtaW5obyBjb20gY2FyYWN0ZXJlIHByb2liaWRvIHBlbG8gYmFuY28nKTsKICByZXR1cm4gczsKfQoKZXhwb3J0IGRlZmF1bHQgewogIHNoYTI1NkhleCwgYWNjb3VudEhhc2gsIGNhbm9uaWNhbFByS2V5LCBwckhhc2gsIG9wZXJhdGlvbkZpbmdlcnByaW50LAogIGJyYXNpbGlhRGF5LCBuZXh0QnJhc2lsaWFEYXlTdGFydE1zLCBldmVudElkRm9yLCBub3ZvSWQsIGFzc2VydFJ0ZGJLZXksCn07CmV4cG9ydCB7CiAgc2hhMjU2SGV4LCBhY2NvdW50SGFzaCwgY2Fub25pY2FsUHJLZXksIHBySGFzaCwgb3BlcmF0aW9uRmluZ2VycHJpbnQsCiAgYnJhc2lsaWFEYXksIG5leHRCcmFzaWxpYURheVN0YXJ0TXMsIGV2ZW50SWRGb3IsIG5vdm9JZCwgYXNzZXJ0UnRkYktleSwKfTsK
```

Depois rode a conferência de novo: agora ela bate.

- [ ] **Passo 4: rodar e ver passar**

```bash
node --test --test-force-exit test/sync-keys.test.js
```

Esperado: PASSA, 0 falhas.

- [ ] **Passo 5: gate e commit**

```bash
npm run check && npm run lint && npm test
```

Esperado: `fail 0` e `gate de qualidade: sem regressão`. Se algo falhar, PARE e relate; não mexa em outro arquivo para fazer passar.

```bash
git add lib/sync/keys.js test/sync-keys.test.js
git commit -m "feat(sync): chaves derivadas, fingerprint de operação e dia canônico"
```


### Tarefa T03: Config da sincronização

A config nasce DESLIGADA e só liga com objeto explícito. O saneamento mora aqui, fora do settings.js, porque ele é injetado como os outros parsers e precisa ser testável sem subir a Engine.

**Arquivos:**
- Criar: `lib/sync/config.js`

- [ ] **Passo 1: implementar**

Crie `lib/sync/config.js` com EXATAMENTE este conteúdo:

```js
// Saneador da chave `sync` do config.json. Puro: sem estado, sem IO, sem rede.
//
// A sincronização entre dispositivos é opt-in e nasce desligada. Os três
// interruptores só ligam com `true` explícito: config.json editado à mão, corrompido
// ou de versão antiga nunca pode ligar sozinho uma coordenação que segura revisão.
//
// A URL do banco passa por allowlist de host, não por escape: é para lá que o ID
// token do usuário viaja na query (`?auth=`), então um host qualquer seria entregar
// a credencial a terceiro.
import { SYNC } from '../constants.js';

const API_KEY_RE = /^[A-Za-z0-9_-]{10,128}$/;
const PROJECT_ID_RE = /^[a-z0-9-]{1,64}$/;
const MAX_NOME = 40;
const HOSTS_FIREBASE = ['.firebaseio.com', '.firebasedatabase.app'];
// o emulador do Firebase só fala http, e só em máquina local
const HOSTS_EMULADOR = ['127.0.0.1', 'localhost'];

function syncDefaults() {
  return {
    enabled: false, coordination: { enabled: false }, consolidation: { enabled: false },
    deviceName: '', apiKey: '', databaseUrl: '', projectId: '',
  };
}

function lerUrl(texto) {
  try { return new URL(texto); } catch { return null; }
}

function hostPermitido(u) {
  if (u.protocol === 'https:') return HOSTS_FIREBASE.some((h) => u.hostname.endsWith(h));
  if (u.protocol === 'http:') return HOSTS_EMULADOR.includes(u.hostname);
  return false;
}

function databaseUrlProblema(url) {
  const texto = typeof url === 'string' ? url.trim() : '';
  if (!texto) return 'informe a URL do banco';
  const u = lerUrl(texto);
  if (!u) return 'a URL do banco não é um endereço válido';
  if (!hostPermitido(u)) return 'a URL do banco precisa ser https no domínio do Firebase (ou http em 127.0.0.1/localhost, para o emulador)';
  if (u.username || u.password) return 'a URL do banco não pode carregar usuário nem senha';
  if ((u.pathname && u.pathname !== '/') || u.search || u.hash) return 'a URL do banco é só o endereço, sem caminho, parâmetro ou âncora';
  return '';
}

// Campo vazio de propósito limpa a URL (é o recurso deixando de estar configurado);
// qualquer outro valor inválido mantém a que já estava, pelo mesmo motivo do
// `ouAtual` de lib/settings.js: um erro de digitação não pode apagar a configuração
// que funcionava.
function sanearUrl(v, atual) {
  const anterior = atual && typeof atual.databaseUrl === 'string' ? atual.databaseUrl : '';
  if (typeof v === 'string' && !v.trim()) return '';
  if (databaseUrlProblema(v)) return anterior;
  const u = new URL(v.trim());
  return `${u.protocol}//${u.host}`;
}

function interruptor(obj) {
  return { enabled: !!(obj && typeof obj === 'object' && obj.enabled === true) };
}

function texto(v, re) {
  return typeof v === 'string' && re.test(v) ? v : '';
}

function parseSyncConfig(raw, atual) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    enabled: r.enabled === true,
    coordination: interruptor(r.coordination),
    consolidation: interruptor(r.consolidation),
    deviceName: typeof r.deviceName === 'string' ? r.deviceName.trim().slice(0, MAX_NOME) : '',
    apiKey: texto(r.apiKey, API_KEY_RE),
    databaseUrl: sanearUrl(r.databaseUrl, atual),
    projectId: texto(r.projectId, PROJECT_ID_RE),
  };
}

// O login segue o banco: banco do emulador (o único http que databaseUrlProblema
// aceita, e só em máquina local) pede o Auth do emulador também. Sem isso a validação
// manual da Fase 5 (firebase/README.md) só rodaria contra um projeto real, com rede e
// senha de verdade. Qualquer outra URL, inclusive a inválida, fica no Auth de
// produção: um valor torto nunca desvia a senha para outro endereço.
function authUrlsFor(databaseUrl) {
  const emulador = !databaseUrlProblema(databaseUrl) && new URL(databaseUrl.trim()).protocol === 'http:';
  if (emulador) return { identityUrl: SYNC.AUTH_EMULATOR_IDENTITY_URL, tokenUrl: SYNC.AUTH_EMULATOR_TOKEN_URL };
  return { identityUrl: SYNC.IDENTITY_TOOLKIT_URL, tokenUrl: SYNC.SECURE_TOKEN_URL };
}

function coordinationActive(cfg) {
  return !!(cfg && cfg.enabled === true && cfg.coordination && cfg.coordination.enabled === true);
}

function consolidationActive(cfg) {
  return !!(cfg && cfg.enabled === true && cfg.consolidation && cfg.consolidation.enabled === true);
}

export default { syncDefaults, parseSyncConfig, coordinationActive, consolidationActive, databaseUrlProblema, authUrlsFor };
export { syncDefaults, parseSyncConfig, coordinationActive, consolidationActive, databaseUrlProblema, authUrlsFor };
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('lib/sync/config.js')).digest('hex').slice(0,16))"
```

Esperado: `45f12762802d6908`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

- [ ] **Passo 2: gate e commit**

```bash
npm run check && npm run lint && npm test
```

Esperado: `fail 0` e `gate de qualidade: sem regressão`. Se algo falhar, PARE e relate; não mexa em outro arquivo para fazer passar.

```bash
git add lib/sync/config.js
git commit -m "feat(sync): saneamento da config da sincronização"
```


### Tarefa T04: Credencial e identidade deste aparelho

A credencial fica FORA do config.json, que trafega inteiro para a tela, e com permissão restrita em toda gravação. A identidade do aparelho é o que dá nome a ele para os outros, e precisa sobreviver a reinício.

**Arquivos:**
- Criar: `lib/sync/credentials.js`
- Criar: `lib/sync/device.js`
- Criar: `test/sync-credentials.test.js`
- Criar: `test/sync-device.test.js`

- [ ] **Passo 1: escrever o teste**

Crie `test/sync-credentials.test.js` com EXATAMENTE este conteúdo:

```js
// lib/sync/credentials.js: o único lugar que lê ou grava o login do Firebase deste
// aparelho. Mora fora do config.json (que trafega inteiro para a UI) e a senha nunca
// entra: só uid, e-mail e o refresh token.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const HOME = path.join(os.tmpdir(), 'farol-test-sync-cred-' + process.pid);
process.env.FAROL_HOME = HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
const cred = await import('../lib/sync/credentials.js');
const { IS_WIN } = await import('../lib/paths.js');
const {
  credentialsPath, readSyncCredential, setSyncCredential, updateRefreshToken, removeSyncCredential, hasSyncCredential,
} = cred;

after(() => { try { fs.rmSync(HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });
beforeEach(() => { try { fs.rmSync(credentialsPath(), { force: true }); } catch { /* best-effort */ } });

const LOGIN = { uid: 'u1', email: 'a@b.com', refreshToken: 'rt-1' };

test('credentialsPath: arquivo próprio em ~/.farol, fora do config.json', () => {
  assert.equal(credentialsPath(), path.join(HOME, 'sync-credentials.json'));
});

test('sem arquivo: nada lido, nada cadastrado', () => {
  assert.equal(readSyncCredential(), null);
  assert.equal(hasSyncCredential(), false);
});

test('setSyncCredential grava uid, e-mail e refresh token, com savedAt', () => {
  const antes = Date.now();
  assert.equal(setSyncCredential(LOGIN), true);
  const lido = readSyncCredential();
  assert.equal(lido.uid, 'u1');
  assert.equal(lido.email, 'a@b.com');
  assert.equal(lido.refreshToken, 'rt-1');
  assert.ok(lido.savedAt >= antes);
  assert.equal(hasSyncCredential(), true);
});

test('setSyncCredential nunca grava a senha, mesmo que ela venha junto', () => {
  setSyncCredential({ ...LOGIN, password: 'segredo-que-nao-sobe' });
  const cru = fs.readFileSync(credentialsPath(), 'utf8');
  assert.doesNotMatch(cru, /segredo-que-nao-sobe/);
  assert.deepEqual(Object.keys(JSON.parse(cru)).sort(), ['email', 'refreshToken', 'savedAt', 'uid']);
});

test('setSyncCredential recusa login incompleto', () => {
  assert.equal(setSyncCredential({ uid: 'u1', email: 'a@b.com' }), false);
  assert.equal(setSyncCredential({ refreshToken: 'rt' }), false);
  assert.equal(setSyncCredential(null), false);
  assert.equal(setSyncCredential({ uid: '  ', refreshToken: '  ' }), false);
  assert.equal(fs.existsSync(credentialsPath()), false);
});

test('readSyncCredential: arquivo sem uid ou sem refresh token vale como ausente', () => {
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(credentialsPath(), JSON.stringify({ uid: 'u1', email: 'a@b.com' }));
  assert.equal(readSyncCredential(), null);
  fs.writeFileSync(credentialsPath(), '[1,2]');
  assert.equal(readSyncCredential(), null);
  fs.writeFileSync(credentialsPath(), '{ quebrado');
  assert.equal(readSyncCredential(), null);
  assert.equal(hasSyncCredential(), false);
});

test('updateRefreshToken troca só o refresh token (rotação do securetoken)', () => {
  setSyncCredential(LOGIN);
  assert.equal(updateRefreshToken('rt-2'), true);
  const lido = readSyncCredential();
  assert.equal(lido.refreshToken, 'rt-2');
  assert.equal(lido.uid, 'u1');
  assert.equal(lido.email, 'a@b.com');
});

test('updateRefreshToken sem login cadastrado ou com token vazio não cria nada', () => {
  assert.equal(updateRefreshToken('rt-2'), false);
  assert.equal(fs.existsSync(credentialsPath()), false);
  setSyncCredential(LOGIN);
  assert.equal(updateRefreshToken(''), false);
  assert.equal(readSyncCredential().refreshToken, 'rt-1');
});

test('removeSyncCredential apaga o arquivo e devolve se havia o que apagar', () => {
  setSyncCredential(LOGIN);
  assert.equal(removeSyncCredential(), true);
  assert.equal(fs.existsSync(credentialsPath()), false);
  assert.equal(hasSyncCredential(), false);
  assert.equal(removeSyncCredential(), false);
});

test('toda gravação deixa o arquivo legível só pelo dono (0600)', { skip: IS_WIN }, () => {
  setSyncCredential(LOGIN);
  assert.equal(fs.statSync(credentialsPath()).mode & 0o777, 0o600);
  updateRefreshToken('rt-3');
  assert.equal(fs.statSync(credentialsPath()).mode & 0o777, 0o600, 'a rotação regrava e precisa restringir de novo');
});
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('test/sync-credentials.test.js')).digest('hex').slice(0,16))"
```

Esperado: `2c9e7202e5af1b92`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

Crie `test/sync-device.test.js` com EXATAMENTE este conteúdo:

```js
// lib/sync/device.js: a identidade persistente deste aparelho na sincronização.
// O deviceId nasce uma vez e sobrevive a reinício: é ele que diz "este lease é meu"
// e separa os eventos de consumo de cada aparelho no banco.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const HOME = path.join(os.tmpdir(), 'farol-test-sync-device-' + process.pid);
process.env.FAROL_HOME = HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
const { devicePath, ensureDevice, readDevice } = await import('../lib/sync/device.js');

after(() => { try { fs.rmSync(HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });
beforeEach(() => { try { fs.rmSync(devicePath(), { force: true }); } catch { /* best-effort */ } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('devicePath: arquivo em workspace/state', () => {
  assert.equal(devicePath(), path.join(HOME, 'workspace', 'state', 'sync-device.json'));
});

test('readDevice: sem arquivo não inventa aparelho', () => {
  assert.equal(readDevice(), null);
});

test('ensureDevice: cria na primeira chamada e grava em disco', () => {
  const antes = Date.now();
  const d = ensureDevice();
  assert.match(d.deviceId, UUID);
  assert.ok(d.createdAt >= antes);
  assert.ok(fs.existsSync(devicePath()));
  assert.deepEqual(readDevice(), d);
});

test('ensureDevice: chamadas seguintes devolvem o MESMO aparelho', () => {
  const a = ensureDevice();
  const b = ensureDevice();
  assert.deepEqual(b, a);
});

test('arquivo corrompido ou com id inválido como chave do banco vira aparelho novo', () => {
  fs.mkdirSync(path.dirname(devicePath()), { recursive: true });
  for (const cru of ['{ quebrado', '[]', JSON.stringify({ deviceId: 'a/b', createdAt: 1 }), JSON.stringify({ createdAt: 1 })]) {
    fs.writeFileSync(devicePath(), cru);
    assert.equal(readDevice(), null, cru);
    const d = ensureDevice();
    assert.match(d.deviceId, UUID, cru);
  }
});
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('test/sync-device.test.js')).digest('hex').slice(0,16))"
```

Esperado: `e479b8176ba132fc`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

- [ ] **Passo 2: rodar e ver falhar**

```bash
node --test --test-force-exit test/sync-credentials.test.js test/sync-device.test.js
```

Esperado: FALHA. Cannot find module lib/sync/credentials.js.

- [ ] **Passo 3: implementar**

Crie `lib/sync/credentials.js` com EXATAMENTE este conteúdo:

```js
// Único lugar do app que lê ou grava o login do Firebase deste aparelho. Mora fora
// do config.json pelo mesmo motivo de lib/jira/credentials.js: o config inteiro
// trafega para a UI, e o refresh token é credencial (troca por ID token sem senha,
// por tempo indeterminado). A senha nunca entra aqui: ela é usada uma vez no login
// e descartada.
import fs from 'node:fs';
import path from 'node:path';
import { HOME } from '../paths.js';
import { SYNC } from '../constants.js';
import io from '../io.js';

const ARQUIVO = path.join(HOME, SYNC.CREDENTIALS_FILE);

function credentialsPath() { return ARQUIVO; }

function texto(v) {
  return typeof v === 'string' ? v.trim() : '';
}

// chmod não existe em NTFS: a proteção real no Windows é a ACL do perfil do
// usuário. Aqui é best effort pro caso POSIX, e falhar não pode impedir o login.
function restringirPermissao(arquivo) {
  try { fs.chmodSync(arquivo, 0o600); } catch { /* sem suporte a modo neste sistema de arquivos */ }
}

// TODA gravação restringe de novo: o writeJsonAtomic entrega ao arquivo final o
// modo default do .tmp, então a rotação do refresh token devolveria o arquivo para
// 0644 se o chmod só acontecesse no primeiro login (mesma armadilha já paga no Jira).
function gravar(dados) {
  io.ensureDir(path.dirname(ARQUIVO));
  io.writeJsonAtomic(ARQUIVO, dados);
  restringirPermissao(ARQUIVO);
}

function readSyncCredential() {
  const d = io.readJson(ARQUIVO, null);
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  const uid = texto(d.uid);
  const refreshToken = texto(d.refreshToken);
  if (!uid || !refreshToken) return null;
  return { uid, email: texto(d.email), refreshToken, savedAt: Number(d.savedAt) || 0 };
}

function hasSyncCredential() { return !!readSyncCredential(); }

function setSyncCredential(valor) {
  const v = valor || {};
  const uid = texto(v.uid);
  const refreshToken = texto(v.refreshToken);
  if (!uid || !refreshToken) return false;
  gravar({ uid, email: texto(v.email), refreshToken, savedAt: Date.now() });
  return true;
}

// O securetoken pode devolver um refresh token NOVO a cada renovação; guardar o
// velho funcionaria até a rotação invalidá-lo, e aí o aparelho cairia sem aviso.
function updateRefreshToken(refreshToken) {
  const atual = readSyncCredential();
  const novo = texto(refreshToken);
  if (!atual || !novo) return false;
  gravar({ uid: atual.uid, email: atual.email, refreshToken: novo, savedAt: Date.now() });
  return true;
}

function removeSyncCredential() {
  if (!fs.existsSync(ARQUIVO)) return false;
  fs.rmSync(ARQUIVO, { force: true });
  return true;
}

export default { credentialsPath, readSyncCredential, setSyncCredential, updateRefreshToken, removeSyncCredential, hasSyncCredential };
export { credentialsPath, readSyncCredential, setSyncCredential, updateRefreshToken, removeSyncCredential, hasSyncCredential };
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('lib/sync/credentials.js')).digest('hex').slice(0,16))"
```

Esperado: `079530f8269db51d`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

Crie `lib/sync/device.js` com EXATAMENTE este conteúdo:

```js
// Identidade persistente deste aparelho na sincronização entre dispositivos. O
// deviceId nasce uma vez e sobrevive a reinício e a update: é ele que diz "este
// lease é meu" e que separa os eventos de consumo de cada aparelho no banco. Mora
// em state/ (e não junto da credencial) porque não é segredo, é estado do app.
import path from 'node:path';
import { STATE_DIR } from '../paths.js';
import { SYNC } from '../constants.js';
import io from '../io.js';
import { novoId } from './keys.js';

const ARQUIVO = path.join(STATE_DIR, SYNC.DEVICE_FILE);
// o id vira segmento de caminho no banco; arquivo editado ou corrompido com um
// caractere proibido lá (/, ., #) quebraria toda escrita, então vale como ausente
const ID_RE = /^[A-Za-z0-9_-]{8,128}$/;

function devicePath() { return ARQUIVO; }

function readDevice() {
  const d = io.readJson(ARQUIVO, null);
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  if (typeof d.deviceId !== 'string' || !ID_RE.test(d.deviceId)) return null;
  return { deviceId: d.deviceId, createdAt: Number(d.createdAt) || 0 };
}

function ensureDevice() {
  const atual = readDevice();
  if (atual) return atual;
  const novo = { deviceId: novoId(), createdAt: Date.now() };
  io.ensureDir(path.dirname(ARQUIVO));
  io.writeJsonAtomic(ARQUIVO, novo);
  return novo;
}

export default { devicePath, ensureDevice, readDevice };
export { devicePath, ensureDevice, readDevice };
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('lib/sync/device.js')).digest('hex').slice(0,16))"
```

Esperado: `dd1c5618499cf695`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

- [ ] **Passo 4: rodar e ver passar**

```bash
node --test --test-force-exit test/sync-credentials.test.js test/sync-device.test.js
```

Esperado: PASSA, 0 falhas.

- [ ] **Passo 5: gate e commit**

```bash
npm run check && npm run lint && npm test
```

Esperado: `fail 0` e `gate de qualidade: sem regressão`. Se algo falhar, PARE e relate; não mexa em outro arquivo para fazer passar.

```bash
git add lib/sync/credentials.js lib/sync/device.js test/sync-credentials.test.js test/sync-device.test.js
git commit -m "feat(sync): credencial fora do config.json e identidade do aparelho"
```


### Tarefa T05: Auth do Firebase e o dublê de identidade

Login por e-mail e senha é o único formato que funciona headless. A senha é usada uma vez e nunca gravada: o que fica é o acesso renovável. O dublê de identidade entra junto porque sem ele não há como testar a rotação do token sem tocar a internet.

**Arquivos:**
- Criar: `lib/sync/auth.js`
- Criar: `test/helpers/fake-identity.js`
- Criar: `test/helpers/sem-tier-wasm.js`
- Criar: `test/sync-auth.test.js`

- [ ] **Passo 1: escrever o teste**

Crie `test/helpers/fake-identity.js` com EXATAMENTE este conteúdo:

```js
// Dublê do Firebase Auth por REST (Identity Toolkit + securetoken), em processo.
// Sem efeito colateral no import: o `node --test` executa test/**/*.js, e um
// arquivo que só exporta funções passa vazio.
//
// Imita o que o cliente consome de verdade: o erro vem como
// { error: { message } }, `expiresIn`/`expires_in` chegam como STRING de segundos,
// e o refresh token pode rotacionar a cada renovação (aqui rotaciona sempre, para o
// teste ver a rotação chegar em quem guarda a credencial).
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { desligarSubidaDeTierDoWasm } from './sem-tier-wasm.js';

// O emulador do Firebase Auth serve as duas APIs com o host de produção como prefixo de
// caminho; o dublê aceita as duas formas, pra servir tanto o teste da folha (que passa
// a URL base à mão) quanto o do engine (que usa o endereço do emulador).
const CAMINHOS_DO_EMULADOR = {
  '/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword': '/v1/accounts:signInWithPassword',
  '/securetoken.googleapis.com/v1/token': '/v1/token',
};

function responder(res, status, corpo) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(corpo));
}

function erro(res, message) {
  responder(res, 400, { error: { code: 400, message, errors: [{ message, domain: 'global', reason: 'invalid' }] } });
}

function lerCorpo(req) {
  return new Promise((resolve) => {
    let dados = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { dados += c; });
    req.on('end', () => resolve(dados));
  });
}

export async function startFakeIdentity({ apiKey = 'key-1', users = { 'a@b.com': { password: 'segredo', uid: 'u1' } }, expiresIn = 3600 } = {}) {
  // antes de qualquer fetch contra o dublê: ver test/helpers/sem-tier-wasm.js
  desligarSubidaDeTierDoWasm();
  const requests = [];
  const tokens = { idTokens: [], refreshTokens: [] };
  const donoDoRefresh = new Map();
  const revogados = new Set();

  function emitir(uid) {
    const idToken = 'id-' + randomUUID();
    const refreshToken = 'rt-' + randomUUID();
    tokens.idTokens.push(idToken);
    tokens.refreshTokens.push(refreshToken);
    donoDoRefresh.set(refreshToken, uid);
    return { idToken, refreshToken };
  }

  function signIn(res, corpo) {
    const dados = JSON.parse(corpo || '{}');
    const user = users[dados.email];
    if (!user) return erro(res, 'EMAIL_NOT_FOUND');
    if (user.password !== dados.password) return erro(res, 'INVALID_PASSWORD');
    const t = emitir(user.uid);
    return responder(res, 200, {
      kind: 'identitytoolkit#VerifyPasswordResponse', localId: user.uid, email: dados.email,
      displayName: '', idToken: t.idToken, registered: true, refreshToken: t.refreshToken, expiresIn: String(expiresIn),
    });
  }

  function refresh(res, corpo) {
    const form = new URLSearchParams(corpo || '');
    const atual = form.get('refresh_token') || '';
    if (form.get('grant_type') !== 'refresh_token') return erro(res, 'INVALID_GRANT_TYPE');
    if (revogados.has(atual)) return erro(res, 'TOKEN_EXPIRED');
    const uid = donoDoRefresh.get(atual);
    if (!uid) return erro(res, 'INVALID_REFRESH_TOKEN');
    const t = emitir(uid);
    return responder(res, 200, {
      access_token: t.idToken, expires_in: String(expiresIn), token_type: 'Bearer',
      refresh_token: t.refreshToken, id_token: t.idToken, user_id: uid, project_id: 'farol-local',
    });
  }

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    const body = await lerCorpo(req);
    requests.push({ method: req.method, path: u.pathname, query: Object.fromEntries(u.searchParams), headers: req.headers, body });
    if (req.method !== 'POST') return erro(res, 'METHOD_NOT_ALLOWED');
    if (u.searchParams.get('key') !== apiKey) return erro(res, 'API key not valid. Please pass a valid API key.');
    const caminho = CAMINHOS_DO_EMULADOR[u.pathname] || u.pathname;
    if (caminho === '/v1/accounts:signInWithPassword') return signIn(res, body);
    if (caminho === '/v1/token') return refresh(res, body);
    return responder(res, 404, { error: { code: 404, message: 'NOT_FOUND' } });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;

  return {
    url,
    requests,
    tokens,
    revogar(refreshToken) { revogados.add(refreshToken); },
    close() {
      return new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      });
    },
  };
}

export default { startFakeIdentity };
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('test/helpers/fake-identity.js')).digest('hex').slice(0,16))"
```

Esperado: `7f4fa8d22f775d67`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

Crie `test/helpers/sem-tier-wasm.js` com EXATAMENTE este conteúdo:

```js
// Desliga a subida de tier do WebAssembly no processo de teste. Sem efeito colateral
// no import: o `node --test` executa test/**/*.js, e quem liga é o dublê ao subir.
//
// Por quê: o parser HTTP do fetch (llhttp, do undici) é WebAssembly. Depois de alguns
// fetch o V8 decide otimizá-lo e compila a versão otimizada numa thread de fundo; se
// o processo sai (process.exit, que o --test-force-exit chama no fim de cada arquivo)
// com essa compilação em andamento, a tarefa termina e avisa a thread principal por
// um handle que a saída já está fechando, e no Windows o node aborta na asserção
// `!(handle->flags & UV_HANDLE_CLOSING)` de src/win/async.c. Medido em 11/09/2026,
// Node 24.15: cinco fetch seguidos de process.exit abortam 15 de 15 vezes SEM nenhum
// socket sendo fechado (o servidor nem é encerrado), então não é o keep-alive; com
// o tiering dinâmico e a subida de tier desligados, 0 de 15. Uma pausa depois do
// close só escondia a corrida: dava tempo à compilação de terminar, na maioria das
// vezes.
//
// As duas flags, e não uma: `--no-wasm-dynamic-tiering` sozinho troca a subida por
// orçamento (a que acontece perto da saída) pela subida imediata de cada função no
// primeiro uso, que ainda é compilação de fundo; `--no-wasm-tier-up` desliga essa.
// Tem que valer ANTES do primeiro fetch de rede do processo: o llhttp é compilado uma
// vez só e guarda o modo de tiering daquele instante. Os dublês sobem antes de
// qualquer fetch de rede em todos os testes, e é por isso que moram aqui.
import v8 from 'node:v8';

let desligado = false;

function desligarSubidaDeTierDoWasm() {
  if (desligado) return;
  desligado = true;
  v8.setFlagsFromString('--no-wasm-dynamic-tiering');
  v8.setFlagsFromString('--no-wasm-tier-up');
}

export default { desligarSubidaDeTierDoWasm };
export { desligarSubidaDeTierDoWasm };
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('test/helpers/sem-tier-wasm.js')).digest('hex').slice(0,16))"
```

Esperado: `3d92d8c41a2a701b`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

Crie `test/sync-auth.test.js` com EXATAMENTE este conteúdo:

```js
// lib/sync/auth.js: login por e-mail e senha e renovação do ID token no Firebase
// Auth por REST. O dublê é test/helpers/fake-identity.js; os casos que o dublê não
// produz (bloqueio por excesso, rede caída, timeout) entram por fetchImpl injetado.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeIdentity } from './helpers/fake-identity.js';
import { SYNC } from '../lib/constants.js';
import auth, { signInWithPassword, refreshIdToken, createTokenSource } from '../lib/sync/auth.js';

const SENHA = 'segredo';
let fake;
let identityUrl;
let tokenUrl;

before(async () => {
  fake = await startFakeIdentity();
  identityUrl = `${fake.url}/v1`;
  tokenUrl = `${fake.url}/v1/token`;
});
after(async () => { await fake.close(); });

const AGORA = 1757500000000;
const agora = () => AGORA;

function entrar(extra = {}) {
  return signInWithPassword({ apiKey: 'key-1', email: 'a@b.com', password: SENHA, identityUrl, agora, ...extra });
}

// fetch falso que devolve uma resposta fixa, para os casos que o dublê não produz
function respostaFixa(status, corpo) {
  return async () => new Response(corpo === undefined ? '' : JSON.stringify(corpo), { status });
}

function semSenha(resultado) {
  assert.doesNotMatch(JSON.stringify(resultado), new RegExp(SENHA), 'a senha nunca volta em resultado de erro');
}

test('signInWithPassword: login certo devolve uid, tokens e o vencimento em ms', async () => {
  const r = await entrar();
  assert.equal(r.ok, true);
  assert.equal(r.uid, 'u1');
  assert.equal(r.email, 'a@b.com');
  assert.ok(fake.tokens.idTokens.includes(r.idToken));
  assert.ok(fake.tokens.refreshTokens.includes(r.refreshToken));
  assert.equal(r.expiresAtMs, AGORA + 3600 * 1000, 'expiresIn chega como string de segundos');
  assert.equal(r.password, undefined);
});

test('signInWithPassword: POST JSON com returnSecureToken e a chave na query', async () => {
  await entrar();
  const req = fake.requests.at(-1);
  assert.equal(req.method, 'POST');
  assert.equal(req.path, '/v1/accounts:signInWithPassword');
  assert.equal(req.query.key, 'key-1');
  assert.match(req.headers['content-type'], /application\/json/);
  assert.deepEqual(JSON.parse(req.body), { email: 'a@b.com', password: SENHA, returnSecureToken: true });
});

test('signInWithPassword: senha errada ou e-mail desconhecido viram credencial_invalida', async () => {
  for (const extra of [{ password: 'errada' }, { email: 'x@y.com' }]) {
    const r = await entrar(extra);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'credencial_invalida');
    assert.equal(typeof r.motivo, 'string');
    semSenha(r);
  }
});

test('signInWithPassword: chave web recusada vira config_invalida', async () => {
  const r = await entrar({ apiKey: 'key-errada' });
  assert.equal(r.code, 'config_invalida');
  semSenha(r);
});

test('signInWithPassword: TOO_MANY_ATTEMPTS vira muitas_tentativas', async () => {
  const fetchImpl = respostaFixa(400, { error: { code: 400, message: 'TOO_MANY_ATTEMPTS_TRY_LATER : Too many unsuccessful login attempts. Please try again later.' } });
  const r = await entrar({ fetchImpl });
  assert.equal(r.code, 'muitas_tentativas');
  semSenha(r);
});

test('signInWithPassword: 5xx sem corpo vira indisponivel; 200 sem os campos vira resposta_invalida', async () => {
  assert.equal((await entrar({ fetchImpl: respostaFixa(503) })).code, 'indisponivel');
  assert.equal((await entrar({ fetchImpl: respostaFixa(200, { idToken: 'x' }) })).code, 'resposta_invalida');
  assert.equal((await entrar({ fetchImpl: respostaFixa(200, [1]) })).code, 'resposta_invalida');
  assert.equal((await entrar({ fetchImpl: respostaFixa(400) })).code, 'resposta_invalida');
});

test('signInWithPassword: sem chave web ou sem senha nem toca a rede', async () => {
  let chamadas = 0;
  const fetchImpl = async () => { chamadas++; return new Response('{}'); };
  assert.equal((await entrar({ apiKey: '', fetchImpl })).code, 'config_invalida');
  assert.equal((await entrar({ password: '', fetchImpl })).code, 'credencial_invalida');
  assert.equal((await entrar({ email: '', fetchImpl })).code, 'credencial_invalida');
  assert.equal(chamadas, 0);
});

test('signInWithPassword: rede caída vira indisponivel sem vazar a senha', async () => {
  const fetchImpl = async () => { throw new TypeError('fetch failed'); };
  const r = await entrar({ fetchImpl });
  assert.deepEqual(Object.keys(r).sort(), ['code', 'motivo', 'ok']);
  assert.equal(r.code, 'indisponivel');
  semSenha(r);
});

test('signInWithPassword: sem resposta no teto de tempo vira timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fetchImpl = (_url, opts) => new Promise((_resolve, reject) => {
    opts.signal.addEventListener('abort', () => {
      const e = new Error('This operation was aborted');
      e.name = 'AbortError';
      reject(e);
    });
  });
  const pendente = entrar({ fetchImpl });
  t.mock.timers.tick(SYNC.REQUEST_TIMEOUT_MS);
  const r = await pendente;
  assert.equal(r.code, 'timeout');
  semSenha(r);
});

test('refreshIdToken: POST form-urlencoded com o refresh token codificado', async () => {
  const login = await entrar();
  const r = await refreshIdToken({ apiKey: 'key-1', refreshToken: login.refreshToken, tokenUrl, agora });
  assert.equal(r.ok, true);
  assert.equal(r.uid, 'u1');
  assert.ok(fake.tokens.idTokens.includes(r.idToken));
  assert.equal(r.expiresAtMs, AGORA + 3600 * 1000);
  const req = fake.requests.at(-1);
  assert.equal(req.path, '/v1/token');
  assert.equal(req.query.key, 'key-1');
  assert.match(req.headers['content-type'], /application\/x-www-form-urlencoded/);
  assert.equal(req.body, `grant_type=refresh_token&refresh_token=${encodeURIComponent(login.refreshToken)}`);
});

test('refreshIdToken: refresh token revogado ou desconhecido vira credencial_invalida', async () => {
  const login = await entrar();
  fake.revogar(login.refreshToken);
  const r = await refreshIdToken({ apiKey: 'key-1', refreshToken: login.refreshToken, tokenUrl, agora });
  assert.equal(r.code, 'credencial_invalida');
  const r2 = await refreshIdToken({ apiKey: 'key-1', refreshToken: 'rt-inventado', tokenUrl, agora });
  assert.equal(r2.code, 'credencial_invalida');
});

test('refreshIdToken: rede caída vira indisponivel', async () => {
  const r = await refreshIdToken({ apiKey: 'key-1', refreshToken: 'x', tokenUrl, agora, fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  assert.equal(r.code, 'indisponivel');
});

test('createTokenSource: usa o cache até a margem de renovação', async () => {
  const login = await entrar();
  let relogio = AGORA;
  const fonte = createTokenSource({ apiKey: 'key-1', refreshToken: login.refreshToken, tokenUrl, agora: () => relogio });
  const antes = fake.requests.length;
  const a = await fonte.getIdToken();
  assert.equal(a.ok, true);
  assert.equal(fake.requests.length, antes + 1, 'a primeira chamada renova');
  relogio = AGORA + 3600 * 1000 - SYNC.TOKEN_MARGIN_MS - 1;
  const b = await fonte.getIdToken();
  assert.equal(b.idToken, a.idToken, 'dentro da margem é o mesmo token, sem rede');
  assert.equal(fake.requests.length, antes + 1);
  relogio = AGORA + 3600 * 1000 - SYNC.TOKEN_MARGIN_MS;
  const c = await fonte.getIdToken();
  assert.notEqual(c.idToken, a.idToken, 'na margem renova');
  assert.equal(fake.requests.length, antes + 2);
});

test('createTokenSource: chamadas concorrentes fazem UMA renovação', async () => {
  const login = await entrar();
  const fonte = createTokenSource({ apiKey: 'key-1', refreshToken: login.refreshToken, tokenUrl, agora });
  const antes = fake.requests.length;
  const todos = await Promise.all([1, 2, 3, 4, 5].map(() => fonte.getIdToken()));
  assert.equal(fake.requests.length, antes + 1);
  assert.equal(new Set(todos.map((x) => x.idToken)).size, 1);
});

test('createTokenSource: a rotação do refresh token chega no onRefresh e é usada na próxima', async () => {
  const login = await entrar();
  const rotacoes = [];
  const fonte = createTokenSource({ apiKey: 'key-1', refreshToken: login.refreshToken, tokenUrl, agora, onRefresh: (x) => rotacoes.push(x) });
  await fonte.getIdToken();
  assert.equal(rotacoes.length, 1);
  assert.notEqual(rotacoes[0].refreshToken, login.refreshToken);
  assert.deepEqual(Object.keys(rotacoes[0]), ['refreshToken']);
  fonte.invalidate();
  await fonte.getIdToken();
  const req = fake.requests.at(-1);
  assert.equal(new URLSearchParams(req.body).get('refresh_token'), rotacoes[0].refreshToken, 'renova com o token rotacionado');
  assert.equal(rotacoes.length, 2);
});

test('createTokenSource: invalidate força renovação; falha devolve o código sem cachear', async () => {
  const login = await entrar();
  const fonte = createTokenSource({ apiKey: 'key-1', refreshToken: login.refreshToken, tokenUrl, agora });
  const a = await fonte.getIdToken();
  fonte.invalidate();
  const b = await fonte.getIdToken();
  assert.notEqual(b.idToken, a.idToken);
  fake.revogar(fake.tokens.refreshTokens.at(-1));
  fonte.invalidate();
  const c = await fonte.getIdToken();
  assert.deepEqual(c, { ok: false, code: 'credencial_invalida', motivo: c.motivo });
  const d = await fonte.getIdToken();
  assert.equal(d.ok, false, 'falha não vira token em cache');
});

test('createTokenSource: onRefresh que lança não derruba a renovação', async () => {
  const login = await entrar();
  const fonte = createTokenSource({ apiKey: 'key-1', refreshToken: login.refreshToken, tokenUrl, agora, onRefresh: () => { throw new Error('disco cheio'); } });
  const r = await fonte.getIdToken();
  assert.equal(r.ok, true);
});

test('export default carrega o mesmo contrato dos nomeados', () => {
  assert.equal(auth.signInWithPassword, signInWithPassword);
  assert.equal(auth.refreshIdToken, refreshIdToken);
  assert.equal(auth.createTokenSource, createTokenSource);
});
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('test/sync-auth.test.js')).digest('hex').slice(0,16))"
```

Esperado: `7d1350d4d3cd13a7`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

- [ ] **Passo 2: rodar e ver falhar**

```bash
node --test --test-force-exit test/sync-auth.test.js
```

Esperado: FALHA. Cannot find module lib/sync/auth.js.

- [ ] **Passo 3: implementar**

Crie `lib/sync/auth.js` com EXATAMENTE este conteúdo:

```js
// Login e renovação de token no Firebase Auth por REST (Identity Toolkit e
// securetoken). E-mail e senha porque é o único fluxo headless que funciona igual no
// Electron e no Termux/proot, sem navegador nem registro de app OAuth.
//
// A senha entra só no corpo do POST de login e nunca volta em resultado nenhum: todo
// erro sai como { ok:false, code, motivo } com o motivo da tabela de errors.js, e
// não com a mensagem crua do fornecedor.
//
// fetch entra por injeção para o teste não tocar a rede.
import { SYNC } from '../constants.js';
import io from '../io.js';
import { SYNC_CODES, codeFromStatus, codeFromIdentityMessage, motivoDe } from './errors.js';

// cabeçalhos fora da chamada: objeto literal aninhado conta como nível de chave no gate
const CABECALHO_JSON = { 'Content-Type': 'application/json' };
const CABECALHO_FORM = { 'Content-Type': 'application/x-www-form-urlencoded' };

function falha(code) {
  return { ok: false, code, motivo: motivoDe(code) };
}

// AbortError é o nosso alarme de tempo disparando; qualquer outra rejeição do fetch
// (DNS, conexão recusada, TLS) é rede.
function codigoDeRede(err) {
  return err && err.name === 'AbortError' ? SYNC_CODES.TIMEOUT : SYNC_CODES.INDISPONIVEL;
}

// O alarme cobre o corpo também: um servidor que manda o cabeçalho e trava no corpo
// seguraria o login para sempre se o timeout parasse no primeiro byte.
async function postar(fetchImpl, url, headers, body) {
  const controle = new AbortController();
  const alarme = setTimeout(() => controle.abort(), SYNC.REQUEST_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { method: 'POST', headers, body, signal: controle.signal });
    const texto = await res.text();
    return { status: res.status, ok: res.ok, corpo: io.parseJson(texto, null) };
  } catch (err) {
    return { erro: codigoDeRede(err) };
  } finally {
    clearTimeout(alarme);
  }
}

// 5xx é sempre indisponibilidade (transitória), mesmo com mensagem no corpo; abaixo
// disso o código do Identity Toolkit é o que diz se foi credencial, excesso ou chave.
function codigoDoErro(resp) {
  if (resp.status >= 500) return codeFromStatus(resp.status);
  const erro = resp.corpo && typeof resp.corpo === 'object' ? resp.corpo.error : null;
  if (erro && typeof erro.message === 'string') return codeFromIdentityMessage(erro.message);
  return codeFromStatus(resp.status);
}

function objeto(corpo) {
  return corpo && typeof corpo === 'object' && !Array.isArray(corpo) ? corpo : null;
}

function naoVazio(v) {
  return typeof v === 'string' && v.length > 0;
}

// expiresIn/expires_in chegam como STRING de segundos; número inválido não vira
// token eterno, vira resposta inválida.
function vencimento(agora, segundos) {
  const s = Number(segundos);
  return Number.isFinite(s) && s > 0 ? agora() + s * 1000 : 0;
}

async function signInWithPassword({ apiKey, email, password, fetchImpl = fetch, identityUrl = SYNC.IDENTITY_TOOLKIT_URL, agora = Date.now }) {
  if (!naoVazio(apiKey)) return falha(SYNC_CODES.CONFIG_INVALIDA);
  if (!naoVazio(email) || !naoVazio(password)) return falha(SYNC_CODES.CREDENCIAL_INVALIDA);
  const url = `${identityUrl}/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`;
  const corpo = io.safeStringify({ email, password, returnSecureToken: true });
  const resp = await postar(fetchImpl, url, CABECALHO_JSON, corpo);
  if (resp.erro) return falha(resp.erro);
  if (!resp.ok) return falha(codigoDoErro(resp));
  const d = objeto(resp.corpo);
  const expiresAtMs = d ? vencimento(agora, d.expiresIn) : 0;
  if (!d || !naoVazio(d.idToken) || !naoVazio(d.refreshToken) || !naoVazio(d.localId) || !expiresAtMs) {
    return falha(SYNC_CODES.RESPOSTA_INVALIDA);
  }
  return { ok: true, uid: d.localId, email: naoVazio(d.email) ? d.email : email, idToken: d.idToken, refreshToken: d.refreshToken, expiresAtMs };
}

async function refreshIdToken({ apiKey, refreshToken, fetchImpl = fetch, tokenUrl = SYNC.SECURE_TOKEN_URL, agora = Date.now }) {
  if (!naoVazio(apiKey)) return falha(SYNC_CODES.CONFIG_INVALIDA);
  if (!naoVazio(refreshToken)) return falha(SYNC_CODES.SEM_CREDENCIAL);
  const url = `${tokenUrl}?key=${encodeURIComponent(apiKey)}`;
  const corpo = `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`;
  const resp = await postar(fetchImpl, url, CABECALHO_FORM, corpo);
  if (resp.erro) return falha(resp.erro);
  if (!resp.ok) return falha(codigoDoErro(resp));
  const d = objeto(resp.corpo);
  const expiresAtMs = d ? vencimento(agora, d.expires_in) : 0;
  if (!d || !naoVazio(d.id_token) || !naoVazio(d.user_id) || !expiresAtMs) return falha(SYNC_CODES.RESPOSTA_INVALIDA);
  // resposta sem refresh_token mantém o que já funcionava: não há rotação a registrar
  const novo = naoVazio(d.refresh_token) ? d.refresh_token : refreshToken;
  return { ok: true, uid: d.user_id, idToken: d.id_token, refreshToken: novo, expiresAtMs };
}

// Fonte de ID token com cache. Renova MARGEM antes de vencer (a chamada que usa o
// token ainda leva até REQUEST_TIMEOUT_MS para chegar ao banco) e faz UMA renovação
// por vez: o heartbeat do lease, o tick de presença e a outbox pedem token no mesmo
// ciclo, e três renovações em paralelo só gastariam cota do securetoken.
function createTokenSource({ apiKey, refreshToken, fetchImpl, tokenUrl, agora = Date.now, onRefresh }) {
  let atual = refreshToken;
  let cache = null;
  let emVoo = null;

  function avisarRotacao(novo) {
    if (!onRefresh) return;
    // guardar a rotação é problema de quem guarda; o token novo já vale nesta fonte
    try { onRefresh({ refreshToken: novo }); } catch { /* falha ao persistir não invalida o token em memória */ }
  }

  async function renovar() {
    const r = await refreshIdToken({ apiKey, refreshToken: atual, fetchImpl, tokenUrl, agora });
    if (!r.ok) {
      cache = null;
      return falha(r.code);
    }
    if (r.refreshToken !== atual) {
      atual = r.refreshToken;
      avisarRotacao(atual);
    }
    cache = { idToken: r.idToken, expiresAtMs: r.expiresAtMs };
    return { ok: true, idToken: r.idToken };
  }

  function getIdToken() {
    if (cache && agora() < cache.expiresAtMs - SYNC.TOKEN_MARGIN_MS) return Promise.resolve({ ok: true, idToken: cache.idToken });
    if (!emVoo) emVoo = renovar().finally(() => { emVoo = null; });
    return emVoo;
  }

  function invalidate() { cache = null; }

  return { getIdToken, invalidate };
}

export default { signInWithPassword, refreshIdToken, createTokenSource };
export { signInWithPassword, refreshIdToken, createTokenSource };
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('lib/sync/auth.js')).digest('hex').slice(0,16))"
```

Esperado: `dce61420ae926df7`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

- [ ] **Passo 4: rodar e ver passar**

```bash
node --test --test-force-exit test/sync-auth.test.js
```

Esperado: PASSA, 0 falhas.

- [ ] **Passo 5: gate e commit**

```bash
npm run check && npm run lint && npm test
```

Esperado: `fail 0` e `gate de qualidade: sem regressão`. Se algo falhar, PARE e relate; não mexa em outro arquivo para fazer passar.

```bash
git add lib/sync/auth.js test/helpers/fake-identity.js test/helpers/sem-tier-wasm.js test/sync-auth.test.js
git commit -m "feat(sync): login por e-mail e senha com renovação do ID token"
```


### Tarefa T06: Parser de SSE

O tempo real do recurso é REST mais SSE, sem SDK. O parser é puro e vem antes do cliente porque é ele que separa evento de keep-alive, e um evento cortado no meio de um pedaço da rede seria entregue pela metade.

**Arquivos:**
- Criar: `lib/sync/sse.js`
- Criar: `test/sync-sse.test.js`

- [ ] **Passo 1: escrever o teste**

Crie `test/sync-sse.test.js` com EXATAMENTE este conteúdo:

```js
// lib/sync/sse.js: o parser de Server-Sent Events do stream do RTDB. Puro. A rede
// entrega o corpo em pedaços arbitrários, então nenhum teste aqui pode supor que um
// pedaço termina numa linha inteira.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sse, { createSseParser } from '../lib/sync/sse.js';

function coletar() {
  const eventos = [];
  const p = createSseParser((e) => eventos.push(e));
  return { p, eventos };
}

test('evento simples com nome e dado', () => {
  const { p, eventos } = coletar();
  p.feed('event: put\ndata: {"path":"/","data":1}\n\n');
  assert.deepEqual(eventos, [{ event: 'put', data: '{"path":"/","data":1}' }]);
});

test('pedaços cortados no meio da linha e no meio do nome do campo', () => {
  const { p, eventos } = coletar();
  const texto = 'event: patch\ndata: {"path":"/a","data":{"x":2}}\n\nevent: put\ndata: null\n\n';
  for (const pedaco of texto.match(/.{1,3}/gs)) p.feed(pedaco);
  assert.deepEqual(eventos, [
    { event: 'patch', data: '{"path":"/a","data":{"x":2}}' },
    { event: 'put', data: 'null' },
  ]);
});

test('aceita \r\n, inclusive com o \r e o \n em pedaços diferentes', () => {
  const { p, eventos } = coletar();
  p.feed('event: put\r');
  p.feed('\ndata: 1\r\n\r');
  p.feed('\n');
  assert.deepEqual(eventos, [{ event: 'put', data: '1' }]);
});

test('várias linhas data: viram um texto só, separado por \n', () => {
  const { p, eventos } = coletar();
  p.feed('data: linha1\ndata: linha2\ndata:linha3\n\n');
  assert.deepEqual(eventos, [{ event: 'message', data: 'linha1\nlinha2\nlinha3' }]);
});

test('linha que começa com ":" é comentário e não despacha nada', () => {
  const { p, eventos } = coletar();
  p.feed(': ping\n\n:outro\nevent: put\n: no meio\ndata: x\n\n');
  assert.deepEqual(eventos, [{ event: 'put', data: 'x' }]);
});

test('linha vazia sem nada pendente não inventa evento', () => {
  const { p, eventos } = coletar();
  p.feed('\n\n\n');
  assert.deepEqual(eventos, []);
});

test('dois-pontos dentro do valor fazem parte do dado', () => {
  const { p, eventos } = coletar();
  p.feed('event: put\ndata: {"a":"b: c"}\n\n');
  assert.equal(eventos[0].data, '{"a":"b: c"}');
});

test('campos desconhecidos (id, retry) são ignorados', () => {
  const { p, eventos } = coletar();
  p.feed('id: 7\nretry: 1000\nevent: put\ndata: 1\n\n');
  assert.deepEqual(eventos, [{ event: 'put', data: '1' }]);
});

test('o nome do evento zera depois de despachar', () => {
  const { p, eventos } = coletar();
  p.feed('event: keep-alive\ndata: null\n\ndata: 2\n\n');
  assert.deepEqual(eventos, [{ event: 'keep-alive', data: 'null' }, { event: 'message', data: '2' }]);
});

test('end() despacha o pendente, inclusive a última linha sem \n', () => {
  const { p, eventos } = coletar();
  p.feed('event: put\ndata: {"x":');
  assert.deepEqual(eventos, []);
  p.feed('1}');
  p.end();
  assert.deepEqual(eventos, [{ event: 'put', data: '{"x":1}' }]);
  p.end();
  assert.equal(eventos.length, 1, 'end() repetido não duplica');
});

test('end() sem pendência não despacha', () => {
  const { p, eventos } = coletar();
  p.feed('event: put\ndata: 1\n\n');
  p.end();
  assert.equal(eventos.length, 1);
});

test('export default carrega o mesmo contrato do nomeado', () => {
  assert.equal(sse.createSseParser, createSseParser);
});
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('test/sync-sse.test.js')).digest('hex').slice(0,16))"
```

Esperado: `570215c635ead774`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

- [ ] **Passo 2: rodar e ver falhar**

```bash
node --test --test-force-exit test/sync-sse.test.js
```

Esperado: FALHA. Cannot find module lib/sync/sse.js.

- [ ] **Passo 3: implementar**

Crie `lib/sync/sse.js` com EXATAMENTE este conteúdo:

```js
// Parser de Server-Sent Events para o stream do RTDB. Puro: não sabe de rede nem
// de JSON, só transforma texto em eventos { event, data }.
//
// A rede entrega o corpo em pedaços arbitrários (no meio da linha, entre o \r e o
// \n), então a linha incompleta fica guardada até o \n chegar. Evento só sai com
// algo pendente: linha vazia solta é o separador do protocolo, não um evento vazio.
function createSseParser(onEvent) {
  let resto = '';
  let nome = '';
  let dados = [];
  let pendente = false;

  function despachar() {
    if (!pendente) return;
    const evento = { event: nome || 'message', data: dados.join('\n') };
    nome = '';
    dados = [];
    pendente = false;
    onEvent(evento);
  }

  // campo sem dois-pontos é o nome inteiro com valor vazio; um espaço logo depois
  // dos dois-pontos é separador do protocolo, não parte do valor
  function campo(linha) {
    const i = linha.indexOf(':');
    if (i < 0) return [linha, ''];
    const valor = linha.slice(i + 1);
    return [linha.slice(0, i), valor.startsWith(' ') ? valor.slice(1) : valor];
  }

  function linha(texto) {
    const l = texto.endsWith('\r') ? texto.slice(0, -1) : texto;
    if (l === '') return despachar();
    if (l.startsWith(':')) return undefined;
    const [chave, valor] = campo(l);
    if (chave === 'event') { nome = valor; pendente = true; }
    if (chave === 'data') { dados.push(valor); pendente = true; }
    return undefined;
  }

  function feed(chunk) {
    resto += String(chunk);
    let i = resto.indexOf('\n');
    while (i >= 0) {
      linha(resto.slice(0, i));
      resto = resto.slice(i + 1);
      i = resto.indexOf('\n');
    }
  }

  function end() {
    if (resto) {
      linha(resto);
      resto = '';
    }
    despachar();
  }

  return { feed, end };
}

export default { createSseParser };
export { createSseParser };
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('lib/sync/sse.js')).digest('hex').slice(0,16))"
```

Esperado: `88e276d05160a659`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

- [ ] **Passo 4: rodar e ver passar**

```bash
node --test --test-force-exit test/sync-sse.test.js
```

Esperado: PASSA, 0 falhas.

- [ ] **Passo 5: gate e commit**

```bash
npm run check && npm run lint && npm test
```

Esperado: `fail 0` e `gate de qualidade: sem regressão`. Se algo falhar, PARE e relate; não mexa em outro arquivo para fazer passar.

```bash
git add lib/sync/sse.js test/sync-sse.test.js
git commit -m "feat(sync): parser de Server-Sent Events"
```


### Tarefa T07: Cliente REST do Realtime Database e o dublê do banco

É o único ponto que fala com o banco. Tudo que é CAS (lease, recibo, rodada) depende do ETag que ele lê, e uma leitura que pede ETag e volta sem ele é RECUSADA: aceitar o vazio faria a escrita seguinte sair sem if-match, por cima do que outro aparelho acabou de gravar.

**Arquivos:**
- Criar: `lib/sync/rtdb.js`
- Criar: `test/helpers/fake-rtdb.js`
- Criar: `test/sync-rtdb.test.js`

- [ ] **Passo 1: escrever o teste**

Crie `test/helpers/fake-rtdb.js` com EXATAMENTE este conteúdo:

```js
// Dublê do Firebase Realtime Database por REST, em processo. Sem efeito colateral
// no import: o `node --test` executa test/**/*.js, e um arquivo que só exporta
// funções passa vazio.
//
// Imita a parte do protocolo que o cliente do Farol consome: `?auth=` com o ID
// token, ETag e `if-match` (CAS só em PUT/DELETE; PATCH com `if-match` é 400),
// `null_etag` para o nó vazio, `{".sv":"timestamp"}`, `?shallow`, `?print=silent`
// e o stream SSE (`put` inicial, `put` a cada escrita sob o caminho, `keep-alive`,
// `auth_revoked` e `cancel`). O emulador real só entra na validação manual, porque o
// CI não tem Java nem firebase-tools.
import http from 'node:http';
import { createHash } from 'node:crypto';
import { desligarSubidaDeTierDoWasm } from './sem-tier-wasm.js';

const PROIBIDO = /[.$#[\]/\u0000-\u001f\u007f]/;

function copia(v) {
  return v === undefined ? null : JSON.parse(JSON.stringify(v));
}

function canonico(v) {
  if (Array.isArray(v)) return `[${v.map(canonico).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonico(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

function etagDe(v) {
  if (v === null || v === undefined) return 'null_etag';
  return createHash('sha1').update(canonico(v)).digest('hex');
}

function chaveInvalida(k) {
  return !k || PROIBIDO.test(k);
}

// resolve {".sv":"timestamp"}, poda nulos e objeto vazio vira null, como o RTDB
function normalizar(v, agora) {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'object') return v;
  if (!Array.isArray(v) && Object.keys(v).length === 1 && v['.sv'] === 'timestamp') return agora();
  const saida = {};
  for (const [k, filho] of Object.entries(v)) {
    if (chaveInvalida(k)) throw new Error('chave inválida');
    const n = normalizar(filho, agora);
    if (n !== null) saida[k] = n;
  }
  return Object.keys(saida).length ? saida : null;
}

function segmentos(caminho) {
  return caminho.split('/').filter(Boolean);
}

function ler(raiz, segs) {
  let no = raiz;
  for (const s of segs) {
    if (!no || typeof no !== 'object') return null;
    no = no[s];
  }
  return no === undefined ? null : no;
}

function gravar(raiz, segs, valor) {
  if (!segs.length) return valor;
  const base = raiz && typeof raiz === 'object' ? { ...raiz } : {};
  const filho = gravar(base[segs[0]], segs.slice(1), valor);
  if (filho === null) delete base[segs[0]];
  else base[segs[0]] = filho;
  return Object.keys(base).length ? base : null;
}

function lerCorpo(req) {
  return new Promise((resolve) => {
    let dados = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { dados += c; });
    req.on('end', () => resolve(dados));
  });
}

function relativo(base, alvo) {
  return '/' + alvo.slice(base.length).join('/');
}

// `token` pode ser o texto exato ou um predicado: o teste da composição (login de
// verdade no dublê do Auth) precisa aceitar os ID tokens que o outro dublê emitiu,
// como o banco real aceita qualquer token válido do mesmo projeto.
export async function startFakeRtdb({ token = 'tok-ok', agora = () => Date.now() } = {}) {
  // antes de qualquer fetch contra o dublê: ver test/helpers/sem-tier-wasm.js
  desligarSubidaDeTierDoWasm();
  const aceitaToken = typeof token === 'function' ? token : (t) => t === token;
  let raiz = null;
  let relogio = null;
  // proxy ou servidor mal configurado que engole o cabeçalho ETag: o CAS do cliente
  // depende dele, e o teste precisa poder produzir esse caso
  let semEtag = false;
  const requests = [];
  const abertos = new Set();
  const tempo = () => (relogio === null ? agora() : relogio);

  function enviar(res, status, corpo, etag) {
    const headers = { 'Content-Type': 'application/json; charset=utf-8' };
    if (etag && !semEtag) headers.ETag = etag;
    res.writeHead(status, headers);
    res.end(corpo === undefined ? '' : JSON.stringify(corpo));
  }

  function evento(stream, nome, dados) {
    stream.res.write(`event: ${nome}\ndata: ${JSON.stringify(dados)}\n\n`);
  }

  function notificar(segsEscrita) {
    for (const s of abertos) {
      const prefixo = s.segs.every((x, i) => segsEscrita[i] === x);
      const ancestral = segsEscrita.every((x, i) => s.segs[i] === x);
      if (prefixo && segsEscrita.length >= s.segs.length) evento(s, 'put', { path: relativo(s.segs, segsEscrita), data: ler(raiz, segsEscrita) });
      else if (ancestral) evento(s, 'put', { path: '/', data: ler(raiz, s.segs) });
    }
  }

  function fechar(s) {
    clearInterval(s.pulso);
    abertos.delete(s);
    s.res.end();
  }

  function abrirStream(res, segs) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    const s = { res, segs, pulso: null };
    s.pulso = setInterval(() => res.write('event: keep-alive\ndata: null\n\n'), 100);
    abertos.add(s);
    res.on('close', () => { clearInterval(s.pulso); abertos.delete(s); });
    evento(s, 'put', { path: '/', data: ler(raiz, segs) });
  }

  function aplicarPatch(segs, corpo) {
    if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) throw new Error('patch sem objeto');
    for (const [k, v] of Object.entries(corpo)) {
      const alvo = [...segs, ...segmentos(k)];
      if (!segmentos(k).length || segmentos(k).some(chaveInvalida)) throw new Error('chave inválida');
      raiz = gravar(raiz, alvo, normalizar(v, tempo));
    }
    return ler(raiz, segs);
  }

  function tratar(req, res, u, body) {
    const segs = segmentos(decodeURIComponent(u.pathname.replace(/\.json$/, '')));
    const querEtag = String(req.headers['x-firebase-etag'] || '') === 'true';
    const ifMatch = req.headers['if-match'];
    if (!aceitaToken(u.searchParams.get('auth'))) return enviar(res, 401, { error: 'Permission denied' });
    if (ifMatch !== undefined && (req.method === 'PATCH' || req.method === 'GET')) return enviar(res, 400, { error: 'if-match só vale em PUT e DELETE' });
    if (segs.some(chaveInvalida)) return enviar(res, 400, { error: 'Invalid path' });
    if (req.method === 'GET' && String(req.headers.accept || '').includes('text/event-stream')) return abrirStream(res, segs);
    const atual = ler(raiz, segs);
    if (ifMatch !== undefined && ifMatch !== etagDe(atual)) return enviar(res, 412, atual, etagDe(atual));
    let resultado;
    try {
      resultado = executar(req.method, segs, body, u, atual);
    } catch (err) {
      return enviar(res, 400, { error: err.message });
    }
    if (u.searchParams.get('print') === 'silent') { res.writeHead(204); return res.end(); }
    return enviar(res, 200, resultado, querEtag ? etagDe(resultado) : '');
  }

  function executar(metodo, segs, body, u, atual) {
    if (metodo === 'GET') {
      if (u.searchParams.get('shallow') !== 'true' || !atual || typeof atual !== 'object') return atual;
      return Object.fromEntries(Object.keys(atual).map((k) => [k, true]));
    }
    if (metodo === 'PUT') {
      const valor = normalizar(JSON.parse(body || 'null'), tempo);
      raiz = gravar(raiz, segs, valor);
      notificar(segs);
      return ler(raiz, segs);
    }
    if (metodo === 'PATCH') {
      const valor = aplicarPatch(segs, JSON.parse(body || 'null'));
      notificar(segs);
      return valor;
    }
    if (metodo === 'DELETE') {
      raiz = gravar(raiz, segs, null);
      notificar(segs);
      return null;
    }
    throw new Error('método não suportado');
  }

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    const body = await lerCorpo(req);
    requests.push({ method: req.method, path: u.pathname, query: Object.fromEntries(u.searchParams), headers: req.headers, body });
    tratar(req, res, u, body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    tree: () => copia(raiz),
    setTree(obj) { raiz = normalizar(copia(obj), tempo); },
    setNow(ms) { relogio = ms; },
    setSemEtag(v) { semEtag = !!v; },
    get streams() { return abertos.size; },
    fecharStreams() { for (const s of [...abertos]) fechar(s); },
    emitirAuthRevoked() {
      for (const s of [...abertos]) {
        evento(s, 'auth_revoked', 'credential is no longer valid');
        fechar(s);
      }
    },
    // o banco manda `cancel` quando a regra deixa de permitir a leitura do caminho
    emitirCancel() {
      for (const s of [...abertos]) {
        evento(s, 'cancel', null);
        fechar(s);
      }
    },
    close() {
      return new Promise((resolve) => {
        for (const s of [...abertos]) fechar(s);
        server.closeAllConnections();
        server.close(() => resolve());
      });
    },
  };
}

export default { startFakeRtdb };
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('test/helpers/fake-rtdb.js')).digest('hex').slice(0,16))"
```

Esperado: `627abc1e979243af`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.
Este arquivo tem sequências de escape que a transcrição costuma normalizar sem querer. Se o hash não bater na segunda tentativa, PARE de transcrever e materialize-o com o comando abaixo, que grava os bytes exatos:

```bash
node -e "require('fs').writeFileSync('test/helpers/fake-rtdb.js', Buffer.from(process.argv[1],'base64'))" Ly8gRHVibMOqIGRvIEZpcmViYXNlIFJlYWx0aW1lIERhdGFiYXNlIHBvciBSRVNULCBlbSBwcm9jZXNzby4gU2VtIGVmZWl0byBjb2xhdGVyYWwKLy8gbm8gaW1wb3J0OiBvIGBub2RlIC0tdGVzdGAgZXhlY3V0YSB0ZXN0LyoqLyouanMsIGUgdW0gYXJxdWl2byBxdWUgc8OzIGV4cG9ydGEKLy8gZnVuw6fDtWVzIHBhc3NhIHZhemlvLgovLwovLyBJbWl0YSBhIHBhcnRlIGRvIHByb3RvY29sbyBxdWUgbyBjbGllbnRlIGRvIEZhcm9sIGNvbnNvbWU6IGA/YXV0aD1gIGNvbSBvIElECi8vIHRva2VuLCBFVGFnIGUgYGlmLW1hdGNoYCAoQ0FTIHPDsyBlbSBQVVQvREVMRVRFOyBQQVRDSCBjb20gYGlmLW1hdGNoYCDDqSA0MDApLAovLyBgbnVsbF9ldGFnYCBwYXJhIG8gbsOzIHZhemlvLCBgeyIuc3YiOiJ0aW1lc3RhbXAifWAsIGA/c2hhbGxvd2AsIGA/cHJpbnQ9c2lsZW50YAovLyBlIG8gc3RyZWFtIFNTRSAoYHB1dGAgaW5pY2lhbCwgYHB1dGAgYSBjYWRhIGVzY3JpdGEgc29iIG8gY2FtaW5obywgYGtlZXAtYWxpdmVgLAovLyBgYXV0aF9yZXZva2VkYCBlIGBjYW5jZWxgKS4gTyBlbXVsYWRvciByZWFsIHPDsyBlbnRyYSBuYSB2YWxpZGHDp8OjbyBtYW51YWwsIHBvcnF1ZSBvCi8vIENJIG7Do28gdGVtIEphdmEgbmVtIGZpcmViYXNlLXRvb2xzLgppbXBvcnQgaHR0cCBmcm9tICdub2RlOmh0dHAnOwppbXBvcnQgeyBjcmVhdGVIYXNoIH0gZnJvbSAnbm9kZTpjcnlwdG8nOwppbXBvcnQgeyBkZXNsaWdhclN1YmlkYURlVGllckRvV2FzbSB9IGZyb20gJy4vc2VtLXRpZXItd2FzbS5qcyc7Cgpjb25zdCBQUk9JQklETyA9IC9bLiQjW1xdL1x1MDAwMC1cdTAwMWZcdTAwN2ZdLzsKCmZ1bmN0aW9uIGNvcGlhKHYpIHsKICByZXR1cm4gdiA9PT0gdW5kZWZpbmVkID8gbnVsbCA6IEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkodikpOwp9CgpmdW5jdGlvbiBjYW5vbmljbyh2KSB7CiAgaWYgKEFycmF5LmlzQXJyYXkodikpIHJldHVybiBgWyR7di5tYXAoY2Fub25pY28pLmpvaW4oJywnKX1dYDsKICBpZiAodiAmJiB0eXBlb2YgdiA9PT0gJ29iamVjdCcpIHJldHVybiBgeyR7T2JqZWN0LmtleXModikuc29ydCgpLm1hcCgoaykgPT4gYCR7SlNPTi5zdHJpbmdpZnkoayl9OiR7Y2Fub25pY28odltrXSl9YCkuam9pbignLCcpfX1gOwogIHJldHVybiBKU09OLnN0cmluZ2lmeSh2KTsKfQoKZnVuY3Rpb24gZXRhZ0RlKHYpIHsKICBpZiAodiA9PT0gbnVsbCB8fCB2ID09PSB1bmRlZmluZWQpIHJldHVybiAnbnVsbF9ldGFnJzsKICByZXR1cm4gY3JlYXRlSGFzaCgnc2hhMScpLnVwZGF0ZShjYW5vbmljbyh2KSkuZGlnZXN0KCdoZXgnKTsKfQoKZnVuY3Rpb24gY2hhdmVJbnZhbGlkYShrKSB7CiAgcmV0dXJuICFrIHx8IFBST0lCSURPLnRlc3Qoayk7Cn0KCi8vIHJlc29sdmUgeyIuc3YiOiJ0aW1lc3RhbXAifSwgcG9kYSBudWxvcyBlIG9iamV0byB2YXppbyB2aXJhIG51bGwsIGNvbW8gbyBSVERCCmZ1bmN0aW9uIG5vcm1hbGl6YXIodiwgYWdvcmEpIHsKICBpZiAodiA9PT0gbnVsbCB8fCB2ID09PSB1bmRlZmluZWQpIHJldHVybiBudWxsOwogIGlmICh0eXBlb2YgdiAhPT0gJ29iamVjdCcpIHJldHVybiB2OwogIGlmICghQXJyYXkuaXNBcnJheSh2KSAmJiBPYmplY3Qua2V5cyh2KS5sZW5ndGggPT09IDEgJiYgdlsnLnN2J10gPT09ICd0aW1lc3RhbXAnKSByZXR1cm4gYWdvcmEoKTsKICBjb25zdCBzYWlkYSA9IHt9OwogIGZvciAoY29uc3QgW2ssIGZpbGhvXSBvZiBPYmplY3QuZW50cmllcyh2KSkgewogICAgaWYgKGNoYXZlSW52YWxpZGEoaykpIHRocm93IG5ldyBFcnJvcignY2hhdmUgaW52w6FsaWRhJyk7CiAgICBjb25zdCBuID0gbm9ybWFsaXphcihmaWxobywgYWdvcmEpOwogICAgaWYgKG4gIT09IG51bGwpIHNhaWRhW2tdID0gbjsKICB9CiAgcmV0dXJuIE9iamVjdC5rZXlzKHNhaWRhKS5sZW5ndGggPyBzYWlkYSA6IG51bGw7Cn0KCmZ1bmN0aW9uIHNlZ21lbnRvcyhjYW1pbmhvKSB7CiAgcmV0dXJuIGNhbWluaG8uc3BsaXQoJy8nKS5maWx0ZXIoQm9vbGVhbik7Cn0KCmZ1bmN0aW9uIGxlcihyYWl6LCBzZWdzKSB7CiAgbGV0IG5vID0gcmFpejsKICBmb3IgKGNvbnN0IHMgb2Ygc2VncykgewogICAgaWYgKCFubyB8fCB0eXBlb2Ygbm8gIT09ICdvYmplY3QnKSByZXR1cm4gbnVsbDsKICAgIG5vID0gbm9bc107CiAgfQogIHJldHVybiBubyA9PT0gdW5kZWZpbmVkID8gbnVsbCA6IG5vOwp9CgpmdW5jdGlvbiBncmF2YXIocmFpeiwgc2VncywgdmFsb3IpIHsKICBpZiAoIXNlZ3MubGVuZ3RoKSByZXR1cm4gdmFsb3I7CiAgY29uc3QgYmFzZSA9IHJhaXogJiYgdHlwZW9mIHJhaXogPT09ICdvYmplY3QnID8geyAuLi5yYWl6IH0gOiB7fTsKICBjb25zdCBmaWxobyA9IGdyYXZhcihiYXNlW3NlZ3NbMF1dLCBzZWdzLnNsaWNlKDEpLCB2YWxvcik7CiAgaWYgKGZpbGhvID09PSBudWxsKSBkZWxldGUgYmFzZVtzZWdzWzBdXTsKICBlbHNlIGJhc2Vbc2Vnc1swXV0gPSBmaWxobzsKICByZXR1cm4gT2JqZWN0LmtleXMoYmFzZSkubGVuZ3RoID8gYmFzZSA6IG51bGw7Cn0KCmZ1bmN0aW9uIGxlckNvcnBvKHJlcSkgewogIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4gewogICAgbGV0IGRhZG9zID0gJyc7CiAgICByZXEuc2V0RW5jb2RpbmcoJ3V0ZjgnKTsKICAgIHJlcS5vbignZGF0YScsIChjKSA9PiB7IGRhZG9zICs9IGM7IH0pOwogICAgcmVxLm9uKCdlbmQnLCAoKSA9PiByZXNvbHZlKGRhZG9zKSk7CiAgfSk7Cn0KCmZ1bmN0aW9uIHJlbGF0aXZvKGJhc2UsIGFsdm8pIHsKICByZXR1cm4gJy8nICsgYWx2by5zbGljZShiYXNlLmxlbmd0aCkuam9pbignLycpOwp9CgovLyBgdG9rZW5gIHBvZGUgc2VyIG8gdGV4dG8gZXhhdG8gb3UgdW0gcHJlZGljYWRvOiBvIHRlc3RlIGRhIGNvbXBvc2nDp8OjbyAobG9naW4gZGUKLy8gdmVyZGFkZSBubyBkdWJsw6ogZG8gQXV0aCkgcHJlY2lzYSBhY2VpdGFyIG9zIElEIHRva2VucyBxdWUgbyBvdXRybyBkdWJsw6ogZW1pdGl1LAovLyBjb21vIG8gYmFuY28gcmVhbCBhY2VpdGEgcXVhbHF1ZXIgdG9rZW4gdsOhbGlkbyBkbyBtZXNtbyBwcm9qZXRvLgpleHBvcnQgYXN5bmMgZnVuY3Rpb24gc3RhcnRGYWtlUnRkYih7IHRva2VuID0gJ3Rvay1vaycsIGFnb3JhID0gKCkgPT4gRGF0ZS5ub3coKSB9ID0ge30pIHsKICAvLyBhbnRlcyBkZSBxdWFscXVlciBmZXRjaCBjb250cmEgbyBkdWJsw6o6IHZlciB0ZXN0L2hlbHBlcnMvc2VtLXRpZXItd2FzbS5qcwogIGRlc2xpZ2FyU3ViaWRhRGVUaWVyRG9XYXNtKCk7CiAgY29uc3QgYWNlaXRhVG9rZW4gPSB0eXBlb2YgdG9rZW4gPT09ICdmdW5jdGlvbicgPyB0b2tlbiA6ICh0KSA9PiB0ID09PSB0b2tlbjsKICBsZXQgcmFpeiA9IG51bGw7CiAgbGV0IHJlbG9naW8gPSBudWxsOwogIC8vIHByb3h5IG91IHNlcnZpZG9yIG1hbCBjb25maWd1cmFkbyBxdWUgZW5nb2xlIG8gY2FiZcOnYWxobyBFVGFnOiBvIENBUyBkbyBjbGllbnRlCiAgLy8gZGVwZW5kZSBkZWxlLCBlIG8gdGVzdGUgcHJlY2lzYSBwb2RlciBwcm9kdXppciBlc3NlIGNhc28KICBsZXQgc2VtRXRhZyA9IGZhbHNlOwogIGNvbnN0IHJlcXVlc3RzID0gW107CiAgY29uc3QgYWJlcnRvcyA9IG5ldyBTZXQoKTsKICBjb25zdCB0ZW1wbyA9ICgpID0+IChyZWxvZ2lvID09PSBudWxsID8gYWdvcmEoKSA6IHJlbG9naW8pOwoKICBmdW5jdGlvbiBlbnZpYXIocmVzLCBzdGF0dXMsIGNvcnBvLCBldGFnKSB7CiAgICBjb25zdCBoZWFkZXJzID0geyAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb247IGNoYXJzZXQ9dXRmLTgnIH07CiAgICBpZiAoZXRhZyAmJiAhc2VtRXRhZykgaGVhZGVycy5FVGFnID0gZXRhZzsKICAgIHJlcy53cml0ZUhlYWQoc3RhdHVzLCBoZWFkZXJzKTsKICAgIHJlcy5lbmQoY29ycG8gPT09IHVuZGVmaW5lZCA/ICcnIDogSlNPTi5zdHJpbmdpZnkoY29ycG8pKTsKICB9CgogIGZ1bmN0aW9uIGV2ZW50byhzdHJlYW0sIG5vbWUsIGRhZG9zKSB7CiAgICBzdHJlYW0ucmVzLndyaXRlKGBldmVudDogJHtub21lfVxuZGF0YTogJHtKU09OLnN0cmluZ2lmeShkYWRvcyl9XG5cbmApOwogIH0KCiAgZnVuY3Rpb24gbm90aWZpY2FyKHNlZ3NFc2NyaXRhKSB7CiAgICBmb3IgKGNvbnN0IHMgb2YgYWJlcnRvcykgewogICAgICBjb25zdCBwcmVmaXhvID0gcy5zZWdzLmV2ZXJ5KCh4LCBpKSA9PiBzZWdzRXNjcml0YVtpXSA9PT0geCk7CiAgICAgIGNvbnN0IGFuY2VzdHJhbCA9IHNlZ3NFc2NyaXRhLmV2ZXJ5KCh4LCBpKSA9PiBzLnNlZ3NbaV0gPT09IHgpOwogICAgICBpZiAocHJlZml4byAmJiBzZWdzRXNjcml0YS5sZW5ndGggPj0gcy5zZWdzLmxlbmd0aCkgZXZlbnRvKHMsICdwdXQnLCB7IHBhdGg6IHJlbGF0aXZvKHMuc2Vncywgc2Vnc0VzY3JpdGEpLCBkYXRhOiBsZXIocmFpeiwgc2Vnc0VzY3JpdGEpIH0pOwogICAgICBlbHNlIGlmIChhbmNlc3RyYWwpIGV2ZW50byhzLCAncHV0JywgeyBwYXRoOiAnLycsIGRhdGE6IGxlcihyYWl6LCBzLnNlZ3MpIH0pOwogICAgfQogIH0KCiAgZnVuY3Rpb24gZmVjaGFyKHMpIHsKICAgIGNsZWFySW50ZXJ2YWwocy5wdWxzbyk7CiAgICBhYmVydG9zLmRlbGV0ZShzKTsKICAgIHMucmVzLmVuZCgpOwogIH0KCiAgZnVuY3Rpb24gYWJyaXJTdHJlYW0ocmVzLCBzZWdzKSB7CiAgICByZXMud3JpdGVIZWFkKDIwMCwgeyAnQ29udGVudC1UeXBlJzogJ3RleHQvZXZlbnQtc3RyZWFtJywgJ0NhY2hlLUNvbnRyb2wnOiAnbm8tY2FjaGUnIH0pOwogICAgY29uc3QgcyA9IHsgcmVzLCBzZWdzLCBwdWxzbzogbnVsbCB9OwogICAgcy5wdWxzbyA9IHNldEludGVydmFsKCgpID0+IHJlcy53cml0ZSgnZXZlbnQ6IGtlZXAtYWxpdmVcbmRhdGE6IG51bGxcblxuJyksIDEwMCk7CiAgICBhYmVydG9zLmFkZChzKTsKICAgIHJlcy5vbignY2xvc2UnLCAoKSA9PiB7IGNsZWFySW50ZXJ2YWwocy5wdWxzbyk7IGFiZXJ0b3MuZGVsZXRlKHMpOyB9KTsKICAgIGV2ZW50byhzLCAncHV0JywgeyBwYXRoOiAnLycsIGRhdGE6IGxlcihyYWl6LCBzZWdzKSB9KTsKICB9CgogIGZ1bmN0aW9uIGFwbGljYXJQYXRjaChzZWdzLCBjb3JwbykgewogICAgaWYgKCFjb3JwbyB8fCB0eXBlb2YgY29ycG8gIT09ICdvYmplY3QnIHx8IEFycmF5LmlzQXJyYXkoY29ycG8pKSB0aHJvdyBuZXcgRXJyb3IoJ3BhdGNoIHNlbSBvYmpldG8nKTsKICAgIGZvciAoY29uc3QgW2ssIHZdIG9mIE9iamVjdC5lbnRyaWVzKGNvcnBvKSkgewogICAgICBjb25zdCBhbHZvID0gWy4uLnNlZ3MsIC4uLnNlZ21lbnRvcyhrKV07CiAgICAgIGlmICghc2VnbWVudG9zKGspLmxlbmd0aCB8fCBzZWdtZW50b3Moaykuc29tZShjaGF2ZUludmFsaWRhKSkgdGhyb3cgbmV3IEVycm9yKCdjaGF2ZSBpbnbDoWxpZGEnKTsKICAgICAgcmFpeiA9IGdyYXZhcihyYWl6LCBhbHZvLCBub3JtYWxpemFyKHYsIHRlbXBvKSk7CiAgICB9CiAgICByZXR1cm4gbGVyKHJhaXosIHNlZ3MpOwogIH0KCiAgZnVuY3Rpb24gdHJhdGFyKHJlcSwgcmVzLCB1LCBib2R5KSB7CiAgICBjb25zdCBzZWdzID0gc2VnbWVudG9zKGRlY29kZVVSSUNvbXBvbmVudCh1LnBhdGhuYW1lLnJlcGxhY2UoL1wuanNvbiQvLCAnJykpKTsKICAgIGNvbnN0IHF1ZXJFdGFnID0gU3RyaW5nKHJlcS5oZWFkZXJzWyd4LWZpcmViYXNlLWV0YWcnXSB8fCAnJykgPT09ICd0cnVlJzsKICAgIGNvbnN0IGlmTWF0Y2ggPSByZXEuaGVhZGVyc1snaWYtbWF0Y2gnXTsKICAgIGlmICghYWNlaXRhVG9rZW4odS5zZWFyY2hQYXJhbXMuZ2V0KCdhdXRoJykpKSByZXR1cm4gZW52aWFyKHJlcywgNDAxLCB7IGVycm9yOiAnUGVybWlzc2lvbiBkZW5pZWQnIH0pOwogICAgaWYgKGlmTWF0Y2ggIT09IHVuZGVmaW5lZCAmJiAocmVxLm1ldGhvZCA9PT0gJ1BBVENIJyB8fCByZXEubWV0aG9kID09PSAnR0VUJykpIHJldHVybiBlbnZpYXIocmVzLCA0MDAsIHsgZXJyb3I6ICdpZi1tYXRjaCBzw7MgdmFsZSBlbSBQVVQgZSBERUxFVEUnIH0pOwogICAgaWYgKHNlZ3Muc29tZShjaGF2ZUludmFsaWRhKSkgcmV0dXJuIGVudmlhcihyZXMsIDQwMCwgeyBlcnJvcjogJ0ludmFsaWQgcGF0aCcgfSk7CiAgICBpZiAocmVxLm1ldGhvZCA9PT0gJ0dFVCcgJiYgU3RyaW5nKHJlcS5oZWFkZXJzLmFjY2VwdCB8fCAnJykuaW5jbHVkZXMoJ3RleHQvZXZlbnQtc3RyZWFtJykpIHJldHVybiBhYnJpclN0cmVhbShyZXMsIHNlZ3MpOwogICAgY29uc3QgYXR1YWwgPSBsZXIocmFpeiwgc2Vncyk7CiAgICBpZiAoaWZNYXRjaCAhPT0gdW5kZWZpbmVkICYmIGlmTWF0Y2ggIT09IGV0YWdEZShhdHVhbCkpIHJldHVybiBlbnZpYXIocmVzLCA0MTIsIGF0dWFsLCBldGFnRGUoYXR1YWwpKTsKICAgIGxldCByZXN1bHRhZG87CiAgICB0cnkgewogICAgICByZXN1bHRhZG8gPSBleGVjdXRhcihyZXEubWV0aG9kLCBzZWdzLCBib2R5LCB1LCBhdHVhbCk7CiAgICB9IGNhdGNoIChlcnIpIHsKICAgICAgcmV0dXJuIGVudmlhcihyZXMsIDQwMCwgeyBlcnJvcjogZXJyLm1lc3NhZ2UgfSk7CiAgICB9CiAgICBpZiAodS5zZWFyY2hQYXJhbXMuZ2V0KCdwcmludCcpID09PSAnc2lsZW50JykgeyByZXMud3JpdGVIZWFkKDIwNCk7IHJldHVybiByZXMuZW5kKCk7IH0KICAgIHJldHVybiBlbnZpYXIocmVzLCAyMDAsIHJlc3VsdGFkbywgcXVlckV0YWcgPyBldGFnRGUocmVzdWx0YWRvKSA6ICcnKTsKICB9CgogIGZ1bmN0aW9uIGV4ZWN1dGFyKG1ldG9kbywgc2VncywgYm9keSwgdSwgYXR1YWwpIHsKICAgIGlmIChtZXRvZG8gPT09ICdHRVQnKSB7CiAgICAgIGlmICh1LnNlYXJjaFBhcmFtcy5nZXQoJ3NoYWxsb3cnKSAhPT0gJ3RydWUnIHx8ICFhdHVhbCB8fCB0eXBlb2YgYXR1YWwgIT09ICdvYmplY3QnKSByZXR1cm4gYXR1YWw7CiAgICAgIHJldHVybiBPYmplY3QuZnJvbUVudHJpZXMoT2JqZWN0LmtleXMoYXR1YWwpLm1hcCgoaykgPT4gW2ssIHRydWVdKSk7CiAgICB9CiAgICBpZiAobWV0b2RvID09PSAnUFVUJykgewogICAgICBjb25zdCB2YWxvciA9IG5vcm1hbGl6YXIoSlNPTi5wYXJzZShib2R5IHx8ICdudWxsJyksIHRlbXBvKTsKICAgICAgcmFpeiA9IGdyYXZhcihyYWl6LCBzZWdzLCB2YWxvcik7CiAgICAgIG5vdGlmaWNhcihzZWdzKTsKICAgICAgcmV0dXJuIGxlcihyYWl6LCBzZWdzKTsKICAgIH0KICAgIGlmIChtZXRvZG8gPT09ICdQQVRDSCcpIHsKICAgICAgY29uc3QgdmFsb3IgPSBhcGxpY2FyUGF0Y2goc2VncywgSlNPTi5wYXJzZShib2R5IHx8ICdudWxsJykpOwogICAgICBub3RpZmljYXIoc2Vncyk7CiAgICAgIHJldHVybiB2YWxvcjsKICAgIH0KICAgIGlmIChtZXRvZG8gPT09ICdERUxFVEUnKSB7CiAgICAgIHJhaXogPSBncmF2YXIocmFpeiwgc2VncywgbnVsbCk7CiAgICAgIG5vdGlmaWNhcihzZWdzKTsKICAgICAgcmV0dXJuIG51bGw7CiAgICB9CiAgICB0aHJvdyBuZXcgRXJyb3IoJ23DqXRvZG8gbsOjbyBzdXBvcnRhZG8nKTsKICB9CgogIGNvbnN0IHNlcnZlciA9IGh0dHAuY3JlYXRlU2VydmVyKGFzeW5jIChyZXEsIHJlcykgPT4gewogICAgY29uc3QgdSA9IG5ldyBVUkwocmVxLnVybCwgJ2h0dHA6Ly8xMjcuMC4wLjEnKTsKICAgIGNvbnN0IGJvZHkgPSBhd2FpdCBsZXJDb3JwbyhyZXEpOwogICAgcmVxdWVzdHMucHVzaCh7IG1ldGhvZDogcmVxLm1ldGhvZCwgcGF0aDogdS5wYXRobmFtZSwgcXVlcnk6IE9iamVjdC5mcm9tRW50cmllcyh1LnNlYXJjaFBhcmFtcyksIGhlYWRlcnM6IHJlcS5oZWFkZXJzLCBib2R5IH0pOwogICAgdHJhdGFyKHJlcSwgcmVzLCB1LCBib2R5KTsKICB9KTsKICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4gc2VydmVyLmxpc3RlbigwLCAnMTI3LjAuMC4xJywgcmVzb2x2ZSkpOwoKICByZXR1cm4gewogICAgdXJsOiBgaHR0cDovLzEyNy4wLjAuMToke3NlcnZlci5hZGRyZXNzKCkucG9ydH1gLAogICAgcmVxdWVzdHMsCiAgICB0cmVlOiAoKSA9PiBjb3BpYShyYWl6KSwKICAgIHNldFRyZWUob2JqKSB7IHJhaXogPSBub3JtYWxpemFyKGNvcGlhKG9iaiksIHRlbXBvKTsgfSwKICAgIHNldE5vdyhtcykgeyByZWxvZ2lvID0gbXM7IH0sCiAgICBzZXRTZW1FdGFnKHYpIHsgc2VtRXRhZyA9ICEhdjsgfSwKICAgIGdldCBzdHJlYW1zKCkgeyByZXR1cm4gYWJlcnRvcy5zaXplOyB9LAogICAgZmVjaGFyU3RyZWFtcygpIHsgZm9yIChjb25zdCBzIG9mIFsuLi5hYmVydG9zXSkgZmVjaGFyKHMpOyB9LAogICAgZW1pdGlyQXV0aFJldm9rZWQoKSB7CiAgICAgIGZvciAoY29uc3QgcyBvZiBbLi4uYWJlcnRvc10pIHsKICAgICAgICBldmVudG8ocywgJ2F1dGhfcmV2b2tlZCcsICdjcmVkZW50aWFsIGlzIG5vIGxvbmdlciB2YWxpZCcpOwogICAgICAgIGZlY2hhcihzKTsKICAgICAgfQogICAgfSwKICAgIC8vIG8gYmFuY28gbWFuZGEgYGNhbmNlbGAgcXVhbmRvIGEgcmVncmEgZGVpeGEgZGUgcGVybWl0aXIgYSBsZWl0dXJhIGRvIGNhbWluaG8KICAgIGVtaXRpckNhbmNlbCgpIHsKICAgICAgZm9yIChjb25zdCBzIG9mIFsuLi5hYmVydG9zXSkgewogICAgICAgIGV2ZW50byhzLCAnY2FuY2VsJywgbnVsbCk7CiAgICAgICAgZmVjaGFyKHMpOwogICAgICB9CiAgICB9LAogICAgY2xvc2UoKSB7CiAgICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4gewogICAgICAgIGZvciAoY29uc3QgcyBvZiBbLi4uYWJlcnRvc10pIGZlY2hhcihzKTsKICAgICAgICBzZXJ2ZXIuY2xvc2VBbGxDb25uZWN0aW9ucygpOwogICAgICAgIHNlcnZlci5jbG9zZSgoKSA9PiByZXNvbHZlKCkpOwogICAgICB9KTsKICAgIH0sCiAgfTsKfQoKZXhwb3J0IGRlZmF1bHQgeyBzdGFydEZha2VSdGRiIH07Cg==
```

Depois rode a conferência de novo: agora ela bate.

Crie `test/sync-rtdb.test.js` com EXATAMENTE este conteúdo:

```js
// lib/sync/rtdb.js: o cliente REST do Firebase Realtime Database. O dublê é
// test/helpers/fake-rtdb.js (servidor HTTP em processo); os casos que ele não
// produz (rede caída, timeout, host https) entram por fetchImpl injetado.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';
import rtdb, { createRtdbClient, redactUrl } from '../lib/sync/rtdb.js';

const TOKEN = 'tok-ok';
let fake;

before(async () => { fake = await startFakeRtdb({ token: TOKEN }); });
after(async () => { await fake.close(); });
beforeEach(() => { fake.setTree(null); fake.requests.length = 0; fake.setNow(1000); });

const tokenOk = async () => ({ ok: true, idToken: TOKEN });

function cliente(extra = {}) {
  return createRtdbClient({ databaseUrl: fake.url, getIdToken: tokenOk, ...extra });
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function ate(cond, limite = 2000) {
  const inicio = Date.now();
  while (!cond()) {
    if (Date.now() - inicio > limite) throw new Error('condição não chegou a tempo');
    await esperar(10);
  }
}

test('get de caminho vazio devolve null; put grava e devolve o valor gravado', async () => {
  const c = cliente();
  const vazio = await c.get('/users/u1/devices/d1');
  assert.deepEqual(vazio, { ok: true, status: 200, data: null, etag: '' });
  const p = await c.put('/users/u1/devices/d1', { name: 'Notebook' });
  assert.equal(p.ok, true);
  assert.equal(p.status, 200);
  assert.deepEqual(p.data, { name: 'Notebook' });
  assert.deepEqual((await c.get('/users/u1/devices/d1')).data, { name: 'Notebook' });
  assert.deepEqual(fake.tree(), { users: { u1: { devices: { d1: { name: 'Notebook' } } } } });
});

test('a URL leva .json e o ID token em ?auth=', async () => {
  await cliente().get('/users/u1/devices');
  const req = fake.requests.at(-1);
  assert.equal(req.path, '/users/u1/devices.json');
  assert.equal(req.query.auth, TOKEN);
});

test('patch mescla filhos e nunca manda if-match', async () => {
  const c = cliente();
  await c.put('/users/u1/devices/d1', { name: 'A', platform: 'win32' });
  const r = await c.patch('/users/u1/devices/d1', { name: 'B' });
  assert.deepEqual(r, { ok: true, status: 200, data: { name: 'B', platform: 'win32' } });
  const req = fake.requests.at(-1);
  assert.equal(req.method, 'PATCH');
  assert.equal(req.headers['if-match'], undefined);
});

test('del apaga e devolve ok', async () => {
  const c = cliente();
  await c.put('/users/u1/x', { a: 1 });
  assert.deepEqual(await c.del('/users/u1/x'), { ok: true, status: 200 });
  assert.equal(fake.tree(), null);
});

test('ETag: pedido na leitura, null_etag para vazio, e if-match no put', async () => {
  const c = cliente();
  const vazio = await c.get('/users/u1/leases/a/p', { etag: true });
  assert.equal(vazio.etag, 'null_etag');
  assert.equal(fake.requests.at(-1).headers['x-firebase-etag'], 'true');
  const p = await c.put('/users/u1/leases/a/p', { leaseId: 'L1' }, { ifMatch: 'null_etag', etag: true });
  assert.equal(p.ok, true);
  assert.match(p.etag, /^[0-9a-f]{40}$/);
  assert.equal(fake.requests.at(-1).headers['if-match'], 'null_etag');
  const lido = await c.get('/users/u1/leases/a/p', { etag: true });
  assert.equal(lido.etag, p.etag, 'o etag devolvido no put é o do valor gravado');
  const ok = await c.put('/users/u1/leases/a/p', { leaseId: 'L2' }, { ifMatch: lido.etag });
  assert.equal(ok.ok, true);
});

test('ETag: 412 devolve o valor ATUAL e o etag atual para quem perdeu a corrida', async () => {
  const c = cliente();
  await c.put('/users/u1/leases/a/p', { leaseId: 'L1' });
  const r = await c.put('/users/u1/leases/a/p', { leaseId: 'L2' }, { ifMatch: 'null_etag' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'conflito');
  assert.equal(r.status, 412);
  assert.deepEqual(r.data, { leaseId: 'L1' });
  assert.equal(r.etag, (await c.get('/users/u1/leases/a/p', { etag: true })).etag);
  assert.deepEqual(fake.tree().users.u1.leases.a.p, { leaseId: 'L1' }, 'nada foi sobrescrito');
});

test('del com if-match: etag velho é 412 com o atual, etag certo apaga', async () => {
  const c = cliente();
  await c.put('/users/u1/r', { v: 1 });
  const velho = (await c.get('/users/u1/r', { etag: true })).etag;
  await c.put('/users/u1/r', { v: 2 });
  const r = await c.del('/users/u1/r', { ifMatch: velho });
  assert.equal(r.code, 'conflito');
  assert.equal(r.status, 412);
  assert.deepEqual(r.data, { v: 2 });
  const atual = (await c.get('/users/u1/r', { etag: true })).etag;
  assert.deepEqual(await c.del('/users/u1/r', { ifMatch: atual }), { ok: true, status: 200 });
});

test('{".sv":"timestamp"} vira o relógio do servidor', async () => {
  fake.setNow(1757500000000);
  const r = await cliente().patch('/users/u1/devices/d1', { lastSeenAt: { '.sv': 'timestamp' } });
  assert.equal(r.data.lastSeenAt, 1757500000000);
});

test('shallow devolve só as chaves do nível', async () => {
  const c = cliente();
  await c.put('/users/u1/devices', { d1: { name: 'A' }, d2: { name: 'B' } });
  const r = await c.get('/users/u1/devices', { shallow: true });
  assert.deepEqual(r.data, { d1: true, d2: true });
  assert.equal(fake.requests.at(-1).query.shallow, 'true');
});

test('?ns=<projectId> só vai com http (emulador) e projectId preenchido', async () => {
  await cliente({ projectId: 'farol-local' }).get('/users/u1');
  assert.equal(fake.requests.at(-1).query.ns, 'farol-local');
  await cliente().get('/users/u1');
  assert.equal(fake.requests.at(-1).query.ns, undefined);
  const urls = [];
  const fetchImpl = async (url) => { urls.push(url); return new Response('null', { status: 200 }); };
  const https = createRtdbClient({ databaseUrl: 'https://x-default-rtdb.firebaseio.com', projectId: 'x', getIdToken: tokenOk, fetchImpl });
  await https.get('/users/u1');
  assert.doesNotMatch(urls[0], /[?&]ns=/);
  assert.equal(urls[0], 'https://x-default-rtdb.firebaseio.com/users/u1.json?auth=tok-ok');
});

test('urlFor: auth primeiro, ns do emulador e demais parâmetros depois', () => {
  const c = cliente({ projectId: 'farol-local' });
  assert.equal(c.urlFor('/users/u1', { auth: 'T', shallow: 'true' }), `${fake.url}/users/u1.json?auth=T&ns=farol-local&shallow=true`);
  assert.equal(cliente().urlFor('/users/u1'), `${fake.url}/users/u1.json`);
});

test('token recusado pelo banco vira nao_autorizado com o motivo do servidor', async () => {
  const c = cliente({ getIdToken: async () => ({ ok: true, idToken: 'tok-vencido' }) });
  const r = await c.get('/users/u1');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'nao_autorizado');
  assert.equal(r.status, 401);
  assert.equal(r.motivo, 'Permission denied');
});

test('falha do getIdToken é devolvida sem tocar a rede', async () => {
  const c = cliente({ getIdToken: async () => ({ ok: false, code: 'credencial_invalida', motivo: 'entre de novo' }) });
  for (const r of [await c.get('/users/u1'), await c.put('/users/u1', 1), await c.patch('/users/u1', { a: 1 }), await c.del('/users/u1')]) {
    assert.equal(r.ok, false);
    assert.equal(r.code, 'credencial_invalida');
  }
  assert.equal(fake.requests.length, 0);
});

test('segmento de caminho inválido é falha interna e não toca a rede', async () => {
  const c = cliente();
  for (const caminho of ['/users/u.1', '/users/$x', '/users//x', 'users/u1', '/users/a#b']) {
    const r = await c.get(caminho);
    assert.equal(r.code, 'falha_interna', caminho);
  }
  assert.throws(() => c.urlFor('/users/a[b'), (e) => e.code === 'falha_interna');
  assert.equal(fake.requests.length, 0);
});

test('valor não serializável não vira null gravado no banco', async () => {
  const circular = {};
  circular.eu = circular;
  const r = await cliente().put('/users/u1/x', circular);
  assert.equal(r.code, 'falha_interna');
  assert.equal(fake.requests.length, 0);
});

test('rede caída vira indisponivel e a mensagem não carrega o token', async () => {
  const fetchImpl = async (url) => { throw new TypeError(`fetch failed: connect ECONNREFUSED ${url}`); };
  const c = createRtdbClient({ databaseUrl: fake.url, getIdToken: async () => ({ ok: true, idToken: 'segredo-do-token' }), fetchImpl });
  const r = await c.get('/users/u1');
  assert.equal(r.code, 'indisponivel');
  assert.doesNotMatch(JSON.stringify(r), /segredo-do-token/);
});

test('sem resposta no teto de tempo vira timeout', async () => {
  const fetchImpl = (_url, opts) => new Promise((_resolve, reject) => {
    opts.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
  });
  const c = createRtdbClient({ databaseUrl: fake.url, getIdToken: tokenOk, fetchImpl, timeoutMs: 20 });
  assert.equal((await c.get('/users/u1')).code, 'timeout');
});

test('5xx vira indisponivel e corpo que não é JSON vira resposta_invalida', async () => {
  const c503 = createRtdbClient({ databaseUrl: fake.url, getIdToken: tokenOk, fetchImpl: async () => new Response('', { status: 503 }) });
  assert.equal((await c503.get('/users/u1')).code, 'indisponivel');
  const lixo = createRtdbClient({ databaseUrl: fake.url, getIdToken: tokenOk, fetchImpl: async () => new Response('<html>', { status: 200 }) });
  assert.equal((await lixo.get('/users/u1')).code, 'resposta_invalida');
});

// Sem o ETag pedido não existe CAS: a escrita seguinte sairia INCONDICIONAL, e
// sobrescrever lease, recibo ou rodada às cegas é o defeito que o if-match existe
// para impedir. Recusar a leitura é a única saída segura.
test('get: ETag pedido e ausente na resposta vira resposta_invalida', async () => {
  const c = cliente();
  await c.put('/users/u1/x', { a: 1 });
  fake.setSemEtag(true);
  try {
    const r = await c.get('/users/u1/x', { etag: true });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'resposta_invalida');
    assert.match(r.motivo, /ETag/);
    const semPedir = await c.get('/users/u1/x');
    assert.deepEqual(semPedir.data, { a: 1 }, 'leitura que não pede etag segue valendo');
  } finally {
    fake.setSemEtag(false);
  }
});

test('redactUrl esconde o valor de auth= e preserva o resto', () => {
  assert.equal(redactUrl('https://x.firebaseio.com/a.json?auth=abc.def-ghi&shallow=true'), 'https://x.firebaseio.com/a.json?auth=***&shallow=true');
  assert.equal(redactUrl('http://127.0.0.1:9000/a.json?ns=p&auth=zzz'), 'http://127.0.0.1:9000/a.json?ns=p&auth=***');
  assert.equal(redactUrl('https://x/a.json'), 'https://x/a.json');
});

/* ---------- stream (SSE) ---------- */

test('stream: put inicial, put incremental, keep-alive engolido, e fecha pelo signal', async () => {
  const c = cliente();
  await c.put('/users/u1/leases', { a: { p: { leaseId: 'L1' } } });
  const eventos = [];
  const controle = new AbortController();
  const fim = c.stream('/users/u1/leases', { onEvent: (e) => eventos.push(e), signal: controle.signal });
  await ate(() => eventos.length >= 1);
  assert.deepEqual(eventos[0], { event: 'put', data: { path: '/', data: { a: { p: { leaseId: 'L1' } } } } });
  assert.equal(fake.requests.at(-1).headers.accept, 'text/event-stream');
  await c.put('/users/u1/leases/a/p', { leaseId: 'L2' });
  await ate(() => eventos.length >= 2);
  assert.deepEqual(eventos[1], { event: 'put', data: { path: '/a/p', data: { leaseId: 'L2' } } });
  await esperar(250);
  assert.ok(eventos.every((e) => e.event !== 'keep-alive'), 'keep-alive não chega ao consumidor');
  assert.equal(fake.streams, 1);
  controle.abort();
  assert.deepEqual(await fim, { ok: true });
  await ate(() => fake.streams === 0);
});

test('stream: auth_revoked chega ao consumidor e a conexão fecha', async () => {
  const c = cliente();
  const eventos = [];
  const fim = c.stream('/users/u1', { onEvent: (e) => eventos.push(e) });
  await ate(() => eventos.length >= 1);
  fake.emitirAuthRevoked();
  assert.deepEqual(await fim, { ok: true });
  assert.equal(eventos.at(-1).event, 'auth_revoked');
});

test('stream: token recusado devolve nao_autorizado sem abrir stream', async () => {
  const c = cliente({ getIdToken: async () => ({ ok: true, idToken: 'tok-vencido' }) });
  const r = await c.stream('/users/u1', { onEvent: () => {} });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'nao_autorizado');
  assert.equal(fake.streams, 0);
});

test('stream: fechamento pelo servidor resolve ok', async () => {
  const c = cliente();
  const eventos = [];
  const fim = c.stream('/users/u1', { onEvent: (e) => eventos.push(e) });
  await ate(() => eventos.length >= 1);
  fake.fecharStreams();
  assert.deepEqual(await fim, { ok: true });
});

test('stream: consumidor que lança não derruba a leitura', async () => {
  const c = cliente();
  let vistos = 0;
  const controle = new AbortController();
  const fim = c.stream('/users/u1', { onEvent: () => { vistos++; throw new Error('bug do consumidor'); }, signal: controle.signal });
  await ate(() => vistos >= 1);
  await c.put('/users/u1/x', 1);
  await ate(() => vistos >= 2);
  controle.abort();
  assert.deepEqual(await fim, { ok: true });
});

// O keep-alive não chega ao onEvent, e é justamente ele que prova que a conexão vive:
// a vigia de inatividade do stream dos leases depende deste aviso por pedaço.
test('stream: onActivity avisa a cada pedaço que chega, keep-alive incluso, e defeito nele não derruba', async () => {
  const c = cliente();
  let pedacos = 0;
  const eventos = [];
  const controle = new AbortController();
  const onActivity = () => { pedacos++; throw new Error('bug do consumidor'); };
  const fim = c.stream('/users/u1', { onEvent: (e) => eventos.push(e), onActivity, signal: controle.signal });
  await ate(() => eventos.length >= 1);
  await esperar(350);
  assert.equal(eventos.length, 1, 'só o put inicial chega ao onEvent');
  assert.ok(pedacos >= 3, `keep-alives contam como atividade (vistos: ${pedacos})`);
  controle.abort();
  assert.deepEqual(await fim, { ok: true });
});

// Corpo SSE servido por fetchImpl: o servidor manda estes bytes e fecha LIMPO.
function clienteComCorpoSse(texto) {
  const fetchImpl = async () => new Response(texto, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  return createRtdbClient({ databaseUrl: fake.url, getIdToken: tokenOk, fetchImpl });
}

test('stream: conexão que fecha no meio de um evento descarta o evento incompleto (WHATWG)', async () => {
  const completo = 'event: put\ndata: {"path":"/","data":{"a":1}}\n\n';
  const cortado = 'event: put\ndata: {"path":"/","data":{"lea';
  const eventos = [];
  const r = await clienteComCorpoSse(completo + cortado).stream('/users/u1', { onEvent: (e) => eventos.push(e) });
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(eventos, [{ event: 'put', data: { path: '/', data: { a: 1 } } }], 'só o evento completo chega');
  assert.ok(eventos.every((e) => e.data !== null), 'nenhum put com data null, que o consumidor leria como nó apagado');
});

test('stream: put ou patch com JSON ilegível não chega como null', async () => {
  const corpo = 'event: put\ndata: {quebrado\n\nevent: patch\ndata: nada\n\nevent: put\ndata: {"path":"/x","data":null}\n\n';
  const eventos = [];
  const r = await clienteComCorpoSse(corpo).stream('/users/u1', { onEvent: (e) => eventos.push(e) });
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(eventos, [{ event: 'put', data: { path: '/x', data: null } }], 'o null legítimo do banco segue passando');
});

test('export default carrega o mesmo contrato dos nomeados', () => {
  assert.equal(rtdb.createRtdbClient, createRtdbClient);
  assert.equal(rtdb.redactUrl, redactUrl);
});
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('test/sync-rtdb.test.js')).digest('hex').slice(0,16))"
```

Esperado: `2aae2f020fb344a1`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

- [ ] **Passo 2: rodar e ver falhar**

```bash
node --test --test-force-exit test/sync-rtdb.test.js
```

Esperado: FALHA. Cannot find module lib/sync/rtdb.js.

- [ ] **Passo 3: implementar**

Crie `lib/sync/rtdb.js` com EXATAMENTE este conteúdo:

```js
// Cliente REST do Firebase Realtime Database, em Node puro (fetch nativo). Único
// ponto do app que fala com o banco da sincronização entre dispositivos.
//
// Contratos de fora que moldam este arquivo:
//  - o ID token do usuário vai em `?auth=` na query (é a única forma documentada
//    para token de usuário no REST do RTDB), então NENHUMA URL daqui pode ir para
//    log, erro ou tela crua: quem precisar mostrar usa redactUrl, e as mensagens de
//    erro saem da tabela de errors.js, nunca do texto do fetch;
//  - CAS por ETag só em PUT e DELETE (`if-match`); PATCH com `if-match` o servidor
//    responde 400, por isso patch() nem aceita a opção;
//  - `?ns=<projeto>` só existe no emulador (http local); no host de produção ele é
//    redundante e fica de fora.
//
// Nada aqui lança: todo desfecho volta como { ok, ... } para quem chama decidir.
// fetch entra por injeção para o teste não tocar a rede.
import { SYNC } from '../constants.js';
import io from '../io.js';
import { SYNC_CODES, SyncError, codeFromStatus, motivoDe } from './errors.js';
import { assertRtdbKey } from './keys.js';
import { createSseParser } from './sse.js';

// cabeçalhos fora da chamada: objeto literal aninhado conta como nível de chave no gate
const CABECALHO_ETAG = { 'X-Firebase-ETag': 'true' };
const CABECALHO_JSON = { 'Content-Type': 'application/json' };
const CABECALHO_SSE = { Accept: 'text/event-stream' };
const DECODE_PARCIAL = { stream: true };
// eventos do stream cujo `data` é JSON do banco; os outros seguem como texto
const EVENTOS_JSON = new Set(['put', 'patch', 'cancel']);
// put/patch com data ilegível é descartado em vez de virar null: null nesses dois é
// o banco dizendo que o nó foi APAGADO, e o consumidor não tem como distinguir
const EVENTOS_DE_ESCRITA = new Set(['put', 'patch']);
// marca de corpo que não é JSON (null é valor legítimo do banco, não serve de marca)
const SEM_CORPO = Symbol('sem-corpo');
const MAX_MOTIVO = 200;
// leitura que PEDE etag e volta sem ele: ver a recusa em get()
const MOTIVO_SEM_ETAG = 'o Firebase não devolveu o ETag pedido';

function redactUrl(url) {
  return String(url || '').replace(/([?&]auth=)[^&#]*/g, '$1***');
}

function falha(code, status, motivo) {
  return { ok: false, code, status, motivo: motivo || motivoDe(code) };
}

// AbortError é o nosso alarme de tempo; qualquer outra rejeição do fetch é rede
function codigoDeRede(err) {
  return err && err.name === 'AbortError' ? SYNC_CODES.TIMEOUT : SYNC_CODES.INDISPONIVEL;
}

// O RTDB responde erro como { "error": "Permission denied" }; o texto do servidor é
// útil para quem opera e não carrega a URL. Qualquer outra forma cai na tabela.
function motivoDoCorpo(corpo, code) {
  if (corpo && typeof corpo === 'object' && typeof corpo.error === 'string') return corpo.error.slice(0, MAX_MOTIVO);
  return motivoDe(code);
}

function erroHttp(r) {
  const code = codeFromStatus(r.status);
  return falha(code, r.status, motivoDoCorpo(r.corpo, code));
}

function conflito(r) {
  return { ok: false, code: SYNC_CODES.CONFLITO, status: 412, data: r.corpo === SEM_CORPO ? null : r.corpo, etag: r.etag };
}

function semToken(tok) {
  return falha((tok && tok.code) || SYNC_CODES.SEM_CREDENCIAL, 0, tok && tok.motivo);
}

function parametros(ctx, query) {
  const q = query || {};
  const lista = [];
  if (q.auth) lista.push(`auth=${encodeURIComponent(q.auth)}`);
  if (ctx.emulador && ctx.projectId) lista.push(`ns=${encodeURIComponent(ctx.projectId)}`);
  for (const [k, v] of Object.entries(q)) {
    if (k === 'auth' || k === 'ns' || v === undefined || v === null || v === false) continue;
    lista.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return lista.length ? `?${lista.join('&')}` : '';
}

// Cada segmento passa pela allowlist de chave do banco: caminho montado com texto
// de fora (id de aparelho corrompido, chave de PR) nunca vira outro caminho.
function montarUrl(ctx, path, query) {
  if (typeof path !== 'string' || !path.startsWith('/')) throw new SyncError(SYNC_CODES.FALHA_INTERNA, 'caminho do banco precisa começar com /');
  const segmentos = path.slice(1).split('/').map((s) => encodeURIComponent(assertRtdbKey(s)));
  return `${ctx.base}/${segmentos.join('/')}.json${parametros(ctx, query)}`;
}

// token + URL, ou a falha pronta; nada disto toca a rede
async function prepararUrl(ctx, path, query) {
  const tok = await ctx.getIdToken();
  if (!tok || !tok.ok) return { erro: semToken(tok) };
  try {
    return { url: montarUrl(ctx, path, { ...query, auth: tok.idToken }) };
  } catch (err) {
    return { erro: falha(SYNC_CODES.FALHA_INTERNA, 0, err && err.message) };
  }
}

// O alarme cobre o corpo também: servidor que manda o cabeçalho e trava no corpo
// seguraria o heartbeat do lease para sempre se o timeout parasse no primeiro byte.
async function requisitar(ctx, method, path, opcoes) {
  const alvo = await prepararUrl(ctx, path, opcoes.query);
  if (alvo.erro) return alvo;
  const controle = new AbortController();
  const alarme = setTimeout(() => controle.abort(), ctx.timeoutMs);
  try {
    const res = await ctx.fetchImpl(alvo.url, { method, headers: opcoes.headers, body: opcoes.body, signal: controle.signal });
    const texto = await res.text();
    return { status: res.status, ok: res.ok, etag: res.headers.get('etag') || '', corpo: io.parseJson(texto, SEM_CORPO) };
  } catch (err) {
    return { erro: falha(codigoDeRede(err), 0) };
  } finally {
    clearTimeout(alarme);
  }
}

// corpo serializado ou '' quando o valor não serializa: o safeStringify devolveria
// 'null' por padrão, e PUT de null APAGA o nó no banco
function serializar(value) {
  const texto = io.safeStringify(value, '');
  return typeof texto === 'string' ? texto : '';
}

async function get(ctx, path, { etag = false, shallow = false } = {}) {
  const query = shallow ? { shallow: 'true' } : {};
  const r = await requisitar(ctx, 'GET', path, { query, headers: etag ? CABECALHO_ETAG : {} });
  if (r.erro) return r.erro;
  if (!r.ok) return erroHttp(r);
  if (r.corpo === SEM_CORPO) return falha(SYNC_CODES.RESPOSTA_INVALIDA, r.status);
  // Quem pede etag é o CAS (lease, recibo, rodada): devolver etag vazio faria a escrita
  // seguinte sair SEM if-match, ou seja, incondicional, por cima do que outro aparelho
  // acabou de gravar. Proxy que engole cabeçalho é o caso real; a saída segura é recusar
  // a leitura e deixar quem chama tratar como banco indisponível.
  if (etag && !r.etag) return falha(SYNC_CODES.RESPOSTA_INVALIDA, r.status, MOTIVO_SEM_ETAG);
  return { ok: true, status: r.status, data: r.corpo, etag: etag ? r.etag : '' };
}

async function put(ctx, path, value, { ifMatch = '', etag = false } = {}) {
  const body = serializar(value);
  if (!body) return falha(SYNC_CODES.FALHA_INTERNA, 0, 'valor não serializável para o banco');
  const headers = { ...CABECALHO_JSON };
  if (etag) headers['X-Firebase-ETag'] = 'true';
  if (ifMatch) headers['if-match'] = ifMatch;
  const r = await requisitar(ctx, 'PUT', path, { headers, body });
  if (r.erro) return r.erro;
  if (r.status === 412) return conflito(r);
  if (!r.ok) return erroHttp(r);
  if (r.corpo === SEM_CORPO) return falha(SYNC_CODES.RESPOSTA_INVALIDA, r.status);
  return { ok: true, status: r.status, data: r.corpo, etag: etag ? r.etag : '' };
}

async function patch(ctx, path, value) {
  const body = serializar(value);
  if (!body) return falha(SYNC_CODES.FALHA_INTERNA, 0, 'valor não serializável para o banco');
  const r = await requisitar(ctx, 'PATCH', path, { headers: CABECALHO_JSON, body });
  if (r.erro) return r.erro;
  if (!r.ok) return erroHttp(r);
  if (r.corpo === SEM_CORPO) return falha(SYNC_CODES.RESPOSTA_INVALIDA, r.status);
  return { ok: true, status: r.status, data: r.corpo };
}

async function del(ctx, path, { ifMatch = '' } = {}) {
  const headers = ifMatch ? { 'if-match': ifMatch } : {};
  const r = await requisitar(ctx, 'DELETE', path, { headers });
  if (r.erro) return r.erro;
  if (r.status === 412) return conflito(r);
  if (!r.ok) return erroHttp(r);
  return { ok: true, status: r.status };
}

function falhaStream(code, motivo) {
  return { ok: false, code, motivo: motivo || motivoDe(code) };
}

// keep-alive é do protocolo e morre aqui; auth_revoked chega a quem chama, que
// renova o token e reabre. Consumidor com defeito não pode derrubar a leitura.
function despachante(onEvent) {
  const entregar = typeof onEvent === 'function' ? onEvent : () => {};
  return (ev) => {
    if (ev.event === 'keep-alive') return;
    const lido = EVENTOS_JSON.has(ev.event) ? io.parseJson(ev.data, SEM_CORPO) : ev.data;
    if (lido === SEM_CORPO && EVENTOS_DE_ESCRITA.has(ev.event)) return;
    const data = lido === SEM_CORPO ? null : lido;
    try { entregar({ event: ev.event, data }); } catch { /* defeito do consumidor não fecha o stream */ }
  };
}

// Todo pedaço que chega (keep-alive incluso) avisa quem chama: é o sinal de vida que a
// vigia de inatividade do stream precisa, e o keep-alive nunca chega ao onEvent.
function tocar(onActivity) {
  if (typeof onActivity !== 'function') return;
  try { onActivity(); } catch { /* defeito do consumidor não fecha o stream */ }
}

async function consumir(res, { onEvent, signal, onActivity }) {
  const parser = createSseParser(despachante(onEvent));
  const leitor = res.body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const lido = await leitor.read();
      if (lido.done) break;
      tocar(onActivity);
      parser.feed(decoder.decode(lido.value, DECODE_PARCIAL));
    }
    // sem parser.end() de propósito: o que sobrou no buffer quando a conexão fecha é
    // evento sem a linha vazia final, ou seja, cortado no meio, e a especificação SSE
    // (WHATWG) manda descartar. Despachar entregaria um put truncado; o caminho de erro
    // (catch) também não despacha, então fim limpo e fim sujo têm o mesmo desfecho.
    parser.feed(decoder.decode());
    return { ok: true };
  } catch (err) {
    if (signal && signal.aborted) return { ok: true };
    return falhaStream(codigoDeRede(err));
  }
}

// Conexão longa: o alarme de tempo vale só até o cabeçalho chegar. Fechar por
// pedido de quem chama (signal) é fim normal, não falha.
async function conectar(ctx, url, signal) {
  const controle = new AbortController();
  const soltar = () => controle.abort();
  if (signal) signal.addEventListener('abort', soltar, { once: true });
  const alarme = setTimeout(soltar, ctx.timeoutMs);
  try {
    return { res: await ctx.fetchImpl(url, { headers: CABECALHO_SSE, signal: controle.signal }), soltar };
  } catch (err) {
    return { erro: signal && signal.aborted ? { ok: true } : falhaStream(codigoDeRede(err)), soltar };
  } finally {
    clearTimeout(alarme);
  }
}

async function stream(ctx, path, opcoes = {}) {
  const { signal } = opcoes;
  if (signal && signal.aborted) return { ok: true };
  const alvo = await prepararUrl(ctx, path, {});
  if (alvo.erro) return falhaStream(alvo.erro.code, alvo.erro.motivo);
  const con = await conectar(ctx, alvo.url, signal);
  try {
    if (con.erro) return con.erro;
    if (!con.res.ok) {
      const corpo = io.parseJson(await con.res.text().catch(() => ''), SEM_CORPO);
      const code = codeFromStatus(con.res.status);
      return falhaStream(code, motivoDoCorpo(corpo, code));
    }
    return await consumir(con.res, opcoes);
  } finally {
    if (signal) signal.removeEventListener('abort', con.soltar);
  }
}

function createRtdbClient({ databaseUrl, projectId = '', getIdToken, fetchImpl = fetch, timeoutMs = SYNC.REQUEST_TIMEOUT_MS }) {
  const base = String(databaseUrl || '').replace(/\/+$/, '');
  const ctx = { base, emulador: base.startsWith('http://'), projectId: String(projectId || ''), getIdToken, fetchImpl, timeoutMs };
  return {
    get: (path, opcoes) => get(ctx, path, opcoes),
    put: (path, value, opcoes) => put(ctx, path, value, opcoes),
    patch: (path, value) => patch(ctx, path, value),
    del: (path, opcoes) => del(ctx, path, opcoes),
    stream: (path, opcoes) => stream(ctx, path, opcoes),
    urlFor: (path, query = {}) => montarUrl(ctx, path, query),
  };
}

export default { createRtdbClient, redactUrl };
export { createRtdbClient, redactUrl };
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('lib/sync/rtdb.js')).digest('hex').slice(0,16))"
```

Esperado: `0550606e8b372d92`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

- [ ] **Passo 4: rodar e ver passar**

```bash
node --test --test-force-exit test/sync-rtdb.test.js
```

Esperado: PASSA, 0 falhas.

- [ ] **Passo 5: gate e commit**

```bash
npm run check && npm run lint && npm test
```

Esperado: `fail 0` e `gate de qualidade: sem regressão`. Se algo falhar, PARE e relate; não mexa em outro arquivo para fazer passar.

```bash
git add lib/sync/rtdb.js test/helpers/fake-rtdb.js test/sync-rtdb.test.js
git commit -m "feat(sync): cliente REST do RTDB com CAS por ETag e stream"
```


### Tarefa T08: Classe de falha da coordenação na taxonomia

Falha de coordenação é TRANSITÓRIA: o certo é esperar, nunca estacionar o PR. Quem decide retry e quem monta o Diagnóstico leem a mesma tabela, então a classe entra aqui, antes de qualquer chamador, e vem ANTES de 'rede' porque a mensagem carrega o texto do fetch.

**Arquivos:**
- Modificar: `lib/log-taxonomy.js`
- Modificar: `test/log-taxonomy.test.js`

- [ ] **Passo 1: escrever o teste**

Em `test/log-taxonomy.test.js`, aplique as 5 substituições abaixo, NA ORDEM. Cada trecho "localize" aparece exatamente uma vez no arquivo no momento em que você aplica aquela substituição; copie-o sem mudar espaço nem acento.

1. Localize:

```js
  restart: 'app reiniciado com revisão em andamento: biudtech/biud-core#262 devolvido(s) à fila',
  console: 'sessao "Login do Claude" saiu com codigo 3221225786',
  nadaVer: 'qualquer coisa que ninguém previu',
};

/* ---------- CLASSES: forma e ordem ---------- */
```

   Troque por:

```js
  restart: 'app reiniciado com revisão em andamento: biudtech/biud-core#262 devolvido(s) à fila',
  console: 'sessao "Login do Claude" saiu com codigo 3221225786',
  nadaVer: 'qualquer coisa que ninguém previu',
  // a coordenação entre dispositivos (Firebase) carrega o texto do fetch; sem classe
  // própria ANTES de 'rede' ela seria lida como queda de rede genérica
  coordenacao: 'coordenação entre dispositivos indisponível: fetch failed',
};

/* ---------- CLASSES: forma e ordem ---------- */
```

2. Localize:

```js
test('CLASSES: toda classe tem os cinco campos e um kind válido', () => {
  const KINDS = ['operacional', 'espera-reset', 'transitorio', 'permanente'];
  const GRUPOS = ['operacional', 'ambiente', 'credencial', 'rede', 'app'];
  assert.ok(Array.isArray(CLASSES) && CLASSES.length === 15, 'são 15 classes');
  for (const c of CLASSES) {
    assert.equal(typeof c.id, 'string');
    assert.ok(c.label, `${c.id} precisa de label humano`);
```

   Troque por:

```js
test('CLASSES: toda classe tem os cinco campos e um kind válido', () => {
  const KINDS = ['operacional', 'espera-reset', 'transitorio', 'permanente'];
  const GRUPOS = ['operacional', 'ambiente', 'credencial', 'rede', 'app'];
  assert.ok(Array.isArray(CLASSES) && CLASSES.length === 16, 'são 16 classes');
  for (const c of CLASSES) {
    assert.equal(typeof c.id, 'string');
    assert.ok(c.label, `${c.id} precisa de label humano`);
```

3. Localize:

```js
test('CLASSES: a ordem é a documentada (primeira que casar vence)', () => {
  assert.deepEqual(CLASSES.map(c => c.id), [
    'restart-fila', 'console-fechado', 'limite-plano', 'assinatura-bloqueada',
    'oauth-expirado', 'credencial-invalida', 'credito-insuficiente', 'resultado-invalido', 'rede', 'github-indisponivel',
    'provedor-indisponivel', 'token-gh', 'skip-permissions-root', 'tempo-esgotado', 'ferramenta'
  ]);
});
```

   Troque por:

```js
test('CLASSES: a ordem é a documentada (primeira que casar vence)', () => {
  assert.deepEqual(CLASSES.map(c => c.id), [
    'restart-fila', 'console-fechado', 'limite-plano', 'assinatura-bloqueada',
    'oauth-expirado', 'credencial-invalida', 'credito-insuficiente', 'resultado-invalido', 'coordenacao-indisponivel', 'rede', 'github-indisponivel',
    'provedor-indisponivel', 'token-gh', 'skip-permissions-root', 'tempo-esgotado', 'ferramenta'
  ]);
});
```

4. Localize:

```js
  ['credencial-invalida', MSG.credencial],
  ['oauth-expirado', MSG.oauthExpirado],
  ['credito-insuficiente', MSG.credito],
  ['rede', MSG.rede],
  ['rede', MSG.redeSessao],
  ['rede', MSG.redeReconexao],
```

   Troque por:

```js
  ['credencial-invalida', MSG.credencial],
  ['oauth-expirado', MSG.oauthExpirado],
  ['credito-insuficiente', MSG.credito],
  ['coordenacao-indisponivel', MSG.coordenacao],
  ['rede', MSG.rede],
  ['rede', MSG.redeSessao],
  ['rede', MSG.redeReconexao],
```

5. Localize:

```js
  assert.equal(classify('--dangerously-skip-permissions cannot be used with root/sudo privileges for security reasons').id, 'skip-permissions-root');
  assert.equal(classify('sessão retornou erro: cannot be used with root/sudo privileges').id, 'skip-permissions-root');
});
```

   Troque por:

```js
  assert.equal(classify('--dangerously-skip-permissions cannot be used with root/sudo privileges for security reasons').id, 'skip-permissions-root');
  assert.equal(classify('sessão retornou erro: cannot be used with root/sudo privileges').id, 'skip-permissions-root');
});

test('coordenação entre dispositivos indisponível: transitória e vence rede mesmo com "fetch failed"', () => {
  const c = classify(MSG.coordenacao);
  assert.equal(c.id, 'coordenacao-indisponivel');
  assert.equal(c.kind, 'transitorio', 'espera é o comportamento certo, nunca estacionamento');
  assert.equal(c.grupo, 'rede');
  assert.match(MSG.coordenacao, /fetch failed/, 'confirma que o texto casaria com rede também');
  assert.equal(classify('Coordenacao entre dispositivos indisponivel: timeout').id, 'coordenacao-indisponivel', 'sem acento também');
  assert.equal(classify(MSG.redeSessao).id, 'rede', 'fetch failed sozinho continua sendo rede');
  // com só a consolidação ligada a MESMA falha se chama "sincronização": sem isto o
  // Diagnóstico mostrava "Coordenação indisponível" a quem nem ligou a coordenação
  const c2 = classify('sincronização entre dispositivos indisponível: fetch failed');
  assert.equal(c2.id, 'coordenacao-indisponivel', 'mesma classe, porque é a mesma falha');
  assert.equal(c2.kind, 'transitorio');
  assert.equal(c2.label, 'Sincronização entre dispositivos indisponível', 'o rótulo não pode nomear um recurso que ninguém ligou');
  assert.equal(classify('Sincronizacao entre dispositivos indisponivel: timeout').id, 'coordenacao-indisponivel', 'sem acento também');
});
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('test/log-taxonomy.test.js')).digest('hex').slice(0,16))"
```

Esperado: `8582470500cab7ea`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

- [ ] **Passo 2: rodar e ver falhar**

```bash
node --test --test-force-exit test/log-taxonomy.test.js
```

Esperado: FALHA. classify não reconhece a frase de coordenação indisponível.

- [ ] **Passo 3: implementar**

Em `lib/log-taxonomy.js`, aplique as 1 substituições abaixo, NA ORDEM. Cada trecho "localize" aparece exatamente uma vez no arquivo no momento em que você aplica aquela substituição; copie-o sem mudar espaço nem acento.

1. Localize:

```js
    kind: 'permanente',
    re: /a sessão não devolveu JSON|JSON da sessão (?:inválido|ambíguo|com bloco json não encerrado|fora do contrato|com analysisStatus ausente ou inválido)/i,
  },
  {
    id: 'rede',
    label: 'Rede indisponível',
```

   Troque por:

```js
    kind: 'permanente',
    re: /a sessão não devolveu JSON|JSON da sessão (?:inválido|ambíguo|com bloco json não encerrado|fora do contrato|com analysisStatus ausente ou inválido)/i,
  },
  {
    // Coordenação entre dispositivos (Firebase) fora de alcance: rede, token vencido,
    // banco indisponível. Transitória para o Diagnóstico: a espera é o comportamento
    // certo. O kind sozinho NÃO impede estacionamento (o ramo transitório do
    // runOneHeadless tem teto e depois estaciona); quem garante que ela nunca estaciona
    // nem entra no retryAfterNet é o próprio runOneHeadless (lib/engine/review.js), que
    // reconhece este id antes de decidir retry. Vem ANTES de 'rede' porque a mensagem
    // carrega o texto do fetch ('fetch failed'), que 'rede' casaria.
    id: 'coordenacao-indisponivel',
    // Duas frases, uma classe: a mesma falha se chama "coordenação" para quem ligou a
    // coordenação e "sincronização" para quem só ligou a consolidação. O id não muda,
    // porque é ele que o runOneHeadless reconhece para nunca estacionar.
    label: 'Sincronização entre dispositivos indisponível',
    grupo: 'rede',
    kind: 'transitorio',
    re: /(?:coordena[cç][aã]o|sincroniza[cç][aã]o) entre dispositivos indispon[ií]vel/i,
  },
  {
    id: 'rede',
    label: 'Rede indisponível',
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('lib/log-taxonomy.js')).digest('hex').slice(0,16))"
```

Esperado: `2f1744946d0fcc41`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

- [ ] **Passo 4: rodar e ver passar**

```bash
node --test --test-force-exit test/log-taxonomy.test.js
```

Esperado: PASSA, 0 falhas.

- [ ] **Passo 5: gate e commit**

```bash
npm run check && npm run lint && npm test
```

Esperado: `fail 0` e `gate de qualidade: sem regressão`. Se algo falhar, PARE e relate; não mexa em outro arquivo para fazer passar.

```bash
git add lib/log-taxonomy.js test/log-taxonomy.test.js
git commit -m "feat(sync): classe transitória de coordenação indisponível"
```


### Tarefa T09: Lease: quem está analisando o PR agora

O lease responde 'quem está com este PR AGORA'. A aquisição é condicional pelo ETag, então dois aparelhos que tentam ao mesmo tempo não ficam os dois com ele; e o vencido é livre, porque um aparelho que morreu não pode travar o PR para sempre.

**Arquivos:**
- Criar: `lib/sync/lease.js`
- Criar: `test/sync-lease.test.js`

- [ ] **Passo 1: escrever o teste**

Crie `test/sync-lease.test.js` com EXATAMENTE este conteúdo:

```js
// lib/sync/lease.js: o lease de coordenação entre aparelhos. Tudo contra o dublê do
// RTDB (test/helpers/fake-rtdb.js), que faz o CAS por ETag de verdade: é o `if-match`
// que decide quem fica com o lease quando dois aparelhos chegam juntos.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';
import { createRtdbClient } from '../lib/sync/rtdb.js';
import { SYNC } from '../lib/constants.js';
import lease, {
  leasePath, leaseAcquirable, buildLease, acquireLease, renewLease, releaseLease,
} from '../lib/sync/lease.js';

const TOKEN = 'tok-ok';
const IDS = { uid: 'u1', accountHash: 'a'.repeat(64), prHash: 'b'.repeat(64) };
const AGORA = 1_800_000_000_000;
let fake;

before(async () => { fake = await startFakeRtdb({ token: TOKEN }); });
after(async () => { await fake.close(); });
beforeEach(() => { fake.setTree(null); fake.requests.length = 0; });

function cliente(extra = {}) {
  return createRtdbClient({ databaseUrl: fake.url, getIdToken: async () => ({ ok: true, idToken: TOKEN }), ...extra });
}

function dadosDe(leaseId, deviceId, nowMs = AGORA) {
  return { leaseId, deviceId, operationKind: 'review', headSha: 'abc123', nowMs, farolVersion: '9.9.9' };
}

function noBanco() {
  const t = fake.tree();
  return t && t.users.u1.leases[IDS.accountHash][IDS.prHash];
}

test('exporta pelo default e pelos nomes', () => {
  for (const nome of ['leasePath', 'leaseAcquirable', 'buildLease', 'acquireLease', 'renewLease', 'releaseLease']) {
    assert.equal(typeof lease[nome], 'function', nome);
  }
});

test('leasePath monta o caminho do contrato', () => {
  assert.equal(leasePath('u1', 'ah', 'ph'), '/users/u1/leases/ah/ph');
});

test('leaseAcquirable: ausente, meu, expirado, alheio e falta de dado', () => {
  assert.equal(leaseAcquirable(null, { leaseId: 'L1', nowMs: AGORA }), 'ausente');
  assert.equal(leaseAcquirable(undefined, { leaseId: 'L1', nowMs: AGORA }), 'ausente');
  assert.equal(leaseAcquirable({ leaseId: 'L1', expiresAt: AGORA - 1 }, { leaseId: 'L1', nowMs: AGORA }), 'meu');
  assert.equal(leaseAcquirable({ leaseId: 'L2', expiresAt: AGORA }, { leaseId: 'L1', nowMs: AGORA }), 'expirado');
  assert.equal(leaseAcquirable({ leaseId: 'L2', expiresAt: AGORA + 1 }, { leaseId: 'L1', nowMs: AGORA }), 'alheio');
  assert.equal(leaseAcquirable({ leaseId: 'L2' }, { leaseId: 'L1', nowMs: AGORA }), 'alheio', 'sem expiresAt não libera');
  assert.equal(leaseAcquirable({ leaseId: 'L2', expiresAt: null }, { leaseId: 'L1', nowMs: AGORA }), 'alheio', 'null não vira zero');
  assert.equal(leaseAcquirable({ leaseId: 'L2', expiresAt: 'x' }, { leaseId: 'L1', nowMs: AGORA }), 'alheio');
  assert.equal(leaseAcquirable({ expiresAt: AGORA + 1 }, { leaseId: '', nowMs: AGORA }), 'alheio', 'leaseId vazio dos dois lados não é "meu"');
});

test('buildLease: expira em LEASE_TTL_MS e headSha vazio vira texto vazio', () => {
  const l = buildLease({ leaseId: 'L1', deviceId: 'd1', operationKind: 'self', headSha: undefined, nowMs: AGORA, farolVersion: '1.0.0' });
  assert.deepEqual(l, {
    leaseId: 'L1', deviceId: 'd1', operationKind: 'self', headSha: '',
    acquiredAt: AGORA, heartbeatAt: AGORA, expiresAt: AGORA + SYNC.LEASE_TTL_MS, farolVersion: '1.0.0',
  });
});

test('acquireLease em nó vazio grava com if-match null_etag', async () => {
  const r = await acquireLease(cliente(), IDS, dadosDe('L1', 'd1'));
  assert.equal(r.ok, true);
  assert.equal(r.lease.leaseId, 'L1');
  assert.match(r.etag, /^[0-9a-f]{40}$/);
  assert.equal(noBanco().deviceId, 'd1');
  const put = fake.requests.find((q) => q.method === 'PUT');
  assert.equal(put.headers['if-match'], 'null_etag');
});

test('dois aparelhos disputando ao mesmo tempo: exatamente um fica com o lease', async () => {
  const [a, b] = await Promise.all([
    acquireLease(cliente(), IDS, dadosDe('LA', 'dA')),
    acquireLease(cliente(), IDS, dadosDe('LB', 'dB')),
  ]);
  const vencedores = [a, b].filter((r) => r.ok);
  assert.equal(vencedores.length, 1, 'exatamente um ok');
  const perdedor = [a, b].find((r) => !r.ok);
  assert.equal(perdedor.reason, 'alheio');
  assert.equal(perdedor.lease.leaseId, vencedores[0].lease.leaseId, 'o perdedor enxerga o lease do vencedor');
  assert.equal(noBanco().leaseId, vencedores[0].lease.leaseId);
});

test('lease alheio vivo não é tomado', async () => {
  await acquireLease(cliente(), IDS, dadosDe('LA', 'dA'));
  const r = await acquireLease(cliente(), IDS, dadosDe('LB', 'dB', AGORA + 1000));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'alheio');
  assert.equal(r.lease.deviceId, 'dA');
  assert.equal(noBanco().leaseId, 'LA');
});

test('lease expirado é assumido', async () => {
  await acquireLease(cliente(), IDS, dadosDe('LA', 'dA'));
  const depois = AGORA + SYNC.LEASE_TTL_MS;
  const r = await acquireLease(cliente(), IDS, dadosDe('LB', 'dB', depois));
  assert.equal(r.ok, true);
  assert.equal(noBanco().leaseId, 'LB');
  assert.equal(noBanco().expiresAt, depois + SYNC.LEASE_TTL_MS);
});

test('lease "meu" é readquirido com validade nova', async () => {
  await acquireLease(cliente(), IDS, dadosDe('LA', 'dA'));
  const r = await acquireLease(cliente(), IDS, dadosDe('LA', 'dA', AGORA + 5000));
  assert.equal(r.ok, true);
  assert.equal(noBanco().expiresAt, AGORA + 5000 + SYNC.LEASE_TTL_MS);
});

test('renewLease do meu lease estende a validade e devolve o etag novo', async () => {
  await acquireLease(cliente(), IDS, dadosDe('LA', 'dA'));
  const r = await renewLease(cliente(), IDS, { leaseId: 'LA', nowMs: AGORA + 30_000 });
  assert.equal(r.ok, true);
  assert.match(r.etag, /^[0-9a-f]{40}$/);
  assert.equal(noBanco().heartbeatAt, AGORA + 30_000);
  assert.equal(noBanco().expiresAt, AGORA + 30_000 + SYNC.LEASE_TTL_MS);
  assert.equal(noBanco().acquiredAt, AGORA, 'acquiredAt fica');
});

test('renewLease de lease alheio devolve perdido e não toca o do outro', async () => {
  await acquireLease(cliente(), IDS, dadosDe('LB', 'dB'));
  const r = await renewLease(cliente(), IDS, { leaseId: 'LA', nowMs: AGORA + 1 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'perdido');
  assert.equal(r.lease.leaseId, 'LB');
  assert.equal(noBanco().heartbeatAt, AGORA);
});

test('renewLease de lease que sumiu devolve perdido', async () => {
  const r = await renewLease(cliente(), IDS, { leaseId: 'LA', nowMs: AGORA });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'perdido');
});

test('renewLease de lease expirado devolve perdido (outro aparelho pode já ter lido como livre)', async () => {
  await acquireLease(cliente(), IDS, dadosDe('LA', 'dA'));
  const r = await renewLease(cliente(), IDS, { leaseId: 'LA', nowMs: AGORA + SYNC.LEASE_TTL_MS });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'perdido');
  assert.equal(noBanco().expiresAt, AGORA + SYNC.LEASE_TTL_MS, 'não ressuscita');
});

test('renewLease condiciona o PUT ao etag lido: sucessor que assumiu entre o GET e o PUT não é sobrescrito', async () => {
  await acquireLease(cliente(), IDS, dadosDe('LA', 'dA'));
  const base = cliente();
  let intercalou = false;
  // entre a leitura (lease meu e vivo) e a escrita, outro aparelho assume o nó
  const c = {
    ...base,
    put: async (p, v, o) => {
      if (!intercalou) {
        intercalou = true;
        const sucessor = buildLease({ leaseId: 'LB', deviceId: 'dB', operationKind: 'review', headSha: 'abc123', nowMs: AGORA + 1, farolVersion: '9.9.9' });
        fake.setTree({ users: { u1: { leases: { [IDS.accountHash]: { [IDS.prHash]: sucessor } } } } });
      }
      return base.put(p, v, o);
    },
  };
  const r = await renewLease(c, IDS, { leaseId: 'LA', nowMs: AGORA + 30_000 });
  assert.equal(intercalou, true, 'o gancho rodou entre o GET e o PUT');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'perdido');
  assert.equal(r.lease.leaseId, 'LB', 'o 412 devolve o lease de quem assumiu');
  assert.equal(noBanco().leaseId, 'LB', 'o sucessor continua dono do nó');
  assert.equal(noBanco().deviceId, 'dB');
  const put = fake.requests.filter((q) => q.method === 'PUT').at(-1);
  assert.match(put.headers['if-match'], /^[0-9a-f]{40}$/, 'a renovação levou if-match');
});

test('releaseLease do meu apaga com if-match', async () => {
  await acquireLease(cliente(), IDS, dadosDe('LA', 'dA'));
  const r = await releaseLease(cliente(), IDS, { leaseId: 'LA' });
  assert.deepEqual(r, { ok: true, released: true });
  assert.equal(fake.tree(), null);
  const del = fake.requests.find((q) => q.method === 'DELETE');
  assert.match(del.headers['if-match'], /^[0-9a-f]{40}$/);
});

test('releaseLease nunca apaga o lease de outro aparelho', async () => {
  await acquireLease(cliente(), IDS, dadosDe('LB', 'dB'));
  const r = await releaseLease(cliente(), IDS, { leaseId: 'LA' });
  assert.deepEqual(r, { ok: true, released: false });
  assert.equal(noBanco().leaseId, 'LB');
  assert.equal(fake.requests.some((q) => q.method === 'DELETE'), false, 'nem tenta apagar');
});

test('release atrasado depois de o sucessor adquirir não apaga o sucessor', async () => {
  await acquireLease(cliente(), IDS, dadosDe('LA', 'dA'));
  const sucessor = await acquireLease(cliente(), IDS, dadosDe('LB', 'dB', AGORA + SYNC.LEASE_TTL_MS + 1));
  assert.equal(sucessor.ok, true);
  const r = await releaseLease(cliente(), IDS, { leaseId: 'LA' });
  assert.deepEqual(r, { ok: true, released: false });
  assert.equal(noBanco().leaseId, 'LB');
});

test('rede caída devolve indisponivel nas três operações, sem lançar', async () => {
  const semRede = cliente({ fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  const a = await acquireLease(semRede, IDS, dadosDe('LA', 'dA'));
  assert.equal(a.ok, false);
  assert.equal(a.reason, 'indisponivel');
  assert.equal(a.code, 'indisponivel');
  assert.equal(typeof a.motivo, 'string');
  const r = await renewLease(semRede, IDS, { leaseId: 'LA', nowMs: AGORA });
  assert.equal(r.reason, 'indisponivel');
  const l = await releaseLease(semRede, IDS, { leaseId: 'LA' });
  assert.equal(l.ok, false);
  assert.equal(l.reason, 'indisponivel');
});

test('token recusado também é indisponivel (nunca libera nem toma)', async () => {
  const c = cliente({ getIdToken: async () => ({ ok: true, idToken: 'errado' }) });
  const a = await acquireLease(c, IDS, dadosDe('LA', 'dA'));
  assert.equal(a.reason, 'indisponivel');
  assert.equal(a.code, 'nao_autorizado');
});

// O ETag é o que prova a posse na escrita; sem ele o PUT sairia sem if-match, ou seja,
// tomando o lease de quem estiver com ele. Proxy e servidor mal configurado engolem
// cabeçalho, então "sem ETag" não é hipótese de laboratório.
test('sem ETag na resposta, adquirir, renovar e soltar viram indisponivel sem escrever nada', async () => {
  const c = cliente();
  await c.put(leasePath('u1', IDS.accountHash, IDS.prHash), buildLease(dadosDe('L-outro', 'outro')));
  fake.requests.length = 0;
  fake.setSemEtag(true);
  try {
    const desfechos = [
      await acquireLease(c, IDS, dadosDe('L1', 'dev-1')),
      await renewLease(c, IDS, { leaseId: 'L-outro', nowMs: AGORA }),
      await releaseLease(c, IDS, { leaseId: 'L-outro' }),
    ];
    for (const r of desfechos) {
      assert.equal(r.ok, false);
      assert.equal(r.reason, 'indisponivel');
      assert.equal(r.code, 'resposta_invalida');
    }
    assert.deepEqual(fake.requests.filter((q) => q.method !== 'GET').map((q) => q.method), [], 'nenhuma escrita sem prova de posse');
    assert.equal(noBanco().leaseId, 'L-outro');
  } finally {
    fake.setSemEtag(false);
  }
});
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('test/sync-lease.test.js')).digest('hex').slice(0,16))"
```

Esperado: `b6cb879908c1eb66`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

- [ ] **Passo 2: rodar e ver falhar**

```bash
node --test --test-force-exit test/sync-lease.test.js
```

Esperado: FALHA. Cannot find module lib/sync/lease.js.

- [ ] **Passo 3: implementar**

Crie `lib/sync/lease.js` com EXATAMENTE este conteúdo:

```js
// Lease de coordenação entre aparelhos: quem está analisando este PR agora. Folha de
// IO simples: recebe o cliente do banco pronto (lib/sync/rtdb.js) e não conhece o engine.
//
// A posse é decidida pelo CAS por ETag do RTDB (`if-match` em PUT e DELETE): dois
// aparelhos que leem o nó vazio no mesmo instante mandam o mesmo `null_etag`, e o
// servidor aceita só o primeiro PUT; o segundo recebe 412 e, relendo, enxerga o lease
// do vencedor. As regras do banco não veem o leaseId de quem apaga, então a remoção
// só apaga o que o `if-match` prova ser o MEU lease.
//
// Nada aqui lança: todo desfecho volta como { ok, ... } para o coordenador decidir.
import { SYNC } from '../constants.js';
import { SYNC_CODES, motivoDe } from './errors.js';

// uma leitura + escrita por tentativa; três é o que o contrato fixa para a disputa
const MAX_TENTATIVAS = 3;
const COM_ETAG = { etag: true };

function leasePath(uid, accountHash, prHash) {
  return `/users/${uid}/leases/${accountHash}/${prHash}`;
}

function caminhoDe(ids) {
  return leasePath(ids.uid, ids.accountHash, ids.prHash);
}

function ehObjeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

// Falta de dado nunca libera: lease sem expiresAt numérico (null não vira zero) conta
// como vivo, porque tomar o lease de quem está trabalhando é a pior falha possível aqui.
function leaseAcquirable(atual, { leaseId, nowMs }) {
  if (atual === null || atual === undefined) return 'ausente';
  if (!ehObjeto(atual)) return 'alheio';
  if (leaseId && atual.leaseId === leaseId) return 'meu';
  const exp = atual.expiresAt;
  if (typeof exp !== 'number' || !Number.isFinite(exp)) return 'alheio';
  return exp <= nowMs ? 'expirado' : 'alheio';
}

function buildLease({ leaseId, deviceId, operationKind, headSha, nowMs, farolVersion }) {
  return {
    leaseId, deviceId, operationKind, headSha: headSha || '',
    acquiredAt: nowMs, heartbeatAt: nowMs, expiresAt: nowMs + SYNC.LEASE_TTL_MS, farolVersion,
  };
}

function indisponivel(r) {
  const code = (r && r.code) || SYNC_CODES.INDISPONIVEL;
  return { ok: false, reason: 'indisponivel', code, motivo: (r && r.motivo) || motivoDe(code) };
}

// Um passo da disputa: lê com etag e, se o lease pode ser meu, escreve condicionado ao
// etag lido. `conflito` devolve o valor atual que o 412 trouxe para a próxima volta.
async function tentarAdquirir(client, path, novo, nowMs) {
  const lido = await client.get(path, COM_ETAG);
  if (!lido.ok) return { fim: indisponivel(lido) };
  if (leaseAcquirable(lido.data, { leaseId: novo.leaseId, nowMs }) === 'alheio') return { fim: { ok: false, reason: 'alheio', lease: lido.data } };
  const w = await client.put(path, novo, { ifMatch: lido.etag || 'null_etag', etag: true });
  if (w.ok) return { fim: { ok: true, lease: novo, etag: w.etag } };
  if (w.code !== SYNC_CODES.CONFLITO) return { fim: indisponivel(w) };
  return { conflito: w.data };
}

async function acquireLease(client, ids, dados) {
  const path = caminhoDe(ids);
  const novo = buildLease(dados);
  let atual = null;
  for (let i = 0; i < MAX_TENTATIVAS; i++) {
    const passo = await tentarAdquirir(client, path, novo, dados.nowMs);
    if (passo.fim) return passo.fim;
    atual = passo.conflito;
  }
  // três 412 seguidos: outro aparelho segue escrevendo no nó, e na dúvida ele é o dono
  return { ok: false, reason: 'alheio', lease: atual };
}

function vivoEMeu(atual, leaseId, nowMs) {
  if (!ehObjeto(atual) || !leaseId || atual.leaseId !== leaseId) return false;
  return typeof atual.expiresAt === 'number' && atual.expiresAt > nowMs;
}

// Lease vencido é perdido mesmo que ninguém o tenha tomado ainda: outro aparelho pode
// já ter lido o nó como livre e estar a caminho do PUT, e renovar por cima esconderia
// essa corrida em vez de encerrar a sessão.
async function renewLease(client, ids, { leaseId, nowMs }) {
  const path = caminhoDe(ids);
  const lido = await client.get(path, COM_ETAG);
  if (!lido.ok) return indisponivel(lido);
  if (!vivoEMeu(lido.data, leaseId, nowMs)) return { ok: false, reason: 'perdido', lease: lido.data };
  const renovado = { ...lido.data, heartbeatAt: nowMs, expiresAt: nowMs + SYNC.LEASE_TTL_MS };
  const w = await client.put(path, renovado, { ifMatch: lido.etag, etag: true });
  if (w.ok) return { ok: true, etag: w.etag };
  if (w.code === SYNC_CODES.CONFLITO) return { ok: false, reason: 'perdido', lease: w.data };
  return indisponivel(w);
}

// Release atrasado (a sessão demorou a encerrar e o sucessor já assumiu) não pode
// apagar o sucessor: só apaga o nó cujo leaseId é o meu, e o `if-match` garante que é
// o MESMO nó que acabou de ser lido.
async function releaseLease(client, ids, { leaseId }) {
  const path = caminhoDe(ids);
  const lido = await client.get(path, COM_ETAG);
  if (!lido.ok) return indisponivel(lido);
  if (!ehObjeto(lido.data) || !leaseId || lido.data.leaseId !== leaseId) return { ok: true, released: false };
  const d = await client.del(path, { ifMatch: lido.etag });
  if (d.ok) return { ok: true, released: true };
  if (d.code === SYNC_CODES.CONFLITO) return { ok: true, released: false };
  return indisponivel(d);
}

export default { leasePath, leaseAcquirable, buildLease, acquireLease, renewLease, releaseLease };
export { leasePath, leaseAcquirable, buildLease, acquireLease, renewLease, releaseLease };
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('lib/sync/lease.js')).digest('hex').slice(0,16))"
```

Esperado: `26cb598b9c48619a`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

- [ ] **Passo 4: rodar e ver passar**

```bash
node --test --test-force-exit test/sync-lease.test.js
```

Esperado: PASSA, 0 falhas.

- [ ] **Passo 5: gate e commit**

```bash
npm run check && npm run lint && npm test
```

Esperado: `fail 0` e `gate de qualidade: sem regressão`. Se algo falhar, PARE e relate; não mexa em outro arquivo para fazer passar.

```bash
git add lib/sync/lease.js test/sync-lease.test.js
git commit -m "feat(sync): lease por conta e PR com aquisição condicional"
```


### Tarefa T10: Recibos: a análise que já terminou

O recibo responde 'esta análise JÁ FOI FEITA neste commit'. É ele que impede pagar duas vezes pela mesma análise, e o estado de órfão é o que distingue um resultado que ainda vale de um que ficou preso num aparelho que sumiu.

**Arquivos:**
- Criar: `lib/sync/receipts.js`
- Criar: `test/sync-receipts.test.js`

- [ ] **Passo 1: escrever o teste**

Crie `test/sync-receipts.test.js` com EXATAMENTE este conteúdo:

```js
// lib/sync/receipts.js: o recibo que diz "esta análise deste head já foi feita". A
// escrita é CAS por ETag contra o dublê do RTDB; bloqueio e órfão são puros.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';
import { createRtdbClient } from '../lib/sync/rtdb.js';
import { SYNC } from '../lib/constants.js';
import receipts, {
  receiptPath, receiptsPath, buildReceipt, receiptBlocks, receiptOrphanState,
  readReceipt, writeReceipt, invalidateReceipt,
} from '../lib/sync/receipts.js';

const TOKEN = 'tok-ok';
const IDS = { uid: 'u1', accountHash: 'a'.repeat(64), prHash: 'b'.repeat(64) };
const FP = 'review_' + 'c'.repeat(32);
const AGORA = 1_800_000_000_000;
let fake;

before(async () => { fake = await startFakeRtdb({ token: TOKEN }); });
after(async () => { await fake.close(); });
beforeEach(() => { fake.setTree(null); fake.requests.length = 0; });

function cliente(extra = {}) {
  return createRtdbClient({ databaseUrl: fake.url, getIdToken: async () => ({ ok: true, idToken: TOKEN }), ...extra });
}

function recibo(extra = {}) {
  return buildReceipt({
    operationKind: 'review', materialVersion: 'abc123', deviceId: 'd1', leaseId: 'L1', nowMs: AGORA,
    outcome: 'completed', publicationState: 'published', reviewId: '', farolVersion: '9.9.9', ...extra,
  });
}

function noBanco() {
  const t = fake.tree();
  return t && t.users.u1.receipts[IDS.accountHash][IDS.prHash][FP];
}

test('exporta pelo default e pelos nomes', () => {
  for (const nome of ['receiptPath', 'receiptsPath', 'buildReceipt', 'receiptBlocks', 'receiptOrphanState', 'readReceipt', 'writeReceipt', 'invalidateReceipt']) {
    assert.equal(typeof receipts[nome], 'function', nome);
  }
});

test('caminhos do contrato', () => {
  assert.equal(receiptPath('u1', 'ah', 'ph', 'fp'), '/users/u1/receipts/ah/ph/fp');
  assert.equal(receiptsPath('u1', 'ah', 'ph'), '/users/u1/receipts/ah/ph');
});

test('buildReceipt: expira em RECEIPT_TTL_MS e campos opcionais viram texto vazio', () => {
  const r = buildReceipt({
    operationKind: 'self', materialVersion: 'abc', deviceId: 'd1', leaseId: undefined, nowMs: AGORA,
    outcome: 'completed', publicationState: 'not_applicable', reviewId: undefined, farolVersion: '1.0.0',
  });
  assert.deepEqual(r, {
    operationKind: 'self', materialVersion: 'abc', deviceId: 'd1', leaseId: '',
    completedAt: AGORA, lastVerifiedAt: AGORA, expiresAt: AGORA + SYNC.RECEIPT_TTL_MS,
    outcome: 'completed', publicationState: 'not_applicable', reviewId: '', farolVersion: '1.0.0',
  });
});

test('receiptBlocks: por outcome e por expiresAt', () => {
  assert.equal(receiptBlocks(recibo(), AGORA), true);
  assert.equal(receiptBlocks(recibo({ outcome: 'external_review' }), AGORA), true);
  assert.equal(receiptBlocks(recibo({ outcome: 'cancelado' }), AGORA), false, 'outcome fora da lista não bloqueia');
  assert.equal(receiptBlocks({ ...recibo(), expiresAt: AGORA }, AGORA), false, 'vencido no instante não bloqueia');
  assert.equal(receiptBlocks({ ...recibo(), expiresAt: AGORA + 1 }, AGORA), true);
  assert.equal(receiptBlocks({ ...recibo(), expiresAt: null }, AGORA), false);
  assert.equal(receiptBlocks(null, AGORA), false);
  assert.equal(receiptBlocks('x', AGORA), false);
  assert.equal(receiptBlocks([recibo()], AGORA), false);
});

const VELHO = AGORA - SYNC.ORPHAN_AFTER_MS;
const DIA = 86_400_000;

test('receiptOrphanState: pending de aparelho parado há uma semana é órfão', () => {
  const r = recibo({ publicationState: 'pending', nowMs: VELHO });
  assert.equal(receiptOrphanState(r, { lastSeenAt: VELHO }, AGORA), 'orfao');
  assert.equal(receiptOrphanState(recibo({ publicationState: 'failed', nowMs: VELHO }), { lastSeenAt: VELHO }, AGORA), 'orfao');
});

test('receiptOrphanState: aparelho visto recentemente é ativo', () => {
  const r = recibo({ publicationState: 'pending', nowMs: VELHO });
  assert.equal(receiptOrphanState(r, { lastSeenAt: AGORA - 1000 }, AGORA), 'ativo');
});

test('receiptOrphanState: recibo recente de aparelho antigo NÃO é órfão', () => {
  const r = recibo({ publicationState: 'pending', nowMs: AGORA - 1000 });
  assert.equal(receiptOrphanState(r, { lastSeenAt: VELHO - DIA }, AGORA), 'ativo');
});

test('receiptOrphanState: falta de dado é desconhecido, nunca órfão', () => {
  const r = recibo({ publicationState: 'pending', nowMs: VELHO });
  assert.equal(receiptOrphanState(r, null, AGORA), 'desconhecido', 'aparelho sumido do banco');
  assert.equal(receiptOrphanState(r, {}, AGORA), 'desconhecido', 'lastSeenAt ausente');
  assert.equal(receiptOrphanState(r, { lastSeenAt: 'ontem' }, AGORA), 'desconhecido');
  assert.equal(receiptOrphanState(r, { lastSeenAt: AGORA + 1 }, AGORA), 'desconhecido', 'lastSeenAt no futuro');
  assert.equal(receiptOrphanState({ ...r, completedAt: undefined }, { lastSeenAt: VELHO }, AGORA), 'desconhecido');
});

test('receiptOrphanState: publicado ou sem publicação nunca é órfão', () => {
  for (const publicationState of ['published', 'not_applicable']) {
    const r = recibo({ publicationState, nowMs: VELHO - DIA });
    assert.equal(receiptOrphanState(r, { lastSeenAt: VELHO - DIA }, AGORA), 'ativo', publicationState);
  }
});

test('readReceipt: vazio devolve null com null_etag; gravado devolve o recibo e o etag', async () => {
  const c = cliente();
  const vazio = await readReceipt(c, IDS, FP);
  assert.deepEqual(vazio, { ok: true, receipt: null, etag: 'null_etag' });
  await writeReceipt(c, IDS, FP, recibo(), { ifMatch: 'null_etag' });
  const lido = await readReceipt(c, IDS, FP);
  assert.equal(lido.ok, true);
  assert.equal(lido.receipt.deviceId, 'd1');
  assert.match(lido.etag, /^[0-9a-f]{40}$/);
});

test('writeReceipt com null_etag grava no nó vazio', async () => {
  const w = await writeReceipt(cliente(), IDS, FP, recibo(), { ifMatch: 'null_etag' });
  assert.deepEqual(w, { ok: true });
  assert.equal(noBanco().outcome, 'completed');
  assert.equal(fake.requests.at(-1).headers['if-match'], 'null_etag');
});

test('writeReceipt sem ifMatch nunca escreve às cegas: vale null_etag', async () => {
  await writeReceipt(cliente(), IDS, FP, recibo({ deviceId: 'dOutro' }), { ifMatch: 'null_etag' });
  const w = await writeReceipt(cliente(), IDS, FP, recibo({ deviceId: 'dEu' }), {});
  assert.equal(w.ok, false);
  assert.equal(w.code, 'conflito');
  assert.equal(noBanco().deviceId, 'dOutro');
});

test('writeReceipt com 412 devolve o recibo atual e não sobrescreve', async () => {
  const c = cliente();
  await writeReceipt(c, IDS, FP, recibo({ deviceId: 'dOutro' }), { ifMatch: 'null_etag' });
  const w = await writeReceipt(c, IDS, FP, recibo({ deviceId: 'dEu' }), { ifMatch: 'null_etag' });
  assert.equal(w.ok, false);
  assert.equal(w.code, 'conflito');
  assert.equal(w.atual.deviceId, 'dOutro');
  assert.equal(noBanco().deviceId, 'dOutro');
});

test('writeReceipt com o etag lido sobrescreve', async () => {
  const c = cliente();
  await writeReceipt(c, IDS, FP, recibo({ deviceId: 'dOutro' }), { ifMatch: 'null_etag' });
  const lido = await readReceipt(c, IDS, FP);
  const w = await writeReceipt(c, IDS, FP, recibo({ deviceId: 'dEu' }), { ifMatch: lido.etag });
  assert.deepEqual(w, { ok: true });
  assert.equal(noBanco().deviceId, 'dEu');
});

test('invalidateReceipt apaga com o etag lido', async () => {
  const c = cliente();
  await writeReceipt(c, IDS, FP, recibo(), { ifMatch: 'null_etag' });
  const lido = await readReceipt(c, IDS, FP);
  assert.deepEqual(await invalidateReceipt(c, IDS, FP, { ifMatch: lido.etag }), { ok: true });
  assert.equal(fake.tree(), null);
});

test('invalidateReceipt com etag velho não apaga o recibo que outro aparelho regravou', async () => {
  const c = cliente();
  await writeReceipt(c, IDS, FP, recibo(), { ifMatch: 'null_etag' });
  const lido = await readReceipt(c, IDS, FP);
  await writeReceipt(c, IDS, FP, recibo({ deviceId: 'dOutro', nowMs: AGORA + 1 }), { ifMatch: lido.etag });
  const r = await invalidateReceipt(c, IDS, FP, { ifMatch: lido.etag });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'conflito');
  assert.equal(noBanco().deviceId, 'dOutro');
});

test('invalidateReceipt sem etag recusa sem tocar a rede', async () => {
  const r = await invalidateReceipt(cliente(), IDS, FP, {});
  assert.equal(r.ok, false);
  assert.equal(r.code, 'falha_interna');
  assert.equal(fake.requests.length, 0);
});

test('rede caída: leitura e escrita devolvem o código, sem lançar', async () => {
  const semRede = cliente({ fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  const r = await readReceipt(semRede, IDS, FP);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'indisponivel');
  assert.equal(typeof r.motivo, 'string');
  const w = await writeReceipt(semRede, IDS, FP, recibo(), { ifMatch: 'null_etag' });
  assert.equal(w.ok, false);
  assert.equal(w.code, 'indisponivel');
});

// Sem ETag não há CAS: writeReceipt cairia no 'null_etag' e invalidateReceipt não teria
// o que provar. A leitura falha, e quem chama trata como banco indisponível.
test('sem ETag na resposta, ler recibo vira resposta_invalida e nada é apagado', async () => {
  const c = cliente();
  await c.put(receiptPath('u1', IDS.accountHash, IDS.prHash, FP), recibo());
  fake.requests.length = 0;
  fake.setSemEtag(true);
  try {
    const r = await readReceipt(c, IDS, FP);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'resposta_invalida');
    assert.deepEqual(fake.requests.filter((q) => q.method === 'DELETE'), []);
    assert.ok(noBanco(), 'o recibo continua no banco');
  } finally {
    fake.setSemEtag(false);
  }
});
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('test/sync-receipts.test.js')).digest('hex').slice(0,16))"
```

Esperado: `0c2201816caf4486`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

- [ ] **Passo 2: rodar e ver falhar**

```bash
node --test --test-force-exit test/sync-receipts.test.js
```

Esperado: FALHA. Cannot find module lib/sync/receipts.js.

- [ ] **Passo 3: implementar**

Crie `lib/sync/receipts.js` com EXATAMENTE este conteúdo:

```js
// Recibo de coordenação: a prova, no banco compartilhado, de que uma análise de um
// head (ou de um marcador de pushback) já terminou em algum aparelho. Folha de IO
// simples: recebe o cliente do banco pronto e não conhece o engine.
//
// A escrita é sempre condicionada ao ETag (`if-match`): recibo escrito às cegas
// apagaria o de um aparelho que terminou a mesma análise um instante antes, e o
// recibo é justamente o que impede a segunda análise paga.
//
// Nada aqui lança: todo desfecho volta como { ok, ... } para quem chama decidir.
import { SYNC } from '../constants.js';
import { SYNC_CODES, motivoDe } from './errors.js';

// só estes desfechos dizem "já foi analisado"; qualquer outro valor não bloqueia
const OUTCOMES_QUE_BLOQUEIAM = new Set(['completed', 'external_review']);
// só recibo cuja publicação não aconteceu pode ficar órfão: publicado ou sem
// publicação (autoanálise, pushback) já é desfecho final, não há o que refazer
const PUBLICACAO_PENDENTE = new Set(['pending', 'failed']);
const COM_ETAG = { etag: true };

function receiptsPath(uid, accountHash, prHash) {
  return `/users/${uid}/receipts/${accountHash}/${prHash}`;
}

function receiptPath(uid, accountHash, prHash, fingerprint) {
  return `${receiptsPath(uid, accountHash, prHash)}/${fingerprint}`;
}

function caminhoDe(ids, fingerprint) {
  return receiptPath(ids.uid, ids.accountHash, ids.prHash, fingerprint);
}

function ehObjeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function ehNumero(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function buildReceipt({ operationKind, materialVersion, deviceId, leaseId, nowMs, outcome, publicationState, reviewId, farolVersion }) {
  return {
    operationKind, materialVersion, deviceId, leaseId: leaseId || '',
    completedAt: nowMs, lastVerifiedAt: nowMs, expiresAt: nowMs + SYNC.RECEIPT_TTL_MS,
    outcome, publicationState, reviewId: reviewId || '', farolVersion,
  };
}

function receiptBlocks(receipt, nowMs) {
  if (!ehObjeto(receipt) || !OUTCOMES_QUE_BLOQUEIAM.has(receipt.outcome)) return false;
  return ehNumero(receipt.expiresAt) && receipt.expiresAt > nowMs;
}

// Órfão exige as DUAS idades: aparelho parado há uma semana E recibo com uma semana.
// Recibo recente de aparelho antigo é o aparelho que acabou de voltar e ainda não
// carimbou presença, e chamá-lo de órfão ofereceria refazer o que está em curso.
// Falta de dado (aparelho sumido do banco, relógio no futuro) é 'desconhecido', nunca
// órfão: a tela não pode convidar a refazer com base em ausência de informação.
function receiptOrphanState(receipt, device, nowMs) {
  const r = ehObjeto(receipt) ? receipt : {};
  if (!PUBLICACAO_PENDENTE.has(r.publicationState)) return 'ativo';
  if (!ehObjeto(device) || !ehNumero(device.lastSeenAt) || device.lastSeenAt > nowMs) return 'desconhecido';
  if (!ehNumero(r.completedAt)) return 'desconhecido';
  const parado = nowMs - device.lastSeenAt >= SYNC.ORPHAN_AFTER_MS;
  const antigo = nowMs - r.completedAt >= SYNC.ORPHAN_AFTER_MS;
  return parado && antigo ? 'orfao' : 'ativo';
}

function falha(r) {
  const code = (r && r.code) || SYNC_CODES.INDISPONIVEL;
  return { ok: false, code, motivo: (r && r.motivo) || motivoDe(code) };
}

async function readReceipt(client, ids, fingerprint) {
  const lido = await client.get(caminhoDe(ids, fingerprint), COM_ETAG);
  if (!lido.ok) return falha(lido);
  return { ok: true, receipt: ehObjeto(lido.data) ? lido.data : null, etag: lido.etag };
}

// Sem ifMatch vale 'null_etag' (só grava em nó vazio), nunca escrita incondicional.
async function writeReceipt(client, ids, fingerprint, receipt, { ifMatch } = {}) {
  const w = await client.put(caminhoDe(ids, fingerprint), receipt, { ifMatch: ifMatch || 'null_etag' });
  if (w.ok) return { ok: true };
  if (w.code === SYNC_CODES.CONFLITO) return { ok: false, code: SYNC_CODES.CONFLITO, atual: w.data };
  return falha(w);
}

// Invalidar sem o etag lido apagaria o recibo que outro aparelho regravou entre a
// leitura e o clique; por isso o etag é obrigatório e a falta dele nem toca a rede.
async function invalidateReceipt(client, ids, fingerprint, { ifMatch } = {}) {
  if (!ifMatch) return { ok: false, code: SYNC_CODES.FALHA_INTERNA, motivo: 'invalidar recibo exige o etag lido antes' };
  const d = await client.del(caminhoDe(ids, fingerprint), { ifMatch });
  if (d.ok) return { ok: true };
  return falha(d);
}

export default { receiptPath, receiptsPath, buildReceipt, receiptBlocks, receiptOrphanState, readReceipt, writeReceipt, invalidateReceipt };
export { receiptPath, receiptsPath, buildReceipt, receiptBlocks, receiptOrphanState, readReceipt, writeReceipt, invalidateReceipt };
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('lib/sync/receipts.js')).digest('hex').slice(0,16))"
```

Esperado: `e829da28dd1b7af1`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

- [ ] **Passo 4: rodar e ver passar**

```bash
node --test --test-force-exit test/sync-receipts.test.js
```

Esperado: PASSA, 0 falhas.

- [ ] **Passo 5: gate e commit**

```bash
npm run check && npm run lint && npm test
```

Esperado: `fail 0` e `gate de qualidade: sem regressão`. Se algo falhar, PARE e relate; não mexa em outro arquivo para fazer passar.

```bash
git add lib/sync/receipts.js test/sync-receipts.test.js
git commit -m "feat(sync): recibo por operação e head, com estado de órfão"
```


### Tarefa T11: Rodadas do dia

O teto de rodadas automáticas por PR e por dia passa a ser COMPARTILHADO entre os aparelhos. Sem isso, três aparelhos multiplicariam por três o teto que existe para proteger orçamento.

**Arquivos:**
- Criar: `lib/sync/rounds.js`
- Criar: `test/sync-rounds.test.js`

- [ ] **Passo 1: escrever o teste**

Crie `test/sync-rounds.test.js` com EXATAMENTE este conteúdo:

```js
// lib/sync/rounds.js: o teto COMPARTILHADO de rodadas automáticas por PR e por dia.
// O nó do dia inteiro é escrito com `if-match`, então dois aparelhos que disputam o
// último lugar do dia não passam os dois: o dublê do RTDB faz o CAS de verdade.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';
import { createRtdbClient } from '../lib/sync/rtdb.js';
import { SYNC } from '../lib/constants.js';
import { brasiliaDay } from '../lib/sync/keys.js';
import rounds, {
  roundsPath, countStarted, countReservedVivas, reserveRound, startRound, pruneRounds,
} from '../lib/sync/rounds.js';

const TOKEN = 'tok-ok';
const IDS = { uid: 'u1', accountHash: 'a'.repeat(64), prHash: 'b'.repeat(64) };
const AGORA = 1_800_000_000_000;
const DIA = brasiliaDay(AGORA);
let fake;

before(async () => { fake = await startFakeRtdb({ token: TOKEN }); });
after(async () => { await fake.close(); });
beforeEach(() => { fake.setTree(null); fake.requests.length = 0; });

function cliente(extra = {}) {
  return createRtdbClient({ databaseUrl: fake.url, getIdToken: async () => ({ ok: true, idToken: TOKEN }), ...extra });
}

function reservaDe(attemptId, leaseId = 'L-' + attemptId, nowMs = AGORA) {
  return { attemptId, fingerprint: 'review_' + 'c'.repeat(32), leaseId, nowMs };
}

function semear(dia, reservations) {
  fake.setTree({ users: { u1: { dailyRounds: { [IDS.accountHash]: { [IDS.prHash]: { [dia]: { dayPolicy: SYNC.DAY_TZ, updatedAt: 1, reservations } } } } } } });
}

function iniciada(n) {
  return { operationFingerprint: 'f', leaseId: 'L' + n, state: 'started', reservedAt: 1, startedAt: 2, expiresAt: 3 };
}

function noDia(dia = DIA) {
  const t = fake.tree();
  return t && t.users.u1.dailyRounds[IDS.accountHash][IDS.prHash][dia];
}

test('exporta pelo default e pelos nomes', () => {
  for (const nome of ['roundsPath', 'countStarted', 'countReservedVivas', 'reserveRound', 'startRound', 'pruneRounds']) {
    assert.equal(typeof rounds[nome], 'function', nome);
  }
});

test('roundsPath monta o caminho do contrato', () => {
  assert.equal(roundsPath('u1', 'ah', 'ph', '2026-09-10'), '/users/u1/dailyRounds/ah/ph/2026-09-10');
});

test('countStarted e countReservedVivas contam só o que vale', () => {
  const node = { reservations: {
    a: { state: 'started' },
    b: { state: 'started', expiresAt: 0 },
    c: { state: 'reserved', expiresAt: AGORA + 1 },
    d: { state: 'reserved', expiresAt: AGORA },
    e: { state: 'reserved' },
    f: 'lixo',
  } };
  assert.equal(countStarted(node), 2, 'started conta mesmo com expiresAt vencido: a rodada aconteceu');
  assert.equal(countReservedVivas(node, AGORA), 1, 'só reserva com expiresAt no futuro');
  assert.equal(countStarted(null), 0);
  assert.equal(countReservedVivas(undefined, AGORA), 0);
});

test('reserveRound em dia vazio grava o nó inteiro com a reserva', async () => {
  const r = await reserveRound(cliente(), IDS, DIA, reservaDe('t1'));
  assert.equal(r.ok, true);
  assert.match(r.etag, /^[0-9a-f]{40}$/);
  const no = noDia();
  assert.equal(no.dayPolicy, 'America/Sao_Paulo');
  assert.equal(no.updatedAt, AGORA);
  assert.deepEqual(no.reservations.t1, {
    operationFingerprint: 'review_' + 'c'.repeat(32), leaseId: 'L-t1', state: 'reserved',
    reservedAt: AGORA, expiresAt: AGORA + SYNC.LEASE_TTL_MS,
  });
  assert.equal(fake.requests.find((q) => q.method === 'PUT').headers['if-match'], 'null_etag');
});

test('teto: DAILY_ROUNDS_MAX rodadas iniciadas esgotam o dia', async () => {
  const cheio = {};
  for (let i = 0; i < SYNC.DAILY_ROUNDS_MAX; i++) cheio['s' + i] = iniciada(i);
  semear(DIA, cheio);
  const r = await reserveRound(cliente(), IDS, DIA, reservaDe('t1'));
  assert.deepEqual(r, { ok: false, reason: 'esgotado', started: SYNC.DAILY_ROUNDS_MAX });
  assert.equal(Object.keys(noDia().reservations).length, SYNC.DAILY_ROUNDS_MAX, 'nada foi escrito');
});

test('reserva viva conta contra o teto', async () => {
  semear(DIA, { s0: iniciada(0), s1: iniciada(1), r2: { operationFingerprint: 'f', leaseId: 'Lx', state: 'reserved', reservedAt: AGORA, expiresAt: AGORA + 1 } });
  const r = await reserveRound(cliente(), IDS, DIA, reservaDe('t1'));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'esgotado');
  assert.equal(r.started, 2);
});

test('reserva vencida não conta: a sessão que reservou morreu antes de começar', async () => {
  semear(DIA, { s0: iniciada(0), s1: iniciada(1), r2: { operationFingerprint: 'f', leaseId: 'Lx', state: 'reserved', reservedAt: 1, expiresAt: AGORA } });
  const r = await reserveRound(cliente(), IDS, DIA, reservaDe('t1'));
  assert.equal(r.ok, true);
  assert.equal(noDia().reservations.t1.state, 'reserved');
  assert.ok(noDia().reservations.r2, 'a reserva antiga fica no nó (a poda é por dia)');
});

test('parâmetro max sobrescreve o teto padrão', async () => {
  semear(DIA, { s0: iniciada(0) });
  const r = await reserveRound(cliente(), IDS, DIA, { ...reservaDe('t1'), max: 1 });
  assert.deepEqual(r, { ok: false, reason: 'esgotado', started: 1 });
});

test('dois aparelhos disputando o último lugar do dia: só um passa', async () => {
  semear(DIA, { s0: iniciada(0), s1: iniciada(1) });
  const [a, b] = await Promise.all([
    reserveRound(cliente(), IDS, DIA, reservaDe('tA')),
    reserveRound(cliente(), IDS, DIA, reservaDe('tB')),
  ]);
  const passaram = [a, b].filter((r) => r.ok);
  assert.equal(passaram.length, 1, 'exatamente um');
  const barrado = [a, b].find((r) => !r.ok);
  assert.equal(barrado.reason, 'esgotado');
  const res = noDia().reservations;
  assert.equal(Object.keys(res).length, 3);
  assert.equal(countStarted(noDia()) + countReservedVivas(noDia(), AGORA), SYNC.DAILY_ROUNDS_MAX);
});

test('startRound marca a reserva como iniciada', async () => {
  await reserveRound(cliente(), IDS, DIA, reservaDe('t1', 'L1'));
  const r = await startRound(cliente(), IDS, DIA, { attemptId: 't1', leaseId: 'L1', nowMs: AGORA + 10 });
  assert.deepEqual(r, { ok: true });
  const res = noDia().reservations.t1;
  assert.equal(res.state, 'started');
  assert.equal(res.startedAt, AGORA + 10);
  assert.equal(noDia().updatedAt, AGORA + 10);
});

test('startRound condiciona o PUT do dia ao etag lido: rodada que outro aparelho gravou entre o GET e o PUT sobrevive', async () => {
  await reserveRound(cliente(), IDS, DIA, reservaDe('t1', 'L1'));
  const base = cliente();
  let intercalou = false;
  // entre a leitura e a escrita do nó do dia, outro aparelho inicia uma rodada própria
  const c = {
    ...base,
    put: async (p, v, o) => {
      if (!intercalou) {
        intercalou = true;
        const t = fake.tree();
        t.users.u1.dailyRounds[IDS.accountHash][IDS.prHash][DIA].reservations.outro = iniciada(9);
        fake.setTree(t);
      }
      return base.put(p, v, o);
    },
  };
  fake.requests.length = 0;
  const r = await startRound(c, IDS, DIA, { attemptId: 't1', leaseId: 'L1', nowMs: AGORA + 10 });
  assert.equal(intercalou, true, 'o gancho rodou entre o GET e o PUT');
  assert.deepEqual(r, { ok: true }, 'o 412 obriga a reler, e a segunda volta inicia a reserva');
  const res = noDia().reservations;
  assert.ok(res.outro, 'a rodada do outro aparelho não foi apagada');
  assert.equal(res.outro.state, 'started');
  assert.equal(res.t1.state, 'started');
  assert.equal(countStarted(noDia()), 2, 'o teto compartilhado enxerga as duas rodadas');
  const puts = fake.requests.filter((q) => q.method === 'PUT');
  assert.equal(puts.length, 2, 'uma escrita recusada e uma aceita');
  for (const q of puts) assert.match(q.headers['if-match'], /^[0-9a-f]{40}$/, 'todo PUT do startRound leva if-match');
});

test('startRound exige o mesmo leaseId da reserva', async () => {
  await reserveRound(cliente(), IDS, DIA, reservaDe('t1', 'L1'));
  const r = await startRound(cliente(), IDS, DIA, { attemptId: 't1', leaseId: 'OUTRO', nowMs: AGORA + 10 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'perdido');
  assert.equal(noDia().reservations.t1.state, 'reserved', 'não iniciou a reserva de outro lease');
});

test('startRound de reserva que não existe é perdido', async () => {
  const r = await startRound(cliente(), IDS, DIA, { attemptId: 'nada', leaseId: 'L1', nowMs: AGORA });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'perdido');
});

test('startRound de reserva vencida é perdido: outro aparelho pode já ter usado o lugar', async () => {
  await reserveRound(cliente(), IDS, DIA, reservaDe('t1', 'L1'));
  const r = await startRound(cliente(), IDS, DIA, { attemptId: 't1', leaseId: 'L1', nowMs: AGORA + SYNC.LEASE_TTL_MS });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'perdido');
});

test('o dia vem de brasiliaDay: 02:30 UTC ainda é o dia anterior em Brasília', async () => {
  const instante = Date.UTC(2026, 8, 11, 2, 30);
  const dia = brasiliaDay(instante);
  assert.equal(dia, '2026-09-10');
  const r = await reserveRound(cliente(), IDS, dia, reservaDe('t1', 'L1', instante));
  assert.equal(r.ok, true);
  assert.ok(noDia('2026-09-10'), 'gravado no dia de Brasília');
  assert.equal(fake.tree().users.u1.dailyRounds[IDS.accountHash][IDS.prHash]['2026-09-11'], undefined);
});

test('pruneRounds apaga dia antigo, mantém o de hoje e decide a borda pelo dia de Brasília', async () => {
  const agora = Date.UTC(2026, 8, 19, 2, 30); // ainda 18/09 em Brasília
  const fundo = { dayPolicy: SYNC.DAY_TZ, updatedAt: 1, reservations: { s: iniciada(0) } };
  fake.setTree({ users: { u1: { dailyRounds: { [IDS.accountHash]: { [IDS.prHash]: {
    '2026-09-01': fundo, '2026-09-09': fundo, '2026-09-10': fundo, '2026-09-18': fundo,
  } } } } } });
  const r = await pruneRounds(cliente(), 'u1', IDS.accountHash, IDS.prHash, { nowMs: agora });
  assert.deepEqual(r, { ok: true, removidos: 2 });
  const dias = Object.keys(fake.tree().users.u1.dailyRounds[IDS.accountHash][IDS.prHash]).sort();
  assert.deepEqual(dias, ['2026-09-10', '2026-09-18'], 'o limite é 8 dias antes em Brasília (10/09), não em UTC (11/09)');
  assert.equal(fake.requests.at(-1).method, 'PATCH', 'um PATCH só com os nulos');
});

test('pruneRounds sem nada velho não escreve', async () => {
  semear(DIA, { s0: iniciada(0) });
  const r = await pruneRounds(cliente(), 'u1', IDS.accountHash, IDS.prHash, { nowMs: AGORA });
  assert.deepEqual(r, { ok: true, removidos: 0 });
  assert.equal(fake.requests.some((q) => q.method !== 'GET'), false);
});

test('rede caída: indisponivel com código, sem lançar', async () => {
  const semRede = cliente({ fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  const r = await reserveRound(semRede, IDS, DIA, reservaDe('t1'));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'indisponivel');
  assert.equal(r.code, 'indisponivel');
  const s = await startRound(semRede, IDS, DIA, { attemptId: 't1', leaseId: 'L1', nowMs: AGORA });
  assert.equal(s.reason, 'indisponivel');
  const p = await pruneRounds(semRede, 'u1', IDS.accountHash, IDS.prHash, { nowMs: AGORA });
  assert.equal(p.ok, false);
  assert.equal(p.removidos, 0);
  assert.equal(p.code, 'indisponivel');
});

// O nó do dia inteiro é reescrito por PUT: sem ETag o if-match sairia de cena e duas
// reservas simultâneas passariam as duas, furando o teto compartilhado.
test('sem ETag na resposta, reservar e iniciar viram indisponivel sem escrever nada', async () => {
  const c = cliente();
  semear(DIA, { t1: reservaDe('t1') });
  fake.requests.length = 0;
  fake.setSemEtag(true);
  try {
    const r = await reserveRound(c, IDS, DIA, { attemptId: 't2', fingerprint: 'review_x', leaseId: 'L2', nowMs: AGORA });
    assert.equal(r.reason, 'indisponivel');
    assert.equal(r.code, 'resposta_invalida');
    const s = await startRound(c, IDS, DIA, { attemptId: 't1', leaseId: 'L-t1', nowMs: AGORA });
    assert.equal(s.reason, 'indisponivel');
    assert.equal(s.code, 'resposta_invalida');
    assert.deepEqual(fake.requests.filter((q) => q.method === 'PUT').map((q) => q.path), [], 'nenhuma escrita sem prova');
    assert.deepEqual(Object.keys(noDia().reservations), ['t1']);
  } finally {
    fake.setSemEtag(false);
  }
});
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('test/sync-rounds.test.js')).digest('hex').slice(0,16))"
```

Esperado: `4409db4e7ff84d5b`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

- [ ] **Passo 2: rodar e ver falhar**

```bash
node --test --test-force-exit test/sync-rounds.test.js
```

Esperado: FALHA. Cannot find module lib/sync/rounds.js.

- [ ] **Passo 3: implementar**

Crie `lib/sync/rounds.js` com EXATAMENTE este conteúdo:

```js
// Teto COMPARTILHADO de rodadas automáticas por PR e por dia (D13 do contrato). Folha
// de IO simples: recebe o cliente do banco pronto e não conhece o engine.
//
// O teto local (MAX_RODADAS_AUTO_DIA, review.js) conta só o que ESTE aparelho relançou;
// com dois aparelhos da mesma pessoa, cada um gastaria o seu teto e o PR teria o dobro
// de rodadas no dia. Aqui o nó do dia inteiro é reescrito com `if-match`, então duas
// reservas simultâneas para o último lugar não passam as duas: o 412 obriga a reler,
// e a releitura já enxerga o lugar ocupado.
//
// O dia é o de Brasília (brasiliaDay), nunca o do fuso do processo: aparelhos em fusos
// diferentes precisam concordar sobre qual é "hoje" para o teto ser o mesmo.
//
// Nada aqui lança: todo desfecho volta como { ok, ... } para o coordenador decidir.
import { SYNC } from '../constants.js';
import { SYNC_CODES, motivoDe } from './errors.js';
import { brasiliaDay } from './keys.js';

// uma leitura + escrita por tentativa; três é o que o contrato fixa para a disputa
const MAX_TENTATIVAS = 3;
const COM_ETAG = { etag: true };
const SHALLOW = { shallow: true };
const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;

function roundsBase(uid, accountHash, prHash) {
  return `/users/${uid}/dailyRounds/${accountHash}/${prHash}`;
}

function roundsPath(uid, accountHash, prHash, day) {
  return `${roundsBase(uid, accountHash, prHash)}/${day}`;
}

function ehObjeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function reservasDe(node) {
  return ehObjeto(node) && ehObjeto(node.reservations) ? node.reservations : {};
}

function listaDeReservas(node) {
  return Object.values(reservasDe(node)).filter(ehObjeto);
}

// started conta mesmo vencido: a rodada aconteceu, e o teto é de rodadas do dia
function countStarted(node) {
  return listaDeReservas(node).filter((r) => r.state === 'started').length;
}

// reserva de sessão que morreu antes de começar não segura o lugar para sempre:
// ela só conta enquanto o prazo dela (o TTL do lease) não venceu
function countReservedVivas(node, nowMs) {
  return listaDeReservas(node).filter((r) => r.state === 'reserved' && Number(r.expiresAt) > nowMs).length;
}

function indisponivel(r) {
  const code = (r && r.code) || SYNC_CODES.INDISPONIVEL;
  return { ok: false, reason: 'indisponivel', code, motivo: (r && r.motivo) || motivoDe(code) };
}

// três 412 seguidos: o nó do dia está em disputa contínua, e sem prova do lugar a
// rodada não começa (a admissão trata como indisponível, que é espera, não falha)
function disputaSemFim() {
  return indisponivel({ code: SYNC_CODES.CONFLITO });
}

function comReserva(node, { attemptId, fingerprint, leaseId, nowMs }) {
  const reserva = {
    operationFingerprint: fingerprint, leaseId, state: 'reserved',
    reservedAt: nowMs, startedAt: null, expiresAt: nowMs + SYNC.LEASE_TTL_MS,
  };
  const reservations = { ...reservasDe(node), [attemptId]: reserva };
  return { dayPolicy: SYNC.DAY_TZ, updatedAt: nowMs, reservations };
}

async function tentarReservar(client, path, dados, max) {
  const lido = await client.get(path, COM_ETAG);
  if (!lido.ok) return { fim: indisponivel(lido) };
  const started = countStarted(lido.data);
  if (started + countReservedVivas(lido.data, dados.nowMs) >= max) return { fim: { ok: false, reason: 'esgotado', started } };
  const w = await client.put(path, comReserva(lido.data, dados), { ifMatch: lido.etag || 'null_etag', etag: true });
  if (w.ok) return { fim: { ok: true, etag: w.etag } };
  if (w.code !== SYNC_CODES.CONFLITO) return { fim: indisponivel(w) };
  return {};
}

async function reserveRound(client, ids, day, { attemptId, fingerprint, leaseId, nowMs, max = SYNC.DAILY_ROUNDS_MAX }) {
  const path = roundsPath(ids.uid, ids.accountHash, ids.prHash, day);
  const dados = { attemptId, fingerprint, leaseId, nowMs };
  for (let i = 0; i < MAX_TENTATIVAS; i++) {
    const passo = await tentarReservar(client, path, dados, max);
    if (passo.fim) return passo.fim;
  }
  return disputaSemFim();
}

// Reserva vencida é perdida: depois do prazo ela deixou de contar contra o teto, então
// outro aparelho pode já ter ocupado o lugar, e iniciá-la agora passaria do teto.
function reservaIniciavel(reserva, leaseId, nowMs) {
  if (!ehObjeto(reserva) || !leaseId || reserva.leaseId !== leaseId) return false;
  return reserva.state === 'started' || Number(reserva.expiresAt) > nowMs;
}

async function tentarIniciar(client, path, { attemptId, leaseId, nowMs }) {
  const lido = await client.get(path, COM_ETAG);
  if (!lido.ok) return { fim: indisponivel(lido) };
  const reserva = reservasDe(lido.data)[attemptId];
  if (!reservaIniciavel(reserva, leaseId, nowMs)) return { fim: { ok: false, reason: 'perdido' } };
  const iniciada = { ...reserva, state: 'started', startedAt: nowMs };
  const reservations = { ...reservasDe(lido.data), [attemptId]: iniciada };
  const w = await client.put(path, { ...lido.data, updatedAt: nowMs, reservations }, { ifMatch: lido.etag });
  if (w.ok) return { fim: { ok: true } };
  if (w.code !== SYNC_CODES.CONFLITO) return { fim: indisponivel(w) };
  return {};
}

async function startRound(client, ids, day, dados) {
  const path = roundsPath(ids.uid, ids.accountHash, ids.prHash, day);
  for (let i = 0; i < MAX_TENTATIVAS; i++) {
    const passo = await tentarIniciar(client, path, dados);
    if (passo.fim) return passo.fim;
  }
  return disputaSemFim();
}

// Um PATCH só, com os dias velhos em null: PATCH é idempotente e dia velho ninguém
// mais escreve, então não há corrida a arbitrar com `if-match`.
async function pruneRounds(client, uid, accountHash, prHash, { nowMs }) {
  const base = roundsBase(uid, accountHash, prHash);
  const lido = await client.get(base, SHALLOW);
  if (!lido.ok) return { ok: false, removidos: 0, code: lido.code, motivo: lido.motivo };
  const limite = brasiliaDay(nowMs - SYNC.ROUNDS_TTL_MS);
  const velhos = Object.keys(ehObjeto(lido.data) ? lido.data : {}).filter((d) => DIA_RE.test(d) && d < limite);
  if (!velhos.length) return { ok: true, removidos: 0 };
  const r = await client.patch(base, Object.fromEntries(velhos.map((d) => [d, null])));
  if (!r.ok) return { ok: false, removidos: 0, code: r.code, motivo: r.motivo };
  return { ok: true, removidos: velhos.length };
}

export default { roundsPath, countStarted, countReservedVivas, reserveRound, startRound, pruneRounds };
export { roundsPath, countStarted, countReservedVivas, reserveRound, startRound, pruneRounds };
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('lib/sync/rounds.js')).digest('hex').slice(0,16))"
```

Esperado: `23f0b06a6657b34b`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

- [ ] **Passo 4: rodar e ver passar**

```bash
node --test --test-force-exit test/sync-rounds.test.js
```

Esperado: PASSA, 0 falhas.

- [ ] **Passo 5: gate e commit**

```bash
npm run check && npm run lint && npm test
```

Esperado: `fail 0` e `gate de qualidade: sem regressão`. Se algo falhar, PARE e relate; não mexa em outro arquivo para fazer passar.

```bash
git add lib/sync/rounds.js test/sync-rounds.test.js
git commit -m "feat(sync): teto de rodadas automáticas por PR e dia"
```


### Tarefa T12: Coordenador da admissão

É o cérebro da admissão, e a ordem dos passos é a feature: recibo antes de tudo, preflight do GitHub, lease, releitura do recibo SOB o lease, e só então o teto do dia. Ele NUNCA lança pelo motivo de coordenação: exceção cairia na taxonomia de falha e estacionaria o PR, e segurar não é falhar.

**Arquivos:**
- Modificar: `lib/engine/decision.js`
- Criar: `lib/sync/coordinator.js`

- [ ] **Passo 1: implementar**

Em `lib/engine/decision.js`, aplique as 3 substituições abaixo, NA ORDEM. Cada trecho "localize" aparece exatamente uma vez no arquivo no momento em que você aplica aquela substituição; copie-o sem mudar espaço nem acento.

1. Localize:

```js
// COMMENTED fica de fora porque comentar não decide nada (pergunta ao autor, recado de
// "vou olhar", comentário de outro assunto). Só o ramo do MESMO HEAD usa esta tabela: no
// ramo do horário, comentar DEPOIS que o card nasceu é atendimento e segue valendo.
const DECISIVE_REVIEW_STATES = new Set(['APPROVED', 'CHANGES_REQUESTED']);

// Pendências que já foram atendidas FORA do botão: o review saiu pelo chat do PR, pela
```

   Troque por:

```js
// COMMENTED fica de fora porque comentar não decide nada (pergunta ao autor, recado de
// "vou olhar", comentário de outro assunto). Só o ramo do MESMO HEAD usa esta tabela: no
// ramo do horário, comentar DEPOIS que o card nasceu é atendimento e segue valendo.
// Exportado porque o preflight da coordenação entre aparelhos (lib/sync/coordinator.js)
// faz a mesma pergunta ("já decidi sobre este head?") e não pode ter tabela própria.
const DECISIVE_REVIEW_STATES = new Set(['APPROVED', 'CHANGES_REQUESTED']);

// Pendências que já foram atendidas FORA do botão: o review saiu pelo chat do PR, pela
```

2. Localize:

```js
  postReview, postReviewFromSession, postedSignature, inlineFallbackPayload, decisionForUi,
  reviewCaps, createReviewPostCapability, revokeReviewPostCapability, revokeReviewPostCapabilitiesByOwner,
  writeMemory, removeTeamMember, decide,
  TERMINAL_SESSION_MAX_MS, MAX_POST_RETRY_ATTEMPTS,
};
export default decisionMod;
export {
```

   Troque por:

```js
  postReview, postReviewFromSession, postedSignature, inlineFallbackPayload, decisionForUi,
  reviewCaps, createReviewPostCapability, revokeReviewPostCapability, revokeReviewPostCapabilitiesByOwner,
  writeMemory, removeTeamMember, decide,
  TERMINAL_SESSION_MAX_MS, MAX_POST_RETRY_ATTEMPTS, DECISIVE_REVIEW_STATES,
};
export default decisionMod;
export {
```

3. Localize:

```js
  postReview, postReviewFromSession, postedSignature, inlineFallbackPayload, decisionForUi,
  reviewCaps, createReviewPostCapability, revokeReviewPostCapability, revokeReviewPostCapabilitiesByOwner,
  writeMemory, removeTeamMember, decide,
  TERMINAL_SESSION_MAX_MS, MAX_POST_RETRY_ATTEMPTS,
};
```

   Troque por:

```js
  postReview, postReviewFromSession, postedSignature, inlineFallbackPayload, decisionForUi,
  reviewCaps, createReviewPostCapability, revokeReviewPostCapability, revokeReviewPostCapabilitiesByOwner,
  writeMemory, removeTeamMember, decide,
  TERMINAL_SESSION_MAX_MS, MAX_POST_RETRY_ATTEMPTS, DECISIVE_REVIEW_STATES,
};
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('lib/engine/decision.js')).digest('hex').slice(0,16))"
```

Esperado: `62af4f219c14e098`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

Crie `lib/sync/coordinator.js` com EXATAMENTE este conteúdo:

```js
// Coordenador de análises entre os aparelhos da mesma pessoa: decide se ESTA análise
// (revisão, autoanálise ou pushback de um PR num head) pode rodar aqui agora. Recebe o
// engine como contexto e lê só o runtime montado por lib/engine/sync.js; quem chama é
// o gate de runClaudeStream (admit) e o clique manual (preflightManual).
//
// Ordem da admissão, e o porquê de cada passo: recibo antes de tudo (análise que já
// terminou em outro aparelho não pode ser paga de novo), preflight do GitHub (review
// meu neste head, feito à mão ou antes da sincronização existir), lease (quem está
// rodando AGORA), releitura do recibo SOB o lease (o outro aparelho pode ter terminado
// entre a primeira leitura e a aquisição) e, só no round automático, o teto do dia.
//
// Nunca lança pelo motivo de coordenação (D9 do contrato): recusa volta como
// { admitted: false, reason, detail }, porque exceção cairia na taxonomia de falha e
// estacionaria o PR, e segurar não é falhar.
import { APP_VERSION } from '../paths.js';
import { SYNC } from '../constants.js';
import { DECISIVE_REVIEW_STATES } from '../engine/decision.js';
import { coordinationActive } from './config.js';
import { SYNC_CODES, motivoDe } from './errors.js';
import { accountHash, prHash, operationFingerprint, brasiliaDay, novoId } from './keys.js';
import { leasePath, leaseAcquirable, acquireLease, renewLease, releaseLease } from './lease.js';
import { buildReceipt, receiptBlocks, receiptOrphanState, readReceipt, writeReceipt } from './receipts.js';
import { reserveRound, startRound } from './rounds.js';

const CONECTADO = 'conectado';
const MOTIVO_SEM_HEAD = 'head do PR desconhecido; a coordenação exige a versão material';
const MOTIVO_SEM_CHAVE = 'chave do PR fora do formato dono/repo#número; a coordenação exige a chave';
// accountHash('') devolve hash VÁLIDO. Sem esta recusa, o aparelho que não soubesse a
// conta dona do PR coordenaria num namespace só dele, e o outro, que sabe, em outro:
// os dois se dariam por sozinhos e analisariam o mesmo PR no mesmo head.
const MOTIVO_SEM_CONTA = 'conta dona do PR desconhecida; a coordenação exige a conta';
const MOTIVO_RODADA_PERDIDA = 'a reserva da rodada do dia se perdeu antes de a sessão começar';
const MOTIVO_LEASE_PERDIDO = 'lease perdido; recibo não gravado';
const MOTIVO_ENCERRADO = 'a coordenação desta sessão já foi encerrada';

function ehObjeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function recusa(reason, detail) {
  return { admitted: false, reason, detail };
}

function admitido(handle) {
  return { admitted: true, handle };
}

function logar(engine, nivel, msg) {
  if (typeof engine.log === 'function') engine.log(nivel, msg);
}

function motivoDoRuntime(rt) {
  return motivoDe((rt.lastError && rt.lastError.code) || SYNC_CODES.INDISPONIVEL);
}

function conectado(rt) {
  return !!rt && rt.status === CONECTADO && !!rt.client;
}

// O nome sai do snapshot de aparelhos que o tick lê; o próprio aparelho usa o nome da
// config, que pode ser mais novo que o snapshot. Sem nome, a tela diz "outro aparelho".
function nomeDoDispositivo(rt, deviceId) {
  if (!deviceId) return '';
  if (deviceId === rt.deviceId) return rt.deviceName || '';
  const d = rt.devices && rt.devices[deviceId];
  return (d && d.name) || '';
}

function noopHandle() {
  return { noop: true, leaseId: '', attemptId: '', lost: false, done: true, onLost() {}, complete: async () => ({ ok: true }), abort: async () => {} };
}

// Memória para a tela (recibosVistos) e, na revisão, o PR vira visto: sem isso o
// toReview o relançaria a cada ciclo só para ouvir a mesma recusa. No pushback quem
// avança o marcador é o chamador, que conhece o marcador.
function registrarRecibo(engine, ctx, receipt) {
  const rt = engine.sync;
  const r = ehObjeto(receipt) ? receipt : {};
  if (!rt.recibosVistos) rt.recibosVistos = {};
  const device = (rt.devices && rt.devices[r.deviceId]) || null;
  rt.recibosVistos[ctx.prKey] = {
    at: Number(r.completedAt) || 0, deviceId: r.deviceId || '', deviceName: nomeDoDispositivo(rt, r.deviceId),
    publicationState: r.publicationState || '', operationKind: r.operationKind || ctx.operationKind,
    orfao: receiptOrphanState(r, device, rt.agora()),
  };
  if (ctx.operationKind === 'review' && typeof engine.markSeen === 'function') engine.markSeen(ctx.prKey);
}

// Passos 3 a 5 do contrato: conexão, versão material e chaves. Nada aqui toca a rede.
function preparar(rt, ctx) {
  if (!conectado(rt)) return { recusa: recusa('indisponivel', { motivo: motivoDoRuntime(rt) }) };
  if (!ctx.materialVersion) return { recusa: recusa('indisponivel', { motivo: MOTIVO_SEM_HEAD }) };
  if (!String(ctx.account || '').trim()) return { recusa: recusa('indisponivel', { motivo: MOTIVO_SEM_CONTA }) };
  const ph = prHash(ctx.prKey);
  if (!ph) return { recusa: recusa('indisponivel', { motivo: MOTIVO_SEM_CHAVE }) };
  const ids = { uid: rt.uid, accountHash: accountHash(ctx.account), prHash: ph };
  return { ids, fingerprint: operationFingerprint(ctx.operationKind, ctx.materialVersion), nowMs: rt.agora() };
}

async function consultarRecibo(engine, ctx, pre) {
  const rt = engine.sync;
  const r = await readReceipt(rt.client, pre.ids, pre.fingerprint);
  if (!r.ok) return recusa('indisponivel', { motivo: r.motivo });
  if (!receiptBlocks(r.receipt, rt.agora())) return null;
  registrarRecibo(engine, ctx, r.receipt);
  return recusa('recibo', { receipt: r.receipt, deviceName: nomeDoDispositivo(rt, r.receipt.deviceId) });
}

// null quando não deu para consultar: falta de dado não bloqueia, o pior caso é uma
// análise redundante, nunca uma análise que deixou de acontecer
async function estadosNoHead(engine, ctx) {
  if (!ctx.pr || typeof engine.myReviewStates !== 'function') return null;
  try {
    return await engine.myReviewStates(ctx.pr, ctx.headSha);
  } catch {
    return null;
  }
}

// Review decisivo MEU neste head (postado à mão, por outro aparelho antes da
// sincronização, ou por um Farol que caiu antes de gravar o recibo) é desfecho: vira
// recibo externo, gravado best-effort (se outro aparelho gravou antes, o 412 não importa).
async function reviewExterno(engine, ctx, pre) {
  if (ctx.operationKind !== 'review') return null;
  const states = await estadosNoHead(engine, ctx);
  if (!Array.isArray(states) || !states.some((s) => DECISIVE_REVIEW_STATES.has(s))) return null;
  const rt = engine.sync;
  const recibo = buildReceipt({
    operationKind: 'review', materialVersion: ctx.materialVersion, deviceId: rt.deviceId, leaseId: '', nowMs: rt.agora(),
    outcome: 'external_review', publicationState: 'published', reviewId: '', farolVersion: APP_VERSION,
  });
  await writeReceipt(rt.client, pre.ids, pre.fingerprint, recibo, { ifMatch: 'null_etag' });
  registrarRecibo(engine, ctx, recibo);
  return recusa('recibo', { externo: true });
}

// O tipo da operação do dono vai junto porque o lease é por conta e PR, não por tipo: a
// revisão que ouve "alheio" só pode deixar a label de revisando no PR quando quem está com
// o lease é outra REVISÃO (mesma conta, mesmo nome de label). Lease de pushback ou de
// autoanálise não põe label nenhuma, e preservar a nossa nesse caso a deixaria presa.
function recusaDoLease(rt, a) {
  if (a.reason !== 'alheio') return recusa('indisponivel', { motivo: a.motivo || motivoDe(SYNC_CODES.INDISPONIVEL) });
  const l = ehObjeto(a.lease) ? a.lease : {};
  return recusa('alheio', { deviceId: l.deviceId || '', deviceName: nomeDoDispositivo(rt, l.deviceId), since: Number(l.acquiredAt) || 0, operationKind: String(l.operationKind || '') });
}

// best-effort: lease que não sai agora expira sozinho pelo TTL
async function soltarLease(client, ids, leaseId) {
  await releaseLease(client, ids, { leaseId });
}

async function reservarRodada(rt, pre, leaseId, nowMs) {
  const day = brasiliaDay(nowMs);
  const attemptId = novoId();
  const rr = await reserveRound(rt.client, pre.ids, day, { attemptId, fingerprint: pre.fingerprint, leaseId, nowMs });
  if (!rr.ok && rr.reason === 'esgotado') return { recusa: recusa('esgotado', { day, started: rr.started }) };
  if (!rr.ok) return { recusa: recusa('indisponivel', { motivo: rr.motivo }) };
  const st = await startRound(rt.client, pre.ids, day, { attemptId, leaseId, nowMs });
  if (!st.ok) return { recusa: recusa('indisponivel', { motivo: st.motivo || MOTIVO_RODADA_PERDIDA }) };
  return { attemptId };
}

// Passos 8 a 12: lease, releitura do recibo sob o lease, teto do dia e o handle. Toda
// recusa depois do lease adquirido o devolve antes de sair.
//
// O relógio é relido aqui, e não reaproveitado de preparar(): entre os dois cabem a
// leitura do recibo e o preflight do GitHub (gh com teto de 60s). Com o instante velho
// o lease nasceria perto de vencer (a primeira batida o acharia vencido e cancelaria
// uma sessão paga que acabou de subir) ou já vencido (as regras do banco recusariam o
// PUT e a admissão viraria um 'indisponivel' espúrio).
async function adquirirEAdmitir(engine, ctx, pre) {
  const rt = engine.sync;
  const leaseId = novoId();
  const agora = rt.agora();
  const dados = { leaseId, deviceId: rt.deviceId, operationKind: ctx.operationKind, headSha: ctx.headSha, nowMs: agora, farolVersion: APP_VERSION };
  const a = await acquireLease(rt.client, pre.ids, dados);
  if (!a.ok) return recusaDoLease(rt, a);
  return depoisDoLease(engine, ctx, pre, { leaseId, agora, expiresAt: a.lease.expiresAt });
}

// Daqui pra baixo o lease JÁ É NOSSO, e toda saída precisa devolvê-lo. Exceção
// inesperada (engine incompleto, defeito na releitura do recibo) sairia por cima do
// `await soltarLease` e deixaria o PR travado para os outros aparelhos até o TTL, com a
// sessão nem tendo começado. O catch solta e relança: quem classifica é o admit.
async function depoisDoLease(engine, ctx, pre, { leaseId, agora, expiresAt }) {
  const rt = engine.sync;
  try {
    const recibo = ctx.ignorarRecibo ? null : await consultarRecibo(engine, ctx, pre);
    const rodada = recibo || !ctx.contaRodada ? { attemptId: '' } : await reservarRodada(rt, pre, leaseId, agora);
    const barrado = recibo || rodada.recusa;
    if (barrado) {
      await soltarLease(rt.client, pre.ids, leaseId);
      return barrado;
    }
    return admitido(createHandle(engine, { ids: pre.ids, fingerprint: pre.fingerprint, leaseId, attemptId: rodada.attemptId, ctx, expiresAt }));
  } catch (err) {
    // best-effort: o lease que não sair agora expira sozinho pelo TTL
    try { await soltarLease(rt.client, pre.ids, leaseId); } catch { /* a falha de origem é a que importa */ }
    throw err;
  }
}

// Os dois overrides valem só no clique explícito: um caminho automático que carregasse
// a flag por engano pularia a coordenação em silêncio.
async function admitir(engine, ctx) {
  if (!coordinationActive(engine.config && engine.config.sync)) return admitido(noopHandle());
  if (ctx.manual && ctx.semCoordenacao) {
    logar(engine, 'INFO', `${ctx.prKey}: gate de coordenação contornado por decisão manual`);
    return admitido(noopHandle());
  }
  const ignorarRecibo = !!(ctx.manual && ctx.ignorarRecibo);
  const c = { ...ctx, ignorarRecibo };
  const pre = preparar(engine.sync, c);
  if (pre.recusa) return pre.recusa;
  const antes = ignorarRecibo ? null : (await consultarRecibo(engine, c, pre)) || (await reviewExterno(engine, c, pre));
  if (antes) return antes;
  return adquirirEAdmitir(engine, c, pre);
}

// Defeito inesperado (engine incompleto, bug) vira espera e não exceção: o chamador
// trataria exceção como falha da revisão e estacionaria o PR.
async function admit(engine, ctx) {
  try {
    return await admitir(engine, ctx || {});
  } catch (err) {
    return recusa('indisponivel', { motivo: `falha interna da coordenação: ${(err && err.message) || err}` });
  }
}

function pararTimer(estado) {
  if (estado.timer) clearInterval(estado.timer);
  estado.timer = null;
}

// callback de quem consome não pode impedir o cancelamento nem os outros callbacks
function avisarPerda(cb) {
  try { cb(); } catch { /* defeito do consumidor não segura o cancelamento da sessão */ }
}

function cancelarSessao(engine, opId) {
  if (!opId || typeof engine.cancelSession !== 'function') return;
  try { engine.cancelSession(opId); } catch { /* sessão que já terminou não tem o que cancelar */ }
}

function perder(engine, h, estado, dados) {
  h.lost = true;
  pararTimer(estado);
  for (const cb of estado.perdas) avisarPerda(cb);
  cancelarSessao(engine, dados.ctx.opId);
}

// Rede caída numa batida não prova que outro aparelho assumiu, e o TTL do lease (4
// batidas) cobre a oscilação. Mas com a queda persistindo nenhuma batida chega a ler o
// lease vencido: o banco o trata como livre a partir de expiresAt, outro aparelho o
// assume e as duas sessões rodariam o mesmo PR no mesmo head. Por isso a validade da
// última escrita que deu certo fica guardada aqui, e passada ela a sessão para sem
// precisar da rede (fail closed: o próprio aparelho sabe que a validade acabou).
function leaseVencido(r, estado, agora) {
  if (r.reason === 'perdido') return true;
  return r.reason === 'indisponivel' && agora >= estado.expiraEm;
}

async function batimento(engine, h, estado, dados) {
  if (estado.emVoo || estado.encerrando || h.done) return;
  estado.emVoo = true;
  try {
    const nowMs = engine.sync.agora();
    const r = await renewLease(dados.client, dados.ids, { leaseId: dados.leaseId, nowMs });
    if (r.ok) estado.expiraEm = nowMs + SYNC.LEASE_TTL_MS;
    else if (!estado.encerrando && !h.done && leaseVencido(r, estado, engine.sync.agora())) perder(engine, h, estado, dados);
  } finally {
    estado.emVoo = false;
  }
}

function recenteDemais(atual, nowMs) {
  return ehObjeto(atual) && Number(atual.completedAt) > nowMs - SYNC.LEASE_TTL_MS;
}

function falhaDe(r) {
  return { ok: false, code: r.code, motivo: r.motivo || motivoDe(r.code) };
}

// 412 quer dizer que já existe recibo deste head: se ele acabou de ser gravado (dentro
// de um TTL de lease), é um sucessor que assumiu e terminou, e o dele fica; se é antigo
// (refazer confirmado, recibo órfão), o desta sessão o substitui, condicionado ao etag.
async function gravarRecibo(dados, recibo, nowMs) {
  const w = await writeReceipt(dados.client, dados.ids, dados.fingerprint, recibo, { ifMatch: 'null_etag' });
  if (w.ok) return { ok: true };
  if (w.code !== SYNC_CODES.CONFLITO) return falhaDe(w);
  const lido = await readReceipt(dados.client, dados.ids, dados.fingerprint);
  if (!lido.ok) return falhaDe(lido);
  if (recenteDemais(lido.receipt, nowMs)) return { ok: true };
  const w2 = await writeReceipt(dados.client, dados.ids, dados.fingerprint, recibo, { ifMatch: lido.etag });
  return w2.ok ? { ok: true } : falhaDe(w2);
}

async function concluir(engine, h, estado, dados, { outcome = 'completed', publicationState, reviewId = '' } = {}) {
  if (h.done) return { ok: false, code: SYNC_CODES.FALHA_INTERNA, motivo: MOTIVO_ENCERRADO };
  estado.encerrando = true;
  pararTimer(estado);
  h.done = true;
  if (h.lost) return { ok: false, code: SYNC_CODES.CONFLITO, motivo: MOTIVO_LEASE_PERDIDO };
  const nowMs = engine.sync.agora();
  const recibo = buildReceipt({
    operationKind: dados.ctx.operationKind, materialVersion: dados.ctx.materialVersion, deviceId: dados.deviceId,
    leaseId: dados.leaseId, nowMs, outcome, publicationState, reviewId, farolVersion: APP_VERSION,
  });
  const gravado = await gravarRecibo(dados, recibo, nowMs);
  await soltarLease(dados.client, dados.ids, dados.leaseId);
  return gravado;
}

async function abortar(h, estado, dados) {
  if (h.done) return;
  estado.encerrando = true;
  pararTimer(estado);
  h.done = true;
  await soltarLease(dados.client, dados.ids, dados.leaseId);
}

function registrarPerda(h, estado, cb) {
  if (typeof cb !== 'function') return;
  if (h.lost) avisarPerda(cb);
  else estado.perdas.push(cb);
}

// Sem a validade da aquisição (chamador antigo), vale a de um lease pego agora: o
// handle nasce logo depois do acquireLease.
function validadeInicial(rt, expiresAt) {
  return Number.isFinite(expiresAt) ? expiresAt : rt.agora() + SYNC.LEASE_TTL_MS;
}

// Cliente e aparelho ficam presos à admissão: se o runtime reconectar no meio da
// sessão, o recibo e a liberação continuam falando do lease que ESTA sessão pegou.
function createHandle(engine, { ids, fingerprint, leaseId, attemptId, ctx, expiresAt }) {
  const rt = engine.sync;
  const dados = { ids, fingerprint, leaseId, ctx, client: rt.client, deviceId: rt.deviceId };
  const estado = { timer: null, emVoo: false, encerrando: false, perdas: [], expiraEm: validadeInicial(rt, expiresAt) };
  const h = { noop: false, leaseId, attemptId: attemptId || '', lost: false, done: false };
  h.onLost = (cb) => registrarPerda(h, estado, cb);
  h.complete = (opcoes) => concluir(engine, h, estado, dados, opcoes);
  h.abort = () => abortar(h, estado, dados);
  // o batimento nunca rejeita (os clientes do banco devolvem { ok }), e o catch fica
  // só como rede contra rejeição solta derrubar o processo pelo timer
  const bater = () => { batimento(engine, h, estado, dados).catch(() => undefined); };
  estado.timer = setInterval(bater, SYNC.HEARTBEAT_MS);
  if (estado.timer && typeof estado.timer.unref === 'function') estado.timer.unref();
  return h;
}

function bloqueio(r) {
  return { ok: false, reason: r.reason, detail: r.detail };
}

async function headDoPr(engine, pr) {
  if (typeof engine.headSha !== 'function') return '';
  try {
    return String((await engine.headSha(pr)) || '');
  } catch {
    return '';
  }
}

function contaDoPr(engine, pr) {
  if (pr.account) return pr.account;
  return typeof engine.accountForPr === 'function' ? engine.accountForPr(pr) : '';
}

// Só leitura: nunca reserva, nunca adquire e nunca escreve (nem o seen local). O gate
// no spawn roda de novo depois do clique e é ele quem decide de fato.
async function verificarManual(engine, pr) {
  if (!coordinationActive(engine.config && engine.config.sync)) return { ok: true };
  const rt = engine.sync;
  if (!conectado(rt)) return bloqueio(recusa('indisponivel', { motivo: motivoDoRuntime(rt) }));
  const ctx = { prKey: pr.key, account: contaDoPr(engine, pr), materialVersion: await headDoPr(engine, pr), operationKind: 'review' };
  const pre = preparar(rt, ctx);
  if (pre.recusa) return bloqueio(pre.recusa);
  const r = await readReceipt(rt.client, pre.ids, pre.fingerprint);
  if (!r.ok) return bloqueio(recusa('indisponivel', { motivo: r.motivo }));
  if (receiptBlocks(r.receipt, pre.nowMs)) return bloqueio(recusa('recibo', { receipt: r.receipt, deviceName: nomeDoDispositivo(rt, r.receipt.deviceId) }));
  const l = await rt.client.get(leasePath(pre.ids.uid, pre.ids.accountHash, pre.ids.prHash));
  if (!l.ok) return bloqueio(recusa('indisponivel', { motivo: l.motivo }));
  if (alheioDeVerdade(rt, l.data, pre.nowMs)) return bloqueio(recusaDoLease(rt, { reason: 'alheio', lease: l.data }));
  return { ok: true };
}

// Lease vivo DESTE aparelho (uma revisão automática ou um pushback em andamento aqui)
// não é bloqueio do clique: quem evita a análise em dobro local é a deduplicação do
// enqueueHeadless. Sem esta distinção o preflight nomeava o próprio aparelho como
// "outro" e a tela mandava esperar por si mesmo.
function alheioDeVerdade(rt, lease, nowMs) {
  if (leaseAcquirable(lease, { leaseId: '', nowMs }) !== 'alheio') return false;
  return !(ehObjeto(lease) && lease.deviceId && lease.deviceId === rt.deviceId);
}

async function preflightManual(engine, pr) {
  try {
    return await verificarManual(engine, pr || {});
  } catch (err) {
    return bloqueio(recusa('indisponivel', { motivo: `falha interna da coordenação: ${(err && err.message) || err}` }));
  }
}

export default { admit, createHandle, noopHandle, preflightManual, registrarRecibo };
export { admit, createHandle, noopHandle, preflightManual, registrarRecibo };
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('lib/sync/coordinator.js')).digest('hex').slice(0,16))"
```

Esperado: `f2ed3050e0bf94ca`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

- [ ] **Passo 2: gate e commit**

```bash
npm run check && npm run lint && npm test
```

Esperado: `fail 0` e `gate de qualidade: sem regressão`. Se algo falhar, PARE e relate; não mexa em outro arquivo para fazer passar.

```bash
git add lib/engine/decision.js lib/sync/coordinator.js
git commit -m "feat(sync): coordenador decide se esta análise pode rodar aqui"
```


### Tarefa T13: Outbox do consumo

A fila do consumo é idempotente por construção: o id do evento sai dos campos imutáveis da sessão, então reenviar nunca conta o mesmo dinheiro duas vezes. O cursor é amarrado ao DESTINO, senão trocar de conta do Firebase deixaria todo o histórico na conta antiga.

**Arquivos:**
- Criar: `lib/sync/outbox.js`

- [ ] **Passo 1: implementar**

Crie `lib/sync/outbox.js` com EXATAMENTE este conteúdo:

```js
// Outbox do consumo que sobe para o banco da sincronização entre dispositivos. Mora em
// state/sync-outbox.json e é só fila: a fonte de verdade do consumo continua sendo o
// usage-sessions.json local. Folha de IO simples: não conhece o engine.
//
// Idempotência é por construção, não por memória: cada sessão vira um evento com id
// derivado dos campos IMUTÁVEIS dela (eventIdFor), gravado por PATCH no mesmo nó
// remoto. Reenviar (migração repetida, correção de desfecho, resposta perdida) cai no
// mesmo lugar e nunca conta o mesmo dinheiro duas vezes.
import path from 'node:path';
import { STATE_DIR } from '../paths.js';
import { SYNC } from '../constants.js';
import io from '../io.js';
import { SYNC_CODES } from './errors.js';
import { accountHash, prHash, eventIdFor, brasiliaDay } from './keys.js';

const ARQUIVO = path.join(STATE_DIR, SYNC.OUTBOX_FILE);
const EVENT_ID_RE = /^[0-9a-f]{64}$/;
// Só a recusa do PRÓPRIO evento conta tentativa, e quem diz isso é o status HTTP, não
// o código: o codeFromStatus junta em `resposta_invalida` tudo que não é 401/404/412/5xx
// (408, 429, 403, 407) e ainda o 200 com corpo que não é JSON (portal cativo, proxy).
// Rede, rate limit, proxy e token vencido dizem respeito à conexão: contá-los jogaria
// evento bom em rejeitados durante a queda, e o dinheiro sumiria do consolidado. 400 é
// o banco recusando o corpo; 413 é corpo grande demais, e num lote a contagem é o que
// liga o envio de um em um (loteDe): o evento bom sai sozinho no envio seguinte, com
// uma tentativa só, e só quem é grande sozinho chega ao teto.
const STATUS_DE_RECUSA = new Set([400, 413]);

function outboxPath() { return ARQUIVO; }

function defaultOutbox() {
  return { destino: '', cursorAt: 0, pending: [], enviados: 0, rejeitados: 0, lastSentAt: 0, paused: false };
}

function numero(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function objeto(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

function entradaValida(e) {
  return objeto(e) && EVENT_ID_RE.test(String(e.eventId || '')) && objeto(e.payload);
}

// arquivo editado à mão ou de versão futura vale pelo que tiver de reconhecível
function normalizar(bruto) {
  const base = defaultOutbox();
  if (!objeto(bruto)) return base;
  const pending = Array.isArray(bruto.pending) ? bruto.pending.filter(entradaValida) : [];
  return {
    destino: typeof bruto.destino === 'string' ? bruto.destino : '',
    cursorAt: numero(bruto.cursorAt),
    pending: pending.map((e) => ({ eventId: e.eventId, payload: e.payload, tentativas: numero(e.tentativas) })),
    enviados: numero(bruto.enviados), rejeitados: numero(bruto.rejeitados),
    lastSentAt: numero(bruto.lastSentAt), paused: bruto.paused === true,
  };
}

function readOutbox() { return normalizar(io.readJson(ARQUIVO, null)); }

function saveOutbox(outbox) {
  try {
    io.ensureDir(path.dirname(ARQUIVO));
    io.writeJsonAtomic(ARQUIVO, outbox);
    return true;
  } catch {
    // disco cheio ou sem permissão: a reconciliação pelo cursor refaz depois
    return false;
  }
}

function texto(v) { return typeof v === 'string' ? v : ''; }

// O dia vai no fuso canônico (D7): aparelhos em fusos diferentes precisam cortar a
// janela do consolidado no mesmo lugar. A versão é a que GRAVOU a sessão; a do app que
// enfileira só vale para registro antigo sem o campo. Tipo e custo saem sempre
// preenchidos porque as regras do banco exigem os dois, e um evento recusado pelas
// regras volta como "Permission denied", que parece token vencido e travaria a fila.
function payloadFor(sessao, deviceId, farolVersion) {
  const s = sessao || {};
  return {
    at: numero(s.at), day: brasiliaDay(numero(s.at)), kind: texto(s.kind) || 'outro',
    accountHash: accountHash(s.account), refHash: prHash(s.ref) || '',
    model: texto(s.model), profileId: texto(s.profileId),
    inputTokens: numero(s.inputTokens), outputTokens: numero(s.outputTokens),
    cacheReadTokens: numero(s.cacheReadTokens), cacheCreationTokens: numero(s.cacheCreationTokens),
    costUsd: numero(s.costUsd), costSource: texto(s.costSource) || 'medido', status: texto(s.status) || 'ok',
    farolVersion: texto(s.farol) || texto(farolVersion), localId: texto(s.id),
  };
}

// A entrada é SUBSTITUÍDA por um objeto novo, nunca mutada: o envio em voo remove o
// que mandou por identidade, então a correção que chega no meio dele fica na fila.
function enqueueSession(outbox, sessao, deviceId, farolVersion) {
  if (!objeto(sessao) || !numero(sessao.at) || !deviceId) return false;
  const eventId = eventIdFor(sessao, deviceId);
  const entrada = { eventId, payload: payloadFor(sessao, deviceId, farolVersion), tentativas: 0 };
  const i = outbox.pending.findIndex((e) => e.eventId === eventId);
  if (i >= 0) outbox.pending[i] = entrada;
  else outbox.pending.push(entrada);
  outbox.cursorAt = Math.max(outbox.cursorAt, numero(sessao.at));
  return true;
}

// O cursor é o que recupera a sessão gravada no disco e perdida no caminho pra cá
// (processo morto entre um e outro): tudo depois dele entra de novo.
function reconcileFromSessions(outbox, sessions, deviceId, farolVersion) {
  const corte = outbox.cursorAt;
  const novas = (Array.isArray(sessions) ? sessions : []).filter((s) => objeto(s) && numero(s.at) > corte);
  let n = 0;
  for (const s of novas) if (enqueueSession(outbox, s, deviceId, farolVersion)) n++;
  return n;
}

// Evento que já tomou recusa sai SOZINHO: o PATCH é tudo ou nada, e um evento ruim no
// meio de um lote de 50 contaria tentativa para os 49 bons até rejeitar todos.
function loteDe(pending, batch) {
  if (pending.length && pending[0].tentativas > 0) return pending.slice(0, 1);
  return pending.slice(0, Math.max(1, batch));
}

function contarRejeicao(outbox, lote) {
  for (const e of lote) e.tentativas += 1;
  const fora = lote.filter((e) => e.tentativas >= SYNC.OUTBOX_MAX_REJEICOES);
  outbox.pending = outbox.pending.filter((e) => !fora.includes(e));
  outbox.rejeitados += fora.length;
}

async function flushOutbox(client, uid, deviceId, outbox, { batch = SYNC.OUTBOX_BATCH } = {}) {
  const lote = loteDe(outbox.pending, batch);
  if (!lote.length) return { ok: true, enviados: 0, restantes: 0 };
  const corpo = Object.fromEntries(lote.map((e) => [e.eventId, e.payload]));
  const r = await client.patch(`/users/${uid}/usageEvents/${deviceId}`, corpo);
  if (r && r.ok) {
    outbox.pending = outbox.pending.filter((e) => !lote.includes(e));
    outbox.enviados += lote.length;
    outbox.lastSentAt = Date.now();
    outbox.paused = false;
    return { ok: true, enviados: lote.length, restantes: outbox.pending.length };
  }
  const code = (r && r.code) || SYNC_CODES.FALHA_INTERNA;
  if (STATUS_DE_RECUSA.has(Number(r && r.status))) contarRejeicao(outbox, lote);
  else outbox.paused = true;
  return { ok: false, enviados: 0, restantes: outbox.pending.length, code, motivo: (r && r.motivo) || '' };
}

// Identidade do DESTINO: a conta do Firebase mais o banco. Sem a URL normalizada, a
// mesma barra a mais no fim passaria por destino novo e refaria a migração inteira.
function outboxTarget(uid, databaseUrl) {
  const u = String(uid || '').trim();
  if (!u) return '';
  return `${u}|${String(databaseUrl || '').trim().replace(/\/+$/, '')}`;
}

// O cursor quer dizer "tudo até aqui já subiu", e isso só vale PARA UM DESTINO. Trocar
// de conta do Firebase ou de banco sem zerá-lo deixaria todo o histórico que foi para o
// destino ANTIGO sem nunca chegar ao novo, e o consolidado lá nasceria pela metade.
// Reenviar é seguro: o eventId vem dos campos imutáveis da sessão, então o destino novo
// recebe cada evento uma vez só, por mais que ele suba de novo.
function retargetOutbox(outbox, destino) {
  if (!destino || outbox.destino === destino) return false;
  outbox.destino = destino;
  outbox.cursorAt = 0;
  return true;
}

function resetForFullSync(outbox) {
  outbox.cursorAt = 0;
  return outbox;
}

export default {
  outboxPath, defaultOutbox, readOutbox, saveOutbox, payloadFor, enqueueSession,
  reconcileFromSessions, flushOutbox, resetForFullSync, outboxTarget, retargetOutbox,
};
export {
  outboxPath, defaultOutbox, readOutbox, saveOutbox, payloadFor, enqueueSession,
  reconcileFromSessions, flushOutbox, resetForFullSync, outboxTarget, retargetOutbox,
};
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('lib/sync/outbox.js')).digest('hex').slice(0,16))"
```

Esperado: `fc6c68b4abeb858b`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

- [ ] **Passo 2: gate e commit**

```bash
npm run check && npm run lint && npm test
```

Esperado: `fail 0` e `gate de qualidade: sem regressão`. Se algo falhar, PARE e relate; não mexa em outro arquivo para fazer passar.

```bash
git add lib/sync/outbox.js
git commit -m "feat(sync): fila idempotente do consumo, amarrada ao destino"
```


### Tarefa T14: Resumo consolidado do consumo

Soma o consumo de todos os aparelhos numa janela de dias civis. Aparelho sem evento na janela aparece ZERADO, de propósito: a tabela diz quem existe, não só quem gastou.

**Arquivos:**
- Criar: `lib/sync/consolidated.js`

- [ ] **Passo 1: implementar**

Crie `lib/sync/consolidated.js` com EXATAMENTE este conteúdo:

```js
// Projeção do consumo de TODOS os aparelhos a partir dos eventos que cada um subiu
// (usageEvents/{deviceId}/{eventId}). Puro: sem estado, sem IO, sem rede. Quem lê o
// banco é lib/engine/sync-usage.js, e ele só lê a árvore do próprio uid.
//
// A janela corta pelo dia canônico de Brasília (D7), recalculado do `at` de cada
// evento: aparelhos em fusos diferentes gravariam dias locais diferentes para o mesmo
// instante, e a soma de "últimos 7 dias" mudaria conforme o aparelho que a pede.
import { TEMPOS } from '../constants.js';
import { brasiliaDay } from './keys.js';

const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;
const TOKENS = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheCreationTokens'];
// mesma régua da aba Consumo (auditoriaDeConsumo): evento sem origem conta como medido
const ORIGENS = { estimado: 'estimado', 'sem-base': 'semBase' };

function objeto(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : null; }

function numero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function diaDe(p) {
  const at = numero(p.at);
  if (at > 0) return brasiliaDay(at);
  return typeof p.day === 'string' && DIA_RE.test(p.day) ? p.day : '';
}

// days 0 (ou inválido) é tudo. O corte é inclusivo e conta HOJE como o primeiro dos n,
// por isso recua n - 1 dias: é a janela da aba Consumo local (usageDayKeysBack), e
// recuar n somaria um dia civil a mais que ela para a mesma escolha na tela.
function corteDe(days, agoraMs) {
  const d = numero(days);
  return d > 0 ? brasiliaDay(numero(agoraMs) - (d - 1) * TEMPOS.DIA_MS) : '';
}

function zero() { return { sessions: 0, costUsd: 0 }; }

function linhaVazia(deviceId, aparelhos, euDeviceId) {
  const d = objeto(aparelhos[deviceId]) || {};
  const linha = { deviceId, name: typeof d.name === 'string' ? d.name : '', euMesmo: deviceId === euDeviceId, sessions: 0, costUsd: 0 };
  for (const t of TOKENS) linha[t] = 0;
  linha.lastAt = 0;
  return linha;
}

function somarNaLinha(linha, p) {
  linha.sessions += 1;
  linha.costUsd += numero(p.costUsd);
  for (const t of TOKENS) linha[t] += numero(p[t]);
  linha.lastAt = Math.max(linha.lastAt, numero(p.at));
}

function somarNoDia(porDia, dia, p) {
  const s = porDia.get(dia) || { day: dia, costUsd: 0, sessions: 0 };
  s.costUsd += numero(p.costUsd);
  s.sessions += 1;
  porDia.set(dia, s);
}

function somarNoTotal(totals, p) {
  const custo = numero(p.costUsd);
  const origem = totals[ORIGENS[p.costSource] || 'medido'];
  totals.sessions += 1;
  totals.costUsd += custo;
  origem.sessions += 1;
  origem.costUsd += custo;
}

function contar(acc, linha, evento) {
  const p = objeto(evento);
  if (!p) return;
  const dia = diaDe(p);
  if (!dia || (acc.corte && dia < acc.corte)) return;
  somarNaLinha(linha, p);
  somarNoDia(acc.porDia, dia, p);
  somarNoTotal(acc.totals, p);
}

// o próprio aparelho primeiro (é a linha que a pessoa procura), depois quem gastou mais
function ordemDosAparelhos(a, b) {
  if (a.euMesmo !== b.euMesmo) return a.euMesmo ? -1 : 1;
  return b.costUsd - a.costUsd || a.name.localeCompare(b.name) || a.deviceId.localeCompare(b.deviceId);
}

function consolidatedSummary(usageEvents, devices, { days = 0, agoraMs = Date.now(), euDeviceId = '' } = {}) {
  const eventos = objeto(usageEvents) || {};
  const aparelhos = objeto(devices) || {};
  const acc = { corte: corteDe(days, agoraMs), porDia: new Map(), totals: { sessions: 0, costUsd: 0, medido: zero(), estimado: zero(), semBase: zero() } };
  const linhas = new Map();
  // aparelho sem evento na janela aparece zerado: a tabela diz quem existe, não só quem gastou
  for (const id of new Set([...Object.keys(aparelhos), ...Object.keys(eventos)])) linhas.set(id, linhaVazia(id, aparelhos, euDeviceId));
  for (const [deviceId, doAparelho] of Object.entries(eventos)) {
    for (const evento of Object.values(objeto(doAparelho) || {})) contar(acc, linhas.get(deviceId), evento);
  }
  const series = [...acc.porDia.values()].sort((a, b) => a.day.localeCompare(b.day));
  return { devices: [...linhas.values()].sort(ordemDosAparelhos), series, totals: acc.totals };
}

export default { consolidatedSummary };
export { consolidatedSummary };
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('lib/sync/consolidated.js')).digest('hex').slice(0,16))"
```

Esperado: `2feb0bbdc49a055c`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

- [ ] **Passo 2: gate e commit**

```bash
npm run check && npm run lint && npm test
```

Esperado: `fail 0` e `gate de qualidade: sem regressão`. Se algo falhar, PARE e relate; não mexa em outro arquivo para fazer passar.

```bash
git add lib/sync/consolidated.js
git commit -m "feat(sync): resumo do consumo somando todos os aparelhos"
```


### Tarefa T15: Runtime da sincronização, em cinco módulos

As cinco peças do runtime. Elas saíram de um módulo só por teto de linhas E por ciclo de vida próprio: o consumo nunca decide nada, o stream abre e fecha com a coordenação, a faxina é manutenção, e o refazer é o caminho que APAGA a prova de uma análise. Entram juntas porque o sync.js importa as outras quatro; ainda ninguém as chama, então o gate segue verde.

**Arquivos:**
- Criar: `lib/engine/sync-faxina.js`
- Criar: `lib/engine/sync-redo.js`
- Criar: `lib/engine/sync-stream.js`
- Criar: `lib/engine/sync-usage.js`
- Criar: `lib/engine/sync.js`

- [ ] **Passo 1: implementar**

Crie `lib/engine/sync-faxina.js` com EXATAMENTE este conteúdo:

```js
// Retenção do banco da coordenação (D17 do contrato): uma faxina por dia, no syncTick,
// que poda os dias de dailyRounds mais velhos que ROUNDS_TTL_MS e apaga o recibo cujo
// expiresAt já passou. Separada de lib/engine/sync.js pelo teto de linhas e porque é
// manutenção: nunca decide admissão nem o estado da conexão.
//
// Lease e presença não entram: o lease vence sozinho pelo TTL (o próximo admit o toma)
// e a presença é um nó por aparelho, sobrescrito a cada tick.
//
// O tick é aguardado no fim do check(), e quem usa há meses acumula centenas de PRs com
// recibo. Por isso cada faxina visita no máximo FAXINA_MAX_PRS nós de PR, numa fatia que
// gira com o dia (fatiaDoDia): em poucos dias tudo passa, sem cursor gravado em disco.
import { SYNC, TEMPOS } from '../constants.js';
import { coordinationActive } from '../sync/config.js';
import { accountHash } from '../sync/keys.js';
import { pruneRounds } from '../sync/rounds.js';
import { receiptsPath, readReceipt, invalidateReceipt } from '../sync/receipts.js';

const CONECTADO = 'conectado';
const SHALLOW = { shallow: true };

function ehObjeto(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

// Lista pequena vai inteira. Na grande, o dia escolhe onde a janela começa e ela dá a
// volta no fim: dias seguidos cobrem fatias vizinhas, e ceil(n / max) dias cobrem todas.
function fatiaDoDia(lista, diaN, max) {
  if (lista.length <= max) return lista.slice();
  const inicio = (diaN * max) % lista.length;
  return Array.from({ length: max }, (_, i) => lista[(inicio + i) % lista.length]);
}

// Conta repetida (ou com caixa diferente) vira o mesmo hash: faxinar duas vezes o mesmo
// nó só gastaria requisição.
function contasDe(engine) {
  const lista = typeof engine.accountList === 'function' ? engine.accountList() : [];
  const hashes = lista.map((a) => String((a && a.user) || '').trim()).filter(Boolean).map(accountHash);
  return [...new Set(hashes)];
}

function podeFaxinar(engine, agora) {
  const rt = engine.sync;
  if (!rt || !coordinationActive((engine.config && engine.config.sync) || {})) return false;
  if (rt.status !== CONECTADO || !rt.client || !rt.uid) return false;
  return agora - (Number(rt.lastFaxinaAt) || 0) >= SYNC.FAXINA_MS;
}

async function chavesDe(client, path) {
  const r = await client.get(path, SHALLOW);
  if (!r.ok) return { erro: r };
  return { chaves: Object.keys(ehObjeto(r.data) ? r.data : {}).sort() };
}

// Os nós de PR a visitar, nas duas árvores e em todas as contas. Listagem que falha
// cancela a faxina inteira: sem saber o que existe, qualquer fatia seria arbitrária.
async function tarefas(client, uid, contas) {
  const lista = [];
  for (const acct of contas) {
    const rodadas = await chavesDe(client, `/users/${uid}/dailyRounds/${acct}`);
    if (rodadas.erro) return rodadas;
    const recibos = await chavesDe(client, `/users/${uid}/receipts/${acct}`);
    if (recibos.erro) return recibos;
    for (const ph of rodadas.chaves) lista.push({ tipo: 'rodadas', acct, ph });
    for (const ph of recibos.chaves) lista.push({ tipo: 'recibos', acct, ph });
  }
  return { lista };
}

// Sem expiresAt numérico o recibo fica: falta de dado nunca apaga a prova de que uma
// análise já foi feita, porque apagá-la faria outro aparelho pagar a mesma análise.
function vencido(recibo, nowMs) {
  return ehObjeto(recibo) && typeof recibo.expiresAt === 'number' && recibo.expiresAt <= nowMs;
}

// Relê com etag antes de apagar: o recibo pode ter sido regravado ("refazer neste
// aparelho") entre a listagem e aqui, e só o nó que o etag prova vencido sai.
async function apagarSeVencido(client, ids, fp, nowMs) {
  const r = await readReceipt(client, ids, fp);
  if (!r.ok || !vencido(r.receipt, nowMs)) return 0;
  const d = await invalidateReceipt(client, ids, fp, { ifMatch: r.etag });
  return d.ok ? 1 : 0;
}

async function faxinarRecibos(client, ids, nowMs) {
  const lido = await client.get(receiptsPath(ids.uid, ids.accountHash, ids.prHash));
  if (!lido.ok) return 0;
  const alvos = Object.entries(ehObjeto(lido.data) ? lido.data : {}).filter(([, rec]) => vencido(rec, nowMs));
  let removidos = 0;
  for (const [fp] of alvos) removidos += await apagarSeVencido(client, ids, fp, nowMs);
  return removidos;
}

async function executar(client, uid, t, nowMs, saldo) {
  if (t.tipo === 'rodadas') {
    const r = await pruneRounds(client, uid, t.acct, t.ph, { nowMs });
    saldo.rodadas += r.removidos || 0;
    return;
  }
  saldo.recibos += await faxinarRecibos(client, { uid, accountHash: t.acct, prHash: t.ph }, nowMs);
}

// A tentativa conta para a janela do dia mesmo quando falha: retenção não é urgente
// (recibo vence em 180 dias, rodada em 8) e tentar de novo a cada tick só gastaria rede
// contra um banco que acabou de recusar. Falha de nó isolado não para a faxina; o nó
// fica para o próximo dia.
async function faxinar(engine) {
  const rt = engine.sync;
  const agora = rt && typeof rt.agora === 'function' ? rt.agora() : Date.now();
  if (!podeFaxinar(engine, agora)) return { ok: true, feita: false };
  rt.lastFaxinaAt = agora;
  const { client, uid } = rt;
  const t = await tarefas(client, uid, contasDe(engine));
  if (t.erro) return { ok: false, feita: true, code: t.erro.code, motivo: t.erro.motivo };
  const fatia = fatiaDoDia(t.lista, Math.floor(agora / TEMPOS.DIA_MS), SYNC.FAXINA_MAX_PRS);
  const saldo = { ok: true, feita: true, prs: fatia.length, rodadas: 0, recibos: 0 };
  for (const tarefa of fatia) {
    // a conexão foi trocada (logout, outra conta) no meio: o resto fica para amanhã
    if (rt.client !== client) break;
    await executar(client, uid, tarefa, agora, saldo);
  }
  return saldo;
}

export default { fatiaDoDia, faxinar };
export { fatiaDoDia, faxinar };
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('lib/engine/sync-faxina.js')).digest('hex').slice(0,16))"
```

Esperado: `84a5260572ce6ee0`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

Crie `lib/engine/sync-redo.js` com EXATAMENTE este conteúdo:

```js
// "Refazer neste aparelho": o botão do recibo ÓRFÃO na tela. Separado de
// lib/engine/sync.js pelo teto de linhas úteis, e porque é um fluxo fechado com regra
// própria: ele APAGA a prova de que uma análise foi feita, e por isso é o caminho mais
// perigoso do recurso inteiro. Duas travas guardam esse apagamento (ver recusaDoRefazer
// e bloqueioAlemDoRecibo); nenhuma delas pode ser contornada pela tela.
import { SYNC_CODES, motivoDe, falhaSemConexao } from '../sync/errors.js';
import { accountHash, prHash, operationFingerprint } from '../sync/keys.js';
import { readReceipt, invalidateReceipt, receiptOrphanState } from '../sync/receipts.js';
import { coordinationActive } from '../sync/config.js';

const CONECTADO = 'conectado';

function falhaSem(code, motivo) { return { ok: false, code, motivo: motivo || motivoDe(code) }; }

// "Refazer neste aparelho" (recibo órfão na tela)
const CHAVE_PR = /^([^/#\s]+\/[^/#\s]+)#(\d+)$/;
const REFAZER = Object.freeze({ ignorarRecibo: true });
const MOTIVO_SEM_HEAD = 'head do PR desconhecido; refazer exige saber de qual commit é o recibo';
const MOTIVO_CHAVE = 'chave do PR fora do formato dono/repo#número';
// Só o recibo ÓRFÃO pode ser refeito. "Refazer" existe para destravar a análise que
// ficou pela metade num aparelho que sumiu, não para apagar a prova de uma análise que
// terminou: apagada, a mesma análise é paga de novo em todo aparelho que a encontrar.
const PUBLICACAO_REFAZIVEL = new Set(['pending', 'failed']);
const MOTIVO_RECIBO_AUSENTE = 'não há recibo deste commit para refazer';
const MOTIVO_RECIBO_PUBLICADO = 'a análise deste commit terminou e foi publicada; refazer apagaria a prova dela';
const MOTIVO_RECIBO_ATIVO = 'o aparelho que fez esta análise continua ativo; espere ou use Revisar de novo este commit';

// o PR que a tela está vendo (fila ou panorama) carrega a conta dona; sem ele, a chave
// basta pra montar o PR como uma URL avulsa colada no Revisar
function prDaChave(engine, key) {
  const lista = [...(engine.queue || []), ...(engine.panorama || [])];
  const visto = lista.find((p) => p && p.key === key);
  if (visto) return visto;
  const m = CHAVE_PR.exec(key);
  return m ? engine.prFromUrl(`https://github.com/${m[1]}/pull/${m[2]}`) : null;
}

async function headDoPr(engine, pr) {
  try { return String((await engine.headSha(pr)) || ''); } catch { return ''; }
}

function resultadoDoRelancamento(r) {
  if (r && r.ok) return { ok: true };
  const code = r && r.coordenacao ? SYNC_CODES.CONFLITO : SYNC_CODES.FALHA_INTERNA;
  return falhaSem(code, String((r && r.error) || ''));
}

// O recibo só é refazível quando a análise dele ficou pela metade (publicação pendente
// ou falha) E o aparelho que a fez está parado há tempo (receiptOrphanState). Qualquer
// outro caso é recusa com motivo, nunca apagamento silencioso.
function recusaDoRefazer(rt, receipt) {
  if (!receipt) return falhaSem(SYNC_CODES.NAO_ENCONTRADO, MOTIVO_RECIBO_AUSENTE);
  if (!PUBLICACAO_REFAZIVEL.has(receipt.publicationState)) return falhaSem(SYNC_CODES.CONFLITO, MOTIVO_RECIBO_PUBLICADO);
  const device = (rt.devices && rt.devices[receipt.deviceId]) || null;
  if (receiptOrphanState(receipt, device, rt.agora()) !== 'orfao') return falhaSem(SYNC_CODES.CONFLITO, MOTIVO_RECIBO_ATIVO);
  return null;
}

// O preflight do clique responde 'recibo' porque o recibo que estamos prestes a apagar
// ainda está lá: esse é o bloqueio esperado. Qualquer OUTRO (lease de outro aparelho,
// banco fora) quer dizer que o relançamento não aconteceria, e aí nada é apagado.
async function bloqueioAlemDoRecibo(engine, pr) {
  // pela FACHADA da Engine, que é a mesma boca que o clique usa: perguntar direto ao
  // coordenador deixaria o "Refazer" respondendo a um preflight diferente do real
  const r = await engine.syncPreflightManual(pr);
  if (r.ok || r.reason === 'recibo') return null;
  return falhaSem(r.reason === 'alheio' ? SYNC_CODES.CONFLITO : SYNC_CODES.INDISPONIVEL, motivoDoBloqueio(r));
}

function motivoDoBloqueio(r) {
  const d = r.detail || {};
  if (r.reason !== 'alheio') return d.motivo || motivoDe(SYNC_CODES.INDISPONIVEL);
  return `outro aparelho (${d.deviceName || 'desconhecido'}) está analisando este PR agora`;
}

// Apaga o recibo de review do head ATUAL, condicionado ao etag lido: se outro aparelho
// regravou o recibo entre a leitura e o apagar, ele deixou de ser órfão e fica, e nada
// é relançado. Depois relança pelo clique com o override de recibo, que passa pelo
// preflight de sempre: lease de outro aparelho continua barrando (D12).
async function redoReceipt(engine, key) {
  const rt = engine.sync;
  if (!coordinationActive((engine.config && engine.config.sync) || {})) return falhaSem(SYNC_CODES.DESLIGADO, 'a coordenação entre aparelhos está desligada');
  if (rt.status !== CONECTADO || !rt.client) return falhaSemConexao(rt);
  const pr = prDaChave(engine, String(key || ''));
  if (!pr) return falhaSem(SYNC_CODES.FALHA_INTERNA, MOTIVO_CHAVE);
  const head = await headDoPr(engine, pr);
  if (!head) return falhaSem(SYNC_CODES.INDISPONIVEL, MOTIVO_SEM_HEAD);
  const ids = { uid: rt.uid, accountHash: accountHash(engine.accountForPr(pr)), prHash: prHash(pr.key) };
  const fp = operationFingerprint('review', head);
  const lido = await readReceipt(rt.client, ids, fp);
  if (!lido.ok) return falhaSem(lido.code, lido.motivo);
  const recusa = recusaDoRefazer(rt, lido.receipt);
  if (recusa) return recusa;
  // Só depois de saber que o relançamento VAI acontecer. Apagar antes deixava, quando
  // um lease alheio ou o banco fora barravam o clique, o recibo destruído e nenhuma
  // análise no lugar dele.
  const barrado = await bloqueioAlemDoRecibo(engine, pr);
  if (barrado) return barrado;
  const apagado = await invalidateReceipt(rt.client, ids, fp, { ifMatch: lido.etag });
  if (!apagado.ok) return falhaSem(apagado.code, apagado.motivo);
  delete rt.recibosVistos[pr.key];
  return resultadoDoRelancamento(await engine.launchReview([pr.url], 'auto', 'clique', REFAZER));
}

export default { redoReceipt, prDaChave };
export { redoReceipt, prDaChave };
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('lib/engine/sync-redo.js')).digest('hex').slice(0,16))"
```

Esperado: `40f580b75d40115f`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

Crie `lib/engine/sync-stream.js` com EXATAMENTE este conteúdo:

```js
// Tempo real da coordenação entre aparelhos: o stream SSE de /users/{uid}/leases, a
// árvore remota que ele mantém em memória e a visão que a tela mostra (quem, em outro
// aparelho, está analisando um PR que este Farol acompanha). Separado de
// lib/engine/sync.js para aquele caber no teto de linhas, e porque tem ciclo de vida
// próprio: abre e fecha junto com a coordenação, reconecta sozinho e nunca decide nada.
// Quem decide a admissão continua sendo o lease lido na hora (lib/sync/coordinator.js);
// esta visão só evita que a tela precise perguntar ao banco.
//
// O stream é REST+SSE de propósito (§5 do spec): é o que dá tempo real sem SDK. O banco
// manda `put` (substitui o nó do caminho) e `patch` (mescla chave a chave), com `data`
// null querendo dizer nó apagado, e um keep-alive a cada ~30 s.
//
// O nome do PR nunca sobe (D6): a árvore só tem hashes, e a tradução para a chave
// legível usa os PRs que ESTE aparelho já conhece. PR que ele não acompanha fica fora da
// visão e só conta em leasesOutros.
import { SYNC } from '../constants.js';
import io from '../io.js';
import { coordinationActive } from '../sync/config.js';
import { SYNC_CODES } from '../sync/errors.js';
import { accountHash, prHash } from '../sync/keys.js';

const CONECTADO = 'conectado';
// o teste troca por um agendador que ele dispara à mão (engine.sync.agendadorStream):
// é assim que a vigia de 90 s e o backoff são testados sem dormir de verdade
const AGENDADOR = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (t) => clearTimeout(t) };

// --- derivação pura -------------------------------------------------------------------

function ehObjeto(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

function segmentosDe(caminho) { return String(caminho || '').split('/').filter(Boolean); }

function entradas(no) { return ehObjeto(no) ? Object.entries(no) : []; }

// grava o valor no caminho e devolve uma árvore NOVA; nó que fica vazio some, como no
// banco, então apagar o último lease de uma conta apaga a conta da árvore
function gravarNo(no, segs, valor) {
  if (!segs.length) return valor === undefined ? null : valor;
  const base = ehObjeto(no) ? { ...no } : {};
  const filho = gravarNo(base[segs[0]], segs.slice(1), valor);
  if (filho === null) delete base[segs[0]];
  else base[segs[0]] = filho;
  return Object.keys(base).length ? base : null;
}

// Chave vazia no patch é pulada: gravar nela trocaria o nó inteiro do caminho, que é o
// efeito de um put, não de um patch.
function aplicarPatch(arvore, segs, dados) {
  let nova = arvore;
  for (const [k, v] of Object.entries(dados)) {
    const alvo = segmentosDe(k);
    if (alvo.length) nova = gravarNo(nova, [...segs, ...alvo], v ?? null);
  }
  return nova;
}

function aplicarEvento(arvore, ev) {
  const corpo = ev && ev.data;
  if (!ehObjeto(corpo) || typeof corpo.path !== 'string') return arvore;
  const segs = segmentosDe(corpo.path);
  if (ev.event === 'put') return gravarNo(arvore, segs, corpo.data ?? null);
  if (ev.event !== 'patch' || !ehObjeto(corpo.data)) return arvore;
  return aplicarPatch(arvore, segs, corpo.data);
}

// `${accountHash}/${prHash}` -> chave legível, para cada PR que este aparelho acompanha.
// A conta é a dona do PR (a mesma que o coordenador usa para montar o caminho do lease).
function mapaDePrs(prs, contaDe) {
  const mapa = new Map();
  for (const p of prs) {
    if (!p || typeof p.key !== 'string') continue;
    const ph = prHash(p.key);
    const ch = ph ? `${accountHash(contaDe(p))}/${ph}` : '';
    if (ch && !mapa.has(ch)) mapa.set(ch, p.key);
  }
  return mapa;
}

// Só lease VIVO de OUTRO aparelho: o meu a tela já mostra em "Analisando agora", e o
// vencido não segura ninguém (o próximo admit o toma). Sem expiresAt numérico não é
// "vivo provado", e a visão não afirma o que não sabe.
function leaseVisivel(lease, euDeviceId, nowMs) {
  if (!ehObjeto(lease) || lease.deviceId === euDeviceId) return false;
  return typeof lease.expiresAt === 'number' && lease.expiresAt > nowMs;
}

function visaoDoLease(lease, devices) {
  const d = ehObjeto(devices) ? devices[lease.deviceId] : null;
  return {
    deviceId: String(lease.deviceId || ''), deviceName: (d && d.name) || '',
    since: Number(lease.acquiredAt) || 0, operationKind: String(lease.operationKind || ''),
  };
}

function leasesVistosDe(arvore, { euDeviceId, nowMs, conhecidos, devices }) {
  const vistos = {};
  let outros = 0;
  for (const [acct, prs] of entradas(arvore)) {
    for (const [ph, lease] of entradas(prs)) {
      if (!leaseVisivel(lease, euDeviceId, nowMs)) continue;
      const key = conhecidos.get(`${acct}/${ph}`);
      if (key) vistos[key] = visaoDoLease(lease, devices);
      else outros++;
    }
  }
  return { vistos, outros };
}

// --- ciclo de vida --------------------------------------------------------------------

function coordenacaoAtiva(engine) { return coordinationActive((engine.config && engine.config.sync) || {}); }

function avisarTela(engine) {
  if (typeof engine.pushState === 'function') engine.pushState();
}

function agendadorDe(rt) { return rt.agendadorStream || AGENDADOR; }

// timer do stream nunca segura o processo vivo: fechar o app não espera reconexão
function agendar(rt, fn, ms) {
  const t = agendadorDe(rt).setTimeout(fn, ms);
  if (t && typeof t.unref === 'function') t.unref();
  return t;
}

function desagendar(rt, t) {
  if (t) agendadorDe(rt).clearTimeout(t);
}

function prsConhecidos(engine) {
  const lista = [...(engine.panorama || []), ...(engine.queue || []), ...(engine.myPRs || [])];
  return mapaDePrs(lista, (p) => engine.accountForPr(p));
}

// Recalcula a visão a partir da árvore e avisa a tela SÓ quando ela muda: roda a cada
// evento e a cada tick, porque o lease também vence sem evento nenhum (o dono caiu) e
// porque a lista de PRs conhecidos muda a cada ciclo de polling.
function atualizarVistos(engine) {
  const rt = engine.sync;
  const st = rt.stream;
  if (!st) return false;
  const opcoes = { euDeviceId: rt.deviceId, nowMs: rt.agora(), conhecidos: prsConhecidos(engine), devices: rt.devices };
  const { vistos, outros } = leasesVistosDe(st.arvore, opcoes);
  const assinatura = io.safeStringify([vistos, outros], '');
  if (assinatura === st.assinatura) return false;
  Object.assign(st, { assinatura });
  Object.assign(rt, { leasesVistos: vistos, leasesOutros: outros });
  avisarTela(engine);
  return true;
}

// Zera a visão sem falar com a tela. É o que quem SOLTA A CONEXÃO chama: o lease que
// a visão mostra tem validade de LEASE_TTL_MS e ninguém mais a mantém depois que o
// stream fecha, então deixá-la de pé afirmaria, por tempo indefinido, que outro
// aparelho está analisando um PR que ele já largou. Quem solta a conexão avisa a tela
// junto com o status novo.
function esquecerVisao(rt) {
  if (!rt) return false;
  if (!Object.keys(rt.leasesVistos || {}).length && !rt.leasesOutros) return false;
  Object.assign(rt, { leasesVistos: {}, leasesOutros: 0 });
  return true;
}

function limparVistos(engine) {
  if (!esquecerVisao(engine.sync)) return;
  avisarTela(engine);
}

function novoStream() {
  return {
    fechado: false, arvore: null, assinatura: '', esperaMs: SYNC.STREAM_RECONNECT_MS,
    controle: null, vigia: null, vigias: 0, espera: null, acordar: null, avisouCancel: false,
  };
}

// O stream só vive enquanto a coordenação está ligada e a conexão está de pé. Status
// fora de 'conectado' encerra o laço: quem reconecta é o startSync, que reabre no fim.
function ativo(engine, st) {
  const rt = engine.sync;
  return !st.fechado && rt.stream === st && rt.status === CONECTADO && !!rt.client && coordenacaoAtiva(engine);
}

// A vigia é rearmada a cada pedaço que chega (keep-alive incluso). Sem nada por
// STREAM_IDLE_MS a conexão está morta sem ter avisado (proxy, NAT, sono do aparelho),
// e esperar o TCP perceber pode levar horas.
function armarVigia(rt, st, conexao) {
  desagendar(rt, st.vigia);
  const marca = ++st.vigias;
  st.vigia = agendar(rt, () => {
    if (marca !== st.vigias || st.controle !== conexao.controle) return;
    conexao.fim = 'inativo';
    conexao.controle.abort();
  }, SYNC.STREAM_IDLE_MS);
}

function aoEvento(engine, st, conexao, ev) {
  if (st.fechado || st.controle !== conexao.controle) return;
  if (ev.event === 'put' || ev.event === 'patch') {
    // dado chegando é o stream são: a próxima queda volta a esperar o mínimo
    Object.assign(conexao, { dados: true });
    Object.assign(st, { esperaMs: SYNC.STREAM_RECONNECT_MS, avisouCancel: false, arvore: aplicarEvento(st.arvore, ev) });
    atualizarVistos(engine);
    return;
  }
  if (ev.event !== 'auth_revoked' && ev.event !== 'cancel') return;
  conexao.fim = ev.event;
  conexao.controle.abort();
}

async function umaConexao(engine, st) {
  const rt = engine.sync;
  const conexao = { controle: new AbortController(), fim: '', dados: false };
  st.controle = conexao.controle;
  armarVigia(rt, st, conexao);
  const r = await rt.client.stream(`/users/${rt.uid}/leases`, {
    signal: conexao.controle.signal,
    onActivity: () => armarVigia(rt, st, conexao),
    onEvent: (ev) => aoEvento(engine, st, conexao, ev),
  });
  desagendar(rt, st.vigia);
  st.vigia = null;
  return { conexao, r };
}

// `cancel` é o banco dizendo que a regra deixou de permitir a leitura: é falha, então
// vai para o log, mas uma vez por episódio (o farol.log é de falha, não de estado). A
// frase é a que a classe coordenacao-indisponivel da taxonomia reconhece.
function avisarCancelamento(engine, st) {
  if (st.avisouCancel) return;
  st.avisouCancel = true;
  if (typeof engine.log === 'function') engine.log('WARN', 'coordenação entre dispositivos indisponível: o banco cancelou o stream dos leases (a leitura deixou de ser permitida)');
}

// Devolve true quando a reconexão deve ser imediata: token revogado numa conexão que
// estava saudável (o banco revoga o ID token quando ele vence, e o token novo resolve).
// Revogado antes de qualquer dado quer dizer que o token NOVO também foi recusado, e
// reabrir na hora viraria laço quente; aí vale a espera de sempre.
function depoisDaConexao(engine, st, conexao, r) {
  const rt = engine.sync;
  const recusado = conexao.fim === 'auth_revoked' || (r && r.code === SYNC_CODES.NAO_AUTORIZADO);
  if (recusado && rt.tokenSource) rt.tokenSource.invalidate();
  if (conexao.fim === 'cancel') avisarCancelamento(engine, st);
  return conexao.fim === 'auth_revoked' && conexao.dados;
}

function proximaEspera(st) {
  const ms = st.esperaMs;
  st.esperaMs = Math.min(ms * 2, SYNC.STREAM_RECONNECT_MAX_MS);
  return ms;
}

// fecharStream acorda a espera (acordar), e o laço sai porque `ativo` ficou falso
function esperar(rt, st, ms) {
  return new Promise((resolve) => {
    st.acordar = resolve;
    st.espera = agendar(rt, resolve, ms);
  });
}

async function ciclo(engine, st) {
  while (ativo(engine, st)) {
    const { conexao, r } = await umaConexao(engine, st);
    if (!ativo(engine, st)) break;
    if (!depoisDaConexao(engine, st, conexao, r)) await esperar(engine.sync, st, proximaEspera(st));
  }
  // saiu sem ninguém fechar (status caiu ou a coordenação foi desligada): solta o lugar
  // para o startSync ou o próximo tick reabrirem, e a visão sai junto, porque sem
  // stream ninguém mais a mantém e ela envelheceria calada na tela
  if (engine.sync.stream !== st) return;
  fecharStream(engine.sync);
  limparVistos(engine);
}

function abrirStream(engine) {
  const rt = engine.sync;
  if (rt.stream) return false;
  const st = novoStream();
  rt.stream = st;
  ciclo(engine, st).catch((err) => {
    if (typeof engine.log === 'function') engine.log('WARN', `coordenação entre dispositivos: stream dos leases parou (${err && err.message})`);
    if (rt.stream !== st) return;
    fecharStream(rt);
    // mesmo tratamento do fim normal do ciclo: sem stream ninguém mantém a visão
    limparVistos(engine);
  });
  return true;
}

function fecharStream(rt) {
  const st = rt && rt.stream;
  if (!st) return false;
  st.fechado = true;
  rt.stream = null;
  desagendar(rt, st.vigia);
  desagendar(rt, st.espera);
  if (st.controle) st.controle.abort();
  if (st.acordar) st.acordar();
  return true;
}

// Ponto único de reconciliação, chamado no fim do startSync, pelo aplicarConfig e a cada
// tick conectado: abre quando a coordenação está ligada e a conexão de pé, fecha (e
// limpa a visão) quando não está, e recalcula a visão do stream que já corre.
function sincronizarStream(engine) {
  const rt = engine.sync;
  if (coordenacaoAtiva(engine) && rt.status === CONECTADO && rt.client) {
    abrirStream(engine);
    return atualizarVistos(engine);
  }
  fecharStream(rt);
  limparVistos(engine);
  return false;
}

export default { aplicarEvento, mapaDePrs, leasesVistosDe, sincronizarStream, fecharStream, esquecerVisao, atualizarVistos };
export { aplicarEvento, mapaDePrs, leasesVistosDe, sincronizarStream, fecharStream, esquecerVisao, atualizarVistos };
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('lib/engine/sync-stream.js')).digest('hex').slice(0,16))"
```

Esperado: `80006f1e3fea9787`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

Crie `lib/engine/sync-usage.js` com EXATAMENTE este conteúdo:

```js
// Consolidação do consumo entre aparelhos: a metade de lib/engine/sync.js que junta a
// outbox (lib/sync/outbox.js) com o engine. Separada para o sync.js caber no teto de
// linhas, e porque ela tem regra própria: consumo nunca decide nada, só agrega.
//
// A consolidação só age com a chave ligada (consolidationActive). Desligada, nenhuma
// função daqui lê ou grava o sync-outbox.json, e o gancho de usage.js vira no-op.
import { APP_VERSION } from '../paths.js';
import { consolidationActive } from '../sync/config.js';
import { SYNC_CODES, motivoDe, falhaSemConexao } from '../sync/errors.js';
import { readOutbox, saveOutbox, enqueueSession, reconcileFromSessions, flushOutbox, resetForFullSync, outboxTarget, retargetOutbox } from '../sync/outbox.js';
import { consolidatedSummary } from '../sync/consolidated.js';

// Lotes por tick: a migração inicial de um histórico longo não pode esperar um ciclo de
// polling por lote de 50, nem ocupar o tick inteiro com milhares de PATCH seguidos.
const LOTES_POR_TICK = 10;
const CONECTADO = 'conectado';
// janelas que a aba Consumo oferece (7/30/90) mais as das Entregas (15) e o tudo (0);
// valor fora da lista cai no padrão da tela em vez de virar uma janela que ninguém pediu
const JANELAS = [0, 7, 15, 30, 90];
const JANELA_PADRAO = 30;

function ativa(engine) { return consolidationActive((engine.config && engine.config.sync) || {}); }
function sessoesDe(engine) { return (engine.usageSessions && engine.usageSessions.sessions) || []; }

function logar(engine, msg) {
  if (typeof engine.log === 'function') engine.log('WARN', msg);
}

// Carrega do disco na primeira vez e SEMPRE reconcilia pelo cursor: é isso que traz de
// volta a sessão que entrou no usage-sessions.json e não chegou aqui (processo morto
// no meio, consolidação desligada por um tempo, aparelho ainda sem identidade).
// Sem uid não há destino conhecido, e o destino guardado fica como está: marcar um
// destino vazio a cada enfileiramento feito fora do ar faria a fila inteira voltar
// toda vez que a conexão subisse.
function destinoDe(engine) {
  return outboxTarget(engine.sync.uid, ((engine.config && engine.config.sync) || {}).databaseUrl);
}

function outboxReconciliada(engine) {
  const rt = engine.sync;
  if (!rt.outbox) rt.outbox = readOutbox();
  // antes de reconciliar: o retarget zera o cursor, e é o cursor que decide o que volta
  const mudouDestino = retargetOutbox(rt.outbox, destinoDe(engine));
  const novas = reconcileFromSessions(rt.outbox, sessoesDe(engine), rt.deviceId, APP_VERSION);
  if (novas || mudouDestino) saveOutbox(rt.outbox);
  return rt.outbox;
}

// O gancho de recordUsage/marcarDesfecho. Roda DEPOIS do save local e nunca lança: o
// registro de consumo não pode falhar por causa da nuvem. Sem identidade do aparelho o
// eventId sairia errado, então espera: o cursor não andou e a reconciliação pega depois.
function enqueueUsage(engine, sessao) {
  const rt = engine.sync;
  if (!rt || !ativa(engine) || !rt.deviceId) return false;
  try {
    const ob = outboxReconciliada(engine);
    if (!enqueueSession(ob, sessao, rt.deviceId, APP_VERSION)) return false;
    return saveOutbox(ob);
  } catch (err) {
    logar(engine, `consumo entre dispositivos: não foi possível enfileirar a sessão (${err && err.message})`);
    return false;
  }
}

function avisarRejeicao(engine, antes, ob) {
  const novos = ob.rejeitados - antes;
  if (novos > 0) logar(engine, `consumo entre dispositivos: ${novos} evento(s) recusado(s) pelo banco e descartado(s) da fila`);
}

// A pausa loga só quando o código muda, pela mesma razão do registrarFalha: a mesma
// recusa a cada tick inundaria o Diagnóstico. A frase é de CONSUMO de propósito: a
// classe `coordenacao-indisponivel` da taxonomia não pode contar envio de consumo
// parado como coordenação fora do ar, porque a coordenação segue funcionando.
function avisarPausa(engine, ob, r) {
  const rt = engine.sync;
  const code = ob.paused && r && !r.ok ? r.code : '';
  if (code && code !== rt.erroConsumo) logar(engine, `consumo entre dispositivos: envio pausado, ${r.motivo || motivoDe(code)} (${code})`);
  rt.erroConsumo = code;
}

// O destino é preso no começo, e não relido a cada lote: um logout ou uma reconexão no
// meio do laço deixava rt.client null e o lote seguinte lançava TypeError dentro do
// tick, contra a regra de que nada daqui lança para o engine. Trocou a conexão, o resto
// da fila fica para o próximo tick, que já vai falar com o destino novo.
async function enviarLotes(engine, ob) {
  const rt = engine.sync;
  const { client, uid, deviceId, geracao } = rt;
  let enviados = 0;
  for (let i = 0; i < LOTES_POR_TICK && ob.pending.length; i++) {
    if (rt.client !== client || rt.geracao !== geracao) return { ok: true, enviados, restantes: ob.pending.length };
    const r = await flushOutbox(client, uid, deviceId, ob);
    enviados += r.enviados;
    if (!r.ok) return { ...r, enviados };
  }
  return { ok: true, enviados, restantes: ob.pending.length };
}

// Um envio por vez: o tick e o botão de consolidar podem pedir no mesmo instante, e dois
// envios do mesmo lote contariam a mesma recusa duas vezes.
function flushUsage(engine) {
  const rt = engine.sync;
  if (!rt || !ativa(engine) || rt.status !== CONECTADO || !rt.client || !rt.deviceId) return Promise.resolve({ ok: true, enviados: 0 });
  if (rt.enviandoConsumo) return rt.enviandoConsumo;
  const ob = outboxReconciliada(engine);
  const antes = ob.rejeitados;
  const p = enviarLotes(engine, ob).then((r) => {
    avisarPausa(engine, ob, r);
    return r;
  }).finally(() => {
    saveOutbox(ob);
    avisarRejeicao(engine, antes, ob);
    rt.enviandoConsumo = null;
  });
  rt.enviandoConsumo = p;
  return p;
}

// Projeção para a tela: contagens, nunca o conteúdo da fila. Antes da primeira
// reconciliação não há número honesto a mostrar, e null diz isso.
function usageStatus(engine) {
  const rt = engine.sync;
  if (!rt || !ativa(engine) || !rt.outbox) return null;
  const ob = rt.outbox;
  return { pendentes: ob.pending.length, enviados: ob.enviados, rejeitados: ob.rejeitados, lastSentAt: ob.lastSentAt, paused: ob.paused };
}

function falha(code, motivo) { return { ok: false, code, motivo: motivo || motivoDe(code) }; }
function desligada() { return falha(SYNC_CODES.DESLIGADO, 'a consolidação de consumo entre aparelhos está desligada'); }

function janelaDe(days) {
  if (days === null || days === undefined || days === '') return JANELA_PADRAO;
  const n = Number(days);
  return JANELAS.includes(n) ? n : JANELA_PADRAO;
}

// Lê SÓ a árvore do próprio uid: o caminho é montado aqui, nunca vem de fora, e as
// regras do banco recusam o resto. Um GET por nó e nenhuma escrita.
async function consolidated(engine, days) {
  const rt = engine.sync;
  if (!rt || !ativa(engine)) return desligada();
  if (rt.status !== CONECTADO || !rt.client || !rt.uid) return falhaSemConexao(rt);
  const base = `/users/${rt.uid}`;
  const [eventos, aparelhos] = await Promise.all([rt.client.get(`${base}/usageEvents`), rt.client.get(`${base}/devices`)]);
  if (!eventos.ok) return falha(eventos.code, eventos.motivo);
  if (!aparelhos.ok) return falha(aparelhos.code, aparelhos.motivo);
  const resumo = consolidatedSummary(eventos.data, aparelhos.data, { days: janelaDe(days), agoraMs: rt.agora(), euDeviceId: rt.deviceId });
  return { ok: true, resumo };
}

// Migração sob demanda: cursor zerado e o histórico inteiro de volta à fila. Não
// duplica nada no banco (o eventId é o mesmo), só reenvia. Sem identidade do aparelho
// o eventId sairia errado, então espera a primeira conexão.
async function consolidate(engine) {
  const rt = engine.sync;
  if (!rt || !ativa(engine)) return desligada();
  if (!rt.deviceId) return falhaSemConexao(rt);
  if (!rt.outbox) rt.outbox = readOutbox();
  resetForFullSync(rt.outbox);
  const enfileirados = reconcileFromSessions(rt.outbox, sessoesDe(engine), rt.deviceId, APP_VERSION);
  saveOutbox(rt.outbox);
  await flushUsage(engine);
  return { ok: true, enfileirados, pendentes: rt.outbox.pending.length };
}

export default { enqueueUsage, flushUsage, usageStatus, consolidated, consolidate };
export { enqueueUsage, flushUsage, usageStatus, consolidated, consolidate };
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('lib/engine/sync-usage.js')).digest('hex').slice(0,16))"
```

Esperado: `d1ab629cd24e1347`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

Crie `lib/engine/sync.js` com EXATAMENTE este conteúdo:

```js
// Composição da sincronização entre dispositivos: o ÚNICO módulo que junta config,
// credencial, identidade do aparelho, autenticação e cliente do banco. As folhas de
// lib/sync/ não conhecem o engine; quem decide quando falar com o Firebase é aqui.
//
// Estado local continua fonte de verdade e nada aqui lança para o engine: toda falha
// vira `lastError` + status, e o tick seguinte tenta de novo. Falha de coordenação é
// ESPERA, nunca estacionamento (D11 do contrato).
//
// A rede entra pelo fetchImpl que login e start recebem e que o runtime guarda: é por
// ele que o teste troca o Firebase por dublês locais sem ler env nenhuma. Em produção
// o campo fica vazio e vale o fetch global.
import os from 'node:os';
import { APP_VERSION } from '../paths.js';
import { SYNC } from '../constants.js';
import { coordinationActive, consolidationActive, databaseUrlProblema, authUrlsFor } from '../sync/config.js';
import { SYNC_CODES, motivoDe, falhaSemConexao } from '../sync/errors.js';
import { nextBrasiliaDayStartMs, accountHash, prHash, operationFingerprint } from '../sync/keys.js';
import { readReceipt, invalidateReceipt, receiptOrphanState } from '../sync/receipts.js';
import { readSyncCredential, setSyncCredential, updateRefreshToken, removeSyncCredential } from '../sync/credentials.js';
import { ensureDevice, readDevice } from '../sync/device.js';
import { signInWithPassword, createTokenSource } from '../sync/auth.js';
import { createRtdbClient } from '../sync/rtdb.js';
import coordinator from '../sync/coordinator.js';
import syncUsage from './sync-usage.js';
import syncStream from './sync-stream.js';
import syncFaxina from './sync-faxina.js';
import syncRedo from './sync-redo.js';

const STATUS = {
  DESLIGADO: 'desligado', SEM_CREDENCIAL: 'sem-credencial', CONECTANDO: 'conectando',
  CONECTADO: 'conectado', ERRO: 'erro',
};
// Recusas que só se resolvem com ação de quem usa (entrar de novo, corrigir a chave ou
// a URL): o tick não insiste nelas, senão cada ciclo de polling gastaria uma chamada ao
// securetoken para ouvir a mesma recusa.
const PERMANENTES = new Set([
  SYNC_CODES.CREDENCIAL_INVALIDA, SYNC_CODES.CONFIG_INVALIDA, SYNC_CODES.NAO_ENCONTRADO,
  SYNC_CODES.SEM_CREDENCIAL, SYNC_CODES.FALHA_INTERNA,
]);
// Estas falhas são o banco fora de alcance: o log usa a frase que a classe
// `coordenacao-indisponivel` da taxonomia reconhece, pro Diagnóstico agrupar certo.
const TRANSITORIAS = new Set([SYNC_CODES.INDISPONIVEL, SYNC_CODES.TIMEOUT, SYNC_CODES.NAO_AUTORIZADO]);
const TIMESTAMP_SERVIDOR = { '.sv': 'timestamp' };
const SHALLOW = { shallow: true };
const MAX_NOME = 40;
const UID_VISIVEL = 6;

function novoRuntime() {
  const rt = {
    status: STATUS.DESLIGADO, lastError: null,
    uid: '', email: '', deviceId: '', deviceName: '',
    client: null, tokenSource: null, skewMs: 0,
    devices: {}, leasesVistos: {}, leasesOutros: 0, recibosVistos: {}, espera: {},
    avisou: false, lastTickAt: 0, lastPresenceAt: 0, lastFaxinaAt: 0,
    outbox: null, stream: null,
    // internos: fetch injetado, geração da conexão (descarta resposta de conexão que
    // já foi substituída), createdAt já gravado e a promessa de start em voo
    fetchImpl: null, geracao: 0, criacaoGravada: false, assinatura: '', iniciando: null, enviandoConsumo: null,
    // código da última pausa do envio de consumo, só pra logar a transição uma vez
    erroConsumo: '',
  };
  rt.agora = () => Date.now() + rt.skewMs;
  return rt;
}

function cfgDe(engine) { return (engine.config && engine.config.sync) || {}; }
function ligado(engine) { return cfgDe(engine).enabled === true; }
function coordenacaoAtiva(engine) { return coordinationActive(cfgDe(engine)); }
function consolidacaoAtiva(engine) { return consolidationActive(cfgDe(engine)); }

function texto(v) { return typeof v === 'string' ? v.trim() : ''; }

function nomeDoAparelho(cfg) {
  return texto(cfg.deviceName) || texto(os.hostname()).slice(0, MAX_NOME) || 'aparelho';
}

// campos que definem PARA ONDE a conexão fala; mudar qualquer um exige reconectar
function assinaturaDe(cfg) { return [cfg.apiKey || '', cfg.databaseUrl || '', cfg.projectId || ''].join('|'); }

function configIncompleta(cfg) { return !cfg.apiKey || !!databaseUrlProblema(cfg.databaseUrl); }

function fetchDe(rt) { return rt.fetchImpl || globalThis.fetch; }

function falhaSem(code, motivo) { return { ok: false, code, motivo: motivo || motivoDe(code) }; }

function avisarTela(engine) {
  if (typeof engine.pushState === 'function') engine.pushState();
}

// Loga só quando o CÓDIGO da falha muda: o farol.log é de falha, não de estado, e a
// mesma recusa a cada tick inundaria o Diagnóstico. Não dá pra usar o status como
// sinal de transição, porque cada reconexão passa por 'conectando' antes de falhar de
// novo; o lastError sobrevive à tentativa e só é zerado quando a conexão volta.
// A falha transitória é a mesma; o NOME dela depende do que a pessoa ligou. Com a
// coordenação desligada (só consolidação), dizer "coordenação entre dispositivos
// indisponível" punha no Diagnóstico um recurso que ninguém ligou. As duas frases caem
// na mesma classe da taxonomia (lib/log-taxonomy.js).
function prefixoDaFalha(engine, code) {
  if (!TRANSITORIAS.has(code)) return 'sincronização entre dispositivos parada';
  return coordenacaoAtiva(engine) ? 'coordenação entre dispositivos indisponível' : 'sincronização entre dispositivos indisponível';
}

function registrarFalha(engine, code, motivo) {
  const rt = engine.sync;
  const frase = motivo || motivoDe(code);
  const novidade = !rt.lastError || rt.lastError.code !== code;
  if (novidade && typeof engine.log === 'function') {
    engine.log('WARN', `${prefixoDaFalha(engine, code)}: ${frase} (${code})`);
  }
  rt.lastError = { code, motivo: frase, at: Date.now() };
  rt.status = STATUS.ERRO;
  return falhaSem(code, frase);
}

function superado() { return falhaSem(SYNC_CODES.DESLIGADO, 'a conexão foi substituída antes de terminar'); }

function soltarConexao(rt) {
  syncStream.fecharStream(rt);
  // a visão de quem analisa em outro aparelho morre com o stream: sem ele nada a
  // recalcula, e um lease de 2 minutos ficaria na tela até a próxima conexão que
  // desse certo (uma reconexão que falha deixaria o aviso de pé por horas)
  syncStream.esquecerVisao(rt);
  rt.client = null;
  rt.tokenSource = null;
}

function limparVisao(rt) {
  Object.assign(rt, { uid: '', email: '', devices: {}, leasesVistos: {}, leasesOutros: 0, recibosVistos: {}, espera: {} });
  Object.assign(rt, { lastError: null, lastPresenceAt: 0, criacaoGravada: false, assinatura: '', avisou: false });
}

// Construtor da Engine: monta o runtime e, com o recurso ligado, só LÊ o que está no
// disco. Nunca toca rede nem cria arquivo: quem conecta é o primeiro tick.
function bootSync(engine) {
  const rt = novoRuntime();
  const cfg = cfgDe(engine);
  rt.deviceName = nomeDoAparelho(cfg);
  if (cfg.enabled !== true) return rt;
  const dev = readDevice();
  rt.deviceId = dev ? dev.deviceId : '';
  const cred = readSyncCredential();
  if (!cred) {
    rt.status = STATUS.SEM_CREDENCIAL;
    return rt;
  }
  Object.assign(rt, { uid: cred.uid, email: cred.email, status: STATUS.CONECTANDO });
  return rt;
}

// o arquivo do aparelho nasce aqui (primeira conexão), não no boot
function garantirAparelho() {
  try { return ensureDevice().deviceId; } catch { return ''; }
}

function conectar(rt, cfg, cred) {
  const tokenSource = createTokenSource({
    apiKey: cfg.apiKey, refreshToken: cred.refreshToken, fetchImpl: fetchDe(rt),
    tokenUrl: authUrlsFor(cfg.databaseUrl).tokenUrl,
    onRefresh: ({ refreshToken }) => updateRefreshToken(refreshToken),
  });
  rt.tokenSource = tokenSource;
  rt.client = createRtdbClient({
    databaseUrl: cfg.databaseUrl, projectId: cfg.projectId,
    getIdToken: () => tokenSource.getIdToken(), fetchImpl: fetchDe(rt),
  });
}

async function iniciar(engine) {
  const rt = engine.sync;
  soltarConexao(rt);
  const geracao = ++rt.geracao;
  const cfg = cfgDe(engine);
  if (cfg.enabled !== true) {
    stopSync(engine);
    return falhaSem(SYNC_CODES.DESLIGADO);
  }
  const cred = readSyncCredential();
  if (!cred) {
    rt.status = STATUS.SEM_CREDENCIAL;
    return falhaSem(SYNC_CODES.SEM_CREDENCIAL);
  }
  if (configIncompleta(cfg)) return registrarFalha(engine, SYNC_CODES.CONFIG_INVALIDA);
  const deviceId = garantirAparelho();
  if (!deviceId) return registrarFalha(engine, SYNC_CODES.FALHA_INTERNA, 'não foi possível gravar a identidade deste aparelho');
  Object.assign(rt, { uid: cred.uid, email: cred.email, deviceId, deviceName: nomeDoAparelho(cfg), criacaoGravada: false });
  Object.assign(rt, { status: STATUS.CONECTANDO, assinatura: assinaturaDe(cfg) });
  conectar(rt, cfg, cred);
  const r = await touchPresence(engine);
  if (geracao !== rt.geracao) return superado();
  if (!r.ok) return r;
  Object.assign(rt, { status: STATUS.CONECTADO, lastError: null, avisou: false });
  await lerAparelhos(engine);
  syncStream.sincronizarStream(engine);
  avisarTela(engine);
  return { ok: true };
}

// Um start por vez: login, tick e troca de config podem pedir conexão no mesmo
// instante, e dois starts em paralelo gastariam duas renovações de token.
function startSync(engine, fetchImpl) {
  const rt = engine.sync;
  if (fetchImpl) rt.fetchImpl = fetchImpl;
  if (rt.iniciando) return rt.iniciando;
  // só limpa a própria promessa: um stop no meio pode já ter aberto outra
  const p = iniciar(engine).finally(() => { if (rt.iniciando === p) rt.iniciando = null; });
  rt.iniciando = p;
  return p;
}

function stopSync(engine) {
  const rt = engine.sync;
  rt.geracao++;
  rt.iniciando = null;
  soltarConexao(rt);
  limparVisao(rt);
  rt.status = ligado(engine) ? STATUS.SEM_CREDENCIAL : STATUS.DESLIGADO;
  return true;
}

// updateSettings chama quando a chave `sync` veio no patch. Nunca rejeita: config
// salva não pode virar exceção solta por causa da rede.
function aplicarConfig(engine) {
  const rt = engine.sync;
  const cfg = cfgDe(engine);
  const nome = nomeDoAparelho(cfg);
  // nome novo sobe no próximo tick em vez de esperar a janela de presença
  if (nome !== rt.deviceName) rt.lastPresenceAt = 0;
  rt.deviceName = nome;
  if (cfg.enabled !== true) {
    stopSync(engine);
    return Promise.resolve({ ok: true });
  }
  // mesma conexão: só a coordenação pode ter mudado, e é ela que abre ou fecha o stream
  if (rt.status === STATUS.CONECTADO && rt.assinatura === assinaturaDe(cfg)) {
    syncStream.sincronizarStream(engine);
    return Promise.resolve({ ok: true });
  }
  return startSync(engine).catch((err) => registrarFalha(engine, SYNC_CODES.FALHA_INTERNA, err && err.message));
}

function presencaDe(rt) {
  return { name: rt.deviceName, platform: process.platform, farolVersion: APP_VERSION, lastSeenAt: TIMESTAMP_SERVIDOR };
}

// createdAt é escrito uma vez só (PUT condicionado a nó vazio); 412 quer dizer que
// já existe, e falha de rede fica para a próxima presença (best-effort).
async function gravarCriacao(rt, client, base) {
  const r = await client.put(`${base}/createdAt`, TIMESTAMP_SERVIDOR, { ifMatch: 'null_etag' });
  if (r.ok || r.code === SYNC_CODES.CONFLITO) rt.criacaoGravada = true;
}

async function touchPresence(engine) {
  const rt = engine.sync;
  const client = rt.client;
  if (!client || !rt.uid || !rt.deviceId) return falhaSem(SYNC_CODES.SEM_CREDENCIAL);
  const geracao = rt.geracao;
  const base = `/users/${rt.uid}/devices/${rt.deviceId}`;
  const r = await client.patch(base, presencaDe(rt));
  if (geracao !== rt.geracao) return superado();
  if (!r.ok) return registrarFalha(engine, r.code, r.motivo);
  // o carimbo que o servidor acabou de gravar mede o desvio do relógio local
  const visto = Number(r.data && r.data.lastSeenAt);
  if (Number.isFinite(visto) && visto > 0) rt.skewMs = visto - Date.now();
  rt.lastPresenceAt = Date.now();
  if (!rt.criacaoGravada) await gravarCriacao(rt, client, base);
  return { ok: true };
}

function aparelho(d) {
  const o = d && typeof d === 'object' ? d : {};
  return { name: texto(o.name), platform: texto(o.platform), farolVersion: texto(o.farolVersion), lastSeenAt: Number(o.lastSeenAt) || 0 };
}

function aparelhosDe(data) {
  const saida = {};
  if (!data || typeof data !== 'object') return saida;
  for (const [id, d] of Object.entries(data)) saida[id] = aparelho(d);
  return saida;
}

async function lerAparelhos(engine) {
  const rt = engine.sync;
  if (!rt.client) return falhaSem(SYNC_CODES.SEM_CREDENCIAL);
  const geracao = rt.geracao;
  const r = await rt.client.get(`/users/${rt.uid}/devices`);
  if (geracao !== rt.geracao) return superado();
  if (!r.ok) return registrarFalha(engine, r.code, r.motivo);
  rt.devices = aparelhosDe(r.data);
  return { ok: true };
}

function podarEspera(rt, agora) {
  for (const [key, e] of Object.entries(rt.espera)) if (!e || !(e.until > agora)) delete rt.espera[key];
}

function deveReconectar(rt) {
  if (rt.status === STATUS.CONECTANDO) return true;
  return rt.status === STATUS.ERRO && !(rt.lastError && PERMANENTES.has(rt.lastError.code));
}

async function tickConectado(engine) {
  const rt = engine.sync;
  if (Date.now() - rt.lastPresenceAt < SYNC.PRESENCE_TICK_MS) return { ok: true };
  const r = await touchPresence(engine);
  if (!r.ok) return r;
  return lerAparelhos(engine);
}

// Depois de cada tick conectado a visão dos leases é refeita (lease vence sem evento
// nenhum quando o dono cai) e a faxina de retenção roda, no máximo uma vez por dia. O consumo sobe a cada tick, fora da janela de presença, e NUNCA decide o estado da
// conexão. O 401 do banco é também a regra recusando o próprio evento: tratá-lo como
// queda derrubava o status em tick sim, tick não, e cada tick em 'erro' segurava a
// revisão automática por causa de consumo, que só agrega. A falha fica na outbox
// (paused) e quem diz se o banco caiu é a presença, na janela dela. O tick devolve o
// desfecho da CONEXÃO, não o do envio.
async function depoisDoTick(engine, conexao) {
  if (!conexao.ok) return conexao;
  syncStream.sincronizarStream(engine);
  await syncUsage.flushUsage(engine);
  await syncFaxina.faxinar(engine);
  return conexao;
}

// check() chama no fim do ciclo. Desligado é custo zero; conectado carimba presença no
// máximo a cada PRESENCE_TICK_MS; erro transitório reconecta.
async function syncTick(engine) {
  const rt = engine.sync;
  if (!rt || !ligado(engine)) return { ok: true };
  rt.lastTickAt = Date.now();
  podarEspera(rt, rt.lastTickAt);
  if (rt.iniciando) return rt.iniciando;
  if (rt.status === STATUS.CONECTADO) return tickConectado(engine).then((r) => depoisDoTick(engine, r));
  if (deveReconectar(rt)) return startSync(engine);
  return { ok: true };
}

// A senha entra só no POST do login e morre aqui: não vai para arquivo, runtime,
// resultado nem log.
async function syncLogin(engine, credenciais, fetchImpl) {
  const rt = engine.sync;
  if (fetchImpl) rt.fetchImpl = fetchImpl;
  const cfg = cfgDe(engine);
  if (cfg.enabled !== true) return falhaSem(SYNC_CODES.DESLIGADO);
  if (configIncompleta(cfg)) return falhaSem(SYNC_CODES.CONFIG_INVALIDA);
  const c = credenciais || {};
  const password = typeof c.password === 'string' ? c.password : '';
  const { identityUrl } = authUrlsFor(cfg.databaseUrl);
  const r = await signInWithPassword({ apiKey: cfg.apiKey, email: texto(c.email), password, fetchImpl: fetchDe(rt), identityUrl });
  if (!r.ok) return falhaSem(r.code, r.motivo);
  if (!setSyncCredential({ uid: r.uid, email: r.email, refreshToken: r.refreshToken })) return falhaSem(SYNC_CODES.FALHA_INTERNA);
  // Um start pode estar em voo com a credencial ANTIGA (o tick reconectando, a tela
  // salvando a config). O startSync devolveria ESSA promessa, e o login voltaria ok
  // apontando para a conta de antes: a tela diria "conectado" com a conta errada. Espera
  // o start em voo acabar e começa outro, agora com a credencial nova já no disco.
  if (rt.iniciando) await rt.iniciando.catch(() => undefined);
  const s = await startSync(engine);
  if (!s.ok) return falhaSem(s.code, s.motivo);
  return { ok: true, uid: r.uid, email: r.email };
}

function syncLogout(engine) {
  removeSyncCredential();
  stopSync(engine);
  avisarTela(engine);
  return { ok: true };
}

function semConexao(engine) {
  if (!ligado(engine)) return falhaSem(SYNC_CODES.DESLIGADO);
  return falhaSemConexao(engine.sync);
}

function contarChaves(data) {
  return data && typeof data === 'object' ? Object.keys(data).length : 0;
}

async function syncTest(engine) {
  const rt = engine.sync;
  if (!ligado(engine) || !rt.client) return semConexao(engine);
  const r = await rt.client.get(`/users/${rt.uid}/devices`, SHALLOW);
  if (!r.ok) return falhaSem(r.code, r.motivo);
  return { ok: true, uid: rt.uid, devices: contarChaves(r.data) };
}

// Apaga só o que está no banco: credencial e identidade locais ficam. A presença
// volta no próximo tick, porque o aparelho continua ligado e conectado.
async function syncEraseRemote(engine) {
  const rt = engine.sync;
  if (!ligado(engine) || !rt.client) return semConexao(engine);
  const r = await rt.client.del(`/users/${rt.uid}`);
  if (!r.ok) return falhaSem(r.code, r.motivo);
  Object.assign(rt, { devices: {}, lastPresenceAt: 0, criacaoGravada: false, status: STATUS.CONECTADO, lastError: null });
  avisarTela(engine);
  return { ok: true };
}

// O motivo sai do STATUS, não só do lastError: sem login e erro de rede pedem ações
// diferentes de quem lê, e um aparelho com login nunca pode ouvir que falta login.
function motivoDoAviso(rt) {
  if (rt.status === STATUS.SEM_CREDENCIAL) return motivoDe(SYNC_CODES.SEM_CREDENCIAL);
  return (rt.lastError && rt.lastError.motivo) || motivoDe(SYNC_CODES.INDISPONIVEL);
}

// 'conectando' é o boot e a reconexão: dura até o tick seguinte e segura a automação
// (fail-closed), mas ainda não há indisponibilidade a relatar. Se a conexão falhar, o
// status vira 'erro' e o aviso sai com o motivo real, uma vez por janela.
function avisarUmaVez(engine) {
  const rt = engine.sync;
  if (rt.avisou || rt.status === STATUS.CONECTANDO) return;
  rt.avisou = true;
  const motivo = motivoDoAviso(rt);
  if (typeof engine.emit === 'function') engine.emit('toast', { kind: 'info', text: `Coordenação entre aparelhos indisponível (${motivo}): a revisão automática espera a conexão voltar.` });
}

// O filtro das automações (toReview, reReviewTargets, retryTargets). Clique manual não
// passa por aqui: quem decide o clique é o preflight.
function seguraAutomacao(engine, key) {
  if (!coordenacaoAtiva(engine)) return false;
  const rt = engine.sync;
  if (rt.status !== STATUS.CONECTADO) {
    avisarUmaVez(engine);
    return true;
  }
  const e = rt.espera[key];
  return !!(e && e.until > Date.now());
}

// O gate de runClaudeStream (via fachada syncAdmit) e o preflight do clique manual.
// A decisão inteira mora no coordenador; aqui só a porta de entrada pelo engine.
function admit(engine, ctx) { return coordinator.admit(engine, ctx); }
function preflightManual(engine, pr) { return coordinator.preflightManual(engine, pr); }
function redoReceipt(engine, key) { return syncRedo.redoReceipt(engine, key); }

// Relógio LOCAL para a espera, porque quem compara é o filtro local; só a virada do
// dia sai do relógio do servidor (o teto é compartilhado) e volta convertida.
function fimDaEspera(rt, reason) {
  const agora = Date.now();
  if (reason === 'alheio') return agora + SYNC.ESPERA_ALHEIO_MS;
  if (reason === 'esgotado') return nextBrasiliaDayStartMs(rt.agora()) - rt.skewMs;
  if (reason === 'indisponivel') return agora + SYNC.STREAM_RECONNECT_MS;
  return 0;
}

// recibo não vira espera: o coordenador já marcou o PR como visto, e esperar um
// recibo vencer seria esperar 180 dias
function registrarEspera(engine, key, admissao) {
  const a = admissao || {};
  const until = fimDaEspera(engine.sync, a.reason);
  if (!until) return null;
  const detail = a.detail && typeof a.detail === 'object' ? a.detail : {};
  engine.sync.espera[key] = { reason: a.reason, deviceName: texto(detail.deviceName), until };
  return engine.sync.espera[key];
}

function listaDeAparelhos(rt) {
  return Object.entries(rt.devices).map(([deviceId, d]) => ({ deviceId, ...d, euMesmo: deviceId === rt.deviceId }));
}

// Projeção para a tela: allowlist. Nada de client, token, fetch ou credencial; o uid
// vai cortado porque a tela só precisa reconhecê-lo. O e-mail vai inteiro por exceção
// declarada: é o "Conectado como" da seção, e o snapshot é o único canal da tela. Ele
// continua fora de log, toast e resposta de rota.
function statusForUi(engine) {
  const rt = engine.sync || novoRuntime();
  const cfg = cfgDe(engine);
  const uid = rt.uid ? `${rt.uid.slice(0, UID_VISIVEL)}…` : '';
  const lastError = rt.lastError ? { ...rt.lastError } : null;
  return {
    enabled: cfg.enabled === true, coordination: coordinationActive(cfg), consolidation: consolidationActive(cfg),
    status: rt.status, lastError, uid, email: rt.email, deviceId: rt.deviceId, deviceName: rt.deviceName,
    devices: listaDeAparelhos(rt),
    espera: { ...rt.espera }, recibosVistos: { ...rt.recibosVistos }, leasesVistos: { ...rt.leasesVistos }, leasesOutros: rt.leasesOutros || 0,
    outbox: syncUsage.usageStatus(engine),
  };
}

export default {
  coordenacaoAtiva, consolidacaoAtiva, bootSync, startSync, stopSync, aplicarConfig, syncTick,
  touchPresence, syncLogin, syncLogout, syncTest, syncEraseRemote, statusForUi, seguraAutomacao, registrarEspera,
  admit, preflightManual, redoReceipt,
};
export {
  coordenacaoAtiva, consolidacaoAtiva, bootSync, startSync, stopSync, aplicarConfig, syncTick,
  touchPresence, syncLogin, syncLogout, syncTest, syncEraseRemote, statusForUi, seguraAutomacao, registrarEspera,
  admit, preflightManual, redoReceipt,
};
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('lib/engine/sync.js')).digest('hex').slice(0,16))"
```

Esperado: `3ac6b21eb0dbb2dc`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

- [ ] **Passo 2: gate e commit**

```bash
npm run check && npm run lint && npm test
```

Esperado: `fail 0` e `gate de qualidade: sem regressão`. Se algo falhar, PARE e relate; não mexa em outro arquivo para fazer passar.

```bash
git add lib/engine/sync-faxina.js lib/engine/sync-redo.js lib/engine/sync-stream.js lib/engine/sync-usage.js lib/engine/sync.js
git commit -m "feat(sync): runtime da sincronização, consumo, stream, faxina e refazer"
```


### Tarefa T16: Fiação no engine: config, rotas, snapshot e fachadas

É aqui que o runtime encosta no app: a entrada na tabela de settings (com o saneador injetado, senão o boot quebra), o gancho do consumo, as rotas, o snapshot e as fachadas. O pushback entra junto porque a fachada dele ganhou um parâmetro, e o teste que deriva a aridade do fonte reprova se implementação e fachada nascerem em commits diferentes.

**Arquivos:**
- Modificar: `lib/engine/pushback.js`
- Modificar: `lib/engine/usage.js`
- Modificar: `lib/http-server.js`
- Modificar: `lib/settings.js`
- Modificar: `server.js`
- Modificar: `test/facades.test.js`
- Criar: `test/sync-config.test.js`
- Criar: `test/sync-engine-boot.test.js`

- [ ] **Passo 1: escrever o teste**

Em `test/facades.test.js`, aplique as 3 substituições abaixo, NA ORDEM. Cada trecho "localize" aparece exatamente uma vez no arquivo no momento em que você aplica aquela substituição; copie-o sem mudar espaço nem acento.

1. Localize:

```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const { Engine } = await import('../server.js');

after(() => { try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

```

   Troque por:

```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const { Engine } = await import('../server.js');
const reviewMod = (await import('../lib/engine/review.js')).default;

after(() => { try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

```

2. Localize:

```js
  // pra repassar o agora explícito. Não é argumento engolido.
  reReviewTargets: 'terceiro parâmetro (agora) tem default, que trunca a contagem do Function.length no parâmetro com default',
  reReviewEsgotados: 'terceiro parâmetro (agora) tem default, que trunca a contagem do Function.length no parâmetro com default',
};

function mapaDeModulos() {
```

   Troque por:

```js
  // pra repassar o agora explícito. Não é argumento engolido.
  reReviewTargets: 'terceiro parâmetro (agora) tem default, que trunca a contagem do Function.length no parâmetro com default',
  reReviewEsgotados: 'terceiro parâmetro (agora) tem default, que trunca a contagem do Function.length no parâmetro com default',
  // O Function.length trunca dos DOIS lados aqui: impl é (engine, urls, mode = 'auto',
  // origem = 'auto', extras = {}) e para em 2; a fachada é (urls, mode = 'auto', ...) e
  // para em 1. A conta (2 - 1 = 1) fecha por coincidência, e fecharia igual se a fachada
  // tivesse esquecido o `extras`, que é justamente o que carrega os overrides do clique
  // (ignorarRecibo, semCoordenacao). Quem prova a passagem é o caso logo abaixo.
  launchReview: 'os dois lados têm parâmetro com default e a contagem fecha por coincidência; o repasse é provado por teste próprio',
};

function mapaDeModulos() {
```

3. Localize:

```js
      `EXCECOES tem "${nome}", mas nenhuma fachada com esse nome foi encontrada. Remova a exceção.`);
  }
});
```

   Troque por:

```js
      `EXCECOES tem "${nome}", mas nenhuma fachada com esse nome foi encontrada. Remova a exceção.`);
  }
});

// A conta do Function.length não vale para o launchReview (ver EXCECOES). Como é ele
// que carrega os overrides do clique, o repasse é provado de verdade: um argumento a
// mais esquecido na fachada chegaria undefined e falharia EM SILÊNCIO.
test('fachada launchReview repassa origem e extras até a implementação', async () => {
  const engine = new Engine();
  const vistos = [];
  engine.prFromUrl = () => null;
  engine.enqueueHeadless = () => {};
  engine.log = () => {};
  engine.pushState = () => {};
  const impl = reviewMod.launchReview;
  try {
    reviewMod.launchReview = async (...args) => { vistos.push(args.slice(1)); return { ok: true }; };
    await engine.launchReview(['https://github.com/o/r/pull/1'], 'auto', 'clique', { ignorarRecibo: true, semCoordenacao: true });
  } finally {
    reviewMod.launchReview = impl;
  }
  assert.deepEqual(vistos, [[['https://github.com/o/r/pull/1'], 'auto', 'clique', { ignorarRecibo: true, semCoordenacao: true }]]);
});
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('test/facades.test.js')).digest('hex').slice(0,16))"
```

Esperado: `ad8e2fa870de5d82`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

Crie `test/sync-config.test.js` com EXATAMENTE este conteúdo:

```js
// lib/sync/config.js: o saneador da chave `sync` do config.json. A sincronização é
// opt-in: nasce desligada, só liga com `true` explícito, e a URL do banco passa por
// allowlist de host (é para lá que o ID token viaja na query).
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const HOME = path.join(os.tmpdir(), 'farol-test-sync-config-' + process.pid);
process.env.FAROL_HOME = HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import cfgMod, {
  syncDefaults, parseSyncConfig, coordinationActive, consolidationActive, databaseUrlProblema, authUrlsFor,
} from '../lib/sync/config.js';
import { SYNC } from '../lib/constants.js';
import { EDITAVEIS, defaults, sanear } from '../lib/settings.js';

after(() => { try { fs.rmSync(HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const DB = 'https://farol-abc-default-rtdb.firebaseio.com';
const VALIDO = {
  enabled: true, coordination: { enabled: true }, consolidation: { enabled: true },
  deviceName: 'Notebook', apiKey: 'AIzaSyA-1234567890_abc', databaseUrl: DB, projectId: 'farol-abc',
};

test('syncDefaults: tudo desligado e vazio, objeto novo a cada chamada', () => {
  assert.deepEqual(syncDefaults(), {
    enabled: false, coordination: { enabled: false }, consolidation: { enabled: false },
    deviceName: '', apiKey: '', databaseUrl: '', projectId: '',
  });
  const a = syncDefaults();
  a.coordination.enabled = true;
  assert.equal(syncDefaults().coordination.enabled, false, 'mutar um não contamina o próximo');
});

test('parseSyncConfig: objeto válido passa inteiro', () => {
  assert.deepEqual(parseSyncConfig(VALIDO, syncDefaults()), VALIDO);
});

test('parseSyncConfig: devolve objeto NOVO, nunca a referência que chegou', () => {
  const saida = parseSyncConfig(VALIDO, syncDefaults());
  assert.notEqual(saida, VALIDO);
  assert.notEqual(saida.coordination, VALIDO.coordination);
  assert.notEqual(saida.consolidation, VALIDO.consolidation);
});

test('parseSyncConfig: os três interruptores só ligam com true explícito', () => {
  for (const v of ['true', 1, 'sim', {}, [], null]) {
    const s = parseSyncConfig({ enabled: v, coordination: { enabled: v }, consolidation: { enabled: v } }, syncDefaults());
    assert.equal(s.enabled, false, String(v));
    assert.equal(s.coordination.enabled, false, String(v));
    assert.equal(s.consolidation.enabled, false, String(v));
  }
  const s = parseSyncConfig({ enabled: true, coordination: true, consolidation: 'x' }, syncDefaults());
  assert.equal(s.coordination.enabled, false, 'interruptor que não é objeto não liga');
  assert.equal(s.consolidation.enabled, false);
});

test('parseSyncConfig: valor lixo não liga nada', () => {
  for (const lixo of [undefined, null, 'ligado', 42, true, [], [VALIDO]]) {
    const s = parseSyncConfig(lixo, syncDefaults());
    assert.deepEqual(s, syncDefaults(), String(lixo));
  }
});

test('parseSyncConfig: deviceName aparado e cortado em 40', () => {
  assert.equal(parseSyncConfig({ deviceName: '  Mac do trabalho  ' }, syncDefaults()).deviceName, 'Mac do trabalho');
  assert.equal(parseSyncConfig({ deviceName: 'x'.repeat(60) }, syncDefaults()).deviceName.length, 40);
  assert.equal(parseSyncConfig({ deviceName: { a: 1 } }, syncDefaults()).deviceName, '');
});

test('parseSyncConfig: apiKey e projectId por allowlist, inválido vira vazio', () => {
  for (const ruim of ['curta', 'tem espaço dentro', 'a'.repeat(129), 'aspas"aqui123', 'subshell$(x)1234']) {
    assert.equal(parseSyncConfig({ apiKey: ruim }, syncDefaults()).apiKey, '', ruim);
  }
  assert.equal(parseSyncConfig({ apiKey: 'a'.repeat(128) }, syncDefaults()).apiKey, 'a'.repeat(128));
  for (const ruim of ['Farol', 'farol_x', 'a'.repeat(65), 'a b', '']) {
    assert.equal(parseSyncConfig({ projectId: ruim }, syncDefaults()).projectId, '', ruim);
  }
  assert.equal(parseSyncConfig({ projectId: 'farol-local' }, syncDefaults()).projectId, 'farol-local');
});

test('databaseUrlProblema: hosts do Firebase em https e emulador em http local', () => {
  for (const ok of [DB, DB + '/', 'https://x.europe-west1.firebasedatabase.app', 'http://127.0.0.1:9000', 'http://localhost:9000']) {
    assert.equal(databaseUrlProblema(ok), '', ok);
  }
  for (const ruim of [
    'http://farol-abc.firebaseio.com', 'https://evil.com', 'https://firebaseio.com', 'https://x.firebaseio.com.evil.com',
    DB + '/users', DB + '?auth=x', 'https://u:p@x.firebaseio.com', 'https://localhost:9000', 'http://10.0.0.1:9000',
    'ftp://x.firebaseio.com', 'nao e url', '', undefined, null, 42,
  ]) {
    const p = databaseUrlProblema(ruim);
    assert.equal(typeof p, 'string', String(ruim));
    assert.ok(p.length > 0, `devia recusar ${String(ruim)}`);
    assert.doesNotMatch(p, /\u2014/, 'frase de tela sem travessão');
  }
});

test('parseSyncConfig: databaseUrl válida sai sem barra final', () => {
  assert.equal(parseSyncConfig({ databaseUrl: DB + '/' }, syncDefaults()).databaseUrl, DB);
  assert.equal(parseSyncConfig({ databaseUrl: '  ' + DB + '  ' }, syncDefaults()).databaseUrl, DB);
});

test('parseSyncConfig: emulador http://127.0.0.1:9000 é aceito', () => {
  assert.equal(parseSyncConfig({ databaseUrl: 'http://127.0.0.1:9000' }, syncDefaults()).databaseUrl, 'http://127.0.0.1:9000');
});

test('parseSyncConfig: databaseUrl inválida mantém a anterior (ou vazio sem anterior)', () => {
  const atual = { ...syncDefaults(), databaseUrl: DB };
  assert.equal(parseSyncConfig({ databaseUrl: 'https://evil.com' }, atual).databaseUrl, DB);
  assert.equal(parseSyncConfig({ databaseUrl: 'https://evil.com' }, undefined).databaseUrl, '');
  assert.equal(parseSyncConfig({ databaseUrl: 'https://evil.com' }, null).databaseUrl, '');
});

test('parseSyncConfig: http em host remoto é recusado', () => {
  const atual = { ...syncDefaults(), databaseUrl: DB };
  assert.equal(parseSyncConfig({ databaseUrl: 'http://farol-abc.firebaseio.com' }, atual).databaseUrl, DB);
  assert.equal(parseSyncConfig({ databaseUrl: 'http://192.168.0.10:9000' }, syncDefaults()).databaseUrl, '');
});

test('parseSyncConfig: databaseUrl vazia de propósito limpa o campo', () => {
  const atual = { ...syncDefaults(), databaseUrl: DB };
  assert.equal(parseSyncConfig({ databaseUrl: '' }, atual).databaseUrl, '');
  assert.equal(parseSyncConfig({ databaseUrl: '   ' }, atual).databaseUrl, '');
});

test('coordinationActive e consolidationActive exigem o interruptor geral E o próprio', () => {
  assert.equal(coordinationActive(VALIDO), true);
  assert.equal(consolidationActive(VALIDO), true);
  assert.equal(coordinationActive({ ...VALIDO, enabled: false }), false);
  assert.equal(consolidationActive({ ...VALIDO, enabled: false }), false);
  assert.equal(coordinationActive({ ...VALIDO, coordination: { enabled: false } }), false);
  assert.equal(consolidationActive({ ...VALIDO, consolidation: { enabled: 'true' } }), false);
  for (const v of [undefined, null, {}, 'x']) {
    assert.equal(coordinationActive(v), false);
    assert.equal(consolidationActive(v), false);
  }
});

test('settings: sync está na tabela, é editável e nasce com os defaults do módulo', () => {
  assert.ok(EDITAVEIS.has('sync'));
  assert.deepEqual(defaults().sync, syncDefaults());
});

test('settings: o saneador da tabela é o parseSyncConfig e recebe o sync atual', () => {
  const atual = { sync: { ...syncDefaults(), databaseUrl: DB } };
  const s = sanear('sync', { enabled: true, databaseUrl: 'https://evil.com' }, atual, { parseSyncConfig });
  assert.equal(s.enabled, true);
  assert.equal(s.databaseUrl, DB);
});

test('export default carrega o mesmo contrato dos nomeados', () => {
  assert.equal(cfgMod.parseSyncConfig, parseSyncConfig);
  assert.equal(cfgMod.databaseUrlProblema, databaseUrlProblema);
  assert.equal(cfgMod.authUrlsFor, authUrlsFor);
});

test('authUrlsFor: banco de produção usa o Auth de produção', () => {
  const producao = { identityUrl: SYNC.IDENTITY_TOOLKIT_URL, tokenUrl: SYNC.SECURE_TOKEN_URL };
  assert.deepEqual(authUrlsFor(DB), producao);
  assert.deepEqual(authUrlsFor('https://x-default-rtdb.europe-west1.firebasedatabase.app'), producao);
});

test('authUrlsFor: banco do emulador (http local) usa o Auth do emulador', () => {
  const emulador = { identityUrl: SYNC.AUTH_EMULATOR_IDENTITY_URL, tokenUrl: SYNC.AUTH_EMULATOR_TOKEN_URL };
  assert.deepEqual(authUrlsFor('http://127.0.0.1:9000'), emulador);
  assert.deepEqual(authUrlsFor('http://localhost:9000'), emulador);
});

test('authUrlsFor: URL inválida ou http remoto nunca desvia o login', () => {
  const producao = { identityUrl: SYNC.IDENTITY_TOOLKIT_URL, tokenUrl: SYNC.SECURE_TOKEN_URL };
  for (const u of ['', null, 'http://exemplo.com:9000', 'lixo', 'http://127.0.0.1:9000/caminho']) {
    assert.deepEqual(authUrlsFor(u), producao, String(u));
  }
});

/* ---------- boot da Engine ---------- */

const { Engine } = await import('../server.js');
const CONFIG = path.join(HOME, 'config.json');

function comConfig(obj) {
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(CONFIG, JSON.stringify(obj));
  return new Engine();
}

test('boot: config.json sem sync inicia com a sincronização desligada', () => {
  const { config } = comConfig({ autoReview: false });
  assert.deepEqual(config.sync, syncDefaults());
  assert.equal(config.sync.enabled, false);
});

test('boot: sync lixo no config.json não liga nada', () => {
  for (const lixo of ['ligado', 1, true, [1, 2], { enabled: 'true', coordination: 1 }]) {
    const { config } = comConfig({ autoReview: false, sync: lixo });
    assert.equal(config.sync.enabled, false, JSON.stringify(lixo));
    assert.equal(config.sync.coordination.enabled, false);
    assert.equal(config.sync.consolidation.enabled, false);
  }
});

test('boot: databaseUrl editada à mão com host estranho é descartada', () => {
  const { config } = comConfig({ autoReview: false, sync: { ...VALIDO, databaseUrl: 'https://evil.com' } });
  assert.equal(config.sync.databaseUrl, '');
  assert.equal(config.sync.enabled, true, 'o resto do objeto válido fica');
});

test('updateSettings: sync passa pelo saneador e URL inválida mantém a anterior', () => {
  const engine = comConfig({ autoReview: false, sync: VALIDO });
  const r = engine.updateSettings({ sync: { ...VALIDO, databaseUrl: 'http://evil.com', apiKey: 'x' } });
  assert.deepEqual(r.ignoradas, []);
  assert.equal(engine.config.sync.databaseUrl, DB);
  assert.equal(engine.config.sync.apiKey, '');
});
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('test/sync-config.test.js')).digest('hex').slice(0,16))"
```

Esperado: `afe560999d52b8bc`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.
Este arquivo tem sequências de escape que a transcrição costuma normalizar sem querer. Se o hash não bater na segunda tentativa, PARE de transcrever e materialize-o com o comando abaixo, que grava os bytes exatos:

```bash
node -e "require('fs').writeFileSync('test/sync-config.test.js', Buffer.from(process.argv[1],'base64'))" Ly8gbGliL3N5bmMvY29uZmlnLmpzOiBvIHNhbmVhZG9yIGRhIGNoYXZlIGBzeW5jYCBkbyBjb25maWcuanNvbi4gQSBzaW5jcm9uaXphw6fDo28gw6kKLy8gb3B0LWluOiBuYXNjZSBkZXNsaWdhZGEsIHPDsyBsaWdhIGNvbSBgdHJ1ZWAgZXhwbMOtY2l0bywgZSBhIFVSTCBkbyBiYW5jbyBwYXNzYSBwb3IKLy8gYWxsb3dsaXN0IGRlIGhvc3QgKMOpIHBhcmEgbMOhIHF1ZSBvIElEIHRva2VuIHZpYWphIG5hIHF1ZXJ5KS4KaW1wb3J0IG9zIGZyb20gJ25vZGU6b3MnOwppbXBvcnQgcGF0aCBmcm9tICdub2RlOnBhdGgnOwppbXBvcnQgZnMgZnJvbSAnbm9kZTpmcyc7Cgpjb25zdCBIT01FID0gcGF0aC5qb2luKG9zLnRtcGRpcigpLCAnZmFyb2wtdGVzdC1zeW5jLWNvbmZpZy0nICsgcHJvY2Vzcy5waWQpOwpwcm9jZXNzLmVudi5GQVJPTF9IT01FID0gSE9NRTsKCmltcG9ydCB7IHRlc3QsIGFmdGVyIH0gZnJvbSAnbm9kZTp0ZXN0JzsKaW1wb3J0IGFzc2VydCBmcm9tICdub2RlOmFzc2VydC9zdHJpY3QnOwppbXBvcnQgY2ZnTW9kLCB7CiAgc3luY0RlZmF1bHRzLCBwYXJzZVN5bmNDb25maWcsIGNvb3JkaW5hdGlvbkFjdGl2ZSwgY29uc29saWRhdGlvbkFjdGl2ZSwgZGF0YWJhc2VVcmxQcm9ibGVtYSwgYXV0aFVybHNGb3IsCn0gZnJvbSAnLi4vbGliL3N5bmMvY29uZmlnLmpzJzsKaW1wb3J0IHsgU1lOQyB9IGZyb20gJy4uL2xpYi9jb25zdGFudHMuanMnOwppbXBvcnQgeyBFRElUQVZFSVMsIGRlZmF1bHRzLCBzYW5lYXIgfSBmcm9tICcuLi9saWIvc2V0dGluZ3MuanMnOwoKYWZ0ZXIoKCkgPT4geyB0cnkgeyBmcy5ybVN5bmMoSE9NRSwgeyByZWN1cnNpdmU6IHRydWUsIGZvcmNlOiB0cnVlIH0pOyB9IGNhdGNoIHsgLyogYmVzdC1lZmZvcnQgKi8gfSB9KTsKCmNvbnN0IERCID0gJ2h0dHBzOi8vZmFyb2wtYWJjLWRlZmF1bHQtcnRkYi5maXJlYmFzZWlvLmNvbSc7CmNvbnN0IFZBTElETyA9IHsKICBlbmFibGVkOiB0cnVlLCBjb29yZGluYXRpb246IHsgZW5hYmxlZDogdHJ1ZSB9LCBjb25zb2xpZGF0aW9uOiB7IGVuYWJsZWQ6IHRydWUgfSwKICBkZXZpY2VOYW1lOiAnTm90ZWJvb2snLCBhcGlLZXk6ICdBSXphU3lBLTEyMzQ1Njc4OTBfYWJjJywgZGF0YWJhc2VVcmw6IERCLCBwcm9qZWN0SWQ6ICdmYXJvbC1hYmMnLAp9OwoKdGVzdCgnc3luY0RlZmF1bHRzOiB0dWRvIGRlc2xpZ2FkbyBlIHZhemlvLCBvYmpldG8gbm92byBhIGNhZGEgY2hhbWFkYScsICgpID0+IHsKICBhc3NlcnQuZGVlcEVxdWFsKHN5bmNEZWZhdWx0cygpLCB7CiAgICBlbmFibGVkOiBmYWxzZSwgY29vcmRpbmF0aW9uOiB7IGVuYWJsZWQ6IGZhbHNlIH0sIGNvbnNvbGlkYXRpb246IHsgZW5hYmxlZDogZmFsc2UgfSwKICAgIGRldmljZU5hbWU6ICcnLCBhcGlLZXk6ICcnLCBkYXRhYmFzZVVybDogJycsIHByb2plY3RJZDogJycsCiAgfSk7CiAgY29uc3QgYSA9IHN5bmNEZWZhdWx0cygpOwogIGEuY29vcmRpbmF0aW9uLmVuYWJsZWQgPSB0cnVlOwogIGFzc2VydC5lcXVhbChzeW5jRGVmYXVsdHMoKS5jb29yZGluYXRpb24uZW5hYmxlZCwgZmFsc2UsICdtdXRhciB1bSBuw6NvIGNvbnRhbWluYSBvIHByw7N4aW1vJyk7Cn0pOwoKdGVzdCgncGFyc2VTeW5jQ29uZmlnOiBvYmpldG8gdsOhbGlkbyBwYXNzYSBpbnRlaXJvJywgKCkgPT4gewogIGFzc2VydC5kZWVwRXF1YWwocGFyc2VTeW5jQ29uZmlnKFZBTElETywgc3luY0RlZmF1bHRzKCkpLCBWQUxJRE8pOwp9KTsKCnRlc3QoJ3BhcnNlU3luY0NvbmZpZzogZGV2b2x2ZSBvYmpldG8gTk9WTywgbnVuY2EgYSByZWZlcsOqbmNpYSBxdWUgY2hlZ291JywgKCkgPT4gewogIGNvbnN0IHNhaWRhID0gcGFyc2VTeW5jQ29uZmlnKFZBTElETywgc3luY0RlZmF1bHRzKCkpOwogIGFzc2VydC5ub3RFcXVhbChzYWlkYSwgVkFMSURPKTsKICBhc3NlcnQubm90RXF1YWwoc2FpZGEuY29vcmRpbmF0aW9uLCBWQUxJRE8uY29vcmRpbmF0aW9uKTsKICBhc3NlcnQubm90RXF1YWwoc2FpZGEuY29uc29saWRhdGlvbiwgVkFMSURPLmNvbnNvbGlkYXRpb24pOwp9KTsKCnRlc3QoJ3BhcnNlU3luY0NvbmZpZzogb3MgdHLDqnMgaW50ZXJydXB0b3JlcyBzw7MgbGlnYW0gY29tIHRydWUgZXhwbMOtY2l0bycsICgpID0+IHsKICBmb3IgKGNvbnN0IHYgb2YgWyd0cnVlJywgMSwgJ3NpbScsIHt9LCBbXSwgbnVsbF0pIHsKICAgIGNvbnN0IHMgPSBwYXJzZVN5bmNDb25maWcoeyBlbmFibGVkOiB2LCBjb29yZGluYXRpb246IHsgZW5hYmxlZDogdiB9LCBjb25zb2xpZGF0aW9uOiB7IGVuYWJsZWQ6IHYgfSB9LCBzeW5jRGVmYXVsdHMoKSk7CiAgICBhc3NlcnQuZXF1YWwocy5lbmFibGVkLCBmYWxzZSwgU3RyaW5nKHYpKTsKICAgIGFzc2VydC5lcXVhbChzLmNvb3JkaW5hdGlvbi5lbmFibGVkLCBmYWxzZSwgU3RyaW5nKHYpKTsKICAgIGFzc2VydC5lcXVhbChzLmNvbnNvbGlkYXRpb24uZW5hYmxlZCwgZmFsc2UsIFN0cmluZyh2KSk7CiAgfQogIGNvbnN0IHMgPSBwYXJzZVN5bmNDb25maWcoeyBlbmFibGVkOiB0cnVlLCBjb29yZGluYXRpb246IHRydWUsIGNvbnNvbGlkYXRpb246ICd4JyB9LCBzeW5jRGVmYXVsdHMoKSk7CiAgYXNzZXJ0LmVxdWFsKHMuY29vcmRpbmF0aW9uLmVuYWJsZWQsIGZhbHNlLCAnaW50ZXJydXB0b3IgcXVlIG7Do28gw6kgb2JqZXRvIG7Do28gbGlnYScpOwogIGFzc2VydC5lcXVhbChzLmNvbnNvbGlkYXRpb24uZW5hYmxlZCwgZmFsc2UpOwp9KTsKCnRlc3QoJ3BhcnNlU3luY0NvbmZpZzogdmFsb3IgbGl4byBuw6NvIGxpZ2EgbmFkYScsICgpID0+IHsKICBmb3IgKGNvbnN0IGxpeG8gb2YgW3VuZGVmaW5lZCwgbnVsbCwgJ2xpZ2FkbycsIDQyLCB0cnVlLCBbXSwgW1ZBTElET11dKSB7CiAgICBjb25zdCBzID0gcGFyc2VTeW5jQ29uZmlnKGxpeG8sIHN5bmNEZWZhdWx0cygpKTsKICAgIGFzc2VydC5kZWVwRXF1YWwocywgc3luY0RlZmF1bHRzKCksIFN0cmluZyhsaXhvKSk7CiAgfQp9KTsKCnRlc3QoJ3BhcnNlU3luY0NvbmZpZzogZGV2aWNlTmFtZSBhcGFyYWRvIGUgY29ydGFkbyBlbSA0MCcsICgpID0+IHsKICBhc3NlcnQuZXF1YWwocGFyc2VTeW5jQ29uZmlnKHsgZGV2aWNlTmFtZTogJyAgTWFjIGRvIHRyYWJhbGhvICAnIH0sIHN5bmNEZWZhdWx0cygpKS5kZXZpY2VOYW1lLCAnTWFjIGRvIHRyYWJhbGhvJyk7CiAgYXNzZXJ0LmVxdWFsKHBhcnNlU3luY0NvbmZpZyh7IGRldmljZU5hbWU6ICd4Jy5yZXBlYXQoNjApIH0sIHN5bmNEZWZhdWx0cygpKS5kZXZpY2VOYW1lLmxlbmd0aCwgNDApOwogIGFzc2VydC5lcXVhbChwYXJzZVN5bmNDb25maWcoeyBkZXZpY2VOYW1lOiB7IGE6IDEgfSB9LCBzeW5jRGVmYXVsdHMoKSkuZGV2aWNlTmFtZSwgJycpOwp9KTsKCnRlc3QoJ3BhcnNlU3luY0NvbmZpZzogYXBpS2V5IGUgcHJvamVjdElkIHBvciBhbGxvd2xpc3QsIGludsOhbGlkbyB2aXJhIHZhemlvJywgKCkgPT4gewogIGZvciAoY29uc3QgcnVpbSBvZiBbJ2N1cnRhJywgJ3RlbSBlc3Bhw6dvIGRlbnRybycsICdhJy5yZXBlYXQoMTI5KSwgJ2FzcGFzImFxdWkxMjMnLCAnc3Vic2hlbGwkKHgpMTIzNCddKSB7CiAgICBhc3NlcnQuZXF1YWwocGFyc2VTeW5jQ29uZmlnKHsgYXBpS2V5OiBydWltIH0sIHN5bmNEZWZhdWx0cygpKS5hcGlLZXksICcnLCBydWltKTsKICB9CiAgYXNzZXJ0LmVxdWFsKHBhcnNlU3luY0NvbmZpZyh7IGFwaUtleTogJ2EnLnJlcGVhdCgxMjgpIH0sIHN5bmNEZWZhdWx0cygpKS5hcGlLZXksICdhJy5yZXBlYXQoMTI4KSk7CiAgZm9yIChjb25zdCBydWltIG9mIFsnRmFyb2wnLCAnZmFyb2xfeCcsICdhJy5yZXBlYXQoNjUpLCAnYSBiJywgJyddKSB7CiAgICBhc3NlcnQuZXF1YWwocGFyc2VTeW5jQ29uZmlnKHsgcHJvamVjdElkOiBydWltIH0sIHN5bmNEZWZhdWx0cygpKS5wcm9qZWN0SWQsICcnLCBydWltKTsKICB9CiAgYXNzZXJ0LmVxdWFsKHBhcnNlU3luY0NvbmZpZyh7IHByb2plY3RJZDogJ2Zhcm9sLWxvY2FsJyB9LCBzeW5jRGVmYXVsdHMoKSkucHJvamVjdElkLCAnZmFyb2wtbG9jYWwnKTsKfSk7Cgp0ZXN0KCdkYXRhYmFzZVVybFByb2JsZW1hOiBob3N0cyBkbyBGaXJlYmFzZSBlbSBodHRwcyBlIGVtdWxhZG9yIGVtIGh0dHAgbG9jYWwnLCAoKSA9PiB7CiAgZm9yIChjb25zdCBvayBvZiBbREIsIERCICsgJy8nLCAnaHR0cHM6Ly94LmV1cm9wZS13ZXN0MS5maXJlYmFzZWRhdGFiYXNlLmFwcCcsICdodHRwOi8vMTI3LjAuMC4xOjkwMDAnLCAnaHR0cDovL2xvY2FsaG9zdDo5MDAwJ10pIHsKICAgIGFzc2VydC5lcXVhbChkYXRhYmFzZVVybFByb2JsZW1hKG9rKSwgJycsIG9rKTsKICB9CiAgZm9yIChjb25zdCBydWltIG9mIFsKICAgICdodHRwOi8vZmFyb2wtYWJjLmZpcmViYXNlaW8uY29tJywgJ2h0dHBzOi8vZXZpbC5jb20nLCAnaHR0cHM6Ly9maXJlYmFzZWlvLmNvbScsICdodHRwczovL3guZmlyZWJhc2Vpby5jb20uZXZpbC5jb20nLAogICAgREIgKyAnL3VzZXJzJywgREIgKyAnP2F1dGg9eCcsICdodHRwczovL3U6cEB4LmZpcmViYXNlaW8uY29tJywgJ2h0dHBzOi8vbG9jYWxob3N0OjkwMDAnLCAnaHR0cDovLzEwLjAuMC4xOjkwMDAnLAogICAgJ2Z0cDovL3guZmlyZWJhc2Vpby5jb20nLCAnbmFvIGUgdXJsJywgJycsIHVuZGVmaW5lZCwgbnVsbCwgNDIsCiAgXSkgewogICAgY29uc3QgcCA9IGRhdGFiYXNlVXJsUHJvYmxlbWEocnVpbSk7CiAgICBhc3NlcnQuZXF1YWwodHlwZW9mIHAsICdzdHJpbmcnLCBTdHJpbmcocnVpbSkpOwogICAgYXNzZXJ0Lm9rKHAubGVuZ3RoID4gMCwgYGRldmlhIHJlY3VzYXIgJHtTdHJpbmcocnVpbSl9YCk7CiAgICBhc3NlcnQuZG9lc05vdE1hdGNoKHAsIC9cdTIwMTQvLCAnZnJhc2UgZGUgdGVsYSBzZW0gdHJhdmVzc8OjbycpOwogIH0KfSk7Cgp0ZXN0KCdwYXJzZVN5bmNDb25maWc6IGRhdGFiYXNlVXJsIHbDoWxpZGEgc2FpIHNlbSBiYXJyYSBmaW5hbCcsICgpID0+IHsKICBhc3NlcnQuZXF1YWwocGFyc2VTeW5jQ29uZmlnKHsgZGF0YWJhc2VVcmw6IERCICsgJy8nIH0sIHN5bmNEZWZhdWx0cygpKS5kYXRhYmFzZVVybCwgREIpOwogIGFzc2VydC5lcXVhbChwYXJzZVN5bmNDb25maWcoeyBkYXRhYmFzZVVybDogJyAgJyArIERCICsgJyAgJyB9LCBzeW5jRGVmYXVsdHMoKSkuZGF0YWJhc2VVcmwsIERCKTsKfSk7Cgp0ZXN0KCdwYXJzZVN5bmNDb25maWc6IGVtdWxhZG9yIGh0dHA6Ly8xMjcuMC4wLjE6OTAwMCDDqSBhY2VpdG8nLCAoKSA9PiB7CiAgYXNzZXJ0LmVxdWFsKHBhcnNlU3luY0NvbmZpZyh7IGRhdGFiYXNlVXJsOiAnaHR0cDovLzEyNy4wLjAuMTo5MDAwJyB9LCBzeW5jRGVmYXVsdHMoKSkuZGF0YWJhc2VVcmwsICdodHRwOi8vMTI3LjAuMC4xOjkwMDAnKTsKfSk7Cgp0ZXN0KCdwYXJzZVN5bmNDb25maWc6IGRhdGFiYXNlVXJsIGludsOhbGlkYSBtYW50w6ltIGEgYW50ZXJpb3IgKG91IHZhemlvIHNlbSBhbnRlcmlvciknLCAoKSA9PiB7CiAgY29uc3QgYXR1YWwgPSB7IC4uLnN5bmNEZWZhdWx0cygpLCBkYXRhYmFzZVVybDogREIgfTsKICBhc3NlcnQuZXF1YWwocGFyc2VTeW5jQ29uZmlnKHsgZGF0YWJhc2VVcmw6ICdodHRwczovL2V2aWwuY29tJyB9LCBhdHVhbCkuZGF0YWJhc2VVcmwsIERCKTsKICBhc3NlcnQuZXF1YWwocGFyc2VTeW5jQ29uZmlnKHsgZGF0YWJhc2VVcmw6ICdodHRwczovL2V2aWwuY29tJyB9LCB1bmRlZmluZWQpLmRhdGFiYXNlVXJsLCAnJyk7CiAgYXNzZXJ0LmVxdWFsKHBhcnNlU3luY0NvbmZpZyh7IGRhdGFiYXNlVXJsOiAnaHR0cHM6Ly9ldmlsLmNvbScgfSwgbnVsbCkuZGF0YWJhc2VVcmwsICcnKTsKfSk7Cgp0ZXN0KCdwYXJzZVN5bmNDb25maWc6IGh0dHAgZW0gaG9zdCByZW1vdG8gw6kgcmVjdXNhZG8nLCAoKSA9PiB7CiAgY29uc3QgYXR1YWwgPSB7IC4uLnN5bmNEZWZhdWx0cygpLCBkYXRhYmFzZVVybDogREIgfTsKICBhc3NlcnQuZXF1YWwocGFyc2VTeW5jQ29uZmlnKHsgZGF0YWJhc2VVcmw6ICdodHRwOi8vZmFyb2wtYWJjLmZpcmViYXNlaW8uY29tJyB9LCBhdHVhbCkuZGF0YWJhc2VVcmwsIERCKTsKICBhc3NlcnQuZXF1YWwocGFyc2VTeW5jQ29uZmlnKHsgZGF0YWJhc2VVcmw6ICdodHRwOi8vMTkyLjE2OC4wLjEwOjkwMDAnIH0sIHN5bmNEZWZhdWx0cygpKS5kYXRhYmFzZVVybCwgJycpOwp9KTsKCnRlc3QoJ3BhcnNlU3luY0NvbmZpZzogZGF0YWJhc2VVcmwgdmF6aWEgZGUgcHJvcMOzc2l0byBsaW1wYSBvIGNhbXBvJywgKCkgPT4gewogIGNvbnN0IGF0dWFsID0geyAuLi5zeW5jRGVmYXVsdHMoKSwgZGF0YWJhc2VVcmw6IERCIH07CiAgYXNzZXJ0LmVxdWFsKHBhcnNlU3luY0NvbmZpZyh7IGRhdGFiYXNlVXJsOiAnJyB9LCBhdHVhbCkuZGF0YWJhc2VVcmwsICcnKTsKICBhc3NlcnQuZXF1YWwocGFyc2VTeW5jQ29uZmlnKHsgZGF0YWJhc2VVcmw6ICcgICAnIH0sIGF0dWFsKS5kYXRhYmFzZVVybCwgJycpOwp9KTsKCnRlc3QoJ2Nvb3JkaW5hdGlvbkFjdGl2ZSBlIGNvbnNvbGlkYXRpb25BY3RpdmUgZXhpZ2VtIG8gaW50ZXJydXB0b3IgZ2VyYWwgRSBvIHByw7NwcmlvJywgKCkgPT4gewogIGFzc2VydC5lcXVhbChjb29yZGluYXRpb25BY3RpdmUoVkFMSURPKSwgdHJ1ZSk7CiAgYXNzZXJ0LmVxdWFsKGNvbnNvbGlkYXRpb25BY3RpdmUoVkFMSURPKSwgdHJ1ZSk7CiAgYXNzZXJ0LmVxdWFsKGNvb3JkaW5hdGlvbkFjdGl2ZSh7IC4uLlZBTElETywgZW5hYmxlZDogZmFsc2UgfSksIGZhbHNlKTsKICBhc3NlcnQuZXF1YWwoY29uc29saWRhdGlvbkFjdGl2ZSh7IC4uLlZBTElETywgZW5hYmxlZDogZmFsc2UgfSksIGZhbHNlKTsKICBhc3NlcnQuZXF1YWwoY29vcmRpbmF0aW9uQWN0aXZlKHsgLi4uVkFMSURPLCBjb29yZGluYXRpb246IHsgZW5hYmxlZDogZmFsc2UgfSB9KSwgZmFsc2UpOwogIGFzc2VydC5lcXVhbChjb25zb2xpZGF0aW9uQWN0aXZlKHsgLi4uVkFMSURPLCBjb25zb2xpZGF0aW9uOiB7IGVuYWJsZWQ6ICd0cnVlJyB9IH0pLCBmYWxzZSk7CiAgZm9yIChjb25zdCB2IG9mIFt1bmRlZmluZWQsIG51bGwsIHt9LCAneCddKSB7CiAgICBhc3NlcnQuZXF1YWwoY29vcmRpbmF0aW9uQWN0aXZlKHYpLCBmYWxzZSk7CiAgICBhc3NlcnQuZXF1YWwoY29uc29saWRhdGlvbkFjdGl2ZSh2KSwgZmFsc2UpOwogIH0KfSk7Cgp0ZXN0KCdzZXR0aW5nczogc3luYyBlc3TDoSBuYSB0YWJlbGEsIMOpIGVkaXTDoXZlbCBlIG5hc2NlIGNvbSBvcyBkZWZhdWx0cyBkbyBtw7NkdWxvJywgKCkgPT4gewogIGFzc2VydC5vayhFRElUQVZFSVMuaGFzKCdzeW5jJykpOwogIGFzc2VydC5kZWVwRXF1YWwoZGVmYXVsdHMoKS5zeW5jLCBzeW5jRGVmYXVsdHMoKSk7Cn0pOwoKdGVzdCgnc2V0dGluZ3M6IG8gc2FuZWFkb3IgZGEgdGFiZWxhIMOpIG8gcGFyc2VTeW5jQ29uZmlnIGUgcmVjZWJlIG8gc3luYyBhdHVhbCcsICgpID0+IHsKICBjb25zdCBhdHVhbCA9IHsgc3luYzogeyAuLi5zeW5jRGVmYXVsdHMoKSwgZGF0YWJhc2VVcmw6IERCIH0gfTsKICBjb25zdCBzID0gc2FuZWFyKCdzeW5jJywgeyBlbmFibGVkOiB0cnVlLCBkYXRhYmFzZVVybDogJ2h0dHBzOi8vZXZpbC5jb20nIH0sIGF0dWFsLCB7IHBhcnNlU3luY0NvbmZpZyB9KTsKICBhc3NlcnQuZXF1YWwocy5lbmFibGVkLCB0cnVlKTsKICBhc3NlcnQuZXF1YWwocy5kYXRhYmFzZVVybCwgREIpOwp9KTsKCnRlc3QoJ2V4cG9ydCBkZWZhdWx0IGNhcnJlZ2EgbyBtZXNtbyBjb250cmF0byBkb3Mgbm9tZWFkb3MnLCAoKSA9PiB7CiAgYXNzZXJ0LmVxdWFsKGNmZ01vZC5wYXJzZVN5bmNDb25maWcsIHBhcnNlU3luY0NvbmZpZyk7CiAgYXNzZXJ0LmVxdWFsKGNmZ01vZC5kYXRhYmFzZVVybFByb2JsZW1hLCBkYXRhYmFzZVVybFByb2JsZW1hKTsKICBhc3NlcnQuZXF1YWwoY2ZnTW9kLmF1dGhVcmxzRm9yLCBhdXRoVXJsc0Zvcik7Cn0pOwoKdGVzdCgnYXV0aFVybHNGb3I6IGJhbmNvIGRlIHByb2R1w6fDo28gdXNhIG8gQXV0aCBkZSBwcm9kdcOnw6NvJywgKCkgPT4gewogIGNvbnN0IHByb2R1Y2FvID0geyBpZGVudGl0eVVybDogU1lOQy5JREVOVElUWV9UT09MS0lUX1VSTCwgdG9rZW5Vcmw6IFNZTkMuU0VDVVJFX1RPS0VOX1VSTCB9OwogIGFzc2VydC5kZWVwRXF1YWwoYXV0aFVybHNGb3IoREIpLCBwcm9kdWNhbyk7CiAgYXNzZXJ0LmRlZXBFcXVhbChhdXRoVXJsc0ZvcignaHR0cHM6Ly94LWRlZmF1bHQtcnRkYi5ldXJvcGUtd2VzdDEuZmlyZWJhc2VkYXRhYmFzZS5hcHAnKSwgcHJvZHVjYW8pOwp9KTsKCnRlc3QoJ2F1dGhVcmxzRm9yOiBiYW5jbyBkbyBlbXVsYWRvciAoaHR0cCBsb2NhbCkgdXNhIG8gQXV0aCBkbyBlbXVsYWRvcicsICgpID0+IHsKICBjb25zdCBlbXVsYWRvciA9IHsgaWRlbnRpdHlVcmw6IFNZTkMuQVVUSF9FTVVMQVRPUl9JREVOVElUWV9VUkwsIHRva2VuVXJsOiBTWU5DLkFVVEhfRU1VTEFUT1JfVE9LRU5fVVJMIH07CiAgYXNzZXJ0LmRlZXBFcXVhbChhdXRoVXJsc0ZvcignaHR0cDovLzEyNy4wLjAuMTo5MDAwJyksIGVtdWxhZG9yKTsKICBhc3NlcnQuZGVlcEVxdWFsKGF1dGhVcmxzRm9yKCdodHRwOi8vbG9jYWxob3N0OjkwMDAnKSwgZW11bGFkb3IpOwp9KTsKCnRlc3QoJ2F1dGhVcmxzRm9yOiBVUkwgaW52w6FsaWRhIG91IGh0dHAgcmVtb3RvIG51bmNhIGRlc3ZpYSBvIGxvZ2luJywgKCkgPT4gewogIGNvbnN0IHByb2R1Y2FvID0geyBpZGVudGl0eVVybDogU1lOQy5JREVOVElUWV9UT09MS0lUX1VSTCwgdG9rZW5Vcmw6IFNZTkMuU0VDVVJFX1RPS0VOX1VSTCB9OwogIGZvciAoY29uc3QgdSBvZiBbJycsIG51bGwsICdodHRwOi8vZXhlbXBsby5jb206OTAwMCcsICdsaXhvJywgJ2h0dHA6Ly8xMjcuMC4wLjE6OTAwMC9jYW1pbmhvJ10pIHsKICAgIGFzc2VydC5kZWVwRXF1YWwoYXV0aFVybHNGb3IodSksIHByb2R1Y2FvLCBTdHJpbmcodSkpOwogIH0KfSk7CgovKiAtLS0tLS0tLS0tIGJvb3QgZGEgRW5naW5lIC0tLS0tLS0tLS0gKi8KCmNvbnN0IHsgRW5naW5lIH0gPSBhd2FpdCBpbXBvcnQoJy4uL3NlcnZlci5qcycpOwpjb25zdCBDT05GSUcgPSBwYXRoLmpvaW4oSE9NRSwgJ2NvbmZpZy5qc29uJyk7CgpmdW5jdGlvbiBjb21Db25maWcob2JqKSB7CiAgZnMubWtkaXJTeW5jKEhPTUUsIHsgcmVjdXJzaXZlOiB0cnVlIH0pOwogIGZzLndyaXRlRmlsZVN5bmMoQ09ORklHLCBKU09OLnN0cmluZ2lmeShvYmopKTsKICByZXR1cm4gbmV3IEVuZ2luZSgpOwp9Cgp0ZXN0KCdib290OiBjb25maWcuanNvbiBzZW0gc3luYyBpbmljaWEgY29tIGEgc2luY3Jvbml6YcOnw6NvIGRlc2xpZ2FkYScsICgpID0+IHsKICBjb25zdCB7IGNvbmZpZyB9ID0gY29tQ29uZmlnKHsgYXV0b1JldmlldzogZmFsc2UgfSk7CiAgYXNzZXJ0LmRlZXBFcXVhbChjb25maWcuc3luYywgc3luY0RlZmF1bHRzKCkpOwogIGFzc2VydC5lcXVhbChjb25maWcuc3luYy5lbmFibGVkLCBmYWxzZSk7Cn0pOwoKdGVzdCgnYm9vdDogc3luYyBsaXhvIG5vIGNvbmZpZy5qc29uIG7Do28gbGlnYSBuYWRhJywgKCkgPT4gewogIGZvciAoY29uc3QgbGl4byBvZiBbJ2xpZ2FkbycsIDEsIHRydWUsIFsxLCAyXSwgeyBlbmFibGVkOiAndHJ1ZScsIGNvb3JkaW5hdGlvbjogMSB9XSkgewogICAgY29uc3QgeyBjb25maWcgfSA9IGNvbUNvbmZpZyh7IGF1dG9SZXZpZXc6IGZhbHNlLCBzeW5jOiBsaXhvIH0pOwogICAgYXNzZXJ0LmVxdWFsKGNvbmZpZy5zeW5jLmVuYWJsZWQsIGZhbHNlLCBKU09OLnN0cmluZ2lmeShsaXhvKSk7CiAgICBhc3NlcnQuZXF1YWwoY29uZmlnLnN5bmMuY29vcmRpbmF0aW9uLmVuYWJsZWQsIGZhbHNlKTsKICAgIGFzc2VydC5lcXVhbChjb25maWcuc3luYy5jb25zb2xpZGF0aW9uLmVuYWJsZWQsIGZhbHNlKTsKICB9Cn0pOwoKdGVzdCgnYm9vdDogZGF0YWJhc2VVcmwgZWRpdGFkYSDDoCBtw6NvIGNvbSBob3N0IGVzdHJhbmhvIMOpIGRlc2NhcnRhZGEnLCAoKSA9PiB7CiAgY29uc3QgeyBjb25maWcgfSA9IGNvbUNvbmZpZyh7IGF1dG9SZXZpZXc6IGZhbHNlLCBzeW5jOiB7IC4uLlZBTElETywgZGF0YWJhc2VVcmw6ICdodHRwczovL2V2aWwuY29tJyB9IH0pOwogIGFzc2VydC5lcXVhbChjb25maWcuc3luYy5kYXRhYmFzZVVybCwgJycpOwogIGFzc2VydC5lcXVhbChjb25maWcuc3luYy5lbmFibGVkLCB0cnVlLCAnbyByZXN0byBkbyBvYmpldG8gdsOhbGlkbyBmaWNhJyk7Cn0pOwoKdGVzdCgndXBkYXRlU2V0dGluZ3M6IHN5bmMgcGFzc2EgcGVsbyBzYW5lYWRvciBlIFVSTCBpbnbDoWxpZGEgbWFudMOpbSBhIGFudGVyaW9yJywgKCkgPT4gewogIGNvbnN0IGVuZ2luZSA9IGNvbUNvbmZpZyh7IGF1dG9SZXZpZXc6IGZhbHNlLCBzeW5jOiBWQUxJRE8gfSk7CiAgY29uc3QgciA9IGVuZ2luZS51cGRhdGVTZXR0aW5ncyh7IHN5bmM6IHsgLi4uVkFMSURPLCBkYXRhYmFzZVVybDogJ2h0dHA6Ly9ldmlsLmNvbScsIGFwaUtleTogJ3gnIH0gfSk7CiAgYXNzZXJ0LmRlZXBFcXVhbChyLmlnbm9yYWRhcywgW10pOwogIGFzc2VydC5lcXVhbChlbmdpbmUuY29uZmlnLnN5bmMuZGF0YWJhc2VVcmwsIERCKTsKICBhc3NlcnQuZXF1YWwoZW5naW5lLmNvbmZpZy5zeW5jLmFwaUtleSwgJycpOwp9KTsK
```

Depois rode a conferência de novo: agora ela bate.

Crie `test/sync-engine-boot.test.js` com EXATAMENTE este conteúdo:

```js
// Boot da Engine com a sincronização LIGADA e um login já feito em disco: o estado em
// que o Farol abre todo dia depois do primeiro uso. test/sync-engine.test.js cobre o
// recurso sendo configurado; este arquivo existe à parte porque o cenário exige o
// config.json e a credencial gravados ANTES do construtor, num FAROL_HOME que nunca
// viu a identidade do aparelho.
//
// FAROL_HOME é fixado antes do import do server.js (os caminhos são const de nível de
// módulo): por isso o await import.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-sync-boot-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { SYNC } from '../lib/constants.js';

const { Engine } = await import('../server.js');

const DEVICE_FILE = path.join(FAROL_HOME, 'workspace', 'state', SYNC.DEVICE_FILE);

after(() => {
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

function gravarJson(arquivo, dados) {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.writeFileSync(arquivo, JSON.stringify(dados, null, 2));
}

// sync ligado, completo e com a coordenação ativa; a URL é de produção de propósito:
// qualquer tentativa de conexão no boot sairia da máquina, e o espião de fetch reprova
gravarJson(path.join(FAROL_HOME, 'config.json'), {
  autoReview: false,
  sync: {
    enabled: true, coordination: { enabled: true }, consolidation: { enabled: false },
    deviceName: 'Mesa', apiKey: 'chave-web-de-teste', databaseUrl: 'https://farol-teste-default-rtdb.firebaseio.com', projectId: 'farol-teste',
  },
});
gravarJson(path.join(FAROL_HOME, SYNC.CREDENTIALS_FILE), { uid: 'u1', email: 'a@b.com', refreshToken: 'rt-do-disco', savedAt: 1 });

function proximaVolta() { return new Promise((resolve) => setImmediate(resolve)); }

// O contrato promete que o construtor NUNCA toca rede: quem conecta é o primeiro tick.
// O espião entra ANTES do new Engine() de propósito, porque é no boot (e em qualquer
// trabalho agendado por ele) que uma conexão escondida apareceria.
test('boot com sync ligado e login em disco não toca a rede nem cria a identidade do aparelho', async () => {
  const fetchReal = globalThis.fetch;
  const chamadas = [];
  globalThis.fetch = async (url) => { chamadas.push(String(url)); throw new TypeError('fetch failed'); };
  try {
    const engine = new Engine();
    await proximaVolta();
    await proximaVolta();
    assert.equal(chamadas.length, 0, 'nenhuma chamada de rede no boot');
    assert.equal(engine.sync.status, 'conectando');
    assert.equal(fs.existsSync(DEVICE_FILE), false, 'sync-device.json nasce na primeira conexão, não no boot');
  } finally {
    globalThis.fetch = fetchReal;
  }
});

test('boot conectando: segura a automação sem toast de login que não falta', () => {
  const engine = new Engine();
  const toasts = [];
  engine.on('toast', (t) => toasts.push(t));
  assert.equal(engine.sync.status, 'conectando');
  assert.equal(engine.syncSeguraAutomacao('o/r#1'), true, 'fail-closed enquanto a primeira conexão não acontece');
  assert.equal(toasts.some((t) => /nenhum login/.test(t.text)), false, 'o aparelho TEM login: o aviso não pode dizer que falta');
  assert.equal(toasts.length, 0, 'conectando é passagem de um ciclo, não indisponibilidade');
});

// A presença e a reconexão só acontecem porque o check() chama o syncTick a cada ciclo.
// Os outros testes chamam a fachada direto; este prova a FIAÇÃO, com todo colaborador de
// rede do ciclo stubado (mesmo molde de test/check-resilience.test.js) e o syncTick
// trocado por um espião que só registra a ordem.
test('check() chama o syncTick uma vez por ciclo, depois do refreshMergeStates', async () => {
  const { BASELINE_FILE, STATE_DIR } = await import('../lib/paths.js');
  const e = new Engine();
  const ordem = [];
  Object.assign(e, {
    seen: new Set(), reReviewedKeys: new Set(), decisions: { pending: [], resolved: [] }, queue: [],
    resolveAccount: async () => {}, refreshTokens: async () => { e.tokenOk = true; return true; },
    searchPRs: async () => [], myAuthoredPRs: async () => [], enrichMyPRBranches: async () => {},
    refreshStaleStates: async () => {}, refreshReviewSignals: async () => {}, scanPushbacks: async () => {},
    checkUpdate: async () => {}, refreshContributors: async () => {}, schedule: () => {}, saveSeen: () => {},
  });
  e.config.accounts = [{ user: 'me', owners: ['acme'] }];
  e.refreshMergeStates = async () => { ordem.push('merge'); };
  e.syncTick = async () => { ordem.push('sync'); return { ok: true }; };
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(BASELINE_FILE, new Date().toISOString() + '\n');
  await e.check('test');
  assert.deepEqual(ordem, ['merge', 'sync']);
});
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('test/sync-engine-boot.test.js')).digest('hex').slice(0,16))"
```

Esperado: `6389924b355d185f`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

- [ ] **Passo 2: rodar e ver falhar**

```bash
node --test --test-force-exit test/facades.test.js test/sync-config.test.js test/sync-engine-boot.test.js
```

Esperado: FALHA. engine.syncTick não é função.

- [ ] **Passo 3: implementar**

Em `lib/engine/pushback.js`, aplique as 4 substituições abaixo, NA ORDEM. Cada trecho "localize" aparece exatamente uma vez no arquivo no momento em que você aplica aquela substituição; copie-o sem mudar espaço nem acento.

1. Localize:

```js
  });
}

async function scanPushbacks(engine) {
  if (!engine.config.autoPushback) return; // opt-in: por padrão não gasta sessão Claude com isso
  if (engine.pushbackScanning) return;
```

   Troque por:

```js
  });
}

function gravarPushback(engine, pr, cls) {
  if (!cls.isPushback || cls.outcome === 'none' || !PUSHBACK_OUTCOMES.includes(cls.outcome)) return;
  const prev = engine.pushbacks[pr.key];
  if (prev && prev.source === 'manual') return; // marcou à mão durante o scan: manual prevalece
  const high = cls.confidence === 'high';
  engine.pushbacks[pr.key] = {
    author: String(pr.author || '').toLowerCase(),
    outcome: cls.outcome,
    note: String(cls.note || '').trim().slice(0, 300),
    at: Date.now(), source: 'auto',
    confidence: high ? 'high' : 'low',
    status: high ? 'confirmed' : 'pending'
  };
  engine.savePushbacks();
  engine.emit('toast', high
    ? { kind: 'info', text: `↩ Pushback em ${pr.key}: ${PUSHBACK_LABEL[cls.outcome] || cls.outcome}.` }
    : { kind: 'info', text: `↩ Possível pushback em ${pr.key}: confirme o desfecho em Revisões recentes.` });
}

// Ordem da D14: estado LOCAL primeiro, recibo remoto por último. Com o recibo gravado
// antes (dentro do classifyPushback), um processo morto no meio deixava o recibo de pé
// e o registro local ausente; no ciclo seguinte a classificação voltava deduplicada, o
// marcador avançava e o pushback sumia sem nunca ter sido registrado em lugar nenhum.
async function concluirPushback(engine, pr, cls, marker) {
  engine.pushbackScanned[pr.key] = marker;
  engine.savePushbackScanned();
  // outro aparelho já classificou este mesmo marcador: o marcador avança e nada é
  // gravado aqui, porque o registro é do aparelho que rodou
  if (!cls.deduped) gravarPushback(engine, pr, cls);
  await fecharCoordenacaoPushback(cls.coord, cls);
}

async function scanPushbacks(engine) {
  if (!engine.config.autoPushback) return; // opt-in: por padrão não gasta sessão Claude com isso
  if (engine.pushbackScanning) return;
```

2. Localize:

```js
          continue;
        }
        classified++;
        const cls = await engine.classifyPushback(pr);
        // sessão caiu (rede/limite): NÃO marca, senão a comparação estrita do gate
        // (updatedAt > marcador) nunca reabre e o pushback se perde em definitivo
        if (!cls) continue;
        engine.pushbackScanned[pr.key] = det.marker; engine.savePushbackScanned();
        if (!cls.isPushback || cls.outcome === 'none' || !PUSHBACK_OUTCOMES.includes(cls.outcome)) continue;
        const high = cls.confidence === 'high';
        const prev = engine.pushbacks[pr.key];
        if (prev && prev.source === 'manual') continue; // marcou à mão durante o scan: manual prevalece
        engine.pushbacks[pr.key] = {
          author: String(pr.author || '').toLowerCase(),
          outcome: cls.outcome,
          note: String(cls.note || '').trim().slice(0, 300),
          at: Date.now(), source: 'auto',
          confidence: high ? 'high' : 'low',
          status: high ? 'confirmed' : 'pending'
        };
        engine.savePushbacks();
        engine.emit('toast', high
          ? { kind: 'info', text: `↩ Pushback em ${pr.key}: ${PUSHBACK_LABEL[cls.outcome] || cls.outcome}.` }
          : { kind: 'info', text: `↩ Possível pushback em ${pr.key}: confirme o desfecho em Revisões recentes.` });
      } catch (e) { engine.log('WARN', `scanPushbacks ${pr.key}: ${e.message}`); }
    }
  } finally { engine.pushbackScanning = false; }
```

   Troque por:

```js
          continue;
        }
        classified++;
        const cls = await engine.classifyPushback(pr, det.marker);
        // sessão caiu (rede/limite): NÃO marca, senão a comparação estrita do gate
        // (updatedAt > marcador) nunca reabre e o pushback se perde em definitivo
        if (!cls) continue;
        await concluirPushback(engine, pr, cls, det.marker);
      } catch (e) { engine.log('WARN', `scanPushbacks ${pr.key}: ${e.message}`); }
    }
  } finally { engine.pushbackScanning = false; }
```

3. Localize:

```js
  return { marker, hadActivity };
}

// classifica a thread via Claude (leitura pura). Devolve { isPushback, outcome,
// confidence, note } ou null se falhar. Não registra em activeReviews (silencioso).
async function classifyPushback(engine, pr) {
  const acc = engine.accountForPr(pr);
  const me = acc || '';
  const prompt = `Você está rodando em modo AUTÔNOMO dentro do app Farol, sem ninguém na tela. NÃO faça perguntas, NÃO poste nada (só leitura via gh).\n\n` +
```

   Troque por:

```js
  return { marker, hadActivity };
}

// Contexto da coordenação entre aparelhos ("Contratos dos chamadores"): a versão
// material do pushback é o MARCADOR da atividade do autor, não o head, porque é a
// thread que se classifica; sem head, o preflight do GitHub nem se aplica.
function contextoCoordenacaoPushback(pr, conta, marker) {
  return {
    prKey: pr.key, account: conta, materialVersion: String(marker || ''), headSha: '',
    contaRodada: false, manual: false, semCoordenacao: false, ignorarRecibo: false,
    pr: { key: pr.key, url: pr.url, repo: pr.repo, number: pr.number, author: pr.author, account: pr.account },
  };
}

function lerClassificacao(engine, raw) {
  const text = engine.parseEnvelope(raw || '');
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try {
    const d = JSON.parse(text.slice(a, b + 1));
    return { isPushback: !!d.isPushback, outcome: d.outcome, confidence: d.confidence, note: d.note };
  } catch { return null; }
}

// Classificação lida = desfecho, e grava o recibo; ilegível devolve o lease sem recibo
// (o próximo ciclo tenta de novo). Nunca lança: roda num finally.
async function fecharCoordenacaoPushback(coord, cls) {
  if (!coord) return;
  try {
    if (cls) await coord.complete({ publicationState: 'not_applicable' });
    else await coord.abort();
  } catch { /* lease que não sai expira pelo TTL; recibo que falta só repete a leitura */ }
}

// classifica a thread via Claude (leitura pura). Devolve { isPushback, outcome,
// confidence, note } ou null se falhar. Não registra em activeReviews (silencioso).
// Com a coordenação entre aparelhos ligada, recibo de outro aparelho para o MESMO
// marcador devolve { deduped: true } (quem chama avança o marcador sem registrar), e
// qualquer outro bloqueio devolve null (tenta de novo no próximo ciclo).
async function classifyPushback(engine, pr, marker) {
  const acc = engine.accountForPr(pr);
  const me = acc || '';
  const prompt = `Você está rodando em modo AUTÔNOMO dentro do app Farol, sem ninguém na tela. NÃO faça perguntas, NÃO poste nada (só leitura via gh).\n\n` +
```

4. Localize:

```js
    `confidence "high" só quando a thread deixa claro; na dúvida, "low".\n\n` +
    `Sua saída final deve ser APENAS um bloco JSON, sem texto em volta: {"isPushback": true|false, "outcome": "author_right"|"we_right"|"mixed"|"none", "confidence": "high"|"low", "note": "1 linha curta do que foi contestado"}`;
  const id = `pb${++engine.sessionSeq}`;
  const res = await engine.runClaudeStream(prompt, { id, account: acc, ref: pr.key });
  const text = engine.parseEnvelope(res.text || '');
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try {
    const d = JSON.parse(text.slice(a, b + 1));
    return { isPushback: !!d.isPushback, outcome: d.outcome, confidence: d.confidence, note: d.note };
  } catch { return null; }
}

const pushbackMod = {
```

   Troque por:

```js
    `confidence "high" só quando a thread deixa claro; na dúvida, "low".\n\n` +
    `Sua saída final deve ser APENAS um bloco JSON, sem texto em volta: {"isPushback": true|false, "outcome": "author_right"|"we_right"|"mixed"|"none", "confidence": "high"|"low", "note": "1 linha curta do que foi contestado"}`;
  const id = `pb${++engine.sessionSeq}`;
  const coordination = contextoCoordenacaoPushback(pr, acc, marker);
  const res = await engine.runClaudeStream(prompt, { id, account: acc, ref: pr.key, operationKind: 'pushback', coordination });
  if (res.blocked) return res.coordination.reason === 'recibo' ? { deduped: true } : null;
  const cls = lerClassificacao(engine, res.text);
  // ilegível é o fim da linha: devolve o lease sem recibo e o próximo ciclo tenta de novo
  if (!cls) {
    await fecharCoordenacaoPushback(res.coordination, null);
    return null;
  }
  // o recibo NÃO sai aqui: quem o grava é o concluirPushback, depois de o marcador e o
  // registro do pushback estarem no disco deste aparelho (D14)
  return { ...cls, coord: res.coordination };
}

const pushbackMod = {
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('lib/engine/pushback.js')).digest('hex').slice(0,16))"
```

Esperado: `7992423806d70f51`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

Em `lib/engine/usage.js`, aplique as 2 substituições abaixo, NA ORDEM. Cada trecho "localize" aparece exatamente uma vez no arquivo no momento em que você aplica aquela substituição; copie-o sem mudar espaço nem acento.

1. Localize:

```js
  if (!alvo) return false;
  alvo.status = status;
  saveSessions(engine);
  engine.pushState();
  return true;
}
```

   Troque por:

```js
  if (!alvo) return false;
  alvo.status = status;
  saveSessions(engine);
  if (typeof engine.syncEnqueueUsage === 'function') engine.syncEnqueueUsage(alvo); // mesmo eventId, status novo
  engine.pushState();
  return true;
}
```

2. Localize:

```js
        : (resultEvent && resultEvent.is_error) ? 'erro' : 'ok',
  });
  saveSessions(engine);
  engine.pushState();
}

```

   Troque por:

```js
        : (resultEvent && resultEvent.is_error) ? 'erro' : 'ok',
  });
  saveSessions(engine);
  // depois do save local: morte entre os dois é recuperada pelo cursor da outbox
  if (typeof engine.syncEnqueueUsage === 'function') engine.syncEnqueueUsage(engine.usageSessions.sessions.at(-1));
  engine.pushState();
}

```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('lib/engine/usage.js')).digest('hex').slice(0,16))"
```

Esperado: `3bc6647f8bf5a16c`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

Em `lib/http-server.js`, aplique as 4 substituições abaixo, NA ORDEM. Cada trecho "localize" aparece exatamente uma vez no arquivo no momento em que você aplica aquela substituição; copie-o sem mudar espaço nem acento.

1. Localize:

```js
function okResponse(value) { return { ok: !!value }; }
function jiraCredentialResult(ok) { return ok ? { ok: true } : { ok: false, error: 'dados incompletos' }; }

async function deliveriesFor(engine, url) {
  if (engine.config.deliveriesEnabled !== true) return { items: [], disabled: true };
  return engine.fetchDeliveries(url.searchParams.get('days'), url.searchParams.get('owner'));
```

   Troque por:

```js
function okResponse(value) { return { ok: !!value }; }
function jiraCredentialResult(ok) { return ok ? { ok: true } : { ok: false, error: 'dados incompletos' }; }

// Sincronização entre dispositivos: o corpo das respostas é allowlist, pelo mesmo
// motivo das credenciais do Jira acima. Nunca ecoa o que veio no corpo (a senha do
// login) nem o e-mail ou o uid: o estado completo chega à tela pelo snapshot, que já
// passa pela projeção de statusForUi.
function syncCredenciais(body) { return { email: String(body.email || ''), password: String(body.password || '') }; }
function syncFalha(r) { return { ok: false, code: String((r && r.code) || 'falha_interna'), motivo: String((r && r.motivo) || '') }; }
function syncResult(r) { return r && r.ok ? { ok: true } : syncFalha(r); }
function syncTestResult(r) { return r && r.ok ? { ok: true, devices: Number(r.devices) || 0 } : syncFalha(r); }
function syncConsolidatedResult(r) { return r && r.ok ? { ok: true, resumo: r.resumo } : syncFalha(r); }
function syncConsolidateResult(r) { return r && r.ok ? { ok: true, enfileirados: Number(r.enfileirados) || 0, pendentes: Number(r.pendentes) || 0 } : syncFalha(r); }

async function deliveriesFor(engine, url) {
  if (engine.config.deliveriesEnabled !== true) return { items: [], disabled: true };
  return engine.fetchDeliveries(url.searchParams.get('days'), url.searchParams.get('owner'));
```

2. Localize:

```js
        // contrato de array de strings.
        if (p === '/api/log/triage') return send(200, triage(tailLog(parseInt(url.searchParams.get('lines'), 10) || 300)));
        if (p === '/api/doctor') return send(200, await engine.doctor());
        if (p === '/api/reviewer-candidates') return send(200, await engine.reviewerCandidates());

        if (p === '/api/events') {
```

   Troque por:

```js
        // contrato de array de strings.
        if (p === '/api/log/triage') return send(200, triage(tailLog(parseInt(url.searchParams.get('lines'), 10) || 300)));
        if (p === '/api/doctor') return send(200, await engine.doctor());
        // consumo de todos os aparelhos (lib/engine/sync-usage.js): envelope, nunca o resumo cru
        if (p === '/api/sync/consolidated' && req.method === 'GET') return send(200, syncConsolidatedResult(await engine.syncConsolidated(url.searchParams.get('days'))));
        if (p === '/api/reviewer-candidates') return send(200, await engine.reviewerCandidates());

        if (p === '/api/events') {
```

3. Localize:

```js
        // resposta com ENVELOPE, nunca o objeto cru: a tela precisa distinguir
        // "testou e falhou" de "a chamada não chegou" (o get da UI engole erro).
        if (p === '/api/jira/test') return send(200, await engine.testarJiraSite(String(body.siteId || '')));
        if (p === '/api/review') {
          // contrato explícito: a UI SEMPRE manda a lista de PRs. O fallback antigo
          // (sem urls = fila inteira) fazia um {} acidental revisar PRs de todas as
```

   Troque por:

```js
        // resposta com ENVELOPE, nunca o objeto cru: a tela precisa distinguir
        // "testou e falhou" de "a chamada não chegou" (o get da UI engole erro).
        if (p === '/api/jira/test') return send(200, await engine.testarJiraSite(String(body.siteId || '')));
        // sincronização entre dispositivos (lib/engine/sync.js); ver syncResult acima
        if (p === '/api/sync/login') return send(200, syncResult(await engine.syncLogin(syncCredenciais(body))));
        if (p === '/api/sync/logout') return send(200, syncResult(engine.syncLogout()));
        if (p === '/api/sync/test') return send(200, syncTestResult(await engine.syncTest()));
        if (p === '/api/sync/erase-remote') return send(200, syncResult(await engine.syncEraseRemote()));
        if (p === '/api/sync/redo') return send(200, syncResult(await engine.syncRedoReceipt(String(body.key || ''))));
        if (p === '/api/sync/consolidate') return send(200, syncConsolidateResult(await engine.syncConsolidate()));
        if (p === '/api/review') {
          // contrato explícito: a UI SEMPRE manda a lista de PRs. O fallback antigo
          // (sem urls = fila inteira) fazia um {} acidental revisar PRs de todas as
```

4. Localize:

```js
          const urls = Array.isArray(body.urls) ? body.urls.filter(u => typeof u === 'string' && u) : [];
          if (!urls.length) return send(400, { error: 'urls é obrigatório: a lista explícita das URLs dos PRs a revisar' });
          // 'clique': veio de um humano apertando Revisar, então nunca é barrado
          // pela saída de cena (e desfaz a saída). Ver enqueueHeadless.
          return send(200, await engine.launchReview(urls, body.mode === 'terminal' ? 'terminal' : 'auto', 'clique'));
        }
        if (p === '/api/claude-login') { engine.openClaudeLoginSession(body.profileId || ''); return send(200, { ok: true }); }
        if (p === '/api/self-review') return send(200, await engine.launchSelfAnalysis(String(body.url || '')));
```

   Troque por:

```js
          const urls = Array.isArray(body.urls) ? body.urls.filter(u => typeof u === 'string' && u) : [];
          if (!urls.length) return send(400, { error: 'urls é obrigatório: a lista explícita das URLs dos PRs a revisar' });
          // 'clique': veio de um humano apertando Revisar, então nunca é barrado
          // pela saída de cena (e desfaz a saída). Ver enqueueHeadless. Os overrides da
          // coordenação entre aparelhos só valem com true de verdade: a confirmação da
          // tela manda booleano, e qualquer outro valor não pode contornar nada.
          const extras = { semCoordenacao: body.semCoordenacao === true, ignorarRecibo: body.ignorarRecibo === true };
          return send(200, await engine.launchReview(urls, body.mode === 'terminal' ? 'terminal' : 'auto', 'clique', extras));
        }
        if (p === '/api/claude-login') { engine.openClaudeLoginSession(body.profileId || ''); return send(200, { ok: true }); }
        if (p === '/api/self-review') return send(200, await engine.launchSelfAnalysis(String(body.url || '')));
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('lib/http-server.js')).digest('hex').slice(0,16))"
```

Esperado: `acddc52b40d375f6`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

Em `lib/settings.js`, aplique as 1 substituições abaixo, NA ORDEM. Cada trecho "localize" aparece exatamente uma vez no arquivo no momento em que você aplica aquela substituição; copie-o sem mudar espaço nem acento.

1. Localize:

```js
  { key: 'owners', def: ['biudtech'], ui: true, san: (v) => listaDeTexto(v) },
  { key: 'accounts', def: [], ui: true, san: (v, _c, f) => f.parseAccounts(v) },
  { key: 'jiraSites', def: [], ui: true, san: (v, _c, f) => f.parseJiraSites(v) },
  { key: 'intervalSeconds', def: 300, ui: true, san: (v) => clamp(parseInt(v, 10) || 300, 180, 3600) },
  { key: 'autoReview', def: true, ui: true },
  { key: 'parallelReviews', def: 1, ui: true, san: (v, c, f) => ouAtual(f.sanitizeParallelReviews(v), c.parallelReviews) },
```

   Troque por:

```js
  { key: 'owners', def: ['biudtech'], ui: true, san: (v) => listaDeTexto(v) },
  { key: 'accounts', def: [], ui: true, san: (v, _c, f) => f.parseAccounts(v) },
  { key: 'jiraSites', def: [], ui: true, san: (v, _c, f) => f.parseJiraSites(v) },
  // opt-in: nasce desligada e só liga com objeto explícito; o saneador vive em
  // lib/sync/config.js e entra por injeção como os outros parsers
  { key: 'sync', def: { enabled: false, coordination: { enabled: false }, consolidation: { enabled: false }, deviceName: '', apiKey: '', databaseUrl: '', projectId: '' }, ui: true, san: (v, c, f) => f.parseSyncConfig(v, c.sync) },
  { key: 'intervalSeconds', def: 300, ui: true, san: (v) => clamp(parseInt(v, 10) || 300, 180, 3600) },
  { key: 'autoReview', def: true, ui: true },
  { key: 'parallelReviews', def: 1, ui: true, san: (v, c, f) => ouAtual(f.sanitizeParallelReviews(v), c.parallelReviews) },
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('lib/settings.js')).digest('hex').slice(0,16))"
```

Esperado: `40521da71aa1366b`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

Em `server.js`, aplique as 11 substituições abaixo, NA ORDEM. Cada trecho "localize" aparece exatamente uma vez no arquivo no momento em que você aplica aquela substituição; copie-o sem mudar espaço nem acento.

1. Localize:

```js
import signalMod from './lib/engine/review-signal.js';
import usageMod from './lib/engine/usage.js';
import quotaMod from './lib/engine/quota.js';
import { EDITAVEIS, defaults as settingsDefaults, sanear } from './lib/settings.js';
import { parseJiraSites, maskJiraSites } from './lib/jira/sites.js';
import credMod from './lib/jira/credentials.js';
import jiraMod from './lib/engine/jira.js';
import { startServer } from './lib/http-server.js';
```

   Troque por:

```js
import signalMod from './lib/engine/review-signal.js';
import usageMod from './lib/engine/usage.js';
import quotaMod from './lib/engine/quota.js';
import syncMod from './lib/engine/sync.js';
import syncUsageMod from './lib/engine/sync-usage.js';
import { EDITAVEIS, defaults as settingsDefaults, sanear } from './lib/settings.js';
import { parseJiraSites, maskJiraSites } from './lib/jira/sites.js';
import { parseSyncConfig, syncDefaults } from './lib/sync/config.js';
import credMod from './lib/jira/credentials.js';
import jiraMod from './lib/engine/jira.js';
import { startServer } from './lib/http-server.js';
```

2. Localize:

```js
  parseAccounts, parseProjectReviewers, parseDefaultReviewers, parsePeople,
  sanitizeClaudeDir, normalizeClaudeProfiles, normalizeClaudeProfileId,
  sanitizeClaudeModel, sanitizeClaudeEffort, sanitizeCodexModel, sanitizeCodexEffort,
  sanitizeParallelReviews, sanitizeGlobalParallelReviews, parseJiraSites,
};

// carência anti-lag do índice de busca do GitHub: logo após EU postar um review, o PR
```

   Troque por:

```js
  parseAccounts, parseProjectReviewers, parseDefaultReviewers, parsePeople,
  sanitizeClaudeDir, normalizeClaudeProfiles, normalizeClaudeProfileId,
  sanitizeClaudeModel, sanitizeClaudeEffort, sanitizeCodexModel, sanitizeCodexEffort,
  sanitizeParallelReviews, sanitizeGlobalParallelReviews, parseJiraSites, parseSyncConfig,
};

// carência anti-lag do índice de busca do GitHub: logo após EU postar um review, o PR
```

3. Localize:

```js
      ? (sanitizeCodexEffort(this.config.codexReviewEffort) || '') : esforcoCodexLegado;
    this.config.reviewModel = sanitizeClaudeModel(this.config.reviewModel) || '';
    this.config.reviewEffort = sanitizeClaudeEffort(this.config.reviewEffort) || '';
    // intervalo do polling: o caminho HTTP (updateSettings) já clampa em 180..3600, mas
    // o boot engolia config.json editado à mão. Não numérico virava Math.max(180, NaN)
    // = NaN no schedule(), e setTimeout(fn, NaN) dispara em ~1ms: polling contínuo
```

   Troque por:

```js
      ? (sanitizeCodexEffort(this.config.codexReviewEffort) || '') : esforcoCodexLegado;
    this.config.reviewModel = sanitizeClaudeModel(this.config.reviewModel) || '';
    this.config.reviewEffort = sanitizeClaudeEffort(this.config.reviewEffort) || '';
    // sincronização entre dispositivos: opt-in que segura revisão quando ligado, então
    // config.json editado à mão passa pelo mesmo saneador do caminho HTTP antes de
    // qualquer coisa ler `enabled`. Base nos defaults: no boot não há valor anterior.
    this.config.sync = parseSyncConfig(this.config.sync, syncDefaults());
    // runtime da sincronização (lib/engine/sync.js): montado a partir do config JÁ
    // saneado e sem rede nem arquivo novo; quem conecta é o primeiro tick do check()
    this.sync = syncMod.bootSync(this);
    // intervalo do polling: o caminho HTTP (updateSettings) já clampa em 180..3600, mas
    // o boot engolia config.json editado à mão. Não numérico virava Math.max(180, NaN)
    // = NaN no schedule(), e setTimeout(fn, NaN) dispara em ~1ms: polling contínuo
```

4. Localize:

```js
      try { await this.enrichMyPRBranches(); } catch (e) { this.log('WARN', `enrichMyPRBranches: ${e.message}`); }
      // mergeabilidade real dos PRs aprovaveis (gate honesto do botao Merge)
      try { await this.refreshMergeStates(); } catch (e) { this.log('WARN', `refreshMergeStates: ${e.message}`); }
      // stale: PRs que EU revisei e receberam commit novo depois (reativa o "Re-revisar")
      try { await this.refreshStaleStates(); } catch (e) { this.log('WARN', `refreshStaleStates: ${e.message}`); }
      // round 2 sozinho: PR onde EU pedi mudanças e o autor empurrou commit novo volta
```

   Troque por:

```js
      try { await this.enrichMyPRBranches(); } catch (e) { this.log('WARN', `enrichMyPRBranches: ${e.message}`); }
      // mergeabilidade real dos PRs aprovaveis (gate honesto do botao Merge)
      try { await this.refreshMergeStates(); } catch (e) { this.log('WARN', `refreshMergeStates: ${e.message}`); }
      // sincronização entre dispositivos: presença e reconexão. Desligada custa zero, e
      // falha dela vira estado da própria sincronização, nunca erro do ciclo.
      try { await this.syncTick(); } catch (e) { this.log('WARN', `sincronização: ${e.message}`); }
      // stale: PRs que EU revisei e receberam commit novo depois (reativa o "Re-revisar")
      try { await this.refreshStaleStates(); } catch (e) { this.log('WARN', `refreshStaleStates: ${e.message}`); }
      // round 2 sozinho: PR onde EU pedi mudanças e o autor empurrou commit novo volta
```

5. Localize:

```js
        if (inflight.has(p.key)) return false;
        if (this.autoReviewParked.has(p.key)) return false;
        if (this.retryAfterNet.has(p.key)) return false;
        if (this.skipComentado[p.key]) { foraDeCena.push(p); return false; }
        if (this._registraPulo(p, pulados)) return false;
        const blockedProfile = this.budgetBlockedFor(acct);
```

   Troque por:

```js
        if (inflight.has(p.key)) return false;
        if (this.autoReviewParked.has(p.key)) return false;
        if (this.retryAfterNet.has(p.key)) return false;
        // coordenação entre aparelhos: conexão fora ou espera anotada segura (D11)
        if (this.syncSeguraAutomacao(p.key)) return false;
        if (this.skipComentado[p.key]) { foraDeCena.push(p); return false; }
        if (this._registraPulo(p, pulados)) return false;
        const blockedProfile = this.budgetBlockedFor(acct);
```

6. Localize:

```js

  // Pipeline de revisão headless: colaborador lib/engine/review.js (gate intacto, Onda 2).
  prFromUrl(url) { return reviewMod.prFromUrl(this, url); }
  async launchReview(urls, mode = 'auto', origem = 'auto') { return reviewMod.launchReview(this, urls, mode, origem); }
  enqueueHeadless(pr) { return reviewMod.enqueueHeadless(this, pr); }
  headlessAcct(pr) { return reviewMod.headlessAcct(this, pr); }
  processHeadless() { return reviewMod.processHeadless(this); }
```

   Troque por:

```js

  // Pipeline de revisão headless: colaborador lib/engine/review.js (gate intacto, Onda 2).
  prFromUrl(url) { return reviewMod.prFromUrl(this, url); }
  async launchReview(urls, mode = 'auto', origem = 'auto', extras = {}) { return reviewMod.launchReview(this, urls, mode, origem, extras); }
  enqueueHeadless(pr) { return reviewMod.enqueueHeadless(this, pr); }
  headlessAcct(pr) { return reviewMod.headlessAcct(this, pr); }
  processHeadless() { return reviewMod.processHeadless(this); }
```

7. Localize:

```js
  // Claude por candidato novo, LEITURA pura (nunca posta), limitada por ciclo.
  async scanPushbacks() { return pushbackMod.scanPushbacks(this); }
  async detectAuthorPushback(pr, seen) { return pushbackMod.detectAuthorPushback(this, pr, seen); }
  async classifyPushback(pr) { return pushbackMod.classifyPushback(this, pr); }

  // --- merge do MEU PR quando a MINHA autoanalise diz "aprovavel" -------------
  // Unica escrita no GitHub partindo de "Meus PRs" (a autoanalise em si continua
```

   Troque por:

```js
  // Claude por candidato novo, LEITURA pura (nunca posta), limitada por ciclo.
  async scanPushbacks() { return pushbackMod.scanPushbacks(this); }
  async detectAuthorPushback(pr, seen) { return pushbackMod.detectAuthorPushback(this, pr, seen); }
  async classifyPushback(pr, marker) { return pushbackMod.classifyPushback(this, pr, marker); }

  // --- merge do MEU PR quando a MINHA autoanalise diz "aprovavel" -------------
  // Unica escrita no GitHub partindo de "Meus PRs" (a autoanalise em si continua
```

8. Localize:

```js
    }
    env.setDebugSpawns(this.config.debugSpawns); // liga/desliga o logger na hora
    this.saveConfig();
    if (userChanged) { this.token = null; this.tokenOk = false; this.tokens = {}; }
    if (intervalChanged || userChanged) this.checkNow();
    // perfil (lista ou padrão global) mudou: o badge de assinatura Claude (doctor.claudeAuth)
```

   Troque por:

```js
    }
    env.setDebugSpawns(this.config.debugSpawns); // liga/desliga o logger na hora
    this.saveConfig();
    // a sincronização liga, desliga ou reconecta conforme o objeto novo; não espera a
    // rede (aplicarConfig nunca rejeita) e o estado final chega pela tela via pushState
    if ('sync' in (patch || {})) this.syncAplicarConfig();
    if (userChanged) { this.token = null; this.tokenOk = false; this.tokens = {}; }
    if (intervalChanged || userChanged) this.checkNow();
    // perfil (lista ou padrão global) mudou: o badge de assinatura Claude (doctor.claudeAuth)
```

9. Localize:

```js
  // Testa o site cadastrado contra o Jira de verdade (ver testarSite em lib/engine/jira.js).
  testarJiraSite(siteId) { return jiraMod.testarSite(this, siteId); }

  snapshot() {
    return {
      app: { name: APP_NAME, version: APP_VERSION, platform: process.platform },
```

   Troque por:

```js
  // Testa o site cadastrado contra o Jira de verdade (ver testarSite em lib/engine/jira.js).
  testarJiraSite(siteId) { return jiraMod.testarSite(this, siteId); }

  // Sincronização entre dispositivos: colaborador lib/engine/sync.js, o único que junta
  // config, credencial, aparelho e cliente do Firebase. A senha do login atravessa só a
  // fachada de login e nunca volta em resultado nenhum.
  syncCoordenacaoAtiva() { return syncMod.coordenacaoAtiva(this); }
  syncSeguraAutomacao(key) { return syncMod.seguraAutomacao(this, key); }
  syncRegistrarEspera(key, admissao) { return syncMod.registrarEspera(this, key, admissao); }
  syncLogin(credenciais, fetchImpl) { return syncMod.syncLogin(this, credenciais, fetchImpl); }
  syncLogout() { return syncMod.syncLogout(this); }
  syncTest() { return syncMod.syncTest(this); }
  syncEraseRemote() { return syncMod.syncEraseRemote(this); }
  syncTick() { return syncMod.syncTick(this); }
  syncAplicarConfig() { return syncMod.aplicarConfig(this); }
  syncAdmit(ctx) { return syncMod.admit(this, ctx); }
  syncPreflightManual(pr) { return syncMod.preflightManual(this, pr); }
  syncRedoReceipt(key) { return syncMod.redoReceipt(this, key); }
  // gancho do consumo (usage.js): no-op com a consolidação entre aparelhos desligada
  syncEnqueueUsage(sessao) { return syncUsageMod.enqueueUsage(this, sessao); }
  syncConsolidated(days) { return syncUsageMod.consolidated(this, days); }
  syncConsolidate() { return syncUsageMod.consolidate(this); }

  snapshot() {
    return {
      app: { name: APP_NAME, version: APP_VERSION, platform: process.platform },
```

10. Localize:

```js
      // lista mascarada dos sites do Jira: mesmos campos do config, mais só a
      // EXISTÊNCIA da credencial (hasCredential), nunca o valor (ver lib/jira/sites.js).
      jiraSites: maskJiraSites(this.config.jiraSites || [], credMod.hasCredential),
      lastCheckAt: this.lastCheckAt,
      nextCheckAt: this.nextCheckAt,
      queue: this.queue,
```

   Troque por:

```js
      // lista mascarada dos sites do Jira: mesmos campos do config, mais só a
      // EXISTÊNCIA da credencial (hasCredential), nunca o valor (ver lib/jira/sites.js).
      jiraSites: maskJiraSites(this.config.jiraSites || [], credMod.hasCredential),
      // sincronização entre dispositivos por allowlist (statusForUi): nunca senha,
      // token ou URL com auth=, só estado, aparelhos e o que a coordenação viu
      sync: syncMod.statusForUi(this),
      lastCheckAt: this.lastCheckAt,
      nextCheckAt: this.nextCheckAt,
      queue: this.queue,
```

11. Localize:

```js
      if (!dona) continue;
      if (this.isMuted(dona) || !this.autoReviewFor(dona) || !this.tokenFor(dona)) continue;
      if (this.autoReviewParked.has(p.key) || this.skipComentado[p.key]) continue;
      espera.add(dona);
    }
    return this.accountList()
```

   Troque por:

```js
      if (!dona) continue;
      if (this.isMuted(dona) || !this.autoReviewFor(dona) || !this.tokenFor(dona)) continue;
      if (this.autoReviewParked.has(p.key) || this.skipComentado[p.key]) continue;
      // D19: PR segurado pela coordenação não vai rodar agora, então não é disputa; sem
      // isto a outra conta cederia a vez pra quem não pode usá-la. A fachada falta no
      // engine mínimo dos testes da cota, e ausência vale como coordenação desligada.
      if (typeof this.syncSeguraAutomacao === 'function' && this.syncSeguraAutomacao(p.key)) continue;
      espera.add(dona);
    }
    return this.accountList()
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('server.js')).digest('hex').slice(0,16))"
```

Esperado: `0c67a26f9526c70c`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

- [ ] **Passo 4: rodar e ver passar**

```bash
node --test --test-force-exit test/facades.test.js test/sync-config.test.js test/sync-engine-boot.test.js
```

Esperado: PASSA, 0 falhas.

- [ ] **Passo 5: gate e commit**

```bash
npm run check && npm run lint && npm test
```

Esperado: `fail 0` e `gate de qualidade: sem regressão`. Se algo falhar, PARE e relate; não mexa em outro arquivo para fazer passar.

```bash
git add lib/engine/pushback.js lib/engine/usage.js lib/http-server.js lib/settings.js server.js test/facades.test.js test/sync-config.test.js test/sync-engine-boot.test.js
git commit -m "feat(sync): fiação do runtime no engine, rotas e projeção para a tela"
```


### Tarefa T17: Provas do runtime, do coordenador e do consumo

Agora que a fiação existe, os dublês provam o que ela faz: boot sem rede, login, presença, tick, o coordenador de ponta a ponta e o dinheiro do consumo. São os casos que seguram o recurso inteiro.

**Arquivos:**
- Criar: `test/sync-consolidated.test.js`
- Criar: `test/sync-coordinator.test.js`
- Criar: `test/sync-engine.test.js`
- Criar: `test/sync-outbox.test.js`

- [ ] **Passo 1: escrever o teste**

Crie `test/sync-consolidated.test.js` com EXATAMENTE este conteúdo:

```js
// Consumo consolidado entre aparelhos: a projeção pura (lib/sync/consolidated.js) e o
// caminho do engine até ela (GET /api/sync/consolidated, POST /api/sync/consolidate).
// A janela corta pelo dia de Brasília e a leitura nunca sai de /users/{uid}: o
// consolidado de uma pessoa não pode trazer o aparelho de outra.
//
// FAROL_HOME é fixado antes do import do server.js (os caminhos são const de nível de
// módulo): por isso o await import. consolidated.js é puro e entra estático.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-sync-consolidated-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';
import { startFakeIdentity } from './helpers/fake-identity.js';
import { SYNC, TEMPOS } from '../lib/constants.js';
import { consolidatedSummary } from '../lib/sync/consolidated.js';
import { usageDayKeysBack } from '../ui/pure.js';

const { Engine } = await import('../server.js');
const { eventIdFor } = await import('../lib/sync/keys.js');

const API_KEY = 'chave-web-de-teste';
const EMAIL = 'a@b.com';
const SENHA = 'senha-de-teste';
const identity = await startFakeIdentity({ apiKey: API_KEY, users: { [EMAIL]: { password: SENHA, uid: 'u1' } } });
const rtdb = await startFakeRtdb({ token: (t) => identity.tokens.idTokens.includes(t) });

after(async () => {
  await rtdb.close();
  await identity.close();
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

// 15/01/2027 02:00 UTC = 14/01/2027 23:00 em Brasília: o dia UTC e o de Brasília divergem
const AGORA = Date.UTC(2027, 0, 15, 2, 0, 0);

function ev(at, extra = {}) {
  return { at, kind: 'review', costUsd: 1, inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheCreationTokens: 0, costSource: 'medido', ...extra };
}

test('janela corta pelo dia de Brasília, não pelo UTC nem pelo dia gravado', () => {
  const eventos = {
    d1: {
      // 08/01 00:30 em Brasília (03:30 UTC): primeiro dia da janela de 7 dias que termina hoje, 14/01
      dentro: ev(Date.UTC(2027, 0, 8, 3, 30), { day: '2027-01-01' }),
      // 07/01 23:30 em Brasília, embora já seja 08/01 no UTC: fora
      fora: ev(Date.UTC(2027, 0, 8, 2, 30), { day: '2027-01-08' }),
    },
  };
  const r = consolidatedSummary(eventos, {}, { days: 7, agoraMs: AGORA, euDeviceId: 'd1' });
  assert.equal(r.totals.sessions, 1);
  assert.deepEqual(r.series, [{ day: '2027-01-08', costUsd: 1, sessions: 1 }]);
  const tudo = consolidatedSummary(eventos, {}, { days: 0, agoraMs: AGORA, euDeviceId: 'd1' });
  assert.equal(tudo.totals.sessions, 2, 'days 0 é o histórico inteiro');
  assert.deepEqual(tudo.series.map((s) => s.day), ['2027-01-07', '2027-01-08'], 'série em ordem de dia');
});

// "Este aparelho" (usageDayKeysBack, dias locais) e "Todos os aparelhos" precisam somar
// a MESMA quantidade de dias civis, senão trocar o segmentado num aparelho só já
// mostra totais diferentes para a mesma janela. A comparação é pela contagem porque o
// dia local depende do fuso do processo e o consolidado corta sempre em Brasília.
test('janela de n dias soma n dias civis, como a aba local', () => {
  const d1 = {};
  // um evento ao meio-dia de Brasília (15:00 UTC) em cada um dos 40 dias até hoje, 14/01
  for (let i = 0; i < 40; i++) d1[`e${i}`] = ev(Date.UTC(2027, 0, 14, 15, 0) - i * TEMPOS.DIA_MS);
  for (const n of [7, 15, 30]) {
    const r = consolidatedSummary({ d1 }, {}, { days: n, agoraMs: AGORA, euDeviceId: 'd1' });
    assert.equal(r.series.length, usageDayKeysBack(n, AGORA).length, `${n} dias: mesma contagem de dias da aba local`);
    assert.equal(r.totals.sessions, n, `${n} dias: um evento por dia`);
    assert.equal(r.series.at(-1).day, '2027-01-14', 'o último dia é hoje em Brasília');
  }
});

test('aparelhos: euMesmo, nome, somas por aparelho e quem não gastou aparece zerado', () => {
  const eventos = {
    d1: { a: ev(AGORA - 1000, { costUsd: 2, inputTokens: 5 }), b: ev(AGORA - 500, { costUsd: 3, inputTokens: 7 }) },
    d2: { c: ev(AGORA - 2000, { costUsd: 10 }) },
  };
  const devices = { d1: { name: 'Mesa' }, d2: { name: 'Celular' }, d3: { name: 'Notebook' } };
  const r = consolidatedSummary(eventos, devices, { days: 30, agoraMs: AGORA, euDeviceId: 'd1' });
  assert.deepEqual(r.devices.map((d) => d.deviceId), ['d1', 'd2', 'd3'], 'eu primeiro, depois quem gastou mais');
  const [eu, cel, nb] = r.devices;
  assert.equal(eu.euMesmo, true);
  assert.equal(eu.name, 'Mesa');
  assert.equal(eu.sessions, 2);
  assert.equal(eu.costUsd, 5);
  assert.equal(eu.inputTokens, 12);
  assert.equal(eu.lastAt, AGORA - 500);
  assert.equal(cel.euMesmo, false);
  assert.equal(cel.costUsd, 10);
  assert.deepEqual([nb.sessions, nb.costUsd, nb.lastAt], [0, 0, 0]);
});

test('totais separam medido, estimado e sem base', () => {
  const eventos = {
    d1: {
      a: ev(AGORA, { costUsd: 4, costSource: 'medido' }),
      b: ev(AGORA, { costUsd: 1.5, costSource: 'estimado' }),
      c: ev(AGORA, { costUsd: 0, costSource: 'sem-base' }),
      d: ev(AGORA, { costUsd: 2, costSource: undefined }),
    },
  };
  const r = consolidatedSummary(eventos, {}, { days: 7, agoraMs: AGORA, euDeviceId: 'd1' });
  assert.deepEqual(r.totals, {
    sessions: 4, costUsd: 7.5,
    medido: { sessions: 2, costUsd: 6 }, estimado: { sessions: 1, costUsd: 1.5 }, semBase: { sessions: 1, costUsd: 0 },
  });
});

test('entrada torta não derruba a projeção', () => {
  const r = consolidatedSummary({ d1: 'lixo', d2: { x: null, y: [1], z: ev(AGORA) } }, null, { days: 7, agoraMs: AGORA });
  assert.equal(r.totals.sessions, 1);
  assert.equal(consolidatedSummary(null, null, { days: 7, agoraMs: AGORA }).totals.sessions, 0);
});

// ---------- engine e rotas ----------

const ORIGEM_EMULADOR_AUTH = new URL(SYNC.AUTH_EMULATOR_IDENTITY_URL).origin;
async function fetchDosDubles(url, init) {
  const alvo = String(url).replace(ORIGEM_EMULADOR_AUTH, identity.url);
  if (!alvo.startsWith('http://127.0.0.1:')) throw new Error('o teste tentou sair da máquina');
  return fetch(alvo, init);
}

function syncCfg(extra = {}) {
  return {
    enabled: true, coordination: { enabled: false }, consolidation: { enabled: false },
    deviceName: 'Mesa', apiKey: API_KEY, databaseUrl: rtdb.url, projectId: 'farol-local', ...extra,
  };
}

async function salvarSync(engine, cfg) {
  engine.updateSettings({ sync: cfg });
  if (engine.sync.iniciando) await engine.sync.iniciando;
}

const engine = new Engine();
engine.sync.fetchImpl = fetchDosDubles;

test('consolidação desligada responde desligado e não lê o banco', async () => {
  await salvarSync(engine, syncCfg());
  assert.equal((await engine.syncLogin({ email: EMAIL, password: SENHA })).ok, true);
  const antes = rtdb.requests.length;
  const r = await engine.syncConsolidated('7');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'desligado');
  const c = await engine.syncConsolidate();
  assert.equal(c.ok, false);
  assert.equal(c.code, 'desligado');
  assert.equal(rtdb.requests.length, antes);
});

test('outro UID nunca aparece: a leitura é sempre em /users/{uid}', async () => {
  await salvarSync(engine, syncCfg({ consolidation: { enabled: true } }));
  const eu = engine.sync.deviceId;
  const arvore = rtdb.tree();
  arvore.users.u1.devices.celular = { name: 'Celular', lastSeenAt: AGORA };
  arvore.users.u1.usageEvents = { celular: { e1: ev(Date.now() - 1000, { costUsd: 3 }) } };
  arvore.users.u2 = { devices: { intruso: { name: 'Aparelho de outra pessoa' } }, usageEvents: { intruso: { e9: ev(Date.now(), { costUsd: 99 }) } } };
  rtdb.setTree(arvore);
  const antes = rtdb.requests.length;

  const r = await engine.syncConsolidated('30');
  assert.equal(r.ok, true);
  const ids = r.resumo.devices.map((d) => d.deviceId);
  assert.ok(ids.includes(eu) && ids.includes('celular'));
  assert.equal(ids.includes('intruso'), false);
  assert.equal(r.resumo.totals.costUsd >= 3 && r.resumo.totals.costUsd < 99, true);
  assert.equal(r.resumo.devices[0].euMesmo, true);
  const leituras = rtdb.requests.slice(antes);
  assert.ok(leituras.length > 0);
  for (const q of leituras) assert.ok(q.path.startsWith('/users/u1/'), `leitura fora do próprio uid: ${q.path}`);
});

test('consolidate: zera o cursor, reenfileira o histórico inteiro e envia sem duplicar', async () => {
  engine.recordUsage('a1', 'fulano', { usage: { output_tokens: 3 }, total_cost_usd: 0.25 }, 'opus', 'p1', 'o/r#1');
  engine.recordUsage('a2', 'fulano', { usage: { output_tokens: 4 }, total_cost_usd: 0.5 }, 'opus', 'p1', 'o/r#2');
  await engine.syncTick();
  const eu = engine.sync.deviceId;
  const remoto = () => Object.keys((rtdb.tree().users.u1.usageEvents || {})[eu] || {});
  const antes = remoto().length;
  assert.equal(antes, engine.usageSessions.sessions.length);

  const c = await engine.syncConsolidate();
  assert.equal(c.ok, true);
  assert.equal(c.enfileirados, engine.usageSessions.sessions.length, 'todo o histórico volta pra fila');
  assert.equal(c.pendentes, 0, 'e sai na mesma chamada');
  assert.deepEqual(remoto().sort(), engine.usageSessions.sessions.map((s) => eventIdFor(s, eu)).sort(), 'mesmo conjunto de eventos, nenhum a mais');
});

test('rotas: envelope nas duas, janela saneada e nada de e-mail ou token na resposta', async () => {
  const { startServer } = await import('../lib/http-server.js');
  engine.config.port = 0;
  const server = startServer(engine);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const texto = await (await fetch(`${base}/api/sync/consolidated?days=7`)).text();
    const r = JSON.parse(texto);
    assert.equal(r.ok, true);
    assert.deepEqual(Object.keys(r).sort(), ['ok', 'resumo']);
    assert.ok(Array.isArray(r.resumo.devices) && Array.isArray(r.resumo.series));
    assert.equal(texto.includes(EMAIL), false);
    assert.equal(texto.includes('auth='), false);
    for (const t of identity.tokens.idTokens) assert.equal(texto.includes(t), false);

    const torta = JSON.parse(await (await fetch(`${base}/api/sync/consolidated?days=abc`)).text());
    assert.equal(torta.ok, true, 'janela inválida cai no padrão em vez de falhar');

    const post = await fetch(`${base}/api/sync/consolidate`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-farol': '1' }, body: '{}' });
    const c = JSON.parse(await post.text());
    assert.deepEqual(Object.keys(c).sort(), ['enfileirados', 'ok', 'pendentes']);

    await salvarSync(engine, syncCfg());
    const off = JSON.parse(await (await fetch(`${base}/api/sync/consolidated?days=7`)).text());
    assert.deepEqual(Object.keys(off).sort(), ['code', 'motivo', 'ok']);
    assert.equal(off.code, 'desligado');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('test/sync-consolidated.test.js')).digest('hex').slice(0,16))"
```

Esperado: `b8b83c31d7014696`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

Crie `test/sync-coordinator.test.js` com EXATAMENTE este conteúdo:

```js
// lib/sync/coordinator.js: a admissão de uma análise entre aparelhos (recibo, preflight
// do GitHub, lease, releitura sob lease, teto de rodadas) e o handle que renova o lease
// e grava o recibo no fim. O banco é o dublê em processo; o engine é um objeto mínimo
// com os campos que o coordenador lê (o runtime de lib/engine/sync.js já conectado).
//
// FAROL_HOME antes do import: o coordenador alcança lib/paths.js (versão do app e o Set
// de estados decisivos de decision.js), então ele entra por await import.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-sync-coordinator-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';
import { SYNC } from '../lib/constants.js';
import { accountHash, prHash, operationFingerprint, brasiliaDay } from '../lib/sync/keys.js';
import { motivoDe } from '../lib/sync/errors.js';

const { createRtdbClient } = await import('../lib/sync/rtdb.js');
const coordinator = await import('../lib/sync/coordinator.js');
const { admit, createHandle, noopHandle, preflightManual, registrarRecibo } = coordinator;

const TOKEN = 'tok-ok';
const AGORA = 1_800_000_000_000;
const HEAD = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const PR_KEY = 'Org/Repo#7';
const IDS = { uid: 'u1', accountHash: accountHash('Eu'), prHash: prHash(PR_KEY) };
const FP = operationFingerprint('review', HEAD);
let fake;

before(async () => { fake = await startFakeRtdb({ token: TOKEN }); });
after(async () => {
  await fake.close();
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});
beforeEach(() => { fake.setTree(null); fake.requests.length = 0; });

function cliente() {
  return createRtdbClient({ databaseUrl: fake.url, getIdToken: async () => ({ ok: true, idToken: TOKEN }) });
}

function motor(extra = {}) {
  const rt = {
    status: 'conectado', lastError: null, uid: 'u1', email: '', deviceId: 'dEu', deviceName: 'Notebook',
    client: cliente(), tokenSource: null, skewMs: 0,
    devices: { dEu: { name: 'Notebook', lastSeenAt: AGORA }, dOutro: { name: 'Desktop', lastSeenAt: AGORA } },
    leasesVistos: {}, recibosVistos: {}, espera: {}, relogio: AGORA,
  };
  rt.agora = () => rt.relogio;
  const engine = {
    config: { sync: { enabled: true, coordination: { enabled: true }, consolidation: { enabled: false } } },
    sync: rt, logs: [], seen: new Set(), cancelados: [], reviewStates: [],
    log(level, msg) { this.logs.push([level, msg]); },
    markSeen(k) { this.seen.add(k); },
    cancelSession(id) { this.cancelados.push(id); },
    async myReviewStates() { return this.reviewStates; },
    accountForPr: (pr) => pr.account || 'eu',
    async headSha() { return HEAD; },
  };
  return Object.assign(engine, extra);
}

function ctxDe(extra = {}) {
  const pr = { key: PR_KEY, url: 'https://github.com/Org/Repo/pull/7', repo: 'Org/Repo', number: 7, author: 'autor', account: 'Eu' };
  return {
    prKey: PR_KEY, account: 'Eu', materialVersion: HEAD, headSha: HEAD, contaRodada: false, manual: false,
    semCoordenacao: false, ignorarRecibo: false, pr, operationKind: 'review', opId: 'a-1', ...extra,
  };
}

function reciboDe(extra = {}) {
  return {
    operationKind: 'review', materialVersion: HEAD, deviceId: 'dOutro', leaseId: 'LO', completedAt: AGORA - 1000,
    lastVerifiedAt: AGORA - 1000, expiresAt: AGORA + SYNC.RECEIPT_TTL_MS, outcome: 'completed',
    publicationState: 'published', reviewId: '', farolVersion: '9.9.9', ...extra,
  };
}

function usuario() {
  const t = fake.tree();
  return (t && t.users && t.users.u1) || {};
}

function leaseNoBanco() {
  const l = usuario().leases;
  return l && l[IDS.accountHash] && l[IDS.accountHash][IDS.prHash];
}

function reciboNoBanco() {
  const r = usuario().receipts;
  return r && r[IDS.accountHash] && r[IDS.accountHash][IDS.prHash] && r[IDS.accountHash][IDS.prHash][FP];
}

function semearRecibo(recibo) {
  fake.setTree({ users: { u1: { receipts: { [IDS.accountHash]: { [IDS.prHash]: { [FP]: recibo } } } } } });
}

function semearLease(lease) {
  fake.setTree({ users: { u1: { leases: { [IDS.accountHash]: { [IDS.prHash]: lease } } } } });
}

function leaseDoOutro() {
  return { leaseId: 'LO', deviceId: 'dOutro', operationKind: 'review', headSha: HEAD, acquiredAt: AGORA - 5000, heartbeatAt: AGORA - 5000, expiresAt: AGORA + 60_000, farolVersion: '9.9.9' };
}

async function ate(cond, limite = 2000) {
  const inicio = Date.now();
  while (!cond()) {
    if (Date.now() - inicio > limite) throw new Error('condição não chegou a tempo');
    await new Promise((r) => setTimeout(r, 5));
  }
}

test('noopHandle segue o contrato e não faz nada', async () => {
  const h = noopHandle();
  assert.equal(h.noop, true);
  assert.equal(h.leaseId, '');
  assert.equal(h.attemptId, '');
  assert.equal(h.lost, false);
  assert.equal(h.done, true);
  h.onLost(() => { throw new Error('nunca chamado'); });
  assert.deepEqual(await h.complete({ publicationState: 'published' }), { ok: true });
  assert.equal(await h.abort(), undefined);
});

test('coordenação desligada: admite com handle noop sem tocar a rede', async () => {
  const e = motor();
  e.config.sync.coordination.enabled = false;
  e.sync.client = null;
  const a = await admit(e, ctxDe());
  assert.equal(a.admitted, true);
  assert.equal(a.handle.noop, true);
  assert.equal(fake.requests.length, 0);
});

test('semCoordenacao confirmado no clique: admite noop e registra INFO no log', async () => {
  const e = motor();
  e.sync.status = 'erro';
  const a = await admit(e, ctxDe({ manual: true, semCoordenacao: true }));
  assert.equal(a.admitted, true);
  assert.equal(a.handle.noop, true);
  assert.deepEqual(e.logs, [['INFO', `${PR_KEY}: gate de coordenação contornado por decisão manual`]]);
  assert.equal(fake.requests.length, 0);
});

test('semCoordenacao sem clique manual não é honrado: override é só do clique', async () => {
  const e = motor();
  e.sync.status = 'erro';
  const a = await admit(e, ctxDe({ manual: false, semCoordenacao: true }));
  assert.equal(a.admitted, false);
  assert.equal(a.reason, 'indisponivel');
  assert.deepEqual(e.logs, []);
});

test('runtime fora de conectado: indisponivel com o motivo do último erro, sem rede', async () => {
  const e = motor();
  e.sync.status = 'erro';
  e.sync.lastError = { code: 'timeout', motivo: 'x', at: 1 };
  const a = await admit(e, ctxDe());
  assert.deepEqual(a, { admitted: false, reason: 'indisponivel', detail: { motivo: motivoDe('timeout') } });
  e.sync.status = 'conectando';
  e.sync.lastError = null;
  const b = await admit(e, ctxDe());
  assert.deepEqual(b.detail, { motivo: motivoDe('indisponivel') });
  assert.equal(fake.requests.length, 0);
});

test('versão material vazia: indisponivel, a coordenação exige saber o que foi analisado', async () => {
  const a = await admit(motor(), ctxDe({ materialVersion: '' }));
  assert.deepEqual(a, { admitted: false, reason: 'indisponivel', detail: { motivo: 'head do PR desconhecido; a coordenação exige a versão material' } });
  assert.equal(fake.requests.length, 0);
});

test('chave de PR fora do formato: indisponivel sem tocar a rede', async () => {
  const a = await admit(motor(), ctxDe({ prKey: 'sem-formato' }));
  assert.equal(a.admitted, false);
  assert.equal(a.reason, 'indisponivel');
  assert.equal(fake.requests.length, 0);
});

test('recibo válido de outro aparelho: recusa com o nome dele, marca o PR como visto e não pega lease', async () => {
  semearRecibo(reciboDe());
  const e = motor();
  const a = await admit(e, ctxDe());
  assert.equal(a.admitted, false);
  assert.equal(a.reason, 'recibo');
  assert.equal(a.detail.deviceName, 'Desktop');
  assert.equal(a.detail.receipt.deviceId, 'dOutro');
  assert.ok(e.seen.has(PR_KEY), 'review com recibo vira visto: o PR não volta a disparar');
  assert.deepEqual(e.sync.recibosVistos[PR_KEY], {
    at: AGORA - 1000, deviceId: 'dOutro', deviceName: 'Desktop', publicationState: 'published', operationKind: 'review', orfao: 'ativo',
  });
  assert.equal(leaseNoBanco(), undefined, 'nenhum lease foi adquirido');
});

test('recibo vencido não bloqueia', async () => {
  semearRecibo(reciboDe({ expiresAt: AGORA }));
  const e = motor();
  const a = await admit(e, ctxDe());
  assert.equal(a.admitted, true);
  await a.handle.abort();
});

test('recibo de autoanálise não marca o PR como visto (seen é da revisão)', async () => {
  const fpSelf = operationFingerprint('self', HEAD);
  fake.setTree({ users: { u1: { receipts: { [IDS.accountHash]: { [IDS.prHash]: { [fpSelf]: reciboDe({ operationKind: 'self' }) } } } } } });
  const e = motor();
  const a = await admit(e, ctxDe({ operationKind: 'self' }));
  assert.equal(a.reason, 'recibo');
  assert.equal(e.seen.has(PR_KEY), false);
});

test('ignorarRecibo confirmado no clique atravessa o recibo e o preflight do GitHub', async () => {
  semearRecibo(reciboDe());
  const e = motor();
  e.reviewStates = ['APPROVED'];
  const a = await admit(e, ctxDe({ manual: true, ignorarRecibo: true }));
  assert.equal(a.admitted, true);
  assert.equal(leaseNoBanco().leaseId, a.handle.leaseId);
  await a.handle.abort();
});

test('preflight do GitHub com APPROVED meu no head: recibo externo gravado e recusa', async () => {
  const e = motor();
  e.reviewStates = ['COMMENTED', 'APPROVED'];
  let pedido = null;
  e.myReviewStates = async (pr, head) => { pedido = { pr, head }; return e.reviewStates; };
  const a = await admit(e, ctxDe());
  assert.deepEqual(a, { admitted: false, reason: 'recibo', detail: { externo: true } });
  assert.equal(pedido.head, HEAD);
  assert.equal(pedido.pr.key, PR_KEY);
  const r = reciboNoBanco();
  assert.equal(r.outcome, 'external_review');
  assert.equal(r.publicationState, 'published');
  assert.equal(r.leaseId, '');
  assert.equal(r.deviceId, 'dEu');
  assert.ok(e.seen.has(PR_KEY));
  assert.equal(leaseNoBanco(), undefined);
});

test('preflight do GitHub só com COMMENTED não é desfecho: admite', async () => {
  const e = motor();
  e.reviewStates = ['COMMENTED', 'DISMISSED'];
  const a = await admit(e, ctxDe());
  assert.equal(a.admitted, true);
  await a.handle.abort();
});

test('myReviewStates null (não deu para consultar) NÃO bloqueia', async () => {
  const e = motor();
  e.reviewStates = null;
  const a = await admit(e, ctxDe());
  assert.equal(a.admitted, true);
  assert.equal(reciboNoBanco(), undefined);
  await a.handle.abort();
});

test('myReviewStates que lança também não bloqueia nem derruba a admissão', async () => {
  const e = motor();
  e.myReviewStates = async () => { throw new Error('gh caiu'); };
  const a = await admit(e, ctxDe());
  assert.equal(a.admitted, true);
  await a.handle.abort();
});

test('preflight do GitHub não roda fora da revisão', async () => {
  const e = motor();
  let chamou = false;
  e.myReviewStates = async () => { chamou = true; return ['APPROVED']; };
  const a = await admit(e, ctxDe({ operationKind: 'pushback', materialVersion: 'marcador-1' }));
  assert.equal(a.admitted, true);
  assert.equal(chamou, false);
  await a.handle.abort();
});

test('lease vivo de outro aparelho: alheio com o nome do aparelho, desde quando e o tipo da operação dele', async () => {
  semearLease(leaseDoOutro());
  const a = await admit(motor(), ctxDe());
  assert.deepEqual(a, { admitted: false, reason: 'alheio', detail: { deviceId: 'dOutro', deviceName: 'Desktop', since: AGORA - 5000, operationKind: 'review' } });
  assert.equal(leaseNoBanco().leaseId, 'LO', 'o lease do outro fica intacto');
});

test('admissão ok grava o lease deste aparelho com a versão material', async () => {
  const e = motor();
  const a = await admit(e, ctxDe());
  assert.equal(a.admitted, true);
  assert.equal(a.handle.noop, false);
  assert.equal(a.handle.lost, false);
  assert.equal(a.handle.done, false);
  const l = leaseNoBanco();
  assert.equal(l.leaseId, a.handle.leaseId);
  assert.equal(l.deviceId, 'dEu');
  assert.equal(l.operationKind, 'review');
  assert.equal(l.headSha, HEAD);
  assert.equal(l.expiresAt, AGORA + SYNC.LEASE_TTL_MS);
  await a.handle.abort();
});

test('releitura sob lease: recibo gravado por outro aparelho entre a primeira leitura e a aquisição', async () => {
  const e = motor();
  const base = e.sync.client;
  const outro = cliente();
  let intercalou = false;
  // o outro aparelho termina a mesma análise no instante em que este vai pegar o lease
  e.sync.client = {
    ...base,
    put: async (p, v, o) => {
      if (!intercalou && p.includes('/leases/')) {
        intercalou = true;
        await outro.put(`/users/u1/receipts/${IDS.accountHash}/${IDS.prHash}/${FP}`, reciboDe(), { ifMatch: 'null_etag' });
      }
      return base.put(p, v, o);
    },
  };
  const a = await admit(e, ctxDe());
  assert.equal(intercalou, true, 'o gancho rodou antes da aquisição');
  assert.equal(a.admitted, false);
  assert.equal(a.reason, 'recibo');
  assert.equal(a.detail.deviceName, 'Desktop');
  assert.equal(leaseNoBanco(), undefined, 'o lease adquirido foi liberado');
  assert.ok(e.seen.has(PR_KEY));
});

test('rodada automática com o teto do dia esgotado: esgotado e lease liberado', async () => {
  const dia = brasiliaDay(AGORA);
  const cheio = {};
  for (let i = 0; i < SYNC.DAILY_ROUNDS_MAX; i++) cheio['s' + i] = { operationFingerprint: 'f', leaseId: 'L' + i, state: 'started', reservedAt: 1, startedAt: 2, expiresAt: 3 };
  fake.setTree({ users: { u1: { dailyRounds: { [IDS.accountHash]: { [IDS.prHash]: { [dia]: { dayPolicy: SYNC.DAY_TZ, updatedAt: 1, reservations: cheio } } } } } } });
  const a = await admit(motor(), ctxDe({ contaRodada: true }));
  assert.deepEqual(a, { admitted: false, reason: 'esgotado', detail: { day: dia, started: SYNC.DAILY_ROUNDS_MAX } });
  assert.equal(leaseNoBanco(), undefined, 'lease liberado');
});

test('rodada automática com lugar: reserva iniciada com o lease e o attemptId do handle, no dia de Brasília', async () => {
  const e = motor();
  // 02:30 UTC de 11/09 ainda é 10/09 em Brasília: quem escolhe o dia é o coordenador
  e.sync.relogio = Date.UTC(2026, 8, 11, 2, 30);
  const a = await admit(e, ctxDe({ contaRodada: true }));
  assert.equal(a.admitted, true);
  assert.ok(a.handle.attemptId);
  const dias = usuario().dailyRounds[IDS.accountHash][IDS.prHash];
  assert.equal(dias['2026-09-11'], undefined, 'nunca o dia UTC');
  const dia = dias['2026-09-10'];
  assert.ok(dia, 'a reserva nasce no dia de Brasília');
  const res = dia.reservations[a.handle.attemptId];
  assert.equal(res.state, 'started');
  assert.equal(res.leaseId, a.handle.leaseId);
  assert.equal(res.operationFingerprint, FP);
  await a.handle.abort();
});

test('preflight do GitHub lento: lease e rodada nascem com o relógio da aquisição, não o do início', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const e = motor();
  // gh no teto (60s) mais a leitura do recibo no teto (15s) mais rede
  const DEMORA = 95_000;
  e.myReviewStates = async () => { e.sync.relogio += DEMORA; return []; };
  const a = await admit(e, ctxDe({ contaRodada: true }));
  assert.equal(a.admitted, true);
  const naAquisicao = AGORA + DEMORA;
  const l = leaseNoBanco();
  assert.equal(l.acquiredAt, naAquisicao);
  assert.equal(l.expiresAt, naAquisicao + SYNC.LEASE_TTL_MS);
  const res = usuario().dailyRounds[IDS.accountHash][IDS.prHash][brasiliaDay(naAquisicao)].reservations[a.handle.attemptId];
  assert.equal(res.reservedAt, naAquisicao);
  assert.equal(res.startedAt, naAquisicao);
  // a primeira batida acha o lease vivo e renova, em vez de cancelar a sessão que acabou de subir
  e.sync.relogio = naAquisicao + SYNC.HEARTBEAT_MS;
  t.mock.timers.tick(SYNC.HEARTBEAT_MS);
  await ate(() => leaseNoBanco() && leaseNoBanco().heartbeatAt === naAquisicao + SYNC.HEARTBEAT_MS);
  assert.equal(a.handle.lost, false);
  assert.deepEqual(e.cancelados, []);
  await a.handle.abort();
});

test('sem contaRodada nada é reservado no teto do dia', async () => {
  const a = await admit(motor(), ctxDe());
  assert.equal(a.handle.attemptId, '');
  assert.equal(usuario().dailyRounds, undefined);
  await a.handle.abort();
});

test('handle.complete grava o recibo, libera o lease e encerra', async () => {
  const e = motor();
  const a = await admit(e, ctxDe());
  e.sync.relogio = AGORA + 1000;
  const r = await a.handle.complete({ publicationState: 'published', reviewId: 'R1' });
  assert.deepEqual(r, { ok: true });
  const rec = reciboNoBanco();
  assert.equal(rec.outcome, 'completed');
  assert.equal(rec.publicationState, 'published');
  assert.equal(rec.reviewId, 'R1');
  assert.equal(rec.leaseId, a.handle.leaseId);
  assert.equal(rec.deviceId, 'dEu');
  assert.equal(rec.materialVersion, HEAD);
  assert.equal(rec.completedAt, AGORA + 1000);
  assert.equal(leaseNoBanco(), undefined, 'lease liberado');
  assert.equal(a.handle.done, true);
  const de_novo = await a.handle.complete({ publicationState: 'published' });
  assert.equal(de_novo.ok, false, 'complete duas vezes não grava de novo');
});

test('handle.complete sobre recibo antigo do mesmo head: sobrescreve', async () => {
  const e = motor();
  const a = await admit(e, ctxDe({ manual: true, ignorarRecibo: true }));
  // recibo antigo (refazer confirmado) já está lá quando esta sessão termina
  await cliente().put(`/users/u1/receipts/${IDS.accountHash}/${IDS.prHash}/${FP}`, reciboDe({ completedAt: AGORA - SYNC.LEASE_TTL_MS - 1, publicationState: 'failed' }), { ifMatch: 'null_etag' });
  const r = await a.handle.complete({ publicationState: 'published' });
  assert.deepEqual(r, { ok: true });
  assert.equal(reciboNoBanco().deviceId, 'dEu');
  assert.equal(reciboNoBanco().publicationState, 'published');
});

test('handle.complete com recibo recente de um sucessor: mantém o do outro', async () => {
  const e = motor();
  const a = await admit(e, ctxDe());
  await cliente().put(`/users/u1/receipts/${IDS.accountHash}/${IDS.prHash}/${FP}`, reciboDe({ completedAt: AGORA - 10 }), { ifMatch: 'null_etag' });
  const r = await a.handle.complete({ publicationState: 'published' });
  assert.equal(r.ok, true);
  assert.equal(reciboNoBanco().deviceId, 'dOutro', 'não sobrescreve o sucessor');
  assert.equal(leaseNoBanco(), undefined);
});

test('handle.abort libera o lease sem gravar recibo', async () => {
  const a = await admit(motor(), ctxDe());
  await a.handle.abort();
  assert.equal(a.handle.done, true);
  assert.equal(leaseNoBanco(), undefined);
  assert.equal(reciboNoBanco(), undefined);
  await a.handle.abort();
});

test('heartbeat renova o lease a cada HEARTBEAT_MS', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const e = motor();
  const a = await admit(e, ctxDe());
  e.sync.relogio = AGORA + SYNC.HEARTBEAT_MS;
  t.mock.timers.tick(SYNC.HEARTBEAT_MS);
  await ate(() => leaseNoBanco() && leaseNoBanco().heartbeatAt === AGORA + SYNC.HEARTBEAT_MS);
  assert.equal(leaseNoBanco().expiresAt, AGORA + SYNC.HEARTBEAT_MS + SYNC.LEASE_TTL_MS);
  assert.equal(a.handle.lost, false);
  await a.handle.abort();
});

test('heartbeat recusado (outro aparelho tomou o lease): lost, onLost, cancela a sessão e complete não grava', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const e = motor();
  const a = await admit(e, ctxDe());
  const perdas = [];
  a.handle.onLost(() => perdas.push('cb1'));
  a.handle.onLost(() => { throw new Error('consumidor com defeito'); });
  a.handle.onLost(() => perdas.push('cb3'));
  semearLease(leaseDoOutro());
  t.mock.timers.tick(SYNC.HEARTBEAT_MS);
  await ate(() => a.handle.lost);
  assert.deepEqual(perdas, ['cb1', 'cb3'], 'cada cb roda, e um que lança não impede os outros');
  assert.deepEqual(e.cancelados, ['a-1'], 'a sessão do opId é cancelada');
  const tardio = [];
  a.handle.onLost(() => tardio.push('tarde'));
  assert.deepEqual(tardio, ['tarde'], 'onLost depois da perda avisa na hora');
  const r = await a.handle.complete({ publicationState: 'published' });
  assert.deepEqual(r, { ok: false, code: 'conflito', motivo: 'lease perdido; recibo não gravado' });
  assert.equal(reciboNoBanco(), undefined, 'nenhum recibo');
  assert.equal(leaseNoBanco().leaseId, 'LO', 'o lease do outro fica intacto');
  t.mock.timers.tick(SYNC.HEARTBEAT_MS * 3);
  await new Promise((r2) => setTimeout(r2, 20));
  assert.deepEqual(e.cancelados, ['a-1'], 'o timer parou: nada é cancelado de novo');
});

test('heartbeat sem rede não perde o lease: espera a próxima batida', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const e = motor();
  const a = await admit(e, ctxDe());
  const base = e.sync.client;
  e.sync.client = { ...base, get: async () => ({ ok: false, code: 'indisponivel', status: 0, motivo: 'sem rede' }) };
  const h = createHandle(e, { ids: IDS, fingerprint: FP, leaseId: a.handle.leaseId, attemptId: '', ctx: ctxDe() });
  t.mock.timers.tick(SYNC.HEARTBEAT_MS);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(h.lost, false);
  assert.deepEqual(e.cancelados, []);
  e.sync.client = base;
  await h.abort();
  await a.handle.abort();
});

test('heartbeat sem rede por mais que o TTL: o próprio aparelho declara o lease perdido e cancela a sessão', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let rede = true;
  let semRede = 0;
  // a queda é do token (getIdToken falha antes de qualquer fetch), como numa partição real
  const client = createRtdbClient({
    databaseUrl: fake.url,
    getIdToken: async () => {
      if (rede) return { ok: true, idToken: TOKEN };
      semRede++;
      return { ok: false, code: 'indisponivel', motivo: 'sem rede' };
    },
  });
  const a = motor();
  a.sync.client = client;
  const adm = await admit(a, ctxDe());
  assert.equal(adm.admitted, true);
  const perdas = [];
  adm.handle.onLost(() => perdas.push('perdeu'));
  rede = false;
  const batidas = SYNC.LEASE_TTL_MS / SYNC.HEARTBEAT_MS;
  for (let i = 1; i <= batidas; i++) {
    a.sync.relogio = AGORA + i * SYNC.HEARTBEAT_MS;
    t.mock.timers.tick(SYNC.HEARTBEAT_MS);
    await ate(() => semRede === i);
    await new Promise((r) => setTimeout(r, 10));
    if (i < batidas) assert.equal(adm.handle.lost, false, `batida ${i}: ainda dentro da validade, rede fora não encerra`);
  }
  assert.equal(adm.handle.lost, true, 'validade local vencida: perdido mesmo sem conseguir ler o banco');
  assert.deepEqual(a.cancelados, ['a-1'], 'a sessão é cancelada');
  assert.deepEqual(perdas, ['perdeu']);
  // outro aparelho assume o lease vencido, e só um dos dois segue rodando
  const b = motor({ cancelados: [] });
  b.sync.deviceId = 'dOutro';
  b.sync.relogio = AGORA + SYNC.LEASE_TTL_MS;
  const admB = await admit(b, ctxDe({ opId: 'b-1' }));
  assert.equal(admB.admitted, true);
  const r = await adm.handle.complete({ publicationState: 'published' });
  assert.deepEqual(r, { ok: false, code: 'conflito', motivo: 'lease perdido; recibo não gravado' });
  assert.equal(reciboNoBanco(), undefined, 'a sessão perdida não grava recibo');
  await admB.handle.abort();
});

test('registrarRecibo guarda o recibo visto para a tela e marca seen só na revisão', () => {
  const e = motor();
  registrarRecibo(e, ctxDe(), reciboDe({ publicationState: 'pending', completedAt: AGORA - SYNC.ORPHAN_AFTER_MS }));
  assert.equal(e.sync.recibosVistos[PR_KEY].orfao, 'ativo', 'aparelho visto agora: não é órfão');
  assert.ok(e.seen.has(PR_KEY));
  const e2 = motor();
  registrarRecibo(e2, ctxDe({ operationKind: 'pushback' }), reciboDe({ operationKind: 'pushback' }));
  assert.equal(e2.seen.size, 0, 'pushback: quem avança o marcador é o chamador');
  assert.equal(e2.sync.recibosVistos[PR_KEY].operationKind, 'pushback');
});

const PR = { key: PR_KEY, url: 'https://github.com/Org/Repo/pull/7', repo: 'Org/Repo', number: 7, account: 'Eu' };

function soLeituras() {
  return fake.requests.every((q) => q.method === 'GET');
}

test('preflightManual: coordenação desligada é ok sem rede', async () => {
  const e = motor();
  e.config.sync.coordination.enabled = false;
  assert.deepEqual(await preflightManual(e, PR), { ok: true });
  assert.equal(fake.requests.length, 0);
});

test('preflightManual: fora de conectado é indisponivel', async () => {
  const e = motor();
  e.sync.status = 'sem-credencial';
  const r = await preflightManual(e, PR);
  assert.deepEqual(r, { ok: false, reason: 'indisponivel', detail: { motivo: motivoDe('indisponivel') } });
});

test('preflightManual: head desconhecido é indisponivel', async () => {
  const e = motor();
  e.headSha = async () => '';
  const r = await preflightManual(e, PR);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'indisponivel');
});

test('preflightManual: recibo existente é recibo, sem escrever e sem marcar seen', async () => {
  semearRecibo(reciboDe());
  const e = motor();
  const r = await preflightManual(e, PR);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'recibo');
  assert.equal(r.detail.deviceName, 'Desktop');
  assert.ok(soLeituras(), 'nunca escreve');
  assert.equal(e.seen.size, 0);
});

test('preflightManual: lease vivo de outro aparelho é alheio, sem adquirir', async () => {
  semearLease(leaseDoOutro());
  const r = await preflightManual(motor(), PR);
  assert.deepEqual(r, { ok: false, reason: 'alheio', detail: { deviceId: 'dOutro', deviceName: 'Desktop', since: AGORA - 5000, operationKind: 'review' } });
  assert.ok(soLeituras());
});

// M1: accountHash('') devolve hash válido, então conta vazia coordenaria num namespace
// só deste aparelho, e o aparelho que sabe a conta, em outro: os dois se dariam por
// sozinhos no mesmo PR e no mesmo head.
test('conta vazia é indisponivel com motivo próprio, nos dois caminhos, sem tocar a rede', async () => {
  const e = motor();
  const a = await admit(e, ctxDe({ account: '   ' }));
  assert.equal(a.admitted, false);
  assert.equal(a.reason, 'indisponivel');
  assert.match(a.detail.motivo, /conta dona do PR desconhecida/);
  assert.equal(fake.requests.length, 0, 'recusa antes de qualquer chamada ao banco');

  const e2 = motor({ accountForPr: () => '' });
  const r = await preflightManual(e2, { key: PR_KEY, url: PR.url, repo: 'Org/Repo', number: 7 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'indisponivel');
  assert.match(r.detail.motivo, /conta dona do PR desconhecida/);
  assert.equal(fake.requests.length, 0);
});

// M2: sem o release, o PR ficava travado para os outros aparelhos até o TTL do lease,
// por causa de uma sessão que nem chegou a começar.
test('exceção depois de adquirir o lease libera o lease antes de virar indisponivel', async () => {
  const e = motor();
  // defeito na camada das rodadas, que só é tocada DEPOIS do lease
  const base = e.sync.client;
  const explode = (metodo) => async (caminho, ...resto) => {
    if (String(caminho).includes('dailyRounds')) throw new Error('defeito na reserva da rodada');
    return base[metodo](caminho, ...resto);
  };
  e.sync.client = { ...base, get: explode('get'), put: explode('put') };
  const r = await admit(e, ctxDe({ contaRodada: true }));
  assert.equal(r.admitted, false);
  assert.equal(r.reason, 'indisponivel');
  assert.match(r.detail.motivo, /falha interna da coordenação/);
  assert.equal(leaseNoBanco(), undefined, 'o lease adquirido não pode ficar para trás');
});

// M3: sem esta distinção o preflight nomeava o PRÓPRIO aparelho como "outro" e a tela
// mandava esperar por si mesmo. Quem evita a análise em dobro aqui é o enqueueHeadless.
test('preflightManual: lease vivo do PRÓPRIO aparelho não bloqueia o clique', async () => {
  semearLease({ ...leaseDoOutro(), leaseId: 'LEu', deviceId: 'dEu' });
  const r = await preflightManual(motor(), PR);
  assert.deepEqual(r, { ok: true });
  assert.ok(soLeituras());
});

test('preflightManual: livre é ok, sem reservar nem escrever nada', async () => {
  const r = await preflightManual(motor(), PR);
  assert.deepEqual(r, { ok: true });
  assert.ok(soLeituras());
  assert.equal(fake.tree(), null);
});

test('fachadas da Engine: syncAdmit e syncPreflightManual delegam ao coordenador', async () => {
  const { Engine } = await import('../server.js');
  const engine = new Engine();
  engine.log = () => {};
  const a = await engine.syncAdmit(ctxDe());
  assert.equal(a.admitted, true, 'recurso desligado por padrão: admite');
  assert.equal(a.handle.noop, true);
  assert.deepEqual(await engine.syncPreflightManual(PR), { ok: true });
});
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('test/sync-coordinator.test.js')).digest('hex').slice(0,16))"
```

Esperado: `04a34ab5cb6d5d73`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

Crie `test/sync-engine.test.js` com EXATAMENTE este conteúdo:

```js
// Composição da sincronização entre dispositivos (lib/engine/sync.js) vista pela Engine
// REAL: boot, login, presença, tick, logout, apagar remoto, desligar e o gate que segura
// a automação. Os dublês do Firebase (test/helpers/) ouvem em 127.0.0.1; a rede entra
// pelo fetchImpl que o runtime guarda. O banco do dublê é http local, então o login vai
// para o endereço do emulador de Auth (o mesmo caminho da validação manual do
// firebase/README.md), e o teste só troca a porta fixa do emulador pela do dublê.
// Qualquer destino fora da máquina reprova o teste, inclusive o Auth de produção.
//
// FAROL_HOME é fixado antes do import do server.js (os caminhos são const de nível de
// módulo): por isso o await import.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-sync-engine-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';
import { startFakeIdentity } from './helpers/fake-identity.js';
import { SYNC } from '../lib/constants.js';

const { Engine } = await import('../server.js');

const CRED_FILE = path.join(FAROL_HOME, SYNC.CREDENTIALS_FILE);
const DEVICE_FILE = path.join(FAROL_HOME, 'workspace', 'state', SYNC.DEVICE_FILE);
const API_KEY = 'chave-web-de-teste';
const EMAIL = 'a@b.com';
const SENHA = 'senha-que-nunca-aparece';
const EMAIL2 = 'outra@b.com';
const RELOGIO_SERVIDOR = 1_800_000_000_000;

const identity = await startFakeIdentity({ apiKey: API_KEY, users: { [EMAIL]: { password: SENHA, uid: 'u1' }, [EMAIL2]: { password: SENHA, uid: 'u2' } } });
// o banco aceita qualquer ID token que o Auth de mentira emitiu, como o de verdade
const rtdb = await startFakeRtdb({ token: (t) => identity.tokens.idTokens.includes(t) });
rtdb.setNow(RELOGIO_SERVIDOR);

after(async () => {
  await rtdb.close();
  await identity.close();
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

// fetch dos dublês: troca a origem fixa do emulador de Auth pela do dublê e recusa
// qualquer destino fora de 127.0.0.1. `fora` simula a rede caída.
const ORIGEM_EMULADOR_AUTH = new URL(SYNC.AUTH_EMULATOR_IDENTITY_URL).origin;
function fetchDosDubles(controle) {
  return async (url, init) => {
    controle.chamadas++;
    if (controle.fora) throw new TypeError('fetch failed');
    const alvo = String(url).replace(ORIGEM_EMULADOR_AUTH, identity.url);
    if (!alvo.startsWith('http://127.0.0.1:')) throw new Error('o teste tentou sair da máquina');
    return fetch(alvo, init);
  };
}

function syncCfg(extra = {}) {
  return {
    enabled: true, coordination: { enabled: false }, consolidation: { enabled: false },
    deviceName: 'Mesa', apiKey: API_KEY, databaseUrl: rtdb.url, projectId: 'farol-local', ...extra,
  };
}

// Salva como a tela salva (updateSettings) e espera o efeito que ELE dispara. Chamar a
// fachada aplicarConfig à mão depois de salvar esconderia uma fiação apagada no
// updateSettings, e é justamente ela que liga, desliga e reconecta na vida real.
async function salvarSync(cfg) {
  engine.updateSettings({ sync: cfg });
  if (engine.sync.iniciando) await engine.sync.iniciando;
}

function patchesDePresenca() {
  return rtdb.requests.filter((r) => r.method === 'PATCH' && r.path.includes('/devices/')).length;
}

test('(a) boot com sync ausente: desligado, nenhuma rede e nenhum arquivo de sincronização', async () => {
  const engine = new Engine();
  const controle = { chamadas: 0, fora: false };
  const spy = fetchDosDubles(controle);
  engine.sync.fetchImpl = spy;
  assert.equal(engine.sync.status, 'desligado');
  assert.equal(engine.snapshot().sync.enabled, false);
  assert.equal(engine.snapshot().sync.status, 'desligado');
  await engine.syncTick();
  const login = await engine.syncLogin({ email: EMAIL, password: SENHA }, spy);
  assert.equal(login.ok, false);
  assert.equal(login.code, 'desligado');
  assert.equal((await engine.syncTest()).ok, false);
  assert.equal(engine.syncSeguraAutomacao('o/r#1'), false);
  assert.equal(engine.syncCoordenacaoAtiva(), false);
  assert.equal(controle.chamadas, 0, 'nenhuma chamada ao fetch injetado');
  assert.equal(fs.existsSync(CRED_FILE), false, 'sync-credentials.json não nasce');
  assert.equal(fs.existsSync(DEVICE_FILE), false, 'sync-device.json não nasce');
});

// Engine compartilhada pelos casos seguintes, na ordem em que o usuário vive o recurso.
const controle = { chamadas: 0, fora: false };
const engine = new Engine();
engine.sync.fetchImpl = fetchDosDubles(controle);
const toasts = [];
engine.on('toast', (t) => toasts.push(t));
// o log real continua sendo escrito; o espelho só conta as linhas de sincronização
const logs = [];
const logReal = engine.log.bind(engine);
engine.log = (nivel, msg) => { logs.push({ nivel, msg }); return logReal(nivel, msg); };
function warnsDeSync() {
  return logs.filter((l) => l.nivel === 'WARN' && /entre dispositivos/.test(l.msg)).length;
}

test('(b) habilitar + login: conectado, credencial sem senha, aparelho persistido e presença com hora do servidor', async () => {
  await salvarSync(syncCfg());
  assert.equal(engine.sync.status, 'sem-credencial');
  assert.equal(controle.chamadas, 0, 'habilitar sem login não toca a rede');

  const r = await engine.syncLogin({ email: EMAIL, password: SENHA });
  assert.deepEqual(r, { ok: true, uid: 'u1', email: EMAIL });
  assert.equal(engine.sync.status, 'conectado');

  const texto = fs.readFileSync(CRED_FILE, 'utf8');
  assert.equal(texto.includes(SENHA), false, 'a senha nunca é gravada');
  const cred = JSON.parse(texto);
  assert.equal(cred.uid, 'u1');
  assert.ok(identity.tokens.refreshTokens.includes(cred.refreshToken), 'guarda um refresh token emitido pelo Auth');

  const dev = JSON.parse(fs.readFileSync(DEVICE_FILE, 'utf8'));
  assert.equal(dev.deviceId, engine.sync.deviceId);
  const no = rtdb.tree().users.u1.devices[dev.deviceId];
  assert.equal(no.lastSeenAt, RELOGIO_SERVIDOR, 'lastSeenAt é carimbo do servidor, não do relógio local');
  assert.equal(no.createdAt, RELOGIO_SERVIDOR);
  assert.equal(no.name, 'Mesa');
  assert.equal(no.platform, process.platform);
  assert.ok(Math.abs(engine.sync.skewMs - (RELOGIO_SERVIDOR - Date.now())) < 60000, 'skew medido na presença');
});

test('(c) syncTick respeita PRESENCE_TICK_MS', async () => {
  const antes = patchesDePresenca();
  await engine.syncTick();
  assert.equal(patchesDePresenca(), antes, 'dentro da janela não carimba de novo');
  engine.sync.lastPresenceAt -= SYNC.PRESENCE_TICK_MS;
  await engine.syncTick();
  assert.equal(patchesDePresenca(), antes + 1, 'vencida a janela, carimba uma vez');
  assert.equal(engine.sync.status, 'conectado');
  assert.ok(engine.snapshot().sync.devices.some((d) => d.euMesmo && d.name === 'Mesa'), 'aparelhos lidos no tick');
});

// O e-mail é a EXCEÇÃO declarada à regra de nunca expor e-mail em snapshot: a tela
// mostra "Conectado como <e-mail>" (desenho da seção sys-sync), e o snapshot é o único
// canal dela. A exceção é estreita: um campo só, no bloco sync. Log, toast e resposta
// de rota continuam proibidos, e o caso (j) confere os dois primeiros.
test('(h) snapshot nunca carrega senha, refresh token, ID token nem auth=; e-mail só em sync.email', () => {
  const texto = JSON.stringify(engine.snapshot());
  assert.equal(texto.includes(SENHA), false);
  assert.equal(texto.includes('auth='), false);
  for (const t of identity.tokens.refreshTokens) assert.equal(texto.includes(t), false, 'refresh token no snapshot');
  for (const t of identity.tokens.idTokens) assert.equal(texto.includes(t), false, 'ID token no snapshot');
  const s = engine.snapshot().sync;
  assert.equal(s.status, 'conectado');
  assert.equal(s.uid.startsWith('u1'), true);
  assert.equal(s.outbox, null);
  assert.equal(s.email, EMAIL, 'a tela precisa do e-mail para dizer com quem está conectada');
  assert.equal(texto.split(EMAIL).length - 1, 1, 'o e-mail aparece uma vez só, no campo sync.email');
});

test('(g) seguraAutomacao: desligada não segura; ligada segura sem conexão e com espera vigente', async () => {
  assert.equal(engine.syncSeguraAutomacao('o/r#1'), false, 'coordenação desligada nunca segura');
  await salvarSync(syncCfg({ coordination: { enabled: true } }));
  assert.equal(engine.syncCoordenacaoAtiva(), true);
  assert.equal(engine.sync.status, 'conectado', 'ligar a coordenação não derruba a conexão');
  assert.equal(engine.syncSeguraAutomacao('o/r#1'), false, 'conectado e sem espera: não segura');

  engine.syncRegistrarEspera('o/r#1', { admitted: false, reason: 'alheio', detail: { deviceName: 'Notebook' } });
  assert.equal(engine.syncSeguraAutomacao('o/r#1'), true, 'espera vigente segura');
  assert.equal(engine.syncSeguraAutomacao('o/r#2'), false, 'a espera é por PR');
  assert.equal(engine.snapshot().sync.espera['o/r#1'].deviceName, 'Notebook');
  engine.syncRegistrarEspera('o/r#3', { admitted: false, reason: 'recibo', detail: {} });
  assert.equal(engine.sync.espera['o/r#3'], undefined, 'recibo não vira espera');
  engine.sync.espera['o/r#1'].until = Date.now() - 1;
  assert.equal(engine.syncSeguraAutomacao('o/r#1'), false, 'espera vencida solta');

  controle.fora = true;
  engine.sync.lastPresenceAt -= SYNC.PRESENCE_TICK_MS;
  const warnsAntes = warnsDeSync();
  await engine.syncTick();
  assert.equal(engine.sync.status, 'erro');
  assert.equal(engine.sync.lastError.code, 'indisponivel');
  assert.equal(engine.syncSeguraAutomacao('o/r#9'), true, 'fora de conectado segura qualquer PR');
  assert.equal(engine.syncSeguraAutomacao('o/r#8'), true);
  assert.equal(toasts.filter((t) => /aparelhos/.test(t.text)).length, 1, 'avisa uma vez por janela');
  // o segundo tick sem rede tenta reconectar e ouve a MESMA recusa: o farol.log é de
  // falha, não de estado, então a queda sai uma vez só
  await engine.syncTick();
  assert.equal(engine.sync.status, 'erro');
  assert.equal(warnsDeSync() - warnsAntes, 1, 'dois ticks sem rede, um WARN só');

  controle.fora = false;
  await engine.syncTick();
  assert.equal(engine.sync.status, 'conectado', 'o tick seguinte reconecta sozinho');
  assert.equal(engine.syncSeguraAutomacao('o/r#9'), false);
  await salvarSync(syncCfg());
});

test('(e) erase-remote apaga /users/{uid} inteiro, só do próprio uid, e nada local', async () => {
  // a árvore real tem mais que presença; e o dublê poda pai vazio, então sem estes nós
  // apagar só /devices produziria a mesma árvore vazia e o teste não distinguiria
  const arvore = rtdb.tree();
  Object.assign(arvore.users.u1, {
    leases: { a1: { p1: { leaseId: 'l1', deviceId: 'd1', operationKind: 'review', expiresAt: 1 } } },
    receipts: { a1: { p1: { review_x: { operationKind: 'review', completedAt: 1 } } } },
    usageEvents: { d1: { e1: { at: 1, kind: 'review', costUsd: 0 } } },
  });
  arvore.users.u2 = { devices: { outro: { name: 'Aparelho de outra pessoa' } } };
  rtdb.setTree(arvore);

  const r = await engine.syncEraseRemote();
  assert.deepEqual(r, { ok: true });
  const depois = rtdb.tree();
  assert.equal(depois.users.u1, undefined, 'a árvore do usuário foi apagada inteira');
  assert.deepEqual(depois.users.u2, { devices: { outro: { name: 'Aparelho de outra pessoa' } } }, 'o apagão respeita o uid');
  assert.equal(engine.sync.status, 'conectado');
  assert.ok(fs.existsSync(CRED_FILE), 'a credencial local fica');
  assert.ok(fs.existsSync(DEVICE_FILE), 'a identidade local do aparelho fica');
  const t = await engine.syncTest();
  assert.deepEqual(t, { ok: true, uid: 'u1', devices: 0 });
});

test('(f) desligar para tudo e volta a desligado sem apagar nada', async () => {
  engine.sync.lastPresenceAt -= SYNC.PRESENCE_TICK_MS;
  await engine.syncTick();
  const arvore = rtdb.tree();
  assert.ok(arvore.users.u1.devices[engine.sync.deviceId], 'presença recriada depois do apagão');
  const deletes = rtdb.requests.filter((r) => r.method === 'DELETE').length;
  const chamadas = controle.chamadas;

  await salvarSync(syncCfg({ enabled: false }));
  assert.equal(engine.sync.status, 'desligado');
  assert.equal(engine.snapshot().sync.enabled, false);
  await engine.syncTick();
  assert.equal(controle.chamadas, chamadas, 'desligado não fala com o Firebase');
  assert.equal(rtdb.requests.filter((r) => r.method === 'DELETE').length, deletes, 'desligar não apaga nada remoto');
  assert.deepEqual(rtdb.tree(), arvore);
  assert.ok(fs.existsSync(CRED_FILE), 'desligar não apaga a credencial');
  assert.ok(fs.existsSync(DEVICE_FILE), 'desligar não apaga a identidade do aparelho');
});

test('(d) logout apaga a credencial e volta a sem-credencial', async () => {
  await salvarSync(syncCfg());
  assert.equal(engine.sync.status, 'conectado', 'religar com credencial reconecta');
  assert.deepEqual(await engine.syncLogout(), { ok: true });
  assert.equal(fs.existsSync(CRED_FILE), false);
  assert.equal(engine.sync.status, 'sem-credencial');
  assert.equal(engine.snapshot().sync.email, '');
  const t = await engine.syncTest();
  assert.equal(t.ok, false);

  // sem login e com a coordenação ligada o gate fica FECHADO: sem banco não há como
  // saber se outro aparelho já pegou o PR (o caso 'conectando' está no teste de boot)
  const avisosAntes = toasts.length;
  await salvarSync(syncCfg({ coordination: { enabled: true } }));
  assert.equal(engine.sync.status, 'sem-credencial');
  assert.equal(engine.syncSeguraAutomacao('o/r#1'), true, 'sem credencial segura a automação');
  const avisos = toasts.slice(avisosAntes);
  assert.equal(avisos.length, 1);
  assert.match(avisos[0].text, /nenhum login/, 'o aviso diz o que falta de verdade');
  await salvarSync(syncCfg());
});

// Só a RESPOSTA das rotas: o e-mail chega à tela pelo snapshot (exceção do caso (h)).
test('(i) rotas /api/sync/*: a resposta é allowlist e nunca ecoa senha, e-mail ou uid', async () => {
  const { startServer } = await import('../lib/http-server.js');
  // porta 0: o sistema escolhe uma livre, sem disputar a do Farol que estiver aberto
  engine.config.port = 0;
  const server = startServer(engine);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (rota, corpo) => {
    const res = await fetch(base + rota, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-farol': '1' }, body: JSON.stringify(corpo || {}) });
    return res.text();
  };
  try {
    const recusa = await post('/api/sync/login', { email: EMAIL, password: 'senha-errada-que-tambem-nao-volta' });
    assert.equal(recusa.includes('senha-errada'), false);
    assert.equal(JSON.parse(recusa).code, 'credencial_invalida');

    const aceita = await post('/api/sync/login', { email: EMAIL, password: SENHA });
    assert.deepEqual(JSON.parse(aceita), { ok: true }, 'sem e-mail nem uid na resposta');
    assert.equal(aceita.includes(SENHA), false);
    assert.equal(engine.sync.status, 'conectado');

    assert.deepEqual(JSON.parse(await post('/api/sync/test')), { ok: true, devices: 1 });
    assert.deepEqual(JSON.parse(await post('/api/sync/erase-remote')), { ok: true });
    assert.deepEqual(JSON.parse(await post('/api/sync/logout')), { ok: true });
    assert.equal(engine.sync.status, 'sem-credencial');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('(j) nenhum toast nem linha de log da bateria carregou o e-mail ou a senha', () => {
  assert.ok(toasts.length > 0 && logs.length > 0, 'a bateria produziu toasts e logs para conferir');
  for (const t of toasts) {
    assert.equal(String(t.text).includes(EMAIL), false, 'e-mail em toast');
    assert.equal(String(t.text).includes(SENHA), false, 'senha em toast');
  }
  for (const l of logs) {
    assert.equal(String(l.msg).includes(EMAIL), false, 'e-mail no log');
    assert.equal(String(l.msg).includes(SENHA), false, 'senha no log');
  }
});

// M6: o helper de "não dá pra falar com o banco agora" estava duplicado em
// lib/engine/sync.js e lib/engine/sync-usage.js, e os dois respondiam sem_credencial no
// estado 'conectando': a quem ACABOU de entrar, a tela dizia "nenhum login do Firebase
// foi feito neste aparelho" e mandava entrar de novo numa conta em que ele já estava.
test('(k) conexão em andamento responde indisponibilidade, nunca "nenhum login foi feito"', async () => {
  const e = new Engine();
  e.log = () => {};
  e.config.sync = { ...syncCfg({ consolidation: { enabled: true } }) };
  e.sync.status = 'conectando';
  const r = await e.syncTest();
  assert.equal(r.ok, false);
  assert.equal(r.code, 'indisponivel');
  assert.match(r.motivo, /conexão com o Firebase ainda está sendo estabelecida/);
  const c = await e.syncConsolidated(30);
  assert.equal(c.code, 'indisponivel', 'um helper só: os dois módulos respondem igual');
  e.sync.status = 'sem-credencial';
  assert.equal((await e.syncTest()).code, 'sem_credencial', 'sem login continua sendo sem login');
});

// M7: a falha transitória é a mesma; o NOME dela depende do que a pessoa ligou. Com a
// coordenação desligada, o Diagnóstico mostrava "Coordenação indisponível" para quem
// nem ligou a coordenação.
test('(l) com só a consolidação ligada, a falha transitória não se chama coordenação', async () => {
  const ctrl = { chamadas: 0, fora: false };
  const e = new Engine();
  const linhas = [];
  e.log = (nivel, msg) => linhas.push(`${nivel} ${msg}`);
  e.sync.fetchImpl = fetchDosDubles(ctrl);
  e.updateSettings({ sync: syncCfg({ consolidation: { enabled: true } }) });
  if (e.sync.iniciando) await e.sync.iniciando;
  assert.equal((await e.syncLogin({ email: EMAIL, password: SENHA })).ok, true);

  ctrl.fora = true;
  // o tick só toca a rede dentro da janela de presença; sem isto ele não tentaria nada
  e.sync.lastPresenceAt = 0;
  await e.syncTick();
  assert.equal(e.sync.status, 'erro');
  const warn = linhas.filter((l) => /indispon/.test(l)).at(-1);
  assert.ok(warn, 'a queda produziu uma linha de indisponibilidade');
  assert.match(warn, /sincronização entre dispositivos indisponível/);
  assert.doesNotMatch(warn, /coordenação entre dispositivos/);
});

// M12: o startSync reaproveita o start EM VOO, e aquele leu a credencial antiga. Sem a
// espera, o login voltava ok e a tela dizia "conectado" com a conta de antes.
test('(m) login com um start em voo conecta com a credencial NOVA', async () => {
  const ctrl = { chamadas: 0, fora: false };
  const e = new Engine();
  e.log = () => {};
  e.sync.fetchImpl = fetchDosDubles(ctrl);
  e.updateSettings({ sync: syncCfg() });
  if (e.sync.iniciando) await e.sync.iniciando;
  assert.equal((await e.syncLogin({ email: EMAIL, password: SENHA })).ok, true);
  assert.equal(e.sync.uid, 'u1');

  // reconexão disparada e NÃO aguardada: ela leu a credencial de u1
  e.updateSettings({ sync: syncCfg({ projectId: 'outro-projeto' }) });
  assert.ok(e.sync.iniciando, 'o caso precisa de um start realmente em voo');
  const r = await e.syncLogin({ email: EMAIL2, password: SENHA });
  assert.deepEqual(r, { ok: true, uid: 'u2', email: EMAIL2 });
  assert.equal(e.sync.status, 'conectado');
  assert.equal(e.sync.uid, 'u2', 'a conexão é da conta nova, não da que o start em voo leu');
  assert.equal(e.sync.email, EMAIL2);
});
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('test/sync-engine.test.js')).digest('hex').slice(0,16))"
```

Esperado: `41dc52aac76df461`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

Crie `test/sync-outbox.test.js` com EXATAMENTE este conteúdo:

```js
// Outbox de consumo da sincronização entre dispositivos (lib/sync/outbox.js) e a
// fiação dela no engine (lib/engine/sync-usage.js, ganchos de lib/engine/usage.js,
// flush no syncTick). O que está em jogo é a contagem de dinheiro: evento duplicado
// infla o consumo consolidado, evento perdido some dele. Por isso cada caso trava uma
// das duas direções.
//
// FAROL_HOME é fixado antes de qualquer import do repo que alcance lib/paths.js
// (os caminhos são const de nível de módulo): por isso o await import.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-sync-outbox-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';
import { startFakeIdentity } from './helpers/fake-identity.js';
import { SYNC } from '../lib/constants.js';

const outbox = await import('../lib/sync/outbox.js');
const { createRtdbClient } = await import('../lib/sync/rtdb.js');
const syncUsage = await import('../lib/engine/sync-usage.js');
const { eventIdFor, accountHash, prHash } = await import('../lib/sync/keys.js');
const { Engine } = await import('../server.js');

const OUTBOX_FILE = path.join(FAROL_HOME, 'workspace', 'state', SYNC.OUTBOX_FILE);
const API_KEY = 'chave-web-de-teste';
const EMAIL = 'a@b.com';
const SENHA = 'senha-de-teste';
const EMAIL2 = 'outra@b.com';
const DEV = 'aparelho-de-teste-1';
const VERSAO = '9.9.9';

// duas contas do Firebase: a troca de destino é o que o caso do cursor amarrado prova
const identity = await startFakeIdentity({ apiKey: API_KEY, users: { [EMAIL]: { password: SENHA, uid: 'u1' }, [EMAIL2]: { password: SENHA, uid: 'u2' } } });
const rtdb = await startFakeRtdb({ token: (t) => t === 'tok-ok' || identity.tokens.idTokens.includes(t) });

after(async () => {
  await rtdb.close();
  await identity.close();
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

function cliente() {
  return createRtdbClient({ databaseUrl: rtdb.url, projectId: 'farol-local', getIdToken: async () => ({ ok: true, idToken: 'tok-ok' }) });
}

function sessao(extra = {}) {
  return {
    id: 'a1', at: 1_800_000_000_000, day: '2027-01-15', kind: 'review', ref: 'Org/Repo#7', account: 'fulano',
    model: 'Opus 5', profileId: 'perfil-1', inputTokens: 10, outputTokens: 20, cacheReadTokens: 30,
    cacheCreationTokens: 40, costUsd: 1.25, farol: '2.58.0', costSource: 'medido', status: 'ok', ...extra,
  };
}

function eventosRemotos(uid = 'u1', device = DEV) {
  const t = rtdb.tree() || {};
  return (((t.users || {})[uid] || {}).usageEvents || {})[device] || {};
}

// cliente de mentira pro caminho de falha: devolve sempre o mesmo resultado e conta
function clienteQueResponde(resultado) {
  const chamadas = [];
  return { chamadas, patch: async (p, corpo) => { chamadas.push({ p, corpo }); return resultado; } };
}

test('payloadFor: hash no lugar do texto legível, e profileId/costSource sobrevivem', () => {
  const p = outbox.payloadFor(sessao({ costSource: 'estimado' }), DEV, VERSAO);
  assert.equal(p.accountHash, accountHash('fulano'));
  assert.equal(p.refHash, prHash('Org/Repo#7'));
  assert.equal(p.profileId, 'perfil-1');
  assert.equal(p.costSource, 'estimado');
  assert.equal(p.localId, 'a1');
  assert.equal(p.status, 'ok');
  assert.equal(p.farolVersion, '2.58.0', 'a versão que gravou a sessão, não a que migrou');
  const texto = JSON.stringify(p);
  assert.equal(texto.includes('Org/Repo'), false, 'nome de PR nunca sobe');
  assert.equal(texto.includes('fulano'), false, 'login nunca sobe');
  const antiga = outbox.payloadFor(sessao({ costSource: undefined, farol: undefined, ref: 'Kudos (fulano)' }), DEV, VERSAO);
  assert.equal(antiga.costSource, 'medido', 'registro antigo sem origem conta como medido, como na aba Consumo');
  assert.equal(antiga.farolVersion, VERSAO);
  assert.equal(antiga.refHash, '', 'rótulo de ferramenta não é PR e não vira hash');
});

test('sessões com o mesmo id local em boots diferentes não colidem', () => {
  const ob = outbox.defaultOutbox();
  assert.equal(outbox.enqueueSession(ob, sessao({ id: 'a1', at: 1000 }), DEV, VERSAO), true);
  assert.equal(outbox.enqueueSession(ob, sessao({ id: 'a1', at: 2000 }), DEV, VERSAO), true);
  assert.equal(ob.pending.length, 2);
  assert.notEqual(ob.pending[0].eventId, ob.pending[1].eventId);
  assert.equal(ob.cursorAt, 2000);
});

test('migração repetida não duplica: o mesmo eventId cai no mesmo nó remoto', async () => {
  const sessions = [sessao({ id: 'a1', at: 1000 }), sessao({ id: 'a2', at: 2000 }), sessao({ id: 'a3', at: 3000 })];
  const ob = outbox.defaultOutbox();
  assert.equal(outbox.reconcileFromSessions(ob, sessions, DEV, VERSAO), 3);
  assert.equal(outbox.reconcileFromSessions(ob, sessions, DEV, VERSAO), 0, 'cursor avançado não reenfileira');
  const r1 = await outbox.flushOutbox(cliente(), 'u1', DEV, ob);
  assert.equal(r1.ok, true);
  assert.equal(r1.enviados, 3);
  assert.equal(ob.pending.length, 0);

  outbox.resetForFullSync(ob);
  assert.equal(ob.cursorAt, 0);
  assert.equal(outbox.reconcileFromSessions(ob, sessions, DEV, VERSAO), 3, 'migração reenfileira o histórico inteiro');
  const r2 = await outbox.flushOutbox(cliente(), 'u1', DEV, ob);
  assert.equal(r2.ok, true);
  const remotos = eventosRemotos();
  assert.equal(Object.keys(remotos).length, 3, 'reenviar tudo não cria evento novo');
  assert.deepEqual(Object.keys(remotos).sort(), sessions.map((s) => eventIdFor(s, DEV)).sort());
  assert.equal(ob.enviados, 6);
  assert.ok(ob.lastSentAt > 0);
});

test('crash entre o save local e a outbox: a reconciliação recupera a sessão', () => {
  const s1 = sessao({ id: 'a1', at: 1000 });
  const s2 = sessao({ id: 'a2', at: 2000 });
  const ob = outbox.defaultOutbox();
  outbox.enqueueSession(ob, s1, DEV, VERSAO);
  assert.equal(outbox.saveOutbox(ob), true);
  // s2 foi gravada em usage-sessions.json e o processo morreu antes do gancho
  const relida = outbox.readOutbox();
  assert.equal(relida.cursorAt, 1000);
  assert.equal(outbox.reconcileFromSessions(relida, [s1, s2], DEV, VERSAO), 1);
  assert.deepEqual(relida.pending.map((e) => e.eventId), [eventIdFor(s1, DEV), eventIdFor(s2, DEV)]);
  fs.rmSync(OUTBOX_FILE, { force: true });
});

test('correção de status reenvia o MESMO eventId com o status novo', async () => {
  const s = sessao({ id: 'a9', at: 9000 });
  const ob = outbox.defaultOutbox();
  outbox.enqueueSession(ob, s, DEV, VERSAO);
  await outbox.flushOutbox(cliente(), 'u1', DEV, ob);
  const id = eventIdFor(s, DEV);
  assert.equal(eventosRemotos()[id].status, 'ok');
  s.status = 'descartada';
  outbox.enqueueSession(ob, s, DEV, VERSAO);
  assert.equal(ob.pending.length, 1);
  assert.equal(ob.pending[0].eventId, id);
  await outbox.flushOutbox(cliente(), 'u1', DEV, ob);
  assert.equal(eventosRemotos()[id].status, 'descartada');
});

// A correção que chega ANTES do envio tem que substituir a entrada, não se somar a
// ela: duas entradas do mesmo eventId inflariam pendentes e enviados, e uma recusa de
// lote contaria o mesmo evento duas vezes.
test('correção antes do envio substitui a entrada: um eventId, um pendente, o payload novo', () => {
  const s = sessao({ id: 'a12', at: 12000 });
  const ob = outbox.defaultOutbox();
  outbox.enqueueSession(ob, s, DEV, VERSAO);
  outbox.enqueueSession(ob, { ...s, status: 'descartada' }, DEV, VERSAO);
  assert.equal(ob.pending.length, 1, 'a correção não vira uma segunda entrada');
  assert.equal(ob.pending[0].eventId, eventIdFor(s, DEV));
  assert.equal(ob.pending[0].payload.status, 'descartada');
});

test('correção que chega durante o envio não se perde', async () => {
  const s = sessao({ id: 'a10', at: 10000 });
  const ob = outbox.defaultOutbox();
  outbox.enqueueSession(ob, s, DEV, VERSAO);
  const lento = {
    patch: async () => {
      outbox.enqueueSession(ob, { ...s, status: 'erro' }, DEV, VERSAO);
      return { ok: true, status: 200, data: {} };
    },
  };
  const r = await outbox.flushOutbox(lento, 'u1', DEV, ob);
  assert.equal(r.ok, true);
  assert.equal(ob.pending.length, 1, 'o payload corrigido fica para o próximo envio');
  assert.equal(ob.pending[0].payload.status, 'erro');
});

test('rede caída, timeout e token recusado mantêm tudo pendente, sem contar rejeição', async () => {
  for (const code of ['indisponivel', 'timeout', 'nao_autorizado']) {
    const ob = outbox.defaultOutbox();
    outbox.enqueueSession(ob, sessao(), DEV, VERSAO);
    const c = clienteQueResponde({ ok: false, code, status: 0, motivo: 'x' });
    for (let i = 0; i < SYNC.OUTBOX_MAX_REJEICOES + 2; i++) {
      const r = await outbox.flushOutbox(c, 'u1', DEV, ob);
      assert.equal(r.ok, false);
      assert.equal(r.code, code);
    }
    assert.equal(ob.pending.length, 1, code);
    assert.equal(ob.pending[0].tentativas, 0, code);
    assert.equal(ob.rejeitados, 0, code);
    assert.equal(ob.paused, true, 'envio pausado enquanto o banco não responde');
  }
});

test('4xx repetido vai para rejeitados depois de OUTBOX_MAX_REJEICOES', async () => {
  const ob = outbox.defaultOutbox();
  outbox.enqueueSession(ob, sessao(), DEV, VERSAO);
  const c = clienteQueResponde({ ok: false, code: 'resposta_invalida', status: 400, motivo: 'x' });
  for (let i = 1; i < SYNC.OUTBOX_MAX_REJEICOES; i++) {
    await outbox.flushOutbox(c, 'u1', DEV, ob);
    assert.equal(ob.pending.length, 1, `tentativa ${i} ainda pendente`);
  }
  await outbox.flushOutbox(c, 'u1', DEV, ob);
  assert.equal(ob.pending.length, 0);
  assert.equal(ob.rejeitados, 1);
});

test('evento recusado não arrasta os vizinhos do lote para rejeitados', async () => {
  const ob = outbox.defaultOutbox();
  const ruim = sessao({ id: 'ruim', at: 1 });
  for (const s of [ruim, sessao({ id: 'b1', at: 2 }), sessao({ id: 'b2', at: 3 })]) outbox.enqueueSession(ob, s, DEV, VERSAO);
  const idRuim = eventIdFor(ruim, DEV);
  const seletivo = {
    patch: async (p, corpo) => (corpo[idRuim] ? { ok: false, code: 'resposta_invalida', status: 400 } : { ok: true, status: 200, data: {} }),
  };
  for (let i = 0; i < SYNC.OUTBOX_MAX_REJEICOES * 3 && ob.pending.length; i++) await outbox.flushOutbox(seletivo, 'u1', DEV, ob);
  assert.equal(ob.pending.length, 0);
  assert.equal(ob.rejeitados, 1, 'só o evento ruim foi rejeitado');
  assert.equal(ob.enviados, 2);
});

// cliente REAL do banco com a resposta HTTP fixa: o que decide rejeitar ou pausar é o
// status que chega do fio, e um cliente de mentira esconderia a tradução status -> código
function clienteHttp(status, corpo, tipo = 'application/json', observar = () => {}) {
  return createRtdbClient({
    databaseUrl: 'http://127.0.0.1:9', projectId: 'farol-local', getIdToken: async () => ({ ok: true, idToken: 'tok-ok' }),
    fetchImpl: async (url, init) => {
      observar(init);
      return new Response(corpo, { status, headers: { 'content-type': tipo } });
    },
  });
}

test('rate limit, proxy e portal cativo pausam: nenhum deles tira evento da fila', async () => {
  const casos = [
    ['429 Too Many Requests', 429, '{"error":"Too Many Requests"}'],
    ['408 Request Timeout', 408, '{"error":"Request Timeout"}'],
    ['407 proxy', 407, '<html>autentique no proxy</html>', 'text/html'],
    ['403 proxy corporativo', 403, '<html>bloqueado</html>', 'text/html'],
    ['200 HTML de portal cativo', 200, '<html>entre na rede</html>', 'text/html'],
  ];
  for (const [nome, status, corpo, tipo] of casos) {
    const ob = outbox.defaultOutbox();
    outbox.enqueueSession(ob, sessao(), DEV, VERSAO);
    const c = clienteHttp(status, corpo, tipo);
    for (let i = 0; i < SYNC.OUTBOX_MAX_REJEICOES; i++) assert.equal((await outbox.flushOutbox(c, 'u1', DEV, ob)).ok, false, nome);
    assert.equal(ob.pending.length, 1, `${nome}: o pendente fica intacto`);
    assert.equal(ob.pending[0].tentativas, 0, `${nome}: não conta tentativa`);
    assert.equal(ob.rejeitados, 0, nome);
    assert.equal(ob.paused, true, nome);
  }
});

test('400 e 413 do evento sozinho são recusa dele e levam a rejeitados', async () => {
  for (const status of [400, 413]) {
    const ob = outbox.defaultOutbox();
    outbox.enqueueSession(ob, sessao(), DEV, VERSAO);
    const c = clienteHttp(status, '{"error":"recusado"}');
    for (let i = 0; i < SYNC.OUTBOX_MAX_REJEICOES; i++) await outbox.flushOutbox(c, 'u1', DEV, ob);
    assert.equal(ob.pending.length, 0, String(status));
    assert.equal(ob.rejeitados, 1, String(status));
  }
});

test('413 de lote não rejeita evento bom: o envio passa a ser de um em um', async () => {
  const ob = outbox.defaultOutbox();
  for (const s of [sessao({ id: 'g1', at: 1 }), sessao({ id: 'g2', at: 2 }), sessao({ id: 'g3', at: 3 })]) outbox.enqueueSession(ob, s, DEV, VERSAO);
  const c = createRtdbClient({
    databaseUrl: 'http://127.0.0.1:9', projectId: 'farol-local', getIdToken: async () => ({ ok: true, idToken: 'tok-ok' }),
    fetchImpl: async (url, init) => {
      const grande = Object.keys(JSON.parse(init.body)).length > 1;
      return new Response(grande ? '{"error":"Payload Too Large"}' : '{}', { status: grande ? 413 : 200, headers: { 'content-type': 'application/json' } });
    },
  });
  for (let i = 0; i < SYNC.OUTBOX_MAX_REJEICOES * 3 && ob.pending.length; i++) await outbox.flushOutbox(c, 'u1', DEV, ob);
  assert.equal(ob.pending.length, 0);
  assert.equal(ob.rejeitados, 0, 'nenhum evento bom foi descartado');
  assert.equal(ob.enviados, 3);
});

// ---------- fiação no engine ----------

const ORIGEM_EMULADOR_AUTH = new URL(SYNC.AUTH_EMULATOR_IDENTITY_URL).origin;
async function fetchDosDubles(url, init) {
  const alvo = String(url).replace(ORIGEM_EMULADOR_AUTH, identity.url);
  if (!alvo.startsWith('http://127.0.0.1:')) throw new Error('o teste tentou sair da máquina');
  return fetch(alvo, init);
}

function syncCfg(extra = {}) {
  return {
    enabled: true, coordination: { enabled: false }, consolidation: { enabled: false },
    deviceName: 'Mesa', apiKey: API_KEY, databaseUrl: rtdb.url, projectId: 'farol-local', ...extra,
  };
}

async function salvarSync(engine, cfg) {
  engine.updateSettings({ sync: cfg });
  if (engine.sync.iniciando) await engine.sync.iniciando;
}

const RESULTADO = { usage: { input_tokens: 5, output_tokens: 7 }, total_cost_usd: 0.5 };

test('consolidação desligada nunca grava sync-outbox.json', async () => {
  const semSync = new Engine();
  assert.equal(semSync.syncEnqueueUsage(sessao()), false);
  semSync.recordUsage('a1', 'fulano', RESULTADO, 'opus', 'perfil-1', 'o/r#1');
  await semSync.syncTick();
  assert.equal(fs.existsSync(OUTBOX_FILE), false);

  const engine = new Engine();
  engine.sync.fetchImpl = fetchDosDubles;
  await salvarSync(engine, syncCfg());
  assert.equal((await engine.syncLogin({ email: EMAIL, password: SENHA })).ok, true);
  const envios = () => rtdb.requests.filter((r) => r.path.includes('/usageEvents/')).length;
  const enviosAntes = envios();
  engine.recordUsage('a2', 'fulano', RESULTADO, 'opus', 'perfil-1', 'o/r#2');
  engine.marcarDesfecho('a2', 'descartada');
  await engine.syncTick();
  assert.equal(fs.existsSync(OUTBOX_FILE), false, 'sincronização ligada sem consolidação não escreve outbox');
  assert.equal(engine.snapshot().sync.outbox, null);
  assert.equal(envios(), enviosAntes, 'nenhum evento de consumo subiu');
});

test('flush no syncTick: sessão nova e correção de desfecho sobem com o mesmo eventId', async () => {
  const engine = new Engine();
  engine.sync.fetchImpl = fetchDosDubles;
  await salvarSync(engine, syncCfg({ consolidation: { enabled: true } }));
  if (engine.sync.status !== 'conectado') assert.equal((await engine.syncLogin({ email: EMAIL, password: SENHA })).ok, true);
  const deviceId = engine.sync.deviceId;
  const antes = engine.usageSessions.sessions.length;

  engine.recordUsage('a7', 'Fulano', RESULTADO, 'opus', 'perfil-7', 'Org/Repo#7');
  assert.ok(fs.existsSync(OUTBOX_FILE), 'o gancho gravou a outbox depois do save local');
  const registro = engine.usageSessions.sessions.at(-1);
  const id = eventIdFor(registro, deviceId);

  await engine.syncTick();
  const remoto = eventosRemotos('u1', deviceId);
  assert.equal(Object.keys(remoto).length, antes + 1, 'o histórico anterior sobe junto (migração inicial)');
  assert.equal(remoto[id].status, 'ok');
  assert.equal(remoto[id].profileId, 'perfil-7');
  assert.equal(remoto[id].costSource, 'medido');
  const ob = engine.snapshot().sync.outbox;
  assert.equal(ob.pendentes, 0);
  assert.ok(ob.enviados >= 1);

  engine.marcarDesfecho('a7', 'descartada');
  await engine.syncTick();
  assert.equal(eventosRemotos('u1', deviceId)[id].status, 'descartada');
  assert.equal(Object.keys(eventosRemotos('u1', deviceId)).length, antes + 1, 'correção não cria evento');
});

test('sessão perdida no caminho pra outbox volta quando o engine reabre', async () => {
  const deviceId = JSON.parse(fs.readFileSync(path.join(FAROL_HOME, 'workspace', 'state', SYNC.DEVICE_FILE), 'utf8')).deviceId;
  const anterior = new Engine();
  // simula o processo morto entre saveSessions e o gancho: a sessão entra no disco sem passar pela outbox
  anterior.syncEnqueueUsage = undefined;
  anterior.recordUsage('a8', 'fulano', RESULTADO, 'opus', 'perfil-1', 'o/r#8');
  const perdida = anterior.usageSessions.sessions.at(-1);

  const engine = new Engine();
  engine.sync.fetchImpl = fetchDosDubles;
  await salvarSync(engine, syncCfg({ consolidation: { enabled: true } }));
  await engine.syncTick();
  assert.ok(eventosRemotos('u1', deviceId)[eventIdFor(perdida, deviceId)], 'a reconciliação pegou a sessão pelo cursor');
});

// O 401 do banco também é a recusa de uma REGRA sobre o próprio evento. Com a
// coordenação ligada, tratar a recusa de usageEvents como queda do banco derrubava o
// status em tick sim, tick não, e cada tick 'erro' segurava a revisão automática.
test('recusa do consumo não derruba a coordenação: 401 só em usageEvents deixa a automação livre', async () => {
  const engine = new Engine();
  const logs = [];
  engine.log = (nivel, msg) => logs.push(`${nivel} ${msg}`);
  engine.sync.fetchImpl = async (url, init) => {
    if (init && init.method === 'PATCH' && String(url).includes('/usageEvents/')) {
      return new Response('{"error":"Permission denied"}', { status: 401, headers: { 'content-type': 'application/json' } });
    }
    return fetchDosDubles(url, init);
  };
  await salvarSync(engine, syncCfg({ coordination: { enabled: true }, consolidation: { enabled: true } }));
  if (engine.sync.status !== 'conectado') assert.equal((await engine.syncLogin({ email: EMAIL, password: SENHA })).ok, true);
  engine.recordUsage('a11', 'fulano', RESULTADO, 'opus', 'perfil-1', 'o/r#11');
  for (let i = 0; i < 4; i++) {
    await engine.syncTick();
    assert.equal(engine.sync.status, 'conectado', `tick ${i}: o consumo não decide o estado da conexão`);
    assert.equal(engine.syncSeguraAutomacao('o/r#11'), false, `tick ${i}: a automação segue livre`);
  }
  const ob = engine.snapshot().sync.outbox;
  assert.ok(ob.pendentes >= 1, 'o evento recusado fica na fila');
  assert.equal(ob.rejeitados, 0);
  assert.equal(ob.paused, true, 'o envio de consumo fica pausado');
  assert.equal(logs.some((l) => /coordena[cç][aã]o entre dispositivos indispon/i.test(l)), false, 'recusa de consumo não vira queda da coordenação no log');
  assert.equal(logs.filter((l) => l.includes('consumo entre dispositivos') && l.includes('nao_autorizado')).length, 1, 'a pausa do consumo loga uma vez só');
});

// M4: o destino era relido a cada lote. Logout ou reconexão no meio do laço deixava
// rt.client null e o lote seguinte lançava TypeError DENTRO do tick, contra a regra de
// que nada do consumo lança para o engine.
test('conexão trocada no meio do envio para o laço, em vez de lançar', async () => {
  const ob = outbox.defaultOutbox();
  for (let i = 0; i < 60; i++) outbox.enqueueSession(ob, sessao({ id: `m${i}`, at: 1_800_000_000_000 + i }), DEV, VERSAO);
  const rt = { status: 'conectado', uid: 'u1', deviceId: DEV, geracao: 1, outbox: ob, client: null, enviandoConsumo: null };
  // o primeiro lote sobe e, no meio dele, alguém desliga a conexão (logout, troca de conta)
  rt.client = { patch: async () => { rt.client = null; rt.geracao += 1; return { ok: true }; } };
  const engine = {
    config: { sync: { enabled: true, consolidation: { enabled: true }, databaseUrl: rtdb.url } },
    sync: rt, usageSessions: { sessions: [] },
  };
  const r = await syncUsage.flushUsage(engine);
  assert.equal(r.ok, true);
  assert.equal(r.enviados, SYNC.OUTBOX_BATCH, 'o lote que estava em voo foi contado');
  assert.equal(ob.pending.length, 60 - SYNC.OUTBOX_BATCH, 'o resto fica para o próximo tick, com o destino novo');
  // este caso escreve no sync-outbox.json compartilhado do FAROL_HOME do arquivo: sem
  // limpar, os pendentes de mentira entrariam no envio dos casos seguintes
  fs.rmSync(OUTBOX_FILE, { force: true });
});

// M5: o cursor quer dizer "tudo até aqui já subiu", e isso só vale PARA UM DESTINO.
test('retargetOutbox: destino novo zera o cursor; o mesmo destino e o destino vazio não mexem', () => {
  const ob = outbox.defaultOutbox();
  ob.cursorAt = 999;
  assert.equal(outbox.retargetOutbox(ob, ''), false, 'sem uid não há destino a marcar');
  assert.equal(ob.cursorAt, 999);
  const destino = outbox.outboxTarget('u1', `${rtdb.url}/`);
  assert.equal(destino, outbox.outboxTarget('u1', rtdb.url), 'barra no fim não é outro destino');
  assert.equal(outbox.retargetOutbox(ob, destino), true);
  assert.equal(ob.cursorAt, 0);
  ob.cursorAt = 42;
  assert.equal(outbox.retargetOutbox(ob, destino), false);
  assert.equal(ob.cursorAt, 42, 'o mesmo destino não refaz a migração a cada tick');
});

test('trocar a conta do Firebase manda o histórico inteiro para o destino novo', async () => {
  const engine = new Engine();
  engine.sync.fetchImpl = fetchDosDubles;
  await salvarSync(engine, syncCfg({ consolidation: { enabled: true } }));
  if (engine.sync.status !== 'conectado') assert.equal((await engine.syncLogin({ email: EMAIL, password: SENHA })).ok, true);
  const deviceId = engine.sync.deviceId;
  engine.recordUsage('a9', 'Fulano', RESULTADO, 'opus', 'perfil-9', 'Org/Repo#9');
  await engine.syncTick();
  const noPrimeiro = Object.keys(eventosRemotos('u1', deviceId)).length;
  assert.ok(noPrimeiro >= 1, 'o destino antigo recebeu o histórico');
  assert.equal(engine.sync.outbox.pending.length, 0, 'a fila esvaziou no destino antigo');

  engine.syncLogout();
  assert.equal((await engine.syncLogin({ email: EMAIL2, password: SENHA })).ok, true);
  assert.equal(engine.sync.uid, 'u2');
  await engine.syncTick();
  assert.equal(Object.keys(eventosRemotos('u2', deviceId)).length, noPrimeiro, 'o destino novo recebe tudo, não só o que vier depois');
});
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('test/sync-outbox.test.js')).digest('hex').slice(0,16))"
```

Esperado: `71b56dfa922fd59f`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

- [ ] **Passo 2: rodar e ver falhar**

```bash
node --test --test-force-exit test/sync-engine.test.js test/sync-coordinator.test.js test/sync-outbox.test.js test/sync-consolidated.test.js
```

Esperado: FALHA. engine.syncLogin não existe.

- [ ] **Passo 3: rodar e ver passar**

```bash
node --test --test-force-exit test/sync-engine.test.js test/sync-coordinator.test.js test/sync-outbox.test.js test/sync-consolidated.test.js
```

Esperado: PASSA, 0 falhas.

- [ ] **Passo 4: gate e commit**

```bash
npm run check && npm run lint && npm test
```

Esperado: `fail 0` e `gate de qualidade: sem regressão`. Se algo falhar, PARE e relate; não mexa em outro arquivo para fazer passar.

```bash
git add test/sync-consolidated.test.js test/sync-coordinator.test.js test/sync-engine.test.js test/sync-outbox.test.js
git commit -m "test(sync): runtime, coordenador e consumo provados contra os dublês"
```


### Tarefa T18: Provas do stream, da faxina e da saída limpa

As três provas que faltam, e as três nasceram de defeito medido: o tempo real do stream, a retenção que ninguém rodava, e a saída do processo, que abortava no Windows por causa da subida de tier do WebAssembly no parser HTTP.

**Arquivos:**
- Criar: `test/sync-faxina.test.js`
- Criar: `test/sync-saida-limpa.test.js`
- Criar: `test/sync-stream.test.js`

- [ ] **Passo 1: escrever o teste**

Crie `test/sync-faxina.test.js` com EXATAMENTE este conteúdo:

```js
// Retenção do banco da coordenação (lib/engine/sync-faxina.js, D17 do contrato): uma
// faxina por dia no syncTick, que poda dailyRounds de mais de ROUNDS_TTL_MS e apaga o
// recibo vencido com `if-match`. Contra o dublê do RTDB, com o relógio do runtime
// injetado (engine.sync.agora), então "amanhã" é uma soma, não uma espera.
//
// A parte do tick usa a Engine REAL com login no dublê do Auth, como em
// test/sync-engine.test.js. FAROL_HOME é fixado antes do import do server.js.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-sync-faxina-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';
import { startFakeIdentity } from './helpers/fake-identity.js';
import { SYNC, TEMPOS } from '../lib/constants.js';
import { accountHash, prHash, brasiliaDay, operationFingerprint } from '../lib/sync/keys.js';

const { Engine } = await import('../server.js');
const faxina = await import('../lib/engine/sync-faxina.js');
const { createRtdbClient } = await import('../lib/sync/rtdb.js');

const TOKEN = 'tok-faxina';
const API_KEY = 'chave-web-de-teste';
const EMAIL = 'a@b.com';
const SENHA = 'senha-do-teste';
const AGORA = 1_800_000_000_000;
const EU = accountHash('eu');
const OUTRA = accountHash('outra');
const PR1 = prHash('Org/Repo#1');
const PR2 = prHash('Org/Repo#2');
const FP_VELHO = operationFingerprint('review', 'a'.repeat(40));
const FP_NOVO = operationFingerprint('review', 'b'.repeat(40));
const FP_SEM_PRAZO = operationFingerprint('self', 'c'.repeat(40));

const identity = await startFakeIdentity({ apiKey: API_KEY, users: { [EMAIL]: { password: SENHA, uid: 'u1' } } });
const rtdb = await startFakeRtdb({ token: (t) => t === TOKEN || identity.tokens.idTokens.includes(t) });

after(async () => {
  await rtdb.close();
  await identity.close();
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});
beforeEach(() => { rtdb.setTree(null); rtdb.requests.length = 0; });

const cliente = createRtdbClient({ databaseUrl: rtdb.url, getIdToken: async () => ({ ok: true, idToken: TOKEN }) });

function dia(ms) { return brasiliaDay(ms); }

function rodada() { return { dayPolicy: SYNC.DAY_TZ, updatedAt: AGORA, reservations: { a1: { state: 'started' } } }; }

function recibo(expiresAt) {
  return { operationKind: 'review', materialVersion: 'x', deviceId: 'd', completedAt: AGORA - SYNC.RECEIPT_TTL_MS, outcome: 'completed', publicationState: 'published', expiresAt };
}

// o banco com um pouco de tudo: dia velho e dia recente, recibo vencido, vivo e sem
// prazo, nas duas contas
function bancoSujo() {
  const velho = dia(AGORA - SYNC.ROUNDS_TTL_MS - TEMPOS.DIA_MS);
  const recente = dia(AGORA - TEMPOS.DIA_MS);
  return {
    users: { u1: {
      dailyRounds: {
        [EU]: { [PR1]: { [velho]: rodada(), [recente]: rodada() }, [PR2]: { [velho]: rodada() } },
        [OUTRA]: { [PR1]: { [velho]: rodada() } },
      },
      receipts: {
        [EU]: { [PR1]: { [FP_VELHO]: recibo(AGORA - 1), [FP_NOVO]: recibo(AGORA + TEMPOS.DIA_MS), [FP_SEM_PRAZO]: { outcome: 'completed' } } },
        [OUTRA]: { [PR2]: { [FP_VELHO]: recibo(AGORA) } },
      },
    } },
  };
}

// motor mínimo: só o que a faxina lê do engine
function motor(extra = {}) {
  return {
    config: { sync: { enabled: true, coordination: { enabled: true } } },
    sync: { status: 'conectado', client: cliente, uid: 'u1', agora: () => AGORA, lastFaxinaAt: 0 },
    accountList: () => [{ user: 'eu' }, { user: 'Outra' }, { user: 'eu' }],
    ...extra,
  };
}

test('fatiaDoDia: lista pequena vai inteira; a grande gira com o dia e cobre tudo em poucos dias', () => {
  assert.deepEqual(faxina.fatiaDoDia([1, 2, 3], 7, 5), [1, 2, 3]);
  const lista = Array.from({ length: 5 }, (_, i) => i);
  assert.deepEqual(faxina.fatiaDoDia(lista, 0, 2), [0, 1]);
  assert.deepEqual(faxina.fatiaDoDia(lista, 1, 2), [2, 3]);
  assert.deepEqual(faxina.fatiaDoDia(lista, 2, 2), [4, 0], 'dá a volta no fim da lista');
  const vistos = new Set([0, 1, 2].flatMap((d) => faxina.fatiaDoDia(lista, d, 2)));
  assert.equal(vistos.size, lista.length, 'em três dias todos os cinco passaram');
});

test('faxina: poda dia velho de dailyRounds e apaga só recibo vencido, nas duas contas', async () => {
  rtdb.setTree(bancoSujo());
  const r = await faxina.faxinar(motor());
  assert.equal(r.ok, true);
  assert.equal(r.feita, true);
  const t = rtdb.tree().users.u1;
  assert.deepEqual(Object.keys(t.dailyRounds[EU][PR1]), [dia(AGORA - TEMPOS.DIA_MS)], 'o dia recente fica');
  assert.equal(t.dailyRounds[EU][PR2], undefined, 'PR só com dia velho some inteiro');
  assert.equal(t.dailyRounds[OUTRA], undefined, 'a outra conta também é faxinada');
  assert.deepEqual(Object.keys(t.receipts[EU][PR1]).sort(), [FP_NOVO, FP_SEM_PRAZO].sort(), 'vivo e sem prazo ficam; falta de dado nunca apaga');
  assert.equal(t.receipts[OUTRA], undefined, 'expiresAt igual a agora já venceu');
  assert.equal(r.rodadas, 3);
  assert.equal(r.recibos, 2);
});

test('faxina: todo DELETE de recibo vai condicionado ao etag lido', async () => {
  rtdb.setTree(bancoSujo());
  await faxina.faxinar(motor());
  const deletes = rtdb.requests.filter((q) => q.method === 'DELETE');
  assert.equal(deletes.length, 2);
  for (const d of deletes) assert.ok(d.headers['if-match'], `DELETE sem if-match em ${d.path}`);
});

test('faxina: uma por dia; no dia seguinte roda de novo', async () => {
  rtdb.setTree(bancoSujo());
  let agora = AGORA;
  const m = motor();
  m.sync.agora = () => agora;
  assert.equal((await faxina.faxinar(m)).feita, true);
  rtdb.setTree(bancoSujo());
  rtdb.requests.length = 0;
  agora += SYNC.FAXINA_MS - 1;
  assert.equal((await faxina.faxinar(m)).feita, false, 'dentro da janela não faxina');
  assert.equal(rtdb.requests.length, 0, 'nem toca o banco');
  agora += 1;
  assert.equal((await faxina.faxinar(m)).feita, true);
});

test('faxina: coordenação desligada, desconectado ou sem cliente não faz nada', async () => {
  rtdb.setTree(bancoSujo());
  const desligada = motor({ config: { sync: { enabled: true, coordination: { enabled: false } } } });
  assert.equal((await faxina.faxinar(desligada)).feita, false);
  const caida = motor();
  caida.sync.status = 'erro';
  assert.equal((await faxina.faxinar(caida)).feita, false);
  const semCliente = motor();
  semCliente.sync.client = null;
  assert.equal((await faxina.faxinar(semCliente)).feita, false);
  assert.equal(rtdb.requests.length, 0);
});

test('faxina: no máximo FAXINA_MAX_PRS nós de PR por faxina; o resto fica para o dia seguinte', async () => {
  const velho = dia(AGORA - SYNC.ROUNDS_TTL_MS - TEMPOS.DIA_MS);
  const muitos = {};
  for (let i = 0; i <= SYNC.FAXINA_MAX_PRS; i++) muitos[prHash(`Org/Repo#${i + 1}`)] = { [velho]: rodada() };
  rtdb.setTree({ users: { u1: { dailyRounds: { [EU]: muitos } } } });
  let agora = AGORA;
  const m = motor({ accountList: () => [{ user: 'eu' }] });
  m.sync.agora = () => agora;
  const r = await faxina.faxinar(m);
  assert.equal(r.prs, SYNC.FAXINA_MAX_PRS);
  assert.equal(Object.keys(rtdb.tree().users.u1.dailyRounds[EU]).length, 1, 'sobra um para amanhã');
  agora += SYNC.FAXINA_MS;
  await faxina.faxinar(m);
  assert.equal(rtdb.tree(), null, 'no dia seguinte a sobra sai');
});

test('faxina: falha na listagem não lança e espera o dia seguinte', async () => {
  const quebrado = createRtdbClient({ databaseUrl: rtdb.url, getIdToken: async () => ({ ok: true, idToken: 'tok-errado' }) });
  const m = motor();
  m.sync.client = quebrado;
  const r = await faxina.faxinar(m);
  assert.equal(r.ok, false);
  assert.equal(r.feita, true);
  assert.equal(r.code, 'nao_autorizado');
  assert.equal(m.sync.lastFaxinaAt, AGORA, 'a tentativa conta: tentar a cada tick só gastaria rede');
});

// --- fiação no syncTick com a Engine real -------------------------------------------

const ORIGEM_EMULADOR_AUTH = new URL(SYNC.AUTH_EMULATOR_IDENTITY_URL).origin;
async function fetchDosDubles(url, init) {
  const alvo = String(url).replace(ORIGEM_EMULADOR_AUTH, identity.url);
  if (!alvo.startsWith('http://127.0.0.1:')) throw new Error('o teste tentou sair da máquina');
  return fetch(alvo, init);
}

test('syncTick conectado com a coordenação ligada faz a faxina uma vez por dia', async () => {
  const engine = new Engine();
  engine.sync.fetchImpl = fetchDosDubles;
  engine.pushState = () => {};
  engine.config.accounts = [{ user: 'eu', owners: ['Org'] }];
  engine.updateSettings({ sync: {
    enabled: true, coordination: { enabled: true }, consolidation: { enabled: false },
    deviceName: 'Mesa', apiKey: API_KEY, databaseUrl: rtdb.url, projectId: 'farol-local',
  } });
  if (engine.sync.iniciando) await engine.sync.iniciando;
  assert.equal((await engine.syncLogin({ email: EMAIL, password: SENHA })).ok, true);
  const banco = rtdb.tree();
  rtdb.setTree({ users: { u1: { ...banco.users.u1, ...bancoSujo().users.u1 } } });
  engine.sync.agora = () => AGORA;
  engine.sync.lastFaxinaAt = 0;
  await engine.syncTick();
  const t = rtdb.tree().users.u1;
  assert.equal(t.dailyRounds[EU][PR2], undefined, 'o tick fez a faxina');
  assert.deepEqual(Object.keys(t.receipts[EU][PR1]).sort(), [FP_NOVO, FP_SEM_PRAZO].sort());
  assert.ok(t.dailyRounds[OUTRA], 'conta que não é da engine não é tocada');
  const antes = rtdb.requests.length;
  await engine.syncTick();
  assert.equal(rtdb.requests.slice(antes).filter((q) => q.query.shallow).length, 0, 'o segundo tick do dia não lista nada');
  engine.syncLogout();
});
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('test/sync-faxina.test.js')).digest('hex').slice(0,16))"
```

Esperado: `8a712a7942cbb801`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

Crie `test/sync-saida-limpa.test.js` com EXATAMENTE este conteúdo:

```js
// Saída forçada depois de fetch contra os dublês. O `npm test` roda com
// --test-force-exit, que termina cada arquivo com process.exit; no Windows isso
// abortava o node numa asserção da libuv (src/win/async.c) em parte das execuções,
// e a suíte ficava vermelha sem nenhum teste ter falhado. A causa está explicada em
// test/helpers/sem-tier-wasm.js; aqui o caso é reproduzido num processo filho, que
// é a única forma de observar como o processo SAI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const HELPERS = path.join(import.meta.dirname, 'helpers');
// cinco fetch seguidos bastam para o V8 subir de tier o parser HTTP do fetch; sair
// logo depois pega essa compilação em andamento (medido: 15 de 15 no Windows)
const REQUISICOES = 5;
const RODADAS = 3;

function script(dubleArquivo, fabrica) {
  const url = pathToFileURL(path.join(HELPERS, dubleArquivo)).href;
  return [
    `const m = await import(${JSON.stringify(url)});`,
    `const d = await m.${fabrica}();`,
    `for (let i = 0; i < ${REQUISICOES}; i++) { const r = await fetch(d.url + '/x.json?auth=tok-ok', { method: 'PUT', body: '1' }); await r.text(); }`,
    'process.exit(0);',
  ].join('\n');
}

function sairLimpo(dubleArquivo, fabrica) {
  for (let i = 0; i < RODADAS; i++) {
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', script(dubleArquivo, fabrica)], { encoding: 'utf8' });
    assert.doesNotMatch(r.stderr, /UV_HANDLE_CLOSING|Assertion failed/, `rodada ${i + 1}: o node abortou na saída`);
    assert.equal(r.status, 0, `rodada ${i + 1}: saída ${r.status}`);
  }
}

test('fetch repetido contra o dublê do banco e saída forçada: o processo sai com 0', () => {
  sairLimpo('fake-rtdb.js', 'startFakeRtdb');
});

test('fetch repetido contra o dublê do Auth e saída forçada: o processo sai com 0', () => {
  sairLimpo('fake-identity.js', 'startFakeIdentity');
});
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('test/sync-saida-limpa.test.js')).digest('hex').slice(0,16))"
```

Esperado: `ebcba63b430d473a`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

Crie `test/sync-stream.test.js` com EXATAMENTE este conteúdo:

```js
// Tempo real da coordenação (lib/engine/sync-stream.js): o stream SSE dos leases, a
// árvore remota em memória e a derivação de leasesVistos que a tela mostra.
//
// A derivação é PURA e testada à parte. O ciclo de vida roda contra os dublês do
// Firebase com a Engine REAL (login de verdade no dublê do Auth, como em
// test/sync-engine.test.js), e o tempo do stream (vigia de inatividade e espera de
// reconexão) entra por um agendador que o teste dispara à mão: nenhum caso dorme o
// tempo de verdade.
//
// FAROL_HOME é fixado antes do import do server.js (os caminhos são const de nível de
// módulo): por isso o await import.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-sync-stream-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';
import { startFakeIdentity } from './helpers/fake-identity.js';
import { SYNC } from '../lib/constants.js';
import { accountHash, prHash } from '../lib/sync/keys.js';

const { Engine } = await import('../server.js');
const stream = await import('../lib/engine/sync-stream.js');
const { createRtdbClient } = await import('../lib/sync/rtdb.js');
const { acquireLease, releaseLease } = await import('../lib/sync/lease.js');

const API_KEY = 'chave-web-de-teste';
const EMAIL = 'a@b.com';
const SENHA = 'senha-do-teste';
const TOKEN_OUTRO = 'tok-do-outro-aparelho';
const CONTA = 'eu';
const PR_CONHECIDO = 'Org/Repo#7';
const PR_MEU = 'Org/Repo#8';
const PR_VENCIDO = 'Org/Repo#9';
const PR_DESCONHECIDO = 'Org/Outro#1';

const identity = await startFakeIdentity({ apiKey: API_KEY, users: { [EMAIL]: { password: SENHA, uid: 'u1' } } });
// o banco aceita os ID tokens que o Auth de mentira emitiu, e o do "outro aparelho"
const rtdb = await startFakeRtdb({ token: (t) => t === TOKEN_OUTRO || identity.tokens.idTokens.includes(t) });

after(async () => {
  await rtdb.close();
  await identity.close();
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});

const ORIGEM_EMULADOR_AUTH = new URL(SYNC.AUTH_EMULATOR_IDENTITY_URL).origin;
const rede = { fora: false };
async function fetchDosDubles(url, init) {
  if (rede.fora) throw new TypeError('fetch failed');
  const alvo = String(url).replace(ORIGEM_EMULADOR_AUTH, identity.url);
  if (!alvo.startsWith('http://127.0.0.1:')) throw new Error('o teste tentou sair da máquina');
  return fetch(alvo, init);
}

// agendador de mentira: guarda cada timer e só dispara quando o teste manda
const timers = [];
const agendador = {
  setTimeout(fn, ms) { const t = { fn, ms, vivo: true }; timers.push(t); return t; },
  clearTimeout(t) { if (t) t.vivo = false; },
};
function vivos(ms) { return timers.filter((t) => t.vivo && t.ms === ms); }
function disparar(ms) {
  const t = vivos(ms).at(-1);
  assert.ok(t, `nenhum timer vivo de ${ms} ms para disparar`);
  t.vivo = false;
  t.fn();
}

// espera de I/O real (o dublê responde por socket); o tempo do stream NÃO passa por aqui
async function ate(cond, rotulo) {
  const limite = Date.now() + 3000;
  while (!cond()) {
    if (Date.now() > limite) throw new Error(`tempo esgotado esperando: ${rotulo}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

function pedidosDeStream() {
  return rtdb.requests.filter((r) => r.method === 'GET' && String(r.headers.accept || '').includes('text/event-stream')).length;
}

const outro = createRtdbClient({ databaseUrl: rtdb.url, getIdToken: async () => ({ ok: true, idToken: TOKEN_OUTRO }) });
function ids(prKey) { return { uid: 'u1', accountHash: accountHash(CONTA), prHash: prHash(prKey) }; }
function dadosDoLease(leaseId, deviceId, nowMs = Date.now()) {
  return { leaseId, deviceId, operationKind: 'review', headSha: 'abc123', nowMs, farolVersion: '9.9.9' };
}

function syncCfg(extra = {}) {
  return {
    enabled: true, coordination: { enabled: false }, consolidation: { enabled: false },
    deviceName: 'Mesa', apiKey: API_KEY, databaseUrl: rtdb.url, projectId: 'farol-local', ...extra,
  };
}

// --- derivação pura ---------------------------------------------------------------

test('aplicarEvento: put substitui o nó do caminho, data null apaga e o vazio some', () => {
  let arv = stream.aplicarEvento(null, { event: 'put', data: { path: '/', data: { a: { p1: { x: 1 } } } } });
  assert.deepEqual(arv, { a: { p1: { x: 1 } } });
  arv = stream.aplicarEvento(arv, { event: 'put', data: { path: '/a/p2', data: { y: 2 } } });
  assert.deepEqual(arv, { a: { p1: { x: 1 }, p2: { y: 2 } } });
  arv = stream.aplicarEvento(arv, { event: 'put', data: { path: '/a/p1', data: { z: 3 } } });
  assert.deepEqual(arv.a.p1, { z: 3 }, 'put troca o nó inteiro, não mescla');
  arv = stream.aplicarEvento(arv, { event: 'put', data: { path: '/a/p1', data: null } });
  arv = stream.aplicarEvento(arv, { event: 'put', data: { path: '/a/p2', data: null } });
  assert.equal(arv, null, 'apagar o último filho apaga os pais vazios, como o banco');
});

test('aplicarEvento: patch mescla chave a chave, aceita caminho na chave e null apaga só a chave', () => {
  const base = { a: { p1: { x: 1 }, p2: { y: 2 } } };
  const arv = stream.aplicarEvento(base, { event: 'patch', data: { path: '/a', data: { p1: null, p3: { w: 4 }, 'p2/y': 5 } } });
  assert.deepEqual(arv, { a: { p2: { y: 5 }, p3: { w: 4 } } });
  assert.deepEqual(base, { a: { p1: { x: 1 }, p2: { y: 2 } } }, 'a árvore anterior não é mutada');
});

test('aplicarEvento: evento sem forma, de outro tipo ou com chave vazia não mexe na árvore', () => {
  const base = { a: { p1: { x: 1 } } };
  assert.equal(stream.aplicarEvento(base, { event: 'put', data: null }), base);
  assert.equal(stream.aplicarEvento(base, { event: 'put', data: { data: 1 } }), base, 'sem path');
  assert.equal(stream.aplicarEvento(base, { event: 'keep-alive', data: null }), base);
  assert.equal(stream.aplicarEvento(base, { event: 'patch', data: { path: '/a', data: 7 } }), base);
  assert.deepEqual(stream.aplicarEvento(base, { event: 'patch', data: { path: '/a', data: { '': 1 } } }), base, 'chave vazia não troca o nó inteiro');
});

test('mapaDePrs: cada PR conhecido vira accountHash/prHash da conta dona; PR sem chave válida fica fora', () => {
  const contaDe = (p) => p.account;
  const mapa = stream.mapaDePrs([
    { key: PR_CONHECIDO, account: 'Eu' }, { key: 'lixo', account: 'eu' }, null, { account: 'eu' },
  ], contaDe);
  assert.equal(mapa.size, 1);
  assert.equal(mapa.get(`${accountHash('eu')}/${prHash('org/repo#7')}`), PR_CONHECIDO, 'login e dono/repo sem diferença de caixa');
});

test('leasesVistosDe: só lease vivo de OUTRO aparelho em PR conhecido; o resto conta em outros ou some', () => {
  const agora = 1_800_000_000_000;
  const ah = accountHash(CONTA);
  const lease = (deviceId, expiresAt) => ({ leaseId: 'L', deviceId, operationKind: 'self', acquiredAt: agora - 10, expiresAt });
  const arvore = { [ah]: {
    [prHash(PR_CONHECIDO)]: lease('dev-outro', agora + 1),
    [prHash(PR_MEU)]: lease('dev-eu', agora + 1),
    [prHash(PR_VENCIDO)]: lease('dev-outro', agora),
    [prHash(PR_DESCONHECIDO)]: lease('dev-outro', agora + 1),
    [prHash('Org/Repo#10')]: { leaseId: 'L', deviceId: 'dev-outro' },
  } };
  const conhecidos = stream.mapaDePrs([PR_CONHECIDO, PR_MEU, PR_VENCIDO, 'Org/Repo#10'].map((key) => ({ key })), () => CONTA);
  const r = stream.leasesVistosDe(arvore, { euDeviceId: 'dev-eu', nowMs: agora, conhecidos, devices: { 'dev-outro': { name: 'Notebook' } } });
  assert.deepEqual(r.vistos, { [PR_CONHECIDO]: { deviceId: 'dev-outro', deviceName: 'Notebook', since: agora - 10, operationKind: 'self' } });
  assert.equal(r.outros, 1, 'lease vivo em PR que este aparelho não acompanha só conta');
  assert.deepEqual(stream.leasesVistosDe(null, { euDeviceId: 'dev-eu', nowMs: agora, conhecidos, devices: {} }), { vistos: {}, outros: 0 });
});

// --- ciclo de vida contra os dublês --------------------------------------------------

const engine = new Engine();
engine.sync.fetchImpl = fetchDosDubles;
engine.sync.agendadorStream = agendador;
engine.panorama = [{ key: PR_CONHECIDO, url: 'https://github.com/Org/Repo/pull/7', repo: 'Org/Repo', number: 7, account: CONTA }];
engine.queue = [{ key: PR_VENCIDO, url: 'https://github.com/Org/Repo/pull/9', repo: 'Org/Repo', number: 9, account: CONTA }];
engine.myPRs = [{ key: PR_MEU, url: 'https://github.com/Org/Repo/pull/8', repo: 'Org/Repo', number: 8, account: CONTA }];
let pushes = 0;
engine.pushState = () => { pushes++; };
const logs = [];
engine.log = (nivel, msg) => { logs.push({ nivel, msg }); };

async function salvarSync(cfg) {
  engine.updateSettings({ sync: cfg });
  if (engine.sync.iniciando) await engine.sync.iniciando;
}

test('coordenação desligada: conectar nunca abre stream', async () => {
  // o outro aparelho existe no banco antes do login, com nome, para a tela poder nomeá-lo
  assert.equal((await outro.patch('/users/u1/devices/dev-outro', { name: 'Notebook', platform: 'linux' })).ok, true);
  await salvarSync(syncCfg());
  const r = await engine.syncLogin({ email: EMAIL, password: SENHA });
  assert.equal(r.ok, true);
  assert.equal(engine.sync.status, 'conectado');
  await engine.syncTick();
  assert.equal(engine.sync.stream, null);
  assert.equal(pedidosDeStream(), 0);
  assert.equal(rtdb.streams, 0);
});

test('ligar a coordenação com a conexão de pé abre o stream em /users/{uid}/leases', async () => {
  await salvarSync(syncCfg({ coordination: { enabled: true } }));
  await ate(() => rtdb.streams === 1, 'stream aberto');
  const req = rtdb.requests.filter((q) => String(q.headers.accept || '').includes('text/event-stream')).at(-1);
  assert.equal(req.path, '/users/u1/leases.json');
});

test('outro aparelho adquire lease de PR conhecido: leasesVistos ganha o PR com o nome dele', async () => {
  const antes = pushes;
  const a = await acquireLease(outro, ids(PR_CONHECIDO), dadosDoLease('L-outro', 'dev-outro'));
  assert.equal(a.ok, true);
  await ate(() => engine.sync.leasesVistos[PR_CONHECIDO], 'lease visto');
  const visto = engine.sync.leasesVistos[PR_CONHECIDO];
  assert.equal(visto.deviceId, 'dev-outro');
  assert.equal(visto.deviceName, 'Notebook');
  assert.equal(visto.operationKind, 'review');
  assert.equal(visto.since, a.lease.acquiredAt);
  assert.ok(pushes > antes, 'a tela é avisada quando a visão muda');
  const s = engine.snapshot().sync;
  assert.deepEqual(s.leasesVistos[PR_CONHECIDO], visto);
  assert.equal(s.leasesOutros, 0);
});

test('lease do próprio aparelho, lease vencido e PR desconhecido não entram na visão', async () => {
  assert.equal((await acquireLease(outro, ids(PR_MEU), dadosDoLease('L-meu', engine.sync.deviceId))).ok, true);
  assert.equal((await acquireLease(outro, ids(PR_VENCIDO), dadosDoLease('L-velho', 'dev-outro', Date.now() - 10 * SYNC.LEASE_TTL_MS))).ok, true);
  assert.equal((await acquireLease(outro, ids(PR_DESCONHECIDO), dadosDoLease('L-x', 'dev-outro'))).ok, true);
  await ate(() => engine.sync.leasesOutros === 1, 'lease de PR desconhecido contado');
  assert.deepEqual(Object.keys(engine.sync.leasesVistos), [PR_CONHECIDO]);
  assert.equal(engine.snapshot().sync.leasesOutros, 1);
  const texto = JSON.stringify(engine.snapshot().sync);
  assert.equal(texto.includes(PR_DESCONHECIDO), false, 'o nome do PR desconhecido nunca aparece');
  assert.equal(texto.includes('auth='), false);
});

test('o release some com o PR da visão', async () => {
  const r = await releaseLease(outro, ids(PR_CONHECIDO), { leaseId: 'L-outro' });
  assert.equal(r.released, true);
  await ate(() => !engine.sync.leasesVistos[PR_CONHECIDO], 'lease solto');
  assert.deepEqual(engine.sync.leasesVistos, {});
});

test('lease que vence sem evento nenhum sai da visão no tick seguinte', async () => {
  const nowMs = engine.sync.agora() - SYNC.LEASE_TTL_MS + 300;
  assert.equal((await acquireLease(outro, ids(PR_CONHECIDO), dadosDoLease('L-curto', 'dev-outro', nowMs))).ok, true);
  await ate(() => engine.sync.leasesVistos[PR_CONHECIDO], 'lease curto visto');
  await new Promise((r) => setTimeout(r, 350));
  await engine.syncTick();
  assert.equal(engine.sync.leasesVistos[PR_CONHECIDO], undefined);
  await releaseLease(outro, ids(PR_CONHECIDO), { leaseId: 'L-curto' });
});

test('auth_revoked invalida o token e reabre na hora', async () => {
  let invalidou = 0;
  const original = engine.sync.tokenSource.invalidate;
  engine.sync.tokenSource.invalidate = () => { invalidou++; original(); };
  const antes = pedidosDeStream();
  rtdb.emitirAuthRevoked();
  await ate(() => pedidosDeStream() === antes + 1 && rtdb.streams === 1, 'stream reaberto');
  assert.equal(invalidou, 1);
});

test('inatividade além de STREAM_IDLE_MS derruba a conexão e reconecta com espera', async () => {
  assert.equal(SYNC.STREAM_IDLE_MS, 90 * 1000);
  const antes = pedidosDeStream();
  disparar(SYNC.STREAM_IDLE_MS);
  await ate(() => rtdb.streams === 0, 'conexão derrubada');
  await ate(() => vivos(SYNC.STREAM_RECONNECT_MS).length === 1, 'reconexão agendada');
  assert.equal(pedidosDeStream(), antes, 'nada reabre antes da espera');
  disparar(SYNC.STREAM_RECONNECT_MS);
  await ate(() => pedidosDeStream() === antes + 1 && rtdb.streams === 1, 'stream reaberto');
});

test('cancel fecha, loga WARN uma vez e reabre com espera', async () => {
  const warns = () => logs.filter((l) => l.nivel === 'WARN' && /stream/.test(l.msg)).length;
  rtdb.emitirCancel();
  await ate(() => vivos(SYNC.STREAM_RECONNECT_MS).length === 1, 'reconexão agendada');
  assert.equal(warns(), 1);
  assert.doesNotMatch(logs.at(-1).msg, /auth=/);
  disparar(SYNC.STREAM_RECONNECT_MS);
  await ate(() => rtdb.streams === 1 && engine.sync.stream.esperaMs === SYNC.STREAM_RECONNECT_MS, 'stream reaberto e são');
  assert.equal(warns(), 1, 'reabrir não loga');
  // o put inicial da reconexão provou que o stream voltou são: um cancel novo é outro episódio
  rtdb.emitirCancel();
  await ate(() => warns() === 2, 'segundo episódio logado');
  await ate(() => vivos(SYNC.STREAM_RECONNECT_MS).length === 1, 'reconexão agendada');
  disparar(SYNC.STREAM_RECONNECT_MS);
  await ate(() => rtdb.streams === 1, 'stream reaberto');
});

test('sem rede, a espera dobra até STREAM_RECONNECT_MAX_MS e volta ao mínimo quando o stream responde', async () => {
  const esperaAgendada = () => timers.filter((t) => t.vivo && t.ms !== SYNC.STREAM_IDLE_MS).at(-1);
  rede.fora = true;
  rtdb.fecharStreams();
  const esperas = [];
  for (let i = 0; i < 6; i++) {
    await ate(() => esperaAgendada(), 'espera agendada');
    const t = esperaAgendada();
    esperas.push(t.ms);
    t.vivo = false;
    t.fn();
  }
  // a sexta tentativa também falha: a espera seguinte continua no teto
  await ate(() => esperaAgendada(), 'sétima espera');
  esperas.push(esperaAgendada().ms);
  const base = SYNC.STREAM_RECONNECT_MS;
  const teto = SYNC.STREAM_RECONNECT_MAX_MS;
  assert.deepEqual(esperas, [base, base * 2, base * 4, base * 8, teto, teto, teto]);
  rede.fora = false;
  const t = esperaAgendada();
  t.vivo = false;
  t.fn();
  await ate(() => rtdb.streams === 1 && engine.sync.stream.esperaMs === base, 'o put inicial zera o backoff');
});

test('desligar a coordenação fecha o stream e limpa a visão', async () => {
  assert.equal((await acquireLease(outro, ids(PR_CONHECIDO), dadosDoLease('L-2', 'dev-outro'))).ok, true);
  await ate(() => engine.sync.leasesVistos[PR_CONHECIDO], 'lease visto');
  await salvarSync(syncCfg());
  await ate(() => rtdb.streams === 0, 'stream fechado');
  assert.equal(engine.sync.stream, null);
  assert.deepEqual(engine.sync.leasesVistos, {});
  assert.equal(engine.sync.leasesOutros, 0);
});

test('startSync com a coordenação ligada abre o stream no fim; stopSync fecha', async () => {
  engine.syncLogout();
  await salvarSync(syncCfg({ coordination: { enabled: true } }));
  assert.equal(rtdb.streams, 0, 'sem login não há stream');
  const r = await engine.syncLogin({ email: EMAIL, password: SENHA });
  assert.equal(r.ok, true);
  await ate(() => rtdb.streams === 1, 'stream aberto no fim do startSync');
  await ate(() => engine.sync.leasesVistos[PR_CONHECIDO], 'lease visto pela conexão nova');
  engine.syncLogout();
  await ate(() => rtdb.streams === 0, 'stream fechado pelo stopSync');
  assert.equal(engine.sync.stream, null);
  assert.deepEqual(engine.sync.leasesVistos, {});
});

// A visão só é recalculada enquanto o stream corre. Soltar a conexão sem zerá-la deixava
// na tela, por tempo indefinido, "outro aparelho está analisando" apoiado num lease de
// dois minutos — e a reconexão que FALHA nunca mais passa por sincronizarStream.
test('reconexão que falha não deixa a visão de outro aparelho envelhecer na tela', async () => {
  await salvarSync(syncCfg({ coordination: { enabled: true } }));
  assert.equal((await engine.syncLogin({ email: EMAIL, password: SENHA })).ok, true);
  await ate(() => engine.sync.leasesVistos[PR_CONHECIDO], 'lease visto antes da queda');
  rede.fora = true;
  try {
    // projectId novo muda a assinatura da conexão: é reconexão, não ajuste de coordenação
    await salvarSync(syncCfg({ coordination: { enabled: true }, projectId: 'outro-projeto' }));
  } finally {
    rede.fora = false;
  }
  assert.equal(engine.sync.status, 'erro');
  assert.equal(engine.sync.stream, null);
  assert.deepEqual(engine.sync.leasesVistos, {}, 'sem stream ninguém recalcula: a visão não pode ficar');
  assert.equal(engine.sync.leasesOutros, 0);
});
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('test/sync-stream.test.js')).digest('hex').slice(0,16))"
```

Esperado: `32507982971e395d`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

- [ ] **Passo 2: rodar e ver falhar**

```bash
node --test --test-force-exit test/sync-stream.test.js test/sync-faxina.test.js test/sync-saida-limpa.test.js
```

Esperado: FALHA. engine.sync.stream é sempre null.

- [ ] **Passo 3: rodar e ver passar**

```bash
node --test --test-force-exit test/sync-stream.test.js test/sync-faxina.test.js test/sync-saida-limpa.test.js
```

Esperado: PASSA, 0 falhas.

- [ ] **Passo 4: gate e commit**

```bash
npm run check && npm run lint && npm test
```

Esperado: `fail 0` e `gate de qualidade: sem regressão`. Se algo falhar, PARE e relate; não mexa em outro arquivo para fazer passar.

```bash
git add test/sync-faxina.test.js test/sync-saida-limpa.test.js test/sync-stream.test.js
git commit -m "test(sync): stream dos leases, faxina de retenção e saída limpa do processo"
```


### Tarefa T19: Gate de admissão na boca das sessões

O gate é a boca ÚNICA por onde toda sessão de IA passa. Ele falha FECHADO: qualquer forma de resposta que não seja admissão explícita segura a sessão, porque admitir por engano é gastar sessão paga em cima de uma análise que outro aparelho já está fazendo.

**Arquivos:**
- Modificar: `lib/engine/session.js`
- Modificar: `lib/format.js`
- Criar: `test/sync-gate.test.js`

- [ ] **Passo 1: escrever o teste**

Crie `test/sync-gate.test.js` com EXATAMENTE este conteúdo:

```js
// O gate da coordenação entre dispositivos mora em runClaudeStream (lib/engine/session.js),
// o estrangulamento por onde passa TODO provedor de IA. Este arquivo trava as duas
// metades do contrato: com a coordenação DESLIGADA a função é a de sempre (spawn no
// mesmo tick, que é o que test/session-checkpoint-capture.test.js captura); LIGADA, a
// admissão roda antes de qualquer stub, spawn ou ramo Codex, e tipo de operação ausente
// ou desconhecido é recusado alto (fail-closed).
//
// FAROL_HOME antes do import: session.js alcança lib/paths.js, então entra por await import.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-sync-gate-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import childProcess from 'node:child_process';

const realSpawn = childProcess.spawn;
let spawnImpl = null;
let spawns = 0;
childProcess.spawn = function mockableSpawn(...args) {
  spawns++;
  if (spawnImpl) return spawnImpl(...args);
  return realSpawn(...args);
};

const session = await import('../lib/engine/session.js');
const { runClaudeStream, runProvedor, parseEnvelope, OPERACOES } = session;

const stubAnterior = process.env.FAROL_HEADLESS_CMD;
after(() => {
  childProcess.spawn = realSpawn;
  if (stubAnterior === undefined) delete process.env.FAROL_HEADLESS_CMD;
  else process.env.FAROL_HEADLESS_CMD = stubAnterior;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});

beforeEach(() => { spawns = 0; spawnImpl = null; });

function filho() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new EventEmitter();
  child.stdin = Object.assign(new EventEmitter(), { write() { }, end() { } });
  child.pid = 4343;
  return child;
}

// termina a sessão com um evento result (sucesso) ou com código != 0 (falha)
function encerrar(child, { ok = true } = {}) {
  if (ok) child.stdout.write(JSON.stringify({ type: 'result', result: 'feito', session_id: 's-gate' }) + '\n');
  child.stdout.once('end', () => child.emit('close', ok ? 0 : 1));
  child.stdout.end();
}

function motor({ ativa = false, admissao = null, auth = { kind: 'dir', id: '' } } = {}) {
  const e = {
    config: {},
    ghEnv: () => ({ PATH: process.env.PATH }),
    running: new Map(),
    activeReviews: new Map(),
    killTree() { },
    recordUsage() { },
    toolSummary: () => '',
    parseEnvelope(raw) { return parseEnvelope(this, raw); },
    authPedida: 0,
    admissoes: [],
  };
  e.resolveClaudeAuth = () => { e.authPedida++; return auth; };
  if (ativa !== null) e.syncCoordenacaoAtiva = () => ativa;
  e.syncAdmit = async (ctx) => { e.admissoes.push(ctx); return admissao; };
  return e;
}

function handleFalso() {
  const h = { noop: false, leaseId: 'L1', attemptId: '', lost: false, done: false, abortos: 0, completos: 0 };
  h.onLost = () => { };
  h.complete = async () => { h.completos++; h.done = true; return { ok: true }; };
  h.abort = async () => { h.abortos++; h.done = true; };
  return h;
}

const COORD = { prKey: 'o/r#1', account: 'eu', materialVersion: 'abc123', headSha: 'abc123', contaRodada: false, manual: false, semCoordenacao: false, ignorarRecibo: false, pr: { key: 'o/r#1' } };

test('OPERACOES é a allowlist fechada: três tipos coordenam, chat e ferramenta passam por bypass', () => {
  assert.deepEqual({ ...OPERACOES }, { review: 'coordena', self: 'coordena', pushback: 'coordena', chat: 'bypass', tool: 'bypass' });
  assert.equal(Object.isFrozen(OPERACOES), true);
  assert.equal(typeof runProvedor, 'function', 'o corpo antigo segue exportado como runProvedor');
});

test('(a) coordenação desligada: o spawn acontece no MESMO tick, sem admissão', async () => {
  delete process.env.FAROL_HEADLESS_CMD;
  const child = filho();
  spawnImpl = () => child;
  const e = motor({ ativa: false });
  const p = runClaudeStream(e, 'prompt', { id: 'a1' });
  assert.equal(spawns, 1, 'spawn síncrono, antes de qualquer await');
  encerrar(child);
  const res = await p;
  assert.equal(res.text, 'feito');
  assert.equal(e.admissoes.length, 0);
  assert.equal('coordination' in res, false, 'desligada, o resultado é byte a byte o de antes');
});

test('(a) engine sem a fachada syncCoordenacaoAtiva também segue o caminho de sempre', async () => {
  const child = filho();
  spawnImpl = () => child;
  const e = motor({ ativa: null });
  const p = runClaudeStream(e, 'prompt', {});
  assert.equal(spawns, 1);
  encerrar(child);
  await p;
});

test('(b) ligada e operationKind ausente: recusa antes do stub, do spawn e do ramo Codex', async () => {
  process.env.FAROL_HEADLESS_CMD = 'node -e "process.exit(0)"';
  spawnImpl = () => filho();
  const e = motor({ ativa: true, auth: { kind: 'codex', id: 'cx' } });
  await assert.rejects(runClaudeStream(e, 'prompt', { id: 'a2', coordination: COORD }), /operationKind ausente ou desconhecido \(vazio\)/);
  assert.equal(spawns, 0, 'spawn nunca chamado');
  assert.equal(e.authPedida, 0, 'nem chegou a resolver o provedor (ramo Codex)');
  assert.equal(e.admissoes.length, 0);
  delete process.env.FAROL_HEADLESS_CMD;
});

test('(b) ligada e operationKind desconhecido também recusa, nomeando o tipo', async () => {
  const e = motor({ ativa: true });
  await assert.rejects(runClaudeStream(e, 'prompt', { operationKind: 'rev' }), /\(rev\)/);
  assert.equal(spawns, 0);
});

for (const kind of ['chat', 'tool']) {
  test(`(c) ligada, '${kind}' passa sem chamar syncAdmit`, async () => {
    const child = filho();
    spawnImpl = () => child;
    const e = motor({ ativa: true });
    const p = runClaudeStream(e, 'prompt', { operationKind: kind });
    await new Promise((r) => setImmediate(r));
    assert.equal(spawns, 1);
    encerrar(child);
    const res = await p;
    assert.equal(res.text, 'feito');
    assert.equal(res.coordination, null, 'bypass não tem handle');
    assert.equal(e.admissoes.length, 0);
  });
}

test('(d) ligada, review sem coordination: recusa antes do spawn', async () => {
  const e = motor({ ativa: true });
  await assert.rejects(runClaudeStream(e, 'prompt', { operationKind: 'review' }), /coordination ausente para review/);
  assert.equal(spawns, 0);
  assert.equal(e.admissoes.length, 0);
});

test('(e) admissão recusada resolve bloqueado, sem texto fabricado e sem spawn', async () => {
  const admissao = { admitted: false, reason: 'alheio', detail: { deviceName: 'notebook' } };
  const e = motor({ ativa: true, admissao });
  const res = await runClaudeStream(e, 'prompt', { id: 'a5', operationKind: 'review', coordination: COORD });
  assert.deepEqual(res, { blocked: true, coordination: admissao, text: '', sessionId: null });
  assert.equal(spawns, 0);
  assert.equal(e.admissoes.length, 1);
  assert.equal(e.admissoes[0].operationKind, 'review');
  assert.equal(e.admissoes[0].opId, 'a5', 'o id da sessão vai junto, pra perda de lease cancelar a sessão certa');
  assert.equal(e.admissoes[0].prKey, 'o/r#1');
});

test('(f) admitida: o resultado carrega o handle', async () => {
  const child = filho();
  spawnImpl = () => child;
  const h = handleFalso();
  const e = motor({ ativa: true, admissao: { admitted: true, handle: h } });
  const p = runClaudeStream(e, 'prompt', { operationKind: 'self', coordination: COORD });
  await new Promise((r) => setImmediate(r));
  encerrar(child);
  const res = await p;
  assert.equal(res.coordination, h);
  assert.equal(h.abortos, 0, 'sucesso não aborta: quem grava o recibo é o chamador');
});

test('(f) erro do provedor aborta o handle e propaga o erro original', async () => {
  const child = filho();
  spawnImpl = () => child;
  const h = handleFalso();
  const e = motor({ ativa: true, admissao: { admitted: true, handle: h } });
  const p = runClaudeStream(e, 'prompt', { operationKind: 'review', coordination: COORD });
  await new Promise((r) => setImmediate(r));
  encerrar(child, { ok: false });
  const err = await p.then(() => null, (x) => x);
  assert.ok(err, 'rejeitou');
  assert.match(err.message, /claude saiu com código 1/);
  assert.equal(h.abortos, 1);
  assert.equal(err.coordenacao, undefined, 'lease não perdido: erro comum');
});

test('(f) erro com o lease perdido carimba err.coordenacao = perdido', async () => {
  const child = filho();
  spawnImpl = () => child;
  const h = handleFalso();
  h.lost = true;
  const e = motor({ ativa: true, admissao: { admitted: true, handle: h } });
  const p = runClaudeStream(e, 'prompt', { operationKind: 'pushback', coordination: COORD });
  await new Promise((r) => setImmediate(r));
  encerrar(child, { ok: false });
  const err = await p.then(() => null, (x) => x);
  assert.equal(err.coordenacao, 'perdido');
  assert.equal(h.abortos, 1);
});

// Fail-closed é do GATE, não do colaborador: qualquer resposta de syncAdmit que não seja
// a forma exata de uma admissão (admitted === true com handle) trava a sessão. null
// era também o valor do bypass, e decidir por ele deixava "admissão sem resposta" passar
// como se fosse chat/ferramenta.
const INVALIDAS = [
  ['undefined', undefined],
  ['null', null],
  ['objeto vazio', {}],
  ['admitted não booleano', { admitted: 'sim' }],
  ['admitida sem handle', { admitted: true }],
];
for (const [nome, admissao] of INVALIDAS) {
  test(`(g) ligada, admissão inválida (${nome}) bloqueia sem spawn`, async () => {
    spawnImpl = () => filho();
    const e = motor({ ativa: true, admissao });
    const res = await runClaudeStream(e, 'prompt', { id: 'a9', operationKind: 'review', coordination: COORD });
    assert.equal(spawns, 0, 'nenhuma sessão abre sem admissão comprovada');
    assert.equal(res.blocked, true);
    assert.equal(res.coordination.admitted, false);
    assert.equal(res.coordination.reason, 'indisponivel');
    assert.deepEqual(res.coordination.detail, { motivo: 'admissão inválida' });
    assert.equal(res.text, '');
    assert.equal(res.sessionId, null);
  });
}

// onAdmitted: o ponto entre a admissão e o spawn, em que o lease já é deste aparelho e
// nenhuma sessão abriu. É ali que a revisão põe a label pública de "revisando".
test('(h) admitida: onAdmitted roda antes do spawn e recebe o handle', async () => {
  const child = filho();
  spawnImpl = () => child;
  const h = handleFalso();
  const vistos = [];
  const e = motor({ ativa: true, admissao: { admitted: true, handle: h } });
  const p = runClaudeStream(e, 'prompt', { operationKind: 'review', coordination: COORD, onAdmitted: async (x) => { vistos.push([x, spawns]); } });
  await new Promise((r) => setImmediate(r));
  encerrar(child);
  await p;
  assert.deepEqual(vistos, [[h, 0]], 'uma vez, com o handle, antes do spawn');
  assert.equal(spawns, 1);
});

test('(h) bloqueada: onAdmitted não roda', async () => {
  let chamou = false;
  const e = motor({ ativa: true, admissao: { admitted: false, reason: 'alheio', detail: {} } });
  const res = await runClaudeStream(e, 'prompt', { operationKind: 'review', coordination: COORD, onAdmitted: () => { chamou = true; } });
  assert.equal(res.blocked, true);
  assert.equal(chamou, false);
});

test('(h) desligada: onAdmitted não roda e o spawn segue no mesmo tick', async () => {
  const child = filho();
  spawnImpl = () => child;
  let chamou = false;
  const e = motor({ ativa: false });
  const p = runClaudeStream(e, 'prompt', { onAdmitted: () => { chamou = true; } });
  assert.equal(spawns, 1);
  encerrar(child);
  await p;
  assert.equal(chamou, false);
});

test('(h) onAdmitted que lança devolve o lease e não abre sessão', async () => {
  const h = handleFalso();
  const e = motor({ ativa: true, admissao: { admitted: true, handle: h } });
  const p = runClaudeStream(e, 'prompt', { operationKind: 'review', coordination: COORD, onAdmitted: () => { throw new Error('falhou antes do spawn'); } });
  await assert.rejects(p, /falhou antes do spawn/);
  assert.equal(spawns, 0);
  assert.equal(h.abortos, 1);
});
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('test/sync-gate.test.js')).digest('hex').slice(0,16))"
```

Esperado: `a46cb48225558caa`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

- [ ] **Passo 2: rodar e ver falhar**

```bash
node --test --test-force-exit test/sync-gate.test.js
```

Esperado: FALHA. runClaudeStream não devolve coordination.

- [ ] **Passo 3: implementar**

Em `lib/engine/session.js`, aplique as 3 substituições abaixo, NA ORDEM. Cada trecho "localize" aparece exatamente uma vez no arquivo no momento em que você aplica aquela substituição; copie-o sem mudar espaço nem acento.

1. Localize:

```js
  return `${msg} (após ${n} tentativa(s) de reconexão com a API)`;
}

// Roda o claude headless com --output-format stream-json: cada evento NDJSON
// vira uma linha do feed de atividade (onEvent) e o resultado final é extraído
// do evento "result". Compatível com o stub FAROL_HEADLESS_CMD, que imprime um
// envelope JSON simples (fallback no close).
function runClaudeStream(engine, prompt, opts = {}) {
  const stub = env.headlessCmdStub();
  const auth = engine.resolveClaudeAuth(opts.account);
  if (auth.kind === 'codex') {
```

   Troque por:

```js
  return `${msg} (após ${n} tentativa(s) de reconexão com a API)`;
}

// Tipos de operação que passam por runClaudeStream. Allowlist exaustiva e FECHADA:
// com a coordenação entre dispositivos ligada, tipo ausente ou desconhecido é recusado
// ANTES do spawn (fail-closed). Prefixo do id (a/s/pb/c/f) segue só para diagnóstico.
const OPERACOES = Object.freeze({ review: 'coordena', self: 'coordena', pushback: 'coordena', chat: 'bypass', tool: 'bypass' });

// O modo sai junto da resposta porque é ELE que decide o caminho, nunca a forma do que o
// colaborador devolveu: null era ao mesmo tempo "bypass" e "admissão sem resposta", e
// decidir por null deixava a segunda passar como se fosse chat ou ferramenta.
async function admitirOperacao(engine, opts) {
  const kind = String(opts.operationKind || '');
  const modo = OPERACOES[kind];
  if (!modo) throw new Error(`operationKind ausente ou desconhecido (${kind || 'vazio'}): sessão recusada com a coordenação entre dispositivos ativa`);
  if (modo === 'bypass') return { modo, adm: null };
  if (!opts.coordination || typeof opts.coordination !== 'object') throw new Error(`coordination ausente para ${kind}: sessão recusada com a coordenação entre dispositivos ativa`);
  const adm = await engine.syncAdmit({ ...opts.coordination, operationKind: kind, opId: opts.id || '' });
  return { modo, adm };
}

// Resposta do coordenador fora do contrato (sem admitted booleano, admitida sem handle)
// trava a sessão: fail-closed é garantia do gate, não do colaborador. Motivo
// 'indisponivel' porque o efeito certo é o mesmo de coordenação fora do ar (espera
// curta e nova tentativa), nunca estacionar nem abrir sessão sem lease.
const ADMISSAO_INVALIDA = Object.freeze({ admitted: false, reason: 'indisponivel', detail: Object.freeze({ motivo: 'admissão inválida' }) });

function sessaoBloqueada(adm) {
  return { blocked: true, coordination: adm, text: '', sessionId: null };
}

// O que pode seguir pro provedor: o bypass declarado (sem handle) ou uma admissão com a
// forma exata. Recusa explícita (admitted === false) segue como veio; o resto vira
// ADMISSAO_INVALIDA.
function decidirAdmissao({ modo, adm }) {
  if (modo === 'bypass') return { handle: null };
  if (adm && adm.admitted === true && adm.handle) return { handle: adm.handle };
  return { bloqueio: sessaoBloqueada(adm && adm.admitted === false ? adm : ADMISSAO_INVALIDA) };
}

// opts.onAdmitted(handle) roda entre a admissão e o spawn: o lease já é deste aparelho e
// nenhuma sessão abriu. A revisão põe ali a label pública de "revisando", que antes da
// admissão seria escrita no GitHub sem sessão nenhuma e, com o lease de outro aparelho,
// ficaria presa. Exceção dele segue o caminho do erro do provedor: o lease volta.
// Com a coordenação desligada ele não roda (o invólucro nem entra em cena).
function avisarAdmissao(opts, handle) {
  if (typeof opts.onAdmitted !== 'function') return Promise.resolve();
  return Promise.resolve().then(() => opts.onAdmitted(handle));
}

// O corpo de hoje vira runProvedor (renomeação sem mudança). runClaudeStream é o invólucro:
// com a coordenação DESLIGADA chama runProvedor no MESMO tick (contrato dos testes que
// capturam o spawn síncrono); LIGADA, admite antes de qualquer stub/spawn/ramo Codex.
function runClaudeStream(engine, prompt, opts = {}) {
  if (!(engine.syncCoordenacaoAtiva && engine.syncCoordenacaoAtiva())) return runProvedor(engine, prompt, opts);
  return admitirOperacao(engine, opts).then((admissao) => {
    const { handle, bloqueio } = decidirAdmissao(admissao);
    if (bloqueio) return bloqueio;
    return avisarAdmissao(opts, handle).then(() => runProvedor(engine, prompt, opts)).then(
      (res) => Object.assign(res, { coordination: handle }),
      (err) => { const fim = handle ? handle.abort() : Promise.resolve(); return fim.then(() => { if (handle && handle.lost) err.coordenacao = 'perdido'; throw err; }); }
    );
  });
}

// Roda o claude headless com --output-format stream-json: cada evento NDJSON
// vira uma linha do feed de atividade (onEvent) e o resultado final é extraído
// do evento "result". Compatível com o stub FAROL_HEADLESS_CMD, que imprime um
// envelope JSON simples (fallback no close).
function runProvedor(engine, prompt, opts = {}) {
  const stub = env.headlessCmdStub();
  const auth = engine.resolveClaudeAuth(opts.account);
  if (auth.kind === 'codex') {
```

2. Localize:

```js
  spawnCodexLoginConsole, spawnCodexLoginConsoleMac, spawnCodexLoginConsoleLinux,
  setSessionModel, pushActivity, toolSummary, killTree, cancelSession,
  registrarAgenteDeTask, rotuloDoAgente, concluirAgentesDoEvento, projectSessions,
  runClaudeStream, parseEnvelope, parseHeadlessResult, buildModelFlags,
  acumularParcial, comReconexoes,
};
export default sessionMod;
```

   Troque por:

```js
  spawnCodexLoginConsole, spawnCodexLoginConsoleMac, spawnCodexLoginConsoleLinux,
  setSessionModel, pushActivity, toolSummary, killTree, cancelSession,
  registrarAgenteDeTask, rotuloDoAgente, concluirAgentesDoEvento, projectSessions,
  runClaudeStream, runProvedor, OPERACOES, parseEnvelope, parseHeadlessResult, buildModelFlags,
  acumularParcial, comReconexoes,
};
export default sessionMod;
```

3. Localize:

```js
  spawnCodexLoginConsole, spawnCodexLoginConsoleMac, spawnCodexLoginConsoleLinux,
  setSessionModel, pushActivity, toolSummary, killTree, cancelSession,
  registrarAgenteDeTask, rotuloDoAgente, concluirAgentesDoEvento, projectSessions,
  runClaudeStream, parseEnvelope, parseHeadlessResult, buildModelFlags,
  acumularParcial, comReconexoes,
};
```

   Troque por:

```js
  spawnCodexLoginConsole, spawnCodexLoginConsoleMac, spawnCodexLoginConsoleLinux,
  setSessionModel, pushActivity, toolSummary, killTree, cancelSession,
  registrarAgenteDeTask, rotuloDoAgente, concluirAgentesDoEvento, projectSessions,
  runClaudeStream, runProvedor, OPERACOES, parseEnvelope, parseHeadlessResult, buildModelFlags,
  acumularParcial, comReconexoes,
};
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('lib/engine/session.js')).digest('hex').slice(0,16))"
```

Esperado: `328e911968f07e2d`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

Em `lib/format.js`, aplique as 1 substituições abaixo, NA ORDEM. Cada trecho "localize" aparece exatamente uma vez no arquivo no momento em que você aplica aquela substituição; copie-o sem mudar espaço nem acento.

1. Localize:

```js
    : `a sessão não devolveu JSON (${n} caracteres de texto, nenhum objeto)`;
}

export default { modelLabel, isPermanentBranch, logStamp, reasonText, staleHeadText, semJsonText };
export { modelLabel, isPermanentBranch, logStamp, reasonText, staleHeadText, semJsonText };
```

   Troque por:

```js
    : `a sessão não devolveu JSON (${n} caracteres de texto, nenhum objeto)`;
}

/* O aviso de uma análise que a coordenação entre aparelhos SEGUROU, dito uma vez só
   pros três chamadores (revisão, autoanálise e o que mais vier). Segurar não é falhar:
   quem lê precisa saber POR QUE nada começou e se precisa fazer algo, e a resposta
   muda por motivo (esperar outro aparelho, nada a refazer, teto do dia, conexão fora).
   Sem nome do aparelho a frase diz "outro aparelho"; o e-mail nunca entra aqui. */
function textoBloqueio(key, admissao) {
  const a = admissao && typeof admissao === 'object' ? admissao : {};
  const d = a.detail && typeof a.detail === 'object' ? a.detail : {};
  const aparelho = d.deviceName ? `o aparelho ${d.deviceName}` : 'outro aparelho';
  if (a.reason === 'alheio') return `${key}: ${aparelho} está analisando este PR agora; este aparelho espera ele terminar.`;
  if (a.reason === 'recibo' && d.externo) return `${key}: você já se manifestou neste commit no GitHub; nada foi refeito.`;
  if (a.reason === 'recibo') return `${key}: este commit já foi analisado por ${aparelho}; nada foi refeito.`;
  if (a.reason === 'esgotado') return `${key}: as rodadas automáticas de hoje deste PR já rodaram entre os seus aparelhos; a próxima fica pra amanhã (o botão Re-revisar continua valendo).`;
  const motivo = d.motivo ? ` (${d.motivo})` : '';
  return `${key}: coordenação entre aparelhos indisponível${motivo}; nada foi iniciado, e a próxima tentativa espera a conexão voltar.`;
}

export default { modelLabel, isPermanentBranch, logStamp, reasonText, staleHeadText, semJsonText, textoBloqueio };
export { modelLabel, isPermanentBranch, logStamp, reasonText, staleHeadText, semJsonText, textoBloqueio };
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('lib/format.js')).digest('hex').slice(0,16))"
```

Esperado: `9633a2f331a6c75e`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

- [ ] **Passo 4: rodar e ver passar**

```bash
node --test --test-force-exit test/sync-gate.test.js
```

Esperado: PASSA, 0 falhas.

- [ ] **Passo 5: gate e commit**

```bash
npm run check && npm run lint && npm test
```

Esperado: `fail 0` e `gate de qualidade: sem regressão`. Se algo falhar, PARE e relate; não mexa em outro arquivo para fazer passar.

```bash
git add lib/engine/session.js lib/format.js test/sync-gate.test.js
git commit -m "feat(sync): gate de coordenação no runClaudeStream"
```


### Tarefa T20: Revisão headless sob coordenação

A revisão headless é o maior consumidor. Ela pede admissão antes de nascer e grava o recibo DEPOIS de registrar a decisão local, nessa ordem: recibo gravado antes deixaria, num processo morto no meio, o recibo de pé e a decisão ausente.

**Arquivos:**
- Modificar: `lib/engine/review.js`
- Criar: `test/sync-coordenacao-nao-estaciona.test.js`
- Criar: `test/sync-review.test.js`

- [ ] **Passo 1: escrever o teste**

Crie `test/sync-coordenacao-nao-estaciona.test.js` com EXATAMENTE este conteúdo:

```js
// D11 do contrato da sincronização: falha de coordenação entre dispositivos nunca
// estaciona e nunca entra no retryAfterNet. A classe 'coordenacao-indisponivel' da
// taxonomia é 'transitorio' (é o que o Diagnóstico precisa ler), e esse kind, no
// runOneHeadless, levaria ao retry com teto e depois ao estacionamento. A garantia
// mora no próprio runOneHeadless, que reconhece a classe antes de decidir retry.
import os from 'node:os';
import path from 'node:path';
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-sync-coord-nao-estaciona-' + process.pid);

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { Engine } = await import('../server.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ } });

const MSG_COORDENACAO = 'coordenação entre dispositivos indisponível: fetch failed';

function engineBase() {
  const e = new Engine();
  e.accountForPr = (pr) => pr.account || 'eu';
  e.tokens = { eu: 'tok-eu' };
  e.log = () => { };
  e.prState = async () => 'OPEN';
  e.bloqueadoPorHistorico = async () => ({ bloqueado: false, head: '', quem: [], decisivos: [] });
  return e;
}
const prDe = (key) => ({ key, url: `https://github.com/${key.replace('#', '/pull/')}` });

test('runOneHeadless: coordenação indisponível volta pra fila sem retry e sem estacionar, mesmo passando do teto', async () => {
  const e = engineBase();
  const toasts = [];
  e.on('toast', (t) => toasts.push(t));
  const pr = prDe('o/r#1');
  e.runHeadlessReview = async () => { throw new Error(MSG_COORDENACAO); };
  // cinco quedas seguidas: o teto do ramo transitório é 3, então a quarta estacionaria
  for (let i = 0; i < 5; i++) await e.runOneHeadless(pr, 'eu');
  assert.equal(e.retryAfterNet.has(pr.key), false, 'nunca entra no retryAfterNet');
  assert.equal(e.autoReviewParked.has(pr.key), false, 'nunca estaciona');
  assert.equal(e.seen.has(pr.key), false, 'unsee: o PR volta a ser elegível');
  assert.equal(e.queue.filter((p) => p.key === pr.key).length, 1, 'volta VISÍVEL pra fila, uma vez só');
  assert.ok(toasts.every((t) => t.kind !== 'error'), 'segurar não é falhar: nenhum toast vermelho');
});

test('runOneHeadless: a mesma mensagem sem acento também não estaciona', async () => {
  const e = engineBase();
  const pr = prDe('o/r#2');
  e.runHeadlessReview = async () => { throw new Error('Coordenacao entre dispositivos indisponivel: timeout'); };
  for (let i = 0; i < 4; i++) await e.runOneHeadless(pr, 'eu');
  assert.equal(e.retryAfterNet.has(pr.key), false);
  assert.equal(e.autoReviewParked.has(pr.key), false);
});

test('runOneHeadless: rede comum continua no retry de sempre (a exceção é só da coordenação)', async () => {
  const e = engineBase();
  const pr = prDe('o/r#3');
  e.runHeadlessReview = async () => { throw new Error('fetch failed'); };
  await e.runOneHeadless(pr, 'eu');
  assert.equal(e.retryAfterNet.get(pr.key).tries, 1);
});
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('test/sync-coordenacao-nao-estaciona.test.js')).digest('hex').slice(0,16))"
```

Esperado: `a6e76b9782a99f46`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

Crie `test/sync-review.test.js` com EXATAMENTE este conteúdo:

```js
// A revisão headless com a coordenação entre aparelhos ligada (D9, D11, D13, D14 e D19
// do contrato da sincronização). O gate mora em runClaudeStream; aqui a prova é o que o
// CHAMADOR faz com a resposta dele:
//   - bloqueio devolve o PR pra fila visível com uma espera anotada, e nunca estaciona
//     nem entra no retry (segurar não é falhar);
//   - recibo de outro aparelho não re-enfileira (o coordenador já marcou o PR como visto);
//   - lease perdido no meio da sessão não estaciona e não posta;
//   - cada desfecho grava o recibo DEPOIS de persistir o resultado local, e o que não
//     chegou a desfecho devolve o lease;
//   - as automações pulam PR segurado, e ele não conta como "esperando" na cota (D19).
// Com a coordenação DESLIGADA nada disto muda: a suíte inteira é a prova.
//
// Engine real com FAROL_HOME temporário (server.js alcança lib/paths.js, então await
// import) e sessão stubada no padrão de test/dedup-round.test.js.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-sync-review-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SYNC } from '../lib/constants.js';

const { Engine } = await import('../server.js');
const reviewMod = (await import('../lib/engine/review.js')).default;
const fanout = (await import('../lib/engine/fanout.js')).default;
const io = (await import('../lib/io.js')).default;

// fan-out neutro (sem gh) e o gh da label de "revisando" gravado em vez de rodar
const prMetricsOriginal = fanout.prMetrics;
fanout.prMetrics = async () => null;
const runOriginal = io.run;
let ghCalls = [];
io.run = async (cmd, args) => { ghCalls.push([cmd, ...args].join(' ')); return { ok: true, code: 0, stdout: '', stderr: '' }; };

after(() => {
  fanout.prMetrics = prMetricsOriginal;
  io.run = runOriginal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});

beforeEach(() => { ghCalls = []; });

const HEAD = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const prDe = (key, extra = {}) => ({ key, repo: key.split('#')[0], number: Number(key.split('#')[1]), url: `https://github.com/${key.replace('#', '/pull/')}`, author: 'dev', requested: true, ...extra });

function envelopeApprove() {
  return {
    analysisStatus: 'complete', verdict: 'approve', decision: 'auto_approve', cardMet: true, reasons: [],
    reportMarkdown: 'relatório', payloads: { approve: { event: 'APPROVE', body: 'Leitura atenta, tudo certo por aqui.' } },
  };
}

function handleFalso() {
  const h = { noop: false, leaseId: 'L1', attemptId: '', lost: false, done: false, completos: [], abortos: 0 };
  h.onLost = () => { };
  h.complete = async (op) => { h.completos.push(op); h.done = true; return { ok: true }; };
  h.abort = async () => { h.abortos++; h.done = true; };
  return h;
}

// sessão stubada: devolve `resposta` (objeto ou função) e guarda os opts que o
// runHeadlessReview mandou pro runClaudeStream. Imita o invólucro de session.js no
// ponto que importa aqui: com a coordenação ligada, opts.onAdmitted roda entre a
// admissão e o provedor, e nunca quando a admissão foi recusada. Resposta em função
// recebe `admitir` e decide quando (ou se) a admissão aconteceu.
function motor({ resposta, policy = 'approve', coordenacao = true } = {}) {
  const e = new Engine();
  e.accountForPr = (pr) => pr.account || 'eu';
  e.tokenFor = () => 'tok-eu';
  e.isMuted = () => false;
  e.log = () => { };
  e.logs = [];
  e.log = (nivel, msg) => { e.logs.push(`${nivel} ${msg}`); };
  e.prState = async () => 'OPEN';
  e.headSha = async () => HEAD;
  e.fetchPrFiles = async () => null;
  e.bloqueadoPorChecks = async () => ({ faltando: [] });
  e.bloqueadoPorHistorico = async () => ({ bloqueado: false, head: '', quem: [], decisivos: [] });
  e.approvePolicyFor = () => policy;
  e.rejectPolicyFor = () => 'wait';
  e.scopeLabel = () => 'Conta';
  e.writeMemory = () => { };
  e.myReviewsWithTime = async () => [];
  e.postados = [];
  e.postReview = async (pr, payload) => { e.postados.push(payload); return { ok: true }; };
  e.opts = [];
  e.runClaudeStream = async (prompt, opts) => {
    e.opts.push(opts);
    const admitir = async () => { if (coordenacao && typeof opts.onAdmitted === 'function') await opts.onAdmitted(null); };
    if (typeof resposta === 'function') return resposta(opts, admitir);
    if (!(resposta && resposta.blocked)) await admitir();
    return resposta;
  };
  e.toasts = [];
  e.on('toast', (t) => e.toasts.push(t));
  if (coordenacao) e.config.sync = { ...e.config.sync, enabled: true, coordination: { enabled: true } };
  return e;
}

const bloqueio = (reason, detail = {}) => ({ blocked: true, coordination: { admitted: false, reason, detail }, text: '', sessionId: null });
const resultado = (envelope, handle) => ({ text: JSON.stringify({ result: JSON.stringify(envelope) }), sessionId: 's1', coordination: handle });

test('MAX_RODADAS_AUTO_DIA lê a fonte única do teto compartilhado', () => {
  assert.equal(reviewMod.MAX_RODADAS_AUTO_DIA, SYNC.DAILY_ROUNDS_MAX);
});

test('runHeadlessReview manda operationKind review e o contexto da coordenação', async () => {
  const e = motor({ resposta: bloqueio('indisponivel') });
  const pr = prDe('o/r#1', { rodadaAutomatica: true, manual: true, semCoordenacao: true, ignorarRecibo: false, account: 'eu' });
  await e.runHeadlessReview(pr);
  const op = e.opts[0];
  assert.equal(op.operationKind, 'review');
  assert.deepEqual(op.coordination, {
    prKey: 'o/r#1', account: 'eu', materialVersion: HEAD, headSha: HEAD, contaRodada: true, manual: true,
    semCoordenacao: true, ignorarRecibo: false,
    pr: { key: 'o/r#1', url: pr.url, repo: 'o/r', number: 1, author: 'dev', account: 'eu' },
  });
});

test('bloqueio alheio: volta pra fila, anota a espera, não estaciona e não entra no retry', async () => {
  const e = motor({ resposta: bloqueio('alheio', { deviceName: 'notebook', deviceId: 'd2', since: 1 }) });
  const pr = prDe('o/r#2');
  e.markSeen(pr.key);
  await e.runOneHeadless(pr, 'eu');
  assert.equal(e.seen.has(pr.key), false, 'unsee: o PR volta a ser elegível');
  assert.equal(e.queue.filter((p) => p.key === pr.key).length, 1, 'volta VISÍVEL pra fila');
  assert.equal(e.autoReviewParked.has(pr.key), false, 'nunca estaciona');
  assert.equal(e.retryAfterNet.has(pr.key), false, 'nunca entra no retry');
  const espera = e.sync.espera[pr.key];
  assert.equal(espera.reason, 'alheio');
  assert.equal(espera.deviceName, 'notebook');
  assert.ok(espera.until > Date.now(), 'a espera vale por um tempo');
  assert.equal(e.postados.length, 0);
  assert.equal(e.decisions.pending.length, 0, 'bloqueio não vira pendência');
  assert.ok(e.toasts.every((t) => t.kind === 'info'), 'segurar não é falhar');
  assert.ok(e.toasts.some((t) => /notebook/.test(t.text)), 'o aviso diz qual aparelho está com o PR');
});

// A label pública só entra depois da admissão: recusada, nada é escrito no GitHub. Antes
// ela entrava no início da revisão, e cada recusa virava um add e um remove sem sessão
// nenhuma (a espera de 'indisponivel' é de segundos), ou uma label presa quando o lease
// alheio era de pushback, que não põe label.
for (const reason of ['alheio', 'recibo', 'esgotado', 'indisponivel']) {
  test(`admissão recusada (${reason}) não escreve a label de revisando no GitHub`, async () => {
    const e = motor({ resposta: bloqueio(reason, { deviceName: 'notebook', operationKind: 'pushback' }) });
    await e.runHeadlessReview(prDe('o/r#3'));
    assert.equal(ghCalls.some((c) => c.includes('--add-label')), false);
    assert.equal(ghCalls.some((c) => c.includes('--remove-label')), false);
  });
}

test('coordenação desligada: a label entra no início, como sempre', async () => {
  const e = motor({ resposta: resultado(envelopeApprove(), null), coordenacao: false });
  await e.runHeadlessReview(prDe('o/r#21'));
  assert.ok(ghCalls.some((c) => c.includes('--add-label')));
  assert.ok(ghCalls.some((c) => c.includes('--remove-label')));
});

test('bloqueio por recibo: não estaciona, não re-enfileira e não anota espera', async () => {
  const e = motor({ resposta: bloqueio('recibo', { deviceName: 'desktop' }) });
  const pr = prDe('o/r#4');
  e.markSeen(pr.key);
  await e.runOneHeadless(pr, 'eu');
  assert.equal(e.seen.has(pr.key), true, 'o coordenador marcou visto e ele fica visto');
  assert.equal(e.queue.some((p) => p.key === pr.key), false, 'não volta pra fila');
  assert.equal(e.autoReviewParked.has(pr.key), false);
  assert.equal(e.retryAfterNet.has(pr.key), false);
  assert.equal(e.sync.espera[pr.key], undefined, 'recibo não é espera');
  assert.equal(ghCalls.some((c) => c.includes('--add-label') || c.includes('--remove-label')), false, 'a label nem entrou: a recusa veio antes');
});

test('bloqueio por teto de rodadas: espera até a virada do dia em Brasília', async () => {
  const e = motor({ resposta: bloqueio('esgotado', { day: '2026-09-11', started: 3 }) });
  const pr = prDe('o/r#5');
  await e.runOneHeadless(pr, 'eu');
  assert.equal(e.sync.espera[pr.key].reason, 'esgotado');
  assert.ok(e.sync.espera[pr.key].until > Date.now());
  assert.equal(e.autoReviewParked.has(pr.key), false);
});

test('lease perdido no meio da sessão: não estaciona, não entra no retry e não posta', async () => {
  const perdido = async (op, admitir) => { await admitir(); throw Object.assign(new Error('cancelada por você'), { cancelled: true, coordenacao: 'perdido' }); };
  const e = motor({ resposta: perdido });
  const pr = prDe('o/r#6');
  e.markSeen(pr.key);
  await e.runOneHeadless(pr, 'eu');
  assert.equal(e.autoReviewParked.has(pr.key), false, 'cancelamento pela coordenação não é cancelamento seu');
  assert.equal(e.retryAfterNet.has(pr.key), false);
  assert.equal(e.seen.has(pr.key), false);
  assert.equal(e.queue.filter((p) => p.key === pr.key).length, 1);
  assert.equal(e.postados.length, 0);
  assert.ok(e.logs.some((l) => /WARN .*lease de coordenação perdido/.test(l)));
  assert.ok(ghCalls.some((c) => c.includes('--add-label')), 'a sessão foi admitida antes de perder o lease');
  assert.equal(ghCalls.some((c) => c.includes('--remove-label')), false, 'a label agora é do aparelho que assumiu');
});

// Entrada de retry PREEXISTENTE: o PR já vinha de uma falha transitória quando a
// coordenação o tirou deste aparelho. Deixá-la viva fazia o próprio check() relançar no
// ciclo seguinte um PR que outro aparelho acabou de assumir.
test('lease perdido limpa a entrada de retry que já existia', async () => {
  const perdido = async (op, admitir) => { await admitir(); throw Object.assign(new Error('cancelada por você'), { cancelled: true, coordenacao: 'perdido' }); };
  const e = motor({ resposta: perdido });
  const pr = prDe('o/r#66');
  e.retryAfterNet.set(pr.key, { tries: 2, pr, at: Date.now() });
  await e.runOneHeadless(pr, 'eu');
  assert.equal(e.retryAfterNet.has(pr.key), false, 'o retry de antes não pode sobreviver à perda do lease');
});

// A autoanálise chega aqui com cancelled também. Sem ramo próprio, a pessoa lia
// "Autoanálise cancelada", como se tivesse cancelado, e sem saber que a análise não
// ficou registrada em lugar nenhum.
test('autoanálise com lease perdido tem texto próprio, não o de cancelamento', async () => {
  const perdido = async (op, admitir) => { await admitir(); throw Object.assign(new Error('cancelada por você'), { cancelled: true, coordenacao: 'perdido' }); };
  const e = motor({ resposta: perdido });
  e.runSelfAnalysis = async () => { throw Object.assign(new Error('cancelada por você'), { cancelled: true, coordenacao: 'perdido' }); };
  const toasts = [];
  e.on('toast', (t) => toasts.push(t.text));
  await e.runOneHeadless({ ...prDe('o/r#7'), kind: 'self' }, 'eu');
  assert.equal(toasts.length, 1);
  assert.match(toasts[0], /outro aparelho assumiu a coordenação; a autoanálise foi encerrada sem registrar/);
  assert.doesNotMatch(toasts[0], /cancelada/);
  assert.ok(e.logs.some((l) => /WARN .*autoanalise .*lease de coordenação perdido/.test(l)));
});

test('desfecho postado grava recibo published depois de registrar a decisão', async () => {
  const h = handleFalso();
  const e = motor({ resposta: resultado(envelopeApprove(), h) });
  const ordem = [];
  const record = e.recordDecision.bind(e);
  e.recordDecision = (...a) => { ordem.push('decisao'); return record(...a); };
  const complete = h.complete;
  h.complete = async (op) => { ordem.push('recibo'); return complete(op); };
  await e.runHeadlessReview(prDe('o/r#7'));
  assert.equal(e.postados.length, 1);
  assert.deepEqual(h.completos, [{ publicationState: 'published' }]);
  assert.deepEqual(ordem, ['decisao', 'recibo'], 'estado local primeiro, recibo depois (D14)');
  assert.equal(h.abortos, 0);
});

test('pendência grava recibo pending; postagem que falhou grava failed', async () => {
  const h1 = handleFalso();
  const e1 = motor({ resposta: resultado(envelopeApprove(), h1), policy: 'wait' });
  await e1.runHeadlessReview(prDe('o/r#8'));
  assert.deepEqual(h1.completos, [{ publicationState: 'pending' }]);

  const h2 = handleFalso();
  const e2 = motor({ resposta: resultado(envelopeApprove(), h2) });
  e2.postReview = async () => ({ ok: false, error: 'HTTP 422: Unprocessable Entity' });
  await e2.runHeadlessReview(prDe('o/r#9'));
  assert.deepEqual(h2.completos, [{ publicationState: 'failed' }]);
});

test('review meu já no head: recibo external_review publicado', async () => {
  const h = handleFalso();
  const e = motor({ resposta: resultado(envelopeApprove(), h) });
  e.myReviewsWithTime = async () => [{ state: 'APPROVED', at: Date.now(), commit: HEAD }];
  await e.runHeadlessReview(prDe('o/r#10'));
  assert.equal(e.postados.length, 0);
  assert.deepEqual(h.completos, [{ outcome: 'external_review', publicationState: 'published' }]);
});

test('sessão sem desfecho (resultado ilegível) devolve o lease no finally, sem recibo', async () => {
  const h = handleFalso();
  const e = motor({ resposta: { text: 'só progresso, nenhum envelope', sessionId: 's1', coordination: h } });
  await assert.rejects(e.runHeadlessReview(prDe('o/r#11')));
  assert.equal(h.completos.length, 0);
  assert.equal(h.abortos, 1);
});

test('toReview pula o PR com espera vigente e volta a lançar quando ela vence', async () => {
  const e = motor();
  e.sync.status = 'conectado';
  const pr = prDe('o/r#12');
  e.queue = [pr];
  const lancados = [];
  e.launchReview = async (urls) => { lancados.push(...urls); return { ok: true }; };
  e.sync.espera[pr.key] = { reason: 'alheio', deviceName: 'notebook', until: Date.now() + 60 * 1000 };
  await e._dispararAutomacoes([]);
  assert.deepEqual(lancados, []);
  delete e.sync.espera[pr.key];
  await e._dispararAutomacoes([]);
  assert.deepEqual(lancados, [pr.url]);
});

test('toReview não lança nada com a coordenação ligada e a conexão fora (aviso único)', async () => {
  const e = motor();
  e.sync.status = 'erro';
  e.sync.lastError = { code: 'indisponivel', motivo: 'o Firebase está indisponível ou sem rede', at: 1 };
  e.queue = [prDe('o/r#13'), prDe('o/r#14')];
  const lancados = [];
  e.launchReview = async (urls) => { lancados.push(...urls); return { ok: true }; };
  await e._dispararAutomacoes([]);
  await e._dispararAutomacoes([]);
  assert.deepEqual(lancados, []);
  assert.equal(e.toasts.filter((t) => /Coordenação entre aparelhos indisponível/.test(t.text)).length, 1);
});

test('coordenação desligada: a espera anotada não segura nada', async () => {
  const e = motor({ coordenacao: false });
  const pr = prDe('o/r#15');
  e.queue = [pr];
  e.sync.espera[pr.key] = { reason: 'alheio', until: Date.now() + 60 * 1000 };
  const lancados = [];
  e.launchReview = async (urls) => { lancados.push(...urls); return { ok: true }; };
  await e._dispararAutomacoes([]);
  assert.deepEqual(lancados, [pr.url]);
});

test('retryTargets e reReviewTargets pulam PR segurado pela coordenação', () => {
  const pr = prDe('org/app#7');
  const base = {
    retryAfterNet: new Map([[pr.key, { tries: 1, pr, notBefore: null }]]),
    accountForPr: () => 'eu', isMuted: () => false, tokenFor: () => 'tok', budgetBlockedFor: () => null,
    skipComentado: {},
  };
  const livre = { ...base, syncSeguraAutomacao: () => false };
  const segura = { ...base, syncSeguraAutomacao: (k) => k === pr.key };
  assert.equal(reviewMod.retryTargets(livre, new Set(), new Set()).length, 1);
  assert.equal(reviewMod.retryTargets(segura, new Set(), new Set()).length, 0);

  const re = (seguraFn) => ({
    panorama: [{ ...pr }],
    staleInfo: { [pr.key]: { stale: true, head: 'sha-novo', lastState: 'CHANGES_REQUESTED' } },
    headQuietoDesde: { [pr.key]: { head: 'sha-novo', at: 0 } },
    reReviewLaunched: {}, decisions: { pending: [], resolved: [] },
    autoReviewParked: new Set(), retryAfterNet: new Map(),
    accountForPr: () => 'eu', isMuted: () => false, autoReviewFor: () => true, tokenFor: () => 'tok',
    budgetBlockedFor: () => null, outrosRevisando: () => [], skipComentado: {},
    syncSeguraAutomacao: seguraFn,
  });
  assert.equal(reviewMod.reReviewTargets(re(() => false), new Set()).length, 1);
  assert.equal(reviewMod.reReviewTargets(re(() => true), new Set()).length, 0);
});

test('launchReReviews carimba rodadaAutomatica no PR enfileirado', async () => {
  const pr = prDe('org/app#8');
  const enq = [];
  const e = {
    panorama: [pr],
    staleInfo: { [pr.key]: { stale: true, head: 'sha-novo', lastState: 'CHANGES_REQUESTED' } },
    headQuietoDesde: { [pr.key]: { head: 'sha-novo', at: 0 } },
    reReviewLaunched: {}, decisions: { pending: [], resolved: [] },
    autoReviewParked: new Set(), retryAfterNet: new Map(), headlessQueue: [], activeReviews: new Map(),
    accountForPr: () => 'eu', isMuted: () => false, autoReviewFor: () => true, tokenFor: () => 'tok',
    budgetBlockedFor: () => null, outrosRevisando: () => [], skipComentado: {},
    saveReReviewLaunched() { }, emit() { }, enqueueHeadless(p) { enq.push(p); },
    bloqueiaAutomatico: async () => false, fetchPrFiles: async () => null,
  };
  await reviewMod.launchReReviews(e);
  assert.equal(enq.length, 1);
  assert.equal(enq[0].rodadaAutomatica, true);
});

// D19: a cota da conta dentro do perfil só morde quando OUTRA conta está esperando.
// PR segurado pela coordenação não vai rodar, então não é disputa de verdade.
function engineContas({ queue, segura }) {
  const contas = [{ user: 'biuder' }, { user: 'pessoal' }];
  return {
    queue,
    accountList: () => contas,
    accountForPr: (p) => p.acct,
    isMuted: () => false,
    autoReviewFor: () => true,
    tokenFor: () => 'tok',
    autoReviewParked: new Set(),
    skipComentado: {},
    profileOfAccount: () => ({ id: 'p1' }),
    syncSeguraAutomacao: segura,
  };
}

test('contasDoPerfil não marca como esperando a conta cujo único PR está segurado (D19)', () => {
  const queue = [{ key: 'org/app#1', acct: 'pessoal' }];
  const segurado = Engine.prototype.contasDoPerfil.call(engineContas({ queue, segura: () => true }), 'p1');
  assert.equal(segurado.find((c) => c.user === 'pessoal').waiting, false);
  const livre = Engine.prototype.contasDoPerfil.call(engineContas({ queue, segura: () => false }), 'p1');
  assert.equal(livre.find((c) => c.user === 'pessoal').waiting, true);
});

// D14 vale até o POST: o heartbeat segue batendo depois de o provedor resolver
// (myReviewStates, checks, headSha), e perder o lease nessa fase quer dizer que outro
// aparelho pode ser o dono agora. Nada sai no GitHub; o PR volta pra fila como no ramo
// de perda durante a sessão.
for (const [nome, marcar] of [['antes de o resultado chegar ao gate', (h) => { h.lost = true; }], ['durante a consulta que antecede o POST', () => { }]]) {
  test(`handle perdido depois de o provedor resolver não posta (${nome})`, async () => {
    const h = handleFalso();
    marcar(h);
    const e = motor({ resposta: resultado(envelopeApprove(), h) });
    e.myReviewsWithTime = async () => { h.lost = true; return []; };
    const pr = prDe('o/r#16');
    e.markSeen(pr.key);
    await e.runOneHeadless(pr, 'eu');
    assert.equal(e.postados.length, 0, 'lease perdido não posta');
    assert.equal(h.completos.length, 0, 'sem desfecho, sem recibo');
    assert.equal(e.autoReviewParked.has(pr.key), false, 'não estaciona');
    assert.equal(e.retryAfterNet.has(pr.key), false, 'não entra no retry');
    assert.equal(e.seen.has(pr.key), false);
    assert.equal(e.queue.filter((p) => p.key === pr.key).length, 1, 'volta pra fila');
    assert.equal(e.decisions.pending.some((d) => d.key === pr.key), false, 'nada foi decidido neste aparelho');
    assert.ok(e.logs.some((l) => /WARN .*lease de coordenação perdido/.test(l)));
    assert.ok(e.toasts.every((t) => t.kind === 'info'));
  });
}

test('handle perdido depois de o provedor resolver também segura o REQUEST_CHANGES', async () => {
  const h = handleFalso();
  const env = {
    analysisStatus: 'complete', verdict: 'request_changes', decision: 'needs_decision', cardMet: true,
    reasons: ['bloqueio real'], reportMarkdown: 'relatório',
    payloads: { request_changes: { event: 'REQUEST_CHANGES', body: 'Tem um problema na validação do redirect.' } },
  };
  const e = motor({ resposta: resultado(env, h) });
  e.rejectPolicyFor = () => 'request_changes';
  e.myReviewsWithTime = async () => { h.lost = true; return []; };
  await e.runOneHeadless(prDe('o/r#17'), 'eu');
  assert.equal(e.postados.length, 0);
});

// D13: o teto compartilhado conta o round automático pós-push UMA vez. A marca é
// consumida na admissão, então nada que herde o objeto do PR depois disso (retry
// transitório, fila de volta, clique sobre o card) gasta outra rodada do dia.
test('retentativa transitória de um round automático não reserva outra rodada', async () => {
  let chamadas = 0;
  const e = motor({ resposta: () => { chamadas++; throw new Error('dial tcp: connectex: rede fora'); } });
  const pr = prDe('o/r#18', { rodadaAutomatica: true });
  await e.runOneHeadless(pr, 'eu');
  assert.equal(e.opts[0].coordination.contaRodada, true, 'a primeira tentativa conta o round');
  const guardado = e.retryAfterNet.get(pr.key);
  assert.ok(guardado, 'queda transitória vai pro retry');
  await e.runOneHeadless(guardado.pr, 'eu');
  assert.equal(chamadas, 2);
  assert.equal(e.opts[1].coordination.contaRodada, false, 'o retry é o MESMO round');
});

test('clique sobre o PR que voltou da coordenação não gasta rodada do dia', async () => {
  const e = motor({ resposta: bloqueio('alheio', { deviceName: 'notebook' }) });
  const pr = prDe('o/r#19', { rodadaAutomatica: true });
  await e.runOneHeadless(pr, 'eu');
  assert.equal(e.opts[0].coordination.contaRodada, true);
  const naFila = e.queue.find((p) => p.key === pr.key);
  assert.ok(naFila, 'voltou pra fila');
  assert.notEqual(naFila.rodadaAutomatica, true, 'a fila não herda a marca do round');
  // o clique copia o objeto da fila; mesmo que a marca tivesse vazado, clique não conta
  naFila.rodadaAutomatica = true;
  e.token = 'tok-eu';
  e.bloqueiaAutomatico = async () => false;
  e.syncPreflightManual = async () => ({ ok: true });
  const enfileirados = [];
  e.enqueueHeadless = (p) => { enfileirados.push(p); };
  await e.launchReview([pr.url], 'auto', 'clique');
  assert.equal(enfileirados.length, 1);
  assert.notEqual(enfileirados[0].rodadaAutomatica, true, 'clique nunca é round automático');
});

test('retomada recusada que recomeça do zero não reserva outra rodada', async () => {
  const h = handleFalso();
  const e = motor({
    resposta: async (op, admitir) => {
      await admitir();
      if ((op.extraArgs || []).includes('--resume')) throw new Error('No conversation found with session id');
      return resultado(envelopeApprove(), h);
    },
  });
  const pr = prDe('o/r#20', { rodadaAutomatica: true, retomarSid: 'sessao-anterior-1', knownHead: HEAD });
  await e.runHeadlessReview(pr);
  assert.equal(e.opts.length, 2);
  assert.equal(e.opts[0].coordination.contaRodada, true, 'a tentativa com --resume conta o round');
  assert.equal(e.opts[1].coordination.contaRodada, false, 'a sessão nova que a substitui é a mesma rodada');
});

// Desfechos com lease: complete() solta o lease, então a label deste aparelho sai ANTES
// do recibo. Na ordem inversa, um aparelho que assumisse o head novo no intervalo teria a
// label dele (mesma conta, mesmo nome) apagada pela remoção atrasada do finally.
const ENV_REJEITA = {
  analysisStatus: 'complete', verdict: 'request_changes', decision: 'needs_decision', cardMet: true,
  reasons: ['bloqueio real'], reportMarkdown: 'relatório',
  payloads: { request_changes: { event: 'REQUEST_CHANGES', body: 'Tem um problema na validação do redirect.' } },
};
const DESFECHOS = [
  ['published', () => ({ env: envelopeApprove() })],
  ['pending', () => ({ env: envelopeApprove(), policy: 'wait' })],
  ['failed', () => ({ env: envelopeApprove(), ajustar: (e) => { e.postReview = async () => ({ ok: false, error: 'HTTP 422: Unprocessable Entity' }); } })],
  ['external_review', () => ({ env: envelopeApprove(), ajustar: (e) => { e.myReviewsWithTime = async () => [{ state: 'APPROVED', at: Date.now(), commit: HEAD }]; } })],
  ['auto_rejected', () => ({ env: ENV_REJEITA, ajustar: (e) => { e.rejectPolicyFor = () => 'request_changes'; } })],
];
for (const [nome, cenario] of DESFECHOS) {
  test(`desfecho ${nome}: a label sai antes do recibo soltar o lease`, async () => {
    const { env, policy, ajustar } = cenario();
    const h = handleFalso();
    const e = motor({ resposta: resultado(env, h), policy });
    if (ajustar) ajustar(e);
    let labelAoGravarRecibo = null;
    const complete = h.complete;
    h.complete = async (op) => { labelAoGravarRecibo = ghCalls.some((c) => c.includes('--remove-label')); return complete(op); };
    await e.runHeadlessReview(prDe('o/r#22'));
    assert.equal(h.completos.length, 1, 'o desfecho gravou o recibo');
    assert.equal(labelAoGravarRecibo, true, 'a label já tinha saído quando o lease foi solto');
    assert.equal(ghCalls.filter((c) => c.includes('--remove-label')).length, 1, 'e sai uma vez só');
  });
}

// A retomada recusada abre uma segunda admissão, depois de a primeira ter posto a label.
// Se a segunda ouve "alheio", a label no PR só é do outro aparelho quando ele está numa
// REVISÃO (mesma conta, mesmo nome); lease de pushback ou autoanálise não põe label, e
// preservar a nossa a deixaria presa.
for (const [kind, preserva] of [['review', true], ['pushback', false], ['self', false]]) {
  test(`retomada recusada e segunda admissão alheia (${kind}): label ${preserva ? 'preservada' : 'removida'}`, async () => {
    const e = motor({
      resposta: async (op, admitir) => {
        if (!(op.extraArgs || []).includes('--resume')) return bloqueio('alheio', { deviceName: 'notebook', operationKind: kind });
        await admitir();
        throw new Error('No conversation found with session id');
      },
    });
    await e.runHeadlessReview(prDe('o/r#23', { retomarSid: 'sessao-anterior-2', knownHead: HEAD }));
    assert.ok(ghCalls.some((c) => c.includes('--add-label')), 'a primeira tentativa pôs a label');
    assert.equal(ghCalls.some((c) => c.includes('--remove-label')), !preserva);
  });
}

// D14 em TODOS os desfechos, não só no postado: o estado local (recordDecision) é
// persistido antes de o recibo ir pro banco. Com a ordem inversa, uma queda entre os
// dois deixaria outro aparelho vendo "este commit já foi analisado" sem decisão nenhuma
// gravada aqui.
for (const [nome, cenario] of DESFECHOS) {
  test(`desfecho ${nome}: recibo gravado depois de registrar a decisão`, async () => {
    const { env, policy, ajustar } = cenario();
    const h = handleFalso();
    const e = motor({ resposta: resultado(env, h), policy });
    if (ajustar) ajustar(e);
    const ordem = [];
    const record = e.recordDecision.bind(e);
    e.recordDecision = (...a) => { ordem.push('decisao'); return record(...a); };
    const complete = h.complete;
    h.complete = async (op) => { ordem.push('recibo'); return complete(op); };
    await e.runHeadlessReview(prDe('o/r#24'));
    assert.deepEqual(ordem, ['decisao', 'recibo']);
  });
}
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('test/sync-review.test.js')).digest('hex').slice(0,16))"
```

Esperado: `f159241df20a1fe5`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

- [ ] **Passo 2: rodar e ver falhar**

```bash
node --test --test-force-exit test/sync-review.test.js test/sync-coordenacao-nao-estaciona.test.js
```

Esperado: FALHA. a revisão não pede admissão e roda mesmo com lease alheio.

- [ ] **Passo 3: implementar**

Em `lib/engine/review.js`, aplique as 23 substituições abaixo, NA ORDEM. Cada trecho "localize" aparece exatamente uma vez no arquivo no momento em que você aplica aquela substituição; copie-o sem mudar espaço nem acento.

1. Localize:

```js
import { classify, resetAtFrom } from '../log-taxonomy.js';
// reasons/attention viajam como { text, kind } desde a v2.48.0: o unwrap tem UM
// endereço (lib/format.js), senão cada consumidor reinventa e um deles esquece
import { reasonText, staleHeadText } from '../format.js';
import { TEMPOS } from '../constants.js';
import { checkpointPath, readCheckpoint, relevantEntries, summarizeCheckpoint, resumeBlock } from './verification-checkpoint.js';
import {
  blobMapFrom, sameEffectiveDiff, splitByProof, reconcileInheritedCoverage,
```

   Troque por:

```js
import { classify, resetAtFrom } from '../log-taxonomy.js';
// reasons/attention viajam como { text, kind } desde a v2.48.0: o unwrap tem UM
// endereço (lib/format.js), senão cada consumidor reinventa e um deles esquece
import { reasonText, staleHeadText, textoBloqueio } from '../format.js';
import { TEMPOS, SYNC } from '../constants.js';
import { checkpointPath, readCheckpoint, relevantEntries, summarizeCheckpoint, resumeBlock } from './verification-checkpoint.js';
import {
  blobMapFrom, sameEffectiveDiff, splitByProof, reconcileInheritedCoverage,
```

2. Localize:

```js
const gateReason = (text) => ({ text, kind: 'gate' });
// Motivo de INFRA: a postagem em si falhou (rede, gateway fora do ar).
const infraReason = (text) => ({ text, kind: 'infra' });

// Marcador de retry da postagem. Só nasce quando a falha é claramente transitória
// (mesma tabela de log-taxonomy.js, invariante 3); null pra todo o resto, porque
```

   Troque por:

```js
const gateReason = (text) => ({ text, kind: 'gate' });
// Motivo de INFRA: a postagem em si falhou (rede, gateway fora do ar).
const infraReason = (text) => ({ text, kind: 'infra' });
// Classe da taxonomia (lib/log-taxonomy.js) que o runOneHeadless NUNCA trata como
// transitória comum: coordenação entre dispositivos fora do ar volta pra fila sem
// retry e sem estacionar (D11 do contrato da sincronização).
const CLASSE_COORDENACAO = 'coordenacao-indisponivel';
// Desfechos que viram recibo de coordenação (D14): no nível do módulo porque os pontos
// de uso vivem em if aninhado, e o literal ali dentro estourava a profundidade do gate.
const RECIBO_PUBLICADO = Object.freeze({ publicationState: 'published' });
const RECIBO_EXTERNO = Object.freeze({ outcome: 'external_review', publicationState: 'published' });

// A fachada falta em engine de teste montado à mão; ausência vale como coordenação
// desligada, que é o que um engine sem sincronização é.
function seguraPelaCoordenacao(engine, key) {
  return typeof engine.syncSeguraAutomacao === 'function' && engine.syncSeguraAutomacao(key) === true;
}
function coordenacaoLigada(engine) {
  return typeof engine.syncCoordenacaoAtiva === 'function' && engine.syncCoordenacaoAtiva() === true;
}

// Contexto que o gate de runClaudeStream entrega ao coordenador ("Contratos dos
// chamadores" do contrato da sincronização). A versão material é o head que ESTA
// sessão leu: recibo e lease falam do mesmo commit em que o review vai ancorar.
//
// Os overrides do clique são CONSUMIDOS aqui: valem pra esta admissão e saem do objeto
// do PR, que é o mesmo que o retry guarda e que a fila recebe de volta. Sem isso, a
// retentativa automática de uma revisão confirmada "sem coordenação" também pularia a
// coordenação, horas depois e sem ninguém ter confirmado de novo.
//
// A marca do round automático (D13) é consumida pelo mesmo motivo: o teto compartilhado
// conta o round UMA vez, na admissão desta sessão. O retry transitório (prComRetomada
// copia o objeto), a fila de volta (tratarBloqueioDeCoordenacao e o catch do
// runOneHeadless empurram este objeto) e o clique que copia da fila herdariam a marca, e
// cada um reservaria outra rodada do dia pro mesmo round lógico. Admissão recusada antes
// da reserva (lease alheio, recibo, coordenação fora) deixa o round sem contar: é o lado
// seguro, porque o teto existe pra conter gasto, e aqui nenhuma sessão rodou.
function contextoCoordenacao(engine, pr, headSha) {
  const semCoordenacao = !!pr.semCoordenacao;
  const ignorarRecibo = !!pr.ignorarRecibo;
  const contaRodada = !!pr.rodadaAutomatica;
  pr.semCoordenacao = false;
  pr.ignorarRecibo = false;
  pr.rodadaAutomatica = false;
  return {
    prKey: pr.key, account: engine.accountForPr(pr), materialVersion: headSha, headSha,
    contaRodada, manual: !!pr.manual, semCoordenacao, ignorarRecibo,
    pr: { key: pr.key, url: pr.url, repo: pr.repo, number: pr.number, author: pr.author, account: pr.account },
  };
}

// D11: bloqueio da coordenação entre aparelhos é ESPERA, nunca falha. O PR volta pra
// fila visível com a espera anotada (o toReview pula a key enquanto ela vale), sem
// estacionar e sem entrar no retry. Recibo é a exceção: o coordenador já marcou o PR
// como visto, porque a análise deste commit terminou em outro lugar, e devolvê-lo à
// fila só faria o próximo ciclo ouvir a mesma recusa.
function tratarBloqueioDeCoordenacao(engine, pr, admissao) {
  const adm = admissao || {};
  if (adm.reason !== 'recibo') {
    engine.unsee(pr.key);
    if (!engine.queue.some(p => p.key === pr.key)) engine.queue.push(pr);
    engine.syncRegistrarEspera(pr.key, adm);
  }
  engine.emit('toast', { kind: 'info', text: textoBloqueio(pr.key, adm) });
}

// Recibo DEPOIS do estado local (D14). Falha ao gravar não desfaz o desfecho: o review
// já saiu ou a pendência já está na mesa, e o pior caso é outro aparelho refazer este
// commit (o preflight dele acha o review meu no GitHub). Nunca lança pelo mesmo motivo:
// exceção aqui estacionaria um PR que foi revisado.
async function concluirCoordenacao(engine, pr, coord, opcoes) {
  if (!coord) return;
  try {
    const r = await coord.complete({ ...opcoes });
    if (r && r.ok === false) engine.log('WARN', `${pr.key}: recibo de coordenação entre dispositivos não gravado: ${r.motivo || r.code}`);
  } catch (err) {
    engine.log('WARN', `${pr.key}: recibo de coordenação entre dispositivos não gravado: ${err.message}`);
  }
}

// Com a coordenação ligada a label entra só depois da admissão (opts.onAdmitted), então
// uma recusa só encontra label nossa no PR quando a retomada recusada abriu uma SEGUNDA
// admissão. Se ela ouviu "alheio", a label no PR é do outro aparelho só quando ele está
// numa revisão (mesma conta, mesmo nome); lease de pushback ou de autoanálise não põe
// label, e preservar a nossa a deixaria presa. Tipo desconhecido fica do lado de
// preservar: quem lê label alheia já a caduca (labelVistaDesde), e apagar o sinal de uma
// revisão viva faria os colegas revisarem por cima.
function labelEhDeOutraRevisao(admissao) {
  const a = admissao || {};
  if (a.reason !== 'alheio') return false;
  const kind = String((a.detail && a.detail.operationKind) || '');
  return kind === '' || kind === 'review';
}

// Sem desfecho, o lease volta pro banco (sem recibo). Best-effort pelo mesmo motivo do
// concluirCoordenacao: roda num finally, e exceção ali trocaria o desfecho real.
async function devolverLease(coord) {
  if (!coord || coord.done) return;
  try { await coord.abort(); } catch { /* lease que não sai agora expira sozinho pelo TTL */ }
}

// D14 vale até o POST, não só enquanto a sessão roda: o heartbeat segue batendo na fase
// pós-sessão (dedup, checks, head), e o cancelamento que ele dispara ali é inócuo
// porque a sessão já saiu de engine.running. Lease perdido quer dizer que outro aparelho
// pode ser o dono do PR agora, então nada sai no GitHub. O erro carrega a mesma marca
// da perda durante a sessão, e o runOneHeadless trata os dois do mesmo jeito: PR de
// volta pra fila, sem estacionar e sem retry. Chamado colado em cada postReview, porque
// entre a checagem e o POST não pode caber nenhum await.
function pararSeLeasePerdido(coord) {
  if (!coord || !coord.lost) return;
  throw Object.assign(new Error('lease de coordenação perdido antes de postar; nada foi postado'), { coordenacao: 'perdido' });
}

// A tentativa com --resume já reservou (e iniciou) a rodada do dia no teto
// compartilhado; a sessão nova que a substitui é a MESMA rodada, e contar de novo
// gastaria o teto em dobro por causa de uma retomada recusada.
function semNovaRodada(streamOpts) {
  if (!streamOpts.coordination) return streamOpts;
  return { ...streamOpts, coordination: { ...streamOpts.coordination, contaRodada: false } };
}

// Marcador de retry da postagem. Só nasce quando a falha é claramente transitória
// (mesma tabela de log-taxonomy.js, invariante 3); null pra todo o resto, porque
```

3. Localize:

```js
  return { key: `${m[1]}#${m[2]}`, url, title: '', author: '', repo: m[1], number: parseInt(m[2], 10) };
}

async function launchReview(engine, urls, mode = 'auto', origem = 'auto') {
  if (!urls || !urls.length) return { ok: false, error: 'sem PRs para revisar' };
  if (!engine.token) await engine.refreshTokens();
  // requested = o PR pediu a MINHA revisão (fila). Revisão iniciada por clique
```

   Troque por:

```js
  return { key: `${m[1]}#${m[2]}`, url, title: '', author: '', repo: m[1], number: parseInt(m[2], 10) };
}

// Overrides do clique manual (D12): cada um contorna UM motivo de bloqueio da
// coordenação entre aparelhos, e só ele. Lease de outro aparelho não aparece aqui de
// propósito: refazer ou forçar nunca toma uma execução que está rodando.
const OVERRIDE_DO_MOTIVO = Object.freeze({ indisponivel: 'semCoordenacao', recibo: 'ignorarRecibo' });

// Os dois overrides só nascem do clique confirmado. No caminho automático eles caem
// sempre, mesmo que tenham vazado pro objeto do PR (a fila recebe de volta o objeto que
// uma sessão manual segurou): automação com contorno pularia a coordenação em silêncio.
// Clique nunca é o round automático pós-push (D13): o objeto que ele copia da fila pode
// ter vindo de uma sessão que caiu antes da admissão, ainda com a marca, e o teto
// compartilhado barraria no spawn justamente o botão que o aviso de teto diz que vale.
function marcarOrigem(it, porClique, extras) {
  it.semCoordenacao = porClique && extras.semCoordenacao === true;
  it.ignorarRecibo = porClique && extras.ignorarRecibo === true;
  if (porClique) {
    it.manual = true;
    it.rodadaAutomatica = false;
  }
}

// Preflight do clique (só leitura, nunca reserva nem escreve): quem a coordenação
// seguraria volta pra tela decidir. O preflight roda de novo MESMO com o override,
// porque a situação pode ter mudado entre o aviso e a confirmação: sem bloqueio o
// override cai (a coordenação normal volta a valer), e bloqueio de outro motivo segue
// bloqueando. O gate no spawn roda depois e honra o que sobrou.
async function preflightDoClique(engine, itens) {
  const liberados = [];
  const coordenacao = [];
  for (const it of itens) {
    const r = (await engine.syncPreflightManual(it)) || {};
    const flag = r.ok ? '' : OVERRIDE_DO_MOTIVO[r.reason];
    const contorna = !!flag && it[flag] === true;
    it.semCoordenacao = contorna && flag === 'semCoordenacao';
    it.ignorarRecibo = contorna && flag === 'ignorarRecibo';
    if (r.ok || contorna) liberados.push(it);
    else coordenacao.push({ key: it.key, reason: r.reason, detail: r.detail });
  }
  return { liberados, coordenacao };
}

async function launchReview(engine, urls, mode = 'auto', origem = 'auto', extras = {}) {
  if (!urls || !urls.length) return { ok: false, error: 'sem PRs para revisar' };
  if (!engine.token) await engine.refreshTokens();
  // requested = o PR pediu a MINHA revisão (fila). Revisão iniciada por clique
```

4. Localize:

```js
  // o clique é marcado ANTES do gate de consciência logo abaixo: pr.manual é o
  // que faz o gate deixar passar sem consultar nada (quem mandou revisar foi você)
  const porClique = origem === 'clique';
  if (porClique) for (const it of prontos) it.manual = true;
  /* Gate de consciência do review automático (decisão do Wanderson, 28/08/2026 à
     tarde): head ativo com review decisivo de OUTRA pessoa deixa o caminho
     automático aguardando ação manual (ver bloqueadoPorHistorico em
```

   Troque por:

```js
  // o clique é marcado ANTES do gate de consciência logo abaixo: pr.manual é o
  // que faz o gate deixar passar sem consultar nada (quem mandou revisar foi você)
  const porClique = origem === 'clique';
  for (const it of prontos) marcarOrigem(it, porClique, extras || {});
  /* Gate de consciência do review automático (decisão do Wanderson, 28/08/2026 à
     tarde): head ativo com review decisivo de OUTRA pessoa deixa o caminho
     automático aguardando ação manual (ver bloqueadoPorHistorico em
```

5. Localize:

```js
     de propósito: o PR bloqueado fica exatamente onde estava, com o card visível
     e o botão Revisar valendo. Clique manual atravessa dentro do próprio
     bloqueiaAutomatico (pr.manual acima). */
  const liberados = [];
  for (const it of prontos) {
    if (await engine.bloqueiaAutomatico(it)) continue;
    liberados.push(it);
  }
  if (!liberados.length) return { ok: false, error: 'head ativo com review decisivo de outra pessoa: aguardando ação manual' };
  // lançar (manual ou auto) tira o PR do "estacionamento": ele volta a ser elegível.
  // A gravação fica FORA do laço (M2): dentro dele um lote de N PRs reescrevia o
  // arquivo inteiro N vezes, e as N-1 primeiras gravações são estado intermediário
```

   Troque por:

```js
     de propósito: o PR bloqueado fica exatamente onde estava, com o card visível
     e o botão Revisar valendo. Clique manual atravessa dentro do próprio
     bloqueiaAutomatico (pr.manual acima). */
  const conscientes = [];
  for (const it of prontos) {
    if (await engine.bloqueiaAutomatico(it)) continue;
    conscientes.push(it);
  }
  if (!conscientes.length) return { ok: false, error: 'head ativo com review decisivo de outra pessoa: aguardando ação manual' };
  // coordenação entre aparelhos no clique (D12): o bloqueado fica na fila, com o card
  // visível, e volta na resposta pra tela confirmar o override. Desligada, nada disto roda.
  const coordenaClique = porClique && coordenacaoLigada(engine);
  const { liberados, coordenacao } = coordenaClique ? await preflightDoClique(engine, conscientes) : { liberados: conscientes, coordenacao: [] };
  const seguradosPelaCoordenacao = coordenacao.length ? { coordenacao } : {};
  if (!liberados.length) return { ok: false, error: 'a coordenação entre aparelhos segurou a revisão: confirme na tela', ...seguradosPelaCoordenacao };
  // lançar (manual ou auto) tira o PR do "estacionamento": ele volta a ser elegível.
  // A gravação fica FORA do laço (M2): dentro dele um lote de N PRs reescrevia o
  // arquivo inteiro N vezes, e as N-1 primeiras gravações são estado intermediário
```

6. Localize:

```js
    // ser da mesma conta). Mistura de contas num mesmo terminal recai na 1a.
    engine.spawnConsole(`/pr-review ${liberados.map(p => p.url).join(' ')}`, label, keys, engine.accountForPr(liberados[0]));
    engine.emit('toast', { kind: 'ok', text: `${label} aberta no terminal do Claude.` });
    return { ok: true, mode };
  }

  for (const pr of liberados) engine.enqueueHeadless(pr);
```

   Troque por:

```js
    // ser da mesma conta). Mistura de contas num mesmo terminal recai na 1a.
    engine.spawnConsole(`/pr-review ${liberados.map(p => p.url).join(' ')}`, label, keys, engine.accountForPr(liberados[0]));
    engine.emit('toast', { kind: 'ok', text: `${label} aberta no terminal do Claude.` });
    return { ok: true, mode, ...seguradosPelaCoordenacao };
  }

  for (const pr of liberados) engine.enqueueHeadless(pr);
```

7. Localize:

```js
      ? `Revisando ${liberados[0].key} internamente. Te aviso do resultado.`
      : `Revisando ${liberados.length} PRs internamente (em paralelo por conta, serial dentro da conta).`
  });
  return { ok: true, mode };
}

// --- revisao autonoma (headless): contas em paralelo; dentro da mesma conta,
```

   Troque por:

```js
      ? `Revisando ${liberados[0].key} internamente. Te aviso do resultado.`
      : `Revisando ${liberados.length} PRs internamente (em paralelo por conta, serial dentro da conta).`
  });
  return { ok: true, mode, ...seguradosPelaCoordenacao };
}

// --- revisao autonoma (headless): contas em paralelo; dentro da mesma conta,
```

8. Localize:

```js
  }
}

async function runOneHeadless(engine, pr, acct) {
  // autoanalise: caminho separado, NUNCA posta nem gerencia a fila de revisor.
  // Erro so vira toast (o autor reroda quando quiser); nada volta pra fila.
```

   Troque por:

```js
  }
}

// Erro da autoanálise só vira toast: o autor reroda quando quiser, nada volta pra fila
// de revisor e nada estaciona. Fora do runOneHeadless porque três desfechos aninhados
// dentro do catch passavam do teto de profundidade do gate.
function falhaDaAutoanalise(engine, pr, err) {
  // o coordenador cancelou a sessão porque outro aparelho tomou o lease. A sessão chega
  // aqui com cancelled também, então este caso vem ANTES: sem ele a pessoa lia
  // "Autoanálise cancelada", como se tivesse cancelado, e sem saber que a análise não
  // ficou registrada em lugar nenhum.
  if (err.coordenacao === 'perdido') {
    engine.log('WARN', `autoanalise ${pr.key}: lease de coordenação perdido durante a sessão`);
    engine.emit('toast', { kind: 'info', text: `${pr.key}: outro aparelho assumiu a coordenação; a autoanálise foi encerrada sem registrar.` });
    return;
  }
  // cancelamento AUTOMÁTICO (commit novo durante a sessão) deixa o motivo aqui; sem ele
  // o texto seria o mesmo do botão Cancelar, e a pessoa leria "cancelada" sem ter
  // cancelado nada. Consumido uma vez, pra não repetir na sessão seguinte.
  if (err.cancelled) {
    const motivo = engine.selfCancelMotivo && engine.selfCancelMotivo.get(pr.key);
    if (motivo) engine.selfCancelMotivo.delete(pr.key);
    engine.emit('toast', { kind: 'info', text: motivo || `Autoanálise de ${pr.key} cancelada.` });
    return;
  }
  engine.log('ERROR', `autoanalise ${pr.key}: ${err.message}`);
  engine.emit('toast', { kind: 'error', text: `Autoanálise de ${pr.key} falhou: ${err.message}` });
}

async function runOneHeadless(engine, pr, acct) {
  // autoanalise: caminho separado, NUNCA posta nem gerencia a fila de revisor.
  // Erro so vira toast (o autor reroda quando quiser); nada volta pra fila.
```

9. Localize:

```js
    try {
      await engine.runSelfAnalysis(pr);
    } catch (err) {
      if (err.cancelled) {
        // cancelamento AUTOMÁTICO (commit novo durante a sessão) deixa o motivo aqui;
        // sem ele o texto seria o mesmo do botão Cancelar, e a pessoa leria "cancelada"
        // sem ter cancelado nada. Consumido uma vez, pra não repetir na sessão seguinte.
        const motivo = engine.selfCancelMotivo && engine.selfCancelMotivo.get(pr.key);
        if (motivo) engine.selfCancelMotivo.delete(pr.key);
        engine.emit('toast', { kind: 'info', text: motivo || `Autoanálise de ${pr.key} cancelada.` });
      } else {
        engine.log('ERROR', `autoanalise ${pr.key}: ${err.message}`);
        engine.emit('toast', { kind: 'error', text: `Autoanálise de ${pr.key} falhou: ${err.message}` });
      }
    } finally {
      engine.freeHeadlessSlot(acct);
      engine.writeInflight();
```

   Troque por:

```js
    try {
      await engine.runSelfAnalysis(pr);
    } catch (err) {
      falhaDaAutoanalise(engine, pr, err);
    } finally {
      engine.freeHeadlessSlot(acct);
      engine.writeInflight();
```

10. Localize:

```js
    const classe = classify(msg);
    const limitErr = classe.kind === 'espera-reset';
    const transient = limitErr || classe.kind === 'transitorio';
    if (err.cancelled) {
      // cancelado por você: estaciona pra não relançar sozinho (você reabre quando quiser).
      // O delete do retry é pelo mesmo motivo do ramo não-transitório lá embaixo (leia o
      // comentário do incidente de 04/08/2026): cancelar um PR que estava em retry e
```

   Troque por:

```js
    const classe = classify(msg);
    const limitErr = classe.kind === 'espera-reset';
    const transient = limitErr || classe.kind === 'transitorio';
    if (err.coordenacao) {
      // D14: o heartbeat perdeu o lease e o coordenador cancelou a sessão. Vem ANTES do
      // ramo de cancelamento de propósito (a sessão chega aqui com cancelled também):
      // quem cancelou foi a coordenação, não você, então nada estaciona, nada entra no
      // retry e nada foi postado. O PR já voltou pra fila no topo deste catch.
      // a entrada de retry que já existia sai junto, pelo mesmo motivo do ramo de
      // cancelamento: deixá-la viva faria o próprio check() relançar no ciclo seguinte
      // um PR que a coordenação acabou de tirar deste aparelho
      engine.retryAfterNet.delete(pr.key);
      engine.log('WARN', `revisao ${pr.key}: lease de coordenação perdido durante a sessão; nada foi postado`);
      engine.emit('toast', { kind: 'info', text: `${pr.key}: outro aparelho assumiu a coordenação; esta sessão foi encerrada sem postar.` });
    } else if (classe.id === CLASSE_COORDENACAO) {
      // D11 da sincronização: a classe é 'transitorio' para o Diagnóstico ler certo,
      // mas aqui ela NÃO segue o ramo transitório. Retry com teto terminaria em
      // estacionamento, e coordenação fora do ar não é defeito do PR: o PR já voltou
      // pra fila (unsee + queue.push acima) e quem segura o relançamento é o gate de
      // coordenação, que pula a automação enquanto a conexão não volta.
      engine.log('WARN', `revisao ${pr.key} (coordenação indisponível, volta pra fila sem estacionar): ${msg}`);
      engine.emit('toast', { kind: 'info', text: `${pr.key}: coordenação entre aparelhos indisponível; o PR voltou pra sua fila.` });
    } else if (err.cancelled) {
      // cancelado por você: estaciona pra não relançar sozinho (você reabre quando quiser).
      // O delete do retry é pelo mesmo motivo do ramo não-transitório lá embaixo (leia o
      // comentário do incidente de 04/08/2026): cancelar um PR que estava em retry e
```

11. Localize:

```js
    // sessão NOVA: o bloco de retomada fica de fora. Ele manda não reler o que já
    // foi lido, e numa sessão que nasce agora isso seria instrução pra pular
    // leitura que ninguém fez.
    return engine.runClaudeStream(promptFinal, streamOpts);
  }
}

```

   Troque por:

```js
    // sessão NOVA: o bloco de retomada fica de fora. Ele manda não reler o que já
    // foi lido, e numa sessão que nasce agora isso seria instrução pra pular
    // leitura que ninguém fez.
    return engine.runClaudeStream(promptFinal, semNovaRodada(streamOpts));
  }
}

```

12. Localize:

```js
  // Declarada FORA do try pra remoção no finally; atribuída DENTRO pra falha
  // inesperada nunca vazar a sessão registrada acima.
  let labelEmAndamento = '';
  try {
    labelEmAndamento = await addInProgressLabel(engine, pr);
    // prova por arquivo: o diff efetivo atual (blob SHA por arquivo) e a prova da
    // última leitura completa. Qualquer falha aqui degrada pra revisão cheia de
    // sempre, que é sempre segura (falta de dado nunca vira herança).
```

   Troque por:

```js
  // Declarada FORA do try pra remoção no finally; atribuída DENTRO pra falha
  // inesperada nunca vazar a sessão registrada acima.
  let labelEmAndamento = '';
  // handle da coordenação entre aparelhos (null com ela desligada): cada desfecho grava
  // o recibo e o finally devolve o lease do que não chegou a desfecho
  let coord = null;
  // o recibo da pendência diz se ela nasceu de uma postagem que falhou
  let postFalhou = false;
  // Com a coordenação ligada a label entra na admissão, não aqui: antes dela seria escrita
  // pública no GitHub sem sessão nenhuma a cada recusa (a espera de 'indisponivel' é de
  // segundos) e, com lease alheio, uma label que ninguém tira. O runClaudeStream chama
  // isto entre a admissão e o spawn; de novo numa segunda admissão (retomada recusada),
  // e o gh trata o add repetido como no-op.
  const porLabelNaAdmissao = async () => { labelEmAndamento = await addInProgressLabel(engine, pr); };
  // Desfecho com lease: a label sai ANTES do recibo, porque complete() solta o lease, e um
  // aparelho que assumisse o head novo no intervalo teria a label dele (mesmo nome) apagada
  // pela remoção atrasada do finally. Sem coordenação o finally segue tirando a label.
  const fecharDesfecho = async (opcoes) => {
    if (coord) {
      const label = labelEmAndamento;
      labelEmAndamento = '';
      await removeInProgressLabel(engine, pr, label);
    }
    await concluirCoordenacao(engine, pr, coord, opcoes);
  };
  try {
    if (!coordenacaoLigada(engine)) labelEmAndamento = await addInProgressLabel(engine, pr);
    // prova por arquivo: o diff efetivo atual (blob SHA por arquivo) e a prova da
    // última leitura completa. Qualquer falha aqui degrada pra revisão cheia de
    // sempre, que é sempre segura (falta de dado nunca vira herança).
```

13. Localize:

```js
      // a etapa é estampada AQUI, na entrada do feed: a esteira ao vivo da UI e o
      // resumo final (stageSummaryFrom) leem a mesma estampa, nunca reclassificam
      onEvent: (e) => engine.pushActivity(id, e.kind, e.text, e.agent,
        stageOfLine({ k: e.kind, text: e.text, a: e.agent }))
    };
    // o sid da retomada já foi escolhido acima (sidDeRetomada), junto do bloco de
    // prompt que ele implica. Falha de retomada degrada pra sessão nova, nunca pra erro.
    const res = await rodarSessao(engine, promptFinal, streamOpts, retomada.sid, retomada.aposFalha, blocoRetomada);
    const result = lerResultadoDaRevisao(engine, res);
    result.sessionId = res.sessionId || null;
    // tempo por etapa: calculado AGORA, porque o finally apaga o feed junto com a
```

   Troque por:

```js
      // a etapa é estampada AQUI, na entrada do feed: a esteira ao vivo da UI e o
      // resumo final (stageSummaryFrom) leem a mesma estampa, nunca reclassificam
      onEvent: (e) => engine.pushActivity(id, e.kind, e.text, e.agent,
        stageOfLine({ k: e.kind, text: e.text, a: e.agent })),
      // gate da coordenação entre aparelhos (runClaudeStream): tipo fechado + contexto
      operationKind: 'review',
      coordination: contextoCoordenacao(engine, pr, headShaAtual),
      onAdmitted: porLabelNaAdmissao,
    };
    // o sid da retomada já foi escolhido acima (sidDeRetomada), junto do bloco de
    // prompt que ele implica. Falha de retomada degrada pra sessão nova, nunca pra erro.
    const res = await rodarSessao(engine, promptFinal, streamOpts, retomada.sid, retomada.aposFalha, blocoRetomada);
    if (res.blocked) {
      if (labelEhDeOutraRevisao(res.coordination)) labelEmAndamento = '';
      return tratarBloqueioDeCoordenacao(engine, pr, res.coordination);
    }
    coord = res.coordination || null;
    const result = lerResultadoDaRevisao(engine, res);
    result.sessionId = res.sessionId || null;
    // tempo por etapa: calculado AGORA, porque o finally apaga o feed junto com a
```

14. Localize:

```js
      const states = await engine.myReviewStates(pr, headShaAtual);
      if (states && states.includes('APPROVED')) {
        engine.recordDecision(pr, result, { status: 'already_reviewed', action: 'approve' });
        engine.emit('toast', { kind: 'info', text: `${pr.key}: você já tinha aprovado no GitHub; não postei de novo.` });
        return;
      }
```

   Troque por:

```js
      const states = await engine.myReviewStates(pr, headShaAtual);
      if (states && states.includes('APPROVED')) {
        engine.recordDecision(pr, result, { status: 'already_reviewed', action: 'approve' });
        await fecharDesfecho(RECIBO_EXTERNO);
        engine.emit('toast', { kind: 'info', text: `${pr.key}: você já tinha aprovado no GitHub; não postei de novo.` });
        return;
      }
```

15. Localize:

```js
      const points = engine.attentionPoints(result);
      // G1: ancora o review no head que ESTA sessão leu (headShaAtual vem do
      // início da revisão); vazio = omite e o comportamento antigo vale
      const post = await engine.postReview(pr, { ...result.payloads.approve, commit_id: headShaAtual });
      if (post.ok) {
        // a memória recebe o item gravado (pr da fila), não o envelope cru: o
```

   Troque por:

```js
      const points = engine.attentionPoints(result);
      // G1: ancora o review no head que ESTA sessão leu (headShaAtual vem do
      // início da revisão); vazio = omite e o comportamento antigo vale
      pararSeLeasePerdido(coord);
      const post = await engine.postReview(pr, { ...result.payloads.approve, commit_id: headShaAtual });
      if (post.ok) {
        // a memória recebe o item gravado (pr da fila), não o envelope cru: o
```

16. Localize:

```js
        const publicItem = engine.decisionForUi(item);
        const publicPoints = publicItem.attention || [];
        engine.writeMemory(item, 'APPROVE');
        // points viaja no evento pro alerta distinguir os desfechos (sem ressalvas x com ressalvas)
        engine.emit('auto-approved', { pr, result: publicItem, points: publicPoints });
        engine.emit('toast', {
```

   Troque por:

```js
        const publicItem = engine.decisionForUi(item);
        const publicPoints = publicItem.attention || [];
        engine.writeMemory(item, 'APPROVE');
        await fecharDesfecho(RECIBO_PUBLICADO);
        // points viaja no evento pro alerta distinguir os desfechos (sem ressalvas x com ressalvas)
        engine.emit('auto-approved', { pr, result: publicItem, points: publicPoints });
        engine.emit('toast', {
```

17. Localize:

```js
        return;
      }
      result.reasons = [...(result.reasons || []), infraReason(`falha ao postar o APPROVE: ${post.error}`)];
      // falha claramente transitória (rede, gateway do GitHub fora do ar):
      // marca pro retryFailedPosts tentar de novo sozinho nos próximos ciclos,
      // reusando o payload já pronto, sem reabrir sessão. Mesma tabela de
```

   Troque por:

```js
        return;
      }
      result.reasons = [...(result.reasons || []), infraReason(`falha ao postar o APPROVE: ${post.error}`)];
      postFalhou = true;
      // falha claramente transitória (rede, gateway do GitHub fora do ar):
      // marca pro retryFailedPosts tentar de novo sozinho nos próximos ciclos,
      // reusando o payload já pronto, sem reabrir sessão. Mesma tabela de
```

18. Localize:

```js
      const states = await engine.myReviewStates(pr, headShaAtual);
      if (states && states.includes('CHANGES_REQUESTED')) {
        engine.recordDecision(pr, result, { status: 'already_reviewed', action: 'request_changes' });
        engine.emit('toast', { kind: 'info', text: `${pr.key}: você já tinha pedido mudanças no GitHub; não postei de novo.` });
        return;
      }
      const rc = { ...result.payloads.request_changes, body: engine.rejectBodyWithMark(result.payloads.request_changes.body), commit_id: headShaAtual };
      const post = await engine.postReview(pr, rc);
      if (post.ok) {
        // mesma regra do approve: memória atribuída pelo item, nunca pelo envelope (M6)
        const item = engine.recordDecision(pr, result, { status: 'auto_rejected', action: 'request_changes' });
        const publicItem = engine.decisionForUi(item);
        engine.writeMemory(item, 'REQUEST_CHANGES');
        engine.emit('auto-rejected', { pr, result: publicItem });
        engine.emit('toast', { kind: 'ok', text: `🔴 ${pr.key} reprovado (mudanças pedidas): ${reasonText((publicItem.reasons || [])[0]) || 'ver relatório'}` });
        return;
      }
      result.reasons = [...(result.reasons || []), infraReason(`falha ao postar o REQUEST_CHANGES: ${post.error}`)];
      result.postRetry = postRetryFor('request_changes', post.error);
    }
    // transparência: o gate disse POR QUE não auto-postou (autoDec.motivo). Só
```

   Troque por:

```js
      const states = await engine.myReviewStates(pr, headShaAtual);
      if (states && states.includes('CHANGES_REQUESTED')) {
        engine.recordDecision(pr, result, { status: 'already_reviewed', action: 'request_changes' });
        await fecharDesfecho(RECIBO_EXTERNO);
        engine.emit('toast', { kind: 'info', text: `${pr.key}: você já tinha pedido mudanças no GitHub; não postei de novo.` });
        return;
      }
      const rc = { ...result.payloads.request_changes, body: engine.rejectBodyWithMark(result.payloads.request_changes.body), commit_id: headShaAtual };
      pararSeLeasePerdido(coord);
      const post = await engine.postReview(pr, rc);
      if (post.ok) {
        // mesma regra do approve: memória atribuída pelo item, nunca pelo envelope (M6)
        const item = engine.recordDecision(pr, result, { status: 'auto_rejected', action: 'request_changes' });
        const publicItem = engine.decisionForUi(item);
        engine.writeMemory(item, 'REQUEST_CHANGES');
        await fecharDesfecho(RECIBO_PUBLICADO);
        engine.emit('auto-rejected', { pr, result: publicItem });
        engine.emit('toast', { kind: 'ok', text: `🔴 ${pr.key} reprovado (mudanças pedidas): ${reasonText((publicItem.reasons || [])[0]) || 'ver relatório'}` });
        return;
      }
      result.reasons = [...(result.reasons || []), infraReason(`falha ao postar o REQUEST_CHANGES: ${post.error}`)];
      postFalhou = true;
      result.postRetry = postRetryFor('request_changes', post.error);
    }
    // transparência: o gate disse POR QUE não auto-postou (autoDec.motivo). Só
```

19. Localize:

```js
      status: 'pending',
      ...(staleHeadNovo ? { blockedKind: 'stale_head', blockedHead: staleHeadNovo } : {})
    });
    const publicItem = engine.decisionForUi(item);
    engine.emit('needs-decision', { pr, item: publicItem });
    // o alerta lidera com o MOTIVO (transparência), não com uma contagem
    const extra = (publicItem.reasons || []).length > 1 ? ` (+${publicItem.reasons.length - 1})` : '';
    engine.emit('toast', { kind: 'info', text: `🟡 ${pr.key} precisa da sua atenção: ${reasonText((publicItem.reasons || [])[0]) || 'ver relatório'}${extra}` });
  } finally {
    await removeInProgressLabel(engine, pr, labelEmAndamento);
    engine.activeReviews.delete(id);
    engine.activity.delete(id);
    engine.writeInflight();
```

   Troque por:

```js
      status: 'pending',
      ...(staleHeadNovo ? { blockedKind: 'stale_head', blockedHead: staleHeadNovo } : {})
    });
    await fecharDesfecho({ publicationState: postFalhou ? 'failed' : 'pending' });
    const publicItem = engine.decisionForUi(item);
    engine.emit('needs-decision', { pr, item: publicItem });
    // o alerta lidera com o MOTIVO (transparência), não com uma contagem
    const extra = (publicItem.reasons || []).length > 1 ? ` (+${publicItem.reasons.length - 1})` : '';
    engine.emit('toast', { kind: 'info', text: `🟡 ${pr.key} precisa da sua atenção: ${reasonText((publicItem.reasons || [])[0]) || 'ver relatório'}${extra}` });
  } catch (err) {
    // lease perdido no meio (D14): outro aparelho assumiu este PR com a mesma conta, e a
    // label de revisando passou a ser dele; tirá-la aqui apagaria o sinal dessa revisão
    if (err && err.coordenacao) labelEmAndamento = '';
    throw err;
  } finally {
    // label antes do lease: com o lease devolvido primeiro, outro aparelho poderia
    // assumir e pôr a label dele, que esta remoção apagaria. Os desfechos já tiraram a
    // label no fecharDesfecho (labelEmAndamento volta vazio); aqui chega o que não teve
    // desfecho, e sem coordenação, tudo.
    await removeInProgressLabel(engine, pr, labelEmAndamento);
    await devolverLease(coord);
    engine.activeReviews.delete(id);
    engine.activity.delete(id);
    engine.writeInflight();
```

20. Localize:

```js
      // revisar (o enqueueHeadless barraria de qualquer jeito; aqui é pra não
      // ficar repescando em silêncio a cada ciclo)
      !(engine.skipComentado || {})[pr.key] &&
      !engine.budgetBlockedFor(engine.accountForPr(pr)));
}

```

   Troque por:

```js
      // revisar (o enqueueHeadless barraria de qualquer jeito; aqui é pra não
      // ficar repescando em silêncio a cada ciclo)
      !(engine.skipComentado || {})[pr.key] &&
      // coordenação entre aparelhos segurando (conexão fora, ou espera anotada): o
      // retry espera com o resto das automações, sem gastar tentativa (D11)
      !seguraPelaCoordenacao(engine, pr.key) &&
      !engine.budgetBlockedFor(engine.accountForPr(pr)));
}

```

21. Localize:

```js
// Teto de rodadas AUTOMÁTICAS por PR por dia. É proteção de orçamento dentro do
// modo autônomo (mesma família do teto por perfil), nunca redução de autonomia:
// estourou, o motivo diz isso e o botão Re-revisar continua valendo.
const MAX_RODADAS_AUTO_DIA = 3;

// Dia local (Brasília na prática) em YYYY-MM-DD, pro teto diário da âncora.
function diaLocal(agora = Date.now()) {
```

   Troque por:

```js
// Teto de rodadas AUTOMÁTICAS por PR por dia. É proteção de orçamento dentro do
// modo autônomo (mesma família do teto por perfil), nunca redução de autonomia:
// estourou, o motivo diz isso e o botão Re-revisar continua valendo.
// O número mora em SYNC.DAILY_ROUNDS_MAX (D13): o mesmo teto vale aqui, na âncora
// local, e no teto compartilhado entre aparelhos, e dois números divergiriam.
const MAX_RODADAS_AUTO_DIA = SYNC.DAILY_ROUNDS_MAX;

// Dia local (Brasília na prática) em YYYY-MM-DD, pro teto diário da âncora.
function diaLocal(agora = Date.now()) {
```

22. Localize:

```js
  if (engine.budgetBlockedFor(acct)) return null;
  if (engine.outrosRevisando(pr).length) return null;
  if ((engine.skipComentado || {})[pr.key]) return null;
  // teto diário por último: tudo acima liberou, só o orçamento de rodadas segura,
  // e isso merece aviso (reReviewEsgotados) em vez de silêncio
  if (ancora.dia === diaLocal(agora) && ancora.rodadas >= MAX_RODADAS_AUTO_DIA) return 'esgotado';
```

   Troque por:

```js
  if (engine.budgetBlockedFor(acct)) return null;
  if (engine.outrosRevisando(pr).length) return null;
  if ((engine.skipComentado || {})[pr.key]) return null;
  if (seguraPelaCoordenacao(engine, pr.key)) return null;
  // teto diário por último: tudo acima liberou, só o orçamento de rodadas segura,
  // e isso merece aviso (reReviewEsgotados) em vez de silêncio
  if (ancora.dia === diaLocal(agora) && ancora.rodadas >= MAX_RODADAS_AUTO_DIA) return 'esgotado';
```

23. Localize:

```js
  // conta, card, contestação, cobertura) e do dedup por head, como qualquer revisão.
  for (const pr of relancar) engine.enqueueHeadless({
    ...pr, account: engine.accountForPr(pr), requested: true,
    // G8: o gate SÓ arma com head conhecido; carregá-lo evita que um flake de gh
    // no início da sessão degrade o dedup pro comportamento antigo e mate o round
    // 2 como already_reviewed com a âncora já queimada. _headRound cobre os DOIS
```

   Troque por:

```js
  // conta, card, contestação, cobertura) e do dedup por head, como qualquer revisão.
  for (const pr of relancar) engine.enqueueHeadless({
    ...pr, account: engine.accountForPr(pr), requested: true,
    // D13: só o round automático pós-push conta no teto compartilhado entre aparelhos
    rodadaAutomatica: true,
    // G8: o gate SÓ arma com head conhecido; carregá-lo evita que um flake de gh
    // no início da sessão degrade o dedup pro comportamento antigo e mate o round
    // 2 como already_reviewed com a âncora já queimada. _headRound cobre os DOIS
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('lib/engine/review.js')).digest('hex').slice(0,16))"
```

Esperado: `9d922b6e02eec4e9`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

- [ ] **Passo 4: rodar e ver passar**

```bash
node --test --test-force-exit test/sync-review.test.js test/sync-coordenacao-nao-estaciona.test.js
```

Esperado: PASSA, 0 falhas.

- [ ] **Passo 5: gate e commit**

```bash
npm run check && npm run lint && npm test
```

Esperado: `fail 0` e `gate de qualidade: sem regressão`. Se algo falhar, PARE e relate; não mexa em outro arquivo para fazer passar.

```bash
git add lib/engine/review.js test/sync-coordenacao-nao-estaciona.test.js test/sync-review.test.js
git commit -m "feat(sync): revisão headless pede admissão e grava recibo no fim"
```


### Tarefa T21: Autoanálise, chat e ferramentas sob coordenação

Autoanálise, chat e ferramentas passam pela MESMA boca. Coordenação que vale só na revisão deixaria três caminhos gastando sessão em cima do que outro aparelho já fez.

**Arquivos:**
- Modificar: `lib/engine/chat.js`
- Modificar: `lib/engine/selfpr.js`
- Modificar: `lib/engine/tools.js`
- Criar: `test/sync-callers.test.js`

- [ ] **Passo 1: escrever o teste**

Crie `test/sync-callers.test.js` com EXATAMENTE este conteúdo:

```js
// Os outros chamadores de runClaudeStream com a coordenação entre aparelhos ligada
// (seção "Contratos dos chamadores" do contrato da sincronização):
//   - autoanálise ('self'): bloqueio vira toast e NÃO grava registro; desfecho grava o
//     recibo not_applicable depois de salvar; análise descartada (head andou) e sessão
//     sem desfecho devolvem o lease;
//   - pushback ('pushback'): o marcador é a versão material; recibo de outro aparelho
//     vira { deduped } e o scan avança o marcador sem gastar sessão;
//   - chat e ferramenta declaram o tipo ('chat'/'tool'), que o gate deixa passar sem
//     coordenar (allowlist fechada: sem o tipo, a sessão seria recusada).
//
// Engine real com FAROL_HOME temporário (server.js alcança lib/paths.js, então await
// import); gh roteado por io.run e sessão stubada na instância, como em
// test/self-analysis-evidencia.test.js e test/reentrancy.test.js.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-sync-callers-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const io = (await import('../lib/io.js')).default;
const runReal = io.run;
let heads = [];
io.run = async (cmd, args) => {
  const sub = (args || []).join(' ');
  if (sub.includes('headRefOid')) return { ok: true, stdout: heads.length > 1 ? heads.shift() : (heads[0] || ''), stderr: '' };
  if (sub.includes('/files')) return { ok: true, stdout: '[]', stderr: '' };
  return { ok: true, stdout: '', stderr: '' };
};

const { Engine } = await import('../server.js');
const { textoBloqueio } = await import('../lib/format.js');

after(() => {
  io.run = runReal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});

const SHA = 'a'.repeat(40);
const OUTRO = 'b'.repeat(40);
beforeEach(() => { heads = [SHA]; });

const PR = { key: 'acme/app#42', repo: 'acme/app', number: 42, url: 'https://github.com/acme/app/pull/42', title: 'PR meu', author: 'eu', headSha: SHA };
const ENVELOPE = JSON.stringify({
  verdict: 'approvable', approvable: true, cardMet: true,
  blockers: [], tips: [], coverageLimitations: [], reportMarkdown: '# ok', summary: 'ok',
});

function handleFalso() {
  const h = { noop: false, leaseId: 'L1', attemptId: '', lost: false, done: false, completos: [], abortos: 0 };
  h.onLost = () => { };
  h.complete = async (op) => { h.completos.push(op); h.done = true; return { ok: true }; };
  h.abort = async () => { h.abortos++; h.done = true; };
  return h;
}

function motor(resposta) {
  const e = new Engine();
  e.token = 'x';
  e.tokens = { eu: 'x' };
  e.config.accounts = [{ user: 'eu', owners: ['acme'] }];
  e.pushState = () => { };
  e.refreshTokens = async () => { };
  e.log = () => { };
  e.salvos = 0;
  e.saveSelfAnalyses = () => { e.salvos++; };
  e.toasts = [];
  e.on('toast', (t) => e.toasts.push(t));
  e.opts = [];
  e.runClaudeStream = async (prompt, opts) => { e.opts.push(opts); return typeof resposta === 'function' ? resposta(opts) : resposta; };
  return e;
}

const bloqueio = (reason, detail = {}) => ({ blocked: true, coordination: { admitted: false, reason, detail }, text: '', sessionId: null });

/* ---------- autoanálise ---------- */

test('autoanálise manda operationKind self e o head lido como versão material', async () => {
  const e = motor(bloqueio('alheio'));
  await e.runSelfAnalysis({ ...PR });
  const op = e.opts[0];
  assert.equal(op.operationKind, 'self');
  assert.deepEqual(op.coordination, {
    prKey: PR.key, account: 'eu', materialVersion: SHA, headSha: SHA, contaRodada: false, manual: true,
    semCoordenacao: false, ignorarRecibo: false,
    pr: { key: PR.key, url: PR.url, repo: PR.repo, number: PR.number, author: PR.author, account: 'eu' },
  });
});

test('autoanálise bloqueada: toast com o motivo e nenhum registro gravado', async () => {
  const adm = { admitted: false, reason: 'recibo', detail: { deviceName: 'notebook' } };
  const e = motor({ blocked: true, coordination: adm, text: '', sessionId: null });
  await e.runSelfAnalysis({ ...PR });
  assert.equal(e.selfAnalyses[PR.key], undefined, 'bloqueio não vira análise');
  assert.equal(e.salvos, 0);
  assert.ok(e.toasts.some((t) => t.kind === 'info' && t.text === textoBloqueio(PR.key, adm)));
  assert.equal(e.activeReviews.size, 0, 'a sessão some da tela');
});

test('autoanálise concluída grava o recibo not_applicable depois de salvar o registro', async () => {
  const h = handleFalso();
  const e = motor({ text: ENVELOPE, sessionId: 's1', coordination: h });
  const ordem = [];
  e.saveSelfAnalyses = () => { ordem.push('salvou'); };
  const complete = h.complete;
  h.complete = async (op) => { ordem.push('recibo'); return complete(op); };
  await e.runSelfAnalysis({ ...PR });
  assert.ok(e.selfAnalyses[PR.key], 'registro gravado');
  assert.deepEqual(h.completos, [{ publicationState: 'not_applicable' }]);
  assert.deepEqual(ordem, ['salvou', 'recibo']);
  assert.equal(h.abortos, 0);
});

test('autoanálise descartada (head andou) devolve o lease sem recibo', async () => {
  heads = [SHA, OUTRO];
  const h = handleFalso();
  const e = motor({ text: ENVELOPE, sessionId: 's1', coordination: h });
  await e.runSelfAnalysis({ ...PR });
  assert.equal(e.selfAnalyses[PR.key], undefined);
  assert.equal(h.completos.length, 0);
  assert.equal(h.abortos, 1);
});

test('autoanálise sem envelope válido devolve o lease no finally', async () => {
  const h = handleFalso();
  const e = motor({ text: 'prosa sem objeto nenhum', sessionId: 's1', coordination: h });
  await assert.rejects(e.runSelfAnalysis({ ...PR }));
  assert.equal(h.completos.length, 0);
  assert.equal(h.abortos, 1);
});

/* ---------- pushback ---------- */

const PB_OK = JSON.stringify({ isPushback: true, outcome: 'we_right', confidence: 'high', note: 'x' });

test('classifyPushback manda operationKind pushback com o marcador como versão material', async () => {
  const h = handleFalso();
  const e = motor({ text: PB_OK, sessionId: 's1', coordination: h });
  const pr = { key: 'o/r#2', repo: 'o/r', number: 2, url: 'https://github.com/o/r/pull/2', author: 'alice', account: 'eu' };
  const cls = await e.classifyPushback(pr, '2026-09-01T10:00:00Z');
  assert.equal(cls.outcome, 'we_right');
  const op = e.opts[0];
  assert.equal(op.operationKind, 'pushback');
  assert.equal(op.coordination.materialVersion, '2026-09-01T10:00:00Z');
  assert.equal(op.coordination.headSha, '');
  assert.equal(op.coordination.manual, false);
  assert.equal(op.coordination.contaRodada, false);
  assert.equal(op.coordination.prKey, 'o/r#2');
  // D14: o recibo não sai aqui. A classificação devolve o handle e quem o fecha é o
  // scanPushbacks, depois de gravar o marcador e o pushback no disco deste aparelho.
  assert.deepEqual(h.completos, [], 'o recibo é a última escrita, não a primeira');
  assert.equal(cls.coord, h, 'o handle volta para quem persiste o estado local');
});

// D14 na ordem completa: sem ela, um processo morto entre o recibo e o save local
// deixava o recibo de pé e o registro ausente, e o ciclo seguinte via a classificação
// deduplicada, avançava o marcador e perdia o pushback para sempre.
test('scanPushbacks grava o recibo do pushback DEPOIS do marcador e do registro local', async () => {
  const e = motor(null);
  e.decisions = { pending: [], resolved: [{ key: 'o/r#5', status: 'auto_rejected', action: 'request_changes', reasons: ['quebra'], resolvedAt: 1 }] };
  e.panorama = [{ key: 'o/r#5', updatedAt: '2026-09-01T12:00:00Z', author: 'alice' }];
  e.pushbackScanned = {};
  e.pushbacks = {};
  e.config.autoPushback = true;
  e.isMuted = () => false;
  e.accountForPr = () => 'eu';
  const ordem = [];
  const h = handleFalso();
  const completeReal = h.complete.bind(h);
  h.complete = async (o) => { ordem.push('recibo'); return completeReal(o); };
  e.savePushbackScanned = () => ordem.push('marcador');
  e.savePushbacks = () => ordem.push('pushback');
  e.detectAuthorPushback = async () => ({ marker: '2026-09-01T11:00:00Z', hadActivity: true });
  e.classifyPushback = async () => ({ isPushback: true, outcome: 'we_right', confidence: 'high', note: 'x', coord: h });
  await e.scanPushbacks();
  assert.deepEqual(ordem, ['marcador', 'pushback', 'recibo'], 'o recibo é a ÚLTIMA escrita');
  assert.deepEqual(h.completos, [{ publicationState: 'not_applicable' }]);
  assert.equal(e.pushbacks['o/r#5'].outcome, 'we_right');
});

test('classifyPushback: recibo de outro aparelho vira deduped; outro bloqueio vira null', async () => {
  const pr = { key: 'o/r#3', url: 'https://github.com/o/r/pull/3', author: 'alice' };
  assert.deepEqual(await motor(bloqueio('recibo')).classifyPushback(pr, 'm'), { deduped: true });
  assert.equal(await motor(bloqueio('alheio')).classifyPushback(pr, 'm'), null);
  assert.equal(await motor(bloqueio('indisponivel')).classifyPushback(pr, 'm'), null);
});

test('classifyPushback sem JSON devolve null e o lease', async () => {
  const h = handleFalso();
  const e = motor({ text: 'nada aqui', sessionId: 's1', coordination: h });
  assert.equal(await e.classifyPushback({ key: 'o/r#4', url: 'u', author: 'a' }, 'm'), null);
  assert.equal(h.completos.length, 0);
  assert.equal(h.abortos, 1);
});

test('scanPushbacks: classificação deduplicada avança o marcador sem gravar pushback', async () => {
  const e = motor(null);
  e.decisions = { pending: [], resolved: [{ key: 'o/r#2', status: 'auto_rejected', action: 'request_changes', reasons: ['quebra'], resolvedAt: 1 }] };
  e.panorama = [{ key: 'o/r#2', updatedAt: '2026-09-01T12:00:00Z', author: 'alice' }];
  e.pushbackScanned = {};
  e.pushbacks = {};
  e.config.autoPushback = true;
  e.isMuted = () => false;
  e.accountForPr = () => 'eu';
  let salvosMarcador = 0;
  e.savePushbackScanned = () => { salvosMarcador++; };
  e.savePushbacks = () => { throw new Error('deduplicado não grava pushback'); };
  e.detectAuthorPushback = async () => ({ marker: '2026-09-01T11:00:00Z', hadActivity: true });
  const chamadas = [];
  e.classifyPushback = async (pr, marker) => { chamadas.push([pr.key, marker]); return { deduped: true }; };
  await e.scanPushbacks();
  assert.deepEqual(chamadas, [['o/r#2', '2026-09-01T11:00:00Z']], 'o marcador chega à classificação');
  assert.equal(e.pushbackScanned['o/r#2'], '2026-09-01T11:00:00Z');
  assert.equal(salvosMarcador, 1);
  assert.deepEqual(e.pushbacks, {});
});

/* ---------- chat e ferramenta ---------- */

function esperar(cond, ms = 2000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (cond()) { clearInterval(iv); resolve(); return; }
      if (Date.now() - t0 > ms) { clearInterval(iv); reject(new Error('timeout esperando a condição')); }
    }, 10);
  });
}

test('chat declara operationKind chat', async () => {
  const e = motor({ text: 'oi', sessionId: 's1' });
  e.saveChats = () => { };
  const r = await e.chatSend(PR.key, PR.url, 'olá');
  assert.equal(r.ok, true);
  await esperar(() => e.chats[PR.key].status === 'idle');
  assert.equal(e.opts[0].operationKind, 'chat');
});

test('ferramenta declara operationKind tool', async () => {
  const e = motor({ text: 'resultado', sessionId: 's1' });
  e.toolPrompt = () => 'prompt de teste';
  const r = await e.launchTool('health');
  assert.equal(r.ok, true);
  await esperar(() => { const run = e.toolRunGet('health'); return run && run.status !== 'running'; });
  assert.equal(e.opts[0].operationKind, 'tool');
});
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('test/sync-callers.test.js')).digest('hex').slice(0,16))"
```

Esperado: `3a332d09ac3cecb2`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

- [ ] **Passo 2: rodar e ver falhar**

```bash
node --test --test-force-exit test/sync-callers.test.js
```

Esperado: FALHA. runSelfAnalysis não manda operationKind self.

- [ ] **Passo 3: implementar**

Em `lib/engine/chat.js`, aplique as 1 substituições abaixo, NA ORDEM. Cada trecho "localize" aparece exatamente uma vez no arquivo no momento em que você aplica aquela substituição; copie-o sem mudar espaço nem acento.

1. Localize:

```js
    account: acc,
    ref: key,
    reviewCap,
    // allowlist como a do modelo (mesma doutrina): o sid entra numa linha de
    // shell montada por concatenação e vem de arquivo em disco (chats.json/
    // decisions.json); sid fora do formato de UUID degrada pra sessão nova,
```

   Troque por:

```js
    account: acc,
    ref: key,
    reviewCap,
    // chat não produz veredito nem recibo: tipo declarado pra o gate da coordenação
    // entre aparelhos deixar passar (allowlist fechada, ausência é recusada)
    operationKind: 'chat',
    // allowlist como a do modelo (mesma doutrina): o sid entra numa linha de
    // shell montada por concatenação e vem de arquivo em disco (chats.json/
    // decisions.json); sid fora do formato de UUID degrada pra sessão nova,
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('lib/engine/chat.js')).digest('hex').slice(0,16))"
```

Esperado: `6d34bd69ce045a8b`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

Em `lib/engine/selfpr.js`, aplique as 7 substituições abaixo, NA ORDEM. Cada trecho "localize" aparece exatamente uma vez no arquivo no momento em que você aplica aquela substituição; copie-o sem mudar espaço nem acento.

1. Localize:

```js
import io from '../io.js';
import { writeJsonAtomic } from '../io.js';
import { SELF_FILE, HIDDEN_FILE, WORKSPACE, TEMPLATE_DIR } from '../paths.js';
import { isPermanentBranch, semJsonText } from '../format.js';
import * as jiraMod from './jira.js';
import * as scopeMod from './pr-scope.js';
import { checkpointPath, readCheckpoint } from './verification-checkpoint.js';
```

   Troque por:

```js
import io from '../io.js';
import { writeJsonAtomic } from '../io.js';
import { SELF_FILE, HIDDEN_FILE, WORKSPACE, TEMPLATE_DIR } from '../paths.js';
import { isPermanentBranch, semJsonText, textoBloqueio } from '../format.js';
import * as jiraMod from './jira.js';
import * as scopeMod from './pr-scope.js';
import { checkpointPath, readCheckpoint } from './verification-checkpoint.js';
```

2. Localize:

```js
  }, 'AUTOANÁLISE');
}

async function runSelfAnalysis(engine, pr) {
  const id = `s${++engine.sessionSeq}`;
  const scopeRoot = scopeMod.scopeRootFor(pr.key);
```

   Troque por:

```js
  }, 'AUTOANÁLISE');
}

// Contexto da coordenação entre aparelhos ("Contratos dos chamadores"): a autoanálise é
// sempre um clique seu, mas sem override (os dois overrides valem só pro clique de
// revisão), e a versão material é o head lido ANTES da sessão, o mesmo do registro.
function contextoCoordenacaoSelf(pr, conta, sha) {
  return {
    prKey: pr.key, account: conta, materialVersion: sha, headSha: sha,
    contaRodada: false, manual: true, semCoordenacao: false, ignorarRecibo: false,
    pr: { key: pr.key, url: pr.url, repo: pr.repo, number: pr.number, author: pr.author, account: conta },
  };
}

// Sem desfecho (erro depois da sessão, envelope inválido) o lease volta pro banco sem
// recibo; roda num finally, então nunca lança (lease que não sai expira pelo TTL).
async function devolverLeaseSelf(coord) {
  if (!coord || coord.done) return;
  try { await coord.abort(); } catch { /* expira sozinho pelo TTL do lease */ }
}

// Falha ao gravar o recibo não desfaz a análise já salva: o pior caso é outro aparelho
// analisar de novo este head. Nunca lança, senão uma análise gravada viraria toast de erro.
async function concluirSelf(engine, pr, coord) {
  if (!coord) return;
  try {
    const r = await coord.complete({ publicationState: 'not_applicable' });
    if (r && r.ok === false) engine.log('WARN', `${pr.key}: recibo de coordenação entre dispositivos não gravado: ${r.motivo || r.code}`);
  } catch (err) {
    engine.log('WARN', `${pr.key}: recibo de coordenação entre dispositivos não gravado: ${err.message}`);
  }
}

async function runSelfAnalysis(engine, pr) {
  const id = `s${++engine.sessionSeq}`;
  const scopeRoot = scopeMod.scopeRootFor(pr.key);
```

3. Localize:

```js
  });
  engine.activity.set(id, []);
  engine.pushState();
  try {
    // SHA ANTES da sessão: a análise vale pro commit que ela vai ler. Capturado
    // depois, um push no meio da análise carimbava SHA novo em análise velha
```

   Troque por:

```js
  });
  engine.activity.set(id, []);
  engine.pushState();
  // handle da coordenação entre aparelhos (null com ela desligada)
  let coord = null;
  try {
    // SHA ANTES da sessão: a análise vale pro commit que ela vai ler. Capturado
    // depois, um push no meio da análise carimbava SHA novo em análise velha
```

4. Localize:

```js
      // empresa pelo conector antigo, que alcança um tenant só
      extraArgs: jiraMod.mcpArgsFor(engine, jiraMod.siteForPr(engine, pr)),
      onModel: (m) => engine.setSessionModel(id, m),
      onEvent: (e) => engine.pushActivity(id, e.kind, e.text, e.agent)
    });
    const result = engine.parseSelfResult(res.text);
    // DESFECHO: derivado do fluxo de controle do app. Chegar aqui significa que o
    // stream resolveu e o envelope passou no contrato; cancelamento e erro sobem como
```

   Troque por:

```js
      // empresa pelo conector antigo, que alcança um tenant só
      extraArgs: jiraMod.mcpArgsFor(engine, jiraMod.siteForPr(engine, pr)),
      onModel: (m) => engine.setSessionModel(id, m),
      onEvent: (e) => engine.pushActivity(id, e.kind, e.text, e.agent),
      // gate da coordenação entre aparelhos (runClaudeStream): tipo fechado + contexto
      operationKind: 'self',
      coordination: contextoCoordenacaoSelf(pr, accPr, shaAntes),
    });
    // segurada pela coordenação: nada foi analisado, então nada é gravado (D9)
    if (res.blocked) {
      engine.emit('toast', { kind: 'info', text: textoBloqueio(pr.key, res.coordination) });
      return;
    }
    coord = res.coordination || null;
    const result = engine.parseSelfResult(res.text);
    // DESFECHO: derivado do fluxo de controle do app. Chegar aqui significa que o
    // stream resolveu e o envelope passou no contrato; cancelamento e erro sobem como
```

5. Localize:

```js
      // a linha fica como `ok` no Consumo, indistinguível de uma análise que serviu.
      // Foi assim que US$ 64,81 de um dia só apareceram como sucesso na tela.
      engine.marcarDesfecho(id, 'descartada');
      engine.emit('toast', { kind: 'info', text: `${pr.key}: entrou commit novo durante a autoanálise; rode de novo pra valer pro código atual.` });
      return;
    }
```

   Troque por:

```js
      // a linha fica como `ok` no Consumo, indistinguível de uma análise que serviu.
      // Foi assim que US$ 64,81 de um dia só apareceram como sucesso na tela.
      engine.marcarDesfecho(id, 'descartada');
      // análise descartada não é desfecho deste head: sem recibo, e o lease volta
      await devolverLeaseSelf(coord);
      engine.emit('toast', { kind: 'info', text: `${pr.key}: entrou commit novo durante a autoanálise; rode de novo pra valer pro código atual.` });
      return;
    }
```

6. Localize:

```js
      observed
    };
    engine.saveSelfAnalyses();
    // O próprio usuário faz parte do time. A identidade vem da conta autenticada
    // dona do PR, nunca do JSON da sessão. Só grava quando o recurso opt-in está ligado.
    writeSelfMemory(engine, pr, result, accPr);
```

   Troque por:

```js
      observed
    };
    engine.saveSelfAnalyses();
    // recibo DEPOIS do registro local (D14); autoanálise nunca publica nada
    await concluirSelf(engine, pr, coord);
    // O próprio usuário faz parte do time. A identidade vem da conta autenticada
    // dona do PR, nunca do JSON da sessão. Só grava quando o recurso opt-in está ligado.
    writeSelfMemory(engine, pr, result, accPr);
```

7. Localize:

```js
      text: parecerOk && !elegivel ? `${cabeca} O Merge segue indisponível: veja no card o que faltou comprovar.` : cabeca
    });
  } finally {
    engine.activeReviews.delete(id);
    engine.activity.delete(id);
    engine.pushState();
```

   Troque por:

```js
      text: parecerOk && !elegivel ? `${cabeca} O Merge segue indisponível: veja no card o que faltou comprovar.` : cabeca
    });
  } finally {
    await devolverLeaseSelf(coord);
    engine.activeReviews.delete(id);
    engine.activity.delete(id);
    engine.pushState();
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('lib/engine/selfpr.js')).digest('hex').slice(0,16))"
```

Esperado: `c331d64f9de6a2c3`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

Em `lib/engine/tools.js`, aplique as 1 substituições abaixo, NA ORDEM. Cada trecho "localize" aparece exatamente uma vez no arquivo no momento em que você aplica aquela substituição; copie-o sem mudar espaço nem acento.

1. Localize:

```js
      const res = await engine.runClaudeStream(engine.toolPrompt(name, { scoped, list: scopedList, label: scopeName }), {
        id,
        ref: label,
        onEvent: (e) => engine.pushActivity(id, e.kind, e.text, e.agent)
      });
      let text = String(res.text || '').trim();
```

   Troque por:

```js
      const res = await engine.runClaudeStream(engine.toolPrompt(name, { scoped, list: scopedList, label: scopeName }), {
        id,
        ref: label,
        // ferramenta não é análise de PR: tipo declarado pra o gate da coordenação
        // entre aparelhos deixar passar (allowlist fechada, ausência é recusada)
        operationKind: 'tool',
        onEvent: (e) => engine.pushActivity(id, e.kind, e.text, e.agent)
      });
      let text = String(res.text || '').trim();
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('lib/engine/tools.js')).digest('hex').slice(0,16))"
```

Esperado: `283924663eb38e13`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

- [ ] **Passo 4: rodar e ver passar**

```bash
node --test --test-force-exit test/sync-callers.test.js
```

Esperado: PASSA, 0 falhas.

- [ ] **Passo 5: gate e commit**

```bash
npm run check && npm run lint && npm test
```

Esperado: `fail 0` e `gate de qualidade: sem regressão`. Se algo falhar, PARE e relate; não mexa em outro arquivo para fazer passar.

```bash
git add lib/engine/chat.js lib/engine/selfpr.js lib/engine/tools.js test/sync-callers.test.js
git commit -m "feat(sync): os demais chamadores pedem admissão pela mesma boca"
```


### Tarefa T22: Clique manual: preflight, overrides e refazer

O clique é seu, e por isso ele pode CONTORNAR a coordenação, mas nunca em silêncio: cada motivo tem a sua confirmação, e lease de outro aparelho não tem contorno nenhum, porque o Farol não toma uma análise em andamento.

**Arquivos:**
- Criar: `test/sync-manual.test.js`

- [ ] **Passo 1: escrever o teste**

Crie `test/sync-manual.test.js` com EXATAMENTE este conteúdo:

```js
// O clique manual com a coordenação entre aparelhos ligada (D12 do contrato da
// sincronização). O launchReview faz um preflight só de leitura por PR e devolve os
// bloqueados em `coordenacao: [{ key, reason, detail }]`, sem enfileirar nem tirar da
// fila; a tela confirma e reenvia com o override certo. As regras que este arquivo trava:
//   - semCoordenacao contorna SÓ 'indisponivel', ignorarRecibo contorna SÓ 'recibo';
//   - lease de outro aparelho ('alheio') não tem override (nunca toma execução ativa);
//   - override sem bloqueio correspondente cai (a coordenação normal volta a valer);
//   - override vale pra UMA admissão: retry e fila não herdam o contorno;
//   - "Refazer neste aparelho" apaga o recibo do head atual (condicionado ao etag) e
//     relança pelo clique com o override de recibo;
//   - com a coordenação DESLIGADA o launchReview é o de antes.
//
// Engine real com FAROL_HOME temporário (await import) e o banco no dublê em processo.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-sync-manual-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';
import { SYNC } from '../lib/constants.js';
import { accountHash, prHash, operationFingerprint } from '../lib/sync/keys.js';

const { Engine } = await import('../server.js');
const { createRtdbClient } = await import('../lib/sync/rtdb.js');
const fanout = (await import('../lib/engine/fanout.js')).default;

const TOKEN = 'tok-ok';
const HEAD = 'c'.repeat(40);
const KEY = 'acme/app#1';
const URL_PR = 'https://github.com/acme/app/pull/1';
let fake;

const prMetricsOriginal = fanout.prMetrics;
fanout.prMetrics = async () => null;
before(async () => { fake = await startFakeRtdb({ token: TOKEN }); });
after(async () => {
  fanout.prMetrics = prMetricsOriginal;
  await fake.close();
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});
beforeEach(() => { fake.setTree(null); });

function motor({ coordenacao = true, preflight = null } = {}) {
  const e = new Engine();
  e.config.accounts = [{ user: 'eu', owners: ['acme'] }];
  e.token = 'tok-eu';
  e.tokens = { eu: 'tok-eu' };
  e.refreshTokens = async () => { };
  e.log = () => { };
  e.pushState = () => { };
  e.on('toast', () => { });
  e.bloqueiaAutomatico = async () => false;
  e.queue = [{ key: KEY, url: URL_PR, repo: 'acme/app', number: 1, author: 'dev' }];
  e.enfileirados = [];
  e.enqueueHeadless = (pr) => { e.enfileirados.push(pr); };
  e.preflights = [];
  if (coordenacao) e.config.sync = { ...e.config.sync, enabled: true, coordination: { enabled: true } };
  if (preflight) e.syncPreflightManual = async (pr) => { e.preflights.push(pr.key); return preflight; };
  return e;
}

const bloqueado = (reason, detail = {}) => ({ ok: false, reason, detail });

test('preflight bloqueado devolve coordenacao sem enfileirar e sem tirar o PR da fila', async () => {
  const detail = { deviceId: 'd2', deviceName: 'notebook', since: 1 };
  const e = motor({ preflight: bloqueado('alheio', detail) });
  const r = await e.launchReview([URL_PR], 'auto', 'clique');
  assert.equal(r.ok, false);
  assert.deepEqual(r.coordenacao, [{ key: KEY, reason: 'alheio', detail }]);
  assert.equal(e.enfileirados.length, 0);
  assert.equal(e.queue.some((p) => p.key === KEY), true, 'o card continua na fila');
  assert.equal(e.seen.has(KEY), false);
});

test('semCoordenacao contorna só o indisponivel', async () => {
  const ok = motor({ preflight: bloqueado('indisponivel', { motivo: 'sem rede' }) });
  const r1 = await ok.launchReview([URL_PR], 'auto', 'clique', { semCoordenacao: true });
  assert.equal(r1.ok, true);
  assert.equal(ok.enfileirados[0].semCoordenacao, true);
  assert.equal(ok.enfileirados[0].manual, true);
  assert.equal(ok.enfileirados[0].ignorarRecibo, false);

  for (const reason of ['recibo', 'alheio']) {
    const e = motor({ preflight: bloqueado(reason) });
    const r = await e.launchReview([URL_PR], 'auto', 'clique', { semCoordenacao: true });
    assert.equal(r.ok, false, `semCoordenacao não contorna ${reason}`);
    assert.equal(r.coordenacao[0].reason, reason);
    assert.equal(e.enfileirados.length, 0);
  }
});

test('ignorarRecibo contorna só o recibo', async () => {
  const ok = motor({ preflight: bloqueado('recibo', { deviceName: 'desktop' }) });
  const r1 = await ok.launchReview([URL_PR], 'auto', 'clique', { ignorarRecibo: true });
  assert.equal(r1.ok, true);
  assert.equal(ok.enfileirados[0].ignorarRecibo, true);
  assert.equal(ok.enfileirados[0].semCoordenacao, false);

  for (const reason of ['indisponivel', 'alheio']) {
    const e = motor({ preflight: bloqueado(reason) });
    const r = await e.launchReview([URL_PR], 'auto', 'clique', { ignorarRecibo: true });
    assert.equal(r.ok, false, `ignorarRecibo não contorna ${reason}`);
    assert.equal(e.enfileirados.length, 0);
  }
});

test('alheio não tem override: nem as duas flags juntas passam', async () => {
  const e = motor({ preflight: bloqueado('alheio') });
  const r = await e.launchReview([URL_PR], 'auto', 'clique', { semCoordenacao: true, ignorarRecibo: true });
  assert.equal(r.ok, false);
  assert.equal(e.enfileirados.length, 0);
});

test('override sem bloqueio correspondente cai: a coordenação normal vale', async () => {
  const e = motor({ preflight: { ok: true } });
  const r = await e.launchReview([URL_PR], 'auto', 'clique', { semCoordenacao: true, ignorarRecibo: true });
  assert.equal(r.ok, true);
  assert.equal(r.coordenacao, undefined, 'sem bloqueio a resposta é a de sempre');
  assert.equal(e.enfileirados[0].semCoordenacao, false);
  assert.equal(e.enfileirados[0].ignorarRecibo, false);
});

test('lote misto: o liberado segue e o bloqueado volta na resposta', async () => {
  const e = motor();
  const URL2 = 'https://github.com/acme/app/pull/2';
  e.queue.push({ key: 'acme/app#2', url: URL2, repo: 'acme/app', number: 2, author: 'dev' });
  e.syncPreflightManual = async (pr) => (pr.key === KEY ? bloqueado('alheio') : { ok: true });
  const r = await e.launchReview([URL_PR, URL2], 'auto', 'clique');
  assert.equal(r.ok, true);
  assert.deepEqual(r.coordenacao.map((c) => c.key), [KEY]);
  assert.deepEqual(e.enfileirados.map((p) => p.key), ['acme/app#2']);
  assert.equal(e.queue.some((p) => p.key === KEY), true);
});

test('caminho automático não faz preflight e descarta override que tenha vazado pro objeto', async () => {
  const e = motor({ preflight: bloqueado('alheio') });
  e.queue[0].semCoordenacao = true;
  e.queue[0].ignorarRecibo = true;
  const r = await e.launchReview([URL_PR], 'auto', 'auto', { semCoordenacao: true });
  assert.equal(r.ok, true);
  assert.equal(e.preflights.length, 0, 'automação é segurada no toReview e no gate do spawn');
  assert.equal(e.enfileirados[0].semCoordenacao, false);
  assert.equal(e.enfileirados[0].ignorarRecibo, false);
});

test('coordenação desligada: launchReview é o de antes (sem preflight e sem campo novo)', async () => {
  const e = motor({ coordenacao: false, preflight: bloqueado('alheio') });
  const r = await e.launchReview([URL_PR], 'auto', 'clique', { semCoordenacao: true });
  assert.deepEqual(r, { ok: true, mode: 'auto' });
  assert.equal(e.preflights.length, 0);
  assert.equal(e.enfileirados.length, 1);
});

test('override vale pra UMA admissão: o PR que sai da sessão não carrega o contorno', async () => {
  const e = motor();
  e.accountForPr = () => 'eu';
  e.headSha = async () => HEAD;
  e.fetchPrFiles = async () => null;
  e.bloqueadoPorChecks = async () => ({ faltando: [] });
  let visto = null;
  e.runClaudeStream = async (prompt, opts) => { visto = opts.coordination; return { blocked: true, coordination: { admitted: false, reason: 'alheio', detail: {} }, text: '', sessionId: null }; };
  const pr = { key: KEY, url: URL_PR, repo: 'acme/app', number: 1, author: 'dev', manual: true, semCoordenacao: true };
  await e.runHeadlessReview(pr);
  assert.equal(visto.semCoordenacao, true, 'a admissão desta sessão recebeu o override');
  assert.equal(pr.semCoordenacao, false, 'retry e fila não herdam o contorno');
  assert.equal(pr.ignorarRecibo, false);
});

/* ---------- Refazer neste aparelho ---------- */

function cliente() {
  return createRtdbClient({ databaseUrl: fake.url, getIdToken: async () => ({ ok: true, idToken: TOKEN }) });
}

const IDS = { accountHash: accountHash('eu'), prHash: prHash(KEY) };
const FP = operationFingerprint('review', HEAD);

function recibo() {
  return {
    operationKind: 'review', materialVersion: HEAD, deviceId: 'dVelho', leaseId: 'LV', completedAt: 1000,
    lastVerifiedAt: 1000, expiresAt: Date.now() + SYNC.RECEIPT_TTL_MS, outcome: 'completed',
    publicationState: 'pending', reviewId: '', farolVersion: '1.0.0',
  };
}

function reciboNoBanco() {
  const t = fake.tree() || {};
  const r = (((t.users || {}).u1 || {}).receipts || {})[IDS.accountHash];
  return r && r[IDS.prHash] && r[IDS.prHash][FP];
}

function motorConectado() {
  const e = motor();
  e.sync.status = 'conectado';
  e.sync.uid = 'u1';
  e.sync.client = cliente();
  e.sync.recibosVistos[KEY] = { at: 1000, deviceId: 'dVelho', orfao: 'orfao' };
  // o "Refazer" só vale para recibo ÓRFÃO: o aparelho que fez a análise precisa estar
  // parado há mais de ORPHAN_AFTER_MS, senão a prova de uma análise viva seria apagada
  e.sync.devices = { dVelho: { name: 'Velho', lastSeenAt: Date.now() - 2 * SYNC.ORPHAN_AFTER_MS } };
  e.headSha = async () => HEAD;
  e.relancados = [];
  e.launchReview = async (urls, mode, origem, extras) => { e.relancados.push({ urls, mode, origem, extras }); return { ok: true, mode }; };
  return e;
}

test('redoReceipt apaga o recibo do head atual e relança pelo clique com ignorarRecibo', async () => {
  fake.setTree({ users: { u1: { receipts: { [IDS.accountHash]: { [IDS.prHash]: { [FP]: recibo() } } } } } });
  const e = motorConectado();
  const r = await e.syncRedoReceipt(KEY);
  assert.deepEqual(r, { ok: true });
  assert.equal(reciboNoBanco(), undefined, 'recibo apagado');
  assert.equal(e.sync.recibosVistos[KEY], undefined, 'a tela deixa de mostrar o órfão');
  assert.deepEqual(e.relancados, [{ urls: [URL_PR], mode: 'auto', origem: 'clique', extras: { ignorarRecibo: true } }]);
});

// "Refazer" existe para destravar a análise que ficou pela metade num aparelho que
// sumiu. Apagar o recibo de uma análise PUBLICADA jogaria fora a prova dela, e a mesma
// análise seria paga de novo em todo aparelho que a encontrasse.
test('redoReceipt recusa recibo publicado e recibo de aparelho ainda ativo, sem apagar nada', async () => {
  fake.setTree({ users: { u1: { receipts: { [IDS.accountHash]: { [IDS.prHash]: { [FP]: { ...recibo(), publicationState: 'published' } } } } } } });
  const e = motorConectado();
  const r = await e.syncRedoReceipt(KEY);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'conflito');
  assert.match(r.motivo, /foi publicada/);
  assert.ok(reciboNoBanco(), 'recibo intacto');
  assert.equal(e.relancados.length, 0);

  fake.setTree({ users: { u1: { receipts: { [IDS.accountHash]: { [IDS.prHash]: { [FP]: recibo() } } } } } });
  const e2 = motorConectado();
  e2.sync.devices = { dVelho: { name: 'Velho', lastSeenAt: Date.now() } };
  const r2 = await e2.syncRedoReceipt(KEY);
  assert.equal(r2.ok, false);
  assert.equal(r2.code, 'conflito');
  assert.match(r2.motivo, /continua ativo/);
  assert.ok(reciboNoBanco(), 'recibo intacto');
  assert.equal(e2.relancados.length, 0);
});

test('redoReceipt sem recibo nenhum recusa em vez de relançar', async () => {
  fake.setTree(null);
  const e = motorConectado();
  const r = await e.syncRedoReceipt(KEY);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'nao_encontrado');
  assert.equal(e.relancados.length, 0);
});

// Apagar antes de saber se o clique passaria deixava, com um lease alheio no caminho, o
// recibo destruído e nenhuma análise no lugar dele.
test('redoReceipt não apaga o recibo quando o clique seria barrado por outro motivo', async () => {
  fake.setTree({ users: { u1: { receipts: { [IDS.accountHash]: { [IDS.prHash]: { [FP]: recibo() } } } } } });
  const e = motorConectado();
  e.syncPreflightManual = async () => bloqueado('alheio', { deviceId: 'd9', deviceName: 'Notebook', since: 1, operationKind: 'review' });
  const r = await e.syncRedoReceipt(KEY);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'conflito');
  assert.match(r.motivo, /Notebook/);
  assert.ok(reciboNoBanco(), 'o recibo só some quando o relançamento vai mesmo acontecer');
  assert.equal(e.relancados.length, 0);
});

test('redoReceipt sem conexão não toca o banco nem relança', async () => {
  const e = motorConectado();
  e.sync.status = 'erro';
  e.sync.lastError = { code: 'indisponivel', motivo: 'sem rede', at: 1 };
  const r = await e.syncRedoReceipt(KEY);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'indisponivel');
  assert.equal(e.relancados.length, 0);
});

test('redoReceipt com a coordenação desligada recusa', async () => {
  const e = motorConectado();
  e.config.sync = { ...e.config.sync, coordination: { enabled: false } };
  const r = await e.syncRedoReceipt(KEY);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'desligado');
  assert.equal(e.relancados.length, 0);
});

test('redoReceipt sem head conhecido não apaga nada', async () => {
  fake.setTree({ users: { u1: { receipts: { [IDS.accountHash]: { [IDS.prHash]: { [FP]: recibo() } } } } } });
  const e = motorConectado();
  e.headSha = async () => '';
  const r = await e.syncRedoReceipt(KEY);
  assert.equal(r.ok, false);
  assert.ok(reciboNoBanco(), 'recibo intacto');
  assert.equal(e.relancados.length, 0);
});

/* ---------- rotas ---------- */

test('rotas: /api/review repassa os overrides só quando === true, e /api/sync/redo responde allowlist', async () => {
  const { startServer } = await import('../lib/http-server.js');
  const e = motor({ coordenacao: false });
  const chamadas = [];
  e.launchReview = async (urls, mode, origem, extras) => { chamadas.push({ urls, mode, origem, extras }); return { ok: true, mode }; };
  e.syncRedoReceipt = async (key) => { chamadas.push({ redo: key }); return { ok: false, code: 'conflito', motivo: 'outro aparelho alterou o mesmo registro', uid: 'u1-que-nao-volta' }; };
  // porta 0: o sistema escolhe uma livre, sem disputar a do Farol que estiver aberto
  e.config.port = 0;
  const server = startServer(e);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (rota, corpo) => {
    const res = await fetch(base + rota, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-farol': '1' }, body: JSON.stringify(corpo || {}) });
    return JSON.parse(await res.text());
  };
  try {
    await post('/api/review', { urls: [URL_PR], semCoordenacao: 'true', ignorarRecibo: true });
    assert.deepEqual(chamadas[0], { urls: [URL_PR], mode: 'auto', origem: 'clique', extras: { semCoordenacao: false, ignorarRecibo: true } });
    const r = await post('/api/sync/redo', { key: KEY });
    assert.deepEqual(chamadas[1], { redo: KEY });
    assert.deepEqual(r, { ok: false, code: 'conflito', motivo: 'outro aparelho alterou o mesmo registro' });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('test/sync-manual.test.js')).digest('hex').slice(0,16))"
```

Esperado: `b0db8454929ea96b`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

- [ ] **Passo 2: rodar e ver falhar**

```bash
node --test --test-force-exit test/sync-manual.test.js
```

Esperado: FALHA. o clique não devolve coordenacao[] para a tela confirmar.

- [ ] **Passo 3: rodar e ver passar**

```bash
node --test --test-force-exit test/sync-manual.test.js
```

Esperado: PASSA, 0 falhas.

- [ ] **Passo 4: gate e commit**

```bash
npm run check && npm run lint && npm test
```

Esperado: `fail 0` e `gate de qualidade: sem regressão`. Se algo falhar, PARE e relate; não mexa em outro arquivo para fazer passar.

```bash
git add test/sync-manual.test.js
git commit -m "feat(sync): clique manual com preflight, overrides e refazer recibo órfão"
```


### Tarefa T23: Interface da sincronização

Sem tela, o recurso é invisível: uma automação que CEDE A VEZ, vista de fora, é idêntica a uma automação quebrada. Todo HTML sai de função pura e testada; o que toca o DOM fica no app.js. Todo elemento que o app.js liga no topo do módulo tem que existir no index.html NESTE commit, senão o smoke do Electron reprova com TypeError.

**Arquivos:**
- Modificar: `test/rerevisar-head-velho.test.js`
- Criar: `test/ui-pure-sync.test.js`
- Modificar: `test/ui-semantics.test.js`
- Modificar: `ui/app.css`
- Modificar: `ui/app.js`
- Modificar: `ui/index.html`
- Modificar: `ui/pure.js`

- [ ] **Passo 1: escrever o teste**

Em `test/rerevisar-head-velho.test.js`, aplique as 1 substituições abaixo, NA ORDEM. Cada trecho "localize" aparece exatamente uma vez no arquivo no momento em que você aplica aquela substituição; copie-o sem mudar espaço nem acento.

1. Localize:

```js
  assert.ok(i > 0, 'a seção precisa ter listener próprio');
  const listener = appJs.slice(i, i + 900);
  assert.match(listener, /act-review/, 'o .act-review não tem listener global: cada seção escuta o seu');
  assert.match(listener, /\/api\/review/, 'e usa a MESMA rota do Revisar da fila');
});
```

   Troque por:

```js
  assert.ok(i > 0, 'a seção precisa ter listener próprio');
  const listener = appJs.slice(i, i + 900);
  assert.match(listener, /act-review/, 'o .act-review não tem listener global: cada seção escuta o seu');
  // desde a seção de sincronização, TODO clique passa pela boca única `revisarUrls`,
  // que é quem trata a confirmação da coordenação entre aparelhos. Chamar /api/review
  // direto aqui puliria essa confirmação em silêncio, que é o defeito que a boca única
  // existe pra impedir (mesma doutrina do enqueueHeadless no engine).
  assert.match(listener, /revisarUrls\(/, 'e usa a MESMA boca do Revisar da fila');
});
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('test/rerevisar-head-velho.test.js')).digest('hex').slice(0,16))"
```

Esperado: `c903bedde302f9f9`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

Crie `test/ui-pure-sync.test.js` com EXATAMENTE este conteúdo:

```js
// As funções PURAS da seção Sistema > Sincronização (ui/pure.js). Sem DOM: cada uma
// recebe a projeção `statusForUi` e a config, e devolve texto ou HTML.
//
// O que está em jogo aqui não é layout, é o que a tela AFIRMA. Dois casos já custaram
// caro no engine e são travados de novo deste lado: recibo que não é órfão não pode
// ganhar o botão que APAGA a prova de uma análise, e PR que este aparelho não acompanha
// não pode ser nomeado (o nome do PR nunca sobe pro banco, D6).
//
// fmtClock/fmtWhenDay formatam no fuso do processo; sem fixar, passa aqui e falha em
// outra máquina. Tem que vir ANTES do import.
process.env.TZ = 'America/Sao_Paulo';

import { test } from 'node:test';
import assert from 'node:assert/strict';
const P = await import('../ui/pure.js');

const CFG = { enabled: true, coordination: { enabled: true }, consolidation: { enabled: true }, apiKey: 'AIzaChave', databaseUrl: 'https://x-default-rtdb.firebaseio.com', deviceName: 'Notebook' };

function sync(extra = {}) {
  return {
    enabled: true, coordination: true, consolidation: true, status: 'conectado', lastError: null,
    uid: 'u1…', email: 'voce@exemplo.com', deviceId: 'dEu', deviceName: 'Notebook',
    devices: [], espera: {}, recibosVistos: {}, leasesVistos: {}, leasesOutros: 0, outbox: null, ...extra,
  };
}

/* ---------- estado ---------- */

test('syncEstado: um estado só, derivado do runtime', () => {
  assert.equal(P.syncEstado(sync({ enabled: false })), 'desligada');
  assert.equal(P.syncEstado(sync({ status: 'desligado' })), 'desligada');
  assert.equal(P.syncEstado(sync({ status: 'sem-credencial' })), 'sem-login');
  assert.equal(P.syncEstado(sync({ status: 'conectando' })), 'entrando');
  assert.equal(P.syncEstado(sync()), 'conectada');
  assert.equal(P.syncEstado(sync({ status: 'erro', lastError: { code: 'indisponivel' } })), 'degradada');
  assert.equal(P.syncEstado(sync({ status: 'erro', lastError: { code: 'credencial_invalida' } })), 'login-expirado');
  assert.equal(P.syncEstado(null), 'desligada', 'sem projeção nenhuma não inventa conexão');
});

test('syncSeloHtml e syncClasseCartao: a borda e o selo saem do MESMO estado', () => {
  assert.match(P.syncSeloHtml('conectada'), /sync-chip ok">conectado</);
  assert.match(P.syncSeloHtml('login-expirado'), /sync-chip bad">login expirado</);
  assert.equal(P.syncClasseCartao('conectada'), '');
  assert.equal(P.syncClasseCartao('degradada'), 'warn');
  assert.equal(P.syncClasseCartao('login-expirado'), 'bad');
  assert.equal(P.syncClasseCartao('desligada'), 'off');
  assert.equal(P.syncClasseCartao('inventado'), 'off', 'estado desconhecido cai no lado apagado');
});

/* ---------- interruptores ---------- */

test('syncTogglesHtml: a chave geral desabilita as outras duas', () => {
  const on = P.syncTogglesHtml(CFG);
  assert.match(on, /id="setSyncEnabled" checked/);
  assert.match(on, /id="setSyncCoordination" checked/);
  assert.doesNotMatch(on, /disabled/);

  const off = P.syncTogglesHtml({ enabled: false, coordination: { enabled: true }, consolidation: { enabled: true } });
  assert.doesNotMatch(off, /id="setSyncEnabled" checked/);
  assert.match(off, /id="setSyncCoordination" disabled/, 'sub-chave travada com a geral desligada');
  assert.doesNotMatch(off, /id="setSyncCoordination" checked/, 'e nunca marcada, porque não tem efeito nenhum');
  assert.match(off, /set-row off/);

  // O .switch tem que ser IRMÃO IMEDIATO do input: com a classe no próprio input, o
  // interruptor simplesmente NÃO APARECE, e a linha salva certo parecendo desligada.
  // Achado abrindo a tela de verdade no navegador, com a suíte inteira verde.
  assert.match(on, /<input type="checkbox" id="setSyncEnabled" checked><span class="switch"><\/span>/);
  assert.match(on, /<input type="checkbox" id="setSyncCoordination" checked><span class="switch"><\/span>/);
  assert.doesNotMatch(on, /input[^>]*class="switch"/, 'a classe nunca vai no input');
});

/* ---------- conexão e login ---------- */

test('syncContaHtml: conectado mostra quem é; desconectado pede e-mail e senha', () => {
  const dentro = P.syncContaHtml(sync());
  assert.match(dentro, /voce@exemplo\.com/);
  assert.match(dentro, /id="syncLogout"/);
  assert.doesNotMatch(dentro, /id="syncSenha"/);

  const fora = P.syncContaHtml(sync({ status: 'sem-credencial' }));
  assert.match(fora, /id="syncEmail"/);
  assert.match(fora, /id="syncSenha" class="sync-input" type="password"/, 'a senha nunca aparece em texto claro');
  assert.match(fora, />Entrar</);

  const expirado = P.syncContaHtml(sync({ status: 'erro', lastError: { code: 'credencial_invalida' } }));
  assert.match(expirado, />Entrar de novo</);
  assert.match(expirado, /recusou o acesso guardado/);
});

test('syncConexaoHtml: os campos vêm da config e a degradação diz o motivo do engine', () => {
  const html = P.syncConexaoHtml(sync(), CFG);
  assert.match(html, /id="syncApiKey" type="text" class="sync-input" value="AIzaChave"/);
  assert.match(html, /value="https:\/\/x-default-rtdb\.firebaseio\.com"/);
  assert.match(html, /value="Notebook"/);
  assert.match(html, /id="syncTest"/);
  assert.match(html, /id="syncErase"/);
  assert.doesNotMatch(html, /sync-degradada/);

  const ruim = P.syncConexaoHtml(sync({ status: 'erro', lastError: { code: 'indisponivel', motivo: 'o Firebase está indisponível ou sem rede' } }), CFG);
  assert.match(ruim, /sync-card warn/);
  assert.match(ruim, /sync-degradada/);
  assert.match(ruim, /o Firebase está indisponível ou sem rede/, 'o motivo é do engine, não uma frase genérica da tela');
});

test('syncEnvioHtml: sem outbox reconciliada não inventa número', () => {
  assert.equal(P.syncEnvioHtml(sync({ outbox: null })), '', 'null quer dizer "ainda não há número honesto"');
  assert.equal(P.syncEnvioHtml(sync({ consolidation: false, outbox: { pendentes: 3 } })), '', 'desligada não fala de envio');
  assert.match(P.syncEnvioHtml(sync({ outbox: { pendentes: 0, rejeitados: 0, lastSentAt: Date.now(), paused: false } })), /nada pendente/);
  assert.match(P.syncEnvioHtml(sync({ outbox: { pendentes: 12, rejeitados: 1, paused: false } })), /enviando o histórico/);
  assert.match(P.syncEnvioHtml(sync({ outbox: { pendentes: 12, rejeitados: 0, paused: true } })), /pausado/);
});

/* ---------- aparelhos ---------- */

test('syncAparelhosHtml: marca ESTE aparelho e nunca mostra lista vazia muda', () => {
  const agora = Date.UTC(2026, 8, 11, 15, 0, 0);
  const html = P.syncAparelhosHtml([
    { deviceId: 'dEu', name: 'Notebook', platform: 'win32', lastSeenAt: agora, euMesmo: true },
    { deviceId: 'dOutro', name: 'Celular', platform: 'linux', lastSeenAt: agora - 4 * 60000, euMesmo: false },
  ], agora);
  assert.match(html, /Notebook <span class="sync-chip mute">este<\/span>/);
  assert.doesNotMatch(html, /Celular <span class="sync-chip mute">este/);
  assert.match(html, /win32/);
  assert.match(P.syncAparelhosHtml([]), /Nenhum aparelho registrado ainda/);
});

/* ---------- coordenação agora ---------- */

test('syncCoordenacaoHtml: some inteira com a coordenação desligada', () => {
  assert.equal(P.syncCoordenacaoHtml(sync({ coordination: false, leasesVistos: { 'o/r#1': { deviceName: 'Celular' } } })), '');
});

test('syncCoordenacaoHtml: lease de outro aparelho é espera, em azul', () => {
  const html = P.syncCoordenacaoHtml(sync({ leasesVistos: { 'o/r#1': { deviceId: 'd2', deviceName: 'Celular', since: Date.UTC(2026, 8, 11, 17, 32), operationKind: 'review' } } }));
  assert.match(html, /o\/r#1/);
  assert.match(html, /sendo analisado no Celular/);
  assert.match(html, /sync-chip info/, 'espera é azul, nunca o vermelho do estacionamento');
  assert.doesNotMatch(html, /sync-redo/, 'lease vivo não oferece refazer: ninguém toma análise em andamento');
});

// A trava mais séria desta tela: o botão APAGA a prova de que uma análise foi feita.
// Recibo que não é órfão não pode oferecê-lo, senão a mesma análise é paga de novo em
// todo aparelho que a encontrar (ver recusaDoRefazer, em lib/engine/sync-redo.js).
test('syncCoordenacaoHtml: só o recibo ÓRFÃO ganha o botão de refazer', () => {
  const ativo = P.syncCoordenacaoHtml(sync({ recibosVistos: { 'o/r#2': { deviceName: 'Celular', at: Date.now(), publicationState: 'pending', orfao: 'ativo' } } }));
  assert.match(ativo, /sync-chip mute">pendente lá/);
  assert.doesNotMatch(ativo, /sync-redo/);

  const orfao = P.syncCoordenacaoHtml(sync({ recibosVistos: { 'o/r#3': { deviceName: 'Celular', at: Date.now(), publicationState: 'pending', orfao: 'orfao' } } }));
  assert.match(orfao, /class="btn sm sync-redo" data-key="o\/r#3"/);
  assert.match(orfao, /sync-o-que sync-orfao/);

  const desconhecido = P.syncCoordenacaoHtml(sync({ recibosVistos: { 'o/r#4': { deviceName: 'Celular', orfao: 'desconhecido' } } }));
  assert.doesNotMatch(desconhecido, /sync-redo/, 'falta de dado nunca libera o apagamento');
});

// D6: o nome do PR nunca sobe pro banco, então a tela só consegue CONTAR o que este
// aparelho não acompanha. Nomear seria inventar.
test('syncCoordenacaoHtml: PR que este aparelho não acompanha é contado, nunca nomeado', () => {
  const html = P.syncCoordenacaoHtml(sync({ leasesOutros: 3 }));
  assert.match(html, /e mais 3 em PR que este aparelho não acompanha/);
  assert.doesNotMatch(html, /sync-redo/);
  assert.match(P.syncCoordenacaoHtml(sync()), /Nenhum PR seu está sendo analisado/);
});

/* ---------- composição ---------- */

test('syncSecaoHtml: desligada mostra só os interruptores, sem campo nem login', () => {
  const html = P.syncSecaoHtml(sync({ enabled: false }), { enabled: false });
  assert.match(html, /setSyncEnabled/);
  assert.doesNotMatch(html, /syncApiKey/);
  assert.doesNotMatch(html, /syncLogin/);
  assert.doesNotMatch(html, /Coordenação agora/);
});

test('syncSecaoHtml: ligada monta interruptores, conexão, aparelhos e coordenação', () => {
  const html = P.syncSecaoHtml(sync({ devices: [{ deviceId: 'dEu', name: 'Notebook', platform: 'win32', lastSeenAt: Date.now(), euMesmo: true }] }), CFG);
  assert.match(html, /setSyncEnabled/);
  assert.match(html, /syncApiKey/);
  assert.match(html, /Aparelhos/);
  assert.match(html, /Coordenação agora/);
});

/* ---------- escape ---------- */

// A projeção carrega texto que vem do BANCO (nome de aparelho, escrito em outro
// aparelho) e do GitHub (chave do PR). Os dois entram como HTML nesta tela.
test('nome de aparelho e chave de PR vindos de fora são escapados', () => {
  const nome = '<img src=x onerror=alert(1)>';
  assert.doesNotMatch(P.syncAparelhosHtml([{ deviceId: 'd', name: nome, platform: '', lastSeenAt: 0, euMesmo: false }]), /<img/);
  const html = P.syncCoordenacaoHtml(sync({ leasesVistos: { '<b>x</b>#1': { deviceName: nome, since: 0 } } }));
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /<b>x<\/b>/);
});

/* ---------- U2: confirmações do clique manual ---------- */

// Cada motivo tem um desfecho DIFERENTE, e é essa escolha que a função carrega.
test('syncConfirmacaoDoClique: indisponível e recibo confirmam com override próprio', () => {
  const ind = P.syncConfirmacaoDoClique({ key: 'o/r#1', reason: 'indisponivel', detail: { motivo: 'sem rede' } });
  assert.equal(ind.tipo, 'confirma');
  assert.equal(ind.override, 'semCoordenacao');
  assert.equal(ind.titulo, 'Revisar sem coordenação?');
  assert.match(ind.corpo, /sem rede/);
  assert.match(ind.corpo, /o\/r#1/);

  const rec = P.syncConfirmacaoDoClique({ key: 'o/r#2', reason: 'recibo', detail: { deviceName: 'Celular', receipt: { completedAt: Date.now() } } });
  assert.equal(rec.tipo, 'confirma');
  assert.equal(rec.override, 'ignorarRecibo');
  assert.equal(rec.titulo, 'Revisar de novo este commit?');
  assert.match(rec.corpo, /Celular/);
});

// A trava desta parte: lease de outro aparelho NÃO tem override. O Farol nunca toma
// uma análise em andamento, e oferecer um botão que a tomasse seria o contrário disso.
test('syncConfirmacaoDoClique: lease alheio só avisa, e nunca oferece override', () => {
  const r = P.syncConfirmacaoDoClique({ key: 'o/r#3', reason: 'alheio', detail: { deviceName: 'Celular' } });
  assert.equal(r.tipo, 'aviso');
  assert.equal(r.override, undefined);
  assert.match(r.texto, /Celular/);
  assert.match(r.texto, /não toma uma análise em andamento/);
});

test('syncConfirmacaoDoClique: motivo desconhecido cai no aviso, nunca num override', () => {
  const r = P.syncConfirmacaoDoClique({ key: 'o/r#4', reason: 'inventado', detail: {} });
  assert.equal(r.tipo, 'aviso');
  assert.equal(r.override, undefined);
});

test('syncConfirmacoesDoClique: resposta sem coordenação não produz nada', () => {
  assert.deepEqual(P.syncConfirmacoesDoClique({ ok: true }), []);
  assert.deepEqual(P.syncConfirmacoesDoClique(null), []);
  assert.equal(P.syncConfirmacoesDoClique({ coordenacao: [{ key: 'a/b#1', reason: 'recibo', detail: {} }] }).length, 1);
});

/* ---------- U3: a nota no card da fila ---------- */

test('prCoordNoteHtml: espera vira nota azul; indisponível e teto viram âmbar', () => {
  const alheio = P.prCoordNoteHtml('o/r#1', { espera: { 'o/r#1': { reason: 'alheio', deviceName: 'Celular' } } });
  assert.match(alheio, /class="pr-coord"/, 'espera é azul, sem modificador');
  assert.match(alheio, /Em análise no Celular/);

  const ind = P.prCoordNoteHtml('o/r#1', { espera: { 'o/r#1': { reason: 'indisponivel' } } });
  assert.match(ind, /class="pr-coord warn"/);
  const teto = P.prCoordNoteHtml('o/r#1', { espera: { 'o/r#1': { reason: 'esgotado' } } });
  assert.match(teto, /class="pr-coord warn"/);
  assert.match(teto, /Teto de 3|Teto de rodadas/);

  assert.doesNotMatch(alheio + ind + teto, /pr-parked/, 'nunca o vermelho do estacionamento: segurar não é falhar');
});

test('prCoordNoteHtml: sem espera, o lease visto pelo stream ainda explica o card', () => {
  const html = P.prCoordNoteHtml('o/r#9', { leasesVistos: { 'o/r#9': { deviceName: 'Notebook' } } });
  assert.match(html, /Em análise no Notebook/);
  assert.equal(P.prCoordNoteHtml('o/r#9', {}), '');
  assert.equal(P.prCoordNoteHtml('o/r#9', null), '');
});

// Decisão registrada: o estacionamento VENCE. Ele é falha e exige ação; a espera se
// resolve sozinha. Duas notas competindo deixariam a mais urgente em segundo plano.
test('queueCardHtml: estacionamento vence a nota de coordenação', () => {
  const pr = { key: 'o/r#1', url: 'https://github.com/o/r/pull/1', title: 'T', author: 'a', updatedAt: new Date().toISOString() };
  const ctx = { people: {}, mark: { style: '', dot: '', chip: '' }, sync: { espera: { 'o/r#1': { reason: 'alheio', deviceName: 'Celular' } } } };
  const so = P.queueCardHtml(pr, ctx);
  assert.match(so, /pr-coord/);

  const com = P.queueCardHtml(pr, { ...ctx, parked: { 'o/r#1': { tipo: 'falha', motivo: 'caiu', at: Date.now() } } });
  assert.match(com, /pr-parked/);
  assert.doesNotMatch(com, /pr-coord/, 'uma nota só, e a que exige ação sua');
});

/* ---------- U4: consumo de todos os aparelhos ---------- */

const RESUMO = {
  devices: [
    { deviceId: 'dEu', name: 'Notebook', euMesmo: true, sessions: 671, costUsd: 2545.07, lastAt: Date.now() },
    { deviceId: 'dOutro', name: 'Celular', euMesmo: false, sessions: 18, costUsd: 66.33, lastAt: Date.now() - 7200000 },
  ],
  series: [],
  totals: { sessions: 689, costUsd: 2611.4, medido: { sessions: 680, costUsd: 2559.3 }, estimado: { sessions: 9, costUsd: 52.1 } },
};

test('usageConsolidatedHtml: soma todos e nomeia cada aparelho, marcando este', () => {
  const html = P.usageConsolidatedHtml(RESUMO);
  assert.match(html, /US\$ 2611\.40/);
  assert.match(html, /Notebook <span class="sync-chip mute">este<\/span>/);
  assert.match(html, /Celular/);
  assert.match(html, /US\$ 52\.10 estimado/);
});

test('usageConsolidatedHtml: sem aparelho nenhum diz isso, em vez de tabela vazia', () => {
  const html = P.usageConsolidatedHtml({ devices: [], totals: { sessions: 0, costUsd: 0 } });
  assert.match(html, /Nenhum aparelho enviou consumo ainda/);
  assert.match(html, /nenhum gasto na janela/);
});

// Tela vazia muda seria lida como "não gastei nada", que é uma afirmação que o app não
// pode fazer sem ter os dados.
test('usageConsolidadoEnvelopeHtml: recusa mostra o MOTIVO, nunca tela vazia', () => {
  const html = P.usageConsolidadoEnvelopeHtml({ ok: false, code: 'indisponivel', motivo: 'o Firebase está indisponível ou sem rede' });
  assert.match(html, /callout warn/);
  assert.match(html, /o Firebase está indisponível ou sem rede/);
  assert.match(html, /continua em "Este aparelho"/);
  assert.match(P.usageConsolidadoEnvelopeHtml(null), /o servidor não respondeu/);
  assert.match(P.usageConsolidadoEnvelopeHtml({ ok: true, resumo: RESUMO }), /US\$ 2611\.40/);
});

test('nome de aparelho vindo do banco é escapado também no consolidado', () => {
  const html = P.usageConsolidatedHtml({ devices: [{ deviceId: 'd', name: '<img src=x onerror=alert(1)>', sessions: 1, costUsd: 1, lastAt: 0 }], totals: { sessions: 1, costUsd: 1 } });
  assert.doesNotMatch(html, /<img/);
});
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('test/ui-pure-sync.test.js')).digest('hex').slice(0,16))"
```

Esperado: `f238181f0a0e2414`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

Em `test/ui-semantics.test.js`, aplique as 1 substituições abaixo, NA ORDEM. Cada trecho "localize" aparece exatamente uma vez no arquivo no momento em que você aplica aquela substituição; copie-o sem mudar espaço nem acento.

1. Localize:

```js
  assert.ok(nav);
  assert.match(nav[0], /role="tablist"/);
  const botoes = todos(/<button[^>]*class="sys-nav-item[^"]*"[^>]*>/g, nav[1]);
  assert.equal(botoes.length, 11, 'as 11 seções do Sistema');
  for (const [b] of botoes) {
    assert.match(b, /role="tab"/);
    assert.match(b, /aria-selected="(true|false)"/);
```

   Troque por:

```js
  assert.ok(nav);
  assert.match(nav[0], /role="tablist"/);
  const botoes = todos(/<button[^>]*class="sys-nav-item[^"]*"[^>]*>/g, nav[1]);
  assert.equal(botoes.length, 12, 'as 12 seções do Sistema');
  for (const [b] of botoes) {
    assert.match(b, /role="tab"/);
    assert.match(b, /aria-selected="(true|false)"/);
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('test/ui-semantics.test.js')).digest('hex').slice(0,16))"
```

Esperado: `64120342d09ad4e8`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

- [ ] **Passo 2: rodar e ver falhar**

```bash
node --test --test-force-exit test/ui-pure-sync.test.js test/ui-semantics.test.js test/rerevisar-head-velho.test.js
```

Esperado: FALHA. syncSecaoHtml não é exportada de ui/pure.js.

- [ ] **Passo 3: implementar**

Em `ui/app.css`, aplique as 1 substituições abaixo, NA ORDEM. Cada trecho "localize" aparece exatamente uma vez no arquivo no momento em que você aplica aquela substituição; copie-o sem mudar espaço nem acento.

1. Localize:

```css
.fj-barra > span { display: block; height: 100%; background: var(--working); }
.fj-conta.is-cedendo .fj-barra > span { background: var(--urgent); }
.fj-conta-num { margin-top: 6px; font-size: 12px; color: var(--muted); }
```

   Troque por:

```css
.fj-barra > span { display: block; height: 100%; background: var(--working); }
.fj-conta.is-cedendo .fj-barra > span { background: var(--urgent); }
.fj-conta-num { margin-top: 6px; font-size: 12px; color: var(--muted); }

/* ---------- Sistema > Sincronização entre dispositivos ----------
   Só tokens, nenhum hex novo. A cor da coordenação é deliberada: --info para espera e
   --accent para atenção, nunca o --danger do estacionamento, porque segurar não é falhar. */
.sync-sub-head { font-size: 13px; font-weight: 650; margin: var(--sp-5) 0 var(--sp-2); color: var(--text); }
.sync-card { padding: 0; border-left: 3px solid var(--ok); }
.sync-card.warn { border-left-color: var(--accent); }
.sync-card.bad { border-left-color: var(--danger); }
.sync-card.off { border-left-color: var(--border); }
.sync-topo { display: flex; align-items: center; gap: var(--sp-3); flex-wrap: wrap; padding: 12px var(--sp-4); border-bottom: 1px solid var(--border-soft); }
.sync-titulo { font-size: 14px; font-weight: 650; }
.sync-espaco { flex: 1; }
.sync-corpo { padding: var(--sp-3) var(--sp-4); display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--sp-3); }
.sync-campo { display: flex; flex-direction: column; gap: var(--sp-1); min-width: 0; }
.sync-campo > label { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--faint); }
.sync-input { background: var(--surface-2); color: var(--text); border: 1px solid var(--border); border-radius: 8px; padding: 6px 10px; font: inherit; font-size: 12.5px; min-height: 31px; width: 100%; }
.sync-input:focus { outline: none; border-color: var(--accent); }
.sync-dica { font-size: 11px; color: var(--faint); }
.sync-vago { color: var(--faint); }
.sync-vazio { margin: var(--sp-3) 2px; font-size: 12.5px; }
.sync-conta { margin: 0 var(--sp-4) var(--sp-3); border: 1px solid var(--border); border-radius: 10px; background: color-mix(in srgb, var(--surface-2) 60%, transparent); }
.sync-conta-topo { display: flex; align-items: center; gap: 9px; padding: 9px 13px; border-bottom: 1px solid var(--border-soft); }
.sync-conta-titulo { font-size: 12.5px; font-weight: 650; }
.sync-conta-onde { font-size: 11.5px; color: var(--faint); margin-left: auto; font-family: "Cascadia Code", Consolas, "SF Mono", Menlo, monospace; }
.sync-conta-corpo { padding: 12px 13px; display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap; font-size: 12.5px; color: var(--muted); }
.sync-conta-corpo .sync-campo { flex: 1; min-width: 190px; }
.sync-quem { color: var(--text); font-weight: 600; }
.sync-conta-nota { padding: 0 13px 11px; margin: 0; font-size: 11.5px; color: var(--faint); text-wrap: pretty; }
.sync-conta-nota-ruim { color: var(--danger); padding-top: 0; }
.sync-degradada { margin: var(--sp-3) var(--sp-4); }
.sync-rodape { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 0 var(--sp-4) 13px; }
.sync-teste { font-size: 11.5px; color: var(--faint); }
.sync-teste.ok { color: var(--ok); }
.sync-teste.ruim { color: var(--danger); }
.sync-lista { padding: 2px var(--sp-4); }
.sync-linha { display: grid; grid-template-columns: minmax(0, 1fr) 110px 150px; gap: var(--sp-3); align-items: center; padding: 10px 0; font-size: 12.5px; }
.sync-linha + .sync-linha { border-top: 1px solid var(--border-soft); }
.sync-linha.sync-head { font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--faint); padding-bottom: 6px; }
.sync-nome { display: flex; align-items: center; gap: var(--sp-2); min-width: 0; font-weight: 600; }
.sync-fraco { color: var(--muted); }
.sync-coord { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--sp-3); align-items: center; padding: 11px 0; font-size: 12.5px; }
.sync-coord + .sync-coord { border-top: 1px solid var(--border-soft); }
.sync-ref { color: var(--accent); font-weight: 600; }
.sync-o-que { display: block; color: var(--muted); margin-top: 1px; }
.sync-o-que.sync-orfao { color: var(--accent); }
.sync-legenda { font-size: 11.5px; color: var(--faint); margin: var(--sp-2) 2px 0; }
.sync-chip { font-size: 10.5px; font-weight: 700; border-radius: 99px; padding: 2px 9px; display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
.sync-chip.ok { color: var(--ok); background: var(--ok-soft); }
.sync-chip.warn { color: var(--accent); background: var(--accent-soft); }
.sync-chip.bad { color: var(--danger); background: var(--danger-soft); }
.sync-chip.info { color: var(--info); background: var(--info-soft); }
.sync-chip.mute { color: var(--muted); background: var(--surface-2); }
/* Anotação de coordenação no card da fila. Azul é espera (o PR está com outro aparelho),
   âmbar é atenção (indisponível, teto de rodadas). O vermelho fica reservado ao
   estacionamento, que é falha de verdade. */
.pr-coord { margin-top: var(--sp-1); font-size: 11.5px; line-height: 1.35; color: var(--info); }
.pr-coord.warn { color: var(--accent); }
/* Telas estreitas (o Farol aberto no navegador do celular, via Termux): os três campos
   viram um por linha e a lista de aparelhos perde a coluna do sistema. */
@media (max-width: 720px) {
  .sync-corpo { grid-template-columns: 1fr; }
  .sync-linha { grid-template-columns: minmax(0, 1fr) auto; }
  .sync-linha > :nth-child(2) { display: none; }
}
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('ui/app.css')).digest('hex').slice(0,16))"
```

Esperado: `b5d8392bdb790b10`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

Em `ui/app.js`, aplique as 14 substituições abaixo, NA ORDEM. Cada trecho "localize" aparece exatamente uma vez no arquivo no momento em que você aplica aquela substituição; copie-o sem mudar espaço nem acento.

1. Localize:

```js
  reasonGroupsHtml, reasonText, claudeProfilesHtml, accountsManagerHtml,
  jiraBaseUrlProblema, jiraPrefixosProblema,
  canMergeSelfAnalysis, qualityBlockTitle, selfAnalysisBadge, selfAnalysisToggle, selfAnalysisStale,
  filaJustaHtml
} from './pure.js';

const $ = (s) => document.querySelector(s);
```

   Troque por:

```js
  reasonGroupsHtml, reasonText, claudeProfilesHtml, accountsManagerHtml,
  jiraBaseUrlProblema, jiraPrefixosProblema,
  canMergeSelfAnalysis, qualityBlockTitle, selfAnalysisBadge, selfAnalysisToggle, selfAnalysisStale,
  filaJustaHtml, syncSecaoHtml, syncConfirmacoesDoClique, usageConsolidadoEnvelopeHtml
} from './pure.js';

const $ = (s) => document.querySelector(s);
```

2. Localize:

```js
  // global (o da fila é escutado dentro do #queue, o do panorama dentro do #panorama),
  // então a seção escuta o seu. O botão desabilita até o próximo estado re-renderizar.
  const rev = e.target.closest('.act-review');
  if (rev) { rev.disabled = true; api('/api/review', { urls: [rev.dataset.url] }); return; }
  const cp = e.target.closest('.rr-copy');
  if (cp) {
    const ok = await copyToClipboard(cp.dataset.url || cp.dataset.key || '');
```

   Troque por:

```js
  // global (o da fila é escutado dentro do #queue, o do panorama dentro do #panorama),
  // então a seção escuta o seu. O botão desabilita até o próximo estado re-renderizar.
  const rev = e.target.closest('.act-review');
  if (rev) { rev.disabled = true; revisarUrls([rev.dataset.url]); return; }
  const cp = e.target.closest('.rr-copy');
  if (cp) {
    const ok = await copyToClipboard(cp.dataset.url || cp.dataset.key || '');
```

3. Localize:

```js
  saveJiraSites(sites);
});

/* ---------- tema ---------- */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
```

   Troque por:

```js
  saveJiraSites(sites);
});


/* ---------- Sistema > Sincronização entre dispositivos ----------

   O HTML todo sai de funções puras (ui/pure.js, testadas em test/ui-pure-sync.test.js);
   aqui fica só o que toca o DOM e a rede. O padrão é o do Jira: um container que a
   seção inteira reescreve, com delegação de evento no container, porque os elementos
   nascem e morrem a cada render e um listener por botão vazaria.

   A senha é lida do DOM no instante do clique, numa const local, e some com o re-render:
   ela nunca entra no STATE nem em nada que o snapshot carregue. */

function syncCfgAtual() {
  return (STATE && STATE.config && STATE.config.sync) || {};
}

/* Salva o objeto INTEIRO de sync. Mandar só o campo alterado faria o engine receber uma
   config parcial e apagar o resto, que é o oposto do que a tela mostra. */
function saveSync(sync) {
  if (!STATE) return;
  STATE.config = { ...STATE.config, sync };
  renderSync();
  api('/api/settings', { sync }).then(r => {
    if (r && Array.isArray(r.ignoradas) && r.ignoradas.includes('sync')) {
      toast('error', '"sync" não foi salvo: o servidor não reconhece essa preferência.', 6000);
      return;
    }
    toast('ok', '✓ Configurações salvas', 2000);
  });
}

function renderSync() {
  const box = $('#syncManager');
  if (!box) return;
  box.innerHTML = syncSecaoHtml((STATE && STATE.sync) || {}, syncCfgAtual());
}

// Os três interruptores. A chave geral desligada arrasta as outras duas no objeto
// salvo, e não só na tela: config que diz "coordenação ligada" com o recurso desligado
// voltaria sozinha ao ligar a chave geral, sem ninguém ter pedido.
function syncToggle(id, valor) {
  const c = syncCfgAtual();
  if (id === 'setSyncEnabled') {
    saveSync({ ...c, enabled: valor });
    return;
  }
  const chave = id === 'setSyncCoordination' ? 'coordination' : 'consolidation';
  saveSync({ ...c, [chave]: { ...(c[chave] || {}), enabled: valor } });
}

function syncCampoSalvar(id, valor) {
  const c = syncCfgAtual();
  const campo = { syncApiKey: 'apiKey', syncDatabaseUrl: 'databaseUrl', syncDeviceName: 'deviceName' }[id];
  if (!campo || String(c[campo] || '') === valor) return;
  saveSync({ ...c, [campo]: valor });
}

async function syncFazerLogin() {
  const email = ($('#syncEmail') || {}).value || '';
  const senha = ($('#syncSenha') || {}).value || '';
  if (!email.trim() || !senha) { toast('error', 'Informe o e-mail e a senha do Firebase.', 4000); return; }
  const r = await api('/api/sync/login', { email: email.trim(), password: senha });
  // os campos são limpos nos DOIS desfechos: senha digitada não fica na tela esperando
  const campoSenha = $('#syncSenha');
  if (campoSenha) campoSenha.value = '';
  if (r && r.ok) toast('ok', '✓ Conectado ao Firebase', 3000);
  else toast('error', `Não deu pra entrar: ${(r && r.motivo) || 'o servidor não respondeu'}`, 7000);
  renderSync();
}

async function syncTestar() {
  const out = $('#syncTestOut');
  if (out) out.textContent = 'testando…';
  const r = await api('/api/sync/test', {});
  if (!out) return;
  if (r && r.ok) {
    out.className = 'teste ok';
    out.textContent = `respondeu agora, ${r.devices} aparelho(s) neste banco`;
    return;
  }
  out.className = 'teste ruim';
  out.textContent = (r && r.motivo) || 'não respondeu';
}

async function syncSair() {
  await api('/api/sync/logout', {});
  toast('info', 'Este aparelho saiu do Firebase. Nada local foi apagado.', 4000);
  renderSync();
}

async function syncApagarRemoto() {
  const ok = await confirmModal({
    danger: true,
    title: 'Apagar dados sincronizados?',
    confirmLabel: 'Apagar do Firebase',
    body: `<p>Apaga do seu Firebase os aparelhos, as coordenações e o consumo enviado por <b>todos</b> os aparelhos.</p>
      <p>Nenhum arquivo local é tocado: o histórico de cada aparelho continua nele. A sincronização segue ligada e recomeça do zero.</p>`,
  });
  if (!ok) return;
  const r = await api('/api/sync/erase-remote', {});
  if (r && r.ok) toast('ok', '✓ Dados sincronizados apagados do Firebase', 4000);
  else toast('error', `Não deu pra apagar: ${(r && r.motivo) || 'o servidor não respondeu'}`, 7000);
  renderSync();
}

/* "Refazer neste aparelho" APAGA a prova de que uma análise foi feita, então ele
   confirma sempre, nomeando o aparelho e o custo. O engine ainda recusa por conta
   própria se o recibo tiver deixado de ser órfão entre a tela e o clique. */
async function syncRefazer(key) {
  const r = ((STATE && STATE.sync && STATE.sync.recibosVistos) || {})[key] || {};
  const onde = esc(r.deviceName || 'outro aparelho');
  const ok = await confirmModal({
    title: 'Refazer este commit neste aparelho?',
    confirmLabel: 'Refazer neste aparelho',
    body: `<p><code>${esc(key)}</code> já foi analisado no <b>${onde}</b> neste commit, e o resultado só existe lá.</p>
      <p>Refazer aqui abre uma sessão nova e consome tokens. Se o ${onde} voltar, ele confere antes de postar e não publica por cima.</p>`,
  });
  if (!ok) return;
  const resp = await api('/api/sync/redo', { key });
  if (resp && resp.ok) toast('ok', `✓ ${key} relançado neste aparelho`, 4000);
  else toast('error', `Não deu pra refazer: ${(resp && resp.motivo) || 'o servidor não respondeu'}`, 7000);
  renderSync();
}

$('#syncManager').addEventListener('click', (e) => {
  const redo = e.target.closest('.sync-redo');
  if (redo) { syncRefazer(redo.dataset.key); return; }
  const b = e.target.closest('button');
  if (!b) return;
  if (b.id === 'syncLogin') syncFazerLogin();
  else if (b.id === 'syncLogout') syncSair();
  else if (b.id === 'syncTest') syncTestar();
  else if (b.id === 'syncErase') syncApagarRemoto();
});

$('#syncManager').addEventListener('change', (e) => {
  const t = e.target;
  if (t.type === 'checkbox' && t.id.startsWith('setSync')) { syncToggle(t.id, t.checked); return; }
  if (t.id && t.id.startsWith('sync')) syncCampoSalvar(t.id, String(t.value || '').trim());
});

/* ---------- tema ---------- */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
```

4. Localize:

```js
  if (name === 'entregas') loadDeliveries();
  if (name === 'destaques') { loadHighlights(); renderTools(); }   // renderTools: kudos do escopo atual, não o defasado
  if (name === 'time') loadTeam();
  if (name === 'sistema') { switchSistemaSection(); loadLog(); renderDoctor(); renderAccountsManager(); renderClaudeProfiles(); renderJiraSites(); loadReviewerCands(); }
  if (name === 'consumo') renderUsage();
}
$('#nav').addEventListener('click', (e) => {
```

   Troque por:

```js
  if (name === 'entregas') loadDeliveries();
  if (name === 'destaques') { loadHighlights(); renderTools(); }   // renderTools: kudos do escopo atual, não o defasado
  if (name === 'time') loadTeam();
  if (name === 'sistema') { switchSistemaSection(); loadLog(); renderDoctor(); renderAccountsManager(); renderClaudeProfiles(); renderJiraSites(); renderSync(); loadReviewerCands(); }
  if (name === 'consumo') renderUsage();
}
$('#nav').addEventListener('click', (e) => {
```

5. Localize:

```js
    return;
  }
  const parked = STATE.parked || {};
  box.innerHTML = q.map(pr => queueCardHtml(pr, { people, mark: acctMark(pr), parked })).join('');
}

/* selo de estado da SUA revisão numa linha do panorama: primeiro o que o Farol
```

   Troque por:

```js
    return;
  }
  const parked = STATE.parked || {};
  box.innerHTML = q.map(pr => queueCardHtml(pr, { people, mark: acctMark(pr), parked, sync: STATE.sync })).join('');
}

/* selo de estado da SUA revisão numa linha do panorama: primeiro o que o Farol
```

6. Localize:

```js

function renderUsage() {
  renderFilaJusta();
  const u = STATE && STATE.usage;
  const kpisEl = $('#usageKpis'), tl = $('#usageTimeline'), legend = $('#usageLegend');
  const matrix = $('#usageMatrix'), matrixCap = $('#usageMatrixCaption');
```

   Troque por:

```js

function renderUsage() {
  renderFilaJusta();
  renderUsageDeviceSeg();
  const consolidado = usageDeviceState.escopo === 'todos';
  const painelLocal = $('#usageLocal');
  const painelTodos = $('#usageConsolidado');
  if (painelLocal) painelLocal.hidden = consolidado;
  if (painelTodos) painelTodos.hidden = !consolidado;
  if (consolidado) { renderUsageConsolidado(); return; }
  const u = STATE && STATE.usage;
  const kpisEl = $('#usageKpis'), tl = $('#usageTimeline'), legend = $('#usageLegend');
  const matrix = $('#usageMatrix'), matrixCap = $('#usageMatrixCaption');
```

7. Localize:

```js
  sessions.innerHTML = usageSessionsHtml(u || {});
}

function wireUsageControls() {
  const bind = (sel, attr, key, cast) => {
    const box = document.querySelector(sel); if (!box) return;
```

   Troque por:

```js
  sessions.innerHTML = usageSessionsHtml(u || {});
}


/* ---------- coordenação no clique Revisar (U2) ----------

   A resposta de /api/review traz `coordenacao[]` quando o preflight segurou algum PR.
   A ESCOLHA do desfecho por motivo é pura (syncConfirmacaoDoClique, em ui/pure.js);
   aqui fica só o modal e o reenvio. O override é reenviado por PR, e só pelo PR que
   a pessoa confirmou: mandar o lote inteiro com a flag contornaria a coordenação de
   PRs que ninguém confirmou. */
async function tratarCoordenacaoDoClique(resp, mode) {
  for (const c of syncConfirmacoesDoClique(resp)) {
    if (c.tipo === 'aviso') { toast('info', c.texto, 7000); continue; }
    const pr = (STATE.queue || []).concat(STATE.panorama || []).find(p => p.key === c.key);
    if (!pr) { toast('info', `${c.key}: a coordenação segurou a revisão, e o PR não está mais na tela.`, 6000); continue; }
    // eslint-disable-next-line no-await-in-loop -- uma confirmação por vez é o ponto: são modais
    const ok = await confirmModal({ title: c.titulo, confirmLabel: c.acao, body: c.corpo });
    if (ok) revisarUrls([pr.url], { [c.override]: true }, mode);
  }
}

/* Boca ÚNICA do clique Revisar. Todos os caminhos (fila, panorama, "revisar de novo",
   revisar tudo, terminal) passam por aqui, pela mesma razão do enqueueHeadless no
   engine: garantia que precisa valer sempre mora no estrangulamento, e não em cada
   chamador. Sem isto, o botão que alguém acrescentasse amanhã ignoraria a confirmação
   da coordenação em silêncio. */
function revisarUrls(urls, extras = {}, mode = 'auto') {
  const corpo = { urls, ...extras };
  if (mode === 'terminal') corpo.mode = 'terminal';
  return api('/api/review', corpo).then(r => {
    if (r && Array.isArray(r.coordenacao) && r.coordenacao.length) tratarCoordenacaoDoClique(r, mode);
    return r;
  });
}

/* ---------- Consumo: este aparelho x todos os aparelhos (U4) ----------

   "Este aparelho" volta ao renderUsage de sempre, sem NENHUMA diferença: a consolidação
   é uma segunda visão, nunca uma reescrita da primeira. O segmentado só existe com a
   consolidação ligada, porque sem ela não há o que consolidar. */
const usageDeviceState = { escopo: 'este' };

function usageConsolidadoVisivel() {
  return !!(STATE && STATE.sync && STATE.sync.consolidation);
}

function renderUsageDeviceSeg() {
  const box = $('#usageDevice');
  if (!box) return;
  box.hidden = !usageConsolidadoVisivel();
  // consolidação desligada no meio do caminho: a visão volta pra deste aparelho, senão
  // a tela ficaria presa numa aba que não pode mais buscar nada
  if (box.hidden && usageDeviceState.escopo !== 'este') usageDeviceState.escopo = 'este';
}

async function renderUsageConsolidado() {
  const alvo = $('#usageConsolidado');
  if (!alvo) return;
  alvo.innerHTML = '<p class="vago">Buscando o consumo de todos os aparelhos…</p>';
  const janela = usageState.window;
  const r = await get(`/api/sync/consolidated?days=${encodeURIComponent(janela)}`);
  // a janela pode ter mudado enquanto a busca corria: resposta velha não pinta a tela
  if (usageDeviceState.escopo !== 'todos' || usageState.window !== janela) return;
  alvo.innerHTML = usageConsolidadoEnvelopeHtml(r);
}

function wireUsageControls() {
  const bind = (sel, attr, key, cast) => {
    const box = document.querySelector(sel); if (!box) return;
```

8. Localize:

```js
  bind('#usageMetric', 'metric', 'metric');
  bind('#usageWindow', 'window', 'window', Number);
  bind('#usageStack', 'dim', 'dim');
}
wireUsageControls();

```

   Troque por:

```js
  bind('#usageMetric', 'metric', 'metric');
  bind('#usageWindow', 'window', 'window', Number);
  bind('#usageStack', 'dim', 'dim');
  const dev = document.querySelector('#usageDevice');
  if (dev) {
    dev.querySelectorAll('.seg-btn').forEach(b => b.addEventListener('click', () => {
      marcarSeg(dev.querySelectorAll('.seg-btn'), x => x === b);
      usageDeviceState.escopo = b.dataset.escopo;
      renderUsage();
    }));
  }
}
wireUsageControls();

```

9. Localize:

```js
  renderReviewersEditor();
  renderClaudeProfiles();
  renderJiraSites();
  $('#setInterval').value = String(c.intervalSeconds);
  $('#setParallelReviews').value = String(c.parallelReviews || 1);
  // teto global: 0 = desligado, e o `|| 0` do default cai certo nele de propósito
```

   Troque por:

```js
  renderReviewersEditor();
  renderClaudeProfiles();
  renderJiraSites();
  renderSync();
  $('#setInterval').value = String(c.intervalSeconds);
  $('#setParallelReviews').value = String(c.parallelReviews || 1);
  // teto global: 0 = desligado, e o `|| 0` do default cai certo nele de propósito
```

10. Localize:

```js
  // (mandar {} fazia o servidor revisar a fila INTEIRA, achado B22)
  const urls = (STATE.queue || []).filter(scopeVisible).map(p => p.url);
  if (!urls.length) { toast('info', 'Nada visível pra revisar agora (a fila mudou embaixo do botão).'); return; }
  api('/api/review', { urls });
};

/* tweaks de exibição (guardados no navegador, não vão pro engine) */
```

   Troque por:

```js
  // (mandar {} fazia o servidor revisar a fila INTEIRA, achado B22)
  const urls = (STATE.queue || []).filter(scopeVisible).map(p => p.url);
  if (!urls.length) { toast('info', 'Nada visível pra revisar agora (a fila mudou embaixo do botão).'); return; }
  revisarUrls(urls);
};

/* tweaks de exibição (guardados no navegador, não vão pro engine) */
```

11. Localize:

```js
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Revisando…';
    api('/api/review', { urls: [btn.dataset.url] });
    return;
  }
  // .act-chat é ouvido globalmente (document); só o copiar precisa de listener aqui,
```

   Troque por:

```js
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Revisando…';
    revisarUrls([btn.dataset.url]);
    return;
  }
  // .act-chat é ouvido globalmente (document); só o copiar precisa de listener aqui,
```

12. Localize:

```js

$('#queue').addEventListener('click', (e) => {
  const rev = e.target.closest('.act-review');
  if (rev) { api('/api/review', { urls: [rev.dataset.url] }); return; }
  const term = e.target.closest('.act-terminal');
  if (term) { api('/api/review', { urls: [term.dataset.url], mode: 'terminal' }); return; }
  const ign = e.target.closest('.act-ignore');
  if (ign) {
    const key = ign.dataset.key;
```

   Troque por:

```js

$('#queue').addEventListener('click', (e) => {
  const rev = e.target.closest('.act-review');
  if (rev) { revisarUrls([rev.dataset.url]); return; }
  const term = e.target.closest('.act-terminal');
  if (term) { revisarUrls([term.dataset.url], {}, 'terminal'); return; }
  const ign = e.target.closest('.act-ignore');
  if (ign) {
    const key = ign.dataset.key;
```

13. Localize:

```js
  // global (cada seção escuta o seu, ver #resolved), e o card bloqueado por head
  // velho é o único caso em que ele aparece aqui: o round novo substitui este card.
  const rev = e.target.closest('.act-review');
  if (rev) { rev.disabled = true; api('/api/review', { urls: [rev.dataset.url] }); return; }
  const btn = e.target.closest('.dec-act');
  if (!btn) return;
  const id = btn.closest('.decision').dataset.id;
```

   Troque por:

```js
  // global (cada seção escuta o seu, ver #resolved), e o card bloqueado por head
  // velho é o único caso em que ele aparece aqui: o round novo substitui este card.
  const rev = e.target.closest('.act-review');
  if (rev) { rev.disabled = true; revisarUrls([rev.dataset.url]); return; }
  const btn = e.target.closest('.dec-act');
  if (!btn) return;
  const id = btn.closest('.decision').dataset.id;
```

14. Localize:

```js
    renderRadarNav();
    syncAnalysisOps();
    renderSettings(); renderTools(); renderUpdate(); tickCountdown();
    if ($('#tab-sistema').classList.contains('active')) { renderDoctor(); renderAccountsManager(); renderClaudeProfiles(); renderJiraSites(); }
    if ($('#tab-consumo').classList.contains('active')) renderUsage();
  });
  es.addEventListener('activity', (e) => {
```

   Troque por:

```js
    renderRadarNav();
    syncAnalysisOps();
    renderSettings(); renderTools(); renderUpdate(); tickCountdown();
    if ($('#tab-sistema').classList.contains('active')) { renderDoctor(); renderAccountsManager(); renderClaudeProfiles(); renderJiraSites(); renderSync(); }
    if ($('#tab-consumo').classList.contains('active')) renderUsage();
  });
  es.addEventListener('activity', (e) => {
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('ui/app.js')).digest('hex').slice(0,16))"
```

Esperado: `a2afa177fe15d0fe`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

Em `ui/index.html`, aplique as 4 substituições abaixo, NA ORDEM. Cada trecho "localize" aparece exatamente uma vez no arquivo no momento em que você aplica aquela substituição; copie-o sem mudar espaço nem acento.

1. Localize:

```html
  <section id="tab-consumo" class="tabpane" role="tabpanel" aria-labelledby="tabbtn-consumo" tabindex="0">
    <div class="section-head">
      <h2>Consumo</h2>
    </div>
    <p class="section-desc">Quanto as sessões autônomas do Claude (revisão, autoanálise, pushback, ferramentas e chat) consomem, em tokens e custo estimado. Mede o Farol como um todo. Registro pessoal e permanente; não influencia nenhuma decisão da automação.</p>

    <div id="usageKpis" class="usage-kpis"></div>

    <!-- Justica de fila (spec 2026-09-10-justica-de-fila-entre-orgs): torna VISIVEL o
```

   Troque por:

```html
  <section id="tab-consumo" class="tabpane" role="tabpanel" aria-labelledby="tabbtn-consumo" tabindex="0">
    <div class="section-head">
      <h2>Consumo</h2>
      <!-- Segmentado da consolidação (T24). Só aparece com a consolidação ligada:
           sem ela não há nada de outros aparelhos pra mostrar, e um botão que não faz
           nada é pior que botão nenhum. -->
      <div class="seg" id="usageDevice" role="group" aria-label="Aparelhos" hidden>
        <button class="seg-btn active" data-escopo="este" aria-pressed="true">Este aparelho</button>
        <button class="seg-btn" data-escopo="todos" aria-pressed="false">Todos os aparelhos</button>
      </div>
    </div>
    <p class="section-desc">Quanto as sessões autônomas do Claude (revisão, autoanálise, pushback, ferramentas e chat) consomem, em tokens e custo estimado. Mede o Farol como um todo. Registro pessoal e permanente; não influencia nenhuma decisão da automação.</p>

    <!-- "Todos os aparelhos" é uma SEGUNDA visão, nunca uma reescrita da primeira:
         "Este aparelho" volta ao painel de sempre, sem nenhuma diferença. -->
    <div id="usageConsolidado" hidden></div>
    <div id="usageLocal">
    <div id="usageKpis" class="usage-kpis"></div>

    <!-- Justica de fila (spec 2026-09-10-justica-de-fila-entre-orgs): torna VISIVEL o
```

2. Localize:

```html
      </div>
      <div id="usageSessions" class="usage-sessions-wrap"></div>
    </div>
  </section>

  <!-- ============ SISTEMA ============ -->
```

   Troque por:

```html
      </div>
      <div id="usageSessions" class="usage-sessions-wrap"></div>
    </div>
    </div>
  </section>

  <!-- ============ SISTEMA ============ -->
```

3. Localize:

```html
            <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="3" y="4.5" width="18" height="15" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 9.5h18M8 14h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            Jira
          </button>
          <button class="sys-nav-item" id="sysbtn-plans" data-section="plans" role="tab" aria-selected="false" aria-controls="sys-plans">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78m.27-2.34L19.07 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M17 8l-1.5 1.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            Plano e chaves
```

   Troque por:

```html
            <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="3" y="4.5" width="18" height="15" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 9.5h18M8 14h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            Jira
          </button>
          <button class="sys-nav-item" id="sysbtn-sync" data-section="sync" role="tab" aria-selected="false" aria-controls="sys-sync">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M21 12a9 9 0 0 1-9 9 9 9 0 0 1-7.5-4M3 12a9 9 0 0 1 9-9 9 9 0 0 1 7.5 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M19.5 3v4h-4M4.5 21v-4h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Sincronização
          </button>
          <button class="sys-nav-item" id="sysbtn-plans" data-section="plans" role="tab" aria-selected="false" aria-controls="sys-plans">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78m.27-2.34L19.07 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M17 8l-1.5 1.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            Plano e chaves
```

4. Localize:

```html
          <div id="jiraSitesManager" class="cards"></div>
        </div>

        <!-- Plano e chaves -->
        <div class="sys-section" id="sys-plans" role="tabpanel" aria-labelledby="sysbtn-plans" tabindex="0">
          <div class="section-head"><h2>Plano e chaves</h2></div>
```

   Troque por:

```html
          <div id="jiraSitesManager" class="cards"></div>
        </div>

        <!-- Sincronização entre dispositivos -->
        <div class="sys-section" id="sys-sync" role="tabpanel" aria-labelledby="sysbtn-sync" tabindex="0">
          <div class="section-head"><h2>Sincronização entre dispositivos</h2></div>
          <p class="section-desc">Opcional. Evita que dois aparelhos seus revisem o mesmo PR e mostra o consumo de todos juntos. Cada aparelho continua com o próprio histórico e funciona sem internet.</p>
          <div class="callout info">
            <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="8" cy="8" r="6"/><path d="M8 7.4v3.8M8 5.1v.6" stroke-linecap="round"/></svg>
            <span><b>Nenhum prompt, diff ou relatório sai daqui.</b> Sobem hashes do PR, o aparelho que está com ele e os números de consumo. O nome do repositório e o título do PR nunca são enviados.</span>
          </div>
          <div id="syncManager"></div>
        </div>

        <!-- Plano e chaves -->
        <div class="sys-section" id="sys-plans" role="tabpanel" aria-labelledby="sysbtn-plans" tabindex="0">
          <div class="section-head"><h2>Plano e chaves</h2></div>
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('ui/index.html')).digest('hex').slice(0,16))"
```

Esperado: `24fe4d19098498ef`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

Em `ui/pure.js`, aplique as 3 substituições abaixo, NA ORDEM. Cada trecho "localize" aparece exatamente uma vez no arquivo no momento em que você aplica aquela substituição; copie-o sem mudar espaço nem acento.

1. Localize:

```js
  const seloRascunho = pr.isDraft ? '<span class="badge">rascunho</span>' : '';
  const seloRepedida = pr.reRequested ? '<span class="badge rev-pend">pedida de novo</span>' : '';
  const papel = pr.author ? ` ${papelPicker(pr.author, ctx.people)}` : '';
  const parked = parkedNoteHtml((ctx.parked || {})[pr.key]);
  return `
    <div class="card pr-card urgent" data-key="${esc(pr.key)}" data-url="${esc(pr.url)}" style="${m.style}">
      ${m.dot}${avatar(pr.author)}
```

   Troque por:

```js
  const seloRascunho = pr.isDraft ? '<span class="badge">rascunho</span>' : '';
  const seloRepedida = pr.reRequested ? '<span class="badge rev-pend">pedida de novo</span>' : '';
  const papel = pr.author ? ` ${papelPicker(pr.author, ctx.people)}` : '';
  // estacionamento VENCE a coordenação quando os dois valem: ele é falha e exige ação
  // sua, a espera se resolve sozinha. Duas notas no mesmo card competiriam por atenção
  // e a mais urgente perderia.
  const parked = parkedNoteHtml((ctx.parked || {})[pr.key]);
  const coord = parked ? '' : prCoordNoteHtml(pr.key, ctx.sync);
  return `
    <div class="card pr-card urgent" data-key="${esc(pr.key)}" data-url="${esc(pr.url)}" style="${m.style}">
      ${m.dot}${avatar(pr.author)}
```

2. Localize:

```js
        <div class="pr-ref"><a href="${esc(pr.url)}" target="_blank" rel="noreferrer">${esc(pr.key)}</a>${m.chip}${seloRascunho}${seloRepedida}</div>
        <div class="pr-title" title="${esc(pr.title)}">${esc(pr.title)}</div>
        <div class="pr-sub">${personMention(pr.author, 'xs')} · atualizado ${fmtRel(pr.updatedAt)}${papel}</div>
        ${parked}
      </div>
      <div class="pr-actions">
        <button class="btn primary sm act-review" data-url="${esc(pr.url)}">Revisar</button>
```

   Troque por:

```js
        <div class="pr-ref"><a href="${esc(pr.url)}" target="_blank" rel="noreferrer">${esc(pr.key)}</a>${m.chip}${seloRascunho}${seloRepedida}</div>
        <div class="pr-title" title="${esc(pr.title)}">${esc(pr.title)}</div>
        <div class="pr-sub">${personMention(pr.author, 'xs')} · atualizado ${fmtRel(pr.updatedAt)}${papel}</div>
        ${parked}${coord}
      </div>
      <div class="pr-actions">
        <button class="btn primary sm act-review" data-url="${esc(pr.url)}">Revisar</button>
```

3. Localize:

```js
  // e um perfil só não têm rodízio nenhum pra explicar, e um card vazio parece defeito.
  return corpo;
}
```

   Troque por:

```js
  // e um perfil só não têm rodízio nenhum pra explicar, e um card vazio parece defeito.
  return corpo;
}

/* ---------- Sincronização entre dispositivos (Sistema > Sincronização) ----------

   Tudo aqui é PURO: recebe a projeção `STATE.sync` (statusForUi, em lib/engine/sync.js)
   e a config, e devolve texto ou HTML. A seção usa os tokens de ui/app.css e as classes
   que o resto do app já tem (.card, .set-list, .set-row, .switch, .callout, .btn, .chip);
   o prefixo .sync- fica só no que é novo.

   A cor da coordenação é DELIBERADA: azul para espera, âmbar para atenção, e nunca o
   vermelho do estacionamento. Segurar um PR porque outro aparelho está com ele não é
   falha, e pintar de vermelho faria procurar defeito onde não há. */

const SYNC_SELOS = {
  desligada: { classe: 'mute', texto: 'desligada' },
  'sem-login': { classe: 'warn', texto: 'falta o login' },
  entrando: { classe: 'info', texto: 'entrando' },
  conectada: { classe: 'ok', texto: 'conectado' },
  degradada: { classe: 'warn', texto: 'coordenação indisponível' },
  'login-expirado': { classe: 'bad', texto: 'login expirado' },
};
const SYNC_BORDA = { desligada: 'off', 'sem-login': 'warn', entrando: 'warn', conectada: '', degradada: 'warn', 'login-expirado': 'bad' };
// o Firebase recusou a credencial guardada: é o único erro que se resolve entrando de
// novo, e por isso o único que vira "login expirado" em vez de indisponibilidade
const SYNC_ERROS_DE_LOGIN = new Set(['credencial_invalida', 'sem_credencial']);

// UM estado, derivado do runtime, porque a tela precisava escolher entre seis em três
// lugares diferentes (selo, borda do cartão e corpo), e três derivações separadas
// divergiriam na primeira mudança.
export function syncEstado(sync) {
  const s = sync || {};
  if (s.enabled !== true || s.status === 'desligado') return 'desligada';
  if (s.status === 'conectado') return 'conectada';
  if (s.status === 'conectando') return 'entrando';
  if (s.status === 'sem-credencial') return 'sem-login';
  const code = (s.lastError && s.lastError.code) || '';
  return SYNC_ERROS_DE_LOGIN.has(code) ? 'login-expirado' : 'degradada';
}

export function syncSeloHtml(estado) {
  const selo = SYNC_SELOS[estado] || SYNC_SELOS.desligada;
  return `<span class="sync-chip ${selo.classe}">${esc(selo.texto)}</span>`;
}

export function syncClasseCartao(estado) {
  const b = SYNC_BORDA[estado];
  return b === undefined ? 'off' : b;
}

/* Os três interruptores. A chave geral manda nos outros dois: com ela desligada este
   Farol não fala com o Firebase, então oferecer as sub-chaves ativas prometeria um
   efeito que não existe. */
// o .switch tem que ser IRMÃO IMEDIATO do input, senão ele para de refletir o estado
// sem erro nenhum (salva certo e parece desligado); ver o comentário em ui/app.css
function syncSubToggle(id, ligada, on, titulo, desc) {
  const classe = ligada ? '' : ' off';
  const marcado = on ? ' checked' : '';
  const travado = ligada ? '' : ' disabled';
  return `<label class="set-row${classe}" id="sys-row-${esc(id)}">
      <span class="set-txt"><span class="set-title">${esc(titulo)}</span><span class="set-desc">${esc(desc)}</span></span>
      <span class="set-ctl"><input type="checkbox" id="${esc(id)}"${marcado}${travado}><span class="switch"></span></span>
    </label>`;
}

export function syncTogglesHtml(cfg) {
  const c = cfg || {};
  const geral = c.enabled === true;
  const coord = geral && !!(c.coordination && c.coordination.enabled === true);
  const cons = geral && !!(c.consolidation && c.consolidation.enabled === true);
  return `<div class="card set-list">
    <label class="set-row" id="sys-row-setSyncEnabled">
      <span class="set-txt"><span class="set-title">Sincronizar entre dispositivos</span><span class="set-desc">Chave geral. Desligada, este Farol não fala com o Firebase: nenhuma conexão, nenhum envio, nenhuma consulta.</span></span>
      <span class="set-ctl"><input type="checkbox" id="setSyncEnabled"${geral ? ' checked' : ''}><span class="switch"></span></span>
    </label>
    ${syncSubToggle('setSyncCoordination', geral, coord, 'Evitar análises simultâneas', 'Antes de abrir uma revisão, autoanálise ou classificação de pushback automática, confere se outro aparelho seu já cuidou daquele PR neste commit. Se já cuidou, nenhuma sessão nasce aqui.')}
    ${syncSubToggle('setSyncConsolidation', geral, cons, 'Consolidar histórico de consumo', 'Envia tokens, custo e desfecho de cada sessão, sem prompt, diff ou relatório, pra aba Consumo mostrar todos os aparelhos juntos. O histórico deste aparelho continua aqui do jeito que está.')}
  </div>`;
}

function syncCampo(id, rotulo, valor, dica) {
  return `<div class="sync-campo">
    <label for="${esc(id)}">${esc(rotulo)}</label>
    <input id="${esc(id)}" type="text" class="sync-input" value="${esc(valor || '')}" spellcheck="false" autocomplete="off">
    <span class="sync-dica">${esc(dica)}</span>
  </div>`;
}

/* O bloco de login. Conectado mostra quem é e o botão de sair; desconectado pede e-mail
   e senha. A senha é `type="password"`, lida do DOM na hora e nunca guardada: o engine
   troca por um acesso renovável, e só ele vai pro disco. */
export function syncContaHtml(sync) {
  const s = sync || {};
  const estado = syncEstado(s);
  if (estado === 'conectada' || estado === 'entrando') {
    const quem = s.email ? `<span class="sync-quem">${esc(s.email)}</span>` : '<span class="sync-vago">sem e-mail</span>';
    return `<div class="sync-conta">
      <div class="sync-conta-topo"><span class="sync-conta-titulo">Login no Firebase</span><span class="sync-conta-onde">sync-credentials.json</span></div>
      <div class="sync-conta-corpo">
        <span>Conectado como ${quem}. A senha não fica guardada; só o acesso renovável, fora do <code>config.json</code>.</span>
        <span class="sync-espaco"></span>
        <button class="btn sm danger-ghost" id="syncLogout">Sair deste aparelho</button>
      </div>
    </div>`;
  }
  const aviso = estado === 'login-expirado'
    ? '<p class="sync-conta-nota sync-conta-nota-ruim">O Firebase recusou o acesso guardado. Enquanto isso a automação espera.</p>'
    : '';
  const rotulo = estado === 'login-expirado' ? 'Entrar de novo' : 'Entrar';
  return `<div class="sync-conta">
    <div class="sync-conta-topo warn"><span class="sync-conta-titulo">Login no Firebase</span><span class="sync-conta-onde">o mesmo usuário em todos os aparelhos</span></div>
    <div class="sync-conta-corpo">
      <span class="sync-campo"><label for="syncEmail">E-mail</label><input id="syncEmail" class="sync-input" type="email" placeholder="voce@exemplo.com" spellcheck="false" autocomplete="off"></span>
      <span class="sync-campo"><label for="syncSenha">Senha</label><input id="syncSenha" class="sync-input" type="password" placeholder="senha do Firebase" autocomplete="off"></span>
      <button class="btn sm primary" id="syncLogin">${rotulo}</button>
    </div>
    ${aviso}
    <p class="sync-conta-nota">Crie o usuário uma vez no console do Firebase (Authentication, provedor e-mail e senha) e entre com ele em cada aparelho. A senha é usada só agora e não é gravada.</p>
  </div>`;
}

/* A linha do envio do histórico. Só existe com a consolidação ligada E com a outbox já
   reconciliada: antes disso não há número honesto a mostrar, e o `null` diz isso. */
export function syncEnvioHtml(sync) {
  const s = sync || {};
  if (!s.consolidation || !s.outbox) return '';
  const o = s.outbox;
  if (o.paused) return `<span class="sync-teste ruim">envio do histórico pausado, ${fmtTok(o.pendentes)} pendente(s)</span>`;
  if (o.pendentes > 0) return `<span class="sync-teste">enviando o histórico de consumo: ${fmtTok(o.pendentes)} pendente(s), ${fmtTok(o.rejeitados)} recusada(s)</span>`;
  const quando = o.lastSentAt ? fmtWhenDay(o.lastSentAt) : 'ainda não';
  return `<span class="sync-teste ok">histórico enviado ${esc(quando)}, nada pendente</span>`;
}

export function syncConexaoHtml(sync, cfg) {
  const s = sync || {};
  const c = cfg || {};
  const estado = syncEstado(s);
  const campos = `<div class="sync-corpo">
    ${syncCampo('syncApiKey', 'Chave web do projeto', c.apiKey, 'em Configurações do projeto, no Firebase')}
    ${syncCampo('syncDatabaseUrl', 'URL do banco', c.databaseUrl, 'Realtime Database')}
    ${syncCampo('syncDeviceName', 'Nome deste aparelho', c.deviceName, 'é como os outros aparelhos o chamam')}
  </div>`;
  const motivo = (s.lastError && s.lastError.motivo) || 'A coordenação está indisponível.';
  const degradada = estado === 'degradada'
    ? `<div class="callout warn sync-degradada"><span><b>O Firebase não respondeu no último ciclo:</b> ${esc(motivo)}. A revisão automática espera a conexão voltar, sem gastar sessão. O clique manual continua podendo executar, com confirmação.</span></div>`
    : '';
  return `<div class="card sync-card ${syncClasseCartao(estado)}">
    <div class="sync-topo"><span class="sync-titulo">Firebase pessoal</span><span class="sync-espaco"></span>${syncSeloHtml(estado)}</div>
    ${campos}
    ${degradada}
    ${syncContaHtml(s)}
    <div class="sync-rodape">
      <button class="btn sm" id="syncTest">Testar conexão</button>
      <span class="sync-teste" id="syncTestOut"></span>
      ${syncEnvioHtml(s)}
      <span class="sync-espaco"></span>
      <button class="btn sm danger-ghost" id="syncErase">Apagar dados sincronizados</button>
    </div>
  </div>`;
}

export function syncAparelhosHtml(devices, agora = Date.now()) {
  const lista = Array.isArray(devices) ? devices : [];
  if (!lista.length) return '<div class="card sync-lista"><p class="sync-vago sync-vazio">Nenhum aparelho registrado ainda. O primeiro aparece assim que a conexão sobe.</p></div>';
  const linhas = lista.map((d) => {
    const eu = d.euMesmo ? ' <span class="sync-chip mute">este</span>' : '';
    const visto = d.lastSeenAt ? fmtWhenDay(d.lastSeenAt, agora) : 'nunca';
    return `<div class="sync-linha"><span class="sync-nome">${esc(d.name || d.deviceId || 'aparelho')}${eu}</span><span class="sync-fraco">${esc(d.platform || '')}</span><span class="sync-fraco">${esc(visto)}</span></div>`;
  }).join('');
  return `<div class="card sync-lista">
    <div class="sync-linha sync-head"><span>aparelho</span><span>sistema</span><span>visto por último</span></div>
    ${linhas}
  </div>`;
}

// Uma linha por PR que a coordenação está segurando ou que já foi analisado em outro
// aparelho. O recibo ÓRFÃO é o único que ganha botão: refazer um recibo vivo apagaria a
// prova de uma análise que ainda vale (ver recusaDoRefazer, em lib/engine/sync-redo.js).
function syncLinhaLease(key, v) {
  const onde = v.deviceName || 'outro aparelho';
  const desde = v.since ? ` desde ${esc(fmtClock(v.since))}` : '';
  return `<div class="sync-coord"><span><span class="sync-ref">${esc(key)}</span><span class="sync-o-que">sendo analisado no ${esc(onde)}${desde}; este aparelho espera</span></span><span class="sync-chip info">em outro aparelho</span></div>`;
}

function syncLinhaRecibo(key, r) {
  const onde = r.deviceName || 'outro aparelho';
  const quando = r.at ? ` em ${esc(fmtWhenDay(r.at))}` : '';
  if (r.orfao === 'orfao') {
    return `<div class="sync-coord"><span><span class="sync-ref">${esc(key)}</span><span class="sync-o-que sync-orfao">pendente no ${esc(onde)}${quando}, sem atividade há dias; o resultado só existe lá</span></span><button class="btn sm sync-redo" data-key="${esc(key)}">Refazer neste aparelho</button></div>`;
  }
  return `<div class="sync-coord"><span><span class="sync-ref">${esc(key)}</span><span class="sync-o-que">analisado no ${esc(onde)}${quando} neste commit</span></span><span class="sync-chip mute">pendente lá</span></div>`;
}

export function syncCoordenacaoHtml(sync) {
  const s = sync || {};
  if (!s.coordination) return '';
  const leases = s.leasesVistos || {};
  const recibos = s.recibosVistos || {};
  const linhas = [
    ...Object.entries(leases).map(([k, v]) => syncLinhaLease(k, v || {})),
    ...Object.entries(recibos).map(([k, v]) => syncLinhaRecibo(k, v || {})),
  ];
  const outros = Number(s.leasesOutros) || 0;
  // PR que ESTE aparelho não acompanha nunca é nomeado: o nome do PR não sobe pro banco
  // (D6), então a tela só consegue contá-lo
  const nota = outros > 0 ? `<p class="sync-legenda sync-outros">e mais ${fmtTok(outros)} em PR que este aparelho não acompanha</p>` : '';
  const corpo = linhas.length || nota
    ? `${linhas.join('')}${nota}`
    : '<p class="sync-vago sync-vazio">Nenhum PR seu está sendo analisado em outro aparelho agora.</p>';
  return `<div class="sync-sub-head">Coordenação agora</div><div class="card sync-lista">${corpo}</div>`;
}

export function syncSecaoHtml(sync, cfg) {
  const s = sync || {};
  if (!(cfg && cfg.enabled === true)) return syncTogglesHtml(cfg);
  return `${syncTogglesHtml(cfg)}
    <div class="sync-sub-head">Conexão</div>
    ${syncConexaoHtml(s, cfg)}
    <div class="sync-sub-head">Aparelhos</div>
    ${syncAparelhosHtml(s.devices)}
    ${syncCoordenacaoHtml(s)}`;
}


/* A resposta de /api/review traz `coordenacao[]` quando o preflight do clique segurou
   algum PR. Cada motivo tem um desfecho DIFERENTE, e é essa escolha que mora aqui:

   - `indisponivel`: o banco não respondeu, então este aparelho não SABE se outro está
     revisando. Dá pra seguir assumindo o risco, com confirmação.
   - `recibo`: outro aparelho já analisou este commit. Refazer é legítimo (o resultado
     só existe lá), mas custa uma sessão nova, então também confirma.
   - `alheio`: outro aparelho está com o PR AGORA. Não existe override, e é de propósito:
     o Farol nunca toma uma análise em andamento. Só avisa quem está com ele.

   Motivo desconhecido cai no aviso, nunca num override: contornar a coordenação por
   um motivo que a tela não entende seria exatamente o contrário do que ela existe pra
   fazer. */
const SYNC_CONFIRMACOES = {
  indisponivel: {
    override: 'semCoordenacao',
    titulo: 'Revisar sem coordenação?',
    acao: 'Revisar mesmo assim',
  },
  recibo: {
    override: 'ignorarRecibo',
    titulo: 'Revisar de novo este commit?',
    acao: 'Refazer neste aparelho',
  },
};

function syncCorpoIndisponivel(key, detalhe) {
  const motivo = detalhe.motivo ? ` (${esc(detalhe.motivo)})` : '';
  return `<p>O Firebase não respondeu${motivo}, então este aparelho não consegue saber se outro já está revisando <code>${esc(key)}</code>.</p>
    <p>Se estiver, as duas sessões gastam tokens pelo mesmo PR. O dedup de postagem continua impedindo review duplicado no GitHub.</p>`;
}

function syncCorpoRecibo(key, detalhe) {
  const onde = esc(detalhe.deviceName || 'outro aparelho');
  const quando = detalhe.receipt && detalhe.receipt.completedAt ? ` em ${esc(fmtWhenDay(detalhe.receipt.completedAt))}` : '';
  return `<p><code>${esc(key)}</code> já foi analisado no <b>${onde}</b> neste commit${quando}. O resultado só existe lá.</p>
    <p>Refazer aqui abre uma sessão nova e consome tokens. Se o ${onde} voltar, ele confere antes de postar e não publica por cima.</p>`;
}

export function syncConfirmacaoDoClique(entrada) {
  const e = entrada || {};
  const key = String(e.key || '');
  const detalhe = (e.detail && typeof e.detail === 'object') ? e.detail : {};
  const modelo = SYNC_CONFIRMACOES[e.reason];
  if (!modelo) {
    const onde = detalhe.deviceName || 'outro aparelho';
    // não é falha: é o app respeitando uma análise que já está rodando
    return { tipo: 'aviso', key, texto: `${key} está sendo analisado no ${onde} agora. O Farol não toma uma análise em andamento; tente de novo quando ela terminar.` };
  }
  const corpo = e.reason === 'recibo' ? syncCorpoRecibo(key, detalhe) : syncCorpoIndisponivel(key, detalhe);
  return { tipo: 'confirma', key, titulo: modelo.titulo, acao: modelo.acao, override: modelo.override, corpo };
}

/* Uma confirmação por PR, na ordem em que o engine devolveu. Lista vazia (ou resposta
   sem coordenação nenhuma) não produz nada: o silêncio aqui quer dizer que a revisão
   seguiu normalmente. */
export function syncConfirmacoesDoClique(resposta) {
  const lista = resposta && Array.isArray(resposta.coordenacao) ? resposta.coordenacao : [];
  return lista.map(syncConfirmacaoDoClique);
}

/* ---------- U3: a nota de coordenação no card da fila ----------

   Mesmo molde do parkedNoteHtml, e a diferença de COR é a regra: espera é azul
   (--info), atenção é âmbar (--accent), e o vermelho fica reservado ao estacionamento,
   que é falha de verdade. Estacionamento e coordenação juntos: o estacionamento VENCE,
   porque ele é o que exige ação sua, e a espera se resolve sozinha. */
const SYNC_ESPERA_FRASE = {
  alheio: (onde) => `Em análise no ${onde}. A revisão automática espera por aqui.`,
  indisponivel: () => 'Coordenação entre dispositivos indisponível agora. A revisão automática espera a conexão voltar.',
  esgotado: () => 'Teto de rodadas automáticas de hoje atingido entre seus aparelhos. Volta amanhã; o Revisar vale agora.',
};
const SYNC_ESPERA_CLASSE = { alheio: '', indisponivel: ' warn', esgotado: ' warn' };

export function prCoordNoteHtml(key, sync) {
  const s = sync || {};
  const espera = (s.espera || {})[key];
  const lease = (s.leasesVistos || {})[key];
  if (espera && SYNC_ESPERA_FRASE[espera.reason]) {
    const onde = esc(espera.deviceName || (lease && lease.deviceName) || 'outro aparelho');
    return `<div class="pr-coord${SYNC_ESPERA_CLASSE[espera.reason]}">${SYNC_ESPERA_FRASE[espera.reason](onde)}</div>`;
  }
  // sem espera registrada, o stream ainda pode saber que outro aparelho está com ele
  if (lease) return `<div class="pr-coord">${SYNC_ESPERA_FRASE.alheio(esc(lease.deviceName || 'outro aparelho'))}</div>`;
  return '';
}

/* ---------- U4: o Consumo de todos os aparelhos ----------

   O resumo vem inteiro do engine (consolidatedSummary, em lib/sync/consolidated.js):
   a tela só formata. Envelope com ok:false mostra o MOTIVO, nunca uma tela vazia muda,
   que seria indistinguível de "não gastei nada". */
export function usageConsolidatedHtml(resumo) {
  const r = resumo || {};
  const devices = Array.isArray(r.devices) ? r.devices : [];
  const t = r.totals || { sessions: 0, costUsd: 0, medido: { costUsd: 0 }, estimado: { costUsd: 0 } };
  const medido = Number((t.medido || {}).costUsd) || 0;
  const estimado = Number((t.estimado || {}).costUsd) || 0;
  const total = medido + estimado;
  const pct = total > 0 ? Math.round((medido / total) * 100) : 100;
  const porAparelho = (campo) => devices.filter(d => d[campo]).map(d => `${esc(d.name || d.deviceId)}: ${campo === 'costUsd' ? fjMoeda(d[campo]) : fmtTok(d[campo])}`).join(', ');
  const linhas = devices.map(d => {
    const eu = d.euMesmo ? ' <span class="sync-chip mute">este</span>' : '';
    const visto = d.lastAt ? fmtWhenDay(d.lastAt) : 'sem sessão na janela';
    return `<div class="sync-linha"><span class="sync-nome">${esc(d.name || d.deviceId || 'aparelho')}${eu}</span><span class="sync-fraco">${fmtTok(d.sessions)}</span><span class="sync-fraco">${fjMoeda(d.costUsd)} · ${esc(visto)}</span></div>`;
  }).join('');
  return `<div class="usage-kpis">
      <div class="usage-kpi"><span class="usage-kpi-label">custo, todos os aparelhos</span><b>${fjMoeda(t.costUsd)}</b><span class="usage-kpi-sub">${esc(porAparelho('costUsd')) || 'nenhum gasto na janela'}</span></div>
      <div class="usage-kpi"><span class="usage-kpi-label">sessões</span><b>${fmtTok(t.sessions)}</b><span class="usage-kpi-sub">${esc(porAparelho('sessions')) || 'nenhuma sessão na janela'}</span></div>
      <div class="usage-kpi"><span class="usage-kpi-label">medido x estimado</span><b>${pct}%</b><span class="usage-kpi-sub">${fjMoeda(estimado)} estimado</span></div>
    </div>
    <div class="card sync-lista">
      <div class="sync-linha sync-head"><span>aparelho</span><span>sessões</span><span>custo · última sessão</span></div>
      ${linhas || '<p class="sync-vago sync-vazio">Nenhum aparelho enviou consumo ainda.</p>'}
    </div>`;
}

// Envelope de recusa: o motivo aparece, sempre. Tela vazia muda seria lida como
// "não gastei nada", que é uma afirmação que o app não pode fazer sem os dados.
export function usageConsolidadoEnvelopeHtml(resp) {
  const r = resp || {};
  if (r.ok && r.resumo) return usageConsolidatedHtml(r.resumo);
  const motivo = r.motivo || 'o servidor não respondeu';
  return `<div class="callout warn"><span>Não deu pra montar o consumo de todos os aparelhos: ${esc(motivo)}. O consumo deste aparelho continua em "Este aparelho".</span></div>`;
}
```

Confira que o arquivo ficou IDÊNTICO antes de seguir:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('ui/pure.js')).digest('hex').slice(0,16))"
```

Esperado: `25211b7151964378`. Saiu outro valor? Você transcreveu com outra grafia (o caso comum é trocar uma sequência como \u2014 pelo caractere que ela representa). Reescreva o arquivo do bloco acima, sem normalizar nada, antes de seguir.

- [ ] **Passo 4: rodar e ver passar**

```bash
node --test --test-force-exit test/ui-pure-sync.test.js test/ui-semantics.test.js test/rerevisar-head-velho.test.js
```

Esperado: PASSA, 0 falhas.

- [ ] **Passo 5: gate e commit**

```bash
npm run check && npm run lint && npm test
```

Esperado: `fail 0` e `gate de qualidade: sem regressão`. Se algo falhar, PARE e relate; não mexa em outro arquivo para fazer passar.

```bash
git add test/rerevisar-head-velho.test.js test/ui-pure-sync.test.js test/ui-semantics.test.js ui/app.css ui/app.js ui/index.html ui/pure.js
git commit -m "feat(sync): seção Sistema, confirmações do clique, nota na fila e Consumo de todos"
```

