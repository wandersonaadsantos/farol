// Uma linha no farol.log, com a rotação por tamanho (05/10/2026, saiu do server.js).
//
// Tudo passa pelo arquivo JÁ ABERTO: o tamanho vem do fstat no descritor, a cópia para o
// .1 lê o descritor e o esvaziamento é ftruncate nele. O jeito anterior media pelo caminho
// e depois renomeava e anexava pelo caminho, que é checar uma coisa e usar outra (alerta de
// CodeQL js/file-system-race): o arquivo podia ter sido trocado no meio. Um desligamento
// entre gravar o .1 e esvaziar deixa as mesmas linhas nos dois arquivos, nunca perde nenhuma.
//
// Leitura e escrita, e não modo de anexar: no Windows o descritor de anexar não tem
// permissão de truncar (EPERM medido). A linha vai na posição do fim lida no fstat; o
// farol.log tem um escritor só, o engine (instância única por FAROL_HOME).
import fs from 'node:fs';

const LER_E_ESCREVER_CRIANDO = fs.constants.O_RDWR | fs.constants.O_CREAT;

function gravarLinhaDeLog(arquivo, linha, tetoBytes) {
  const fd = fs.openSync(arquivo, LER_E_ESCREVER_CRIANDO);
  try {
    let fim = fs.fstatSync(fd).size;
    if (fim > tetoBytes) {
      const conteudo = Buffer.alloc(fim);
      fs.readSync(fd, conteudo, 0, fim, 0);
      fs.writeFileSync(arquivo + '.1', conteudo);
      fs.ftruncateSync(fd, 0);
      fim = 0;
    }
    fs.writeSync(fd, Buffer.from(linha), 0, Buffer.byteLength(linha), fim);
  } finally {
    fs.closeSync(fd);
  }
}

export { gravarLinhaDeLog };
export default { gravarLinhaDeLog };
