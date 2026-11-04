// O experimento só credita conteúdo retornado e conferido contra o patch local.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { prPathFromRead } from './pr-scope.js';
import { avisarLeituraSensivel } from './leitura-sensivel.js';
import { registrarMedicao } from './medicoes-leitura.js';
import { safeStringify } from '../io.js';

const observations = new WeakMap();
const normalized = text => text.replaceAll('\r\n', '\n').replace(/\n$/, '');
const linesOf = text => text.replaceAll('\r\n', '\n').split('\n');
const keyFor = (event, id) => `${String(event.parent_tool_use_id || '').length}:${event.parent_tool_use_id || ''}:${id}`;
// Teto de arquivos por sessão e de faixas por registro: PR grande não pode inundar a medição.
const TETO_DE_ARQUIVOS_MEDIDOS = 30;
const TETO_DE_FAIXAS = 10;

// `pedidos` é o que a regra do Read credita, `provados` o que a prova do retorno credita.
// As duas contas correm juntas em qualquer modo; o modo só escolhe qual delas vale.
function estadoDe(review) {
  if (!observations.has(review)) {
    observations.set(review, { pending: new Map(), files: new Map(), pedidos: new Set(), provados: new Set(), recusas: new Map(), relatadas: new Map(), tetoRelatado: false });
  }
  return observations.get(review);
}

function anotarRecusa(state, file, motivo) {
  if (!state.recusas.has(file)) state.recusas.set(file, new Set());
  state.recusas.get(file).add(motivo);
}

function deliveredLines(content) {
  let text = '';
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) text = content.filter(b => b?.type === 'text').map(b => b.text).join('\n');
  const lines = new Map();
  for (const line of String(text || '').replaceAll('\r\n', '\n').split('\n')) {
    const match = line.match(/^\s*(\d+)(?:→|\t)(.*)$/);
    if (match) lines.set(Number(match[1]), match[2]);
  }
  return lines;
}

function observarLeitura(engine, opts, block) {
  if (block.name !== 'Read') return;
  avisarLeituraSensivel(engine, opts, block);
  if (engine.config?.reviewBatchedReads === true || opts.selfIsolation) return;
  const review = engine.activeReviews?.get(opts.id);
  const file = prPathFromRead(review?.scopeRoot, block.input?.file_path);
  if (!file) return;
  if (!review.filesRead) review.filesRead = new Set();
  review.filesRead.add(file);
}

// Com a prova valendo (experimento ou isolamento) o evento credita. Fora disso ele só mede:
// `filesRead` continua sendo da regra do Read, e falha da medição não chega à sessão.
function observeReadEvent(engine, opts, event) {
  if (engine.config?.reviewBatchedReads === true || opts.selfIsolation) return acompanharEvento(engine, opts, event, true);
  try { acompanharEvento(engine, opts, event, false); }
  catch { /* só observa */ }
}

function acompanharEvento(engine, opts, event, creditar) {
  const review = engine.activeReviews?.get(opts.id);
  if (!review?.scopeRoot || !Array.isArray(event.message?.content)) return;
  const state = estadoDe(review);
  for (const block of event.message.content) {
    if (event.type === 'assistant' && block.type === 'tool_use' && block.name === 'Read' && typeof block.id === 'string') {
      const file = prPathFromRead(review.scopeRoot, block.input?.file_path);
      if (file) { state.pending.set(keyFor(event, block.id), file); state.pedidos.add(file); }
    }
    if (event.type === 'user' && block.type === 'tool_result') acceptResult(review, state, event, block, creditar);
  }
}

function motivoDaRecusa(review, file, block, result) {
  if (block.is_error) return 'erro-do-read';
  if (result?.type !== 'text' || typeof result.file?.content !== 'string') return 'retorno-sem-prova';
  return prPathFromRead(review.scopeRoot, result.file.filePath) !== file ? 'outro-caminho' : '';
}

function acceptResult(review, state, event, block, creditar) {
  const key = keyFor(event, block.tool_use_id), file = state.pending.get(key);
  if (!file) return;
  state.pending.delete(key);
  const result = event.tool_use_result;
  const recusa = motivoDaRecusa(review, file, block, result);
  if (recusa) return anotarRecusa(state, file, recusa);
  creditDelivery(review, state, file, result.file, block.content, creditar);
}

function creditDelivery(review, state, file, returned, content, creditar = true) {
  let text;
  try { text = fs.readFileSync(path.join(review.scopeRoot, file), 'utf8'); }
  catch { return anotarRecusa(state, file, 'arquivo-ilegivel'); }
  const expected = linesOf(text), start = returned.startLine, count = returned.numLines;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(count) || start < 1 || count < 1
    || start - 1 + count > expected.length || normalized(returned.content) !== normalized(expected.slice(start - 1, start - 1 + count).join('\n'))) return anotarRecusa(state, file, 'conteudo-divergente');
  const delivered = deliveredLines(content);
  if (expected.slice(start - 1, start - 1 + count).some((line, i) => delivered.get(start + i) !== line)) return anotarRecusa(state, file, 'conteudo-divergente');
  // resumo, e não o texto: em modo sombra esta conta roda em toda sessão, e guardar cada arquivo
  // lido em memória até o fim dela seria custo só para medir
  const resumo = createHash('sha256').update(text).digest('hex');
  let proof = state.files.get(file);
  if (!proof || proof.resumo !== resumo) { proof = { resumo, ranges: [] }; state.files.set(file, proof); }
  proof.ranges.push([start, start + count - 1]);
  let through = 0;
  for (const [from, to] of proof.ranges.sort((a, b) => a[0] - b[0])) {
    if (from > through + 1) break;
    through = Math.max(through, to);
  }
  const required = Math.max(1, expected.length - Number(expected.at(-1) === ''));
  proof.required = required;
  if (through >= required) {
    state.provados.add(file);
    if (!creditar) return;
    if (!review.filesRead) review.filesRead = new Set();
    review.filesRead.add(file);
  }
}

