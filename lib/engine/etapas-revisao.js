// Tempo por etapa da revisão: a classificação de cada linha do feed e a soma por etapa.
// Saiu do lib/engine/review.js em 30/09/2026 (o arquivo está acima do teto de tamanho e o
// ratchet passou a medir crescimento), e é assunto fechado em si: o que o engine estampa
// em cada linha, e como essas estampas viram "Tempo por etapa" na decisão.
//
// A esteira AO VIVO da tela (ui/pure/sessao.js, STAGE_FLOW_ORDER) usa estes mesmos ids:
// eles divergiam (`redacao` lá, `fechamento` aqui) e o último nó nunca acendia.

/* ---------- tempo por etapa da revisão (instrumentação) ----------
   Motivado por 17/08/2026 (#775, "por que demorou 10 minutos?"): o feed de
   atividade tem timestamp por linha mas morre com a sessão, então a pergunta
   ficava sem resposta. O resumo é calculado do feed ANTES do finally apagar e
   persiste na decisão. Heurística determinística e honesta: o intervalo entre
   uma linha e a anterior é atribuído à etapa da linha que o ENCERRA (o gap é o
   trabalho que produziu a linha), e a fatia final (última linha até o fim) é a
   redação do envelope. É aproximação de traço, não cronômetro. */
const STAGE_ORDER = ['preparo', 'leitura', 'card', 'verificacao', 'raciocinio', 'fechamento'];
// `fechamento`, e não `redação`: a última fatia NÃO é medida de nenhuma linha, é o
// silêncio entre a última atividade do feed e o fim da sessão (ver stageSummaryFrom).
// Costuma ser o modelo compondo o envelope, mas o rótulo antigo prometia uma medição
// que não existe. Decisões gravadas antes disto guardam o próprio label, então o
// histórico continua mostrando "redação" sem migração.
const STAGE_LABEL = {
  preparo: 'preparo', leitura: 'leitura', card: 'card',
  verificacao: 'verificação', raciocinio: 'raciocínio', fechamento: 'fechamento',
};

function stageOfLine(it) {
  // linha já estampada (item.s do feed) é a fonte: classificar duas vezes abriria
  // espaço pra esteira ao vivo e o resumo final divergirem sobre a mesma linha
  if (it && it.s && STAGE_LABEL[it.s]) return it.s;
  const t = String((it && it.text) || '');
  if (t.includes('FAROL_CHECKPOINT')) return 'verificacao';
  if (it && it.a) return /^claim-verifier/i.test(String(it.a)) ? 'verificacao' : 'leitura';
  // `card` só a partir de FERRAMENTA. Casando o texto de qualquer linha, prosa que
  // apenas MENCIONA o Jira ("o card não cobre esse caso") virava consulta ao card, e
  // todo o raciocínio até ali era creditado à etapa errada. Medido: as três frases de
  // exemplo do teste caíam em `card`, sendo que duas eram raciocínio puro.
  if (it && it.k === 'tool' && /atlassian|jira/i.test(t)) return 'card';
  if (it && it.k === 'text') return 'raciocinio';
  if (it && it.k === 'tool') return 'leitura';
  return 'preparo';
}

// PURA: { totalMs, stages: [{id, label, ms}] } na ordem canônica, só etapas > 0.
function stageSummaryFrom(items, startedAt, endedAt) {
  const linhas = (items || []).filter(i => i && i.t);
  if (!linhas.length || !startedAt || !endedAt) return null;
  const ms = {};
  let prev = startedAt;
  for (const it of linhas) {
    const etapa = stageOfLine(it);
    ms[etapa] = (ms[etapa] || 0) + Math.max(0, it.t - prev);
    prev = it.t;
  }
  ms.fechamento = (ms.fechamento || 0) + Math.max(0, endedAt - prev);
  return {
    totalMs: Math.max(0, endedAt - startedAt),
    stages: STAGE_ORDER.filter(s => ms[s] > 0).map(s => ({ id: s, label: STAGE_LABEL[s], ms: ms[s] })),
  };
}

const etapasMod = { STAGE_ORDER, STAGE_LABEL, stageOfLine, stageSummaryFrom };
export default etapasMod;
export { STAGE_ORDER, STAGE_LABEL, stageOfLine, stageSummaryFrom };
