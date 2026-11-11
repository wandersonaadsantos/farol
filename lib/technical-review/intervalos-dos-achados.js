// O início de uma construção não delimita o achado. O parser do app mede seu intervalo
// no material privado, sem carregar código do PR. Falha de leitura/sintaxe não dá desconto.
import fs from 'node:fs/promises';
import path from 'node:path';
import { carregarParserDistribuido, pluginsDoArquivo } from '../parser-runtime.js';
import { sourcePath, blobHash, DEFAULTS } from '../review-source/contract.js';
import { contained } from '../review-source/files.js';
import { linhaDoAchado } from './divida-fora-das-linhas.js';

const { parse } = carregarParserDistribuido();
const MAX_NODES = 100000;
// Só verificadores cujo ponto acusa uma construção sintática. Regra nova não ganha
// dívida por coincidência de texto; entra aqui depois de conferir seu contrato.
const REGRAS_COM_INTERVALO = new Set([
  'core.suppression.declared', 'core.testing.e2e-without-mocks', 'core.javascript.no-nested-ternary',
  'frontend.component.scalable-units', 'frontend.design-system.canonical-source',
  'frontend.component.index-only-reexports', 'frontend.component.no-inline-jsx-ternary',
]);
const IGNORADOS = new Set(['loc', 'tokens', 'comments', 'errors', 'extra', 'leadingComments', 'innerComments', 'trailingComments']);

function juntar(mapa, linha, inicio, fim) {
  const anterior = mapa.get(linha);
  mapa.set(linha, { inicio: Math.min(anterior?.inicio ?? inicio, inicio), fim: Math.max(anterior?.fim ?? fim, fim) });
}

function medirNo(node, linhas, intervalos, supressores) {
  if (['File', 'Program'].includes(node.type)) return;
  const linha = node.loc?.start.line;
  if (linhas.has(linha)) {
    juntar(intervalos, linha, linha, node.loc.end.line);
    // A ficha de it.skip/only pode ser um comentário de bloco que começa longe.
    for (const c of node.leadingComments || []) {
      if (c.loc.end.line === linha - 1) juntar(supressores, linha, c.loc.start.line, node.loc.end.line);
    }
  }
  // O supressor na linha de cima alcança a construção seguinte inteira.
  for (const c of [...(node.leadingComments || []), ...comentariosEntreDecorators(node)]) {
    if (linhas.has(c.loc.start.line)) {
      juntar(supressores, c.loc.start.line, c.loc.start.line, node.loc.end.line);
    }
  }
}

// Com decorators, a construção começa no primeiro decorator, e o comentário posto depois dele fica
// preso à chave, ao nome ou ao decorator seguinte, não à construção. Medido só até ali, um supressor
// entre `@Get()` e o método daria desconto a uma mudança no corpo que ele cobre.
function comentariosEntreDecorators(node) {
  if (!Array.isArray(node.decorators) || !node.decorators.length) return [];
  const presos = [node.key, node.id, ...node.decorators.slice(1)].flatMap((n) => n?.leadingComments || []);
  const soltos = node.decorators.flatMap((d) => d.trailingComments || []);
  return [...presos, ...soltos];
}

function empilharFilhos(node, stack) {
  for (const [key, value] of Object.entries(node)) {
    if (IGNORADOS.has(key)) continue;
    if (Array.isArray(value)) {
      for (const child of value) if (child?.type) stack.push(child);
      continue;
    }
    if (value?.type) stack.push(value);
  }
}

