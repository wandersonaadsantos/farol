// A fila de um aparelho executor, vista do admin (controle do celular, 28/09/2026). PURA.
// Desenho: docs/superpowers/specs/2026-09-28-controle-do-celular-anexos/HANDOFF-claude-design.md.
//
// A fila junta três fontes do mesmo aparelho, pela tag do PR: a linha do Panorama que ele
// publica (com `fila`, o estado de cada PR pedido a ele), as pendências que ele publica
// (esperando decisão) e as sessões ao vivo dele. Pendência e sessão vencem a linha, porque
// são mais novas: o Panorama sobe no ciclo de polling, e elas a cada 10 s.
//
// FALHA NÃO SE DISFARÇA DE VAZIO: carregando, falhou, vazia e versão antiga são quatro
// miolos diferentes, com texto e cor próprios.
import { esc, fmtClock, fmtWhenDay, plural } from './comum.js';
import { avatar, personMention, prRefMention } from './mencoes.js';

// grupos fixos, nesta ordem (HANDOFF, seção 1)
const GRUPOS = [
  { id: 'pedem', titulo: 'Pedem você', sub: 'O aparelho revisou e espera sua decisão.' },
  { id: 'revisando', titulo: 'Revisando agora', sub: 'Ao vivo, atualiza a cada 10 s.' },
  { id: 'fila', titulo: 'Na fila', sub: 'Ainda não começaram.' },
  { id: 'parados', titulo: 'Parados', sub: 'Não andam sozinhos. Cada um diz o porquê.' },
  { id: 'feitos', titulo: 'Revisados e ignorados', sub: 'Saíram da fila.' },
];
const FILTROS = [['tudo', 'Tudo'], ['pedem', 'Pedem você'], ['revisando', 'Revisando'], ['fila', 'Na fila'], ['parados', 'Parados'], ['feitos', 'Feitos']];

const GRUPO_DO_ESTADO = {
  decidir: 'pedem', revisando: 'revisando',
  esperando: 'fila', 'sem-automatica': 'fila', retry: 'fila',
  estacionado: 'parados', 'saiu-de-cena': 'parados', 'limite-plano': 'parados', 'espera-grupo': 'parados',
  visto: 'feitos', ignorado: 'feitos',
};

const CHIP = {
  decidir: ['warn', 'decidir'], revisando: ['info', 'revisando'], esperando: ['mute', 'esperando'],
  'sem-automatica': ['warn', 'sem automática'], retry: ['info', 'nova tentativa'],
  estacionado: ['bad', 'estacionado'], 'saiu-de-cena': ['mute', 'saiu de cena'],
  'limite-plano': ['mute', 'limite do plano'], 'espera-grupo': ['mute', 'espera do grupo'],
  visto: ['ok', 'visto'], ignorado: ['mute', 'ignorado'],
};

const PARADO = {
  cancelado: 'parou: cancelada por você', esgotado: 'parou: falhou várias vezes seguidas',
  falha: 'parou: a revisão falhou', orcamento: 'parou: o orçamento estourou',
  autenticacao: 'parou: a credencial da revisão expirou', legado: 'parou antes desta versão',
};
const VEREDITO = { approve: 'aprovar', request_changes: 'pedir mudanças', comment: 'comentar' };
const ETAPA = {
  preparo: 'preparando', leitura: 'lendo o diff', card: 'conferindo o card', verificacao: 'verificando',
  raciocinio: 'raciocinando', fechamento: 'fechando',
};

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function lista(v) {
  return Array.isArray(v) ? v : [];
}

function quando(at) {
  return at ? fmtWhenDay(at) : '';
}

// O item a partir do PR em claro (linha do Panorama, ou `pr` que o catálogo resolveu).
function itemDoPr(pr, prTag, extra) {
  const p = objeto(pr) ? pr : {};
  return { prTag, key: String(p.key || ''), url: String(p.url || ''), title: String(p.title || ''), author: String(p.author || ''), account: String(p.account || ''), acctTag: '', updatedAt: p.updatedAt || '', fila: null, pend: null, op: null, ...extra };
}

