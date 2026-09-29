// Radar > Aparelhos (controle do celular, 28/09/2026): as funções puras da fila e do painel
// de um aparelho executor visto do admin. Desenho em
// docs/superpowers/specs/2026-09-28-controle-do-celular-anexos/HANDOFF-claude-design.md.
process.env.TZ = 'America/Sao_Paulo';

import { test } from 'node:test';
import assert from 'node:assert/strict';

const P = await import('../ui/pure.js');

const AGORA = Date.UTC(2026, 8, 28, 22, 0, 0);
const TAG = (c) => c.repeat(32);
const DEV = 'dCel';

function linha(key, estado, extra = {}) {
  return { key, url: `https://github.com/${key.replace('#', '/pull/')}`, title: `Título de ${key}`, author: 'bruno-exemplo', prTag: TAG(key.slice(-1)), fila: { estado, motivo: '', desde: 0, ate: 0, ...extra }, account: 'ana-exemplo' };
}

function listas(linhas, extra = {}) {
  return { estado: 'ligada', escopos: [{ tipo: 'panorama', dev: DEV, acctTag: TAG('f'), account: 'ana-exemplo', estado: 'lido', lidoEm: AGORA - 5000, linhas, ...extra }] };
}

const AP = { deviceId: DEV, nome: 'Celular da Ana', platform: 'Android', versao: '2.65.0', vistoEm: AGORA - 6000, abriu: true, pausado: false, paralelismo: 2, ocupadas: 1, iaPronta: true, aceitarAdmin: true, contas: [], falhas: [], publicadoEm: AGORA - 6000 };

/* ---------- a fila junta as três fontes ---------- */

test('itensDaFila: linha, pendência e sessão do MESMO aparelho, e pendência/sessão vencem a linha', () => {
  const itens = P.itensDaFila(DEV, {
    listas: listas([linha('acme-exemplo/loja-web#1', 'esperando'), linha('acme-exemplo/loja-web#2', 'visto')]),
    pendencias: [{ itemId: 'p1', dev: DEV, prTag: TAG('2'), veredito: 'approve', motivos: [{ text: 'a' }], pr: null }, { itemId: 'p9', dev: 'outro', prTag: TAG('9') }],
    operacoes: [{ opId: 'o3', dev: DEV, prTag: TAG('3'), tipo: 'review', pr: { key: 'acme-exemplo/loja-api#3' } }],
  });
  const porTag = Object.fromEntries(itens.map((i) => [i.prTag, i.fila.estado]));
  assert.deepEqual(porTag, { [TAG('1')]: 'esperando', [TAG('2')]: 'decidir', [TAG('3')]: 'revisando' });
  assert.equal(itens.find((i) => i.prTag === TAG('3')).key, 'acme-exemplo/loja-api#3', 'sessão sem linha usa o PR do catálogo');
});

test('contagemDaFila agrupa pelos cinco grupos do desenho', () => {
  const itens = ['decidir', 'revisando', 'esperando', 'sem-automatica', 'retry', 'estacionado', 'limite-plano', 'visto', 'ignorado'].map((e, i) => ({ prTag: String(i), fila: { estado: e } }));
  assert.deepEqual(P.contagemDaFila(itens), { tudo: 9, pedem: 1, revisando: 1, fila: 3, parados: 2, feitos: 2 });
});

/* ---------- falha não se disfarça de vazio ---------- */

test('carregando, falhou, vazia e versão antiga são quatro miolos diferentes', () => {
  const carregando = P.filaDoAparelhoHtml([], P.situacaoDaFila(DEV, { estado: 'aguardando', escopos: [] }), { nome: 'Celular da Ana' });
  const falhou = P.filaDoAparelhoHtml([], P.situacaoDaFila(DEV, listas([], { estado: 'falhou', falhaEm: AGORA })), { nome: 'Celular da Ana' });
  const vazia = P.filaDoAparelhoHtml([], P.situacaoDaFila(DEV, listas([])), { nome: 'Celular da Ana' });
  const antiga = P.filaDoAparelhoHtml([], P.situacaoDaFila(DEV, listas([]), { antigo: true }), { nome: 'Celular da Ana', versao: '2.58.0' });
  assert.match(carregando, /aria-busy="true"/);
  assert.match(falhou, /role="alert"/);
  assert.match(falhou, /não quer dizer que a fila está vazia/);
  assert.match(vazia, /Nada na fila do Celular da Ana/);
  assert.match(antiga, /Atualize o Farol no Celular da Ana/);
  assert.match(antiga, /2\.58\.0/);
  for (const [a, b] of [[carregando, falhou], [falhou, vazia], [vazia, antiga]]) assert.notEqual(a, b);
});

