// Jornada de transferência e tomada com engines reais: tudo passa pelas rotas do Farol.
// uso: node jornada-transferencia.mjs <numero do PR novo>
import fs from 'node:fs';
const PORTAS = { a: 47301, c: 47302, d: 47303 };
const DEV = { a: '13d111c5-c1a6-4707-8f18-52996e6d4e9f', c: '59fce5ea-2f09-431e-9bac-3f8d64568ea0', d: '15292345-70d8-4c92-b1e0-26332c3fea7c' };
const nome = Object.fromEntries(Object.entries(DEV).map(([k, v]) => [v, k.toUpperCase()]));
const numero = Number(process.argv[2]);
const chave = `acme-exemplo/app-web#${numero}`;
const H = { 'content-type': 'application/json', 'x-farol': '1' };
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function estado(k) { return (await fetch(`http://127.0.0.1:${PORTAS[k]}/api/state`)).json(); }
async function post(k, rota, corpo) {
  return (await fetch(`http://127.0.0.1:${PORTAS[k]}/api/sync/${rota}`, { method: 'POST', headers: H, body: JSON.stringify(corpo) })).json();
}
function rodandoEm(j) { return (j.activeSessions || []).some((s) => [].concat(s.key || s.keys || []).includes(chave)); }
async function quemRoda() {
  const r = [];
  for (const k of Object.keys(PORTAS)) if (rodandoEm(await estado(k))) r.push(k);
  return r;
}
async function ate(teste, rotulo, tetoMs = 300000) {
  const fim = Date.now() + tetoMs;
  while (Date.now() < fim) { const v = await teste(); if (v) return v; await esperar(5000); }
  throw new Error(`tempo esgotado esperando: ${rotulo}`);
}
async function recibo(admin, cmdId) {
  return ate(async () => { const r = await post(admin, 'command-status', { cmdId }); return r.recibo ? r.recibo : null; }, `recibo ${cmdId}`);
}

const jaRevelado = process.argv[3] === '--existente';
if (!jaRevelado) {
const lista = JSON.parse(fs.readFileSync('prs.json', 'utf8'));
lista.push({ url: `https://github.com/acme-exemplo/app-web/pull/${numero}`, title: `PR de jornada ${numero}`, isDraft: false, author: { login: 'ana-exemplo' }, number: numero, repository: { nameWithOwner: 'acme-exemplo/app-web' }, updatedAt: new Date().toISOString(), labels: [] });
fs.writeFileSync('prs.json', JSON.stringify(lista, null, 2));
log('PR revelado', chave);
}

const origem = (await ate(async () => { const q = await quemRoda(); return q.length ? q : null; }, 'alguém executar'))[0];
log('executando em', origem.toUpperCase());
const cand = (await estado('c')).sync.distribuicao.candidatos.find((x) => x.pr && x.pr.key === chave);
const tags = { prTag: cand.prTag, matTag: cand.matTag };
log('tags', tags.prTag.slice(0, 8), tags.matTag.slice(0, 8));

const destinos = await post('c', 'transfer-targets', { dono: DEV[origem], acctTag: cand.acctTag, itemId: cand.itemId });
log('destinos oferecidos:', JSON.stringify(destinos));
const apto = destinos.destinos.find((d) => d.apto && !d.souEu);
if (!apto) throw new Error('nenhum destino apto oferecido');
const destino = nome[apto.deviceId].toLowerCase();
log('destino escolhido', destino.toUpperCase());
const t = await post('c', 'command', { alvo: DEV[origem], tipo: 'transferir', args: { ...tags, destino: DEV[destino] } });
log('transferir', JSON.stringify(t));
log('recibo da transferência', JSON.stringify(await recibo('c', t.cmdId)));
await ate(async () => (await quemRoda()).join('') === destino, `sessão no destino ${destino.toUpperCase()}`);
log('TRANSFERÊNCIA CONCLUÍDA: agora executa em', destino.toUpperCase(), 'e a origem parou');

const tomador = origem;
const k = await post('c', 'command', { alvo: DEV[tomador], tipo: 'tomar', args: { ...tags, confirmado: true } });
log('tomar', JSON.stringify(k));
log('recibo da tomada', JSON.stringify(await recibo('c', k.cmdId)));
await ate(async () => (await quemRoda()).join('') === tomador, `sessão de volta em ${tomador.toUpperCase()}`);
log('TOMADA CONCLUÍDA: executa em', tomador.toUpperCase());
const sofrida = (await estado(destino)).sync;
log('tomadas sofridas no destino anterior:', JSON.stringify(sofrida.tomadasSofridas || []));
log('tomadas registradas no tomador:', JSON.stringify((await estado(tomador)).sync.tomadas || []));
