// Achado técnico em linha que o PR não tocou é dívida anterior e não bloqueia (05/11/2026).
// Medido em biud-frontend#1818 (heads e8b2f02 e d50ee37): a sessão aprovou, e a avaliação técnica
// virou o desfecho em pedido de mudanças por supressor sem motivo e unidade fixa em linhas que o PR
// não alterou, só porque o arquivo estava no diff. Precedente do mesmo princípio, só para o
// merge-back: lib/engine/heranca-de-producao.js.
//
// PURO. O app decide com o que ele mesmo mediu, nunca com o texto da sessão:
//   - a linha do achado vem só do verificador mecânico da ferramenta ("na linha N"). Achado de
//     avaliação ("avaliada como ...") carrega o texto da sessão e nunca é lido em busca de linha;
//   - as linhas do PR vêm do inventário do diff (patch do GitHub por arquivo, contra o ancestral
//     comum), do mesmo commit da avaliação;
//   - "fora das linhas" é fora de todo trecho do patch, inclusive das linhas de contexto em volta
//     de cada mudança. É mais estreito que "linha não alterada" de propósito: o achado que começa
//     numa linha intacta e depende da vizinha alterada (o motivo do supressor apagado na linha de
//     cima, um ramo novo dentro de uma expressão antiga) continua bloqueando;
//   - falta de dado bloqueia: inventário incompleto ou de outro commit, patch ausente, parcial,
//     reescrito (arquivo de ambiente) ou com trecho oculto, arquivo fora do inventário, mensagem
//     sem linha ou com duas linhas diferentes;
//   - regra sem linha (arquivo inteiro, como responsabilidade única, ou regra de avaliação, como
//     duplicação de regra de negócio) continua bloqueando: a ferramenta só a aciona em arquivo da
//     entrega, a duplicação pode morar fora do trecho alterado justamente porque o PR a criou, e
//     sem linha não há como provar que a violação é anterior ao PR;
//   - a regra reprovada só deixa de bloquear quando TODOS os achados dela ficaram fora das linhas.
// Nada some: o achado fica no relatório com a marca, o resumo técnico e a ressalva dizem quantos.

const LINHA = /\bna linha (\d+)\b/g;
const ENTRE_ASPAS = /"[^"]*"/g;
const AVALIACAO = /^\s*avaliad[ao] como/i;
const CABECALHO = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;
const AMOSTRA = 3;

// A linha que o verificador mecânico escreveu. O que vem entre aspas é texto do código revisado
// (o supressor, por exemplo) e sai antes da leitura, para o PR não escrever a própria linha.
function linhaDoAchado(achado) {
  const texto = typeof achado?.message === 'string' ? achado.message : '';
  if (!texto || AVALIACAO.test(texto)) return null;
  const linhas = new Set([...texto.replace(ENTRE_ASPAS, '""').matchAll(LINHA)].map((m) => Number(m[1])));
  if (linhas.size !== 1) return null;
  const [linha] = linhas;
  return Number.isSafeInteger(linha) && linha >= 1 ? linha : null;
}

// Só o patch cru do GitHub, inteiro e sem trecho oculto, diz em que linha do head cada mudança está.
function patchConfiavel(arquivo) {
  if (!arquivo || typeof arquivo.path !== 'string' || typeof arquivo.patch !== 'string') return false;
  if (arquivo.patchStatus !== 'available') return false;
  if (arquivo.patchOrigin && arquivo.patchOrigin.status !== 'available') return false;
  const rep = arquivo.representation;
  return !rep || (rep.kind === 'github-patch' && Array.isArray(rep.redactions) && rep.redactions.length === 0);
}

// Os intervalos do head que o patch cobre (mudança e contexto). Sem trecho nenhum, sem dado.
function trechosDoPatch(patch) {
  const trechos = [];
  for (const linha of String(patch).split('\n')) {
    const m = CABECALHO.exec(linha);
    if (!m) continue;
    const inicio = Number(m[1]);
    const tamanho = m[2] === undefined ? 1 : Number(m[2]);
    // `+10,3` cobre as linhas 10 a 12; trecho vazio (só remoção) fica na linha onde a remoção caiu
    trechos.push([inicio, tamanho > 0 ? inicio + tamanho - 1 : inicio]);
  }
  return trechos;
}

// Mapa caminho -> trechos do head, ou null quando o inventário não fala do commit avaliado.
function trechosDoDiff(inventario, head) {
  if (!inventario || inventario.status !== 'complete' || !head || inventario.headSha !== head) return null;
  if (!Array.isArray(inventario.files)) return null;
  const mapa = new Map();
  for (const arquivo of inventario.files) {
    if (!patchConfiavel(arquivo)) continue;
    const trechos = trechosDoPatch(arquivo.patch);
    if (trechos.length) mapa.set(arquivo.path, trechos);
  }
  return mapa;
}

function foraDasLinhas(achado, mapa) {
  const linha = linhaDoAchado(achado);
  const trechos = linha && typeof achado.file === 'string' ? mapa.get(achado.file) : null;
  return !!trechos && !trechos.some(([inicio, fim]) => linha >= inicio && linha <= fim);
}

// Marca os achados fora das linhas e as regras reprovadas cujos achados todos ficaram fora. Recebe o
// resultado COMPLETO da ferramenta (o relatório público guarda só uma parte dos achados).
function classificarPorLinhas(resultado, inventario, head) {
  const achados = Array.isArray(resultado?.findings) ? resultado.findings : [];
  const regras = Array.isArray(resultado?.rules) ? resultado.rules : [];
  const mapa = trechosDoDiff(inventario, head);
  if (!mapa || !mapa.size) return { findings: achados, rules: regras, resumo: null };
  const findings = achados.map((f) => (f && typeof f === 'object' && foraDasLinhas(f, mapa) ? { ...f, foraDasLinhas: true } : f));
  const daRegra = (regra) => findings.filter((f) => f?.rule === regra);
  const rules = regras.map((r) => {
    if (!r || r.verdict !== 'fail') return r;
    const deles = daRegra(r.rule);
    return deles.length && deles.every((f) => f.foraDasLinhas === true) ? { ...r, dividaForaDasLinhas: true } : r;
  });
  const marcados = findings.filter((f) => f?.foraDasLinhas === true);
  if (!marcados.length) return { findings, rules, resumo: null };
  const amostra = marcados.slice(0, AMOSTRA).map((f) => ({ rule: f.rule, file: f.file, linha: linhaDoAchado(f) }));
  const resumo = { achados: marcados.length, regras: rules.filter((r) => r?.dividaForaDasLinhas === true).map((r) => r.rule), amostra };
  return { findings, rules, resumo };
}

// A ressalva da revisão aprovável: a dívida não bloqueia, mas não some calada.
function pontoDaDivida(relatorio) {
  const resumo = relatorio?.foraDasLinhas;
  const total = Number(resumo?.achados) || 0;
  if (!total) return null;
  const amostra = (Array.isArray(resumo.amostra) ? resumo.amostra : [])
    .filter((a) => a && typeof a.file === 'string').map((a) => `${a.file}:${a.linha}`).join(', ');
  return `${total} achado(s) da avaliação técnica em linha que este PR não alterou ficaram como dívida anterior, sem bloquear${amostra ? `: ${amostra}` : ''}`;
}

export { linhaDoAchado, patchConfiavel, trechosDoPatch, trechosDoDiff, classificarPorLinhas, pontoDaDivida };
