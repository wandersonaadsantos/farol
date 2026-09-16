// Nó assinado pelo admin: a forma `{ v, generation, enc, sig }` e a ORDEM das recusas,
// num lugar só (CT-ADM-POL e CT-GRUPO). Puro: sem estado, sem rede; o IO é de quem chama.
//
// Política e grupo são conteúdos diferentes com o MESMO contrato de nó, e a ordem em que
// um valor recebido é recusado é regra de negócio, não detalhe de cada chamador. Copiada
// em dois lugares, ela vira duas ordens diferentes na primeira correção feita só de um
// lado, e a ordem é justamente o que garante que nada seja decifrado antes de provar que
// veio do admin.
//
// A ordem, e o porquê de cada passo:
//   1. `forma`      o que não tem os quatro campos não é um nó assinado;
//   2. `geracao`    valor de outra geração é de outra autoridade;
//   3. `assinatura` só aqui se prova que veio do admin vigente;
//   4. `autoridade` assinatura válida não diz QUANDO: o frescor diz;
//   5. `antiga`     versão menor ou igual à aceita é reentrega, não novidade;
//   6. decifrar     último, com o conteúdo já provado.
import assinatura from './assinatura.js';
import envelope from './envelope.js';

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

// O valor assinado é o nó SEM a própria assinatura, sempre na mesma ordem: é o que faz
// assinar e verificar chegarem ao mesmo texto.
function valorAssinado(no) {
  return { v: Number(no.v) || 0, generation: Number(no.generation) || 0, enc: String(no.enc || '') };
}

function montarNoAssinado({ jwk, uid, caminho, generation, versao, enc }) {
  const no = { v: Number(versao) || 0, generation: Number(generation) || 0, enc: String(enc || '') };
  const sig = assinatura.assinar(jwk, { uid, caminho, generation: no.generation, valor: valorAssinado(no) });
  if (!sig) return null;
  return { ...no, sig };
}

function recusa(code) {
  return { ok: false, code };
}

function aceitarNoAssinado({ no, admin, uid, caminho, campo, esquema, material, fresca, versaoAceita }) {
  if (!objeto(no) || !no.enc || !no.sig || !objeto(admin) || !admin.publicKey) return recusa('forma');
  const generation = Number(admin.generation) || 0;
  if (!generation || (Number(no.generation) || 0) !== generation) return recusa('geracao');
  if (!assinatura.verificar(admin.publicKey, no.sig, { uid, caminho, generation, valor: valorAssinado(no) })) return recusa('assinatura');
  if (fresca !== true) return recusa('autoridade');
  const versao = Number(no.v) || 0;
  if (versao <= (Number(versaoAceita) || 0)) return recusa('antiga');
  const aberto = envelope.decifrar({ enc: no.enc, material, uid, caminho, campo, esquema, rMinimo: versao });
  if (!aberto.ok) return { ok: false, code: 'cifra', motivo: aberto.motivo };
  return { ok: true, valor: aberto.valor, versao, generation };
}

export default { valorAssinado, montarNoAssinado, aceitarNoAssinado };
export { valorAssinado, montarNoAssinado, aceitarNoAssinado };
