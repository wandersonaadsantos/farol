// A fiação das divergências resolvidas em Sistema > Aparelhos e Grupos de consumo
// (ui/telas/sistema-aparelhos.js e ui/telas/sistema-grupos.js), com rede e modal de
// mentira, no padrão de test/ui-telas-aparelhos-grupos.test.js. O que se prova aqui é
// COMPORTAMENTO: qual rota é chamada, com que corpo, e o que a tela desenha com a resposta.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { instalarDom } from './helpers/dom-stub.js';

instalarDom();
const { definirEstado } = await import('../ui/telas/estado.js');
const AP = await import('../ui/telas/sistema-aparelhos.js');
const GR = await import('../ui/telas/sistema-grupos.js');

const RAIZ = path.join(import.meta.dirname, '..');
const ID = 'b'.repeat(32);

function deps({ respostas = {}, confirma = true, valor = '' } = {}) {
  const chamadas = [];
  const avisos = [];
  const pendentes = [];
  const d = {
    chamadas, avisos, pendentes, confirmacoes: 0, recarregou: false, durante: [],
    api: async (rota, corpo) => {
      chamadas.push({ rota, corpo });
      d.durante.push(document.querySelector('#devicesManager').innerHTML);
      return Object.hasOwn(respostas, rota) ? respostas[rota] : { ok: true };
    },
    get: async () => null,
    toast: (tipo, texto) => avisos.push({ tipo, texto }),
    confirmarComCampo: async () => { d.confirmacoes++; return { ok: confirma, valor }; },
    confirmModal: async () => { d.confirmacoes++; return confirma; },
    recarregar: () => { d.recarregou = true; },
    idSorteado: () => ID,
    anotarPendente: (p) => pendentes.push(p),
  };
  return d;
}

function estadoCom(sync = {}, cfgSync = {}, extra = {}) {
  definirEstado({
    config: { sync: { enabled: true, aceitarAdmin: true, ...cfgSync }, claudeProfiles: [{ id: 'pLab', label: 'Laboratório', kind: 'apikey' }] },
    sync: { enabled: true, shared: true, devices: [], coberturaPostagem: [], gruposDeConsumo: [], ...sync },
    ...extra,
  });
}

const ADMIN_VIVO = { deviceId: 'dEu', generation: 1, souEu: true, fresca: true, ultimoBatimentoEm: 1 };
const DEVICES = [{ deviceId: 'dEu', name: 'Notebook de teste', euMesmo: true }, { deviceId: 'dX', name: 'Desktop antigo', euMesmo: false }];

/* ---------- item 2: a política abre com o valor vigente ---------- */

test('item 2: abrir a política desenha "lendo", pede a leitura e redesenha com a versão publicada', async () => {
  estadoCom({ admin: ADMIN_VIVO, devices: DEVICES });
  const d = deps({ respostas: { '/api/sync/policy-read': { ok: true, existe: true, valida: true, versao: 4, politica: { pausado: true, tetoParalelismo: 3 } } } });
  await AP.abrirPolitica('dX', d);
  assert.deepEqual(d.chamadas, [{ rota: '/api/sync/policy-read', corpo: { deviceId: 'dX' } }]);
  assert.match(d.durante[0], /lendo a política vigente/, 'enquanto lê, a tela diz que está lendo');
  const html = document.querySelector('#devicesManager').innerHTML;
  assert.match(html, /publicada, versão 4/);
  assert.match(html, /id="aparPolPausado" checked/);
  assert.match(html, /<option value="3" selected>/);
});

test('item 2: leitura que falha vira falha com motivo, nunca "sem política"', async () => {
  assert.deepEqual(await AP.lerPoliticaAtual('dX', deps({ respostas: { '/api/sync/policy-read': null } })), { estado: 'falha', motivo: 'o servidor não respondeu' });
  const recusa = await AP.lerPoliticaAtual('dX', deps({ respostas: { '/api/sync/policy-read': { ok: false, code: 'indisponivel', motivo: 'não deu para ler a política agora' } } }));
  assert.deepEqual(recusa, { estado: 'falha', motivo: 'não deu para ler a política agora' });
  const vazia = await AP.lerPoliticaAtual('dX', deps({ respostas: { '/api/sync/policy-read': { ok: true, existe: false } } }));
  assert.deepEqual(vazia, { estado: 'ok', existe: false, valida: false, versao: 0, politica: null });
});

test('item 2: abrir sem ser o admin com batimento não lê nada', async () => {
  estadoCom({ admin: { ...ADMIN_VIVO, fresca: false }, devices: DEVICES });
  const d = deps();
  await AP.abrirPolitica('dX', d);
  assert.equal(d.chamadas.length, 0);
});

