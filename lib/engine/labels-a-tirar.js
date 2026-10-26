// Limpeza durável das tags de revisão, inclusive após falha de rede ou reinício.
import path from 'node:path';
import { STATE_DIR, APP_VERSION } from '../paths.js';
import io, { writeJsonAtomic } from '../io.js';
import { accountHash, prHash, novoId, canonicalPrKey } from '../sync/keys.js';
import { acquireLease, releaseLease } from '../sync/lease.js';
import { labelGerenciada, prDaUrl, mesmoPr } from './review-label-target.js';

const ARQUIVO = path.join(STATE_DIR, 'labels-a-tirar.json');
const JA_SAIU = /not found|não encontrad|does not exist/i;
function pendentes(engine) {
  if (!engine.labelsATirar) {
    const bruto = io.readJson(ARQUIVO, {}, m => engine.log('WARN', m));
    const entries = bruto && typeof bruto === 'object' && !Array.isArray(bruto) ? Object.entries(bruto) : [];
    engine.labelsATirar = Object.fromEntries(entries.filter(([id, item]) => item && (!Object.hasOwn(item, 'key') || typeof item.key === 'string') && labelGerenciada(item.label) && mesmoPr(prDaUrl(item.url)?.key, item.key || id)));
    if (Object.keys(engine.labelsATirar).length !== entries.length) engine.log('WARN', 'Pendências de remoção de tag inválidas foram ignoradas.');
  }
  return engine.labelsATirar;
}
function salvar(engine) {
  try { io.ensureDir(STATE_DIR); writeJsonAtomic(ARQUIVO, engine.labelsATirar || {}); return true; }
  catch { engine.log('WARN', 'Não foi possível salvar a pendência de remoção de tag.'); return false; }
}
function anotar(engine, pr, label, agora = Date.now(), account) {
  if (typeof pr?.key !== 'string' || !labelGerenciada(label) || !mesmoPr(prDaUrl(pr.url)?.key, pr.key)) return false;
  const p = pendentes(engine), id = `${canonicalPrKey(pr.key)}|${label.toLowerCase()}`;
  let desde = agora;
  for (const [chave, item] of Object.entries(p)) {
    if (mesmoPr(item.key || chave, pr.key) && item.label.toLowerCase() === label.toLowerCase()) { desde = Math.min(desde, Number(item.desde) || agora); delete p[chave]; }
  }
  p[id] = { key: pr.key, url: pr.url, label, account: account || label.split(':')[0], desde };
  return salvar(engine);
}
function concluir(engine, pr, label) {
  const p = pendentes(engine);
  for (const [id, item] of Object.entries(p)) {
    if (mesmoPr(item.key || id, pr.key) && item.label.toLowerCase() === label.toLowerCase()) delete p[id];
  }
  salvar(engine);
}
async function ler(engine, pr, account, run = io.run) {
  const r = await run('gh', ['pr', 'view', pr.url, '--json', 'labels'], { env: engine.ghEnv(account) });
  const value = r?.ok ? io.parseJson(r.stdout, null) : null;
  if (!Array.isArray(value?.labels) || value.labels.some(l => typeof l?.name !== 'string')) return null;
  return value.labels.map(l => l.name);
}
async function ausenciaConfirmada(engine, pr, label, account, run, response) {
  if (!JA_SAIU.test(String(response?.stderr || ''))) return false;
  const labels = await ler(engine, pr, account, run);
  return !!labels && !labels.some(l => l.toLowerCase() === label.toLowerCase());
}
async function remover(engine, pr, label, run = io.run, account = engine.accountForPr(pr)) {
  if (!label) return true;
  try {
    const r = await run('gh', ['pr', 'edit', pr.url, '--remove-label', label], { env: engine.ghEnv(account) });
    if (r?.ok || await ausenciaConfirmada(engine, pr, label, account, run, r)) { concluir(engine, pr, label); return true; }
  } catch { /* A pendência permanece até uma remoção confirmada. */ }
  engine.log('WARN', `label ${label} não saiu de ${pr.key}; tento de novo no próximo ciclo`);
  anotar(engine, pr, label, Date.now(), account);
  return false;
}
function revisandoAqui(engine, key) {
  return [...(engine.activeReviews?.values() || [])].some(s => s?.mode !== 'self' && s?.keys?.some(k => mesmoPr(k, key)));
}
// O CAS impede a limpeza atrasada de apagar a tag de uma revisão que outro aparelho iniciou.
async function reservar(engine, key, labelOwner, agora) {
  if (!engine.syncCoordenacaoAtiva?.()) return async () => {};
  const rt = engine.sync;
  if (rt?.status !== 'conectado' || !rt.client || !rt.uid || !rt.deviceId) return null;
  const ids = { uid: rt.uid, accountHash: accountHash(labelOwner), prHash: prHash(key) }, leaseId = novoId();
  if (!ids.prHash) return null;
  const r = await acquireLease(rt.client, ids, { leaseId, deviceId: rt.deviceId, operationKind: 'post', headSha: '', nowMs: agora, farolVersion: APP_VERSION });
  return r.ok ? () => releaseLease(rt.client, ids, { leaseId }) : null;
}
async function soltarReserva(soltar, engine, key) {
  if (!soltar) return;
  try { const result = await soltar(); if (result?.ok === false) engine.log('WARN', `Posse da limpeza de ${key} aguarda expiração.`); }
  catch { engine.log('WARN', `Posse da limpeza de ${key} aguarda expiração.`); }
}
async function tirarPendentes(engine, run = io.run, agora) {
  for (const [id, item] of Object.entries(pendentes(engine))) {
    const key = item.key || id;
    if (revisandoAqui(engine, key)) continue;
    const pr = { key, url: item.url };
    const account = item.account || item.label.split(':')[0];
    if (!engine.tokenFor(account)) continue;
    let soltar;
    try {
      soltar = await reservar(engine, key, item.label.split(':')[0], agora ?? Date.now());
      if (soltar && pendentes(engine)[id] === item && !revisandoAqui(engine, key)) await remover(engine, pr, item.label, run, account);
    } catch { engine.log('WARN', `Limpeza da tag de ${key} adiada; não foi possível confirmar a posse.`); }
    finally { await soltarReserva(soltar, engine, key); }
  }
}
const labelsATirar = { anotar, concluir, ler, remover, tirarPendentes, ARQUIVO };
export default labelsATirar;
export { anotar, concluir, ler, remover, tirarPendentes, ARQUIVO };
