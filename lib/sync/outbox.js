// Outbox do consumo que sobe para o banco da sincronização entre dispositivos. Mora em
// state/sync-outbox.json e é só fila: a fonte de verdade do consumo continua sendo o
// usage-sessions.json local. Folha de IO simples: não conhece o engine.
//
// Idempotência é por construção, não por memória: cada sessão vira um evento com id
// derivado dos campos IMUTÁVEIS dela (eventIdFor), gravado por PATCH no mesmo nó
// remoto. Reenviar (migração repetida, correção de desfecho, resposta perdida) cai no
// mesmo lugar e nunca conta o mesmo dinheiro duas vezes.
import path from 'node:path';
import { STATE_DIR } from '../paths.js';
import { SYNC } from '../constants.js';
import io from '../io.js';
import { SYNC_CODES } from './errors.js';
import { accountHash, prHash, eventIdFor, brasiliaDay } from './keys.js';

const ARQUIVO = path.join(STATE_DIR, SYNC.OUTBOX_FILE);
const EVENT_ID_RE = /^[0-9a-f]{64}$/;
// Só a recusa do PRÓPRIO evento conta tentativa, e quem diz isso é o status HTTP, não
// o código: o codeFromStatus junta em `resposta_invalida` tudo que não é 401/404/412/5xx
// (408, 429, 403, 407) e ainda o 200 com corpo que não é JSON (portal cativo, proxy).
// Rede, rate limit, proxy e token vencido dizem respeito à conexão: contá-los jogaria
// evento bom em rejeitados durante a queda, e o dinheiro sumiria do consolidado. 400 é
// o banco recusando o corpo; 413 é corpo grande demais, e num lote a contagem é o que
// liga o envio de um em um (loteDe): o evento bom sai sozinho no envio seguinte, com
// uma tentativa só, e só quem é grande sozinho chega ao teto.
const STATUS_DE_RECUSA = new Set([400, 413]);

function outboxPath() { return ARQUIVO; }

function defaultOutbox() {
  return { destino: '', cursorAt: 0, correcoesAt: 0, pending: [], enviados: 0, rejeitados: 0, lastSentAt: 0, paused: false };
}

