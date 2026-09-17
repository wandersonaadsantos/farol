// C0, defeito 2: o texto que a tela mostra quando o servidor recusa uma preferência, e a
// garantia de que os QUATRO salvamentos da tela usam o mesmo texto. Antes cada handler
// só olhava a própria chave, e a rota nem devolvia a lista.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settingsIgnoradasTexto } from '../ui/pure.js';
import { fonteDasTelas } from './helpers/fontes-ui.js';

test('settingsIgnoradasTexto: vazio quando tudo entrou ou quando a resposta não diz nada', () => {
  assert.equal(settingsIgnoradasTexto({ ok: true, ignoradas: [] }), '');
  assert.equal(settingsIgnoradasTexto({ ok: true }), '');
  assert.equal(settingsIgnoradasTexto(null), '');
  assert.equal(settingsIgnoradasTexto({ ignoradas: 'sync' }), '', 'formato errado não inventa recusa');
});

test('settingsIgnoradasTexto: uma chave', () => {
  assert.equal(settingsIgnoradasTexto({ ignoradas: ['sync'] }), '"sync" não foi salva: o servidor não reconhece essa preferência.');
});

test('settingsIgnoradasTexto: várias chaves, e item que não é texto fica de fora', () => {
  assert.equal(settingsIgnoradasTexto({ ignoradas: ['a', 7, 'b'] }), '"a", "b" não foram salvas: o servidor não reconhece essas preferências.');
});

test('os quatro salvamentos da tela usam o texto das ignoradas, e nenhum filtra pela própria chave', () => {
  // desde a Fase 1b os handlers moram em ui/telas/ (acoes, sistema-jira, sistema-sync e, com a
  // seção Aparelhos, sistema-aparelhos); a leitura cobre o bootstrap e todas as telas, então a
  // contagem continua sendo da tela inteira
  const app = fonteDasTelas();
  assert.equal((app.match(/settingsIgnoradasTexto\(r\)/g) || []).length, 4, 'saveJiraSites, saveSync, o laço do settingsMap e o consentimento de Aparelhos');
  assert.equal(/r\.ignoradas\.includes\(/.test(app), false, 'filtrar pela própria chave escondia a recusa das outras');
});
