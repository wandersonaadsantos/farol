/* Farol · UI: Sistema > Aparelhos.

   O HTML todo sai de funções puras (ui/pure/aparelhos*.js, testadas em
   test/ui-pure-aparelhos.test.js e test/ui-pure-divergencias.test.js); aqui fica só o que
   toca o DOM e a rede. O padrão é o da Sincronização (telas/sistema-sync.js): um container
   que a seção inteira reescreve, com delegação de evento no container.

   Três leituras são sob demanda, e não vêm no snapshot: as sessões pareadas (A4), o estado
   da chave de limpeza (que lê o banco) e a política vigente de um aparelho (só quando o
   admin abre o formulário). Cada uma guarda um estado próprio desta tela, com
   "carregando" e "falha" separados do vazio.

   A SENHA nunca é guardada: é lida do campo no instante do clique (ou do modal, na hora da
   confirmação), vai numa const local para a rota e some com a repintura.

   As ações recebem as dependências por parâmetro (`deps`), com o default real. É assim que
   os testes exercitam o fluxo sem rede e sem DOM de verdade. */

import { esc, aparelhosSecaoHtml, aparelhosSouAdmin, aparelhosCampoSenhaModal, aparelhosDesignarAcao, aparelhosDesignarConfirmacao, aparelhosResultadoDaLimpeza, aparelhoPoliticaParaPublicar, reciboFinal, syncOlhoRotulo, syncOlhoDesenho, settingsIgnoradasTexto } from '../pure.js';
import { estado } from './estado.js';
import { $, api, get, toast, confirmModal } from './infra.js';

let navegadores = { estado: 'carregando' };
let limpeza = { estado: 'carregando' };
// a limpeza pedida DAQUI, entre o clique e a resposta da rota
let limpando = false;
// o aparelho cuja política está aberta, a leitura da política vigente e a última recusa
let politicaAberta = '';
let politicaLeitura = null;
let politicaRecusa = '';
// os recibos das designações enviadas daqui: leitura avulsa, uma por comando aberto, com
// piso de tempo (sem ele, cada snapshot repetiria a consulta)
const RECIBO_MIN_MS = 10000;
const RECIBOS = { mapa: {}, emCurso: null, at: 0 };

function syncDoEstado() {
  return (estado() && estado().sync) || {};
}

function cfgSync() {
  return (estado() && estado().config && estado().config.sync) || {};
}

// O modal de confirmação remove o próprio DOM ANTES de resolver; o campo é guardado no
// instante em que o modal abre (o executor da Promise roda síncrono), e o valor é lido
// depois, do elemento já desanexado. Nada disso vai para variável de módulo.
async function confirmarComCampo(opcoes, idDoCampo) {
  const espera = confirmModal(opcoes);
  const campo = idDoCampo ? document.querySelector(`#${idDoCampo}`) : null;
  const ok = await espera;
  return { ok, valor: ok && campo ? String(campo.value || '') : '' };
}

const DEPS = { api, get, toast, confirmarComCampo, recarregar: () => location.reload() };

export function renderAparelhos() {
  const box = $('#devicesManager');
  if (!box) return;
  // repintar por baixo de quem digita apaga a senha no meio da frase; o interruptor fica
  // fora da guarda, porque ele precisa repintar no mesmo clique
  const foco = document.activeElement;
  if (foco && box.contains(foco) && /INPUT|SELECT/.test(foco.tagName) && foco.type !== 'checkbox') return;
  const s = syncDoEstado();
  const lista = Array.isArray(s.devices) ? s.devices : [];
  const politicaDe = politicaAberta ? lista.find((d) => d && d.deviceId === politicaAberta) : null;
  box.innerHTML = aparelhosSecaoHtml({
    sync: s, cfg: cfgSync(), auth: navegadores, limpeza, limpando, politicaDe, politicaLeitura, politicaRecusa,
    capacidades: estado() && estado().capacidades, agora: Date.now(), recibos: RECIBOS.mapa,
  });
  lerRecibosDaDesignacao();
}

