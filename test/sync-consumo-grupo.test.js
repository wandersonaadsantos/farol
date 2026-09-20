// Soma do consumo do grupo (7.C4b, CT-GRUPO): a parte pura.
//
// O contrato em uma frase: o que não se consegue provar completo NÃO é mostrado como
// completo. Leitura que falhou, rollup torto, lacuna na sequência e reserva anunciada por
// quem sumiu deixam o orçamento "não verificável"; valor desconhecido conta pela reserva
// do custo típico e marca "parcialmente estimado".
import os from 'node:os';
import path from 'node:path';
process.env.FAROL_HOME = process.env.FAROL_HOME || path.join(os.tmpdir(), 'farol-test-consumo-grupo-' + process.pid);

import { test } from 'node:test';
import assert from 'node:assert/strict';

const cg = (await import('../lib/sync/consumo-grupo.js')).default;
const { SYNC } = await import('../lib/constants.js');

const G = 'a'.repeat(32);
const OUTRO = 'b'.repeat(32);
// 2026-09-16 (quarta-feira) às 12:00 em Brasília
const T = Date.UTC(2026, 8, 16, 15, 0, 0);

function rollup(seq, grupos) {
  return { v: 1, u: T, seq, g: grupos };
}

function remoto(extra = {}) {
  return {
    dev: 'dB',
    rollups: { '2026-09-16': rollup(4, { [G]: { c: 3, s: 2, d: 0, t: 1.5 } }) },
    status: { u: T, consumo: { seq: 4, dia: '2026-09-16', grupos: {} } },
    ...extra,
  };
}

function somar(remotos, extra = {}) {
  return cg.somarGrupo({ grupoId: G, periodo: 'dia', agora: T, local: { custo: 1, desconhecidas: 0, reservas: 0, tipico: 2 }, remotos, tipicoPadrao: 9, ...extra });
}

test('início do período no dia canônico: dia, segunda-feira e primeiro do mês', () => {
  assert.equal(cg.inicioDoPeriodo('dia', T), '2026-09-16');
  assert.equal(cg.inicioDoPeriodo('semana', T), '2026-09-14');
  assert.equal(cg.inicioDoPeriodo('mes', T), '2026-09-01');
  const domingo = Date.UTC(2026, 8, 20, 15);
  assert.equal(cg.inicioDoPeriodo('semana', domingo), '2026-09-14', 'domingo ainda é da semana que começou na segunda');
  const tardeUtc = Date.UTC(2026, 8, 17, 2);
  assert.equal(cg.inicioDoPeriodo('dia', tardeUtc), '2026-09-16', 'o corte é o de Brasília, não o do UTC');
  assert.equal(cg.inicioDoPeriodo('ano', T), null, 'período desconhecido não vira dia');
});

test('rollup saneado: forma exata, e o que foge dela não é somado', () => {
  assert.deepEqual(cg.sanearRollup(rollup(1, { [G]: { c: 1, s: 1, d: 0, t: 0.5, extra: 9 } })), rollup(1, { [G]: { c: 1, s: 1, d: 0, t: 0.5 } }));
  assert.equal(cg.sanearRollup({ v: 2, u: T, seq: 1, g: {} }), null);
  assert.equal(cg.sanearRollup(rollup(1, { [G]: { c: -1, s: 1, d: 0 } })), null, 'custo negativo é defeito, não zero');
  assert.equal(cg.sanearRollup(rollup(1, { 'nao-e-id': { c: 1, s: 1, d: 0 } })), null);
  assert.equal(cg.sanearRollup(null), null);
});

test('consumo de outro aparelho do mesmo grupo soma com o local', () => {
  const r = somar([remoto()]);
  assert.equal(r.verificavel, true);
  assert.equal(r.custo, 4);
  assert.equal(r.parcialmenteEstimado, false);
});

test('o consumo de OUTRO grupo e o de fora do período não entram', () => {
  const r = somar([remoto({
    rollups: {
      '2026-09-15': rollup(3, { [G]: { c: 50, s: 1, d: 0 } }),
      '2026-09-16': rollup(4, { [G]: { c: 3, s: 2, d: 0 }, [OUTRO]: { c: 70, s: 1, d: 0 } }),
    },
  })]);
  assert.equal(r.custo, 4);
  const semana = somar([remoto({
    rollups: {
      '2026-09-15': rollup(3, { [G]: { c: 50, s: 1, d: 0 } }),
      '2026-09-16': rollup(4, { [G]: { c: 3, s: 2, d: 0 } }),
    },
  })], { periodo: 'semana' });
  assert.equal(semana.custo, 54);
});

