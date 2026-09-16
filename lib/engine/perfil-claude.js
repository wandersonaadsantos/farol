// Plano e chaves explícito (spec 7.A2): o que a tela de perfis de assinatura precisa saber e
// ainda não tinha caminho, sem nenhuma escrita que o usuário não tenha pedido.
//
// TRÊS COISAS, e nenhuma decide sessão:
// 1. `problemasDePerfil`: id de perfil que não existe ou perfil que não resolve. A cascata do
//    resolveClaudeAuth cai no legado nesses casos, e isso era SILENCIOSO: a tela dizia "usa o
//    padrão" enquanto a pessoa achava que estava num perfil. A queda continua (tirar a sessão
//    do ar por um id apagado seria pior), mas agora aparece no snapshot e no Diagnóstico.
// 2. `testarPerfil`: o ato explícito de testar, como "Testar leitura" do Jira. Diz de onde
//    veio cada informação (informado, detectado, validado, inferido, desconhecido) e NUNCA
//    grava a configuração. O nome comercial do plano não sai: nada que o CLI devolve o prova.
// 3. `adotarLegado`: quem roda sem perfil ganha a prévia do perfil equivalente, e só uma
//    confirmação literal grava.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import io from '../io.js';
import { loginConsoleEnv } from './session.js';

const CODIGOS = Object.freeze({
  INEXISTENTE: 'perfil-inexistente',
  INVALIDO: 'perfil-invalido',
  JA_TEM_PERFIS: 'ja-tem-perfis',
  PADRAO_DA_MAQUINA: 'padrao-da-maquina',
});
const MOTIVO_PLANO = 'o nome comercial do plano não é detectável com confiança pelo que o Claude Code informa';
const ROTULO_MAX = 60;

function lista(v) {
  return Array.isArray(v) ? v : [];
}

function campo(valor, origem, motivo) {
  return motivo ? { valor, origem, motivo } : { valor, origem };
}

/**
 * O shape de autenticação de um perfil já escolhido, ou null quando ele não resolve. É a
 * regra única de "perfil utilizável": a cascata real (server.js) e o aviso de problema
 * leem daqui, senão o aviso diria que está tudo bem com um perfil que a sessão ignora.
 */
function authFromProfile(p) {
  if (!p) return null;
  if (p.kind === 'codex') return { kind: 'codex', id: p.id };
  if (p.kind === 'openrouter' && p.apiKey) {
    return { kind: 'openrouter', id: p.id, apiKey: p.apiKey, baseUrl: p.baseUrl || '' };
  }
  if (p.kind === 'apikey' && p.apiKey) {
    return { kind: 'apikey', id: p.id, apiKey: p.apiKey, baseUrl: p.baseUrl || '' };
  }
  if (p.kind !== 'apikey' && p.kind !== 'openrouter' && p.dir) {
    return { kind: 'dir', id: p.id, dir: p.dir };
  }
  return null;
}

function problemaDoId(perfis, id) {
  if (!id) return '';
  const p = perfis.find((x) => x && x.id === id);
  if (!p) return CODIGOS.INEXISTENTE;
  return authFromProfile(p) ? '' : CODIGOS.INVALIDO;
}

/** Cada id de perfil apontado pela configuração que a cascata não consegue usar. */
function problemasDePerfil(config) {
  const cfg = config || {};
  const perfis = lista(cfg.claudeProfiles);
  const out = [];
  const padrao = problemaDoId(perfis, cfg.claudeProfileId);
  if (padrao) out.push({ escopo: 'padrao', user: '', profileId: cfg.claudeProfileId, code: padrao });
  for (const conta of lista(cfg.accounts)) {
    const code = problemaDoId(perfis, conta && conta.claudeProfileId);
    if (code) out.push({ escopo: 'conta', user: conta.user, profileId: conta.claudeProfileId, code });
  }
  return out;
}

// --- teste explícito --------------------------------------------------------------------

function emailDoArquivo(dir) {
  if (!dir) return '';
  const j = io.readJson(path.join(dir, '.claude.json'), {});
  const conta = j && j.oauthAccount;
  return (conta && typeof conta.emailAddress === 'string') ? conta.emailAddress : '';
}

