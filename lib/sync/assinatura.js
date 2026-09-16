// Assinatura Ed25519 dos sinais que o admin publica (CT-ENV, bloco ASSINATURA, e
// CT-ADM-POL). Puro: sem estado, sem IO, sem rede.
//
// O QUE ELA É: prova de que aquele valor, naquele caminho, naquela geração e naquela
// conta, foi montado por quem tem a chave privada do admin. Serve contra cliente honesto
// com defeito e contra versão divergente do Farol.
//
// O QUE ELA NÃO É: controle de acesso. O Realtime Database não verifica criptografia; as
// regras conferem forma, dono e frescor de login, e nada mais. Qualquer aparelho com a
// credencial da conta consegue ESCREVER nesses nós. Quem recusa um valor mal assinado é
// sempre o CLIENTE que lê, antes de aplicar. Isso está na tela técnica e num teste.
import { sign, verify, createHash } from 'node:crypto';
import { createPrivateKey } from 'node:crypto';
import io from '../io.js';
import { chavePublicaDe } from './admin-chave.js';

function texto(v) { return typeof v === 'string' ? v.trim() : ''; }

// A pré-imagem amarra os quatro: conta, caminho lógico, geração e o valor canônico. Mover
// a assinatura para outro nó, reusar de outra geração ou trocar um campo do valor falha.
function preImagemDaAssinatura({ uid, caminho, generation, valor }) {
  const resumo = createHash('sha256').update(io.safeStringify(valor, 'null'), 'utf8').digest('hex');
  return ['farol', 'sig', '1', texto(uid), texto(caminho), String(Number(generation) || 0), ''].join('|') + resumo;
}

function chavePrivadaDe(jwk) {
  try {
    return createPrivateKey({ key: jwk, format: 'jwk' });
  } catch {
    // jwk torto: quem chama trata como "este aparelho não consegue assinar"
    return null;
  }
}

function assinar(jwk, ctx) {
  const chave = chavePrivadaDe(jwk);
  if (!chave) return '';
  return sign(null, Buffer.from(preImagemDaAssinatura(ctx), 'utf8'), chave).toString('base64url');
}

// Nunca lança: assinatura ausente, malformada ou de outra chave devolve false, que é o
// caminho normal de quem lê um nó que outro aparelho escreveu.
function verificar(publicKey, assinatura, ctx) {
  const chave = chavePublicaDe(publicKey);
  const s = texto(assinatura);
  if (!chave || !s) return false;
  try {
    return verify(null, Buffer.from(preImagemDaAssinatura(ctx), 'utf8'), chave, Buffer.from(s, 'base64url'));
  } catch {
    // base64url inválido ou tamanho errado de assinatura
    return false;
  }
}

export default { preImagemDaAssinatura, assinar, verificar };
export { preImagemDaAssinatura, assinar, verificar };