test('valor desconhecido conta e marca parcialmente estimado', () => {
  const r = somar([remoto({ rollups: { '2026-09-16': rollup(4, { [G]: { c: 3, s: 2, d: 1 } }) } })], { local: { custo: 0, desconhecidas: 1, reservas: 0, tipico: 0 } });
  assert.equal(r.desconhecidas, 2);
  assert.equal(r.parcialmenteEstimado, true);
  assert.equal(r.verificavel, true, 'desconhecido é estimado, não inverificável');
});

test('reservas vivas de três aparelhos somam, e a reserva vencida vira cobertura incompleta', () => {
  const com = (dev, n, u = T) => remoto({ dev, status: { u, consumo: { seq: 4, dia: '2026-09-16', grupos: { [G]: n } } } });
  const r = somar([com('dB', 1), com('dC', 2)], { local: { custo: 0, desconhecidas: 0, reservas: 1, tipico: 0 } });
  assert.equal(r.reservas, 4);
  assert.equal(r.verificavel, true);
  const velha = somar([com('dB', 1, T - SYNC.RESERVA_GRUPO_TTL_MS - 1)]);
  assert.equal(velha.verificavel, false);
  assert.deepEqual(velha.motivos, [{ dev: 'dB', motivo: 'reserva-vencida' }]);
  const velhaSemReserva = somar([com('dB', 0, T - SYNC.RESERVA_GRUPO_TTL_MS - 1)]);
  assert.equal(velhaSemReserva.verificavel, true, 'aparelho quieto sem reserva não impede');
});

test('lacuna na sequência deixa o orçamento não verificável', () => {
  const atrasado = remoto({ status: { u: T, consumo: { seq: 6, dia: '2026-09-16', grupos: {} } } });
  const r = somar([atrasado]);
  assert.equal(r.verificavel, false);
  assert.deepEqual(r.motivos, [{ dev: 'dB', motivo: 'lacuna' }]);
  const semODia = remoto({ rollups: {}, status: { u: T, consumo: { seq: 1, dia: '2026-09-16', grupos: {} } } });
  assert.equal(somar([semODia]).motivos[0].motivo, 'lacuna', 'o dia anunciado sem rollup também é lacuna');
  const ontem = remoto({ rollups: {}, status: { u: T, consumo: { seq: 1, dia: '2026-09-15', grupos: {} } } });
  assert.equal(somar([ontem]).verificavel, true, 'sessão anterior ao período não é lacuna do período');
});

test('leitura que falhou, rollup inválido e aparelho sem capacidade não são completos', () => {
  assert.deepEqual(somar([remoto({ rollups: null })]).motivos, [{ dev: 'dB', motivo: 'sem-dados' }]);
  assert.deepEqual(somar([remoto({ status: null })]).motivos, [{ dev: 'dB', motivo: 'sem-dados' }]);
  const torto = remoto({ rollups: { '2026-09-16': { v: 1, seq: 'x' } } });
  assert.deepEqual(somar([torto]).motivos, [{ dev: 'dB', motivo: 'invalido' }]);
});

test('custo típico: mediana do que se sabe, e o padrão quando ninguém sabe', () => {
  const r = somar([remoto()]);
  assert.equal(r.tipico, 1.75, 'mediana de 1,5 (remoto) e 2 (local)');
  const nada = somar([], { local: { custo: 0, desconhecidas: 0, reservas: 0, tipico: 0 } });
  assert.equal(nada.tipico, 9);
});

test('perfil sintético: dia usa o teto diário, semana e mês usam o total desde o início', () => {
  const soma = { custo: 7, desconhecidas: 1, reservas: 2 };
  const dia = cg.perfilDoGrupo({ id: G, nome: 'Time', periodo: 'dia', tetoUsd: 10 }, soma, { hoje: '2026-09-16', inicio: '2026-09-16', kind: 'claude' });
  assert.equal(dia.profile.id, `grupo:${G}`);
  assert.equal(dia.profile.budgetDaily, 10);
  assert.equal(dia.profile.budgetTotal, undefined);
  assert.equal(dia.store.byProfileDay[`grupo:${G}|2026-09-16`].costUsd, 7);
  assert.deepEqual(dia.nd, { hoje: 3, desde: 3 });
  const mes = cg.perfilDoGrupo({ id: G, nome: 'Time', periodo: 'mes', tetoUsd: 10 }, soma, { hoje: '2026-09-16', inicio: '2026-09-01', kind: 'claude' });
  assert.equal(mes.profile.budgetDaily, undefined);
  assert.equal(mes.profile.budgetTotal, 10);
  assert.equal(mes.profile.budgetSince, '2026-09-01');
  assert.equal(mes.store.byProfileDay[`grupo:${G}|2026-09-01`].costUsd, 7);
});

