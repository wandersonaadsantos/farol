// Menções navegáveis: UM primitivo por tipo de coisa (pessoa, repo, PR, ferramenta,
// sessão). Extraído do ui/pure.js na Fase 1a da reorganização; o conteúdo não mudou.
//
// Regra do app (pedido do Wanderson, 11/08/2026): "se tem menção a uma coisa X
// ou Y eu deveria navegar até aquela coisa por clique". Toda menção passa por
// um destes helpers, pra o destino de cada tipo ser o MESMO em toda tela e
// ninguém precisar reinventar (nem esquecer) o link/foto no próximo painel:
//
// | menção | helper | destino |
// |---|---|---|
// | pessoa (@login) | personMention | perfil dela no GitHub |
// | repositório (owner/repo) | repoMention | repo no GitHub |
// | PR (owner/repo#N) | prRefMention | o PR no GitHub |
// | ferramenta (Kudos/Diagnóstico) | toolRefGoto | o painel dela no próprio app |
// | ref de sessão (coluna do Consumo) | sessionRefMention | roteia entre os de cima |
// | lugar do próprio app | data-goto (ui/app.js) | aba/seção/grupo, com destaque |
//
// Pessoa SEMPRE vem com foto: era a assimetria que o Wanderson apontou no
//
// A doutrina completa está no CLAUDE.md, seção "Menções navegáveis".
import { esc } from './comum.js';

/* ---- atribuição de conta pra memória (Destaques/Time) ---- */
export function ownerFromUrl(url) { const m = String(url || '').match(/github\.com\/([^\/]+)\//i); return m ? m[1] : ''; }

// Fronteira única dos links de PR que a UI torna clicáveis. Aceita query/fragmento
// copiados do navegador, mas devolve sempre a URL canônica, sem carregar esses dados.
export function canonicalGithubPrUrl(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { return ''; }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' || url.port || url.username || url.password) return '';
  const match = /^\/([^/]+)\/([^/]+)\/pull\/([1-9]\d*)\/?$/.exec(url.pathname);
  return match ? `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}` : '';
}

// 'https://github.com/owner/repo/pull/123' -> 'owner/repo#123' (o key canônico do app)
export function prKeyFromUrl(url) {
  const m = canonicalGithubPrUrl(url).match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)$/);
  return m ? `${m[1]}#${m[2]}` : '';
}

export function avatar(login, cls = '') {
  const initial = (login || '?').charAt(0).toUpperCase();
  return `<span class="avatar ${cls}">${esc(initial)}<img src="https://github.com/${encodeURIComponent(login)}.png?size=96" alt="" loading="lazy" onerror="this.remove()"></span>`;
}

const GH_URL = 'https://github.com/';

// owner/repo#N (o formato de `pr.key` e do `ref` das sessões). Só o que casa
// vira link: ref de ferramenta ("Kudos · BIUD trabalho") e "(sem referência)"
// seguem texto puro, sem inventar URL.
const PR_REF_RE = /^([\w.-]+)\/([\w.-]+)#(\d+)$/;

export function ghPrUrl(ref) {
  const m = PR_REF_RE.exec(String(ref || '').trim());
  return m ? `${GH_URL}${m[1]}/${m[2]}/pull/${m[3]}` : '';
}

// menção de pessoa: foto + @login, clicável pro perfil no GitHub. `cls` entra
// no avatar ('sm' nas linhas compactas). semFoto=true só onde a foto não cabe
// (linha de PR das Entregas, que já roda dentro de um grupo com a foto no topo).
export function personMention(login, cls = '', semFoto = false) {
  const nome = String(login || '').trim();
  if (!nome) return `<span class="person-mention vazio">@(desconhecido)</span>`;
  return `<a class="person-mention" href="${GH_URL}${encodeURIComponent(nome)}" target="_blank" rel="noreferrer" title="Abrir @${esc(nome)} no GitHub">`
    + `${semFoto ? '' : avatar(nome, cls)}<span class="pm-login">@${esc(nome)}</span></a>`;
}

