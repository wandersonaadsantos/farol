// A decisão sem mesa (18/10/2026, v2.73.2). Regra do dono: "Se foi configurado pra aprovar
// sozinho ele aprova sozinho, se foi configurado pra reprovar sozinho ele reprova sozinho, sem
// depender da minha ação. Não quero desculpas pra entregar a decisão pra mim."
//
// PURO: sem IO e sem estado. Aqui moram as peças que o desfecho da revisão
// (desfecho-da-revisao.js), a espera do CI (espera-ci.js), a espera de PR próprio
// (espera-pr-proprio.js) e o reenvio (decision.js) leem do mesmo lugar:
//   - de onde veio a revisão (`origemDoDono`): fila, clique, Panorama, URL colada, pedido do
//     aparelho admin, comando e distribuição são todos o dono agindo; só um objeto sem marca
//     nenhuma é origem desconhecida, e ela continua sem postar sozinha;
//   - o que é DEFEITO do PR (violação técnica confirmada, achado técnico não resolvido, a parte
//     do card deste PR não entregue): com a conta reprovando sozinha, vira REQUEST_CHANGES;
//   - os textos públicos que o Farol monta sozinho (defeito, CI vermelho, PR próprio), sempre
//     sujeitos à trava de linguagem do postReview, e a reconstrução de um texto que ela barrou.
import { GAP_DA_PARTE_DO_CARD, LACUNA_DE_VIOLACAO, achadoBloqueia, reprovadasQueBloqueiam } from '../technical-review/verdict.js';
import { linhaDoAchado } from '../technical-review/divida-fora-das-linhas.js';
import { motivoPublico } from '../technical-review/motivo-publico.js';
import { publicTextLanguageIssues } from './public-review.js';
import { causasDosBloqueios } from './review-findings-contract.js';
// o "já saiu?" do reenvio mora em comentario-proprio.js (lê o GitHub); daqui só é reexportado
export { jaPublicado } from './comentario-proprio.js';

const VIOLACAO = LACUNA_DE_VIOLACAO;
const ACHADOS = 'achados técnicos não resolvidos';
const TEXTO_DO_DEFEITO = {
  [VIOLACAO]: 'há violação confirmada de um padrão técnico do repositório',
  [ACHADOS]: 'há achados técnicos que ainda não foram resolvidos',
  [GAP_DA_PARTE_DO_CARD]: 'a parte do card que cabe a este PR ainda não foi entregue',
};
const TETO_DO_ITEM = 300;
const TETO_DE_LUGARES = 5;

// As marcas que dizem de onde a revisão saiu. `origemDono` é a que a pendência grava
// (recordDecision) para quem relança a partir dela (reconferência técnica).
const MARCAS_DO_DONO = ['requested', 'manual', 'viaAdmin', 'viaComando', 'viaDistribuicao', 'origemDono'];

function origemDoDono(pr) {
  return !!pr && MARCAS_DO_DONO.some((m) => pr[m] === true);
}

function temTexto(payload) {
  if (!payload) return false;
  return !!(String(payload.body || '').trim() || (Array.isArray(payload.comments) && payload.comments.length));
}

// As lacunas do resultado que são defeito do PR (pedem mudança no código).
function defeitosDoPr(result) {
  const lista = Array.isArray(result && result.approvalEvidence) ? result.approvalEvidence : [];
  return [...new Set(lista.filter((g) => Object.hasOwn(TEXTO_DO_DEFEITO, g)))];
}

// A análise sustenta a reprovação quando terminou OU quando já confirmou defeito do PR. O que
// ficou inconclusivo não desfaz o defeito, e defeito não arma a recuperação durável
// (espera-prova.js): exigir análise completa deixava o PR na mesa com a conta reprovando
// sozinha (biblioteca-cnbb-api#143, 30/10/2026: violação confirmada, regra de imports
// inconclusiva). Aprovar continua exigindo análise completa.
function analiseSustentaReprovacao(result) {
  return result?.analysisStatus === 'complete' || defeitosDoPr(result).length > 0;
}

// Só defeito do código e a parte do card reprovam sozinhos (05/11/2026). Medido no dia em três PRs
// reais (tenant-company#293, biud-frontend#1784, engine-ai#880): o pedido de mudanças automático
// se apoiava em conflito com a base, CI que não rodou, arquivo fora do diff e critério do card.
const CAUSAS_QUE_REPROVAM = ['defeito_codigo', 'card'];

// Há bloqueio declarado e nenhum com causa que reprova. Envelope legado ou fora do contrato não
// declara causa (causasDosBloqueios devolve vazio) e segue a regra de antes.
function bloqueiosSoDeEstado(result) {
  const causas = causasDosBloqueios(result);
  return causas.size > 0 && ![...causas].some((c) => CAUSAS_QUE_REPROVAM.includes(c));
}

