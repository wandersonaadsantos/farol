// Gestão de aparelho (7.C2): renomear e aposentar.
//
// APOSENTAR É ATO EXPLÍCITO, e essa é a regra inteira. Inferir aposentadoria por ausência
// de presença seria conveniente e errado: sumir é um fato do mundo (aparelho desligado,
// sem rede, de férias), e aposentar é uma decisão de quem administra. Um aparelho que
// volta sozinho aposentado teria sido aposentado por ninguém.
//
// Por isso este módulo é o ÚNICO lugar que escreve `retiredAt`, e o caminho automático da
// presença nunca chega aqui. "Sumido" e "aposentado" seguem sendo estados diferentes.
//
// Aposentar também não é revogar: não apaga dado, não tira chave, não depõe admin e não
// encerra sessão. E tem volta, porque aposentar por engano precisa ter.
import { SYNC_CODES, motivoDe } from '../sync/errors.js';

function recusa(code, motivo) {
  return { ok: false, code, motivo: motivo || motivoDe(code) };
}

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function texto(v) { return typeof v === 'string' ? v.trim() : ''; }

// Aposentado continua na lista lida: ele faz parte do histórico do conjunto. O que muda é
// quem conta como ativo.
function ativos(devices) {
  const saida = {};
  if (!objeto(devices)) return saida;
  for (const [id, d] of Object.entries(devices)) {
    if (objeto(d) && Number(d.retiredAt) > 0) continue;
    saida[id] = d;
  }
  return saida;
}

function mudancaDe({ nome, aposentar }) {
  const mudanca = {};
  const n = texto(nome);
  // nome vazio não apaga o nome: quem quer trocar escreve o novo
  if (n) mudanca.name = n.slice(0, 40);
  if (aposentar === true) mudanca.retiredAt = Date.now();
  if (aposentar === false) mudanca.retiredAt = 0;
  return mudanca;
}

async function syncAparelho(engine, cfg, { deviceId, nome, aposentar } = {}) {
  const rt = engine.sync;
  if (!rt || !rt.client || !rt.uid) return recusa(SYNC_CODES.SEM_CREDENCIAL, 'este aparelho não está conectado');
  const id = texto(deviceId);
  if (!id) return recusa('forma', 'falta dizer qual aparelho');
  const mudanca = mudancaDe({ nome, aposentar });
  if (!Object.keys(mudanca).length) return recusa('forma', 'nada para mudar neste aparelho');

  const r = await rt.client.patch(`/users/${rt.uid}/devices/${id}`, mudanca);
  if (!r || !r.ok) return recusa((r && r.code) || SYNC_CODES.INDISPONIVEL, r && r.motivo);
  // renomear ESTE aparelho troca o nome local também, senão a próxima presença
  // devolveria o nome antigo e o ato pareceria não ter pegado
  if (id === rt.deviceId && mudanca.name) {
    engine.updateSettings({ sync: { ...cfg, deviceName: mudanca.name } });
  }
  if (typeof engine.pushState === 'function') engine.pushState();
  return { ok: true, deviceId: id, ...mudanca };
}

export default { syncAparelho, ativos };
export { syncAparelho, ativos };
