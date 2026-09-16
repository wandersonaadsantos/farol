// O ato de apagar (7.C2, decisões D-b e D8). Separado de lib/engine/sync-limpeza.js
// porque lá o assunto é o interruptor e aqui é a remoção: são riscos diferentes.
//
// A ORDEM É A PROTEÇÃO, e ela não é negociável:
//   1. compartilhamento ligado e chave de limpeza ligada (assinada, do admin vigente);
//   2. a senha real do Firebase, conferida ANTES de qualquer gravação;
//   3. nenhuma operação viva, aqui ou em outro aparelho;
//   4. só então a trava do ato;
//   5. remoção, apenas das categorias que passam pela lista positiva;
//   6. `lastCleanup`, que é o corte da outbox;
//   7. a trava sai SEMPRE, inclusive se algo falhar no meio.
//
// Gravar a trava antes de conferir a senha deixaria o conjunto travado por dez minutos a
// cada senha errada, e travar os outros aparelhos é exatamente o que uma senha errada não
// deveria conseguir fazer.
//
// D8: se o servidor não conseguir conferir senha recente, a limpeza NÃO é publicada. Não
// existe caminho alternativo dentro do app; a saída documentada é o console do Firebase, e
// o resultado traz o código que a tela usa para dizer isso.
import { sharedActive, authUrlsFor } from '../sync/config.js';
import { readSyncCredential, setSyncCredential } from '../sync/credentials.js';
import { signInWithPassword } from '../sync/auth.js';
import { SYNC_CODES, motivoDe } from '../sync/errors.js';
import limpeza from '../sync/limpeza.js';
import publicar from './sync-publicar.js';
import { chaveDeLimpezaLigada } from './sync-limpeza.js';

const LOCK = 'live/control/cleanupLock';
const ULTIMA = 'live/control/lastCleanup';

function recusa(code, motivo) {
  return { ok: false, code, motivo: motivo || motivoDe(code) };
}

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

// Lease vivo em qualquer aparelho conta: a limpeza é do conjunto, não deste aparelho.
function leaseVivo(arvore, agora) {
  if (!objeto(arvore)) return false;
  for (const porConta of Object.values(arvore)) {
    if (!objeto(porConta)) continue;
    for (const lease of Object.values(porConta)) {
      if (objeto(lease) && Number(lease.expiresAt) > agora) return true;
    }
  }
  return false;
}

async function temOperacaoViva(engine, rt) {
  if (engine.running instanceof Map && engine.running.size > 0) return true;
  const r = await publicar.lerNo(rt.client, `/users/${rt.uid}/leases`);
  return leaseVivo(r && r.valor, Date.now());
}

async function apagarCategorias(rt, categorias) {
  const apagadas = [];
  const falharam = [];
  for (const cat of categorias) {
    const r = await rt.client.del(`/users/${rt.uid}/${cat}`);
    if (r && r.ok) apagadas.push(cat);
    else falharam.push(cat);
  }
  return { apagadas, falharam };
}

async function comTrava(rt, executar) {
  const trava = limpeza.formaDaTrava({ dev: rt.deviceId, agora: Date.now() });
  const posta = await rt.client.put(`/users/${rt.uid}/${LOCK}`, trava, {});
  if (!posta || !posta.ok) return recusa(posta && posta.code, 'o servidor não aceitou a trava da limpeza');
  try {
    return await executar();
  } finally {
    // a trava sai mesmo se a remoção falhar no meio: deixá-la para trás faria os outros
    // aparelhos recusarem admissão por dez minutos por causa de um erro já terminado
    await rt.client.del(`/users/${rt.uid}/${LOCK}`);
  }
}

async function syncLimpar(engine, cfg, fetchImpl, { password, categorias, autoridade } = {}) {
  if (!sharedActive(cfg)) return recusa('compartilhamento-desligado', 'o compartilhamento cifrado está desligado');
  const rt = engine.sync;
  if (!rt || !rt.client || !rt.uid) return recusa(SYNC_CODES.SEM_CREDENCIAL, 'este aparelho não está conectado');

  const admin = await publicar.lerNo(rt.client, `/users/${rt.uid}/live/control/admin`);
  const chave = await publicar.lerNo(rt.client, `/users/${rt.uid}/live/control/cleanup`);
  const ligada = chaveDeLimpezaLigada(engine, {
    no: chave && chave.valor, admin: admin && admin.valor, autoridade: autoridade || rt.autoridade,
  });
  if (!ligada) return recusa('limpeza-desligada', 'a chave de limpeza de dados sincronizados está desligada');

  const cred = readSyncCredential();
  const email = (cred && cred.email) || rt.email;
  if (!email) return recusa(SYNC_CODES.SEM_CREDENCIAL, 'este aparelho não tem login guardado');
  const { identityUrl } = authUrlsFor(cfg.databaseUrl);
  const entrada = await signInWithPassword({ apiKey: cfg.apiKey, email, password: typeof password === 'string' ? password : '', fetchImpl, identityUrl });
  if (!entrada.ok) return recusa(entrada.code, entrada.motivo);
  setSyncCredential({ uid: entrada.uid, email: entrada.email, refreshToken: entrada.refreshToken });

  if (await temOperacaoViva(engine, rt)) {
    return recusa('operacao-viva', 'tem operação em andamento no conjunto; espere terminar e tente de novo');
  }

  const alvos = limpeza.categoriasAlcancaveis(categorias);
  if (!alvos.length) return recusa('forma', 'nenhuma das categorias pedidas pode ser apagada');

  return comTrava(rt, async () => {
    const { apagadas, falharam } = await apagarCategorias(rt, alvos);
    // sem nenhuma remoção não existe corte para gravar, e um lastCleanup de um ato que
    // não apagou nada faria a outbox descartar sessão antiga por engano
    if (!apagadas.length) return recusa('limpeza-recusada', 'o servidor recusou a remoção; a saída é o console do Firebase');
    const marca = await rt.client.put(`/users/${rt.uid}/${ULTIMA}`, { at: Date.now(), dev: rt.deviceId, categorias: apagadas }, {});
    if (typeof engine.pushState === 'function') engine.pushState();
    return { ok: true, apagadas, falharam, corteGravado: !!(marca && marca.ok) };
  });
}

export default { syncLimpar };
export { syncLimpar };
