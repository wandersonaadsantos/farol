// O aviso da release de ponte em Sistema > Visão geral (plano 4 do Farol nativo, 4.7).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instalarDom } from './helpers/dom-stub.js';

instalarDom();
const { pontePainelHtml } = await import('../ui/pure.js');
const { definirEstado, definirPlataforma } = await import('../ui/telas/estado.js');
const { renderUpdate } = await import('../ui/telas/sistema-atualizacao.js');

const ponte = { versao: '3.0.0', dmg: 'https://x/Farol-3.0.0.dmg', msix: 'https://x/Farol-3.0.0.msix', appinstaller: null };
const u = { channel: 'remote', available: false, current: '2.80.0', sourceVersion: '3.0.0', repo: 'owner/farol', ponte };

test('pontePainelHtml mostra os dois instaladores, o do sistema atual primeiro', () => {
  const mac = pontePainelHtml(u, 'darwin');
  assert.match(mac, /última versão do Farol nesta casca \(Electron\)/);
  assert.match(mac, /Baixe o Farol nativo/);
  assert.ok(mac.indexOf('Farol-3.0.0.dmg') < mac.indexOf('Farol-3.0.0.msix'));
  assert.match(mac, /target="_blank" rel="noreferrer"/);
  const win = pontePainelHtml(u, 'win32');
  assert.ok(win.indexOf('Farol-3.0.0.msix') < win.indexOf('Farol-3.0.0.dmg'));
});

test('link nulo vira texto, nunca link morto', () => {
  const html = pontePainelHtml({ ...u, ponte: { ...ponte, msix: null } }, 'win32');
  assert.match(html, /ainda sem instalador para este sistema/);
  assert.doesNotMatch(html, /href="null"/);
  assert.match(html, /Farol-3\.0\.0\.dmg/);
});

test('versão e link passam pelo escape', () => {
  const html = pontePainelHtml({ ...u, ponte: { ...ponte, versao: '<b>3</b>', dmg: 'https://x/"><script>' } }, 'darwin');
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<b>3<\/b>/);
});

test('renderUpdate com ponte desenha o aviso e nenhum botão de atualizar', () => {
  definirPlataforma('darwin');
  definirEstado({ config: {}, update: u });
  renderUpdate();
  const box = document.querySelector('#updateBox');
  assert.ok(box.classList.contains('ponte'));
  assert.match(box.innerHTML, /Baixe o Farol nativo/);
  assert.doesNotMatch(box.innerHTML, /Atualizar agora/);
  assert.doesNotMatch(box.innerHTML, /versão mais recente/);
  definirEstado({ config: {}, update: { ...u, ponte: undefined, sourceVersion: '2.80.0' } });
  renderUpdate();
  assert.ok(!box.classList.contains('ponte'));
});
