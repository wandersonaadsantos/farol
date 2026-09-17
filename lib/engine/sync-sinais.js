// Sinais do admin no relógio do andamento (7.C5, anexo S3, "Degradação e volta"):
// publicar o batimento, observar batimento e prontidão, decidir o modo e devolver ao
// escalonador local o que estava distribuindo quando a prontidão venceu.
//
// ATÉ AQUI NINGUÉM PUBLICAVA NEM OBSERVAVA O BATIMENTO: os testes injetavam o estado.
// Este módulo liga as duas pontas. A PRIMEIRA leitura de cada caminho depois de ligar o
// relógio é snapshot e não prova vida (CT-ADM-POL): até o primeiro valor que MUDA, a
// autoridade e a prontidão são desconhecidas, e desconhecida vale como indisponível.
//
// BANCO FORA NÃO É ADMIN FORA. Leitura que falha não muda nada: o estado anterior vence
// sozinho pelo relógio local. Quem segura a automação quando o banco cai é o
// `seguraAutomacao`, que continua igual.
//
// O QUE ROLA TERMINA ONDE ESTÁ. A volta só devolve o que ainda não começou
// (`engine.headlessDistribuindo`); sessão viva e lease não são tocados.
import { SYNC } from '../constants.js';
import assinatura from '../sync/assinatura.js';
import adminChave from '../sync/admin-chave.js';
import { outboxTarget } from '../sync/outbox.js';
import autoridade from '../sync/autoridade.js';
import modo from '../sync/modo-distribuicao.js';
import publicar from './sync-publicar.js';

const NO_ADMIN = 'live/control/admin';
const NO_BATIMENTO = 'live/control/beat';
const NO_PRONTIDAO = 'live/control/ready';
const INTERVALO_MS = SYNC.AUTORIDADE_INTERVALO_MS;

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function sinaisDe(rt) {
  if (!objeto(rt.sinais)) {
    rt.sinais = { conexaoEm: Date.now(), lidos: new Set(), beat: null, ready: null, modo: '', voltaPendente: false, voltando: false, ultimoBatimentoEm: 0 };
  }
  return rt.sinais;
}

function esquecerSinais(rt) {
  if (rt) rt.sinais = null;
}

async function geracaoDoAdmin(rt) {
  const admin = await publicar.lerNo(rt.client, `/users/${rt.uid}/${NO_ADMIN}`);
  if (!admin) return null;
  const v = admin.valor || {};
  return { generation: Number(v.generation) || 0, publicKey: v.publicKey || '', dev: String(v.deviceId || '') };
}

// Batimento e prontidão são o MESMO sinal em caminhos diferentes: sequência monotônica
// assinada pela chave da geração vigente. O caminho entra na assinatura, então um não
// vale no lugar do outro.
async function publicarSinal(engine, cfg, caminho, { agora }) {
  const rt = engine.sync;
  const admin = await geracaoDoAdmin(rt);
  if (!admin) return false;
  const { generation } = admin;
  const minha = adminChave.lerChaveDeAdmin();
  if (!adminChave.chaveServe(minha, { uid: rt.uid, destino: outboxTarget(rt.uid, cfg.databaseUrl), generation })) return false;
  const anterior = await publicar.lerNo(rt.client, `/users/${rt.uid}/${caminho}`);
  if (!anterior) return false;
  const sequencia = (anterior.valor ? Number(anterior.valor.sequencia) || 0 : 0) + 1;
  const valor = { dev: rt.deviceId, generation, sequencia, beatAt: agora };
  const sig = assinatura.assinar(minha.jwk, { uid: rt.uid, caminho, generation, valor });
  if (!sig) return false;
  const w = await rt.client.put(`/users/${rt.uid}/${caminho}`, { ...valor, sig }, {});
  return !!(w && w.ok);
}

// Só quem guarda a chave da geração vigente consegue assinar; os outros saem na checagem.
async function publicarBatimento(engine, cfg, { agora }) {
  const s = sinaisDe(engine.sync);
  if (agora - s.ultimoBatimentoEm < INTERVALO_MS) return false;
  const ok = await publicarSinal(engine, cfg, NO_BATIMENTO, { agora });
  if (ok) s.ultimoBatimentoEm = agora;
  return ok;
}

function publicoDe(estado, agora) {
  const fresca = autoridade.autoridadeFresca(estado, { agora, intervaloMs: INTERVALO_MS });
  return { ...estado, fresca, agora, intervaloMs: INTERVALO_MS };
}

async function lerSinal(rt, s, caminho) {
  const lido = await publicar.lerNo(rt.client, `/users/${rt.uid}/${caminho}`);
  if (!lido) return null;
  const doSnapshot = !s.lidos.has(caminho);
  s.lidos.add(caminho);
  return { valor: lido.valor, doSnapshot };
}

