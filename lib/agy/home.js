// A pasta de cada perfil do Antigravity CLI e o que mora dentro dela.
//
// `~/.farol/agy/<id>/` é a home do `agy` daquele perfil (lib/agy/ambiente.js): o token do
// login Google, a configuração, os logs, as conversas e a memória (`brain/`) da conta. Mora
// em ~/.farol pelo invariante 2 e fora do workspace da sessão, como a credencial do Jira. O
// token fica em arquivo JSON legível (é o truque do `SSH_*`, seção 2 da medição), então:
//   - a pasta é 0700 no POSIX, a cada uso;
//   - nada daqui lista o conteúdo da pasta para fora: o diagnóstico só diz se o arquivo do
//     token existe (`temLogin`), e o pacote e a sincronização nunca leem ~/.farol/agy;
//   - o arquivo do token nunca é aberto pelo Farol.
//
// Limpeza (spec, seção 5): `brain/` e `conversations/` crescem por revisão (2,6 MB e 5,1 MB
// numa revisão medida; relato de 15 GB num usuário). A sessão encerrada leva a conversa
// dela embora, menos a que o chat do PR ainda pode retomar.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AGY_DIR, IS_WIN } from '../paths.js';
import { TEMPOS } from '../constants.js';
import { ID_DE_PASTA } from '../parse.js';
import envMod from '../env.js';

const CLI_DIR = path.join('.gemini', 'antigravity-cli');
const ARQUIVO_DO_TOKEN = 'antigravity-oauth-token';
// conversa do `agy` é um uuid (lido do evento `init`); nada além disso vira caminho
const ID_DE_CONVERSA = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOGS_GUARDADOS = 30;

function pastaDoPerfil(id) {
  const s = String(id || '');
  return ID_DE_PASTA.test(s) ? path.join(AGY_DIR, s) : '';
}

function garantirPasta(id) {
  const pasta = pastaDoPerfil(id);
  if (!pasta) return '';
  fs.mkdirSync(pasta, { recursive: true });
  if (!IS_WIN) {
    try { fs.chmodSync(AGY_DIR, 0o700); fs.chmodSync(pasta, 0o700); } catch { /* pasta de outro dono: o agy diz se conseguir ler */ }
  }
  return pasta;
}

function dirDoCli(pasta) { return path.join(pasta, CLI_DIR); }

// Só a existência do arquivo: o Farol nunca abre o token.
function temLogin(id) {
  const pasta = pastaDoPerfil(id);
  return !!pasta && fs.existsSync(path.join(dirDoCli(pasta), ARQUIVO_DO_TOKEN));
}

// O `agy` que o Farol roda. Teste aponta FAROL_AGY_CMD para um script Node (o agy falso),
// rodado pelo próprio Node. No Windows o instalador oficial põe o binário em
// %LOCALAPPDATA%\agy\bin, que o PATH do boot também recebe (server.js).
function comandoDoAgy() {
  const stub = envMod.agyCmdStub();
  if (stub) return { cmd: process.execPath, prefixo: [stub] };
  if (IS_WIN) {
    const instalado = path.join(os.homedir(), 'AppData', 'Local', 'agy', 'bin', 'agy.exe');
    if (fs.existsSync(instalado)) return { cmd: instalado, prefixo: [] };
  }
  return { cmd: 'agy', prefixo: [] };
}

// POSIX: a home do filho é a pasta do perfil, e o `git` volta ao ~/.gitconfig real por aqui
function gitconfigReal() {
  if (IS_WIN) return '';
  const real = path.join(os.homedir(), '.gitconfig');
  return fs.existsSync(real) ? real : '';
}

function apagar(alvo) {
  try { fs.rmSync(alvo, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); } catch { /* preso por outro processo: sai na próxima limpeza */ }
}

// Os rastros de UMA conversa: a memória, o banco da conversa (com o diário do SQLite) e a
// anotação. Nomes medidos na pasta de uma conta real (1.4.3).
function apagarConversa(cli, conversa) {
  apagar(path.join(cli, 'brain', conversa));
  for (const sufixo of ['.db', '.db-wal', '.db-shm']) apagar(path.join(cli, 'conversations', conversa + sufixo));
  apagar(path.join(cli, 'annotations', conversa + '.pbtxt'));
}

function conversasAntigas(cli, agora) {
  let nomes = [];
  try { nomes = fs.readdirSync(path.join(cli, 'brain')); } catch { return []; }
  return nomes.filter((n) => {
    if (!ID_DE_CONVERSA.test(n)) return false;
    try { return agora - fs.statSync(path.join(cli, 'brain', n)).mtimeMs > TEMPOS.AGY_CONVERSA_VELHA_MS; } catch { return false; }
  });
}

function podarLogs(cli) {
  let nomes = [];
  try { nomes = fs.readdirSync(path.join(cli, 'log')).filter((n) => /^cli-\d{8}_\d{6}\.log$/.test(n)).sort(); } catch { return; }
  for (const n of nomes.slice(0, Math.max(0, nomes.length - LOGS_GUARDADOS))) apagar(path.join(cli, 'log', n));
}

/**
 * Limpa o que a sessão encerrada deixou na pasta do perfil, e o que sobrou de sessões
 * antigas (mais de uma semana). `preservar` são as conversas que o chat do PR ainda retoma.
 * @param {string} id o perfil
 * @param {string} conversa a conversa da sessão que acabou ('' quando não houve)
 * @param {Set<string>} preservar
 */
function limparSessao(id, conversa, preservar = new Set(), agora = Date.now()) {
  const pasta = pastaDoPerfil(id);
  if (!pasta) return;
  const cli = dirDoCli(pasta);
  const alvos = new Set(conversasAntigas(cli, agora));
  if (ID_DE_CONVERSA.test(String(conversa || ''))) alvos.add(String(conversa));
  for (const c of alvos) if (!preservar.has(c)) apagarConversa(cli, c);
  podarLogs(cli);
}

// As conversas que um chat por PR pode retomar: a do próprio chat e a da revisão pendente
// que o chat herda quando ainda não tem a sua (lib/engine/chat.js).
function conversasDoChat(engine) {
  const ids = new Set();
  for (const c of Object.values(engine?.chats || {})) if (c?.sessionId) ids.add(String(c.sessionId));
  for (const d of engine?.decisions?.pending || []) if (d?.sessionId) ids.add(String(d.sessionId));
  return ids;
}

export default { pastaDoPerfil, garantirPasta, dirDoCli, temLogin, comandoDoAgy, gitconfigReal, limparSessao, conversasDoChat, ID_DE_CONVERSA };
export { pastaDoPerfil, garantirPasta, dirDoCli, temLogin, comandoDoAgy, gitconfigReal, limparSessao, conversasDoChat, ID_DE_CONVERSA };
