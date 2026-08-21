// Único ponto do app que fala com o Atlassian. O timeout próprio é o ganho
// concreto sobre o conector do claude.ai: lá uma chamada travada só morre em 300
// segundos e queima cinco minutos da revisão, porque quem chama é o CLI e o
// Farol não tem como interromper.
//
// fetch entra por injeção pra o teste não tocar a rede.
import { JIRA } from '../constants.js';
import io from '../io.js';
import { JiraError, JIRA_CODES, codeFromStatus } from './errors.js';

function authHeader(email, token) {
  return `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
}

// o Jira promete objeto; escalar, array e envelope de erro em 200 (proxy, portal
// de login) chegam como JSON válido e não são resposta de API.
function corpoDeObjeto(texto) {
  const corpo = io.parseJson(texto, null);
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return null;
  return corpo;
}

function comoJiraError(err) {
  if (err instanceof JiraError) return err;
  if (err && err.name === 'AbortError') return new JiraError(JIRA_CODES.TIMEOUT, 'o Jira não respondeu no tempo esperado');
  return new JiraError(JIRA_CODES.INDISPONIVEL, (err && err.message) || 'falha de rede falando com o Jira');
}

function createJiraClient({ baseUrl, email, token, fetchImpl }) {
  const chamar = fetchImpl || fetch;

  async function pedir(caminho) {
    const controle = new AbortController();
    const alarme = setTimeout(() => controle.abort(), JIRA.REQUEST_TIMEOUT_MS);
    // cabeçalhos fora da chamada: objeto literal aninhado conta como nível de
    // chave no gate, e headers dentro das opções dentro do try dentro da função
    // dentro da fábrica estoura a profundidade máxima.
    const cabecalhos = { Authorization: authHeader(email, token), Accept: 'application/json' };
    try {
      const res = await chamar(`${baseUrl}${caminho}`, { headers: cabecalhos, signal: controle.signal });
      if (!res.ok) throw new JiraError(codeFromStatus(res.status), `o Jira respondeu ${res.status}`);
      const corpo = corpoDeObjeto(await res.text());
      if (!corpo) throw new JiraError(JIRA_CODES.RESPOSTA_INVALIDA, 'o Jira respondeu em formato inesperado');
      return corpo;
    } catch (err) {
      throw comoJiraError(err);
    } finally {
      clearTimeout(alarme);
    }
  }

  return {
    getIssue: (key) => pedir(`${JIRA.API_PATH}${encodeURIComponent(key)}?fields=${JIRA.FIELDS}`),
    searchJql: (jql, maxResults) => pedir(
      `${JIRA.SEARCH_PATH}?jql=${encodeURIComponent(jql)}&maxResults=${Number(maxResults) || 10}&fields=${JIRA.FIELDS}`
    ),
  };
}

export default { createJiraClient };
export { createJiraClient };
