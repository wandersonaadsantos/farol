// Compatibilidade do runtime distribuído: mesma regra no update e nos builders.
// Sem dependência semver; ranges fora das formas suportadas falham explicitamente.
import fs from 'node:fs';
import path from 'node:path';
import { parseJson } from './io.js';
import { executadoDireto } from './paths.js';

function stableVersion(value) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(String(value || '').trim());
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

function requirementParts(range) {
  const match = /^(\^|~)?(\d+\.\d+\.\d+)$/.exec(String(range || '').trim());
  const parts = match && stableVersion(match[2]);
  if (!parts) throw new Error('Requisito de Electron ausente ou não suportado no pacote. Use o instalador completo.');
  return { operator: match[1] || '', version: match[2], parts };
}

function requiredElectronVersion(range) {
  return requirementParts(range).version;
}

function electronVersionSatisfies(version, range) {
  const required = requirementParts(range);
  const actual = stableVersion(version);
  if (!actual) return false;
  const difference = actual.map((part, i) => part - required.parts[i]).find(n => n !== 0) || 0;
  if (difference < 0) return false;
  if (!required.operator) return difference === 0;
  if (actual[0] !== required.parts[0]) return false;
  if (required.operator === '~' || required.parts[0] === 0) {
    if (actual[1] !== required.parts[1]) return false;
    if (required.operator === '^' && required.parts[1] === 0) return difference === 0;
  }
  return true;
}

function assertElectronRuntime(version, range) {
  if (electronVersionSatisfies(version, range)) return String(version).trim();
  const current = stableVersion(version) ? String(version).trim() : 'não identificado';
  throw Object.assign(new Error(`Electron ${current} incompatível com ${String(range).trim()}. Use o instalador completo desta versão; a instalação atual foi preservada.`),
    { code: 'ELECTRON_RUNTIME_INCOMPATIBLE' });
}

function readPackage(file) {
  try {
    const manifest = parseJson(fs.readFileSync(file, 'utf8'));
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('Manifesto inválido.');
    return manifest;
  }
  catch { throw new Error('Não foi possível ler o manifesto do runtime. Use o instalador completo.'); }
}

function packageElectronRequirement(file) {
  const range = readPackage(file).dependencies?.electron;
  requiredElectronVersion(range);
  return range;
}

function checkElectronPackage(sourceDir, verifyDist = false) {
  const requirement = packageElectronRequirement(path.join(sourceDir, 'package.json'));
  const electronDir = path.join(sourceDir, 'node_modules', 'electron');
  const version = assertElectronRuntime(readPackage(path.join(electronDir, 'package.json')).version, requirement);
  if (verifyDist) {
    let distributed;
    try { distributed = fs.readFileSync(path.join(electronDir, 'dist', 'version'), 'utf8').trim().replace(/^v/, ''); }
    catch { throw new Error('Versão do binário Electron ausente. Rode npm install e node node_modules/electron/install.js antes de gerar o instalador.'); }
    assertElectronRuntime(distributed, version);
  }
  return version;
}

function runCli(args) {
  const [command, file, installed] = args;
  const mode = String(command || '').replace(/^--/, '');
  if (mode === 'required' && file) return requiredElectronVersion(packageElectronRequirement(file));
  if (mode === 'check-running' && file) return assertElectronRuntime(process.versions.electron, packageElectronRequirement(file));
  if (mode === 'check' && file && installed) return assertElectronRuntime(readPackage(installed).version, packageElectronRequirement(file));
  if (mode === 'check-package' && file) return checkElectronPackage(file);
  if (mode === 'check-installed' && file) return checkElectronPackage(file, true);
  throw new Error('Uso: electron-runtime.js required|check-running <package.json>, check <package.json> <electron-package.json> ou check-package|check-installed <pasta>.');
}

if (executadoDireto(import.meta.url)) {
  try { process.stdout.write(runCli(process.argv.slice(2)) + '\n'); }
  catch (err) {
    process.stderr.write(err.message + '\n');
    process.exitCode = err.code === 'ELECTRON_RUNTIME_INCOMPATIBLE' ? 1 : 2;
  }
}

export { requiredElectronVersion, electronVersionSatisfies, assertElectronRuntime, packageElectronRequirement, checkElectronPackage };
