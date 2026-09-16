// Composição da sincronização entre dispositivos: o ÚNICO módulo que junta config,
// credencial, identidade do aparelho, autenticação e cliente do banco. As folhas de
// lib/sync/ não conhecem o engine; quem decide quando falar com o Firebase é aqui.
//
// Estado local continua fonte de verdade e nada aqui lança para o engine: toda falha
// vira `lastError` + status, e o tick seguinte tenta de novo. Falha de coordenação é
// ESPERA, nunca estacionamento (D11 do contrato).
//
// A rede entra pelo fetchImpl que login e start recebem e que o runtime guarda: é por
// ele que o teste troca o Firebase por dublês locais sem ler env nenhuma. Em produção
// o campo fica vazio e vale o fetch global.
import os from 'node:os';
import { APP_VERSION } from '../paths.js';
import { SYNC } from '../constants.js';
import { coordinationActive, consolidationActive, sharedActive, databaseUrlProblema, authUrlsFor } from '../sync/config.js';
import syncChave from './sync-chave.js';
import syncAdmin from './sync-admin.js';
import syncPoliticas from './sync-politicas.js';
import syncGrupo from './sync-grupo.js';
import syncAparelho from './sync-aparelho.js';
import syncLimpeza from './sync-limpeza.js';
import syncLimpar from './sync-limpar.js';
import syncRevogacao from './sync-revogacao.js';
import syncConsumoGrupo from './sync-consumo-grupo.js';
import syncAndamento from './sync-andamento.js';
import syncPendencias from './sync-pendencias.js';
import syncHistorico from './sync-historico.js';
import syncEnvio from './sync-envio-historico.js';
import { SYNC_CODES, motivoDe, falhaSemConexao } from '../sync/errors.js';
import { nextBrasiliaDayStartMs, accountHash, prHash } from '../sync/keys.js';
import { readSyncCredential, setSyncCredential, updateRefreshToken, removeSyncCredential } from '../sync/credentials.js';
import { ensureDevice, readDevice } from '../sync/device.js';
import { signInWithPassword, createTokenSource } from '../sync/auth.js';
import { createRtdbClient } from '../sync/rtdb.js';
import { atualizarPublicacaoDoRecibo } from '../sync/receipts.js';
import coordinator from '../sync/coordinator.js';
import { coberturaDePostagem } from '../sync/cobertura-postagem.js';
import syncUsage from './sync-usage.js';
import syncStream from './sync-stream.js';
import frota from '../sync/frota.js';
import { STATUS, PERMANENTES, falhaSem, avisarTela, registrarFalha, superado } from './sync-falha.js';
import syncFaxina from './sync-faxina.js';
import syncRedo from './sync-redo.js';

const TIMESTAMP_SERVIDOR = { '.sv': 'timestamp' };
const SHALLOW = { shallow: true };
const MAX_NOME = 40;
const UID_VISIVEL = 6;

function novoRuntime() {
  const rt = {
    status: STATUS.DESLIGADO, lastError: null,
    uid: '', email: '', deviceId: '', deviceName: '',
    client: null, tokenSource: null, skewMs: 0,
    devices: {}, leasesVistos: {}, leasesOutros: 0, recibosVistos: {}, espera: {},
    avisou: false, lastTickAt: 0, lastPresenceAt: 0, lastFaxinaAt: 0,
    outbox: null, stream: null,
    // internos: fetch injetado, geração da conexão (descarta resposta de conexão que
    // já foi substituída), createdAt já gravado e a promessa de start em voo
    fetchImpl: null, geracao: 0, criacaoGravada: false, assinatura: '', iniciando: null, enviandoConsumo: null,
    // código da última pausa do envio de consumo, só pra logar a transição uma vez
    erroConsumo: '',
    // CT-ENV: material de chave aberto NESTA sessão (nunca vai para a tela), se este
    // aparelho já viu o chaveiro alguma vez (é o que separa "primeiro login" de "o
    // chaveiro sumiu") e o motivo da última recusa de chave
    material: null, cur: '', chaveVista: false, chaveMotivo: '',
  };
  rt.agora = () => Date.now() + rt.skewMs;
  return rt;
}