/* ---------- designar outro aparelho como admin (C6) ---------- */

function designacoesAbertas() {
  const s = syncDoEstado();
  return (Array.isArray(s.comandosEmitidos) ? s.comandosEmitidos : [])
    .filter((c) => c && c.tipo === 'designar-admin' && c.cmdId && !reciboFinal(RECIBOS.mapa[c.cmdId]));
}

async function lerAbertas(d, abertos) {
  let mudou = false;
  for (const c of abertos) {
    const r = await d.api('/api/sync/command-status', { cmdId: c.cmdId });
    if (r && r.ok === true && r.recibo) { RECIBOS.mapa[c.cmdId] = r.recibo; mudou = true; }
  }
  return mudou;
}

// O desfecho de uma designação só existe com o recibo do aparelho de destino, e ele pode
// demorar o tempo de alguém digitar a senha lá. A tela pergunta enquanto o recibo não for
// final, uma consulta por vez: quem chega com outra em curso espera ela terminar (sem
// isso, o pedido forçado logo depois de uma ação voltaria sem ler nada). Só repinta
// quando algum recibo chegou.
export async function lerRecibosDaDesignacao(d = DEPS, { forcar = false } = {}) {
  if (RECIBOS.emCurso) await RECIBOS.emCurso;
  const abertos = designacoesAbertas();
  if (!abertos.length) return false;
  if (!forcar && Date.now() - RECIBOS.at < RECIBO_MIN_MS) return false;
  RECIBOS.at = Date.now();
  RECIBOS.emCurso = lerAbertas(d, abertos);
  let mudou = false;
  try { mudou = await RECIBOS.emCurso; } finally { RECIBOS.emCurso = null; }
  if (mudou) renderAparelhos();
  return mudou;
}

// Designar NÃO promove ninguém daqui: manda o pedido, e quem promove é a senha digitada
// no aparelho de destino. A guarda do ato fica aqui também, porque um snapshot novo pode
// tirar a autoridade entre o desenho da linha e o clique.
export async function designarAdmin(deviceId, d = DEPS) {
  const s = syncDoEstado();
  const alvo = (Array.isArray(s.devices) ? s.devices : []).find((x) => x && x.deviceId === deviceId);
  if (!alvo || !aparelhosDesignarAcao(alvo, { souAdmin: aparelhosSouAdmin(s.admin) }).pode) return false;
  const nome = String(alvo.name || deviceId);
  const texto = aparelhosDesignarConfirmacao(nome);
  const resp = await d.confirmarComCampo({ title: texto.title, confirmLabel: 'Enviar o pedido', body: texto.body }, '');
  if (!resp.ok) return false;
  const r = await d.api('/api/sync/command', { alvo: deviceId, tipo: 'designar-admin', args: {} });
  if (r && r.ok === true) d.toast('info', `Pedido enviado ao ${nome}. Ele vira admin quando alguém digitar a senha lá.`, 6000);
  else d.toast('error', `O pedido não saiu: ${motivoDe(r)}`, 7000);
  return !!(r && r.ok === true);
}

/* ---------- leituras sob demanda ---------- */

function motivoDe(r) {
  return (r && r.motivo) || 'o servidor não respondeu';
}

export async function lerNavegadores(d = DEPS) {
  const status = await d.get('/api/auth/status');
  if (!status) return { estado: 'falha', motivo: 'o servidor não respondeu' };
  if (status.exigida !== true) return { estado: 'nao-exigida' };
  const r = await d.api('/api/auth/sessions', {});
  if (!r || !r.ok) return { estado: 'falha', motivo: (r && r.code) || 'o servidor não respondeu' };
  return { estado: 'ok', sessoes: Array.isArray(r.sessoes) ? r.sessoes : [] };
}

