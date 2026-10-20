// Login do Claude pela própria tela (20/10/2026), para quem não tem terminal para abrir: o
// modo servidor (a instância da Hostinger, sem SSH permanente) e o Linux sem emulador.
//
// Medido com o Claude Code 2.1.295, sem TTY (stdin em pipe): `claude auth login` imprime
//   "If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&..."
//   "Paste code here if prompted > "
// e espera o código no stdin. O redirect desse link é a página da Anthropic que MOSTRA o
// código (`platform.claude.com/oauth/code/callback`), então o navegador não precisa estar na
// mesma máquina. Código falso colado no pipe devolve "Login failed: Request failed with
// status code 400" e sai com 1; a troca do código acontece do mesmo jeito que no terminal.
// Zero dependência nova: é o `child_process` do Node conversando com o próprio CLI.
//
// O que NÃO foi medido aqui: o login que dá certo (exigiria uma assinatura real), e o CLI
// tentando abrir navegador numa máquina sem nenhum. Por isso o sucesso é o código de saída 0
// e nada mais, e o fim é conferido pelo doctor, como no login pelo terminal.
//
// O código colado é credencial de uso único: vai só para o stdin do CLI, nunca para log,
// spawns.log, snapshot ou toast. A saída do CLI também não vai para log (traz o link).
import cp from 'node:child_process';
import crypto from 'node:crypto';
import { IS_WIN } from '../paths.js';
import { TEMPOS } from '../constants.js';
import { loginConsoleEnv } from './session.js';
import { claudeAuthPosixPrefix } from '../parse.js';
import { LINHA_DO_PATH } from './login-celular.js';