import projecao from './sync-projecao.js';

function cfgDe(engine) { return (engine.config && engine.config.sync) || {}; }
function ligado(engine) { return cfgDe(engine).enabled === true; }
function coordenacaoAtiva(engine) { return coordinationActive(cfgDe(engine)); }
function consolidacaoAtiva(engine) { return consolidationActive(cfgDe(engine)); }

function texto(v) { return typeof v === 'string' ? v.trim() : ''; }

function nomeDoAparelho(cfg) {
  return texto(cfg.deviceName) || texto(os.hostname()).slice(0, MAX_NOME) || 'aparelho';
}

// campos que definem PARA ONDE a conexão fala; mudar qualquer um exige reconectar
function assinaturaDe(cfg) { return [cfg.apiKey || '', cfg.databaseUrl || '', cfg.projectId || ''].join('|'); }

function configIncompleta(cfg) { return !cfg.apiKey || !!databaseUrlProblema(cfg.databaseUrl); }

function fetchDe(rt) { return rt.fetchImpl || globalThis.fetch; }

function soltarConexao(rt) {
  syncStream.fecharStream(rt);
  // a visão de quem analisa em outro aparelho morre com o stream: sem ele nada a
  // recalcula, e um lease de 2 minutos ficaria na tela até a próxima conexão que
  // desse certo (uma reconexão que falha deixaria o aviso de pé por horas)
  syncStream.esquecerVisao(rt);
  rt.client = null;
  rt.tokenSource = null;
}

function limparVisao(rt) {
  Object.assign(rt, { uid: '', email: '', devices: {}, leasesVistos: {}, leasesOutros: 0, recibosVistos: {}, espera: {} });
  Object.assign(rt, { lastError: null, lastPresenceAt: 0, criacaoGravada: false, assinatura: '', avisou: false });
}

// Construtor da Engine: monta o runtime e, com o recurso ligado, só LÊ o que está no
// disco. Nunca toca rede nem cria arquivo: quem conecta é o primeiro tick.
function bootSync(engine) {
  const rt = novoRuntime();
  const cfg = cfgDe(engine);
  rt.deviceName = nomeDoAparelho(cfg);
  if (cfg.enabled !== true) return rt;
  const dev = readDevice();
  rt.deviceId = dev ? dev.deviceId : '';
  const cred = readSyncCredential();
  if (!cred) {
    rt.status = STATUS.SEM_CREDENCIAL;
    return rt;
  }
  Object.assign(rt, { uid: cred.uid, email: cred.email, status: STATUS.CONECTANDO });
  return rt;
}

// o arquivo do aparelho nasce aqui (primeira conexão), não no boot
function garantirAparelho() {
  try { return ensureDevice().deviceId; } catch { return ''; }
}

function conectar(rt, cfg, cred) {
  const tokenSource = createTokenSource({
    apiKey: cfg.apiKey, refreshToken: cred.refreshToken, fetchImpl: fetchDe(rt),
    tokenUrl: authUrlsFor(cfg.databaseUrl).tokenUrl,
    // o uid vai junto: renovação que chega depois de trocar de conta não pode gravar
    // o token da conta anterior sob o uid da nova (ver lib/sync/credentials.js).
    // O `false` é REGISTRADO: o token novo vale em memória, mas se ele não chegou ao
    // disco o próximo boot volta a usar o refresh token velho, que o securetoken já
    // rotacionou, e o aparelho cai pedindo login sem ninguém saber por quê.
    onRefresh: ({ refreshToken, uid }) => {
      const ok = updateRefreshToken(refreshToken, uid);
      if (!ok) engine.log('WARN', 'coordenação entre dispositivos: refresh token rotacionado não foi gravado; este aparelho pode pedir login de novo no próximo início');
      return ok;
    },
  });
  rt.tokenSource = tokenSource;
  rt.client = createRtdbClient({
    databaseUrl: cfg.databaseUrl, projectId: cfg.projectId,
    getIdToken: () => tokenSource.getIdToken(), fetchImpl: fetchDe(rt),
  });
}