// menção de repositório (owner/repo): leva ao repo no GitHub. `label` permite
// mostrar o nome curto e ainda assim linkar o caminho completo.
export function repoMention(repo, label) {
  const nome = String(repo || '').trim();
  if (!nome) return '';
  return `<a class="repo-mention" href="${GH_URL}${nome.split('/').map(encodeURIComponent).join('/')}" target="_blank" rel="noreferrer" title="Abrir ${esc(nome)} no GitHub">${esc(label || nome)}</a>`;
}

// menção de PR pela referência textual (owner/repo#N): vira link; qualquer
// outra coisa volta como texto escapado, no mesmo lugar, sem link quebrado.
export function prRefMention(ref, cls = '') {
  const url = ghPrUrl(ref);
  const txt = esc(String(ref || ''));
  if (!url) return `<span class="${esc(cls)}">${txt}</span>`;
  return `<a class="${esc(cls)} pr-ref-mention" href="${url}" target="_blank" rel="noreferrer" title="Abrir ${txt} no GitHub">${txt}</a>`;
}

// Lê um valor de data-goto ('tipo:alvo[:seletor]'). O seletor é o RESTO inteiro,
// nunca só o terceiro pedaço: seletor CSS tem ':' (`.acct-label:nth-child(2)`) e
// destino de Entregas tem '/' e ':' no meio.
export function parseGoto(spec) {
  const [tipo, alvo, ...resto] = String(spec ?? '').split(':');
  return { tipo: tipo || '', alvo: alvo || '', seletor: resto.join(':') };
}

// Ferramenta interna: o "lugar" dela não é uma URL, é um painel do próprio app,
// então o destino sai no formato data-goto do ui/app.js. Os rótulos são os que o
// lib/engine/tools.js monta pro ref da sessão ('Kudos', 'Kudos · <escopo>' e
// 'Diagnóstico do Farol'); o escopo é nome de conta, entra no rótulo mas NÃO no
// destino, que é constante.
const TOOL_REF_GOTO = [
  [/^Kudos( · .+)?$/, 'aba:destaques:#kudosPanel'],
  [/^Diagnóstico do Farol$/, 'sys:diag:#healthPanel'],
];

export function toolRefGoto(ref) {
  const s = String(ref ?? '').trim();
  for (const [re, destino] of TOOL_REF_GOTO) if (re.test(s)) return destino;
  return '';
}

// menção do ref de uma sessão (coluna "PR / sessão" do Consumo), que é polimórfico:
// revisão/pushback/chat gravam a chave do PR, ferramenta grava o rótulo dela. Cada
// um vai pro SEU destino; o que não se reconhece continua texto puro, no mesmo
// lugar, sem link quebrado nem clique que não leva a nada.
export function sessionRefMention(ref, cls = '') {
  if (ghPrUrl(ref)) return prRefMention(ref, cls);
  const txt = esc(String(ref || ''));
  const destino = toolRefGoto(ref);
  if (!destino) return `<span class="${esc(cls)}">${txt}</span>`;
  return `<span class="${esc(cls)} is-goto" data-goto="${esc(destino)}" role="button" tabindex="0" title="Abrir ${txt} no Farol">${txt}</span>`;
}

/* A célula da coluna "PR / sessão" do Consumo. DOIS destinos no mesmo lugar, e
   por isso dois elementos (a doutrina do app é um destino por elemento): o texto
   leva ao PR no GitHub, o botão ao lado abre a caixa de revisão AQUI DENTRO.
   Só linha de PR ganha o botão: ferramenta e sessão sem referência não têm
   revisão nenhuma pra abrir, e botão que não faz nada é pior que botão nenhum. */
export function sessionRefCell(ref, cls = 'usage-sessions-ref') {
  const mencao = sessionRefMention(ref, cls);
  if (!ghPrUrl(ref)) return `<span class="usage-ref-cell">${mencao}</span>`;
  const k = esc(String(ref));
  return `<span class="usage-ref-cell">${mencao}`
    + `<button class="usage-review-btn" data-review-key="${k}" title="Ver a revisão de ${k} aqui no Farol" aria-label="Ver a revisão de ${k} aqui no Farol">`
    + `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 5h16M4 12h10M4 19h7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`
    + `</button></span>`;
}
