// Pareamento da API local (A4, spec 7.A4 itens 3 e 4). Imprime um código novo SÓ na saída
// do terminal, ou revoga todas as sessões e códigos com --revogar-todas. Roda no próprio
// aparelho, com o mesmo FAROL_HOME do engine (lib/paths.js resolve). O código nunca vai
// para log, arquivo em claro nem linha de comando de outro processo, e o comando não
// aceita segredo por argumento.
import { executadoDireto } from '../lib/paths.js';
import { TEMPOS } from '../lib/constants.js';
import { criarCodigo, revogarCodigos } from '../lib/local-auth/pareamento.js';
import { revogarTodas } from '../lib/local-auth/sessoes.js';

const MINUTO_MS = TEMPOS.HORA_MS / 60;
const USO = 'Uso: node tools/farol-parear.js [--revogar-todas]\n';

function executar(args, saida, erro) {
  if (args.length === 1 && args[0] === '--revogar-todas') {
    revogarTodas();
    revogarCodigos();
    saida.write('Todas as sessões autorizadas e códigos de pareamento foram revogados.\n');
    return 0;
  }
  if (args.length) {
    erro.write(USO);
    return 2;
  }
  const codigo = criarCodigo();
  const minutos = Math.round(TEMPOS.PAREAMENTO_VALIDADE_MS / MINUTO_MS);
  saida.write(`Código de pareamento: ${codigo}\nVale por ${minutos} minutos e funciona uma vez só.\n`);
  return 0;
}

if (executadoDireto(import.meta.url)) process.exitCode = executar(process.argv.slice(2), process.stdout, process.stderr);

export default { executar };
export { executar };
