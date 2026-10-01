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
import { prIdentificado } from './pr-compartilhado.js';
import { feedDaOperacaoHtml, resumoDaOperacao, textoDoBloqueio, textoDoVeredito } from './compartilhado.js';
import { botaoDoReviewHtml, motivosDaPendenciaHtml, motivosOmitidosDe } from './compartilhado-decisao.js';

// A pendência que espera o CI (01/10/2026): o aparelho dono aprova sozinho quando o CI
// obrigatório fechar verde, então ela NÃO pede você. Chega por dois caminhos, e os dois dão
// no mesmo motivo: a linha do Panorama (`fila.motivo`, lib/sync/fila.js) e a pendência
// (`espera`, lib/sync/pendencia.js). Aparelho em versão anterior não manda nenhum dos dois,
// e o item dele continua em "Pedem você", como era.
const ESPERA_CI = 'espera-ci';
const CHIP_ESPERA_CI = ['info', 'esperando o CI'];
const FRASE_ESPERA_CI = 'aprovável, esperando o CI obrigatório: o aparelho aprova sozinho quando ele fechar verde';

// grupos fixos, nesta ordem (HANDOFF, seção 1); "Esperando o CI" entrou em 01/10/2026
const GRUPOS = [
  { id: 'pedem', titulo: 'Pedem você', sub: 'O aparelho revisou e espera sua decisão.' },
  { id: 'ci', titulo: 'Esperando o CI (aprova sozinho)', sub: 'Não precisam de você: o aparelho aprova quando o CI fechar verde.' },
  { id: 'revisando', titulo: 'Revisando agora', sub: 'Ao vivo, atualiza a cada 10 s.' },
  { id: 'fila', titulo: 'Na fila', sub: 'Ainda não começaram.' },
  { id: 'parados', titulo: 'Parados', sub: 'Não andam sozinhos. Cada um diz o porquê.' },
  { id: 'feitos', titulo: 'Revisados e ignorados', sub: 'Saíram da fila.' },
];
const FILTROS = [['tudo', 'Tudo'], ['pedem', 'Pedem você'], ['ci', 'Esperando o CI'], ['revisando', 'Revisando'], ['fila', 'Na fila'], ['parados', 'Parados'], ['feitos', 'Feitos']];

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
// PR que o catálogo cifrado não nomeou: a tela diz o que sabe, nunca um palpite
const SEM_NOME = 'Um PR seu, sem nome nesta tela (o catálogo cifrado não abriu)';

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

// Pendência e sessão viva vencem o estado da linha: são mais novas que o Panorama. O motivo
// vai junto, senão o da linha (mais velho) sobreviveria: espera largada continuaria "esperando
// o CI" até o próximo ciclo de polling do dono, e ali ela já pede você.
function sobrepor(porTag, fonte, campo, estado, motivo = '') {
  const it = porTag.get(fonte.prTag) || itemDoPr(fonte.pr, fonte.prTag);
  const fila = { ...(it.fila || {}), estado, motivo };
  porTag.set(fonte.prTag, { ...it, [campo]: fonte, fila });
}

// só o valor do vocabulário vira espera; ausente (versão anterior) ou lixo é pendência comum
function motivoDaPendencia(p) {
  return p.espera === 'ci' ? ESPERA_CI : '';
}

export function itensDaFila(dev, { listas, pendencias, operacoes } = {}) {
  const porTag = new Map(linhasDoAparelho(listas, dev).map((it) => [it.prTag, it]));
  const pends = lista(pendencias).filter((p) => p && p.dev === dev && p.prTag && !p.visto);
  const ops = lista(operacoes).filter((o) => o && o.dev === dev && o.prTag && o.tipo !== 'self');
  for (const p of pends) sobrepor(porTag, p, 'pend', 'decidir', motivoDaPendencia(p));
  for (const o of ops) sobrepor(porTag, o, 'op', 'revisando');
  return [...porTag.values()];
}

function esperaOCi(f) {
  return !!f && f.estado === 'decidir' && f.motivo === ESPERA_CI;
}

export function grupoDoItem(item) {
  const f = item && item.fila;
  if (esperaOCi(f)) return 'ci';
  return GRUPO_DO_ESTADO[f && f.estado] || 'fila';
}

// `pedem` é o número que vira selo e contador ("N pedem você"): quem espera o CI fica fora
export function contagemDaFila(itens) {
  const c = { tudo: 0, pedem: 0, ci: 0, revisando: 0, fila: 0, parados: 0, feitos: 0 };
  for (const it of lista(itens)) { c.tudo += 1; c[grupoDoItem(it)] += 1; }
  return c;
}

