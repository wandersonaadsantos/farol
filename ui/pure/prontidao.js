// A faixa de prontidão de um PR na tela (07/11/2026): checks obrigatórios, reviewers e merge.
// Recebe o registro que o motor grava em `prontidao[key]` (lib/engine/prontidao-pr-estado.js,
// onde mora a tabela de estados) e devolve as três pílulas (tom, rótulo, valor, forma curta,
// avatares), os pontos do Panorama e as linhas do detalhe. Só texto e dado: o HTML sai de
// prontidao-html.js. Desenho: docs/superpowers/specs/2026-11-07-meus-prs-prontidao-anexos/.
//
// Cinco tons, nenhuma cor nova: ok (--ok, resolvido), run (--info, o GitHub está rodando),
// wait (--accent, espera alguém), fail (--danger, trava), none (--muted, não se aplica).
import { plural } from './comum.js';

export const ROTULOS_DA_PRONTIDAO = { checks: 'Checks obrigatórios', reviewers: 'Reviewers', merge: 'Merge' };
const TONS = new Set(['ok', 'run', 'wait', 'fail', 'none']);

// classe de tom (t-ok, t-run, t-wait, t-fail, t-none); tom desconhecido vira o neutro
export function tomDaProntidao(tom) {
  return `t-${TONS.has(tom) ? tom : 'none'}`;
}

function nomeDoCheck(lista, estado) {
  return lista.filter(c => c.estado === estado).map(c => c.nome);
}

function pilulaDosChecks(c) {
  const p = { id: 'checks', rotulo: ROTULOS_DA_PRONTIDAO.checks, tom: c.tom };
  const falhou = nomeDoCheck(c.lista || [], 'falhou');
  const rodando = nomeDoCheck(c.lista || [], 'rodando');
  const ausente = nomeDoCheck(c.lista || [], 'ausente');
  if (c.tom === 'none' && c.regraLegivel === false) return { ...p, valor: 'Regra não legível', curto: 'Regra não legível' };
  if (c.tom === 'none') return { ...p, valor: 'Nenhum exigido', curto: 'Nenhum' };
  if (c.tom === 'fail') {
    return falhou.length === 1
      ? { ...p, valor: `1 falhando · ${falhou[0]}`, curto: `${falhou[0]} falhou` }
      : { ...p, valor: `${falhou.length} falhando`, curto: `${falhou.length} falharam` };
  }
  if (c.tom === 'run') return { ...p, valor: `${c.verdes} de ${c.total} · ${rodando.length} rodando`, curto: `${c.verdes}/${c.total} rodando` };
  if (c.tom === 'wait') {
    const quem = ausente.length === 1 ? ` · ${ausente[0]}` : '';
    return { ...p, valor: `${plural(ausente.length, 'não rodou', 'não rodaram')}${quem}`, curto: ausente.length === 1 ? `${ausente[0]} não rodou` : `${ausente.length} não rodaram` };
  }
  return { ...p, valor: `${c.verdes} de ${c.total} verdes`, curto: `${c.verdes}/${c.total}` };
}

const TOM_DO_REVIEWER = { aprovou: 'ok', 'aprovou-antigo': 'wait', mudanca: 'fail', comentou: 'none', aguardando: 'wait' };
const ESTADO_DO_REVIEWER = {
  aprovou: 'aprovou no head', 'aprovou-antigo': 'aprovou commit antigo', mudanca: 'pediu mudanças',
  comentou: 'comentou', aguardando: 'aguardando',
};

// "0 de 2 aprovou", "1 de 2 aprovou", "2 de 2 aprovaram", como no desenho
function aprovou(n) { return n > 1 ? 'aprovaram' : 'aprovou'; }

