// Login do Claude pela tela (20/10/2026). Nenhum `claude` real roda: o spawn é trocado por
// um processo falso que imprime o que o Claude Code 2.1.295 imprime sem TTY (medido) e lê o
// código do stdin. Prova o contrato com o CLI (link na saída, código no stdin, saída 0 é
// sucesso), a pasta do perfil no ambiente e que o código nunca sai para a tela.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import loginWeb from '../lib/engine/login-web.js';
import { loginWebHtml } from '../ui/pure.js';

const LINK = 'https://claude.com/cai/oauth/authorize?code=true&client_id=x&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&state=abc';

function cliFalso({ saidaFinal = 0, falha = '' } = {}) {
  const chamadas = [];
  const spawn = (cmd, args, opts) => {
    const child = new EventEmitter();
    child.pid = 999999;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    const chamada = { cmd, args, env: opts.env, recebido: '' };
    chamadas.push(chamada);
    setImmediate(() => child.stdout.write(`Opening browser to sign in…\nIf the browser didn't open, visit: ${LINK}\nPaste code here if prompted > `));
    child.stdin.on('data', (b) => {
      chamada.recebido += String(b);
      if (falha) child.stdout.write(`Login failed: ${falha} ${LINK}\n`);
      setImmediate(() => child.emit('exit', falha ? 1 : saidaFinal));
    });
    return child;
  };
  return { spawn, chamadas };
}

function engineFalso(perfis) {
  const e = {
    emitidos: [], doctorChamado: 0,
    emit(tipo, dados) { this.emitidos.push({ tipo, dados }); },
    doctor() { this.doctorChamado++; return Promise.resolve({}); },
    resolveAuthForLogin(id) {
      const p = perfis[id];
      return p || { kind: 'dir', dir: '' };
    },
  };
  return e;
}

test('abre o login na pasta do perfil, devolve o link e entrega o código colado ao CLI', async () => {
  const cli = cliFalso();
  const e = engineFalso({ p1: { kind: 'dir', dir: '/home/farol/.claude-pessoal' } });
  const r = await loginWeb.iniciar(e, 'p1', { spawn: cli.spawn });
  assert.equal(r.ok, true);
  assert.equal(r.url, LINK);
  assert.equal(cli.chamadas[0].env.CLAUDE_CONFIG_DIR, '/home/farol/.claude-pessoal');
  const fim = await loginWeb.enviarCodigo(e, r.loginId, '  codigoDeVerdade123#estado456  ');
  assert.deepEqual(fim, { ok: true });
  assert.equal(cli.chamadas[0].recebido, 'codigoDeVerdade123#estado456\n');
  assert.equal(e.doctorChamado, 1);
  // o código não aparece em nada que vai para a tela
  assert.doesNotMatch(JSON.stringify(e.emitidos), /codigoDeVerdade123/);
  // login usado não aceita outro código
  assert.equal((await loginWeb.enviarCodigo(e, r.loginId, 'outrocodigo999')).code, 'expirou');
});

test('o login padrão da máquina roda sem CLAUDE_CONFIG_DIR', async () => {
  const cli = cliFalso();
  const e = engineFalso({});
  const r = await loginWeb.iniciar(e, 'maquina', { spawn: cli.spawn });
  assert.equal(r.ok, true);
  assert.equal('CLAUDE_CONFIG_DIR' in cli.chamadas[0].env, false);
  loginWeb.cancelar(e, r.loginId);
});

test('código que o CLI recusa volta com o motivo, sem o link', async () => {
  const cli = cliFalso({ falha: 'Request failed with status code 400' });
  const e = engineFalso({});
  const r = await loginWeb.iniciar(e, '', { spawn: cli.spawn });
  const fim = await loginWeb.enviarCodigo(e, r.loginId, 'codigofalso#estadofalso');
  assert.equal(fim.ok, false);
  assert.equal(fim.code, 'recusado');
  assert.match(fim.motivo, /^Login failed: Request failed with status code 400/);
  assert.doesNotMatch(fim.motivo, /https:/);
});

test('código fora da forma nem chega ao CLI, e perfil de chave não abre login', async () => {
  const cli = cliFalso();
  const e = engineFalso({ k: { kind: 'apikey', apiKey: 'x' } });
  assert.equal((await loginWeb.iniciar(e, 'k', { spawn: cli.spawn })).code, 'sem-login');
  assert.equal(cli.chamadas.length, 0);
  const r = await loginWeb.iniciar(e, '', { spawn: cli.spawn });
  for (const ruim of ['', 'curto', 'tem espaco no meio', 'linha\nnova', 'x'.repeat(3000)]) {
    assert.equal((await loginWeb.enviarCodigo(e, r.loginId, ruim)).code, 'codigo-invalido');
  }
  assert.equal(cli.chamadas[0].recebido, '');
  loginWeb.cancelar(e, r.loginId);
});

test('CLI que não mostra link vira falha com motivo, sem pendurar a tela', async () => {
  const e = engineFalso({});
  const spawn = () => {
    const child = new EventEmitter();
    child.pid = 999998;
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    setImmediate(() => { child.stderr.write('claude: command not found\n'); child.emit('exit', 127); });
    return child;
  };
  const r = await loginWeb.iniciar(e, '', { spawn, prazoDoLinkMs: 2000 });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'sem-link');
});

