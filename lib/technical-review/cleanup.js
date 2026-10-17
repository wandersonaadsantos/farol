// Só remove diretórios privados criados por esta operação, nunca uma origem revisada.
import fs from 'node:fs';
import path from 'node:path';
import { STATE_DIR } from '../paths.js';

function privateChild(directory, root, prefix) {
  const target = path.resolve(directory);
  if (path.dirname(target) !== path.resolve(root) || !path.basename(target).startsWith(prefix)
    || path.basename(target) === prefix) throw new Error('diretório privado fora da área permitida');
  if (fs.existsSync(target)) {
    const stat = fs.lstatSync(target);
    if (!stat.isDirectory() || stat.isSymbolicLink() || path.dirname(fs.realpathSync(target)) !== fs.realpathSync(root)) {
      throw new Error('diretório privado não corresponde à área permitida');
    }
  }
  return target;
}

function removePrivateDirectory(directory, root, prefix) {
  const target = privateChild(directory, root, prefix);
  fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

function cleanup(context) {
  if (!context?.snapshot) return;
  const root = path.join(STATE_DIR, 'technical-review');
  const target = privateChild(context.snapshot, root, 'review-');
  removePrivateDirectory(target, root, 'review-');
  fs.rmSync(`${target}-request.json`, { force: true });
}

export { cleanup, privateChild, removePrivateDirectory };
