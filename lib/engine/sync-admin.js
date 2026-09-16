// Autoridade do admin (7.C2 e CT-ADM-POL), separado de lib/engine/sync.js pelo mesmo
// motivo do sync-chave.js: lá o assunto é conexão e coordenação, e aquele arquivo vive no
// teto de linhas do gate de qualidade.
//
// ORDEM OBRIGATÓRIA para tornar este aparelho admin, e ela não é detalhe: a senha real do
// Firebase vem ANTES de qualquer gravação. Se o par fosse gerado e publicado primeiro,
// uma senha errada deixaria no banco uma geração nova com a chave pública de um aparelho
// que não conseguiu se autenticar, e o admin anterior perderia autoridade sem que ninguém
// tivesse provado ser o dono.
//
// A geração só anda para cima, uma de cada vez, e a gravação é CAS por ETag: dois
// aparelhos disputando terminam com um só, e o perdedor sabe que perdeu.
import { authUrlsFor, sharedActive } from '../sync/config.js';
import { outboxTarget } from '../sync/outbox.js';
import { readSyncCredential, setSyncCredential } from '../sync/credentials.js';
import { signInWithPassword } from '../sync/auth.js';
import { SYNC_CODES, motivoDe } from '../sync/errors.js';
import adminChave from '../sync/admin-chave.js';

import comandos from './sync-comandos.js';

const CAMINHO_ADMIN = 'live/control/admin';

function recusa(code, motivo) {
  return { ok: false, code, motivo: motivo || motivoDe(code) };
}

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function geracaoAtual(no) {
  return objeto(no) ? Number(no.generation) || 0 : 0;
}

async function lerAdmin(client, uid) {
  try {
    const r = await client.get(`/users/${uid}/${CAMINHO_ADMIN}`, { etag: true });
    if (!r.ok) return null;
    return { no: objeto(r.data) ? r.data : null, etag: r.etag || 'null_etag' };
  } catch {
    return null;
  }
}

async function publicarAdmin(client, uid, no, etag) {
  try {
    const w = await client.put(`/users/${uid}/${CAMINHO_ADMIN}`, no, { ifMatch: etag });
    return !!(w && w.ok);
  } catch {
    return false;
  }
}

async function syncTornarAdmin(engine, cfg, fetchImpl, { password } = {}) {
  if (!sharedActive(cfg)) return recusa('compartilhamento-desligado', 'o compartilhamento cifrado está desligado');
  const rt = engine.sync;
  if (!rt || !rt.client || !rt.uid) return recusa(SYNC_CODES.SEM_CREDENCIAL, 'este aparelho não está conectado');
  const cred = readSyncCredential();
  const email = (cred && cred.email) || rt.email;
  if (!email) return recusa(SYNC_CODES.SEM_CREDENCIAL, 'este aparelho não tem login guardado');

  // 1. a senha real, primeiro. Só depois disto existe par, gravação ou geração nova.
  const { identityUrl } = authUrlsFor(cfg.databaseUrl);
  const senha = typeof password === 'string' ? password : '';
  const entrada = await signInWithPassword({ apiKey: cfg.apiKey, email, password: senha, fetchImpl, identityUrl });
  if (!entrada.ok) return recusa(entrada.code, entrada.motivo);
  setSyncCredential({ uid: entrada.uid, email: entrada.email, refreshToken: entrada.refreshToken });

  // 2. lê a geração vigente com ETag, gera o par e publica com geração + 1
  const lido = await lerAdmin(rt.client, rt.uid);
  if (!lido) return recusa(SYNC_CODES.INDISPONIVEL, 'não deu para ler quem é o admin agora');
  const generation = geracaoAtual(lido.no) + 1;
  const par = adminChave.gerarParDeAdmin();
  const no = { deviceId: rt.deviceId, generation, publicKey: par.publicKey, setAt: Date.now() };
  if (!await publicarAdmin(rt.client, rt.uid, no, lido.etag)) {
    return recusa(SYNC_CODES.CONFLITO, 'outro aparelho virou admin enquanto este tentava; releia a tela');
  }

  // 3. a privada fica só aqui, presa à geração que acabou de ser publicada
  adminChave.gravarChaveDeAdmin({ uid: rt.uid, destino: outboxTarget(rt.uid, cfg.databaseUrl), generation, jwk: par.jwk });
  // C6: designação remota exige a senha digitada AQUI. Se havia um pedido do admin
  // anterior, é só agora, com a senha já conferida, que ele vira recibo.
  await comandos.confirmarDesignacao(engine, {});
  if (typeof engine.pushState === 'function') engine.pushState();
  return { ok: true, generation };
}

export default { syncTornarAdmin };
export { syncTornarAdmin };
