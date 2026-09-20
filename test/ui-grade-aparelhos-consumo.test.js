// A grade da lista de aparelhos, a linha do consumo consolidado e o que cada uma diz
// quando a tela encolhe. Tudo aqui nasceu de medição no DOM (Chromium do Electron,
// getBoundingClientRect/getComputedStyle) em 20/09/2026:
//
// 7.1 Cada .apar-linha era um grid PRÓPRIO, com a 5ª coluna `auto`. No cabeçalho ela vale
//     0 px (span vazio) e nas linhas vale a largura dos botões, que depende do PAPEL do
//     aparelho: a 1500 px o nome media 1077 px no cabeçalho e 444/666/827 px nas linhas, e
//     a 860 px a linha com mais ações tinha a coluna do nome em 0 px. Quanto mais poder a
//     linha oferecia, mais o nome dela era espremido.
// 7.2 A linha do consumo consolidado tem TRÊS filhos e usava a grade de QUATRO colunas da
//     .sync-linha, cujo media query de 720 px esconde os filhos 2 e 3: a ≤720 px sobrava
//     uma lista de nomes, sem sessões e sem custo (medido: display none nos dois).
// 7.3 A ≤720 px o cabeçalho some e os valores empilham crus (`win32`, `v2.62.4`,
//     `hoje 13:28`), sem dizer o que é cada um.
// 7.5 O cartão "medido x estimado" mostrava 100% com US$ 3.19 de estimativa dentro
//     (3232.79 de 3235.98 é 99,90%), e mostrava 100% também sem gasto nenhum.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fonteDasTelas } from './helpers/fontes-ui.js';
const P = await import('../ui/pure.js');

const RAIZ = path.join(import.meta.dirname, '..');
const CSS = fs.readFileSync(path.join(RAIZ, 'ui', 'app.css'), 'utf8');

// TODOS os corpos de `@media (max-width: N px)` concatenados, com as chaves equilibradas.
// São vários blocos por largura no app.css (um por seção), e regex simples pararia na
// primeira `}`, lendo só a primeira regra: teste cego passa verde.
function blocoDaMedia(largura) {
  const marca = `@media (max-width: ${largura}px)`;
  const corpos = [];
  for (let abre = CSS.indexOf(marca); abre >= 0; abre = CSS.indexOf(marca, abre + 1)) {
    const i = CSS.indexOf('{', abre);
    let profundidade = 0;
    for (let j = i; j < CSS.length; j += 1) {
      if (CSS[j] === '{') profundidade += 1;
      if (CSS[j] === '}') { profundidade -= 1; if (!profundidade) { corpos.push(CSS.slice(i + 1, j)); break; } }
    }
  }
  assert.ok(corpos.length, `não achei o bloco de ${largura}px no app.css`);
  return corpos.join('\n');
}

const AGORA = Date.parse('2026-09-20T13:28:00-03:00');

function aparelho(extra) {
  return {
    deviceId: 'dX', name: 'Aparelho', platform: 'win32', farolVersion: '2.62.4', lastSeenAt: AGORA - 60000,
    retiredAt: 0, euMesmo: false, semPresenca: false, contract: 2, keyReady: true, ...extra,
  };
}

const TRES = [
  aparelho({ deviceId: 'dThi', name: 'Thiagueira da Bahia', platform: 'darwin', semPresenca: true }),
  aparelho({ deviceId: 'dAnd', name: 'Farol-Android-Velho', platform: 'linux' }),
  aparelho({ deviceId: 'dWin', name: 'Windows Predator', euMesmo: true }),
];

/* ---------- 7.1: cabeçalho e linhas na MESMA grade ---------- */

test('7.1: a lista de aparelhos é o grid, e cada linha herda as colunas dele', () => {
  const html = P.aparelhosListaHtml(TRES, { admin: { deviceId: 'dWin' }, agora: AGORA, souAdmin: true });
  assert.match(html, /class="card sync-lista apar-lista"/, 'a lista precisa de classe própria para ser a grade');
  assert.match(CSS, /\.apar-lista\s*\{[^}]*grid-template-columns:[^}]*\}/, 'as colunas moram no container');
  assert.match(CSS, /\.apar-linha\s*\{[^}]*grid-template-columns:\s*subgrid/, 'a linha herda as colunas do container');
});

test('7.1: nenhuma largura de tela devolve colunas próprias para a .apar-linha', () => {
  for (const largura of [860, 720]) {
    const bloco = blocoDaMedia(largura);
    const regras = bloco.match(/[^{}]*\{[^}]*\}/g) || [];
    for (const regra of regras) {
      const seletor = regra.slice(0, regra.indexOf('{'));
      if (!/\.apar-linha(?![-\w])/.test(seletor)) continue;
      assert.doesNotMatch(regra, /grid-template-columns/, `a ${largura}px a .apar-linha voltou a ter grade própria: ${seletor.trim()}`);
    }
    assert.match(bloco, /\.apar-lista\s*\{[^}]*grid-template-columns/, `a ${largura}px quem muda de grade é o container`);
  }
});

/* ---------- 7.2: o consumo consolidado no estreito ---------- */

const RESUMO = {
  devices: [
    { deviceId: 'dWin', name: 'Windows Predator', euMesmo: true, sessions: 812, costUsd: 1992.33, lastAt: AGORA - 3600000 },
    { deviceId: 'dThi', name: 'Thiagueira da Bahia', sessions: 301, costUsd: 733.16, lastAt: 0 },
  ],
  totals: { sessions: 1113, costUsd: 3235.98, medido: { costUsd: 3232.79 }, estimado: { costUsd: 3.19 } },
};

