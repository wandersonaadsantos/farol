// Transferência voluntária de uma revisão em andamento (7.C7b): o aparelho que está
// rodando entrega o trabalho a outro aparelho apto.
//
// A ORDEM IMPORTA, e é esta: conferir o destino, mandar a MEMÓRIA (checkpoint da C7a),
// encerrar a sessão daqui e só então publicar o item com preferência pelo destino. Publicar
// antes de encerrar deixaria duas sessões possíveis sobre o mesmo head; encerrar antes de
// mandar a memória jogaria fora tudo o que já tinha sido verificado.
//
// O QUE NÃO ACONTECE AQUI: nenhuma sessão é migrada, nenhum `sid` viaja e nenhum PR fica
// reservado para sempre. A preferência tem prazo, e vencido ele a colocação volta a ser a
// de sempre.
//
// A LISTA DE DESTINOS da tela (`destinosDaTransferencia`) sai das MESMAS fontes que o
// executor confere: o registro do aparelho e a capacidade cifrada que ele publica. Ela
// serve para escolher; a decisão continua sendo do aparelho de origem, na hora.
import { SYNC } from '../constants.js';
import { sharedActive } from '../sync/config.js';
import { SYNC_CODES, motivoDe } from '../sync/errors.js';
import transferencia from '../sync/transferencia.js';
import capacidade from '../sync/capacidade.js';
import kek from '../sync/kek.js';
import { prTag, acctTag, matTag } from '../sync/tags.js';
import checkpointSync from './sync-checkpoint.js';
import candidatosEng from './sync-candidatos.js';
import distribuicao from './sync-distribuicao.js';
import fechamento from './sync-fechamento.js';
import publicar from './sync-publicar.js';

const TAG_RE = /^[0-9a-f]{32}$/;

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function recusa(code, motivo) {
  return { ok: false, code, motivo: motivo || motivoDe(code) };
}

function sessaoDoPr(engine, kId, tagDoPr) {
  const vivas = engine.activeReviews instanceof Map ? engine.activeReviews : new Map();
  for (const [id, sessao] of vivas) {
    const chaves = (sessao && sessao.keys) || [];
    if (chaves.some((k) => prTag(kId, k) === tagDoPr)) return { id, sessao };
  }
  return null;
}

// A capacidade publicada por um aparelho, já aberta, na forma que a aptidão lê.
function resumoDaCapacidade(rt, dev, no) {
  const aberta = capacidade.abrirCapacidade({ uid: rt.uid, material: rt.material, dev, no });
  if (!aberta) return null;
  const c = aberta.c;
  const adm = objeto(c.admissao) ? c.admissao : { porEstado: {} };
  return {
    frescoAte: aberta.u + SYNC.FROTA_JANELA_MS,
    aceitarAdmin: c.aceitarAdmin === true,
    pausado: c.pausado === true,
    iaPronta: c.iaPronta !== false,
    token: c.token === true,
    contas: Array.isArray(c.contas) ? c.contas : [],
    teto: Math.max(1, Number(c.paralelismo) || 1),
    ocupadas: Number(adm.porEstado && adm.porEstado.reserva) + Number(adm.porEstado && adm.porEstado.execucao) || 0,
    ramLivre: String(c.ramLivre || ''),
  };
}

async function resumoDoDestino(rt, destino) {
  const lido = await publicar.lerNo(rt.client, `/users/${rt.uid}/live/deviceStatus/${destino}`);
  if (!lido || !objeto(lido.valor)) return null;
  return resumoDaCapacidade(rt, destino, lido.valor);
}

// O head da sessão viva mora na SESSÃO (runHeadlessReview grava `headSha` nela); o do
// objeto do PR fica como reserva. Sem nenhum dos dois, o comando é recusado como head
// mudado: presumir o head seria executar sobre um commit que ninguém conferiu.
function headDaSessao(sessao) {
  const s = objeto(sessao) ? sessao : {};
  return String(s.headSha || (objeto(s.pr) && s.pr.headSha) || '');
}

