// Sobe o engine num FAROL_HOME de SANDBOX, pra inspecionar a interface sem tocar no
// estado real (~/.farol) e sem risco de revisar ou postar em PR nenhum.
//
// Existe porque validar a tela exige o engine servindo o snapshot, e apontar o
// sandbox por variavel de ambiente na linha de comando nao sobrevive ao formato do
// .claude/launch.json. O caminho vem de FAROL_UI_SANDBOX quando definido; senao cai
// num diretorio previsivel dentro do temp do SO.
//
// Ele NUNCA deve virar caminho de producao: autoReview e autoUpdate ficam desligados
// pelo config do sandbox, e o processo serve so pra olhar a interface.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const HOME = process.env.FAROL_UI_SANDBOX || path.join(os.tmpdir(), 'farol-ui-sandbox');
fs.mkdirSync(path.join(HOME, 'workspace', 'state'), { recursive: true });
const cfg = path.join(HOME, 'config.json');
if (!fs.existsSync(cfg)) {
  fs.writeFileSync(cfg, JSON.stringify({ port: 47192, autoReview: false, autoUpdate: false }, null, 2), 'utf8');
}
process.env.FAROL_HOME = HOME;
console.log(`[sandbox] FAROL_HOME=${HOME}`);
// o server.js so sobe sozinho quando EXECUTADO direto (guarda executadoDireto); aqui
// ele e importado, entao o start e explicito
const { start } = await import('../server.js');
start((url, err) => {
  if (err) { console.error('[sandbox] erro ao subir:', err.message); process.exit(1); }
  console.log(`[sandbox] UI em ${url}`);
});
