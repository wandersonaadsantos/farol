// Panorama e Meus PRs de outros aparelhos (visão compartilhada, 7.C3), parte PURA.
//
// Recebe a projeção que o engine entrega (evento `sync-lists` e `POST /api/sync/lists`,
// lib/engine/sync-listas.js), a lista local da aba e o `STATE.sync`, e devolve o que a aba
// mostra. Nada aqui toca DOM nem lê estado global.
//
// TRÊS AFIRMAÇÕES QUE ESTE MÓDULO NÃO PODE ERRAR, travadas em teste:
//   1. o PR que este aparelho também vê aparece UMA vez, com a origem "este aparelho", e a
//      contagem da aba não o soma de novo;
//   2. linha de outro aparelho é só leitura: nenhum botão, nenhuma ação que escreva no
//      GitHub, e o Merge de Meus PRs diz por que está desabilitado;
//   3. dado indisponível (visão desligada, bloqueada, sem outro aparelho, sem chave), leitura
//      que falhou e leitura velha são estados diferentes, com frases diferentes. A idade limite
//      vem do engine (`limiteMs`), a tela não define regra de dado.
import { esc, fmtClock, plural } from './comum.js';
import { personMention, prRefMention } from './mencoes.js';
import { visaoCompartilhada } from './compartilhado.js';

const INDISPONIVEL = {
  'sem-frota': 'Nenhum outro aparelho com a chave aberta foi visto nas últimas 24 horas: só este aparelho aparece aqui.',
  'sem-chave': 'A chave do conjunto não está aberta neste aparelho, então as listas dos outros não abrem aqui.',
  'sem-credencial': 'Este aparelho não está conectado à sincronização, então as listas dos outros não chegam.',
  desligada: 'A visão compartilhada está desligada: só este aparelho aparece aqui.',
  'compartilhamento-desligado': 'A visão compartilhada está desligada: só este aparelho aparece aqui.',
};

const GERAL = {
  desligada: 'A visão compartilhada está desligada: só este aparelho aparece aqui.',
  bloqueada: 'O Farol bloqueou a visão compartilhada neste aparelho: as listas dos outros aparelhos não aparecem.',
  aguardando: 'A primeira leitura das listas dos outros aparelhos ainda não chegou.',
};

function chaveDe(pr) {
  return String((pr && pr.key) || '').toLowerCase();
}

export function estadoDasListas(listas, sync) {
  const visao = visaoCompartilhada(sync);
  if (visao !== 'ligada') return { estado: visao, texto: GERAL[visao] };
  if (!listas || typeof listas !== 'object') return { estado: 'aguardando', texto: GERAL.aguardando };
  if (listas.estado === 'ligada') return { estado: 'ligada', texto: '' };
  if (listas.estado === 'aguardando') return { estado: 'aguardando', texto: GERAL.aguardando };
  return { estado: 'indisponivel', texto: INDISPONIVEL[listas.estado] || 'As listas dos outros aparelhos não estão disponíveis agora.' };
}

// 'falhou' e 'desatualizado' são os dois estados de dado velho; 'local' e 'sem-publicador'
// não têm linha remota para mostrar
export function estadoDoEscopo(escopo, limiteMs, agora = Date.now()) {
  const e = escopo || {};
  if (e.estado !== 'ok') return String(e.estado || 'aguardando');
  const velhaLeitura = agora - (Number(e.lidoEm) || 0) > (Number(limiteMs) || 0);
  const publicadorParado = (Number(e.confirmadoAte) || 0) <= agora;
  return velhaLeitura || publicadorParado ? 'desatualizado' : 'ok';
}

function nomeDaOrigem(escopo) {
  return escopo.aparelho || 'outro aparelho';
}

function avisoDoEscopo(escopo, estado) {
  const nome = nomeDaOrigem(escopo);
  if (estado === 'falhou') {
    const antes = escopo.lidoEm ? `mostrando a de ${fmtClock(escopo.lidoEm)}, que pode estar velha` : 'nenhuma leitura anterior deu certo';
    return `A leitura da lista do ${nome} falhou às ${fmtClock(escopo.falhaEm)}; ${antes}.`;
  }
  if ((Number(escopo.confirmadoAte) || 0) <= (escopo.agora || 0)) {
    return `Lista desatualizada: o ${nome} não confirma esta lista, e a última confirmação venceu às ${fmtClock(escopo.confirmadoAte)}.`;
  }
  return `Lista desatualizada: a última leitura da lista do ${nome} é de ${fmtClock(escopo.lidoEm)}.`;
}

function vazioMesclado(locais, geral) {
  return { remotas: [], deste: locais.length, outros: 0, total: locais.length, naoAbriram: 0, avisos: [], geral };
}

