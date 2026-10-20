/* Login do Claude pela própria tela (20/10/2026), para quando o Farol não tem terminal para
   abrir: o modo servidor e o Linux sem emulador. O engine roda o `claude auth login` na pasta
   do perfil (lib/engine/login-web.js) e devolve o link; a pessoa entra pelo navegador, copia
   o código que a página da Anthropic mostra e cola aqui. PURA.

   O comando de terminal continua junto, como alternativa: é o caminho que já existia, e
   quem tem acesso à máquina pode preferir. */
import { esc } from './comum.js';

const SO_HTTPS = /^https:\/\/[^\s"'<>]+$/;
// no proot do celular o comando entra pelo Termux, fora do Ubuntu (lib/engine/login-celular.js)
const ONDE_RODAR = {
  termux: 'no Termux, numa sessão fora do Ubuntu',
  terminal: 'num terminal da máquina do Farol',
};

function comandoAlternativo(comando, onde) {
  if (!comando) return '';
  const lugar = ONDE_RODAR[onde] || ONDE_RODAR.terminal;
  return `<details class="cp-login-web-alt"><summary>Prefere o terminal?</summary>
    <div class="a-hint">Rode ${esc(lugar)}; o Claude abre na pasta deste perfil (rode /login se pedir):</div><code>${esc(comando)}</code></details>`;
}

/**
 * O painel do login pela tela.
 * @param {{ estado?: 'abrindo'|'link'|'enviando'|'erro'|'feito', perfil?: string, url?: string, motivo?: string, comando?: string, onde?: string }} dados
 */
function loginWebHtml(dados = {}) {
  const d = dados || {};
  if (!d.estado) return '';
  const titulo = `<div class="a-add-title">Login do Claude${d.perfil ? ` em ${esc(d.perfil)}` : ''}</div>`;
  const cancelar = '<button class="btn sm ghost" id="cpLoginWebCancelar">Fechar</button>';
  if (d.estado === 'abrindo') return `<div class="card acct-add cp-login-web">${titulo}<span class="pill busy">abrindo o login…</span></div>`;
  if (d.estado === 'feito') {
    return `<div class="card acct-add cp-login-web">${titulo}<div class="a-hint">Login feito. O selo do perfil atualiza na próxima verificação do ambiente.</div>${cancelar}</div>`;
  }
  const url = SO_HTTPS.test(String(d.url || '')) ? d.url : '';
  if (!url) {
    return `<div class="card acct-add cp-login-web" role="alert">${titulo}<div class="a-hint">${esc(d.motivo || 'não deu para abrir o login agora')}</div>${comandoAlternativo(d.comando, d.onde)}${cancelar}</div>`;
  }
  const erro = d.estado === 'erro' && d.motivo ? `<div class="a-hint cp-teste-erro" role="alert">${esc(d.motivo)}</div>` : '';
  const enviando = d.estado === 'enviando';
  const trava = enviando ? ' disabled' : '';
  const rotulo = enviando ? 'Entrando…' : 'Entrar';
  return `<div class="card acct-add cp-login-web">
    ${titulo}
    <div class="a-hint">1. Abra a página de login e entre com a conta desta assinatura.</div>
    <div class="a-editrow"><a class="btn sm" href="${esc(url)}" target="_blank" rel="noreferrer">Abrir a página de login</a></div>
    <div class="a-hint">2. Cole aqui o código que a página mostrar no fim.</div>
    <div class="a-editrow">
      <input id="cpLoginWebCodigo" placeholder="código de autorização" spellcheck="false" autocomplete="off"${trava}>
      <button class="btn sm" id="cpLoginWebEnviar"${trava}>${rotulo}</button>
      ${cancelar}
    </div>
    ${erro}
    ${comandoAlternativo(d.comando, d.onde)}
  </div>`;
}

export { loginWebHtml };
