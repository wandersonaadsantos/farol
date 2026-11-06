// Prova de leitura por CONTEÚDO, entre PRs do mesmo repositório (06/11/2026).
//
// A prova por arquivo (file-proof.js) é do PR: um PR novo com os mesmos blobs relia tudo.
// Medido em 06/11/2026: biudtech/biud-frontend#1852 (promoção para homologation) trazia os 21
// arquivos com o MESMO blob do #1843, revisado uma hora antes, e gastou ~10 min relendo os 21.
// As réplicas do GitFlow (task para develop, release_hmg e release_prd) trazem os mesmos blobs.
//
// Aqui mora um índice por repositório, em state/file-proof-blobs/<repo>.json (nome em minúsculas:
// o Windows não diferencia caixa), com chave (caminho, blob SHA, hash do patch): de qual PR e
// commit veio a leitura daquele conteúdo, quando, e o alcance
// conferido para aquele blob. É alimentado junto da prova do PR (salvarProvaDaSessao), só com
// o que a sessão LEU (nunca o herdado, que mantém a origem de quem leu) e só com o alcance que
// o engine conferiu. É lido em prepareReviewReading para o arquivo que a prova própria do PR
// não cobre.
//
// O que NÃO é herdado entre PRs, para não perder qualidade:
// - o alcance "sem uso fora do diff": depende da base e do head do PR novo; a leitura herda e a
//   declaração é refeita pela sessão;
// - o alcance com chamador sem nova conferência: ele é conferido no head NOVO antes da sessão,
//   e o que não confere devolve o arquivo à leitura;
// - a avaliação técnica e o veredito: herança é só da LEITURA do arquivo;
// - caminho diferente (renomeado) e blob vazio;
// - caminho PROTEGIDO (`.env*`, credencial, chave): ele só conta coberto com a leitura OBSERVADA
//   da projeção nesta revisão (file-proof.js, `protegidosSemLeitura`), e a declaração de outro PR
//   não é observação. É pequeno, e relê-lo custa pouco;
// - patch diferente ou status diferente (revisão independente, 06/11/2026): o que se revisa é o
//   patch contra o merge-base, e ele muda entre PRs com o mesmo blob (réplica do GitFlow ou
//   promoção que leva linhas de outras tasks na base). Sem patch completo (o GitHub omite em
//   arquivo grande ou binário, ou corta) não há o que comparar, e o arquivo não herda.
// Falta de dado nunca vira herança: índice ausente, ilegível ou conferência que falha voltam à
// leitura, que é o caminho sempre seguro.
import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { STATE_DIR } from '../paths.js';
import { TEMPOS } from '../constants.js';
import { ensureDir, readJson, writeJsonAtomic } from '../io.js';
import { verificarAlcance, alcanceConferido } from './alcance.js';
import { isCiGap } from '../technical-review/verdict.js';
import { lacunasDispensadas } from './busca-da-prova.js';
import { normalizeFindings, causasDosBloqueios } from './review-findings-contract.js';
import { arquivoProtegido } from '../review-source/caminho-protegido.js';

// Teto por repositório: o índice é lido a cada revisão e não pode crescer sem limite. Acima
// dele ficam as leituras mais recentes; perder uma entrada só custa reler o arquivo.
const TETO_DO_INDICE = 4000;
const DIR = () => path.join(STATE_DIR, 'file-proof-blobs');

function repoDoPr(pr) {
  return String((pr && (pr.repo || String(pr.key || '').split('#')[0])) || '');
}

function indiceDoRepositorioPath(repo) {
  // encodeURIComponent pelo mesmo motivo da prova do PR: trocar `/` por `__` colidiria
  return path.join(DIR(), `${encodeURIComponent(String(repo).toLowerCase())}.json`);
}

function hashDoPatch(patch) { return createHash('sha256').update(String(patch)).digest('hex').slice(0, 32); }
function chaveDoIndice(caminho, sha, patchHash) { return `${sha}:${patchHash}:${caminho}`; }

