// Comandos remotos (7.C6): o admin emite, o aparelho ALVO aplica e responde com recibo.
//
// SUCESSO SÓ EXISTE COM RECIBO DO EXECUTOR. Quem emite nunca marca sucesso sozinho: o
// emissor devolve "enviado" e a tela só muda quando o recibo do alvo aparece.
//
// IDEMPOTÊNCIA POR CONSTRUÇÃO: o efeito é gravado localmente por `cmdId` ANTES de existir
// qualquer chance de repetição, e o recibo remoto é escrita única. Comando relido no giro
// seguinte (ou depois de um reinício) não repete o efeito.
//
// EXECUTOR OFFLINE não perde o comando: ele fica no banco até o TTL e, quando o aparelho
// volta, a validação inteira roda de novo, inclusive head e posse. Comando vencido não
// executa: o que era para agora não vale depois.
//
// CT-FIO: nada aqui escreve `manual` ou `requested`. O PR que sai de um comando passa por
// `comando.prDoComando`, que remove os dois.
import path from 'node:path';
import { STATE_DIR } from '../paths.js';
import { SYNC } from '../constants.js';
import io from '../io.js';
import { sharedActive } from '../sync/config.js';
import { SYNC_CODES, motivoDe } from '../sync/errors.js';
import comando from '../sync/comando.js';
import envelope from '../sync/envelope.js';
import kek from '../sync/kek.js';
import adminChave from '../sync/admin-chave.js';
import assinatura from '../sync/assinatura.js';
import { outboxTarget } from '../sync/outbox.js';
import { prTag, matTag } from '../sync/tags.js';
import { itemIdDe } from '../sync/pendencia.js';
import admissao from './admissao.js';
import publicar from './sync-publicar.js';

const NO = 'live/commands';
const NO_RECIBO = 'commandReceipts';
const CAMPO = 'comando';
const ARQUIVO = path.join(STATE_DIR, 'sync-comandos.json');
const TTL_PADRAO_MS = SYNC.COMANDO_TTL_MS;

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function recusa(code, motivo) {
  return { ok: false, code, motivo: motivo || motivoDe(code) };
}

// O que já foi feito mora em disco: reinício não pode fazer o mesmo comando agir de novo.
function lerFeitos() {
  const d = io.readJson(ARQUIVO, null);
  return objeto(d) && objeto(d.feitos) ? d.feitos : {};
}

function gravarFeito(cmdId, desfecho) {
  const feitos = { ...lerFeitos(), [cmdId]: desfecho };
  try {
    io.ensureDir(path.dirname(ARQUIVO));
    io.writeJsonAtomic(ARQUIVO, { v: 1, feitos });
    return true;
  } catch {
    // sem o arquivo o recibo remoto ainda segura a repetição; o pior caso é repetir
    // depois de perder os dois, e é por isso que o efeito só roda com o registro gravado
    return false;
  }
}

function kIdDe(rt) {
  return kek.bufferDe(rt.material.id);
}

async function lerAdmin(rt) {
  const admin = await publicar.lerNo(rt.client, `/users/${rt.uid}/live/control/admin`);
  if (!admin || !objeto(admin.valor)) return null;
  return { generation: Number(admin.valor.generation) || 0, publicKey: admin.valor.publicKey || '' };
}

// --- lado do admin ---------------------------------------------------------------------

async function emitir(engine, cfg, { alvo, tipo, args, ttlMs = TTL_PADRAO_MS, agora = Date.now() } = {}) {
  const rt = engine.sync;
  if (!sharedActive(cfg)) return recusa('compartilhamento-desligado', 'o compartilhamento cifrado está desligado');
  if (!rt || !rt.client || !rt.uid || !rt.material || !rt.cur) return recusa(SYNC_CODES.SEM_CREDENCIAL, 'este aparelho não está conectado');
  const limpo = comando.sanearComando({ tipo, args });
  if (!limpo) return recusa('forma', 'comando sem tipo conhecido ou sem os argumentos dele');
  const destino = String(alvo || '').trim();
  if (!destino) return recusa('forma', 'falta dizer para qual aparelho');
  const admin = await lerAdmin(rt);
  if (!admin) return recusa(SYNC_CODES.INDISPONIVEL, 'não deu para ler quem é o admin agora');
  const minha = adminChave.lerChaveDeAdmin();
  if (!adminChave.chaveServe(minha, { uid: rt.uid, destino: outboxTarget(rt.uid, cfg.databaseUrl), generation: admin.generation })) {
    return recusa('nao-e-admin', 'este aparelho não é o admin da geração vigente');
  }
  const cmdId = comando.novoCmdId();
  const caminho = `${NO}/${cmdId}`;
  const cifrado = envelope.cifrar({
    uid: rt.uid, caminho, campo: CAMPO, no: NO, esquema: comando.ESQUEMA,
    cur: rt.cur, material: rt.material, r: 1, dados: comando.claroDoComando({ ...limpo, issuedAt: agora }),
  });
  if (!cifrado.ok) return recusa('cifra', `não deu para cifrar o comando (${cifrado.motivo})`);
  const no = { v: 1, generation: admin.generation, alvo: destino, ttl: agora + Number(ttlMs), enc: cifrado.enc };
  const sig = assinatura.assinar(minha.jwk, { uid: rt.uid, caminho, generation: admin.generation, valor: comando.valorAssinado(no) });
  if (!sig) return recusa('assinatura', 'não deu para assinar o comando');
  const w = await rt.client.put(`/users/${rt.uid}/${caminho}`, { ...no, sig }, {});
  if (!w || !w.ok) return recusa((w && w.code) || SYNC_CODES.INDISPONIVEL, 'não deu para publicar o comando');
  return { ok: true, cmdId, estado: 'enviado' };
}

