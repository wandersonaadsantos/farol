// Valores portáveis e reconstrução local das dependências que não viajam no JSON.
import { isDeepStrictEqual } from 'node:util';
import { SETTINGS } from '../settings.js';
import acesso from '../local-auth/acesso.js';
import { politicaExplicita } from '../engine/contas-migracao.js';
const PORTABLE_SETTINGS = SETTINGS.filter(setting => setting.ui);
const KEYS = PORTABLE_SETTINGS.map(setting => setting.key);
function withoutApiKey(value) {
  const { apiKey: _private, ...portable } = value;
  return portable;
}
function project(key, value) {
  if (key === 'sync') return withoutApiKey(value);
  if (key === 'claudeProfiles') return value.map(withoutApiKey);
  return value;
}
function withValidationKey(key, value) {
  if (key !== 'claudeProfiles' || !Array.isArray(value)) return value;
  return value.map(profile => ['apikey', 'openrouter'].includes(profile?.kind) ? { ...profile, apiKey: 'validation-only' } : profile);
}
function canonical(engine, key, value) {
  const defaults = Object.fromEntries(PORTABLE_SETTINGS.map(setting => [setting.key, setting.def]));
  const sanitized = engine.sanearPreferencia(key, withValidationKey(key, value), defaults);
  if (key === 'accounts') return sanitized.map(account => ({ ...account, ...politicaExplicita(account) }));
  return project(key, sanitized);
}
function values(engine) {
  return Object.fromEntries(PORTABLE_SETTINGS.map(setting => {
    const raw = engine.config[setting.key] ?? setting.def;
    return [setting.key, canonical(engine, setting.key, project(setting.key, raw))];
  }));
}
function validValue(engine, key, value) {
  const setting = PORTABLE_SETTINGS.find(item => item.key === key);
  if (!setting) return false;
  if (Array.isArray(setting.def) && !Array.isArray(value)) return false;
  if (setting.def !== null && !Array.isArray(setting.def) && typeof value !== typeof setting.def) return false;
  if (key === 'theme' && !['dark', 'light'].includes(value)) return false;
  if (['accounts', 'claudeProfiles'].includes(key)) {
    const ids = value.map(item => key === 'accounts' ? String(item?.user || '').toLowerCase() : String(item?.id || ''));
    if (new Set(ids).size !== ids.length) return false;
  }
  return isDeepStrictEqual(value, canonical(engine, key, value));
}
function localProfile(config, profile) {
  return (config.claudeProfiles || []).find(local => local.id === profile.id && local.kind === profile.kind && (local.baseUrl || '') === (profile.baseUrl || ''));
}
function dependencyReason(config, key, value) {
  if (key === 'accounts' && !value.length && config.accounts?.length) {
    return 'A importação não pode remover a última conta configurada. Para interromper o monitoramento, silencie a conta.';
  }
  if (key === 'claudeProfiles' && value.some(profile => ['apikey', 'openrouter'].includes(profile.kind) && !localProfile(config, profile)?.apiKey)) {
    return 'Cadastre neste aparelho as credenciais dos perfis de API, com o mesmo identificador e endereço, antes de importar seus ajustes.';
  }
  if (key === 'sync' && (value.shared?.enabled || value.distribution?.enabled) && !acesso.compartilhamentoLiberado(config)) {
    return 'Ative a autenticação local exigida neste aparelho antes de importar o compartilhamento.';
  }
  if (key === 'sync' && (value.enabled || config.sync?.apiKey) && (!config.sync?.apiKey || config.sync.databaseUrl !== value.databaseUrl || config.sync.projectId !== value.projectId)) {
    return 'Configure neste aparelho a chave da sincronização para este projeto e banco antes de importar seus ajustes.';
  }
  return '';
}
function localValue(config, key, value) {
  if (key === 'claudeProfiles') return value.map(profile => {
    if (!['apikey', 'openrouter'].includes(profile.kind)) return profile;
    return { ...profile, apiKey: localProfile(config, profile)?.apiKey || '' };
  });
  if (key === 'sync') {
    const sameTarget = config.sync?.databaseUrl === value.databaseUrl && config.sync?.projectId === value.projectId;
    return { ...value, apiKey: sameTarget ? config.sync?.apiKey || '' : '' };
  }
  return value;
}
function missingProfile(config, patch) {
  const profiles = patch.claudeProfiles || config.claudeProfiles || [];
  const ids = new Set(profiles.map(profile => profile.id));
  const refs = [patch.claudeProfileId, ...(patch.accounts || []).map(account => account.claudeProfileId), ...(patch.cadeiaPerfis || []).map(entry => entry.id)].filter(Boolean);
  return refs.some(id => !ids.has(id));
}
export { KEYS, values, validValue, dependencyReason, localValue, missingProfile };