async function iniciar(engine) {
  const rt = engine.sync;
  soltarConexao(rt);
  const geracao = ++rt.geracao;
  const cfg = cfgDe(engine);
  if (cfg.enabled !== true) {
    stopSync(engine);
    return falhaSem(SYNC_CODES.DESLIGADO);
  }
  const cred = readSyncCredential();
  if (!cred) {
    rt.status = STATUS.SEM_CREDENCIAL;
    return falhaSem(SYNC_CODES.SEM_CREDENCIAL);
  }
  if (configIncompleta(cfg)) return registrarFalha(engine, SYNC_CODES.CONFIG_INVALIDA);
  const deviceId = garantirAparelho();
  if (!deviceId) return registrarFalha(engine, SYNC_CODES.FALHA_INTERNA, 'não foi possível gravar a identidade deste aparelho');
  Object.assign(rt, { uid: cred.uid, email: cred.email, deviceId, deviceName: nomeDoAparelho(cfg), criacaoGravada: false });
  Object.assign(rt, { status: STATUS.CONECTANDO, assinatura: assinaturaDe(cfg) });
  conectar(rt, cfg, cred);
  const r = await touchPresence(engine);
  if (geracao !== rt.geracao) return superado();
  if (!r.ok) return r;
  Object.assign(rt, { status: STATUS.CONECTADO, lastError: null, avisou: false });
  // o resultado importa: lerAparelhos pode falhar e deixar o status em erro, e devolver
  // { ok: true } aqui faria o retorno e a tela dizerem coisas diferentes sobre o mesmo
  // login. A geração é conferida de novo porque houve await no meio.
  const ap = await lerAparelhos(engine);
  if (geracao !== rt.geracao) return superado();
  if (ap && ap.ok === false) return ap;
  syncStream.sincronizarStream(engine);
  avisarTela(engine);
  return { ok: true };
}

// Um start por vez: login, tick e troca de config podem pedir conexão no mesmo
// instante, e dois starts em paralelo gastariam duas renovações de token.
function startSync(engine, fetchImpl) {
  const rt = engine.sync;
  if (fetchImpl) rt.fetchImpl = fetchImpl;
  if (rt.iniciando) return rt.iniciando;
  // só limpa a própria promessa: um stop no meio pode já ter aberto outra
  const p = iniciar(engine).finally(() => { if (rt.iniciando === p) rt.iniciando = null; });
  rt.iniciando = p;
  return p;
}

// Devolve os leases que este aparelho segura, best effort. Sem isso, parar a
// sincronização (ou fechar o app) deixava cada PR preso até o TTL, com outro aparelho
// esperando por um trabalho que já tinha morrido.
// LIMITE honesto: só cobre a saída ORDENADA. Queda de energia, kill -9 ou crash do
// processo continuam dependendo do TTL do lease, que é exatamente para isso que ele existe.
function soltarLeases(rt) {
  if (!rt.handlesVivos || !rt.handlesVivos.size) return;
  for (const h of [...rt.handlesVivos]) {
    try { Promise.resolve(h.abort()).catch(() => undefined); } catch { /* handle já encerrado */ }
  }
  rt.handlesVivos.clear();
}

function stopSync(engine) {
  const rt = engine.sync;
  rt.geracao++;
  rt.iniciando = null;
  soltarLeases(rt);
  soltarConexao(rt);
  limparVisao(rt);
  syncAndamento.desligarRelogio(rt);
  rt.status = ligado(engine) ? STATUS.SEM_CREDENCIAL : STATUS.DESLIGADO;
  return true;
}