// A frase dos reviewers quando ainda falta alguém. "Você" entra pelo nome, porque em Pra mim
// a pergunta é se falta a SUA aprovação.
function valorEsperando(r) {
  const lista = r.lista || [];
  const aprovadores = lista.filter(x => x.estado === 'aprovou');
  const voceEspera = lista.some(x => x.voce && x.estado === 'aguardando');
  const base = r.exigidas > 0 ? r.exigidas : lista.length;
  const curto = base > 0 ? `${r.aprovadasNoHead}/${base}` : 'Falta';
  if (voceEspera) {
    const curtoDaSua = r.exigidas > 0 ? curto : 'Falta a sua';
    if (aprovadores.length) return { valor: `${aprovadores[0].quem} ${aprovou(1)}, falta você`, curto: curtoDaSua };
    const outros = lista.filter(x => !x.voce && x.estado === 'aguardando').length;
    const valor = outros ? `Você e mais ${outros}, ninguém aprovou` : 'Só você marcado';
    return { valor, curto: curtoDaSua };
  }
  if (r.aprovadasAntigas > 0 && r.aprovadasNoHead < base) return { valor: 'Aprovação antiga', curto };
  if (base > 0) return { valor: `${r.aprovadasNoHead} de ${base} ${aprovou(r.aprovadasNoHead)}`, curto };
  return { valor: 'Aprovação exigida', curto: 'Falta' };
}

function pilulaDosReviewers(r) {
  const lista = r.lista || [];
  const p = {
    id: 'reviewers', rotulo: ROTULOS_DA_PRONTIDAO.reviewers, tom: r.tom,
    avatares: lista.filter(x => !x.time).slice(0, 4).map(x => ({ login: x.quem, tom: TOM_DO_REVIEWER[x.estado] || 'none', titulo: `${x.quem} ${ESTADO_DO_REVIEWER[x.estado] || ''}`.trim() })),
  };
  if (r.tom === 'fail') return { ...p, valor: 'Mudança pedida', curto: 'Mudança pedida' };
  if (r.tom === 'wait') return { ...p, ...valorEsperando(r) };
  if (r.tom === 'ok') {
    if (r.exigidas > 0) return { ...p, valor: `${r.aprovadasNoHead} de ${r.exigidas} ${aprovou(r.aprovadasNoHead)}`, curto: `${r.aprovadasNoHead}/${r.exigidas}` };
    return { ...p, valor: r.aprovadasNoHead ? `${r.aprovadasNoHead} ${aprovou(r.aprovadasNoHead)}` : 'Aprovado', curto: 'Aprovado' };
  }
  return lista.length ? { ...p, valor: 'Não exigido', curto: 'Não exigido' } : { ...p, valor: 'Nenhum marcado', curto: 'Ninguém' };
}

function faltaAprovacao(reg) {
  const r = reg.reviewers || {};
  const voce = (r.lista || []).some(x => x.voce && x.estado === 'aguardando');
  if (voce && (!(r.faltam > 1))) return { valor: 'Bloqueado · falta a sua aprovação', curto: 'Falta a sua' };
  if (r.faltam > 0) return { valor: `Bloqueado · falta ${plural(r.faltam, 'aprovação', 'aprovações')}`, curto: `Falta ${plural(r.faltam, 'aprovação', 'aprovações')}` };
  return { valor: 'Bloqueado · falta aprovação', curto: 'Falta aprovação' };
}

const MERGE_FIXO = {
  pronto: ['Pronto pra merge', 'Pronto'],
  'esperando-checks': ['Esperando os checks', 'Esperando checks'],
  'check-ausente': ['Bloqueado · check não rodou', 'Bloqueado'],
  atras: ['Atrás da base', 'Atrás da base'],
  conflito: ['Conflito com a base', 'Conflito'],
  rascunho: ['Rascunho', 'Rascunho'],
  verificando: ['Verificando…', 'Verificando'],
  bloqueado: ['Bloqueado', 'Bloqueado'],
  'check-falhando': ['Bloqueado · check falhando', 'Bloqueado'],
  'mudanca-pedida': ['Bloqueado · mudança pedida', 'Bloqueado'],
};

