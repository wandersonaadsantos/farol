// Login do Claude sem terminal para abrir (26/09/2026, lib/engine/login-celular.js).
//
// No celular o Farol roda dentro do proot, sem emulador de terminal: o botão "Abrir sessão
// de login" só avisava "instale o gnome-terminal", e o login feito à mão caiu em
// /root/.claude, porque `claude` rodou como root com HOME=/root. Aqui se prova que o
// script entregue fixa HOME, PATH e a pasta do perfil, e que o comando é o do Termux.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-login-celular-'));
process.env.FAROL_HOME = BASE;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const lc = (await import('../lib/engine/login-celular.js')).default;
const { buildLoginScriptMac } = await import('../lib/engine/session.js');

after(() => { try { fs.rmSync(BASE, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ } });

function motor() {
  return { config: { port: 47170 }, sessionSeq: 0, logs: [], toasts: [], log(n, m) { this.logs.push([n, m]); }, emit(ev, p) { if (ev === 'toast') this.toasts.push(p); } };
}

test('no celular: o script fixa HOME e PATH antes da pasta do perfil, e o comando é o do Termux', () => {
  const e = motor();
  const r = lc.semTerminal(e, '/home/farol/.claude', buildLoginScriptMac, { sinais: { celular: true }, distro: 'ubuntu', home: '/home/farol', sessionsDir: BASE });
  assert.equal(r.code, 'copiar-comando');
  const m = r.comando.match(/^proot-distro login ubuntu -- bash '(.+)'$/);
  assert.ok(m, r.comando);
  const script = fs.readFileSync(m[1], 'utf8');
  const home = script.indexOf("export HOME='/home/farol'");
  const pathLocal = script.indexOf('export PATH="$HOME/.local/bin:$PATH"');
  const perfil = script.indexOf("CLAUDE_CONFIG_DIR='/home/farol/.claude'");
  assert.ok(home > 0 && pathLocal > home, 'HOME e depois o PATH do instalador');
  assert.ok(perfil > pathLocal, 'a pasta do perfil vem depois, e é ela que isola a credencial');
  assert.match(script, /\nclaude\n/, 'abre direto no claude, sem shell esperando comando');
  assert.deepEqual(e.toasts, [], 'não é erro: a tela copia o comando');
});

test('perfil "Padrão da máquina" (sem pasta própria) depende do HOME, que vai fixado', () => {
  const r = lc.semTerminal(motor(), '', buildLoginScriptMac, { sinais: { celular: true }, distro: 'debian', home: '/home/farol', sessionsDir: BASE });
  const script = fs.readFileSync(r.comando.match(/bash '(.+)'$/)[1], 'utf8');
  assert.match(script, /export HOME='\/home\/farol'/);
  assert.doesNotMatch(script, /CLAUDE_CONFIG_DIR='/, 'sem pasta própria, a credencial fica no $HOME/.claude do Farol');
});

test('sem sinal de proot, o comando é o bash direto, e nunca mais o erro de terminal', () => {
  const e = motor();
  const r = lc.semTerminal(e, '/x', buildLoginScriptMac, { sinais: { celular: false, sistemaAndroid: false, osrelease: '6.8.0-generic' }, home: '/home/eu', sessionsDir: BASE });
  assert.equal(r.code, 'copiar-comando');
  assert.equal(r.onde, 'terminal');
  assert.match(r.comando, /^bash '.+.command'$/);
  assert.deepEqual(e.toasts, [], 'o aviso de instalar gnome-terminal não volta');
});

// 26/09/2026: a v2.62.21 só montava o comando no modo celular, e a detecção dele respondeu
// "não" no aparelho do dono: o proot-distro esconde TERMUX_VERSION e PREFIX e troca a versão do
// kernel por uma falsa. O login entrega o comando do Termux com qualquer um dos sinais de proot.
test('proot se reconhece pelo kernel falso, pelo /system do Android ou pelo modo celular', () => {
  assert.equal(lc.dentroDoProot({ osrelease: '6.2.1-PRoot-Distro' }), true);
  assert.equal(lc.dentroDoProot({ sistemaAndroid: true }), true);
  assert.equal(lc.dentroDoProot({ celular: true }), true);
  assert.equal(lc.dentroDoProot({ osrelease: '5.10.198-android12-9-g1234' }), true);
  assert.equal(lc.dentroDoProot({ osrelease: '6.8.0-45-generic' }), false);
  assert.equal(lc.dentroDoProot(), false);
  const r = lc.semTerminal(motor(), '/home/farol/.claude', buildLoginScriptMac, { sinais: { osrelease: '6.2.1-PRoot-Distro' }, distro: 'ubuntu', home: '/home/farol', sessionsDir: BASE });
  assert.equal(r.onde, 'termux');
  assert.match(r.comando, /^proot-distro login ubuntu -- bash '/);
});

test('distribuição e caminho estranhos não quebram o comando', () => {
  assert.equal(lc.comandoDoTermux('ubuntu; rm -rf /', '/tmp/a.command'), "proot-distro login debian -- bash '/tmp/a.command'");
  assert.equal(lc.comandoDoTermux('ubuntu', "/tmp/it's.command"), "proot-distro login ubuntu -- bash '/tmp/it'\\''s.command'");
  assert.deepEqual(lc.linhasDoCelular("/home/o'neil"), ["export HOME='/home/o'\\''neil'", 'export PATH="$HOME/.local/bin:$PATH"']);
});
