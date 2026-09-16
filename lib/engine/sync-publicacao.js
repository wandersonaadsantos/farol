// Publicação de conteúdo compartilhado (7.C3): a capacidade deste aparelho e o catálogo
// de PRs. As duas obedecem às mesmas duas condições, e elas são a entrega:
//
//   1. VALE PUBLICAR? Só se existe outro aparelho da frota v2 pronto para ler
//      (lib/sync/frota.js). Sem leitor, escrever é cota gasta e dado sem dono.
//   2. MUDOU? Só sobe o que mudou no TEXTO CLARO, medido por um resumo local. O envelope
//      sorteia IV a cada cifragem, então o ciphertext SEMPRE difere e o banco nunca
//      deduplica sozinho: sem este segundo gate, o tick de presença reescreveria tudo a
//      cada cinco minutos.
//
// O que sobe do aparelho é CAPACIDADE, não identidade: nome escolhido, contas por tag,
// se há token, se a IA está pronta, paralelismo, RAM livre arredondada. Nunca login em
// claro, hostname ou caminho de diretório, que são justamente o que ligaria o conteúdo
// cifrado a uma pessoa e a uma máquina para quem lesse o banco.
import os from 'node:os';
import { sharedActive } from '../sync/config.js';
import { SYNC_CODES, motivoDe } from '../sync/errors.js';
import envelope from '../sync/envelope.js';
import frota from '../sync/frota.js';
import { acctTag } from '../sync/tags.js';
import kek from '../sync/kek.js';
import { resumoDoClaro, linhaDoCatalogo } from '../sync/catalogo.js';
import { prTag } from '../sync/tags.js';

const NO_STATUS = 'live/deviceStatus';
const CAMPO_STATUS = 'capacidade';
const ESQUEMA_STATUS = 'cap1';
// RAM livre arredondada para blocos grandes: o número exato muda a cada segundo, e
// publicar "mudou" a cada tick por causa de 3 MB seria ruído caro.
const BLOCO_RAM_MB = 256;
const NO_CATALOGO = 'catalog';
const CAMPO_CATALOGO = 'linha';
const ESQUEMA_CATALOGO = 'cat1';
// LRU pequeno de propósito: o catálogo é regenerável, e memória gasta com nome de PR é
// memória que falta para o que decide.
const LRU_MAX = 500;

function recusa(code, motivo) {
  return { ok: false, code, motivo: motivo || motivoDe(code) };
}

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function ramLivreResumida() {
  const mb = Math.round(os.freemem() / (1024 * 1024));
  return Math.round(mb / BLOCO_RAM_MB) * BLOCO_RAM_MB;
}

function contasDe(engine, kId) {
  const lista = typeof engine.accountList === 'function' ? engine.accountList() : [];
  return lista.map((a) => acctTag(kId, a.user)).filter(Boolean).sort();
}

function capacidadeDe(engine, cfg) {
  const rt = engine.sync || {};
  const doctor = objeto(engine.doctorInfo) ? engine.doctorInfo : {};
  // K_id viaja em base64url no material; as tags exigem os 32 bytes
  const kId = rt.material ? kek.bufferDe(rt.material.id) : null;
  return {
    nome: rt.deviceName || '',
    contas: kId ? contasDe(engine, kId) : [],
    token: doctor.ghAuth === true,
    iaPronta: !!doctor.claude,
    paralelismo: Number(engine.config && engine.config.parallelReviews) || 1,
    ramLivreMb: ramLivreResumida(),
    aceitarAdmin: cfg.aceitarAdmin === true,
    keyReady: !!rt.material,
  };
}

function podePublicar(engine, cfg) {
  if (!sharedActive(cfg)) return recusa('compartilhamento-desligado', 'o compartilhamento cifrado está desligado');
  const rt = engine.sync;
  if (!rt || !rt.client || !rt.uid) return recusa(SYNC_CODES.SEM_CREDENCIAL, 'este aparelho não está conectado');
  if (!rt.material || !rt.cur) return recusa('sem-chave', 'a chave do conjunto não está aberta neste aparelho');
  if (!frota.valePublicar(rt.devices, { meuId: rt.deviceId, agora: rt.agora ? rt.agora() : Date.now() })) {
    return recusa('sem-frota', 'nenhum outro aparelho pronto para ler nas últimas 24 horas');
  }
  return { ok: true };
}

// O resumo do que já foi publicado vive na SESSÃO. Guardar em disco faria o Farol confiar,
// depois de reiniciar, que o banco ainda tem o que ele mandou da última vez, e o banco
// pode ter sido limpo no meio.
function jaPublicado(rt, chave) {
  return objeto(rt.publicado) ? rt.publicado[chave] : undefined;
}

function marcarPublicado(rt, chave, resumo) {
  if (!objeto(rt.publicado)) rt.publicado = {};
  rt.publicado[chave] = resumo;
}

