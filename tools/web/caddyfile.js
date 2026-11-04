// Web hospedada: o Caddyfile do proxy com TLS, gerado de /etc/farol/portas. Cada pessoa
// vira o bloco de tools/web/Caddyfile.template no subdomínio `<pessoa>.farol.<dominio>`
// (nunca prefixo de caminho: a tela carrega /app.js e /app.css da raiz e as rotas moram
// no caminho), encaminhando para o motor dela em 127.0.0.1:<porta>.
//
// O formato de /etc/farol/portas é do portas.js, inclusive a regra de login que serve de
// subdomínio: aqui os registros só passam de novo pela leitura dele (formato, login e porta
// sem repetição). O que se valida aqui é só o domínio, rótulo a rótulo.
//
// `gerarCaddyfile` é PURA; `executar` é a CLI fina que o gerar-caddyfile.sh chama:
//   node tools/web/caddyfile.js <arquivo-de-portas> <dominio>   imprime o Caddyfile
import fs from 'node:fs';
import { executadoDireto } from '../../lib/paths.js';
import { lerPortas, serializarPortas } from './portas.js';

const TEMPLATE = fs.readFileSync(new URL('./Caddyfile.template', import.meta.url), 'utf8');
// o cabeçalho do template (até a primeira linha vazia) documenta os marcadores e fica fora
const BLOCO = TEMPLATE.slice(TEMPLATE.indexOf('\n\n') + 2);
const ROTULO = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const DOMINIO_MAX = 253;
const CABECALHO = '# Gerado por tools/web/gerar-caddyfile.sh a partir de /etc/farol/portas.\n'
  + '# Nao edite a mao: a proxima geracao sobrescreve. A fonte e tools/web/Caddyfile.template.\n';
const USO = 'Uso: node tools/web/caddyfile.js <arquivo-de-portas> <dominio>\n';

function dominioValido(dominio) {
  if (typeof dominio !== 'string' || dominio.length > DOMINIO_MAX) return false;
  const rotulos = dominio.split('.');
  return rotulos.length >= 2 && rotulos.every(r => ROTULO.test(r));
}

function bloco(dominio, { login, porta }) {
  return BLOCO.replaceAll('@PESSOA@', login).replaceAll('@DOMINIO@', dominio).replaceAll('@PORTA@', String(porta));
}

function gerarCaddyfile({ dominio, pessoas } = {}) {
  if (!dominioValido(dominio)) throw new Error(`domínio inválido: ${dominio}`);
  // ida e volta pelo formato do portas.js: mesma regra de login, porta e repetição
  const registros = lerPortas(serializarPortas(pessoas || []));
  return [CABECALHO, ...registros.map(r => bloco(dominio, r))].join('\n');
}

function executar(args, saida, erro) {
  if (args.length !== 2) {
    erro.write(USO);
    return 2;
  }
  const [arquivo, dominio] = args;
  try {
    const texto = fs.readFileSync(arquivo, 'utf8');
    saida.write(gerarCaddyfile({ dominio, pessoas: lerPortas(texto) }));
    return 0;
  } catch (e) {
    erro.write(`${e.message}\n`);
    return 1;
  }
}

if (executadoDireto(import.meta.url)) process.exitCode = executar(process.argv.slice(2), process.stdout, process.stderr);

export default { gerarCaddyfile, executar };
export { gerarCaddyfile, executar };
