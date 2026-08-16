'use strict';
// Estrutura semântica da UI, verificada direto no ui/index.html.
//
// Por que existe: `npm run check` só valida sintaxe de JS, e não há teste nenhum de UI.
// Toda a semântica de tela (o h1, as abas como tablist, os ícones marcados como
// decorativos, os campos com rótulo) foi acrescentada de uma vez, e sem isto aqui ela
// regride calada: HTML errado não quebra nada, só piora para quem usa leitor de tela ou
// navega por teclado.
//
// Sem DOM e sem dependência: o HTML é lido como texto e conferido por regex. Isso limita
// o que dá pra afirmar (não valida aninhamento), então cada teste checa um invariante
// simples e verificável assim, e o resto fica pra verificação no navegador.
const path = require('node:path');
const fs = require('node:fs');

const { test } = require('node:test');
const assert = require('node:assert/strict');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'ui', 'index.html'), 'utf8');
const APPJS = fs.readFileSync(path.join(__dirname, '..', 'ui', 'app.js'), 'utf8');

const todos = (re, s = HTML) => [...s.matchAll(re)];
const attr = (tagTrecho, nome) => (tagTrecho.match(new RegExp(nome + '="([^"]*)"')) || [])[1];

test('a página tem exatamente um h1, e é o nome do app', () => {
  const h1 = todos(/<h1[^>]*>([\s\S]*?)<\/h1>/g);
  assert.equal(h1.length, 1, 'zero h1 deixa o documento sem título; mais de um confunde a estrutura');
  assert.match(h1[0][1], /Farol/);
});

test('todo id do documento é único', () => {
  // aria-controls e aria-labelledby resolvem por id: id repetido aponta pro elemento errado
  const ids = todos(/\sid="([^"]+)"/g).map(m => m[1]);
  const repetidos = [...new Set(ids.filter((x, i) => ids.indexOf(x) !== i))];
  assert.deepEqual(repetidos, [], `ids repetidos: ${repetidos.join(', ')}`);
});

test('as abas do topo formam um tablist completo', () => {
  const nav = HTML.match(/<nav class="tabs"[^>]*>([\s\S]*?)<\/nav>/);
  assert.ok(nav, 'a nav das abas existe');
  assert.match(nav[0], /role="tablist"/);
  assert.match(nav[0], /aria-label="[^"]+"/, 'tablist sem rótulo não diz de que é a navegação');
  const botoes = todos(/<button[^>]*class="nav-item[^"]*"[^>]*>/g, nav[1]);
  assert.equal(botoes.length, 6, 'as 6 abas do app');
  for (const [b] of botoes) {
    assert.match(b, /role="tab"/, `sem role=tab: ${b}`);
    assert.match(b, /aria-selected="(true|false)"/, `sem aria-selected: ${b}`);
    assert.match(b, /aria-controls="tab-[a-z]+"/, `sem aria-controls: ${b}`);
  }
  const selecionados = botoes.filter(([b]) => /aria-selected="true"/.test(b));
  assert.equal(selecionados.length, 1, 'exatamente uma aba começa selecionada');
});

test('a sidebar do Sistema também é um tablist completo', () => {
  const nav = HTML.match(/<nav class="sys-nav"[^>]*>([\s\S]*?)<\/nav>/);
  assert.ok(nav);
  assert.match(nav[0], /role="tablist"/);
  const botoes = todos(/<button[^>]*class="sys-nav-item[^"]*"[^>]*>/g, nav[1]);
  assert.equal(botoes.length, 10, 'as 10 seções do Sistema');
  for (const [b] of botoes) {
    assert.match(b, /role="tab"/);
    assert.match(b, /aria-selected="(true|false)"/);
    assert.match(b, /aria-controls="sys-[a-z]+"/);
  }
  assert.equal(botoes.filter(([b]) => /aria-selected="true"/.test(b)).length, 1);
});

test('todo aria-controls e aria-labelledby aponta pra um id que existe', () => {
  const ids = new Set(todos(/\sid="([^"]+)"/g).map(m => m[1]));
  for (const nome of ['aria-controls', 'aria-labelledby']) {
    for (const [, alvo] of todos(new RegExp(nome + '="([^"]+)"', 'g'))) {
      assert.ok(ids.has(alvo), `${nome}="${alvo}" aponta pra um id que não existe`);
    }
  }
});

