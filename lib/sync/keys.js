// Chaves que sobem para o banco da sincronização entre dispositivos. Puro: sem
// estado, sem IO, sem rede.
//
// Conta e PR sobem só como SHA-256 hex: o banco é do usuário, mas o texto legível
// de PR (org, repositório, número) não precisa sair do aparelho para coordenar, e
// hex é chave válida no RTDB sem escape nenhum.
import { createHash, randomUUID } from 'node:crypto';
import { SYNC, TEMPOS } from '../constants.js';
import { SyncError, SYNC_CODES } from './errors.js';

const TIPOS_COORDENADOS = ['review', 'self', 'pushback'];
const PR_KEY_RE = /^([^/#\s]+)\/([^/#\s]+)#(\d+)$/;
// o RTDB recusa estes caracteres em chave (e controle); 768 bytes é o teto dele
const PROIBIDO_EM_CHAVE = /[.$#[\]/\u0000-\u001f\u007f]/;
const MAX_BYTES_CHAVE = 768;
// busca da virada do dia: passo grosso de 15 min e refino de 1 min. Os fusos em
// uso têm deslocamento em minutos inteiros, então a virada cai num minuto redondo.
const PASSO_GROSSO_MS = TEMPOS.HORA_MS / 4;
const MINUTO_MS = TEMPOS.HORA_MS / 60;
// 26 horas de passos grossos: cobre o dia de 25 horas de um fuso com horário de
// verão, com folga. Sem teto, um fuso inválido giraria para sempre.
const MAX_PASSOS_GROSSOS = 26 * 4;

function sha256Hex(texto) {
  return createHash('sha256').update(String(texto)).digest('hex');
}

function accountHash(login) {
  return sha256Hex('acct:' + String(login || '').trim().toLowerCase());
}

function canonicalPrKey(key) {
  const m = PR_KEY_RE.exec(String(key || '').trim());
  if (!m) return '';
  return `${m[1].toLowerCase()}/${m[2].toLowerCase()}#${Number(m[3])}`;
}

function prHash(key) {
  const canonica = canonicalPrKey(key);
  return canonica ? sha256Hex('pr:' + canonica) : '';
}

function falhaInterna(msg) {
  return new SyncError(SYNC_CODES.FALHA_INTERNA, msg);
}

function operationFingerprint(kind, materialVersion) {
  if (!TIPOS_COORDENADOS.includes(kind)) throw falhaInterna(`tipo de operação sem coordenação: ${String(kind)}`);
  const versao = materialVersion === null || materialVersion === undefined ? '' : String(materialVersion);
  if (!versao) throw falhaInterna('versão material vazia: a coordenação exige saber o que foi analisado');
  return `${kind}_${sha256Hex(versao).slice(0, 32)}`;
}

// en-CA formata como AAAA-MM-DD; o Intl do Node traz o ICU completo, então o fuso
// nomeado resolve igual em qualquer aparelho, independente do fuso do processo.
function brasiliaDay(ms, tz = SYNC.DAY_TZ) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  return fmt.format(new Date(ms));
}

function nextBrasiliaDayStartMs(ms, tz = SYNC.DAY_TZ) {
  const hoje = brasiliaDay(ms, tz);
  let t = Math.floor(ms / MINUTO_MS) * MINUTO_MS;
  for (let i = 0; i < MAX_PASSOS_GROSSOS && brasiliaDay(t + PASSO_GROSSO_MS, tz) === hoje; i++) t += PASSO_GROSSO_MS;
  while (brasiliaDay(t + MINUTO_MS, tz) === hoje) t += MINUTO_MS;
  return t + MINUTO_MS;
}

// Só campos IMUTÁVEIS da sessão entram: o status muda na correção de desfecho e
// reenvia o MESMO evento, que é o que torna a outbox idempotente.
function eventIdFor(sessao, deviceId) {
  const s = sessao || {};
  return sha256Hex([
    deviceId, s.at, s.id || '', s.kind, s.ref || '', s.model || '',
    s.inputTokens | 0, s.outputTokens | 0, s.cacheReadTokens | 0, s.cacheCreationTokens | 0,
    Number(s.costUsd) || 0,
  ].join('|'));
}

function novoId() {
  return randomUUID();
}

function assertRtdbKey(segmento) {
  const s = String(segmento === null || segmento === undefined ? '' : segmento);
  if (!s) throw falhaInterna('segmento de caminho vazio');
  if (Buffer.byteLength(s, 'utf8') > MAX_BYTES_CHAVE) throw falhaInterna('segmento de caminho acima de 768 bytes');
  if (PROIBIDO_EM_CHAVE.test(s)) throw falhaInterna('segmento de caminho com caractere proibido pelo banco');
  return s;
}

export default {
  sha256Hex, accountHash, canonicalPrKey, prHash, operationFingerprint,
  brasiliaDay, nextBrasiliaDayStartMs, eventIdFor, novoId, assertRtdbKey,
};
export {
  sha256Hex, accountHash, canonicalPrKey, prHash, operationFingerprint,
  brasiliaDay, nextBrasiliaDayStartMs, eventIdFor, novoId, assertRtdbKey,
};
