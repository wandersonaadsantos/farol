// O apagão remoto some (7.C1). As regras v2 negam o DELETE de /users/{uid}, então um botão
// que o chama só produziria erro. Sair deste aparelho e desligar continuam existindo, e
// nenhum dos dois apaga nada no banco.
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { arquivosDasTelas, fonteDasTelas } from './helpers/fontes-ui.js';

const RAIZ = path.join(import.meta.dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

test('nenhum arquivo de produção menciona o apagão remoto', () => {
  // a tela saiu do ui/app.js na Fase 1b: a varredura cobre o bootstrap e todas as telas
  const fontes = ['lib/engine/sync.js', 'server.js', 'lib/http-server.js', 'ui/pure/sync.js'].map((rel) => ({ rel, fonte: ler(rel) }))
    .concat(arquivosDasTelas().map((a) => ({ rel: `ui/${a.nome}`, fonte: a.texto })));
  for (const { rel, fonte } of fontes) {
    assert.equal(/syncEraseRemote|erase-remote|syncApagarRemoto/.test(fonte), false, rel);
    assert.equal(/id="syncErase"/.test(fonte), false, rel);
  }
});

test('a saída e o desligar continuam de pé', () => {
  const engine = ler('lib/engine/sync.js');
  assert.ok(/function syncLogout/.test(engine));
  assert.ok(/function stopSync/.test(engine));
  assert.ok(/syncLogout/.test(fonteDasTelas()));
});

test('a rota do apagão não existe mais no servidor', () => {
  assert.equal(/\/api\/sync\/erase-remote/.test(ler('lib/http-server.js')), false);
});

test('nenhum DELETE da raiz users/{uid} sobrou em lib/', () => {
  for (const dir of ['lib/engine', 'lib/sync']) {
    for (const nome of fs.readdirSync(path.join(RAIZ, dir)).filter((f) => f.endsWith('.js'))) {
      const fonte = ler(`${dir}/${nome}`);
      // a sonda de regras tenta esse DELETE de propósito, para descobrir regra velha
      if (nome === 'sonda-regras.js') continue;
      assert.equal(/del\(`\/users\/\$\{[a-zA-Z.]+\}`\)/.test(fonte), false, `${dir}/${nome}`);
    }
  }
});
