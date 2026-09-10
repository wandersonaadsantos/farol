// Painel de Justiça de fila (spec 2026-09-10-justica-de-fila-entre-orgs). O painel
// existe porque uma automação que CEDE A VEZ, vista de fora, é idêntica a uma automação
// QUEBRADA: nos dois casos o PR fica parado e nada na tela explica. Mesma lição do
// estacionamento visível (v2.57.4) e do rastro durável do gate de orçamento.
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { filaJustaHtml, fjQuando, fjMoeda } = await import('../ui/pure.js');

test('fjQuando: nunca atendida, agora, e intervalo humano', () => {
  assert.equal(fjQuando(null), 'nunca');
  assert.equal(fjQuando(undefined), 'nunca');
  assert.equal(fjQuando(0), 'agora');
  assert.equal(fjQuando(720000), 'há 12m');
});

test('fjMoeda: sem teto é travessão, não US$ 0,00', () => {
  assert.equal(fjMoeda(null), '—');
  assert.equal(fjMoeda(undefined), '—');
  assert.equal(fjMoeda(''), '—');
  assert.equal(fjMoeda('banana'), '—');
  assert.equal(fjMoeda(0), 'US$ 0.00', 'zero MEDIDO é um número de verdade e aparece');
  assert.equal(fjMoeda(12.5), 'US$ 12.50');
});

test('painel vazio não desenha card nenhum', () => {
  assert.equal(filaJustaHtml(null), '');
  assert.equal(filaJustaHtml({ porOrg: [], porPerfil: [], emCurso: 0, tetoGlobal: 0 }), '');
});

test('org: mostra fila, mais antigo e quando foi atendida pela última vez', () => {
  const html = filaJustaHtml({
    porOrg: [{ org: 'biudtech', esperando: 3, esperaMaisAntigaMs: 3600000, ultimaVezMs: 120000 }],
    porPerfil: [], emCurso: 0, tetoGlobal: 0,
  });
  assert.match(html, /biudtech/);
  assert.match(html, /3 esperando/);
  assert.match(html, /mais antigo há 1h/);
  assert.match(html, /há 2m/);
});

test('org nunca atendida aparece como "nunca", que é o motivo de ela furar a fila', () => {
  const html = filaJustaHtml({
    porOrg: [{ org: 'pessoal', esperando: 1, esperaMaisAntigaMs: 0, ultimaVezMs: null }],
    porPerfil: [], emCurso: 0, tetoGlobal: 0,
  });
  assert.match(html, /nunca/);
});

test('perfil com UMA conta só não desenha bloco: não há rodízio a explicar', () => {
  const html = filaJustaHtml({
    porOrg: [], emCurso: 0, tetoGlobal: 0,
    porPerfil: [{ id: 'p1', label: 'Principal', tetoDoDia: 100, contas: [{ user: 'biuder', peso: 1, esperando: false, cota: 100, gasto: 10, cedendo: false, cedendoPara: [] }] }],
  });
  assert.equal(html, '');
});

test('perfil com duas contas mostra cada uma contra a própria cota', () => {
  const html = filaJustaHtml({
    porOrg: [], emCurso: 0, tetoGlobal: 0,
    porPerfil: [{
      id: 'p1', label: 'Principal', tetoDoDia: 100, contas: [
        { user: 'biuder', peso: 1, esperando: true, cota: 50, gasto: 60, cedendo: true, cedendoPara: ['pessoal'] },
        { user: 'pessoal', peso: 1, esperando: true, cota: 50, gasto: 5, cedendo: false, cedendoPara: [] },
      ],
    }],
  });
  // personMention: o login vira link pro GitHub, então a asserção é sobre o markup dele
  assert.match(html, /pm-login">@biuder</);
  assert.match(html, /cedendo a vez para <a class="person-mention"[^>]*>.*?@pessoal/);
  assert.match(html, /US\$ 60\.00 de US\$ 50\.00/);
  assert.match(html, /US\$ 5\.00 de US\$ 50\.00/);
  assert.match(html, /Teto do dia US\$ 100\.00/);
});

test('peso diferente de 1 aparece; peso 1 (o padrão) não polui a tela', () => {
  const conta = (user, peso) => ({ user, peso, esperando: false, cota: 50, gasto: 1, cedendo: false, cedendoPara: [] });
  const html = filaJustaHtml({
    porOrg: [], emCurso: 0, tetoGlobal: 0,
    porPerfil: [{ id: 'p1', label: 'P', tetoDoDia: 100, contas: [conta('a', 3), conta('b', 1)] }],
  });
  assert.match(html, /peso 3/);
  assert.equal((html.match(/peso /g) || []).length, 1, 'só o peso fora do padrão é escrito');
});

test('teto global só aparece quando está ligado', () => {
  const base = { porOrg: [{ org: 'x', esperando: 1, esperaMaisAntigaMs: 0, ultimaVezMs: null }], porPerfil: [] };
  assert.doesNotMatch(filaJustaHtml({ ...base, emCurso: 1, tetoGlobal: 0 }), /Teto global/);
  assert.match(filaJustaHtml({ ...base, emCurso: 1, tetoGlobal: 4 }), /1 de 4 revisões simultâneas/);
});

test('nome de org e login são escapados: eles vêm do GitHub, não do app', () => {
  const html = filaJustaHtml({
    porOrg: [{ org: '<img src=x onerror=alert(1)>', esperando: 1, esperaMaisAntigaMs: 0, ultimaVezMs: null }],
    porPerfil: [], emCurso: 0, tetoGlobal: 0,
  });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});
