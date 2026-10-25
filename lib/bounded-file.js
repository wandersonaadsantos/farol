// Leitura limitada de arquivo regular: metadados e conteúdo pertencem ao mesmo fd.
import fs from 'node:fs';

function sameFile(left, right) {
  return left.ino !== 0n && left.ino === right.ino && left.dev === right.dev;
}
function assertPathIdentity(file, opened) {
  const current = fs.lstatSync(file, { bigint: true });
  if (current.isSymbolicLink() || !current.isFile() || !sameFile(opened, current)) {
    throw new Error('Arquivo substituído ou link não permitido.');
  }
}
function readRegularFile(file, maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error('Limite de leitura inválido.');
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0);
  const descriptor = fs.openSync(file, flags);
  try {
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || opened.size > BigInt(maxBytes)) throw new Error('Arquivo acima do limite ou não regular.');
    assertPathIdentity(file, opened);
    // Um byte extra detecta crescimento sem permitir leitura/alocação ilimitada.
    const bytes = Buffer.alloc(Number(opened.size) + 1);
    let total = 0, read;
    do {
      read = fs.readSync(descriptor, bytes, total, bytes.length - total, total);
      total += read;
    } while (read && total < bytes.length);
    const final = fs.fstatSync(descriptor, { bigint: true });
    if (BigInt(total) !== opened.size || final.size !== opened.size
      || final.mtimeNs !== opened.mtimeNs || final.ctimeNs !== opened.ctimeNs) {
      throw new Error('Arquivo alterado durante a leitura.');
    }
    assertPathIdentity(file, opened);
    return bytes.subarray(0, total);
  } finally { fs.closeSync(descriptor); }
}

export { readRegularFile };
