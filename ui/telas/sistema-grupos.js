/* Farol · UI: Sistema > Grupos de consumo.

   O HTML todo sai de funções puras (ui/pure/grupos.js, testadas em
   test/ui-pure-grupos.test.js); aqui fica só o que toca o DOM e a rede, com delegação de
   evento no container, como em telas/sistema-sync.js.

   Publicar grupo é ato do admin (o engine recusa quem não é); vincular perfil é LOCAL e vale
   para qualquer aparelho. O grupo publicado só aparece na lista depois que o aceite do
   relógio o lê do banco (lib/engine/sync-aceite.js): a tela diz isso no aviso de sucesso,
   em vez de desenhar um grupo que o engine ainda não aceitou.

   As ações recebem as dependências por parâmetro (`deps`), com o default real, para o teste
   exercitar o fluxo sem rede. */

import { gruposSecaoHtml, grupoCorpoDaRota, grupoCorpoDoGrupo, grupoNovoId, grupoTipoDoPerfil, aparelhosSouAdmin } from '../pure.js';
import { estado } from './estado.js';
import { $, api, toast, confirmModal } from './infra.js';

// o formulário aberto: `null` fechado, `{ grupo: null }` criando, `{ grupo }` editando
let formulario = null;
// grupos publicados daqui que ainda não chegaram pelo snapshot, por id (dono de escrita
// único: anotarPendente). Saem sozinhos quando o grupo aparece na lista aceita.
const pendentes = new Map();

export function anotarPendente(p) {
  if (p && p.id) pendentes.set(p.id, { id: p.id, nome: p.nome, versao: p.versao });
}

function syncDoEstado() {
  return (estado() && estado().sync) || {};
}

function perfis() {
  const c = (estado() && estado().config) || {};
  return Array.isArray(c.claudeProfiles) ? c.claudeProfiles : [];
}

function grupoPorId(id) {
  const lista = Array.isArray(syncDoEstado().gruposDeConsumo) ? syncDoEstado().gruposDeConsumo : [];
  return lista.find((g) => g && g.id === id) || null;
}

function idSorteado() {
  return grupoNovoId(crypto.getRandomValues(new Uint8Array(16)));
}

const DEPS = { api, toast, confirmModal, idSorteado, anotarPendente };

function podarPendentes(grupos) {
  for (const g of grupos) if (g && pendentes.has(g.id)) pendentes.delete(g.id);
}

export function renderGrupos() {
  const box = $('#groupsManager');
  if (!box) return;
  const foco = document.activeElement;
  if (foco && box.contains(foco) && /INPUT|SELECT/.test(foco.tagName) && foco.type !== 'checkbox') return;
  const cfg = (estado() && estado().config && estado().config.sync) || {};
  const s = syncDoEstado();
  podarPendentes(Array.isArray(s.gruposDeConsumo) ? s.gruposDeConsumo : []);
  box.innerHTML = gruposSecaoHtml({ sync: s, cfg, perfis: perfis(), form: formulario, souAdmin: aparelhosSouAdmin(s.admin), pendentes: [...pendentes.values()] });
}

function motivoDe(r) {
  return (r && r.motivo) || 'o servidor não respondeu';
}

/* ---------- publicar ---------- */

// `form` é o que foi digitado; `atual` é o grupo em edição (ou null ao criar). O ativo do
// grupo em edição vai junto: republicar sem ele desativaria o teto sem ninguém pedir.
export async function salvarGrupo(form, atual, d = DEPS) {
  const id = (atual && atual.id) || d.idSorteado();
  if (!id) { d.toast('error', 'Não deu para gerar a identidade do grupo neste navegador.', 6000); return false; }
  const ativo = atual && atual.ativo === true ? true : undefined;
  const corpo = grupoCorpoDaRota({ ...form, id, ativo });
  if (!corpo.nome || !corpo.periodo) { d.toast('error', 'Dê um nome e escolha o período do grupo.', 5000); return false; }
  const r = await d.api('/api/sync/group', { grupo: corpo });
  if (!r || !r.ok) { d.toast('error', `O grupo não foi publicado: ${motivoDe(r)}`, 9000); return false; }
  (d.anotarPendente || anotarPendente)({ id, nome: corpo.nome, versao: Number(r.versao) || 0 });
  d.toast('ok', `✓ Grupo publicado na versão ${Number(r.versao) || 0}. Ele aparece aqui quando o próximo ciclo o aceitar.`, 5000);
  return true;
}