// Junta as três fontes do aparelho `dev`. `listas` é a projeção de `sync-lists`.
function itemDaLinha(l, escopo) {
  const extra = { fila: l.fila, acctTag: String(escopo.acctTag || ''), account: String(l.account || escopo.account || '') };
  return itemDoPr(l, l.prTag, extra);
}

function linhasDoAparelho(listas, dev) {
  const escopos = lista(listas && listas.escopos).filter((e) => e && e.tipo === 'panorama' && e.dev === dev);
  return escopos.flatMap((e) => lista(e.linhas).filter((l) => l && l.fila && l.prTag).map((l) => itemDaLinha(l, e)));
}

// Pendência e sessão viva vencem o estado da linha: são mais novas que o Panorama.
function sobrepor(porTag, fonte, campo, estado) {
  const it = porTag.get(fonte.prTag) || itemDoPr(fonte.pr, fonte.prTag);
  const fila = { ...(it.fila || {}), estado };
  porTag.set(fonte.prTag, { ...it, [campo]: fonte, fila });
}

export function itensDaFila(dev, { listas, pendencias, operacoes } = {}) {
  const porTag = new Map(linhasDoAparelho(listas, dev).map((it) => [it.prTag, it]));
  const pends = lista(pendencias).filter((p) => p && p.dev === dev && p.prTag && !p.visto);
  const ops = lista(operacoes).filter((o) => o && o.dev === dev && o.prTag && o.tipo !== 'self');
  for (const p of pends) sobrepor(porTag, p, 'pend', 'decidir');
  for (const o of ops) sobrepor(porTag, o, 'op', 'revisando');
  return [...porTag.values()];
}

export function grupoDoItem(item) {
  return GRUPO_DO_ESTADO[item && item.fila && item.fila.estado] || 'fila';
}

export function contagemDaFila(itens) {
  const c = { tudo: 0, pedem: 0, revisando: 0, fila: 0, parados: 0, feitos: 0 };
  for (const it of lista(itens)) { c.tudo += 1; c[grupoDoItem(it)] += 1; }
  return c;
}

// O miolo da fila: `lista`, ou um dos quatro estados sem lista. Sem escopo publicado por
// este aparelho, a pergunta é POR QUÊ: versão antiga, ainda não li ou li e está vazio.
export function situacaoDaFila(dev, listas, { antigo = false } = {}) {
  const l = listas || {};
  const escopos = lista(l.escopos).filter((e) => e && e.tipo === 'panorama' && e.dev === dev);
  if (antigo) return { miolo: 'antiga', lidoEm: 0 };
  const falhou = escopos.find((e) => e.estado === 'falhou');
  if (falhou) return { miolo: 'falhou', lidoEm: 0, falhaEm: Number(falhou.falhaEm) || 0 };
  const lidoEm = Math.max(0, ...escopos.map((e) => Number(e.lidoEm) || 0));
  if (!escopos.length && (!l.estado || l.estado === 'aguardando' || l.estado === 'inicial')) return { miolo: 'carregando', lidoEm: 0 };
  return { miolo: 'lista', lidoEm };
}

function fraseDoItem(item, agora) {
  const f = item.fila || {};
  if (f.estado === 'decidir' && item.pend) {
    const n = lista(item.pend.motivos).length + (Number(item.pend.motivosOmitidos) || 0);
    return `revisado: ${VEREDITO[item.pend.veredito] || 'sem veredito'}${n ? `, ${plural(n, 'motivo', 'motivos')}` : ''}`;
  }
  if (f.estado === 'revisando' && item.op) {
    const ms = Object.values(item.op.msPorEtapa || {}).reduce((t, v) => t + (Number(v) || 0), 0);
    const min = Math.max(1, Math.round(ms / 60000));
    return `revisando agora, ${min} min, ${ETAPA[item.op.etapa] || 'sem etapa conhecida'}${item.op.modelo ? ` · ${item.op.modelo}` : ''}`;
  }
  return FRASE[f.estado] ? FRASE[f.estado](item, f, agora) : '';
}

