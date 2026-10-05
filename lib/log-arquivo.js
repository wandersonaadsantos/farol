// Uma linha no farol.log, com a rotação por tamanho (05/10/2026, saiu do server.js).
//
// O tamanho é lido do arquivo JÁ ABERTO (fstat no descritor), e não do caminho antes de
// abrir: "existe? qual o tamanho? então anexa" pelo caminho é checar uma coisa e usar outra,
// e o arquivo pode ter sido trocado no meio (alerta de CodeQL js/file-system-race). Aberto
// o descritor, quem mede é quem escreve. A rotação ainda troca o nome pelo caminho, porque
// rename é por caminho; depois dela o descritor novo é aberto de novo, e a linha vai nele.
import fs from 'node:fs';

function gravarLinhaDeLog(arquivo, linha, tetoBytes) {
  let fd = fs.openSync(arquivo, 'a');
  try {
    if (fs.fstatSync(fd).size > tetoBytes) {
      fs.closeSync(fd);
      fd = null;
      fs.renameSync(arquivo, arquivo + '.1');
      fd = fs.openSync(arquivo, 'a');
    }
    fs.writeSync(fd, linha);
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

export { gravarLinhaDeLog };
export default { gravarLinhaDeLog };