function pilulaDoMerge(reg, ctx) {
  const m = reg.merge || {};
  const p = { id: 'merge', rotulo: ROTULOS_DA_PRONTIDAO.merge, tom: m.tom };
  if (ctx.repoBloqueado) return { ...p, tom: 'none', valor: 'Repo bloqueado', curto: 'Repo bloqueado' };
  if (m.tom === 'fail' && (m.motivos || []).length > 1) return { ...p, valor: `Bloqueado · ${m.motivos.length} motivos`, curto: 'Bloqueado' };
  if (m.motivo === 'falta-aprovacao') return { ...p, ...faltaAprovacao(reg) };
  const [valor, curto] = MERGE_FIXO[m.motivo] || MERGE_FIXO.verificando;
  return { ...p, valor, curto };
}

// As três pílulas, na ordem Checks, Reviewers, Merge. Sem registro: lista vazia (a tela
// mostra o estado neutro discreto, nunca erro). ctx: { repoBloqueado }.
export function pilulasDaProntidao(reg, ctx = {}) {
  if (!reg || !reg.checks || !reg.reviewers || !reg.merge) return [];
  return [pilulaDosChecks(reg.checks), pilulaDosReviewers(reg.reviewers), pilulaDoMerge(reg, ctx)];
}

// A forma curta da Compacta: ["7/7", "1/2", "Falta 1 aprovação"].
export function formaCurtaDaProntidao(reg, ctx = {}) {
  return pilulasDaProntidao(reg, ctx).map(p => p.curto);
}

// Os três pontos do Panorama, com o texto completo para title e aria-label.
export function pontosDaProntidao(reg, ctx = {}) {
  const pilulas = pilulasDaProntidao(reg, ctx);
  if (!pilulas.length) return { tons: ['none', 'none', 'none'], rotulo: 'Checks, reviewers e merge ainda não lidos' };
  return { tons: pilulas.map(p => p.tom), rotulo: pilulas.map(p => `${p.rotulo}: ${p.valor}`).join(' · ') };
}

// Resumo do topo: "1 pronto pra merge · 2 esperando · 1 travado", pela pílula Merge.
export function resumoDaProntidao(regs) {
  const out = { prontos: 0, esperando: 0, travados: 0 };
  for (const reg of regs || []) {
    const tom = reg && reg.merge && reg.merge.tom;
    if (tom === 'ok') out.prontos++;
    else if (tom === 'fail') out.travados++;
    else if (tom === 'run' || tom === 'wait') out.esperando++;
  }
  return out;
}

// A barra esquerda do card segue a pílula Merge (sem autoanálise; com ela vale o selo).
export function barraDaProntidao(reg, ctx = {}) {
  const pilulas = pilulasDaProntidao(reg, ctx);
  const tom = pilulas.length ? pilulas[2].tom : '';
  return tom && tom !== 'none' ? `pron-b-${tom}` : '';
}

const ESTADO_DO_CHECK = { verde: ['passou', 'ok'], rodando: ['rodando', 'run'], falhou: ['falhou', 'fail'], ausente: ['não rodou neste head', 'wait'] };

function detalheDosChecks(reg) {
  const c = reg.checks;
  const head = reg.headSha ? ` · no head ${String(reg.headSha).slice(0, 7)}` : '';
  const linhas = (c.lista || []).map(x => ({ nome: x.nome, codigo: true, estado: ESTADO_DO_CHECK[x.estado][0], tom: ESTADO_DO_CHECK[x.estado][1] }));
  let nota = 'Vale a rodada mais recente de cada nome exigido.';
  if (c.semExigencia) nota = c.regraLegivel ? 'A branch não exige check obrigatório.' : 'Regra da branch não legível: sem a lista dos checks exigidos.';
  if ((c.foraDaConta || []).length) nota += ` Fora da conta: ${c.foraDaConta.join(', ')} (veredito de bot de review, não é sinal de pipe).`;
  return { titulo: `Checks obrigatórios da ${reg.base || 'branch'}${head}`, linhas, nota };
}

