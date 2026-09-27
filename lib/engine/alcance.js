// O ALCANCE da revisão: onde o código alterado é usado FORA do diff (27/09/2026).
//
// Duas auditorias seguidas acharam o mesmo buraco. Em 26/09/2026, com o Haiku e o Sonnet; em
// 27/09/2026, numa amostra sorteada de 16 aprovações do próprio Opus (1 erro, 5 lacunas
// importantes). O que escapou estava sempre fora do diff: quem chama a função alterada, o estado
// que chega de outra tela, o script que a documentação cita. A regra de prompt "siga quem chama o
// código" existia e não bastou. Aqui ela vira prova conferida pelo engine.
//
// O contrato (prompts/pr-review-auto.md, campo `alcance` do envelope): para cada arquivo de
// código de produção do diff, a revisão declara onde ele é usado fora do diff (`chamadores`:
// arquivo, linha e o símbolo que aparece ali) ou por que não há uso a conferir
// (`semChamador`). O engine lê cada arquivo citado NO HEAD revisado e confere que perto da
// linha declarada aparece o símbolo declarado. Uso inventado, arquivo de código sem
// declaração, ou conferência que não deu para fazer viram lacuna de cobertura: a decisão
// volta para a pessoa (coverageGap, lib/engine/file-proof.js, é quem aplica).
//
// O que isto NÃO prova: que a revisão entendeu o chamador. Prova que ela abriu o arquivo certo
// no lugar certo, que é o passo que faltou nos casos medidos.
import io from '../io.js';

// Código de produção: o que tem chamador de verdade. Teste, documentação, configuração e lock
// ficam fora (a cobertura do diff continua valendo para eles).
const CODIGO = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|java|kt|rb|php|cs|rs|vue|svelte)$/i;
const PASTA_DE_TESTE = /(?:^|\/)(?:test|tests|__tests__|__mocks__|spec|e2e|fixtures?)\//i;
const SUFIXO_DE_TESTE = /\.(?:test|spec|stories|d)\.[a-z]+$/i;
// Quantos arquivos citados o engine lê por revisão. Acima disso a conferência não fecha e a
// decisão vai para a pessoa: qualidade antes de velocidade.
const TETO_DE_ARQUIVOS = 60;
// A linha declarada pode estar alguns números fora (edição, contagem do modelo): a janela
// tolera isso sem aceitar um símbolo que só aparece longe dali.
const FOLGA_DE_LINHAS = 3;
const MOTIVO_MINIMO = 10;
const PARALELO = 6;

function norm(p) { return String(p || '').trim().replace(/^\.?\/+/, ''); }

function ehCodigoDeProducao(caminho) {
  const p = norm(caminho);
  return CODIGO.test(p) && !PASTA_DE_TESTE.test(p) && !SUFIXO_DE_TESTE.test(p);
}

// Os arquivos do diff que exigem declaração de alcance. Sem a medição do diff, usa o que a
// cobertura declarou ter lido.
function alvosDoAlcance(result) {
  const lidos = (result && result.coverage && Array.isArray(result.coverage.reviewed)) ? result.coverage.reviewed : [];
  const medido = Array.isArray(result && result.diffMedido) && result.diffMedido.length ? result.diffMedido : lidos;
  return [...new Set(medido.map(norm))].filter(ehCodigoDeProducao);
}

function chamadoresForaDoDiff(entrada, diff) {
  const lista = Array.isArray(entrada && entrada.chamadores) ? entrada.chamadores : [];
  return lista.filter((c) => c && norm(c.arquivo) && !diff.has(norm(c.arquivo)));
}

// PURA: a linha declarada cita o símbolo? Janela de FOLGA_DE_LINHAS para cada lado.
function conferirChamador(texto, linha, simbolo) {
  const s = String(simbolo || '').trim();
  const n = Number(linha);
  if (s.length < 2 || !Number.isInteger(n) || n < 1) return false;
  const linhas = String(texto || '').split('\n');
  const ini = Math.max(0, n - 1 - FOLGA_DE_LINHAS);
  return linhas.slice(ini, n + FOLGA_DE_LINHAS).some((l) => l.includes(s));
}