// O miolo da fila: `lista`, ou um dos quatro estados sem lista. Sem escopo publicado por
// este aparelho, a pergunta é POR QUÊ: versão antiga, ainda não li ou li e está vazio.
// `fontesLidas`: pendências e andamento do conjunto já tiveram a primeira leitura nesta
// conexão. Antes disso a fila vazia não é vazio: pode haver decisão esperando lá.
export function situacaoDaFila(dev, listas, { antigo = false, fontesLidas = true } = {}) {
  const l = listas || {};
  const escopos = lista(l.escopos).filter((e) => e && e.tipo === 'panorama' && e.dev === dev);
  if (antigo) return { miolo: 'antiga', lidoEm: 0 };
  const falhou = escopos.find((e) => e.estado === 'falhou');
  if (falhou) return { miolo: 'falhou', lidoEm: 0, falhaEm: Number(falhou.falhaEm) || 0 };
  const lidoEm = Math.max(0, ...escopos.map((e) => Number(e.lidoEm) || 0));
  const listaNaoLida = !escopos.length && (!l.estado || l.estado === 'aguardando' || l.estado === 'inicial');
  if (listaNaoLida || !fontesLidas) return { miolo: 'carregando', lidoEm };
  return { miolo: 'lista', lidoEm };
}

// A contagem soma os motivos que o dono não conseguiu mandar (`motivosOmitidos`), para a
// lista parcial nunca parecer completa; o bloqueio por commit novo vai junto.
function aberturaDaPendencia(p, f) {
  if (esperaOCi(f)) return FRASE_ESPERA_CI;
  return `revisado: ${textoDoVeredito(p.veredito)}`;
}

function fraseDaPendencia(p, f) {
  const n = lista(p.motivos).length + motivosOmitidosDe(p);
  const bloqueio = textoDoBloqueio(p.bloqueio);
  const partes = [aberturaDaPendencia(p, f), n ? plural(n, 'motivo registrado', 'motivos registrados') : '', bloqueio];
  return partes.filter(Boolean).join(', ');
}

function fraseDoItem(item, agora) {
  const f = item.fila || {};
  if (f.estado === 'decidir' && item.pend) return fraseDaPendencia(item.pend, f);
  if (f.estado === 'revisando' && item.op) return `revisando agora: ${resumoDaOperacao(item.op)}`;
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

function fraseDecidir(it, f) {
  if (esperaOCi(f)) return FRASE_ESPERA_CI;
  return 'revisado, esperando sua decisão';
}

const FRASE = {
  revisando: () => 'revisando agora',
  decidir: fraseDecidir,
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

// Quem espera o CI segue com o Decidir (aprovar na mão sem esperar é direito seu, como no
// card local), só que sem o destaque de ação principal: ali o esperado é não fazer nada.
function acoesDaPendencia(item, ctx) {
  const p = item.pend;
  const decidir = botao('md-decidir', 'Decidir', ` data-item="${esc(p.itemId)}" data-dev="${esc(p.dev)}" data-aparelho="${esc(p.aparelho || ctx.nome)}"`, ctx.desligadoBase, item, !esperaOCi(item.fila));
  return `${decidir}${botaoDoReviewHtml(p)}`;
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

// o mesmo feed que o aparelho dono mostra: as 6 últimas linhas e o resto recolhido
function aoVivoHtml(item, aberto) {
  if (!aberto || !item.op) return '';
  const feed = feedDaOperacaoHtml(item.op.feed);
  return feed ? `<div class="fila-ao-vivo">${feed}</div>` : '';
}

// o que só existe no item de pendência ou de sessão: os motivos por extenso e o nó vencido
function detalheDoItem(item) {
  const motivos = item.pend ? motivosDaPendenciaHtml(item.pend) : '';
  const vencido = item.op && item.op.situacao === 'interrompida' ? '<span class="sync-chip warn">sem renovar</span>' : '';
  return `${vencido}${motivos}`;
}

function chipDe(f) {
  if (esperaOCi(f)) return CHIP_ESPERA_CI;
  return CHIP[f.estado] || ['mute', f.estado || 'sem estado'];
}

function itemHtml(item, ctx) {
  const f = item.fila || {};
  const [classe, rotulo] = chipDe(f);
  const pr = prIdentificado(item) ? prRefMention(item.key, 'pr-ref-mention') : `<span class="md-pr-generico">${esc(SEM_NOME)}</span>`;
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
      ${detalheDoItem(item)}${aoVivoHtml(item, ctx.aoVivo && ctx.aoVivo.has(item.prTag))}${retorno}
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
  if (aviso && !todos.length) return `${cab}${aviso}`;
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
  // com itens na mão, "carregando" não esconde nada; versão antiga e falha continuam avisando
  const avisoComItens = s.miolo === 'carregando' ? '' : aviso;
  return `${cab}${avisoComItens}${filtrosHtml(cont, filtro)}${grupos}`;
}