// O desfecho REAL de um comando emitido: só o recibo do alvo conta.
async function desfechoDe(engine, cmdId) {
  const rt = engine.sync;
  if (!rt || !rt.client || !rt.uid) return null;
  const r = await publicar.lerNo(rt.client, `/users/${rt.uid}/${NO_RECIBO}/${cmdId}`);
  return r && objeto(r.valor) ? r.valor : null;
}

// --- lado do executor ------------------------------------------------------------------

async function responder(rt, cmdId, desfecho) {
  const w = await rt.client.put(`/users/${rt.uid}/${NO_RECIBO}/${cmdId}`, comando.recibo({ dev: rt.deviceId, ...desfecho }), {});
  return !!(w && w.ok);
}

function prPorTag(engine, kId, tagDoPr) {
  const listas = [engine.queue, engine.panorama, engine.myPRs, engine.headlessQueue];
  for (const lista of listas) {
    const achado = (Array.isArray(lista) ? lista : []).find((pr) => pr && pr.key && prTag(kId, pr.key) === tagDoPr);
    if (achado) return achado;
  }
  return null;
}

function sessaoDoPr(engine, kId, tagDoPr) {
  const vivas = engine.activeReviews instanceof Map ? engine.activeReviews : new Map();
  for (const [id, sessao] of vivas) {
    const chaves = (sessao && sessao.keys) || [];
    if (chaves.some((k) => prTag(kId, k) === tagDoPr)) return id;
  }
  return '';
}

function cancelar(engine, kId, args) {
  const id = sessaoDoPr(engine, kId, args.prTag);
  if (!id) return { estado: 'recusado', code: 'nada_rodando' };
  engine.cancelSession(id);
  return { estado: 'aplicado' };
}

// Head confere SEMPRE: comando para head antigo é recusado, e o head atual nunca é
// presumido igual ao que o admin viu.
function repetir(engine, kId, args) {
  const pr = prPorTag(engine, kId, args.prTag);
  if (!pr) return { estado: 'recusado', code: 'nao_conheco' };
  if (!pr.headSha || matTag(kId, pr.headSha) !== args.matTag) return { estado: 'recusado', code: 'head_mudou' };
  const r = engine.enqueueHeadless(comando.prDoComando(pr));
  return r && r.ok ? { estado: 'aplicado' } : { estado: 'recusado', code: (r && r.code) || 'nao_enfileirou' };
}

// Atribuição forçada: ainda assim passa pela admissão local, como qualquer execução.
function iniciar(engine, args, agora) {
  const rt = engine.sync;
  const candidatos = rt.candidatos instanceof Map ? rt.candidatos : new Map();
  const meu = candidatos.get(`${args.prTag}_${args.matTag}`);
  if (!meu) return { estado: 'recusado', code: 'nao_publiquei' };
  const kId = kIdDe(rt);
  if (!meu.pr.headSha || matTag(kId, meu.pr.headSha) !== args.matTag) return { estado: 'recusado', code: 'head_mudou' };
  const vaga = admissao.reservar(engine, { tipo: 'review', ref: meu.pr.key, agora, grupo: engine.grupoDaConta ? engine.grupoDaConta(engine.accountForPr(meu.pr)) : '' });
  if (!vaga.ok) return { estado: 'recusado', code: vaga.motivo === 'sem-vaga' ? 'sem_vaga' : 'inapto' };
  engine.enfileirarDaDistribuicao(comando.prDoComando(meu.pr), vaga.id);
  return { estado: 'aplicado' };
}

// Decidir e postar é do DONO da pendência: payload, motivo e retry moram nele, e o dedup
// de postagem é por processo. Pendência de outro aparelho aqui é recusa, nunca postagem
// com credencial alheia.
async function decidir(engine, args) {
  const rt = engine.sync;
  const kId = kIdDe(rt);
  const pendentes = (engine.decisions && engine.decisions.pending) || [];
  const item = pendentes.find((d) => d && itemIdDe(kId, rt.deviceId, d.id) === args.itemId);
  if (!item) return { estado: 'recusado', code: 'nao_e_minha' };
  const r = await engine.decide(item.id, args.acao);
  return r && r.ok ? { estado: 'aplicado' } : { estado: 'recusado', code: (r && r.blocked) || (r && r.code) || 'nao_postou' };
}

