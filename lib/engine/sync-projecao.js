// Projeção da sincronização para a TELA. Allowlist e nada mais: aqui não entra client,
// token, fetch nem credencial, e o uid vai cortado porque a tela só precisa reconhecê-lo.
//
// Este módulo saiu de `lib/engine/sync.js` quando ele passou do teto de tamanho: projeção
// e fiação são assuntos diferentes, e a projeção é o que a tela lê.
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

function listaDeAparelhos(rt) {
  return Object.entries(rt.devices).map(([deviceId, d]) => ({ deviceId, ...d, euMesmo: deviceId === rt.deviceId }));
}

// As tomadas forçadas (7.C8) dos dois lados. A tela mostra as recentes; o registro
// completo do que aconteceu está no log e no recibo da operação.
function ultimasTomadas(lista) {
  return Array.isArray(lista) ? lista.slice(0, 10) : [];
}

export default { projecaoDoAparelho, aparelhosDe, listaDeAparelhos, ultimasTomadas };
export { projecaoDoAparelho, aparelhosDe, listaDeAparelhos, ultimasTomadas };
