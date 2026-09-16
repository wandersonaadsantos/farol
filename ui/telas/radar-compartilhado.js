/* Farol · UI: a visão compartilhada no Radar (brief B2, itens 2.7, 2.8, 2.9 e 2.11).

   Faixa do modo da distribuição no topo, "Precisa de você em todos os aparelhos", "Em
   outros aparelhos", comandos enviados com o recibo, revisões de todos os aparelhos e o
   envio do histórico local. O HTML mora em ui/pure/compartilhado.js e
   ui/pure/compartilhado-historico.js; aqui só mora o que toca DOM, estado() e rede.

   Os dois eventos SSE próprios (`sync-live`, `sync-pending`) chegam pelo bootstrap
   (connect(), em ui/app.js), que só repassa: quem entende o evento é esta tela.

   Tudo só aparece com a visão compartilhada VALENDO. Bloqueada pelo Farol aparece como
   bloqueada, nunca como ligada. */

import {
  andamentoAtrasadoHtml, comandoPermitido, comandosEmitidosHtml, compartilhadoBloqueioHtml,
  envioDepoisDoLote, envioHistoricoHtml, esc, modoDistribuicaoHtml, oQueELocalHtml,
  operacoesRemotasHtml, pendenciasCompartilhadasHtml, reciboFinal, revisaoAbertaHtml,
  revisoesCompartilhadasHtml, tomadaDialogo, visaoCompartilhada, acoesDaOperacao,
  tomadasFeitasHtml, transferenciaConfirmacao, transferenciaDialogo,
} from '../pure.js';
import { estado } from './estado.js';
import { $, api, confirmModal, toast } from './infra.js';
import { registrarTela } from './registro.js';

// o relógio do andamento gira a cada 10 s; a tela reavalia a idade do que mostra no mesmo passo
const ANDAMENTO_TIQUE_MS = 10000;
// recibo e lista de revisões são leitura avulsa: sem piso, cada snapshot repetiria a busca
const RECIBO_MIN_MS = 10000;
const REVISOES_MIN_MS = 60000;

const LIVE = { operacoes: [], at: 0, falhaEm: 0 };
const PEND = { pendencias: [], novas: new Set() };
const RECIBOS = { mapa: {}, falhas: new Set(), at: 0, emCurso: null };
const REVISOES = { escopo: 'todos', estado: 'inicial', revisoes: [], at: 0 };
let ENVIO = { fase: 'inicial' };

function syncAtual() { return (estado() && estado().sync) || {}; }
function cfgSyncAtual() { return (estado() && estado().config && estado().config.sync) || {}; }

/* ---------- diálogo com opções (anatomia de .modal-card, ui/app.css) ---------- */

// confirmModal só tem confirmar e cancelar; decidir precisa de duas ações e a leitura de uma
// revisão precisa só de fechar. `opcoes` vazio é um diálogo de leitura.
function escolherModal({ titulo, corpo, opcoes = [], fechar = 'Cancelar', largo = false }) {
  return new Promise((resolve) => {
    const ov = document.createElement('div');
    ov.className = 'modal-overlay';
    const botoes = opcoes.map((o) => `<button class="btn sm ${esc(o.classe || '')} md-opcao" data-valor="${esc(o.valor)}">${esc(o.rotulo)}</button>`).join('');
    ov.innerHTML = `<div class="modal-card${largo ? ' wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="mdModalTitulo">
      <div class="modal-title" id="mdModalTitulo">${esc(titulo)}</div>
      <div class="modal-body">${corpo}</div>
      <div class="modal-actions md-modal-acoes"><button class="btn sm ghost md-fechar">${esc(fechar)}</button>${botoes}</div>
    </div>`;
    document.body.appendChild(ov);
    const fecharCom = (v) => { ov.remove(); document.removeEventListener('keydown', aoTeclar); resolve(v); };
    const aoTeclar = (e) => { if (e.key === 'Escape') fecharCom(null); };
    ov.addEventListener('click', (e) => {
      if (e.target === ov || e.target.closest('.md-fechar')) return fecharCom(null);
      const b = e.target.closest('.md-opcao');
      if (b) fecharCom(b.dataset.valor);
    });
    document.addEventListener('keydown', aoTeclar);
    setTimeout(() => { const f = ov.querySelector('.md-fechar'); if (f) f.focus(); }, 30);
  });
}