function fraseSemAutomatica(it, f) {
  if (f.motivo === 'silenciada') return `a conta ${it.account} está silenciada`;
  return `a conta ${it.account} não revisa sozinha`;
}

function fraseLimite(it, f) {
  if (!f.ate) return 'assinatura no limite do plano';
  return `assinatura no limite até ${fmtClock(f.ate)}`;
}

const FRASE = {
  revisando: () => 'revisando agora',
  decidir: () => 'revisado, esperando sua decisão',
  esperando: () => 'na fila, a revisão automática vai pegar',
  'sem-automatica': fraseSemAutomatica,
  retry: () => 'esperando nova tentativa depois de falha de rede',
  estacionado: (it, f) => `${PARADO[f.motivo] || 'parou'}${f.desde ? `, ${quando(f.desde)}` : ''}`,
  'saiu-de-cena': () => 'outra pessoa pegou este PR',
  'limite-plano': fraseLimite,
  'espera-grupo': () => 'o teto de consumo do grupo segura',
  visto: () => 'já revisado',
  ignorado: () => 'não volta para a fila',
};

// Ações por estado (HANDOFF, tabela "Estados de cada PR"). `cmd` manda comando pela tela;
// as de pendência e sessão reusam os gatilhos que já existem (md-decidir, md-cancelar...).
const ACOES = {
  esperando: [['revisar', 'Revisar agora', true], ['ignorar', 'Ignorar']],
  'sem-automatica': [['revisar', 'Revisar agora', true], ['ignorar', 'Ignorar'], ['ligar-auto', 'Ligar a automática da conta']],
  retry: [['revisar', 'Revisar agora', true]],
  estacionado: [['revisar', 'Destravar e revisar', true]],
  'saiu-de-cena': [['revisar', 'Revisar agora', true]],
  visto: [['revisar', 'Revisar de novo']],
  ignorado: [['restaurar', 'Restaurar']],
};
const SEM_ACAO = {
  'limite-plano': (f) => (f.ate ? `sem ação até o reset, às ${fmtClock(f.ate)}` : 'sem ação até o reset do plano'),
  'espera-grupo': () => 'sem ação: sai sozinho quando o grupo liberar',
};

