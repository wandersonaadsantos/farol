// Decisão, revisão e pushback: a caixa de revisão, os motivos agrupados por eixo, o card
// de commit novo, o selo e o contador de chat do card, o controle de pushback e a linha
// inteira de Revisões recentes. Extraído do ui/pure.js na Fase 1a da reorganização; o
// conteúdo não mudou.
//
// Os três eixos de "por que isto está na sua mesa": a pergunta que o agrupamento responde
// é a que o biud-frontend#774 deixou sem resposta. Dos N motivos listados, quais foram
// JULGAMENTO da revisão, quais são regra deliberada do app e qual foi só a rede caindo?
// Numa lista plana os três se confundiam, e um 503 do GitHub lia igual a uma ressalva
// técnica sobre o código. A ordem é a de quem lê: falha técnica primeiro (é a única
// acionável agora), regra depois (explica o comportamento), e o que a revisão achou por
// último (é o conteúdo, não o motivo do bloqueio).
//
// Card de commit novo (pendência stale_head, v2.59.3): a tela diz quem está com a bola.
// Até a v2.59.2 o card mandava "Peça uma revisão nova" sobre um texto ancorado no commit
// anterior, num caso em que o round automático ia revisar sozinho minutos depois
// (Edicoes-CNBB/biblioteca-cnbb-api#22, 09/09/2026). O estado vem do engine
// (reRoundParaUi, lib/engine/review.js); aqui só vira frase.
//
// Chat e pushback saíram do app.js na onda 5 com o mapa entrando por parâmetro (eram lidos
// de STATE, global proibida aqui).
//
// Revisões recentes, a linha inteira: três colunas (ícone, conteúdo, quando e ações). A
// barra esquerda colorida NÃO entra aqui: ela significa urgência (acctMark no app.js) e
// esta seção é histórico resolvido. O autor fica em linha própria (.rr-person), fora do
// .rr-title: o título tem ellipsis, e um título comprido já empurrou o autor para fora da
// tela sem aviso.

// O conteúdo da caixa de revisão (o mesmo que o card mostra em "Precisa de você"
// e "Revisões recentes"): veredito, PR, autor, pontos de atenção e o relatório.
// Cada ausência vira texto explícito: caixa em branco não distingue "não achei"
// de "achei e está vazio", e é exatamente essa confusão que motivou a feature.
import { esc, fmtClock, fmtStamp, fmtWhenDay, md, plural } from './comum.js';
import { personMention, prRefMention } from './mencoes.js';
import { stagesLine } from './sessao.js';

const VERDICT_LABEL = { approve: 'Aprovável', request_changes: 'Com blocker', comment: 'Comentado' };

const REASON_GROUPS = [
  ['infra', '🔌', 'falha técnica ao postar'],
  ['gate', '📏', 'regra do app'],
  ['content', '🧭', 'ponto que a revisão levantou'],
];

export function reasonGroups(reasons) {
  const porKind = new Map();
  for (const r of (Array.isArray(reasons) ? reasons : [])) {
    if (!r) continue;
    // string solta = decisão gravada antes da v2.48.0: entra como 'content', a
    // leitura conservadora (nunca inventa gate nem falha de infra que não houve)
    const text = (typeof r === 'object') ? r.text : r;
    const kind = (typeof r === 'object' && r.kind) ? r.kind : 'content';
    if (!text) continue;
    if (!porKind.has(kind)) porKind.set(kind, []);
    porKind.get(kind).push(text);
  }
  return REASON_GROUPS
    .filter(([kind]) => porKind.has(kind))
    .map(([kind, icon, label]) => ({ kind, icon, label, items: porKind.get(kind) }));
}

// Uma linha por grupo, com os motivos daquele grupo embaixo. `postRetry` (já
// projetado por decisionForUi) só decora o grupo de infra: é ali que "o app ainda
// vai tentar sozinho" muda o que VOCÊ precisa fazer, que é nada.
// Texto de UM motivo, aceitando as duas formas: { text, kind } (v2.48.0+) e string
// solta (histórico gravado antes). Existe porque nem todo consumidor mostra a lista
// agrupada: o toast e a notificação do sistema mostram só o primeiro motivo, e
// interpolar o objeto direto imprimia "[object Object]" na cara do usuário.
export function reasonText(r) {
  if (r && typeof r === 'object') return String(r.text || '');
  return String(r || '');
}

