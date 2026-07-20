// Empacota os PNGs gerados pelo make-icons.ps1 em um .ico multi-tamanho.
// PNGs embutidos em ICO sao suportados do Vista em diante.
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const sizes = [256, 64, 48, 32, 24, 16];
const pngs = sizes.map(s => ({ size: s, data: fs.readFileSync(path.join(root, 'assets', 'png', `farol-${s}.png`)) }));

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);            // reservado
header.writeUInt16LE(1, 2);            // tipo: icone
header.writeUInt16LE(pngs.length, 4);  // quantidade

let offset = 6 + pngs.length * 16;
const entries = [];
for (const { size, data } of pngs) {
  const e = Buffer.alloc(16);
  e.writeUInt8(size >= 256 ? 0 : size, 0);  // largura (0 = 256)
  e.writeUInt8(size >= 256 ? 0 : size, 1);  // altura
  e.writeUInt8(0, 2);                       // paleta
  e.writeUInt8(0, 3);                       // reservado
  e.writeUInt16LE(1, 4);                    // planes
  e.writeUInt16LE(32, 6);                   // bpp
  e.writeUInt32LE(data.length, 8);          // tamanho
  e.writeUInt32LE(offset, 12);              // offset
  entries.push(e);
  offset += data.length;
}

const ico = Buffer.concat([header, ...entries, ...pngs.map(p => p.data)]);
fs.writeFileSync(path.join(root, 'assets', 'farol.ico'), ico);
console.log(`assets/farol.ico gerado (${ico.length} bytes, ${pngs.length} tamanhos)`);
