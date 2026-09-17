// Teste de permissão com CREDENCIAL DE USUÁRIO (nunca owner): escreve um candidato na
// forma do produto em live/queue e mostra a resposta do emulador com as regras do commit.
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=chave-do-emulador';
const BANCO = 'http://127.0.0.1:9000';
const NS = 'demo-farol-default-rtdb';

const r = await fetch(AUTH, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'bancada@demo.local', password: 'senha-da-bancada', returnSecureToken: true }) });
const s = await r.json();
if (!s.idToken) { console.log('login falhou', s); process.exit(1); }
const uid = s.localId;
const agora = Date.now();
const enc = `e1.g1.${'A'.repeat(20)}.${'B'.repeat(20)}.${'C'.repeat(20)}`;
const candidato = {
  itemId: 'aaaa1111_bbbb2222', prTag: 'aaaa1111', matTag: 'bbbb2222', acctTag: 'cccc3333',
  orgTag: 'dddd4444', isDraft: false, rodadaAutomatica: true, publishedAt: agora,
  ttl: agora + 10 * 60 * 1000, enc,
};
const caminho = `/users/${uid}/live/queue/${candidato.itemId}/dev-de-prova.json?auth=${s.idToken}`;
const w = await fetch(`${BANCO}${caminho}&ns=${NS}`, { method: 'PUT', body: JSON.stringify(candidato) });
console.log('PUT candidato:', w.status, (await w.text()).slice(0, 400));
const leitura = await fetch(`${BANCO}/users/${uid}/live/queue.json?auth=${s.idToken}&ns=${NS}`);
console.log('GET queue:', leitura.status, (await leitura.text()).slice(0, 300));