// updateSettings chama quando a chave `sync` veio no patch. Nunca rejeita: config
// salva não pode virar exceção solta por causa da rede.
function aplicarConfig(engine) {
  const rt = engine.sync;
  const cfg = cfgDe(engine);
  const nome = nomeDoAparelho(cfg);
  // nome novo sobe no próximo tick em vez de esperar a janela de presença
  if (nome !== rt.deviceName) rt.lastPresenceAt = 0;
  rt.deviceName = nome;
  // consentimento retirado descarta a política em cache: sem isto, a restrição de um
  // admin continuaria valendo depois de o dono dizer que não obedece mais a admin nenhum
  if (cfg.aceitarAdmin !== true) syncRevogacao.esquecerPoliticaAceita();
  if (cfg.enabled !== true) {
    stopSync(engine);
    return Promise.resolve({ ok: true });
  }
  // mesma conexão: só a coordenação pode ter mudado, e é ela que abre ou fecha o stream
  if (rt.status === STATUS.CONECTADO && rt.assinatura === assinaturaDe(cfg)) {
    syncStream.sincronizarStream(engine);
    return Promise.resolve({ ok: true });
  }
  return startSync(engine).catch((err) => registrarFalha(engine, SYNC_CODES.FALHA_INTERNA, err && err.message));
}

// Com o compartilhamento LIGADO a presença declara duas coisas a mais, e elas são o que
// os outros aparelhos leem para decidir se vale publicar: o contrato que este aparelho
// fala, e se a chave do conjunto está aberta AGORA. `keyReady` nunca é promessa sobre o
// futuro: anunciar chave pronta por otimismo faria outro aparelho publicar contando com um
// leitor que não consegue abrir nada. Desligado, o corpo é byte a byte o de hoje.
function presencaDe(rt, cfg) {
  const base = { name: rt.deviceName, platform: process.platform, farolVersion: APP_VERSION, lastSeenAt: TIMESTAMP_SERVIDOR };
  if (!sharedActive(cfg || {})) return base;
  return { ...base, contract: frota.CONTRATO, keyReady: !!rt.material };
}

// createdAt é escrito uma vez só (PUT condicionado a nó vazio); 412 quer dizer que
// já existe, e falha de rede fica para a próxima presença (best-effort).
async function gravarCriacao(rt, client, base) {
  const r = await client.put(`${base}/createdAt`, TIMESTAMP_SERVIDOR, { ifMatch: 'null_etag' });
  if (r.ok || r.code === SYNC_CODES.CONFLITO) rt.criacaoGravada = true;
}

async function touchPresence(engine) {
  const rt = engine.sync;
  const client = rt.client;
  if (!client || !rt.uid || !rt.deviceId) return falhaSem(SYNC_CODES.SEM_CREDENCIAL);
  const geracao = rt.geracao;
  const base = `/users/${rt.uid}/devices/${rt.deviceId}`;
  const r = await client.patch(base, presencaDe(rt, cfgDe(engine)));
  if (geracao !== rt.geracao) return superado();
  if (!r.ok) return registrarFalha(engine, r.code, r.motivo);
  // o carimbo que o servidor acabou de gravar mede o desvio do relógio local
  const visto = Number(r.data && r.data.lastSeenAt);
  if (Number.isFinite(visto) && visto > 0) rt.skewMs = visto - Date.now();
  rt.lastPresenceAt = Date.now();
  if (!rt.criacaoGravada) await gravarCriacao(rt, client, base);
  return { ok: true };
}

async function lerAparelhos(engine) {
  const rt = engine.sync;
  if (!rt.client) return falhaSem(SYNC_CODES.SEM_CREDENCIAL);
  const geracao = rt.geracao;
  const r = await rt.client.get(`/users/${rt.uid}/devices`);
  if (geracao !== rt.geracao) return superado();
  if (!r.ok) return registrarFalha(engine, r.code, r.motivo);
  rt.devices = projecao.aparelhosDe(r.data);
  return { ok: true };
}

function podarEspera(rt, agora) {
  for (const [key, e] of Object.entries(rt.espera)) if (!e || !(e.until > agora)) delete rt.espera[key];
}

function deveReconectar(rt) {
  if (rt.status === STATUS.CONECTANDO) return true;
  return rt.status === STATUS.ERRO && !(rt.lastError && PERMANENTES.has(rt.lastError.code));
}

