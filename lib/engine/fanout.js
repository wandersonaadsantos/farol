'use strict';
// Concern do fan-out de revisão em PR grande. Tudo aqui é DETERMINÍSTICO e sem IA:
// mede o PR, decide se vale fatiar, e monta os lotes por afinidade de caminho. A
// orquestração dos subagentes fica na sessão principal (que já dispara o agente
// pr-reviewer hoje), então o engine não gerencia sessão nova nenhuma.
//
// Por que existe (medido em 29/07/2026 sobre 44 reviews reais): o tamanho do PR
// varia 4359x no histórico e o esforço visível do review varia 3x; a correlação
// entre linhas do diff e âncoras arquivo:linha é r = -0,08, ou seja, nenhuma. Nos
// PRs acima de 2000 linhas, 3 de 5 saíram sem uma única âncora. Uma sessão só não
// lê 8717 linhas com atenção: ela triava em silêncio. Fatiar dá contexto pequeno
// pra cada revisor e transforma cobertura em conta auditável.
const { run } = require('../io');

// Limiar do fan-out. Medido no histórico do Wanderson: pega 28% dos PRs (7 de 25),
// concentrando o custo extra exatamente onde a densidade de evidência desabou.
const FANOUT_MIN_LINES = 1000;
const FANOUT_MIN_FILES = 20;
const MAX_LOTES = 4;

// Tamanho + lista de arquivos do PR, numa chamada gh. Roda no início da revisão
// (não no polling, pra não encarecer o ciclo). null = não deu pra medir, e aí o
// chamador segue no modo de sempre (degradar pro fluxo atual é sempre seguro).
async function prMetrics(engine, pr) {
  const r = await run('gh', ['pr', 'view', pr.url, '--json', 'additions,deletions,changedFiles,files'],
    { env: engine.ghEnv(engine.accountForPr(pr)) });
  if (!r.ok) return null;
  let j;
  try { j = JSON.parse(r.stdout || '{}'); } catch { return null; }
  const files = (j.files || []).map(f => ({
    path: String(f.path || ''),
    lines: (f.additions || 0) + (f.deletions || 0)
  })).filter(f => f.path);
  if (!files.length) return null;
  return {
    lines: (j.additions || 0) + (j.deletions || 0),
    changedFiles: j.changedFiles || files.length,
    files
  };
}

function shouldFanOut(metrics) {
  if (!metrics) return false;
  return metrics.lines >= FANOUT_MIN_LINES || metrics.changedFiles >= FANOUT_MIN_FILES;
}

// Quantos lotes pro volume: mais linhas, mais fatias, sempre dentro de 2..MAX_LOTES.
function lotesAlvo(lines) {
  if (lines >= 4000) return 4;
  if (lines >= 2000) return 3;
  return 2;
}

// Prefixo de diretório do arquivo até `depth` segmentos. Arquivo na raiz vira '.'.
function prefixAt(p, depth) {
  const parts = String(p).split('/');
  if (parts.length <= 1) return '.';
  return parts.slice(0, Math.min(depth, parts.length - 1)).join('/');
}

// Rótulo de um grupo fundido: o caminho comum dos dois, ou uma indicação honesta
// de que o lote junta pastas diferentes (não inventa uma pasta que não existe).
function escopoComum(a, b) {
  if (a === b) return a;
  const pa = a.split('/'), pb = b.split('/');
  const comum = [];
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    if (pa[i] !== pb[i]) break;
    comum.push(pa[i]);
  }
  return comum.length ? comum.join('/') : `${a} + ${b}`;
}

