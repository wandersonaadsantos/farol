// Label própria sem dono some sozinha (A3, 05/11/2026).
//
// O `finally` da sessão tira a `<conta>:revisando` e o labels-a-tirar.js repete a remoção que o
// GitHub não confirmou. Mas a instância que morre e não volta deixa a label no PR até alguém da
// mesma conta revisá-lo (2 h 05 num PR real). Aqui o Farol carimba, por PR, desde quando VIU a
// própria label sem sessão viva neste aparelho, sem pendência de remoção e sem lease vivo da
// conta (com a coordenação ligada). Passado o TTL do sinal (3 h, acima do teto de 2 h da sessão
// headless) a label entra no labels-a-tirar e sai. Falta de dado nunca remove.
import path from 'node:path';
import { STATE_DIR } from '../paths.js';
import { TEMPOS } from '../constants.js';
import io, { writeJsonAtomic } from '../io.js';
import { accountHash, prHash } from '../sync/keys.js';
import { leaseVivo } from '../sync/lease.js';
import { mesmoPr } from './review-label-target.js';
import { recusaDeIsolada } from './instancia-isolada.js';
import labelsATirar from './labels-a-tirar.js';

const ARQUIVO = path.join(STATE_DIR, 'label-propria-vista.json');
const SUFIXO = ':revisando';

function mapa(engine) {
  if (!engine.labelPropriaVistaDesde || typeof engine.labelPropriaVistaDesde !== 'object') {
    const lido = io.readJson(ARQUIVO, {}, m => engine.log?.('WARN', m));
    engine.labelPropriaVistaDesde = lido && typeof lido === 'object' && !Array.isArray(lido) ? lido : {};
  }
  return engine.labelPropriaVistaDesde;
}

function salvar(engine) {
  try { io.ensureDir(STATE_DIR); writeJsonAtomic(ARQUIVO, engine.labelPropriaVistaDesde); }
  catch { /* best-effort: perder o relógio só reinicia a contagem */ }
}

function sessaoViva(engine, key) {
  return [...(engine.activeReviews?.values() || [])].some(s => s?.mode !== 'self' && s?.keys?.some(k => mesmoPr(k, key)));
}

function pendenciaDe(engine, key, label) {
  return Object.entries(engine.labelsATirar || {}).some(([k, i]) => mesmoPr(i?.key || k, key) && String(i?.label || '').toLowerCase() === label.toLowerCase());
}

// Só a falta de lease CONFIRMADA libera; coordenação desligada não tem lease a ler.
async function semDonoNaFrota(engine, key, conta) {
  if (!engine.syncCoordenacaoAtiva?.()) return true;
  const rt = engine.sync;
  if (rt?.status !== 'conectado' || !rt.client || !rt.uid) return false;
  const ids = { uid: rt.uid, accountHash: accountHash(conta), prHash: prHash(key) };
  if (!ids.prHash) return false;
  return (await leaseVivo(rt.client, ids, Date.now())) === false;
}

// A label própria do PR (grafia do GitHub) ou null.
function labelPropria(engine, pr) {
  const conta = String(engine.accountForPr(pr) || '').trim().toLowerCase();
  if (!conta) return null;
  return (Array.isArray(pr.labels) ? pr.labels : []).map(String).find(l => l.toLowerCase() === `${conta}${SUFIXO}`) || null;
}

async function candidata(engine, pr) {
  if (!pr?.key) return null;
  const label = labelPropria(engine, pr);
  if (!label || sessaoViva(engine, pr.key) || pendenciaDe(engine, pr.key, label)) return null;
  return (await semDonoNaFrota(engine, pr.key, label.slice(0, -SUFIXO.length))) ? label : null;
}

// Atualiza o relógio (grava só quando muda) e devolve as keys cuja label passou do TTL.
async function carimbarEPodar(engine, panorama, agora = Date.now()) {
  // Sem pausa por notebook fechado (ao contrário das labels alheias): a sessão que segurava a label
  // era DESTE aparelho e morreu com ele, então o tempo parado não a deixa mais viva.
  const m = mapa(engine);
  const novo = {}, vencidas = [];
  for (const pr of Array.isArray(panorama) ? panorama : []) {
    if (!(await candidata(engine, pr))) continue;
    const anterior = Number(m[pr.key]);
    novo[pr.key] = Number.isFinite(anterior) && anterior > 0 ? Math.min(anterior, agora) : agora;
    if (agora - novo[pr.key] >= TEMPOS.SINAL_REVISAO_TTL_MS) vencidas.push(pr.key);
  }
  const mesmo = Object.keys(novo).length === Object.keys(m).length && Object.keys(novo).every(k => m[k] === novo[k]);
  if (!mesmo) { engine.labelPropriaVistaDesde = novo; salvar(engine); }
  return vencidas;
}

async function tirarOrfas(engine, panorama, { agora = Date.now(), run } = {}) {
  if (recusaDeIsolada(engine, 'tira label')) return;
  const vencidas = await carimbarEPodar(engine, panorama, agora);
  for (const key of vencidas) {
    const pr = panorama.find(p => p?.key === key);
    const label = pr && labelPropria(engine, pr);
    if (!label) continue;
    const account = engine.accountForPr(pr);
    if (!engine.tokenFor(account)) continue;
    const alvo = { key: pr.key, url: pr.url };
    labelsATirar.anotar(engine, alvo, label, agora, account);
    if (await labelsATirar.remover(engine, alvo, label, run, account)) {
      delete engine.labelPropriaVistaDesde[key]; salvar(engine);
    }
  }
}

export default { carimbarEPodar, tirarOrfas, ARQUIVO };
export { carimbarEPodar, tirarOrfas, ARQUIVO };
