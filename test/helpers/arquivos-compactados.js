// Zip e tar.gz montados em Node puro, para os testes de release não dependerem de `zip` e
// `tar` na máquina (o Git for Windows do CI não traz `zip`). Só o necessário para fixture:
// zip sem compressão (método 0) e tar ustar com arquivos regulares, nomes até 100 bytes.
import zlib from 'node:zlib';

// entradas: [{ nome, conteudo }] com nome em '/', conteudo string ou Buffer
export function zipDe(entradas) {
  const locais = [];
  const centrais = [];
  let deslocamento = 0;
  for (const { nome, conteudo } of entradas) {
    const dados = Buffer.from(conteudo);
    const bNome = Buffer.from(nome, 'utf8');
    const crc = zlib.crc32(dados);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(dados.length, 18);
    local.writeUInt32LE(dados.length, 22);
    local.writeUInt16LE(bNome.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(dados.length, 20);
    central.writeUInt32LE(dados.length, 24);
    central.writeUInt16LE(bNome.length, 28);
    central.writeUInt32LE(deslocamento, 42);
    locais.push(local, bNome, dados);
    centrais.push(central, bNome);
    deslocamento += local.length + bNome.length + dados.length;
  }
  const cd = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(entradas.length, 8);
  fim.writeUInt16LE(entradas.length, 10);
  fim.writeUInt32LE(cd.length, 12);
  fim.writeUInt32LE(deslocamento, 16);
  return Buffer.concat([...locais, cd, fim]);
}

function octal(valor, largura) {
  return valor.toString(8).padStart(largura - 1, '0') + '\0';
}

// entradas: [{ nome, conteudo, modo }], modo padrão 0o644
export function tarGzDe(entradas) {
  const blocos = [];
  for (const { nome, conteudo, modo = 0o644 } of entradas) {
    const dados = Buffer.from(conteudo);
    const cab = Buffer.alloc(512);
    cab.write(nome, 0, 100, 'utf8');
    cab.write(octal(modo, 8), 100, 'ascii');
    cab.write(octal(0, 8), 108, 'ascii');
    cab.write(octal(0, 8), 116, 'ascii');
    cab.write(octal(dados.length, 12), 124, 'ascii');
    cab.write(octal(0, 12), 136, 'ascii');
    cab.write('        ', 148, 'ascii');
    cab.write('0', 156, 'ascii');
    cab.write('ustar\0', 257, 'ascii');
    cab.write('00', 263, 'ascii');
    let soma = 0;
    for (const b of cab) soma += b;
    cab.write(soma.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
    const resto = (512 - (dados.length % 512)) % 512;
    blocos.push(cab, dados, Buffer.alloc(resto));
  }
  blocos.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(blocos));
}
