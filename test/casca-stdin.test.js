// O motor como sidecar sai quando o stdin chega ao fim (onda de pendências das cascas, item A).
// A casca Mac entrega um pipe como stdin e o segura aberto enquanto vive; quando o app morre
// (crash, kill -9, logout), o pipe fecha e o EOF é o único aviso que chega ao motor, porque o
// bootstrap vira órfão do launchd e o motor reexecutado seguiria vivo segurando a porta.
// Fora do modo casca nada muda: o modo servidor roda com stdin fechado sob systemd.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import net from 'node:net';
import { PassThrough, Readable } from 'node:stream';
import { spawn } from 'node:child_process';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { vigiarStdin } from '../lib/engine/casca-stdin.js';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-casca-stdin-'));
after(() => fs.rmSync(BASE, { recursive: true, force: true }));
const SERVER = path.join(import.meta.dirname, '..', 'server.js');

test('vigiarStdin chama aoFechar uma vez só quando o stdin termina', async () => {
  const stdin = new PassThrough();
  let vezes = 0;
  vigiarStdin({ stdin, aoFechar: () => { vezes += 1; } });
  stdin.write('qualquer coisa');
  stdin.end();
  await new Promise(r => setImmediate(r));
  stdin.emit('error', new Error('depois do fim'));
  await new Promise(r => setImmediate(r));
  assert.equal(vezes, 1);
});

test('vigiarStdin trata erro no stdin como fim', async () => {
  const stdin = new PassThrough();
  let vezes = 0;
  vigiarStdin({ stdin, aoFechar: () => { vezes += 1; } });
  stdin.destroy(new Error('EPIPE'));
  await new Promise(r => setImmediate(r));
  assert.equal(vezes, 1);
});

test('vigiarStdin: stdin já fechado na largada (sem pai) conta como fim', async () => {
  const stdin = Readable.from([]);
  let vezes = 0;
  vigiarStdin({ stdin, aoFechar: () => { vezes += 1; } });
  await new Promise(r => setTimeout(r, 20));
  assert.equal(vezes, 1);
});

test('vigiarStdin: stdin aberto não chama aoFechar', async () => {
  const stdin = new PassThrough();
  let vezes = 0;
  vigiarStdin({ stdin, aoFechar: () => { vezes += 1; } });
  await new Promise(r => setTimeout(r, 20));
  assert.equal(vezes, 0);
  stdin.end();
});

function portaLivre() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

async function subirMotor({ casca }) {
  const home = fs.mkdtempSync(path.join(BASE, 'home-'));
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ port: await portaLivre(), autoReview: false }));
  const env = { ...process.env, FAROL_HOME: home };
  delete env.FAROL_SHELL;
  delete env.FAROL_SHELL_VERSION;
  delete env.FAROL_BOOTSTRAP_FEITO;
  delete env.FAROL_PAI_PID;
  if (casca) Object.assign(env, { FAROL_SHELL: 'mac', FAROL_SHELL_VERSION: '3.0.0' });
  const filho = spawn(process.execPath, [SERVER], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let saida = '';
  filho.stdout.on('data', (d) => { saida += d; });
  filho.stderr.on('data', (d) => { saida += d; });
  const fim = new Promise((resolve) => filho.on('exit', (code, signal) => resolve({ code, signal })));
  const inicio = Date.now();
  while (!saida.includes('monitorando')) {
    if (Date.now() - inicio > 30000) { filho.kill('SIGKILL'); throw new Error(`o motor não subiu: ${saida}`); }
    if (filho.exitCode !== null) throw new Error(`o motor saiu antes de subir: ${saida}`);
    await new Promise(r => setTimeout(r, 50));
  }
  return { filho, fim, casca: path.join(home, 'state', 'casca.json') };
}

function esperar(promessa, ms) {
  return Promise.race([promessa, new Promise(r => setTimeout(() => r('tempo'), ms))]);
}

test('modo casca: fechar o stdin encerra o motor pela saída ordenada (código 0, casca.json apagado)',
  { skip: process.platform === 'win32', timeout: 60000 }, async () => {
    const { filho, fim, casca } = await subirMotor({ casca: true });
    const inicio = Date.now();
    while (!fs.existsSync(casca)) {
      if (Date.now() - inicio > 10000) { filho.kill('SIGKILL'); throw new Error('o casca.json não apareceu'); }
      await new Promise(r => setTimeout(r, 25));
    }
    filho.stdin.end();
    const r = await esperar(fim, 15000);
    if (r === 'tempo') filho.kill('SIGKILL');
    assert.deepEqual(r, { code: 0, signal: null });
    assert.equal(fs.existsSync(casca), false, 'o casca.json some com a saída');
  });

test('modo servidor: fechar o stdin NÃO encerra o motor', { skip: process.platform === 'win32', timeout: 60000 }, async () => {
  const { filho, fim } = await subirMotor({ casca: false });
  filho.stdin.end();
  const r = await esperar(fim, 2000);
  assert.equal(r, 'tempo', 'o motor seguiu vivo depois do EOF');
  filho.kill('SIGTERM');
  await esperar(fim, 15000);
});