// A chave do arquivo do inventário, ou '' quando ele não pode herdar nem entrar no índice: sem
// blob, ou sem o patch completo (patchStatus 'available' é o que review-source mediu inteiro).
function chaveDoArquivo(f) {
  if (!f || !f.path || !f.sha || f.patchStatus !== 'available' || typeof f.patch !== 'string' || !f.patch.length) return '';
  return chaveDoIndice(f.path, f.sha, hashDoPatch(f.patch));
}

function lerIndiceDoRepositorio(repo) {
  if (!repo) return {};
  const data = readJson(indiceDoRepositorioPath(repo), null);
  // o repositório gravado tem que ser o pedido: arquivo trocado de lugar não empresta leitura
  if (!data || String(data.repo || '').toLowerCase() !== String(repo).toLowerCase() || !data.entradas || typeof data.entradas !== 'object') return {};
  return data.entradas;
}

// PURA: tira o que passou da idade e, acima do teto, fica com as leituras mais recentes.
function podarIndice(entradas, { agora = Date.now(), maxAgeMs = TEMPOS.PROVA_ARQUIVO_MAX_AGE_MS, teto = TETO_DO_INDICE } = {}) {
  const vivas = Object.entries(entradas || {}).filter(([, e]) => e && Number(e.at) > 0 && agora - Number(e.at) <= maxAgeMs);
  vivas.sort((a, b) => Number(b[1].at) - Number(a[1].at));
  return Object.fromEntries(vivas.slice(0, teto));
}

// O status tem de ser IGUAL: added e modified com o mesmo blob têm patches de natureza diferente.
const mesmoStatus = (a, b) => String(a || '') === String(b || '');

const lista = (v) => (Array.isArray(v) ? v.map(String) : []);

// O que a sessão LEU de fato: no diff medido, com blob, declarado em coverage.reviewed, fora de
// missing e fora do herdado (o herdado guarda a origem de quem leu primeiro).
function lidosNaSessao(arquivos, result) {
  const cov = (result && result.coverage) || {};
  const reviewed = new Set(lista(cov.reviewed));
  // o sem conteúdo integral no escopo (file-proof.js) também fica fora: ninguém o leu
  const fora = new Set([...lista(cov.missing), ...lista(cov.inherited), ...lista(result && result.semConteudoIntegral)]);
  return arquivos.filter((f) => chaveDoArquivo(f) && reviewed.has(f.path) && !fora.has(f.path) && !arquivoProtegido(f));
}

// a origem do alcance diz o PR: o herdado já traz o dele, o lido nesta sessão leva este
function alcanceComOrigem(registro, prKey) {
  const origem = registro.origem || {};
  return { ...registro, origem: { ...origem, pr: origem.pr || prKey } };
}

// Grava no índice do repositório a leitura desta sessão. `alcance` é o que a prova do PR guarda
// (alcanceDaProva: conferido, preso ao blob). Best-effort: quem chama protege a revisão.
function registrarNoIndiceDoRepositorio(pr, headSha, arquivos, result, alcance, opcoes = {}) {
  const repo = repoDoPr(pr);
  if (!repo || !headSha || !Array.isArray(arquivos)) return 0;
  const lidos = lidosNaSessao(arquivos, result);
  if (!lidos.length) return 0;
  const agora = opcoes.agora || Date.now();
  const entradas = { ...lerIndiceDoRepositorio(repo) };
  for (const f of lidos) {
    const registro = alcance && Object.hasOwn(alcance, f.path) ? alcance[f.path] : null;
    const entrada = { caminho: f.path, pr: pr.key, head: headSha, at: agora, sessionId: (result && result.sessionId) || null, status: String(f.status || '') };
    if (registro && registro.sha === f.sha) entrada.alcance = alcanceComOrigem(registro, pr.key);
    entradas[chaveDoArquivo(f)] = entrada;
  }
  const p = indiceDoRepositorioPath(repo);
  ensureDir(path.dirname(p));
  writeJsonAtomic(p, { repo, entradas: podarIndice(entradas, { agora, ...opcoes }) });
  return lidos.length;
}