test('7.2: a linha do consolidado tem grade própria, e o estreito preserva sessões e custo', () => {
  const html = P.usageConsolidatedHtml(RESUMO);
  const linhas = html.match(/<div class="sync-linha[^"]*"/g) || [];
  assert.ok(linhas.length >= 3, 'cabeçalho e uma linha por aparelho');
  for (const l of linhas) assert.match(l, /usage-dev/, 'toda linha do consolidado carrega a classe do componente');
  const bloco = blocoDaMedia(720);
  assert.match(bloco, /\.sync-linha\.usage-dev\s*>\s*:nth-child\(2\)[^{]*\{[^}]*display:\s*block/, 'sessões e custo continuam visíveis no estreito');
  assert.match(bloco, /\.sync-linha\s*>\s*:nth-child\(2\),\s*\.sync-linha\s*>\s*:nth-child\(3\)\s*\{\s*display:\s*none/, 'a regra genérica da .sync-linha continua como estava');
});

/* ---------- 7.3: sem cabeçalho, cada valor se identifica ---------- */

test('7.3: os valores da linha do aparelho levam rótulo, e o estreito o mostra', () => {
  const html = P.aparelhosListaHtml(TRES, { agora: AGORA });
  for (const rot of ['sistema', 'versão', 'visto']) {
    assert.ok(html.includes(`data-rot="${rot}"`), `o valor de ${rot} precisa se identificar sem o cabeçalho`);
  }
  const cabecalho = html.slice(html.indexOf('apar-head'), html.indexOf('</div>', html.indexOf('apar-head')));
  assert.doesNotMatch(cabecalho, /data-rot/, 'o cabeçalho é o rótulo, não leva rótulo dentro');
  const bloco = blocoDaMedia(720);
  assert.match(bloco, /\[data-rot\]::before\s*\{[^}]*content:\s*attr\(data-rot\)/, 'o rótulo aparece onde o cabeçalho some');
});

test('7.3: no consolidado estreito sessões e custo também se identificam', () => {
  const html = P.usageConsolidatedHtml(RESUMO);
  assert.ok(html.includes('data-rot="sessões"'), 'o número solto precisa dizer que é sessões');
  assert.ok(/data-rot="custo/.test(html), 'o valor solto precisa dizer que é custo');
});

/* ---------- 7.5: 100% só quando não há estimativa ---------- */

function kpiMedido(html) {
  const m = /medido x estimado<\/span><b>([^<]*)<\/b><span class="usage-kpi-sub">([^<]*)</.exec(html);
  assert.ok(m, 'não achei o cartão medido x estimado');
  return { valor: m[1], sub: m[2] };
}

test('7.5: 99,90% medido não vira 100%', () => {
  const kpi = kpiMedido(P.usageConsolidatedHtml(RESUMO));
  assert.notEqual(kpi.valor, '100%', 'com US$ 3.19 estimado a tela não pode afirmar medição completa');
  assert.equal(kpi.valor, '99.9%');
  assert.match(kpi.sub, /US\$ 3\.19 estimado/);
});

test('7.5: 100% exato só com estimativa zero e total positivo', () => {
  const semEstimativa = { devices: RESUMO.devices, totals: { sessions: 9, costUsd: 10, medido: { costUsd: 10 }, estimado: { costUsd: 0 } } };
  assert.equal(kpiMedido(P.usageConsolidatedHtml(semEstimativa)).valor, '100%');
  const quaseTudoEstimado = { devices: [], totals: { sessions: 1, costUsd: 10, medido: { costUsd: 0.004 }, estimado: { costUsd: 9.996 } } };
  assert.equal(kpiMedido(P.usageConsolidatedHtml(quaseTudoEstimado)).valor, '0.0%', 'truncar para baixo também vale no piso');
});

test('7.5: total zero ou indisponível não vira porcentagem inventada', () => {
  const zerado = kpiMedido(P.usageConsolidatedHtml({ devices: [], totals: { sessions: 0, costUsd: 0, medido: { costUsd: 0 }, estimado: { costUsd: 0 } } }));
  assert.doesNotMatch(zerado.valor, /%/, 'sem total não há divisão, e sem divisão não há porcentagem');
  assert.match(zerado.sub, /sem gasto/);
  const semCampos = kpiMedido(P.usageConsolidatedHtml({ devices: [], totals: { sessions: 0, costUsd: 0 } }));
  assert.doesNotMatch(semCampos.valor, /%/);
});

test('7.5: a formatação não mexe no que é contabilizado', () => {
  const html = P.usageConsolidatedHtml(RESUMO);
  assert.match(html, /US\$ 3235\.98/, 'o total continua o que o engine mandou');
  assert.match(html, /US\$ 1992\.33/);
});

/* ---------- 7.4: escopo local sem o seletor ---------- */

test('7.4: sem consolidação a aba continua dizendo que o escopo é este aparelho', () => {
  const telas = fonteDasTelas();
  assert.match(telas, /usageEscopoLocal/, 'o marcador de escopo precisa existir quando o segmentado some');
  assert.match(telas, /consolidação[^\n]*desligada/i, 'o marcador diz o MOTIVO, para não ser lido como falha de carregamento');
  assert.match(CSS, /\.usage-escopo\s*\{/, 'o marcador tem estilo próprio');
});
