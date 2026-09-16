// Saneador da chave `sync` do config.json. Puro: sem estado, sem IO, sem rede.
//
// A sincronização entre dispositivos é opt-in e nasce desligada. Os três
// interruptores só ligam com `true` explícito: config.json editado à mão, corrompido
// ou de versão antiga nunca pode ligar sozinho uma coordenação que segura revisão.
//
// A URL do banco passa por allowlist de host, não por escape: é para lá que o ID
// token do usuário viaja na query (`?auth=`), então um host qualquer seria entregar
// a credencial a terceiro.
import { SYNC } from '../constants.js';

const API_KEY_RE = /^[A-Za-z0-9_-]{10,128}$/;
const PROJECT_ID_RE = /^[a-z0-9-]{1,64}$/;
const MAX_NOME = 40;
const HOSTS_FIREBASE = ['.firebaseio.com', '.firebasedatabase.app'];
// o emulador do Firebase só fala http, e só em máquina local
const HOSTS_EMULADOR = ['127.0.0.1', 'localhost'];

function syncDefaults() {
  return {
    enabled: false, coordination: { enabled: false }, consolidation: { enabled: false }, shared: { enabled: false },
    distribution: { enabled: false }, aceitarAdmin: false,
    deviceName: '', apiKey: '', databaseUrl: '', projectId: '',
  };
}

function lerUrl(texto) {
  try { return new URL(texto); } catch { return null; }
}

function hostPermitido(u) {
  if (u.protocol === 'https:') return HOSTS_FIREBASE.some((h) => u.hostname.endsWith(h));
  if (u.protocol === 'http:') return HOSTS_EMULADOR.includes(u.hostname);
  return false;
}

function databaseUrlProblema(url) {
  const texto = typeof url === 'string' ? url.trim() : '';
  if (!texto) return 'informe a URL do banco';
  const u = lerUrl(texto);
  if (!u) return 'a URL do banco não é um endereço válido';
  if (!hostPermitido(u)) return 'a URL do banco precisa ser https no domínio do Firebase (ou http em 127.0.0.1/localhost, para o emulador)';
  if (u.username || u.password) return 'a URL do banco não pode carregar usuário nem senha';
  if ((u.pathname && u.pathname !== '/') || u.search || u.hash) return 'a URL do banco é só o endereço, sem caminho, parâmetro ou âncora';
  return '';
}

// Campo vazio de propósito limpa a URL (é o recurso deixando de estar configurado);
// qualquer outro valor inválido mantém a que já estava, pelo mesmo motivo do
// `ouAtual` de lib/settings.js: um erro de digitação não pode apagar a configuração
// que funcionava.
function sanearUrl(v, atual) {
  const anterior = atual && typeof atual.databaseUrl === 'string' ? atual.databaseUrl : '';
  if (typeof v === 'string' && !v.trim()) return '';
  if (databaseUrlProblema(v)) return anterior;
  const u = new URL(v.trim());
  return `${u.protocol}//${u.host}`;
}

function interruptor(obj) {
  return { enabled: !!(obj && typeof obj === 'object' && obj.enabled === true) };
}

function texto(v, re) {
  return typeof v === 'string' && re.test(v) ? v : '';
}

function parseSyncConfig(raw, atual) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    enabled: r.enabled === true,
    coordination: interruptor(r.coordination),
    consolidation: interruptor(r.consolidation),
    // CT-ENV: conteúdo cifrado só sobe com este interruptor ligado. Nasce desligado e,
    // como os outros, só liga com `true` explícito: config de versão antiga não pode
    // começar a publicar título de PR de colega por conta própria.
    shared: interruptor(r.shared),
    // 7.C5: distribuir trabalho entre aparelhos EXIGE coordenação (lease e recibo são o
    // que impede dois aparelhos revisando o mesmo PR). Sem coordenação, o saneador zera:
    // ligar só a distribuição seria prometer arbitragem que não existe.
    distribution: { enabled: interruptor(r.distribution).enabled && interruptor(r.coordination).enabled },
    // CT-ADM-POL: consentimento para aceitar política do admin. Só liga com `true`
    // explícito, e só pela tela DESTE aparelho: nenhum payload remoto e nenhuma leitura
    // do banco carregam esta chave, senão o admin se autorizaria sozinho.
    aceitarAdmin: r.aceitarAdmin === true,
    deviceName: typeof r.deviceName === 'string' ? r.deviceName.trim().slice(0, MAX_NOME) : '',
    apiKey: texto(r.apiKey, API_KEY_RE),
    databaseUrl: sanearUrl(r.databaseUrl, atual),
    projectId: texto(r.projectId, PROJECT_ID_RE),
  };
}

// O login segue o banco: banco do emulador (o único http que databaseUrlProblema
// aceita, e só em máquina local) pede o Auth do emulador também. Sem isso a validação
// manual da Fase 5 (firebase/README.md) só rodaria contra um projeto real, com rede e
// senha de verdade. Qualquer outra URL, inclusive a inválida, fica no Auth de
// produção: um valor torto nunca desvia a senha para outro endereço.
function authUrlsFor(databaseUrl) {
  const emulador = !databaseUrlProblema(databaseUrl) && new URL(databaseUrl.trim()).protocol === 'http:';
  if (emulador) return { identityUrl: SYNC.AUTH_EMULATOR_IDENTITY_URL, tokenUrl: SYNC.AUTH_EMULATOR_TOKEN_URL };
  return { identityUrl: SYNC.IDENTITY_TOOLKIT_URL, tokenUrl: SYNC.SECURE_TOKEN_URL };
}

function coordinationActive(cfg) {
  return !!(cfg && cfg.enabled === true && cfg.coordination && cfg.coordination.enabled === true);
}

function consolidationActive(cfg) {
  return !!(cfg && cfg.enabled === true && cfg.consolidation && cfg.consolidation.enabled === true);
}

function sharedActive(cfg) {
  return !!(cfg && cfg.enabled === true && cfg.shared && cfg.shared.enabled === true);
}

// Distribuição exige, junto: a chave geral, o conteúdo cifrado (o candidato leva nome de
// owner cifrado) e a coordenação.
function distributionActive(cfg) {
  return !!(sharedActive(cfg) && coordinationActive(cfg) && cfg.distribution && cfg.distribution.enabled === true);
}

// Aplica um bloqueio vindo de FORA da config (hoje: o celular sem autenticação exigida).
// Compartilhamento desligado derruba a distribuição junto, que depende dele.
// O inverso do bloqueio, para a GRAVAÇÃO: devolve a configuração com o que a pessoa pediu,
// mesmo que o efeito esteja desligado em memória. Gravar o valor forçado apagaria a escolha
// dela em silêncio, e nem com a autenticação exigida ela voltaria.
function comCompartilhamentoPedido(cfg, pedido) {
  const base = cfg || {};
  const p = pedido || {};
  return { ...base, shared: { ...(base.shared || {}), enabled: p.shared === true }, distribution: { ...(base.distribution || {}), enabled: p.distribution === true } };
}

function comCompartilhamentoBloqueado(cfg) {
  return { ...cfg, shared: { enabled: false }, distribution: { enabled: false } };
}

export default { comCompartilhamentoBloqueado, comCompartilhamentoPedido, syncDefaults, parseSyncConfig, coordinationActive, consolidationActive, sharedActive, distributionActive, databaseUrlProblema, authUrlsFor };
export { comCompartilhamentoBloqueado, comCompartilhamentoPedido, syncDefaults, parseSyncConfig, coordinationActive, consolidationActive, sharedActive, distributionActive, databaseUrlProblema, authUrlsFor };
