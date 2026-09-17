// Prepara as pastas de dados da bancada de aparelhos REAIS: três instâncias do Farol
// (admin, origem e destino), cada uma com estado, identidade e porta próprios, apontadas
// para os emuladores oficiais do Firebase.
//
// uso: node bancada-real.mjs <scratchpad> [--limpar]
import fs from 'node:fs';
import path from 'node:path';

const base = process.argv[2];
const limpar = process.argv.includes('--limpar');

// o emulador carrega as regras no espaço <projeto>-default-rtdb; o cliente do Farol usa
// ns=projectId, então o projeto configurado aqui é o espaço em que as regras valem
const PROJETO = 'demo-farol-default-rtdb';
const BANCO = 'http://127.0.0.1:9000';

const APARELHOS = [
  { pasta: 'real-a', porta: 47301, nome: 'Notebook do escritorio', autoReview: false },
  { pasta: 'real-c', porta: 47302, nome: 'Desktop da sala', autoReview: true },
  { pasta: 'real-d', porta: 47303, nome: 'Notebook de viagem', autoReview: true },
];

for (const a of APARELHOS) {
  const dir = path.join(base, a.pasta);
  if (limpar) fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    port: a.porta,
    intervalSeconds: 60,
    autoReview: a.autoReview,
    parallelReviews: 1,
    ghUser: 'alice',
    accounts: [{ user: 'alice', owners: ['acme-exemplo'] }],
    sync: {
      enabled: true,
      coordination: { enabled: true },
      consolidation: { enabled: true },
      shared: { enabled: true },
      distribution: { enabled: true },
      aceitarAdmin: true,
      deviceName: a.nome,
      apiKey: 'chave-do-emulador',
      databaseUrl: BANCO,
      projectId: PROJETO,
    },
  }, null, 2));
  console.log(`${a.pasta} porta ${a.porta} ${a.nome}`);
}