export async function lerLimpeza(d = DEPS) {
  const r = await d.api('/api/sync/cleanup-state', {});
  if (!r || !r.ok) return { estado: 'falha', motivo: motivoDe(r) };
  // só o que a rota trouxe: lista ausente não vira lista vazia inventada aqui
  const saida = { estado: String(r.estado || '') };
  if (r.travada) saida.travada = r.travada;
  if (Array.isArray(r.categorias)) saida.categorias = r.categorias;
  if (Array.isArray(r.nuncaApagadas)) saida.nuncaApagadas = r.nuncaApagadas;
  return saida;
}

export async function lerPoliticaAtual(deviceId, d = DEPS) {
  const r = await d.api('/api/sync/policy-read', { deviceId });
  if (!r || !r.ok) return { estado: 'falha', motivo: motivoDe(r) };
  return { estado: 'ok', existe: r.existe === true, valida: r.valida === true, versao: Number(r.versao) || 0, politica: r.politica || null };
}

export async function carregarAparelhos(d = DEPS) {
  navegadores = { estado: 'carregando' };
  limpeza = { estado: 'carregando' };
  renderAparelhos();
  // sem sincronização não existe chave de limpeza para ler, e perguntar ao banco seria uma
  // chamada que só pode falhar
  const ligada = cfgSync().enabled === true;
  const [nav, limp] = await Promise.all([lerNavegadores(d), ligada ? lerLimpeza(d) : Promise.resolve({ estado: 'compartilhamento-desligado' })]);
  navegadores = nav;
  limpeza = limp;
  renderAparelhos();
}

/* ---------- aparelhos ---------- */

export async function renomearAparelho(deviceId, d = DEPS) {
  const atual = (syncDoEstado().devices || []).find((x) => x && x.deviceId === deviceId) || {};
  const resp = await d.confirmarComCampo({
    title: 'Renomear aparelho',
    confirmLabel: 'Renomear',
    body: `<p>É o nome que os outros aparelhos mostram. Nome vazio mantém o atual.</p>
      <input id="aparModalNome" class="sync-input" type="text" maxlength="40" spellcheck="false" autocomplete="off" value="${esc(atual.name || '')}">`,
  }, 'aparModalNome');
  if (!resp.ok || !resp.valor.trim()) return false;
  const r = await d.api('/api/sync/device', { deviceId, nome: resp.valor.trim() });
  if (r && r.ok) d.toast('ok', '✓ Aparelho renomeado', 2500);
  else d.toast('error', `Não deu para renomear: ${motivoDe(r)}`, 7000);
  return !!(r && r.ok);
}

export async function aposentarAparelho(deviceId, aposentar, d = DEPS) {
  if (aposentar) {
    const resp = await d.confirmarComCampo({
      title: 'Aposentar este aparelho?',
      confirmLabel: 'Aposentar',
      body: `<p>O aparelho deixa de contar como ativo no conjunto.</p>
        <p><b>Não acontece:</b> nenhum dado é apagado, nenhuma chave é retirada, o admin não é deposto e nenhuma sessão é encerrada. Dá para reativar depois.</p>`,
    }, '');
    if (!resp.ok) return false;
  }
  const r = await d.api('/api/sync/device', { deviceId, aposentar: aposentar === true });
  if (r && r.ok) d.toast('ok', aposentar ? '✓ Aparelho aposentado' : '✓ Aparelho reativado', 2500);
  else d.toast('error', `Não deu para mudar o aparelho: ${motivoDe(r)}`, 7000);
  return !!(r && r.ok);
}

/* ---------- administração ---------- */

export async function tornarAdmin(senha, d = DEPS) {
  if (!senha) { d.toast('error', 'Digite a senha da sincronização.', 4000); return false; }
  const r = await d.api('/api/sync/admin', { password: senha });
  if (r && r.ok) d.toast('ok', '✓ Este aparelho agora é o admin', 3500);
  else d.toast('error', `Não deu para tornar este aparelho admin: ${motivoDe(r)}`, 8000);
  return !!(r && r.ok);
}