export function reasonGroupsHtml(reasons, postRetry) {
  const grupos = reasonGroups(reasons);
  if (!grupos.length) return '';
  return `<div class="reason-groups">${grupos.map(g => {
    let nota = '';
    if (g.kind === 'infra' && postRetry) {
      nota = postRetry.exhausted
        ? `<span class="reason-note">desisti de tentar sozinho depois de ${postRetry.attempts} tentativa(s)</span>`
        : `<span class="reason-note">tentando de novo sozinho</span>`;
    }
    return `<div class="reason-group rg-${esc(g.kind)}">`
      + `<div class="reason-group-head"><span aria-hidden="true">${g.icon}</span> ${esc(g.label)}${nota}</div>`
      + `<ul class="dec-reasons">${g.items.map(t => `<li>${esc(t)}</li>`).join('')}</ul>`
      + `</div>`;
  }).join('')}</div>`;
}

const REROUND_MOTIVO = {
  rascunho: () => 'o PR está como rascunho.',
  auto_desligado: (d) => `a revisão automática está desligada na conta ${d} (Sistema > Contas).`,
  conta_silenciada: (d) => `a conta ${d} está silenciada.`,
  sem_token: (d) => `a conta ${d} está sem login no gh.`,
  orcamento: () => 'o orçamento do perfil desta conta estourou.',
  estacionado: (d) => (d === 'cancelado'
    ? 'você cancelou a última tentativa.'
    : 'a última tentativa falhou e ficou estacionada. Volto sozinho se chegar commit novo ou pedirem revisão de novo.'),
  outros_revisando: (d) => `${d} já está revisando este PR.`,
  saiu_de_cena: () => 'saí de cena porque outra pessoa pegou este PR.',
  coordenacao: () => 'outro aparelho seu está cuidando deste PR.',
  pendencia_viva: () => 'há outra decisão deste PR esperando você.',
  consciencia: () => 'outra pessoa já deu um review decisivo neste commit.',
  ancora: () => 'já tentei neste commit e a revisão não terminou. Volto sozinho se chegar commit novo ou pedirem revisão de novo.',
};

const shaCurto = (s) => String(s || '').slice(0, 7);

function reRoundAguardando(r, d) {
  if (r.motivo === 'retry') {
    return { lead: 'Reviso de novo sozinho quando a conexão voltar.', texto: 'A última tentativa caiu por instabilidade e não postou nada.' };
  }
  const de = shaCurto(d && d.headSha), para = shaCurto(d && d.blockedHead);
  const commits = (de && para) ? ` (${de} para ${para})` : '';
  return {
    lead: r.aPartirDe ? `Reviso de novo sozinho a partir de ${fmtClock(r.aPartirDe)}.` : 'Reviso de novo sozinho no próximo ciclo.',
    texto: `O autor enviou commit novo${commits} enquanto eu revisava, então este texto fala do código anterior. Começo quando o PR ficar uns minutos sem push.`,
  };
}

// null = sem estado do engine (snapshot antigo ou PR sem gatilho): o card cai no aviso de sempre
export function reRoundStatus(r, d) {
  if (!r || !r.estado || r.estado === 'sem_gatilho') return null;
  if (r.estado === 'revisando') {
    return { tom: 'info', icone: 'spin', automatico: true, lead: 'Revisando de novo agora,', texto: 'já no commit novo. Este card sai da mesa sozinho quando a revisão nova terminar.' };
  }
  if (r.estado === 'espera_longa') {
    const n = Number(r.rodadasPresas) || 0;
    return {
      tom: 'info', icone: 'hourglass', automatico: true,
      lead: r.aPartirDe ? `Próxima tentativa a partir de ${fmtClock(r.aPartirDe)}.` : 'Próxima tentativa quando o PR ficar mais tempo sem push.',
      texto: `As últimas ${n} revisões pegaram commit novo no meio, então agora espero o PR ficar mais tempo sem push antes de revisar de novo.`,
    };
  }
  if (r.estado === 'parado') {
    const frase = REROUND_MOTIVO[r.motivo];
    return { tom: 'accent', icone: 'pause', automatico: false, lead: 'Não vou revisar de novo sozinho:', texto: `${frase ? frase(r.detalhe || '') : 'motivo desconhecido.'} Use Revisar agora quando quiser.` };
  }
  return { tom: 'info', icone: 'clock', automatico: true, ...reRoundAguardando(r, d) };
}

