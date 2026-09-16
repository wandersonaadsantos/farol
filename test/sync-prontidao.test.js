// Prontidão do distribuidor (CT-PRONT), a parte pura.
//
// O caso que a spec nomeia com todas as letras: **falha não é disfarçada de fila vazia**.
// Ciclo com exceção, com leitura que não conclui, com falha devolvida sem exceção ou que
// estourou o prazo NÃO renova a prontidão, e "fila vazia" continua sendo resultado
// legítimo, que renova.
import os from 'node:os';
import path from 'node:path';
process.env.FAROL_HOME = process.env.FAROL_HOME || path.join(os.tmpdir(), 'farol-test-prontidao-' + process.pid);

import { test } from 'node:test';
import assert from 'node:assert/strict';

const prontidao = (await import('../lib/sync/prontidao.js')).default;
const { SYNC } = await import('../lib/constants.js');

const T = 1_800_000_000_000;
const LEU_TUDO = { candidatos: true, ocupacao: true, politicas: true };

function ciclo(extra = {}) {
  return { leituras: LEU_TUDO, avaliados: [], duracaoMs: 10, ...extra };
}

test('fila vazia é ciclo saudável, e renova', () => {
  assert.deepEqual(prontidao.cicloSaudavel(ciclo()), { ok: true, motivo: '' });
});

test('resultados legítimos renovam: sem vaga, política, orçamento, ninguém apto, isolado', () => {
  for (const desfecho of ['atribuido', 'sem-vaga', 'politica', 'orcamento', 'sem-aparelho-apto', 'espera-com-motivo', 'isolado']) {
    assert.equal(prontidao.cicloSaudavel(ciclo({ avaliados: [{ itemId: 'i1', desfecho }] })).ok, true, desfecho);
  }
});

test('exceção, leitura incompleta, falha devolvida e prazo estourado NÃO renovam', () => {
  assert.deepEqual(prontidao.cicloSaudavel(ciclo({ erro: 'excecao' })), { ok: false, motivo: 'excecao' });
  const semLeitura = prontidao.cicloSaudavel(ciclo({ leituras: { candidatos: true, ocupacao: false, politicas: true } }));
  assert.deepEqual([semLeitura.ok, semLeitura.motivo, semLeitura.fonte], [false, 'leitura-incompleta', 'ocupacao']);
  const devolvida = prontidao.cicloSaudavel(ciclo({ avaliados: [{ itemId: 'i9', desfecho: 'deu ruim' }] }));
  assert.deepEqual([devolvida.ok, devolvida.motivo, devolvida.itemId], [false, 'falha-devolvida', 'i9']);
  assert.equal(prontidao.cicloSaudavel(ciclo({ duracaoMs: SYNC.AUTORIDADE_INTERVALO_MS + 1 })).motivo, 'prazo-estourado');
  assert.equal(prontidao.cicloSaudavel(ciclo({ erro: 'coisa estranha' })).motivo, 'estado-impede', 'erro desconhecido não vira sucesso');
});

test('a impressão da causa muda com revisão, geração ou dependência', () => {
  const base = { revisao: 3, geracao: 'g1', versoes: { politica: 7, keyring: 2 } };
  assert.equal(prontidao.impressaoDaCausa(base), prontidao.impressaoDaCausa({ ...base, versoes: { keyring: 2, politica: 7 } }), 'ordem não conta');
  assert.notEqual(prontidao.impressaoDaCausa(base), prontidao.impressaoDaCausa({ ...base, revisao: 4 }));
  assert.notEqual(prontidao.impressaoDaCausa(base), prontidao.impressaoDaCausa({ ...base, geracao: 'g2' }));
  assert.notEqual(prontidao.impressaoDaCausa(base), prontidao.impressaoDaCausa({ ...base, versoes: { politica: 8, keyring: 2 } }));
});

