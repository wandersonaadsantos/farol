// Diário de tentativas de sessão de IA (spec 7.A1, item 9). O acumulador de consumo da
// sessão mora em memória (lib/engine/session.js), então app fechado no meio (bandeja,
// queda, kill) perdia o gasto inteiro. Aqui cada tentativa é aberta ANTES do provedor,
// ganha o consumo parcial durante a sessão e sai no fechamento normal, DEPOIS de o
// consumo ser registrado. O que sobra no boot virou, por construção, uma sessão cortada:
// reconciliarInterrompidas a transforma em linha `interrompida`, com os tokens vistos
// ou com custo desconhecido, e nunca a apaga sem registrar.
//
// O id da tentativa é próprio (uma sessão pode ter duas tentativas: retomada recusada
// cai numa sessão nova com o mesmo id do Farol) e viaja para a linha do Consumo como
// `attemptId`, que é o que impede o boot de duplicar uma tentativa já registrada.
//
// LIMITE DECLARADO: no POSIX o provedor roda em grupo de processo próprio (detached) e
// pode continuar consumindo depois que o engine morreu. Esse gasto não é observado; a
// linha diz isso em `provedorPodeTerContinuado`.
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { STATE_DIR, IS_WIN } from '../paths.js';
import { readJson, writeJsonAtomic, ensureDir } from '../io.js';
import { TEMPOS } from '../constants.js';
import usageMod from './usage.js';

const ARQUIVO = path.join(STATE_DIR, 'usage-tentativas.json');
const CAMPOS = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'];
// hora da última gravação de parcial por tentativa: memória do processo, de propósito
// (reinício zera, e a primeira gravação depois dele sai na hora)
const ultimaGravacao = new Map();

function arquivoDeTentativas() { return ARQUIVO; }
function objeto(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function texto(v) { return typeof v === 'string' ? v : ''; }

function avisar(engine, msg) {
  if (engine && typeof engine.log === 'function') engine.log('WARN', msg);
}

function ler(engine) {
  const bruto = readJson(ARQUIVO, null, (m) => avisar(engine, m));
  return objeto(bruto) && objeto(bruto.tentativas) ? bruto : { tentativas: {} };
}

function gravar(engine, dados) {
  try {
    ensureDir(STATE_DIR);
    writeJsonAtomic(ARQUIVO, dados);
    return true;
  } catch (err) {
    avisar(engine, `gravar usage-tentativas.json: ${err.message}`);
    return false;
  }
}

function usoSaneado(u) {
  const out = {};
  for (const c of CAMPOS) out[c] = Math.max(0, Number(u && u[c]) || 0);
  return out;
}

function abrirTentativa(engine, meta) {
  const m = objeto(meta) ? meta : {};
  const attemptId = randomUUID();
  const dados = ler(engine);
  dados.tentativas[attemptId] = {
    attemptId, sessionId: texto(m.sessionId), kind: usageMod.kindFromId(m.sessionId),
    account: texto(m.account), profileId: texto(m.profileId), model: texto(m.model),
    ref: texto(m.ref), provedor: texto(m.provedor) || 'claude',
    abertaEm: Date.now(), parcial: usoSaneado(null), parcialEm: 0,
  };
  gravar(engine, dados);
  return attemptId;
}

// `parcial.usage` é o acumulado da sessão até aqui (substitui, não soma).
function registrarParcial(engine, attemptId, parcial) {
  if (!attemptId || !objeto(parcial)) return false;
  const agora = Date.now();
  const ultima = ultimaGravacao.get(attemptId) || 0;
  if (parcial.fimDeTurno !== true && ultima && agora - ultima < TEMPOS.TENTATIVA_PARCIAL_MS) return false;
  const dados = ler(engine);
  const tentativa = dados.tentativas[attemptId];
  if (!objeto(tentativa)) return false;
  tentativa.parcial = usoSaneado(parcial.usage);
  if (texto(parcial.model)) tentativa.model = texto(parcial.model);
  tentativa.parcialEm = agora;
  ultimaGravacao.set(attemptId, agora);
  return gravar(engine, dados);
}

// Chamado DEPOIS do registro de consumo do fechamento normal. Se o processo morrer entre
// os dois, o boot acha a linha pelo attemptId e só remove.
function fecharTentativa(engine, attemptId) {
  ultimaGravacao.delete(attemptId);
  if (!attemptId) return false;
  const dados = ler(engine);
  if (!dados.tentativas[attemptId]) return false;
  delete dados.tentativas[attemptId];
  return gravar(engine, dados);
}

function eventoInterrompido(tentativa) {
  const usage = usoSaneado(tentativa.parcial);
  const temToken = CAMPOS.some((c) => usage[c] > 0);
  return {
    usage, farol_interrompida: true, farol_parcial: temToken, farol_custo_desconhecido: !temToken,
    farol_attempt: tentativa.attemptId, farol_iniciada_em: Number(tentativa.abertaEm) || 0,
    farol_provedor_destacado: !IS_WIN,
  };
}

// recordUsage avisa a tela (pushState) e a outbox. No boot a tela ainda não existe e o
// snapshot leria campos que o construtor preenche depois; a outbox recupera pelo cursor.
function registroDeBoot(engine) {
  if (!engine.usage) engine.usage = usageMod.defaultUsage();
  if (!engine.usageSessions) engine.usageSessions = usageMod.defaultSessions();
  return {
    usage: engine.usage, usageSessions: engine.usageSessions,
    log: (nivel, msg) => avisar(engine, msg),
    pushState() { /* boot: a tela ainda não existe */ },
  };
}

function jaRegistrada(engine, attemptId) {
  return (engine.usageSessions.sessions || []).some((s) => objeto(s) && s.attemptId === attemptId);
}

function reconciliarInterrompidas(engine) {
  const dados = ler(engine);
  const ids = Object.keys(dados.tentativas);
  if (!ids.length) return 0;
  const alvo = registroDeBoot(engine);
  let criadas = 0;
  for (const id of ids) {
    const tentativa = dados.tentativas[id];
    if (objeto(tentativa) && !jaRegistrada(engine, id)) {
      usageMod.recordUsage(alvo, tentativa.sessionId, tentativa.account, eventoInterrompido(tentativa), tentativa.model, tentativa.profileId, tentativa.ref);
      criadas++;
    }
    // só sai do diário o que tem linha (ou era lixo ilegível): nunca some sem registro
    if (!objeto(tentativa) || jaRegistrada(engine, id)) delete dados.tentativas[id];
  }
  gravar(engine, dados);
  return criadas;
}

const tentativasMod = { arquivoDeTentativas, abrirTentativa, registrarParcial, fecharTentativa, reconciliarInterrompidas };
export default tentativasMod;
export { arquivoDeTentativas, abrirTentativa, registrarParcial, fecharTentativa, reconciliarInterrompidas };