// Agrupa os arquivos do diff em lotes coesos por AFINIDADE DE CAMINHO (arquivos da
// mesma feature/pasta ficam juntos, que é o que reduz o furo cross-file: quem revisa
// um contrato tende a revisar quem o consome). Função PURA: mesma entrada, mesma
// saída, testável sem rede e sem IA.
//
// Estratégia (DESCE por profundidade, nunca sobe): acha a profundidade de caminho mais
// rasa que já separa o diff em pelo menos `alvo` grupos, agrupa ali, e se sobrar grupo
// demais funde os MENORES ENTRE SI. A primeira versão fundia o menor grupo no pai, e a
// validação com o PR #688 real reprovou: a fusão cascateava até a raiz e um lote saía
// com 53 dos 74 arquivos, recriando o problema que o fatiamento existe pra resolver.
// Fundir menor com menor mantém o equilíbrio; descer por profundidade mantém a afinidade.
function planLotes(files, maxLotes = MAX_LOTES) {
  const lista = (files || []).filter(f => f && f.path);
  if (!lista.length) return [];
  const total = lista.reduce((s, f) => s + (f.lines || 0), 0);
  const alvo = Math.min(maxLotes, lotesAlvo(total), lista.length);

  // profundidade mínima que já separa em `alvo` grupos (mantém o agrupamento o mais
  // alto possível, então arquivos da mesma feature continuam juntos)
  const maxDepth = Math.max(...lista.map(f => String(f.path).split('/').length));
  let depth = 1;
  for (let d = 1; d <= maxDepth; d++) {
    depth = d;
    const keys = new Set(lista.map(f => prefixAt(f.path, d)));
    if (keys.size >= alvo) break;
  }

  const grupos = new Map();
  for (const f of lista) {
    const k = prefixAt(f.path, depth);
    if (!grupos.has(k)) grupos.set(k, { dir: k, files: [], lines: 0 });
    const g = grupos.get(k);
    g.files.push(f.path);
    g.lines += (f.lines || 0);
  }

  let arr = [...grupos.values()];

  // fallback (M12): o caminho não separa nada (diff inteiro num diretório só, ou tudo
  // na raiz). Sem isso, o agrupamento devolvia UM lote, o chamador exige >= 2, e o
  // fan-out era descartado EM SILÊNCIO: exatamente o PR que mais precisa de fatiamento
  // seguia no passe único. Fatia por ARQUIVO, balanceando linhas: maiores primeiro,
  // cada um cai no lote mais leve (tudo com desempate total, então determinístico).
  if (arr.length === 1 && lista.length >= 2) {
    const base = arr[0].dir === '.' ? 'raiz do repo' : arr[0].dir;
    const partes = Array.from({ length: Math.min(alvo, lista.length) }, () => ({ dir: base, files: [], lines: 0 }));
    const ordenados = [...lista].sort((x, y) =>
      (y.lines || 0) - (x.lines || 0) || String(x.path).localeCompare(String(y.path)));
    for (const arq of ordenados) {
      let menor = partes[0];
      for (const p of partes) if (p.lines < menor.lines) menor = p;
      menor.files.push(arq.path);
      menor.lines += (arq.lines || 0);
    }
    arr = partes.filter(p => p.files.length);
    arr.sort((a, b) => b.lines - a.lines || a.files[0].localeCompare(b.files[0]));
    arr.forEach((p, i) => { p.dir = `${base} (parte ${i + 1})`; });
  }

  // funde os dois MENORES até caber no alvo (equilíbrio melhor que jogar tudo na raiz)
  while (arr.length > alvo) {
    arr.sort((a, b) => a.lines - b.lines || a.dir.localeCompare(b.dir));
    const a = arr.shift(), b = arr.shift();
    arr.push({ dir: escopoComum(a.dir, b.dir), files: [...a.files, ...b.files], lines: a.lines + b.lines });
  }

  return arr
    .sort((a, b) => b.lines - a.lines || a.dir.localeCompare(b.dir))
    .map((g, i) => ({
      id: i + 1,
      escopo: g.dir === '.' ? 'raiz do repo' : g.dir,
      lines: g.lines,
      files: [...g.files].sort()
    }));
}

// Instrução injetada no prompt quando o fan-out vale a pena. A sessão principal já
// dispara o subagente pr-reviewer hoje; aqui ela passa a disparar UM POR LOTE, em
// paralelo, e a consolidar. O gate de blocker continua aplicado UMA vez, na
// consolidação (invariante 4: a decisão fica num lugar só).
function fanOutBlock(lotes, metrics) {
  if (!lotes || lotes.length < 2) return '';
  const todos = lotes.flatMap(l => l.files);
  const bloco = lotes.map(l =>
    `\n### Lote ${l.id} (${l.escopo}, ~${l.lines} linhas)\n` + l.files.map(f => `- \`${f}\``).join('\n')
  ).join('\n');

  return `\n\n## PR GRANDE: revisão em lotes com subagentes (OBRIGATÓRIO neste PR)\n` +
    `Este PR tem ${metrics.changedFiles} arquivos e ~${metrics.lines} linhas de diff. Uma leitura única não dá conta com atenção, então revise em LOTES, assim:\n` +
    `1. **Dispare um subagente \`pr-reviewer\` POR LOTE, em paralelo** (várias chamadas na MESMA mensagem, não em sequência). Cada um recebe: o PR, o card, o perfil do autor, e a lista de arquivos DO LOTE DELE.\n` +
    `2. **Cada subagente lê por completo só os arquivos do lote dele** (\`gh pr diff\` e filtre, ou leia arquivo por arquivo no headSha). Ele NÃO precisa ler os outros lotes.\n` +
    `3. **Consciência cross-lote:** cada subagente recebe também a lista de caminhos dos OUTROS lotes (só os nomes). Se um achado depende de arquivo de outro lote (contrato, tipo compartilhado, call-site), ele registra a suspeita citando o caminho, e a consolidação resolve. Ninguém afirma defeito em arquivo que não leu.\n` +
    `4. **Você consolida:** junte os achados, **deduplique por \`arquivo:linha\`**, resolva as suspeitas cross-lote (aí sim pode abrir o arquivo do outro lote pra confirmar), e aplique o gate dos 8 blockers **uma única vez** sobre o conjunto. Um lote não decide veredito: você decide.\n` +
    `5. **Cobertura é obrigatória no JSON:** preencha \`coverage\` com \`total\` (arquivos no diff), \`reviewed\` (os que foram efetivamente revisados) e \`missing\` (os que ficaram sem revisão, por falha de subagente ou por corte). **Nunca declare \`missing: []\` sem ter revisado tudo:** o app usa esse campo pra decidir se pode postar sozinho, então mentir aqui derruba a única prova de que a revisão olhou o PR inteiro. Subagente que falhou é \`missing\`, não é silêncio.\n` +
    `6. O relatório final é ÚNICO, no formato de sempre (nada de N relatórios colados).\n` +
    `\n**Lotes deste PR (${lotes.length}, cobrindo ${todos.length} arquivos):**${bloco}\n`;
}

module.exports = {
  prMetrics, shouldFanOut, planLotes, fanOutBlock, lotesAlvo,
  FANOUT_MIN_LINES, FANOUT_MIN_FILES, MAX_LOTES
};
