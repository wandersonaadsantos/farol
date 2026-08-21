// Cache de card por site. Existe por medição: 339 leituras pra 143 cards
// distintos no histórico, com três cards lidos 17 vezes cada. Também é o que dá
// degradação boa quando o Jira cai no meio de uma rodada de revisões.
//
// O relógio entra por parâmetro, nunca Date.now() aqui dentro, pra expiração ter
// teste sem dormir.
import path from 'node:path';
import { STATE_DIR } from '../paths.js';
import { JIRA } from '../constants.js';
import io from '../io.js';

// Regra única de "identificador vira nome de arquivo" do recurso. Exportada de
// propósito: o caminho do mcp-config precisa da mesma defesa, e duas cópias da
// mesma regra divergem com o tempo. A borda (parseJiraSites) já rejeita id fora
// de forma; isto é a segunda camada, pra função exportada não confiar em quem
// chama.
function sanitizar(valor) {
  return String(valor || '').replace(/[^A-Za-z0-9_-]/g, '_');
}

function cardCachePath(siteId, key) {
  return path.join(STATE_DIR, JIRA.CACHE_DIR, sanitizar(siteId), `${sanitizar(key)}.json`);
}

function readCachedCard(siteId, key, agoraMs) {
  const registro = io.readJson(cardCachePath(siteId, key), null);
  if (!registro || !registro.card || typeof registro.fetchedAt !== 'number') return null;
  if (agoraMs - registro.fetchedAt > JIRA.CACHE_TTL_MS) return null;
  return registro.card;
}

function writeCachedCard(siteId, key, card, agoraMs) {
  const arquivo = cardCachePath(siteId, key);
  io.ensureDir(path.dirname(arquivo));
  io.writeJsonAtomic(arquivo, { fetchedAt: agoraMs, card });
}

export default { sanitizar, cardCachePath, readCachedCard, writeCachedCard };
export { sanitizar, cardCachePath, readCachedCard, writeCachedCard };
