import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readRegularFile } from '../lib/bounded-file.js';
import { sourceManifest } from '../tools/bench/ui-source-manifest.js';
import { createHash } from 'node:crypto';
import { IS_WIN } from '../lib/paths.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-bounded-file-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));
let sequence = 0;
function fixture(content = '1234') {
  const file = path.join(root, 'case-' + sequence++);
  fs.writeFileSync(file, content);
  return file;
}
function onOpen(file, action, run) {
  const original = fs.openSync;
  let descriptor;
  fs.openSync = function (current, ...args) {
    const fd = original.call(this, current, ...args);
    if (current === file) { descriptor = fd; action(fd); }
    return fd;
  };
  try { run(); }
  finally { fs.openSync = original; }
  assert.throws(() => fs.fstatSync(descriptor), { code: 'EBADF' }, 'descritor fechado também na recusa');
}

test('leitura regular respeita limite exato; tamanho acima do teto não é lido', () => {
  const file = fixture();
  assert.equal(readRegularFile(file, 4).toString(), '1234');
  const original = fs.readSync;
  let reads = 0;
  fs.readSync = (...args) => { reads++; return original(...args); };
  try { assert.throws(() => readRegularFile(file, 3), /limite/); }
  finally { fs.readSync = original; }
  assert.equal(reads, 0);
});

test('troca do caminho depois de abrir é recusada antes de ler e preserva ambos os arquivos', () => {
  const file = fixture(), old = file + '.previous';
  onOpen(file, () => { fs.renameSync(file, old); fs.writeFileSync(file, 'novo'); },
    () => assert.throws(() => readRegularFile(file, 4), /substituído/));
  assert.equal(fs.readFileSync(old, 'utf8'), '1234');
  assert.equal(fs.readFileSync(file, 'utf8'), 'novo');
});

test('crescimento entre fstat e read é limitado a tamanho inicial mais um byte e recusado', () => {
  const file = fixture();
  const original = fs.readSync;
  let changed = false, readBytes = 0;
  fs.readSync = (...args) => {
    if (!changed) { changed = true; fs.appendFileSync(file, 'x'.repeat(4096)); }
    const count = original(...args); readBytes += count; return count;
  };
  try { assert.throws(() => readRegularFile(file, 4), /alterado/); }
  finally { fs.readSync = original; }
  assert.equal(readBytes, 5);
  assert.equal(fs.statSync(file).size, 4100, 'a investigação não elimina o arquivo alterado');
});

test('alteração de mesmo tamanho durante leitura não produz conteúdo aceito', () => {
  const file = fixture();
  const original = fs.readSync;
  let changed = false;
  fs.readSync = (...args) => {
    const count = original(...args);
    if (!changed) {
      changed = true; fs.writeFileSync(file, 'ABCD');
      const later = new Date(Date.now() + 2000); fs.utimesSync(file, later, later);
    }
    return count;
  };
  try { assert.throws(() => readRegularFile(file, 4), /alterado/); }
  finally { fs.readSync = original; }
  assert.equal(fs.readFileSync(file, 'utf8'), 'ABCD');
});

test('link real é recusado e seu destino permanece intacto', () => {
  const outside = path.join(root, 'outside'), link = path.join(root, 'linked');
  fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'preservar'), 'intacto');
  // Junction não exige privilégio de link de arquivo no Windows; POSIX cobre o arquivo.
  fs.symlinkSync(IS_WIN ? outside : path.join(outside, 'preservar'), link, IS_WIN ? 'junction' : 'file');
  assert.throws(() => readRegularFile(link, 100));
  assert.equal(fs.readFileSync(path.join(outside, 'preservar'), 'utf8'), 'intacto');
});

test('manifesto de benchmark mede e calcula hash do mesmo conteúdo aberto', () => {
  const file = fixture('evidência');
  const content = fs.readFileSync(file);
  assert.deepEqual(sourceManifest(root, [file]), [{ file: path.basename(file), bytes: content.length,
    sha256: createHash('sha256').update(content).digest('hex') }]);
  onOpen(file, () => { fs.renameSync(file, file + '.previous'); fs.writeFileSync(file, 'substituto'); },
    () => assert.throws(() => sourceManifest(root, [file]), /substituído/));
});
