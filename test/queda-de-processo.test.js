// A linha do farol.log quando um processo do Electron morre (lib/queda-de-processo.js).
// Até 05/11/2026 a queda do renderer só dizia "(crashed)": 23 linhas sem código de
// saída nem memória, e nenhuma deu diagnóstico.
import test from 'node:test';
import assert from 'node:assert/strict';
import { linhaDaQuedaDoRenderer, linhaDaQuedaDeProcesso, memoriaDoProcesso } from '../lib/queda-de-processo.js';

const AGORA = 1_000_000_000;

test('queda do renderer no Windows leva código em hexa, o nome dele, memória e tempo de página', () => {
  // o Electron entrega o NTSTATUS como inteiro com sinal
  const linha = linhaDaQuedaDoRenderer({
    details: { reason: 'crashed', exitCode: -1073741819 },
    amostra: { kb: 812 * 1024, picoKb: 900 * 1024, em: AGORA - 20_000 },
    carregadaEm: AGORA - (2 * 60 + 13) * 60_000,
    visivel: false, agora: AGORA, ehWindows: true,
  });
  assert.equal(linha, 'renderer caiu (crashed, código 0xC0000005, acesso inválido à memória); '
    + 'memória 812 MB (pico 900 MB) medida há 20 s; página carregada há 2 h 13 min; janela escondida; recarregando a janela');
});

test('a falta de memória do Chromium e o fail-fast têm nome próprio', () => {
  const comum = { amostra: null, carregadaEm: AGORA - 5000, agora: AGORA, ehWindows: true };
  assert.match(linhaDaQuedaDoRenderer({ ...comum, details: { reason: 'crashed', exitCode: 0xE0000008 } }),
    /0xE0000008, sem memória \(limite do Chromium\)/);
  assert.match(linhaDaQuedaDoRenderer({ ...comum, details: { reason: 'crashed', exitCode: -1073740791 } }),
    /0xC0000409, encerramento forçado pelo próprio Chromium/);
  assert.match(linhaDaQuedaDoRenderer({ ...comum, details: { reason: 'crashed', exitCode: 0x12345 } }),
    /\(crashed, código 0x00012345\)/);
});

test('sem amostra, sem página carregada e fora do Windows a linha diz isso, sem inventar', () => {
  const linha = linhaDaQuedaDoRenderer({
    details: { reason: 'oom', exitCode: 9 }, amostra: null, carregadaEm: null, agora: AGORA, ehWindows: false,
  });
  assert.equal(linha, 'renderer caiu (oom, código 9); memória não medida; página ainda não tinha carregado; recarregando a janela');
});

test('details ausente ainda produz uma linha legível', () => {
  assert.match(linhaDaQuedaDoRenderer({ details: undefined, agora: AGORA, ehWindows: true }),
    /^renderer caiu \(motivo desconhecido\); memória não medida;/);
});

test('memoriaDoProcesso usa privateBytes quando existe e cai no workingSet fora do Windows', () => {
  const metricas = [
    { pid: 10, type: 'Browser', memory: { workingSetSize: 1, peakWorkingSetSize: 2, privateBytes: 3 } },
    { pid: 42, type: 'Tab', memory: { workingSetSize: 500, peakWorkingSetSize: 700, privateBytes: 450 } },
    { pid: 43, type: 'Tab', memory: { workingSetSize: 600, peakWorkingSetSize: 650 } },
  ];
  assert.deepEqual(memoriaDoProcesso(metricas, 42), { kb: 450, picoKb: 700 });
  assert.deepEqual(memoriaDoProcesso(metricas, 43), { kb: 600, picoKb: 650 });
  assert.equal(memoriaDoProcesso(metricas, 99), null);
  assert.equal(memoriaDoProcesso(metricas, 0), null);
  assert.equal(memoriaDoProcesso(null, 42), null);
});

test('queda de GPU ou utilitário vira linha; saída limpa não (log só de falhas)', () => {
  assert.equal(linhaDaQuedaDeProcesso({ type: 'GPU', reason: 'crashed', exitCode: -1073741819 }, true),
    'processo GPU do Electron caiu (crashed, código 0xC0000005, acesso inválido à memória)');
  assert.equal(linhaDaQuedaDeProcesso({ type: 'Utility', name: 'Network Service', reason: 'killed', exitCode: 1 }, true),
    'processo Utility Network Service do Electron caiu (killed, código 0x00000001)');
  assert.equal(linhaDaQuedaDeProcesso({ type: 'GPU', reason: 'clean-exit', exitCode: 0 }, true), null);
  assert.equal(linhaDaQuedaDeProcesso(null, true), null);
});
