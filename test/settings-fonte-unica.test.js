// A tabela de preferências (lib/settings.js) é a FONTE ÚNICA, e este teste é a ponte
// que a UI não consegue ser.
//
// Queixa que originou tudo (18/08/2026): "Sistema > Automação não está salvando as
// minhas preferências, toda vez que ocorre um update perco tudo". A persistência em si
// estava certa (escrita atômica, snapshot completo, allowlist cobrindo os toggles). O
// problema era a FORMA: uma preferência morava em cinco lugares (DEFAULTS, allowlist,
// saneamento, settingsMap da tela, leitura no renderSettings), e esquecer um deles não
// quebrava nada visível — o updateSettings descartava a chave em silêncio, devolvia
// `undefined`, e a tela dizia "Configuração salva." do mesmo jeito.
//
// O `ui/app.js` não pode importar `lib/settings.js` (o servidor estático só serve
// `ui/`, ver lib/http-server.js), então a checagem cruzada vive aqui: chave que a tela
// edita e a tabela não conhece quebra a suíte, em vez de sumir com a preferência de
// alguém. Mesmo padrão do guarda de taxonomia UI x engine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SETTINGS, EDITAVEIS, defaults, sanear } from '../lib/settings.js';

const APPJS = fs.readFileSync(path.join(import.meta.dirname, '..', 'ui', 'app.js'), 'utf8');

// as duplas [seletor, chave] que a tela liga no change
function togglesDaTela() {
  const m = APPJS.match(/const settingsMap = \[([\s\S]*?)\n\];/);
  assert.ok(m, 'settingsMap precisa existir no ui/app.js');
  return [...m[1].matchAll(/\['([^']+)',\s*'([^']+)'/g)].map(x => ({ sel: x[1], key: x[2] }));
}

test('toda preferência que a tela edita existe na tabela e é editável', () => {
  const daTela = togglesDaTela();
  assert.ok(daTela.length >= 15, `esperava os toggles de Sistema, achei ${daTela.length}`);
  const órfãs = daTela.filter(t => !EDITAVEIS.has(t.key));
  assert.deepEqual(órfãs.map(t => `${t.sel} -> ${t.key}`), [],
    'chave que a tela manda e o servidor não aceita é preferência que some em silêncio');
});

test('a tela não inventa chave: todo seletor lê um id que existe no HTML', () => {
  const html = fs.readFileSync(path.join(import.meta.dirname, '..', 'ui', 'index.html'), 'utf8');
  const semElemento = togglesDaTela().filter(t => !html.includes(`id="${t.sel.slice(1)}"`));
  assert.deepEqual(semElemento.map(t => t.sel), [],
    'seletor sem elemento no HTML explode no boot da tela (addEventListener de null)');
});

test('defaults cobre toda a tabela e a porta entra por injeção', () => {
  const d = defaults(12345);
  for (const s of SETTINGS) assert.ok(s.key in d, `${s.key} faltando no defaults`);
  assert.equal(d.port, 12345, 'a porta vem de fora: lib/settings.js não importa constants');
});

test('port existe no config mas NÃO é editável pela tela', () => {
  // trocar porta em runtime derrubaria o servidor que respondeu o pedido
  assert.ok('port' in defaults(1), 'port existe no config');
  assert.equal(EDITAVEIS.has('port'), false, 'e não pode vir da tela');
});

test('saneamento: os defaults que ligados só desligam com valor explícito', () => {
  // autoUpdate é o caso: chave ausente não pode virar "desligado"
  assert.equal(sanear('autoUpdate', undefined, {}, {}), true);
  assert.equal(sanear('autoUpdate', false, {}, {}), false);
  // e os opt-in são o contrário: só ligam com valor verdadeiro
  assert.equal(sanear('reviewFast', undefined, {}, {}), false);
  assert.equal(sanear('reviewFast', true, {}, {}), true);
  assert.equal(sanear('teamHighlights', undefined, {}, {}), false);
  assert.equal(sanear('teamHighlights', true, {}, {}), true);
  assert.equal(sanear('deliveriesEnabled', undefined, {}, {}), false);
  assert.equal(sanear('deliveriesEnabled', true, {}, {}), true);
});

test('saneamento: valor inválido mantém o anterior, não derruba pro padrão', () => {
  // semântica de sempre: a tela mostra o que o engine aceitou no próximo estado
  const fns = {
    sanitizeClaudeModel: () => null, sanitizeClaudeEffort: () => null,
    sanitizeCodexModel: () => null, sanitizeCodexEffort: () => null,
    sanitizeParallelReviews: () => null,
  };
  assert.equal(sanear('reviewModel', 'lixo', { reviewModel: 'opus' }, fns), 'opus');
  assert.equal(sanear('reviewEffort', 'lixo', { reviewEffort: 'high' }, fns), 'high');
  assert.equal(sanear('codexReviewModel', 'lixo', { codexReviewModel: 'gpt-5.6-terra' }, fns), 'gpt-5.6-terra');
  assert.equal(sanear('codexReviewEffort', 'lixo', { codexReviewEffort: 'medium' }, fns), 'medium');
  assert.equal(sanear('parallelReviews', 99, { parallelReviews: 3 }, fns), 3);
});

test('saneamento: intervalo fica no intervalo permitido', () => {
  assert.equal(sanear('intervalSeconds', 5, {}, {}), 180, 'piso');
  assert.equal(sanear('intervalSeconds', 99999, {}, {}), 3600, 'teto');
  assert.equal(sanear('intervalSeconds', 'nada', {}, {}), 300, 'lixo cai no padrão');
});

test('saneamento: lista aceita texto separado ou array', () => {
  assert.deepEqual(sanear('owners', 'a, b;c', {}, {}), ['a', 'b', 'c']);
  assert.deepEqual(sanear('owners', [' a ', '', 'b'], {}, {}), ['a', 'b']);
});
