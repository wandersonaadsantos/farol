// Monta um "aparelho" para os testes da arbitragem de postagem: uma Engine real com a
// coordenação ligada, o runtime da sincronização já conectado ao dublê do banco e um
// arquivo de registros de postagem próprio. Dois aparelhos no mesmo processo dividem o
// STATE_DIR (resolvido uma vez no import de lib/paths.js), então o que separa o estado
// local de cada um é `postagensArquivo`, exatamente o arquivo que a arbitragem lê.
// Sem import do server.js aqui: quem chama passa a classe, depois de fixar FAROL_HOME.
import fs from 'node:fs';
import path from 'node:path';

export function montarAparelho({ Engine, createRtdbClient, fake, token, deviceId, dir, relogio, conta = 'eu' }) {
  fs.mkdirSync(dir, { recursive: true });
  const e = new Engine();
  e.logs = [];
  e.log = (nivel, msg) => { e.logs.push(`${nivel} ${msg}`); };
  e.accountForPr = () => conta;
  e.tokenFor = () => 'tok-eu';
  e.token = 'tok-eu';
  e.refreshTokens = async () => { };
  e.ghEnv = () => ({});
  e.headSha = async () => relogio.head;
  e.prState = async () => 'OPEN';
  e.saveDecisions = () => { };
  e.pushState = () => { };
  e.writeMemory = () => { };
  e.skipComentado = {};
  e.postagensArquivo = path.join(dir, 'postagens.json');
  e.config.sync = { enabled: true, coordination: { enabled: true }, consolidation: { enabled: false } };
  const rt = {
    status: 'conectado', lastError: null, uid: 'u1', email: '', deviceId, deviceName: deviceId,
    client: createRtdbClient({ databaseUrl: fake.url, getIdToken: async () => ({ ok: true, idToken: token }) }),
    tokenSource: null, skewMs: 0, devices: {}, leasesVistos: {}, recibosVistos: {}, espera: {},
  };
  rt.agora = () => relogio.agora;
  e.sync = rt;
  e.toasts = [];
  e.on('toast', (t) => e.toasts.push(t));
  return e;
}
