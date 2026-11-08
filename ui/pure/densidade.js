// A Compacta de Pra mim (07/11/2026): o estado de cada PR numa frase, a ação principal, o
// resumo do topo que leva às seções e o rodapé de Revisões recentes. A Expandida continua
// sendo os cards de sempre. Desenho: artboard PraMim em
// docs/superpowers/specs/2026-11-07-meus-prs-prontidao-anexos/PraMim.dc.html.
import { esc, plural, localDayKey } from './comum.js';
import { tituloDoAprovarDesligado } from './review.js';

export const DENSIDADES = ['compacta', 'expandida'];

// preferência lida do armazenamento local: qualquer coisa fora das duas vira a padrão
export function densidadeValida(valor) {
  return DENSIDADES.includes(valor) ? valor : 'compacta';
}

// O card de "Precisa de você" numa frase: "Aprovar com 2 ressalvas", "Pedir mudanças · 1 motivo".
export function fraseDaDecisao(d, meta = {}) {
  if (meta.stale) return { texto: 'Commit novo depois da revisão', tom: 'wait' };
  const n = Array.isArray(meta.reasons) ? meta.reasons.length : 0;
  if (d && d.verdict === 'approve') return { texto: n ? `Aprovar com ${plural(n, 'ressalva', 'ressalvas')}` : 'Aprovar', tom: 'wait' };
  return { texto: n ? `Pedir mudanças · ${plural(n, 'motivo', 'motivos')}` : 'Pedir mudanças', tom: 'fail' };
}

// A única ação da linha compacta: a principal. As outras (Comentar, Pular) ficam no card cheio.
export function acaoDaDecisaoHtml(d, meta = {}, ciObrigatorio = true) {
  if (meta.stale || meta.semDecisivos) {
    const revisar = (meta.reviewBtn === 'primary' || meta.reviewBtn === 'secondary') && d?.pr?.url;
    return revisar ? `<button class="btn primary sm act-review" data-url="${esc(d.pr.url)}">Revisar agora</button>` : '';
  }
  if (d && d.verdict === 'approve') {
    const desligado = meta.approveDisabled ? ` disabled title="${esc(tituloDoAprovarDesligado(ciObrigatorio))}"` : '';
    return `<button class="btn ok sm dec-act" data-action="approve"${desligado}>Aprovar</button>`;
  }
  return '<button class="btn sm dec-act dec-rc" data-action="request_changes">Pedir mudanças</button>';
}

// "Resolução automática": nada a fazer, o Farol posta sozinho quando o CI ou a análise fechar.
export function fraseDaEspera(ciObrigatorio) {
  return { texto: ciObrigatorio ? 'Esperando os checks · posta sozinho' : 'Resolvendo sozinho', tom: 'run' };
}

// O PR da fila numa frase: parado, checks rodando, pedido de novo ou a posição na fila.
export function fraseDaFila(pr, o = {}) {
  if (o.parado) return { texto: 'Revisão automática parada', tom: 'fail' };
  if (o.checksRodando) return { texto: 'Checks obrigatórios rodando', tom: 'wait' };
  if (pr && pr.reRequested) return { texto: 'Pedida de novo', tom: 'wait' };
  return { texto: `${Number(o.posicao) || 1}º na fila`, tom: 'none' };
}

export function fraseDaFilaDeExecucao(distribuindo) {
  return { texto: distribuindo ? 'Esperando distribuição' : 'Na fila de execução', tom: 'run' };
}

// Quantas revisões do histórico recente foram resolvidas hoje (dia local).
export function resolvidasHoje(resolved, agora = Date.now()) {
  const hoje = localDayKey(agora);
  return (resolved || []).filter(r => r && r.resolvedAt && localDayKey(r.resolvedAt) === hoje).length;
}

// O rodapé que substitui Revisões recentes na Compacta: "2 resolvidas hoje · mostrar".
export function rodapeDasRecentes(hoje, total, aberto) {
  if (aberto) return 'Esconder revisões recentes';
  if (hoje > 0) return `${plural(hoje, 'resolvida hoje', 'resolvidas hoje')} · mostrar`;
  return `${plural(total, 'revisão recente', 'revisões recentes')} · mostrar`;
}

function precisam(n) { return n === 1 ? '1 precisa de você' : `${n} precisam de você`; }
function sozinhos(n) { return n === 1 ? '1 se resolve sozinho' : `${n} se resolvem sozinhos`; }

const ITENS_DO_RESUMO = [
  ['analisando', 't-run', 'aba:radar:#activeWrap', n => `${n} analisando`],
  ['precisam', 't-wait', 'aba:radar:#decisionsWrap', precisam],
  ['sozinhos', 't-run', 'aba:radar:#esperaCiWrap', sozinhos],
  ['fila', 't-none', 'aba:radar:#queueSection', n => `${n} na fila`],
  ['resolvidas', 't-ok', 'aba:radar:#resolvedWrap', n => plural(n, 'resolvida hoje', 'resolvidas hoje')],
];

// A linha do topo de Pra mim: cada item leva à sua seção (data-goto). Vazio sem nada a contar.
export function resumoPraMimHtml(contagem = {}) {
  const itens = ITENS_DO_RESUMO.filter(([campo]) => Number(contagem[campo]) > 0).map(([campo, tom, goto, texto]) =>
    `<button type="button" class="pron-resumo-item" data-goto="${goto}"><span class="pl-estado ${tom}"><span class="pl-pt" aria-hidden="true"></span></span>${esc(texto(Number(contagem[campo])))}</button>`);
  return itens.length ? `<div class="pron-resumo-mim" aria-label="Resumo do que está acontecendo">${itens.join('')}</div>` : '';
}