function ref(item) {
  const curto = item.key ? item.key.replace(/^[^/]+\//, '') : '';
  return curto || 'este PR';
}

// `desligado`: texto do motivo quando o aparelho não pode receber comando agora.
function botao(classe, rotulo, attrs, desligado, item, primario = false) {
  const dis = desligado ? ` aria-disabled="true" title="${esc(desligado)}"` : '';
  return `<button class="btn sm${primario ? ' primary' : ''} ${classe}"${attrs}${dis} aria-label="${esc(`${rotulo}: ${ref(item)}`)}">${esc(rotulo)}</button>`;
}

function acoesDaPendencia(item, ctx) {
  const p = item.pend;
  const decidir = botao('md-decidir', 'Decidir', ` data-item="${esc(p.itemId)}" data-dev="${esc(p.dev)}" data-aparelho="${esc(p.aparelho || ctx.nome)}"`, ctx.desligadoBase, item, true);
  const review = p.reviewId ? botao('md-review-completo', 'Ver review completo', ` data-review="${esc(p.reviewId)}"`, '', item) : '';
  return `${decidir}${review}`;
}

// Transferir exige o commit no andamento: a origem confere a tag dele. Os destinos aptos
// (o próprio admin inclusive, que executa) vêm da rota, na hora do clique.
function motivoSemTransferir(o, ctx) {
  if (!o.matTag) return 'o andamento não traz o commit, que a transferência exige';
  return ctx.desligadoBase;
}

function acoesDaSessao(item, ctx) {
  const o = item.op;
  const vivo = botao('ap-ao-vivo', 'Ver ao vivo', ` data-tag="${esc(item.prTag)}"`, '', item);
  const transferir = botao('md-transferir', 'Transferir', ` data-op="${esc(o.opId)}"`, motivoSemTransferir(o, ctx), item);
  return `${vivo}${transferir}${botao('md-cancelar', 'Cancelar', ` data-op="${esc(o.opId)}"`, ctx.desligadoBase, item)}`;
}

function acoesDoItem(item, ctx) {
  const f = item.fila || {};
  const deste = ctx.pendenteDe ? ctx.pendenteDe(item.prTag) : false;
  const desligado = ctx.desligado || (deste ? 'Esperando o aparelho aplicar o comando anterior.' : '');
  if (f.estado === 'decidir' && item.pend) return acoesDaPendencia(item, ctx);
  if (f.estado === 'revisando' && item.op) return acoesDaSessao(item, ctx);
  if (SEM_ACAO[f.estado]) return `<span class="fila-sem-acao">${esc(SEM_ACAO[f.estado](f))}</span>`;
  return lista(ACOES[f.estado]).map(([tipo, rotulo, prim]) => botao('ap-cmd', rotulo, ` data-tipo="${tipo}" data-tag="${esc(item.prTag)}" data-acct="${esc(item.acctTag)}"`, desligado, item, prim)).join('');
}

function aoVivoHtml(item, aberto) {
  const linhas = lista(item.op && item.op.feed).slice(-6);
  if (!aberto || !linhas.length) return '';
  return `<ol class="fila-ao-vivo">${linhas.map((l) => `<li>${esc(l)}</li>`).join('')}</ol>`;
}

function itemHtml(item, ctx) {
  const f = item.fila || {};
  const [classe, rotulo] = CHIP[f.estado] || ['mute', f.estado || 'sem estado'];
  const pr = item.key ? prRefMention(item.key, 'pr-ref-mention') : '<span class="md-fraco">PR sem nome no catálogo</span>';
  const conta = item.account ? `<span class="acct-chip">${esc(item.account)}</span>` : '';
  const autor = item.author ? `${personMention(item.author, 'xs')}` : '';
  const retorno = ctx.retornoDe ? ctx.retornoDe(item.prTag) : '';
  const semSinal = ctx.semSinal && f.estado === 'revisando' ? 'revisando na última leitura, pode já ter acabado' : '';
  const foto = item.author ? avatar(item.author) : '';
  const titulo = item.title ? `<div class="pr-title" title="${esc(item.title)}">${esc(item.title)}</div>` : '';
  const sub = autor ? `<div class="pr-sub">${autor}</div>` : '';
  const frase = semSinal || fraseDoItem(item, ctx.agora);
  return `<article class="card fila-item" data-estado="${esc(f.estado || '')}" data-tag="${esc(item.prTag)}">
    ${foto}
    <div class="info">
      <div class="pr-ref">${pr}${conta}</div>
      ${titulo}${sub}
      <div class="fila-estado"><span class="sync-chip ${classe}">${esc(rotulo)}</span><span>${esc(frase)}</span></div>
      ${aoVivoHtml(item, ctx.aoVivo && ctx.aoVivo.has(item.prTag))}${retorno}
    </div>
    <div class="pr-actions">${acoesDoItem(item, ctx)}</div>
  </article>`;
}

function filtrosHtml(cont, filtro) {
  return `<div class="fila-filtros" role="toolbar" aria-label="Filtrar por estado">${FILTROS.map(([id, rot]) => {
    const n = cont[id] || 0;
    const urg = id === 'pedem' && n ? ' class="urg"' : '';
    return `<button class="fila-filtro${filtro === id ? ' active' : ''}" data-filtro="${id}" aria-pressed="${String(filtro === id)}">${esc(rot)} <span${urg}>${n}</span></button>`;
  }).join('')}</div>`;
}

const MIOLO = {
  carregando: (nome) => `<div class="fila-carregando" aria-busy="true"><p class="md-vazio">Lendo a fila do ${esc(nome)} pela primeira vez…</p><div></div><div></div></div>`,
  falhou: (nome, s) => `<div class="fila-falhou" role="alert"><b>Não deu para ler a fila do ${esc(nome)}</b><p>A leitura${s.falhaEm ? ` das ${esc(fmtClock(s.falhaEm))}` : ''} falhou. Isso não quer dizer que a fila está vazia: o aparelho pode ter PRs esperando.</p><button class="btn sm ap-reler">Tentar de novo</button></div>`,
  antiga: (nome, s, versao) => `<div class="fila-antiga"><b>Atualize o Farol no ${esc(nome)}</b><p>Este aparelho está na versão ${esc(versao || 'antiga')}, que ainda não publica a fila nem aceita os comandos novos do admin. Por isso não há fila para mostrar aqui, e não é que ela esteja vazia. Atualize no próprio aparelho; depois disso a fila aparece sozinha.</p></div>`,
};

// `ctx`: { nome, filtro, desligado, semSinal, executores, agora, versao, aoVivo:Set,
// retornoDe(prTag)->html, pendenteDe(prTag)->bool }
export function filaDoAparelhoHtml(itens, situacao, ctx) {
  const c = ctx || {};
  const nome = c.nome || 'aparelho';
  const s = situacao || { miolo: 'carregando' };
  const titulo = c.semSinal ? 'Última fila conhecida' : `Fila do ${esc(nome)}`;
  let lateral = 'primeira leitura';
  if (s.miolo === 'falhou') lateral = `leitura falhou${s.falhaEm ? ` às ${esc(fmtClock(s.falhaEm))}` : ''}`;
  else if (s.miolo === 'antiga') lateral = 'não publicada nesta versão';
  else if (s.lidoEm) lateral = `lida às ${esc(fmtClock(s.lidoEm))} · atualiza a cada 10 s`;
  const todos = lista(itens);
  const cont = contagemDaFila(todos);
  const cab = `<div class="section-head"><h2>${titulo} <span class="count ambient">${cont.tudo}</span></h2><span class="section-sub">${lateral}</span></div>`;
  // Pendências e sessões ao vivo chegam por outro caminho que a fila: com elas na mão, o
  // aviso (versão antiga, leitura que falhou) fica em cima e os itens continuam visíveis.
  const aviso = MIOLO[s.miolo] ? MIOLO[s.miolo](nome, s, c.versao) : '';
  if (aviso && (!todos.length || s.miolo === 'carregando')) return `${cab}${aviso}`;
  if (!todos.length) return `${cab}<div class="fila-vazia"><b>Nada na fila do ${esc(nome)}</b><p>Nenhum PR pedido às contas dele espera revisão.${s.lidoEm ? ` Leitura das ${esc(fmtClock(s.lidoEm))}.` : ''}</p></div>`;
  const filtro = c.filtro || 'tudo';
  const ctxItem = { ...c, nome };
  const grupos = GRUPOS.filter((g) => filtro === 'tudo' || filtro === g.id).map((g) => {
    const doGrupo = todos.filter((it) => grupoDoItem(it) === g.id);
    if (!doGrupo.length) return '';
    const chip = g.id === 'pedem' ? 'warn' : 'mute';
    return `<div class="fila-grupo"><div class="fila-grupo-head"><h3>${esc(g.titulo)}</h3><span class="sync-chip ${chip}">${doGrupo.length}</span><span class="section-sub">${esc(g.sub)}</span></div>
      <div class="cards">${doGrupo.map((it) => itemHtml(it, ctxItem)).join('')}</div></div>`;
  }).join('');
  return `${cab}${aviso}${filtrosHtml(cont, filtro)}${grupos}`;
}