// PURA: as pendências de alcance, no formato do coverageGap (uma string por pendência).
function alcanceGap(result) {
  const alvos = alvosDoAlcance(result);
  if (!alvos.length) return [];
  const declarado = result && result.alcance;
  if (!Array.isArray(declarado)) return ['a revisão não declarou onde o código alterado é usado fora do diff'];
  const diff = new Set((Array.isArray(result.diffMedido) ? result.diffMedido : alvos).map(norm));
  const conferidos = Array.isArray(result.alcanceVerificado) ? result.alcanceVerificado : null;
  const pendencias = [];
  for (const alvo of alvos) {
    const entrada = declarado.find((e) => e && norm(e.alterado) === alvo);
    if (!entrada) { pendencias.push(`${alvo}: uso fora do diff não declarado`); continue; }
    const fora = chamadoresForaDoDiff(entrada, diff);
    if (fora.length) continue;
    if (String(entrada.semChamador || '').trim().length < MOTIVO_MINIMO) pendencias.push(`${alvo}: sem uso fora do diff e sem o motivo`);
  }
  if (!conferidos && declarado.some((e) => chamadoresForaDoDiff(e, diff).length)) {
    pendencias.push('o uso fora do diff declarado não foi conferido no head');
  }
  for (const c of (conferidos || []).filter((x) => !x.ok)) pendencias.push(`${c.arquivo}:${c.linha} ${c.motivo}`);
  return pendencias;
}

async function lerNoHead(engine, pr, head, caminho) {
  const acc = engine.accountForPr(pr);
  const r = await io.run('gh', ['api', `repos/${pr.repo}/contents/${encodeURI(norm(caminho))}?ref=${head}`,
    '-H', 'Accept: application/vnd.github.raw'], { env: engine.ghEnv(acc) });
  return r.ok ? r.stdout : null;
}

// Lê no head cada arquivo citado como chamador fora do diff e grava o resultado em
// result.alcanceVerificado, para o gate (puro) decidir. Falha de leitura vira "não conferido",
// nunca "conferido". Nunca lança.
async function verificarAlcance(engine, pr, head, result) {
  try {
    const declarado = Array.isArray(result.alcance) ? result.alcance : [];
    const diff = new Set((Array.isArray(result.diffMedido) ? result.diffMedido : alvosDoAlcance(result)).map(norm));
    const chamadores = declarado.flatMap((e) => chamadoresForaDoDiff(e, diff));
    if (!chamadores.length) return;
    if (!head || !pr.repo) {
      result.alcanceVerificado = chamadores.map((c) => ({ arquivo: norm(c.arquivo), linha: c.linha, ok: false, motivo: 'sem head para conferir' }));
      return;
    }
    const arquivos = [...new Set(chamadores.map((c) => norm(c.arquivo)))];
    const lidos = new Map();
    const dentro = arquivos.slice(0, TETO_DE_ARQUIVOS);
    for (let i = 0; i < dentro.length; i += PARALELO) {
      const lote = dentro.slice(i, i + PARALELO);
      const textos = await Promise.all(lote.map((a) => lerNoHead(engine, pr, head, a).catch(() => null)));
      lote.forEach((a, j) => lidos.set(a, textos[j]));
    }
    result.alcanceVerificado = chamadores.map((c) => {
      const arquivo = norm(c.arquivo);
      const base = { arquivo, linha: c.linha, simbolo: String(c.simbolo || '') };
      if (!lidos.has(arquivo)) return { ...base, ok: false, motivo: `acima do teto de ${TETO_DE_ARQUIVOS} arquivos conferidos` };
      const texto = lidos.get(arquivo);
      if (texto == null) return { ...base, ok: false, motivo: 'não foi possível ler o arquivo no head' };
      const ok = conferirChamador(texto, c.linha, c.simbolo);
      return { ...base, ok, motivo: ok ? '' : `não cita ${base.simbolo || '(símbolo vazio)'} no head` };
    });
  } catch (err) {
    result.alcanceVerificado = [{ arquivo: '(conferência)', linha: 0, ok: false, motivo: `falhou: ${err.message}` }];
  }
}

const alcanceMod = { ehCodigoDeProducao, alvosDoAlcance, conferirChamador, alcanceGap, verificarAlcance, TETO_DE_ARQUIVOS };
export default alcanceMod;
export { ehCodigoDeProducao, alvosDoAlcance, conferirChamador, alcanceGap, verificarAlcance, TETO_DE_ARQUIVOS };
