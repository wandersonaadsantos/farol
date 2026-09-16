// Projeção da sincronização para a TELA. Allowlist e nada mais: aqui não entra client,
// token, fetch nem credencial, e o uid vai cortado porque a tela só precisa reconhecê-lo.
//
// Este módulo saiu de `lib/engine/sync.js` quando ele passou do teto de tamanho: projeção
// e fiação são assuntos diferentes, e a projeção é o que a tela lê.
import { SYNC } from '../constants.js';

function texto(v) {
  return typeof v === 'string' ? v : '';
}

// `retiredAt` entra na projeção porque a tela precisa distinguir sumido de aposentado;
// quem escreve esse campo é só lib/engine/sync-aparelho.js, nunca o caminho automático.
// `farolVersion` é o que deixa a tabela de aparelhos dizer quem já está na versão nova.
function projecaoDoAparelho(d) {
  const o = d && typeof d === 'object' ? d : {};
  return { name: texto(o.name), platform: texto(o.platform), farolVersion: texto(o.farolVersion), lastSeenAt: Number(o.lastSeenAt) || 0, retiredAt: Number(o.retiredAt) || 0 };
}

function aparelhosDe(data) {
  const saida = {};
  if (!data || typeof data !== 'object') return saida;
  for (const [id, d] of Object.entries(data)) saida[id] = projecaoDoAparelho(d);
  return saida;
}

// "Sem presença" usa a MESMA janela da frota (lib/sync/frota.js): fora dela o aparelho não
// conta como alguém para ler. Este aparelho está aqui por definição, e o aposentado já tem
// o próprio selo.
function semPresenca(d, euMesmo, agora) {
  if (euMesmo || Number(d.retiredAt) > 0) return false;
  const visto = Number(d.lastSeenAt) || 0;
  return visto <= 0 || agora - visto > SYNC.FROTA_JANELA_MS;
}

function listaDeAparelhos(rt) {
  const agora = typeof rt.agora === 'function' ? rt.agora() : Date.now();
  return Object.entries(rt.devices).map(([deviceId, d]) => {
    const euMesmo = deviceId === rt.deviceId;
    return { deviceId, ...d, euMesmo, semPresenca: semPresenca(d || {}, euMesmo, agora) };
  });
}

// As tomadas forçadas (7.C8) dos dois lados. A tela mostra as recentes; o registro
// completo do que aconteceu está no log e no recibo da operação.
function ultimasTomadas(lista) {
  return Array.isArray(lista) ? lista.slice(0, 10) : [];
}

export default { projecaoDoAparelho, aparelhosDe, listaDeAparelhos, ultimasTomadas };
export { projecaoDoAparelho, aparelhosDe, listaDeAparelhos, ultimasTomadas };