function regraDosReviewers(r) {
  if (r.exigidas > 0) return `a branch exige ${plural(r.exigidas, 'aprovação', 'aprovações')}${r.codeOwner ? ' e code owner' : ''}`;
  return r.regraLegivel ? 'a branch não exige aprovação' : 'regra da branch não legível';
}

// time não vira menção de pessoa: aparece pelo slug, sem abrir os membros
function linhaDoReviewer(x) {
  const base = { voce: !!x.voce, estado: ESTADO_DO_REVIEWER[x.estado] || x.estado, tom: TOM_DO_REVIEWER[x.estado] || 'none' };
  if (x.time) return { ...base, pessoa: '', nome: `time ${x.quem}` };
  return { ...base, pessoa: x.quem, nome: x.quem };
}

function detalheDosReviewers(reg) {
  const r = reg.reviewers;
  const linhas = (r.lista || []).map(linhaDoReviewer);
  let nota = 'Aprovação só conta no commit atual.';
  if (!linhas.length) nota += ' Ninguém marcado ainda.';
  if (!r.regraLegivel) nota += ' Sem a regra legível, a pílula segue a decisão de revisão do GitHub.';
  return { titulo: `Reviewers · ${regraDosReviewers(r)}`, linhas, nota };
}

// um requisito do merge: ok, ou o estado e o tom de quando ele não está atendido
function requisito(nome, falha, estado, tom) {
  return falha ? { nome, estado, tom } : { nome, estado: 'ok', tom: 'ok' };
}

function detalheDoMerge(reg, ctx) {
  const m = reg.merge, r = reg.reviewers;
  const checks = pilulaDosChecks(reg.checks);
  const linhas = [
    requisito('Sem conflito com a base', m.motivo === 'conflito', 'conflito', 'fail'),
    requisito('Branch em dia com a base', m.motivo === 'atras', 'atrás', 'wait'),
  ];
  if (reg.checks.tom !== 'none') linhas.push({ nome: 'Checks obrigatórios', estado: checks.curto, tom: checks.tom });
  if (r.exigidas > 0) linhas.push(requisito(`Aprovações (${plural(r.exigidas, 'exigida', 'exigidas')})`, r.faltam > 0, `falta ${r.faltam}`, 'wait'));
  if ((r.lista || []).length) linhas.push(requisito('Nenhuma mudança pedida em aberto', r.mudancaPedida > 0, plural(r.mudancaPedida, 'aberta', 'abertas'), 'fail'));
  if (m.motivo === 'rascunho') linhas.push({ nome: 'Pronto para revisão (não rascunho)', estado: 'rascunho', tom: 'none' });
  let nota = `Estado do merge no GitHub: ${m.status || 'UNKNOWN'}. A pílula informa; o botão Merge continua dependendo da autoanálise.`;
  if (ctx.repoBloqueado) nota = 'Repo bloqueado para merge pelo Farol (Sistema > Automação): o Farol nem lê a mergeabilidade para o botão.';
  return { titulo: 'O que o GitHub exige pra mergear', linhas, nota };
}

// As linhas do detalhe de UMA pílula: { titulo, linhas: [{ nome, estado, tom, pessoa?,
// codigo?, voce? }], nota }. `pessoa` sai como menção navegável no HTML (personMention).
export function linhasDoDetalhe(id, reg, ctx = {}) {
  if (!pilulasDaProntidao(reg, ctx).length) return null;
  if (id === 'checks') return detalheDosChecks(reg);
  if (id === 'reviewers') return detalheDosReviewers(reg);
  if (id === 'merge') return detalheDoMerge(reg, ctx);
  return null;
}
