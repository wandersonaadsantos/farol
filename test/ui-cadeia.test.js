// Sistema > Plano e chaves: a cadeia de perfis na tela (20/10/2026). O estado de cada perfil
// vem avaliado do engine; a tela diz em palavras, e subir, descer, ligar e desligar devolvem
// a lista inteira que vira o campo cadeiaPerfis.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const P = await import('../ui/pure.js');
const RAIZ = path.join(import.meta.dirname, '..');
const HTML = fs.readFileSync(path.join(RAIZ, 'ui', 'index.html'), 'utf8');

const AGORA = new Date(2026, 9, 20, 14, 0).getTime();
const CADEIA = {
  emUso: 'gy',
  todosNoLimite: false,
  entradas: [
    { id: 'gx', label: 'Gemini X', provedorRotulo: 'Claude Code', ativo: true, estado: 'limite', ate: new Date(2026, 9, 20, 17, 50).getTime(), estimado: false },
    { id: 'gy', label: 'Gemini Y', provedorRotulo: 'Claude Code', ativo: true, estado: 'em-uso', ate: 0, estimado: false },
    { id: 'cmax', label: 'Claude Max BIUD', provedorRotulo: 'Codex', ativo: false, estado: 'desligado', ate: 0, estimado: false },
  ],
  contasComPerfilProprio: [],
};

test('cada perfil diz o estado ao vivo, na ordem da cadeia', () => {
  const html = P.cadeiaHtml(CADEIA, AGORA);
  assert.match(html, /No limite até 17:50/);
  assert.match(html, /Em uso/);
  assert.match(html, /Desligado/);
  assert.match(html, /Agora as revisões usam <b>Gemini Y<\/b>/);
  const ordem = [...html.matchAll(/data-cadeia-id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ordem, ['gx', 'gy', 'cmax']);
  assert.match(html, /cad-subir" data-id="gx"[^>]*disabled/, 'o primeiro não sobe');
  assert.match(html, /cad-descer" data-id="cmax"[^>]*disabled/, 'o último não desce');
  assert.doesNotMatch(html, /—/, 'sem travessão');
});

test('reset em outro dia leva a data, e a hora estimada se diz estimada', () => {
  const amanha = new Date(2026, 9, 21, 9, 5).getTime();
  assert.equal(P.estadoDaCadeiaTexto({ estado: 'limite', ate: amanha }, AGORA), 'No limite até 21/10 09:05');
  assert.equal(P.estadoDaCadeiaTexto({ estado: 'limite', ate: amanha, estimado: true }, AGORA), 'No limite até 21/10 09:05 (estimado)');
  assert.equal(P.estadoDaCadeiaTexto({ estado: 'sem-login' }, AGORA), 'Sem login');
});

test('todos no limite: a tela diz que espera o primeiro reset sem estacionar PR', () => {
  const todos = { ...CADEIA, todosNoLimite: true, entradas: CADEIA.entradas.slice(0, 2).map((e, i) => ({ ...e, estado: 'limite', ate: AGORA + (i + 1) * 3600e3 })) };
  const html = P.cadeiaHtml(todos, AGORA);
  assert.match(html, /Todos os perfis ligados estão no limite/);
  assert.match(html, /Gemini X, até 15:00/);
  assert.match(html, /sem estacionar nenhum PR/);
});

test('subir, descer, ligar e desligar devolvem a lista inteira', () => {
  assert.deepEqual(P.moverNaCadeia(CADEIA.entradas, 'cmax', -1).map((e) => e.id), ['gx', 'cmax', 'gy']);
  assert.deepEqual(P.moverNaCadeia(CADEIA.entradas, 'gx', -1).map((e) => e.id), ['gx', 'gy', 'cmax'], 'o primeiro não sobe');
  assert.deepEqual(P.moverNaCadeia(CADEIA.entradas, 'cmax', 1).map((e) => e.id), ['gx', 'gy', 'cmax'], 'o último não desce');
  assert.deepEqual(P.alternarNaCadeia(CADEIA.entradas, 'cmax'), [
    { id: 'gx', ativo: true }, { id: 'gy', ativo: true }, { id: 'cmax', ativo: true },
  ], 'só id e ativo: é o formato do campo cadeiaPerfis');
});

test('conta com perfil próprio aparece como fora da cadeia, com menção navegável', () => {
  const html = P.cadeiaHtml({ ...CADEIA, contasComPerfilProprio: [{ user: 'fulano', perfil: 'gx' }] }, AGORA);
  assert.match(html, /fica fora da cadeia/);
  assert.match(html, /github\.com\/fulano/);
});

test('sem perfil salvo, a cadeia explica o que ela faz em vez de uma lista vazia', () => {
  assert.match(P.cadeiaHtml({ entradas: [] }, AGORA), /Adicione um perfil abaixo/);
});

test('Plano e chaves reúne a cadeia, o modelo por provedor e os perfis, nessa ordem', () => {
  const ini = HTML.indexOf('id="sys-plans"');
  const fim = HTML.indexOf('<!-- Reviewers -->');
  const sec = HTML.slice(ini, fim);
  const pos = ['id="cadeiaPerfis"', 'id="sys-row-provedor"', 'id="sys-row-modelo"', 'id="sys-row-esforco"', 'id="claudeProfilesManager"'].map((m) => sec.indexOf(m));
  assert.ok(pos.every((p) => p > 0), 'tudo dentro da seção');
  assert.deepEqual([...pos].sort((a, b) => a - b), pos);
  assert.match(sec, /data-provider="agy"[^>]*disabled/, 'o lugar do Antigravity existe e não roda');
  assert.doesNotMatch(sec, /Perfil padrão do Farol/, 'o padrão virou o primeiro da cadeia');
});