// Recusar fecha o pedido com recibo: quem designou vê a recusa, e não há volta daqui.
export async function recusarDesignacao(d = DEPS) {
  const resp = await d.confirmarComCampo({
    title: 'Recusar o pedido para ser admin?',
    confirmLabel: 'Recusar',
    body: `<p><b>Acontece:</b> o pedido é fechado, e quem designou este aparelho vê a recusa no desfecho do comando.</p>
      <p><b>Não acontece:</b> nada muda no admin vigente, e nenhuma senha é pedida. Para este aparelho virar admin depois, é só usar "Tornar este aparelho admin".</p>`,
  }, '');
  if (!resp.ok) return false;
  const r = await d.api('/api/sync/designation-decline', {});
  if (r && r.ok) d.toast('ok', '✓ Pedido recusado', 3000);
  else d.toast('error', `Não deu para recusar: ${motivoDe(r)}`, 7000);
  return !!(r && r.ok);
}

// Retirar o consentimento vale na hora; o objeto de sync vai INTEIRO, senão o engine
// receberia uma config parcial (mesma regra do saveSync da Sincronização).
export async function salvarConsentimento(valor, d = DEPS) {
  const sync = { ...cfgSync(), aceitarAdmin: valor === true };
  const r = await d.api('/api/settings', { sync });
  const recusa = settingsIgnoradasTexto(r);
  if (!r || recusa) { d.toast('error', recusa || 'O servidor não respondeu; nada mudou.', 6000); return false; }
  d.toast('ok', valor ? '✓ Este aparelho aceita o admin' : '✓ Este aparelho voltou a valer só pela configuração local', 3000);
  return true;
}

/* ---------- política ---------- */

// Teto vazio é "não definir": o corpo não leva o campo, e o aparelho vale pelo próprio.
function politicaDoDom() {
  const tipos = [...document.querySelectorAll('.apar-tipo-check')].filter((c) => c.checked).map((c) => c.value);
  const teto = String(($('#aparPolTeto') || {}).value || '');
  return {
    pausado: !!($('#aparPolPausado') || {}).checked,
    tetoParalelismo: teto ? Number(teto) : null,
    tiposDeOperacao: tipos,
  };
}

// A versão é a que foi PUBLICADA; o aceite acontece no destino e não volta para cá.
export async function publicarPolitica(deviceId, politica, d = DEPS) {
  const r = await d.api('/api/sync/policy', { deviceId, politica });
  if (r && r.ok) {
    d.toast('ok', `✓ Política publicada na versão ${Number(r.versao) || 0}. O aparelho aplica no próximo ciclo, se aceitar admin.`, 5000);
    return '';
  }
  return motivoDe(r);
}

// Exportada para o teste: o botão só existe para o admin, mas a guarda fica aqui também,
// porque um snapshot novo pode tirar a autoridade entre o desenho e o clique.
export async function abrirPolitica(id, d = DEPS) {
  if (!aparelhosSouAdmin(syncDoEstado().admin)) return;
  politicaAberta = id;
  politicaRecusa = '';
  politicaLeitura = { estado: 'carregando' };
  renderAparelhos();
  const lida = await lerPoliticaAtual(id, d);
  // outro aparelho aberto no meio da leitura: esta resposta já não é de quem está na tela
  if (politicaAberta !== id) return;
  politicaLeitura = lida;
  renderAparelhos();
}

/* ---------- navegadores ---------- */

export async function revogarSessao(id, d = DEPS) {
  const resp = await d.confirmarComCampo({
    title: 'Revogar este navegador?',
    confirmLabel: 'Revogar',
    danger: true,
    body: `<p>O navegador perde o acesso à API deste aparelho e precisa parear de novo.</p>
      <p>Se for o navegador que você está usando, a página volta para o pareamento.</p>`,
  }, '');
  if (!resp.ok) return false;
  const r = await d.api('/api/auth/revoke', { id });
  if (!r || !r.ok) { d.toast('error', `Não deu para revogar: ${(r && r.code) || 'o servidor não respondeu'}`, 7000); return false; }
  if (r.eraAtual === true) { d.recarregar(); return true; }
  d.toast('ok', '✓ Navegador revogado', 2500);
  return true;
}

