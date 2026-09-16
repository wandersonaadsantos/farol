// Contrato das telas da sincronização (brief B2, seção 5): o que a interface lê e aciona e
// que ainda não tinha caminho. Nada aqui é funcionalidade nova: cada função expõe, com
// allowlist, algo que o engine já decide.
//
// PROJEÇÃO NÃO É FONTE. Os valores saem do runtime já saneado; a tela não recalcula regra
// nenhuma a partir deles. E o que é lido sob demanda (recibo de comando, lease para o aviso
// da tomada, chave de limpeza) sai como leitura avulsa, sem entrar no snapshot, que vai para
// a tela a cada ciclo.
import { sharedActive } from '../sync/config.js';
import { SYNC_CODES, motivoDe } from '../sync/errors.js';
import { accountHash, prHash } from '../sync/keys.js';
import { leasePath } from '../sync/lease.js';
import tomada from '../sync/tomada.js';
import limpezaLista from '../sync/limpeza.js';
import vinculo from '../sync/vinculo.js';
import { POSTAGEM_COORDENADA_DESDE } from '../sync/cobertura-postagem.js';
import admissao from './admissao.js';
import comandos from './sync-comandos.js';
import limpeza from './sync-limpeza.js';
import publicar from './sync-publicar.js';
import politicas from './sync-politicas.js';

const MAX_EMITIDOS = 20;

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function recusa(code, motivo) {
  return { ok: false, code, motivo: motivo || motivoDe(code) };
}

// --- projeções para o snapshot --------------------------------------------------------

function adminParaTela(rt) {
  const sinais = objeto(rt.sinais) ? rt.sinais : {};
  const admin = objeto(sinais.admin) ? sinais.admin : null;
  if (!admin || !admin.dev) return null;
  return {
    deviceId: String(admin.dev), generation: Number(admin.generation) || 0,
    souEu: String(admin.dev) === String(rt.deviceId || ''),
    fresca: !!(rt.autoridade && rt.autoridade.fresca === true),
    // o instante LOCAL em que este aparelho viu o último batimento fresco (0: nenhum desde
    // que conectou). É o que deixa a tela dizer "sem batimento há X" sem inventar duração.
    ultimoBatimentoEm: Number(rt.autoridade && rt.autoridade.ultimaMudancaEm) || 0,
  };
}

function distribuicaoParaTela(engine) {
  const rt = engine.sync || {};
  const sinais = objeto(rt.sinais) ? rt.sinais : {};
  const mapa = engine.headlessDistribuindo instanceof Map ? engine.headlessDistribuindo : new Map();
  return {
    modo: String(sinais.modo || ''),
    esperando: [...mapa.values()].map((x) => ({ key: String(x.pr && x.pr.key || ''), desde: Number(x.desde) || 0 })).filter((x) => x.key),
  };
}

// Ocupação deste aparelho como a admissão local enxerga, sem referência de PR.
function admissaoParaTela(engine) {
  if (!admissao.ativa(engine)) return null;
  const r = admissao.resumo(engine);
  const politica = admissao.politicaDoAparelho(engine);
  return {
    ocupadas: r.total, porEstado: r.porEstado, porTipo: r.porTipo,
    teto: Math.max(1, Number(politica.tetoParalelismo) || 1), pausado: politica.pausado === true,
  };
}

function emitidosParaTela(rt) {
  return Array.isArray(rt.comandosEmitidos) ? rt.comandosEmitidos.slice(0, MAX_EMITIDOS) : [];
}

// --- ações e leituras avulsas ---------------------------------------------------------

// Guarda o comando emitido para a tela listar; o DESFECHO continua vindo só do recibo.
function cfgDe(engine) {
  return (engine.config && engine.config.sync) || {};
}

async function emitirComando(engine, dados) {
  const r = await comandos.emitir(engine, cfgDe(engine), dados);
  if (!r.ok) return r;
  const rt = engine.sync;
  if (!Array.isArray(rt.comandosEmitidos)) rt.comandosEmitidos = [];
  rt.comandosEmitidos.unshift({ cmdId: r.cmdId, tipo: String(dados && dados.tipo || ''), alvo: String(dados && dados.alvo || ''), at: Date.now(), vence: Number(r.vence) || 0 });
  if (rt.comandosEmitidos.length > MAX_EMITIDOS) rt.comandosEmitidos.length = MAX_EMITIDOS;
  if (typeof engine.pushState === 'function') engine.pushState();
  return r;
}

async function desfechoDoComando(engine, dados) {
  const id = String((dados && dados.cmdId) || '');
  if (!/^[0-9a-f]{32}$/.test(id)) return recusa('forma', 'identificador de comando inválido');
  const recibo = await comandos.desfechoDe(engine, id);
  return { ok: true, recibo: objeto(recibo) ? { dev: String(recibo.dev || ''), estado: String(recibo.estado || ''), code: String(recibo.code || ''), at: Number(recibo.at) || 0 } : null };
}

