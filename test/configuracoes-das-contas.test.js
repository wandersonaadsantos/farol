// Revisão das configurações das contas (29/09/2026, pedido do dono: "não quero de maneira
// nenhuma habilitar um botão à toa"). A chave geral da Automação diz quantas contas ela
// alcança, o campo sem chave geral para de prometer que herda uma, e o nome do perfil diz
// que ele escolhe o login do Claude, não o modelo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const P = await import('../ui/pure.js');
const HTML = fs.readFileSync(path.join(import.meta.dirname, '..', 'ui', 'index.html'), 'utf8');

const BIUDER = { user: 'biuder', onReject: 'request_changes' };
const PESSOAL = { user: 'pessoal', autoReview: true, onClean: 'approve', onCaveats: 'approve' };
const MUDA = { user: 'antiga', muted: true };

test('alcance: diz quantas contas ativas a chave geral alcança e quem tem valor próprio', () => {
  assert.equal(P.alcanceDaChaveGeral([BIUDER, PESSOAL, MUDA], 'autoReview'), 'Vale para 1 de 2 contas ativas; @pessoal tem configuração própria em Contas.');
  assert.equal(P.alcanceDaChaveGeral([BIUDER, MUDA], 'autoReview'), 'Vale para a conta ativa.', 'silenciada não conta');
  assert.equal(P.alcanceDaChaveGeral([BIUDER, { user: 'b2' }], 'autoReview'), 'Vale para as 2 contas ativas.');
  assert.equal(P.alcanceDaChaveGeral([PESSOAL], 'autoReview'), 'Não vale para nenhuma conta agora: todas têm configuração própria em Contas.');
  assert.equal(P.alcanceDaChaveGeral([], 'autoReview'), '');
  assert.equal(P.alcanceDaChaveGeral([BIUDER], 'inventada'), '');
});

test('alcance das ressalvas: a conta cujo sem ressalvas espera você não segue a chave geral', () => {
  const espera = { user: 'cautelosa', onClean: 'wait' };
  assert.equal(P.alcanceDaChaveGeral([BIUDER, espera], 'autoApproveAll'), 'Vale para 1 de 2 contas ativas; @cautelosa tem configuração própria em Contas.');
  assert.equal(P.alcanceDaChaveGeral([BIUDER, PESSOAL], 'autoApproveAll'), 'Vale para 1 de 2 contas ativas; @pessoal tem configuração própria em Contas.');
});

test('as duas chaves gerais têm onde dizer o alcance, ao lado da descrição', () => {
  assert.match(HTML, /id="sys-row-autoreview"[\s\S]*?id="alcanceAutoReview"[\s\S]*?id="setAutoReview"/);
  assert.match(HTML, /id="sys-row-autoapprove"[\s\S]*?id="alcanceAutoApproveAll"[\s\S]*?id="setAutoApproveAll"/);
});

test('Contas: o sem ressalvas não promete herdar uma chave geral que não existe', () => {
  const html = P.accountsManagerHtml({ accounts: [BIUDER], acct: {}, config: { claudeProfiles: [] } });
  assert.match(html, /<option value="">padrão: aprova sozinho<\/option>/);
  assert.doesNotMatch(html, /herda o geral: aprova sozinho/);
});

test('Contas: o perfil diz que escolhe o login do Claude, e que o modelo vem da Automação', () => {
  const html = P.accountsManagerHtml({ accounts: [BIUDER], acct: {}, config: { claudeProfiles: [] } });
  assert.match(html, /login do Claude \(plano\)/);
  assert.match(html, /O modelo e o raciocínio vêm de Sistema &gt; Automação|O modelo e o raciocínio vêm de Sistema > Automação/);
  assert.doesNotMatch(html, /a-fieldlabel">perfil de IA</);
});

test('Automação: a co-assinatura avisa no app, não no PR, e respeita a conta', () => {
  const desc = HTML.slice(HTML.indexOf('id="sys-row-coassinar"'), HTML.indexOf('id="sys-row-reviewfast"'));
  assert.doesNotMatch(desc, /avisa no PR/);
  assert.match(desc, /sem postar nada no PR/);
  assert.match(desc, /espera você também não co-assina/);
});
