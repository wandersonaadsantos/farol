/* Farol · UI: Radar > Aparelhos, o controle dos executores pelo admin (28/09/2026).

   Desenho: docs/superpowers/specs/2026-09-28-controle-do-celular-anexos/HANDOFF-claude-design.md.
   Uma página por aparelho: painel, fila (com pendências e sessões ao vivo dele), contas
   editáveis à distância e os comandos enviados. Em Pra mim, o resumo "Seus aparelhos".

   Os dados vêm de três lugares que já existiam: o snapshot (`sync.paineis`, `sync.devices`,
   `sync.comandosEmitidos`), as listas remotas (telas/listas-remotas.js, com a `fila` de cada
   PR) e o andamento e as pendências (telas/radar-compartilhado.js). As ações de pendência e
   de sessão reusam os gatilhos de lá (md-decidir, md-cancelar, md-transferir,
   md-review-completo); aqui nascem só os comandos da fila, das contas e da política.

   O HTML mora em ui/pure/aparelhos-fila.js e ui/pure/aparelhos-painel.js. */

import {
  comandoPermitido, comandosDoAparelhoHtml, confirmacaoAutomatica, contagemDaFila, contasDoAparelhoHtml,
  executoresDoConjunto, faixaDeAparelhosHtml, filaDoAparelhoHtml, itensDaFila, ligaAutomatico,
  motivoSemAcao, nenhumExecutorHtml, painelDoAparelhoHtml, avisoDoAparelhoHtml, retornoDoComando,
  seusAparelhosHtml, situacaoDaFila, situacaoDoAparelho, versaoAntiga, visaoCompartilhada, secoesDaFrota,
  aparelhoPoliticaParaPublicar, andamentoAtrasadoHtml,
} from '../pure.js';
import { estado } from './estado.js';
import { $, api, confirmModal, toast } from './infra.js';
import { registrarTela } from './registro.js';
import { dadosDasListas } from './listas-remotas.js';
import { dadosDoConjunto, emitirComando, aoMudarConjunto, aoClicarCompartilhado } from './radar-compartilhado.js';
import { lerPoliticaAtual, publicarPolitica } from './sistema-aparelhos.js';

const APAR = { selecionado: '', filtro: 'tudo', aoVivo: new Set() };

async function alternarEspelho(opId) {
  const aberto = !APAR.aoVivo.has(opId);
  if (aberto) APAR.aoVivo.add(opId); else APAR.aoVivo.delete(opId);
  renderAparelhos();
  const r = await api('/api/sync/mirror', { opId, aberto });
  if (aberto && !r?.ok) {
    APAR.aoVivo.delete(opId);
    toast('Não foi possível abrir o espelho. Confira se a sessão e a conexão continuam ativas.', 'error');
    renderAparelhos();
  }
}


function syncAtual() { return (estado() && estado().sync) || {}; }
// a última release que ESTE Farol conhece (a do GitHub, ou a dele mesmo sem nada mais novo)
function ultimaVersaoConhecida() {
  const u = (estado() && estado().update) || {};
  return u.sourceVersion || u.current || '';
}

function ligada(s) {
  return visaoCompartilhada(s) === 'ligada' && secoesDaFrota(s);
}

function fontes() {
  const c = dadosDoConjunto();
  return { listas: dadosDasListas(), pendencias: c.pendencias, operacoes: c.operacoes };
}

// Aparelho com operação na última leitura BOA do andamento está vivo naquele instante: o
// andamento renova a cada 60 s, bem mais que a presença (5 min).
function sinaisAoVivo() {
  const c = dadosDoConjunto();
  if (c.andamentoFalhaEm || !c.andamentoEm) return {};
  return Object.fromEntries((c.operacoes || []).filter((o) => o && o.dev).map((o) => [o.dev, c.andamentoEm]));
}

function selecionado(executores) {
  if (!executores.some((a) => a.deviceId === APAR.selecionado)) APAR.selecionado = executores.length ? executores[0].deviceId : '';
  return executores.find((a) => a.deviceId === APAR.selecionado) || null;
}

// O retorno de um comando na linha do PR, e se ele ainda espera o aparelho.
function retornosDo(dev, s) {
  const recibos = dadosDoConjunto().recibos;
  const comandos = Array.isArray(s.comandosEmitidos) ? s.comandosEmitidos : [];
  const doPr = (tag) => retornoDoComando(comandos, recibos, (c) => c && c.alvo === dev && c.prTag === tag && c.tipo !== 'config-conta');
  const daConta = (acct, campo) => retornoDoComando(comandos, recibos, (c) => c && c.alvo === dev && c.tipo === 'config-conta' && c.acctTag === acct && c.campo === campo).html;
  return { doPr, daConta };
}