const REROUND_ICONE = {
  clock: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.2"/><path d="M8 4.6V8l2.3 1.5"/></svg>',
  spin: '<svg class="dec-status-spin" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M14.2 8A6.2 6.2 0 1 1 8 1.8"/></svg>',
  hourglass: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 1.8h8M4 14.2h8M4.8 1.8c0 3.2 6.4 3.2 6.4 6.2s-6.4 3-6.4 6.2M11.2 1.8c0 3.2-6.4 3.2-6.4 6.2s6.4 3 6.4 6.2"/></svg>',
  pause: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.2"/><path d="M6.4 5.6v4.8M9.6 5.6v4.8"/></svg>',
};

export function reRoundBoxHtml(st) {
  if (!st) return '';
  return `<div class="dec-status ${esc(st.tom)}"><span class="dec-status-icon" aria-hidden="true">${REROUND_ICONE[st.icone] || ''}</span>`
    + `<span><b>${esc(st.lead)}</b> ${esc(st.texto)}</span></div>`;
}

// Tudo que muda no card de decisão quando ele é de commit novo, num lugar só e testável.
// reviewBtn: 'primary' (você precisa agir), 'secondary' (atalho: o Farol já vai agir),
// 'none' (revisão nova já rodando) ou '' (card comum, sem o botão).
export function staleCardMeta(d, r) {
  const reasons = Array.isArray(d && d.reasons) ? d.reasons : [];
  const stale = !!(d && d.blockedKind === 'stale_head');
  const legado = d && d.blockedReason ? `<div class="dec-blocked">🚫 <span><b>Bloqueado:</b> ${esc(d.blockedReason)}</span></div>` : '';
  const verdictComum = d && d.verdict === 'approve' ? '<span class="verdict approve">APROVÁVEL</span>' : '<span class="verdict rc">COM BLOCKER</span>';
  if (!stale) {
    return { stale, cardClass: d && d.verdict === 'approve' ? 'urgent' : 'blocked', verdictHtml: verdictComum, reasons, statusHtml: legado, reviewBtn: '' };
  }
  const st = reRoundStatus(r, d);
  if (!st) return { stale, cardClass: d.verdict === 'approve' ? 'urgent' : 'blocked', verdictHtml: verdictComum, reasons, statusHtml: legado, reviewBtn: 'primary' };
  let reviewBtn = st.automatico ? 'secondary' : 'primary';
  if (r.estado === 'revisando') reviewBtn = 'none';
  return {
    stale,
    cardClass: st.automatico ? 'working' : 'urgent',
    verdictHtml: '<span class="verdict stale">COMMIT NOVO</span>',
    // a "regra do app" repetia a caixa de status; o que a revisão levantou continua
    reasons: reasons.filter(x => !(x && typeof x === 'object' && x.kind === 'gate')),
    statusHtml: reRoundBoxHtml(st),
    reviewBtn,
  };
}

