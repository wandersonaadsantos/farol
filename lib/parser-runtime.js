// Artefato upstream autocontido: não depende do node_modules preservado nos upgrades.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { parseJson } from './io.js';
import { executadoDireto } from './paths.js';

const VERSION = '7.28.5';
const BASE = 'assets/third-party/babel-parser';
const ARQUIVOS = ['dist/parser.cjs', 'LICENSE'];
const raizAtual = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);

function validarParserDistribuido(raiz, exigir = false) {
  // Pacotes anteriores ao parser continuam elegíveis para rollback de versão.
  if (!exigir && !fs.existsSync(path.join(raiz, 'lib/parser-runtime.js'))) return null;
  try {
    const manifesto = parseJson(fs.readFileSync(path.join(raiz, BASE, 'manifest.json'), 'utf8'));
    if (manifesto?.name !== '@babel/parser' || manifesto.version !== VERSION) throw new Error('versão incorreta');
    for (const arquivo of ARQUIVOS) {
      const bytes = fs.readFileSync(path.join(raiz, BASE, arquivo));
      const item = manifesto.files?.[arquivo];
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      if (!item || item.bytes !== bytes.length || item.sha256 !== sha256) throw new Error(`integridade de ${arquivo}`);
    }
    return manifesto;
  } catch (err) {
    throw new Error(`Parser distribuído ausente ou inválido (${err.message}). O pacote precisa ser reconstruído antes da instalação.`);
  }
}

function carregarParserDistribuido() {
  validarParserDistribuido(raizAtual, true);
  return require(path.join(raizAtual, BASE, 'dist/parser.cjs'));
}

if (executadoDireto(import.meta.url)) {
  try { process.stdout.write(validarParserDistribuido(process.argv[2] || raizAtual, true).version + '\n'); }
  catch (err) { process.stderr.write(err.message + '\n'); process.exitCode = 1; }
}

export { validarParserDistribuido, carregarParserDistribuido };
