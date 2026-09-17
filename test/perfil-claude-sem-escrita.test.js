// Testar um perfil de assinatura NÃO altera a pasta do perfil (verificação A, 16/09/2026).
//
// Medido com o Claude Code 2.1.268: `claude auth status --json` REESCREVE o `.claude.json` da
// pasta apontada por CLAUDE_CONFIG_DIR e cria `backups/` ali, mesmo numa pasta vazia. O teste
// do perfil, que promete não gravar, alterava então a pasta real da assinatura (e, no padrão
// da máquina, o `~/.claude.json` real). A correção roda o status contra uma CÓPIA efêmera dos
// arquivos de configuração e aponta CLAUDE_SECURESTORAGE_CONFIG_DIR para a pasta original,
// que é de onde o CLI lê a credencial (arquivo no Windows e no Linux, keychain no macOS).
//
// Aqui o `io.runShell` é o REAL: quem responde é um `claude` falso no PATH, um script node
// que imita o CLI medido (lê a credencial da pasta segura, reescreve o `.claude.json` e cria
// `backups/` na pasta de configuração que recebeu).
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-perfil-sem-escrita-'));
process.env.FAROL_HOME = path.join(BASE, 'farol');

import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';

const io = (await import('../lib/io.js')).default;
const { Engine } = await import('../server.js');
const { IS_WIN } = await import('../lib/paths.js');

const BIN = path.join(BASE, 'bin');
const REGISTRO = path.join(BASE, 'registro.jsonl');
const HOME_FALSO = path.join(BASE, 'home');
const ORIGINAIS = {};
// O que o `claude` falso instalado deixou para trás, para o `after` desfazer.
const INSTALADOS = [];

const FALSO = `
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const env = process.env;
const conf = env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const segura = env.CLAUDE_SECURESTORAGE_CONFIG_DIR !== undefined
  ? (env.CLAUDE_SECURESTORAGE_CONFIG_DIR || path.join(os.homedir(), '.claude'))
  : conf;
const global = env.CLAUDE_CONFIG_DIR ? path.join(conf, '.claude.json') : path.join(os.homedir(), '.claude.json');
let cred = null;
try { cred = JSON.parse(fs.readFileSync(path.join(segura, '.credentials.json'), 'utf8')); } catch {}
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(global, 'utf8')); } catch {}
fs.mkdirSync(path.join(conf, 'backups'), { recursive: true });
fs.writeFileSync(path.join(conf, 'backups', '.claude.json.backup.' + Date.now()), JSON.stringify(cfg));
fs.writeFileSync(global, JSON.stringify({ ...cfg, firstStartTime: new Date().toISOString(), userID: 'falso' }));
fs.appendFileSync(env.FAROL_TESTE_REGISTRO, JSON.stringify({ conf, segura, argv: process.argv.slice(2) }) + '\\n');
const logado = !!(cred && cred.claudeAiOauth);
const saida = { loggedIn: logado, authMethod: logado ? 'claude.ai' : 'none' };
if (logado && cfg.oauthAccount) saida.email = cfg.oauthAccount.emailAddress;
process.stdout.write(JSON.stringify(saida));
process.exit(logado ? 0 : 1);
`;

function arvore(raiz) {
  const out = {};
  const andar = (d) => {
    for (const n of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, n.name);
      const rel = path.relative(raiz, p);
      if (n.isDirectory()) { out[rel + path.sep] = 'dir'; andar(p); continue; }
      out[rel] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    }
  };
  andar(raiz);
  return out;
}

function semear(dir, email) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'sintetico-nao-e-token', expiresAt: 4102444800000 } }));
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ model: 'sintetico' }));
  if (email) fs.writeFileSync(path.join(dir, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: email } }));
}

