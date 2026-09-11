// Parser de Server-Sent Events para o stream do RTDB. Puro: não sabe de rede nem
// de JSON, só transforma texto em eventos { event, data }.
//
// A rede entrega o corpo em pedaços arbitrários (no meio da linha, entre o \r e o
// \n), então a linha incompleta fica guardada até o \n chegar. Evento só sai com
// algo pendente: linha vazia solta é o separador do protocolo, não um evento vazio.
function createSseParser(onEvent) {
  let resto = '';
  let nome = '';
  let dados = [];
  let pendente = false;

  function despachar() {
    if (!pendente) return;
    const evento = { event: nome || 'message', data: dados.join('\n') };
    nome = '';
    dados = [];
    pendente = false;
    onEvent(evento);
  }

  // campo sem dois-pontos é o nome inteiro com valor vazio; um espaço logo depois
  // dos dois-pontos é separador do protocolo, não parte do valor
  function campo(linha) {
    const i = linha.indexOf(':');
    if (i < 0) return [linha, ''];
    const valor = linha.slice(i + 1);
    return [linha.slice(0, i), valor.startsWith(' ') ? valor.slice(1) : valor];
  }

  function linha(texto) {
    const l = texto.endsWith('\r') ? texto.slice(0, -1) : texto;
    if (l === '') return despachar();
    if (l.startsWith(':')) return undefined;
    const [chave, valor] = campo(l);
    if (chave === 'event') { nome = valor; pendente = true; }
    if (chave === 'data') { dados.push(valor); pendente = true; }
    return undefined;
  }

  function feed(chunk) {
    resto += String(chunk);
    let i = resto.indexOf('\n');
    while (i >= 0) {
      linha(resto.slice(0, i));
      resto = resto.slice(i + 1);
      i = resto.indexOf('\n');
    }
  }

  function end() {
    if (resto) {
      linha(resto);
      resto = '';
    }
    despachar();
  }

  return { feed, end };
}

export default { createSseParser };
export { createSseParser };
