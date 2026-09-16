// Política por aparelho: publicar (lado admin) e aceitar (lado consumidor), CT-ADM-POL.
//
// A ORDEM DAS RECUSAS É O CONTRATO, e ela é sempre a mesma:
//   1. o compartilhamento cifrado está ligado?
//   2. ESTE aparelho consente em obedecer a um admin (aceitarAdmin)?
//   3. o nó tem a forma esperada e a geração vigente?
//   4. a assinatura é da pública do admin vigente?
//   5. a autoridade está fresca AGORA?
//   6. a versão é mais nova que a já aceita?
// Só depois de tudo isso o envelope é aberto. Decifrar antes de conferir a assinatura
// significaria processar conteúdo que ninguém provou ter vindo do admin, e o custo dessa
// inversão não aparece em teste nenhum que só olhe o resultado final.
//
// A assinatura NÃO é controle de acesso: o banco não verifica criptografia, e qualquer
// aparelho com a credencial da conta escreve nestes nós. Quem recusa é sempre o cliente
// que lê, aqui, antes de aplicar.
import { sharedActive } from '../sync/config.js';
import { outboxTarget } from '../sync/outbox.js';
import { SYNC_CODES, motivoDe } from '../sync/errors.js';
import adminChave from '../sync/admin-chave.js';
import assinatura from '../sync/assinatura.js';
import envelope from '../sync/envelope.js';
import politica from '../sync/politica.js';
import cachePolitica from '../sync/cache-politica.js';
import { autoridadeFresca } from '../sync/autoridade.js';
import { SYNC } from '../constants.js';

const NO = 'live/devicePolicies';
const CAMPO = 'politica';

function recusa(code, motivo) {
  return { ok: false, code, motivo: motivo || motivoDe(code) };
}

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function caminhoDe(dev) { return `${NO}/${dev}`; }

// O valor assinado é o nó SEM a própria assinatura, e na mesma ordem em todo lugar: é o
// que faz assinar e verificar chegarem ao mesmo texto.
function valorAssinado(no) {
  return { v: Number(no.v) || 0, generation: Number(no.generation) || 0, enc: String(no.enc || '') };
}

async function lerNo(client, caminho) {
  try {
    const r = await client.get(caminho, { etag: true });
    if (!r.ok) return null;
    return { valor: objeto(r.data) ? r.data : null, etag: r.etag || 'null_etag' };
  } catch {
    return null;
  }
}

async function syncPublicarPolitica(engine, cfg, { deviceId, politica: bruta } = {}) {
  if (!sharedActive(cfg)) return recusa('compartilhamento-desligado', 'o compartilhamento cifrado está desligado');
  const rt = engine.sync;
  if (!rt || !rt.client || !rt.uid) return recusa(SYNC_CODES.SEM_CREDENCIAL, 'este aparelho não está conectado');
  if (!rt.material || !rt.cur) return recusa('sem-chave', 'a chave do conjunto não está aberta neste aparelho');
  const dev = String(deviceId || '').trim();
  if (!dev) return recusa('forma', 'falta dizer para qual aparelho é a política');

  const admin = await lerNo(rt.client, `/users/${rt.uid}/live/control/admin`);
  if (!admin || !admin.valor) return recusa(SYNC_CODES.INDISPONIVEL, 'não deu para ler quem é o admin agora');
  const generation = Number(admin.valor.generation) || 0;
  const destino = outboxTarget(rt.uid, cfg.databaseUrl);
  const minha = adminChave.lerChaveDeAdmin();
  if (!adminChave.chaveServe(minha, { uid: rt.uid, destino, generation })) {
    return recusa('nao-e-admin', 'este aparelho não é o admin da geração vigente');
  }

  const caminho = caminhoDe(dev);
  const atual = await lerNo(rt.client, `/users/${rt.uid}/${caminho}`);
  const versao = (atual && atual.valor ? Number(atual.valor.v) || 0 : 0) + 1;
  const ctx = { uid: rt.uid, caminho, campo: CAMPO, no: NO, esquema: politicaEsquema(), cur: rt.cur, material: rt.material };
  const cifrado = envelope.cifrar({ ...ctx, r: versao, dados: { p: sanear(bruta) } });
  if (!cifrado.ok) return recusa('cifra', `não deu para cifrar a política (${cifrado.motivo})`);

  const no = { v: versao, generation, enc: cifrado.enc };
  no.sig = assinatura.assinar(minha.jwk, { uid: rt.uid, caminho, generation, valor: valorAssinado(no) });
  if (!no.sig) return recusa('cifra', 'este aparelho não conseguiu assinar a política');
  const w = await rt.client.put(`/users/${rt.uid}/${caminho}`, no, { ifMatch: atual ? atual.etag : 'null_etag' });
  if (!w || !w.ok) return recusa(SYNC_CODES.CONFLITO, 'outro aparelho escreveu a política ao mesmo tempo; releia a tela');
  return { ok: true, versao, generation };
}

