// Envelope cifrado do conteúdo que sobe para o banco (CT-ENV). Folha: sem estado, sem IO,
// sem rede, só node:crypto.
//
// Formato: 'e1.<kid>.<iv>.<ct>.<tag>', tudo em base64url sem preenchimento. A AAD amarra
// uid, caminho lógico, campo, geração e esquema, mais os extras que o contrato do nó
// exigir. Mover um envelope para outro nó, outro campo ou outra conta falha no GCM em vez
// de decifrar em silêncio no lugar errado.
//
// O texto claro é completado com espaços até múltiplo de ENVELOPE_BLOCO_BYTES e NÃO é
// comprimido: comprimir antes de cifrar faz o tamanho do ciphertext seguir o conteúdo, e
// o conteúdo aqui é relatório de revisão com texto de terceiros.
//
// A leitura falha FECHADA: qualquer pedaço malformado descarta o item inteiro, que vira
// "não verificável" para quem chamou. Nunca existe texto parcial.
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { SYNC } from '../constants.js';
import io from '../io.js';
import kek from './kek.js';

const PREFIXO = 'e1';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KID_RE = /^g[0-9]+$/;
const ESPACO = ' ';

// Tetos em caracteres da string final, por nó (anexo C1, "Envelope cifrado").
const TETOS = {
  'live/operations': 2048, 'live/pending': 4096, 'live/deviceStatus': 2048,
  'live/devicePolicies': 2048, 'live/profiles': 1024, catalog: 2048,
  recentReviews: 1024, reviewBodies: 48000, panorama: 2048, myPrs: 8192,
  selfAnalyses: 48000, usageEvents: 1024,
};

function falha(motivo) { return { ok: false, motivo }; }

function b64(buf) { return Buffer.from(buf).toString('base64url'); }
function debase64(t) { return Buffer.from(String(t || ''), 'base64url'); }

function textoDoExtra(x) {
  return String(x === null || x === undefined ? '' : x);
}

function aadDe({ uid, caminho, campo, kid, esquema, extras }) {
  const base = ['farol', PREFIXO, String(uid || ''), String(caminho || ''), String(campo || ''), String(kid || ''), String(esquema || '')];
  const extra = Array.isArray(extras) ? extras.map(textoDoExtra) : [];
  return [...base, ...extra].join('|');
}

// O claro guarda o esquema e a revisão junto dos campos: quem lê confere os dois antes de
// aceitar o item, e a revisão é o que impede um item antigo de sobrescrever um novo.
function claroDe({ esquema, r, dados }) {
  const texto = io.safeStringify({ s: String(esquema || ''), v: 1, r: Number(r) || 0, ...(dados || {}) }, '{}');
  const bloco = SYNC.ENVELOPE_BLOCO_BYTES;
  const falta = (bloco - (Buffer.byteLength(texto, 'utf8') % bloco)) % bloco;
  return texto + ESPACO.repeat(falta);
}

function tamanhoDoClaro(ctx) {
  return Buffer.byteLength(claroDe(ctx), 'utf8');
}

function cabeNoTeto(enc, no) {
  const teto = TETOS[no];
  if (!teto) return true;
  return String(enc || '').length <= teto;
}

function chaveDa(material, kid) {
  const enc = material && material.enc ? material.enc[kid] : '';
  return kek.bufferDe(enc);
}

function cifrar(ctx) {
  const kid = String(ctx.cur || '');
  const chave = chaveDa(ctx.material, kid);
  if (!KID_RE.test(kid) || !chave) return falha('kid');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', chave, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(aadDe({ ...ctx, kid }), 'utf8'));
  const ct = Buffer.concat([cipher.update(claroDe(ctx), 'utf8'), cipher.final()]);
  const enc = [PREFIXO, kid, b64(iv), b64(ct), b64(cipher.getAuthTag())].join('.');
  if (!cabeNoTeto(enc, ctx.no)) return falha('teto');
  return { ok: true, enc };
}

function pedacos(enc) {
  const partes = String(enc || '').split('.');
  if (partes.length !== 5 || partes[0] !== PREFIXO) return null;
  return { kid: partes[1], iv: debase64(partes[2]), ct: debase64(partes[3]), tag: debase64(partes[4]) };
}

function abrir(p, chave, ctx) {
  try {
    const decipher = createDecipheriv('aes-256-gcm', chave, p.iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(aadDe({ ...ctx, kid: p.kid }), 'utf8'));
    decipher.setAuthTag(p.tag);
    return Buffer.concat([decipher.update(p.ct), decipher.final()]).toString('utf8');
  } catch {
    // tag inválida, AAD diferente ou ciphertext adulterado: o item inteiro é descartado
    return null;
  }
}

function decifrar(ctx) {
  const p = pedacos(ctx.enc);
  if (!p) return falha('prefixo');
  const chave = chaveDa(ctx.material, p.kid);
  if (!KID_RE.test(p.kid) || !chave) return falha('kid');
  if (p.iv.length !== IV_BYTES) return falha('iv');
  if (p.tag.length !== TAG_BYTES) return falha('tag');
  const claro = abrir(p, chave, ctx);
  if (claro === null) return falha('gcm');
  const valor = io.parseJson(claro.trim(), null);
  if (!valor || typeof valor !== 'object') return falha('json');
  if (String(valor.s || '') !== String(ctx.esquema || '')) return falha('esquema');
  const r = Number(valor.r) || 0;
  if (Number.isFinite(Number(ctx.rMinimo)) && r < Number(ctx.rMinimo)) return falha('revisao');
  return { ok: true, valor: semMetadados(valor), r, kid: p.kid };
}

// O que volta para quem chamou são só os campos do item: `s`, `v` e `r` são metadados do
// envelope e já foram conferidos aqui.
function semMetadados(valor) {
  const campos = { ...valor };
  delete campos.s;
  delete campos.v;
  delete campos.r;
  return campos;
}

export default { cifrar, decifrar, aadDe, cabeNoTeto, tamanhoDoClaro, TETOS };
export { cifrar, decifrar, aadDe, cabeNoTeto, tamanhoDoClaro, TETOS };
