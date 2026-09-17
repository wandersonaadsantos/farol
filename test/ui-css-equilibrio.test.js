// O app.css não tem compilador que reclame de chave solta: o navegador fecha o bloco onde
// acha a primeira `}` e segue. Medido em 16/09/2026: uma `}` a mais fechava o bloco de 620 px
// cedo, e as regras de Entregas, Destaques, Time e do card do Radar passavam a valer em
// qualquer largura; num merge da mesma semana, o fechamento de outro bloco sumiu e as
// regras de Aparelhos só valiam no estreito. Nenhum dos dois quebrava teste.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const CSS = fs.readFileSync(path.join(import.meta.dirname, '..', 'ui', 'app.css'), 'utf8');

function semComentarios(texto) {
  return texto.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
}

test('app.css: nenhuma chave fecha o que não abriu, e todo bloco aberto fecha', () => {
  const linhas = semComentarios(CSS).split('\n');
  let profundidade = 0;
  linhas.forEach((linha, i) => {
    for (const c of linha) {
      if (c === '{') profundidade += 1;
      if (c === '}') {
        profundidade -= 1;
        assert.ok(profundidade >= 0, `chave fechando sem abrir na linha ${i + 1}`);
      }
    }
  });
  assert.equal(profundidade, 0, 'sobrou bloco aberto no fim do arquivo');
});

test('app.css: media query não se aninha dentro de outra media query', () => {
  const texto = semComentarios(CSS);
  let profundidade = 0;
  const pilha = [];
  const re = /@media[^{]*\{|\{|\}/g;
  let m;
  while ((m = re.exec(texto))) {
    if (m[0] === '}') { pilha.pop(); profundidade -= 1; continue; }
    const ehMedia = m[0].startsWith('@media');
    if (ehMedia) {
      const linha = texto.slice(0, m.index).split('\n').length;
      assert.ok(!pilha.includes(true), `@media aninhada na linha ${linha}: um bloco anterior não fechou`);
    }
    pilha.push(ehMedia);
    profundidade += 1;
  }
  assert.equal(profundidade, 0);
});
