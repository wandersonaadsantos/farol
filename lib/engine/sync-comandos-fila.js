// Os comandos do controle do celular (28/09/2026), no aparelho ALVO: mexer na fila dele e
// na configuração das contas dele pelo admin. A ordem das recusas, a idempotência e o
// recibo são do ciclo de sempre (lib/engine/sync-comandos.js); aqui mora só o efeito.
//
// CT-FIO, outra vez: `revisar` NUNCA vira clique. O PR sai de `comando.prDoComando`, que
// tira `manual` e `requested`, e ganha `viaAdmin`, que só faz duas coisas: o enqueueHeadless
// não o devolve à distribuição e o estacionamento sai dele. Saída de cena, gate de
// consciência e checks obrigatórios continuam valendo, e quando um deles segura, o recibo
// diz qual. Sem `requested`, a revisão nunca aprova sozinha: vira pendência, e a decisão
// volta ao computador (invariante 4).
//
// IGNORAR, RESTAURAR, OCULTAR E MOSTRAR são os mesmos métodos das rotas locais
// (/api/ignore, /api/restore, /api/pr/hide, /api/pr/unhide): o admin aperta, pelo banco, o
// mesmo botão que a pessoa na frente do aparelho apertaria.
import comando from '../sync/comando.js';
import { prTag, acctTag } from '../sync/tags.js';
import prProprio from './pr-proprio.js';
import { prPorTag } from './pr-por-tag.js';
import { aguardaChecksParaRevisar } from './checks-exigidos.js';

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function recusado(code) {
  return { estado: 'recusado', code };
}

// A chave do PR por trás da tag: primeiro nas listas de sempre (pr-por-tag.js) e, quando
// não achou, nas chaves que o próprio efeito conhece (o ignorado sai da fila, e o oculto
// pode ter saído do Panorama).
function chavePorTag(engine, kId, tagDoPr, extras = []) {
  const pr = prPorTag(engine, kId, tagDoPr);
  if (pr) return pr.key;
  for (const fonte of extras) {
    const chaves = fonte instanceof Set ? [...fonte] : Object.keys(fonte || {});
    const achada = chaves.find((k) => prTag(kId, k) === tagDoPr);
    if (achada) return achada;
  }
  return '';
}

// Tira do estacionamento e grava, como o launchReview faz no clique (review.js).
function desestacionar(engine, key) {
  const saiu = engine.autoReviewParked instanceof Set && engine.autoReviewParked.delete(key);
  if (engine.parkedMotivos && engine.parkedMotivos[key]) delete engine.parkedMotivos[key];
  if (saiu && typeof engine.saveAutoReviewParked === 'function') engine.saveAutoReviewParked();
}

// As travas que o pedido do admin NÃO atravessa, na ordem do caminho automático, cada uma
// com o código que vai no recibo. O gate de consciência e o de checks são as duas metades do
// bloqueiaAutomatico (skip-review.js), consultadas em separado para o recibo dizer qual.
async function travaDoPedido(engine, pr) {
  if (prProprio.ehMeu(engine, pr)) return 'pr-proprio';
  if (engine.skipComentado && engine.skipComentado[pr.key]) return 'saida-de-cena';
  const outros = typeof engine.outrosRevisando === 'function' ? engine.outrosRevisando(pr) : [];
  if (Array.isArray(outros) && outros.length) return 'outros_revisando';
  const conta = engine.accountForPr(pr);
  if (typeof engine.tokenFor === 'function' && !engine.tokenFor(conta)) return 'sem_token';
  const hist = typeof engine.bloqueadoPorHistorico === 'function' ? await engine.bloqueadoPorHistorico(pr) : null;
  if (hist && hist.bloqueado) return 'bloqueado_historico';
  // a espera pelo CI antes de revisar é opt-in (aguardarCiParaRevisar), igual ao caminho automático
  const checks = aguardaChecksParaRevisar(engine) && typeof engine.bloqueadoPorChecks === 'function' ? await engine.bloqueadoPorChecks(pr) : null;
  if (checks && checks.bloqueado) return 'checks_pendentes';
  return '';
}