export function reviewBoxHtml(d) {
  if (!d) return `<div class="empty">Nenhuma revisão registrada pra este PR no histórico do Farol.</div>`;
  const v = VERDICT_LABEL[d.verdict] || d.verdict || 'sem veredito';
  const cls = d.verdict === 'approve' ? 'approve' : 'rc';
  const autor = (d.pr && d.pr.author) || d.author || '';
  const razoes = Array.isArray(d.reasons) ? d.reasons : [];
  return `<div class="review-box">
    <div class="review-box-head">
      <span class="verdict ${cls}">${esc(v)}</span>
      ${prRefMention(d.key || '', 'dec-ref')}
      ${d.card ? `<span class="pill">${esc(d.card)}</span>` : ''}
    </div>
    ${d.pr && d.pr.title ? `<div class="dec-title">${esc(d.pr.title)}</div>` : ''}
    ${autor ? `<div class="dec-author">PR de ${personMention(autor, 'xs')}</div>` : ''}
    ${d.status === 'pending' && razoes.length
      ? `<div class="review-box-context"><strong>Por que precisa de você</strong>${reasonGroupsHtml(razoes, d.postRetry)}</div>`
      : ''}
    ${d.reportMarkdown
      ? `<div class="report">${md(d.reportMarkdown)}</div>`
      : `<div class="empty">Esta revisão ficou sem relatório gravado.</div>`}
  </div>`;
}

// O estado do GitHub vence o histórico local pelo mesmo motivo do kindDaRevisao
// (ui/pure/radar.js): o que outro aparelho postou só existe lá.
const CHIP_DO_GH = {
  APPROVED: '<span class="badge rev-ok" title="Seu último review decisivo neste PR, no GitHub, aprovou">✅ você aprovou</span>',
  CHANGES_REQUESTED: '<span class="badge rev-rc" title="Seu último review decisivo neste PR, no GitHub, pediu mudanças">✋ você pediu mudanças</span>',
};

export function reviewChip(pr, actions, estadosGh) {
  const a = (actions || {})[pr.key];
  if (a && a.kind === 'pending') return '<span class="badge rev-pend" title="A análise terminou e está esperando a sua decisão em Precisa de você">🟡 aguardando você</span>';
  const gh = String((estadosGh || {})[pr.key]);
  if (Object.hasOwn(CHIP_DO_GH, gh)) return CHIP_DO_GH[gh];
  if (a) {
    if (a.kind === 'approve') return `<span class="badge rev-ok" title="APPROVE postado${a.auto ? ' automaticamente pelo protocolo' : ' por você'} via Farol">✅ você aprovou</span>`;
    if (a.kind === 'request_changes') return '<span class="badge rev-rc" title="REQUEST CHANGES postado por você via Farol">✋ você pediu mudanças</span>';
    if (a.kind === 'comment') return '<span class="badge rev-cm" title="COMMENT postado por você via Farol">💬 você comentou</span>';
  }
  if (pr.reviewedByMe) return '<span class="badge rev-ok" title="Você já revisou este PR no GitHub">✔ revisado por você</span>';
  return '';
}

export function chatBadge(key, chats) {
  const c = (chats || {})[key];
  return c && c.count ? ` <span class="count">${c.count}</span>` : '';
}

export const PB_OPTS = [['', 'sem pushback'], ['author_right', 'o autor tinha razão'], ['we_right', 'nós tínhamos razão'], ['mixed', 'meio-termo']];

export const PB_SHORT = { author_right: 'autor tinha razão', we_right: 'nós tínhamos razão', mixed: 'meio-termo' };

export function pushbackControl(r, pushbacks) {
  const author = (r.pr && r.pr.author) || r.author || '';
  if (!author) return '';
  const pb = (pushbacks || {})[r.key] || null;
  const pending = pb && pb.status === 'pending';    // auto em dúvida: pede confirmação
  const sum = resumoDoPushback(pending, pb);
  const title = pending ? 'O Farol suspeita de pushback aqui; confirme ou corrija o desfecho'
    : 'Marque se o autor contestou este review, pra calibrar os reviews futuros dele';
  return `<details class="pushback"${pb ? ' data-set="1"' : ''}${pending ? ' data-pending="1" open' : ''}>
    <summary title="${title}">${sum}</summary>
    <div class="pb-body">
      ${pending ? `<span class="pb-hint">O Farol detectou possível pushback${pb.note ? ` (${esc(pb.note)})` : ''}. Confirme o desfecho:</span>` : ''}
      <select class="pb-outcome" data-key="${esc(r.key)}" data-author="${esc(author)}">
        ${PB_OPTS.map(([v, t]) => `<option value="${v}"${pb && pb.outcome === v ? ' selected' : ''}>${t}</option>`).join('')}
      </select>
      <input class="pb-note" data-key="${esc(r.key)}" data-author="${esc(author)}" value="${esc(pb && pb.note || '')}" placeholder="nota curta (opcional)" spellcheck="false" maxlength="300">
      ${pending ? `<button class="btn sm primary pb-confirm" data-key="${esc(r.key)}" data-author="${esc(author)}" title="Grava o desfecho selecionado como confirmado (re-selecionar a mesma opção não dispara change; com '' confirma que NÃO houve pushback)">Confirmar</button>` : ''}
    </div>
  </details>`;
}

