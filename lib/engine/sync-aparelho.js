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
//
// QUEM PODE (fechado em 20/09/2026; até aqui a frase acima era só uma frase, e o engine não
// exigia nada de ninguém):
//   - aposentar e reativar QUALQUER aparelho: só o admin da geração vigente, porque é a
//     decisão de administração que o cabeçalho sempre declarou, e ela mexe em quem conta
//     como ativo para a frota inteira;
//   - renomear OUTRO aparelho: idem, é escrever no registro alheio;
//   - renomear ESTE aparelho: sem exigência de admin. É o mesmo ato do campo "Nome deste
//     aparelho" em Sistema > Sincronização, que todo aparelho tem, e negá-lo aqui tiraria de
//     um aparelho comum o direito de dizer o próprio nome.
// A autoridade é conferida contra a geração LIDA DO BANCO AGORA, nunca a guardada, e leitura
// indisponível recusa: falta de dado não concede autoridade.
import { SYNC_CODES, motivoDe } from '../sync/errors.js';
import adminChave from '../sync/admin-chave.js';
import { outboxTarget } from '../sync/outbox.js';
import publicar from './sync-publicar.js';

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

// Renomear a si mesmo é o único ato daqui que não é administração. Todo o resto mexe no
// registro de outro aparelho, ou em quem conta como ativo para a frota.
function exigeAdmin(rt, { id, aposentar }) {
  if (aposentar === true || aposentar === false) return true;
  return id !== String((rt && rt.deviceId) || '');
}

async function autoridadeDeAdmin(rt, cfg) {
  const admin = await publicar.lerNo(rt.client, `/users/${rt.uid}/live/control/admin`);
  // as duas ausências são diferentes e a recusa diz qual é: `lerNo` devolve null quando a
  // LEITURA falhou e `{ valor: null }` quando o nó não existe. "Não sei quem administra" não
  // pode sair como "ninguém administra", e nenhuma das duas concede autoridade
  if (!admin) return recusa(SYNC_CODES.INDISPONIVEL, 'não deu para ler quem é o admin agora');
  if (!admin.valor) return recusa('nao-e-admin', 'ninguém administra este conjunto, e este ato é de quem administra');
  const generation = Number(admin.valor.generation) || 0;
  const minha = adminChave.lerChaveDeAdmin();
  if (!adminChave.chaveServe(minha, { uid: rt.uid, destino: outboxTarget(rt.uid, cfg.databaseUrl), generation })) {
    return recusa('nao-e-admin', 'este aparelho não é o admin da geração vigente');
  }
  return { ok: true };
}

async function syncAparelho(engine, cfg, { deviceId, nome, aposentar } = {}) {
  const rt = engine.sync;
  if (!rt || !rt.client || !rt.uid) return recusa(SYNC_CODES.SEM_CREDENCIAL, 'este aparelho não está conectado');
  const id = texto(deviceId);
  if (!id) return recusa('forma', 'falta dizer qual aparelho');
  const mudanca = mudancaDe({ nome, aposentar });
  if (!Object.keys(mudanca).length) return recusa('forma', 'nada para mudar neste aparelho');

  // a autoridade é reavaliada AQUI, no instante da mutação: entre o desenho da linha e o
  // clique, uma geração nova pode ter tirado este aparelho do papel de admin
  if (exigeAdmin(rt, { id, aposentar })) {
    const pode = await autoridadeDeAdmin(rt, cfg);
    if (!pode.ok) return pode;
  }

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