// Devolve o desfecho para virar recibo do comando (C6): quem pediu só sabe que deu certo
// quando este aparelho responde.
async function transferir(engine, cfg, { prTag: tagDoPr, matTag: material, destino, agora = Date.now() } = {}) {
  const rt = engine.sync;
  if (!sharedActive(cfg)) return recusa('compartilhamento-desligado', 'o compartilhamento cifrado está desligado');
  if (!rt || !rt.client || !rt.uid || !rt.material) return recusa(SYNC_CODES.SEM_CREDENCIAL, 'este aparelho não está conectado');
  const alvo = String(destino || '').trim();
  if (!alvo || alvo === rt.deviceId) return recusa('forma', 'transferir exige outro aparelho de destino');
  const kId = kek.bufferDe(rt.material.id);
  const viva = sessaoDoPr(engine, kId, tagDoPr);
  if (!viva) return recusa('nada_rodando', 'nenhuma sessão deste PR está rodando aqui');
  const pr = viva.sessao.pr || {};
  const head = headDaSessao(viva.sessao);
  if (!head || matTag(kId, head) !== material) return recusa('head_mudou', 'o head mudou desde o pedido');
  const conta = typeof engine.accountForPr === 'function' ? engine.accountForPr(pr) : '';
  const apto = transferencia.destinoApto(await resumoDoDestino(rt, alvo), { acctTag: conta ? acctTag(kId, conta) : '', agora });
  if (!apto.apto) return recusa('destino_inapto', `o destino não está apto (${apto.motivo})`);

  // 1. a memória vai primeiro: encerrar antes disso perderia o que já foi verificado
  await checkpointSync.publicarCheckpoint(engine, cfg, { prKey: pr.key, loja: viva.sessao.checkpoint || 'review', agora });
  // 2. a sessão daqui termina, e o lease sai junto com ela; a marca vem antes, para o fim
  // da sessão saber que isto é entrega, não cancelamento
  fechamento.marcarTransferida(engine, pr.key);
  const encerrada = engine.cancelSession(viva.id);
  // sessão que já tinha terminado não vai consumir a marca, e ela seguraria o fechamento
  // de uma sessão futura do mesmo PR
  if (encerrada && encerrada.ok === false) fechamento.soltarTransferida(engine, pr.key);
  // 3. o item volta para a fila do conjunto, preferindo o destino enquanto a preferência vale
  const publicado = await distribuicao.publicarCandidato(engine, cfg, { ...pr, headSha: head }, {
    agora, preferencia: { dev: alvo, ate: agora + SYNC.PREFERENCIA_TTL_MS },
  });
  if (!publicado.ok) return recusa(publicado.code || SYNC_CODES.INDISPONIVEL, 'a sessão foi encerrada, mas o item não subiu para o conjunto');
  return { ok: true, itemId: publicado.itemId, destino: alvo };
}

function nomeDe(d, id) {
  return String((objeto(d) && d.name) || id).slice(0, 40);
}

function linhaDoDestino(rt, id, ctx) {
  const aparelho = ctx.aparelhos[id];
  const motivo = transferencia.motivoDoDestino({ id, aparelho, resumo: resumoDaCapacidade(rt, id, ctx.status[id]), ...ctx.base });
  return { deviceId: id, nome: nomeDe(aparelho, id), apto: !motivo, motivo, souEu: id === rt.deviceId };
}

function porAptidaoENome(a, b) {
  return Number(b.apto) - Number(a.apto) || a.nome.localeCompare(b.nome);
}

// A lista que a tela mostra ao pedir uma transferência: cada aparelho conhecido, apto ou
// com o motivo de não estar, e a situação da origem (quem aplicaria o comando). Uma
// leitura só do banco, sob demanda: não entra no snapshot, que vai à tela a cada ciclo.
// O candidato entra no lugar do dono quando a pergunta é "quem pode INICIAR este item"
// (C6): a lista de executores possíveis é a dos publicadores, lida agora.
async function alvoDaLista(engine, { dono, itemId, agora }) {
  const origem = String(dono || '').trim();
  if (origem) return { ok: true, origem, publicadores: null, acctTagDoItem: '' };
  const c = await candidatosEng.executoresDoCandidato(engine, { itemId, agora });
  if (!c) return { ok: false };
  return { ok: true, origem: '', publicadores: c.publicadores, acctTagDoItem: c.acctTag };
}

async function destinosDaTransferencia(engine, cfg, { dono, acctTag: tagDaConta, itemId = '', agora } = {}) {
  const rt = engine.sync;
  if (!sharedActive(cfg)) return recusa('compartilhamento-desligado', 'o compartilhamento cifrado está desligado');
  if (!rt || !rt.client || !rt.uid || !rt.material) return recusa(SYNC_CODES.SEM_CREDENCIAL, 'este aparelho não está conectado');
  if (!String(dono || '').trim() && !String(itemId || '').trim()) return recusa('forma', 'falta dizer qual aparelho roda a análise, ou qual item espera colocação');
  const instante = Number(agora) || (rt.agora ? rt.agora() : Date.now());
  const alvo = await alvoDaLista(engine, { dono, itemId, agora: instante });
  if (!alvo.ok) return recusa(SYNC_CODES.INDISPONIVEL, 'não deu para ler quem publicou este item agora');
  const lido = await publicar.lerNo(rt.client, `/users/${rt.uid}/live/deviceStatus`);
  if (!lido) return recusa(SYNC_CODES.INDISPONIVEL, 'não deu para ler a capacidade dos aparelhos agora');
  const status = objeto(lido.valor) ? lido.valor : {};
  const daConta = TAG_RE.test(String(tagDaConta || '')) ? String(tagDaConta) : alvo.acctTagDoItem;
  const base = { dono: alvo.origem, acctTag: TAG_RE.test(String(daConta || '')) ? String(daConta) : '', agora: instante, publicadores: alvo.publicadores };
  const aparelhos = objeto(rt.devices) ? rt.devices : {};
  const destinos = Object.keys(aparelhos).map((id) => linhaDoDestino(rt, id, { aparelhos, status, base })).sort(porAptidaoENome);
  // sem dono não existe origem que aplique o comando: quem aplica o `iniciar` é o próprio
  // destino escolhido, e a tela não pode ler promessa de origem num objeto vazio
  if (!alvo.origem) return { ok: true, destinos, itemId: String(itemId) };
  const motivoOrigem = transferencia.motivoDaOrigem(resumoDaCapacidade(rt, alvo.origem, status[alvo.origem]), { agora: instante });
  return { ok: true, destinos, origem: { deviceId: alvo.origem, motivo: motivoOrigem } };
}

export default { transferir, resumoDoDestino, destinosDaTransferencia };
export { transferir, resumoDoDestino, destinosDaTransferencia };
