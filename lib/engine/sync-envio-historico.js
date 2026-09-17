// Envio do histórico local existente (7.C3): ato EXPLÍCITO, medido antes, retomável.
//
// MEDIR ANTES DE PERGUNTAR. A tela mostra o que vai subir e QUANTO, e o número é medido
// cifrando de verdade em memória, nunca estimado: a estimativa de "uns 25 MB" da spec não
// é garantia. A confirmação carrega o número medido, e se o histórico mudou entre medir e
// confirmar, o envio recusa e pede medir de novo: confirmar um tamanho é confirmar AQUELE
// conteúdo.
//
// O QUE SOBE: só revisões anteriores ao marco do compartilhamento (as posteriores já sobem
// sozinhas), pela mesma porta da história (índice e corpo projetados para a tela). Nunca
// credencial, configuração inteira ou histórico bruto do CLI.
//
// RETOMÁVEL E SEM DUPLICAR. O progresso fica em `state/sync-envio.json`. O corpo é
// write-once por versão e o índice é regravado igual, então repetir o envio inteiro não
// cria nada a mais; o progresso só evita trabalho.
import path from 'node:path';
import { STATE_DIR } from '../paths.js';
import io from '../io.js';
import kek from '../sync/kek.js';
import historicoPuro from '../sync/historico.js';
import historico from './sync-historico.js';
import publicacao from './sync-publicacao.js';

const PROGRESSO = path.join(STATE_DIR, 'sync-envio.json');
const LOTE = 50;

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function anteriores(engine, marco) {
  const d = engine.decisions || {};
  const todas = [...(Array.isArray(d.resolved) ? d.resolved : [])];
  return todas.filter((x) => x && x.id && historicoPuro.tDe(x) > 0 && historicoPuro.tDe(x) < marco);
}

function lerProgresso() {
  const p = io.readJson(PROGRESSO, null);
  return objeto(p) && Array.isArray(p.feitos) ? { feitos: new Set(p.feitos), impressao: String(p.impressao || '') } : { feitos: new Set(), impressao: '' };
}

function gravarProgresso(prog) {
  try {
    io.ensureDir(path.dirname(PROGRESSO));
    io.writeJsonAtomic(PROGRESSO, { v: 1, impressao: prog.impressao, feitos: [...prog.feitos] });
    return true;
  } catch {
    // sem o arquivo, repetir o envio recomeça do zero, sem duplicar nada no banco
    return false;
  }
}

// A impressão identifica AQUELE conteúdo: ids e versões. Mudou qualquer um, é outro envio.
function impressaoDe(lista) {
  return publicacao.resumoDe(lista.map((d) => [d.id, historicoPuro.versaoDe(d)]));
}

// "lote N de M": M é o total da impressão (a lista inteira) em lotes de LOTE, e N conta o
// que já subiu nessa MESMA impressão. Envio retomado continua a contagem; impressão nova
// recomeça do primeiro lote.
function lotesDe(total) { return Math.ceil(total / LOTE); }

function medirEnvio(engine, cfg) {
  const pode = publicacao.podePublicar(engine, cfg);
  if (!pode.ok) return pode;
  const rt = engine.sync;
  const kId = kek.bufferDe(rt.material.id);
  const marco = rt.historicoDesde || (rt.historicoDesde = historico.marcoDe(Date.now()));
  const lista = anteriores(engine, marco);
  const prog = lerProgresso();
  const impressao = impressaoDe(lista);
  const pendentes = prog.impressao === impressao ? lista.filter((d) => !prog.feitos.has(d.id)) : lista;
  let bytes = 0;
  for (const d of pendentes) bytes += historico.bytesDe(engine, kId, d);
  const feitos = lista.length - pendentes.length;
  return { ok: true, categorias: { revisoes: lista.length }, pendentes: pendentes.length, bytes, impressao, lote: Math.floor(feitos / LOTE) + 1, lotes: lotesDe(lista.length) };
}

async function enviarHistorico(engine, cfg, { impressao } = {}) {
  const medida = medirEnvio(engine, cfg);
  if (!medida.ok) return medida;
  if (!impressao || impressao !== medida.impressao) {
    return { ok: false, code: 'medida-vencida', motivo: 'o histórico mudou desde a medição; meça de novo antes de confirmar', medida };
  }
  const rt = engine.sync;
  const kId = kek.bufferDe(rt.material.id);
  const prog = lerProgresso();
  if (prog.impressao !== impressao) { prog.impressao = impressao; prog.feitos = new Set(); }
  const todas = anteriores(engine, rt.historicoDesde);
  const lista = todas.filter((d) => !prog.feitos.has(d.id));
  let enviados = 0;
  for (const d of lista.slice(0, LOTE)) {
    if (!await historico.publicarUma(engine, kId, d)) break;
    prog.feitos.add(d.id);
    enviados++;
  }
  gravarProgresso(prog);
  const restantes = lista.length - enviados;
  const lote = Math.ceil((todas.length - restantes) / LOTE);
  return { ok: true, enviados, restantes, concluido: restantes === 0, lote, lotes: lotesDe(todas.length) };
}

export default { medirEnvio, enviarHistorico, LOTE };
export { medirEnvio, enviarHistorico, LOTE };
