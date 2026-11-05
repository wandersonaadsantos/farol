// PR em conflito com a base não abre sessão automática (C2, 05/11/2026). A sessão paga
// revisava o PR e o modelo pedia mudanças em público por causa do conflito, que quem abriu
// o PR resolve de graça. Antes de abrir a sessão automática, UMA leitura de `mergeable`:
// só 'CONFLICTING' segura (falta de dado, 'UNKNOWN' e null nunca seguram), o clique manual
// atravessa e 'MERGEABLE' apaga a marca. A leitura é cacheada por key + updatedAt, então custa
// uma chamada por mudança do PR. A marca `engine.esperaConflito[key] = { at, head }` vai ao
// snapshot e sustenta o motivo `conflito` da máquina de estados e a nota do card.
// O retry pós-transitório (review-retry.js) passa pelo mesmo gate. `marcarConflito` e `limparConflito` são a via de quem detecta o conflito por outro caminho.
import { mergeavelDoPr } from './gh-queries.js';

const ligado = (engine) => engine.config?.aguardarMergeavelParaRevisar !== false;
// segura (travaDoRound): marca presente e PR ainda no updatedAt lido
function marcaSegura(engine, pr) {
  const m = (engine.esperaConflito || {})[pr.key];
  return !!m && ligado(engine) && String(pr.updatedAt || '') === m.updatedAt;
}
const marcas = (engine) => (engine.esperaConflito ||= {});

function limparConflito(engine, key) {
  if (engine.esperaConflito) delete engine.esperaConflito[key];
}

// Grava a marca e avisa UMA vez por PR e head (memória em processo: errar custa um toast).
// `updatedAt` é o do PR no momento da leitura: a trava síncrona (travaDoRound) só segura enquanto
// o PR segue com ele; quando muda, o PR chega ao gate assíncrono, que relê e regrava ou limpa.
function marcarConflito(engine, key, head, agora = Date.now(), updatedAt = '') {
  marcas(engine)[key] = { at: agora, head: String(head || ''), updatedAt: String(updatedAt || '') };
  const avisados = (engine.conflitoAvisado ||= new Set());
  const chave = `${key}@${head || ''}`;
  if (avisados.has(chave)) return;
  avisados.add(chave);
  engine.emit('toast', { kind: 'info', text: `⏸ ${key}: em conflito com a base; a revisão automática abre quando o conflito for resolvido.` });
}

async function seguraPorConflito(engine, pr, { agora = Date.now(), ler = mergeavelDoPr } = {}) {
  if (!pr || pr.manual || !ligado(engine)) return false;
  const cache = (engine.conflitoLido ||= new Map());
  const visto = cache.get(pr.key);
  let estado;
  if (visto && visto.updatedAt === pr.updatedAt) estado = visto.estado;
  else {
    // leitura que lança (engine sem gh) é falta de dado: nunca segura
    try { estado = await ler(engine, pr); } catch { estado = null; }
    // falta de dado não é cacheada: tenta de novo no próximo ciclo, e nunca segura
    if (estado === 'CONFLICTING' || estado === 'MERGEABLE') cache.set(pr.key, { updatedAt: pr.updatedAt, estado });
  }
  if (estado === 'CONFLICTING') {
    let head = String(pr.headSha || pr.knownHead || '');
    if (!head && typeof engine.headSha === 'function') head = String((await engine.headSha(pr)) || '');
    marcarConflito(engine, pr.key, head, agora, pr.updatedAt);
    return true;
  }
  if (estado === 'MERGEABLE') limparConflito(engine, pr.key);
  return false;
}

export { marcaSegura, seguraPorConflito, marcarConflito, limparConflito, ligado };
export default { seguraPorConflito, marcarConflito, limparConflito, ligado };