function prKeyDaTag(itens) {
  const mapa = new Map(itens.map((it) => [it.prTag, it.key]));
  return (tag) => mapa.get(tag) || '';
}

function renderPagina(s) {
  const alvo = $('#aparPagina');
  const executores = executoresDoConjunto(s, { aoVivo: sinaisAoVivo() });
  const ap = selecionado(executores);
  if (!ap) { alvo.innerHTML = nenhumExecutorHtml(); return; }
  const agora = Date.now();
  const f = fontes();
  const porAparelho = Object.fromEntries(executores.map((x) => [x.deviceId, itensDaFila(x.deviceId, f)]));
  const contagens = Object.fromEntries(executores.map((x) => [x.deviceId, contagemDaFila(porAparelho[x.deviceId])]));
  const itens = porAparelho[ap.deviceId];
  const permissao = comandoPermitido(s);
  const base = { podeComandar: permissao.pode, motivoSemComando: permissao.motivo, agora };
  const desligado = motivoSemAcao(ap, base);
  const desligadoBase = motivoSemAcao(ap, { ...base, novos: false });
  const r = retornosDo(ap.deviceId, s);
  const conjunto = dadosDoConjunto();
  const ctxFila = {
    nome: ap.nome, filtro: APAR.filtro, desligado, desligadoBase, agora, versao: ap.versao, aoVivo: APAR.aoVivo,
    semSinal: situacaoDoAparelho(ap, agora) === 'sem-sinal', pausado: ap.pausado === true, executores: executores.length,
    retornoDe: (tag) => r.doPr(tag).html, pendenteDe: (tag) => r.doPr(tag).pendente,
  };
  const fontesLidas = conjunto.estadoPendencias === 'lido' && conjunto.estadoOperacoes === 'lido';
  const situacao = situacaoDaFila(ap.deviceId, f.listas, { antigo: versaoAntiga(ap.versao), fontesLidas });
  alvo.innerHTML = `${faixaDeAparelhosHtml(executores, ap.deviceId, contagens, agora)}
    ${painelDoAparelhoHtml(ap, { agora, desligado, prKeyDaTag: prKeyDaTag(itens), ultimaVersao: ultimaVersaoConhecida() })}
    ${avisoDoAparelhoHtml(ap, { agora })}
    ${andamentoAtrasadoHtml(conjunto.andamentoEm, agora, conjunto.andamentoFalhaEm, { estado: conjunto.estadoOperacoes })}
    <section aria-label="Fila do aparelho" id="aparFila">${filaDoAparelhoHtml(itens, situacao, ctxFila)}</section>
    <section aria-label="Contas do aparelho">${contasDoAparelhoHtml(ap, { desligado, retornoConta: r.daConta })}</section>
    <section aria-label="Comandos enviados">${comandosDoAparelhoHtml(s.comandosEmitidos, dadosDoConjunto().recibos, ap.deviceId, { agora })}</section>`;
  const pedem = Object.values(contagens).reduce((t, c) => t + c.pedem, 0);
  const rc = $('#rcApar');
  rc.textContent = pedem || '';
  rc.hidden = !pedem;
}

function renderSeusAparelhos(s) {
  const executores = executoresDoConjunto(s, { aoVivo: sinaisAoVivo() });
  const f = fontes();
  const porAparelho = Object.fromEntries(executores.map((x) => [x.deviceId, itensDaFila(x.deviceId, f)]));
  const html = seusAparelhosHtml(executores, porAparelho);
  const alvo = $('#mdSeusAparelhos');
  alvo.innerHTML = html;
  alvo.hidden = !html;
}

function renderAparelhos() {
  const s = syncAtual();
  const on = ligada(s);
  $('#rsub-apar').hidden = !on;
  $('#mdSeusAparelhos').hidden = !on;
  if (!on) return;
  renderSeusAparelhos(s);
  renderPagina(s);
}

/* ---------- ações ---------- */

function desligadoNoClique(el) {
  if (el.getAttribute('aria-disabled') !== 'true') return false;
  toast('info', el.getAttribute('title') || 'Esta ação não está disponível agora.');
  return true;
}

function nomeDoSelecionado() {
  const ap = executoresDoConjunto(syncAtual(), { aoVivo: sinaisAoVivo() }).find((a) => a.deviceId === APAR.selecionado);
  return ap ? ap.nome : 'aparelho';
}

async function comandoDaFila(el) {
  const tipo = el.dataset.tipo;
  if (tipo === 'ligar-auto') return configConta(el.dataset.acct, 'autoReview', true, '');
  await emitirComando({ alvo: APAR.selecionado, tipo, args: { prTag: el.dataset.tag } }, nomeDoSelecionado());
  renderAparelhos();
  return true;
}