async function observarSinais(engine, { agora }) {
  const rt = engine.sync;
  const s = sinaisDe(rt);
  const admin = await geracaoDoAdmin(rt);
  if (!admin) return false;
  // quem é o admin vigente vai para a tela; decidir, o observador continua decidindo por assinatura
  s.admin = { dev: admin.dev, generation: admin.generation };
  const base = { uid: rt.uid, publicKey: admin.publicKey, generationVigente: admin.generation, agora, conexaoIniciadaEm: s.conexaoEm };
  const beat = await lerSinal(rt, s, NO_BATIMENTO);
  if (beat) {
    const inicial = s.beat || autoridade.novoEstadoDeAutoridade(autoridade.lerSequenciaVista());
    s.beat = autoridade.observarAutoridade(inicial, beat.valor, { ...base, caminho: NO_BATIMENTO, doSnapshot: beat.doSnapshot });
    if (s.beat.sequenciaVista !== inicial.sequenciaVista) autoridade.gravarSequenciaVista(s.beat.sequenciaVista);
  }
  const ready = await lerSinal(rt, s, NO_PRONTIDAO);
  if (ready) {
    const inicial = s.ready || autoridade.novoEstadoDeAutoridade();
    s.ready = autoridade.observarAutoridade(inicial, ready.valor, { ...base, caminho: NO_PRONTIDAO, doSnapshot: ready.doSnapshot });
  }
  if (s.beat) rt.autoridade = publicoDe(s.beat, agora);
  return true;
}

function modoAtual(engine, { agora = Date.now() } = {}) {
  const rt = engine && engine.sync;
  if (!rt || !objeto(rt.sinais)) return 'local';
  return modo.modoDe(rt.sinais.ready, { agora, intervaloMs: INTERVALO_MS });
}

function esperaReal(ms) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (t && typeof t.unref === 'function') t.unref();
  });
}

// Devolve ao ramo local um lote do que estava distribuindo. A guarda impede duas voltas
// ao mesmo tempo (o relógio não espera por ela), o atraso só vale no primeiro lote de uma
// virada, e o resto sai nos giros seguintes enquanto o modo seguir local.
async function voltarAoLocal(engine, { esperar = esperaReal, relogio = Date.now } = {}) {
  const s = sinaisDe(engine.sync);
  if (s.voltando) return { ok: false, code: 'volta-em-andamento' };
  s.voltando = true;
  try {
    if (s.voltaPendente) {
      await esperar(modo.jitterMs(engine.sync.deviceId, SYNC.VOLTA_JITTER_TETO_MS));
      s.voltaPendente = false;
    }
    // o modo é conferido DEPOIS do atraso: a prontidão pode ter voltado enquanto isso
    if (modoAtual(engine, { agora: relogio() }) !== 'local') return { ok: false, code: 'modo-distribuido' };
    const mapa = engine.headlessDistribuindo instanceof Map ? engine.headlessDistribuindo : new Map();
    const lote = modo.loteDaVolta([...mapa.values()], SYNC.VOLTA_TETO_POR_GIRO);
    for (const item of lote.agora) engine.devolverAoLocal(item.pr);
    return { ok: true, devolvidos: lote.agora.map((i) => i.pr.key), restantes: lote.depois.length };
  } finally {
    s.voltando = false;
  }
}

function temDistribuindo(engine) {
  return engine.headlessDistribuindo instanceof Map && engine.headlessDistribuindo.size > 0;
}

// Um giro: publica o batimento (se for o admin), observa, decide o modo e, se ficou local
// com coisa distribuindo, dispara a volta SEM esperar por ela.
async function cicloDosSinais(engine, cfg, { agora = Date.now(), esperar } = {}) {
  const rt = engine.sync;
  if (!rt || !rt.client || !rt.uid) return { ok: false, code: 'sem-conexao' };
  const s = sinaisDe(rt);
  await publicarBatimento(engine, cfg, { agora });
  await observarSinais(engine, { agora });
  const atual = modoAtual(engine, { agora });
  const virada = modo.transicao(s.modo, atual);
  s.modo = atual;
  if (virada === 'para-local') s.voltaPendente = true;
  if (virada && typeof engine.pushState === 'function') engine.pushState();
  const inicio = Date.now();
  const relogio = () => agora + (Date.now() - inicio);
  const volta = atual === 'local' && temDistribuindo(engine) ? voltarAoLocal(engine, { esperar, relogio }) : null;
  return { ok: true, modo: atual, virada, volta };
}

export default { publicarSinal, publicarBatimento, observarSinais, modoAtual, voltarAoLocal, cicloDosSinais, esquecerSinais, NO_BATIMENTO, NO_PRONTIDAO };
export { publicarSinal, publicarBatimento, observarSinais, modoAtual, voltarAoLocal, cicloDosSinais, esquecerSinais, NO_BATIMENTO, NO_PRONTIDAO };
