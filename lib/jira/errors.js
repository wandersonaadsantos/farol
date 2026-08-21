// Taxonomia de falha do Jira. Existe pelo mesmo motivo de lib/log-taxonomy.js:
// a decisão de quem chama (adiar, avisar, marcar card como não verificável) tem
// que sair de um código estável, não de regex em cima da mensagem do fornecedor.
//
// Três donos de falha, não um. `desligado` é o recurso que ninguém configurou e
// NÃO é falha: sem esse código, quem nunca cadastrou site receberia card ilegível
// em todo PR e perderia o auto-approve (ver decisão fechada 10). `falha_interna`
// é o Farol falhando, e apresentar isso como indisponibilidade do Jira mandaria
// quem opera investigar o fornecedor errado.
//
// Todo código novo entra nos DOIS objetos. Só no JIRA_CODES, o teste que varre
// Object.values fica verde por acidente e a frase nunca aparece.
const JIRA_CODES = {
  DESLIGADO: 'desligado',
  SITE_NAO_CONFIGURADO: 'site_nao_configurado',
  SEM_CREDENCIAL: 'sem_credencial',
  SEM_CHAVE: 'sem_chave',
  NAO_ENCONTRADO: 'nao_encontrado',
  SEM_PERMISSAO: 'sem_permissao',
  TIMEOUT: 'timeout',
  INDISPONIVEL: 'indisponivel',
  RESPOSTA_INVALIDA: 'resposta_invalida',
  FALHA_INTERNA: 'falha_interna',
};

const MOTIVOS = {
  [JIRA_CODES.DESLIGADO]: 'o recurso de Jira do Farol não está configurado',
  [JIRA_CODES.SITE_NAO_CONFIGURADO]: 'nenhum site do Jira está ligado a esta organização do GitHub',
  [JIRA_CODES.SEM_CREDENCIAL]: 'o site do Jira desta organização está sem credencial cadastrada',
  [JIRA_CODES.SEM_CHAVE]: 'não há chave de card no título, na branch nem no corpo do PR',
  [JIRA_CODES.NAO_ENCONTRADO]: 'o card não existe neste site do Jira',
  [JIRA_CODES.SEM_PERMISSAO]: 'a credencial não tem permissão para ler este card',
  [JIRA_CODES.TIMEOUT]: 'o Jira não respondeu no tempo esperado',
  [JIRA_CODES.INDISPONIVEL]: 'o Jira está indisponível',
  [JIRA_CODES.RESPOSTA_INVALIDA]: 'o Jira respondeu em formato inesperado',
  [JIRA_CODES.FALHA_INTERNA]: 'o Farol falhou ao montar o card, não foi o Jira',
};

class JiraError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'JiraError';
    this.code = code;
  }
}

function codeFromStatus(status) {
  if (status === 404) return JIRA_CODES.NAO_ENCONTRADO;
  if (status === 401 || status === 403) return JIRA_CODES.SEM_PERMISSAO;
  return JIRA_CODES.INDISPONIVEL;
}

function motivoDe(code) {
  return MOTIVOS[code] || 'falha desconhecida ao falar com o Jira';
}

export default { JIRA_CODES, JiraError, codeFromStatus, motivoDe };
export { JIRA_CODES, JiraError, codeFromStatus, motivoDe };
