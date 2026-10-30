// Seleção explícita de Codex somente na autoanálise restrita, sem associação global.
import { MODE, assertSelfIsolation } from './self-isolation.js';

function requestedSelfProfile(engine, options = {}) {
  const id = options.codexProfileId;
  if (id === undefined) return null;
  if (options.isolation !== MODE || typeof id !== 'string' || !id) {
    throw new Error('Perfil Codex explícito exige autoanálise restrita e id configurado.');
  }
  const profile = engine.config?.claudeProfiles?.find(item => item.id === id);
  if (profile?.kind !== 'codex') throw new Error('Perfil Codex configurado não encontrado; nenhum fallback iniciado.');
  return { kind: 'codex', id: profile.id };
}

function sessionSelfProfile(engine, opts = {}) {
  if (opts.selfCodexProfileId === undefined) return null;
  if (opts.operationKind !== 'self') throw new Error('Perfil por execução só é aceito na autoanálise restrita.');
  assertSelfIsolation(opts.selfIsolation);
  return requestedSelfProfile(engine, { isolation: MODE, codexProfileId: opts.selfCodexProfileId });
}

// Indica intenção, não elegibilidade: pedidos inválidos também precisam sair da fila.
function hasSelfCodexSelection(pr) {
  return pr?.kind === 'self' && pr.codexProfileId !== undefined;
}

export { requestedSelfProfile, sessionSelfProfile, hasSelfCodexSelection };
