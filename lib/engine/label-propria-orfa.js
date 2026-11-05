// Label própria sem dono some sozinha (A3, 05/11/2026).
//
// O `finally` da sessão tira a `<conta>:revisando` e o labels-a-tirar.js repete a remoção que o
// GitHub não confirmou. Mas a instância que morre e não volta deixa a label no PR até alguém da
// mesma conta revisá-lo (2 h 05 num PR real). Aqui o Farol carimba, por PR, desde quando VIU a
// própria label sem sessão viva neste aparelho, sem pendência de remoção e sem lease vivo da
// conta (com a coordenação ligada). Passado o TTL do sinal (3 h, acima do teto de 2 h da sessão
// headless) com observação CONTÍNUA, a label entra no labels-a-tirar e sai pelo mesmo CAS de lease
// da pendência comum. Falta de dado nunca remove.
import path from 'node:path';
import { STATE_DIR } from '../paths.js';
import { TEMPOS } from '../constants.js';
import io, { writeJsonAtomic } from '../io.js';
import { accountHash, prHash } from '../sync/keys.js';
import { leaseVivo } from '../sync/lease.js';
import { mesmoPr, SUFIXO_REVISANDO as SUFIXO } from './review-label-target.js';
import { recusaDeIsolada } from './instancia-isolada.js';
import { limiteDaObservacao } from './relogio-da-label.js';
import labelsATirar from './labels-a-tirar.js';

const ARQUIVO = path.join(STATE_DIR, 'label-propria-vista.json');

// Arquivo `{ observadaEm, vistas }`. Carimbo com mais de 2 x TTL não sobrevive à carga: com a
// observação contínua ele já teria virado pendência, então é resto de um relógio que parou.
function carregar(engine, agora) {
  const lido = io.readJson(ARQUIVO, {}, m => engine.log?.('WARN', m));
  const vistas = lido && typeof lido.vistas === 'object' && !Array.isArray(lido.vistas) ? lido.vistas : {};
  engine.labelPropriaObservadaEm = Number(lido?.observadaEm) || 0;
  engine.labelPropriaVistaDesde = Object.fromEntries(Object.entries(vistas)
    .filter(([, v]) => Number(v) > 0 && agora - Number(v) <= 2 * TEMPOS.SINAL_REVISAO_TTL_MS));
}

function mapa(engine, agora) {
  if (!engine.labelPropriaVistaDesde || typeof engine.labelPropriaVistaDesde !== 'object') carregar(engine, agora);
  return engine.labelPropriaVistaDesde;
}

function salvar(engine) {
  try { io.ensureDir(STATE_DIR); writeJsonAtomic(ARQUIVO, { observadaEm: engine.labelPropriaObservadaEm || 0, vistas: engine.labelPropriaVistaDesde }); }
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

// A rodada anterior foi há pouco? Notebook fechado, Farol parado ou relógio que voltou quebram a
// observação: ninguém olhou a label nesse intervalo, e nesse tempo o dono dela pode ter terminado
// e aberto outra sessão no mesmo PR. Ao contrário das labels alheias, aqui o relógio RECOMEÇA
// (não pausa), porque remover a label errada cancela a sessão de outra instância.
function observacaoContinua(engine, agora) {
  const ultima = Number(engine.labelPropriaObservadaEm);
  return Number.isFinite(ultima) && ultima > 0 && agora >= ultima && agora - ultima <= limiteDaObservacao(engine);
}

// Atualiza o relógio e devolve as keys cuja label passou do TTL. Grava quando muda e, enquanto
// houver carimbo, a cada rodada (a hora da última observação precisa sobreviver ao reinício).
async function carimbarEPodar(engine, panorama, agora = Date.now()) {
  const anteriores = mapa(engine, agora);
  const m = observacaoContinua(engine, agora) ? anteriores : {};
  engine.labelPropriaObservadaEm = agora;
  const novo = {}, vencidas = [];
  for (const pr of Array.isArray(panorama) ? panorama : []) {
    if (!(await candidata(engine, pr))) continue;
    const anterior = Number(m[pr.key]);
    novo[pr.key] = Number.isFinite(anterior) && anterior > 0 ? Math.min(anterior, agora) : agora;
    if (agora - novo[pr.key] >= TEMPOS.SINAL_REVISAO_TTL_MS) vencidas.push(pr.key);
  }
  const mesmo = Object.keys(novo).length === Object.keys(anteriores).length && Object.keys(novo).every(k => anteriores[k] === novo[k]);
  engine.labelPropriaVistaDesde = novo;
  if (!mesmo || Object.keys(novo).length) salvar(engine);
  return vencidas;
}

// A vencida vira pendência do labels-a-tirar e sai pelo caminho dela, com a disputa do lease:
// entre ler o lease ausente e remover, outro aparelho da mesma conta pode ter aberto uma revisão.
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
    if (!labelsATirar.anotar(engine, alvo, label, agora, account)) continue;
    if (await labelsATirar.tirarSobPosse(engine, alvo, label, run, agora)) {
      delete engine.labelPropriaVistaDesde[key]; salvar(engine);
    }
  }
}

export default { carimbarEPodar, tirarOrfas, ARQUIVO };
export { carimbarEPodar, tirarOrfas, ARQUIVO };