// Designar admin não promove ninguém sozinho: ele acende o pedido, e quem promove é a
// senha digitada NESTE aparelho (syncTornarAdmin). O recibo sai quando isso acontece.
function designar(engine, cmdId, agora) {
  engine.sync.designacaoAdmin = { cmdId, desde: agora };
  if (typeof engine.pushState === 'function') engine.pushState();
  return { estado: 'pendente', code: 'espera_senha', semRecibo: true };
}

async function executar(engine, cmdId, claro, agora) {
  const rt = engine.sync;
  const kId = kIdDe(rt);
  const { tipo, args } = claro;
  if (tipo === 'cancelar') return cancelar(engine, kId, args);
  if (tipo === 'repetir') return repetir(engine, kId, args);
  if (tipo === 'iniciar') return iniciar(engine, args, agora);
  if (tipo === 'decidir') return decidir(engine, args);
  return designar(engine, cmdId, agora);
}

function abrir(rt, cmdId, no) {
  const aberto = envelope.decifrar({
    enc: no.enc, material: rt.material, uid: rt.uid, caminho: `${NO}/${cmdId}`, campo: CAMPO, esquema: comando.ESQUEMA,
  });
  if (!aberto.ok || !objeto(aberto.valor) || !objeto(aberto.valor.c)) return null;
  return comando.sanearComando(aberto.valor.c);
}

async function aplicarUm(engine, cfg, { cmdId, no, admin, agora }) {
  const rt = engine.sync;
  const pode = comando.podeAplicar(no, {
    cmdId, uid: rt.uid, dev: rt.deviceId, aceitarAdmin: cfg.aceitarAdmin === true,
    publicKey: admin.publicKey, generationVigente: admin.generation,
    fresca: !!(rt.autoridade && rt.autoridade.fresca === true), agora,
  });
  if (!pode.ok && pode.code === 'nao-e-meu') return { cmdId, code: 'nao-e-meu' };
  if (!pode.ok) {
    await responder(rt, cmdId, { estado: 'ignorado', code: pode.code, agora });
    gravarFeito(cmdId, { estado: 'ignorado', code: pode.code, at: agora });
    return { cmdId, code: pode.code };
  }
  const claro = abrir(rt, cmdId, no);
  if (!claro) {
    await responder(rt, cmdId, { estado: 'ignorado', code: 'cifra', agora });
    gravarFeito(cmdId, { estado: 'ignorado', code: 'cifra', at: agora });
    return { cmdId, code: 'cifra' };
  }
  // o registro do efeito vem ANTES de executar: um comando que roda e não consegue gravar
  // o desfecho não pode virar dois efeitos no giro seguinte
  gravarFeito(cmdId, { estado: 'executando', tipo: claro.tipo, at: agora });
  const desfecho = await executar(engine, cmdId, claro, agora);
  gravarFeito(cmdId, { estado: desfecho.estado, code: desfecho.code || '', tipo: claro.tipo, at: agora });
  if (!desfecho.semRecibo) await responder(rt, cmdId, { estado: desfecho.estado, code: desfecho.code || '', agora });
  return { cmdId, ...desfecho };
}

async function cicloDosComandos(engine, cfg, { agora = Date.now() } = {}) {
  const rt = engine.sync;
  if (!sharedActive(cfg) || !rt || !rt.client || !rt.uid || !rt.material) return { ok: false, code: 'sem-conexao' };
  const lido = await publicar.lerNo(rt.client, `/users/${rt.uid}/${NO}`);
  if (!lido) return { ok: false, code: 'sem-leitura' };
  const arvore = objeto(lido.valor) ? lido.valor : {};
  if (!Object.keys(arvore).length) return { ok: true, aplicados: [] };
  const admin = await lerAdmin(rt);
  if (!admin) return { ok: false, code: 'sem-admin' };
  const feitos = lerFeitos();
  const aplicados = [];
  for (const [cmdId, no] of Object.entries(arvore)) {
    if (feitos[cmdId]) continue;
    aplicados.push(await aplicarUm(engine, cfg, { cmdId, no, admin, agora }));
  }
  return { ok: true, aplicados: aplicados.filter((a) => a.code !== 'nao-e-meu') };
}

// Chamado quando este aparelho vira admin: fecha o pedido de designação com o recibo que
// faltava. Sem pedido pendente, não faz nada.
async function confirmarDesignacao(engine, { agora = Date.now() } = {}) {
  const rt = engine.sync;
  const pedido = rt && objeto(rt.designacaoAdmin) ? rt.designacaoAdmin : null;
  if (!pedido || !rt.client) return false;
  rt.designacaoAdmin = null;
  gravarFeito(pedido.cmdId, { estado: 'aplicado', tipo: 'designar-admin', at: agora });
  return responder(rt, pedido.cmdId, { estado: 'aplicado', code: '', agora });
}

function caminhoDosFeitos() { return ARQUIVO; }

export default { emitir, desfechoDe, cicloDosComandos, confirmarDesignacao, caminhoDosFeitos, lerFeitos, NO, NO_RECIBO, TTL_PADRAO_MS };
export { emitir, desfechoDe, cicloDosComandos, confirmarDesignacao, caminhoDosFeitos, lerFeitos, NO, NO_RECIBO, TTL_PADRAO_MS };
