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
  const r = lc.semTerminal(e, '/home/farol/.claude', buildLoginScriptMac, { celular: true, distro: 'ubuntu', home: '/home/farol', sessionsDir: BASE });
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
  const r = lc.semTerminal(motor(), '', buildLoginScriptMac, { celular: true, distro: 'debian', home: '/home/farol', sessionsDir: BASE });
  const script = fs.readFileSync(r.comando.match(/bash '(.+)'$/)[1], 'utf8');
  assert.match(script, /export HOME='\/home\/farol'/);
  assert.doesNotMatch(script, /CLAUDE_CONFIG_DIR='/, 'sem pasta própria, a credencial fica no $HOME/.claude do Farol');
});

test('fora do celular, sem terminal, o aviso de sempre continua', () => {
  const e = motor();
  const r = lc.semTerminal(e, '/x', buildLoginScriptMac, { celular: false });
  assert.equal(r.code, 'sem-terminal');
  assert.equal(r.comando, undefined);
  assert.match(e.toasts[0].text, /Nenhum emulador de terminal/);
});

test('distribuição e caminho estranhos não quebram o comando', () => {
  assert.equal(lc.comandoDoTermux('ubuntu; rm -rf /', '/tmp/a.command'), "proot-distro login debian -- bash '/tmp/a.command'");
  assert.equal(lc.comandoDoTermux('ubuntu', "/tmp/it's.command"), "proot-distro login ubuntu -- bash '/tmp/it'\\''s.command'");
  assert.deepEqual(lc.linhasDoCelular("/home/o'neil"), ["export HOME='/home/o'\\''neil'", 'export PATH="$HOME/.local/bin:$PATH"']);
});
