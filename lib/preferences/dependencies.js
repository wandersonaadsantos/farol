// Reconciliação das preferências que dependem de outros campos da configuração.
import { isDeepStrictEqual } from 'node:util';
import { normalizarDepoisDeAplicar } from '../engine/contas-config.js';
import { reconciliar, normalizarCadeia } from '../engine/cadeia-perfis.js';
function chainConfig(chain, profiles, keepUnknown = false) {
  const known = new Set(profiles.map(profile => profile.id));
  const extra = keepUnknown ? chain.filter(entry => !known.has(entry.id)).map(entry => ({ id: entry.id })) : [];
  const config = { claudeProfiles: [...profiles, ...extra], cadeiaPerfis: chain, claudeProfileId: '' };
  reconciliar(config, { cadeiaPerfis: chain });
  return config;
}
function effectiveValue(config, key, value) {
  if (key !== 'cadeiaPerfis') return value;
  return chainConfig(value, config.claudeProfiles || [], true).cadeiaPerfis;
}
function changesUnselectedAccounts(config, patch) {
  if (Object.hasOwn(patch, 'accounts') || !['claudeProfiles', 'ghUser', 'owners'].some(key => Object.hasOwn(patch, key))) return false;
  const candidate = { config: { ...config, ...patch } };
  normalizarDepoisDeAplicar(candidate, patch);
  return !isDeepStrictEqual(config.accounts, candidate.config.accounts);
}
function dependencyNote(config, key, value) {
  if (changesUnselectedAccounts(config, { [key]: value })) return 'Esta diferença também altera contas. Selecione a diferença de Contas correspondente ou ajuste os vínculos na tela Contas antes de importar.';
  if (key === 'claudeProfileId') return 'O perfil padrão ajusta a ordem de consumo. Deixá-lo vazio desativa os perfis da cadeia.';
  if (key === 'cadeiaPerfis') return 'A cadeia define o perfil padrão. Perfis existentes que não aparecem no arquivo ficam desativados.';
  return '';
}
function completePatch(config, patch) {
  if (changesUnselectedAccounts(config, patch)) return { error: 'Esta alteração também modifica contas. Selecione a diferença de Contas correspondente ou ajuste os vínculos na tela Contas antes de importar.' };
  const profiles = patch.claudeProfiles || config.claudeProfiles || [];
  if (Object.hasOwn(patch, 'cadeiaPerfis')) {
    const result = chainConfig(patch.cadeiaPerfis, profiles);
    if (Object.hasOwn(patch, 'claudeProfileId') && patch.claudeProfileId !== result.claudeProfileId) return { error: 'O perfil padrão e a cadeia selecionados são incompatíveis. Confira o arquivo antes de aplicar.' };
    return { patch: { ...patch, cadeiaPerfis: result.cadeiaPerfis, claudeProfileId: result.claudeProfileId } };
  }
  if (patch.claudeProfileId === '') {
    const chain = normalizarCadeia(config.cadeiaPerfis).map(entry => ({ ...entry, ativo: false }));
    return { patch: { ...patch, cadeiaPerfis: chainConfig(chain, profiles).cadeiaPerfis } };
  }
  return { patch };
}
export { effectiveValue, dependencyNote, completePatch };