function observeSourceResult(engine, opts, returned, content) {
  const review = engine.activeReviews?.get(opts.id);
  if (!review?.scopeRoot || typeof returned?.path !== 'string' || typeof returned.text !== 'string') return;
  const file = prPathFromRead(review.scopeRoot, path.join(review.scopeRoot, returned.path));
  if (!file || file !== returned.path) return;
  creditDelivery(review, estadoDe(review), file,
    { content: returned.text, startLine: returned.start, numLines: returned.count }, content);
}
// PURA. Faixas fechadas [de, ate] já somadas, e o que falta delas até `total`.
function faixasEntregues(ranges) {
  const somadas = [];
  for (const [de, ate] of [...ranges].sort((a, b) => a[0] - b[0])) {
    const ultima = somadas.at(-1);
    if (ultima && de <= ultima[1] + 1) ultima[1] = Math.max(ultima[1], ate);
    else somadas.push([de, ate]);
  }
  return somadas;
}

function faixasFaltantes(entregues, total) {
  const faltam = [];
  let proxima = 1;
  for (const [de, ate] of entregues) {
    if (de > proxima) faltam.push([proxima, de - 1]);
    proxima = Math.max(proxima, ate + 1);
  }
  if (proxima <= total) faltam.push([proxima, total]);
  return faltam;
}

// Sem nenhuma entrega conferida, o total vem do disco na hora do relatório.
function linhasDoArquivo(review, file, proof) {
  if (proof?.required) return proof.required;
  try {
    const linhas = linesOf(fs.readFileSync(path.join(review.scopeRoot, file), 'utf8'));
    return Math.max(1, linhas.length - Number(linhas.at(-1) === ''));
  } catch { return null; }
}

function motivosDaDivergencia(state, file) {
  const motivos = new Set(state.recusas.get(file));
  if ([...state.pending.values()].includes(file)) motivos.add('sem-retorno');
  if (state.files.has(file)) motivos.add('parcial');
  return motivos.size ? [...motivos] : ['sem-retorno'];
}

// Só caminho, contagens e motivo: conteúdo de arquivo nunca entra aqui.
function medidaDaDivergencia(review, state, file) {
  const proof = state.files.get(file), total = linhasDoArquivo(review, file, proof);
  const entregues = faixasEntregues(proof?.ranges || []);
  const faltantes = total === null ? null : faixasFaltantes(entregues, total);
  return {
    arquivo: file, motivos: motivosDaDivergencia(state, file), total,
    entregues: entregues.slice(0, TETO_DE_FAIXAS), faltantes: faltantes && faltantes.slice(0, TETO_DE_FAIXAS),
    faixasOmitidas: Math.max(0, entregues.length - TETO_DE_FAIXAS) + Math.max(0, (faltantes?.length || 0) - TETO_DE_FAIXAS),
  };
}

// O fim da sessão é o único ponto em que a divergência é definitiva: leitura em partes só fecha
// na última parte. Medição para decidir depois; não toca em crédito nem em resultado, e vai para
// o arquivo próprio (medicoes-leitura.js), nunca para o farol.log. O sentido contrário não existe
// em Read (toda prova nasce de um pedido) e a fonte restrita do Codex não tem regra do Read a
// comparar. Tentativa nova da mesma revisão só repete o que mudou, dentro do mesmo teto.
function relatarCoberturaEmSombra(engine, opts) {
  try {
    const review = engine.activeReviews?.get(opts.id), state = review && observations.get(review);
    if (!state) return;
    const dados = { pr: review.keys?.[0] || review.pr?.key || null, sessao: opts.id || null };
    const divergentes = [...state.pedidos].filter(file => !state.provados.has(file));
    let omitidos = 0;
    for (const file of divergentes) {
      if (!state.relatadas.has(file) && state.relatadas.size >= TETO_DE_ARQUIVOS_MEDIDOS) { omitidos++; continue; }
      const medida = medidaDaDivergencia(review, state, file), assinatura = safeStringify(medida);
      if (state.relatadas.get(file) === assinatura) continue;
      state.relatadas.set(file, assinatura);
      registrarMedicao('cobertura-sombra', { ...dados, ...medida });
    }
    if (omitidos && !state.tetoRelatado) {
      state.tetoRelatado = true;
      registrarMedicao('cobertura-sombra-teto', { ...dados, teto: TETO_DE_ARQUIVOS_MEDIDOS, omitidos });
    }
  } catch { /* só observa */ }
}

export { observarLeitura, observeReadEvent, observeSourceResult, relatarCoberturaEmSombra };
