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
fs.mkdirSync(path.join(HOME, 'workspace', 'state'), { recursive: true, mode: 0o700 });

// Criacao EXCLUSIVA com permissao restrita, e sem `existsSync` antes: o caminho e
// previsivel dentro do temp compartilhado do SO, entao checar-e-depois-escrever abre
// janela pra outro processo trocar o alvo entre as duas chamadas, e a escrita sem
// `wx` seguiria um symlink plantado ali. `EEXIST` e o caso NORMAL (ja existe config
// da rodada anterior) e por isso e o unico erro engolido. Alertas
// js/insecure-temporary-file e js/file-system-race do CodeQL, PR #45; mesmo remedio
// do materializeScope em lib/engine/pr-scope.js.
const cfg = path.join(HOME, 'config.json');
try {
  fs.writeFileSync(cfg, JSON.stringify({ port: 47192, autoReview: false, autoUpdate: false }, null, 2),
    { encoding: 'utf8', mode: 0o600, flag: 'wx' });
} catch (err) {
  if (err.code !== 'EEXIST') throw err;
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
