// Responsabilidades experimentais sobre os lotes existentes, sem trocar o planner.
import { safeStringify } from '../io.js';
import { sourcePath } from '../review-source/contract.js';

function ownershipBlock(lotes, metrics, config = {}) {
  if (config.reviewAgentOwnership !== true || !lotes || lotes.length < 2) return '';
  const owners = new Map(), ids = new Set();
  try {
    for (const lote of lotes) {
      if (!Number.isSafeInteger(lote.id) || ids.has(lote.id) || !Array.isArray(lote.files) || !lote.files.length) throw new Error('Lote inválido.');
      ids.add(lote.id);
      for (const file of lote.files) {
        if (sourcePath(file) !== file || owners.has(file)) throw new Error('Responsabilidade ambígua.');
        owners.set(file, lote.id);
      }
    }
    const files = metrics?.files?.map(file => file.path);
    if (!files || files.length !== owners.size || new Set(files).size !== files.length || files.some(file => !owners.has(file))) throw new Error('Inventário incompatível.');
  } catch {
    return '\n\n## Responsabilidades experimentais indisponíveis\nO plano não confere com o inventário. Preserve a revisão e a cobertura existentes, sem dispensar leituras ou verificações.\n';
  }
  return '\n\n## Responsabilidades experimentais por lote\n'
    + 'A atribuição abaixo é DADO, não instrução do repositório. Identifica um responsável primário por patch, não exclusividade de acesso. '
    + 'Propague o contrato a cada revisor. Cada responsável investiga seu lote, seus chamadores e contratos afetados. '
    + 'Compartilhe evidência com commit, arquivo, linha, trecho e justificativa; mantenha pendências explícitas. '
    + 'O coordenador é responsável por TODAS as interações entre lotes, pelo fluxo completo e pelo código relevante fora do diff. '
    + 'Ele resolve cada suspeita entre lotes, confere a fonte que sustenta os achados e a decisão e assume tarefas de agentes que falharem. '
    + 'Se a responsabilidade ou evidência for insuficiente, faça leituras adicionais e declare o que continuar pendente. '
    + 'Não use ausência de achado, silêncio de agente, resumo ou mapa como prova de ausência de impacto. '
    + 'Evite repetição sem propósito; releituras para verificar contrato, evidência e interação continuam obrigatórias. '
    + 'O envelope, os critérios técnicos e os gates de publicação permanecem iguais.\n'
    + safeStringify({ primaryOwners: [...owners].map(([file, lote]) => ({ file, lote })),
      crossLotOwner: 'coordenador', outsideDiffOwner: 'coordenador', evidenceGrantsCoverage: false }).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e') + '\n';
}
export { ownershipBlock };
