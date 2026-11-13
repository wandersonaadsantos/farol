/* Uso do plano e validade do login em Sistema > Plano e chaves (12/11/2026). PURA.

   O que a tela mostra de um perfil do Claude por assinatura: cada janela do plano (sessão,
   semana, semana por modelo) com o percentual usado e a hora em que volta, e quando o login
   deixa de se renovar sozinho. Vem lido do engine (`cadeiaPerfis.entradas[].uso`, lib/engine/
   uso-do-plano.js, usoParaTela): o engine já diz em que faixa o vencimento está, e aqui só
   se escolhe a cor da barra e se diz em palavras. Desenho no Claude Design, handoff em
   docs/superpowers/specs/2026-11-12-uso-do-plano-anexos/HANDOFF.md. */
import { esc, fmtWhenDay } from './comum.js';

// A barra muda de cor por faixa de uso: âmbar perto do limite, vermelha quase nele.
const USO_ALTO = 0.7;
const USO_CRITICO = 0.9;
const HORA_MS = 3600 * 1000;
const DIA_MS = 24 * HORA_MS;

// "volta hoje 05:59", "volta 15/11 04:59": fmtWhenDay é o formato de dia e hora do app
function voltaEmTexto(j, agora) {
  if (j.reset) return `volta ${fmtWhenDay(j.reset, agora)}`;
  return j.resetTexto ? `volta ${j.resetTexto}` : '';
}

function classeDoUso(usado) {
  if (usado >= USO_CRITICO) return ' uso-critico';
  return usado >= USO_ALTO ? ' uso-alto' : '';
}

function janelaHtml(j, agora) {
  const usado = Math.min(1, Math.max(0, Number(j.usado) || 0));
  const pct = Math.round(usado * 100);
  const nome = j.nome || 'Uso';
  return `<span class="uso-janela${classeDoUso(usado)}">
    <span class="uso-topo"><span class="uso-nome">${esc(nome)}</span><span class="uso-pct">${pct}%</span></span>
    <span class="uso-barra" role="img" aria-label="${esc(nome)}: ${pct}% usados"><span class="uso-fill" style="width: ${pct}%"></span></span>
    <span class="uso-volta">${esc(voltaEmTexto(j, agora))}</span>
  </span>`;
}

function faltaEmTexto(ms) {
  if (ms < DIA_MS) return `${Math.max(1, Math.round(ms / HORA_MS))} h`;
  const dias = Math.floor(ms / DIA_MS);
  return dias === 1 ? '1 dia' : `${dias} dias`;
}

const COMO_RENOVAR = 'Renove pela sessão de login do perfil.';

/**
 * A linha da validade do login. `faixa` vem do engine: '' (longe), 'perto', 'ultimo-dia' ou
 * 'vencido'.
 */
function validadeDoLoginHtml(uso, agora = Date.now()) {
  const vence = Number(uso && uso.venceEm) || 0;
  if (!vence) return '';
  const data = fmtWhenDay(vence, agora);
  if (uso.faixaDoLogin === 'vencido') {
    return `<span class="uso-login"><span class="pill err">Login vencido</span><span class="uso-login-txt">Desde ${esc(data)}. ${COMO_RENOVAR}</span></span>`;
  }
  const falta = faltaEmTexto(Math.max(0, vence - agora));
  if (uso.faixaDoLogin === 'perto' || uso.faixaDoLogin === 'ultimo-dia') {
    const tom = uso.faixaDoLogin === 'ultimo-dia' ? 'err' : 'session';
    return `<span class="uso-login"><span class="pill ${tom}">Login vence em ${esc(falta)}</span><span class="uso-login-txt">${esc(data)}. ${COMO_RENOVAR}</span></span>`;
  }
  return `<span class="uso-login uso-login-longe">Login vence ${esc(data)} (faltam ${esc(falta)})</span>`;
}

/**
 * O uso do plano e a validade do login de um perfil, para a ordem de uso e o cartão do perfil.
 * `null` (perfil que não é assinatura do Claude) não desenha nada.
 * @param {{ lido?: boolean, ok?: boolean, erro?: string, venceEm?: number, faixaDoLogin?: string, janelas?: Array<{id:string,nome:string,usado:number,reset:number,resetTexto?:string}> } | null} uso
 */
function usoDoPlanoHtml(uso, agora = Date.now()) {
  if (!uso) return '';
  if (!uso.lido) return '<span class="set-desc uso-plano">Uso do plano ainda não lido: o Farol lê sozinho, sem gastar nada.</span>';
  const janelas = Array.isArray(uso.janelas) ? uso.janelas : [];
  const corpo = uso.ok && janelas.length
    ? `<span class="uso-janelas">${janelas.map((j) => janelaHtml(j, agora)).join('')}</span>`
    : `<span class="set-desc">Uso do plano não lido: ${esc(uso.erro || 'o Claude Code não respondeu')}.</span>`;
  // a leitura mais recente falhou e o engine manteve a anterior: a tela diz de quando ela é
  const velho = uso.desatualizado && uso.ok
    ? `<span class="set-desc">Não foi possível atualizar agora. Uso lido ${esc(fmtWhenDay(uso.lidaEm, agora))}.</span>`
    : '';
  return `<span class="uso-plano">${corpo}${velho}${validadeDoLoginHtml(uso, agora)}</span>`;
}

export { usoDoPlanoHtml, validadeDoLoginHtml };
