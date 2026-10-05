// Uma linha no farol.log, com a rotação por tamanho (05/10/2026, saiu do server.js).
//
// O tamanho vem do fstat no descritor JÁ ABERTO, e o esvaziamento é ftruncate nele. O jeito
// anterior media pelo caminho e depois renomeava e anexava pelo caminho, que é checar uma
// coisa e usar outra (alerta de CodeQL js/file-system-race): o arquivo podia ter sido trocado
// no meio. Um desligamento entre gravar o .1 e esvaziar deixa as mesmas linhas nos dois
// arquivos, nunca perde nenhuma.
//
// Somente escrita, de propósito. Medido no Windows (05/10/2026, 1000 linhas): abrir com
// leitura custa ~10 ms por linha (o antivírus varre o arquivo a cada abertura que pode ler),
// contra ~0,3 ms só com escrita. Anexar não serve porque esse descritor não pode truncar
// (EPERM). A linha vai na posição do fim lida no fstat: o farol.log tem um escritor só, o
// engine (instância única por FAROL_HOME). Só a rotação, rara, lê o conteúdo.
import fs from 'node:fs';

const ESCREVER_CRIANDO = fs.constants.O_WRONLY | fs.constants.O_CREAT;

function gravarLinhaDeLog(arquivo, linha, tetoBytes) {
  const fd = fs.openSync(arquivo, ESCREVER_CRIANDO);
  try {
    let fim = fs.fstatSync(fd).size;
    if (fim > tetoBytes) {
      fs.writeFileSync(arquivo + '.1', fs.readFileSync(arquivo));
      fs.ftruncateSync(fd, 0);
      fim = 0;
    }
    const bytes = Buffer.from(linha);
    fs.writeSync(fd, bytes, 0, bytes.length, fim);
  } finally {
    fs.closeSync(fd);
  }
}

export { gravarLinhaDeLog };
export default { gravarLinhaDeLog };
