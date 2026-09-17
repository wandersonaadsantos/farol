// Prova de PERMISSÃO da tomada de lease, com credencial de USUÁRIO: lê um lease vivo e
// escreve o sucessor exatamente como o produto escreve (lib/sync/tomada.js).
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=chave-do-emulador';
const B = 'http://127.0.0.1:9000';
const NS = 'demo-farol-default-rtdb';
const s = await (await fetch(AUTH, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'bancada@demo.local', password: 'senha-da-bancada', returnSecureToken: true }) })).json();
const u = s.localId;
const t = s.idToken;
const todas = await (await fetch(`${B}/users/${u}/leases.json?auth=${t}&ns=${NS}`)).json();
let acct = '';
let pr = '';
let lease = null;
for (const [a, prs] of Object.entries(todas || {})) {
  for (const [k, v] of Object.entries(prs || {})) if (Number(v.expiresAt) > Date.now()) { acct = a; pr = k; lease = v; }
}
if (!lease) { console.log('nenhum lease vivo agora'); process.exit(0); }
console.log('lease vivo de', lease.deviceId.slice(0, 8), 'takeoverSeq', lease.takeoverSeq, 'expira em', Math.round((lease.expiresAt - Date.now()) / 1000), 's');
const agora = Date.now();
const sucessor = {
  leaseId: `prova-${agora}`, deviceId: 'aparelho-de-prova', operationKind: lease.operationKind, headSha: lease.headSha || '',
  acquiredAt: agora, heartbeatAt: agora, expiresAt: agora + 180000, farolVersion: '2.59.5',
  takeoverSeq: (Number(lease.takeoverSeq) || 1) + 1, tomadoDe: lease.deviceId, tomadoEm: agora,
};
const url = `${B}/users/${u}/leases/${acct}/${pr}.json?auth=${t}&ns=${NS}`;
const r = await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sucessor) });
console.log('PUT sucessor:', r.status, (await r.text()).slice(0, 300));
if (r.ok) {
  const volta = await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...lease, expiresAt: Math.max(Number(lease.expiresAt), Date.now() + 60000), takeoverSeq: sucessor.takeoverSeq + 1, tomadoDe: sucessor.deviceId, tomadoEm: Date.now() }) });
  console.log('devolvido ao dono anterior:', volta.status);
}