const RESOLVED_LABELS = {
  auto_approved: ['✅', 'aprovado sozinho'],
  auto_rejected: ['🔴', 'mudanças pedidas sozinho'],
  posted: ['📬', 'postado por você'],
  already_reviewed: ['✔', 'já revisado por você (não repostei)'],
  already_merged: ['🔀', 'já foi mergeado (cancelei a revisão pendente)'],
  already_closed: ['🚫', 'PR fechado sem merge (cancelei a revisão pendente)'],
  skipped: ['⏭', 'pulado'],
  superseded: ['♻', 'substituída por uma revisão nova']
};

const RESOLVED_ACTIONS = { approve: 'APPROVE', request_changes: 'REQUEST CHANGES', comment: 'COMMENT' };

// cor do selo pela AÇÃO postada, não pelo status: o desfecho é o que se procura ao
// varrer a lista. Pulado fica neutro de propósito, porque nada foi postado.
const VERDICT_CLASS = { approve: 'rev-ok', request_changes: 'rev-rc', comment: 'rev-cm' };

// O rótulo diz de QUE lista se está falando, e ela muda com o status: em
// already_reviewed o achado não foi postado, em auto_rejected ele é o bloqueio, em
// posted é o que trouxe o PR pra mesa. Fora desses, é ponto de atenção comum.
const ROTULO_DOS_PONTOS = {
  already_reviewed: (p) => `achado${p ? 's' : ''} que ${p ? 'ficaram' : 'ficou'} só aqui`,
  auto_rejected: (p) => `motivo${p ? 's' : ''} do pedido de mudanças`,
  posted: (p) => `motivo${p ? 's' : ''} de ter vindo pra você`,
};

function rotuloDosPontos(status, plural) {
  const f = ROTULO_DOS_PONTOS[status];
  return f ? f(plural) : `ponto${plural ? 's' : ''} de atenção`;
}

// `attention` manda quando existe; senão, nos status que carregam motivo, os reasons
// fazem as vezes (a recusa por contestação ou cobertura precisa aparecer em algum lugar).
function pontosDeAtencao(r, comReasons) {
  if (r.attention && r.attention.length) return r.attention;
  return comReasons.includes(r.status) ? (r.reasons || []) : [];
}

// a contagem vem pronta quando é número; sem ela, conta a lista; sem as duas, zero
function divergenciasDoCheckpoint(vc) {
  if (!vc) return 0;
  const n = Number(vc.conflictCount);
  if (Number.isFinite(n)) return n;
  return Array.isArray(vc.conflicts) ? vc.conflicts.length : 0;
}

// pendente pede confirmação; confirmado mostra o desfecho (e de onde ele veio)
function resumoDoPushback(pending, pb) {
  const nome = (p) => esc(PB_SHORT[p.outcome] || 'pushback');
  if (pending) return `↩ confirmar: ${nome(pb)}?`;
  if (pb) return `↩ ${nome(pb)}${pb.source === 'auto' ? ' (auto)' : ''}`;
  return '↩ pushback?';
}

