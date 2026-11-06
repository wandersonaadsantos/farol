// Uma sessão não pode recolocar como defeito a mesma dívida que o app já mediu.
// Linha intacta, sozinha, não prova dívida: uma regressão pode vir de outro arquivo.
import { linhaDoAchado, patchConfiavel, VERSAO_DAS_LINHAS } from './divida-fora-das-linhas.js';
import { normalizeFindings } from '../engine/review-findings-contract.js';

const ATIVO = f => !['resolvido', 'retirado'].includes(f?.status);
const CABECALHO = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const CAMPO_DA_MARCA = 'dividaForaDasLinhasConfirmada';

// A correlação é feita ANTES do corte de dez achados do relatório. Nenhum texto da
// sessão é interpretado como verificador: a origem é uma regra mecânica identificada.
function dividasRelacionadas(findings, achadosDaSessao) {
  if (!Array.isArray(achadosDaSessao)) return [];
  const dividas = findings.filter(f => f?.foraDasLinhas === true);
  return achadosDaSessao.flatMap((f, indice) => {
    if (!f || typeof f.file !== 'string' || !Number.isSafeInteger(f.line)) return [];
    const regras = new Set(dividas.filter(d => d.file === f.file && (linhaDoAchado(d) === f.line
      || (d.intervaloVerificado?.inicio <= f.line && d.intervaloVerificado?.fim >= f.line))).map(d => d.rule));
    return [...regras].map(rule => ({ indice, file: f.file, line: f.line, rule }));
  });
}

function alteracoesDoPatch(patch) {
  const head = new Set(), base = new Set();
  let trecho;
  const completo = () => !trecho || (trecho.b === trecho.fimB && trecho.h === trecho.fimH);
  for (const linha of patch.split('\n')) {
    const m = CABECALHO.exec(linha);
    if (m) {
      if (!completo()) return null;
      const b = Number(m[1]), h = Number(m[3]);
      trecho = { b, h, fimB: b + Number(m[2] ?? 1), fimH: h + Number(m[4] ?? 1) };
      continue;
    }
    if (!trecho || linha.startsWith('\\') || linha === '') continue;
    if (linha.startsWith('+')) { head.add(trecho.h++); continue; }
    if (linha.startsWith('-')) { base.add(trecho.b++); continue; }
    if (!linha.startsWith(' ')) return null;
    trecho.b++; trecho.h++;
  }
  return trecho && completo() ? { head, base } : null;
}

// A âncora prova localização, não semântica: a evidência do cenário continua sendo
// julgamento da revisão. Contexto do hunk não serve como linha introduzida pelo PR.
function causaNoDiff(f, inventario, head) {
  const causa = f?.introduzidoPor;
  if (!causa || typeof causa.file !== 'string' || !Number.isSafeInteger(causa.line) || causa.line < 1
    || typeof causa.evidence !== 'string' || !causa.evidence.trim()) return false;
  if (inventario?.status !== 'complete' || inventario.headSha !== head || !head) return false;
  const side = causa.side || 'head';
  if (!['head', 'base'].includes(side)) return false;
  const file = inventario.files?.find(a => a.path === causa.file || (side === 'base' && a.previousPath === causa.file));
  if (!patchConfiavel(file)) return false;
  return alteracoesDoPatch(file.patch)?.[side].has(causa.line) === true;
}

function tirarMarca(f) {
  if (!f || !Object.hasOwn(f, CAMPO_DA_MARCA)) return f;
  const { [CAMPO_DA_MARCA]: _marca, ...resto } = f;
  return resto;
}