/* ---------- item 1: publicar diz a versão, não o aceite ---------- */

test('item 1: publicar avisa a versão publicada, sem prometer o aceite do destino', async () => {
  const d = deps({ respostas: { '/api/sync/policy': { ok: true, versao: 6 } } });
  assert.equal(await AP.publicarPolitica('dX', { pausado: false, tiposDeOperacao: [] }, d), '');
  assert.match(d.avisos.at(-1).texto, /versão 6/);
  assert.match(d.avisos.at(-1).texto, /se aceitar admin/);
});

/* ---------- item 3: recusar a designação ---------- */

test('item 3: recusar a designação confirma, chama a rota e diz o desfecho', async () => {
  const negado = deps({ confirma: false });
  assert.equal(await AP.recusarDesignacao(negado), false);
  assert.equal(negado.chamadas.length, 0);
  const d = deps();
  assert.equal(await AP.recusarDesignacao(d), true);
  assert.deepEqual(d.chamadas, [{ rota: '/api/sync/designation-decline', corpo: {} }]);
  assert.equal(d.avisos.at(-1).tipo, 'ok');
  const falha = deps({ respostas: { '/api/sync/designation-decline': { ok: false, code: 'sem-pedido', motivo: 'não há pedido de designação esperando neste aparelho' } } });
  assert.equal(await AP.recusarDesignacao(falha), false);
  assert.match(falha.avisos.at(-1).texto, /não há pedido de designação/);
});

/* ---------- itens 8 e 9: limpeza em andamento e desfecho por categoria ---------- */

