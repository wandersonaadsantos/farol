// O segredo por sessão de terminal que autentica o aviso de saída. O script da sessão
// (macOS e Linux) avisa o motor pelo trap EXIT, com um curl a /api/session-exit; quando a
// autenticação local é exigida (modo casca, bind fora do loopback, localAuth 'exigir') o
// porteiro da A4 aceita esse pedido sem Bearer só com o segredo DAQUELA sessão
// (lib/local-auth/acesso.js). Saber o id não basta. O segredo mora só em memória, no
// registro da sessão em `activeReviews` (`segredoDeSaida`), e no script da sessão (0700,
// apagado ao terminar, numa variável de shell que o claude não herda); nunca vai a log, snapshot (lib/engine/sessao-projecao.js tira o
// campo), toast ou linha de comando (o spawnlog registra só o caminho do script).
import crypto from 'node:crypto';

function novoSegredoDeSaida() {
  return crypto.randomBytes(32).toString('base64url');
}

// Tempo constante com tamanhos iguais; sessão inexistente ou sem segredo nunca confere.
function confereSegredoDeSaida(engine, id, segredo) {
  const vivas = engine && engine.activeReviews instanceof Map ? engine.activeReviews : null;
  const sessao = vivas ? vivas.get(String(id || '')) : null;
  const esperado = Buffer.from(sessao && typeof sessao.segredoDeSaida === 'string' ? sessao.segredoDeSaida : '');
  const dado = Buffer.from(String(segredo || ''));
  if (!esperado.length || esperado.length !== dado.length) return false;
  return crypto.timingSafeEqual(esperado, dado);
}

// As linhas do script POSIX que avisam o motor no fim: o segredo vai por cabeçalho, lido de
// uma variável de shell, para nunca aparecer como argumento de processo. Sem `export`: o trap
// EXIT roda no mesmo shell, e assim o segredo não chega ao processo do claude.
function linhasDeAvisoDeSaida(id, porta, segredo) {
  return [
    `FAROL_SESSION_SECRET='${String(segredo || '')}'`,
    'notify() {',
    `  curl -fsS -m 5 -X POST -H 'x-farol: 1' -H "x-farol-session: $FAROL_SESSION_SECRET" -H 'Content-Type: application/json' \\`,
    `    --data '{"id":"${id}"}' 'http://127.0.0.1:${porta}/api/session-exit' >/dev/null 2>&1`,
    '  rm -f -- "$0"',
    '}',
    'trap notify EXIT',
  ];
}

export default { novoSegredoDeSaida, confereSegredoDeSaida, linhasDeAvisoDeSaida };
export { novoSegredoDeSaida, confereSegredoDeSaida, linhasDeAvisoDeSaida };