export async function mudarAtivacao(grupo, ativo, d = DEPS) {
  if (ativo) {
    const ok = await d.confirmModal({
      title: `Ativar o teto de ${grupo.nome || 'grupo'}?`,
      confirmLabel: 'Ativar teto',
      body: `<p><b>Acontece:</b> quando o gasto somado dos perfis controlados chegar ao teto, nenhuma sessão nova abre por eles, em nenhum aparelho que aceita admin. Se a soma não fechar, as revisões desses perfis esperam, inclusive as de clique.</p>
        <p><b>Não acontece:</b> sessões em andamento não são interrompidas, e perfis não controlados (como o Codex) não entram na soma.</p>`,
    });
    if (!ok) return false;
  }
  const r = await d.api('/api/sync/group', { grupo: grupoCorpoDoGrupo(grupo, ativo) });
  // a recusa `ativacao-bloqueada` traz a lista do que falta no próprio motivo
  if (r && r.ok) d.toast('ok', ativo ? '✓ Teto ativado. Vale quando o próximo ciclo o aceitar.' : '✓ Teto desativado', 5000);
  else d.toast('error', `Não deu: ${motivoDe(r)}`, 10000);
  return !!(r && r.ok);
}

/* ---------- vínculo ---------- */

export async function vincularPerfil(perfil, grupoId, d = DEPS) {
  const tipo = grupoTipoDoPerfil(perfil);
  if (!tipo || !grupoId) { d.toast('error', 'Escolha um grupo; perfil de tipo desconhecido não é vinculado.', 5000); return false; }
  const r = await d.api('/api/sync/link', { perfilId: perfil.id, grupo: grupoId, tipo });
  if (r && r.ok) d.toast('ok', '✓ Perfil vinculado', 2500);
  else d.toast('error', `Não deu para vincular: ${motivoDe(r)}`, 7000);
  return !!(r && r.ok);
}

export async function desvincularPerfil(perfilId, d = DEPS) {
  const ok = await d.confirmModal({
    title: 'Desvincular este perfil?',
    confirmLabel: 'Desvincular',
    body: `<p><b>Acontece:</b> o gasto novo deste perfil deixa de contar no grupo.</p>
      <p><b>Não acontece:</b> o gasto já registrado continua no grupo em que foi feito, e nenhuma credencial muda.</p>`,
  });
  if (!ok) return false;
  const r = await d.api('/api/sync/link', { perfilId, desvincular: true });
  if (r && r.ok) d.toast('ok', '✓ Perfil desvinculado', 2500);
  else d.toast('error', `Não deu para desvincular: ${motivoDe(r)}`, 7000);
  return !!(r && r.ok);
}

/* ---------- fiação ---------- */

function formDoDom() {
  return {
    nome: ($('#grupoNome') || {}).value || '',
    periodo: ($('#grupoPeriodo') || {}).value || '',
    teto: ($('#grupoTeto') || {}).value || '',
  };
}

async function aoSalvar() {
  const atual = formulario && formulario.grupo;
  if (await salvarGrupo(formDoDom(), atual)) formulario = null;
  renderGrupos();
}

function abrirFormulario(grupo) {
  formulario = { grupo };
  renderGrupos();
}

function aoVincular(b) {
  const linha = b.closest('.grupo-perfil');
  const sel = linha && linha.querySelector('.grupo-vinc-sel');
  const perfil = perfis().find((p) => p && p.id === b.dataset.grupoVincular);
  if (!perfil) return;
  vincularPerfil(perfil, sel ? sel.value : '').then(renderGrupos);
}

function aoClicarNoGrupo(b) {
  const ds = b.dataset || {};
  if (ds.grupoEditar) { abrirFormulario(grupoPorId(ds.grupoEditar)); return; }
  if (ds.grupoAtivar && grupoPorId(ds.grupoAtivar)) { mudarAtivacao(grupoPorId(ds.grupoAtivar), true).then(renderGrupos); return; }
  if (ds.grupoDesativar && grupoPorId(ds.grupoDesativar)) { mudarAtivacao(grupoPorId(ds.grupoDesativar), false).then(renderGrupos); return; }
  if (ds.grupoVincular) { aoVincular(b); return; }
  if (ds.grupoDesvincular) desvincularPerfil(ds.grupoDesvincular).then(renderGrupos);
}

$('#groupsManager').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.id === 'grupoNovo') { abrirFormulario(null); return; }
  if (b.id === 'grupoCancelar') { formulario = null; renderGrupos(); return; }
  if (b.id === 'grupoSalvar') { aoSalvar(); return; }
  aoClicarNoGrupo(b);
});
