// O PR que ESTE aparelho conhece por trás de uma tag do conjunto, e o head dele agora.
//
// O conjunto só fala por tag (o PR nunca viaja em claro), então quem recebe um comando ou
// uma transferência precisa achar o PR nas próprias listas. Dois consumidores: os comandos
// remotos e a adoção do item transferido pela distribuição.
import { prTag } from '../sync/tags.js';

function prPorTag(engine, kId, tagDoPr) {
  const listas = [engine.queue, engine.panorama, engine.myPRs, engine.headlessQueue];
  for (const lista of listas) {
    const achado = (Array.isArray(lista) ? lista : []).find((pr) => pr && pr.key && prTag(kId, pr.key) === tagDoPr);
    if (achado) return achado;
  }
  return null;
}

// O PR da fila vem da busca do GitHub, que não traz o head; sem ele pergunta-se agora
// (`engine.headSha`), e falha na pergunta é head desconhecido. O `headSha` que o objeto já
// tiver continua valendo primeiro.
async function headAtual(engine, pr) {
  if (pr.headSha) return String(pr.headSha);
  if (typeof engine.headSha !== 'function') return '';
  try { return String((await engine.headSha(pr)) || ''); } catch { return ''; }
}

export default { prPorTag, headAtual };
export { prPorTag, headAtual };