// Só o que o Farol usa da resposta do CLI; o resto (inclusive o tipo de assinatura) fica fora.
function lerStatus(r) {
  const j = io.parseJson(String((r && r.stdout) || '').trim(), null);
  if (!j || typeof j !== 'object' || typeof j.loggedIn !== 'boolean') return null;
  const email = [j.email, j.emailAddress, j.account && j.account.email].find((v) => typeof v === 'string' && v) || '';
  return { loggedIn: j.loggedIn, authMethod: typeof j.authMethod === 'string' ? j.authMethod : '', email };
}

// O que o `auth status` lê da pasta de configuração, além da credencial: a conta (e-mail) e os
// settings (que podem mudar o método de autenticação). A credencial NUNCA é copiada.
const ARQUIVOS_DA_PASTA = Object.freeze(['settings.json', '.config.json']);

// Cópia efêmera e privada da configuração do perfil. Medido com o Claude Code 2.1.268:
// `claude auth status` REESCREVE o `.claude.json` da pasta de configuração e cria `backups/`
// nela, mesmo numa pasta vazia. Sem a cópia, "testar" alterava a pasta real da assinatura (e,
// no padrão da máquina, o `~/.claude.json`). Sem pasta, o CLI usa `~/.claude` e o arquivo de
// conta mora FORA dela, em `~/.claude.json`.
function copiaEfemera(dir) {
  const base = dir || path.join(os.homedir(), '.claude');
  const conta = dir ? path.join(dir, '.claude.json') : path.join(os.homedir(), '.claude.json');
  const copia = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-teste-perfil-'));
  fs.chmodSync(copia, 0o700);
  const copiar = (origem, nome) => {
    if (fs.existsSync(origem)) fs.copyFileSync(origem, path.join(copia, nome));
  };
  try {
    copiar(conta, '.claude.json');
    for (const nome of ARQUIVOS_DA_PASTA) copiar(path.join(base, nome), nome);
  } catch (err) {
    fs.rmSync(copia, { recursive: true, force: true });
    throw err;
  }
  return copia;
}

// `claude auth status` não chama modelo. Sai com código 1 quando não há login, e isso é
// resposta: o que decide é o JSON. Roda com o mesmo ambiente limpo da sessão de login, com
// duas trocas: a configuração é a cópia efêmera, e CLAUDE_SECURESTORAGE_CONFIG_DIR aponta
// para a pasta ORIGINAL, que é de onde o CLI lê a credencial (o `.credentials.json` no
// Windows e no Linux; no macOS, o item do keychain cujo nome deriva dessa pasta). Vazia, ela
// equivale ao padrão da máquina (`~/.claude`, keychain sem sufixo).
async function statusDoClaude(dir) {
  const copia = copiaEfemera(dir);
  try {
    const env = loginConsoleEnv(dir);
    env.CLAUDE_CONFIG_DIR = copia;
    env.CLAUDE_SECURESTORAGE_CONFIG_DIR = dir || '';
    const r = await io.runShell('claude auth status --json', { env });
    return lerStatus(r);
  } finally {
    fs.rmSync(copia, { recursive: true, force: true });
  }
}

function camposDeChave(p) {
  const tipo = p.kind === 'openrouter' ? 'openrouter' : 'chave-de-api';
  return {
    tipoAuth: campo(tipo, 'informado'),
    chave: campo('preenchida', 'informado'),
    login: campo(null, 'desconhecido', 'testar a chave exigiria uma chamada paga ao provedor'),
    email: campo(null, 'desconhecido'),
    plano: campo(null, 'desconhecido', MOTIVO_PLANO),
  };
}

function camposDoCodex(engine) {
  const d = engine.doctorInfo || {};
  const sabe = typeof d.codexChatGPT === 'boolean';
  return {
    tipoAuth: campo('codex', 'informado'),
    login: sabe ? campo(d.codexChatGPT, 'inferido', 'da última verificação do ambiente') : campo(null, 'desconhecido'),
    email: campo(null, 'desconhecido'),
    plano: campo(null, 'desconhecido', MOTIVO_PLANO),
  };
}

