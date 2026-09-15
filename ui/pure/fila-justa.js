// Justiça de fila entre orgs e contas (spec 2026-09-10-justica-de-fila-entre-orgs).
//
// O painel existe porque uma automação que CEDE A VEZ, vista de fora, é idêntica a uma
// automação QUEBRADA: nos dois casos o PR fica parado e nada na tela explica. É a mesma
// lição do estacionamento visível (v2.57.4) e do rastro durável do gate de orçamento.
//
// Puro: recebe o `filaJusta` do snapshot e devolve HTML. Não decide nada.
//
// Extraído do ui/pure.js na Fase 1a da reorganização; o conteúdo não mudou. O import
// abaixo é a camada de baixo do diretório.

// "há 12m" / "agora" pra um intervalo já medido em ms (o snapshot manda a diferença
// pronta, não o instante, pra tela não depender do relógio da máquina bater com o do
// engine). null = nunca aconteceu.
import { esc, fmtDur } from './comum.js';
import { personMention } from './mencoes.js';

export function fjQuando(ms) {
  if (ms == null) return 'nunca';
  const d = fmtDur(ms);
  return d ? `há ${d}` : 'agora';
}

// US$ com 2 casas; null/indefinido vira travessão, nunca "NaN" nem "US$ 0.00" (que
// mentiria dizendo que existe teto zerado onde não existe teto nenhum).
export function fjMoeda(v) {
  // null/'' ANTES do Number: Number(null) e Number('') são 0 e finitos, e "US$ 0,00"
  // afirmaria que existe um teto zerado onde na verdade não existe teto nenhum, que é
  // a diferença entre "não pode gastar" e "não configurou".
  if (v == null || v === '') return '—';
  const n = Number(v);
  return Number.isFinite(n) ? `US$ ${n.toFixed(2)}` : '—';
}

function fjOrgsHtml(porOrg) {
  if (!porOrg || !porOrg.length) return '';
  const linhas = porOrg.map(o => {
    const espera = o.esperando > 0 ? `${o.esperando} esperando` : 'fila vazia';
    const maisAntigo = o.esperando > 0 && o.esperaMaisAntigaMs ? ` · mais antigo ${fjQuando(o.esperaMaisAntigaMs)}` : '';
    return `<tr>
      <td class="fj-org">${esc(o.org)}</td>
      <td>${esc(espera)}${esc(maisAntigo)}</td>
      <td class="fj-num">${esc(fjQuando(o.ultimaVezMs))}</td>
    </tr>`;
  }).join('');
  return `<div class="fj-bloco">
    <h4>Por org</h4>
    <p class="fj-nota">A próxima vaga vai para a org atendida há mais tempo. Dentro da mesma org, vale a ordem de chegada.</p>
    <table class="fj-tab"><thead><tr><th>Org</th><th>Fila</th><th class="fj-num">Última vez atendida</th></tr></thead><tbody>${linhas}</tbody></table>
  </div>`;
}

function fjContaHtml(c) {
  const pct = (Number.isFinite(c.cota) && c.cota > 0)
    ? Math.min(100, Math.round((Number(c.gasto) / c.cota) * 100)) : 0;
  // personMention e nao "@" + login na mao: a foto e o link vem de graca, e o
  // invariante da UI (ui-pure.test.js, pedido do Wanderson em 11/08/2026) exige que
  // TODA mencao de pessoa passe por ele, senao a assimetria volta painel a painel.
  // Sem foto aqui: sao as contas do proprio dono do app, numa lista curta, e o avatar
  // repetido brigaria com a barra de cota que e o assunto da linha.
  const para = (c.cedendoPara || []).map(u => personMention(u, '', true)).join(', ');
  let marca = '';
  if (c.cedendo) marca = `<span class="fj-tag fj-tag-cede">cedendo a vez para ${para}</span>`;
  else if (c.esperando) marca = '<span class="fj-tag">com PR esperando</span>';
  const peso = c.peso !== 1 ? ` <span class="fj-peso">peso ${esc(c.peso)}</span>` : '';
  return `<div class="fj-conta${c.cedendo ? ' is-cedendo' : ''}">
    <div class="fj-conta-top"><span class="fj-user">${personMention(c.user, '', true)}</span>${peso} ${marca}</div>
    <div class="fj-barra"><span style="width:${pct}%"></span></div>
    <div class="fj-conta-num">${esc(fjMoeda(c.gasto))} de ${esc(fjMoeda(c.cota))} hoje</div>
  </div>`;
}

function fjPerfisHtml(porPerfil) {
  const comDisputa = (porPerfil || []).filter(p => p.contas.length > 1);
  if (!comDisputa.length) return '';
  // o rotulo do perfil ja costuma comecar com "Perfil" (o default do app e "Perfil
  // atual"), e prefixar de novo dava "Perfil Perfil atual" na tela.
  return comDisputa.map(p => `<div class="fj-bloco">
    <h4>${/^perfil/i.test(String(p.label || '')) ? esc(p.label) : `Perfil ${esc(p.label)}`}</h4>
    <p class="fj-nota">Teto do dia ${esc(fjMoeda(p.tetoDoDia))}, dividido entre as contas que usam este perfil. A cota só barra quando outra conta está de fato esperando; sem disputa, quem chegar é atendido até o teto.</p>
    ${p.contas.map(fjContaHtml).join('')}
  </div>`).join('');
}

export function filaJustaHtml(fj) {
  if (!fj) return '';
  const global = fj.tetoGlobal > 0
    ? `<div class="fj-bloco"><h4>Teto global</h4><p class="fj-nota">${esc(fj.emCurso)} de ${esc(fj.tetoGlobal)} revisões simultâneas em curso, somando todas as contas.</p></div>`
    : '';
  const corpo = fjOrgsHtml(fj.porOrg) + fjPerfisHtml(fj.porPerfil) + global;
  // Sem nada a mostrar, o painel some inteiro em vez de exibir tabela vazia: uma org só
  // e um perfil só não têm rodízio nenhum pra explicar, e um card vazio parece defeito.
  return corpo;
}
