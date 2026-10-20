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
//    confirmação literal grava. Desde 20/10/2026 isso inclui o login padrão da máquina, que
//    vira o perfil `maquina` (nome editável, id fixo) sem mudar como a sessão autentica.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import io from '../io.js';
import { TEMPOS } from '../constants.js';
import { ID_MAQUINA, sanitizeAgyModel, AGY_MODELO_PADRAO } from '../parse.js';
import { loginConsoleEnv } from './session.js';
import { grupoDoModelo, lerCota, mascararEmail, contaConfere, restanteDoGrupo, voltaEm } from '../agy/cota.js';
import { temLogin } from '../agy/home.js';

const CODIGOS = Object.freeze({
  INEXISTENTE: 'perfil-inexistente',
  INVALIDO: 'perfil-invalido',
  JA_TEM_PERFIS: 'ja-tem-perfis',
  MAQUINA_JA_LISTADA: 'maquina-ja-listada',
  ID_MAQUINA_OCUPADO: 'id-maquina-ocupado',
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
function authFromProfile(p, config = {}) {
  if (!p) return null;
  if (p.kind === 'codex') return { kind: 'codex', id: p.id };
  // Antigravity: a pasta é derivada do id (lib/agy/home.js) e a cota é por grupo de modelos,
  // o do modelo configurado para o provedor (o limite de um grupo não trava o outro)
  if (p.kind === 'agy') return { kind: 'agy', id: p.id, grupo: grupoDoModelo(sanitizeAgyModel(config?.agyReviewModel) || AGY_MODELO_PADRAO) };
  // o login padrão da máquina: pasta vazia é o caminho de sempre, sem CLAUDE_CONFIG_DIR.
  // Medido com o Claude Code 2.1.295 (20/10/2026): apontar CLAUDE_CONFIG_DIR para ~/.claude
  // NÃO é o mesmo login, porque o CLI passa a ler a conta de ~/.claude/.claude.json em vez de
  // ~/.claude.json (e, no macOS, o item do keychain ganha sufixo derivado da pasta)
  if (p.kind === 'maquina') return { kind: 'dir', id: p.id, dir: '' };
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
// Cópia esquecida por um processo que morreu no meio carrega uma CÓPIA do .claude.json do
// perfil (conta e projetos) e ninguém a apaga. Antes de criar a próxima, varre as antigas:
// as recentes podem ser de outra execução em andamento e ficam.
const PREFIXO_COPIA = 'farol-teste-perfil-';
const COPIA_VELHA_MS = TEMPOS.HORA_MS;

function varrerCopiasVelhas(agora = Date.now()) {
  const raiz = os.tmpdir();
  let nomes = [];
  try { nomes = fs.readdirSync(raiz).filter((n) => n.startsWith(PREFIXO_COPIA)); } catch { return; }
  for (const nome of nomes) {
    const alvo = path.join(raiz, nome);
    try {
      if (agora - fs.statSync(alvo).mtimeMs < COPIA_VELHA_MS) continue;
      fs.rmSync(alvo, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    } catch { /* cópia de outro usuário ou em uso: não é nossa para apagar */ }
  }
}

function copiaEfemera(dir) {
  varrerCopiasVelhas();
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
    // maxRetries: no Windows o arquivo recém-escrito pelo CLI pode estar preso por um
    // instante, e uma falha aqui deixaria a cópia para trás
    fs.rmSync(copia, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
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

// Antigravity: o `/usage` da pasta do perfil (zero token) diz se há login, a conta que
// autenticou (mascarada) e a cota de cada grupo com a hora do reset. Não registra limite nem
// grava nada: o teste é só leitura.
function cotaLegivel(grupos) {
  return grupos.map((g) => {
    const pct = Math.round((restanteDoGrupo(g) ?? 0) * 100);
    const volta = voltaEm(g);
    const quando = volta ? ` (volta ${new Date(volta).toLocaleString('pt-BR')})` : '';
    return `${g.nome || g.grupo} ${pct}%${quando}`;
  }).join('; ');
}

function loginDoAgy(l) {
  if (l.ok) return campo(true, 'validado');
  if (l.semLogin) return campo(false, 'validado');
  return campo(null, 'desconhecido', l.erro);
}

async function camposDoAgy(engine, p) {
  const l = await lerCota(engine, p.id, { forcar: true });
  const confere = contaConfere(p, l);
  const campos = {
    tipoAuth: campo('antigravity', 'informado'),
    login: loginDoAgy(l),
    email: l.conta ? campo(mascararEmail(l.conta), 'validado') : campo(null, 'desconhecido'),
    plano: campo(null, 'desconhecido', MOTIVO_PLANO),
  };
  if (confere !== null) campos.contaConfere = campo(confere ? 'confere' : 'não confere', 'validado');
  if (l.ok) campos.cota = campo(cotaLegivel(l.grupos), 'validado');
  const aviso = temLogin(p.id) || l.ok ? '' : 'esta pasta ainda não tem login: use Abrir sessão de login';
  return { campos, aviso };
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
  if (p.kind === 'agy') return { ok: true, escreveu: false, perfil: { ...base, ...(await camposDoAgy(engine, p)) } };
  const { campos, aviso } = await camposDeAssinatura(engine, p);
  return { ok: true, escreveu: false, perfil: { ...base, campos, aviso } };
}

// --- adoção guiada do legado -------------------------------------------------------------

const ROTULO_MAQUINA = 'Login padrão desta máquina';

// Duas adoções. Com pasta legada (`claudeConfigDir`), o perfil de pasta, só para quem ainda
// não tem perfil nenhum. Sem ela, o login padrão da máquina vira o perfil `maquina`, que
// convive com os outros perfis: é ele que some da lista quando já existem perfis de pasta.
function previaDaAdocao(config) {
  const perfis = lista(config.claudeProfiles);
  if (config.claudeConfigDir) {
    if (perfis.length) return { ok: false, code: CODIGOS.JA_TEM_PERFIS };
    return { ok: true, perfil: { kind: 'dir', label: 'Assinatura desta máquina', dir: config.claudeConfigDir } };
  }
  if (perfis.some((p) => p && p.kind === 'maquina')) return { ok: false, code: CODIGOS.MAQUINA_JA_LISTADA };
  // o id fixo já é de outro perfil: listar criaria dois perfis com o mesmo id
  if (perfis.some((p) => p && p.id === ID_MAQUINA)) return { ok: false, code: CODIGOS.ID_MAQUINA_OCUPADO };
  return { ok: true, perfil: { kind: 'maquina', label: ROTULO_MAQUINA } };
}

function novoId() {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function adotarLegado(engine, dados) {
  const previa = previaDaAdocao(engine.config);
  if (!previa.ok) return previa;
  if (!dados || dados.confirmar !== true) return { ...previa, escreveu: false, precisaConfirmar: true };
  const label = String(dados.label || '').trim().slice(0, ROTULO_MAX) || previa.perfil.label;
  if (previa.perfil.kind === 'maquina') return listarMaquina(engine, label);
  const perfil = { id: novoId(), label, dir: previa.perfil.dir };
  engine.updateSettings({ claudeProfiles: [perfil], claudeProfileId: perfil.id });
  return { ok: true, escreveu: true, perfil };
}

// O perfil padrão só passa a ser o `maquina` quando estava vazio, e vazio já era esse mesmo
// login: nenhuma conta muda de assinatura por listar a da máquina.
function listarMaquina(engine, label) {
  const perfil = { id: ID_MAQUINA, label, kind: 'maquina' };
  const patch = { claudeProfiles: [...lista(engine.config.claudeProfiles), perfil] };
  if (!engine.config.claudeProfileId) patch.claudeProfileId = ID_MAQUINA;
  engine.updateSettings(patch);
  return { ok: true, escreveu: true, perfil };
}

export default { CODIGOS, authFromProfile, problemasDePerfil, testarPerfil, previaDaAdocao, adotarLegado, statusDoClaude };
export { CODIGOS, authFromProfile, problemasDePerfil, testarPerfil, previaDaAdocao, adotarLegado, statusDoClaude };
