// Regime x episódio no resumo do log (v2.52.3).
//
// Diagnóstico real de 24/08/2026, colado pelo Wanderson: "101x Rede indisponível
// [rede/transitorio] 24/08 03:36 -> 24/08 09:33" e, logo abaixo, "Leitura: 101
// evento(s) se resolvem sozinhos, 0 exigem ação humana, 0 são operacionais".
//
// Cada evento se resolvia mesmo, e ainda assim a leitura mentia por omissão: eram
// SEIS HORAS ininterruptas, madrugada inclusive, uma falha a cada ~3,5 minutos.
// Medido ao vivo na mesma janela: 1 falha em 24 chamadas ao GitHub numa rodada e 2
// em 3 na seguinte, com ICMP perfeito (25/25, 8ms) pro mesmo IP. Isso não é
// episódio que passa, é o regime da rede daquela máquina, e a ação é de gente.
//
// Este arquivo trava a distinção. O cálculo é sobre o que o triage já entrega
// (`first`/`last`/`count`), sem dado novo e sem chamada nenhuma.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const P = await import('../ui/pure.js');

const REDE = {
  id: 'rede', label: 'Rede indisponível', grupo: 'rede', kind: 'transitorio',
  count: 101, first: '2026-08-24 03:36:29 -03:00', last: '2026-08-24 09:33:10 -03:00', refs: [],
};

test('logSpanMinutes mede a janela pelos componentes, sem deixar o fuso mover a hora', () => {
  assert.equal(P.logSpanMinutes('2026-08-24 03:36:29 -03:00', '2026-08-24 09:33:10 -03:00'), 357);
  assert.equal(P.logSpanMinutes('2026-08-24 03:36', '2026-08-24 03:36'), 0);
  // carimbo fora de forma volta null em vez de virar NaN silencioso na conta
  assert.equal(P.logSpanMinutes('ontem', '2026-08-24 09:33:10'), null);
  assert.equal(P.logSpanMinutes('2026-08-24 09:33:10', '2026-08-24 03:36:29'), null, 'fim antes do início não vira duração negativa');
});

test('fmtSpan fala em hora e minuto, do jeito que se lê', () => {
  assert.equal(P.fmtSpan(357), '5h57');
  assert.equal(P.fmtSpan(48), '48min');
  assert.equal(P.fmtSpan(120), '2h');
});

test('o episódio real de 6h é classificado como REGIME', () => {
  const r = P.logGroupRate(REDE);
  assert.equal(r.minutos, 357);
  assert.equal(r.regime, true);
  assert.ok(r.porHora > 16 && r.porHora < 18, `taxa medida: ${r.porHora}`);
});

test('queda curta continua sendo episódio: janela apertada não vira acusação de regime', () => {
  const curto = { ...REDE, count: 13, first: '2026-08-24 03:36:00', last: '2026-08-24 04:20:00' };
  assert.equal(P.logGroupRate(curto), null, '44 minutos é queda de rede comum, não regime');
});

test('janela longa com pouquíssimo evento também não é regime', () => {
  const raro = { ...REDE, count: 3, first: '2026-08-24 00:00:00', last: '2026-08-24 09:00:00' };
  assert.equal(P.logGroupRate(raro).regime, false, '1 falha a cada 3 horas o app absorve sem ninguém sentir');
});

test('a linha de regime diz a contagem, a duração, a taxa e de quem é a ação', () => {
  const [linha, ...resto] = P.logRegimeLines([REDE]);
  assert.equal(resto.length, 0);
  assert.match(linha, /Rede indisponível não é episódio, é regime/);
  assert.match(linha, /101 falhas em 5h57/);
  assert.match(linha, /17 por hora/);
  assert.match(linha, /decisão sua \(rede, provedor\), não do app/);
});

test('problema que JÁ exige gente não ganha a linha (ela existe pro que passaria batido)', () => {
  const permanente = { ...REDE, id: 'token', label: 'Token da conta sumiu no gh', kind: 'permanente' };
  assert.deepEqual(P.logRegimeLines([permanente]), []);
});

test('o resumo do diagnóstico mantém a leitura de sempre E acrescenta o regime', () => {
  const linhas = P.logSummaryLines([REDE]);
  assert.match(linhas[0], /^101x {2}Rede indisponível/, 'a linha do grupo continua igual');
  assert.match(linhas[1], /Leitura: 101 evento\(s\) se resolvem sozinhos/, 'a contagem por tipo é factual e fica');
  assert.match(linhas[2], /é regime/, 'e a leitura de tranquilidade deixa de andar sozinha');
});

test('a linha única da aba Sistema carrega a duração do que é contínuo', () => {
  const curto = P.logSummaryShort([{ ...REDE, count: 4, first: '2026-08-24 09:00:00', last: '2026-08-24 09:20:00' }], 3);
  assert.doesNotMatch(curto, /contínuo/, 'pico curto não ganha selo');
  const longo = P.logSummaryShort([REDE], 3);
  assert.match(longo, /contínuo: Rede indisponível há 5h57/, '"101x Rede indisponível" sozinho lê como pico de um minuto');
});