// Devolve os pontos que a MESMA conversa precisa corrigir. O app nunca troca o
// verdict nem reaproveita um APPROVE antigo: a sessão reescreve o texto coerente.
function conferirDividaDaSessao(result, inventario, head) {
  if (!Array.isArray(result?.findings)) return [];
  result.findings = result.findings.map(tirarMarca);
  if (normalizeFindings(result.findings).status !== 'complete') return [];
  const report = result.technicalReview;
  if (report?.head !== head || report.foraDasLinhas?.versao !== VERSAO_DAS_LINHAS) return [];
  const relacionadas = Array.isArray(report.dividasDaSessao) ? report.dividasDaSessao : [];
  const issues = [];
  result.findings = result.findings.map((f, indice) => {
    if (!['blocking', 'suggestion'].includes(f?.severity)) return f;
    const delas = relacionadas.filter(d => d.indice === indice && d.file === f?.file && d.line === f?.line);
    if (!delas.length || causaNoDiff(f, inventario, head)) return f;
    if (f.introduzidoPor && f.severity === 'blocking' && ATIVO(f)) {
      issues.push(`${f.title}: a causa indicada não aponta para uma linha alterada verificável; corrija introduzidoPor com file, line, side (head/base) e evidence do cenário.`);
      return f;
    }
    const regra = f.technicalRule || f.criteria?.source;
    if (!delas.some(d => d.rule === regra)) {
      if (f.severity === 'blocking' && f.causa === 'defeito_codigo' && ATIVO(f)) {
        issues.push(`${f.title}: a construção ${f.file}:${f.line} está fora da mudança e a avaliação mediu dívida (${delas.map(d => d.rule).join(', ')}). Se reproduz esse achado, declare technicalRule e trate como sugestão; se é regressão distinta, declare introduzidoPor com a linha alterada e a evidência causal. Não retire defeito real.`);
      }
      return f;
    }
    if (f.severity === 'blocking' && f.causa !== 'defeito_codigo') return f;
    const nota = `Dívida anterior conferida no blob do head: a construção de ${f.file}:${f.line} não foi alterada por este PR.`;
    const anterior = String(f.evidence || '').trim();
    const evidence = anterior.includes(nota) ? anterior : [anterior, nota].filter(Boolean).join(' · ');
    if (f.severity === 'blocking' && ATIVO(f)) {
      issues.push(`${f.title}: ${nota} Reescreva o envelope e os textos públicos tratando este ponto como sugestão. Preserve outros defeitos e referências; sem outro bloqueio, conclua o veredito correspondente com texto novo.`);
    }
    return { ...f, severity: 'suggestion', evidence, [CAMPO_DA_MARCA]: true, ...(f.ref ? { status: 'retirado' } : {}) };
  });
  const dividas = result.findings.filter(f => f?.[CAMPO_DA_MARCA]);
  if (dividas.length && result.verdict === 'request_changes' && !result.findings.some(f => f?.severity === 'blocking' && ATIVO(f))) {
    issues.push('O pedido de mudanças ficou sem bloqueio próprio depois da conferência da dívida. Reavalie o veredito e reescreva os payloads; o app não publica uma aprovação com texto antigo.');
  }
  return issues;
}

function inconclusaoDoEscopo(result, issues, pausa = '') {
  if (!issues.length) return result;
  // Marcas exclusivas do engine. Pausa de admissão/conversa não esgota a correção:
  // ambas seguram o texto antigo, mas só tentativa concluída pode impedir repetição.
  result.technicalReview[pausa ? 'escopoSessaoPendente' : 'escopoSessaoInconclusivo'] = true;
  result.analysisStatus = 'incomplete';
  result.decision = 'needs_decision';
  result.technicalReview.escopoSessaoMotivos = [
    `A sessão não concluiu a distinção entre dívida anterior e defeito deste PR, ou não reescreveu o parecer após essa conferência. Nada foi publicado; ${pausa || 'as tentativas de correção desta conversa terminaram.'}`,
    ...issues,
  ];
  return result;
}

// Acrescentado depois de normalizar os motivos do modelo, para conservar a origem
// do app sem permitir que a sessão se atribua a etiqueta gate.
function motivosDoEscopo(result) {
  const report = result?.technicalReview;
  if (!report?.escopoSessaoInconclusivo && !report?.escopoSessaoPendente) return [];
  return (report.escopoSessaoMotivos || []).map(text => ({ kind: 'gate', text }));
}

export { dividasRelacionadas, causaNoDiff, conferirDividaDaSessao, inconclusaoDoEscopo, motivosDoEscopo };
