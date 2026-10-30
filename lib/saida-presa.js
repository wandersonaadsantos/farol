// O processo da sessão saiu, mas a saída dele continua aberta (30/10/2026).
//
// O 'close' do Node só chega quando o processo sai E todos os pipes fecham. Um neto que
// herdou o pipe e não morre (medido: o query.js aberto pelo Farol.exe sem
// ELECTRON_RUN_AS_NODE vira app Electron e não encerra) segura o 'close' para sempre. A
// sessão nunca terminava, a label `<conta>:revisando` ficava no PR e a atualização recusava
// por "análise em andamento" (biblioteca-cnbb-api#144: 75 minutos, cancelada e viva). O
// cancelamento não resolvia, porque matar a árvore não alcança o neto que já perdeu o pai.
//
// Depois do 'exit', espera um pouco pelo 'close' e, se ele não vier, fecha os pipes do
// lado do Farol: o 'close' sai e o desfecho normal da sessão roda. O que o processo
// escreveu antes de sair já foi entregue; o neto só segura o pipe aberto.
import { TEMPOS } from './constants.js';

function fecharSaidaPresa(child, esperaMs = TEMPOS.SAIDA_SEM_FECHAMENTO_MS) {
  let timer = null;
  child.once('exit', () => {
    timer = setTimeout(() => {
      for (const pipe of [child.stdout, child.stderr, child.stdin]) {
        try { pipe?.destroy(); } catch { /* pipe já fechado */ }
      }
    }, esperaMs);
    if (typeof timer.unref === 'function') timer.unref();
  });
  child.once('close', () => clearTimeout(timer));
}

export { fecharSaidaPresa };