function numero(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function objeto(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

function entradaValida(e) {
  return objeto(e) && EVENT_ID_RE.test(String(e.eventId || '')) && objeto(e.payload);
}

// arquivo editado à mão ou de versão futura vale pelo que tiver de reconhecível
function normalizar(bruto) {
  const base = defaultOutbox();
  if (!objeto(bruto)) return base;
  const pending = Array.isArray(bruto.pending) ? bruto.pending.filter(entradaValida) : [];
  return {
    destino: typeof bruto.destino === 'string' ? bruto.destino : '',
    cursorAt: numero(bruto.cursorAt),
    correcoesAt: numero(bruto.correcoesAt),
    pending: pending.map((e) => ({ eventId: e.eventId, payload: e.payload, tentativas: numero(e.tentativas) })),
    enviados: numero(bruto.enviados), rejeitados: numero(bruto.rejeitados),
    lastSentAt: numero(bruto.lastSentAt), paused: bruto.paused === true,
  };
}

function readOutbox() { return normalizar(io.readJson(ARQUIVO, null)); }

function saveOutbox(outbox) {
  try {
    io.ensureDir(path.dirname(ARQUIVO));
    io.writeJsonAtomic(ARQUIVO, outbox);
    return true;
  } catch {
    // disco cheio ou sem permissão: a reconciliação pelo cursor refaz depois
    return false;
  }
}

function texto(v) { return typeof v === 'string' ? v : ''; }

// O dia vai no fuso canônico (D7): aparelhos em fusos diferentes precisam cortar a
// janela do consolidado no mesmo lugar. A versão é a que GRAVOU a sessão; a do app que
// enfileira só vale para registro antigo sem o campo. Tipo e custo saem sempre
// preenchidos porque as regras do banco exigem os dois, e um evento recusado pelas
// regras volta como "Permission denied", que parece token vencido e travaria a fila.
function payloadFor(sessao, deviceId, farolVersion) {
  const s = sessao || {};
  return {
    at: numero(s.at), day: brasiliaDay(numero(s.at)), kind: texto(s.kind) || 'outro',
    accountHash: accountHash(s.account), refHash: prHash(s.ref) || '',
    model: texto(s.model), profileId: texto(s.profileId),
    inputTokens: numero(s.inputTokens), outputTokens: numero(s.outputTokens),
    cacheReadTokens: numero(s.cacheReadTokens), cacheCreationTokens: numero(s.cacheCreationTokens),
    costUsd: numero(s.costUsd), costSource: texto(s.costSource) || 'medido', status: texto(s.status) || 'ok',
    farolVersion: texto(s.farol) || texto(farolVersion), localId: texto(s.id),
  };
}

// A entrada é SUBSTITUÍDA por um objeto novo, nunca mutada: o envio em voo remove o
// que mandou por identidade, então a correção que chega no meio dele fica na fila.
function enqueueSession(outbox, sessao, deviceId, farolVersion) {
  if (!objeto(sessao) || !numero(sessao.at) || !deviceId) return false;
  const eventId = eventIdFor(sessao, deviceId);
  const entrada = { eventId, payload: payloadFor(sessao, deviceId, farolVersion), tentativas: 0 };
  const i = outbox.pending.findIndex((e) => e.eventId === eventId);
  if (i >= 0) outbox.pending[i] = entrada;
  else outbox.pending.push(entrada);
  outbox.cursorAt = Math.max(outbox.cursorAt, numero(sessao.at));
  return true;
}

// O cursor é o que recupera a sessão gravada no disco e perdida no caminho pra cá
// (processo morto entre um e outro): tudo depois dele entra de novo.
function reconcileFromSessions(outbox, sessions, deviceId, farolVersion) {
  const corte = outbox.cursorAt;
  const novas = (Array.isArray(sessions) ? sessions : []).filter((s) => objeto(s) && numero(s.at) > corte);
  let n = 0;
  for (const s of novas) if (enqueueSession(outbox, s, deviceId, farolVersion)) n++;
  return n;
}

// Correção de desfecho feita quando o evento não podia ser enfileirado (consolidação
// desligada, aparelho ainda sem identidade): o cursor já passou pela sessão e nunca a
// pegaria de novo. A pendência mora na própria linha (`corrigidoEm`), que é durável; aqui
// ela volta à fila com o MESMO eventId e o status atual. Segundo cursor, só de correções.
function reconcileCorrections(outbox, sessions, deviceId, farolVersion) {
  const corte = outbox.correcoesAt;
  const lista = Array.isArray(sessions) ? sessions : [];
  let n = 0;
  let maior = corte;
  for (const s of lista) {
    const quando = objeto(s) ? numero(s.corrigidoEm) : 0;
    if (quando <= corte || !enqueueSession(outbox, s, deviceId, farolVersion)) continue;
    n++;
    maior = Math.max(maior, quando);
  }
  outbox.correcoesAt = maior;
  return n;
}

// Evento que já tomou recusa sai SOZINHO: o PATCH é tudo ou nada, e um evento ruim no
// meio de um lote de 50 contaria tentativa para os 49 bons até rejeitar todos.
function loteDe(pending, batch) {
  if (pending.length && pending[0].tentativas > 0) return pending.slice(0, 1);
  return pending.slice(0, Math.max(1, batch));
}

function contarRejeicao(outbox, lote) {
  for (const e of lote) e.tentativas += 1;
  const fora = lote.filter((e) => e.tentativas >= SYNC.OUTBOX_MAX_REJEICOES);
  outbox.pending = outbox.pending.filter((e) => !fora.includes(e));
  outbox.rejeitados += fora.length;
}

async function flushOutbox(client, uid, deviceId, outbox, { batch = SYNC.OUTBOX_BATCH } = {}) {
  const lote = loteDe(outbox.pending, batch);
  if (!lote.length) return { ok: true, enviados: 0, restantes: 0 };
  const corpo = Object.fromEntries(lote.map((e) => [e.eventId, e.payload]));
  const r = await client.patch(`/users/${uid}/usageEvents/${deviceId}`, corpo);
  if (r && r.ok) {
    outbox.pending = outbox.pending.filter((e) => !lote.includes(e));
    outbox.enviados += lote.length;
    outbox.lastSentAt = Date.now();
    outbox.paused = false;
    return { ok: true, enviados: lote.length, restantes: outbox.pending.length };
  }
  const code = (r && r.code) || SYNC_CODES.FALHA_INTERNA;
  if (STATUS_DE_RECUSA.has(Number(r && r.status))) contarRejeicao(outbox, lote);
  else outbox.paused = true;
  return { ok: false, enviados: 0, restantes: outbox.pending.length, code, motivo: (r && r.motivo) || '' };
}

// Identidade do DESTINO: a conta do Firebase mais o banco. Sem a URL normalizada, a
// mesma barra a mais no fim passaria por destino novo e refaria a migração inteira.
function outboxTarget(uid, databaseUrl) {
  const u = String(uid || '').trim();
  if (!u) return '';
  return `${u}|${String(databaseUrl || '').trim().replace(/\/+$/, '')}`;
}

// O cursor quer dizer "tudo até aqui já subiu", e isso só vale PARA UM DESTINO. Trocar
// de conta do Firebase ou de banco sem zerá-lo deixaria todo o histórico que foi para o
// destino ANTIGO sem nunca chegar ao novo, e o consolidado lá nasceria pela metade.
// Reenviar é seguro: o eventId vem dos campos imutáveis da sessão, então o destino novo
// recebe cada evento uma vez só, por mais que ele suba de novo.
function retargetOutbox(outbox, destino) {
  if (!destino || outbox.destino === destino) return false;
  outbox.destino = destino;
  outbox.cursorAt = 0;
  outbox.correcoesAt = 0;
  return true;
}

function resetForFullSync(outbox) {
  outbox.cursorAt = 0;
  outbox.correcoesAt = 0;
  return outbox;
}

export default {
  outboxPath, defaultOutbox, readOutbox, saveOutbox, payloadFor, enqueueSession,
  reconcileFromSessions, reconcileCorrections, flushOutbox, resetForFullSync, outboxTarget, retargetOutbox,
};
export {
  outboxPath, defaultOutbox, readOutbox, saveOutbox, payloadFor, enqueueSession,
  reconcileFromSessions, reconcileCorrections, flushOutbox, resetForFullSync, outboxTarget, retargetOutbox,
};
