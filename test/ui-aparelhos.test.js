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

// 29/09/2026: o dono respeita aparelho de terceiro no mesmo conjunto; só entra na aba quem
// ligou, nele mesmo, "Aceitar políticas e comandos do admin", e publicou isso no painel.
test('executores: só quem aceitou explicitamente; não aceitou, desconhecido, aposentado e este ficam de fora', () => {
  const sync = {
    deviceId: 'dPc',
    devices: [
      { deviceId: 'dPc', name: 'PC' }, { deviceId: DEV, name: 'Celular da Ana', farolVersion: '2.65.0' },
      { deviceId: 'dTerceiro', name: 'Notebook do colega' }, { deviceId: 'dSemPainel', name: 'Tablet' },
      { deviceId: 'dVelho', name: 'Velho', retiredAt: 1 },
    ],
    paineis: { aparelhos: [
      { deviceId: DEV, abriu: true, aceitarAdmin: true, paralelismo: 2, contas: [] },
      { deviceId: 'dTerceiro', abriu: true, aceitarAdmin: false, contas: [] },
      { deviceId: 'dVelho', abriu: true, aceitarAdmin: true, contas: [] },
      { deviceId: 'dPc', abriu: true, aceitarAdmin: true, contas: [] },
    ] },
  };
  assert.deepEqual(P.executoresDoConjunto(sync).map((a) => a.deviceId), [DEV]);
  assert.deepEqual([...P.aparelhosQueAceitam(sync)].sort(), [DEV, 'dPc', 'dVelho'].sort(), 'o conjunto de quem aceitou vem só do painel');
  assert.match(P.nenhumExecutorHtml(), /Nenhum aparelho aceitou o controle deste computador/);
  assert.match(P.nenhumExecutorHtml(), /Aceitar políticas e comandos do admin/);
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

// 29/09/2026: com o aparelho vivo, a tela dizia "sem sinal há 6 min" e bloqueava os
// comandos, porque só olhava a presença (carimbada a cada 5 min) numa janela de 3 min.
test('vivo pelo sinal mais recente: presença, painel publicado ou andamento ao vivo', () => {
  const base = { deviceId: 'dPc', devices: [{ deviceId: 'dPc' }, { deviceId: DEV, name: 'Celular', farolVersion: '2.65.2', lastSeenAt: AGORA - 6 * 60000 }] };
  const painel = (extra) => ({ ...base, paineis: { aparelhos: [{ deviceId: DEV, aceitarAdmin: true, contas: [], ...extra }] } });
  const presenca6min = P.executoresDoConjunto(painel({}))[0];
  assert.equal(P.situacaoDoAparelho(presenca6min, AGORA), 'vivo', 'presença de 6 min está dentro do ritmo de 5 min dela');
  assert.equal(P.motivoSemAcao(presenca6min, { podeComandar: true, agora: AGORA }), '');
  const velho = { ...base, devices: [{ deviceId: 'dPc' }, { deviceId: DEV, farolVersion: '2.65.2', lastSeenAt: AGORA - 40 * 60000 }] };
  const comPainel = P.executoresDoConjunto({ ...velho, paineis: { aparelhos: [{ deviceId: DEV, aceitarAdmin: true, contas: [], publicadoEm: AGORA - 60000 }] } })[0];
  assert.equal(P.situacaoDoAparelho(comPainel, AGORA), 'vivo', 'painel de 1 min atrás prova sinal');
  const soAndamento = P.executoresDoConjunto({ ...velho, paineis: { aparelhos: [{ deviceId: DEV, aceitarAdmin: true, contas: [] }] } }, { aoVivo: { [DEV]: AGORA - 10000 } })[0];
  assert.equal(P.situacaoDoAparelho(soAndamento, AGORA), 'vivo', 'andamento lido há 10 s prova sinal');
  const semNada = P.executoresDoConjunto({ ...velho, paineis: { aparelhos: [{ deviceId: DEV, aceitarAdmin: true, contas: [] }] } })[0];
  assert.equal(P.situacaoDoAparelho(semNada, AGORA), 'sem-sinal', 'sem sinal nenhum há 40 min continua sem sinal');
});
