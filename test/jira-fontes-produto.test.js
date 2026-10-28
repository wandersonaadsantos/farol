import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-fontes-produto-'));
process.env.FAROL_HOME = home;
const { fontesDeProduto } = await import('../lib/engine/jira.js');
const jira = (await import('../lib/engine/jira.js')).default;
const { criteriaContext } = await import('../lib/engine/review-criteria-context.js');
const { setCredential } = await import('../lib/jira/credentials.js');
after(() => fs.rmSync(home, { recursive: true, force: true }));
const card = { ok: true, card: { key: 'CARD-1' }, site: { id: 'teste', baseUrl: 'https://a.atlassian.net' }, fromCache: true };
const issue = { key: 'CARD-1', fields: { description: 'Descrição atualizada', updated: 'agora' } };
function rede(paginas) {
  const urls = [];
  return { urls, fetchImpl: async url => {
    urls.push(url);
    const corpo = url.includes('/comment?') ? paginas.shift() : issue;
    return { ok: true, text: async () => JSON.stringify(corpo) };
  } };
}

test('sem card ou credencial, não busca nem confirma procedência', async () => {
  assert.deepEqual(await fontesDeProduto({ ok: false }), { completa: false, itens: [] });
  assert.equal((await fontesDeProduto(card, () => assert.fail('rede'))).completa, false);
});

test('relê descrição sem cache, pagina comentários e só conserva metadados necessários', async () => {
  setCredential('teste', { email: 'fixture@example.test', token: 'fixture' });
  const c = { id: '123', body: 'Decisão registrada', author: { accountId: 'autor', emailAddress: 'privado' }, updated: 'hoje' };
  const r = rede([{ startAt: 0, total: 2, comments: [c] }, { startAt: 1, total: 2, comments: [{ ...c, id: '456' }] }]);
  const lido = await fontesDeProduto(card, r.fetchImpl);
  assert.equal(lido.completa, true);
  assert.equal(lido.itens.length, 3);
  assert.equal(lido.itens[0].texto, issue.fields.description);
  assert.equal(lido.cardAtual.description, issue.fields.description);
  assert.equal(lido.itens[1].autor, 'autor');
  assert.ok(!JSON.stringify(lido).includes('privado'));
  assert.ok(r.urls[2].endsWith('startAt=1&maxResults=100'));
});

test('página repetida, formato ilegível, página vazia ou erro deixam leitura incompleta', async () => {
  for (const pagina of [{ startAt: 1, total: 2, comments: [] }, { startAt: 0, total: 2, comments: [] },
    { startAt: 0, total: 1, comments: [{ id: '1', body: {} }] }, { erro: true }]) {
    assert.equal((await fontesDeProduto(card, rede([pagina]).fetchImpl)).completa, false);
  }
  const r = await fontesDeProduto(card, async () => { throw new Error('segredo do fornecedor'); });
  assert.deepEqual(r, { completa: false, itens: [] });
});

test('limite de páginas não transforma leitura parcial em prova completa', async () => {
  const paginas = Array.from({ length: 5 }, (_, i) => ({ startAt: i, total: 6, comments: [{ id: String(i), body: 'texto' }] }));
  assert.equal((await fontesDeProduto(card, rede(paginas).fetchImpl)).completa, false);
});

test('duplicação e alteração de total entre páginas deixam procedência incompleta', async () => {
  const c = { id: '123', body: 'Registro' };
  for (const segunda of [{ startAt: 1, total: 2, comments: [c] }, { startAt: 1, total: 3, comments: [{ ...c, id: '456' }] }]) {
    const paginas = [{ startAt: 0, total: 2, comments: [c] }, segunda];
    assert.equal((await fontesDeProduto(card, rede(paginas).fetchImpl)).completa, false);
  }
});

test('contexto usa descrição relida e não instrui o revisor a aceitar o card antigo do cache', async () => {
  const original = jira.fontesDeProduto;
  const paginas = [{ startAt: 0, total: 0, comments: [] }];
  const redeAtual = rede(paginas);
  jira.fontesDeProduto = r => fontesDeProduto(r, redeAtual.fetchImpl);
  try {
    const antigo = { ...card, card: { key: 'CARD-1', summary: 'Antigo', criteria: ['Resumo antigo'] } };
    const engine = { accountForPr: () => 'ana', decisions: { pending: [], resolved: [] } };
    const ctx = await criteriaContext(antigo);
    assert.ok(ctx.prompt.includes('Descrição atualizada'));
    assert.ok(!ctx.prompt.includes('Resumo antigo'));
    assert.equal(ctx.sources.completa, true);
    assert.equal(antigo.card.summary, 'Antigo', 'não altera o objeto de cache recebido');
  } finally { jira.fontesDeProduto = original; }
});
