// Quantos aparelhos vivos do conjunto buscam no GitHub com a MESMA conta (16/10/2026).
//
// O limite de busca do GitHub é por CONTA, somando todos os lugares que usam o token dela.
// Cada Farol já se segura em 20 buscas por minuto (lib/engine/orcamento-busca.js), mas uma
// conta estava em três aparelhos (admin, celular e computador) e outra em dois: juntos eles
// passavam do teto, e o admin tomava "limite de rajada" várias vezes por dia. Com esta
// contagem, cada aparelho fica com a sua parte.
//
// A fonte é o painel que cada aparelho publica (`contasComToken`, por tag de conta), lido
// a cada minuto no relógio da frota (lib/engine/sync-painel.js), e a presença em `devices`.
// Sem compartilhamento ligado, ou sem leitura ainda, a resposta é 1: o comportamento de antes.
import kek from '../sync/kek.js';
import { acctTag } from '../sync/tags.js';
import { SYNC } from '../constants.js';

// Vivo é quem carimbou presença dentro de três intervalos dela, a mesma régua da admissão.
const VIVO_MS = SYNC.PRESENCE_TICK_MS * 3;

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

// PURA: este aparelho mais os OUTROS vivos, não aposentados, cujo painel tem a conta com token.
function contarAparelhos({ paineis, devices, tag, eu, agora }) {
  let n = 1;
  for (const [dev, reg] of Object.entries(objeto(paineis) ? paineis : {})) {
    if (dev === eu || !reg || !objeto(reg.painel)) continue;
    const d = objeto(devices) && objeto(devices[dev]) ? devices[dev] : {};
    if (Number(d.retiredAt) > 0 || agora - (Number(d.lastSeenAt) || 0) > VIVO_MS) continue;
    if ((reg.painel.contasComToken || []).includes(tag)) n += 1;
  }
  return n;
}

function aparelhosComAConta(engine, user, agora = Date.now()) {
  const rt = engine && engine.sync;
  if (!rt || !rt.material || !objeto(rt.paineis) || !user) return 1;
  const tag = acctTag(kek.bufferDe(rt.material.id), String(user));
  return contarAparelhos({ paineis: rt.paineis, devices: rt.devices, tag, eu: rt.deviceId, agora });
}

export default { contarAparelhos, aparelhosComAConta, VIVO_MS };
export { contarAparelhos, aparelhosComAConta, VIVO_MS };