async function tickConectado(engine) {
  const rt = engine.sync;
  // o andamento ao vivo tem relógio próprio (renova a cada 60 s, vence em 150 s), e o
  // ciclo de polling só garante que ele exista enquanto o compartilhamento estiver ligado
  if (sharedActive(cfgDe(engine))) syncAndamento.ligarRelogio(engine, cfgDe);
  else syncAndamento.desligarRelogio(rt);
  if (Date.now() - rt.lastPresenceAt < SYNC.PRESENCE_TICK_MS) return { ok: true };
  const r = await touchPresence(engine);
  if (!r.ok) return r;
  return lerAparelhos(engine);
}

// Depois de cada tick conectado a visão dos leases é refeita (lease vence sem evento
// nenhum quando o dono cai) e a faxina de retenção roda, no máximo uma vez por dia. O consumo sobe a cada tick, fora da janela de presença, e NUNCA decide o estado da
// conexão. O 401 do banco é também a regra recusando o próprio evento: tratá-lo como
// queda derrubava o status em tick sim, tick não, e cada tick em 'erro' segurava a
// revisão automática por causa de consumo, que só agrega. A falha fica na outbox
// (paused) e quem diz se o banco caiu é a presença, na janela dela. O tick devolve o
// desfecho da CONEXÃO, não o do envio.
async function depoisDoTick(engine, conexao) {
  if (!conexao.ok) return conexao;
  syncStream.sincronizarStream(engine);
  await syncUsage.flushUsage(engine);
  // A faxina NÃO é aguardada: ela varre até 200 nós, cada chamada com teto de 15 s, e o
  // check() espera este tick antes de relançar as re-revisões dos PRs com push novo.
  // Faxina de retenção pode terminar no minuto seguinte; round de revisão preso atrás
  // dela, não. A reentrada já é impedida pelo lastFaxinaAt lá dentro.
  // a promessa fica guardada (não é aguardada aqui): é o que deixa o teste e o
  // diagnóstico esperarem a faxina sem devolver o await ao caminho crítico do check()
  engine.sync.faxinaEmVoo = syncFaxina.faxinar(engine).catch(() => undefined);
  return conexao;
}

// check() chama no fim do ciclo. Desligado é custo zero; conectado carimba presença no
// máximo a cada PRESENCE_TICK_MS; erro transitório reconecta.
async function syncTick(engine) {
  const rt = engine.sync;
  if (!rt || !ligado(engine)) return { ok: true };
  rt.lastTickAt = Date.now();
  podarEspera(rt, rt.lastTickAt);
  if (rt.iniciando) return rt.iniciando;
  if (rt.status === STATUS.CONECTADO) return tickConectado(engine).then((r) => depoisDoTick(engine, r));
  if (deveReconectar(rt)) return startSync(engine);
  return { ok: true };
}

// A senha entra só no POST do login e morre aqui: não vai para arquivo, runtime,
// resultado nem log.
async function syncLogin(engine, credenciais, fetchImpl) {
  const rt = engine.sync;
  if (fetchImpl) rt.fetchImpl = fetchImpl;
  const cfg = cfgDe(engine);
  if (cfg.enabled !== true) return falhaSem(SYNC_CODES.DESLIGADO);
  if (configIncompleta(cfg)) return falhaSem(SYNC_CODES.CONFIG_INVALIDA);
  const c = credenciais || {};
  const password = typeof c.password === 'string' ? c.password : '';
  const { identityUrl } = authUrlsFor(cfg.databaseUrl);
  const r = await signInWithPassword({ apiKey: cfg.apiKey, email: texto(c.email), password, fetchImpl: fetchDe(rt), identityUrl });
  if (!r.ok) return falhaSem(r.code, r.motivo);
  if (!setSyncCredential({ uid: r.uid, email: r.email, refreshToken: r.refreshToken })) return falhaSem(SYNC_CODES.FALHA_INTERNA);
  // Um start pode estar em voo com a credencial ANTIGA (o tick reconectando, a tela
  // salvando a config). O startSync devolveria ESSA promessa, e o login voltaria ok
  // apontando para a conta de antes: a tela diria "conectado" com a conta errada. Espera
  // o start em voo acabar e começa outro, agora com a credencial nova já no disco.
  if (rt.iniciando) await rt.iniciando.catch(() => undefined);
  const s = await startSync(engine);
  if (!s.ok) return falhaSem(s.code, s.motivo);
  return { ok: true, uid: r.uid, email: r.email };
}