// Recuperação sem HEAD novo: a causa mudou, então reavalia.
test('registro isolado volta quando a causa muda, mesmo sem head novo', () => {
  const causa = prontidao.impressaoDaCausa({ revisao: 1, geracao: 'g1', versoes: { politica: 1 } });
  const defeito = prontidao.isolar(null, { causa, motivo: 'envelope-ilegivel', agora: T });
  assert.equal(prontidao.deveReavaliar(defeito, causa, { agora: T + 1000 }), false, 'sem mudança, não custa nada por ciclo');
  const outra = prontidao.impressaoDaCausa({ revisao: 1, geracao: 'g1', versoes: { politica: 2 } });
  assert.equal(prontidao.deveReavaliar(defeito, outra, { agora: T + 1000 }), true);
});

test('causa externa: a revalidação cresce e para no teto de uma hora', () => {
  const causa = 'mesma';
  let d = prontidao.isolar(null, { causa, motivo: 'dependencia-indisponivel', agora: T });
  const primeira = d.espera;
  d = prontidao.isolar(d, { causa, motivo: 'dependencia-indisponivel', agora: T + primeira });
  assert.equal(d.espera, primeira * 2, 'intervalo crescente');
  for (let i = 0; i < 20; i++) d = prontidao.isolar(d, { causa, motivo: 'x', agora: T + i });
  assert.equal(d.espera, prontidao.BACKOFF_TETO_MS);
  assert.equal(d.desde, T, 'a mesma causa mantém desde quando ela dura');
  assert.equal(prontidao.deveReavaliar(d, causa, { agora: d.proxima }), true, 'vencida a janela, tenta de novo');
});

// Ocupação (CT-PRONT, seção da recuperação).
const RESUMO_FRESCO = { frescoAte: T + 1000, porEstado: { reserva: 1, execucao: 1, fila: 3 }, atribuicoes: [] };

test('reserva e execução somam; fila só informa', () => {
  const r = prontidao.ocupacaoDe('dA', { resumo: RESUMO_FRESCO, atribuicoes: [], leases: [], agora: T });
  assert.equal(r.total, 2, 'fila não ocupa');
});

test('atribuição enviada e não aceita conta como provisória, e some quando vira reserva', () => {
  const atribuicoes = [{ id: 'at1', dev: 'dA', ttl: T + 5000 }];
  const antes = prontidao.ocupacaoDe('dA', { resumo: RESUMO_FRESCO, atribuicoes, leases: [], agora: T });
  assert.equal(antes.total, 3);
  assert.equal(antes.provisorias, 1);
  const depois = prontidao.ocupacaoDe('dA', { resumo: { ...RESUMO_FRESCO, atribuicoes: ['at1'] }, atribuicoes, leases: [], agora: T });
  assert.equal(depois.total, 2, 'nem dupla contagem, nem omissão na passagem');
  const vencida = prontidao.ocupacaoDe('dA', { resumo: RESUMO_FRESCO, atribuicoes: [{ id: 'at2', dev: 'dA', ttl: T - 1 }], leases: [], agora: T });
  assert.equal(vencida.total, 2, 'atribuição vencida libera a ocupação provisória');
});

test('aparelho em versão antiga aparece pelo lease; com resumo fresco o lease não soma de novo', () => {
  const leases = [{ dev: 'dB', expiresAt: T + 1000 }, { dev: 'dB', expiresAt: T - 1 }];
  const antigo = prontidao.ocupacaoDe('dB', { resumo: null, atribuicoes: [], leases, agora: T });
  assert.deepEqual([antigo.total, antigo.porLease, antigo.temResumo], [1, 1, false]);
  const novo = prontidao.ocupacaoDe('dB', { resumo: RESUMO_FRESCO, atribuicoes: [], leases, agora: T });
  assert.equal(novo.total, 2, 'o lease não soma por cima do resumo');
});

test('sem resumo fresco, o aparelho é inapto para atribuição nova', () => {
  const ctx = { atribuicoes: [], leases: [], agora: T };
  assert.equal(prontidao.aptoParaAtribuir('dA', { ...ctx, resumo: RESUMO_FRESCO }), true);
  assert.equal(prontidao.aptoParaAtribuir('dA', { ...ctx, resumo: { ...RESUMO_FRESCO, frescoAte: T - 1 } }), false);
  assert.equal(prontidao.aptoParaAtribuir('dA', { ...ctx, resumo: null }), false);
});
