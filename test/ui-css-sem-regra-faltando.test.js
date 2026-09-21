// Print de 21/09/2026: o resultado de "Testar perfil" saía como uma frase emendada
// ("Testado às 15:58o teste não abre sessão...", "Conta fulano@x detectado", "Tipo de
// autenticação não sabemos desconhecido"). O HTML estava certo; as classes que ele usa
// nunca tiveram regra no app.css, então cada <span> virava texto corrido.
//
// No mesmo cartão, o bloco Orçamento pedia `var(--line)`, um token que o app nunca
// definiu: a linha divisória simplesmente não era pintada. O mesmo token aparecia em
// outras quatro regras.
//
// As duas travas daqui não conhecem a tela: uma exige que todo token usado sem valor
// reserva exista, a outra que toda classe que o teste de perfil emite tenha regra.
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const CSS = fs.readFileSync(path.join(import.meta.dirname, '..', 'ui', 'app.css'), 'utf8');

test('todo token usado sem valor reserva está definido no app.css', () => {
  const definidos = new Set([...CSS.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
  const semReserva = [...CSS.matchAll(/var\((--[\w-]+)\s*\)/g)].map((m) => m[1]);
  const faltando = [...new Set(semReserva.filter((t) => !definidos.has(t)))];
  assert.deepEqual(faltando, [], `token sem definição e sem valor reserva: a regra não pinta nada (${faltando.join(', ')})`);
});

test('toda classe que o teste de perfil emite tem regra no app.css', async () => {
  const { perfilTesteHtml } = await import('../ui/pure/perfil.js');
  const campos = {
    configDir: { valor: '/Users/x/.claude', origem: 'informado' },
    login: { valor: true, origem: 'inferido', motivo: 'pelos arquivos da pasta' },
    email: { valor: 'x@y.com', origem: 'detectado' },
    tipoAuth: { valor: null, origem: 'desconhecido' },
    plano: { valor: null, origem: 'desconhecido', motivo: 'o nome do plano não é detectável' },
    chave: { valor: 'preenchida', origem: 'validado' },
  };
  const html = [
    perfilTesteHtml({ estado: 'pronto', em: Date.now(), perfil: { campos, aviso: 'o Claude Code não respondeu à verificação' } }),
    perfilTesteHtml({ estado: 'erro', motivo: 'falhou' }),
  ].join('');
  // o valor da origem vai como MODIFICADOR do selo (class="origem inferido"): quem o cobre
  // é o `.origem` base e as variantes do caso abaixo, não uma regra solta por valor
  const ORIGENS = new Set(['informado', 'detectado', 'validado', 'inferido', 'desconhecido']);
  const classes = new Set([...html.matchAll(/class="([^"]+)"/g)]
    .flatMap((m) => m[1].split(/\s+/)).filter((c) => !ORIGENS.has(c)));
  const semRegra = [...classes].filter((c) => !new RegExp(`\\.${c}(?![\\w-])`).test(CSS));
  assert.deepEqual(semRegra, [], `classe do teste de perfil sem regra: o texto se emenda (${semRegra.join(', ')})`);
});

test('o selo de origem distingue validado, informado, inferido e desconhecido', () => {
  // a razão de ser da tela é dizer DE ONDE veio cada dado; selo sem cor por origem
  // desmancharia isso, então cada origem com peso diferente precisa de regra própria
  for (const origem of ['validado', 'informado', 'inferido']) {
    assert.match(CSS, new RegExp(`\\.origem\\.${origem}\\b`), `sem cor própria para a origem ${origem}`);
  }
  assert.match(CSS, /\.origem\s*\{/, 'o selo base (que cobre "desconhecido") precisa existir');
});

test('na largura estreita o motivo ocupa a linha toda, nunca a coluna do selo', () => {
  // A 373 px a grade da linha tem duas colunas, e a segunda é a do selo. O motivo que
  // ficava nela (herdando o `2 / -1` da largura normal) esticava o selo e espremia o
  // valor até zero: "não sabemos" saía uma letra por linha. Medido no navegador.
  const i = CSS.indexOf('@media (max-width: 620px) {\n  .cp-linha');
  assert.ok(i >= 0, 'a regra estreita do teste de perfil existe');
  const bloco = CSS.slice(i, CSS.indexOf('\n}', i));
  assert.match(bloco, /\.cp-motivo[^{]*\{\s*grid-column:\s*1\s*\/\s*-1/, 'o motivo precisa atravessar a linha na largura estreita');
});
