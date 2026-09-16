// Publicação de um nó assinado pelo admin (CT-ADM-POL e CT-GRUPO): as condições e a ordem
// de escrita, num lugar só.
//
// Política e grupo publicam conteúdos diferentes com o MESMO ritual: exigir compartilhamento
// ligado, chave do conjunto aberta e ser o admin da GERAÇÃO VIGENTE lida agora do banco,
// cifrar, assinar, e gravar com `v` anterior + 1 sob CAS por ETag.
//
// Ler a geração do banco em vez de confiar na guardada localmente é o que impede um admin
// já deposto de continuar publicando: a chave local dele não serve para a geração nova.
// E o CAS por ETag é o que faz dois aparelhos publicando ao mesmo tempo terminarem com um
// valor só, com o perdedor sabendo que perdeu.
import { sharedActive } from '../sync/config.js';
import { outboxTarget } from '../sync/outbox.js';
import { SYNC_CODES, motivoDe } from '../sync/errors.js';
import adminChave from '../sync/admin-chave.js';
import envelope from '../sync/envelope.js';
import noAssinado from '../sync/no-assinado.js';

function recusa(code, motivo) {
  return { ok: false, code, motivo: motivo || motivoDe(code) };
}

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

async function lerNo(client, caminho) {
  try {
    const r = await client.get(caminho, { etag: true });
    if (!r.ok) return null;
    return { valor: objeto(r.data) ? r.data : null, etag: r.etag || 'null_etag' };
  } catch {
    // sem leitura não existe geração vigente conhecida, e publicar às cegas seria
    // sobrescrever o que outro aparelho pode ter acabado de gravar
    return null;
  }
}

async function publicarNoAssinado(engine, cfg, { caminho, no: nomeDoNo, campo, esquema, dados, assunto }) {
  if (!sharedActive(cfg)) return recusa('compartilhamento-desligado', 'o compartilhamento cifrado está desligado');
  const rt = engine.sync;
  if (!rt || !rt.client || !rt.uid) return recusa(SYNC_CODES.SEM_CREDENCIAL, 'este aparelho não está conectado');
  if (!rt.material || !rt.cur) return recusa('sem-chave', 'a chave do conjunto não está aberta neste aparelho');
  if (!caminho) return recusa('forma', `falta dizer de quem é ${assunto}`);

  const admin = await lerNo(rt.client, `/users/${rt.uid}/live/control/admin`);
  if (!admin || !admin.valor) return recusa(SYNC_CODES.INDISPONIVEL, 'não deu para ler quem é o admin agora');
  const generation = Number(admin.valor.generation) || 0;
  const destino = outboxTarget(rt.uid, cfg.databaseUrl);
  const minha = adminChave.lerChaveDeAdmin();
  if (!adminChave.chaveServe(minha, { uid: rt.uid, destino, generation })) {
    return recusa('nao-e-admin', 'este aparelho não é o admin da geração vigente');
  }

  const atual = await lerNo(rt.client, `/users/${rt.uid}/${caminho}`);
  const versao = (atual && atual.valor ? Number(atual.valor.v) || 0 : 0) + 1;
  const cifrado = envelope.cifrar({
    uid: rt.uid, caminho, campo, no: nomeDoNo, esquema, cur: rt.cur, material: rt.material, r: versao, dados,
  });
  if (!cifrado.ok) return recusa('cifra', `não deu para cifrar ${assunto} (${cifrado.motivo})`);

  const no = noAssinado.montarNoAssinado({ jwk: minha.jwk, uid: rt.uid, caminho, generation, versao, enc: cifrado.enc });
  if (!no) return recusa('cifra', `este aparelho não conseguiu assinar ${assunto}`);
  const w = await rt.client.put(`/users/${rt.uid}/${caminho}`, no, { ifMatch: atual ? atual.etag : 'null_etag' });
  if (!w || !w.ok) return recusa(SYNC_CODES.CONFLITO, `outro aparelho escreveu ${assunto} ao mesmo tempo; releia a tela`);
  return { ok: true, versao, generation };
}

export default { lerNo, publicarNoAssinado };
export { lerNo, publicarNoAssinado };
