import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anotarFilaDoConjunto } from '../lib/engine/sync-candidatos.js';
import { acctTag, prTag } from '../lib/sync/tags.js';
import { motivoDoDestino } from '../lib/sync/transferencia.js';

const kId = Buffer.alloc(32, 7);
const tagDaConta = acctTag(kId, 'reviewer');
const tagDoPr = prTag(kId, 'acme/app#10');
const cfg = { enabled: true, shared: { enabled: true } };
const item = { itemId: `${tagDoPr}_${'b'.repeat(32)}`, prTag: tagDoPr, acctTag: tagDaConta, publicadores: ['celular'] };

function engine({ conhecida = true, local = false, token = false } = {}) {
  return {
    sync: {
      material: { id: kId.toString('base64url') }, client: {},
      listasRemotas: { escopos: new Map(conhecida ? [['remote', { scope: tagDaConta, conta: 'reviewer' }]] : []) },
      catalogoLru: new Map([[tagDoPr, { key: 'acme/app#10', title: 'Correção', author: 'author', repo: 'acme/app' }]]),
    },
    accountList: () => [{ user: local ? 'reviewer' : 'author' }],
    accountForPr: () => 'author',
    tokenFor: user => token && user === 'reviewer' ? 'token-sintetico' : '',
  };
}

test('candidato identifica a conta revisora, sem atribuir a conta local da organização', async () => {
  const [linha] = await anotarFilaDoConjunto(engine(), cfg, { itens: [item], agora: 1000 });
  assert.equal(linha.pr.account, 'reviewer');
  assert.deepEqual(linha.conta, { nome: 'reviewer', conhecida: true, configuradaAqui: false, autenticadaAqui: false });
  assert.equal(linha.pr.author, 'author');
});

test('conta desconhecida não é substituída pela conta do catálogo', async () => {
  const [linha] = await anotarFilaDoConjunto(engine({ conhecida: false }), cfg, { itens: [item], agora: 1000 });
  assert.equal(linha.pr.account, '');
  assert.equal(linha.conta.conhecida, false);
  assert.equal(linha.conta.nome, tagDaConta.slice(0, 8));
});

test('configurar a conta sem token não afirma que o aparelho pode autenticá-la', async () => {
  for (const token of [false, true]) {
    const [linha] = await anotarFilaDoConjunto(engine({ local: true, token }), cfg, { itens: [item], agora: 1000 });
    assert.equal(linha.conta.configuradaAqui, true);
    assert.equal(linha.conta.autenticadaAqui, token);
  }
});

test('falta de credencial é explicada antes da ausência de publicação, sem admitir o destino', () => {
  const base = {
    id: 'host', aparelho: { contract: 2, keyReady: true, lastSeenAt: 1000 },
    resumo: { frescoAte: 2000, teto: 2, ocupadas: 0, contasComToken: [], ramLivre: 'alta' },
    acctTag: tagDaConta, agora: 1000, publicadores: ['celular'],
  };
  assert.equal(motivoDoDestino(base), 'sem-credencial');
  const comToken = { ...base, resumo: { ...base.resumo, contasComToken: [tagDaConta] } };
  assert.equal(motivoDoDestino(comToken), 'nao-publicou');
  assert.equal(motivoDoDestino({ ...comToken, publicadores: ['host'] }), '');
});
