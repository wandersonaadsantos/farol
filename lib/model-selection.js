// Mantém o par de modelos coerente na configuração, sem IO nem efeito de sessão.
import { modeloEquivalente, modelosCompativeis } from './modelos.js';
import { sanitizeClaudeModel, sanitizeCodexModel } from './parse.js';

const CAMPOS = Object.freeze({ claude: 'reviewModel', codex: 'codexReviewModel' });
const SANEADORES = Object.freeze({ claude: sanitizeClaudeModel, codex: sanitizeCodexModel });

function provedorPadrao(config) {
  const perfis = Array.isArray(config.claudeProfiles) ? config.claudeProfiles : [];
  return perfis.find((p) => p.id === config.claudeProfileId)?.kind === 'codex' ? 'codex' : 'claude';
}

// Patch com os dois campos: vence o provedor padrão, independentemente da ordem JSON.
// No boot, a seleção não vazia do provedor padrão vence conflitos legados. Sem seleção
// nele, a do outro provedor migra o par. IDs personalizados sem par ficam preservados.
function sincronizarModelos(config, patch = null) {
  let preferido = provedorPadrao(config);
  if (!patch && Object.hasOwn(CAMPOS, config.modelSelectionProvider)) preferido = config.modelSelectionProvider;
  const parExplicito = !patch || Object.keys(CAMPOS).every(p => Object.hasOwn(patch, CAMPOS[p]) && SANEADORES[p](patch[CAMPOS[p]]) !== null);
  if (parExplicito && config.reviewModel && config.codexReviewModel && modelosCompativeis(config.reviewModel, config.codexReviewModel)) {
    const viaClaude = modeloEquivalente(config.reviewModel, 'codex') === config.codexReviewModel;
    const viaCodex = modeloEquivalente(config.codexReviewModel, 'claude') === config.reviewModel;
    if (viaClaude !== viaCodex) preferido = viaClaude ? 'claude' : 'codex';
    config.modelSelectionProvider = preferido;
    return { origem: preferido, semEquivalente: false };
  }
  const outro = preferido === 'claude' ? 'codex' : 'claude';
  const candidatos = [preferido, outro];
  const origem = candidatos.find((p) => {
    const campo = CAMPOS[p];
    if (patch) return Object.hasOwn(patch, campo) && SANEADORES[p](patch[campo]) !== null;
    return !!config[campo];
  });
  if (!origem) return null;
  const destino = origem === 'claude' ? 'codex' : 'claude';
  config.modelSelectionProvider = origem;
  const modelo = config[CAMPOS[origem]];
  const equivalente = modeloEquivalente(modelo, destino);
  if (equivalente === null) return { origem, modelo, semEquivalente: true };
  config[CAMPOS[destino]] = equivalente;
  return { origem, modelo, equivalente, semEquivalente: false };
}

export { sincronizarModelos };