test('item 8: enquanto a limpeza pedida daqui corre, a seção diz "limpando" e não oferece outra', async () => {
  estadoCom({ admin: ADMIN_VIVO, devices: DEVICES });
  const d = deps({ valor: 'segredo-de-teste', respostas: { '/api/sync/cleanup': { ok: true, apagadas: ['panorama'], falharam: [], corteGravado: true }, '/api/sync/cleanup-state': { ok: true, estado: 'ligada', travada: null, categorias: [], nuncaApagadas: [] } } });
  await AP.aoLimpar(d);
  const naHora = d.durante[0];
  assert.match(naHora, /sync-chip warn">limpando</);
  assert.doesNotMatch(naHora, /id="aparLimpar"/);
  assert.equal(d.chamadas[1].rota, '/api/sync/cleanup-state', 'depois do ato a chave é relida');
  assert.doesNotMatch(document.querySelector('#devicesManager').innerHTML, />limpando</, 'terminado, o estado sai');
});

test('item 9: limpeza parcial avisa como erro, nomeando o que ficou', async () => {
  const d = deps({ valor: 's', respostas: { '/api/sync/cleanup': { ok: true, apagadas: ['panorama'], falharam: ['usageDaily'], corteGravado: true } } });
  assert.equal(await AP.limparDados(d), true);
  assert.equal(d.avisos.at(-1).tipo, 'error');
  assert.match(d.avisos.at(-1).texto, /consumo diário/);
});

test('item 17: os modais de limpar e revogar levam o campo com o olho', async () => {
  const corpos = [];
  const d = deps({ confirma: false });
  d.confirmarComCampo = async (opcoes) => { corpos.push(opcoes.body); return { ok: false, valor: '' }; };
  await AP.limparDados(d);
  await AP.revogarConjunto(d);
  for (const b of corpos) assert.match(b, /data-olho-de="aparModalSenha"/);
});

/* ---------- item 17: o olho alterna o campo certo ---------- */

function campoFalso(tipo) { return { type: tipo }; }

function botaoFalso(alvo, pressionado) {
  const b = { dataset: { olhoDe: alvo }, attributes: { 'aria-pressed': pressionado }, innerHTML: '' };
  b.getAttribute = (k) => b.attributes[k];
  b.setAttribute = (k, v) => { b.attributes[k] = String(v); };
  return b;
}

test('item 17: o olho alterna o tipo do campo que ele nomeia, e o estado fica no aria-pressed', () => {
  const campo = campoFalso('password');
  const raiz = { querySelector: (sel) => (sel === '#aparSenhaAdmin' ? campo : null) };
  const b = botaoFalso('aparSenhaAdmin', 'false');
  assert.equal(AP.alternarOlho(b, raiz), true);
  assert.equal(campo.type, 'text');
  assert.equal(b.attributes['aria-pressed'], 'true');
  assert.equal(b.attributes['aria-label'], 'Ocultar senha');
  assert.match(b.innerHTML, /<svg/);
  AP.alternarOlho(b, raiz);
  assert.equal(campo.type, 'password');
  assert.equal(b.attributes['aria-pressed'], 'false');
  assert.equal(AP.alternarOlho(botaoFalso('naoExiste', 'false'), raiz), false, 'sem campo, nada muda');
});

/* ---------- item 16: o cartão do que não está valendo ---------- */

test('item 16: a seção Aparelhos recebe as capacidades do snapshot', () => {
  const capacidades = { autenticacaoLocal: { modoCelular: true, exigida: false }, compartilhamento: { pedido: false, aplicado: false }, tetoGrupo: { configurado: false, aplicado: false } };
  estadoCom({ admin: ADMIN_VIVO, devices: DEVICES }, {}, { capacidades });
  AP.renderAparelhos();
  assert.match(document.querySelector('#devicesManager').innerHTML, /apar-so-estreito[\s\S]*Autenticação da API local/);
});

/* ---------- item 13: grupo publicado esperando o aceite ---------- */

test('item 13: salvar grupo anota o pendente com a versão, e a seção o mostra até ele chegar', async () => {
  const d = deps({ respostas: { '/api/sync/group': { ok: true, versao: 2 } } });
  assert.equal(await GR.salvarGrupo({ nome: 'Time', periodo: 'mes', teto: '' }, null, d), true);
  assert.deepEqual(d.pendentes, [{ id: ID, nome: 'Time', versao: 2 }]);
  const falha = deps({ respostas: { '/api/sync/group': { ok: false, code: 'nao-e-admin', motivo: 'x' } } });
  await GR.salvarGrupo({ nome: 'Time', periodo: 'mes', teto: '' }, null, falha);
  assert.deepEqual(falha.pendentes, [], 'o que não foi publicado não espera aceite');
  GR.anotarPendente({ id: ID, nome: 'Time', versao: 2 });
  estadoCom({ admin: ADMIN_VIVO, gruposDeConsumo: [] });
  GR.renderGrupos();
  assert.match(document.querySelector('#groupsManager').innerHTML, /Time[\s\S]*publicado na versão 2/);
  estadoCom({ admin: ADMIN_VIVO, gruposDeConsumo: [{ id: ID, nome: 'Time', estado: 'sem-teto', requisitos: [] }] });
  GR.renderGrupos();
  assert.doesNotMatch(document.querySelector('#groupsManager').innerHTML, /esperando o aceite/, 'chegou pelo snapshot, sai dos pendentes');
});

/* ---------- item 12: o vínculo do snapshot chega à seção ---------- */

test('item 12: a seção de grupos usa o vínculo do snapshot', () => {
  estadoCom({ admin: ADMIN_VIVO, gruposDeConsumo: [], vinculosDePerfis: { pLab: { grupo: 'e'.repeat(32), tipo: 'api', desde: 1 } } });
  GR.renderGrupos();
  const html = document.querySelector('#groupsManager').innerHTML;
  assert.match(html, /vinculado a um grupo que não chegou a este aparelho/);
  assert.match(html, /data-grupo-desvincular="pLab"/);
});

/* ---------- item 18 e 16: o CSS do estreito ---------- */

function blocoDaQuebra(css, largura, marcador) {
  const inicio = css.indexOf(marcador);
  assert.ok(inicio >= 0, `marcador ${marcador} não achado`);
  const i = css.indexOf(`@media (max-width: ${largura}px)`, inicio);
  assert.ok(i >= 0, `quebra de ${largura} depois de ${marcador} não achada`);
  return css.slice(i, css.indexOf('\n}', i));
}

test('item 18: no estreito a linha do navegador mostra pareado e usado, e o cartão do estreito só aparece lá', () => {
  const css = fs.readFileSync(path.join(RAIZ, 'ui', 'app.css'), 'utf8');
  const marcador = '/* ---------- divergências de Aparelhos e Grupos';
  const i = css.indexOf(marcador);
  assert.ok(i > css.indexOf('.sync-linha > :nth-child(2), .sync-linha > :nth-child(3) { display: none; }'), 'a regra nova vem DEPOIS da que esconde, para vencer na cascata');
  assert.match(css.slice(i), /\.apar-so-estreito \{ display: none; \}/);
  const quebra = blocoDaQuebra(css, 720, marcador);
  assert.match(quebra, /\.sync-linha\.apar-sessao > :nth-child\(2\), \.sync-linha\.apar-sessao > :nth-child\(3\) \{ display: (block|inline); \}/);
  assert.match(quebra, /\.apar-so-estreito \{ display: block; \}/);
});
