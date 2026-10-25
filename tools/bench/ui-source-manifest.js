// Hash e tamanho derivam dos mesmos bytes limitados, sem abrir Electron.
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readRegularFile } from '../../lib/bounded-file.js';

const UI_SOURCE_MAX_BYTES = 32 * 1024 ** 2;
function sourceManifest(root, files) {
  return [...files].sort().map(file => {
    const content = readRegularFile(file, UI_SOURCE_MAX_BYTES);
    return { file: path.relative(root, file).replaceAll('\\', '/'), bytes: content.length,
      sha256: createHash('sha256').update(content).digest('hex') };
  });
}

export { sourceManifest, UI_SOURCE_MAX_BYTES };
