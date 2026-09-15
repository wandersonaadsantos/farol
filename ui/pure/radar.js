// O Radar: os cards da fila e do panorama, a nota de PR estacionado e o vazio que
// confirma o que o app fez. Extraído do ui/pure.js na Fase 1a da reorganização; o
// conteúdo não mudou.
//
// Os cards saíram do app.js na onda 5, quarto passo: o render lê o estado, filtra e seta
// os contadores; o CARD em si só recebe o PR e um ctx. O acctMark ficou no app.js de
// propósito e o ctx recebe o RESULTADO dele (ctx.mark): ele depende de SCOPE, TWEAK e da
// tabela de contas, uma cadeia que não tem a ver com desenhar o card.
//
// O vazio que CONFIRMA: vazio bom merece dizer o que o app fez, não só que não há nada
// (quantos PRs foram aprovados sozinhos hoje, quais orgs são monitoradas e de quanto em
// quanto tempo). `aprovadosHoje` mora em comum.js e é chamada pelo app.js: ela lê
// `decisions.resolved`, que é estado, e o construtor recebe só o número pronto. Ficar em
// comum.js é também o que impede o ciclo radar -> review -> sessao -> radar.
import { esc, fmtMoney, fmtRel, fmtStamp, fmtWhenDay, plural } from './comum.js';
import { avatar, personMention } from './mencoes.js';
import { papelPicker } from './pessoas.js';
import { chatBadge, reviewChip } from './review.js';
import { prCoordNoteHtml } from './sync.js';

/* A automação está pausada por teto de gasto? PURA.

   Devolve o primeiro perfil BLOQUEADO que alguma conta monitorada usa de fato
   (override da conta, senão o padrão do Farol), ou null. Conta silenciada não conta:
   ela já está fora da automação por escolha.

   POR QUE ISTO EXISTE (medido em 30/08/2026): o teto diário do perfil padrão estourou
   às 19:52, num dia em que a autoanálise (que passa por fora do gate, por decisão)
   levou US$ 74,48 dos US$ 94,39 gastos. Das 19:52 em diante a revisão automática ficou
   pausada nas DUAS contas, e esta tela seguia dizendo "o Farol monitora biudtech a cada
   3 minutos", que é a frase de quem está trabalhando. O selo do bloqueio existia, mas só
   em Sistema e no Consumo, ou seja, longe da tela onde se pergunta "ele está agindo?".
   Vazio que tranquiliza enquanto a automação está parada é pior que vazio nenhum. */
export function automacaoPausadaPor(accounts, config, usage) {
  const budgets = (usage && usage.budgets) || [];
  if (!budgets.length) return null;
  const padrao = (config && config.claudeProfileId) || '';
  for (const a of accounts || []) {
    if (!a || a.muted) continue;
    const id = a.claudeProfileId || padrao;
    const b = budgets.find(x => x.id === id);
    if (b && b.blocked) return b;
  }
  return null;
}

// Frase do bloqueio, no eixo certo. Os motivos `-previsto` dizem que o gasto ainda NÃO
// passou do teto, mas a próxima revisão passaria: quem lê age diferente em cada caso.
function textoPausa(b) {
  const motivo = String(b.reason || '');
  const eixo = motivo.startsWith('total') ? 'teto total' : 'teto de hoje';
  const gasto = motivo.startsWith('total') ? b.sinceCutoff : b.today;
  const cap = motivo.startsWith('total') ? b.budgetTotal : b.capHoje;
  const valores = `${fmtMoney(gasto)} de ${fmtMoney(cap)}`;
  return motivo.endsWith('-previsto')
    ? `a próxima revisão (${fmtMoney(b.tipicoReview)} em média) passaria do ${eixo} do perfil <b>${esc(b.label || 'padrão')}</b> (${valores})`
    : `o perfil <b>${esc(b.label || 'padrão')}</b> passou do ${eixo} (${valores})`;
}

/* As orgs que o vazio da fila pode NOMEAR. PURA.

   Existe porque a frase saía de `config.owners` (`ui/app.js`), o campo legado do modo
   simples: `accountList()` (server.js) só cai nele quando NÃO há conta cadastrada, então
   com contas o motor ignorava aquele campo e a tela seguia exibindo ele. Medido em
   12/09/2026: `config.owners` dizia uma org enquanto as contas monitoravam cinco.

   A régua é o que de fato é BUSCADO, e por isso as duas exclusões não são zelo:
   `searchPRs` pula conta sem token (`lib/engine/gh-queries.js`) e conta silenciada está
   fora da automação por escolha, como `automacaoPausadaPor` logo acima já reconhece.

   O escopo entra aqui porque a LISTA da fila é filtrada por ele (`scopeVisible`) e a frase
   não era: escolher uma conta no seletor seguia citando org que ela nem cobre. */