/* ---------- aposentado: encerra a exigência, não a contabilidade (20/09/2026) ----------
   A matriz que interessa, uma linha por caso:
     ativo com informação válida      -> soma, verificável
     ativo offline / retrato velho    -> NÃO verificável (sumir não é aposentar)
     aposentado com gasto na janela   -> soma, verificável, reservas zeradas pelo TTL
     aposentado sem dado suficiente   -> continua NÃO verificável se o dado não foi lido
     aposentado com rollup torto      -> continua inválido */

test('aposentado sem retrato: o gasto publicado continua somando, e o grupo fica verificável', () => {
  const r = somar([remoto({ aposentado: true, status: null })]);
  assert.equal(r.verificavel, true);
  assert.equal(r.custo, 4, 'o 1 local mais os 3 que ele publicou');
  assert.deepEqual(r.motivos, []);
});

test('ATIVO sem retrato continua não verificável: a exigência só cai com o ato explícito', () => {
  const r = somar([remoto({ status: null })]);
  assert.equal(r.verificavel, false);
  assert.deepEqual(r.motivos, [{ dev: 'dB', motivo: 'sem-dados' }]);
});

test('aposentado com reserva vencida zera a reserva em vez de travar o grupo para sempre', () => {
  const velho = { u: T - SYNC.RESERVA_GRUPO_TTL_MS - 1, consumo: { seq: 4, dia: '2026-09-16', grupos: { [G]: 5 } } };
  const ativo = somar([remoto({ status: velho })]);
  assert.equal(ativo.verificavel, false, 'no ativo, reserva vencida continua sendo cobertura incompleta');
  assert.equal(ativo.motivos[0].motivo, 'reserva-vencida');
  const fora = somar([remoto({ aposentado: true, status: velho })]);
  assert.equal(fora.verificavel, true);
  assert.equal(fora.reservas, 0, 'a reserva dele venceu pelo TTL que já existia');
  assert.equal(fora.custo, 4, 'e o gasto dele continua contando');
});

test('aposentado com retrato FRESCO vale inteiro: reserva viva ainda projeta', () => {
  const vivo = { u: T, consumo: { seq: 4, dia: '2026-09-16', grupos: { [G]: 3 } } };
  const r = somar([remoto({ aposentado: true, status: vivo })]);
  assert.equal(r.verificavel, true);
  assert.equal(r.reservas, 3);
});

test('aposentado não perdoa leitura que falhou nem rollup torto', () => {
  const semLeitura = somar([remoto({ aposentado: true, rollups: null, status: null })]);
  assert.equal(semLeitura.motivos[0].motivo, 'sem-dados', 'não ler é diferente de não haver');
  const torto = somar([remoto({ aposentado: true, status: null, rollups: { '2026-09-16': { v: 9 } } })]);
  assert.equal(torto.motivos[0].motivo, 'invalido');
});

test('aposentado com lacuna conhecida continua não verificável: gasto não publicado é gasto que não se sabe', () => {
  const comLacuna = { u: T, consumo: { seq: 9, dia: '2026-09-16', grupos: {} } };
  const r = somar([remoto({ aposentado: true, status: comLacuna })]);
  assert.equal(r.verificavel, false);
  assert.equal(r.motivos[0].motivo, 'lacuna');
});

test('janela seguinte: o gasto do aposentado fica na janela em que foi feito', () => {
  const amanha = Date.UTC(2026, 8, 17, 15, 0, 0);
  const r = cg.somarGrupo({
    grupoId: G, periodo: 'dia', agora: amanha, tipicoPadrao: 9,
    local: { custo: 0, desconhecidas: 0, reservas: 0, tipico: 2 },
    remotos: [remoto({ aposentado: true, status: null })],
  });
  assert.equal(r.verificavel, true);
  assert.equal(r.custo, 0, 'o rollup de ontem não atravessa para a janela de hoje');
});
