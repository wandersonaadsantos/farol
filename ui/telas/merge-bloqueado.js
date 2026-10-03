/* Farol · UI: Repos bloqueados pra merge, em Sistema > Automação (03/10/2026).

   Saiu de Sistema > Conexões, que sumiu (os outros dois campos de lá não tinham efeito).
   Desenho do Claude Design: docs/superpowers/specs/2026-10-03-tela-conexoes-anexos/HANDOFF.md.
   Não é aba (não passa por registrarTela): o sistema.js chama `renderReposBloqueados` junto
   das outras configurações, e os ouvintes abaixo nascem com o import.

   Toda gravação manda a lista INTEIRA para /api/settings, como o campo de texto antigo fazia;
   o servidor saneia (lib/settings.js) e devolve o que recusou. */
import {
  incluirRepo, tirarRepo, prsDoRepo, reposBloqueadosHtml, textoDoMergeBloqueado, textoDoMergeDesbloqueado,
  settingsIgnoradasTexto,
} from '../pure.js';
import { estado } from './estado.js';
import { $, api, toast, toastRich } from './infra.js';

function listaAtual() {
  return (estado()?.config?.mergeBlockedRepos) || [];
}

export function renderReposBloqueados() {
  const bloco = reposBloqueadosHtml(listaAtual(), estado()?.myPRs || []);
  const count = $('#mbCount');
  count.hidden = !bloco.contagem;
  count.textContent = bloco.contagem;
  $('#mbEmpty').hidden = !bloco.vazio;
  $('#mbList').hidden = bloco.vazio;
  $('#mbList').innerHTML = bloco.itens;
  $('#mbSug').hidden = !bloco.sugestoes;
  $('#mbSug').innerHTML = bloco.sugestoes;
}

function mostrarErro(texto) {
  const erro = $('#mbErro');
  erro.hidden = !texto;
  erro.textContent = texto || '';
  if (texto) $('#mbAdd').setAttribute('aria-invalid', 'true');
  else $('#mbAdd').removeAttribute('aria-invalid');
}

// Grava a lista e mostra o toast com Desfazer, que regrava a lista de antes.
async function gravar(nova, anterior, texto) {
  const r = await api('/api/settings', { mergeBlockedRepos: nova });
  const recusa = settingsIgnoradasTexto(r);
  if (recusa || !r) { toast('error', recusa || 'Não consegui salvar a lista.', 6000); return; }
  let desfazer;
  const t = toastRich('ok', (el) => {
    const msg = document.createElement('span');
    msg.textContent = texto;
    desfazer = document.createElement('button');
    desfazer.className = 'undo';
    desfazer.textContent = 'Desfazer';
    el.appendChild(msg);
    el.appendChild(desfazer);
  }, 8000);
  desfazer.onclick = () => { api('/api/settings', { mergeBlockedRepos: anterior }); t.remove(); };
}

async function incluir(valor) {
  const anterior = listaAtual();
  const r = incluirRepo(anterior, valor);
  if (!r.ok) { mostrarErro(r.erro); return; }
  mostrarErro('');
  $('#mbAdd').value = '';
  await gravar(r.lista, anterior, textoDoMergeBloqueado(r.repo, prsDoRepo(estado()?.myPRs, r.repo)));
}

$('#mbAddBtn').addEventListener('click', () => incluir($('#mbAdd').value));
$('#mbAdd').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); incluir(e.target.value); } });
$('#mbAdd').addEventListener('input', () => mostrarErro(''));
$('#mbSug').addEventListener('click', (e) => {
  const b = e.target.closest('.mb-sug-btn');
  if (b) incluir(b.dataset.repo);
});
$('#mbList').addEventListener('click', (e) => {
  const b = e.target.closest('.mb-x');
  if (!b) return;
  const anterior = listaAtual();
  gravar(tirarRepo(anterior, b.dataset.repo), anterior, textoDoMergeDesbloqueado(b.dataset.repo));
});
