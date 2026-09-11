// As funções PURAS da seção Sistema > Sincronização (ui/pure.js). Sem DOM: cada uma
// recebe a projeção `statusForUi` e a config, e devolve texto ou HTML.
//
// O que está em jogo aqui não é layout, é o que a tela AFIRMA. Dois casos já custaram
// caro no engine e são travados de novo deste lado: recibo que não é órfão não pode
// ganhar o botão que APAGA a prova de uma análise, e PR que este aparelho não acompanha
// não pode ser nomeado (o nome do PR nunca sobe pro banco, D6).
//
// fmtClock/fmtWhenDay formatam no fuso do processo; sem fixar, passa aqui e falha em
// outra máquina. Tem que vir ANTES do import.
process.env.TZ = 'America/Sao_Paulo';

import { test } from 'node:test';
import assert from 'node:assert/strict';
const P = await import('../ui/pure.js');

const CFG = { enabled: true, coordination: { enabled: true }, consolidation: { enabled: true }, apiKey: 'AIzaChave', databaseUrl: 'https://x-default-rtdb.firebaseio.com', deviceName: 'Notebook' };

function sync(extra = {}) {
  return {
    enabled: true, coordination: true, consolidation: true, status: 'conectado', lastError: null,
    uid: 'u1…', email: 'voce@exemplo.com', deviceId: 'dEu', deviceName: 'Notebook',
    devices: [], espera: {}, recibosVistos: {}, leasesVistos: {}, leasesOutros: 0, outbox: null, ...extra,
  };
}

/* ---------- estado ---------- */

test('syncEstado: um estado só, derivado do runtime', () => {
  assert.equal(P.syncEstado(sync({ enabled: false })), 'desligada');
  assert.equal(P.syncEstado(sync({ status: 'desligado' })), 'desligada');
  assert.equal(P.syncEstado(sync({ status: 'sem-credencial' })), 'sem-login');
  assert.equal(P.syncEstado(sync({ status: 'conectando' })), 'entrando');
  assert.equal(P.syncEstado(sync()), 'conectada');
  assert.equal(P.syncEstado(sync({ status: 'erro', lastError: { code: 'indisponivel' } })), 'degradada');
  assert.equal(P.syncEstado(sync({ status: 'erro', lastError: { code: 'credencial_invalida' } })), 'login-expirado');
  assert.equal(P.syncEstado(null), 'desligada', 'sem projeção nenhuma não inventa conexão');
});