/* ---------- render ---------- */

function renderPendencias(s) {
  const permissao = comandoPermitido(s);
  const alvo = $('#mdPendencias');
  alvo.innerHTML = pendenciasCompartilhadasHtml(PEND.pendencias, { novas: PEND.novas, podeComandar: permissao.pode, motivoSemComando: permissao.motivo });
  const abertas = PEND.pendencias.filter((p) => !p.visto).length;
  $('#mdPendCount').textContent = abertas;
  $('#mdPendCount').hidden = !abertas;
}

function renderOperacoes(s) {
  const permissao = comandoPermitido(s);
  $('#mdOperacoes').innerHTML = `${andamentoAtrasadoHtml(LIVE.at, Date.now(), LIVE.falhaEm)}${operacoesRemotasHtml(LIVE.operacoes, { podeComandar: permissao.pode, motivoSemComando: permissao.motivo })}`;
}

function pintarComandos(s) {
  $('#mdComandos').innerHTML = comandosEmitidosHtml(s.comandosEmitidos, RECIBOS.mapa, { devices: s.devices, deviceIdLocal: s.deviceId, falhas: RECIBOS.falhas });
}

function renderComandos(s) {
  const lista = Array.isArray(s.comandosEmitidos) ? s.comandosEmitidos : [];
  $('#mdComandosWrap').hidden = !lista.length;
  pintarComandos(s);
  atualizarRecibos(lista);
}

// Histórico das tomadas feitas por este aparelho (quadro C8): lista própria, e some vazia.
function renderTomadas(s) {
  const html = tomadasFeitasHtml(s.tomadas, s.devices, s.deviceId);
  $('#mdTomadasWrap').hidden = !html;
  $('#mdTomadas').innerHTML = html;
}

function renderHistorico(s) {
  $('#mdRevisoes').innerHTML = revisoesCompartilhadasHtml({ ...REVISOES, deviceIdLocal: s.deviceId });
  $('#mdEnvio').innerHTML = envioHistoricoHtml(ENVIO);
  $('#mdLocal').innerHTML = oQueELocalHtml();
  const velha = Date.now() - REVISOES.at > REVISOES_MIN_MS;
  if (REVISOES.estado !== 'carregando' && velha) buscarRevisoes();
}

function renderCompartilhado() {
  const s = syncAtual();
  const faixa = $('#mdFaixa');
  const topo = `${compartilhadoBloqueioHtml(s)}${modoDistribuicaoHtml(s, cfgSyncAtual())}`;
  faixa.innerHTML = topo;
  faixa.hidden = !topo;
  const ligada = visaoCompartilhada(s) === 'ligada';
  $('#mdCompartilhado').hidden = !ligada;
  $('#mdHistorico').hidden = !ligada;
  if (!ligada) return;
  renderPendencias(s);
  renderOperacoes(s);
  renderComandos(s);
  renderTomadas(s);
  renderHistorico(s);
}

/* ---------- eventos SSE próprios (entregues pelo bootstrap) ---------- */

// Com `falhaEm`, o engine avisa que a leitura falhou e manda a visão anterior: a hora da
// última leitura boa fica como estava, e a faixa diz a falha.
function aoAndamentoRemoto(d) {
  LIVE.operacoes = Array.isArray(d && d.operacoes) ? d.operacoes : [];
  LIVE.falhaEm = Number(d && d.falhaEm) || 0;
  if (!LIVE.falhaEm) LIVE.at = Date.now();
  if (visaoCompartilhada(syncAtual()) === 'ligada') renderOperacoes(syncAtual());
}

