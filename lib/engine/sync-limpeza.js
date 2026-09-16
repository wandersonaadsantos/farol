// Limpeza protegida (7.C2, decisões D-b e D8): a chave que autoriza, e a trava do ato.
//
// LIGAR A CHAVE NÃO PEDE SENHA, e isso é decisão registrada (D-b): ligar não apaga nada,
// e pedir senha para ligar treinaria a pessoa a digitar a senha num momento inofensivo,
// que é o melhor jeito de ela digitar sem ler no momento que importa. A senha é pedida no
// CLIQUE EM APAGAR, e o servidor confere que ela é recente (REC) no mesmo ato.
//
// A chave sozinha não apaga nada. Ela é uma das cinco condições, e as outras quatro (senha
// real, `REC` conferido pelo servidor, trava do próprio ato e nenhuma operação viva) são
// conferidas na hora de apagar.
//
// FAIL-CLOSED: nó ausente, assinatura inválida ou geração antiga contam como DESLIGADA.
// Num interruptor que autoriza remoção irreversível, o estado desconhecido é "não".
import { sharedActive } from '../sync/config.js';
import { SYNC_CODES, motivoDe } from '../sync/errors.js';
import adminChave from '../sync/admin-chave.js';
import assinatura from '../sync/assinatura.js';
import { outboxTarget } from '../sync/outbox.js';
import { autoridadeFresca } from '../sync/autoridade.js';
import { SYNC } from '../constants.js';
import publicar from './sync-publicar.js';

const CAMINHO = 'live/control/cleanup';

function recusa(code, motivo) {
  return { ok: false, code, motivo: motivo || motivoDe(code) };
}

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function valorDaChave(no) {
  return { enabled: no.enabled === true, generation: Number(no.generation) || 0, rev: Number(no.rev) || 0 };
}

function frescor(autoridade) {
  if (!objeto(autoridade)) return false;
  const intervaloMs = Number(autoridade.intervaloMs) || SYNC.AUTORIDADE_INTERVALO_MS;
  return autoridadeFresca(autoridade, { agora: Number(autoridade.agora) || 0, intervaloMs });
}

async function syncChaveDeLimpeza(engine, cfg, { ligada } = {}) {
  if (!sharedActive(cfg)) return recusa('compartilhamento-desligado', 'o compartilhamento cifrado está desligado');
  const rt = engine.sync;
  if (!rt || !rt.client || !rt.uid) return recusa(SYNC_CODES.SEM_CREDENCIAL, 'este aparelho não está conectado');

  const admin = await publicar.lerNo(rt.client, `/users/${rt.uid}/live/control/admin`);
  if (!admin || !admin.valor) return recusa(SYNC_CODES.INDISPONIVEL, 'não deu para ler quem é o admin agora');
  const generation = Number(admin.valor.generation) || 0;
  const minha = adminChave.lerChaveDeAdmin();
  if (!adminChave.chaveServe(minha, { uid: rt.uid, destino: outboxTarget(rt.uid, cfg.databaseUrl), generation })) {
    return recusa('nao-e-admin', 'este aparelho não é o admin da geração vigente');
  }

  const atual = await publicar.lerNo(rt.client, `/users/${rt.uid}/${CAMINHO}`);
  // `rev` monotônico: sem ele, um valor antigo reentregue voltaria a valer, e "desligada"
  // podia virar "ligada" sem ninguém ter ligado nada
  const rev = (atual && atual.valor ? Number(atual.valor.rev) || 0 : 0) + 1;
  const no = { enabled: ligada === true, generation, rev };
  const sig = assinatura.assinar(minha.jwk, { uid: rt.uid, caminho: CAMINHO, generation, valor: valorDaChave(no) });
  if (!sig) return recusa('cifra', 'este aparelho não conseguiu assinar a chave de limpeza');
  const w = await rt.client.put(`/users/${rt.uid}/${CAMINHO}`, { ...no, sig }, { ifMatch: atual ? atual.etag : 'null_etag' });
  if (!w || !w.ok) return recusa(SYNC_CODES.CONFLITO, 'outro aparelho mexeu na chave de limpeza ao mesmo tempo');
  if (typeof engine.pushState === 'function') engine.pushState();
  return { ok: true, enabled: no.enabled, rev };
}

function chaveDeLimpezaLigada(engine, { no, admin, autoridade } = {}) {
  const rt = (engine && engine.sync) || {};
  if (!objeto(no) || !objeto(admin) || !admin.publicKey) return false;
  if (no.enabled !== true) return false;
  const generation = Number(admin.generation) || 0;
  if (!generation || (Number(no.generation) || 0) !== generation) return false;
  if (!assinatura.verificar(admin.publicKey, no.sig, { uid: rt.uid, caminho: CAMINHO, generation, valor: valorDaChave(no) })) return false;
  return frescor(autoridade);
}

export default { syncChaveDeLimpeza, chaveDeLimpezaLigada };
export { syncChaveDeLimpeza, chaveDeLimpezaLigada };
