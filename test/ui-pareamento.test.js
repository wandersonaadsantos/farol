// A tela de pareamento (A4, brief B2 item 2.1). O que se prova aqui: a interface inteira é
// substituída quando a API exige credencial, a recusa diz qual é (com tentativas restantes),
// o que a pessoa digitou sobrevive à volta para esta tela, e o token só é guardado quando o
// servidor devolve um de verdade.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { instalarDom } from './helpers/dom-stub.js';

// a tela importa a infraestrutura das telas, que toca o DOM ao carregar
instalarDom();
const { pareamentoHtml, textoDaRecusa } = await import('../ui/pure.js');
const { submeterPareamento, precisaParear, rotuloSugerido, lerRascunho, gravarRascunho, limparRascunho } = await import('../ui/telas/pareamento.js');

const RAIZ = path.join(import.meta.dirname, '..');

function armazenamentoFalso() {
  const dados = new Map();
  return { getItem: (k) => (dados.has(k) ? dados.get(k) : null), setItem: (k, v) => dados.set(k, String(v)), removeItem: (k) => dados.delete(k), _dados: dados };
}

test('a recusa diz qual é, e a contagem só aparece quando existe', () => {
  assert.match(textoDaRecusa({ ok: false, code: 'codigo_invalido', restantes: 3 }), /não confere.*Restam 3 tentativas/);
  assert.match(textoDaRecusa({ ok: false, code: 'codigo_invalido', restantes: 1 }), /Resta 1 tentativa/);
  assert.match(textoDaRecusa({ ok: false, code: 'codigo_invalido', restantes: null }), /^Código não confere\.$/);
  assert.match(textoDaRecusa({ ok: false, code: 'bloqueado', restantes: 0 }), /Cinco tentativas erradas/);
  assert.match(textoDaRecusa({ ok: false, code: 'sem_codigo_pendente' }), /10 minutos ou já ter sido usado/);
  assert.match(textoDaRecusa(null), /não deu para falar com o Farol/i);
  assert.match(textoDaRecusa({ ok: false, code: 'inventado' }), /não deu para falar com o Farol/i);
});

test('o HTML traz os dois passos, o comando nas duas sintaxes e nenhum destino morto', () => {
  const html = pareamentoHtml({ rotuloSugerido: 'Chrome do celular', ehWindows: false });
  assert.match(html, /Parear este navegador/);
  assert.match(html, /node tools\/farol-parear\.js/);
  assert.ok(html.includes('node .\\tools\\farol-parear.js'), 'a sintaxe do PowerShell também aparece');
  assert.match(html, /id="parCodigo"/);
  assert.match(html, /id="parRotulo"/);
  assert.match(html, /value="Chrome do celular"/);
  assert.doesNotMatch(html, /<a /, 'nada de link nesta tela: não há para onde navegar antes de parear');
});

test('a sintaxe do sistema de quem está olhando vem primeiro', () => {
  const win = pareamentoHtml({ ehWindows: true });
  const posix = pareamentoHtml({ ehWindows: false });
  assert.ok(win.indexOf('PowerShell') < win.indexOf('Termux'));
  assert.ok(posix.indexOf('Termux') < posix.indexOf('PowerShell'));
});

test('o HTML escapa o que vem de fora', () => {
  const html = pareamentoHtml({ rotuloSugerido: '"><script>alert(1)</script>', recusa: '<img src=x onerror=alert(2)>' });
  assert.doesNotMatch(html, /<script|<img/i, 'nada do que veio de fora vira tag');
  assert.match(html, /&lt;script&gt;/, 'aparece como texto');
});

test('pareamento aceito guarda o token e recarrega a página', async () => {
  let guardado = '';
  let recarregou = false;
  let limpou = false;
  const token = 'c'.repeat(43);
  const r = await submeterPareamento({ codigo: 'K7QX2M9P4R', rotulo: 'Chrome' }, {
    pedir: async (corpo) => { assert.deepEqual(corpo, { codigo: 'K7QX2M9P4R', rotulo: 'Chrome' }); return { ok: true, token }; },
    salvar: (t) => { guardado = t; return true; },
    recarregar: () => { recarregou = true; },
    limpar: () => { limpou = true; },
  });
  assert.deepEqual(r, { ok: true, texto: '' });
  assert.equal(guardado, token);
  assert.equal(recarregou, true);
  assert.equal(limpou, true, 'o rascunho some depois que entrou');
});

test('recusa não guarda nada, não recarrega e devolve o texto', async () => {
  let guardou = false;
  let recarregou = false;
  const r = await submeterPareamento({ codigo: 'AAAAAAAAAA' }, {
    pedir: async () => ({ ok: false, code: 'codigo_invalido', restantes: 2 }),
    salvar: () => { guardou = true; return true; },
    recarregar: () => { recarregou = true; },
    limpar: () => { },
  });
  assert.equal(r.ok, false);
  assert.match(r.texto, /Restam 2 tentativas/);
  assert.equal(guardou, false);
  assert.equal(recarregou, false);
});