function aoPendenciasRemotas(d) {
  PEND.pendencias = Array.isArray(d && d.pendencias) ? d.pendencias : [];
  const novas = Array.isArray(d && d.novas) ? d.novas : [];
  for (const id of novas) PEND.novas.add(id);
  if (visaoCompartilhada(syncAtual()) !== 'ligada') return;
  renderPendencias(syncAtual());
  // todos os aparelhos avisam o que ninguém viu; o primeiro visto cala os outros (D3)
  if (novas.length) toast('info', novas.length === 1 ? 'Uma decisão espera por você em outro aparelho.' : `${novas.length} decisões esperam por você em outros aparelhos.`);
}

/* ---------- leituras avulsas ---------- */

async function lerRecibosAbertos(abertos) {
  for (const c of abertos) await lerRecibo(c.cmdId);
}

// Uma consulta por vez: quem chega com outra em curso espera ela terminar. `forcar` passa
// por cima do piso de tempo (é o que deixa conferir o recibo logo depois de uma ação).
async function atualizarRecibos(lista, { forcar = false } = {}) {
  if (RECIBOS.emCurso) await RECIBOS.emCurso;
  if (!forcar && Date.now() - RECIBOS.at < RECIBO_MIN_MS) return;
  const abertos = (Array.isArray(lista) ? lista : []).filter((c) => c && c.cmdId && !reciboFinal(RECIBOS.mapa[c.cmdId]));
  if (!abertos.length) return;
  RECIBOS.emCurso = lerRecibosAbertos(abertos);
  try { await RECIBOS.emCurso; } finally { RECIBOS.emCurso = null; }
  RECIBOS.at = Date.now();
  pintarComandos(syncAtual());
}

async function lerRecibo(cmdId) {
  const r = await api('/api/sync/command-status', { cmdId });
  if (!r || r.ok !== true) { RECIBOS.falhas.add(cmdId); return; }
  RECIBOS.falhas.delete(cmdId);
  if (r.recibo) RECIBOS.mapa[cmdId] = r.recibo;
}

async function buscarRevisoes() {
  const s = syncAtual();
  REVISOES.estado = 'carregando';
  REVISOES.at = Date.now();
  const r = await api('/api/sync/reviews', { dev: REVISOES.escopo === 'este' ? s.deviceId : '' });
  REVISOES.estado = r && r.ok === true ? 'lista' : 'falha';
  REVISOES.revisoes = r && Array.isArray(r.revisoes) ? r.revisoes : [];
  $('#mdRevisoes').innerHTML = revisoesCompartilhadasHtml({ ...REVISOES, deviceIdLocal: s.deviceId });
}

/* ---------- ações ---------- */

async function emitirComando(corpo, rotuloDoAlvo) {
  const r = await api('/api/sync/command', corpo);
  if (r && r.ok === true) {
    // "enviado", nunca "feito": o desfecho só existe com o recibo do alvo
    toast('info', `Comando enviado ao ${rotuloDoAlvo}. O resultado aparece quando ele responder.`);
    RECIBOS.at = 0;
    return true;
  }
  toast('error', `O comando não saiu: ${(r && (r.motivo || r.code)) || 'o engine não respondeu'}.`);
  return false;
}

async function marcarVisto(itemId) {
  const r = await api('/api/sync/seen', { itemId });
  if (!r || r.ok !== true) {
    toast('error', `Não deu para registrar o visto: ${(r && (r.motivo || r.code)) || 'o engine não respondeu'}.`);
    return false;
  }
  const item = PEND.pendencias.find((p) => p.itemId === itemId);
  if (item) item.visto = true;
  renderPendencias(syncAtual());
  return true;
}

function perguntarDecisao(aparelho) {
  return escolherModal({
    titulo: `Decidir no ${aparelho}`,
    corpo: `<p>A decisão vai como comando ao <b>${esc(aparelho)}</b>, que é o dono desta pendência. Ele confere os próprios gates antes de postar, e o resultado aparece quando ele responder.</p>`,
    opcoes: [{ valor: 'reject', rotulo: 'Pedir mudanças' }, { valor: 'approve', rotulo: 'Aprovar', classe: 'primary' }],
  });
}

async function decidirNoAparelho({ itemId, dev, aparelho }, perguntar = perguntarDecisao) {
  const acao = await perguntar(aparelho);
  if (acao !== 'approve' && acao !== 'reject') return false;
  return emitirComando({ alvo: dev, tipo: 'decidir', args: { itemId, acao } }, aparelho);
}

