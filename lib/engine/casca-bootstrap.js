// Bootstrap de versão do motor sidecar (28/10/2026, desenho 4.5 do Farol nativo): decide, antes
// de construir o engine ou tocar estado, se este processo vira o motor ou cede a vez a uma
// versão instalada. A casca nativa sempre executa o motor SEMEADO no próprio bundle (somente
// leitura, assinado); o semeado pergunta a casca-motores.js qual versão vale e, se for outra,
// se reexecuta a partir dela. O filho leva FAROL_BOOTSTRAP_FEITO=1 e não escolhe de novo. Node
// não tem execve: o pai fica vivo só para repassar sinal e devolver o código de saída do
// filho, e o filho o vigia (casca-vigia-do-pai.js).
import path from 'node:path';
import { spawn } from 'node:child_process';
import { escolherMotor, podarMotores } from './casca-motores.js';
import { vigiarPai, sairComoNoSigterm } from './casca-vigia-do-pai.js';
import { gravarLinhaDeLog } from '../log-arquivo.js';
import { logStamp, semControle } from '../format.js';
import { TEMPOS } from '../constants.js';
import { vigiarStdin } from './casca-stdin.js';
import {
  APP_ROOT, APP_VERSION, ENGINE_DIR, LOG_FILE, modoCasca, versaoDaCasca, bootstrapFeito, ambienteDoBootstrap, pidDoPai,
} from '../paths.js';

// Sobe o server.js da raiz escolhida com o mesmo Node, os mesmos argumentos e o ambiente
// atual marcado, e encerra este processo com o código do filho (morte por sinal vira 1).
function reexecutar(raiz) {
  const filho = spawn(process.execPath, [path.join(raiz, 'server.js'), ...process.argv.slice(2)], {
    stdio: 'inherit', env: ambienteDoBootstrap(),
  });
  const repassar = (sinal) => { try { filho.kill(sinal); } catch { /* filho já saiu */ } };
  for (const sinal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sinal, () => repassar(sinal));
  // O pai e o filho herdam o mesmo pipe da casca, e os dois veem o EOF quando ela morre; o
  // pai repassa como SIGTERM e sai com o código do filho, como no sinal de verdade.
  if (modoCasca()) vigiarStdin({ aoFechar: () => repassar('SIGTERM') });
  filho.on('error', (err) => { console.error(`[farol] não consegui subir o motor de ${raiz}: ${err.message}`); process.exit(1); });
  filho.on('exit', (codigo) => process.exit(typeof codigo === 'number' ? codigo : 1));
}

// O WARN vai ao farol.log, que é a fonte do Diagnóstico. Na primeira subida o STATE_DIR pode
// não existir ainda: aí a linha cai no stderr, para não se perder.
function avisarNoLog(texto) {
  try {
    gravarLinhaDeLog(LOG_FILE, `[${logStamp()}] [WARN] ${semControle(texto)}\n`, TEMPOS.LOG_ROTACAO_BYTES);
  } catch {
    console.error(`[farol] WARN ${texto}`);
  }
}

// O motor que vai escutar sai pelo caminho do SIGTERM quando o stdin da casca chega ao fim.
function vigiarFimDoStdin() {
  vigiarStdin({ aoFechar: sairComoNoSigterm });
}

// A chamada do server.js. Devolve true quando reexecutou (quem chama NÃO sobe o engine). No
// filho já reexecutado, liga a vigia do pai. Todo motor que fica (devolve false em modo
// casca) liga a vigia do fim do stdin; quem reexecuta a liga no `reexecutar`.
function bootstrapDaCasca({
  env, semeada = APP_VERSION, raizSemeada = APP_ROOT, pastaEngine = ENGINE_DIR, reexec = reexecutar,
  avisar = avisarNoLog, vigiar = vigiarPai, vigiarFim = vigiarFimDoStdin,
} = {}) {
  if (!modoCasca(env)) return false;
  if (bootstrapFeito(env)) {
    const pid = pidDoPai(env);
    if (pid) vigiar({ pid, aoMorrer: sairComoNoSigterm });
    vigiarFim();
    return false;
  }
  const r = escolherMotor({ semeada, raizSemeada, pastaEngine, versaoCasca: versaoDaCasca(env) });
  for (const i of r.ignoradas) {
    if (i.motivo === 'manifesto-invalido') avisar(`motor instalado ignorado, manifesto inválido: ${i.pasta}`);
  }
  if (r.raiz === raizSemeada) {
    vigiarFim();
    return false;
  }
  podarMotores({ pastaEngine, manter: [r.versao, semeada] });
  reexec(r.raiz);
  return true;
}

export default { reexecutar, bootstrapDaCasca };
export { reexecutar, bootstrapDaCasca };
