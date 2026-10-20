// O ambiente do processo `agy` (Antigravity CLI), por sistema operacional. PURO.
//
// Por que uma pasta por perfil funciona (docs/superpowers/specs/2026-10-20-agy-provedor.md,
// seção 2): por padrão o `agy` guarda o login Google numa vaga ÚNICA do chaveiro do sistema,
// igual para qualquer pasta. Com uma variável `SSH_*` no ambiente ele passa a guardar o token
// em arquivo dentro da home do processo, e com a home apontada para a pasta do perfil cada
// perfil vira uma conta. É detecção de ambiente, não contrato do produto: por isso a sessão
// confere, antes de rodar, que a conta autenticada é a esperada (lib/agy/cota.js).
//
// Windows: só o USERPROFILE muda. O `gh` lê a configuração de %APPDATA% e o `git` lê HOME,
// então os dois seguem com a configuração real do usuário. POSIX: a home é HOME, e mudá-la
// tira o `git` do ~/.gitconfig real, que volta por GIT_CONFIG_GLOBAL; o `gh` usa o GH_TOKEN
// que o Farol já injeta (engine.ghEnv), como nos outros provedores.
//
// As credenciais herdadas que trocariam o login da pasta por outra cobrança saem sempre: a
// chave de API do Gemini (cobra por token) e a credencial de aplicativo do GCP. A mesma regra
// do `codexEnv` (lib/codex/stream.js).
import { IS_WIN } from '../paths.js';

const HERDADAS_PROIBIDAS = Object.freeze(['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'AGY_ADC_AUTH']);
// qualquer valor serve: o `agy` só olha se a variável existe (medido com três formatos)
const SSH_CLIENT_DO_FAROL = 'farol 0 0';

/**
 * @param {object} base o ambiente de partida (o `ghEnv` da conta, com o GH_TOKEN dela)
 * @param {string} pasta a pasta do perfil (~/.farol/agy/<id>)
 * @param {{ win?: boolean, gitconfigReal?: string }} [opcoes]
 */
function agyEnv(base, pasta, { win = IS_WIN, gitconfigReal = '' } = {}) {
  const out = { ...(base || {}) };
  // no Windows o nome da variável não diferencia caixa: `Gemini_Api_Key` também é ela
  // (e o que o Farol vai escrever sai antes em qualquer caixa, senão o filho do Windows
  // receberia `UserProfile` e `USERPROFILE` juntos, e não há garantia de qual vence)
  const sobrescritas = win ? ['SSH_CLIENT', 'USERPROFILE'] : [];
  for (const k of Object.keys(out)) {
    const nome = k.toUpperCase();
    if (HERDADAS_PROIBIDAS.includes(nome) || sobrescritas.includes(nome)) delete out[k];
  }
  out.SSH_CLIENT = SSH_CLIENT_DO_FAROL;
  if (win) {
    out.USERPROFILE = pasta;
    return out;
  }
  out.HOME = pasta;
  if (gitconfigReal) out.GIT_CONFIG_GLOBAL = gitconfigReal;
  return out;
}

export default { agyEnv, HERDADAS_PROIBIDAS, SSH_CLIENT_DO_FAROL };
export { agyEnv, HERDADAS_PROIBIDAS, SSH_CLIENT_DO_FAROL };
