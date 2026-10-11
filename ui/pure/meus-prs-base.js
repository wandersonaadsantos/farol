// O aviso do card de Meus PRs sobre o que a base fez com o PR: conflito e PR superado pela
// base. Desenho do Claude Design de 10/10/2026
// (docs/superpowers/specs/2026-10-10-aviso-da-base-anexos/HANDOFF.md), três camadas do longe
// para o perto: a barra do card (`base-alerta`), o selo na linha da chave e o aviso abaixo do
// topo (uma linha no conflito, um bloco no superado). O dado vem do engine
// (snapshot.baseDosMeusPRs, lib/engine/meus-prs-base.js), lido para TODO PR meu a cada ciclo.
import { esc, plural } from './comum.js';
import { personMention } from './mencoes.js';

const MIN_MS = 60 * 1000;
const HORA_MS = 60 * MIN_MS;
const DIA_MS = 24 * HORA_MS;

// "1 min", "20 min", "2 h", "1 dia": a idade do último aviso quando a leitura de agora falhou
export function idadeDoAviso(at, agora = Date.now()) {
  const ms = Math.max(0, Number(agora) - Number(at || 0));
  if (ms < HORA_MS) return `${Math.max(1, Math.round(ms / MIN_MS))} min`;
  if (ms < DIA_MS) return `${Math.round(ms / HORA_MS)} h`;
  return plural(Math.round(ms / DIA_MS), 'dia', 'dias');
}

const code = (txt) => `<code>${esc(txt)}</code>`;

function linhaDaFalha(info, agora) {
  const f = info.falha;
  if (!f) return '';
  const semToken = f.motivo === 'sem-token' && f.conta;
  const motivo = semToken ? `: ${personMention(f.conta, 'xs', true)} está sem token` : ' no GitHub';
  return `<div class="mb-extra">Visto há ${esc(idadeDoAviso(info.at, agora))}. A leitura de agora falhou${motivo}.</div>`;
}

// "dos 7 arquivos que ele muda, 5 estão idênticos em staging e 2 têm todas as linhas dele"
function provaDoSuperado(s, base) {
  const { total, iguais, contidos } = s;
  const b = code(base);
  const resto = 'mais mudanças da própria base';
  if (!total) return `Conferido no código: desde o ancestral comum, este PR não muda nenhum arquivo em relação a ${b}.`;
  if (iguais && contidos) {
    const ig = iguais === 1 ? '1 está idêntico' : `${iguais} estão idênticos`;
    const ct = contidos === 1 ? '1 tem todas as linhas dele' : `${contidos} têm todas as linhas dele`;
    return `Conferido no código: dos ${total} arquivos que ele muda, ${ig} em ${b} e ${ct}, ${resto}.`;
  }
  const quem = total === 1 ? 'o arquivo que ele muda' : `os ${total} arquivos que ele muda`;
  if (iguais) return `Conferido no código: ${quem} ${total === 1 ? 'está idêntico' : 'estão idênticos'} em ${b}.`;
  return `Conferido no código: ${quem} ${total === 1 ? 'tem' : 'têm'} todas as linhas dele em ${b}, ${resto}.`;
}

function grupoDeArquivos(titulo, nomes, contagem) {
  if (!contagem) return '';
  const lista = nomes || [];
  const faltam = contagem - lista.length;
  const mais = faltam > 0 ? `<li>e mais ${esc(plural(faltam, 'arquivo', 'arquivos'))}</li>` : '';
  return `<div><b>${esc(titulo)} (${contagem})</b><ul>${lista.map(n => `<li>${esc(n)}</li>`).join('')}${mais}</ul></div>`;
}

// a lista só existe quando o engine mandou os nomes; sem eles, a contagem da prova basta
function listaDoSuperado(s) {
  const a = s.arquivos;
  if (!a || !((a.iguais || []).length || (a.contidos || []).length)) return '';
  return `<details class="ms-arquivos"><summary>Ver ${s.total === 1 ? 'o arquivo' : `os ${s.total} arquivos`}</summary><div class="ms-grupos">`
    + grupoDeArquivos('Idênticos na base', a.iguais, s.iguais)
    + grupoDeArquivos('Mesmas linhas, base tem mais', a.contidos, s.contidos)
    + '</div></details>';
}

function blocoDoSuperado(info, pr, agora) {
  const s = info.superado;
  const conflito = info.conflito ? ` O conflito com ${code(info.base)} não precisa ser resolvido.` : '';
  return '<div class="mypr-superado">'
    + `<div class="ms-titulo">Nada para entregar: tudo o que este PR muda já está em ${code(info.base)}.</div>`
    + `<div class="ms-prova">${provaDoSuperado(s, info.base)}${conflito}</div>`
    + listaDoSuperado(s)
    + linhaDaFalha(info, agora)
    + `<div class="ms-saida"><a class="btn sm primary ms-fechar" href="${esc(pr.url)}" target="_blank" rel="noopener">Fechar no GitHub ↗</a>`
    + '<span>Dá para fechar sem merge. O link abre o PR; quem fecha é você, lá.</span></div>'
    + '</div>';
}

function linhaDoConflito(info, pr, id, agora) {
  const s = info.superado;
  const naBase = s && s.veredito === 'nao' && s.total ? (s.iguais + s.contidos) : 0;
  const verbo = naBase === 1 ? 'está igual' : 'estão iguais';
  const parte = naBase > 0
    ? `<div class="mb-extra">${naBase} dos ${esc(plural(s.total, 'arquivo', 'arquivos'))} que ele muda já ${verbo} em ${code(info.base)}.</div>`
    : '';
  return `<div class="mypr-base" id="${esc(id)}"><span class="mb-marca" aria-hidden="true"></span><div class="mb-corpo">`
    + `<b>Em conflito com ${code(info.base)}.</b> Atualize a branch antes do merge. `
    + `<a class="mb-link" href="${esc(pr.url)}" target="_blank" rel="noopener">Abrir no GitHub ↗</a>`
    + parte + linhaDaFalha(info, agora)
    + '</div></div>';
}

// Tudo o que o card precisa, de uma vez: `alerta` (a barra), `selo` (na linha da chave),
// `html` (o aviso, antes da nota de merge e do painel da autoanálise) e `id`, para o Merge
// desabilitado apontar para o aviso com aria-describedby. Superado vence conflito, e
// inconclusivo aparece como conflito, sem nenhuma frase sobre a base.
export function avisoDaBaseNoCard(info, pr, agora = Date.now()) {
  const vazio = { alerta: false, selo: '', html: '', id: '', conflito: false };
  if (!info || !pr) return vazio;
  if (info.superado && info.superado.veredito === 'superado') {
    return { alerta: true, selo: '<span class="verdict base-superado">Superado pela base</span>', html: blocoDoSuperado(info, pr, agora), id: '', conflito: !!info.conflito };
  }
  if (!info.conflito) return vazio;
  const id = `base-${String(pr.key || '').replace(/[^A-Za-z0-9]+/g, '-')}`;
  return { alerta: true, selo: '<span class="verdict base-conflito">Em conflito</span>', html: linhaDoConflito(info, pr, id, agora), id, conflito: true };
}
