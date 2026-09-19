// Contas do GitHub nesta máquina x contas do Farol (v2.62.0): o bloco que aparece no topo de
// Sistema > Contas quando os dois lados divergem. O diagnóstico vem pronto do engine
// (`snapshot.contasGh`, lib/engine/contas-gh.js); aqui só vira texto e botão.
//
// Cada linha diz o que acontece HOJE por causa da divergência e oferece o ato que a resolve.
// Sem divergência nenhuma, o bloco não existe: aviso que diz "tudo certo" vira ruído que
// ninguém lê quando algo der errado.
import { esc } from './comum.js';
import { personMention } from './mencoes.js';

function lista(v) {
  return Array.isArray(v) ? v : [];
}

function linha(texto, acao) {
  return `<li class="contas-gh-item"><span>${texto}</span>${acao ? ` <span class="contas-gh-acao">${acao}</span>` : ''}</li>`;
}

function naoMonitorada(login) {
  return linha(`${personMention(login)} está logada no <code>gh</code> desta máquina e o Farol não a monitora: os PRs pedidos a ela não chegam aqui.`,
    `<button class="btn sm" data-gh-monitorar="${esc(login)}">Monitorar</button>`);
}

function semLogin(user) {
  return linha(`${personMention(user)} está no Farol sem login no <code>gh</code>: nada dela é buscado nem postado. Faça <code>gh auth login</code> com essa conta, ou tire-a do Farol.`,
    `<button class="btn sm ghost acct-remove" data-user="${esc(user)}">Remover do Farol</button>`);
}

function duplicada(d) {
  const contas = lista(d.contas);
  const [primeira, ...resto] = contas;
  const acoes = resto.map((u) => `<button class="btn sm ghost" data-gh-tirar-org="${esc(d.owner)}" data-user="${esc(u)}">Tirar de @${esc(u)}</button>`).join(' ');
  return linha(`A org <b>${esc(d.owner)}</b> está em ${contas.map((u) => personMention(u)).join(' e ')}. Vale a primeira da lista, ${personMention(primeira)}, e as outras só esperam.`, acoes);
}

const ORIGEM = {
  pedido: 'foi pedida como revisora em PRs dela',
  membro: 'é membro dela no GitHub',
};

function sugestao(s) {
  const porque = lista(s.origens).map((o) => ORIGEM[o]).filter(Boolean).join(' e ');
  return linha(`${personMention(s.conta)} ${esc(porque)}, mas a org <b>${esc(s.owner)}</b> não está nas orgs dela no Farol: o Panorama não mostra os PRs de lá.`,
    `<button class="btn sm" data-gh-add-org="${esc(s.owner)}" data-user="${esc(s.conta)}">Adicionar ${esc(s.owner)}</button>`);
}

export function contasGhVazio(diag) {
  const d = diag || {};
  return !lista(d.naoMonitoradas).length && !lista(d.semLogin).length && !lista(d.orgsDuplicadas).length && !lista(d.sugestoes).length;
}

export function contasGhHtml(diag) {
  if (!diag || contasGhVazio(diag)) return '';
  const itens = [
    ...lista(diag.semLogin).map(semLogin),
    ...lista(diag.naoMonitoradas).map(naoMonitorada),
    ...lista(diag.orgsDuplicadas).map(duplicada),
    ...lista(diag.sugestoes).map(sugestao),
  ];
  return `<div class="callout warn contas-gh"><div><b>O GitHub desta máquina e as contas do Farol não batem</b><ul class="contas-gh-lista">${itens.join('')}</ul></div></div>`;
}