function syncLogout(engine) {
  removeSyncCredential();
  syncChave.esquecerChave(engine.sync);
  stopSync(engine);
  avisarTela(engine);
  return { ok: true };
}

function semConexao(engine) {
  if (!ligado(engine)) return falhaSem(SYNC_CODES.DESLIGADO);
  return falhaSemConexao(engine.sync);
}

function contarChaves(data) {
  return data && typeof data === 'object' ? Object.keys(data).length : 0;
}

async function syncTest(engine) {
  const rt = engine.sync;
  if (!ligado(engine) || !rt.client) return semConexao(engine);
  const r = await rt.client.get(`/users/${rt.uid}/devices`, SHALLOW);
  if (!r.ok) return falhaSem(r.code, r.motivo);
  return { ok: true, uid: rt.uid, devices: contarChaves(r.data) };
}

// O apagão remoto saiu na C1 (spec 7.C1): sob as regras v2 a raiz `users/{uid}` não tem
// mais concessão de escrita, então o DELETE dela é negado pelo banco. Manter o caminho
// seria oferecer um botão que o servidor recusa. Quem quer parar de usar tem "Sair deste
// aparelho" e o desligar, que continuam existindo e não apagam nada remoto.

// O motivo sai do STATUS, não só do lastError: sem login e erro de rede pedem ações
// diferentes de quem lê, e um aparelho com login nunca pode ouvir que falta login.
function motivoDoAviso(rt) {
  if (rt.status === STATUS.SEM_CREDENCIAL) return motivoDe(SYNC_CODES.SEM_CREDENCIAL);
  return (rt.lastError && rt.lastError.motivo) || motivoDe(SYNC_CODES.INDISPONIVEL);
}

// 'conectando' é o boot e a reconexão: dura até o tick seguinte e segura a automação
// (fail-closed), mas ainda não há indisponibilidade a relatar. Se a conexão falhar, o
// status vira 'erro' e o aviso sai com o motivo real, uma vez por janela.
function avisarUmaVez(engine) {
  const rt = engine.sync;
  if (rt.avisou || rt.status === STATUS.CONECTANDO) return;
  rt.avisou = true;
  const motivo = motivoDoAviso(rt);
  if (typeof engine.emit === 'function') engine.emit('toast', { kind: 'info', text: `Coordenação entre aparelhos indisponível (${motivo}): a revisão automática espera a conexão voltar.` });
}

// O filtro das automações (toReview, reReviewTargets, retryTargets). Clique manual não
// passa por aqui: quem decide o clique é o preflight.
function seguraAutomacao(engine, key) {
  if (!coordenacaoAtiva(engine)) return false;
  const rt = engine.sync;
  if (rt.status !== STATUS.CONECTADO) {
    avisarUmaVez(engine);
    return true;
  }
  const e = rt.espera[key];
  return !!(e && e.until > Date.now());
}

// O gate de runClaudeStream (via fachada syncAdmit) e o preflight do clique manual.
// A decisão inteira mora no coordenador; aqui só a porta de entrada pelo engine.
function admit(engine, ctx) { return coordinator.admit(engine, ctx); }
function preflightManual(engine, pr) { return coordinator.preflightManual(engine, pr); }
function redoReceipt(engine, key) { return syncRedo.redoReceipt(engine, key); }

