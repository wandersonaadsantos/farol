/* Farol · UI: Sistema > Aparelhos.

   O HTML todo sai de funções puras (ui/pure/aparelhos.js, testadas em
   test/ui-pure-aparelhos.test.js); aqui fica só o que toca o DOM e a rede. O padrão é o da
   Sincronização (telas/sistema-sync.js): um container que a seção inteira reescreve, com
   delegação de evento no container.

   Duas leituras são sob demanda, e não vêm no snapshot: as sessões pareadas (A4) e o estado
   da chave de limpeza (que lê o banco). Cada uma guarda um estado próprio desta tela, com
   "carregando" e "falha" separados do vazio.

   A SENHA nunca é guardada: é lida do campo no instante do clique (ou do modal, na hora da
   confirmação), vai numa const local para a rota e some com a repintura.

   As ações recebem as dependências por parâmetro (`deps`), com o default real. É assim que
   test/ui-telas-aparelhos-grupos.test.js exercita o fluxo sem rede e sem DOM de verdade. */

import { esc, aparelhosSecaoHtml, aparelhosSouAdmin, settingsIgnoradasTexto } from '../pure.js';
import { estado } from './estado.js';
import { $, api, get, toast, confirmModal } from './infra.js';

let navegadores = { estado: 'carregando' };
let limpeza = { estado: 'carregando' };
// o aparelho cuja política está aberta, e a última recusa dela
let politicaAberta = '';
let politicaRecusa = '';

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
  box.innerHTML = aparelhosSecaoHtml({ sync: s, cfg: cfgSync(), auth: navegadores, limpeza, politicaDe, politicaRecusa, agora: Date.now() });
}

/* ---------- leituras sob demanda ---------- */

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
  if (!r || !r.ok) return { estado: 'falha', motivo: (r && r.motivo) || 'o servidor não respondeu' };
  return { estado: String(r.estado || '') };
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

function motivoDe(r) {
  return (r && r.motivo) || 'o servidor não respondeu';
}

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

function politicaDoDom() {
  const tipos = [...document.querySelectorAll('.apar-tipo-check')].filter((c) => c.checked).map((c) => c.value);
  return {
    pausado: !!($('#aparPolPausado') || {}).checked,
    tetoParalelismo: Number(($('#aparPolTeto') || {}).value) || 1,
    tiposDeOperacao: tipos,
  };
}

