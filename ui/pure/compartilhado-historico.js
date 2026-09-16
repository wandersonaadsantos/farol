// A história de revisões entre aparelhos e o envio do histórico local (brief B2, item 2.7),
// parte PURA. Irmã de compartilhado.js: o assunto é o mesmo, e o arquivo foi separado só
// para cada um caber no teto de tamanho.
//
// O ÍNDICE que chega de POST /api/sync/reviews não traz o PR em claro (lib/sync/historico.js
// sobe o PR como tag), então a linha nomeia o aparelho, o veredito e o desfecho, e o corpo
// se abre sob demanda. O corpo é a projeção que a tela já usa, com o review humanizado.
//
// O ENVIO do histórico é medido antes de confirmar, e a confirmação carrega a impressão da
// medida: se o histórico mudou no meio, o engine recusa com `medida-vencida` e a tela pede
// medir de novo, sem dizer que enviou nada.
import { esc, fmtTok, fmtWhenDay, md } from './comum.js';
import { prRefMention } from './mencoes.js';

const VEREDITO_CHIP = {
  approve: { classe: 'ok', rotulo: 'aprovar' },
  request_changes: { classe: 'bad', rotulo: 'mudanças' },
  comment: { classe: 'info', rotulo: 'comentário' },
  skip: { classe: 'mute', rotulo: 'pulado' },
};

const STATUS = {
  pending: 'esperando decisão', posted: 'postado', auto_approved: 'aprovado sozinho',
  auto_rejected: 'reprovado sozinho', already_reviewed: 'já revisado', skipped: 'pulado', superseded: 'substituído',
};

function chipDoVeredito(v) {
  const m = VEREDITO_CHIP[v];
  return m ? `<span class="sync-chip ${m.classe}">${esc(m.rotulo)}</span>` : '<span class="sync-chip mute">sem veredito</span>';
}

function origemChip(item, deviceIdLocal) {
  if (item.dev && item.dev === deviceIdLocal) return '<span class="sync-chip info">este</span>';
  return `<span class="sync-chip mute">${esc(item.aparelho || 'outro aparelho')}</span>`;
}

function revisaoLinhaHtml(item, ctx) {
  const status = STATUS[item.status] || 'sem desfecho';
  return `<div class="md-rev" data-review="${esc(item.reviewId)}">
    <span class="md-rev-txt"><b>${esc(status)}</b> <span class="md-fraco">${esc(fmtWhenDay(item.t, ctx.agora))}</span></span>
    ${chipDoVeredito(item.veredito)}
    ${origemChip(item, ctx.deviceIdLocal)}
    <button class="btn sm ghost md-ver-revisao" data-review="${esc(item.reviewId)}">Ver revisão</button>
  </div>`;
}

const ESCOPO_ROTULO = { todos: 'Todos os aparelhos', este: 'Só este' };

function escopoBotoesHtml(escopo) {
  return Object.entries(ESCOPO_ROTULO).map(([id, rotulo]) => {
    const ativo = id === escopo;
    const classe = ativo ? ' active' : '';
    return `<button class="btn sm ghost md-escopo${classe}" data-escopo="${id}" aria-pressed="${String(ativo)}">${esc(rotulo)}</button>`;
  }).join('');
}

// `estado` separa o que a lista vazia NÃO pode esconder: carregando, falha e vazio legítimo.
export function revisoesCompartilhadasHtml(entrada) {
  const e = entrada || {};
  const escopo = e.escopo === 'este' ? 'este' : 'todos';
  const topo = `<div class="md-linha md-rev-topo">${escopoBotoesHtml(escopo)}</div>`;
  if (e.estado === 'carregando') return `${topo}<p class="md-vazio">Buscando as revisões de todos os aparelhos…</p>`;
  if (e.estado === 'falha') return `${topo}<p class="md-vazio md-ruim">A busca das revisões falhou. A lista deste aparelho, acima, continua valendo.</p>`;
  const lista = Array.isArray(e.revisoes) ? e.revisoes : [];
  if (!lista.length) return `${topo}<p class="md-vazio">Nenhuma revisão compartilhada ainda.</p>`;
  const ctx = { agora: e.agora || Date.now(), deviceIdLocal: e.deviceIdLocal || '' };
  return `${topo}<div class="card md-lista">${lista.map((item) => revisaoLinhaHtml(item || {}, ctx)).join('')}</div>
    <p class="md-nota">O endereço do PR não viaja no índice; ele aparece ao abrir a revisão, se o corpo trouxer. Revisão que não abriu fica de fora da lista inteira, nunca pela metade.</p>`;
}

