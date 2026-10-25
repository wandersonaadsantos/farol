// O manifesto é a fonte do contrato externo; Electron tem verificação própria.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseJson } from './io.js';
import { executadoDireto } from './paths.js';

const PACKAGE_FILE = fileURLToPath(new URL('../package.json', import.meta.url));

function packageNodeRequirement(file = PACKAGE_FILE) {
  const manifest = parseJson(fs.readFileSync(file, 'utf8'));
  const range = manifest?.engines?.node;
  if (!/^>=\d+\.\d+\.\d+ <\d+$/.test(String(range || ''))) {
    throw new Error('Contrato Node ausente ou inválido no pacote. Use o pacote completo do Farol.');
  }
  return range;
}

function nodeVersionSatisfies(version, range) {
  const actual = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version || '').replace(/^v/, ''));
  const required = /^>=(\d+)\.(\d+)\.(\d+) <(\d+)$/.exec(String(range || ''));
  if (!actual || !required) return false;
  const parts = actual.slice(1).map(Number);
  const floor = required.slice(1, 4).map(Number);
  const difference = parts.map((part, i) => part - floor[i]).find(n => n !== 0) || 0;
  return parts[0] < Number(required[4]) && difference >= 0;
}

function assertExternalNodeRuntime({ version = process.versions.node, electron = process.versions.electron, packageFile = PACKAGE_FILE } = {}) {
  // A versão de Node do desktop é embarcada no Electron, não vem do PATH.
  if (electron !== undefined) return version;
  const range = packageNodeRequirement(packageFile);
  if (nodeVersionSatisfies(version, range)) return version;
  throw Object.assign(new Error(`Node ${version || 'não identificado'} incompatível: o Farol requer Node ${range}. Instale a linha Node 24 LTS no ambiente deste projeto (nvm install 24.22.1; nvm use 24.22.1), confira node --version e execute novamente. A instalação existente foi preservada.`),
    { code: 'NODE_RUNTIME_INCOMPATIBLE' });
}

if (executadoDireto(import.meta.url)) {
  try {
    assertExternalNodeRuntime({ packageFile: process.argv[2] || PACKAGE_FILE });
    process.stdout.write(`Node ${process.versions.node}: contrato externo atendido.\n`);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exitCode = 1;
  }
}

export { packageNodeRequirement, nodeVersionSatisfies, assertExternalNodeRuntime };