export async function publicarPolitica(deviceId, politica, d = DEPS) {
  const r = await d.api('/api/sync/policy', { deviceId, politica });
  if (r && r.ok) {
    d.toast('ok', '✓ Política publicada. O aparelho aplica no próximo ciclo, se aceitar admin.', 5000);
    return '';
  }
  return motivoDe(r);
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

/* ---------- limpeza e revogação ---------- */

export async function mudarChaveDeLimpeza(ligada, d = DEPS) {
  const r = await d.api('/api/sync/cleanup-key', { ligada: ligada === true });
  if (r && r.ok) d.toast('ok', ligada ? '✓ Chave de limpeza ligada' : '✓ Chave de limpeza desligada', 3000);
  else d.toast('error', `Não deu para mudar a chave: ${motivoDe(r)}`, 7000);
  return !!(r && r.ok);
}

const CAMPO_SENHA_MODAL = '<input id="aparModalSenha" class="sync-input" type="password" placeholder="senha da sincronização" spellcheck="false" autocomplete="off">';

// Sem lista de categorias: a rota, sem categorias, alcança todas as que a lista POSITIVA
// do engine permite (lib/sync/limpeza.js). A tela não repete essa lista.
export async function limparDados(d = DEPS) {
  const resp = await d.confirmarComCampo({
    title: 'Apagar os dados sincronizados?',
    confirmLabel: 'Apagar agora',
    danger: true,
    body: `<p><b>Acontece:</b> o conteúdo compartilhado de todas as categorias que a limpeza alcança é apagado do banco, para todos os aparelhos. Não tem volta.</p>
      <p><b>Não acontece:</b> chaveiro, posses, recibos, rodadas do dia e o controle do conjunto ficam; o histórico local de cada aparelho fica; nada é apagado com operação em andamento.</p>
      ${CAMPO_SENHA_MODAL}`,
  }, 'aparModalSenha');
  if (!resp.ok) return false;
  if (!resp.valor) { d.toast('error', 'A limpeza exige a senha da sincronização.', 5000); return false; }
  const r = await d.api('/api/sync/cleanup', { password: resp.valor });
  if (r && r.ok) d.toast('ok', '✓ Dados sincronizados apagados', 4000);
  else d.toast('error', `A limpeza não foi feita: ${motivoDe(r)}`, 9000);
  return !!(r && r.ok);
}

export async function revogarConjunto(d = DEPS) {
  const resp = await d.confirmarComCampo({
    title: 'Revogar o conjunto?',
    confirmLabel: 'Revogar',
    danger: true,
    body: `<p><b>Acontece:</b> todo acesso anterior a agora é cortado, e cada aparelho precisa entrar de novo com a senha.</p>
      <p><b>Não acontece:</b> sessões já em andamento em outro aparelho não são canceladas, o que eles já receberam não é apagado e o admin não é deposto.</p>
      ${CAMPO_SENHA_MODAL}`,
  }, 'aparModalSenha');
  if (!resp.ok) return false;
  if (!resp.valor) { d.toast('error', 'A revogação exige a senha da sincronização.', 5000); return false; }
  const r = await d.api('/api/sync/revoke', { password: resp.valor });
  if (r && r.ok) d.toast('ok', '✓ Acessos anteriores revogados', 4000);
  else d.toast('error', `A revogação não foi feita: ${motivoDe(r)}`, 9000);
  return !!(r && r.ok);
}

/* ---------- fiação ---------- */

async function aoPublicarPolitica() {
  const alvo = politicaAberta;
  if (!alvo) return;
  politicaRecusa = await publicarPolitica(alvo, politicaDoDom());
  if (!politicaRecusa) politicaAberta = '';
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

// Exportada para o teste: o botão só existe para o admin, mas a guarda fica aqui também,
// porque um snapshot novo pode tirar a autoridade entre o desenho e o clique.
export function abrirPolitica(id) {
  if (!aparelhosSouAdmin(syncDoEstado().admin)) return;
  politicaAberta = id;
  politicaRecusa = '';
  renderAparelhos();
}

const BOTOES = {
  aparTornarAdmin: () => aoTornarAdmin('aparSenhaAdmin'),
  aparAceitarDesignacao: () => aoTornarAdmin('aparSenhaDesignacao'),
  aparPublicarPolitica: aoPublicarPolitica,
  aparFecharPolitica: () => { politicaAberta = ''; politicaRecusa = ''; renderAparelhos(); },
  aparLigarLimpeza: () => aoMudarLimpeza(() => mudarChaveDeLimpeza(true)),
  aparDesligarLimpeza: () => aoMudarLimpeza(() => mudarChaveDeLimpeza(false)),
  aparLimpar: () => aoMudarLimpeza(() => limparDados()),
  aparRevogar: () => revogarConjunto(),
};

function aoClicarNoAparelho(b) {
  const ds = b.dataset || {};
  if (ds.aparRenomear) { renomearAparelho(ds.aparRenomear).then(renderAparelhos); return; }
  if (ds.aparAposentar) { aposentarAparelho(ds.aparAposentar, true).then(renderAparelhos); return; }
  if (ds.aparReativar) { aposentarAparelho(ds.aparReativar, false).then(renderAparelhos); return; }
  if (ds.aparPolitica) { abrirPolitica(ds.aparPolitica); return; }
  if (ds.aparRevogarSessao) aoRevogarSessao(ds.aparRevogarSessao);
}

$('#devicesManager').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (Object.hasOwn(BOTOES, b.id)) { BOTOES[b.id](); return; }
  aoClicarNoAparelho(b);
});

$('#devicesManager').addEventListener('change', (e) => {
  const t = e.target;
  if (t.id !== 'setSyncAceitarAdmin') return;
  // o interruptor já mostra o que foi pedido; só a recusa repinta (e volta ao valor salvo)
  salvarConsentimento(t.checked).then((ok) => { if (!ok) renderAparelhos(); });
});