export function orgsMonitoradas(accounts, scope) {
  const todas = String(scope || 'all') === 'all';
  const alvo = String(scope || '').toLowerCase();
  // minúscula -> primeira grafia vista: a mesma org em duas contas é uma org só, e quem
  // lê deve ver o nome do jeito que cadastrou, não normalizado
  const vistas = new Map();
  for (const a of Array.isArray(accounts) ? accounts : []) {
    if (!a || a.muted || !a.tokenOk) continue;
    if (!todas && String(a.user || '').toLowerCase() !== alvo) continue;
    for (const org of orgsDaConta(a)) if (!vistas.has(org.toLowerCase())) vistas.set(org.toLowerCase(), org);
  }
  return [...vistas.values()];
}

function orgsDaConta(a) {
  return (Array.isArray(a.owners) ? a.owners : []).map(o => String(o || '').trim()).filter(Boolean);
}

export function queueEmptyOkHtml(ctx = {}) {
  const aprovados = ctx.aprovados || 0;
  const orgs = (ctx.owners || []).map(o => `<b>${esc(o)}</b>`).join(', ');
  const min = Math.round((ctx.intervalSeconds || 300) / 60);
  const plural = aprovados === 1 ? 'PR' : 'PRs';
  const feito = aprovados
    ? `O Farol aprovou ${aprovados} ${plural} sozinho hoje e monitora `
    : 'O Farol monitora ';
  const quem = orgs || 'as organizações configuradas';
  const cadencia = min === 1 ? 'minuto' : 'minutos';
  // pausado por orçamento: a fila vazia não significa "está tudo em dia", significa que
  // nada vai ser revisado sozinho até o teto liberar. É a informação que muda o que
  // você faz agora, então ela vem primeiro e o resto do texto muda de tempo verbal.
  if (ctx.pausado) {
    return `<div class="empty-ok pausado">
      <div class="eo-check" aria-hidden="true">⏸</div>
      <div class="eo-title">Revisão automática pausada</div>
      <p class="eo-sub">Nada está esperando a sua decisão, mas ${textoPausa(ctx.pausado)}, então nenhum PR novo vai ser revisado sozinho até isso liberar. O clique em Revisar continua valendo.</p>
      <div class="eo-acts">
        <button class="btn sm" data-goto="aba:consumo">Ver o consumo</button>
        <button class="btn sm ghost eo-check-now">Verificar agora</button>
      </div>
    </div>`;
  }
  return `<div class="empty-ok">
      <div class="eo-check" aria-hidden="true">✓</div>
      <div class="eo-title">Nada esperando por você</div>
      <p class="eo-sub">${feito}${quem} a cada ${min} ${cadencia}. Quando pedirem sua revisão, o card aparece aqui.</p>
      <div class="eo-acts">
        <button class="btn sm eo-resolved">Ver o que foi aprovado</button>
        <button class="btn sm ghost eo-check-now">Verificar agora</button>
      </div>
    </div>`;
}

// Frase do estacionamento por tipo (ver `estacionar` em lib/engine/review.js). O
// motivo só entra onde ele diz algo que o tipo não diz: cancelamento e orçamento já
// são a explicação inteira.
function comMotivo(base, motivo, rotulo = '') {
  if (!motivo) return base;
  return `${base} (${rotulo}${motivo})`;
}

const PARKED_FRASE = {
  cancelado: () => 'cancelada por você',
  autenticacao: () => 'a credencial usada na revisão expirou; renove o login do perfil em Sistema > Plano e chaves antes de clicar em Revisar',
  orcamento: (motivo) => comMotivo('o orçamento estourou', motivo),
  esgotado: (motivo) => comMotivo('falhou várias vezes seguidas', motivo, 'último erro: '),
  falha: (motivo) => comMotivo('falhou', motivo),
  // estacionada antes da v2.57.4: o arquivo antigo não guardava motivo nem hora
  legado: () => 'parou antes desta versão, sem motivo registrado',
};