test('versão antiga com sessão ao vivo: o aviso fica em cima e a sessão continua visível', () => {
  const itens = [{ prTag: TAG('3'), key: 'acme-exemplo/loja-api#3', fila: { estado: 'revisando' }, op: { opId: 'o3', matTag: TAG('c'), msPorEtapa: {} } }];
  const html = P.filaDoAparelhoHtml(itens, { miolo: 'antiga' }, { nome: 'Celular', versao: '2.60.0' });
  assert.match(html, /Atualize o Farol/);
  assert.match(html, /md-cancelar" data-op="o3"/);
});

/* ---------- ações por estado ---------- */

function htmlDe(estado, ctx = {}) {
  const it = { ...linha('acme-exemplo/loja-web#1', estado), acctTag: TAG('f') };
  return P.filaDoAparelhoHtml([it], { miolo: 'lista', lidoEm: AGORA }, { nome: 'Celular da Ana', agora: AGORA, ...ctx });
}

test('cada estado oferece as ações do desenho, e limite do plano não oferece nenhuma', () => {
  assert.match(htmlDe('esperando'), /data-tipo="revisar"[^>]*>Revisar agora</);
  assert.match(htmlDe('esperando'), /data-tipo="ignorar"/);
  assert.match(htmlDe('sem-automatica'), /data-tipo="ligar-auto"[^>]*>Ligar a automática da conta</);
  assert.match(htmlDe('estacionado', {}), />Destravar e revisar</);
  assert.match(htmlDe('ignorado'), /data-tipo="restaurar"/);
  const limite = htmlDe('limite-plano');
  assert.doesNotMatch(limite, /ap-cmd/);
  assert.match(limite, /sem ação até o reset/);
});

test('ação desligada diz por quê (aria-disabled com title), e comando pendente trava a linha', () => {
  const sem = htmlDe('esperando', { desligado: 'Este aparelho não aceita comandos do admin.' });
  assert.match(sem, /aria-disabled="true" title="Este aparelho não aceita comandos do admin\."/);
  const pend = htmlDe('esperando', { pendenteDe: () => true });
  assert.match(pend, /title="Esperando o aparelho aplicar o comando anterior\."/);
});

test('decidir e cancelar não dependem da versão: só os comandos novos pedem atualização', () => {
  const antigo = { ...AP, versao: '2.60.0' };
  assert.match(P.motivoSemAcao(antigo, { podeComandar: true, agora: AGORA }), /Atualize o Farol/);
  assert.equal(P.motivoSemAcao(antigo, { podeComandar: true, agora: AGORA, novos: false }), '');
});

test('consentimento: só o "não aceita" explícito desliga; o desconhecido deixa o recibo responder', () => {
  assert.match(P.motivoSemAcao({ ...AP, aceitarAdmin: false }, { podeComandar: true, agora: AGORA }), /não aceita comandos do admin/);
  assert.equal(P.motivoSemAcao({ ...AP, aceitarAdmin: null }, { podeComandar: true, agora: AGORA }), '');
  assert.match(P.avisoDoAparelhoHtml({ ...AP, aceitarAdmin: false }, { agora: AGORA }), /Aceitar políticas e comandos do admin/);
  assert.equal(P.avisoDoAparelhoHtml({ ...AP, aceitarAdmin: null }, { agora: AGORA }), '');
});

test('sem sinal: o motivo diz há quanto tempo, e a fila vira a última conhecida', () => {
  const velho = { ...AP, vistoEm: AGORA - 2 * 3600 * 1000 };
  assert.equal(P.situacaoDoAparelho(velho, AGORA), 'sem-sinal');
  assert.match(P.motivoSemAcao(velho, { podeComandar: true, agora: AGORA }), /Sem sinal há 2 h/);
  assert.match(htmlDe('esperando', { semSinal: true }), /Última fila conhecida/);
});

test('versaoAntiga compara por número, não por texto', () => {
  assert.equal(P.versaoAntiga('2.9.0'), true);
  assert.equal(P.versaoAntiga('2.65.0'), false);
  assert.equal(P.versaoAntiga('2.100.0'), false);
  assert.equal(P.versaoAntiga(''), true);
});

/* ---------- executores ---------- */

test('executores: sem este aparelho e sem aposentado, e quem só apareceu no andamento entra', () => {
  const sync = {
    deviceId: 'dPc',
    devices: [{ deviceId: 'dPc', name: 'PC' }, { deviceId: DEV, name: 'Celular da Ana', farolVersion: '2.65.0' }, { deviceId: 'dVelho', name: 'Velho', retiredAt: 1 }],
    paineis: { aparelhos: [{ deviceId: DEV, abriu: true, aceitarAdmin: true, paralelismo: 2, contas: [] }] },
  };
  const lista = P.executoresDoConjunto(sync, [{ dev: 'dNovo', aparelho: 'Notebook' }, { dev: 'dPc' }]);
  assert.deepEqual(lista.map((a) => a.deviceId), [DEV, 'dNovo']);
  assert.equal(lista[0].aceitarAdmin, true);
  assert.equal(lista[1].aceitarAdmin, null, 'sem painel, consentimento desconhecido');
  assert.equal(lista[1].nome, 'Notebook');
});

/* ---------- contas e confirmação ---------- */

test('contas: o valor atual vem marcado, e o automático ligado avisa que o aparelho posta sozinho', () => {
  const ap = { ...AP, contas: [{ acctTag: TAG('f'), nome: 'ana-exemplo', politica: { autoReview: true, muted: false, onClean: 'approve', onCaveats: 'wait', onReject: 'wait' } }] };
  const html = P.contasDoAparelhoHtml(ap, {});
  assert.match(html, /aria-checked="true" class="ap-conta active"[^>]*data-campo="autoReview"[^>]*data-valor="true"/);
  assert.match(html, /<option value="approve" selected>aprova sozinho</);
  assert.match(html, /o aparelho posta a aprovação sozinho no GitHub/);
});

test('ligar aprovação automática pede confirmação; desligar não', () => {
  assert.equal(P.ligaAutomatico('onClean', 'approve'), true);
  assert.equal(P.ligaAutomatico('onReject', 'request_changes'), true);
  assert.equal(P.ligaAutomatico('onClean', 'wait'), false);
  assert.equal(P.ligaAutomatico('autoReview', true), false);
  const t = P.confirmacaoAutomatica('Celular da Ana', 'ana-exemplo', 'onClean');
  assert.equal(t.titulo, 'Deixar o Celular da Ana aprovar sozinho?');
  assert.equal(t.cancelar, 'Manter esperando você');
  assert.match(t.corpo, /com o nome de @ana-exemplo/);
});

/* ---------- retorno do comando ---------- */

test('retorno: enviado sem recibo, aplicado e recusado com o motivo do aparelho', () => {
  const cmd = { cmdId: TAG('1'), tipo: 'revisar', alvo: DEV, prTag: TAG('1'), at: AGORA - 3000, vence: AGORA + 600000 };
  const filtro = (c) => c.prTag === TAG('1');
  const enviado = P.retornoDoComando([cmd], {}, filtro, { agora: AGORA });
  assert.equal(enviado.pendente, true);
  assert.match(enviado.html, /enviado/);
  const aplicado = P.retornoDoComando([cmd], { [TAG('1')]: { estado: 'aplicado', at: AGORA } }, filtro, { agora: AGORA });
  assert.equal(aplicado.pendente, false);
  assert.match(aplicado.html, /sync-chip ok/);
  const recusado = P.retornoDoComando([cmd], { [TAG('1')]: { estado: 'recusado', code: 'saida-de-cena', at: AGORA } }, filtro, { agora: AGORA });
  assert.match(recusado.html, /outra pessoa já pegou este PR/);
  assert.equal(P.retornoDoComando([], {}, filtro).html, '');
});
