// Sincronização na tela, a parte da trilha C (brief B2 item 2.4): os interruptores de
// compartilhamento e distribuição, o estado "pedido, não aplicado" quando o Farol mantém o
// efeito desligado, e o cartão da chave do conjunto (bloqueada, perdida, pronta).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const { syncTogglesHtml, syncCfgComGeral, syncCfgSemCompartilhamento, syncChaveHtml, syncSecaoHtml } = await import('../ui/pure.js');

const RAIZ = path.join(import.meta.dirname, '..');
const TELA = fs.readFileSync(path.join(RAIZ, 'ui', 'telas', 'sistema-sync.js'), 'utf8');

const LIGADO = { enabled: true, coordination: { enabled: true }, consolidation: { enabled: true }, shared: { enabled: true }, distribution: { enabled: true } };

test('os interruptores de compartilhar e distribuir existem, com a dependência entre eles', () => {
  const html = syncTogglesHtml(LIGADO, {});
  assert.match(html, /id="setSyncShared" checked/);
  assert.match(html, /id="setSyncDistribution" checked/);
  const semCompartilhar = syncTogglesHtml({ ...LIGADO, shared: { enabled: false } }, {});
  assert.match(semCompartilhar, /id="setSyncDistribution"(?: checked)? disabled/, 'distribuir depende de compartilhar: o pedido continua marcado, mas travado');
  const semCoordenar = syncTogglesHtml({ ...LIGADO, coordination: { enabled: false } }, {});
  assert.match(semCoordenar, /id="setSyncDistribution" checked disabled|id="setSyncDistribution" disabled/, 'e de coordenar');
});

test('bloqueado pelo Farol, o interruptor mostra o pedido e diz que não está valendo', () => {
  const html = syncTogglesHtml(LIGADO, { bloqueioCompartilhamento: 'autenticacao-local' });
  assert.match(html, /pedido, não aplicado aqui/);
  assert.equal((html.match(/pedido, não aplicado aqui/g) || []).length, 2, 'nos dois interruptores afetados');
  assert.doesNotMatch(syncTogglesHtml(LIGADO, {}), /não aplicado/, 'sem bloqueio, sem aviso');
});

test('desligar a chave geral zera também compartilhar e distribuir', () => {
  const c = syncCfgComGeral(LIGADO, false);
  assert.equal(c.shared.enabled, false);
  assert.equal(c.distribution.enabled, false);
  const religado = syncCfgComGeral(c, true);
  assert.equal(religado.shared.enabled, false, 'religar a geral não religa nada sozinho');
});

test('desligar compartilhar desliga distribuir, e religar não religa sozinho', () => {
  const c = syncCfgSemCompartilhamento(LIGADO);
  assert.equal(c.shared.enabled, false);
  assert.equal(c.distribution.enabled, false);
  assert.equal(c.coordination.enabled, true, 'coordenar é independente e continua');
});

test('o cartão da chave diz o estado e oferece só a ação que cabe', () => {
  assert.equal(syncChaveHtml({ chave: 'desligada' }), '', 'sem compartilhamento, a chave não aparece');
  const pronta = syncChaveHtml({ chave: 'pronta' });
  assert.match(pronta, /pronta/);
  assert.doesNotMatch(pronta, /id="syncUnlock"/);
  assert.doesNotMatch(pronta, /syncChaveSenha/, 'chave aberta não pede senha de novo');
  const bloqueada = syncChaveHtml({ chave: 'bloqueada' });
  assert.match(bloqueada, /id="syncChaveSenha" type="password"/);
  assert.match(bloqueada, /id="syncUnlock"/);
  assert.match(bloqueada, /Redefinir a senha/, 'diz que redefinir a senha não abre a chave antiga');
  assert.doesNotMatch(bloqueada, /id="syncNewEpoch"/);
  const perdida = syncChaveHtml({ chave: 'perdida' });
  assert.match(perdida, /id="syncNewEpoch"/);
  assert.match(perdida, /não recria sozinho/);
  assert.doesNotMatch(perdida, /id="syncUnlock"/);
});

test('a recusa do desbloqueio aparece com o motivo do engine, escapado', () => {
  const html = syncChaveHtml({ chave: 'bloqueada' }, { motivo: 'a senha não abre a chave <b>x</b>' });
  assert.match(html, /a senha não abre a chave &lt;b&gt;x&lt;\/b&gt;/);
});

test('a seção inclui o cartão da chave quando a sincronização está ligada', () => {
  const html = syncSecaoHtml({ chave: 'bloqueada' }, LIGADO, null, null);
  assert.match(html, /id="syncUnlock"/);
});

test('a tela salva os interruptores novos e liga desbloquear e gerar chave às rotas', () => {
  assert.match(TELA, /setSyncShared/);
  assert.match(TELA, /setSyncDistribution/);
  assert.match(TELA, /\/api\/sync\/unlock/);
  assert.match(TELA, /\/api\/sync\/new-epoch/);
  // a regra de "desligar compartilhar leva distribuir junto" é pura e está testada acima;
  // aqui se prova que a tela usa ela, em vez de montar o objeto por fora
  const toggle = TELA.slice(TELA.indexOf('function syncToggle('), TELA.indexOf('/* Chave do conjunto'));
  assert.match(toggle, /syncCfgSemCompartilhamento\(c\)/);
});
