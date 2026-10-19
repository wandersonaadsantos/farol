// A decisão sem mesa (18/10/2026, v2.72.12). Regra do dono: "Se foi configurado pra aprovar
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
import { GAP_DA_PARTE_DO_CARD } from '../technical-review/verdict.js';
import { publicTextLanguageIssues } from './public-review.js';
// o "já saiu?" do reenvio mora em comentario-proprio.js (lê o GitHub); daqui só é reexportado
export { jaPublicado } from './comentario-proprio.js';

const VIOLACAO = 'violação técnica confirmada';
const ACHADOS = 'achados técnicos não resolvidos';
const TEXTO_DO_DEFEITO = {
  [VIOLACAO]: 'há violação confirmada de um padrão técnico do repositório',
  [ACHADOS]: 'há achados técnicos que ainda não foram resolvidos',
  [GAP_DA_PARTE_DO_CARD]: 'a parte do card que cabe a este PR ainda não foi entregue',
};
const TETO_DO_ITEM = 300;

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

const curto = (v) => String(v || '').replace(/[\r\n]+/g, ' ').trim().slice(0, TETO_DO_ITEM);

// A seção do defeito diz só a CATEGORIA, com texto do app. Nome de regra, causa e achado vêm da
// ferramenta e do catálogo privado da avaliação técnica, e nada disso vai ao texto público (PR
// #253): a evidência do código é a que a própria revisão escreveu no pedido de mudanças.
function secaoDoDefeito(defeitos) {
  return ['Antes do merge, isto precisa ser resolvido:', '', ...defeitos.map((g) => `- ${TEXTO_DO_DEFEITO[g]}`)].join('\n');
}

// O REQUEST_CHANGES de um resultado que concluiu aprovar mas tem defeito do PR. O pedido de
// mudanças que a própria revisão escreveu (os três payloads vêm sempre) entra depois da seção
// do defeito, com os comentários de linha; `soDefeito` monta só a seção, que é a reconstrução
// quando a trava de linguagem barra o texto da sessão.
function payloadDoDefeito(result, defeitos, { soDefeito = false } = {}) {
  const secao = secaoDoDefeito(defeitos);
  const rc = result && result.payloads && result.payloads.request_changes;
  if (soDefeito || !temTexto(rc)) return { event: 'REQUEST_CHANGES', body: secao, comments: [] };
  const body = [secao, String(rc.body || '').trim()].filter(Boolean).join('\n\n');
  return { event: 'REQUEST_CHANGES', body, comments: Array.isArray(rc.comments) ? rc.comments : [] };
}

// O REQUEST_CHANGES do CI obrigatório vermelho no commit revisado. Só cita os checks: o
// código em si estava aprovável, e a aprovação sai quando a pipe fechar verde neste commit.
function payloadDoCiVermelho(checks, head) {
  const nomes = (Array.isArray(checks) ? checks : []).map((c) => curto(c && (c.nome || c.name || c))).filter(Boolean);
  const lista = nomes.length ? nomes.map((n) => `\`${n}\``).join(', ') : 'obrigatórios';
  const sha = String(head || '').slice(0, 7);
  const body = `Os checks obrigatórios ${lista} estão falhando${sha ? ` no commit ${sha}` : ''}. `
    + 'O código está aprovável, mas o merge precisa da pipe verde neste commit; com os checks verdes, sigo com a aprovação.';
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

// O pedido de mudanças que o próprio Farol postou pelo CI vermelho (marca `esperaCi.rcHead`,
// espera-ci.js) não é decisão de fora: a reconciliação (decision.js, reconcilePending) o ignora,
// senão a espera sumiria antes da aprovação prometida para quando o CI ficar verde (revisão do
// Codex sobre a 8c1a1e2, achado 1). Qualquer outro review meu continua resolvendo.
function ehPedidoDoCi(item, review) {
  const rc = item && item.esperaCi && item.esperaCi.rcHead;
  return !!rc && !!review && review.state === 'CHANGES_REQUESTED' && review.commit === rc;
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
  reconstruirPayload, ehPedidoDoCi, estadoNoGithub, statusAutomatico, rotuloDaMemoria, eventoNaTela,
};
export {
  origemDoDono, defeitosDoPr, payloadDoDefeito, payloadDoCiVermelho, payloadDoPrProprio,
  reconstruirPayload, ehPedidoDoCi, estadoNoGithub, statusAutomatico, rotuloDaMemoria, eventoNaTela,
};