async function configConta(acctTag, campo, valor, conta) {
  const aparelho = nomeDoSelecionado();
  if (ligaAutomatico(campo, valor)) {
    const t = confirmacaoAutomatica(aparelho, conta || 'a conta', campo);
    if (!await confirmModal({ title: t.titulo, body: t.corpo, confirmLabel: t.confirmar, cancelLabel: t.cancelar })) { renderAparelhos(); return false; }
  }
  await emitirComando({ alvo: APAR.selecionado, tipo: 'config-conta', args: { acctTag, campo, valor } }, aparelho);
  renderAparelhos();
  return true;
}

// Pausa e teto são a POLÍTICA do aparelho (Sistema > Aparelhos): lê a vigente e republica só
// o campo mudado, para não apagar o que a tela de política definiu.
async function mudarPolitica(dev, mudanca) {
  const leitura = await lerPoliticaAtual(dev);
  if (leitura.estado !== 'ok') { toast('error', `Não deu para ler a política atual: ${leitura.motivo || 'o engine não respondeu'}.`); return false; }
  const base = leitura.politica || {};
  const teto = Number.isInteger(base.tetoParalelismo) ? base.tetoParalelismo : null;
  const corpo = aparelhoPoliticaParaPublicar({ pausado: base.pausado === true, tetoParalelismo: teto, ...mudanca });
  const erro = await publicarPolitica(dev, corpo);
  if (erro) toast('error', `A política não saiu: ${erro}.`);
  return !erro;
}

function aoClicar(e) {
  const troca = e.target.closest('.apar-troca-item');
  if (troca) { APAR.selecionado = troca.dataset.dev; renderAparelhos(); return; }
  const filtro = e.target.closest('.fila-filtro');
  if (filtro) { APAR.filtro = filtro.dataset.filtro; renderAparelhos(); return; }
  const vivo = e.target.closest('.ap-ao-vivo');
  if (vivo) { alternarEspelho(vivo.dataset.op); return; }
  const alvo = e.target.closest('.ap-cmd, .ap-conta, .ap-pausa');
  if (!alvo || desligadoNoClique(alvo)) return;
  if (alvo.classList.contains('ap-cmd')) { comandoDaFila(alvo); return; }
  if (alvo.classList.contains('ap-conta')) { configConta(alvo.dataset.acct, alvo.dataset.campo, alvo.dataset.valor === 'true', alvo.dataset.conta); return; }
  mudarPolitica(alvo.dataset.dev, { pausado: alvo.dataset.pausar === 'true' });
}

function aoMudar(e) {
  const sel = e.target.closest('.ap-conta-sel, .ap-teto');
  if (!sel || desligadoNoClique(sel)) { renderAparelhos(); return; }
  // vazio = "não definir": a política deixa de opinar e o aparelho vale pelo próprio teto total
  if (sel.classList.contains('ap-teto')) { mudarPolitica(sel.dataset.dev, { tetoParalelismo: sel.value ? Number(sel.value) : null }); return; }
  configConta(sel.dataset.acct, sel.dataset.campo, sel.value, sel.dataset.conta);
}

function abrirAparelho(dev) {
  APAR.selecionado = dev;
  const b = $('#rsub-apar');
  if (b) b.click();
  renderAparelhos();
}

function registrarTelaRadarAparelhos() {
  registrarTela({ id: 'radar-aparelhos', aoEstado: renderAparelhos });
  // decidir, ver review, cancelar e transferir são os gatilhos da visão compartilhada
  $('#aparPagina').addEventListener('click', aoClicarCompartilhado);
  $('#aparPagina').addEventListener('click', aoClicar);
  $('#aparPagina').addEventListener('change', aoMudar);
  $('#mdSeusAparelhos').addEventListener('click', (e) => {
    const b = e.target.closest('.ap-abrir');
    if (b) abrirAparelho(b.dataset.dev);
  });
  const espelhoTick = setInterval(() => {
    if (document.hidden || $('#tab-radar')?.hidden || !$('#rpane-apar') || $('#rpane-apar').hidden) return;
    for (const op of dadosDoConjunto().operacoes) {
      if (op.dev === APAR.selecionado && APAR.aoVivo.has(op.opId)) api('/api/sync/mirror', { opId: op.opId, aberto: true });
    }
  }, 10000);
  if (typeof espelhoTick.unref === 'function') espelhoTick.unref();
  aoMudarConjunto(renderAparelhos);
}

export { registrarTelaRadarAparelhos, renderAparelhos, abrirAparelho, configConta, mudarPolitica };
