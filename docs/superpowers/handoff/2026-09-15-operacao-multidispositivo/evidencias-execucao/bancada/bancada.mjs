// Bancada da jornada multidispositivo: dublê do banco e dublê do login, os mesmos dos testes,
// servidos em portas locais para duas instâncias isoladas do Farol conversarem entre si.
// Fronteira simulada: o banco NÃO aplica as regras de segurança do Firebase, e os dois
// "aparelhos" são dois processos na mesma máquina.
//
// uso: node bancada.mjs <raiz-do-farol>
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const raiz = process.argv[2];
const helpers = (nome) => pathToFileURL(path.join(raiz, 'test', 'helpers', nome)).href;
const { startFakeIdentity } = await import(helpers('fake-identity.js'));
const { startFakeRtdb } = await import(helpers('fake-rtdb.js'));

const PORTA_AUTH = 9099; // a do emulador, que o Farol usa quando o banco é http local
const PORTA_BANCO = 47290;

const identidade = await startFakeIdentity({
  apiKey: 'chave-da-bancada',
  users: { 'bancada@teste.local': { password: 'senha-da-bancada', uid: 'u-bancada' } },
});
const banco = await startFakeRtdb({ token: (t) => identidade.tokens.idTokens.includes(t) });

// repassa as duas portas fixas para as portas que os dublês abriram
function repassar(portaFixa, destino) {
  const alvo = new URL(destino);
  const servidor = http.createServer((req, res) => {
    const saida = http.request({ host: alvo.hostname, port: alvo.port, path: req.url, method: req.method, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    });
    saida.on('error', () => { try { res.writeHead(502); res.end(); } catch { /* conexão já fechada */ } });
    req.pipe(saida);
    res.on('close', () => saida.destroy());
  });
  servidor.listen(portaFixa, '127.0.0.1');
  return servidor;
}

repassar(PORTA_AUTH, identidade.url);
repassar(PORTA_BANCO, banco.url);
console.log(JSON.stringify({ auth: PORTA_AUTH, banco: `http://127.0.0.1:${PORTA_BANCO}`, identidadeReal: identidade.url, bancoReal: banco.url }));