// Aviso no card da fila de que a revisão automática PAROU, com quando e por quê.
// Existe porque o estacionamento era invisível: o toast morria em cinco segundos e o
// card voltava idêntico ao de um PR nunca revisado (biud-core#317, 03/09/2026: duas
// horas parado no Farol de um colega enquanto ele revisava os vizinhos). '' sem info.
export function parkedNoteHtml(info) {
  if (!info || typeof info !== 'object') return '';
  const frase = (PARKED_FRASE[info.tipo] || PARKED_FRASE.falha)(String(info.motivo || '').trim());
  const quando = info.at ? ` <span title="${esc(fmtStamp(info.at))}">${esc(fmtWhenDay(info.at))}</span>` : '';
  return `<div class="pr-parked">Revisão automática parada${quando}: ${esc(frase)}. Ela não relança sozinha; o botão Revisar tenta de novo.</div>`;
}

export function queueCardHtml(pr, ctx) {
  const m = ctx.mark;
  // os selos inline saem do template: dentro dele o gate conta todos os ternarios
  // do literal como um statement so, e o template fica ilegivel de tao denso
  const seloRascunho = pr.isDraft ? '<span class="badge">rascunho</span>' : '';
  const seloRepedida = pr.reRequested ? '<span class="badge rev-pend">pedida de novo</span>' : '';
  const papel = pr.author ? ` ${papelPicker(pr.author, ctx.people)}` : '';
  // estacionamento VENCE a coordenação quando os dois valem: ele é falha e exige ação
  // sua, a espera se resolve sozinha. Duas notas no mesmo card competiriam por atenção
  // e a mais urgente perderia.
  const parked = parkedNoteHtml((ctx.parked || {})[pr.key]);
  const coord = parked ? '' : prCoordNoteHtml(pr.key, ctx.sync);
  return `
    <div class="card pr-card urgent" data-key="${esc(pr.key)}" data-url="${esc(pr.url)}" style="${m.style}">
      ${m.dot}${avatar(pr.author)}
      <div class="info">
        <div class="pr-ref"><a href="${esc(pr.url)}" target="_blank" rel="noreferrer">${esc(pr.key)}</a>${m.chip}${seloRascunho}${seloRepedida}</div>
        <div class="pr-title" title="${esc(pr.title)}">${esc(pr.title)}</div>
        <div class="pr-sub">${personMention(pr.author, 'xs')} · atualizado ${fmtRel(pr.updatedAt)}${papel}</div>
        ${parked}${coord}
      </div>
      <div class="pr-actions">
        <button class="btn primary sm act-review" data-url="${esc(pr.url)}">Revisar</button>
        <button class="btn icon sm ghost act-chat" data-key="${esc(pr.key)}" data-url="${esc(pr.url)}" title="Conversar com o Claude sobre este PR" aria-label="Conversar com o Claude sobre este PR">
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-8 8H4l2.5-2.7A8 8 0 1 1 21 12z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
        </button>
        <button class="btn icon sm ghost act-more" data-key="${esc(pr.key)}" title="Mais ações" aria-label="Mais ações" aria-expanded="false">···</button>
      </div>
      <!-- O menu abre DENTRO do card, empurrando o conteúdo, em vez de flutuar por cima:
           num card já estreito, dropdown flutuante sai da tela ou cobre o card vizinho.
           Terminal e Ignorar vieram pra cá porque Ignorar é destrutivo e estava a um
           toque de distância do Revisar. -->
      <div class="pr-menu" data-menu="${esc(pr.key)}" hidden>
        <button class="act-terminal" data-url="${esc(pr.url)}">Revisar no terminal (interativo)</button>
        <a href="${esc(pr.url)}" target="_blank" rel="noreferrer">Abrir no GitHub ↗</a>
        <button class="danger act-ignore" data-key="${esc(pr.key)}">Marcar como visto sem revisar</button>
      </div>
    </div>`;
}