async function revisar(engine, kId, args) {
  const pr = prPorTag(engine, kId, args.prTag);
  if (!pr) return recusado('nao_conheco');
  const trava = await travaDoPedido(engine, pr);
  if (trava) return recusado(trava);
  const item = { ...comando.prDoComando(pr), account: engine.accountForPr(pr), viaAdmin: true };
  desestacionar(engine, pr.key);
  // o retry pendente seria uma segunda revisão do mesmo PR quando a rede voltasse
  if (engine.retryAfterNet instanceof Map) engine.retryAfterNet.delete(pr.key);
  const r = engine.enqueueHeadless(item);
  if (!r || !r.ok) return recusado((r && r.code) || 'nao_enfileirou');
  // o mesmo que o launchReview e a repescagem fazem ao lançar: o card deixa de dizer
  // "aguardando você" com a revisão já na fila
  if (typeof engine.markSeen === 'function') engine.markSeen(pr.key);
  if (Array.isArray(engine.queue)) engine.queue = engine.queue.filter((p) => p && p.key !== pr.key);
  if (typeof engine.pushState === 'function') engine.pushState();
  return { estado: 'aplicado' };
}

function ignorar(engine, kId, args) {
  const key = chavePorTag(engine, kId, args.prTag);
  if (!key) return recusado('nao_conheco');
  engine.ignore(key);
  return { estado: 'aplicado' };
}

function restaurar(engine, kId, args) {
  const key = chavePorTag(engine, kId, args.prTag, [engine.ignorados, engine.seen]);
  if (!key) return recusado('nao_conheco');
  engine.restore(key);
  return { estado: 'aplicado' };
}

// Ocultar é de Meus PRs: PR que não é meu não tem o botão lá, e não ganha aqui.
function ocultar(engine, kId, args) {
  const meu = (Array.isArray(engine.myPRs) ? engine.myPRs : []).find((p) => p && p.key && prTag(kId, p.key) === args.prTag);
  if (!meu) return recusado('nao_conheco');
  const r = engine.hidePR(meu.key);
  return r && r.ok ? { estado: 'aplicado' } : recusado('nao_ocultou');
}

function mostrar(engine, kId, args) {
  const key = chavePorTag(engine, kId, args.prTag, [engine.hiddenPRs]);
  if (!key) return recusado('nao_conheco');
  engine.unhidePR(key);
  return { estado: 'aplicado' };
}

// O nome do aparelho que mandou: o admin da geração vigente, como este aparelho o enxerga.
function nomeDoAdmin(rt) {
  const admin = rt && objeto(rt.sinais) && objeto(rt.sinais.admin) ? rt.sinais.admin : null;
  const d = admin && objeto(rt.devices) ? rt.devices[admin.dev] : null;
  return objeto(d) && d.name ? String(d.name) : '';
}

// A conta é resolvida entre as DESTE aparelho: tag que não é de nenhuma conta daqui é recusa,
// nunca conta criada. A edição passa pelo mesmo caminho da tela de Contas (editarConta, por
// operação sobre a config atual), e o rastro fica com origem `admin` e o nome de quem mandou.
function configConta(engine, kId, args) {
  const contas = typeof engine.accountList === 'function' ? engine.accountList() : [];
  const conta = contas.find((a) => a && a.user && acctTag(kId, a.user) === args.acctTag);
  if (!conta) return recusado('conta_desconhecida');
  const op = { tipo: 'editar', user: conta.user, campos: { [args.campo]: args.valor } };
  const r = engine.editarConta(op, { origem: 'admin', aparelho: nomeDoAdmin(engine.sync) });
  return r && r.ok ? { estado: 'aplicado' } : recusado('nao_editou');
}

const EFEITOS = { revisar, ignorar, restaurar, ocultar, mostrar, 'config-conta': configConta };

function trataDaFila(tipo) {
  return Object.hasOwn(EFEITOS, tipo);
}

async function executarDaFila(engine, kId, { tipo, args }) {
  return EFEITOS[tipo](engine, kId, args);
}

export default { trataDaFila, executarDaFila };
export { trataDaFila, executarDaFila };
