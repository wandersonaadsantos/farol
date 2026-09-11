// Dublê do Firebase Realtime Database por REST, em processo. Sem efeito colateral
// no import: o `node --test` executa test/**/*.js, e um arquivo que só exporta
// funções passa vazio.
//
// Imita a parte do protocolo que o cliente do Farol consome: `?auth=` com o ID
// token, ETag e `if-match` (CAS só em PUT/DELETE; PATCH com `if-match` é 400),
// `null_etag` para o nó vazio, `{".sv":"timestamp"}`, `?shallow`, `?print=silent`
// e o stream SSE (`put` inicial, `put` a cada escrita sob o caminho, `keep-alive`,
// `auth_revoked` e `cancel`). O emulador real só entra na validação manual, porque o
// CI não tem Java nem firebase-tools.
import http from 'node:http';
import { createHash } from 'node:crypto';
import { desligarSubidaDeTierDoWasm } from './sem-tier-wasm.js';

const PROIBIDO = /[.$#[\]/\u0000-\u001f\u007f]/;

function copia(v) {
  return v === undefined ? null : JSON.parse(JSON.stringify(v));
}

function canonico(v) {
  if (Array.isArray(v)) return `[${v.map(canonico).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonico(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

function etagDe(v) {
  if (v === null || v === undefined) return 'null_etag';
  return createHash('sha1').update(canonico(v)).digest('hex');
}

// O RTDB recusa estes caracteres na chave; as três chaves de protótipo entram junto
// porque o caminho da requisição vira nome de propriedade aqui dentro, e `__proto__`
// num PUT poluiria o objeto do dublê em vez de gravar um filho.
const CHAVES_DE_PROTOTIPO = new Set(['__proto__', 'constructor', 'prototype']);
function chaveInvalida(k) {
  return !k || PROIBIDO.test(k) || CHAVES_DE_PROTOTIPO.has(k);
}

// resolve {".sv":"timestamp"}, poda nulos e objeto vazio vira null, como o RTDB
function normalizar(v, agora) {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'object') return v;
  if (!Array.isArray(v) && Object.keys(v).length === 1 && v['.sv'] === 'timestamp') return agora();
  const saida = {};
  for (const [k, filho] of Object.entries(v)) {
    if (chaveInvalida(k)) throw new Error('chave inválida');
    const n = normalizar(filho, agora);
    if (n !== null) saida[k] = n;
  }
  return Object.keys(saida).length ? saida : null;
}

function segmentos(caminho) {
  return caminho.split('/').filter(Boolean);
}

function ler(raiz, segs) {
  let no = raiz;
  for (const s of segs) {
    if (!no || typeof no !== 'object' || !Object.hasOwn(no, s)) return null;
    no = no[s];
  }
  return no === undefined ? null : no;
}

function gravar(raiz, segs, valor) {
  if (!segs.length) return valor;
  if (chaveInvalida(segs[0])) throw new Error('chave inválida');
  const base = raiz && typeof raiz === 'object' ? { ...raiz } : {};
  const filho = gravar(base[segs[0]], segs.slice(1), valor);
  if (filho === null) delete base[segs[0]];
  else base[segs[0]] = filho;
  return Object.keys(base).length ? base : null;
}

function lerCorpo(req) {
  return new Promise((resolve) => {
    let dados = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { dados += c; });
    req.on('end', () => resolve(dados));
  });
}

function relativo(base, alvo) {
  return '/' + alvo.slice(base.length).join('/');
}

// `token` pode ser o texto exato ou um predicado: o teste da composição (login de
// verdade no dublê do Auth) precisa aceitar os ID tokens que o outro dublê emitiu,
// como o banco real aceita qualquer token válido do mesmo projeto.
export async function startFakeRtdb({ token = 'tok-ok', agora = () => Date.now() } = {}) {
  // antes de qualquer fetch contra o dublê: ver test/helpers/sem-tier-wasm.js
  desligarSubidaDeTierDoWasm();
  const aceitaToken = typeof token === 'function' ? token : (t) => t === token;
  let raiz = null;
  let relogio = null;
  // proxy ou servidor mal configurado que engole o cabeçalho ETag: o CAS do cliente
  // depende dele, e o teste precisa poder produzir esse caso
  let semEtag = false;
  const requests = [];
  const abertos = new Set();
  const tempo = () => (relogio === null ? agora() : relogio);

  function enviar(res, status, corpo, etag) {
    const headers = { 'Content-Type': 'application/json; charset=utf-8' };
    if (etag && !semEtag) headers.ETag = etag;
    res.writeHead(status, headers);
    res.end(corpo === undefined ? '' : JSON.stringify(corpo));
  }

  function evento(stream, nome, dados) {
    stream.res.write(`event: ${nome}\ndata: ${JSON.stringify(dados)}\n\n`);
  }

  function notificar(segsEscrita) {
    for (const s of abertos) {
      const prefixo = s.segs.every((x, i) => segsEscrita[i] === x);
      const ancestral = segsEscrita.every((x, i) => s.segs[i] === x);
      if (prefixo && segsEscrita.length >= s.segs.length) evento(s, 'put', { path: relativo(s.segs, segsEscrita), data: ler(raiz, segsEscrita) });
      else if (ancestral) evento(s, 'put', { path: '/', data: ler(raiz, s.segs) });
    }
  }

  function fechar(s) {
    clearInterval(s.pulso);
    abertos.delete(s);
    s.res.end();
  }

  function abrirStream(res, segs) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    const s = { res, segs, pulso: null };
    s.pulso = setInterval(() => res.write('event: keep-alive\ndata: null\n\n'), 100);
    abertos.add(s);
    res.on('close', () => { clearInterval(s.pulso); abertos.delete(s); });
    evento(s, 'put', { path: '/', data: ler(raiz, segs) });
  }

  function aplicarPatch(segs, corpo) {
    if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) throw new Error('patch sem objeto');
    for (const [k, v] of Object.entries(corpo)) {
      const alvo = [...segs, ...segmentos(k)];
      if (!segmentos(k).length || segmentos(k).some(chaveInvalida)) throw new Error('chave inválida');
      raiz = gravar(raiz, alvo, normalizar(v, tempo));
    }
    return ler(raiz, segs);
  }

  function tratar(req, res, u, body) {
    const segs = segmentos(decodeURIComponent(u.pathname.replace(/\.json$/, '')));
    const querEtag = String(req.headers['x-firebase-etag'] || '') === 'true';
    const ifMatch = req.headers['if-match'];
    if (!aceitaToken(u.searchParams.get('auth'))) return enviar(res, 401, { error: 'Permission denied' });
    if (ifMatch !== undefined && (req.method === 'PATCH' || req.method === 'GET')) return enviar(res, 400, { error: 'if-match só vale em PUT e DELETE' });
    if (segs.some(chaveInvalida)) return enviar(res, 400, { error: 'Invalid path' });
    if (req.method === 'GET' && String(req.headers.accept || '').includes('text/event-stream')) return abrirStream(res, segs);
    const atual = ler(raiz, segs);
    if (ifMatch !== undefined && ifMatch !== etagDe(atual)) return enviar(res, 412, atual, etagDe(atual));
    let resultado;
    try {
      resultado = executar(req.method, segs, body, u, atual);
    } catch (err) {
      return enviar(res, 400, { error: err.message });
    }
    if (u.searchParams.get('print') === 'silent') { res.writeHead(204); return res.end(); }
    return enviar(res, 200, resultado, querEtag ? etagDe(resultado) : '');
  }

  function executar(metodo, segs, body, u, atual) {
    if (metodo === 'GET') {
      if (u.searchParams.get('shallow') !== 'true' || !atual || typeof atual !== 'object') return atual;
      return Object.fromEntries(Object.keys(atual).map((k) => [k, true]));
    }
    if (metodo === 'PUT') {
      const valor = normalizar(JSON.parse(body || 'null'), tempo);
      raiz = gravar(raiz, segs, valor);
      notificar(segs);
      return ler(raiz, segs);
    }
    if (metodo === 'PATCH') {
      const valor = aplicarPatch(segs, JSON.parse(body || 'null'));
      notificar(segs);
      return valor;
    }
    if (metodo === 'DELETE') {
      raiz = gravar(raiz, segs, null);
      notificar(segs);
      return null;
    }
    throw new Error('método não suportado');
  }

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    const body = await lerCorpo(req);
    requests.push({ method: req.method, path: u.pathname, query: Object.fromEntries(u.searchParams), headers: req.headers, body });
    tratar(req, res, u, body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    tree: () => copia(raiz),
    setTree(obj) { raiz = normalizar(copia(obj), tempo); },
    setNow(ms) { relogio = ms; },
    setSemEtag(v) { semEtag = !!v; },
    get streams() { return abertos.size; },
    fecharStreams() { for (const s of [...abertos]) fechar(s); },
    emitirAuthRevoked() {
      for (const s of [...abertos]) {
        evento(s, 'auth_revoked', 'credential is no longer valid');
        fechar(s);
      }
    },
    // o banco manda `cancel` quando a regra deixa de permitir a leitura do caminho
    emitirCancel() {
      for (const s of [...abertos]) {
        evento(s, 'cancel', null);
        fechar(s);
      }
    },
    close() {
      return new Promise((resolve) => {
        for (const s of [...abertos]) fechar(s);
        server.closeAllConnections();
        server.close(() => resolve());
      });
    },
  };
}

export default { startFakeRtdb };
