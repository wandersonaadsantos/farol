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
