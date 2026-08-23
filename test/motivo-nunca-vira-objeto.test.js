/* "[object Object]" na cara do usuário, três vezes na mesma feature.

   Desde a v2.48.0 `reasons`/`attention` viajam como `{ text, kind }`. Quem
   interpolar o objeto cru numa string escreve "[object Object]". Já aconteceu:

     v2.48.0  card "Precisa de você"        (corrigido na v2.48.3)
     v2.51.1  as TRÊS notificações do sistema (achado pelo Wanderson em 20/08/2026,
              e o CHANGELOG da v2.48.3 AFIRMAVA que a notificação estava corrigida)

   Este arquivo trava as duas metades: o unwrap em si, e a ausência de
   interpolação crua no shell Electron, que é o consumidor que ficou de fora
   duas vezes por não ter teste nenhum. */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-motivo-' + process.pid);

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { reasonText } = await import('../lib/format.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const RAIZ = path.join(import.meta.dirname, '..');

test('reasonText: motivo etiquetado devolve o texto', () => {
  assert.equal(reasonText({ text: 'cobertura incompleta', kind: 'gate' }), 'cobertura incompleta');
});

// entrada antiga (decisions.json anterior à v2.48.0) passa direto
test('reasonText: string pura passa direto', () => {
  assert.equal(reasonText('motivo antigo'), 'motivo antigo');
});

test('reasonText: vazio nunca vira "[object Object]" nem "undefined"', () => {
  for (const entrada of [null, undefined, {}, { kind: 'gate' }]) {
    const saida = reasonText(entrada);
    assert.equal(saida, '', `entrada ${JSON.stringify(entrada)}`);
    assert.doesNotMatch(String(saida), /\[object Object\]/);
  }
});

test('interpolar um motivo etiquetado produz texto legível, nunca o objeto', () => {
  const motivo = { text: 'a revisão não cobriu o diff inteiro', kind: 'gate' };
  const frase = `Motivo: ${reasonText(motivo)}`;
  assert.equal(frase, 'Motivo: a revisão não cobriu o diff inteiro');
  assert.doesNotMatch(frase, /\[object Object\]/);
});

/* ---------- a trava estrutural ----------
   O main.js não tem como ser exercitado aqui (é o shell Electron), então a
   proteção é ler o FONTE e proibir a interpolação crua de motivo. É a mesma
   técnica do ui-pure.test.js contra menção de pessoa escrita à mão. */

test('main.js nunca interpola motivo cru numa string', () => {
  const fonte = fs.readFileSync(path.join(RAIZ, 'main.js'), 'utf8');
  // `${reasons[0]}`, `${ressalvas[0]}`, `${points[0]}` e afins, sem passar por reasonText
  const cru = fonte.match(/\$\{\s*(?!reasonText)[A-Za-z_$][\w$]*\s*\[\s*0\s*\]\s*\}/g) || [];
  assert.deepEqual(cru, [], `interpolação crua de motivo em main.js: ${cru.join(', ')}`);
});

test('main.js usa a fonte única do unwrap (lib/format.js)', () => {
  const fonte = fs.readFileSync(path.join(RAIZ, 'main.js'), 'utf8');
  assert.match(fonte, /import \{ reasonText \} from '\.\/lib\/format\.js'/);
  // e não reimplementa a própria cópia
  assert.doesNotMatch(fonte, /function reasonText/);
});

// o engine também: a cópia local dele foi removida na v2.51.1
test('review.js usa a fonte única, sem cópia local', () => {
  const fonte = fs.readFileSync(path.join(RAIZ, 'lib', 'engine', 'review.js'), 'utf8');
  assert.doesNotMatch(fonte, /function reasonText/);
  // a lista de nomes importados pode crescer (o staleHeadText entrou junto na v2.51.2);
  // o que o teste trava é a ORIGEM ser o lib/format.js, não o tamanho da chave
  assert.match(fonte, /import \{[^}]*\breasonText\b[^}]*\} from '\.\.\/format\.js'/);
});
