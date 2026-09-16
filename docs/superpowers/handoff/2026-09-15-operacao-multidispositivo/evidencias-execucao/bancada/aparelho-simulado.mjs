// Aparelho simulado da bancada: um Farol isolado, sem UI, rodando o relógio REAL da visão
// compartilhada (lib/engine/sync-andamento.js, `ciclo`) contra o banco de teste.
//
// FRONTEIRA SIMULADA, declarada: nada aqui fala com o GitHub nem abre sessão de IA.
//   - `doctorInfo` diz que há gh e Claude (capacidade publicada como apta);
//   - `headSha` responde o head fixo deste cenário (o executor confere o head por aqui);
//   - `enfileirarDaDistribuicao`, `enqueueHeadless`, `cancelSession` e `decide` só registram
//     o que teriam feito, no log deste processo, e a origem simula a sessão viva.
// Todos os gates de consentimento, assinatura, geração, autoridade, head, posse e admissão
// continuam os do engine.
//
// uso: node aparelho-simulado.mjs <raiz-do-farol> <pasta> <nome> <origem|destino> <senha> [porta]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [raiz, pasta, nome, papel, senha] = process.argv.slice(2);
const PR = { key: 'acme-exemplo/app-web#41', url: 'https://github.com/acme-exemplo/app-web/pull/41', title: 'Ajusta o rodapé do relatório', author: 'bruno-exemplo', repo: 'acme-exemplo/app-web', number: 41, account: 'alice' };
const HEAD = 'a'.repeat(40);
const registro = (evento, dados = {}) => console.log(JSON.stringify({ at: new Date().toISOString(), evento, ...dados }));

// a pasta é mantida entre reinícios: o id do aparelho mora nela
fs.mkdirSync(pasta, { recursive: true });
fs.writeFileSync(path.join(pasta, 'config.json'), JSON.stringify({
  autoReview: false,
  ghUser: 'alice',
  accounts: [{ user: 'alice', owners: ['acme-exemplo'] }],
  parallelReviews: 2,
  sync: {
    enabled: true, coordination: { enabled: true }, consolidation: { enabled: true },
    shared: { enabled: true }, distribution: { enabled: true }, aceitarAdmin: true,
    deviceName: nome, apiKey: 'chave-da-bancada', databaseUrl: 'http://127.0.0.1:47290', projectId: 'farol-bancada',
  },
}, null, 2));
process.env.FAROL_HOME = pasta;

const mod = (p) => pathToFileURL(path.join(raiz, p)).href;
const { Engine } = await import(mod('server.js'));
const andamento = (await import(mod('lib/engine/sync-andamento.js'))).default;
const syncMod = (await import(mod('lib/engine/sync.js'))).default;
const distribuicao = (await import(mod('lib/engine/sync-distribuicao.js'))).default;
const admissao = (await import(mod('lib/engine/admissao.js'))).default;

const e = new Engine();
e.log = (nivel, texto) => { if (nivel !== 'INFO') registro('log', { nivel, texto }); };
e.pushState = () => { };
e.doctorInfo = { claude: 'simulado', ghAuth: true };
e.headSha = async () => HEAD;
// uma sessão simulada segura a posse como a real (coordenação do engine); cancelar solta
const posses = new Map();
e.cancelSession = (id) => {
  registro('cancelou-sessao', { id });
  const posse = posses.get(id) || {};
  if (posse.handle && typeof posse.handle.abort === 'function') posse.handle.abort().catch(() => { });
  // a sessão que termina devolve a vaga da admissão, como o engine faz ao liberar o slot
  if (posse.vaga) admissao.liberar(e, posse.vaga);
  posses.delete(id);
  e.activeReviews.delete(id);
};
async function comecarSessao(id, extra = {}, { tomar = false, vaga = '' } = {}) {
  const adm = await e.syncAdmit({
    prKey: PR.key, account: 'alice', materialVersion: HEAD, headSha: HEAD, contaRodada: false, manual: false,
    semCoordenacao: false, ignorarRecibo: false, tomar, confirmado: tomar,
    pr: { key: PR.key, url: PR.url, repo: PR.repo, number: PR.number, author: PR.author, account: 'alice' },
    operationKind: 'review', opId: id,
  });
  // como o engine faz ao liberar o slot da sessão barrada: a reserva de admissão volta
  if (!adm || adm.admitted !== true) { if (vaga) admissao.liberar(e, vaga); registro('sessao-recusada', { id, motivo: adm && adm.reason }); return false; }
  posses.set(id, { handle: adm.handle, vaga });
  e.activeReviews.set(id, { id, keys: [PR.key], label: 'revisão', mode: 'auto', checkpoint: 'review', startedAt: Date.now(), model: 'Opus 5', pr: { ...PR }, headSha: HEAD, ...extra });
  e.activity.set(id, [{ t: Date.now(), k: 'tool', s: 'verificando' }]);
  registro('sessao-comecou', { id, tomar });
  return true;
}
e.enqueueHeadless = (pr) => { registro('enfileirou-local', { key: pr && pr.key }); return { ok: true }; };
e.decide = async (id, acao) => { registro('decidiu', { id, acao }); return { ok: true }; };
e.enfileirarDaDistribuicao = (item, vaga) => {
  registro('recebeu-do-conjunto', { key: item && item.key, tomarLease: !!(item && item.tomarLease), vaga: !!vaga });
  // o destino "começa" a análise pelo mesmo gate de posse de uma sessão real
  comecarSessao(`r-${Date.now()}`, { heranca: 'integral' }, { tomar: !!(item && item.tomarLease), vaga }).catch(() => { });
  return { ok: true };
};
if (e.sync.iniciando) await e.sync.iniciando;
const login = await e.syncLogin({ email: 'bancada@teste.local', password: senha });
if (!login.ok) throw new Error('login: ' + JSON.stringify(login));
const chave = await e.syncUnlock({ password: senha });
if (!chave.ok) throw new Error('chave: ' + JSON.stringify(chave));

