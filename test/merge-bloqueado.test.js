// Sistema > Conexões saiu, e "Repos bloqueados pra merge" foi para Sistema > Automação
// (03/10/2026). Os outros dois campos da seção (conta e organizações do modo simples) não
// tinham efeito desde que as contas passaram a morar em Sistema > Contas. Desenho do Claude
// Design, handoff em docs/superpowers/specs/2026-10-03-tela-conexoes-anexos/HANDOFF.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  normalizarRepo, incluirRepo, tirarRepo, prsDoRepo, reposBloqueadosHtml,
  textoDoMergeBloqueado, textoDoMergeDesbloqueado, tituloDoMergeBloqueado, notaDoMergeBloqueadoHtml, delivEmptyState,
} from '../ui/pure.js';

const RAIZ = path.join(import.meta.dirname, '..');
const HTML = fs.readFileSync(path.join(RAIZ, 'ui', 'index.html'), 'utf8');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const MEUS = [{ key: 'acme/web#1' }, { key: 'acme/web#2' }, { key: 'Acme/Api#3' }];

test('normalizarRepo: owner/repo, URL do repo e URL de PR viram owner/repo em minúsculas', () => {
  assert.equal(normalizarRepo('  Acme/Web  '), 'acme/web');
  assert.equal(normalizarRepo('https://github.com/Acme/Web'), 'acme/web');
  assert.equal(normalizarRepo('https://www.github.com/acme/web.git'), 'acme/web');
  assert.equal(normalizarRepo('https://github.com/acme/web/pull/12'), 'acme/web');
  assert.equal(normalizarRepo('acme/web/'), 'acme/web');
});

test('incluirRepo: grava ordenado, recusa formato inválido e repetido sem mudar nada', () => {
  assert.deepEqual(incluirRepo(['acme/web'], 'https://github.com/acme/api/pull/3'), { ok: true, repo: 'acme/api', lista: ['acme/api', 'acme/web'] });
  for (const v of ['', 'acme', 'acme/', '/web', 'acme web/x', 'https://gitlab.com/acme/web']) {
    assert.deepEqual(incluirRepo([], v), { ok: false, erro: 'Use o formato owner/repo, como minha-org/meu-repo.' }, v);
  }
  assert.deepEqual(incluirRepo(['acme/web'], 'Acme/Web'), { ok: false, erro: 'acme/web já está na lista.' });
});

test('tirarRepo tira sem diferenciar caixa, e o resto fica', () => {
  assert.deepEqual(tirarRepo(['acme/web', 'acme/api'], 'ACME/WEB'), ['acme/api']);
});

test('o bloco: vazio, um e vários repos, com a contagem de PRs meus e os atalhos dos livres', () => {
  const vazio = reposBloqueadosHtml([], MEUS);
  assert.deepEqual([vazio.contagem, vazio.vazio, vazio.itens], ['', true, '']);
  assert.match(vazio.sugestoes, /^<span>Dos seus PRs abertos:<\/span>/);
  assert.match(vazio.sugestoes, /data-repo="acme\/api" aria-label="Bloquear acme\/api">\+ acme\/api</);
  const um = reposBloqueadosHtml(['acme/web'], MEUS);
  assert.equal(um.contagem, '1 repo');
  assert.match(um.itens, /<code class="mb-repo">acme\/web<\/code><span class="mb-meta">2 PRs seus abertos<\/span>/);
  assert.match(um.itens, /aria-label="Tirar acme\/web da lista">Tirar<\/button>/);
  assert.doesNotMatch(um.sugestoes, /acme\/web/, 'repo já bloqueado não é sugerido');
  const varios = reposBloqueadosHtml(['acme/zeta', 'acme/api', 'acme/web'], MEUS);
  assert.equal(varios.contagem, '3 repos');
  assert.ok(varios.itens.indexOf('acme/api') < varios.itens.indexOf('acme/web'), 'ordem alfabética');
  assert.match(varios.itens, /acme\/api<\/code><span class="mb-meta">1 PR seu aberto</);
  assert.match(varios.itens, /acme\/zeta<\/code><span class="mb-meta">nenhum PR seu aberto agora</);
  assert.equal(varios.sugestoes, '', 'sem repo livre, sem atalhos');
});

test('os textos: toasts, title do Merge e a linha com o atalho que leva à lista', () => {
  assert.equal(prsDoRepo(MEUS, 'acme/web'), 2);
  assert.equal(textoDoMergeBloqueado('acme/web', 2), 'acme/web bloqueado. O Merge some de 2 PRs seus.');
  assert.equal(textoDoMergeBloqueado('acme/api', 1), 'acme/api bloqueado. O Merge some de 1 PR seu.');
  assert.equal(textoDoMergeBloqueado('acme/x', 0), 'acme/x bloqueado.');
  assert.equal(textoDoMergeDesbloqueado('acme/web'), 'acme/web desbloqueado. O Merge volta a valer nos seus PRs desse repo.');
  assert.equal(tituloDoMergeBloqueado('acme/web'), 'Merge bloqueado para acme/web (lista em Sistema → Automação)');
  assert.match(notaDoMergeBloqueadoHtml(), /data-goto="sys:automation:#sys-row-mergeblocked" role="button" tabindex="0"/);
});

test('a seção Conexões saiu inteira, e o bloco novo está em Automação com o alvo do atalho', () => {
  for (const id of ['sys-connections', 'sysbtn-connections', 'setUser', 'setOwners', 'setMergeBlocked']) {
    assert.doesNotMatch(HTML, new RegExp(`id="${id}"`), id);
  }
  const automacao = HTML.slice(HTML.indexOf('id="sys-automation"'), HTML.indexOf('<!-- Jira -->'));
  for (const id of ['sys-row-mergeblocked', 'mbAdd', 'mbAddBtn', 'mbList', 'mbEmpty', 'mbSug', 'mbErro', 'mbCount']) {
    assert.match(automacao, new RegExp(`id="${id}"`), id);
  }
  const telas = ler('ui/telas/acoes.js') + ler('ui/telas/sistema.js');
  assert.doesNotMatch(telas, /'ghUser'|'owners'|#setUser|#setOwners|#setMergeBlocked|sec: 'connections'/, 'nada lê nem grava os campos que saíram');
  assert.match(ler('ui/telas/sistema.js'), /sec: 'automation', at: '#sys-row-mergeblocked'/, 'a busca acha a lista no lugar novo');
  assert.match(ler('ui/telas/sistema.js'), /title: 'Organizações monitoradas \(por conta\)'/, 'e acha as organizações em Contas');
});

test('o card de Meus PRs testa o bloqueio antes de tudo e mostra a linha com o atalho', () => {
  const fonte = ler('ui/telas/meus-prs.js');
  const i = fonte.indexOf("let mergeBtns = '';");
  const primeiro = fonte.slice(i, i + 600);
  assert.match(primeiro, /if \(repoBlocked\) \{\s*\n\s*mergeBtns = btnMerge\(true, tituloDoMergeBloqueado\(repo\)\);/);
  assert.match(fonte, /\$\{repoBlocked \? notaDoMergeBloqueadoHtml\(\) : ''\}/);
  assert.doesNotMatch(fonte, /edite a lista na aba Sistema/, 'o motivo vago saiu');
});

test('Entregas leva as organizações para Sistema → Contas, onde elas moram', () => {
  assert.match(delivEmptyState({}), /organizações de cada conta em <span class="is-goto" data-goto="sys:accounts:#accountsManager"/);
});
