// A nota do card de Meus PRs sobre o que a base fez com o PR (10/10/2026): conflito e PR
// superado pela base. O dado vem do engine (snapshot.baseDosMeusPRs, lib/engine/meus-prs-base.js),
// lido para TODO PR meu a cada ciclo, sem esperar autoanálise. O visual é a mesma linha
// discreta da nota de merge bloqueado (`mypr-merge-nota`, desenho do Claude Design de
// 03/10/2026): é um aviso de uma linha no mesmo lugar do card, não uma tela nova.
import { esc, plural } from './comum.js';

// "5 arquivos iguais e 2 com as mesmas linhas": diz como o Farol chegou à conclusão, porque
// "pode fechar" sem a prova é pedir que se acredite.
function comoConferiu(s) {
  const partes = [];
  if (s.iguais) partes.push(plural(s.iguais, 'arquivo idêntico', 'arquivos idênticos'));
  if (s.contidos) partes.push(`${plural(s.contidos, 'arquivo', 'arquivos')} com as mesmas linhas`);
  return partes.join(' e ');
}

export function notaDaBaseHtml(info) {
  if (!info) return '';
  const base = `<code>${esc(info.base || 'base')}</code>`;
  const s = info.superado || null;
  if (s && s.veredito === 'superado') {
    const prova = comoConferiu(s);
    return `<p class="mypr-merge-nota">Tudo o que este PR muda já está em ${base}: não sobrou nada para entregar, dá para fechar sem merge.${prova ? ` Conferido no código: ${esc(prova)}.` : ''}</p>`;
  }
  if (!info.conflito) return '';
  const parte = s && s.total && (s.iguais + s.contidos) > 0
    ? ` ${s.iguais + s.contidos} dos ${plural(s.total, 'arquivo', 'arquivos')} que ele muda já estão iguais lá.`
    : '';
  return `<p class="mypr-merge-nota">Em conflito com ${base}: atualize a branch antes do merge.${parte}</p>`;
}
