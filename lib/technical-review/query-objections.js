// Consulta de leitura da sessão: usa a identidade gh já isolada pelo Farol, nunca posta.
import { readReviewSnapshot } from './reviews.js';
import { safeStringify } from '../io.js';
import { executadoDireto } from '../paths.js';

async function main(args = process.argv.slice(2)) {
  const [repo, numero] = args;
  const number = Number(numero);
  if (args.length !== 2 || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo || '') || !Number.isSafeInteger(number) || number < 1) {
    throw new Error('Use: node lib/technical-review/query-objections.js owner/repo numero-do-pr');
  }
  const snapshot = await readReviewSnapshot({ repo, number });
  return { ...snapshot, objecoesLidas: snapshot.leituras };
}

if (executadoDireto(import.meta.url)) {
  main().then(result => console.log(safeStringify(result))).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

export { main };