test('todo painel de aba declara role e o rótulo dele', () => {
  const paineis = todos(/<section[^>]*class="tabpane[^"]*"[^>]*>/g);
  assert.equal(paineis.length, 6);
  for (const [p] of paineis) {
    assert.match(p, /role="tabpanel"/, `sem role=tabpanel: ${p}`);
    assert.match(p, /aria-labelledby="tabbtn-[a-z]+"/, `sem aria-labelledby: ${p}`);
    assert.match(p, /tabindex="0"/, 'painel precisa receber foco pra ser alcançável por teclado');
  }
});

test('todo ícone é marcado como decorativo, nos dois arquivos', () => {
  // ícone sem aria-hidden é lido em voz alta como conteúdo, poluindo cada botão
  for (const [nome, fonte] of [['index.html', HTML], ['app.js', APPJS]]) {
    const svgs = todos(/<svg\b[^>]*>/g, fonte);
    assert.ok(svgs.length > 0, `${nome} tem svg`);
    const nus = svgs.filter(([s]) => !/aria-hidden="true"/.test(s) && !/role="img"/.test(s));
    assert.deepEqual(nus.map(([s]) => s.slice(0, 60)), [],
      `${nome}: svg sem aria-hidden (decorativo) nem role="img" (informativo)`);
  }
});

test('todo campo de entrada tem rótulo, por label ou aria-label', () => {
  const comFor = new Set(todos(/<label[^>]*\sfor="([^"]+)"/g).map(m => m[1]));
  const alvos = todos(/<(input|select|textarea)\b[^>]*>/g);
  const semRotulo = [];
  for (const [tag] of alvos) {
    const id = attr(tag, 'id');
    const tipo = attr(tag, 'type');
    if (tipo === 'checkbox' || tipo === 'radio') continue;  // envolvidos por <label>, associação implícita
    if (/aria-label="/.test(tag)) continue;
    if (id && comFor.has(id)) continue;
    semRotulo.push(tag.slice(0, 70));
  }
  assert.deepEqual(semRotulo, [], 'campo sem rótulo: o placeholder some ao digitar e não é lido como nome');
});

test('os avisos que mudam sozinhos são anunciados', () => {
  // toast é a única confirmação de que uma configuração foi salva
  assert.match(HTML, /id="toasts"[^>]*aria-live="polite"/);
  assert.match(HTML, /id="banner"[^>]*aria-live="polite"/);
});

test('os segmentados declaram o estado, não só a classe', () => {
  const botoes = todos(/<button class="seg-btn[^"]*"[^>]*>/g);
  assert.ok(botoes.length >= 8, 'os segmentados de Entregas e Consumo');
  for (const [b] of botoes) assert.match(b, /aria-pressed="(true|false)"/, `sem aria-pressed: ${b}`);
});

test('cada aba explica pra que serve', () => {
  // .section-desc é a única classe de descrição do app (a .sys-desc foi absorvida)
  assert.equal(HTML.includes('sys-desc'), false, 'a .sys-desc foi unificada na .section-desc');
  const porAba = {};
  for (const m of todos(/<section[^>]*id="tab-([a-z]+)"[\s\S]*?(?=<section[^>]*id="tab-|<\/main>)/g)) {
    porAba[m[1]] = (m[0].match(/class="section-desc"/g) || []).length;
  }
  for (const aba of ['radar', 'entregas', 'destaques', 'time', 'consumo', 'sistema']) {
    assert.ok(porAba[aba] > 0, `a aba ${aba} não tem nenhuma descrição de seção`);
  }
});

test('o JS mantém aria-selected junto com a classe active', () => {
  // se alguém voltar a mexer só na classe, o leitor de tela passa a mentir
  assert.match(APPJS, /aria-selected/, 'switchTab e switchSistemaSection setam aria-selected');
  assert.match(APPJS, /function marcarSeg/, 'o helper que mantém classe e aria-pressed juntos');
});