function politicaEsquema() { return politica.ESQUEMA; }
function sanear(bruta) { return politica.sanearPolitica(bruta); }

function frescor(autoridade) {
  if (!objeto(autoridade)) return false;
  const intervaloMs = Number(autoridade.intervaloMs) || SYNC.AUTORIDADE_INTERVALO_MS;
  return autoridadeFresca(autoridade, { agora: Number(autoridade.agora) || 0, intervaloMs });
}

function versaoNoCache(rt, dev) {
  const cache = cachePolitica.lerPolitica();
  if (!cachePolitica.politicaServe(cache, { uid: rt.uid, dev })) return 0;
  return Number(cache.versao) || 0;
}

function aceitarPolitica(engine, cfg, { no, admin, autoridade, dev } = {}) {
  if (!sharedActive(cfg)) return recusa('compartilhamento-desligado', 'o compartilhamento cifrado está desligado');
  if (cfg.aceitarAdmin !== true) return recusa('nao-aceita-admin', 'este aparelho não aceita política de admin');
  const rt = engine.sync;
  if (!rt || !rt.uid || !rt.material) return recusa('sem-chave', 'a chave do conjunto não está aberta neste aparelho');
  if (!objeto(no) || !no.enc || !no.sig || !objeto(admin) || !admin.publicKey) return recusa('forma', 'política incompleta');

  const alvo = String(dev || rt.deviceId || '').trim();
  const generation = Number(admin.generation) || 0;
  if ((Number(no.generation) || 0) !== generation || !generation) return recusa('geracao', 'a política não é da geração vigente do admin');
  const caminho = caminhoDe(alvo);
  if (!assinatura.verificar(admin.publicKey, no.sig, { uid: rt.uid, caminho, generation, valor: valorAssinado(no) })) {
    return recusa('assinatura', 'a política não foi assinada pelo admin vigente');
  }
  if (!frescor(autoridade)) return recusa('autoridade', 'o admin não deu sinal de vida recente');
  const versao = Number(no.v) || 0;
  if (versao <= versaoNoCache(rt, alvo)) return recusa('antiga', 'já existe uma política mais nova neste aparelho');

  const aberto = envelope.decifrar({
    enc: no.enc, material: rt.material, uid: rt.uid, caminho, campo: CAMPO,
    esquema: politicaEsquema(), rMinimo: versao,
  });
  if (!aberto.ok) return recusa('cifra', `não deu para abrir a política (${aberto.motivo})`);

  const limpa = sanear(aberto.valor && aberto.valor.p);
  cachePolitica.gravarPolitica({ uid: rt.uid, dev: alvo, generation, versao, politica: limpa });
  return { ok: true, politica: limpa, versao, generation };
}

export default { syncPublicarPolitica, aceitarPolitica };
export { syncPublicarPolitica, aceitarPolitica };