// Mais de uma construção começando na mesma linha usa a união conservadora: sem coluna
// na ferramenta não há prova para escolher a menor. File/Program não contam como construção.
function intervalosDoTexto(file, text, linhas) {
  if (!/\.[cm]?[jt]sx?$/.test(file) || !linhas.size) return null;
  const plugins = pluginsDoArquivo(file);
  try {
    const ast = parse(text, { sourceType: 'unambiguous', plugins, errorRecovery: false,
      allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true });
    const intervalos = new Map(), supressores = new Map(), amplos = new Set(), stack = [ast];
    let count = 0;
    for (const c of ast.comments || []) {
      if (linhas.has(c.loc.start.line)) juntar(intervalos, c.loc.start.line, c.loc.start.line, c.loc.end.line);
      const texto = c.value.replace(/^[\s*/]+/, '');
      if (texto.startsWith('istanbul ignore file') || texto.startsWith('@ts-nocheck')) amplos.add(c.loc.start.line);
    }
    while (stack.length) {
      const node = stack.pop();
      if (++count > MAX_NODES) return null;
      medirNo(node, linhas, intervalos, supressores);
      empilharFilhos(node, stack);
    }
    return { intervalos, supressores, amplos };
  } catch { return null; /* sintaxe desconhecida não prova que o achado é anterior */ }
}

function supressorAmplo(f, arquivo, linha) {
  if (f?.rule !== 'core.suppression.declared') return false;
  // Seleção exclusiva de testes e diretiva de arquivo afetam código além do primeiro
  // nó. Sem delimitar esse alcance, o intervalo sintático local não concede dívida.
  return arquivo.amplos.has(linha) || ['eslint-disable', '.only', 'fit', 'fdescribe']
    .some(marcador => f.message.startsWith(`supressor "${marcador}" `));
}

// Abre uma vez e opera só pelo descritor: o tipo, o tamanho e os bytes são do MESMO arquivo
// aberto, e o blob sai dos bytes lidos (nunca de um caminho checado antes e lido depois).
// Lê no máximo um byte além do teto para recusar o arquivo que cresceu depois do fstat.
async function lerPeloDescritor(alvo) {
  const handle = await fs.open(alvo, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > DEFAULTS.maxFileBytes) return null;
    const buffer = Buffer.alloc(DEFAULTS.maxFileBytes + 1);
    let lidos = 0;
    while (lidos < buffer.length) {
      const { bytesRead } = await handle.read(buffer, lidos, buffer.length - lidos, lidos);
      if (!bytesRead) break;
      lidos += bytesRead;
    }
    return lidos > DEFAULTS.maxFileBytes ? null : buffer.subarray(0, lidos);
  } finally { await handle.close(); }
}

async function lerMaterial(snapshot, file) {
  try {
    const bytes = await lerPeloDescritor(await contained(snapshot, path.join(snapshot, sourcePath(file))));
    return bytes && { text: bytes.toString('utf8'), blob: blobHash(bytes) };
  } catch { return null; /* arquivo ilegível ou fora do material conserva o bloqueio */ }
}

// Roda no worker da avaliação, dentro do teto/cancelamento que já o controla. Os intervalos
// levam o blob lido: só o inventário desse mesmo conteúdo pode usá-los para classificar dívida.
async function medirIntervalos(snapshot, findings) {
  const grupos = new Map();
  for (const f of findings) {
    const linha = linhaDoAchado(f);
    if (!linha || !REGRAS_COM_INTERVALO.has(f?.rule) || typeof f.file !== 'string') continue;
    if (!grupos.has(f.file)) grupos.set(f.file, new Set());
    grupos.get(f.file).add(linha);
  }
  const arquivos = new Map();
  for (const [file, linhas] of grupos) {
    const material = await lerMaterial(snapshot, file);
    if (!material) continue;
    const medido = intervalosDoTexto(file, material.text, linhas);
    if (medido) arquivos.set(file, { ...medido, blob: material.blob });
  }
  return findings.map((f) => {
    const arquivo = arquivos.get(f?.file), linha = linhaDoAchado(f);
    const faixa = arquivo?.intervalos.get(linha);
    if (!faixa || !REGRAS_COM_INTERVALO.has(f?.rule) || supressorAmplo(f, arquivo, linha)) return f;
    const supressor = f.rule === 'core.suppression.declared' ? arquivo.supressores.get(linha) : null;
    const inicio = Math.min(faixa.inicio, supressor?.inicio ?? faixa.inicio);
    const fim = Math.max(faixa.fim, supressor?.fim ?? faixa.fim);
    return { ...f, intervaloVerificado: { inicio, fim, blob: arquivo.blob } };
  });
}

export { intervalosDoTexto, medirIntervalos };
