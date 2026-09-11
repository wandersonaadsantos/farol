// Taxonomia de falha da sincronização entre dispositivos. Existe pelo mesmo motivo
// de lib/jira/errors.js: quem chama (esperar, pedir login de novo, avisar na tela)
// decide por um código estável, nunca por regex em cima da mensagem do Firebase.
//
// `desligado` e `sem_credencial` não são falha do Firebase: são o recurso que
// ninguém ligou ou o login que ninguém fez. `falha_interna` é o Farol montando a
// operação errado, e apresentar isso como indisponibilidade mandaria quem opera
// investigar o fornecedor errado.
//
// Todo código novo entra nos DOIS objetos, senão a frase nunca aparece.
const SYNC_CODES = {
  DESLIGADO: 'desligado',
  SEM_CREDENCIAL: 'sem_credencial',
  CONFIG_INVALIDA: 'config_invalida',
  CREDENCIAL_INVALIDA: 'credencial_invalida',
  MUITAS_TENTATIVAS: 'muitas_tentativas',
  NAO_AUTORIZADO: 'nao_autorizado',
  NAO_ENCONTRADO: 'nao_encontrado',
  CONFLITO: 'conflito',
  TIMEOUT: 'timeout',
  INDISPONIVEL: 'indisponivel',
  PROVEDOR_DESABILITADO: 'provedor_desabilitado',
  AUTH_NAO_CONFIGURADO: 'auth_nao_configurado',
  RESPOSTA_INVALIDA: 'resposta_invalida',
  FALHA_INTERNA: 'falha_interna',
};

const MOTIVOS = {
  desligado: 'a sincronização entre dispositivos está desligada',
  sem_credencial: 'nenhum login do Firebase foi feito neste aparelho',
  config_invalida: 'a chave web ou a URL do banco estão incompletas ou inválidas',
  credencial_invalida: 'o Firebase recusou o e-mail e a senha, ou o login expirou; entre de novo',
  muitas_tentativas: 'o Firebase bloqueou tentativas de login por excesso; aguarde e tente de novo',
  nao_autorizado: 'o Firebase recusou a operação (token vencido ou regras do banco)',
  nao_encontrado: 'o banco informado não existe',
  conflito: 'outro aparelho alterou o mesmo registro antes desta escrita',
  provedor_desabilitado: 'o login por e-mail e senha não está habilitado neste projeto; ligue o provedor em Authentication, no console do Firebase',
  auth_nao_configurado: 'o Authentication deste projeto do Firebase nunca foi inicializado; abra Authentication no console e habilite o provedor de e-mail e senha',
  timeout: 'o Firebase não respondeu no tempo esperado',
  indisponivel: 'o Firebase está indisponível ou sem rede',
  resposta_invalida: 'o Firebase respondeu em formato inesperado',
  falha_interna: 'o Farol falhou ao montar a operação, não foi o Firebase',
};

class SyncError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SyncError';
    this.code = code;
  }
}

// O RTDB responde 401 tanto para token vencido quanto para regra que recusa a
// escrita; 412 é o CAS por ETag que perdeu a corrida.
function codeFromStatus(status) {
  if (status === 401) return SYNC_CODES.NAO_AUTORIZADO;
  if (status === 404) return SYNC_CODES.NAO_ENCONTRADO;
  if (status === 412) return SYNC_CODES.CONFLITO;
  // 408 e 429 são espera, não defeito: o servidor está dizendo "tente de novo daqui a
  // pouco". Caíam em RESPOSTA_INVALIDA, cujo texto fala em formato inesperado e em
  // sincronização PARADA, e aí o diagnóstico mandava investigar um problema que não
  // existe enquanto o próprio cliente já ia tentar de novo sozinho.
  if (status === 408 || status === 429) return SYNC_CODES.INDISPONIVEL;
  if (status >= 500 && status <= 599) return SYNC_CODES.INDISPONIVEL;
  return SYNC_CODES.RESPOSTA_INVALIDA;
}

const CREDENCIAL_RECUSADA = new Set([
  'EMAIL_NOT_FOUND', 'INVALID_PASSWORD', 'INVALID_LOGIN_CREDENTIALS', 'USER_DISABLED',
  'USER_NOT_FOUND', 'TOKEN_EXPIRED', 'INVALID_REFRESH_TOKEN',
  // e-mail ou senha que o Identity Toolkit recusa antes de olhar a conta: para quem
  // digitou, é a mesma ação (conferir e entrar de novo), não um defeito do Firebase
  'INVALID_EMAIL', 'MISSING_EMAIL', 'MISSING_PASSWORD',
]);

// Recusas que falam do PROJETO, não de quem digita. Elas caíam em RESPOSTA_INVALIDA, cuja
// frase manda investigar o Firebase por um formato de resposta, quando o que falta é uma
// caixa marcada no console; ver o passo 4 de firebase/README.md.
const PROVEDOR_DESLIGADO = new Set(['OPERATION_NOT_ALLOWED', 'PASSWORD_LOGIN_DISABLED', 'ADMIN_ONLY_OPERATION']);

// O Identity Toolkit às vezes acrescenta prosa depois do código
// ("TOO_MANY_ATTEMPTS_TRY_LATER : Too many unsuccessful..."), então a comparação
// é pelo prefixo; a prosa muda de versão para versão e o código não.
function codeFromIdentityMessage(msg) {
  const texto = String(msg || '');
  const prefixo = texto.split(' : ')[0].trim();
  if (CREDENCIAL_RECUSADA.has(prefixo)) return SYNC_CODES.CREDENCIAL_INVALIDA;
  if (PROVEDOR_DESLIGADO.has(prefixo)) return SYNC_CODES.PROVEDOR_DESABILITADO;
  if (prefixo === 'CONFIGURATION_NOT_FOUND') return SYNC_CODES.AUTH_NAO_CONFIGURADO;
  if (prefixo === 'TOO_MANY_ATTEMPTS_TRY_LATER') return SYNC_CODES.MUITAS_TENTATIVAS;
  if (/API key not valid/i.test(texto)) return SYNC_CODES.CONFIG_INVALIDA;
  return SYNC_CODES.RESPOSTA_INVALIDA;
}

function motivoDe(code) {
  return MOTIVOS[code] || 'falha desconhecida ao falar com o Firebase';
}

const MOTIVO_CONECTANDO = 'a conexão com o Firebase ainda está sendo estabelecida';

// Resposta única para "não dá pra falar com o banco agora". Estava duplicada em
// lib/engine/sync.js e lib/engine/sync-usage.js, e as duas respondiam sem_credencial
// no estado 'conectando': a quem ACABOU de entrar, a tela dizia "nenhum login do
// Firebase foi feito neste aparelho" e mandava entrar de novo numa conta em que ele
// já estava. Conexão em andamento é indisponibilidade passageira, não falta de login.
function falhaSemConexao(rt) {
  const r = rt || {};
  const code = r.lastError && r.lastError.code;
  if (code) return { ok: false, code, motivo: motivoDe(code) };
  if (r.status === 'conectando') return { ok: false, code: SYNC_CODES.INDISPONIVEL, motivo: MOTIVO_CONECTANDO };
  return { ok: false, code: SYNC_CODES.SEM_CREDENCIAL, motivo: motivoDe(SYNC_CODES.SEM_CREDENCIAL) };
}

export default { SYNC_CODES, MOTIVOS, SyncError, codeFromStatus, codeFromIdentityMessage, motivoDe, falhaSemConexao };
export { SYNC_CODES, MOTIVOS, SyncError, codeFromStatus, codeFromIdentityMessage, motivoDe, falhaSemConexao };
