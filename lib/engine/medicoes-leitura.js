// O arquivo próprio das medições de leitura (detector de credencial e cobertura em sombra).
//
// Não vão para o farol.log de propósito. A triagem lê as últimas 300 linhas dele, e toda linha
// que ela não reconhece vira "Falha não classificada": medido em 04/11/2026, dez sessões
// divergentes bastavam para um ERROR real sair da janela e a tela Ferramentas e o diagnóstico
// mudarem. Medição não pode mexer no que o dono vê. Nenhuma rota, tela ou diagnóstico lê este
// arquivo: uma linha JSON por evento, só caminho e contagens, nunca conteúdo.
import path from 'node:path';
import { ensureDir, safeStringify } from '../io.js';
import { gravarLinhaDeLog } from '../log-arquivo.js';
import { STATE_DIR } from '../paths.js';

const ARQUIVO_DE_MEDICOES = path.join(STATE_DIR, 'medicoes-leitura.jsonl');
// Acima disto o arquivo vira `.1` e recomeça: no máximo duas vezes este tamanho em disco.
const TETO_EM_BYTES = 2 * 1024 * 1024;

// Melhor esforço: disco cheio ou arquivo preso perdem a medição, nunca a sessão.
function registrarMedicao(tipo, dados) {
  try {
    ensureDir(STATE_DIR);
    gravarLinhaDeLog(ARQUIVO_DE_MEDICOES, `${safeStringify({ em: new Date().toISOString(), tipo, ...dados })}\n`, TETO_EM_BYTES);
  } catch { /* só observa */ }
}

export { registrarMedicao, ARQUIVO_DE_MEDICOES, TETO_EM_BYTES };
