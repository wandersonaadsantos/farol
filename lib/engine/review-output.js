// Contrato opt-in: um texto público para o veredito escolhido, sem alternativas.
// O restante do motor continua recebendo seu contrato conhecido e seus mesmos gates.
import { parseJson } from '../io.js';
const EVENTS = { approve: 'APPROVE', request_changes: 'REQUEST_CHANGES', comment: 'COMMENT' };

function expandReviewOutput(data) {
  if (!data || !Object.hasOwn(data, 'reviewOutputVersion')) return data;
  if (data.reviewOutputVersion !== 1 || !EVENTS[data.verdict]) throw new Error('Contrato de saída de review desconhecido');
  const review = data.review;
  if (Object.hasOwn(data, 'payloads') || Object.hasOwn(data, 'reviewMarkdown') || !review || typeof review.body !== 'string'
    || !Array.isArray(review.comments) || review.event !== EVENTS[data.verdict]) {
    throw new Error('Contrato de saída de review inconsistente');
  }
  // Não gera APPROVE a partir de um pedido de mudanças, nem cria payloads alternativos
  // para habilitar uma ação manual que não passou pelo julgamento desta revisão.
  const payload = { event: review.event, body: review.body, comments: review.comments };
  const { review: _review, ...rest } = data;
  return { ...rest, reviewMarkdown: payload.body, payloads: { [data.verdict]: payload } };
}

function singleReviewPrompt(base, enabled) {
  if (!enabled) return base;
  // O schema duplicado sai do exemplo, mas as instruções de investigação, provas,
  // relatório interno e publicação continuam no mesmo protocolo.
  const start = base.indexOf('  "reviewMarkdown":');
  const end = base.indexOf('  "memory":', start);
  if (start < 0 || end < 0) throw templateError();
  const old = parseJson('{' + base.slice(start, end).trim().replace(/,$/, '') + '}');
  if (!old || Object.keys(old).length !== 2 || !Object.hasOwn(old, 'payloads') || !Object.hasOwn(old, 'reviewMarkdown')) throw templateError();
  const schema = '  "reviewOutputVersion": 1,\n'
    + '  "review": { "event": "APPROVE|REQUEST_CHANGES", "body": "texto público do veredito escolhido", "comments": [] },\n';
  return base.slice(0, start) + schema + base.slice(end) + SINGLE_REVIEW_PROTOCOL;
}

function templateError() {
  return Object.assign(new Error('Template incompatível com saída única de review'), { code: 'FAROL_REVIEW_OUTPUT_TEMPLATE' });
}

const SINGLE_REVIEW_PROTOCOL = `\n\n## Saída pública única (contrato 1; prevalece sobre campos de saída anteriores)
Mantenha toda a investigação, os critérios técnicos, a cobertura, os achados, as evidências,
as ressalvas e o relatório interno. Não reduza o raciocínio nem a leitura.
No JSON final use reviewOutputVersion: 1 e review: {event, body, comments}.
O event deve ser APPROVE para verdict approve, ou REQUEST_CHANGES para verdict request_changes.
Omita reviewMarkdown e payloads: não escreva três alternativas nem copie o corpo público.
Toda instrução anterior sobre o conteúdo público de reviewMarkdown e do payload do veredito
aplica-se ao único review.body e seus comments. Conserve paraQuemMergeia e as ressalvas.
Não misture reportMarkdown, reasons, memória ou justificativas internas no texto público.
comments mantém as mesmas âncoras path, line, side e body verificadas no diff.
Se analysisStatus for incomplete, preserve decision needs_decision; nunca complete a análise
para satisfazer o formato. Não gere uma aprovação alternativa para uma revisão negativa.
`;

export { expandReviewOutput, singleReviewPrompt };
