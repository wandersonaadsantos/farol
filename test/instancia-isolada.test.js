// Instância isolada (FAROL_HOME fora do ~/.farol) não escreve no GitHub sem opt-in por arquivo.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import net from 'node:net';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';

process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-instancia-isolada-'));

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { recusaDeIsolada } = await import('../lib/engine/instancia-isolada.js');

const RAIZ = path.join(import.meta.dirname, '..');
const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-isolada-filhos-'));
after(() => {
  fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true });
  fs.rmSync(BASE, { recursive: true, force: true });
});

// ambiente de um processo FORA do executor de testes (senão a instância nunca é isolada)
function envLimpo(extra) {
  const env = { ...process.env, ...extra };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

test('isolada e sem opt-in recusa, com o motivo dito', () => {
  const r = recusaDeIsolada({ config: {} }, 'postar review', { isolada: true });
  assert.equal(r.blocked, 'instancia_isolada');
  assert.match(r.error, /instanciaIsoladaPosta/);
});

test('opt-in por arquivo libera; instância normal não recusa', () => {
  assert.equal(recusaDeIsolada({ config: { instanciaIsoladaPosta: true } }, 'postar review', { isolada: true }), null);
  assert.equal(recusaDeIsolada({ config: {} }, 'postar review', { isolada: false }), null);
});

test('postReview em isolada não chama gh', () => {
  const home = fs.mkdtempSync(path.join(BASE, 'home-'));
  const script = `
    const io = (await import('${RAIZ}/lib/io.js')).default;
    const chamadas = [];
    io.run = async (...a) => { chamadas.push(a); return { ok: true, code: 0, stdout: '', stderr: '' }; };
    io.runShell = io.run;
    const { postReview } = await import('${RAIZ}/lib/engine/decision.js');
    const logs = [];
    const engine = { config: {}, log: (n, m) => logs.push(n + ' ' + m), accountForPr: () => 'eu', ghEnv: () => ({}), tokenFor: () => 'tok', emit() {}, activeReviews: new Map() };
    const pr = { key: 'acme/app#7', url: 'https://github.com/acme/app/pull/7', repo: 'acme/app', number: 7 };
    const r = await postReview(engine, pr, { event: 'COMMENT', body: 'oi' });
    console.log(JSON.stringify({ blocked: r && r.blocked, chamadas: chamadas.length }));
  `;
  const saida = execFileSync(process.execPath, ['--input-type=module', '-e', script], { env: envLimpo({ FAROL_HOME: home }), encoding: 'utf8' });
  assert.deepEqual(JSON.parse(saida.trim().split('\n').pop()), { blocked: 'instancia_isolada', chamadas: 0 });
});

test('FAROL_HOME igual ao ~/.farol (com barra final) não é isolada', () => {
  const script = `const p = await import('${RAIZ}/lib/paths.js'); console.log(String(p.instanciaIsolada));`;
  const home = `${os.homedir()}/.farol/`;
  const saida = execFileSync(process.execPath, ['--input-type=module', '-e', script], { env: envLimpo({ FAROL_HOME: home }), encoding: 'utf8' });
  assert.equal(saida.trim(), 'false');
});

function portaLivre() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

function pegar(porta, rota) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${porta}${rota}`, { headers: { 'x-farol': '1' } }, (res) => {
      let corpo = '';
      res.on('data', (d) => { corpo += d; });
      res.on('end', () => resolve(JSON.parse(corpo)));
    }).on('error', reject);
  });
}

test('servidor filho com FAROL_HOME temporário expõe doctor.instanciaIsolada=true', { skip: process.platform === 'win32', timeout: 60000 }, async () => {
  const home = fs.mkdtempSync(path.join(BASE, 'srv-'));
  const porta = await portaLivre();
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ port: porta, autoReview: false }));
  const filho = spawn(process.execPath, [path.join(RAIZ, 'server.js')], { env: envLimpo({ FAROL_HOME: home }), stdio: ['pipe', 'pipe', 'pipe'] });
  let saida = '';
  filho.stdout.on('data', (d) => { saida += d; });
  filho.stderr.on('data', (d) => { saida += d; });
  try {
    const inicio = Date.now();
    while (!saida.includes('monitorando')) {
      if (Date.now() - inicio > 30000) throw new Error(`o motor não subiu: ${saida}`);
      if (filho.exitCode !== null) throw new Error(`o motor saiu antes de subir: ${saida}`);
      await new Promise(r => setTimeout(r, 50));
    }
    const doctor = await pegar(porta, '/api/doctor');
    assert.equal(doctor.instanciaIsolada, true);
  } finally {
    filho.kill('SIGKILL');
  }
});
