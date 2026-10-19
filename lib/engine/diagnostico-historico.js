// Só fatos estruturados do histórico local. Texto livre do log nunca viaja.
import path from 'node:path';
import io from '../io.js';
import { STATE_DIR } from '../paths.js';
import { tailLog } from '../workspace.js';
import { classify, parseLine } from '../log-taxonomy.js';

const LIMITE = 60;
const LINHAS = 1000;
const KEY = '[\\w.-]+/[\\w.-]+#\\d+';
const RELANCADA = new RegExp(`^(${KEY}): busca da prova relançada no head ([a-f0-9]+)`, 'i');
const FALHA = new RegExp(`^revisao(?: autonoma)? (${KEY})(?: |:)`, 'i');
const ORFA = new RegExp(`^label ([a-z0-9-]+):revisando tinha ficado presa em (${KEY})`, 'i');
const PR_PROPRIO = new RegExp(`^(${KEY}): espera automática largada, o PR é da própria conta`, 'i');

function eventoDaLinha(linha) {
  const p = parseLine(linha);
  if (!p) return [];
  const base = { quando: p.ts, fuso: /^\[[^\]]* ([+-]\d{2}:\d{2})\]/.exec(linha)?.[1] || '' };
  const relancada = RELANCADA.exec(p.msg);
  if (relancada) return [{ ...base, key: relancada[1], evento: 'busca-prova-relancada', head: relancada[2].slice(0, 40) }];
  const falha = FALHA.exec(p.msg);
  if (falha) return [{ ...base, key: falha[1], evento: 'falha-revisao', classe: classify(p.msg).id }];
  const orfa = ORFA.exec(p.msg);
  if (orfa) return [{ ...base, key: orfa[2], evento: 'label-orfa-removida', account: orfa[1] }];
  const propria = PR_PROPRIO.exec(p.msg);
  if (propria) return [{ ...base, key: propria[1], evento: 'espera-pr-proprio-largada' }];
  if (!p.msg.startsWith('app reiniciado com revisão em andamento: ')) return [];
  return [...p.msg.matchAll(new RegExp(KEY, 'g'))].map(m => ({ ...base, key: m[0], evento: 'boot-revisao-recuperada' }));
}

function identificador(v) { return /^[\w-]{1,80}$/.test(String(v || '')) ? String(v) : ''; }

function historicoDaIdentidade(aceita) {
  const rastros = tailLog(LINHAS).flatMap(eventoDaLinha).filter(e => aceita(e.key));
  const eventos = rastros.slice(-LIMITE);
  const dado = io.readJson(path.join(STATE_DIR, 'falhas-sessao.json'), {});
  const registros = Array.isArray(dado?.falhas) ? dado.falhas : [];
  const relacionadas = registros.filter(f => f && aceita(String(f.ref || '')));
  const falhas = relacionadas.slice(-LIMITE).map(f => ({
    key: String(f.ref), at: Number(f.at) || 0, account: identificador(f.account),
    sessao: identificador(f.sessionId), sessaoCli: identificador(f.cliSessionId),
    classe: identificador(f.classe), retomada: ['retomada', 'recusada', 'nova', 'nenhuma'].includes(f.resumeOutcome) ? f.resumeOutcome : '',
  }));
  return { eventos, falhas, logUltimasLinhas: LINHAS, omitidos: { eventos: rastros.length - eventos.length, falhas: relacionadas.length - falhas.length } };
}

export { historicoDaIdentidade };
