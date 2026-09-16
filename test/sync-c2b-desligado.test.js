// Grupo de consumo, aposentadoria, limpeza protegida e revogação DESLIGADOS: o Farol se
// comporta como hoje. Este arquivo nasce antes da mudança e continua verde depois
// (CT-COMPAT, CT-GRUPO "com sincronização e teto do grupo desligados, vale o comportamento
// de hoje", e D-b/D8 para a limpeza).
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-c2b-desligado-'));
const CASA = path.join(BASE, 'casa');
fs.mkdirSync(CASA, { recursive: true });
process.env.FAROL_HOME = path.join(BASE, 'farol');
process.env.HOME = CASA;
process.env.USERPROFILE = CASA;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const RAIZ = path.join(import.meta.dirname, '..');
const cfgMod = (await import('../lib/sync/config.js')).default;
const { Engine } = await import('../server.js');
const { STATE_DIR } = await import('../lib/paths.js');

after(() => { try { fs.rmSync(BASE, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ } });

test('o padrão não configura grupo nem liga limpeza, e payload remoto não liga', () => {
  const d = cfgMod.syncDefaults();
  assert.equal(d.grupo, undefined, 'grupo não nasce no config: a identidade é ato explícito');
  assert.equal(d.limpeza, undefined);
  const salvo = cfgMod.parseSyncConfig({ grupo: 'g1', limpeza: { enabled: true }, cleanup: true });
  assert.equal(salvo.grupo, undefined, 'nada vindo de fora entra no config por nome parecido');
  assert.equal(salvo.limpeza, undefined);
  assert.equal(salvo.cleanup, undefined);
});

test('subir o engine não cria arquivo de vínculo, de grupo nem de limpeza', () => {
  const e = new Engine();
  assert.ok(e);
  for (const f of ['sync-vinculos.json', 'sync-grupo.json', 'sync-limpeza.json']) {
    assert.equal(fs.existsSync(path.join(STATE_DIR, f)), false, f);
  }
  assert.equal(fs.existsSync(path.join(CASA, '.farol', 'sync-policy.json')), false);
});

// Aposentar é ato explícito. A presença é o único caminho que escreve no nó do aparelho a
// cada ciclo, e ela nunca pode carimbar aposentadoria: inatividade não é decisão de
// ninguém, e um aparelho de férias voltaria aposentado.
test('a presença não carimba aposentadoria: nada de retiredAt no caminho automático', () => {
  const fonte = fs.readFileSync(path.join(RAIZ, 'lib', 'engine', 'sync.js'), 'utf8');
  const presenca = fonte.slice(fonte.indexOf('function presencaDe'), fonte.indexOf('function projecaoDoAparelho'));
  assert.ok(presenca.length > 0, 'o recorte precisa achar o trecho da presença');
  assert.equal(/retired|aposent/i.test(presenca), false, 'o que a presença escreve não inclui aposentadoria');
  // ler `retiredAt` é legítimo (a tela precisa distinguir sumido de aposentado); ESCREVER
  // no caminho automático não é, e é isso que o segundo laço guarda
  const escritas = fonte.split('\n').filter((l) => l.includes('retiredAt') && /\.(patch|put|del)\(/.test(l));
  assert.deepEqual(escritas, [], 'só lib/engine/sync-aparelho.js escreve retiredAt');
});

// A limpeza protegida nunca alcança estes nós. Hoje isso é verdade por ausência (não
// existe limpeza); depois passa a ser verdade por allowlist, e este caso continua valendo.
test('os nós que a limpeza nunca alcança não dependem da chave de limpeza', () => {
  const regras = JSON.parse(fs.readFileSync(path.join(RAIZ, 'firebase', 'database.rules.json'), 'utf8')).rules.users.$uid;
  for (const no of ['keyring', 'leases', 'receipts', 'dailyRounds']) {
    const w = regras[no] && regras[no]['.write'];
    assert.ok(w, `${no} precisa ter concessão própria`);
    assert.equal(w.includes("child('cleanup')"), false, `${no} não pode ser removível pela limpeza`);
  }
});
