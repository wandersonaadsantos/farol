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
    this.agendar(() => this.abrir(), RECONEXAO_MS);
  }

  async ler() {
    const init = { headers: comAutorizacao({ Accept: 'text/event-stream' }, this.obterToken()), signal: this.controle.signal };
    const resposta = await this.fetchImpl(this.url, init);
    if (!resposta.ok || !resposta.body) return false;
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
