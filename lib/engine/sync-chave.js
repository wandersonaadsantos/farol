// Estado e abertura da chave do conjunto (CT-ENV), separado de lib/engine/sync.js porque
// lá o assunto é conexão, presença e coordenação, e aqui é só a chave: qual é o estado
// dela neste aparelho, como ela é aberta e onde o material fica guardado.
//
// O material aberto vive no runtime (`rt.material`) e no cache local. Ele NUNCA vai para
// config, snapshot, log, toast ou resposta de rota: o que a tela recebe é só o estado,
// uma palavra.
import { sharedActive, authUrlsFor } from '../sync/config.js';
import { outboxTarget } from '../sync/outbox.js';
import { readSyncCredential, setSyncCredential } from '../sync/credentials.js';
import { signInWithPassword } from '../sync/auth.js';
import { SYNC_CODES, motivoDe } from '../sync/errors.js';
import chaveiro from '../sync/chaveiro.js';
import cacheChave from '../sync/cache-chave.js';

function avisar(engine) {
  if (typeof engine.pushState === 'function') engine.pushState();
}

// 'desligada' não é problema: é o recurso não estar ligado.
function estadoDaChave(rt, cfg) {
  if (!sharedActive(cfg)) return 'desligada';
  if (rt.chaveMotivo === 'chave-perdida') return 'perdida';
  return rt.material ? 'pronta' : 'bloqueada';
}

function motivoDaChave(codigo) {
  if (codigo === 'chave-perdida') return 'a chave do conjunto sumiu do banco depois de já ter sido vista neste aparelho';
  if (codigo === 'senha-nao-abre') return 'a senha não abre a chave do conjunto deste banco';
  return 'não deu para falar com o banco agora';
}

function falhaDaChave(engine, rt, motivo) {
  rt.chaveMotivo = motivo;
  avisar(engine);
  return { ok: false, code: motivo, motivo: motivoDaChave(motivo) };
}

// O material fica só no runtime e no cache local, e o cache carrega o DESTINO: trocar de
// conta do Firebase ou de banco descarta o cache em vez de cifrar com a chave do destino
// anterior.
function guardarMaterial(engine, rt, cfg, r) {
  rt.material = r.material;
  rt.chaveVista = true;
  rt.chaveMotivo = '';
  cacheChave.gravarCache({
    uid: rt.uid, destino: outboxTarget(rt.uid, cfg.databaseUrl),
    keyringRev: Number(r.chaveiro.rev) || 0, cur: r.chaveiro.cur, id: r.material.id, enc: r.material.enc,
  });
  avisar(engine);
  return { ok: true };
}

async function abrirChaveDoConjunto(engine, rt, cfg, password) {
  const r = await chaveiro.garantirChaveiro(rt.client, rt.uid, password, { deviceId: rt.deviceId, jaVisto: rt.chaveVista });
  if (!r.ok) return falhaDaChave(engine, rt, r.motivo);
  return guardarMaterial(engine, rt, cfg, r);
}

function recusa(code, motivo) {
  return { ok: false, code, motivo: motivo || motivoDe(code) };
}

// Desbloqueio do aparelho que já estava logado antes da feature: ele tem refresh token e
// não tem senha, então o chaveiro só abre quando a pessoa digita a senha uma vez. A senha
// é usada aqui e descartada; nada dela vai para config, log, snapshot ou cache.
//
// `cfg` e `fetchImpl` chegam de fora para não duplicar aqui os acessores de lib/engine/sync.js.
async function syncUnlock(engine, cfg, fetchImpl, { password } = {}) {
  if (!sharedActive(cfg)) return recusa('compartilhamento-desligado', 'o compartilhamento cifrado está desligado');
  const rt = engine.sync;
  const cred = readSyncCredential();
  const email = (cred && cred.email) || rt.email;
  if (!email) return recusa(SYNC_CODES.SEM_CREDENCIAL, 'este aparelho não tem login guardado');
  const { identityUrl } = authUrlsFor(cfg.databaseUrl);
  const senha = typeof password === 'string' ? password : '';
  const entrada = await signInWithPassword({ apiKey: cfg.apiKey, email, password: senha, fetchImpl, identityUrl });
  if (!entrada.ok) return recusa(entrada.code, entrada.motivo);
  if (!setSyncCredential({ uid: entrada.uid, email: entrada.email, refreshToken: entrada.refreshToken })) return recusa(SYNC_CODES.FALHA_INTERNA);
  return abrirChaveDoConjunto(engine, rt, cfg, senha);
}

export default { estadoDaChave, motivoDaChave, falhaDaChave, guardarMaterial, abrirChaveDoConjunto, syncUnlock };
export { estadoDaChave, motivoDaChave, falhaDaChave, guardarMaterial, abrirChaveDoConjunto, syncUnlock };
