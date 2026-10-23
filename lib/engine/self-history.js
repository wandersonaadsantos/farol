import { writeJsonAtomic } from '../io.js';
import { SELF_FILE } from '../paths.js';

export function saveSelfAnalyses(engine) {
  try { writeJsonAtomic(SELF_FILE, engine.selfAnalyses); }
  catch (err) { engine.log('ERROR', `salvar self-analyses.json: ${err.message}`); }
}

// O relatório atual continua sendo a única entrada dos gates. Tentativas anteriores
// ficam no mesmo registro persistido, sem encadear cópias recursivas do histórico.
export function preservarAnaliseAnterior(anterior, atual) {
  if (!anterior) return atual;
  const { history = [], ...relatorio } = anterior;
  return { ...atual, history: [...history, relatorio] };
}

// A tela recebe somente o relatório atual; histórico completo permanece no disco.
export function analiseAtual(analise) {
  const atual = { ...analise };
  delete atual.history;
  return atual;
}
