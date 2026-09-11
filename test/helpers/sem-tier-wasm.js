// Desliga a subida de tier do WebAssembly no processo de teste. Sem efeito colateral
// no import: o `node --test` executa test/**/*.js, e quem liga é o dublê ao subir.
//
// Por quê: o parser HTTP do fetch (llhttp, do undici) é WebAssembly. Depois de alguns
// fetch o V8 decide otimizá-lo e compila a versão otimizada numa thread de fundo; se
// o processo sai (process.exit, que o --test-force-exit chama no fim de cada arquivo)
// com essa compilação em andamento, a tarefa termina e avisa a thread principal por
// um handle que a saída já está fechando, e no Windows o node aborta na asserção
// `!(handle->flags & UV_HANDLE_CLOSING)` de src/win/async.c. Medido em 11/09/2026,
// Node 24.15: cinco fetch seguidos de process.exit abortam 15 de 15 vezes SEM nenhum
// socket sendo fechado (o servidor nem é encerrado), então não é o keep-alive; com
// o tiering dinâmico e a subida de tier desligados, 0 de 15. Uma pausa depois do
// close só escondia a corrida: dava tempo à compilação de terminar, na maioria das
// vezes.
//
// As duas flags, e não uma: `--no-wasm-dynamic-tiering` sozinho troca a subida por
// orçamento (a que acontece perto da saída) pela subida imediata de cada função no
// primeiro uso, que ainda é compilação de fundo; `--no-wasm-tier-up` desliga essa.
// Tem que valer ANTES do primeiro fetch de rede do processo: o llhttp é compilado uma
// vez só e guarda o modo de tiering daquele instante. Os dublês sobem antes de
// qualquer fetch de rede em todos os testes, e é por isso que moram aqui.
import v8 from 'node:v8';

let desligado = false;

function desligarSubidaDeTierDoWasm() {
  if (desligado) return;
  desligado = true;
  v8.setFlagsFromString('--no-wasm-dynamic-tiering');
  v8.setFlagsFromString('--no-wasm-tier-up');
}

export default { desligarSubidaDeTierDoWasm };
export { desligarSubidaDeTierDoWasm };
