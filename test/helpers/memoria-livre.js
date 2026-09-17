/* Memória livre fixa para os testes que precisam de uma vaga de admissão.

   A admissão (`lib/engine/admissao.js`) recusa abaixo do piso de memória, e mede pelo MENOR
   entre `process.availableMemory()` (o limite do processo) e `os.freemem()` (a máquina). Um
   teste que finge só uma das duas continua à mercê da memória real: medido em 16/09/2026,
   com a máquina em 1031 MB livres, seis testes de quatro arquivos reprovavam por isso, e
   passavam sozinhos. Quem quer provar o comportamento SEM memória fixa as duas na mão, como
   `test/admissao-local.test.js` faz; quem só precisa da vaga usa isto. */
import os from 'node:os';

const freememReal = os.freemem;
const disponivelReal = process.availableMemory;
const MB = 1024 * 1024;

/** Finge `mb` de memória livre nas DUAS fontes, senão a menor delas ainda manda. */
function fixarMemoriaLivre(mb = 8192) {
  os.freemem = () => mb * MB;
  process.availableMemory = () => mb * MB;
}

function restaurarMemoriaLivre() {
  os.freemem = freememReal;
  if (disponivelReal) process.availableMemory = disponivelReal;
  else delete process.availableMemory;
}

export { fixarMemoriaLivre, restaurarMemoriaLivre };
