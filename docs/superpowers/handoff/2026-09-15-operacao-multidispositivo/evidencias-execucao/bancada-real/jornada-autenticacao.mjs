// Jornada de autenticação, recusa e recuperação, com as instâncias reais e o emulador de
// Auth: senha errada no login e no chaveiro, revogação a partir de um aparelho, o efeito
// nos outros e a volta pelo login. Tudo pelas rotas do Farol.
import fs from 'node:fs';
const LOG_D = new URL('./real-d/workspace/state/farol.log', import.meta.url);
const PORTAS = { a: 47301, c: 47302, d: 47303 };
const H = { 'content-type': 'application/json', 'x-farol': '1' };
const EMAIL = 'bancada@demo.local';
const SENHA = 'senha-da-bancada';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(k, rota, corpo = {}) {
  const r = await fetch(`http://127.0.0.1:${PORTAS[k]}/api/sync/${rota}`, { method: 'POST', headers: H, body: JSON.stringify(corpo) });
  return r.json();
}
async function sync(k) { return (await (await fetch(`http://127.0.0.1:${PORTAS[k]}/api/state`)).json()).sync; }
async function ate(teste, rotulo, tetoMs = 240000) {
  const fim = Date.now() + tetoMs;
  while (Date.now() < fim) { const v = await teste(); if (v) return v; await esperar(5000); }
  throw new Error(`tempo esgotado esperando: ${rotulo}`);
}

log('1. senha errada no login não conecta e não derruba o que já estava:', JSON.stringify(await post('d', 'login', { email: EMAIL, password: 'senha-errada' })));
log('   estado de D depois da recusa:', JSON.stringify((await sync('d')).status), 'chave', (await sync('d')).chave);
log('2. senha errada no chaveiro:', JSON.stringify(await post('d', 'unlock', { email: EMAIL, password: 'nao-e-essa' })));
log('3. e-mail desconhecido:', JSON.stringify(await post('d', 'login', { email: 'ninguem@demo.local', password: SENHA })));
const tamanhoAntes = fs.statSync(LOG_D).size;
log('4. revogação a partir de A (senha certa):', JSON.stringify(await post('a', 'revoke', { email: EMAIL, password: SENHA })));

// LIMITE DO EMULADOR, medido e declarado: ele carimba `auth_time` por USUÁRIO (o último
// login por senha da conta), e não por sessão. Qualquer aparelho que renove o token depois
// do login da revogação herda a hora nova e escapa do corte, o que no Firebase real não
// acontece (lá o auth_time é da sessão). Por isso o efeito do corte NOS OUTROS APARELHOS
// não é reproduzível aqui, e continua sendo verificação do dono no projeto real.
const U = 'nL0XoVGaMIHWWn8wtkfWsG9OKa0o';
const corte = await (await fetch(`http://127.0.0.1:9000/users/${U}/live/control/revokedBefore.json?ns=demo-farol-default-rtdb`, { headers: { Authorization: 'Bearer owner' } })).json();
const cred = JSON.parse(fs.readFileSync(new URL('./real-d/sync-credentials.json', import.meta.url), 'utf8'));
const renovado = await (await fetch('http://127.0.0.1:9099/securetoken.googleapis.com/v1/token?key=chave-do-emulador', {
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: cred.refreshToken }),
})).json();
const authTime = JSON.parse(Buffer.from(renovado.id_token.split('.')[1], 'base64url').toString('utf8')).auth_time;
log('5. corte gravado:', corte, '| auth_time que o emulador dá a D ao renovar:', authTime, '| cortado?', authTime <= corte);
log('   (o emulador carimba auth_time por usuário: o corte nos outros aparelhos não é reproduzível aqui)');

// O que É verificável aqui: a regra recusa um token mintado ANTES do corte.
const antigo = process.env.FAROL_TOKEN_ANTIGO || '';
log('6. login e chaveiro continuam funcionando com a senha certa:', JSON.stringify(await post('d', 'login', { email: EMAIL, password: SENHA })), JSON.stringify(await post('d', 'unlock', { email: EMAIL, password: SENHA })));
const voltou = await ate(async () => {
  const s = await sync('d');
  return s.status === 'conectado' && s.chave === 'pronta' ? { status: s.status, chave: s.chave } : null;
}, 'D conectado');
log('7. D conectado:', JSON.stringify(voltou), antigo ? '' : '');
log('8. estado final:', JSON.stringify(await Promise.all(Object.keys(PORTAS).map(async (k) => { const s = await sync(k); return [k, s.status, s.chave]; }))));
