// Chaveiro remoto da sincronização (CT-ENV): users/{uid}/keyring, nó único que guarda
// K_id e K_enc embrulhadas pela senha. Folha de IO: fala com o cliente do banco e com o
// kek, e não conhece o engine.
//
// Três regras que vêm da spec e não são negociáveis aqui:
//   1. só se cria chaveiro DEPOIS de o login por senha ter dado certo, senão uma senha
//      errada embrulharia material que ninguém mais conseguiria abrir;
//   2. a criação é CAS com if-match null_etag; 412 quer dizer que outro aparelho criou
//      antes, e aí o material próprio é DESCARTADO (ele ainda não cifrou nada);
//   3. chaveiro que já foi visto e depois some nunca é recriado sozinho: isso é o estado
//      'chave-perdida', com saída explícita e senha, porque recriar publicaria conteúdo
//      novo sob uma chave que o histórico não conhece.
import { randomBytes } from 'node:crypto';
import kek from './kek.js';

const REV_INICIAL = 1;
const PRIMEIRA_GERACAO = 'g1';
const GERACAO_RE = /^g[0-9]+$/;
const CHAVE_BYTES = 32;

function falha(motivo) {
  return { ok: false, motivo };
}

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function chaveiroValido(x) {
  if (!objeto(x) || x.v !== 1) return false;
  if (!Number.isFinite(Number(x.rev)) || Number(x.rev) < 1) return false;
  if (!GERACAO_RE.test(String(x.cur || ''))) return false;
  return objeto(x.kids) && objeto(x.kcv) && objeto(x.slots) && objeto(x.slots.pw);
}

function caminho(uid) {
  return `/users/${uid}/keyring`;
}

function proximaGeracao(material) {
  const numeros = Object.keys(material.enc || {}).map((g) => Number(String(g).slice(1)) || 0);
  return `g${Math.max(0, ...numeros) + 1}`;
}

function kcvDeTodas(material) {
  const kcv = {};
  for (const [g, valor] of Object.entries(material.enc || {})) kcv[g] = kek.kcvDe(valor);
  return kcv;
}

function kidsDe(material, anterior, agora) {
  const kids = objeto(anterior) ? { ...anterior } : {};
  for (const g of Object.keys(material.enc || {})) if (!kids[g]) kids[g] = agora;
  return kids;
}

async function montarNo(material, senha, { uid, rev, cur, kids, epochSince, deviceId, agora }) {
  const { kdf, blob } = await kek.embrulhar(material, senha, { uid, rev, kdf: kek.parametrosPadrao() });
  return {
    v: 1, rev, updatedAt: agora, epochSince, cur,
    kids: kidsDe(material, kids, agora), kcv: kcvDeTodas(material),
    slots: { pw: { kdf, blob, by: String(deviceId || '') } },
  };
}

async function lerChaveiro(client, uid) {
  try {
    const r = await client.get(caminho(uid), { etag: true });
    if (!r.ok) return falha('indisponivel');
    const bruto = r.data;
    return { ok: true, chaveiro: chaveiroValido(bruto) ? bruto : null, etag: r.etag || 'null_etag' };
  } catch {
    return falha('indisponivel');
  }
}

async function abrirChaveiro(chaveiro, senha, uid) {
  if (!chaveiroValido(chaveiro)) return null;
  const slot = chaveiro.slots.pw;
  return kek.abrir(slot.blob, senha, slot.kdf, { uid, rev: Number(chaveiro.rev) });
}

// Perdeu a corrida: relê e adota o material de quem criou primeiro. O material sorteado
// aqui é jogado fora sem cerimônia, porque nada foi cifrado com ele ainda.
async function adotarDoVencedor(client, uid, senha) {
  const lido = await lerChaveiro(client, uid);
  if (!lido.ok || !lido.chaveiro) return falha('indisponivel');
  const material = await abrirChaveiro(lido.chaveiro, senha, uid);
  if (!material) return falha('senha-nao-abre');
  return { ok: true, material, chaveiro: lido.chaveiro };
}

async function criarChaveiro(client, uid, senha, deviceId) {
  const agora = Date.now();
  const material = kek.novoMaterial();
  const no = await montarNo(material, senha, {
    uid, rev: REV_INICIAL, cur: PRIMEIRA_GERACAO, kids: null, epochSince: agora, deviceId, agora,
  });
  try {
    const w = await client.put(caminho(uid), no, { ifMatch: 'null_etag' });
    if (w.ok) return { ok: true, material, chaveiro: no };
    return adotarDoVencedor(client, uid, senha);
  } catch {
    return falha('indisponivel');
  }
}

// `jaVisto` é o que separa "primeiro login deste aparelho" de "o chaveiro sumiu".
async function garantirChaveiro(client, uid, senha, { deviceId, jaVisto }) {
  const lido = await lerChaveiro(client, uid);
  if (!lido.ok) return falha('indisponivel');
  if (lido.chaveiro) {
    const material = await abrirChaveiro(lido.chaveiro, senha, uid);
    if (!material) return falha('senha-nao-abre');
    return { ok: true, material, chaveiro: lido.chaveiro };
  }
  if (jaVisto) return falha('chave-perdida');
  return criarChaveiro(client, uid, senha, deviceId);
}

async function gravarVersaoNova(client, uid, material, senha, { chaveiro, etag, deviceId, cur }) {
  const agora = Date.now();
  const rev = Number(chaveiro.rev) + 1;
  const no = await montarNo(material, senha, {
    uid, rev, cur: cur || chaveiro.cur, kids: chaveiro.kids, epochSince: chaveiro.epochSince, deviceId, agora,
  });
  try {
    const w = await client.put(caminho(uid), no, { ifMatch: etag || 'null_etag' });
    if (!w.ok) return falha('conflito');
    return { ok: true, material, chaveiro: no };
  } catch {
    return falha('indisponivel');
  }
}

function reembrulhar(client, uid, material, senha, opcoes) {
  return gravarVersaoNova(client, uid, material, senha, opcoes);
}

// Rotação: geração nova e aleatória, `cur` apontando para ela. As antigas ficam no
// material para continuar lendo o histórico; nada é recifrado em massa.
function rotacionar(client, uid, material, senha, opcoes) {
  const nova = proximaGeracao(material);
  const comNova = { ...material, enc: { ...material.enc, [nova]: randomBytes(CHAVE_BYTES).toString('base64url') } };
  return gravarVersaoNova(client, uid, comNova, senha, { ...opcoes, cur: nova });
}

export default { lerChaveiro, criarChaveiro, garantirChaveiro, abrirChaveiro, reembrulhar, rotacionar, chaveiroValido };
export { lerChaveiro, criarChaveiro, garantirChaveiro, abrirChaveiro, reembrulhar, rotacionar, chaveiroValido };
