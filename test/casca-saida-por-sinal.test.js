// A saída ordenada do motor (registrarSaidaOrdenada no server.js) apaga o casca.json. O pai
// do bootstrap da casca repassa SIGTERM, SIGINT e SIGHUP ao motor reexecutado, então os três
// precisam passar pelo mesmo caminho: com SIGHUP de fora, o arquivo ficava para trás com um
// pid morto. Processo filho de verdade, sem engine completo (nada de polling no gh).
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-casca-sinal-'));
after(() => fs.rmSync(BASE, { recursive: true, force: true }));

const SERVER = new URL('../server.js', import.meta.url).href;
const ARQUIVO = new URL('../lib/engine/casca-arquivo.js', import.meta.url).href;

function script() {
  return `
    const { registrarSaidaOrdenada } = await import(${JSON.stringify(SERVER)});
    const { publicarCasca } = await import(${JSON.stringify(ARQUIVO)});
    const engine = { syncStop() {}, log() {} };
    publicarCasca(engine, 47199);
    registrarSaidaOrdenada(engine);
    process.stdout.write('pronto\\n');
    setInterval(() => {}, 1000);
  `;
}

function rodar(sinal) {
  const home = fs.mkdtempSync(path.join(BASE, 'home-'));
  const env = { ...process.env, FAROL_HOME: home, FAROL_SHELL: 'mac', FAROL_SHELL_VERSION: '3.0.0' };
  const filho = spawn(process.execPath, ['--input-type=module', '-e', script()], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const casca = path.join(home, 'state', 'casca.json');
  return new Promise((resolve, reject) => {
    const limite = setTimeout(() => { filho.kill('SIGKILL'); reject(new Error(`o motor não saiu com ${sinal}`)); }, 15000);
    let saida = '';
    filho.stdout.on('data', (d) => {
      saida += d;
      if (!saida.includes('pronto')) return;
      saida = '';
      assert.ok(fs.existsSync(casca), 'o casca.json existia antes do sinal');
      filho.kill(sinal);
    });
    filho.on('exit', (code, signal) => { clearTimeout(limite); resolve({ code, signal, existe: fs.existsSync(casca) }); });
  });
}

for (const sinal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  test(`${sinal} passa pela saída ordenada: o casca.json some e o código é 0`, { skip: process.platform === 'win32' }, async () => {
    const r = await rodar(sinal);
    assert.equal(r.signal, null, 'saiu pelo handler, não morto pelo sinal');
    assert.equal(r.code, 0);
    assert.equal(r.existe, false);
  });
}