// A leitura só empresta prova a outro PR quando a análise sustenta decisão (revisão independente,
// 06/11/2026): completa, sem cancelamento e sem lacuna exigida além do CI (a incoerência do texto,
// o commit não confirmado e as outras lacunas duras ficam em approvalEvidence depois da rodada).
// Sem a prova da rodada calculada, não entra. A lacuna não dura sobre a qualidade da leitura
// (protocolo não comprovado, verificação de afirmações ausente, divergência no checkpoint) também
// barra, mesmo virando ressalva aqui: o PR que herdasse ficaria limpo, sem a ressalva da origem
// (segunda revisão independente, 06/11/2026). Só a pendência de cobertura é tolerada, porque
// lidosNaSessao já tira do índice, arquivo a arquivo, o que não foi lido.
// Bloqueio em aberto também barra (thread do PR #351, 06/11/2026): o índice guarda só a leitura,
// nunca os achados, e a memória de rodadas é por PR. Um pedido de mudanças coerente entrava, e o
// PR seguinte com o patch idêntico herdava o arquivo como lido sem reavaliar o defeito conhecido.
// Vale o bloqueio vigente desta rodada, o pedido de mudanças sem achado legível e o bloqueio de
// rodada anterior que a memória ainda conta. Achado ilegível não vira herança. PURA.
const ehPendenciaDeCobertura = (g) => /^a cobertura da leitura tem /.test(g);
function temBloqueioEmAberto(result) {
  if (result.verdict === 'request_changes') return true;
  if (normalizeFindings(result.findings).status === 'invalid' || causasDosBloqueios(result).size) return true;
  const memoria = result.roundReview;
  return !!memoria && Number(memoria.unresolvedCount) > 0;
}
function podeEntrarNoIndice(result) {
  if (!result || result.cancelled || result.analysisStatus !== 'complete' || !Array.isArray(result.approvalEvidence)) return false;
  if (temBloqueioEmAberto(result)) return false;
  if (!result.approvalEvidence.every((g) => isCiGap(g))) return false;
  return lacunasDispensadas({ ...result, provaEsgotada: true }).every(ehPendenciaDeCobertura);
}

// O que o runHeadlessReview chama depois da prova da rodada e da conferência do cancelamento.
// Best-effort: falha aqui nunca derruba a revisão.
function registrarLeituraEntrePrs(pr, headSha, arquivos, result, alcance) {
  if (!podeEntrarNoIndice(result)) return 0;
  try { return registrarNoIndiceDoRepositorio(pr, headSha, arquivos, result, alcance); } catch { return 0; }
}

// PURA: os arquivos do diff atual que herdam a leitura do índice. `jaCobertos` é o que a prova
// própria do PR já herda (ela vence). Entrada gravada pelo próprio PR não serve: a prova do PR
// é quem responde por ele, inclusive pela regra do mesmo head.
function herancaDoRepositorio(pr, arquivos, entradas, jaCobertos) {
  const vazio = { unchanged: [], alcance: {}, origens: {} };
  if (!Array.isArray(arquivos) || !entradas) return vazio;
  const pular = new Set(jaCobertos || []);
  const saida = { unchanged: [], alcance: {}, origens: {} };
  for (const f of arquivos) {
    const chave = chaveDoArquivo(f);
    if (!chave || pular.has(f.path) || arquivoProtegido(f)) continue;
    const e = Object.hasOwn(entradas, chave) ? entradas[chave] : null;
    if (!e || e.pr === pr.key || !e.head || !mesmoStatus(e.status, f.status)) continue;
    saida.unchanged.push(f.path);
    saida.origens[f.path] = { pr: String(e.pr), head: String(e.head) };
    if (e.alcance && e.alcance.sha === f.sha && e.alcance.entrada) saida.alcance[f.path] = e.alcance;
  }
  return saida;
}

