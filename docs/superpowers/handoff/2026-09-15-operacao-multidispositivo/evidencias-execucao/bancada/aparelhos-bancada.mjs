// Cria (ou recria) as pastas de dois aparelhos da bancada, com a sincronização apontada para
// o dublê local. Nada aqui toca ~/.farol.
// uso: node aparelhos-bancada.mjs <scratchpad>
import fs from 'node:fs';
import path from 'node:path';

const base = process.argv[2];
const APARELHOS = [
  { pasta: 'bancada-a', porta: 47201, nome: 'Desktop da bancada' },
  { pasta: 'bancada-b', porta: 47202, nome: 'Notebook da bancada' },
];

for (const a of APARELHOS) {
  const dir = path.join(base, a.pasta);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const config = {
    port: a.porta,
    autoReview: false,
    ghUser: '',
    owners: [],
    accounts: [],
    sync: {
      enabled: true,
      coordination: { enabled: true },
      consolidation: { enabled: true },
      shared: { enabled: true },
      distribution: { enabled: true },
      aceitarAdmin: true,
      deviceName: a.nome,
      apiKey: 'chave-da-bancada',
      databaseUrl: 'http://127.0.0.1:47290',
      projectId: 'farol-bancada',
    },
  };
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config, null, 2));
  console.log(dir, a.porta);
}
