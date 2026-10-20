// Os provedores de IA que rodam revisão (20/10/2026), num lugar só. PURO.
//
// A cadeia de perfis (lib/engine/cadeia-perfis.js) mistura perfis de provedores diferentes
// (assinatura do Claude, chave de API, Codex e, depois, o Antigravity CLI), e cada perfil
// precisa responder três perguntas sem que o resto do engine conheça o provedor:
//
//   1. COMO RODA: quais `kind` de perfil pertencem a ele. O despacho da sessão
//      (runProvedor, lib/engine/session.js) pergunta `provedorDoKind(auth.kind)`.
//   2. QUAIS MODELOS ACEITA: o par de campos da config (`campoModelo`, `campoEsforco`) e os
//      saneadores, que moram em lib/parse.js, a ÚNICA porta de valor de config para a linha
//      de comando. Cada provedor tem o próprio par: modelo de um nunca chega à linha do
//      outro, porque o saneador de um recusa o vocabulário do outro.
//   3. COMO SINALIZA O LIMITE: `limiteDaMensagem` diz se a falha foi limite de plano e até
//      quando. O padrão lê a tabela única de falhas (lib/log-taxonomy.js, classe de
//      `kind` espera-reset) e a hora do reset (`resetAtFrom`).
//
// Provedor novo (o `agy`, medido em docs/superpowers/specs/2026-10-20-agy-provedor.md) entra
// declarando uma entrada aqui, os saneadores dele em lib/parse.js, o catálogo em
// lib/modelos.js e o ramo de execução em session.js. A cadeia, o registro de limite
// (lib/engine/limite-plano.js) e a tela não mudam. O contrato está em docs/CONFIGURATION.md,
// seção "Cadeia de perfis".
import { sanitizeClaudeModel, sanitizeClaudeEffort, sanitizeCodexModel, sanitizeCodexEffort } from '../parse.js';
import { classify, resetAtFrom } from '../log-taxonomy.js';

// Leitura padrão do limite: a classe da falha decide, a mensagem diz a hora. Sem hora, `ate`
// é null e quem registra aplica o prazo estimado (TEMPOS.LIMITE_PLANO_SEM_HORA_MS).
function limitePelaTaxonomia(msg, agora = Date.now()) {
  const texto = typeof msg === 'string' ? msg : '';
  if (!texto || classify(texto).kind !== 'espera-reset') return { limite: false, ate: null };
  const reset = resetAtFrom(texto, new Date(agora));
  return { limite: true, ate: reset ? reset.getTime() : null };
}

const PROVEDORES = Object.freeze([
  Object.freeze({
    id: 'claude',
    rotulo: 'Claude Code',
    kinds: Object.freeze(['dir', 'maquina', 'apikey', 'openrouter']),
    campoModelo: 'reviewModel',
    campoEsforco: 'reviewEffort',
    saneiaModelo: sanitizeClaudeModel,
    saneiaEsforco: sanitizeClaudeEffort,
    limiteDaMensagem: limitePelaTaxonomia,
  }),
  Object.freeze({
    id: 'codex',
    rotulo: 'Codex',
    kinds: Object.freeze(['codex']),
    campoModelo: 'codexReviewModel',
    campoEsforco: 'codexReviewEffort',
    saneiaModelo: sanitizeCodexModel,
    saneiaEsforco: sanitizeCodexEffort,
    limiteDaMensagem: limitePelaTaxonomia,
  }),
]);

// O lugar reservado: o que a tela mostra enquanto o provedor ainda não roda. Não tem campo
// de config nem saneador, então nada dele chega à linha de comando.
const RESERVADOS = Object.freeze([
  Object.freeze({ id: 'agy', rotulo: 'Antigravity (Gemini)', motivo: 'em medição; entra numa versão seguinte' }),
]);

// perfil sem `kind` é o de pasta (o formato mais antigo), que é do Claude
function provedorDoKind(kind) {
  const k = kind ? String(kind) : 'dir';
  return PROVEDORES.find(p => p.kinds.includes(k)) || null;
}

function provedorDoPerfil(perfil) {
  return provedorDoKind(perfil && perfil.kind);
}

// O par que a sessão daquele provedor usa, já pelo saneador dele. Valor que o saneador
// recusa vira '' (o CLI decide), nunca o valor cru.
function modeloDoProvedor(config, provedorId) {
  const p = PROVEDORES.find(x => x.id === provedorId);
  if (!p) return { modelo: '', esforco: '' };
  const c = config || {};
  return { modelo: p.saneiaModelo(c[p.campoModelo]) || '', esforco: p.saneiaEsforco(c[p.campoEsforco]) || '' };
}

function limiteDaMensagem(provedorId, msg, agora = Date.now()) {
  const p = PROVEDORES.find(x => x.id === provedorId) || PROVEDORES[0];
  return p.limiteDaMensagem(msg, agora);
}

// O que a tela recebe: só dados, por allowlist (função não atravessa JSON)
function provedoresParaTela(config) {
  return {
    ativos: PROVEDORES.map(p => ({ id: p.id, rotulo: p.rotulo, ...modeloDoProvedor(config, p.id) })),
    reservados: RESERVADOS.map(r => ({ ...r })),
  };
}

export default { PROVEDORES, RESERVADOS, provedorDoKind, provedorDoPerfil, modeloDoProvedor, limiteDaMensagem, provedoresParaTela };
export { PROVEDORES, RESERVADOS, provedorDoKind, provedorDoPerfil, modeloDoProvedor, limiteDaMensagem, provedoresParaTela };
