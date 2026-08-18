// DOM mínimo escrito à mão, pra permitir CARREGAR o ui/app.js num teste.
//
// Por que existe: o app.js é um módulo de navegador que toca `document` no topo, e por
// isso nunca teve teste que o EXECUTASSE. Os arquivos que o "testam" leem o fonte como
// texto e casam regex. Isso deixou passar dois bugs meus só em 18/08: função movida
// que referenciava constante deixada pra trás, e um regex de conversão que enfiou uma
// variável dentro de uma string de CSS. Os dois eram erro de RUNTIME com sintaxe
// válida, então `node --check`, lint e CI verde não diziam nada.
//
// jsdom resolveria e está fora de questão: o invariante 1 proíbe dependência npm.
// Então o stub é este, e ele é deliberadamente BURRO: não implementa layout, cascata
// nem eventos de verdade. Existe pra UMA pergunta, que é a que faltava: "carregar a
// tela e desenhar com um estado plausível levanta exceção?".
//
// O que ele NÃO cobre, pra ninguém confundir cobertura com garantia: nada de visual,
// nada de CSS, nada de comportamento de clique. Verde aqui não diz que a tela está
// certa; diz que ela não explode.

function criaElemento(tag = 'div') {
  return {
    tagName: String(tag).toUpperCase(),
    children: [], dataset: {}, attributes: {},
    // style precisa de setProperty/removeProperty: o app.js troca variaveis de CSS
    style: { setProperty() { }, removeProperty() { }, getPropertyValue() { return ''; } },
    _html: '', _text: '', hidden: false, value: '', checked: false, disabled: false,
    scrollTop: 0, scrollHeight: 0, clientWidth: 800, clientHeight: 600, offsetHeight: 40,
    classList: {
      _s: new Set(),
      add(...c) { c.forEach(x => this._s.add(x)); },
      remove(...c) { c.forEach(x => this._s.delete(x)); },
      toggle(c, f) { const t = this._s.has(c); const q = f === undefined ? !t : !!f; if (q) this._s.add(c); else this._s.delete(c); return q; },
      contains(c) { return this._s.has(c); },
    },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); },
    get textContent() { return this._text; },
    set textContent(v) { this._text = String(v); },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; },
    removeAttribute(k) { delete this.attributes[k]; },
    hasAttribute(k) { return k in this.attributes; },
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) { this.children = this.children.filter(x => x !== c); return c; },
    remove() { },
    insertBefore(c) { this.children.unshift(c); return c; },
    addEventListener() { }, removeEventListener() { }, dispatchEvent() { return true; },
    focus() { }, blur() { }, click() { }, scrollIntoView() { },
    querySelector() { return criaElemento(); },
    querySelectorAll() { return []; },
    closest() { return null; },
    matches() { return false; },
    insertAdjacentHTML() { },
    getBoundingClientRect() { return { top: 0, left: 0, width: 800, height: 600, bottom: 600, right: 800 }; },
  };
}

export function instalarDom() {
  // cache por seletor: o app.js guarda referências e espera que a MESMA consulta
  // devolva o MESMO elemento entre chamadas
  const cache = new Map();
  const doc = {
    body: criaElemento('body'),
    documentElement: criaElemento('html'),
    activeElement: null,
    querySelector(sel) { if (!cache.has(sel)) cache.set(sel, criaElemento()); return cache.get(sel); },
    querySelectorAll() { return []; },
    getElementById(id) { return this.querySelector('#' + id); },
    createElement(tag) { return criaElemento(tag); },
    createTextNode(t) { const e = criaElemento('#text'); e.textContent = t; return e; },
    addEventListener() { }, removeEventListener() { }, dispatchEvent() { return true; },
  };
  const listeners = new Map();
  class EventSourceStub {
    constructor() { this.readyState = 1; }
    addEventListener(tipo, fn) { listeners.set(tipo, [...(listeners.get(tipo) || []), fn]); }
    close() { this.readyState = 2; }
  }
  const store = new Map();
  const g = globalThis;
  g.document = doc;
  // window aponta pro global, entao o global precisa das APIs de janela que o app usa
  g.addEventListener = () => { };
  g.removeEventListener = () => { };
  g.dispatchEvent = () => true;
  g.scrollTo = () => { };
  g.open = () => null;
  g.window = g;
  // navigator no Node moderno e getter-only: define por propriedade em vez de atribuir
  try { g.navigator = { userAgent: 'node-test', platform: 'test' }; }
  catch { Object.defineProperty(g, 'navigator', { value: { userAgent: 'node-test', platform: 'test' }, configurable: true }); }
  g.location = { href: 'http://localhost/', origin: 'http://localhost', reload() { } };
  g.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  };
  g.EventSource = EventSourceStub;
  g.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' });
  function N() { } N.permission = 'default'; g.Notification = N;
  g.requestAnimationFrame = fn => setTimeout(fn, 0);
  g.cancelAnimationFrame = () => { };
  g.ResizeObserver = class { observe() { } unobserve() { } disconnect() { } };
  g.getComputedStyle = () => ({ getPropertyValue: () => '' });
  // CSS.escape: o app usa pra montar seletor com id do usuario dentro
  g.CSS = { escape: v => String(v).replace(/([^a-zA-Z0-9_-])/g, '\\$1') };
  g.matchMedia = () => ({ matches: false, addEventListener() { }, removeEventListener() { } });
  g.AudioContext = class {
    createOscillator() { return { connect() { }, start() { }, stop() { }, frequency: { value: 0, setValueAtTime() { } } }; }
    createGain() { return { connect() { }, gain: { value: 0, setValueAtTime() { }, exponentialRampToValueAtTime() { } } }; }
    get destination() { return {}; }
    get currentTime() { return 0; }
  };

  // dispara um evento SSE como o servidor dispararia
  const emitir = (tipo, dados) => {
    const fns = listeners.get(tipo) || [];
    for (const fn of fns) fn({ data: JSON.stringify(dados) });
    return fns.length;
  };
  return { doc, emitir, listeners };
}