test('token com forma errada não entra: a resposta é tratada como recusa', async () => {
  let recarregou = false;
  const r = await submeterPareamento({ codigo: 'K7QX2M9P4R' }, {
    pedir: async () => ({ ok: true, token: 'curto-demais' }),
    salvar: () => false,
    recarregar: () => { recarregou = true; },
    limpar: () => { },
  });
  assert.equal(r.ok, false);
  assert.equal(recarregou, false);
});

test('o gate do boot só para a página quando a API exige e este navegador não tem credencial', async () => {
  const resposta = (corpo) => async (rota) => { assert.equal(rota, '/api/auth/status'); return corpo; };
  assert.equal(await precisaParear(resposta({ exigida: true, autenticado: false })), true);
  assert.equal(await precisaParear(resposta({ exigida: true, autenticado: true })), false);
  assert.equal(await precisaParear(resposta({ exigida: false, autenticado: false })), false);
  // servidor mudo (o get() da infraestrutura devolve null) não pode trancar ninguém fora
  assert.equal(await precisaParear(async () => null), false);
  assert.equal(await precisaParear(async () => { throw new Error('sem rede'); }), false);
});

test('o rascunho do que foi digitado sobrevive, e some quando pareia', () => {
  const arm = armazenamentoFalso();
  gravarRascunho({ codigo: 'K7QX', rotulo: 'Chrome' }, arm);
  assert.deepEqual(lerRascunho(arm), { codigo: 'K7QX', rotulo: 'Chrome' });
  limparRascunho(arm);
  assert.deepEqual(lerRascunho(arm), {});
  assert.deepEqual(lerRascunho({ getItem() { throw new Error('janela privada'); } }), {}, 'armazenamento bloqueado não derruba a tela');
});

test('o rótulo sugerido nomeia o navegador, sem inventar dado', () => {
  assert.equal(rotuloSugerido({ userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/140 Mobile Safari/537.36' }), 'Chrome do celular');
  assert.equal(rotuloSugerido({ userAgent: 'Mozilla/5.0 (Windows NT 10.0) Firefox/141.0' }), 'Firefox');
  assert.equal(rotuloSugerido({ userAgent: '' }), 'Navegador');
});

test('o bootstrap troca a interface inteira, e o stream avisa quando a credencial cai', () => {
  const app = fs.readFileSync(path.join(RAIZ, 'ui', 'app.js'), 'utf8');
  assert.match(app, /precisaParear/, 'o boot pergunta antes de conectar');
  assert.match(app, /montarPareamento/);
  assert.match(app, /nao-autenticado/, 'sessão revogada no meio do uso volta para o pareamento');
  const transporte = fs.readFileSync(path.join(RAIZ, 'ui', 'transporte.js'), 'utf8');
  const html = fs.readFileSync(path.join(RAIZ, 'ui', 'index.html'), 'utf8');
  assert.match(html, /id="pareamento"/);
  const css = fs.readFileSync(path.join(RAIZ, 'ui', 'app.css'), 'utf8');
  assert.match(css, /^body\.parear > \*:not\(\.par-raiz\) \{ display: none !important; \}$/m, 'com a tela de pareamento, o resto do app não é mostrado');
});

// Brief B2, item 2.1: sessão expirada ou revogada no meio do uso volta ao pareamento "sem
// perder o que o usuário estava digitando". O app fica só escondido enquanto a tela de
// pareamento está na frente; recarregar a página jogaria fora o que estava nos campos. Por
// isso, depois de parear, a volta mostra o app de novo e reconecta, sem recarregar.
test('depois de parear, o app volta a aparecer e reconecta, sem recarregar a página', async () => {
  const { voltarDoPareamento } = await import('../ui/telas/pareamento.js');
  const corpo = { classList: new Set(['parear']) };
  corpo.classList.remove = corpo.classList.delete;
  corpo.classList.contains = corpo.classList.has;
  const raiz = { hidden: false, innerHTML: '<form id="parForm"></form>' };
  const campoDoChat = { value: 'o que eu estava escrevendo' };
  let reconexoes = 0;
  voltarDoPareamento(raiz, () => { reconexoes += 1; }, corpo);
  assert.equal(corpo.classList.contains('parear'), false, 'o app volta a ser mostrado');
  assert.equal(raiz.hidden, true);
  assert.equal(raiz.innerHTML, '', 'a tela de pareamento sai do DOM, com o código digitado junto');
  assert.equal(reconexoes, 1, 'o stream reconecta uma vez, já com a credencial nova');
  assert.equal(campoDoChat.value, 'o que eu estava escrevendo', 'nada do app foi redesenhado');
});

test('o bootstrap usa a volta sem recarregar, e a reconexão fecha o stream anterior', () => {
  const app = fs.readFileSync(path.join(RAIZ, 'ui', 'app.js'), 'utf8');
  const troca = app.slice(app.indexOf('function trocarPeloPareamento('), app.indexOf('precisaParear().then'));
  assert.match(troca, /recarregar: \(\) => voltarDoPareamento\(raiz, connect\)/, 'a troca manda voltar sem recarregar');
  const conecta = app.slice(app.indexOf('function connect('), app.indexOf("es.addEventListener('state'"));
  assert.match(conecta, /if \(streamAtual\) streamAtual\.close\(\);/, 'o stream da credencial antiga não fica duplicando eventos');
});