// O que a avaliação técnica provou (defeitosDoPr) reprova sem olhar a causa: a causa restringe só o
// que o modelo pode chamar de defeito sem prova, nunca o que a prova mostrou.
function reprovacaoSoDeEstado(result) {
  return result?.verdict === 'request_changes' && bloqueiosSoDeEstado(result) && defeitosDoPr(result).length === 0;
}

// Para onde vai a reprovação só de estado: a espera do CI, a espera do conflito ou a mesa
// (dependência e arquivo fora do diff, com o texto do modelo no card).
function causaDaEspera(result) {
  const causas = causasDosBloqueios(result);
  if (causas.has('ci')) return 'ci';
  return causas.has('conflito') ? 'conflito' : 'mesa';
}

const curto = (v) => String(v || '').replace(/[\r\n]+/g, ' ').trim().slice(0, TETO_DO_ITEM);

// A seção do defeito diz a CATEGORIA, com texto do app, e ONDE está o achado que bloqueia. Nome de
// regra, causa e mensagem da ferramenta vêm do catálogo privado da avaliação técnica e não vão ao
// texto público (PR #253). O arquivo e a linha são do próprio PR: sem eles o autor não sabe o que
// corrigir (engine-ai#1031, 11/11/2026: o pedido não dizia onde, e o autor mexeu em três coisas
// que não eram a causa). Entram os mesmos achados que seguram o merge (achadosQueBloqueiam: nem
// dívida descontada nem regra de organização); achado sem UMA linha lida da ferramenta sai pelo
// arquivo, para a lista não parecer completa sem a causa. Os lugares saem agrupados pelo MOTIVO da
// regra (motivo-publico.js): só o onde não bastou (biud-frontend#1992, 12/11/2026). Regra que
// bloqueia e ficou sem achado citável (o relatório guarda dez) entra com o motivo e sem lugar, para
// o texto nunca sair só com a categoria (backoffice#365, 14/11/2026). A regra sem frase pública
// entra como "outro padrão", para a lista não parecer completa sem ela.
function lugaresPorMotivo(result) {
  const achados = Array.isArray(result?.technicalReview?.findings) ? result.technicalReview.findings : [];
  const grupos = new Map();
  for (const a of achados) {
    if (!a || !achadoBloqueia(a) || typeof a.file !== 'string') continue;
    const linha = linhaDoAchado(a);
    const lugar = linha ? `${a.file}:${linha}` : a.file;
    if (!lugar || /[`\r\n]/.test(lugar)) continue;
    const motivo = motivoPublico(a.rule);
    if (!grupos.has(motivo)) grupos.set(motivo, []);
    if (!grupos.get(motivo).includes(lugar)) grupos.get(motivo).push(lugar);
  }
  for (const r of reprovadasQueBloqueiam(result?.technicalReview)) {
    const motivo = motivoPublico(r.rule);
    if (!grupos.has(motivo)) grupos.set(motivo, []);
  }
  return grupos;
}

// O relatório guarda só os primeiros achados (runtime.js), então o total não é conhecido: passou do
// teto, o texto diz "e outros" em vez de inventar um número.
function citar(lugares) {
  const citados = lugares.slice(0, TETO_DE_LUGARES).map((l) => `\`${l}\``).join(', ');
  return `em ${citados}${lugares.length > TETO_DE_LUGARES ? ' e outros' : ''}`;
}

function itemDoMotivo(motivo, lugares) {
  return lugares.length ? `  - ${motivo}: ${citar(lugares)}` : `  - ${motivo}`;
}

// Só o grupo sem frase pública: a categoria já diz tudo o que se pode dizer, com o lugar se houver.
function emLinha(texto, lugares) {
  return lugares.length ? `${texto}, ${citar(lugares)}` : texto;
}

function itemDoDefeito(gap, result) {
  const texto = `- ${TEXTO_DO_DEFEITO[gap]}`;
  if (gap !== VIOLACAO) return texto;
  const grupos = lugaresPorMotivo(result);
  if (!grupos.size) return texto;
  if (grupos.size === 1 && grupos.has(null)) return emLinha(texto, grupos.get(null));
  const itens = [...grupos].map(([motivo, lugares]) => itemDoMotivo(motivo || 'outro padrão técnico do repositório', lugares));
  return [`${texto}:`, ...itens].join('\n');
}

function secaoDoDefeito(defeitos, result) {
  return ['Antes do merge, isto precisa ser resolvido:', '', ...defeitos.map((g) => itemDoDefeito(g, result))].join('\n');
}

// O REQUEST_CHANGES de um resultado que concluiu aprovar mas tem defeito do PR. O pedido de
// mudanças que a própria revisão escreveu (os três payloads vêm sempre) entra depois da seção
// do defeito, com os comentários de linha; `soDefeito` monta só a seção, que é a reconstrução
// quando a trava de linguagem barra o texto da sessão.
function payloadDoDefeito(result, defeitos, { soDefeito = false } = {}) {
  const secao = secaoDoDefeito(defeitos, result);
  const rc = result && result.payloads && result.payloads.request_changes;
  if (soDefeito || !temTexto(rc)) return { event: 'REQUEST_CHANGES', body: secao, comments: [] };
  const body = [secao, String(rc.body || '').trim()].filter(Boolean).join('\n\n');
  return { event: 'REQUEST_CHANGES', body, comments: Array.isArray(rc.comments) ? rc.comments : [] };
}

// O REQUEST_CHANGES do CI obrigatório vermelho no commit revisado. Só cita os checks: o
// código em si estava aprovável; o parecer publicado encerra a revisão deste head.
function payloadDoCiVermelho(checks, head) {
  const nomes = (Array.isArray(checks) ? checks : []).map((c) => curto(c && (c.nome || c.name || c))).filter(Boolean);
  const lista = nomes.length ? nomes.map((n) => `\`${n}\``).join(', ') : 'obrigatórios';
  const sha = String(head || '').slice(0, 7);
  const body = `Os checks obrigatórios ${lista} estão falhando${sha ? ` no commit ${sha}` : ''}. `
    + 'O merge precisa dos checks obrigatórios verdes; confira a falha antes de integrar.';
  return { event: 'REQUEST_CHANGES', body, comments: [] };
}

// O COMMENT de um PR da própria conta que revisa: o GitHub não aceita APPROVE nem
// REQUEST_CHANGES do autor. Prefere o payload de comentário que a revisão escreveu; sem
// ele, o texto do veredito, como comentário.
function payloadDoPrProprio(result) {
  const p = (result && result.payloads) || {};
  const escolhido = [p.comment, p[result && result.verdict]].find(temTexto);
  if (!escolhido) return null;
  return { event: 'COMMENT', body: String(escolhido.body || '').trim(), comments: Array.isArray(escolhido.comments) ? escolhido.comments : [] };
}

// Reconstrução UMA vez do texto que a trava de linguagem barrou: sai cada comentário de
// linha barrado e cada parágrafo do corpo barrado. Devolve null quando nada muda ou quando
// não sobra texto (e então a postagem não sai: o motivo vai para o card como infra).
function reconstruirPayload(payload, conta = '') {
  if (!payload || typeof payload !== 'object') return null;
  const paragrafos = String(payload.body || '').split(/\n{2,}/);
  const limpos = paragrafos.filter((p) => !publicTextLanguageIssues(p, 'body', conta).length);
  const comentarios = (Array.isArray(payload.comments) ? payload.comments : [])
    .filter((c) => c && !publicTextLanguageIssues(c.body, 'body', conta).length);
  const mudou = limpos.length !== paragrafos.length || comentarios.length !== (payload.comments || []).length;
  const novo = { ...payload, body: limpos.join('\n\n').trim(), comments: comentarios };
  return mudou && temTexto(novo) ? novo : null;
}

// Mapas do evento postado para o que o GitHub guarda, o status da decisão e o rótulo da memória.
const NO_GITHUB = { approve: 'APPROVED', request_changes: 'CHANGES_REQUESTED', comment: 'COMMENTED' };
const STATUS = { approve: 'auto_approved', request_changes: 'auto_rejected', comment: 'commented_own_pr' };
const MEMORIA = { approve: 'APPROVE', request_changes: 'REQUEST_CHANGES', comment: 'COMMENT' };
const EVENTO_NA_TELA = { approve: 'auto-approved', request_changes: 'auto-rejected', comment: 'auto-commented' };

const estadoNoGithub = (evento) => NO_GITHUB[evento] || NO_GITHUB.request_changes;
const statusAutomatico = (evento) => STATUS[evento] || STATUS.request_changes;
const rotuloDaMemoria = (evento) => MEMORIA[evento] || MEMORIA.request_changes;
const eventoNaTela = (evento) => EVENTO_NA_TELA[evento] || EVENTO_NA_TELA.request_changes;

export default {
  origemDoDono, defeitosDoPr, payloadDoDefeito, payloadDoCiVermelho, payloadDoPrProprio,
  reconstruirPayload, estadoNoGithub, statusAutomatico, rotuloDaMemoria, eventoNaTela, analiseSustentaReprovacao,
  bloqueiosSoDeEstado, reprovacaoSoDeEstado, causaDaEspera,
};
export {
  origemDoDono, defeitosDoPr, payloadDoDefeito, payloadDoCiVermelho, payloadDoPrProprio,
  reconstruirPayload, estadoNoGithub, statusAutomatico, rotuloDaMemoria, eventoNaTela, analiseSustentaReprovacao,
  CAUSAS_QUE_REPROVAM, bloqueiosSoDeEstado, reprovacaoSoDeEstado, causaDaEspera,
};