// Resposta de POST /api/sync/review-body: `{found, revisao}` ou null (a chamada falhou).
export function revisaoAbertaHtml(resposta) {
  if (!resposta) return { ok: false, titulo: 'Não deu para abrir', corpo: '<p>A busca do corpo falhou. O resumo continua na lista.</p>' };
  if (resposta.found !== true || !resposta.revisao) return { ok: false, titulo: 'Revisão indisponível', corpo: '<p>O corpo desta revisão não abriu neste aparelho. O resumo continua na lista.</p>' };
  const r = resposta.revisao;
  const titulo = (r.pr && r.pr.title) || '';
  const ref = r.key ? `<p>${prRefMention(r.key)} ${esc(titulo)}</p>` : '';
  return { ok: true, titulo: 'Revisão de outro aparelho', corpo: `${ref}<div class="report">${md(r.reportMarkdown || '')}</div>` };
}

/* ---------- envio do histórico local ---------- */

function numeros(medida) {
  const m = medida || {};
  const mb = (Number(m.bytes) || 0) / (1024 * 1024);
  return `<div class="md-numeros">
    <span><span class="md-fraco">revisões anteriores</span> <b>${fmtTok(m.categorias && m.categorias.revisoes)}</b></span>
    <span><span class="md-fraco">a enviar</span> <b>${fmtTok(m.pendentes)}</b></span>
    <span><span class="md-fraco">tamanho cifrado, medido</span> <b>${esc(mb.toFixed(1).replace('.', ','))} MB</b></span>
  </div>`;
}

// acima disto a tela recomenda conexão estável antes de enviar
const ENVIO_GRANDE_BYTES = 5 * 1024 * 1024;

// o número do lote é do engine; sem ele (resposta antiga), a tela não o calcula
function qualLote(fonte) {
  const n = Number(fonte && fonte.lote) || 0;
  const total = Number(fonte && fonte.lotes) || 0;
  return n > 0 && total > 0 ? `lote ${fmtTok(n)} de ${fmtTok(total)}` : '';
}

function progresso(parcial, medida) {
  if (!parcial) return qualLote(medida) || 'primeiro lote';
  const lote = qualLote(parcial);
  const contas = `${fmtTok(parcial.enviados)} enviadas, ${fmtTok(parcial.restantes)} faltando`;
  return lote ? `${lote} (${contas})` : contas;
}

const ENVIO_FASE = {
  inicial: () => ({ corpo: '', botoes: '<button class="btn sm md-medir">Medir o histórico</button>' }),
  medindo: () => ({ corpo: '<span class="pill busy">medindo</span>', botoes: '' }),
  enviando: (e) => ({ corpo: `<span class="pill busy">enviando</span> <span class="md-fraco">${progresso(e.parcial, e.medida)}</span>`, botoes: '' }),
  concluido: () => ({ corpo: '<span class="sync-chip ok">enviado</span> <span class="md-fraco">sem duplicar o que já estava lá</span>', botoes: '<button class="btn sm ghost md-medir">Medir de novo</button>' }),
  vencida: () => ({ corpo: '<span class="sync-chip warn">medir de novo</span> <span class="md-fraco">o histórico mudou desde a medida, e nada foi enviado</span>', botoes: '<button class="btn sm md-medir">Medir de novo</button>' }),
};

