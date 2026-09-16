// Embrulho do material de chave pela senha da conta do Firebase (CT-ENV). Puro no sentido
// que importa aqui: sem estado, sem IO e sem rede. Só node:crypto.
//
// A senha nunca vira chave direto: ela passa pelo scrypt com sal por embrulho, e a KEK
// resultante cifra o material em AES-256-GCM. O scrypt roda ASSÍNCRONO, no threadpool: a
// versão síncrona travaria o event loop do engine por dezenas de milissegundos a cada
// login, e o engine atende HTTP e SSE no mesmo laço.
//
// A AAD amarra uid, slot, parâmetros, sal e rev. Trocar qualquer um deles no banco
// invalida o embrulho em vez de produzir material silenciosamente errado.
import { scrypt, randomBytes, createCipheriv, createDecipheriv, createHmac } from 'node:crypto';
import { SYNC } from '../constants.js';
import io from '../io.js';

const PREFIXO = 'w1';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const CHAVE_BYTES = 32;
const KCV_HEX = 16;

function parametrosPadrao() {
  return { alg: 'scrypt', N: SYNC.KEK_N, r: SYNC.KEK_R, p: SYNC.KEK_P, salt: randomBytes(SYNC.KEK_SALT_BYTES).toString('base64url') };
}

function b64(buf) { return Buffer.from(buf).toString('base64url'); }
function debase64(texto) { return Buffer.from(String(texto || ''), 'base64url'); }

function bufferDe(valor) {
  const b = debase64(valor);
  return b.length === CHAVE_BYTES ? b : null;
}

function novoMaterial() {
  return { v: 1, id: b64(randomBytes(CHAVE_BYTES)), enc: { g1: b64(randomBytes(CHAVE_BYTES)) } };
}

// Prova, sem a senha, que a chave que está no cache é a mesma que o banco conhece.
function kcvDe(encBase64url) {
  const chave = bufferDe(encBase64url);
  if (!chave) return '';
  return createHmac('sha256', chave).update('farol|kcv', 'utf8').digest('hex').slice(0, KCV_HEX);
}

function aad(uid, kdf, rev) {
  return ['farol', 'wrap', '1', String(uid || ''), 'pw', String(kdf.alg), String(kdf.N), String(kdf.r), String(kdf.p), String(kdf.salt), String(rev)].join('|');
}

// scrypt assíncrono: nunca scryptSync no event loop do engine.
function derivar(senha, kdf) {
  return new Promise((resolve, reject) => {
    const opcoes = { N: Number(kdf.N), r: Number(kdf.r), p: Number(kdf.p) };
    scrypt(String(senha === null || senha === undefined ? '' : senha), debase64(kdf.salt), CHAVE_BYTES, opcoes, (err, chave) => {
      if (err) reject(err);
      else resolve(chave);
    });
  });
}

async function embrulhar(material, senha, { uid, rev, kdf }) {
  const parametros = kdf || parametrosPadrao();
  const chave = await derivar(senha, parametros);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', chave, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(aad(uid, parametros, rev), 'utf8'));
  const ct = Buffer.concat([cipher.update(io.safeStringify(material, '{}'), 'utf8'), cipher.final()]);
  return { kdf: parametros, blob: [PREFIXO, b64(iv), b64(ct), b64(cipher.getAuthTag())].join('.') };
}

// Senha errada, embrulho mexido ou AAD diferente devolvem null: é resposta esperada do
// fluxo de login, não falha de programa.
async function abrir(blob, senha, kdf, { uid, rev }) {
  const partes = String(blob || '').split('.');
  if (partes.length !== 4 || partes[0] !== PREFIXO) return null;
  const iv = debase64(partes[1]);
  const ct = debase64(partes[2]);
  const tag = debase64(partes[3]);
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES || !ct.length) return null;
  try {
    const chave = await derivar(senha, kdf);
    const decipher = createDecipheriv('aes-256-gcm', chave, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(aad(uid, kdf, rev), 'utf8'));
    decipher.setAuthTag(tag);
    const claro = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
    const material = io.parseJson(claro, null);
    return material && typeof material === 'object' ? material : null;
  } catch {
    // tag GCM inválida: senha errada ou embrulho adulterado, que é o caminho normal
    return null;
  }
}

export default { parametrosPadrao, novoMaterial, embrulhar, abrir, kcvDe, bufferDe };
export { parametrosPadrao, novoMaterial, embrulhar, abrir, kcvDe, bufferDe };