function registros() {
  if (!fs.existsSync(REGISTRO)) return [];
  return fs.readFileSync(REGISTRO, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// O `io.runShell` do POSIX é `/bin/sh -lc`, e o shell de LOGIN reescreve o PATH (é o que
// `/etc/profile` faz no Debian e no Alpine): o falso num diretório temporário deixa de ser o
// executado, e todos os casos que provam o teste de perfil ficavam pulados em Linux. A saída
// honesta é instalar o MESMO falso num diretório que o shell de login JÁ enxerga, quando um
// deles for gravável e não tiver um `claude` de verdade. É preparação do ambiente de teste,
// não mexe no produto, e o `after` desinstala.
async function instalarOndeOLoginEnxerga() {
  if (IS_WIN) return;
  const r = await io.runShell('echo "$PATH"');
  for (const dir of String(r.stdout || '').trim().split(path.delimiter)) {
    if (!dir || !path.isAbsolute(dir)) continue;
    const alvo = path.join(dir, 'claude');
    // `claude` que já existe é de verdade (ou de outra execução): não é nosso para trocar,
    // e o `falsoResolve` vai pular os casos com o motivo escrito
    if (fs.existsSync(alvo)) return;
    try {
      // `wx`: criação exclusiva, nunca sobrescrita. Os arquivos de teste rodam em paralelo, e
      // dois falsos disputando o mesmo nome fariam um arquivo executar o falso do outro
      fs.writeFileSync(alvo, LANCADOR, { mode: 0o755, flag: 'wx' });
      INSTALADOS.push(alvo);
      return;
    } catch { /* diretório do sistema sem permissão de escrita: tenta o próximo */ }
  }
}

// Caminho ABSOLUTO do falso: o lançador é copiado para fora do BIN, onde `dirname $0` não
// acharia o script.
const LANCADOR = `#!/bin/sh\nexec "${process.execPath}" "${path.join(BIN, 'claude-falso.cjs')}" "$@"\n`;

before(async () => {
  fs.mkdirSync(BIN, { recursive: true });
  fs.writeFileSync(path.join(BIN, 'claude-falso.cjs'), FALSO);
  if (IS_WIN) {
    fs.writeFileSync(path.join(BIN, 'claude.cmd'), `@"${process.execPath}" "%~dp0claude-falso.cjs" %*\r\n`);
  } else {
    fs.writeFileSync(path.join(BIN, 'claude'), LANCADOR, { mode: 0o755 });
  }
  process.env.PATH = BIN + path.delimiter + process.env.PATH;
  await instalarOndeOLoginEnxerga();
  process.env.FAROL_TESTE_REGISTRO = REGISTRO;
  ORIGINAIS.USERPROFILE = process.env.USERPROFILE;
  ORIGINAIS.HOME = process.env.HOME;
  process.env.USERPROFILE = HOME_FALSO;
  process.env.HOME = HOME_FALSO;
  fs.mkdirSync(HOME_FALSO, { recursive: true });
});

after(() => {
  for (const alvo of INSTALADOS) {
    try { fs.rmSync(alvo, { force: true }); } catch { /* best-effort */ }
  }
  for (const [k, v] of Object.entries(ORIGINAIS)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try { fs.rmSync(BASE, { recursive: true, force: true }); } catch { /* best-effort */ }
});

function engineCom(config) {
  const e = new Engine();
  e.log = () => { };
  e.pushState = () => { };
  Object.assign(e.config, config);
  return e;
}

// O shell de login reescreve o PATH (path_helper no macOS, /etc/profile no Linux). O caso só
// vale se quem o shell resolve é UM DOS falsos deste arquivo: o do BIN temporário, quando o
// PATH sobrevive, ou o instalado no diretório do PATH de login. Qualquer outro caminho não
// prova nada e é pulado com o motivo, nunca aprovado.
async function falsoResolve(t) {
  if (IS_WIN) return true;
  const r = await io.runShell('command -v claude', { env: { ...process.env } });
  const achado = r.stdout.trim();
  const nossos = [path.join(BIN, 'claude'), ...INSTALADOS];
  if (nossos.includes(achado)) return true;
  t.skip(`o shell de login resolve outro claude (${achado}), o falso não seria o executado`);
  return false;
}

test('testar um perfil de pasta não altera NENHUM arquivo da pasta, e a credencial vem dela', async (t) => {
  if (!await falsoResolve(t)) return;
  const dir = path.join(BASE, 'perfil-a');
  semear(dir, 'sintetico@exemplo.invalid');
  const antes = arvore(dir);
  const e = engineCom({ claudeProfiles: [{ id: 'p1', label: 'A', dir }], claudeProfileId: 'p1', accounts: [] });
  fs.rmSync(REGISTRO, { force: true });
  const r = await e.claudeTestarPerfil({ profileId: 'p1' });
  assert.deepEqual(arvore(dir), antes, 'a pasta do perfil ficou byte a byte igual');
  const reg = registros();
  assert.equal(reg.length, 1, 'o claude falso foi o executado');
  assert.deepEqual(reg[0].argv, ['auth', 'status', '--json']);
  assert.notEqual(path.resolve(reg[0].conf), path.resolve(dir), 'o CLI escreveu numa cópia, não na pasta do perfil');
  assert.equal(path.resolve(reg[0].segura), path.resolve(dir), 'a credencial é lida da pasta original');
  assert.equal(fs.existsSync(reg[0].conf), false, 'a cópia efêmera foi apagada');
  assert.equal(path.dirname(path.resolve(reg[0].conf)), path.resolve(os.tmpdir()), 'a cópia nasce no diretório temporário, nunca dentro da pasta do perfil');
  assert.deepEqual(r.perfil.campos.login, { valor: true, origem: 'validado' });
  assert.deepEqual(r.perfil.campos.email, { valor: 'sintetico@exemplo.invalid', origem: 'validado' }, 'a cópia leva o .claude.json');
});

test('a cópia efêmera nunca recebe a credencial, e leva o settings.json', async (t) => {
  if (!await falsoResolve(t)) return;
  const dir = path.join(BASE, 'perfil-b');
  semear(dir, '');
  const e = engineCom({ claudeProfiles: [{ id: 'p1', label: 'B', dir }], claudeProfileId: 'p1', accounts: [] });
  const vistos = [];
  const realRun = io.runShell;
  // espiona SEM trocar o comportamento: olha a cópia no instante em que o CLI roda
  io.runShell = async (linha, opts) => {
    const c = opts && opts.env && opts.env.CLAUDE_CONFIG_DIR;
    if (c && fs.existsSync(c)) vistos.push({ arquivos: fs.readdirSync(c).sort(), modo: fs.statSync(c).mode & 0o777 });
    return realRun(linha, opts);
  };
  try {
    await e.claudeTestarPerfil({ profileId: 'p1' });
  } finally {
    io.runShell = realRun;
  }
  assert.equal(vistos.length, 1);
  assert.deepEqual(vistos[0].arquivos, ['settings.json']);
  if (!IS_WIN) assert.equal(vistos[0].modo, 0o700, 'a cópia é privada');
});

// No Windows o modo POSIX não é observável no disco; a chamada é, nos dois sistemas.
test('a cópia efêmera é restringida (chmod 0700) antes de receber arquivo', async (t) => {
  if (!await falsoResolve(t)) return;
  const dir = path.join(BASE, 'perfil-d');
  semear(dir, 'sintetico@exemplo.invalid');
  const e = engineCom({ claudeProfiles: [{ id: 'p1', label: 'D', dir }], claudeProfileId: 'p1', accounts: [] });
  const ordem = [];
  const chmodReal = fs.chmodSync;
  const copyReal = fs.copyFileSync;
  fs.chmodSync = (p, modo) => { ordem.push(['chmod', path.resolve(String(p)), modo]); return chmodReal(p, modo); };
  fs.copyFileSync = (a, b, ...resto) => { ordem.push(['copia', path.resolve(path.dirname(String(b)))]); return copyReal(a, b, ...resto); };
  fs.rmSync(REGISTRO, { force: true });
  try {
    await e.claudeTestarPerfil({ profileId: 'p1' });
  } finally {
    fs.chmodSync = chmodReal;
    fs.copyFileSync = copyReal;
  }
  const copia = path.resolve(registros()[0].conf);
  assert.deepEqual(ordem[0], ['chmod', copia, 0o700], 'o primeiro ato sobre a cópia é restringir');
  assert.ok(ordem.slice(1).some((x) => x[0] === 'copia' && x[1] === copia), 'e só depois os arquivos entram');
});

test('falha ao copiar apaga a cópia parcial e não roda o CLI', async () => {
  const dir = path.join(BASE, 'perfil-e');
  semear(dir, '');
  // .claude.json que é diretório: existsSync diz sim, copyFileSync falha
  fs.mkdirSync(path.join(dir, '.claude.json'));
  const e = engineCom({ claudeProfiles: [{ id: 'p1', label: 'E', dir }], claudeProfileId: 'p1', accounts: [] });
  const mkdtempReal = fs.mkdtempSync;
  const realRun = io.runShell;
  const criadas = [];
  let rodou = false;
  fs.mkdtempSync = (...a) => { const p = mkdtempReal(...a); criadas.push(p); return p; };
  io.runShell = async () => { rodou = true; return { ok: false, code: 1, stdout: '', stderr: '' }; };
  try {
    await assert.rejects(() => e.claudeTestarPerfil({ profileId: 'p1' }));
  } finally {
    fs.mkdtempSync = mkdtempReal;
    io.runShell = realRun;
  }
  assert.equal(rodou, false);
  assert.equal(criadas.length, 1);
  assert.equal(fs.existsSync(criadas[0]), false, 'a cópia parcial foi apagada');
});

test('o padrão da máquina (sem pasta) não altera o ~/.claude.json nem o ~/.claude', async (t) => {
  if (!await falsoResolve(t)) return;
  semear(path.join(HOME_FALSO, '.claude'), '');
  fs.writeFileSync(path.join(HOME_FALSO, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'maquina@exemplo.invalid' } }));
  // o boot da Engine pré-confia o workspace no ~/.claude.json (ensureWorkspaceTrusted): é
  // escrita do boot, documentada, e não do teste do perfil; a foto vem depois dele
  const e = engineCom({ claudeProfiles: [], claudeProfileId: '', claudeConfigDir: '', accounts: [] });
  const antes = arvore(HOME_FALSO);
  fs.rmSync(REGISTRO, { force: true });
  const r = await e.claudeTestarPerfil({});
  assert.deepEqual(arvore(HOME_FALSO), antes, 'o home ficou byte a byte igual');
  const reg = registros();
  assert.equal(reg.length, 1);
  assert.equal(path.resolve(reg[0].segura), path.resolve(HOME_FALSO, '.claude'), 'a credencial vem do ~/.claude, como no uso normal');
  assert.equal(fs.existsSync(reg[0].conf), false);
  assert.deepEqual(r.perfil.campos.login, { valor: true, origem: 'validado' });
  assert.deepEqual(r.perfil.campos.email, { valor: 'maquina@exemplo.invalid', origem: 'validado' }, 'a cópia leva o ~/.claude.json');
});

test('CLI que falha ainda apaga a cópia efêmera', async () => {
  const dir = path.join(BASE, 'perfil-c');
  semear(dir, '');
  const e = engineCom({ claudeProfiles: [{ id: 'p1', label: 'C', dir }], claudeProfileId: 'p1', accounts: [] });
  const realRun = io.runShell;
  let copia = '';
  io.runShell = async (linha, opts) => {
    copia = opts.env.CLAUDE_CONFIG_DIR;
    throw new Error('queda simulada');
  };
  try {
    await assert.rejects(() => e.claudeTestarPerfil({ profileId: 'p1' }), /queda simulada/);
  } finally {
    io.runShell = realRun;
  }
  assert.ok(copia && path.resolve(copia) !== path.resolve(dir));
  assert.equal(fs.existsSync(copia), false, 'o finally apagou a cópia');
});

// A cópia efêmera carrega uma CÓPIA do .claude.json do perfil (conta e projetos). Se um
// processo morrer no meio, ela fica no diretório temporário e ninguém a apaga: o teste
// seguinte varre o que sobrou de antes. Achado ao conferir a pasta temporária depois da
// jornada de 16/09/2026, onde 20 cópias de medições anteriores continuavam lá.
test('cópias efêmeras esquecidas por execuções anteriores são varridas', async (t) => {
  if (!await falsoResolve(t)) return;
  const velha = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-teste-perfil-'));
  fs.writeFileSync(path.join(velha, '.claude.json'), '{"oauthAccount":{"emailAddress":"nao-deve-ficar"}}');
  const antiga = Date.now() - 2 * 60 * 60 * 1000;
  fs.utimesSync(velha, new Date(antiga), new Date(antiga));
  const recente = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-teste-perfil-'));

  try {
    const dir = path.join(BASE, 'perfil-varredura');
    semear(dir, 'sintetico@exemplo.invalid');
    const e = engineCom({ claudeProfiles: [{ id: 'p1', label: 'A', dir }], claudeProfileId: 'p1', accounts: [] });
    await e.claudeTestarPerfil({ profileId: 'p1' });
    assert.equal(fs.existsSync(velha), false, 'a cópia velha foi apagada');
    assert.equal(fs.existsSync(recente), true, 'cópia recente de outra execução em andamento não é tocada');
  } finally {
    // o próprio teste não pode virar fonte de cópia esquecida quando falha
    fs.rmSync(velha, { recursive: true, force: true });
    fs.rmSync(recente, { recursive: true, force: true });
  }
});