function operacaoPorId(opId) {
  return LIVE.operacoes.find((o) => o && o.opId === opId) || null;
}

function perguntarCancelamento(aparelho) {
  return confirmModal({
    title: `Cancelar a análise no ${aparelho}?`,
    body: `<p>O comando vai ao <b>${esc(aparelho)}</b>, que encerra a sessão daquele PR se ela ainda estiver rodando lá.</p>`,
    confirmLabel: 'Enviar o cancelamento', cancelLabel: 'Voltar', danger: true,
  });
}

async function cancelarOperacao(opId, perguntar = perguntarCancelamento) {
  const op = operacaoPorId(opId);
  if (!op || !acoesDaOperacao(op, { podeComandar: comandoPermitido(syncAtual()).pode }).cancelar.pode) return false;
  const aparelho = op.aparelho || 'outro aparelho';
  if (!await perguntar(aparelho)) return false;
  return emitirComando({ alvo: op.dev, tipo: 'cancelar', args: { prTag: op.prTag } }, aparelho);
}

// A escolha do destino: cada apto é um botão, e os inaptos ficam na lista com o motivo.
async function perguntarDestino(dialogo) {
  return escolherModal({ titulo: dialogo.titulo, corpo: dialogo.corpo, opcoes: dialogo.opcoes, fechar: dialogo.pode ? 'Cancelar' : 'Fechar', largo: true });
}

function confirmarTransferencia(texto) {
  return confirmModal({ title: texto.title, body: texto.body, confirmLabel: 'Transferir', cancelLabel: 'Voltar' });
}

function nomeDoDestinoEscolhido(resposta, deviceId, s) {
  const d = resposta.destinos.find((x) => x && x.deviceId === deviceId) || {};
  return deviceId === s.deviceId ? 'este aparelho' : (d.nome || deviceId);
}

// Destinos lidos AGORA, escolha entre os aptos, confirmação, e só então o comando ao
// aparelho que roda a análise. Escolha fora da lista de aptos não sai, venha de onde vier:
// a origem confere de novo, mas a tela não manda o que ela já sabe que seria recusado.
async function transferirOperacao(opId, escolher = perguntarDestino, confirmar = confirmarTransferencia) {
  const s = syncAtual();
  const op = operacaoPorId(opId);
  if (!op || !acoesDaOperacao(op, { podeComandar: comandoPermitido(s).pode }).transferir.pode) return false;
  const resposta = await api('/api/sync/transfer-targets', { dono: op.dev, acctTag: op.acctTag || '' });
  const dialogo = transferenciaDialogo(resposta, op);
  const destino = await escolher(dialogo);
  if (!dialogo.pode || !dialogo.aptos.includes(destino)) return false;
  const origem = op.aparelho || 'outro aparelho';
  if (!await confirmar(transferenciaConfirmacao({ origem, destino: nomeDoDestinoEscolhido(resposta, destino, s) }))) return false;
  return emitirComando({ alvo: op.dev, tipo: 'transferir', args: { prTag: op.prTag, matTag: op.matTag, destino } }, origem);
}

async function perguntarTomada(dialogo) {
  const opcoes = dialogo.pode ? [{ valor: 'tomar', rotulo: 'Tomar mesmo assim', classe: 'primary' }] : [];
  const escolha = await escolherModal({ titulo: dialogo.titulo, corpo: dialogo.corpo, opcoes, fechar: dialogo.pode ? 'Não tomar' : 'Fechar' });
  return escolha === 'tomar';
}

// O aviso vem ANTES de qualquer comando, e só a confirmação manda `confirmado: true`.
async function tomarOperacao(opId, perguntar = perguntarTomada) {
  const s = syncAtual();
  const op = operacaoPorId(opId);
  if (!op || !acoesDaOperacao(op, { podeComandar: comandoPermitido(s).pode }).tomar.pode) return false;
  const aviso = await api('/api/sync/takeover-notice', { prKey: op.pr.key, account: op.pr.account });
  const dialogo = tomadaDialogo(aviso);
  if (!await perguntar(dialogo) || !dialogo.pode) return false;
  return emitirComando({ alvo: s.deviceId, tipo: 'tomar', args: { prTag: op.prTag, matTag: op.matTag, confirmado: true } }, 'este aparelho');
}

