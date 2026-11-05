// Quem o Farol revisa sozinho, além do head decidido (skip-review.js). O PR pode esperar muito na
// fila, e o autor pode tirar o pedido nesse meio tempo (tenant-company#276: tirado às 23:56, aprovado
// às 00:33). Pedido só a um time não é a conta marcada; o do CODEOWNERS é, por decisão do dono.
import io from '../io.js';
import { ultimoPedidoDeRevisao } from './gh-queries.js';
import { temPedidoAutomatico } from './retirada-de-pedido.js';

const ORIGENS_EXPLICITAS = ['manual', 'viaAdmin', 'viaComando'];
const DECISIVOS = new Set(['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED']);

// Clique, aparelho admin e comando são o dono pedindo.
// Revisar tudo (`lote`) também é clique, mas sem escolha por PR: não conta como explícito.
const origemExplicita = (pr) => !pr?.lote && ORIGENS_EXPLICITAS.some((m) => pr?.[m] === true);

const temPendencia = (engine, pr) => (engine.decisions?.pending || []).some((d) => d.key === pr.key);

// Revisão decisiva anterior da conta é continuação: o GitHub tira o pedido quando ela revisa. Com
// pendência viva, a rodada já foi admitida e está em recuperação (retomar por clique cairia aqui
// sem marca nenhuma, porque o relançamento não a carrega). Falta de dado não inventa recusa.
async function pedidoSaiu(engine, pr) {
  if (origemExplicita(pr)) return false;
  if (temPendencia(engine, pr)) return false;
  const conta = engine.accountForPr?.(pr);
  if (!pr.url || !conta || !engine.tokenFor?.(conta)) return false;
  let env;
  try { env = engine.ghEnv(conta); } catch { return false; /* sem credencial para ler: falta de dado */ }
  const r = await io.run('gh', ['pr', 'view', pr.url, '--json', 'reviewRequests,reviews'], { env });
  const j = r.ok ? io.parseJson(r.stdout, null) : null;
  if (!Array.isArray(j?.reviewRequests) || !Array.isArray(j?.reviews)) return false;
  const eu = String(conta).toLowerCase();
  const ehEu = (login) => String(login || '').toLowerCase() === eu;
  return !j.reviewRequests.some((q) => ehEu(q.login)) && !j.reviews.some((x) => ehEu(x.author?.login) && DECISIVOS.has(x.state));
}

// O meu pedido de mudanças AUTOMÁTICO, aberto em commit anterior: só a rodada consegue retirá-lo,
// e sem ela ele prenderia um PR já aprovado. O feito à mão não sai pela rodada, então não libera.
function pedidoMeuAberto(engine, pr, head) {
  const info = (engine.staleInfo || {})[pr.key];
  return !!(info && info.stale && info.lastState === 'CHANGES_REQUESTED' && engine.decisions && temPedidoAutomatico(engine, pr, head));
}

// PR segurado fica na fila e passaria pelo gate a cada ciclo. Enquanto o updatedAt não muda, nem a
// decisão nem o pedido mudaram: a resposta é a mesma, sem gastar gh (a régua segura muito mais PR
// desde 05/11/2026, e a busca já vinha batendo no limite de rajada do GitHub).
function jaSegurado(engine, pr) {
  return !!pr.updatedAt && engine.seguradosPorUpdatedAt?.get(pr.key) === pr.updatedAt;
}
function lembrarSegurado(engine, pr) {
  // com pedido automático meu, a resposta depende do staleInfo, que muda sem mudar o updatedAt
  if (!pr.updatedAt || (engine.decisions && temPedidoAutomatico(engine, pr, ''))) return;
  if (!engine.seguradosPorUpdatedAt) engine.seguradosPorUpdatedAt = new Map();
  engine.seguradosPorUpdatedAt.set(pr.key, pr.updatedAt);
}

// A metade do gate da fila que olha o pedido, com a memória.
async function seguradoPeloPedido(engine, pr) {
  if (jaSegurado(engine, pr)) return !temPendencia(engine, pr);
  if (!(await pedidoSaiu(engine, pr))) return false;
  engine.log('INFO', `${pr.key}: o pedido de revisão não está mais com esta conta; não reviso sozinho.`);
  lembrarSegurado(engine, pr);
  return true;
}

// Quem pediu a revisão automática (B1): uma leitura da timeline por sessão, fora do caminho da
// revisão (nunca a atrasa nem a derruba). Guarda o pedido no registro da sessão e no pr (as
// provas da decisão o leem de lá), avisa a tela e as cascas, e só então atualiza o estado.
function registrarPedidoDaSessao(engine, id, pr) {
  if (pr.manual) return Promise.resolve();
  return ultimoPedidoDeRevisao(engine, pr).then((pedido) => {
    const s = engine.activeReviews.get(id);
    if (!s) return;
    s.pedido = pedido;
    pr.pedido = pedido;
    const hora = pedido && new Date(pedido.em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const quem = pedido && hora ? `, pedida por @${pedido.por} às ${hora}` : '';
    engine.emit('toast', { kind: 'info', text: `▶ ${pr.key}: revisão automática iniciada${quem}` });
    engine.emit('review-started', { pr, pedido });
    engine.pushState();
  }).catch(() => {});
}

export { registrarPedidoDaSessao, origemExplicita, pedidoSaiu, pedidoMeuAberto, seguradoPeloPedido, lembrarSegurado };
