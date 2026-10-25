// A remoção só alcança um filho direto e real da raiz privada declarada.
import fs from 'node:fs';
import path from 'node:path';

function privateChild(directory, root, prefix) {
  const target = path.resolve(directory), base = path.resolve(root);
  if (path.dirname(target) !== base || !path.basename(target).startsWith(prefix)
    || path.basename(target) === prefix) throw new Error('diretório privado fora da área permitida');
  if (fs.existsSync(base) && fs.lstatSync(base).isSymbolicLink()) throw new Error('raiz privada é um link');
  if (!fs.existsSync(target)) return target;
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink() || path.dirname(fs.realpathSync(target)) !== fs.realpathSync(base)) {
    throw new Error('diretório privado não corresponde à área permitida');
  }
  return target;
}

function siblingFile(target, suffix) {
  const file = target + suffix;
  if (fs.existsSync(file) && (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink())) {
    throw new Error('registro privado não corresponde à área permitida');
  }
  return file;
}

export { privateChild, siblingFile };