if (papel === 'origem') {
  // o que a busca deste aparelho teria achado: sobe como Panorama e Meus PRs da conta
  e.panorama = [
    { key: 'acme-exemplo/app-web#40', url: 'https://github.com/acme-exemplo/app-web/pull/40', title: 'Atualiza os ícones', author: 'ana-exemplo', repo: 'acme-exemplo/app-web', number: 40, updatedAt: '2026-09-16T12:30:00Z', account: 'alice' },
    { key: 'acme-exemplo/app-web#38', url: 'https://github.com/acme-exemplo/app-web/pull/38', title: 'Melhora o log de erro', author: 'ana-exemplo', repo: 'acme-exemplo/app-web', number: 38, updatedAt: '2026-09-16T12:00:00Z', account: 'alice' },
    { key: 'acme-exemplo/api-pedidos#101', url: 'https://github.com/acme-exemplo/api-pedidos/pull/101', title: 'Corrige arredondamento', author: 'bruno-exemplo', repo: 'acme-exemplo/api-pedidos', number: 101, updatedAt: '2026-09-16T11:00:00Z', account: 'alice' },
  ];
  e.myPRs = [
    { key: 'acme-exemplo/app-web#36', url: 'https://github.com/acme-exemplo/app-web/pull/36', title: 'Adiciona filtro por status', author: 'alice', repo: 'acme-exemplo/app-web', number: 36, headRefName: 'feature/filtro-status', baseRefName: 'main', mergeable: 'MERGEABLE', account: 'alice' },
  ];
  await comecarSessao('a-1');
  // a busca "deu certo": sem isso o relógio não publica as listas (guarda do arranque a frio)
  e.ownersJaLidos.add('acme-exemplo');
  e.contasMeusPrsLidas.add('alice');
  // uma revisão concluída, que sobe para "Revisões de todos os aparelhos" (e pode ser repetida)
  e.decisions.resolved.unshift({
    id: 'd-1', key: 'acme-exemplo/app-web#40', createdAt: Date.now() + 1000, resolvedAt: Date.now() + 2000,
    verdict: 'approve', action: 'approve', status: 'posted', headSha: HEAD,
    pr: { key: 'acme-exemplo/app-web#40', url: 'https://github.com/acme-exemplo/app-web/pull/40', repo: 'acme-exemplo/app-web', number: 40, title: 'Atualiza os ícones', author: 'ana-exemplo', account: 'alice' },
    reasons: [], attention: [], reportMarkdown: 'Revisão simulada da bancada.',
  });
  e.decisions.pending = [{
    id: 'p-1', key: 'acme-exemplo/api-pedidos#109', createdAt: Date.now() - 900000,
    verdict: 'approve', action: 'approve', status: 'pending',
    pr: { key: 'acme-exemplo/api-pedidos#109', url: 'https://github.com/acme-exemplo/api-pedidos/pull/109', title: 'Separa filas de notificação', author: 'ana-exemplo', repo: 'acme-exemplo/api-pedidos', number: 109, account: 'alice' },
    reasons: [{ text: 'cobertura', kind: 'gate' }], attention: [],
  }];
}

// o destino também "vê" o PR na própria busca (mesma conta), e por isso publica o candidato;
// sem isso o conjunto não teria como colocar o item nele
function jaRoda() {
  return [...e.activeReviews.values()].some((s) => s && s.pr && s.pr.key === PR.key);
}

async function girar() {
  await syncMod.anunciarPresenca(e);
  if (papel === 'destino' && !jaRoda()) await distribuicao.publicarCandidato(e, e.config.sync, { ...PR, headSha: HEAD });
  const r = await andamento.ciclo(e, e.config.sync);
  return r && r.ok;
}

registro('pronto', { deviceId: e.sync.deviceId, nome, papel, primeiro: await girar() });
let emCurso = false;
setInterval(async () => {
  if (emCurso) return;
  emCurso = true;
  try { await girar(); } catch (err) { registro('erro', { texto: err && err.message }); } finally { emCurso = false; }
}, 5000);