// Postagem que saiu FORA da revisão automática (clique, reenvio, review já no PR) fecha
// o recibo do head como publicado. Sem isto ele ficava 'pending' para sempre e outro
// aparelho oferecia "Refazer" pago para um PR já postado. Nunca lança: o review já está
// no PR, e a falha aqui só deixa o recibo como estava.
async function syncAtualizarPublicacao(engine, dados) {
  const d = dados || {};
  if (!coordenacaoAtiva(engine)) return { ok: false, motivo: 'coordenacao-desligada' };
  const rt = engine.sync;
  if (!rt || rt.status !== STATUS.CONECTADO || !rt.client) return { ok: false, motivo: 'sem-conexao' };
  const ph = prHash(d.prKey);
  if (!ph || !d.headSha || !texto(d.account)) return { ok: false, motivo: 'contexto-incompleto' };
  const ids = { uid: rt.uid, accountHash: accountHash(d.account), prHash: ph };
  const alvo = { operationKind: d.operationKind || 'review', materialVersion: d.headSha, publicationState: d.publicationState, nowMs: rt.agora() };
  try {
    return await atualizarPublicacaoDoRecibo(rt.client, ids, alvo);
  } catch (err) {
    return { ok: false, motivo: `falha interna: ${(err && err.message) || err}` };
  }
}

// Relógio LOCAL para a espera, porque quem compara é o filtro local; só a virada do
// dia sai do relógio do servidor (o teto é compartilhado) e volta convertida.
function fimDaEspera(rt, reason) {
  const agora = Date.now();
  if (reason === 'alheio') return agora + SYNC.ESPERA_ALHEIO_MS;
  if (reason === 'esgotado') return nextBrasiliaDayStartMs(rt.agora()) - rt.skewMs;
  if (reason === 'indisponivel') return agora + SYNC.STREAM_RECONNECT_MS;
  return 0;
}

// recibo não vira espera: o coordenador já marcou o PR como visto, e esperar um
// recibo vencer seria esperar 180 dias
function registrarEspera(engine, key, admissao) {
  const a = admissao || {};
  const until = fimDaEspera(engine.sync, a.reason);
  if (!until) return null;
  const detail = a.detail && typeof a.detail === 'object' ? a.detail : {};
  engine.sync.espera[key] = { reason: a.reason, deviceName: texto(detail.deviceName), until };
  return engine.sync.espera[key];
}

// Projeção para a tela: allowlist. Nada de client, token, fetch ou credencial; o uid
// vai cortado porque a tela só precisa reconhecê-lo. O e-mail vai inteiro por exceção
// declarada: é o "Conectado como" da seção, e o snapshot é o único canal da tela. Ele
// continua fora de log, toast e resposta de rota.
// CT-COMPAT: a tela declara a conta como não coberta pela arbitragem de postagem enquanto
// algum aparelho visto estiver numa versão que não participa. Só com a coordenação ligada.
function coberturaDasContas(engine, rt, cfg) {
  if (!coordinationActive(cfg) || typeof engine.accountList !== 'function') return [];
  return engine.accountList().map((a) => coberturaDePostagem(rt.devices, a.user));
}

// Desbloqueio do aparelho que já estava logado antes da feature: ele tem refresh token e
// não tem senha, então o chaveiro só abre quando a pessoa digita a senha uma vez. A senha
// é usada aqui e descartada; nada dela vai para config, log, snapshot ou cache.
function syncUnlock(engine, dados) { return syncChave.syncUnlock(engine, cfgDe(engine), fetchDe(engine.sync), dados); }
function syncGerarChaveNova(engine, dados) { return syncChave.syncGerarChaveNova(engine, cfgDe(engine), dados); }
function syncTornarAdmin(engine, dados) { return syncAdmin.syncTornarAdmin(engine, cfgDe(engine), fetchDe(engine.sync), dados); }
function syncPublicarPolitica(engine, dados) { return syncPoliticas.syncPublicarPolitica(engine, cfgDe(engine), dados); }
function syncPublicarGrupo(engine, dados) { return syncGrupo.syncPublicarGrupo(engine, cfgDe(engine), dados); }
function vincularPerfil(engine, dados) { return syncGrupo.syncVincularPerfil(engine, dados); }
function marcarVisto(engine, dados) { return syncPendencias.marcarVisto(engine, cfgDe(engine), dados && dados.itemId); }
function recentes(engine, dados) { return syncHistorico.lerRecentes(engine, { dev: String((dados && dados.dev) || '') }); }
function abrirRevisao(engine, dados) { return syncHistorico.abrirRevisao(engine, dados && dados.reviewId); }
function medirEnvio(engine) { return syncEnvio.medirEnvio(engine, cfgDe(engine)); }
function enviarHistorico(engine, dados) { return syncEnvio.enviarHistorico(engine, cfgDe(engine), { impressao: String((dados && dados.impressao) || '') }); }
function aparelho(engine, dados) { return syncAparelho.syncAparelho(engine, cfgDe(engine), dados); }
function chaveDeLimpeza(engine, dados) { return syncLimpeza.syncChaveDeLimpeza(engine, cfgDe(engine), dados); }
function limpar(engine, dados) { return syncLimpar.syncLimpar(engine, cfgDe(engine), fetchDe(engine.sync), dados); }
function revogar(engine, dados) { return syncRevogacao.syncRevogar(engine, cfgDe(engine), fetchDe(engine.sync), dados); }
function retirarConsentimento(engine) { return syncRevogacao.retirarConsentimento(engine, cfgDe(engine)); }