/* ---------- o olho da senha ---------- */

// O `aria-pressed` do botão é o estado; o campo é o que `data-olho-de` nomeia. Nada é
// repintado: a senha digitada fica onde está.
export function alternarOlho(botao, raiz = document) {
  const alvo = botao && botao.dataset ? botao.dataset.olhoDe : '';
  const campo = alvo ? raiz.querySelector(`#${alvo}`) : null;
  if (!campo) return false;
  const visivel = botao.getAttribute('aria-pressed') !== 'true';
  campo.type = visivel ? 'text' : 'password';
  botao.setAttribute('aria-pressed', visivel ? 'true' : 'false');
  botao.setAttribute('aria-label', syncOlhoRotulo(visivel));
  botao.setAttribute('title', syncOlhoRotulo(visivel));
  botao.innerHTML = syncOlhoDesenho(visivel);
  return true;
}

/* ---------- limpeza e revogação ---------- */

export async function mudarChaveDeLimpeza(ligada, d = DEPS) {
  const r = await d.api('/api/sync/cleanup-key', { ligada: ligada === true });
  if (r && r.ok) d.toast('ok', ligada ? '✓ Chave de limpeza ligada' : '✓ Chave de limpeza desligada', 3000);
  else d.toast('error', `Não deu para mudar a chave: ${motivoDe(r)}`, 7000);
  return !!(r && r.ok);
}

// Sem lista de categorias: a rota, sem categorias, alcança todas as que a lista POSITIVA
// do engine permite (lib/sync/limpeza.js). A tela não repete essa lista; o desfecho volta
// por categoria, e falha parcial é aviso de erro.
export async function limparDados(d = DEPS) {
  const resp = await d.confirmarComCampo({
    title: 'Apagar os dados sincronizados?',
    confirmLabel: 'Apagar agora',
    danger: true,
    body: `<p><b>Acontece:</b> o conteúdo compartilhado de todas as categorias que a limpeza alcança é apagado do banco, para todos os aparelhos. Não tem volta.</p>
      <p><b>Não acontece:</b> as categorias que o app nunca apaga ficam; o histórico local de cada aparelho fica; nada é apagado com operação em andamento.</p>
      ${aparelhosCampoSenhaModal()}`,
  }, 'aparModalSenha');
  if (!resp.ok) return false;
  if (!resp.valor) { d.toast('error', 'A limpeza exige a senha da sincronização.', 5000); return false; }
  const r = await d.api('/api/sync/cleanup', { password: resp.valor });
  const desfecho = aparelhosResultadoDaLimpeza(r);
  d.toast(desfecho.tipo, desfecho.texto, desfecho.tipo === 'ok' ? 4000 : 9000);
  return !!(r && r.ok);
}

export async function revogarConjunto(d = DEPS) {
  const resp = await d.confirmarComCampo({
    title: 'Revogar o conjunto?',
    confirmLabel: 'Revogar',
    danger: true,
    body: `<p><b>Acontece:</b> todo acesso anterior a agora é cortado, e cada aparelho precisa entrar de novo com a senha.</p>
      <p><b>Não acontece:</b> sessões já em andamento em outro aparelho não são canceladas, o que eles já receberam não é apagado, o admin não é deposto e o consentimento deste aparelho não muda.</p>
      ${aparelhosCampoSenhaModal()}`,
  }, 'aparModalSenha');
  if (!resp.ok) return false;
  if (!resp.valor) { d.toast('error', 'A revogação exige a senha da sincronização.', 5000); return false; }
  const r = await d.api('/api/sync/revoke', { password: resp.valor });
  if (r && r.ok) d.toast('ok', '✓ Acessos anteriores revogados', 4000);
  else d.toast('error', `A revogação não foi feita: ${motivoDe(r)}`, 9000);
  return !!(r && r.ok);
}