// O aviso que o computador mostra ANTES de confirmar uma tomada. Lê o lease do PR agora;
// sem lease vivo de outro aparelho, não há o que tomar, e a resposta diz isso.
async function avisoDaTomada(engine, dados) {
  const { prKey, account } = dados || {};
  const rt = engine.sync;
  if (!rt || !rt.client || !rt.uid) return recusa(SYNC_CODES.SEM_CREDENCIAL, 'este aparelho não está conectado');
  const ph = prHash(String(prKey || ''));
  const conta = String(account || '').trim();
  if (!ph || !conta) return recusa('forma', 'falta dizer o PR e a conta');
  const lido = await rt.client.get(leasePath(rt.uid, accountHash(conta), ph));
  if (!lido || !lido.ok) return recusa((lido && lido.code) || SYNC_CODES.INDISPONIVEL, 'não deu para ler quem está com este PR agora');
  const agora = rt.agora ? rt.agora() : Date.now();
  const pode = tomada.podeTomar(lido.data, { nowMs: agora, deviceId: rt.deviceId });
  if (!pode.pode) return { ok: true, podeTomar: false, motivo: pode.motivo, aviso: '' };
  const dono = objeto(rt.devices) && objeto(rt.devices[lido.data.deviceId]) ? rt.devices[lido.data.deviceId].name : '';
  return {
    ok: true, podeTomar: true, motivo: '', dono: String(lido.data.deviceId || ''),
    risco: tomada.riscoDeDuplicidade(lido.data, { nowMs: agora }),
    aviso: tomada.avisoDaTomada(lido.data, { nowMs: agora, nomeDoAparelho: dono }),
  };
}

// A trava do ato vive no banco (lib/engine/sync-limpar.js); viva, ela é "limpeza em
// andamento", com o prazo que a própria trava carrega.
function travaParaTela(lido) {
  const trava = lido && objeto(lido.valor) ? lido.valor : null;
  if (!limpezaLista.travaViva(trava, Date.now())) return null;
  return { dev: String(trava.dev || ''), ate: Number(trava.x) || 0 };
}

// As duas listas saem da MESMA fonte que a limpeza usa (lib/sync/limpeza.js): a tela não
// repete nenhuma delas.
function listasDaLimpeza() {
  return { categorias: [...limpezaLista.CATEGORIAS], nuncaApagadas: [...limpezaLista.PROIBIDOS] };
}

// Estado da chave de limpeza como o banco diz agora, pela mesma conferência que a limpeza usa.
async function estadoDaLimpeza(engine) {
  if (!sharedActive(cfgDe(engine))) return { ok: true, estado: 'compartilhamento-desligado' };
  const rt = engine.sync;
  if (!rt || !rt.client || !rt.uid) return recusa(SYNC_CODES.SEM_CREDENCIAL, 'este aparelho não está conectado');
  const [no, admin, trava] = await Promise.all([
    publicar.lerNo(rt.client, `/users/${rt.uid}/live/control/cleanup`),
    publicar.lerNo(rt.client, `/users/${rt.uid}/live/control/admin`),
    publicar.lerNo(rt.client, `/users/${rt.uid}/live/control/cleanupLock`),
  ]);
  if (!no || !admin || !trava) return recusa(SYNC_CODES.INDISPONIVEL, 'não deu para ler a chave de limpeza agora');
  const comum = { ...listasDaLimpeza(), travada: travaParaTela(trava) };
  if (!objeto(no.valor)) return { ok: true, estado: 'desligada', ...comum };
  const ligada = limpeza.chaveDeLimpezaLigada(engine, { no: no.valor, admin: admin.valor, autoridade: rt.autoridade });
  return { ok: true, estado: ligada ? 'ligada' : 'desligada-ou-nao-verificavel', ...comum };
}

// C6: o pedido de designação também se recusa aqui, e a recusa vira recibo.
function recusarDesignacao(engine) {
  return comandos.recusarDesignacao(engine);
}

// A política vigente no banco para um aparelho, para o formulário do admin abrir com ela.
function lerPolitica(engine, dados) {
  return politicas.lerPoliticaPublicada(engine, cfgDe(engine), dados);
}

// Vínculos são LOCAIS (state/sync-vinculos.json): o perfil vinculado a um grupo que ainda
// não chegou aqui continua vinculado, e a tela precisa saber disso.
function vinculosParaTela() {
  const saida = {};
  for (const [perfil, v] of Object.entries(vinculo.lerVinculos())) saida[perfil] = { grupo: v.grupo, tipo: v.tipo, desde: v.desde };
  return saida;
}

// O que o snapshot da sincronização ganha para as telas, num objeto só.
function projecaoDasTelas(engine) {
  const rt = engine.sync || {};
  const admin = adminParaTela(rt);
  // sem admin conhecido o campo NÃO existe: a tela não pode ler promessa de autoridade
  // num objeto vazio (test/sync-admin-desligado.test.js)
  return {
    ...(admin ? { admin } : {}),
    distribuicao: distribuicaoParaTela(engine),
    admissao: admissaoParaTela(engine),
    comandosEmitidos: emitidosParaTela(rt),
    versaoPostagemCoordenada: POSTAGEM_COORDENADA_DESDE,
    vinculosDePerfis: vinculosParaTela(),
  };
}

export default { projecaoDasTelas, adminParaTela, distribuicaoParaTela, admissaoParaTela, emitidosParaTela, emitirComando, desfechoDoComando, avisoDaTomada, estadoDaLimpeza, recusarDesignacao, lerPolitica };
export { projecaoDasTelas, adminParaTela, distribuicaoParaTela, admissaoParaTela, emitidosParaTela, emitirComando, desfechoDoComando, avisoDaTomada, estadoDaLimpeza, recusarDesignacao, lerPolitica };
