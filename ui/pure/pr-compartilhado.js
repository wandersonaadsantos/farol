// O nome de um PR que chegou de outro aparelho (visão compartilhada, brief B2, item 2.7).
//
// Pendência e andamento viajam com o PR como TAG. O engine resolve a tag pelo catálogo
// cifrado e entrega `pr: { key, account, title, author }`, ou `null` quando o catálogo não
// está disponível (chave de outra época, linha que não abre, PR que ninguém catalogou).
// Esta função é a ÚNICA que transforma esse campo em texto, para os dois blocos da tela
// dizerem a mesma coisa: com nome, a menção navegável, o título e o autor; sem nome, o
// rótulo genérico que a tela passar, nunca um palpite.
import { esc } from './comum.js';
import { personMention, prRefMention } from './mencoes.js';

const REF_DE_PR = /^[\w.-]+\/[\w.-]+#\d+$/;

// PR com chave no formato owner/repo#N; o resto (vazio, lixo, objeto sem chave) é genérico
export function prIdentificado(pr) {
  return !!pr && typeof pr === 'object' && REF_DE_PR.test(String(pr.key || ''));
}

export function prIdentificadoHtml(pr, generico) {
  if (!prIdentificado(pr)) return `<span class="md-pr-generico">${esc(generico || 'um PR')}</span>`;
  const titulo = pr.title ? ` <span class="md-pr-titulo">${esc(pr.title)}</span>` : '';
  const autor = pr.author ? ` <span class="md-pr-autor">de ${personMention(pr.author, 'xs')}</span>` : '';
  return `<span class="md-pr">${prRefMention(pr.key, 'md-pr-ref')}${titulo}${autor}</span>`;
}