export function panoramaRowHtml(pr, ctx) {
  const chip = reviewChip(pr, ctx.actions);
  const m = ctx.mark;
    // estado da SUA revisão: aprovado/mudanças pedidas = resolvido (sem botão de
    // re-revisar); pendente = já na fila de decisão; senão, dá pra revisar.
  const ra = (ctx.actions || {})[pr.key];
  // sem registro nosso, "revisado por mim no GitHub" conta como approve
  let kind = null;
  if (ra) kind = ra.kind;
  else if (pr.reviewedByMe) kind = 'approve';
    // re-request (o autor pediu sua revisão DE NOVO): não é mais "resolvido/aguardando o
    // autor", voltou a ser acionável (a review antiga foi dismissed no GitHub).
    const reviewed = (kind === 'approve' || kind === 'request_changes') && !pr.reRequested;
    const isPending = kind === 'pending';
    // stale = você revisou e entrou commit novo depois: o "Re-revisar" volta a valer
  const stale = reviewed && !!(ctx.staleStates || {})[pr.key];
    // roda de verdade x só espera a vez: mesma distinção do "Meus PRs", pra não
    // rotular de "Revisando…" um PR que ainda nem começou (B: fila e panorama divergiam)
  const running = (ctx.running || new Set()).has(pr.key);
  const qpos = running ? 0 : (ctx.waiting || []).indexOf(pr.key) + 1;
    const queued = qpos > 0;
    const showBtn = (!reviewed || stale) && !isPending && !running && !queued;
  // tres estados excludentes, um por linha. A cadeia de ternarios escondia qual
  // deles ganhava quando mais de um parecia valer.
  let settledLabel = '';
  if (kind === 'request_changes') settledLabel = 'aguardando o autor';
  else if (isPending) settledLabel = 'aguardando você';
  else if (reviewed) settledLabel = 'nada a fazer';
  // mesma regra do settledLabel: a ordem de precedencia (rodando > na fila >
  // botao > estado final) agora esta na sequencia dos if, nao aninhada num ternario.
  const BTN_RODANDO = '<button class="btn sm ghost pano-review" disabled>Revisando…</button>';
  const btnFila = `<button class="btn sm ghost pano-review" disabled>Na fila (${qpos})</button>`;
  // quatro motivos possiveis pra este botao existir, e o tooltip diz qual e. Como
  // cadeia de ternario dentro do template eles ficavam ilegiveis e ainda somavam
  // no gate; nomeados, da pra ler a precedencia de cima pra baixo.
  let tituloRevisar = 'Revisar sob demanda: o resultado sempre passa por você, nada é postado sozinho';
  if (pr.reRequested) tituloRevisar = 'O autor pediu sua revisão de novo (re-request): a review anterior foi dispensada';
  else if (stale) tituloRevisar = 'Entrou commit novo depois da sua review: revisar de novo';
  else if (pr.mine) tituloRevisar = 'Revisar (seu review pedido)';
  const rotuloRevisar = (stale || pr.reRequested) ? 'Re-revisar' : 'Revisar';
  const btnRevisar = `<button class="btn sm ghost act-review pano-review" data-url="${esc(pr.url)}" title="${tituloRevisar}">${rotuloRevisar}</button>`
  const clsMine = pr.mine ? 'mine' : '';
  const clsRev = chip ? 'reviewed' : '';
  let seloConta = '';
  if (ctx.todasContas && m.chip) seloConta = m.chip;
  else if (pr.mine) seloConta = '<span class="badge">sua revisão</span>';
  const seloRascunhoP = pr.isDraft ? '<span class="badge">rascunho</span>' : '';
  const seloRepedidaP = pr.reRequested ? '<span class="badge rev-pend">pedida de novo</span>' : '';
  const sepTitulo = pr.title ? '<span class="pw-sep">·</span>' : '';
  let tail = `<span class="settled">${esc(settledLabel)}</span>`;
  if (running) tail = BTN_RODANDO;
  else if (queued) tail = btnFila;
  else if (showBtn) tail = btnRevisar;
    return `
    <div class="prow ${clsMine} ${clsRev}" style="${m.varStyle}${m.dim}">
      <span class="status-dot" aria-hidden="true"></span>
      <div class="pw-main">
        <div class="pw-head">
          <a class="pw-ref" href="${esc(pr.url)}" target="_blank" rel="noreferrer">${esc(pr.key)}</a>
          ${seloConta}
          ${seloRascunhoP}
          ${seloRepedidaP}
          ${chip}
        </div>
        <div class="pw-title">
          <span class="pw-title-txt" title="${esc(pr.title)}">${esc(pr.title)}</span>
          ${sepTitulo}${personMention(pr.author, 'xs')}
        </div>
      </div>
      <div class="pw-side">
        <span class="pw-when">${fmtRel(pr.updatedAt)}</span>
        <div class="pw-acts">
          <button class="btn icon sm ghost act-chat" data-key="${esc(pr.key)}" data-url="${esc(pr.url)}" title="Conversar com o Claude sobre este PR" aria-label="Conversar sobre este PR">💬${chatBadge(pr.key, ctx.chats)}</button>
          ${tail}
          <button class="btn icon sm ghost rr-copy" data-url="${esc(pr.url)}" data-key="${esc(pr.key)}" title="Copiar a URL do PR" aria-label="Copiar a URL do PR">⧉</button>
          <a class="btn icon sm ghost" href="${esc(pr.url)}" target="_blank" rel="noreferrer" title="Abrir no GitHub" aria-label="Abrir no GitHub">↗</a>
        </div>
      </div>
    </div>`;
}
