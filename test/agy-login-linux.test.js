// Integração com o PTY real do Linux: login, recusa, sigilo e cancelamento.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import cp from 'node:child_process';
import { once } from 'node:events';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "farol agy ' tty-"));
process.env.FAROL_HOME = raiz;
const falso = path.join(raiz, "agy ' falso.mjs");
process.env.FAROL_AGY_CMD = falso;
fs.writeFileSync(falso, `
import fs from 'node:fs';
import readline from 'node:readline';
if (!process.stdin.isTTY) process.exit(42);
process.on('SIGTERM', () => { if (!process.env.AGY_FALSO_IGNORAR_TERM) process.exit(0); });
if (process.env.AGY_FALSO_IGNORAR_TERM) setInterval(() => {}, 1000);
fs.writeFileSync(process.env.HOME + '/filho.pid', String(process.pid));
console.log('https://accounts.google.com/o/oauth2/auth?teste=1');
readline.createInterface({ input: process.stdin }).on('line', (codigo) => {
  if (process.env.AGY_FALSO_AGUARDAR) return;
  console.log('codigo recebido');
  process.exit(codigo === '4/bom-codigo_123' ? 0 : 7);
});
`);
const { IS_LINUX, AGY_DIR } = await import('../lib/paths.js');
const { default: web } = await import('../lib/engine/login-web.js');
after(() => fs.rmSync(raiz, { recursive: true, force: true }));

function engine() {
  return {
    ghEnv: () => ({ ...process.env }),
    resolveAuthForLogin: (id) => ({ kind: 'agy', id }),
    doctor: async () => {},
    emit: () => {},
  };
}

for (const [codigo, esperado] of [['4/bom-codigo_123', 0], ['4/ruim-codigo', 7]]) {
  test(`Linux: CLI recebe código sem eco e preserva saída ${esperado}`, { skip: !IS_LINUX, timeout: 10000 }, async (t) => {
    const e = engine();
    let child;
    let saida = '';
    const r = await web.iniciar(e, `pl${esperado}`, { spawn: (...args) => {
      child = cp.spawn(...args);
      child.stdout.on('data', (b) => { saida += b; });
      child.stderr.on('data', (b) => { saida += b; });
      return child;
    } });
    t.after(() => web.cancelar(e, r.loginId));
    assert.equal(r.ok, true, JSON.stringify(r));
    const fechado = once(child, 'close');
    const resultado = await web.enviarCodigo(e, r.loginId, codigo);
    assert.equal((await fechado)[0], esperado);
    assert.equal(resultado.ok, esperado === 0);
    if (esperado) assert.equal(resultado.code, 'recusado');
    assert.ok(!saida.includes(codigo), 'o terminal não pode ecoar o código');
    assert.ok(!fs.existsSync(path.join(AGY_DIR, `pl${esperado}`, 'typescript')), 'sem transcrição');
  });
}

for (const automatico of [false, true]) {
  test(`Linux: ${automatico ? 'prazo vencido' : 'cancelar'} encerra também o CLI na sessão do pseudoterminal`, { skip: !IS_LINUX, timeout: 10000 }, async (t) => {
    const e = engine();
    const r = await web.iniciar(e, 'cancelar', { prazoTotalMs: automatico ? 2000 : 10000 });
    t.after(() => web.cancelar(e, r.loginId));
    assert.equal(r.ok, true, JSON.stringify(r));
    const child = e.loginsWeb.get(r.loginId).child;
    const pid = Number(fs.readFileSync(path.join(AGY_DIR, 'cancelar', 'filho.pid'), 'utf8'));
    const fechado = once(child, 'close');
    if (!automatico) {
      web.cancelar(e, r.loginId);
      assert.ok(child.stdin.writableEnded || child.stdin.destroyed, 'cancelar fecha a entrada do wrapper');
    }
    await fechado;
    // O wrapper só pode fechar depois de recolher o filho, inclusive sem init reaper.
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    assert.equal(e.loginsWeb.size, 0);
  });
}

test('Linux: cancelamento com saída zero não confirma código em trânsito', { skip: !IS_LINUX, timeout: 10000 }, async (t) => {
  const e = engine();
  e.ghEnv = () => ({ ...process.env, AGY_FALSO_AGUARDAR: '1' });
  const r = await web.iniciar(e, 'interrompido');
  t.after(() => web.cancelar(e, r.loginId));
  assert.equal(r.ok, true, JSON.stringify(r));
  const child = e.loginsWeb.get(r.loginId).child;
  const fechado = once(child, 'close');
  const envio = web.enviarCodigo(e, r.loginId, '4/bom-codigo_123');
  web.cancelar(e, r.loginId);
  const resultado = await envio;
  assert.equal((await fechado)[0], 0, 'simula o CLI que sai normalmente ao receber TERM');
  assert.equal(resultado.ok, false);
  assert.equal(resultado.code, 'expirou');
});

test('Linux: CLI que ignora TERM é forçado e recolhido pelo wrapper', { skip: !IS_LINUX, timeout: 10000 }, async (t) => {
  const e = engine();
  e.ghEnv = () => ({ ...process.env, AGY_FALSO_IGNORAR_TERM: '1' });
  const r = await web.iniciar(e, 'ignora');
  t.after(() => web.cancelar(e, r.loginId));
  assert.equal(r.ok, true, JSON.stringify(r));
  const child = e.loginsWeb.get(r.loginId).child;
  const pid = Number(fs.readFileSync(path.join(AGY_DIR, 'ignora', 'filho.pid'), 'utf8'));
  const fechado = once(child, 'close');
  web.cancelar(e, r.loginId);
  assert.ok(child.stdin.writableEnded || child.stdin.destroyed, 'fecha a entrada mesmo quando o CLI ignora TERM');
  assert.equal((await fechado)[0], 137);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});