async function abrirRevisao(reviewId) {
  const r = await api('/api/sync/review-body', { reviewId });
  const aberta = revisaoAbertaHtml(r);
  await escolherModal({ titulo: aberta.titulo, corpo: aberta.corpo, fechar: 'Fechar', largo: aberta.ok });
}

function pintarEnvio() {
  $('#mdEnvio').innerHTML = envioHistoricoHtml(ENVIO);
}

async function medirHistorico() {
  ENVIO = { fase: 'medindo' };
  pintarEnvio();
  const r = await api('/api/sync/history-measure', {});
  ENVIO = r && r.ok === true ? { fase: 'medido', medida: r } : { fase: 'falha', erro: r || { motivo: 'o engine não respondeu' } };
  pintarEnvio();
  return ENVIO;
}

// Um lote por vez, com a MESMA medida: o engine confere a impressão em cada lote.
async function enviarHistorico() {
  const medida = ENVIO.medida;
  if (!medida || !medida.impressao) return ENVIO;
  ENVIO = { fase: 'enviando', medida, parcial: ENVIO.parcial || null };
  pintarEnvio();
  while (ENVIO.fase === 'enviando') {
    const r = await api('/api/sync/history-send', { impressao: medida.impressao });
    ENVIO = envioDepoisDoLote(medida, r, ENVIO.parcial);
    pintarEnvio();
  }
  return ENVIO;
}

/* ---------- gatilhos ---------- */

function aoClicarCompartilhado(e) {
  const visto = e.target.closest('.md-visto');
  if (visto) { visto.disabled = true; marcarVisto(visto.dataset.item); return; }
  const decidir = e.target.closest('.md-decidir');
  if (decidir) { decidirNoAparelho({ itemId: decidir.dataset.item, dev: decidir.dataset.dev, aparelho: decidir.dataset.aparelho }); return; }
  const cancelar = e.target.closest('.md-cancelar');
  if (cancelar) { cancelarOperacao(cancelar.dataset.op); return; }
  const transferir = e.target.closest('.md-transferir');
  if (transferir) { transferirOperacao(transferir.dataset.op); return; }
  const tomar = e.target.closest('.md-tomar');
  if (tomar) tomarOperacao(tomar.dataset.op);
}

function aoClicarHistorico(e) {
  const escopo = e.target.closest('.md-escopo');
  if (escopo) { REVISOES.escopo = escopo.dataset.escopo; buscarRevisoes(); return; }
  const ver = e.target.closest('.md-ver-revisao');
  if (ver) { abrirRevisao(ver.dataset.review); return; }
  if (e.target.closest('.md-medir')) { medirHistorico(); return; }
  if (e.target.closest('.md-enviar')) enviarHistorico();
}

function tiqueDoAndamento() {
  if (visaoCompartilhada(syncAtual()) === 'ligada') renderOperacoes(syncAtual());
}

// Registro explícito, chamado pelo bootstrap DEPOIS do Consumo: registrar no import mudaria
// a ordem de registro que o app.js garante (ver o comentário de registrarTelaConsumo).
function registrarTelaRadarCompartilhado() {
  registrarTela({ id: 'radar-compartilhado', aoEstado: renderCompartilhado });
  $('#mdCompartilhado').addEventListener('click', aoClicarCompartilhado);
  $('#mdHistorico').addEventListener('click', aoClicarHistorico);
  const t = setInterval(tiqueDoAndamento, ANDAMENTO_TIQUE_MS);
  if (t && typeof t.unref === 'function') t.unref();
}

export {
  registrarTelaRadarCompartilhado, renderCompartilhado, aoAndamentoRemoto, aoPendenciasRemotas,
  marcarVisto, decidirNoAparelho, cancelarOperacao, transferirOperacao, tomarOperacao, medirHistorico, enviarHistorico, atualizarRecibos, buscarRevisoes,
};
