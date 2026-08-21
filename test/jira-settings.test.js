// A tabela de lib/settings.js é a fonte única das preferências. Chave que não
// entra nela é descartada em silêncio pelo updateSettings, que foi exatamente a
// classe de bug que originou aquele arquivo.
//
// EDITAVEIS é um Set (settings.js:82), então a checagem é .has, não .includes.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-jira-settings-' + process.pid);

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const { EDITAVEIS, defaults, sanear } = await import('../lib/settings.js');
const { parseJiraSites } = await import('../lib/jira/sites.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

test('jiraSites existe na tabela, é editável e nasce vazio', () => {
  assert.ok(EDITAVEIS.has('jiraSites'), 'a tela precisa poder editar');
  assert.deepEqual(defaults().jiraSites, []);
});

test('o saneador da tabela é o parseJiraSites', () => {
  const bruto = [{ id: 's1', baseUrl: 'https://a.atlassian.net/', owners: ['OrgA'] }, { baseUrl: 'https://sem-id.atlassian.net' }];
  const saneado = sanear('jiraSites', bruto, {}, { parseJiraSites });
  assert.equal(saneado.length, 1);
  assert.equal(saneado[0].baseUrl, 'https://a.atlassian.net');
  assert.deepEqual(saneado[0].owners, ['orga']);
});
