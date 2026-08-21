// Normalização do card. É aqui que mora a whitelist de saída: a resposta do Jira
// traz e-mail de responsável, histórico e anexo, e nada disso tem por que entrar
// no contexto de uma revisão de código. Puro, então testa sem rede.
//
// A busca de seção é por LINHA DE CABEÇALHO curta: descrição de card mistura
// wiki markup (h2.), markdown (##) e texto solto, e casar o padrão em qualquer
// linha faria uma frase que cita "fora de escopo" no meio de um parágrafo virar
// cabeçalho e engolir o resto da descrição.
const LIMITE_CABECALHO = 80;

const SECOES = [
  { campo: 'criteria', padrao: /crit[eé]rios?\s+de\s+aceite/i },
  { campo: 'scope', padrao: /escopo\s+t[eé]cnico/i },
  { campo: 'outOfScope', padrao: /fora\s+de\s+escopo/i },
];

// Prova de forma da entrada de rede. JSON válido não é card: envelope de erro do
// Jira em 200, portal de login de proxy corporativo e array vazio passam por
// qualquer parser. Sem esta guarda eles viram card de chave vazia com ok:true,
// entram no cache por uma hora e chegam ao prompt como "card lido", que é
// justamente o que a trava do cardMet existe pra impedir.
//
// De propósito NÃO comparamos a chave devolvida com a pedida: card movido de
// projeto continua acessível pela chave antiga e o Jira responde com a chave
// nova, então a comparação estrita transformaria leitura boa em card ilegível.
function issueValida(raw) {
  return !!raw && typeof raw === 'object' && !Array.isArray(raw)
    && typeof raw.key === 'string' && raw.key.trim() !== ''
    && !!raw.fields && typeof raw.fields === 'object';
}

function itemDeLista(linha) {
  const m = String(linha).match(/^\s*(?:[-*+]|\d+[.)]|\[[ xX]\])\s*(?:\[[ xX]\]\s*)?(.*\S)\s*$/);
  return m ? m[1].trim() : '';
}

function cabecalhoDe(linha) {
  if (String(linha).trim().length > LIMITE_CABECALHO) return null;
  return SECOES.find((s) => s.padrao.test(linha)) || null;
}

function sectionsFrom(description) {
  const saida = { criteria: [], scope: [], outOfScope: [] };
  const texto = String(description || '');
  if (!texto.trim()) return saida;
  let atual = null;
  for (const linha of texto.split(/\r?\n/)) {
    const cabecalho = cabecalhoDe(linha);
    if (cabecalho) { atual = cabecalho.campo; continue; }
    const item = atual ? itemDeLista(linha) : '';
    if (item) saida[atual].push(item);
  }
  return saida;
}

function normalizeIssue(raw) {
  const campos = (raw && raw.fields) || {};
  const description = typeof campos.description === 'string' ? campos.description : '';
  const secoes = sectionsFrom(description);
  return {
    key: String((raw && raw.key) || '').toUpperCase(),
    summary: String(campos.summary || '').trim(),
    status: String((campos.status && campos.status.name) || '').trim(),
    description,
    criteria: secoes.criteria,
    scope: secoes.scope,
    outOfScope: secoes.outOfScope,
  };
}

export default { sectionsFrom, normalizeIssue, issueValida };
export { sectionsFrom, normalizeIssue, issueValida };