// Confere no head NOVO o alcance com chamador herdado entre PRs, com a mesma régua da rodada
// (verificarAlcance + alcanceConferido) contra o diff do PR novo. O "sem uso fora do diff" é
// retirado da conferência: ele não vale fora do PR que o declarou. Arquivo cuja declaração com
// chamador não fecha perde a herança e volta à leitura; só motivo, a leitura fica e o alcance
// é pedido de novo à sessão.
async function conferirAlcanceEntrePrs(engine, pr, head, arquivos, heranca) {
  const comChamador = Object.entries(heranca.alcance)
    .filter(([, r]) => Array.isArray(r.entrada.chamadores) && r.entrada.chamadores.length);
  const devolvidos = [];
  const alcance = {};
  if (comChamador.length) {
    const teste = { diffMedido: arquivos.map((f) => f.path),
      alcance: comChamador.map(([p, r]) => ({ alterado: p, chamadores: r.entrada.chamadores, semChamador: '' })) };
    await verificarAlcance(engine, pr, head, teste);
    const fechou = alcanceConferido(teste);
    for (const [p, r] of comChamador) {
      if (Object.hasOwn(fechou, p)) alcance[p] = r; else devolvidos.push(p);
    }
  }
  const fora = new Set(devolvidos);
  return { unchanged: heranca.unchanged.filter((p) => !fora.has(p)), alcance,
    origens: Object.fromEntries(Object.entries(heranca.origens).filter(([p]) => !fora.has(p))), devolvidos };
}

// PURA: a herança da prova do PR somada à do repositório. O alcance da prova própria vence.
function juntarHerancas(propria, doRepo, arquivos) {
  const unchanged = [...new Set([...(propria.unchanged || []), ...doRepo.unchanged])];
  const herdado = new Set(unchanged);
  return { ...propria, ativa: unchanged.length > 0, unchanged,
    changed: arquivos.map((f) => f.path).filter((p) => !herdado.has(p)),
    alcance: { ...doRepo.alcance, ...(propria.alcance || {}) }, origens: { ...(propria.origens || {}), ...doRepo.origens } };
}

// Fiação de prepareReviewReading: devolve a herança combinada, ou a própria se algo faltar.
async function herdarDoRepositorio(engine, pr, head, arquivos, propria) {
  if (!Array.isArray(arquivos) || !arquivos.length || !head) return propria;
  try {
    const bruta = herancaDoRepositorio(pr, arquivos, lerIndiceDoRepositorio(repoDoPr(pr)), propria.unchanged);
    if (!bruta.unchanged.length) return propria;
    const conferida = await conferirAlcanceEntrePrs(engine, pr, head, arquivos, bruta);
    if (conferida.devolvidos.length && typeof engine.log === 'function') {
      engine.log('WARN', `${pr.key}: alcance herdado de outro PR não conferiu no head ${String(head).slice(0, 7)}; volta à leitura: ${conferida.devolvidos.join(', ')}`);
    }
    return conferida.unchanged.length ? juntarHerancas(propria, conferida, arquivos) : propria;
  } catch { return propria; }
}

// Poda do diretório no boot: índice de repositório sem gravação há mais que a idade máxima sai
// inteiro (best-effort por entrada, padrão G20).
function pruneIndicesDoRepositorio(maxAgeMs = TEMPOS.PROVA_ARQUIVO_MAX_AGE_MS, agora = Date.now()) {
  let nomes;
  try { nomes = fs.readdirSync(DIR()); } catch { return; }
  for (const nome of nomes) {
    try {
      const alvo = path.join(DIR(), nome);
      if (agora - fs.statSync(alvo).mtimeMs > maxAgeMs) fs.unlinkSync(alvo);
    } catch { /* lixo que não sai hoje sai amanhã */ }
  }
}

export {
  TETO_DO_INDICE, repoDoPr, indiceDoRepositorioPath, chaveDoIndice, chaveDoArquivo, hashDoPatch, lerIndiceDoRepositorio, podarIndice, mesmoStatus,
  registrarNoIndiceDoRepositorio, podeEntrarNoIndice, registrarLeituraEntrePrs, herancaDoRepositorio, conferirAlcanceEntrePrs, juntarHerancas, herdarDoRepositorio,
  pruneIndicesDoRepositorio,
};