export function resolvedRow(r, ctx) {
  ctx = ctx || {};
  const [icon, label] = RESOLVED_LABELS[r.status] || ['•', r.status];
  const act = (r.status === 'posted' || r.status === 'already_reviewed')
    ? ` (${RESOLVED_ACTIONS[r.action] || r.action})` : '';
  const url = (r.pr && r.pr.url) || '';
  const title = (r.pr && r.pr.title) || '';
  const author = (r.pr && r.pr.author) || r.author || '';
  // pontos de atenção de um PR resolvido sozinho: ficam claros aqui (expansível).
  // already_reviewed entra na mesma regra desde o #742: "não repostei" significa que o
  // que a revisão achou ficou SÓ no app, então esconder as reasons justo nesse status
  // deixava o achado sem nenhuma superfície (nem no PR, nem na linha). O rótulo dele diz
  // isso na cara, pra não parecer que alguém já leu.
  // `posted` (você resolveu na mão) entrou na lista depois do #767: a linha mostrava
  // só "postado por você" e engolia o motivo de o PR ter caído na sua mesa, então uma
  // recusa por contestação ou cobertura era lida como se a chave de aprovar sozinho
  // estivesse quebrada. O motivo já estava gravado em `reasons`, faltava a superfície.
  const COM_REASONS = ['auto_approved', 'auto_rejected', 'already_reviewed', 'posted'];
  const attn = pontosDeAtencao(r, COM_REASONS);
  const plural = attn.length > 1;
  const attnLabel = rotuloDosPontos(r.status, plural);
  const vcls = VERDICT_CLASS[r.action] || '';
  const vc = r.verificationCheckpoint;
  const vcConflicts = divergenciasDoCheckpoint(vc);
  const vcLine = (vc && vc.total)
    ? `Verificação de afirmações: ${vc.confirmedCount} confirmadas de ${vc.total}`
      + (vcConflicts ? ` · ⚠ ${vcConflicts} divergência(s) entre passadas` : '')
    : '';
  const stLine = stagesLine(r.stages);
  return `<div class="rrow${attn.length ? ' has-attn' : ''}">
    <span class="rr-icon" aria-hidden="true">${icon}</span>
    <div class="rr-main">
      <div class="rr-head">
        <a class="rr-ref" href="${esc(url || '#')}" target="_blank" rel="noreferrer">${esc(r.key)}</a>
        ${ctx.chip || ''}
        ${r.card ? `<span class="pill">${esc(r.card)}</span>` : ''}
        <span class="rr-verdict${vcls ? ` ${vcls}` : ''}">${label}${act}</span>
      </div>
      ${title ? `<div class="rr-title" title="${esc(title)}">${esc(title)}</div>` : ''}
      ${author ? `<div class="rr-person">${personMention(author, 'sm')}</div>` : ''}
      <div class="rr-disc">
        ${vcLine ? `<div class="rr-verification">${esc(vcLine)}</div>` : ''}
        ${stLine ? `<div class="rr-stages">${esc(stLine)}</div>` : ''}
        ${attn.length ? `<details class="resolved-attn"><summary>⚠ ${attn.length} ${attnLabel}</summary>${reasonGroupsHtml(attn, r.postRetry)}</details>` : ''}
        ${r.reportMarkdown ? `<details class="dec-report"><summary>Ver relatório completo</summary><div class="report">${md(r.reportMarkdown)}</div></details>` : ''}
        ${pushbackControl(r, ctx.pushbacks)}
      </div>
    </div>
    <div class="rr-side">
      <span class="rr-when" title="${esc(fmtStamp(r.resolvedAt))}">${esc(fmtWhenDay(r.resolvedAt, ctx.agora))}</span>
      <div class="rr-acts">
        <button class="btn icon sm ghost act-chat" data-key="${esc(r.key)}" data-url="${esc(url)}" title="Conversar com o Claude sobre este PR" aria-label="Conversar sobre este PR">💬${ctx.chatBadge || ''}</button>
        ${url ? `<button class="btn icon sm ghost act-review" data-url="${esc(url)}" title="Revisar de novo" aria-label="Revisar de novo">↻</button>` : ''}
        <button class="btn icon sm ghost rr-copy" data-url="${esc(url)}" data-key="${esc(r.key)}" title="Copiar a URL do PR" aria-label="Copiar a URL do PR">⧉</button>
        <a class="btn icon sm ghost" href="${esc(url || '#')}" target="_blank" rel="noreferrer" title="Abrir no GitHub" aria-label="Abrir no GitHub">↗</a>
      </div>
    </div>
  </div>`;
}