test('as funções puras: link, código e motivo', () => {
  assert.equal(loginWeb.linkDaSaida(`visit: ${LINK}\nPaste`), LINK);
  assert.equal(loginWeb.linkDaSaida('nada aqui'), '');
  assert.equal(loginWeb.codigoValido(' abc123def#xyz '), 'abc123def#xyz');
  assert.equal(loginWeb.codigoValido('abc"; rm -rf /'), '');
  assert.equal(loginWeb.motivoDaFalha('sem a linha'), 'o Claude Code não aceitou o código');
});

test('o painel mostra o link só se for https, e o comando de terminal como alternativa', () => {
  const html = loginWebHtml({ estado: 'link', perfil: 'Pessoal Max 20X', url: LINK, comando: "bash '/x/login.command'", onde: 'terminal' });
  assert.match(html, /Login do Claude em Pessoal Max 20X/);
  assert.match(html, /href="https:\/\/claude\.com\/cai\/oauth\/authorize/);
  assert.match(html, /id="cpLoginWebCodigo"/);
  assert.match(html, /Prefere o terminal\?/);
  const falso = loginWebHtml({ estado: 'link', url: 'javascript:alert(1)', motivo: 'm' });
  assert.doesNotMatch(falso, /javascript:/);
  assert.doesNotMatch(falso, /cpLoginWebCodigo/);
  assert.equal(loginWebHtml({}), '');
  assert.match(loginWebHtml({ estado: 'enviando', url: LINK }), /disabled/);
});

// Revisão do PR #262. `/bin/sh -lc` lê /etc/profile e ~/.profile DEPOIS do ambiente limpo:
// um profile que exporte CLAUDE_CONFIG_DIR ou ANTHROPIC_* gravava o login no lugar errado.
// Prova num shell de login de verdade, com um `claude` falso que imprime o que recebeu.
test('o shell de login não deixa o ~/.profile trocar a pasta nem vazar chave', { skip: process.platform === 'win32' }, async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const cp = await import('node:child_process');
  const { LINHA_DO_PATH } = await import('../lib/engine/login-celular.js');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-login-profile-'));
  try {
    fs.writeFileSync(path.join(home, '.profile'), 'export CLAUDE_CONFIG_DIR=/errado\nexport ANTHROPIC_API_KEY=vazou\n');
    fs.mkdirSync(path.join(home, '.local', 'bin'), { recursive: true });
    fs.writeFileSync(path.join(home, '.local', 'bin', 'claude'), '#!/bin/sh\necho "dir=${CLAUDE_CONFIG_DIR:-} chave=${ANTHROPIC_API_KEY:-}"\n', { mode: 0o755 });
    const rodar = (linha) => cp.spawnSync('/bin/sh', ['-lc', linha], { env: { HOME: home, PATH: '/usr/bin:/bin' }, encoding: 'utf8' }).stdout.trim();
    // a linha antiga: o profile vence
    assert.equal(rodar(`${LINHA_DO_PATH}; exec claude auth login`), 'dir=/errado chave=vazou');
    assert.equal(rodar(loginWeb.linhaPosix('/home/farol/.claude-pessoal')), 'dir=/home/farol/.claude-pessoal chave=');
    // login padrão da máquina: sem pasta nenhuma, como a sessão headless
    assert.equal(rodar(loginWeb.linhaPosix('')), 'dir= chave=');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('a linha POSIX reaplica a autenticação do perfil depois do PATH', () => {
  const linha = loginWeb.linhaPosix('/home/farol/.claude-x');
  assert.match(linha, /^export PATH="\$HOME\/\.local\/bin:\$PATH"; unset [^;]*CLAUDE_CONFIG_DIR[^;]*; export CLAUDE_CONFIG_DIR='\/home\/farol\/\.claude-x'; exec claude auth login$/);
  assert.doesNotMatch(loginWeb.linhaPosix(''), /export CLAUDE_CONFIG_DIR/);
});

// Revisão do PR #262: o CLI pode fechar a entrada enquanto o código chega. Sem ouvinte, o
// EPIPE assíncrono do stdin vira exceção não tratada e derruba o engine inteiro.
test('EPIPE no stdin do login não derruba o processo e volta como falha', async () => {
  const { Writable } = await import('node:stream');
  const e = engineFalso({});
  const spawn = () => {
    const child = new EventEmitter();
    child.pid = 999997;
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.stdin = new Writable({ write(_c, _e, cb) { cb(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })); } });
    setImmediate(() => child.stdout.write(`visit: ${LINK}\nPaste code here if prompted > `));
    child.stdin.on('finish', () => { });
    child.saida = () => setImmediate(() => child.emit('exit', 1));
    child.stdin.once('error', () => child.saida());
    return child;
  };
  const r = await loginWeb.iniciar(e, '', { spawn });
  const fim = await loginWeb.enviarCodigo(e, r.loginId, 'codigoDeVerdade123#estado456');
  assert.equal(fim.ok, false);
  assert.equal(fim.code, 'recusado');
});
