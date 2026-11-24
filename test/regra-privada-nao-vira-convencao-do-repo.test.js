// Regra da avaliação técnica não pode ser publicada como convenção do repositório (21/11/2026).
//
// Num PR real de 21/11/2026 o review pediu mudanças por um `it.skip` sem a ficha
// `// skip -- <motivo>`. O bloqueio estava certo (a regra de supressão bloqueia e a linha era
// nova), mas o texto dizia "A convenção do repositório exige". O repositório não declara essa
// regra em arquivo nenhum: ela vem da avaliação técnica, de fonte privada. O autor procura,
// não acha, e o bloqueio passa a parecer inventado. O bloco de formato manda esconder o nome
// da fonte privada, e sem esta trava o modelo preenchia o vazio com o próprio repositório.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-regra-privada-'));

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const { Engine } = await import('../server.js');
const prompt = (await import('../lib/engine/review-prompt.js')).default;

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { } });

test('regra que o repositório não declara não é atribuída a ele no texto público', () => {
  const b = prompt.reviewFormatBlock(new Engine());
  assert.match(b, /não declara em arquivo próprio/, 'a trava nomeia o caso: regra sem arquivo no repositório');
  assert.match(b, /a convenção do repositório exige/, 'a frase proibida aparece como exemplo do que não escrever');
  assert.match(b, /Diga a exigência como sua/, 'o que entra no lugar: a exigência dita pelo revisor');
  assert.match(b, /cite o arquivo/, 'convenção do repositório só com o arquivo que a declara');
});

test('a fonte privada continua sem nome no texto público', () => {
  const b = prompt.reviewFormatBlock(new Engine());
  assert.match(b, /sem publicar seu nome, identificador ou metadados/);
});
