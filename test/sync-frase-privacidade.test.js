// Frase da tela com o compartilhamento ligado (spec, seção 11). Ela é contrato: promete
// exatamente o que a cifra entrega, e nomeia o que ela NÃO protege. Um dia alguém vai
// querer encurtar isso; este teste existe para essa hora.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const P = await import('../ui/pure/sync.js');

const LIGADO = { shared: true };

test('desligado: a frase não aparece', () => {
  assert.equal(P.syncPrivacidadeHtml({ shared: false }), '');
  assert.equal(P.syncPrivacidadeHtml({}), '');
  assert.equal(P.syncPrivacidadeHtml(null), '');
});

test('ligado: a frase cobre os seis eixos da seção 11', () => {
  const html = P.syncPrivacidadeHtml(LIGADO);
  for (const eixo of ['Sobe cifrado', 'Qualquer cópia do banco enxerga', 'A coordenação expõe', 'A cifra não protege contra', 'Nunca sai do aparelho', 'Não é backup']) {
    assert.ok(html.includes(eixo), eixo);
  }
});

test('a frase diz o que a cifra NÃO protege, sem suavizar', () => {
  const html = P.syncPrivacidadeHtml(LIGADO);
  assert.match(html, /quem sabe a sua senha/);
  assert.match(html, /o Google/);
  assert.match(html, /acesso a um aparelho seu/);
});

test('a frase nomeia que título e autor de PR são dados de colegas', () => {
  assert.match(P.syncPrivacidadeHtml(LIGADO), /dados de colegas/);
});

test('a frase não promete backup nem sigilo contra a coordenação', () => {
  const html = P.syncPrivacidadeHtml(LIGADO);
  assert.match(html, /não para guardar cópia/);
  assert.match(html, /descobríveis testando nomes conhecidos/);
});

test('o cartão de conexão mostra a frase só com o compartilhamento ligado', () => {
  const cfg = { apiKey: 'AIza', databaseUrl: 'https://x-default-rtdb.firebaseio.com', deviceName: 'Notebook' };
  assert.ok(P.syncConexaoHtml({ status: 'conectado', shared: true }, cfg).includes('sync-privacidade'));
  assert.equal(P.syncConexaoHtml({ status: 'conectado', shared: false }, cfg).includes('sync-privacidade'), false);
});