// Enquanto a rota não responde, a seção diz "limpando" e não oferece outra limpeza.
export async function aoLimpar(d = DEPS) {
  limpando = true;
  renderAparelhos();
  let feito = false;
  try {
    feito = await limparDados(d);
  } finally {
    limpando = false;
  }
  if (feito) limpeza = await lerLimpeza(d);
  renderAparelhos();
}

/* ---------- fiação ---------- */

async function aoPublicarPolitica() {
  const alvo = politicaAberta;
  if (!alvo) return;
  politicaRecusa = await publicarPolitica(alvo, aparelhoPoliticaParaPublicar(politicaLeitura, politicaDoDom()));
  if (!politicaRecusa) { politicaAberta = ''; politicaLeitura = null; }
  renderAparelhos();
}

async function aoTornarAdmin(idDoCampo) {
  const senha = ($(`#${idDoCampo}`) || {}).value || '';
  await tornarAdmin(senha);
  renderAparelhos();
}

async function aoMudarLimpeza(acao) {
  const feito = await acao();
  if (feito) limpeza = await lerLimpeza();
  renderAparelhos();
}

async function aoRevogarSessao(id) {
  if (await revogarSessao(id)) navegadores = await lerNavegadores();
  renderAparelhos();
}

const BOTOES = {
  aparTornarAdmin: () => aoTornarAdmin('aparSenhaAdmin'),
  aparAceitarDesignacao: () => aoTornarAdmin('aparSenhaDesignacao'),
  aparRecusarDesignacao: () => recusarDesignacao().then(renderAparelhos),
  aparPublicarPolitica: aoPublicarPolitica,
  aparFecharPolitica: () => { politicaAberta = ''; politicaLeitura = null; politicaRecusa = ''; renderAparelhos(); },
  aparLigarLimpeza: () => aoMudarLimpeza(() => mudarChaveDeLimpeza(true)),
  aparDesligarLimpeza: () => aoMudarLimpeza(() => mudarChaveDeLimpeza(false)),
  aparLimpar: () => aoLimpar(),
  aparRevogar: () => revogarConjunto(),
};

function aoClicarNoAparelho(b) {
  const ds = b.dataset || {};
  if (ds.aparRenomear) { renomearAparelho(ds.aparRenomear).then(renderAparelhos); return; }
  if (ds.aparAposentar) { aposentarAparelho(ds.aparAposentar, true).then(renderAparelhos); return; }
  if (ds.aparReativar) { aposentarAparelho(ds.aparReativar, false).then(renderAparelhos); return; }
  if (ds.aparPolitica) { abrirPolitica(ds.aparPolitica); return; }
  if (ds.aparDesignar) { designarAdmin(ds.aparDesignar).then(renderAparelhos); return; }
  if (ds.aparRevogarSessao) aoRevogarSessao(ds.aparRevogarSessao);
}

$('#devicesManager').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (Object.hasOwn(BOTOES, b.id)) { BOTOES[b.id](); return; }
  aoClicarNoAparelho(b);
});

// O olho também vive nos modais, que moram fora do container: um ouvinte no documento,
// só para os botões que dizem qual campo alternam (o da Sincronização não diz, e segue
// com o handler dele).
document.addEventListener('click', (e) => {
  const b = e.target && e.target.closest ? e.target.closest('.sync-olho[data-olho-de]') : null;
  if (b) alternarOlho(b);
});

$('#devicesManager').addEventListener('change', (e) => {
  const t = e.target;
  if (t.id !== 'setSyncAceitarAdmin') return;
  // o interruptor já mostra o que foi pedido; só a recusa repinta (e volta ao valor salvo)
  salvarConsentimento(t.checked).then((ok) => { if (!ok) renderAparelhos(); });
});