async function publicarCapacidade(engine, cfg) {
  const pode = podePublicar(engine, cfg);
  if (!pode.ok) return pode;
  const rt = engine.sync;
  const claro = capacidadeDe(engine, cfg);
  const resumo = resumoDoClaro(claro);
  if (jaPublicado(rt, NO_STATUS) === resumo) return { ok: true, escreveu: false };

  const caminho = `${NO_STATUS}/${rt.deviceId}`;
  const cifrado = envelope.cifrar({
    uid: rt.uid, caminho, campo: CAMPO_STATUS, no: NO_STATUS, esquema: ESQUEMA_STATUS,
    cur: rt.cur, material: rt.material, r: 1, dados: { c: claro },
  });
  if (!cifrado.ok) return recusa('cifra', `não deu para cifrar a capacidade (${cifrado.motivo})`);
  const w = await rt.client.put(`/users/${rt.uid}/${caminho}`, { v: 1, u: Date.now(), enc: cifrado.enc }, {});
  if (!w || !w.ok) return recusa((w && w.code) || SYNC_CODES.INDISPONIVEL, 'não deu para publicar a capacidade');
  marcarPublicado(rt, NO_STATUS, resumo);
  return { ok: true, escreveu: true };
}

// Só sobem as linhas cujo texto claro mudou. Publicar o catálogo inteiro a cada ciclo
// custaria uma escrita por PR monitorado, para sempre, sem nada ter mudado.
async function publicarNoCatalogo(engine, cfg, prs) {
  const pode = podePublicar(engine, cfg);
  if (!pode.ok) return pode;
  const rt = engine.sync;
  const kId = kek.bufferDe(rt.material.id);
  if (!kId) return recusa('sem-chave', 'o material da chave não serve para gerar tag');
  const escritas = [];
  for (const pr of Array.isArray(prs) ? prs : []) {
    const linha = linhaDoCatalogo(pr);
    if (!linha.key) continue;
    const tag = prTag(kId, linha.key);
    const resumo = resumoDoClaro(linha);
    if (jaPublicado(rt, `${NO_CATALOGO}/${tag}`) === resumo) continue;
    const feito = await escreverLinha(rt, tag, linha);
    if (!feito) continue;
    marcarPublicado(rt, `${NO_CATALOGO}/${tag}`, resumo);
    escritas.push(tag);
  }
  return { ok: true, escritas };
}

async function escreverLinha(rt, tag, linha) {
  const caminho = `${NO_CATALOGO}/${tag}`;
  const cifrado = envelope.cifrar({
    uid: rt.uid, caminho, campo: CAMPO_CATALOGO, no: NO_CATALOGO, esquema: ESQUEMA_CATALOGO,
    cur: rt.cur, material: rt.material, r: 1, dados: { l: linha },
  });
  if (!cifrado.ok) return false;
  const w = await rt.client.put(`/users/${rt.uid}/${caminho}`, { v: 1, u: Date.now(), enc: cifrado.enc }, {});
  return !!(w && w.ok);
}

function lembrar(rt, tag, linha) {
  if (!(rt.catalogoLru instanceof Map)) rt.catalogoLru = new Map();
  rt.catalogoLru.delete(tag);
  rt.catalogoLru.set(tag, linha);
  while (rt.catalogoLru.size > LRU_MAX) rt.catalogoLru.delete(rt.catalogoLru.keys().next().value);
}

// Leitura pontual por tag. Falha FECHADA: linha que não decifra (chave de outra época,
// envelope adulterado) vira `null`, nunca texto parcial nem nome de outro PR.
async function lerDoCatalogo(engine, cfg, tag) {
  const rt = engine.sync;
  if (!sharedActive(cfg) || !rt || !rt.client || !rt.material) return null;
  const chave = String(tag || '');
  if (rt.catalogoLru instanceof Map && rt.catalogoLru.has(chave)) return rt.catalogoLru.get(chave);
  const caminho = `${NO_CATALOGO}/${chave}`;
  const r = await rt.client.get(`/users/${rt.uid}/${caminho}`);
  if (!r || !r.ok || !objeto(r.data) || !r.data.enc) return null;
  const aberto = envelope.decifrar({
    enc: r.data.enc, material: rt.material, uid: rt.uid, caminho, campo: CAMPO_CATALOGO, esquema: ESQUEMA_CATALOGO,
  });
  if (!aberto.ok) return null;
  const linha = linhaDoCatalogo(aberto.valor && aberto.valor.l);
  lembrar(rt, chave, linha);
  return linha;
}

export default { capacidadeDe, publicarCapacidade, podePublicar, jaPublicado, marcarPublicado, publicarNoCatalogo, lerDoCatalogo };
export { capacidadeDe, publicarCapacidade, podePublicar, jaPublicado, marcarPublicado, publicarNoCatalogo, lerDoCatalogo };