function emailDe(status, arquivo) {
  if (status && status.email) return campo(status.email, 'validado');
  if (arquivo) return campo(arquivo, 'detectado');
  return campo(null, 'desconhecido');
}

async function camposDeAssinatura(engine, alvo) {
  const dir = alvo.dir || '';
  const status = await statusDoClaude(dir);
  const arquivo = emailDoArquivo(dir);
  const campos = {
    configDir: dir ? campo(dir, 'informado') : campo(null, 'inferido', 'padrão da máquina'),
    email: emailDe(status, arquivo),
    plano: campo(null, 'desconhecido', MOTIVO_PLANO),
  };
  if (status) {
    campos.login = campo(status.loggedIn, 'validado');
    campos.tipoAuth = campo(status.authMethod || null, status.authMethod ? 'validado' : 'desconhecido');
    return { campos, aviso: '' };
  }
  const info = typeof engine.claudeAuthInfo === 'function' ? engine.claudeAuthInfo(dir) : { ready: !!arquivo };
  campos.login = campo(!!info.ready, 'inferido', 'pelos arquivos da pasta');
  campos.tipoAuth = campo(null, 'desconhecido');
  return { campos, aviso: 'o Claude Code não respondeu à verificação; o que aparece aqui foi lido dos arquivos da pasta' };
}

function alvoDoTeste(engine, id) {
  if (!id) return { perfil: { id: '', label: 'Padrão da máquina', kind: 'dir', dir: engine.config.claudeConfigDir || '' } };
  const p = lista(engine.config.claudeProfiles).find((x) => x && x.id === id);
  if (!p) return { erro: { ok: false, code: CODIGOS.INEXISTENTE, motivo: 'esse perfil não existe mais na configuração' } };
  if (!authFromProfile(p)) return { erro: { ok: false, code: CODIGOS.INVALIDO, motivo: 'esse perfil está incompleto: falta a pasta ou a chave' } };
  return { perfil: p };
}

async function testarPerfil(engine, dados) {
  const alvo = alvoDoTeste(engine, String((dados && dados.profileId) || ''));
  if (alvo.erro) return alvo.erro;
  const p = alvo.perfil;
  const base = { id: p.id, label: String(p.label || ''), kind: p.kind || 'dir' };
  if (p.kind === 'apikey' || p.kind === 'openrouter') return { ok: true, escreveu: false, perfil: { ...base, campos: camposDeChave(p), aviso: '' } };
  if (p.kind === 'codex') return { ok: true, escreveu: false, perfil: { ...base, campos: camposDoCodex(engine), aviso: '' } };
  const { campos, aviso } = await camposDeAssinatura(engine, p);
  return { ok: true, escreveu: false, perfil: { ...base, campos, aviso } };
}

// --- adoção guiada do legado -------------------------------------------------------------

function previaDaAdocao(config) {
  if (lista(config.claudeProfiles).length) return { ok: false, code: CODIGOS.JA_TEM_PERFIS };
  // sem pasta própria, o Claude usa o padrão da máquina, que não cabe num perfil de pasta:
  // o arquivo de conta mora fora da pasta de configuração nesse caso
  if (!config.claudeConfigDir) return { ok: false, code: CODIGOS.PADRAO_DA_MAQUINA };
  return { ok: true, perfil: { kind: 'dir', label: 'Assinatura desta máquina', dir: config.claudeConfigDir } };
}

function novoId() {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function adotarLegado(engine, dados) {
  const previa = previaDaAdocao(engine.config);
  if (!previa.ok) return previa;
  if (!dados || dados.confirmar !== true) return { ...previa, escreveu: false, precisaConfirmar: true };
  const label = String(dados.label || '').trim().slice(0, ROTULO_MAX) || previa.perfil.label;
  const perfil = { id: novoId(), label, dir: previa.perfil.dir };
  engine.updateSettings({ claudeProfiles: [perfil], claudeProfileId: perfil.id });
  return { ok: true, escreveu: true, perfil };
}

export default { CODIGOS, authFromProfile, problemasDePerfil, testarPerfil, previaDaAdocao, adotarLegado, statusDoClaude };
export { CODIGOS, authFromProfile, problemasDePerfil, testarPerfil, previaDaAdocao, adotarLegado, statusDoClaude };
