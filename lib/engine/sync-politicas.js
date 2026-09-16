// Política por aparelho: publicar (lado admin) e aceitar (lado consumidor), CT-ADM-POL.
//
// A ORDEM DAS RECUSAS É O CONTRATO, e ela é sempre a mesma:
//   1. o compartilhamento cifrado está ligado?
//   2. ESTE aparelho consente em obedecer a um admin (aceitarAdmin)?
//   3. daí em diante, a ordem comum de `lib/sync/no-assinado.js`: forma, geração,
//      assinatura, frescor, versão, e só então decifrar.
// Decifrar antes de conferir a assinatura significaria processar conteúdo que ninguém
// provou ter vindo do admin, e o custo dessa inversão não aparece em teste nenhum que só
// olhe o resultado final. Os dois primeiros passos ficam aqui porque são do consumidor,
// não do nó: quem não consente não chega a olhar o valor.
//
// A assinatura NÃO é controle de acesso: o banco não verifica criptografia, e qualquer
// aparelho com a credencial da conta escreve nestes nós. Quem recusa é sempre o cliente
// que lê, aqui, antes de aplicar.
import { sharedActive } from '../sync/config.js';
import { SYNC_CODES, motivoDe } from '../sync/errors.js';
import noAssinado from '../sync/no-assinado.js';
import publicar from './sync-publicar.js';
import politica from '../sync/politica.js';
import cachePolitica from '../sync/cache-politica.js';
import { autoridadeFresca } from '../sync/autoridade.js';
import { SYNC } from '../constants.js';

const NO = 'live/devicePolicies';
const CAMPO = 'politica';

// Os códigos vêm da ordem comum; as frases são desta tela.
const MOTIVOS = {
  forma: 'política incompleta',
  geracao: 'a política não é da geração vigente do admin',
  assinatura: 'a política não foi assinada pelo admin vigente',
  autoridade: 'o admin não deu sinal de vida recente',
  antiga: 'já existe uma política mais nova neste aparelho',
  cifra: 'não deu para abrir a política',
};

function recusa(code, motivo) {
  return { ok: false, code, motivo: motivo || motivoDe(code) };
}

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function caminhoDe(dev) { return `${NO}/${dev}`; }

async function syncPublicarPolitica(engine, cfg, { deviceId, politica: bruta } = {}) {
  const dev = String(deviceId || '').trim();
  return publicar.publicarNoAssinado(engine, cfg, {
    caminho: dev ? caminhoDe(dev) : '', no: NO, campo: CAMPO, esquema: politicaEsquema(),
    dados: { p: sanear(bruta) }, assunto: 'a política',
  });
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

  const alvo = String(dev || rt.deviceId || '').trim();
  const caminho = caminhoDe(alvo);
  const r = noAssinado.aceitarNoAssinado({
    no, admin, uid: rt.uid, caminho, campo: CAMPO, esquema: politicaEsquema(),
    material: rt.material, fresca: frescor(autoridade), versaoAceita: versaoNoCache(rt, alvo),
  });
  if (!r.ok) return recusa(r.code, MOTIVOS[r.code] || motivoDe(r.code));

  const limpa = sanear(r.valor && r.valor.p);
  cachePolitica.gravarPolitica({ uid: rt.uid, dev: alvo, generation: r.generation, versao: r.versao, politica: limpa });
  return { ok: true, politica: limpa, versao: r.versao, generation: r.generation };
}

// O que está no banco AGORA para um aparelho, para o formulário do admin abrir com ele em
// vez de valores mínimos (publicar substitui a política inteira, e abrir com mínimos
// apagaria em silêncio o que a tela não edita, como as contas elegíveis).
//
// Isto é LEITURA DE EXIBIÇÃO, não aceite: a mesma ordem comum decide se o conteúdo se
// prova (forma, geração, assinatura), mas o frescor e a versão já aceita não entram,
// porque ninguém vai aplicar nada daqui. O que não se prova sai como `valida: false`, sem
// o conteúdo. O aceite de verdade acontece no aparelho de destino e não volta para cá.
async function lerPoliticaPublicada(engine, cfg, { deviceId } = {}) {
  if (!sharedActive(cfg)) return recusa('compartilhamento-desligado', 'o compartilhamento cifrado está desligado');
  const dev = String(deviceId || '').trim();
  if (!dev) return recusa('forma', 'falta dizer de qual aparelho é a política');
  const rt = engine.sync;
  if (!rt || !rt.client || !rt.uid) return recusa(SYNC_CODES.SEM_CREDENCIAL, 'este aparelho não está conectado');
  if (!rt.material) return recusa('sem-chave', 'a chave do conjunto não está aberta neste aparelho');
  const [lido, admin] = await Promise.all([
    publicar.lerNo(rt.client, `/users/${rt.uid}/${caminhoDe(dev)}`),
    publicar.lerNo(rt.client, `/users/${rt.uid}/live/control/admin`),
  ]);
  if (!lido || !admin) return recusa(SYNC_CODES.INDISPONIVEL, 'não deu para ler a política agora');
  if (!lido.valor) return { ok: true, existe: false };
  const r = noAssinado.aceitarNoAssinado({
    no: lido.valor, admin: admin.valor, uid: rt.uid, caminho: caminhoDe(dev), campo: CAMPO, esquema: politicaEsquema(),
    material: rt.material, fresca: true, versaoAceita: 0,
  });
  if (!r.ok) return { ok: true, existe: true, valida: false, code: r.code };
  return { ok: true, existe: true, valida: true, versao: r.versao, politica: sanear(r.valor && r.valor.p) };
}

export default { syncPublicarPolitica, aceitarPolitica, lerPoliticaPublicada };
export { syncPublicarPolitica, aceitarPolitica, lerPoliticaPublicada };