function faseMedida(e) {
  const m = e.medida || {};
  if (!(Number(m.pendentes) > 0)) {
    return { corpo: '<span class="md-fraco">Nada a enviar: todo o histórico anterior deste aparelho já está compartilhado.</span>', botoes: '<button class="btn sm ghost md-medir">Medir de novo</button>' };
  }
  const aviso = Number(m.bytes) > ENVIO_GRANDE_BYTES ? '<span class="md-fraco">É um volume grande: envie com internet estável. O envio é retomável se cair.</span>' : '';
  return { corpo: `${numeros(m)}${aviso}`, botoes: `<button class="btn sm primary md-enviar">Enviar ${fmtTok(m.pendentes)} revisões</button><button class="btn sm ghost md-medir">Medir de novo</button>` };
}

// Falha no meio de um envio já começado é INTERROMPIDO, e continuar usa a mesma medida:
// o engine confere a impressão de novo e recusa se o histórico tiver mudado.
function faseFalha(e) {
  const motivo = e.erro && e.erro.motivo ? e.erro.motivo : 'o engine não respondeu';
  if (e.parcial) {
    return {
      corpo: `<span class="sync-chip warn">interrompido</span> <span class="md-fraco">${fmtTok(e.parcial.enviados)} enviadas, ${fmtTok(e.parcial.restantes)} faltando: ${esc(motivo)}</span>`,
      botoes: '<button class="btn sm primary md-enviar">Continuar o envio</button><button class="btn sm ghost md-medir">Medir de novo</button>',
    };
  }
  return { corpo: `<span class="sync-chip bad">falhou</span> <span class="md-fraco">${esc(motivo)}</span>`, botoes: '<button class="btn sm md-medir">Medir de novo</button>' };
}

export function envioHistoricoHtml(estadoDoEnvio) {
  const e = estadoDoEnvio || {};
  let fase = ENVIO_FASE.inicial(e);
  if (ENVIO_FASE[e.fase]) fase = ENVIO_FASE[e.fase](e);
  if (e.fase === 'medido') fase = faseMedida(e);
  if (e.fase === 'falha') fase = faseFalha(e);
  return `<div class="card md-envio">
    <span class="md-nota">Só sobe sozinho o que aconteceu depois de a visão compartilhada ser ligada aqui. O histórico anterior sobe por este envio explícito, cifrado, em lotes, e pode ser interrompido e retomado. Nunca sobem credenciais, a configuração inteira nem o histórico do Claude Code.</span>
    <div class="md-linha">${fase.corpo}</div>
    <div class="md-acoes">${fase.botoes}</div>
  </div>`;
}

// Estado seguinte do envio a partir da resposta de POST /api/sync/history-send. `anterior`
// é o progresso acumulado; um lote que não sobe nada é interrupção, nunca "enviando" para
// sempre (o engine para no primeiro item que não sobe e responde ok com zero enviados).
export function envioDepoisDoLote(medida, resposta, anterior) {
  const r = resposta || null;
  const feitos = Number(anterior && anterior.enviados) || 0;
  const parcial = feitos ? { enviados: feitos, restantes: Number(anterior.restantes) || 0 } : null;
  if (!r) return { fase: 'falha', medida, parcial, erro: { motivo: 'a chamada não chegou ao engine' } };
  if (r.ok !== true && r.code === 'medida-vencida') return { fase: 'vencida' };
  if (r.ok !== true) return { fase: 'falha', medida, parcial, erro: r };
  if (r.concluido === true) return { fase: 'concluido' };
  const agora = { enviados: feitos + (Number(r.enviados) || 0), restantes: Number(r.restantes) || 0 };
  // o número do lote só entra quando o engine o manda
  if (Number(r.lote) > 0 && Number(r.lotes) > 0) Object.assign(agora, { lote: Number(r.lote), lotes: Number(r.lotes) });
  if (!(Number(r.enviados) > 0)) return { fase: 'falha', medida, parcial: agora, erro: { motivo: 'nenhuma revisão subiu neste lote' } };
  return { fase: 'enviando', medida, parcial: agora };
}