test('syncSeloHtml e syncClasseCartao: a borda e o selo saem do MESMO estado', () => {
  assert.match(P.syncSeloHtml('conectada'), /sync-chip ok">conectado</);
  assert.match(P.syncSeloHtml('login-expirado'), /sync-chip bad">login expirado</);
  assert.equal(P.syncClasseCartao('conectada'), '');
  assert.equal(P.syncClasseCartao('degradada'), 'warn');
  assert.equal(P.syncClasseCartao('login-expirado'), 'bad');
  assert.equal(P.syncClasseCartao('desligada'), 'off');
  assert.equal(P.syncClasseCartao('inventado'), 'off', 'estado desconhecido cai no lado apagado');
});

/* ---------- interruptores ---------- */

test('syncTogglesHtml: a chave geral desabilita as outras duas', () => {
  const on = P.syncTogglesHtml(CFG);
  assert.match(on, /id="setSyncEnabled" checked/);
  assert.match(on, /id="setSyncCoordination" checked/);
  assert.doesNotMatch(on, /disabled/);

  const off = P.syncTogglesHtml({ enabled: false, coordination: { enabled: true }, consolidation: { enabled: true } });
  assert.doesNotMatch(off, /id="setSyncEnabled" checked/);
  assert.match(off, /id="setSyncCoordination" disabled/, 'sub-chave travada com a geral desligada');
  assert.doesNotMatch(off, /id="setSyncCoordination" checked/, 'e nunca marcada, porque não tem efeito nenhum');
  assert.match(off, /set-row off/);

  // O .switch tem que ser IRMÃO IMEDIATO do input: com a classe no próprio input, o
  // interruptor simplesmente NÃO APARECE, e a linha salva certo parecendo desligada.
  // Achado abrindo a tela de verdade no navegador, com a suíte inteira verde.
  assert.match(on, /<input type="checkbox" id="setSyncEnabled" checked><span class="switch"><\/span>/);
  assert.match(on, /<input type="checkbox" id="setSyncCoordination" checked><span class="switch"><\/span>/);
  assert.doesNotMatch(on, /input[^>]*class="switch"/, 'a classe nunca vai no input');
});

/* ---------- conexão e login ---------- */

test('syncContaHtml: conectado mostra quem é; desconectado pede e-mail e senha', () => {
  const dentro = P.syncContaHtml(sync());
  assert.match(dentro, /voce@exemplo\.com/);
  assert.match(dentro, /id="syncLogout"/);
  assert.doesNotMatch(dentro, /id="syncSenha"/);

  const fora = P.syncContaHtml(sync({ status: 'sem-credencial' }));
  assert.match(fora, /id="syncEmail"/);
  assert.match(fora, /id="syncSenha" class="sync-input" type="password"/, 'a senha nunca aparece em texto claro');
  assert.match(fora, />Entrar</);

  const expirado = P.syncContaHtml(sync({ status: 'erro', lastError: { code: 'credencial_invalida' } }));
  assert.match(expirado, />Entrar de novo</);
  assert.match(expirado, /recusou o acesso guardado/);
});

test('syncConexaoHtml: os campos vêm da config e a degradação diz o motivo do engine', () => {
  const html = P.syncConexaoHtml(sync(), CFG);
  assert.match(html, /id="syncApiKey" type="text" class="sync-input" value="AIzaChave"/);
  assert.match(html, /value="https:\/\/x-default-rtdb\.firebaseio\.com"/);
  assert.match(html, /value="Notebook"/);
  assert.match(html, /id="syncTest"/);
  assert.match(html, /id="syncErase"/);
  assert.doesNotMatch(html, /sync-degradada/);

  const ruim = P.syncConexaoHtml(sync({ status: 'erro', lastError: { code: 'indisponivel', motivo: 'o Firebase está indisponível ou sem rede' } }), CFG);
  assert.match(ruim, /sync-card warn/);
  assert.match(ruim, /sync-degradada/);
  assert.match(ruim, /o Firebase está indisponível ou sem rede/, 'o motivo é do engine, não uma frase genérica da tela');
});

test('syncEnvioHtml: sem outbox reconciliada não inventa número', () => {
  assert.equal(P.syncEnvioHtml(sync({ outbox: null })), '', 'null quer dizer "ainda não há número honesto"');
  assert.equal(P.syncEnvioHtml(sync({ consolidation: false, outbox: { pendentes: 3 } })), '', 'desligada não fala de envio');
  assert.match(P.syncEnvioHtml(sync({ outbox: { pendentes: 0, rejeitados: 0, lastSentAt: Date.now(), paused: false } })), /nada pendente/);
  assert.match(P.syncEnvioHtml(sync({ outbox: { pendentes: 12, rejeitados: 1, paused: false } })), /enviando o histórico/);
  assert.match(P.syncEnvioHtml(sync({ outbox: { pendentes: 12, rejeitados: 0, paused: true } })), /pausado/);
});

/* ---------- aparelhos ---------- */

test('syncAparelhosHtml: marca ESTE aparelho e nunca mostra lista vazia muda', () => {
  const agora = Date.UTC(2026, 8, 11, 15, 0, 0);
  const html = P.syncAparelhosHtml([
    { deviceId: 'dEu', name: 'Notebook', platform: 'win32', lastSeenAt: agora, euMesmo: true },
    { deviceId: 'dOutro', name: 'Celular', platform: 'linux', lastSeenAt: agora - 4 * 60000, euMesmo: false },
  ], agora);
  assert.match(html, /Notebook <span class="sync-chip mute">este<\/span>/);
  assert.doesNotMatch(html, /Celular <span class="sync-chip mute">este/);
  assert.match(html, /win32/);
  assert.match(P.syncAparelhosHtml([]), /Nenhum aparelho registrado ainda/);
});

/* ---------- coordenação agora ---------- */

test('syncCoordenacaoHtml: some inteira com a coordenação desligada', () => {
  assert.equal(P.syncCoordenacaoHtml(sync({ coordination: false, leasesVistos: { 'o/r#1': { deviceName: 'Celular' } } })), '');
});

test('syncCoordenacaoHtml: lease de outro aparelho é espera, em azul', () => {
  const html = P.syncCoordenacaoHtml(sync({ leasesVistos: { 'o/r#1': { deviceId: 'd2', deviceName: 'Celular', since: Date.UTC(2026, 8, 11, 17, 32), operationKind: 'review' } } }));
  assert.match(html, /o\/r#1/);
  assert.match(html, /sendo analisado no Celular/);
  assert.match(html, /sync-chip info/, 'espera é azul, nunca o vermelho do estacionamento');
  assert.doesNotMatch(html, /sync-redo/, 'lease vivo não oferece refazer: ninguém toma análise em andamento');
});

// A trava mais séria desta tela: o botão APAGA a prova de que uma análise foi feita.
// Recibo que não é órfão não pode oferecê-lo, senão a mesma análise é paga de novo em
// todo aparelho que a encontrar (ver recusaDoRefazer, em lib/engine/sync-redo.js).
test('syncCoordenacaoHtml: só o recibo ÓRFÃO ganha o botão de refazer', () => {
  const ativo = P.syncCoordenacaoHtml(sync({ recibosVistos: { 'o/r#2': { deviceName: 'Celular', at: Date.now(), publicationState: 'pending', orfao: 'ativo' } } }));
  assert.match(ativo, /sync-chip mute">pendente lá/);
  assert.doesNotMatch(ativo, /sync-redo/);

  const orfao = P.syncCoordenacaoHtml(sync({ recibosVistos: { 'o/r#3': { deviceName: 'Celular', at: Date.now(), publicationState: 'pending', orfao: 'orfao' } } }));
  assert.match(orfao, /class="btn sm sync-redo" data-key="o\/r#3"/);
  assert.match(orfao, /sync-o-que sync-orfao/);

  const desconhecido = P.syncCoordenacaoHtml(sync({ recibosVistos: { 'o/r#4': { deviceName: 'Celular', orfao: 'desconhecido' } } }));
  assert.doesNotMatch(desconhecido, /sync-redo/, 'falta de dado nunca libera o apagamento');
});

// D6: o nome do PR nunca sobe pro banco, então a tela só consegue CONTAR o que este
// aparelho não acompanha. Nomear seria inventar.
test('syncCoordenacaoHtml: PR que este aparelho não acompanha é contado, nunca nomeado', () => {
  const html = P.syncCoordenacaoHtml(sync({ leasesOutros: 3 }));
  assert.match(html, /e mais 3 em PR que este aparelho não acompanha/);
  assert.doesNotMatch(html, /sync-redo/);
  assert.match(P.syncCoordenacaoHtml(sync()), /Nenhum PR seu está sendo analisado/);
});

/* ---------- composição ---------- */

test('syncSecaoHtml: desligada mostra só os interruptores, sem campo nem login', () => {
  const html = P.syncSecaoHtml(sync({ enabled: false }), { enabled: false });
  assert.match(html, /setSyncEnabled/);
  assert.doesNotMatch(html, /syncApiKey/);
  assert.doesNotMatch(html, /syncLogin/);
  assert.doesNotMatch(html, /Coordenação agora/);
});

test('syncSecaoHtml: ligada monta interruptores, conexão, aparelhos e coordenação', () => {
  const html = P.syncSecaoHtml(sync({ devices: [{ deviceId: 'dEu', name: 'Notebook', platform: 'win32', lastSeenAt: Date.now(), euMesmo: true }] }), CFG);
  assert.match(html, /setSyncEnabled/);
  assert.match(html, /syncApiKey/);
  assert.match(html, /Aparelhos/);
  assert.match(html, /Coordenação agora/);
});

/* ---------- escape ---------- */

// A projeção carrega texto que vem do BANCO (nome de aparelho, escrito em outro
// aparelho) e do GitHub (chave do PR). Os dois entram como HTML nesta tela.
test('nome de aparelho e chave de PR vindos de fora são escapados', () => {
  const nome = '<img src=x onerror=alert(1)>';
  assert.doesNotMatch(P.syncAparelhosHtml([{ deviceId: 'd', name: nome, platform: '', lastSeenAt: 0, euMesmo: false }]), /<img/);
  const html = P.syncCoordenacaoHtml(sync({ leasesVistos: { '<b>x</b>#1': { deviceName: nome, since: 0 } } }));
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /<b>x<\/b>/);
});

/* ---------- U2: confirmações do clique manual ---------- */

// Cada motivo tem um desfecho DIFERENTE, e é essa escolha que a função carrega.
test('syncConfirmacaoDoClique: indisponível e recibo confirmam com override próprio', () => {
  const ind = P.syncConfirmacaoDoClique({ key: 'o/r#1', reason: 'indisponivel', detail: { motivo: 'sem rede' } });
  assert.equal(ind.tipo, 'confirma');
  assert.equal(ind.override, 'semCoordenacao');
  assert.equal(ind.titulo, 'Revisar sem coordenação?');
  assert.match(ind.corpo, /sem rede/);
  assert.match(ind.corpo, /o\/r#1/);

  const rec = P.syncConfirmacaoDoClique({ key: 'o/r#2', reason: 'recibo', detail: { deviceName: 'Celular', receipt: { completedAt: Date.now() } } });
  assert.equal(rec.tipo, 'confirma');
  assert.equal(rec.override, 'ignorarRecibo');
  assert.equal(rec.titulo, 'Revisar de novo este commit?');
  assert.match(rec.corpo, /Celular/);
});

// A trava desta parte: lease de outro aparelho NÃO tem override. O Farol nunca toma
// uma análise em andamento, e oferecer um botão que a tomasse seria o contrário disso.
test('syncConfirmacaoDoClique: lease alheio só avisa, e nunca oferece override', () => {
  const r = P.syncConfirmacaoDoClique({ key: 'o/r#3', reason: 'alheio', detail: { deviceName: 'Celular' } });
  assert.equal(r.tipo, 'aviso');
  assert.equal(r.override, undefined);
  assert.match(r.texto, /Celular/);
  assert.match(r.texto, /não toma uma análise em andamento/);
});

test('syncConfirmacaoDoClique: motivo desconhecido cai no aviso, nunca num override', () => {
  const r = P.syncConfirmacaoDoClique({ key: 'o/r#4', reason: 'inventado', detail: {} });
  assert.equal(r.tipo, 'aviso');
  assert.equal(r.override, undefined);
});

test('syncConfirmacoesDoClique: resposta sem coordenação não produz nada', () => {
  assert.deepEqual(P.syncConfirmacoesDoClique({ ok: true }), []);
  assert.deepEqual(P.syncConfirmacoesDoClique(null), []);
  assert.equal(P.syncConfirmacoesDoClique({ coordenacao: [{ key: 'a/b#1', reason: 'recibo', detail: {} }] }).length, 1);
});

/* ---------- U3: a nota no card da fila ---------- */

test('prCoordNoteHtml: espera vira nota azul; indisponível e teto viram âmbar', () => {
  const alheio = P.prCoordNoteHtml('o/r#1', { espera: { 'o/r#1': { reason: 'alheio', deviceName: 'Celular' } } });
  assert.match(alheio, /class="pr-coord"/, 'espera é azul, sem modificador');
  assert.match(alheio, /Em análise no Celular/);

  const ind = P.prCoordNoteHtml('o/r#1', { espera: { 'o/r#1': { reason: 'indisponivel' } } });
  assert.match(ind, /class="pr-coord warn"/);
  const teto = P.prCoordNoteHtml('o/r#1', { espera: { 'o/r#1': { reason: 'esgotado' } } });
  assert.match(teto, /class="pr-coord warn"/);
  assert.match(teto, /Teto de 3|Teto de rodadas/);

  assert.doesNotMatch(alheio + ind + teto, /pr-parked/, 'nunca o vermelho do estacionamento: segurar não é falhar');
});

test('prCoordNoteHtml: sem espera, o lease visto pelo stream ainda explica o card', () => {
  const html = P.prCoordNoteHtml('o/r#9', { leasesVistos: { 'o/r#9': { deviceName: 'Notebook' } } });
  assert.match(html, /Em análise no Notebook/);
  assert.equal(P.prCoordNoteHtml('o/r#9', {}), '');
  assert.equal(P.prCoordNoteHtml('o/r#9', null), '');
});

// Decisão registrada: o estacionamento VENCE. Ele é falha e exige ação; a espera se
// resolve sozinha. Duas notas competindo deixariam a mais urgente em segundo plano.
test('queueCardHtml: estacionamento vence a nota de coordenação', () => {
  const pr = { key: 'o/r#1', url: 'https://github.com/o/r/pull/1', title: 'T', author: 'a', updatedAt: new Date().toISOString() };
  const ctx = { people: {}, mark: { style: '', dot: '', chip: '' }, sync: { espera: { 'o/r#1': { reason: 'alheio', deviceName: 'Celular' } } } };
  const so = P.queueCardHtml(pr, ctx);
  assert.match(so, /pr-coord/);

  const com = P.queueCardHtml(pr, { ...ctx, parked: { 'o/r#1': { tipo: 'falha', motivo: 'caiu', at: Date.now() } } });
  assert.match(com, /pr-parked/);
  assert.doesNotMatch(com, /pr-coord/, 'uma nota só, e a que exige ação sua');
});

/* ---------- U4: consumo de todos os aparelhos ---------- */

const RESUMO = {
  devices: [
    { deviceId: 'dEu', name: 'Notebook', euMesmo: true, sessions: 671, costUsd: 2545.07, lastAt: Date.now() },
    { deviceId: 'dOutro', name: 'Celular', euMesmo: false, sessions: 18, costUsd: 66.33, lastAt: Date.now() - 7200000 },
  ],
  series: [],
  totals: { sessions: 689, costUsd: 2611.4, medido: { sessions: 680, costUsd: 2559.3 }, estimado: { sessions: 9, costUsd: 52.1 } },
};

test('usageConsolidatedHtml: soma todos e nomeia cada aparelho, marcando este', () => {
  const html = P.usageConsolidatedHtml(RESUMO);
  assert.match(html, /US\$ 2611\.40/);
  assert.match(html, /Notebook <span class="sync-chip mute">este<\/span>/);
  assert.match(html, /Celular/);
  assert.match(html, /US\$ 52\.10 estimado/);
});

test('usageConsolidatedHtml: sem aparelho nenhum diz isso, em vez de tabela vazia', () => {
  const html = P.usageConsolidatedHtml({ devices: [], totals: { sessions: 0, costUsd: 0 } });
  assert.match(html, /Nenhum aparelho enviou consumo ainda/);
  assert.match(html, /nenhum gasto na janela/);
});

// Tela vazia muda seria lida como "não gastei nada", que é uma afirmação que o app não
// pode fazer sem ter os dados.
test('usageConsolidadoEnvelopeHtml: recusa mostra o MOTIVO, nunca tela vazia', () => {
  const html = P.usageConsolidadoEnvelopeHtml({ ok: false, code: 'indisponivel', motivo: 'o Firebase está indisponível ou sem rede' });
  assert.match(html, /callout warn/);
  assert.match(html, /o Firebase está indisponível ou sem rede/);
  assert.match(html, /continua em "Este aparelho"/);
  assert.match(P.usageConsolidadoEnvelopeHtml(null), /o servidor não respondeu/);
  assert.match(P.usageConsolidadoEnvelopeHtml({ ok: true, resumo: RESUMO }), /US\$ 2611\.40/);
});

test('nome de aparelho vindo do banco é escapado também no consolidado', () => {
  const html = P.usageConsolidatedHtml({ devices: [{ deviceId: 'd', name: '<img src=x onerror=alert(1)>', sessions: 1, costUsd: 1, lastAt: 0 }], totals: { sessions: 1, costUsd: 1 } });
  assert.doesNotMatch(html, /<img/);
});