// Mescla a lista local da aba com as linhas remotas do tipo pedido. `filtro` é o filtro da
// aba (escopo de conta, ocultos), aplicado às linhas remotas como às locais.
export function mesclarListaRemota(locais, listas, tipo, opcoes = {}) {
  const lista = Array.isArray(locais) ? locais : [];
  const agora = opcoes.agora || Date.now();
  const filtro = typeof opcoes.filtro === 'function' ? opcoes.filtro : () => true;
  const geral = estadoDasListas(listas, opcoes.sync);
  if (geral.estado !== 'ligada') return vazioMesclado(lista, geral);
  const vistas = new Set(lista.map(chaveDe));
  const porChave = new Map();
  const avisos = [];
  let naoAbriram = 0;
  const escopos = (Array.isArray(listas.escopos) ? listas.escopos : []).filter((x) => x && x.tipo === tipo);
  for (const escopo of escopos) {
    naoAbriram += Number(escopo.naoAbriram) || 0;
    const estado = estadoDoEscopo(escopo, listas.limiteMs, agora);
    if (estado === 'falhou' || estado === 'desatualizado') avisos.push({ estado, texto: avisoDoEscopo({ ...escopo, agora }, estado) });
    for (const l of Array.isArray(escopo.linhas) ? escopo.linhas : []) {
      const linha = { ...l, account: l.account || escopo.account, dev: escopo.dev, aparelho: nomeDaOrigem(escopo) };
      const chave = chaveDe(linha);
      const anterior = porChave.get(chave);
      if (!chave || vistas.has(chave) || !filtro(linha)) continue;
      if (!anterior || (Number(linha.u) || 0) > (Number(anterior.u) || 0)) porChave.set(chave, linha);
    }
  }
  const remotas = [...porChave.values()].sort((a, b) => (Number(b.u) || 0) - (Number(a.u) || 0));
  const outros = new Set(remotas.map((l) => l.dev)).size;
  return { remotas, deste: lista.length, outros, total: lista.length + remotas.length, naoAbriram, avisos, geral };
}

function resumoDaOrigem(m) {
  const deste = `${m.deste} deste aparelho`;
  const outros = `${m.remotas.length} de ${plural(m.outros, 'outro', 'outros')}`;
  return `${plural(m.total, 'PR', 'PRs')}: ${deste} e ${outros}`;
}

function avisosHtml(m) {
  const partes = [];
  if (m.geral && m.geral.estado !== 'ligada' && m.geral.estado !== 'desligada') {
    partes.push(`<div class="md-faixa md-remoto-estado" data-estado="${esc(m.geral.estado)}"><span class="sync-chip mute">${esc(m.geral.estado)}</span><span>${esc(m.geral.texto)}</span></div>`);
  }
  for (const a of m.avisos) {
    const rotulo = a.estado === 'falhou' ? 'leitura falhou' : 'desatualizada';
    partes.push(`<div class="md-faixa warn md-remoto-estado" data-estado="${esc(a.estado)}"><span class="sync-chip warn">${rotulo}</span><span>${esc(a.texto)}</span></div>`);
  }
  if (m.naoAbriram) {
    const itens = m.naoAbriram === 1 ? '1 item de outro aparelho não abriu e ficou de fora' : `${m.naoAbriram} itens de outros aparelhos não abriram e ficaram de fora`;
    partes.push(`<p class="md-nota md-remoto-nao-abriu"><span class="sync-chip mute">não verificável</span> ${esc(itens)}.</p>`);
  }
  return partes.join('');
}

function origemHtml(l) {
  const hora = l.u ? `<span class="md-fraco">atualizado ${esc(fmtClock(l.u))}</span>` : '';
  return `<span class="sync-chip mute md-origem" title="lista vinda de outro aparelho">${esc(l.aparelho)}</span>${hora}`;
}

function linhaPanoramaHtml(l) {
  const rascunho = l.isDraft ? '<span class="badge">rascunho</span>' : '';
  const autor = l.author ? `<span class="pw-sep">·</span>${personMention(l.author, 'xs')}` : '';
  return `<div class="prow md-remota" data-origem="${esc(l.dev)}">
    <span class="status-dot" aria-hidden="true"></span>
    <div class="pw-main">
      <div class="pw-head">${prRefMention(l.key, 'pw-ref')}${rascunho}</div>
      <div class="pw-title"><span class="pw-title-txt">${esc(l.title || '')}</span>${autor}</div>
    </div>
    <div class="md-remota-fim">${origemHtml(l)}<span class="settled">só leitura</span></div>
  </div>`;
}

// Bloco de linhas remotas do Panorama. Vazio quando não há nada a dizer (visão desligada
// não polui a aba; ela já diz isso no Radar).
export function panoramaRemotoHtml(m) {
  const avisos = avisosHtml(m || {});
  const linhas = (m && m.remotas) || [];
  if (!linhas.length && !avisos) return '';
  const topo = linhas.length ? `<div class="md-remoto-topo">${esc(resumoDaOrigem(m))}</div>` : '';
  const corpo = linhas.length ? `<div class="rows md-remoto-linhas">${linhas.map(linhaPanoramaHtml).join('')}</div>` : '';
  return `${topo}${avisos}${corpo}`;
}

function ramoHtml(l) {
  if (!l.headRefName) return '';
  const base = l.baseRefName ? ` → ${esc(l.baseRefName)}` : '';
  return `<span class="md-fraco">${esc(l.headRefName)}${base}</span>`;
}

function cardMeusPrsHtml(l) {
  const merge = l.mergeable ? `<span class="md-fraco">estado de merge no ${esc(l.aparelho)}: ${esc(l.mergeable)}</span>` : '';
  return `<div class="card md-remota md-meu-remoto" data-origem="${esc(l.dev)}">
    <div class="md-linha">${prRefMention(l.key, 'md-pr-ref')}<span class="sync-chip mute">do ${esc(l.aparelho)}, só leitura</span><span class="md-espaco"></span>${origemHtml(l)}</div>
    <div class="md-titulo">${esc(l.title || '')}</div>
    <div class="md-sub">${ramoHtml(l)} ${merge}</div>
    <p class="md-nota">Merge desabilitado aqui: dado vindo de outro aparelho nunca habilita merge.</p>
  </div>`;
}

export function meusPrsRemotoHtml(m) {
  const avisos = avisosHtml(m || {});
  const linhas = (m && m.remotas) || [];
  if (!linhas.length && !avisos) return '';
  const topo = linhas.length ? `<div class="md-remoto-topo">${esc(resumoDaOrigem(m))}</div>` : '';
  return `${topo}${avisos}${linhas.map(cardMeusPrsHtml).join('')}`;
}
