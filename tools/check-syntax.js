// Gate de sintaxe do Farol: valida TODO .js do projeto, não uma lista fixa.
//
// Antes o `npm run check` era `node --check` em três arquivos escolhidos a dedo
// (server.js, main.js, ui/app.js). Os 19 módulos de lib/ e lib/engine/, criados na
// decomposição da Engine, e os arquivos de test/ ficavam de fora: erro de sintaxe neles
// só aparecia quando alguém rodasse a suíte, e num arquivo pouco exercitado podia passar
// despercebido. Aqui a lista é DESCOBERTA, então módulo novo entra sozinho.
//
// Node puro, zero dependências (invariante 1). Usa `node --check` por processo filho
// (em vez do antigo vm.Script, que era CommonJS e não parseia ESM): respeita o
// "type": "module" do package.json mais próximo, igual o node faria ao carregar o
// arquivo de verdade.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { executadoDireto } from '../lib/paths.js';
import { ignorar } from './nao-e-fonte.js';

const RAIZ = path.join(import.meta.dirname, '..');
// Este gate olha TODO .js do projeto, entao nao pula nada alem do comum.
const IGNORAR = ignorar();

// `workspace-template/.claude/` é a ÚNICA exceção, e ela é deste gate.
//
// A lista casa por NOME de entrada em qualquer nível da árvore, então `.claude`
// não pula só o da raiz: pula o do template também. E o template é artefato
// DISTRIBUÍDO, o protocolo de review que vai dentro do pacote, tanto que o
// `.gitignore` o reabre de propósito. Hoje só existem `.md` e `settings.json` lá
// e nada muda; a armadilha é para depois, quando um hook `.js` novo ali sairia no
// pacote sem nunca passar pelo `node --check`.
//
// Comparar por caminho relativo à raiz resolveria de forma geral e seria o
// remédio errado: quebraria o caso que este gate precisa continuar cobrindo,
// worktree nascendo aninhada em qualquer profundidade. A exceção pontual não tem
// esse efeito. O gate mecânico e a higiene não precisam dela porque os dois já
// ignoram `workspace-template` inteiro, por medirem código de produção.
const TEMPLATE_DISTRIBUIDO = path.join('workspace-template', '.claude');

function ignorado(dir, nome) {
  if (nome === '.claude' && path.join(dir, nome).endsWith(TEMPLATE_DISTRIBUIDO)) return false;
  return IGNORAR.has(nome);
}

function varrer(dir, achados = []) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignorado(dir, item.name)) continue;
    const p = path.join(dir, item.name);
    if (item.isDirectory()) varrer(p, achados);
    else if (item.name.endsWith('.js')) achados.push(p);
  }
  return achados;
}

// piso anti-vacuidade: se a varredura quebrar e devolver pouca coisa, o gate ficaria
// verde sem ter checado nada. Bem abaixo do que existe hoje, mas alto pra denunciar.
const PISO = 25;

function main() {
  const arquivos = varrer(RAIZ).sort();

  if (arquivos.length < PISO) {
    console.error(`  x  check-syntax: só ${arquivos.length} arquivos encontrados (piso ${PISO}).`);
    console.error('     A varredura provavelmente quebrou; o gate NÃO validou o projeto.');
    return 1;
  }

  const falhas = [];
  for (const arq of arquivos) {
    try {
      execFileSync(process.execPath, ['--check', arq], { stdio: 'pipe' });
    } catch (e) {
      falhas.push({ arq: path.relative(RAIZ, arq), msg: String(e.stderr || e.message).split('\n')[0] });
    }
  }

  if (falhas.length) {
    console.error('');
    console.error(`  x  ${falhas.length} arquivo(s) com erro de sintaxe:`);
    for (const f of falhas) console.error(`     ${f.arq}: ${f.msg}`);
    console.error('');
    return 1;
  }

  console.log(`  ok  sintaxe validada em ${arquivos.length} arquivos .js`);
  return 0;
}

if (executadoDireto(import.meta.url)) process.exit(main());
// Só `varrer` é exportada: é o que a suíte precisa observar para provar a
// exceção. `ignorado` não tem consumidor fora daqui, e exportar o que ninguém lê
// é o campo sem leitor que a `core.abstraction.no-premature` condena.
export default { varrer };
export { varrer };
