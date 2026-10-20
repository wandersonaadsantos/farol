/* Transporte autenticado da UI (A4, spec 7.A4 item 2).
   Sem token salvo, nada muda: api() e get() seguem sem cabeçalho e o SSE segue no
   EventSource. Com token (depois do pareamento), toda chamada leva Authorization: Bearer
   e o SSE passa a ser lido por fetch, porque EventSource não aceita cabeçalho e o token
   nunca vai em URL. Sem cookie de propósito: localStorage é isolado por origem (esquema,
   host e porta), e cookie não é isolado por porta (RFC 6265, seção 8.5). */

const CHAVE_TOKEN = 'farol-auth-token';
const FORMATO_TOKEN = /^[A-Za-z0-9_-]{43}$/;
// a mesma espera de reconexão que os navegadores usam por padrão no EventSource
const RECONEXAO_MS = 3000;
// Teto do recuo. A espera fixa de 3 s martelava um engine morto a 1 requisição por 3
// segundos para sempre; dobrando até aqui, o engine que voltou é reencontrado rápido e
// o que não voltou não é perseguido.
const RECONEXAO_MAX_MS = 30000;
// Sem nada vindo do engine por isto, nem o batimento de 25 s, a conexão está morta sem
// ter avisado (proxy ou antivírus que bufferiza o stream). Mesmo critério do
// TEMPOS.SSE_OCIOSO_MS do lado do engine; quem observa aqui é o ui/app.js.
export const OCIOSO_MS = 90 * 1000;

// localStorage pode lançar (janela privada, dados do site bloqueados). Sem token legível
// a página segue no caminho de sempre.
export function tokenLocal(armazenamento = globalThis.localStorage) {
  try {
    const t = String((armazenamento && armazenamento.getItem(CHAVE_TOKEN)) || '');
    return FORMATO_TOKEN.test(t) ? t : '';
  } catch {
    return '';
  }
}

// Só entra token com a forma que o servidor emite: resposta torta não vira credencial
// guardada, e a tela trata isso como recusa.
export function salvarToken(token, armazenamento = globalThis.localStorage) {
  const t = String(token || '');
  if (!FORMATO_TOKEN.test(t)) return false;
  try {
    armazenamento.setItem(CHAVE_TOKEN, t);
    return true;
  } catch {
    return false;
  }
}

export function esquecerToken(armazenamento = globalThis.localStorage) {
  try { armazenamento.removeItem(CHAVE_TOKEN); } catch { /* janela privada */ }
}

export function comAutorizacao(cabecalhos = {}, token = tokenLocal()) {
  return token ? { ...cabecalhos, Authorization: `Bearer ${token}` } : { ...cabecalhos };
}

function lerBloco(bloco) {
  let tipo = 'message';
  const dados = [];
  for (const linha of bloco.split('\n')) {
    if (linha.startsWith('event:')) tipo = linha.slice(6).trim();
    if (linha.startsWith('data:')) dados.push(linha.slice(5).replace(/^ /, ''));
  }
  return dados.length ? { tipo, dados: dados.join('\n') } : null;
}

// O que sobra depois do último separador é evento pela metade: volta como resto para
// juntar com o próximo pedaço do stream.
export function separarEventos(texto) {
  const blocos = String(texto).replace(/\r\n/g, '\n').split('\n\n');
  const resto = blocos.pop();
  const eventos = [];
  for (const bloco of blocos) {
    const evento = lerBloco(bloco);
    if (evento) eventos.push(evento);
  }
  return { eventos, resto };
}

// O `error` do corpo JSON de uma recusa. Corpo ausente ou que não é JSON devolve '', e quem
// chama trata como a recusa do próprio Farol (o comportamento de antes).
export async function motivoDaRecusa(resposta) {
  try {
    const corpo = typeof resposta.json === 'function' ? await resposta.json() : null;
    return corpo && typeof corpo.error === 'string' ? corpo.error : '';
  } catch {
    return '';
  }
}

// O EventSource nativo (o caminho sem token) não mostra o status nem o corpo de uma recusa.
// Quando ele cai, esta sondagem pede o estado uma vez e diz se a queda foi um login de fora do
// Farol vencido ('login-externo'). Qualquer outra resposta, ou falha de rede, é ''.
export async function recusaDeLoginExterno(fetchImpl = (u, init) => globalThis.fetch(u, init)) {
  try {
    const resposta = await fetchImpl('/api/state', { headers: { 'x-farol': '1' } });
    if (!resposta || resposta.status !== 401) return '';
    const motivo = await motivoDaRecusa(resposta);
    return motivo && motivo !== 'nao_autenticado' ? 'login-externo' : '';
  } catch {
    return '';
  }
}

export class FonteDeEventosAutenticada {
  constructor(url, obterToken = tokenLocal, fetchImpl = (u, init) => globalThis.fetch(u, init), agendar = (fn, ms) => setTimeout(fn, ms)) {
    this.url = url;
    this.obterToken = obterToken;
    this.fetchImpl = fetchImpl;
    this.agendar = agendar;
    this.ouvintes = new Map();
    this.onerror = null;
    this.fechada = false;
    this.controle = null;
    this.espera = RECONEXAO_MS;
    this.agendar(() => this.abrir(), 0);
  }

  addEventListener(tipo, fn) {
    this.ouvintes.set(tipo, [...(this.ouvintes.get(tipo) || []), fn]);
  }

  close() {
    this.fechada = true;
    if (this.controle) this.controle.abort();
  }

  emitir(tipo, dados) {
    for (const fn of this.ouvintes.get(tipo) || []) fn({ data: dados });
  }

  // Queda, fim do stream e recusa (token revogado) seguem o contrato do EventSource:
  // avisa por onerror e tenta de novo depois da espera.
  async abrir() {
    if (this.fechada) return;
    this.controle = new AbortController();
    await this.ler().catch(() => false);
    if (this.fechada) return;
    if (this.onerror) this.onerror();
    const espera = this.espera;
    this.espera = Math.min(this.espera * 2, RECONEXAO_MAX_MS);
    this.agendar(() => this.abrir(), espera);
  }

  async ler() {
    const init = { headers: comAutorizacao({ Accept: 'text/event-stream' }, this.obterToken()), signal: this.controle.signal };
    const resposta = await this.fetchImpl(this.url, init);
    // 401 do próprio Farol (`nao_autenticado`) é a credencial vencida ou revogada no meio do
    // uso: quem ouve leva de volta ao pareamento, e a reconexão continua, porque parear de novo
    // faz o stream voltar sozinho. 401 com OUTRO motivo vem de quem está na frente do Farol
    // (medido em 20/10/2026 na Hostinger: o portão do login Google devolve
    // `google_login_required` quando a sessão dele vence); parear não resolve, entrar de novo
    // no portão resolve, e por isso ele sai como `login-externo`.
    if (resposta.status === 401) {
      const motivo = await motivoDaRecusa(resposta);
      if (motivo && motivo !== 'nao_autenticado') this.emitir('login-externo', motivo);
      else this.emitir('nao-autenticado', '');
    }
    if (!resposta.ok || !resposta.body) return false;
    // conexão de pé: o recuo volta ao início, senão uma queda longa deixaria a próxima
    // reconexão lenta pelo resto da sessão
    this.espera = RECONEXAO_MS;
    this.emitir('open', '');
    const leitor = resposta.body.getReader();
    const decodificador = new TextDecoder();
    let resto = '';
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) return true;
      const lote = separarEventos(resto + decodificador.decode(value, { stream: true }));
      resto = lote.resto;
      lote.eventos.forEach(e => this.emitir(e.tipo, e.dados));
    }
  }
}
