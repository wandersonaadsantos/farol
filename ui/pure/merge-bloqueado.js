// Repos bloqueados pra merge: a lista que desativa o botão Merge de Meus PRs (03/10/2026).
//
// Até 03/10/2026 a lista era um campo de texto em Sistema > Conexões, ao lado de dois campos
// que não faziam nada (conta e organizações do modo simples, sem efeito desde que as contas
// passaram a morar em Sistema > Contas). A seção saiu e a lista foi para Sistema > Automação,
// com o desenho do Claude Design (handoff em
// docs/superpowers/specs/2026-10-03-tela-conexoes-anexos/HANDOFF.md).
//
// O dado não muda: `config.mergeBlockedRepos`, lista de `owner/repo`, saneada no servidor
// (lib/settings.js). Aqui só se normaliza a entrada e se escolhe o texto.
import { esc, plural } from './comum.js';

const REPO_OK = /^[a-z0-9][a-z0-9-]*\/[a-z0-9._-]+$/;

// `owner/repo`, a URL do repo ou a URL de um PR viram `owner/repo` em minúsculas (o card de
// Meus PRs já compara em minúsculas).
export function normalizarRepo(v) {
  return String(v || '').trim().toLowerCase()
    .replace(/^https?:\/\/(www\.)?github\.com\//, '')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '')
    .split('/').slice(0, 2).join('/');
}

function listaLimpa(lista) {
  return (Array.isArray(lista) ? lista : []).map((r) => String(r).toLowerCase()).filter(Boolean);
}

// Incluir: devolve a lista nova ordenada, ou o erro que a tela mostra sem gravar nada.
export function incluirRepo(lista, valor) {
  const repo = normalizarRepo(valor);
  const atual = listaLimpa(lista);
  if (!REPO_OK.test(repo)) return { ok: false, erro: 'Use o formato owner/repo, como minha-org/meu-repo.' };
  if (atual.includes(repo)) return { ok: false, erro: `${repo} já está na lista.` };
  return { ok: true, repo, lista: [...atual, repo].sort() };
}

export function tirarRepo(lista, repo) {
  const alvo = String(repo || '').toLowerCase();
  return listaLimpa(lista).filter((r) => r !== alvo);
}

// Quantos PRs meus abertos (Meus PRs, todas as contas) são deste repo.
export function prsDoRepo(myPRs, repo) {
  const alvo = String(repo || '').toLowerCase();
  return (Array.isArray(myPRs) ? myPRs : []).filter((p) => String((p && p.key) || '').split('#')[0].toLowerCase() === alvo).length;
}

function metaDoRepo(n) {
  if (!n) return 'nenhum PR seu aberto agora';
  return n === 1 ? '1 PR seu aberto' : `${n} PRs seus abertos`;
}

// O bloco de Sistema > Automação, sem o campo de inclusão (que é fixo no index.html).
export function reposBloqueadosHtml(lista, myPRs) {
  const repos = [...listaLimpa(lista)].sort();
  const itens = repos.map((r) => `<li class="mb-item"><span class="mb-txt"><code class="mb-repo">${esc(r)}</code><span class="mb-meta">${esc(metaDoRepo(prsDoRepo(myPRs, r)))}</span></span><button class="btn sm danger-ghost mb-x" type="button" data-repo="${esc(r)}" aria-label="Tirar ${esc(r)} da lista">Tirar</button></li>`).join('');
  const livres = [...new Set((Array.isArray(myPRs) ? myPRs : []).map((p) => String((p && p.key) || '').split('#')[0].toLowerCase()).filter(Boolean))]
    .filter((r) => !repos.includes(r)).sort();
  const sugestoes = livres.map((r) => `<button class="mb-sug-btn" type="button" data-repo="${esc(r)}" aria-label="Bloquear ${esc(r)}">+ ${esc(r)}</button>`).join('');
  const contagem = repos.length ? plural(repos.length, 'repo', 'repos') : '';
  const comRotulo = sugestoes ? `<span>Dos seus PRs abertos:</span>${sugestoes}` : '';
  return { contagem, vazio: repos.length === 0, itens, sugestoes: comRotulo };
}

// Os toasts da inclusão e da retirada (o Desfazer é da tela).
export function textoDoMergeBloqueado(repo, n) {
  if (!n) return `${repo} bloqueado.`;
  return n === 1 ? `${repo} bloqueado. O Merge some de 1 PR seu.` : `${repo} bloqueado. O Merge some de ${n} PRs seus.`;
}

export function textoDoMergeDesbloqueado(repo) {
  return `${repo} desbloqueado. O Merge volta a valer nos seus PRs desse repo.`;
}

// Card de Meus PRs com o repo bloqueado: o title do botão e a linha com o atalho.
export function tituloDoMergeBloqueado(repo) {
  return `Merge bloqueado para ${repo} (lista em Sistema → Automação)`;
}

export function notaDoMergeBloqueadoHtml() {
  return '<p class="mypr-merge-nota">Merge bloqueado neste repo. <span class="is-goto" data-goto="sys:automation:#sys-row-mergeblocked" role="button" tabindex="0" title="Abrir Sistema → Automação">Ver a lista em Sistema → Automação</span></p>';
}
