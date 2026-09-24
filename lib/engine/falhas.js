// Registro local e durável de falha por sessão de IA (spec 7.A1, item 6). Mora em
// state/falhas-sessao.json, FORA do farol.log: o log é a fonte do Diagnóstico e o
// "Limpar log" o apaga inteiro, e até aqui ele era a única cópia do motivo de uma
// revisão que estacionou. Aqui o motivo fica inteiro (sem o corte de 300 caracteres
// da mensagem de erro), com teto próprio e máscara de segredo, ligado à linha do
// Consumo (sessionId e attemptId) e ao card estacionado (sessionId).
//
// `sessionId` é o id OPACO do Farol (lib/engine/sessao-id.js); o id da sessão do CLI,
// quando existe, vai em `cliSessionId`. Nunca lança: registrar falha não pode virar falha.
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { STATE_DIR } from '../paths.js';
import { readJson, writeJsonAtomic, ensureDir } from '../io.js';
import { classify, CLASSES, DESCONHECIDO } from '../log-taxonomy.js';

const ARQUIVO = path.join(STATE_DIR, 'falhas-sessao.json');
// stderr de CLI e pilha cabem folgados; um dump de megabytes não
const MOTIVO_MAX = 8000;
const FALHAS_MAX = 500;
const LIMITE_PADRAO = 50;
const RESUMO_MOTIVO_MAX = 200;
// o corte que a MENSAGEM de erro sempre teve: taxonomia, toast e retry leem ela
const CORTE_MENSAGEM = 300;
// desfechos de retomada que a A5 produz
const RESUME_OUTCOMES = ['retomada', 'recusada', 'nova', 'nenhuma'];
const MARCA = '[segredo mascarado]';
const VARIAVEL_DE_SEGREDO = /\b(ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|CLAUDE_CODE_OAUTH_TOKEN|OPENAI_API_KEY|CODEX_API_KEY|GH_TOKEN|GITHUB_TOKEN)\s*[=:]\s*\S+/gi;
const PARAMETRO_DE_URL = /([?&](?:auth|access_token|token)=)[^&\s]+/gi;
const FORMATOS_DE_SEGREDO = [
  /\bsk-(?:ant|or)-[A-Za-z0-9_-]{8,}/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
];

