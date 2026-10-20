// Fechamento dos terminais e recuperação do perfil cujo login foi renovado ali.
import io from '../io.js';
import { statusDoClaude } from './perfil-claude.js';
import { leituraDoLogin } from '../codex/auth.js';
import { liberarLogin, loginIndisponivel } from './login-indisponivel.js';

function atualizarLoginDoTerminal(engine, auth, deps = {}) {
  const diagnostico = engine.doctor().catch(() => { /* o próximo doctor tenta novamente */ });
  if (!auth || !loginIndisponivel(engine, auth)) return diagnostico;
  return Promise.all([diagnostico, conferirLogin(auth, deps)]).then(([, pronto]) => {
    if (pronto) liberarLogin(engine, auth);
    engine.pushState();
  }).catch(() => {
    engine.log('WARN', 'Não consegui confirmar o login ao fechar o terminal; o perfil continua sem login.');
  });
}

async function conferirLogin(auth, deps) {
  if (auth.kind === 'dir') return (await (deps.statusClaude || statusDoClaude)(auth.dir))?.loggedIn === true;
  if (auth.kind === 'codex') return leituraDoLogin(await (deps.statusCodex || (() => io.runShell('codex login status')))()).chatGPT;
  return false;
}

function encerrarTerminal(engine, { keys = [], label, id, code, login, loginAuth } = {}) {
  engine.activeReviews.delete(id);
  if (code !== 0 && code !== null && code !== undefined) engine.log('WARN', `sessao "${label}" saiu com codigo ${code}`);
  for (const k of keys) engine.unsee(k);
  engine.emit('toast', { kind: 'ok', text: `${label}: sessão encerrada. De volta ao monitoramento.` });
  if (login) atualizarLoginDoTerminal(engine, loginAuth);
  engine.pushState();
  if (keys.length) engine.checkNow();
}

export { atualizarLoginDoTerminal, encerrarTerminal };
