// Gerador das regras do Firebase (anexo C1, "Estratégia de regras"). Expande as macros do
// template e escreve firebase/database.rules.json.
//
// A expansão é TEXTUAL, sem JSON.parse: o template já é o JSON publicável, com marcadores
// no lugar das condições repetidas. Assim o arquivo gerado é byte a byte previsível, o
// diff da publicação é legível, e nada aqui depende do formatador de JSON do Node.
//
// As regras NÃO são publicadas por este script: a publicação é manual, uma vez, pelo dono
// (firebase/README.md). Aqui só se gera o arquivo que ele vai colar no console.
//
// Uso:
//   node tools/sync-rules.js            grava firebase/database.rules.json
//   node tools/sync-rules.js --stdout   imprime o gerado, sem gravar
//   node tools/sync-rules.js --check    sai com 1 se o arquivo no disco divergir
import fs from 'node:fs';
import path from 'node:path';

const RAIZ = path.join(import.meta.dirname, '..');
const TEMPLATE = path.join(RAIZ, 'firebase', 'database.rules.template.json');
const SAIDA = path.join(RAIZ, 'firebase', 'database.rules.json');
const MAX_PASSES = 5;

const SIMPLES = {
  U: "auth != null && auth.uid == $uid",
  C: "root.child('users').child($uid).child('live').child('control')",
  // senha recente: o auth_time vem em SEGUNDOS, e sem o *1000 a comparação com `now`
  // (milissegundos) daria sempre falso, negando até quem acabou de entrar
  REC: "auth.token.firebase.sign_in_provider == 'password' && auth.token.auth_time * 1000 + 300000 > now",
  GEN: "newData.child('generation').val() == @C@.child('admin').child('generation').val()",
  // tomada forçada (7.C8): sucessor sobe por cima de lease VIVO só com a geração anterior
  // mais um, nomeando de quem tomou e sendo outro aparelho. Escrita acidental por cima de
  // lease vivo continua recusada pelo servidor.
  TOMADA: "newData.child('takeoverSeq').isNumber() && newData.child('takeoverSeq').val() == (data.child('takeoverSeq').exists() ? data.child('takeoverSeq').val() + 1 : 2) && newData.child('tomadoDe').val() == data.child('deviceId').val() && newData.child('deviceId').val() != data.child('deviceId').val()",
  // a mesma condição, vista de um FILHO do lease (as regras de expiresAt e leaseId olham
  // o pai): sem isto o servidor recusaria o sucessor por causa da regra do filho
  TOMADA_FILHO: "newData.parent().child('takeoverSeq').isNumber() && newData.parent().child('takeoverSeq').val() == (data.parent().child('takeoverSeq').exists() ? data.parent().child('takeoverSeq').val() + 1 : 2) && newData.parent().child('tomadoDe').val() == data.parent().child('deviceId').val() && newData.parent().child('deviceId').val() != data.parent().child('deviceId').val()",
  LIMPA: "!newData.exists() && @REC@ && @C@.child('cleanup').child('enabled').val() == true && !root.child('users').child($uid).child('live').child('operations').exists()",
};

function listaDe(texto) {
  return texto.split(',').map((x) => x.trim().replace(/^'|'$/g, '')).filter(Boolean);
}

function expandirFuncoes(texto) {
  return texto
    .replace(/@H\(\[([^\]]*)\]\)@/g, (_m, lista) => `newData.hasChildren([${listaDe(lista).map((x) => `'${x}'`).join(', ')}])`)
    .replace(/@ENC\((\d+)\)@/g, (_m, n) => `newData.child('enc').isString() && newData.child('enc').val().matches(/^e1[.]g[0-9]+[.][A-Za-z0-9_-]+[.][A-Za-z0-9_-]+[.][A-Za-z0-9_-]+$/) && newData.child('enc').val().length <= ${n}`);
}

function expandir(texto) {
  let saida = texto;
  for (let i = 0; i < MAX_PASSES; i++) {
    const antes = saida;
    for (const [nome, valor] of Object.entries(SIMPLES)) saida = saida.split(`@${nome}@`).join(valor);
    saida = expandirFuncoes(saida);
    if (saida === antes) break;
  }
  return saida;
}

function gerar() {
  const bruto = fs.readFileSync(TEMPLATE, 'utf8');
  const saida = expandir(bruto);
  const sobrou = saida.match(/@[A-Z][A-Za-z]*/);
  if (sobrou) throw new Error(`macro sem expansão no template: ${sobrou[0]}`);
  return saida;
}

const gerado = gerar();
if (process.argv.includes('--stdout')) {
  process.stdout.write(gerado);
} else if (process.argv.includes('--check')) {
  const atual = fs.existsSync(SAIDA) ? fs.readFileSync(SAIDA, 'utf8') : '';
  if (atual !== gerado) {
    process.stderr.write('firebase/database.rules.json está diferente do gerado pelo template\n');
    process.exit(1);
  }
  process.stdout.write('regras geradas conferem com o arquivo publicado\n');
} else {
  fs.writeFileSync(SAIDA, gerado);
  process.stdout.write(`regras geradas em ${SAIDA}\n`);
}