const SAIDA_MAX = 64 * 1024;
const LINK = /https:\/\/\S+\/oauth\/authorize\?\S+/;
// o código que a página da Anthropic mostra é `<código>#<estado>`; nada além disso entra
const CODIGO = /^[A-Za-z0-9._~#-]{8,2048}$/;

// PURA: o link de autorização na saída do CLI, ou ''.
function linkDaSaida(texto) {
  const m = String(texto || '').match(LINK);
  return m ? m[0] : '';
}

// PURA: o código como a pessoa colou, sem espaço em volta, ou '' quando não tem a forma.
function codigoValido(v) {
  const s = String(v == null ? '' : v).trim();
  return CODIGO.test(s) ? s : '';
}

// PURA: o motivo da falha que pode ir para a tela. Só a linha "Login failed", sem link.
function motivoDaFalha(texto) {
  const linha = String(texto || '').split(/\r?\n/).map((l) => l.replace(/^.*?>\s*/, '').trim())
    .find((l) => /^Login failed/i.test(l));
  if (!linha) return 'o Claude Code não aceitou o código';
  return linha.replace(/https?:\/\/\S+/g, '').slice(0, 200);
}

function sessoes(engine) {
  if (!engine.loginsWeb) engine.loginsWeb = new Map();
  return engine.loginsWeb;
}

// PURA: a linha do shell POSIX. O `-l` lê /etc/profile e ~/.profile DEPOIS do ambiente
// limpo, e um profile que exporte CLAUDE_CONFIG_DIR ou ANTHROPIC_* gravaria o login em
// outro lugar; por isso a autenticação do perfil é reaplicada depois, como na sessão
// headless (claudeAuthPosixPrefix). ~/.local/bin vai na frente, onde o instalador oficial
// põe o `claude` (a linha é do login-celular).
function linhaPosix(dir) {
  return `${LINHA_DO_PATH}; ${claudeAuthPosixPrefix({ kind: 'dir', dir: dir || '' })}exec claude auth login`;
}

function abrirProcesso(dir, spawn) {
  const env = loginConsoleEnv(dir);
  if (IS_WIN) return spawn('cmd.exe', ['/d', '/s', '/c', 'claude auth login'], { env, windowsHide: true, stdio: 'pipe' });
  return spawn('/bin/sh', ['-lc', linhaPosix(dir)], { env, detached: true, stdio: 'pipe' });
}

function encerrar(engine, id, s) {
  sessoes(engine).delete(id);
  clearTimeout(s.prazo);
  if (s.fim !== null) return;
  try {
    if (IS_WIN) cp.execFile('taskkill', ['/pid', String(s.child.pid), '/t', '/f'], { windowsHide: true }, () => { });
    else process.kill(-s.child.pid, 'SIGKILL');
  } catch { /* o processo já saiu */ }
}

// Resolve quando `pronto()` fica verdadeiro (a cada saída ou fim do processo) ou no prazo.
function esperar(s, pronto, prazoMs) {
  return new Promise((resolve) => {
    const fim = () => { clearTimeout(desistir); s.ouvintes = []; resolve(); };
    const desistir = setTimeout(fim, prazoMs);
    if (pronto()) return fim();
    s.ouvintes.push(() => { if (pronto()) fim(); });
  });
}

/**
 * Abre o `claude auth login` na pasta do perfil e devolve o link de autorização.
 * @returns {Promise<{ok: true, loginId: string, url: string} | {ok: false, code: string, motivo: string}>}
 */
function iniciar(engine, profileId, deps = {}) {
  const auth = engine.resolveAuthForLogin(String(profileId || ''));
  if (auth.kind !== 'dir') return Promise.resolve({ ok: false, code: 'sem-login', motivo: 'este perfil não entra por login do Claude' });
  // um login por vez: o anterior, se havia, perde a vez
  for (const [id, s] of sessoes(engine)) encerrar(engine, id, s);
  const child = abrirProcesso(auth.dir, deps.spawn || cp.spawn);
  const id = crypto.randomUUID();
  const s = { child, saida: '', fim: null, ouvintes: [], prazo: null };
  sessoes(engine).set(id, s);
  s.prazo = setTimeout(() => encerrar(engine, id, s), deps.prazoTotalMs || TEMPOS.LOGIN_WEB_ABERTO_MS);
  const juntar = (b) => { if (s.saida.length < SAIDA_MAX) s.saida += String(b); s.ouvintes.forEach((f) => f()); };
  child.stdout.on('data', juntar);
  child.stderr.on('data', juntar);
  child.on('error', () => { s.fim = -1; s.ouvintes.forEach((f) => f()); });
  // o CLI pode fechar a entrada enquanto o código chega (EPIPE assíncrono); sem ouvinte o
  // erro derrubaria o engine inteiro. O fim do processo é quem responde, pelo `exit`
  child.stdin.on('error', () => { /* o exit do processo decide o resultado */ });
  child.on('exit', (code) => { s.fim = code === null ? -1 : code; s.ouvintes.forEach((f) => f()); });
  return esperar(s, () => linkDaSaida(s.saida) || s.fim !== null, deps.prazoDoLinkMs || TEMPOS.LOGIN_WEB_LINK_MS).then(() => {
    const url = linkDaSaida(s.saida);
    if (url && s.fim === null) return { ok: true, loginId: id, url };
    encerrar(engine, id, s);
    return { ok: false, code: 'sem-link', motivo: 'o Claude Code não mostrou o link de login; confira se ele está instalado nesta máquina' };
  });
}

/**
 * Entrega o código colado ao CLI e espera ele sair.
 * @returns {Promise<{ok: boolean, code?: string, motivo?: string}>}
 */
function enviarCodigo(engine, loginId, codigo, deps = {}) {
  const s = sessoes(engine).get(String(loginId || ''));
  if (!s || s.fim !== null) return Promise.resolve({ ok: false, code: 'expirou', motivo: 'este login não está mais aberto; comece de novo' });
  const c = codigoValido(codigo);
  if (!c) return Promise.resolve({ ok: false, code: 'codigo-invalido', motivo: 'cole o código inteiro, como a página da Anthropic mostra' });
  const inicio = s.saida.length;
  s.child.stdin.write(c + '\n');
  return esperar(s, () => s.fim !== null, deps.prazoDoCodigoMs || TEMPOS.LOGIN_WEB_CODIGO_MS).then(() => {
    const fim = s.fim;
    encerrar(engine, String(loginId), s);
    if (fim === null) return { ok: false, code: 'sem-resposta', motivo: 'o Claude Code não respondeu ao código' };
    if (fim !== 0) return { ok: false, code: 'recusado', motivo: motivoDaFalha(s.saida.slice(inicio)) };
    engine.doctor().catch(() => { /* o selo atualiza no próximo doctor */ });
    engine.emit('toast', { kind: 'ok', text: 'Login do Claude feito neste perfil.' });
    return { ok: true };
  });
}

function cancelar(engine, loginId) {
  const s = sessoes(engine).get(String(loginId || ''));
  if (s) encerrar(engine, String(loginId), s);
  return { ok: true };
}

export default { iniciar, enviarCodigo, cancelar, linhaPosix, linkDaSaida, codigoValido, motivoDaFalha };
export { iniciar, enviarCodigo, cancelar, linhaPosix, linkDaSaida, codigoValido, motivoDaFalha };
