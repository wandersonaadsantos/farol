// Web hospedada: a tabela de portas do provisionamento por pessoa. Uma VPS roda um
// motor do Farol por pessoa, cada um na sua porta em 127.0.0.1, e o proxy com TLS
// encaminha para lá. Quem guarda "qual pessoa está em qual porta" é /etc/farol/portas,
// e ESTE arquivo é o único que lê ou escreve esse formato.
//
// Formato: texto simples, uma linha `<login> <porta>` por pessoa (um espaço só entre
// os dois), sem comentário e sem linha vazia no meio, na ordem de inserção, com quebra
// de linha no fim. O login segue a regra de nome de usuário do Linux que o useradd
// aceita sem aviso; a porta é inteira, de 1024 a 65535.
//
// Linha fora do formato, login repetido ou porta repetida LANÇAM com a mensagem dizendo
// o que e onde: o arquivo é editado à mão em caso de emergência, e alocar em cima de um
// arquivo que não se entende arriscaria dar a mesma porta para duas pessoas.
//
// Tudo aqui é PURO, exceto `executar`, a CLI fina que o provisionar-pessoa.sh chama:
//   node tools/web/portas.js alocar <arquivo> <login> [porta]   imprime a porta e regrava
//   node tools/web/portas.js listar <arquivo>                   imprime `login porta`
import fs from 'node:fs';
import { executadoDireto } from '../../lib/paths.js';
import { DEFAULT_PORT } from '../../lib/constants.js';

const LOGIN = /^[a-z_][a-z0-9_-]{0,31}$/;
const PORTA = /^\d{1,5}$/;
const PORTA_MIN = 1024;
const PORTA_MAX = 65535;
const USO = 'Uso: node tools/web/portas.js alocar <arquivo> <login> [porta]\n'
  + '     node tools/web/portas.js listar <arquivo>\n';

function loginValido(login) {
  return typeof login === 'string' && LOGIN.test(login);
}

// Porta como número, ou null quando não é inteira no intervalo aceito.
function portaValida(valor) {
  const texto = String(valor);
  if (!PORTA.test(texto)) return null;
  const porta = Number(texto);
  return porta >= PORTA_MIN && porta <= PORTA_MAX ? porta : null;
}

function conferirUnicos(registros) {
  const logins = new Set();
  const portas = new Set();
  for (const { login, porta } of registros) {
    if (logins.has(login)) throw new Error(`login repetido em /etc/farol/portas: ${login}`);
    if (portas.has(porta)) throw new Error(`porta repetida em /etc/farol/portas: ${porta}`);
    logins.add(login);
    portas.add(porta);
  }
}

function lerPortas(texto) {
  const conteudo = String(texto || '');
  if (!conteudo) return [];
  const linhas = conteudo.endsWith('\n') ? conteudo.slice(0, -1).split('\n') : conteudo.split('\n');
  const registros = linhas.map((linha, i) => {
    const partes = linha.split(' ');
    const porta = partes.length === 2 ? portaValida(partes[1]) : null;
    if (!loginValido(partes[0]) || porta === null) {
      throw new Error(`linha ${i + 1} fora do formato "<login> <porta>": ${linha}`);
    }
    return { login: partes[0], porta };
  });
  conferirUnicos(registros);
  return registros;
}

function serializarPortas(registros) {
  return registros.map(({ login, porta }) => `${login} ${porta}\n`).join('');
}

function proximaPortaLivre(registros, aPartirDe = DEFAULT_PORT) {
  const ocupadas = new Set(registros.map(r => r.porta));
  let porta = aPartirDe;
  while (ocupadas.has(porta)) porta += 1;
  if (porta > PORTA_MAX) throw new Error('nenhuma porta livre até 65535');
  return porta;
}

// Devolve o texto novo do arquivo (com a pessoa no fim) e a porta dela. Sem porta
// pedida, a próxima livre a partir da padrão do Farol.
function alocarPorta(texto, login, portaPedida) {
  if (!loginValido(login)) throw new Error(`login inválido: ${login}`);
  const registros = lerPortas(texto);
  let porta = proximaPortaLivre(registros);
  if (portaPedida !== undefined) {
    porta = portaValida(portaPedida);
    if (porta === null) throw new Error(`porta inválida: ${portaPedida}`);
  }
  const novos = [...registros, { login, porta }];
  conferirUnicos(novos);
  return { texto: serializarPortas(novos), porta };
}

function lerArquivo(arquivo) {
  return fs.existsSync(arquivo) ? fs.readFileSync(arquivo, 'utf8') : '';
}

function executar(args, saida, erro) {
  const [comando, arquivo, login, porta] = args;
  const alocar = comando === 'alocar' && (args.length === 3 || args.length === 4);
  const listar = comando === 'listar' && args.length === 2;
  if (!alocar && !listar) {
    erro.write(USO);
    return 2;
  }
  try {
    if (listar) {
      saida.write(serializarPortas(lerPortas(lerArquivo(arquivo))));
      return 0;
    }
    const r = alocarPorta(lerArquivo(arquivo), login, porta);
    // grava ao lado e renomeia: uma queda no meio não deixa o arquivo pela metade
    const temporario = `${arquivo}.tmp`;
    fs.writeFileSync(temporario, r.texto, { mode: 0o644 });
    fs.renameSync(temporario, arquivo);
    saida.write(`${r.porta}\n`);
    return 0;
  } catch (e) {
    erro.write(`${e.message}\n`);
    return 1;
  }
}

if (executadoDireto(import.meta.url)) process.exitCode = executar(process.argv.slice(2), process.stdout, process.stderr);

export default { lerPortas, serializarPortas, proximaPortaLivre, alocarPorta, executar };
export { lerPortas, serializarPortas, proximaPortaLivre, alocarPorta, executar };