function arquivoDeFalhas() { return ARQUIVO; }
function objeto(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function texto(v) { return typeof v === 'string' ? v : ''; }

function avisar(engine, msg) {
  if (engine && typeof engine.log === 'function') engine.log('WARN', msg);
}

function mascararSegredos(valor) {
  let s = String(valor === undefined || valor === null ? '' : valor);
  s = s.replace(VARIAVEL_DE_SEGREDO, (_, nome) => `${nome}=${MARCA}`);
  s = s.replace(PARAMETRO_DE_URL, (_, prefixo) => `${prefixo}${MARCA}`);
  for (const re of FORMATOS_DE_SEGREDO) s = s.replace(re, MARCA);
  return s;
}

// Cópia em memória presa ao engine: o snapshot lê a cada push, e reler o disco a cada
// push seria IO sem motivo. Engine de teste sem o campo lê do disco uma vez.
function lista(engine) {
  if (engine && Array.isArray(engine.falhasSessao)) return engine.falhasSessao;
  const bruto = readJson(ARQUIVO, null, (m) => avisar(engine, m));
  const falhas = objeto(bruto) && Array.isArray(bruto.falhas) ? bruto.falhas.filter(objeto) : [];
  if (engine && typeof engine === 'object') engine.falhasSessao = falhas;
  return falhas;
}

function gravar(engine, falhas) {
  try {
    ensureDir(STATE_DIR);
    writeJsonAtomic(ARQUIVO, { falhas });
    return true;
  } catch (err) {
    avisar(engine, `gravar falhas-sessao.json: ${err.message}`);
    return false;
  }
}

function etapaValida(s) {
  return { id: texto(s.id), label: texto(s.label), ms: Number(s.ms) || 0 };
}

function etapasValidas(etapas) {
  if (!objeto(etapas) || !Array.isArray(etapas.stages)) return null;
  return { totalMs: Number(etapas.totalMs) || 0, stages: etapas.stages.filter(objeto).map(etapaValida) };
}

// Erro de sessão com a mensagem de sempre (cortada) e o texto inteiro em
// `detalheCompleto`, que só o registro durável lê.
function erroDeSessao(prefixo, detalhe) {
  const bruto = String(detalhe === undefined || detalhe === null ? '' : detalhe);
  const err = new Error(`${prefixo}${bruto.slice(0, CORTE_MENSAGEM)}`);
  err.detalheCompleto = `${prefixo}${bruto}`;
  return err;
}

function detalheDaFalha(err) {
  if (!err) return '';
  return String(err.detalheCompleto || err.message || '');
}

// Quem conhece a sessão (runHeadlessReview, runSelfAnalysis) anota antes do finally
// apagar o feed; quem registra (runOneHeadless) está fora dela.
function anotarFalhaDaSessao(err, sessionId, etapas) {
  if (!err || typeof err !== 'object') return err;
  if (!err.sessaoFarol && sessionId) err.sessaoFarol = sessionId;
  if (!err.etapas && etapas) err.etapas = etapas;
  return err;
}

function marcarErroNoConsumo(engine, id) {
  if (!id || !engine || typeof engine.marcarDesfecho !== 'function') return false;
  return engine.marcarDesfecho(id, 'erro');
}

function montarRegistro(d) {
  const bruto = String(d.motivo || '');
  const mascarado = mascararSegredos(bruto);
  const registro = {
    id: randomUUID(), at: Date.now(),
    sessionId: texto(d.sessionId), attemptId: texto(d.attemptId), cliSessionId: texto(d.cliSessionId),
    kind: texto(d.kind) || 'outro', account: texto(d.account).toLowerCase(), ref: texto(d.ref),
    motivo: mascarado.slice(0, MOTIVO_MAX),
    motivoTruncado: mascarado.length > MOTIVO_MAX,
    classe: texto(d.classe) || classify(bruto).id,
    etapas: etapasValidas(d.etapas),
  };
  if (RESUME_OUTCOMES.includes(d.resumeOutcome)) registro.resumeOutcome = d.resumeOutcome;
  return registro;
}

/* Falha que se resolve sozinha volta a cada ciclo enquanto a condição durar, e até aqui
   cada tentativa virava um registro novo: em 17/09/2026 o mesmo limite semanal do plano
   escreveu um cartão por minuto no mesmo PR, todos com a mesma mensagem. Repetição
   IDÊNTICA não é informação nova, é contagem: ela atualiza o registro que já existe (mesma
   espécie, mesma conta, mesma referência, mesmo motivo), que sobe para o fim da lista com a
   data da última vez e guarda desde quando repete. Vale só para o que repete por
   construção; falha permanente e operacional continuam uma linha por acontecimento, porque
   cada uma tem sessão própria para investigar e o card estacionado aponta pra ela. */
const KINDS_QUE_REPETEM = ['espera-reset', 'transitorio'];

function repetitiva(classeId) {
  const c = [...CLASSES, DESCONHECIDO].find((x) => x.id === classeId);
  return !!c && KINDS_QUE_REPETEM.includes(c.kind);
}

function mesmaFalha(a, b) {
  return a.kind === b.kind && a.classe === b.classe && a.ref === b.ref
    && a.account === b.account && a.motivo === b.motivo;
}

// Funde a repetição no registro anterior: mantém o id (o cartão da tela e o botão de
// copiar não trocam de identidade no meio de uma espera) e a data da PRIMEIRA vez.
function fundirRepeticao(falhas, registro) {
  if (!repetitiva(registro.classe)) return registro;
  const i = falhas.findIndex((f) => mesmaFalha(f, registro));
  if (i < 0) return registro;
  const anterior = falhas.splice(i, 1)[0];
  registro.id = String(anterior.id || registro.id);
  registro.primeiraAt = Number(anterior.primeiraAt) || Number(anterior.at) || registro.at;
  registro.ocorrencias = (Number(anterior.ocorrencias) || 1) + 1;
  return registro;
}

function registrarFalha(engine, dados) {
  try {
    const registro = montarRegistro(objeto(dados) ? dados : {});
    const falhas = lista(engine);
    falhas.push(fundirRepeticao(falhas, registro));
    if (falhas.length > FALHAS_MAX) falhas.splice(0, falhas.length - FALHAS_MAX);
    gravar(engine, falhas);
    return registro;
  } catch (err) {
    avisar(engine, `registrar falha de sessão: ${err && err.message}`);
    return null;
  }
}

/* A fusao de repeticao acontecia so na ESCRITA (fundirRepeticao), entao registro anterior
   a ela continuava uma linha por acontecimento para sempre: em 23/09/2026 o Diagnostico
   deste aparelho mostrava 19 cartoes, 15 deles o MESMO limite de plano no MESMO PR, um por
   tentativa entre 17:12 e 18:02. Quem LE funde pela mesma regra (mesmaFalha e repetitiva,
   uma fonte so para "isto e repeticao"), e o historico antigo colapsa sem tocar no disco.
   Guarda a data da PRIMEIRA e fala da ULTIMA, igual ao lado da escrita. */
function fundirParaLeitura(registros) {
  const saida = [];
  for (const f of registros) {
    const i = repetitiva(f.classe) ? saida.findIndex((x) => mesmaFalha(x, f)) : -1;
    if (i < 0) { saida.push({ ...f }); continue; }
    const anterior = saida.splice(i, 1)[0];
    saida.push({
      ...f,
      id: String(anterior.id || f.id),
      primeiraAt: Number(anterior.primeiraAt) || Number(anterior.at) || Number(f.at) || 0,
      ocorrencias: (Number(anterior.ocorrencias) || 1) + (Number(f.ocorrencias) || 1),
    });
  }
  return saida;
}

// O limite conta LINHAS da tela, e nao registros crus: pedir 20 e receber 20 copias da
// mesma noticia era o mesmo defeito por outro caminho.
function falhasRecentes(engine, opcoes) {
  const pedido = Number(opcoes && opcoes.limite);
  const limite = pedido > 0 ? Math.min(pedido, FALHAS_MAX) : LIMITE_PADRAO;
  return fundirParaLeitura(lista(engine)).slice(-limite).reverse();
}

function falhaDaSessao(engine, sessionId) {
  const id = texto(sessionId);
  if (!id) return null;
  return [...lista(engine)].reverse().find((f) => f.sessionId === id) || null;
}

// Resumo curto para o snapshot da aba Consumo: só das sessões que a tela mostra.
function falhasPorSessao(engine, ids) {
  const alvo = new Set((Array.isArray(ids) ? ids : []).filter(Boolean));
  const out = {};
  if (!alvo.size) return out;
  for (const f of lista(engine)) {
    if (alvo.has(f.sessionId)) out[f.sessionId] = { at: f.at, classe: f.classe, motivo: String(f.motivo || '').slice(0, RESUMO_MOTIVO_MAX) };
  }
  return out;
}

const falhasMod = {
  arquivoDeFalhas, mascararSegredos, erroDeSessao, detalheDaFalha, anotarFalhaDaSessao,
  marcarErroNoConsumo, registrarFalha, falhasRecentes, falhaDaSessao, falhasPorSessao,
};
export default falhasMod;
export {
  arquivoDeFalhas, mascararSegredos, erroDeSessao, detalheDaFalha, anotarFalhaDaSessao,
  marcarErroNoConsumo, registrarFalha, falhasRecentes, falhaDaSessao, falhasPorSessao,
};