function statusForUi(engine) {
  const rt = engine.sync || novoRuntime();
  const cfg = cfgDe(engine);
  const uid = rt.uid ? `${rt.uid.slice(0, UID_VISIVEL)}…` : '';
  const lastError = rt.lastError ? { ...rt.lastError } : null;
  return {
    enabled: cfg.enabled === true, coordination: coordinationActive(cfg), consolidation: consolidationActive(cfg), shared: sharedActive(cfg),
    chave: syncChave.estadoDaChave(rt, cfg),
    status: rt.status, lastError, uid, email: rt.email, deviceId: rt.deviceId, deviceName: rt.deviceName,
    devices: projecao.listaDeAparelhos(rt),
    espera: { ...rt.espera }, recibosVistos: { ...rt.recibosVistos }, leasesVistos: { ...rt.leasesVistos }, leasesOutros: rt.leasesOutros || 0,
    outbox: syncUsage.usageStatus(engine),
    coberturaPostagem: coberturaDasContas(engine, rt, cfg),
    // teto do grupo (C4b): estado, requisitos da ativação e se o orçamento é verificável
    gruposDeConsumo: syncConsumoGrupo.resumoParaTela(engine),
    // C8: tomadas forçadas, dos dois lados, com o risco declarado
    tomadas: projecao.ultimasTomadas(rt.tomadas),
    tomadasSofridas: projecao.ultimasTomadas(rt.tomadasSofridas),
    // o compartilhamento pedido e desligado pelo engine (celular sem autenticação exigida)
    bloqueioCompartilhamento: engine.syncBloqueioCompartilhamento || '',
    // C6: pedido de designação de admin esperando a senha DESTE aparelho
    designacaoAdmin: rt.designacaoAdmin ? { desde: Number(rt.designacaoAdmin.desde) || 0 } : null,
  };
}

export default {
  coordenacaoAtiva, consolidacaoAtiva, bootSync, startSync, stopSync, aplicarConfig, syncTick,
  touchPresence, syncLogin, syncLogout, syncTest, syncUnlock, syncGerarChaveNova, syncTornarAdmin, syncPublicarPolitica, syncPublicarGrupo, vincularPerfil, marcarVisto, recentes, abrirRevisao, medirEnvio, enviarHistorico, aparelho, chaveDeLimpeza, limpar, revogar, retirarConsentimento, lerAparelhos, statusForUi, seguraAutomacao, registrarEspera,
  admit, preflightManual, redoReceipt, syncAtualizarPublicacao, presencaDe,
};
export {
  coordenacaoAtiva, consolidacaoAtiva, bootSync, startSync, stopSync, aplicarConfig, syncTick,
  touchPresence, syncLogin, syncLogout, syncTest, syncUnlock, syncGerarChaveNova, syncTornarAdmin, syncPublicarPolitica, syncPublicarGrupo, vincularPerfil, marcarVisto, recentes, abrirRevisao, medirEnvio, enviarHistorico, aparelho, chaveDeLimpeza, limpar, revogar, retirarConsentimento, lerAparelhos, statusForUi, seguraAutomacao, registrarEspera,
  admit, preflightManual, redoReceipt, syncAtualizarPublicacao, presencaDe,
};
