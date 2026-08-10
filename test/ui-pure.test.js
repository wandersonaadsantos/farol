'use strict';
// Primeiro teste de codigo da UI do Farol.
//
// O ui/app.js tinha ~2860 linhas e ZERO teste: era o maior arquivo do projeto e o debito
// declarado como Onda 4 no docs/QUALITY.md. Nao dava pra testar porque e um script de
// navegador que toca `document` no topo. As 26 funcoes PURAS sairam pro ui/pure.js, que
// o navegador le por <script src> e o node le por require. Estas sao elas.
//
// A mais importante e o esc(): e a defesa contra injecao de HTML de ~240 interpolacoes
// espalhadas pelo app, e nunca teve uma linha de teste.
const path = require('node:path');

// fmtClock formata no fuso do processo; sem fixar, o teste passa na minha maquina e
// falha em outra. Tem que vir ANTES do require.
process.env.TZ = 'America/Sao_Paulo';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require(path.join(__dirname, '..', 'ui', 'pure.js'));

/* ---------- esc: a defesa contra injecao ---------- */

test('esc neutraliza todo caractere que fecha tag ou atributo', () => {
  assert.equal(P.esc('&'), '&amp;');
  assert.equal(P.esc('<'), '&lt;');
  assert.equal(P.esc('>'), '&gt;');
  assert.equal(P.esc('"'), '&quot;');
  assert.equal(P.esc("'"), '&#39;');
});

test('esc quebra as injecoes classicas', () => {
  assert.equal(P.esc('<script>alert(1)</script>'),
    '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(P.esc('" onerror="alert(1)'), '&quot; onerror=&quot;alert(1)');
  assert.equal(P.esc("' onload='x"), '&#39; onload=&#39;x');
  assert.equal(P.esc('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
});

test('esc escapa TODAS as ocorrencias, não só a primeira', () => {
  // uma regex sem /g aqui deixaria passar a segunda tag
  assert.equal(P.esc('<b><b>'), '&lt;b&gt;&lt;b&gt;');
  assert.equal(P.esc('a"b"c"d'), 'a&quot;b&quot;c&quot;d');
});

test('esc trata vazio e nulo sem virar "null" na tela', () => {
  assert.equal(P.esc(null), '');
  assert.equal(P.esc(undefined), '');
  assert.equal(P.esc(''), '');
  // ?? só pega null/undefined: zero e false SÃO valores e devem aparecer
  assert.equal(P.esc(0), '0');
  assert.equal(P.esc(false), 'false');
});

test('esc é idempotente o bastante pra não corromper texto já escapado', () => {
  // escapar duas vezes vira &amp;lt;, feio mas seguro. O que não pode é DESescapar.
  assert.equal(P.esc(P.esc('<b>')), '&amp;lt;b&amp;gt;');
});

test('LIMITE CONHECIDO do esc: não escapa crase nem igual', () => {
  // documenta a fronteira em vez de fingir que não existe: esc() é seguro em conteúdo de
  // texto e em atributo ENTRE ASPAS, que é como o app inteiro usa. Atributo sem aspas
  // seria injetável, então nunca escreva `class=${esc(x)}` sem as aspas.
  assert.equal(P.esc('`'), '`');
  assert.equal(P.esc('='), '=');
});

/* ---------- md: escapa antes de marcar ---------- */

test('md escapa o HTML da entrada ANTES de gerar o dele', () => {
  // é a invariante do renderizador: relatório de review vem de um modelo, então
  // markdown malicioso não pode virar tag
  const out = P.md('<script>alert(1)</script>');
  assert.doesNotMatch(out, /<script>/);
  assert.match(out, /&lt;script&gt;/);
});

test('md monta os blocos basicos', () => {
  assert.match(P.md('# Titulo'), /<h3>Titulo<\/h3>/);      // # vira h3 (h1 é do app)
  assert.match(P.md('## Sub'), /<h4>Sub<\/h4>/);
  assert.match(P.md('- um\n- dois'), /<ul>\n<li>um<\/li>\n<li>dois<\/li>\n<\/ul>/);
  assert.match(P.md('---'), /<hr>/);
  assert.match(P.md('texto solto'), /<p>texto solto<\/p>/);
});

test('md formata inline sem deixar tag escapar', () => {
  assert.match(P.md('**forte**'), /<b>forte<\/b>/);
  assert.match(P.md('`codigo`'), /<code>codigo<\/code>/);
  assert.match(P.md('*enfase*'), /<i>enfase<\/i>/);
});

test('md NÃO aplica bold/itálico/link dentro de código', () => {
  // relatório de review adora assinatura Python: f(*args, **kwargs) virava markup corrompido
  const out = P.md('`f(*args, **kwargs)`');
  assert.match(out, /<code>f\(\*args, \*\*kwargs\)<\/code>/);
  assert.doesNotMatch(out, /<i>|<b>/);
  const link = P.md('`[a](https://x.com)`');
  assert.match(link, /<code>\[a\]\(https:\/\/x\.com\)<\/code>/);
  assert.doesNotMatch(link, /<a /);
});

test('md segue formatando NORMALMENTE fora do código', () => {
  const out = P.md('use `a_b` com *ênfase* e **força**');
  assert.match(out, /<code>a_b<\/code>/);
  assert.match(out, /<i>ênfase<\/i>/);
  assert.match(out, /<b>força<\/b>/);
});

test('md só aceita link http e https', () => {
  assert.match(P.md('[x](https://exemplo.com)'), /<a href="https:\/\/exemplo\.com"/);
  // javascript: não pode virar href
  const js = P.md('[x](javascript:alert(1))');
  assert.doesNotMatch(js, /<a /);
  assert.doesNotMatch(js, /href=/);
});

test('md abre link externo com rel=noreferrer', () => {
  // sem isso a página de destino recebe window.opener
  assert.match(P.md('[x](https://exemplo.com)'), /rel="noreferrer"/);
  assert.match(P.md('[x](https://exemplo.com)'), /target="_blank"/);
});

test('md monta tabela e descarta a linha separadora', () => {
  const out = P.md('| a | b |\n| --- | --- |\n| 1 | 2 |');
  assert.match(out, /<table><tbody>/);
  assert.match(out, /<td>a<\/td><td>b<\/td>/);
  assert.match(out, /<td>1<\/td><td>2<\/td>/);
  assert.doesNotMatch(out, /---/);
});

test('md converte checkbox em símbolo', () => {
  assert.match(P.md('- [x] feito'), /☑ feito/);
  assert.match(P.md('- [ ] pendente'), /☐ pendente/);
});

test('md fecha o que abriu (lista e tabela) no fim do texto', () => {
  const l = P.md('- a');
  assert.equal((l.match(/<ul>/g) || []).length, (l.match(/<\/ul>/g) || []).length);
  const t = P.md('| a |\n| 1 |');
  assert.equal((t.match(/<table>/g) || []).length, (t.match(/<\/table>/g) || []).length);
});

test('md aceita vazio sem quebrar', () => {
  for (const v of ['', null, undefined]) assert.equal(P.md(v), '');
});

/* ---------- formatadores ---------- */

test('fmtRel escolhe a unidade pela distância', () => {
  const agora = Date.parse('2026-08-01T12:00:00Z');
  const atras = seg => new Date(agora - seg * 1000).toISOString();
  assert.equal(P.fmtRel(atras(0), agora), 'agora');
  assert.equal(P.fmtRel(atras(89), agora), 'agora');
  assert.equal(P.fmtRel(atras(300), agora), '5min');
  assert.equal(P.fmtRel(atras(7200), agora), '2h');
  assert.equal(P.fmtRel(atras(86400 * 3), agora), '3d');
});

test('fmtRel nunca devolve tempo negativo (relógio adiantado do servidor)', () => {
  const agora = Date.parse('2026-08-01T12:00:00Z');
  const futuro = new Date(agora + 60000).toISOString();
  assert.equal(P.fmtRel(futuro, agora), 'agora', 'data no futuro não vira "-1min"');
});

test('fmtRel sem data devolve vazio', () => {
  assert.equal(P.fmtRel(''), '');
  assert.equal(P.fmtRel(null), '');
});

test('fmtCompact encurta sem enganar a ordem de grandeza', () => {
  assert.equal(P.fmtCompact(0), '0');
  assert.equal(P.fmtCompact(999), '999');
  assert.equal(P.fmtCompact(1000), '1k');
  assert.equal(P.fmtCompact(15400), '15k');
  assert.equal(P.fmtCompact(1.5e6), '1,5M');     // vírgula, que é o separador daqui
  assert.equal(P.fmtCompact(1.5e7), '15M');      // acima de 10M some a casa decimal
  assert.equal(P.fmtCompact(null), '0');
  assert.equal(P.fmtCompact('abc'), '0');
});

test('fmtCompact: fronteira do milhão não vira 1000k', () => {
  // Math.round(999500/1000) = 1000, e "1000k" mente a unidade: promove pra M
  assert.equal(P.fmtCompact(999499), '999k');
  assert.equal(P.fmtCompact(999500), '1,0M');
  assert.equal(P.fmtCompact(999999), '1,0M');
  assert.equal(P.fmtCompact(1000000), '1,0M');
});

test('fmtTok agrupa milhar no formato daqui', () => {
  assert.equal(P.fmtTok(1234567), '1.234.567');
  assert.equal(P.fmtTok(0), '0');
  assert.equal(P.fmtTok(null), '0');
});

test('fmtClock mostra hora e minuto no fuso do processo', () => {
  // TZ fixado no topo: 12:00Z é 09:00 em São Paulo
  assert.equal(P.fmtClock('2026-08-01T12:00:00Z'), '09:00');
  assert.equal(P.fmtClock(''), '');
  assert.equal(P.fmtClock(null), '');
});

/* ---------- consumo ---------- */

test('usageMetricVal soma o eixo pedido', () => {
  const b = { inputTokens: 100, outputTokens: 20, cacheReadTokens: 5, cacheCreationTokens: 3 };
  assert.equal(P.usageMetricVal(b, 'input'), 100);
  assert.equal(P.usageMetricVal(b, 'output'), 20);
  assert.equal(P.usageMetricVal(b, 'cache'), 8);
  assert.equal(P.usageMetricVal(b, 'total'), 120);
});

test('usageMetricVal: métrica desconhecida e bucket vazio caem no total', () => {
  assert.equal(P.usageMetricVal({ inputTokens: 7, outputTokens: 3 }, 'inventada'), 10);
  assert.equal(P.usageMetricVal(null, 'total'), 0);
  assert.equal(P.usageMetricVal(undefined, 'input'), 0);
});

test('usageMetricVal: caso custo le costUsd', () => {
  assert.equal(P.usageMetricVal({ costUsd: 1.5 }, 'custo'), 1.5);
  assert.equal(P.usageMetricVal(null, 'custo'), 0);
});

test('sparklinePath: gera line e area proporcionais ao maior valor', () => {
  const { line, area } = P.sparklinePath([0, 5, 10], 100, 26);
  assert.match(line, /^M0(\.0)?,26/, 'primeiro ponto no eixo (valor 0 -> y=26, base)');
  assert.match(line, /L100(\.0)?,/, 'ultimo ponto no fim da largura');
  assert.match(area, /Z$/, 'area fecha o poligono');
});

test('sparklinePath: serie de 1 ponto nao gera NaN (divisao por zero evitada)', () => {
  const { line } = P.sparklinePath([7], 100, 26);
  assert.ok(!line.includes('NaN'));
});

test('usageDelta: cresceu, caiu, sem base', () => {
  assert.equal(P.usageDelta(120, 100), '↑ 20%');
  assert.equal(P.usageDelta(80, 100), '↓ 20%');
  assert.equal(P.usageDelta(10, 0), '', 'sem base de comparacao (0 ou ausente) nao mostra chip');
  assert.equal(P.usageDelta(10, null), '');
});

test('usageDayKeysBack devolve n dias LOCAIS, do mais antigo pro mais novo', () => {
  // 23:30Z de 01/08 é 20:30 em São Paulo: hoje local ainda é 01/08
  const agora = Date.parse('2026-08-01T23:30:00Z');
  const k = P.usageDayKeysBack(3, agora);
  assert.deepEqual(k, ['2026-07-30', '2026-07-31', '2026-08-01']);
  assert.equal(P.usageDayKeysBack(30, agora).length, 30);
});

test('usageDayKeysBack atravessa virada de mês e de ano no fuso LOCAL', () => {
  assert.deepEqual(P.usageDayKeysBack(2, Date.parse('2026-03-01T00:00:00-03:00')), ['2026-02-28', '2026-03-01']);
  assert.deepEqual(P.usageDayKeysBack(2, Date.parse('2026-01-01T00:00:00-03:00')), ['2025-12-31', '2026-01-01']);
  // meia-noite UTC ainda é véspera no local: o corte tem que ser o local
  assert.deepEqual(P.usageDayKeysBack(2, Date.parse('2026-03-01T00:00:00Z')), ['2026-02-27', '2026-02-28']);
});

test('localDayKey aceita epoch ms e ISO; entrada inválida devolve vazio', () => {
  assert.equal(P.localDayKey(Date.parse('2026-08-02T01:00:00Z')), '2026-08-01');
  assert.equal(P.localDayKey('2026-08-01T12:00:00Z'), '2026-08-01');
  assert.equal(P.localDayKey(''), '');
  assert.equal(P.localDayKey(null), '');
  assert.equal(P.localDayKey('lixo'), '');
});

test('aprovadosHoje conta só APPROVE do dia LOCAL (resolvedAt em epoch ms)', () => {
  const agora = Date.parse('2026-08-01T22:00:00-03:00');
  const resolved = [
    { action: 'approve', resolvedAt: agora - 60 * 60 * 1000 },             // 21:00 local de hoje
    { action: 'approve', resolvedAt: Date.parse('2026-08-02T01:00:00Z') }, // 22:00 local de hoje (dia UTC já virou)
    { action: 'approve', resolvedAt: agora - 26 * 60 * 60 * 1000 },        // ontem
    { action: 'request_changes', resolvedAt: agora },                      // não é approve
    { action: 'approve' },                                                 // sem resolvedAt: fora
  ];
  assert.equal(P.aprovadosHoje(resolved, agora), 2);
  assert.equal(P.aprovadosHoje([], agora), 0);
  assert.equal(P.aprovadosHoje(undefined, agora), 0);
});

/* ---------- reviewers: comparações que APAGAM configuração ---------- */

test('sameSet ignora ordem e caixa', () => {
  // decide se a exceção de um repo "virou igual ao padrão" e por isso é DELETADA:
  // um falso positivo aqui apaga configuração do usuário
  assert.equal(P.sameSet(['a', 'B'], ['b', 'A']), true);
  assert.equal(P.sameSet(['a'], ['a', 'b']), false);
  assert.equal(P.sameSet(['a', 'b'], ['a']), false);
  assert.equal(P.sameSet([], []), true);
  assert.equal(P.sameSet(null, []), true);
  assert.equal(P.sameSet(['a'], null), false);
});

test('sameSet trata repetido como o conjunto que é', () => {
  assert.equal(P.sameSet(['a', 'a'], ['a']), true, 'duplicata não muda o conjunto');
});

test('diffVs diz o que entrou e o que saiu, ignorando caixa', () => {
  const d = P.diffVs(['a', 'b'], ['B', 'c']);
  assert.deepEqual(d.added, ['c']);
  assert.deepEqual(d.removed, ['a']);
});

test('diffVs com lista vazia dos dois lados', () => {
  assert.deepEqual(P.diffVs([], []), { added: [], removed: [] });
  assert.deepEqual(P.diffVs(null, null), { added: [], removed: [] });
});

/* ---------- contas: o serializador do config ---------- */

test('accountSaveArray guarda os campos de identidade', () => {
  // é o que vai pro config.json via /api/settings: campo esquecido aqui é
  // configuração de conta perdida em silêncio
  const [o] = P.accountSaveArray([{ user: 'alice', owners: ['acme'], label: 'Trabalho', color: '#fff', kind: 'work', muted: true }]);
  assert.equal(o.user, 'alice');
  assert.deepEqual(o.owners, ['acme']);
  assert.equal(o.label, 'Trabalho');
  assert.equal(o.muted, true);
});

test('accountSaveArray só grava política quando ela foi escolhida', () => {
  // ausente = herda o global; gravar um valor inventado mudaria o comportamento
  const [herda] = P.accountSaveArray([{ user: 'a', owners: [] }]);
  for (const k of ['autoReview', 'onClean', 'onCaveats', 'onReject', 'claudeProfileId']) {
    assert.equal(k in herda, false, `${k} não pode aparecer quando não foi escolhido`);
  }
  const [escolheu] = P.accountSaveArray([{ user: 'a', owners: [], autoReview: false, onClean: 'wait', onCaveats: 'approve', onReject: 'request_changes', claudeProfileId: 'p1' }]);
  assert.equal(escolheu.autoReview, false, 'false é escolha, não ausência');
  assert.equal(escolheu.onClean, 'wait');
  assert.equal(escolheu.onReject, 'request_changes');
  assert.equal(escolheu.claudeProfileId, 'p1');
});

test('accountSaveArray descarta valor de política inválido', () => {
  const [o] = P.accountSaveArray([{ user: 'a', owners: [], onClean: 'talvez', onReject: 'merge' }]);
  assert.equal('onClean' in o, false);
  assert.equal('onReject' in o, false);
});

test('accountSaveArray aceita lista vazia ou ausente', () => {
  assert.deepEqual(P.accountSaveArray([]), []);
  assert.deepEqual(P.accountSaveArray(null), []);
});

/* ---------- agrupamento e ordenação (aba Entregas) ---------- */

test('groupBy preserva a ordem de primeira aparição', () => {
  const g = P.groupBy([{ r: 'b' }, { r: 'a' }, { r: 'b' }], x => x.r);
  assert.deepEqual([...g.keys()], ['b', 'a']);
  assert.equal(g.get('b').length, 2);
});

test('lastMerge devolve a data mais recente sem mexer na lista', () => {
  const lista = [{ mergedAt: '2026-07-01' }, { mergedAt: '2026-08-01' }, { mergedAt: '2026-07-15' }];
  const copia = JSON.parse(JSON.stringify(lista));
  assert.equal(P.lastMerge(lista), '2026-08-01');
  assert.deepEqual(lista, copia, 'não pode reordenar a lista do chamador');
  assert.equal(P.lastMerge([]), '');
  assert.equal(P.lastMerge([{}]), '');
});

test('deliveriesByRepo escapa o conteúdo e ordena por volume', () => {
  const html = P.deliveriesByRepo([
    { repo: 'acme/<b>x</b>', key: 'acme/x#1', url: 'https://u/1', title: 'um', author: 'a', mergedAt: '2026-08-01' },
    { repo: 'acme/y', key: 'acme/y#2', url: 'https://u/2', title: 'dois', author: 'b', mergedAt: '2026-07-01' },
    { repo: 'acme/y', key: 'acme/y#3', url: 'https://u/3', title: 'tres', author: 'c', mergedAt: '2026-07-02' },
  ]);
  assert.doesNotMatch(html, /acme\/<b>/, 'nome de repo não vira tag');
  assert.match(html, /acme\/&lt;b&gt;x&lt;\/b&gt;/);
  assert.ok(html.indexOf('acme/y') < html.indexOf('acme/&lt;b&gt;'), 'quem entregou mais vem antes');
  assert.match(html, /2 autores/, 'conta autores distintos');
});

test('deliveriesByAuthor concorda no singular e no plural', () => {
  const um = P.deliveriesByAuthor([{ repo: 'a/b', key: 'a/b#1', url: 'u', title: 't', author: 'alice', mergedAt: '2026-08-01' }]);
  assert.match(um, /1 repo ·/);
  const dois = P.deliveriesByAuthor([
    { repo: 'a/b', key: 'a/b#1', url: 'u', title: 't', author: 'alice', mergedAt: '2026-08-01' },
    { repo: 'a/c', key: 'a/c#2', url: 'u', title: 't', author: 'alice', mergedAt: '2026-08-01' },
  ]);
  assert.match(dois, /2 repos ·/);
});

test('deliveriesByAuthor nomeia quem não tem autor', () => {
  assert.match(P.deliveriesByAuthor([{ repo: 'a/b', key: 'a/b#1', url: 'u', title: 't', mergedAt: '2026-08-01' }]),
    /\(desconhecido\)/);
});

test('delivCappedMsg fala o limite REAL vindo do server, nunca o 100 antigo', () => {
  // DELIVERIES_LIMIT = 1000 (lib/paths.js); a mensagem afirmava 100, fator de 10
  assert.match(P.delivCappedMsg(1000), /mais de 1000 entregas/);
  assert.match(P.delivCappedMsg(1000), /1000 mais recentes/);
  assert.doesNotMatch(P.delivCappedMsg(1000), /\b100\b/);
  assert.match(P.delivCappedMsg(undefined), /1000/, 'payload em cache sem limit cai no valor real atual');
});

/* ---------- helpers menores ---------- */

test('ownerFromUrl extrai a org da URL de PR', () => {
  assert.equal(P.ownerFromUrl('https://github.com/acme/app/pull/1'), 'acme');
  assert.equal(P.ownerFromUrl(''), '');
  assert.equal(P.ownerFromUrl(null), '');
  assert.equal(P.ownerFromUrl('não é url'), '');
});

test('repoShort tira a org e mantém o nome', () => {
  assert.equal(P.repoShort('acme/app'), 'app');
  assert.equal(P.repoShort('sem-barra'), 'sem-barra');
});

test('stripFence remove a cerca de código do relatório', () => {
  assert.equal(P.stripFence('```json\n{"a":1}\n```'), '{"a":1}');
  assert.equal(P.stripFence('```\ntexto\n```'), 'texto');
  assert.equal(P.stripFence('sem cerca'), 'sem cerca');
  assert.equal(P.stripFence(null), '');
});

test('hexToRgba converte e cai num laranja quando não dá', () => {
  assert.equal(P.hexToRgba('#ffb454', .5), 'rgba(255,180,84,0.5)');
  assert.equal(P.hexToRgba('ffb454', 1), 'rgba(255,180,84,1)');
  assert.equal(P.hexToRgba('#abc', .2), 'rgba(255,180,84,0.2)', 'hex de 3 dígitos não é suportado');
  assert.equal(P.hexToRgba(null, .3), 'rgba(255,180,84,0.3)');
});

test('avatar escapa a inicial e codifica o login na URL', () => {
  const a = P.avatar('alice');
  assert.match(a, />A</, 'inicial maiúscula');
  assert.match(a, /github\.com\/alice\.png/);
  const mau = P.avatar('a"b');
  assert.doesNotMatch(mau, /src="https:\/\/github\.com\/a"b/, 'aspas do login não escapam do atributo');
});

test('feedLine escapa o texto da atividade ao vivo', () => {
  const l = P.feedLine({ k: 'text', t: '2026-08-01T12:00:00Z', text: '<script>x</script>' });
  assert.doesNotMatch(l, /<script>/);
  assert.match(l, /&lt;script&gt;/);
  assert.match(l, /class="feed-line k-text"/);
});

test('sysNorm tira acento pra busca sem acento achar', () => {
  assert.equal(P.sysNorm('Revisão AUTOMÁTICA'), 'revisao automatica');
  assert.equal(P.sysNorm('Esforço'), 'esforco');
  assert.equal(P.sysNorm(null), '');
});

/* ---------- prKeyFromUrl: o key canônico a partir da URL do PR ---------- */

test('prKeyFromUrl monta o key canônico owner/repo#numero', () => {
  assert.equal(P.prKeyFromUrl('https://github.com/biudtech/app/pull/123'), 'biudtech/app#123');
});

test('prKeyFromUrl não repete o defeito do slice(-3): nada de "pull" no key', () => {
  // o bug real: url.split('/').slice(-3).join('#') produzia 'repo#pull#123'
  assert.doesNotMatch(P.prKeyFromUrl('https://github.com/biudtech/app/pull/123'), /pull/);
});

test('prKeyFromUrl devolve vazio pra entrada que não é URL de PR', () => {
  assert.equal(P.prKeyFromUrl('https://github.com/biudtech/app'), '');
  assert.equal(P.prKeyFromUrl(''), '');
  assert.equal(P.prKeyFromUrl(null), '');
});

/* ---------- analysisOpsPlan: ciclo de vida do widget de autoanálise ---------- */

test('analysisOpsPlan marca seen quando o key aparece rodando ou na fila', () => {
  const snap = { activeSessions: [{ mode: 'self', keys: ['a/b#1'] }], headlessWaiting: ['c/d#2'] };
  const plan = P.analysisOpsPlan([
    { id: 'analysis-a/b#1', key: 'a/b#1', seen: false },
    { id: 'analysis-c/d#2', key: 'c/d#2', seen: false }
  ], snap);
  assert.deepEqual(plan.markSeen.sort(), ['analysis-a/b#1', 'analysis-c/d#2']);
  assert.deepEqual(plan.close, []);
});

test('analysisOpsPlan fecha só o op que JÁ foi visto e sumiu do snapshot', () => {
  const plan = P.analysisOpsPlan([
    { id: 'analysis-a/b#1', key: 'a/b#1', seen: true }
  ], { activeSessions: [], headlessWaiting: [] });
  assert.deepEqual(plan.close, ['analysis-a/b#1']);
});

test('analysisOpsPlan NÃO fecha o op recém-criado que um snapshot atrasado ainda não conhece', () => {
  // a corrida real: clique -> showOp -> chega um state emitido ANTES do servidor
  // enfileirar; sem o protocolo seen, o widget fecharia "concluído" ao nascer
  const plan = P.analysisOpsPlan([
    { id: 'analysis-a/b#1', key: 'a/b#1', seen: false }
  ], { activeSessions: [], headlessWaiting: [] });
  assert.deepEqual(plan.close, []);
  assert.deepEqual(plan.markSeen, []);
});

test('analysisOpsPlan ignora sessão de outro modo com o mesmo key', () => {
  const plan = P.analysisOpsPlan([
    { id: 'analysis-a/b#1', key: 'a/b#1', seen: true }
  ], { activeSessions: [{ mode: 'auto', keys: ['a/b#1'] }], headlessWaiting: [] });
  assert.deepEqual(plan.close, ['analysis-a/b#1'], 'mode auto não segura o widget de autoanálise');
});

test('analysisOpsPlan aguenta snapshot e lista vazios sem lançar', () => {
  assert.deepEqual(P.analysisOpsPlan([], {}), { markSeen: [], close: [] });
  assert.deepEqual(P.analysisOpsPlan(null, null), { markSeen: [], close: [] });
});

/* ---------- pushbackControl: o controle de pushback nas Revisões recentes ---------- */

test('pushback pendente traz o botão Confirmar e o desfecho sugerido já selecionado', () => {
  // achado M21: re-selecionar a opção já selecionada não dispara change, então sem um
  // botão o caminho "confirme num toque" prometido pela hint não existia
  const html = P.pushbackControl(
    { key: 'a/b#1', pr: { author: 'dev' } },
    { 'a/b#1': { outcome: 'author_right', status: 'pending', source: 'auto', note: 'palpite' } }
  );
  assert.match(html, /pb-confirm/, 'tem o botão Confirmar');
  assert.match(html, /value="author_right" selected/, 'o desfecho sugerido vem selecionado');
  assert.match(html, /data-pending="1"/, 'o details nasce aberto no estado pendente');
});

test('pushback confirmado NÃO mostra o botão Confirmar', () => {
  const html = P.pushbackControl(
    { key: 'a/b#1', pr: { author: 'dev' } },
    { 'a/b#1': { outcome: 'author_right', status: 'confirmed', source: 'manual' } }
  );
  assert.doesNotMatch(html, /pb-confirm/);
});

test('pushbackControl sem autor devolve vazio e sem registro rende o convite padrão', () => {
  assert.equal(P.pushbackControl({ key: 'a/b#1' }, {}), '');
  assert.match(P.pushbackControl({ key: 'a/b#1', pr: { author: 'dev' } }, {}), /pushback\?/);
});

test('pushbackControl escapa a nota vinda do classificador', () => {
  const html = P.pushbackControl(
    { key: 'a/b#1', pr: { author: 'dev' } },
    { 'a/b#1': { outcome: 'mixed', status: 'pending', source: 'auto', note: '<img src=x onerror=alert(1)>' } }
  );
  assert.doesNotMatch(html, /<img/);
});

/* ---------- fmtWhenDay / fmtStamp: o carimbo das Revisões recentes ----------
   O defeito reportado: a linha mostrava "17:51" e mais nada, numa seção que guarda as
   30 revisões mais recentes (o disco guarda 200), então a maioria não é de hoje e o
   número sozinho não localizava nada no tempo. `agora` entra por parâmetro pra nenhum
   caso depender do relógio da máquina (o TZ do arquivo já está fixo em São Paulo). */

const AG = Date.parse('2026-08-03T20:51:00Z');   // 03/08/2026 17:51 em São Paulo

test('fmtWhenDay: hoje e ontem saem por extenso, com a hora', () => {
  assert.equal(P.fmtWhenDay(Date.parse('2026-08-03T20:51:00Z'), AG), 'hoje 17:51');
  assert.equal(P.fmtWhenDay(Date.parse('2026-08-03T03:05:00Z'), AG), 'hoje 00:05');
  assert.equal(P.fmtWhenDay(Date.parse('2026-08-02T19:29:00Z'), AG), 'ontem 16:29');
});

test('fmtWhenDay: dia mais antigo do mesmo ano sai como data curta, sem o ano', () => {
  assert.equal(P.fmtWhenDay(Date.parse('2026-08-01T18:35:00Z'), AG), '01/08 15:35');
  // virada de mês: "ontem" não pode vazar pro 31/07 nem a data curta perder o zero
  assert.equal(P.fmtWhenDay(Date.parse('2026-07-31T18:35:00Z'), AG), '31/07 15:35');
});

test('fmtWhenDay: ano diferente carrega o ano (senão 24/07 é ambíguo)', () => {
  assert.equal(P.fmtWhenDay(Date.parse('2025-07-24T12:12:00Z'), AG), '24/07/2025 09:12');
});

test('fmtWhenDay: a conta de "ontem" é por data local, não por menos 86400s', () => {
  // subtrair um dia em segundos escorrega o rótulo quando o fuso vira no meio
  const agora = Date.parse('2026-11-01T15:00:00Z');
  assert.match(P.fmtWhenDay(Date.parse('2026-10-31T15:00:00Z'), agora), /^ontem /);
  assert.match(P.fmtWhenDay(Date.parse('2026-11-01T10:00:00Z'), agora), /^hoje /);
});

test('fmtWhenDay: sem carimbo devolve vazio, não "Invalid Date"', () => {
  assert.equal(P.fmtWhenDay(null, AG), '');
  assert.equal(P.fmtWhenDay(0, AG), '');
  assert.equal(P.fmtWhenDay(undefined, AG), '');
});

test('fmtStamp: o tooltip carrega data E hora completas, sempre', () => {
  assert.equal(P.fmtStamp(Date.parse('2026-08-03T20:51:00Z')), '03/08/2026 17:51');
  assert.equal(P.fmtStamp(null), '');
});

/* ---------- resolvedRow: a linha inteira das Revisões recentes ----------
   O que depende de estado global (chip da conta, contador de chat, mapa de pushbacks)
   entra por ctx já resolvido em valor, mesmo contrato do pushbackControl. */

function linhaResolvida(extra) {
  return {
    key: 'biudtech/biud-esg#172', status: 'auto_approved', action: 'approve',
    resolvedAt: Date.parse('2026-08-03T19:41:00Z'),
    pr: { url: 'https://github.com/biudtech/biud-esg/pull/172', title: 'Ajusta o cálculo', author: 'alex' },
    card: 'BT-1119', attention: [], reasons: [], reportMarkdown: '# relatório',
    ...extra
  };
}
const CTX = { pushbacks: {}, chip: '', chatBadge: '', agora: AG };

test('resolvedRow: cabeçalho traz referência, card, selo e o quando com dia', () => {
  const html = P.resolvedRow(linhaResolvida(), CTX);
  assert.match(html, /biudtech\/biud-esg#172/);
  assert.match(html, /BT-1119/);
  assert.match(html, /aprovado sozinho/, 'o vocabulário de hoje é preservado');
  assert.match(html, /hoje 16:41/, 'o carimbo diz o dia');
  assert.match(html, /title="03\/08\/2026 16:41"/, 'e a data completa fica no tooltip');
});

test('resolvedRow: mostra o que o estado já tinha e a linha não exibia', () => {
  const html = P.resolvedRow(linhaResolvida(), CTX);
  assert.match(html, /Ajusta o cálculo/, 'título do PR');
  assert.match(html, /@alex/, 'autor');
  assert.match(html, /Ver relatório completo/, 'relatório da revisão');
});

test('resolvedRow: as quatro ações estão presentes e apontam pro PR', () => {
  const html = P.resolvedRow(linhaResolvida(), CTX);
  assert.match(html, /class="[^"]*act-chat/, 'conversar');
  assert.match(html, /class="[^"]*act-review/, 'revisar de novo');
  assert.match(html, /class="[^"]*rr-copy/, 'copiar');
  assert.match(html, /href="https:\/\/github\.com\/biudtech\/biud-esg\/pull\/172"[^>]*target="_blank"/, 'abrir no GitHub');
});

test('resolvedRow: o selo do veredito tem a cor da ação', () => {
  const cor = (extra) => (P.resolvedRow(linhaResolvida(extra), CTX).match(/class="rr-verdict ?([\w-]*)"/) || [])[1];
  assert.equal(cor({ action: 'approve' }), 'rev-ok');
  assert.equal(cor({ status: 'auto_rejected', action: 'request_changes' }), 'rev-rc');
  assert.equal(cor({ status: 'posted', action: 'comment' }), 'rev-cm');
  assert.equal(cor({ status: 'skipped', action: 'skip' }), '', 'pulado é neutro, não colorido');
});

test('resolvedRow: os cinco status mantêm o rótulo que a tela já usava', () => {
  const rot = (status, action) => P.resolvedRow(linhaResolvida({ status, action }), CTX);
  assert.match(rot('auto_approved', 'approve'), /aprovado sozinho/);
  assert.match(rot('auto_rejected', 'request_changes'), /mudanças pedidas sozinho/);
  assert.match(rot('posted', 'approve'), /postado por você \(APPROVE\)/);
  assert.match(rot('already_reviewed', 'approve'), /já revisado por você \(não repostei\) \(APPROVE\)/);
  assert.match(rot('skipped', 'skip'), /pulado/);
});

test('resolvedRow: sem relatório não inventa a divulgação vazia', () => {
  assert.doesNotMatch(P.resolvedRow(linhaResolvida({ reportMarkdown: '' }), CTX), /Ver relatório completo/);
});

test('resolvedRow: pontos de atenção seguem contados e expansíveis', () => {
  const html = P.resolvedRow(linhaResolvida({ attention: ['um', 'dois'] }), CTX);
  assert.match(html, /2 pontos de atenção/);
  assert.match(html, /<li>um<\/li>/);
  // auto_rejected troca o rótulo pelo motivo do pedido de mudanças
  const rc = P.resolvedRow(linhaResolvida({ status: 'auto_rejected', action: 'request_changes', reasons: ['x'] }), CTX);
  assert.match(rc, /1 motivo do pedido de mudanças/);
});

test('resolvedRow: título e card vindos de fora saem escapados', () => {
  const html = P.resolvedRow(linhaResolvida({
    card: '<img src=x onerror=alert(1)>',
    pr: { url: 'https://x/y/pull/1', title: '<script>alert(1)</script>', author: 'dev' }
  }), CTX);
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /<script>/);
});

test('resolvedRow: sem autor não há controle de pushback (contrato do pushbackControl)', () => {
  const html = P.resolvedRow(linhaResolvida({ pr: { url: 'https://x/y/pull/1', title: 't' } }), CTX);
  assert.doesNotMatch(html, /pushback/);
});

test('resolvedRow: o chip da conta e o contador de chat entram como vieram do ctx', () => {
  const html = P.resolvedRow(linhaResolvida(), { ...CTX, chip: '<span class="acct-chip">BIUD</span>', chatBadge: '<b>2</b>' });
  assert.match(html, /acct-chip">BIUD/);
  assert.match(html, /<b>2<\/b>/);
});

test('resolvedRow: sem verificationCheckpoint, não mostra nenhuma linha de resumo', () => {
  const html = P.resolvedRow({ key: 'o/r#1', status: 'auto_approved', action: 'approve', reasons: [] }, {});
  assert.doesNotMatch(html, /Verificação de afirmações/);
});

test('resolvedRow: com verificationCheckpoint limpo, mostra a contagem sem selo de divergência', () => {
  const html = P.resolvedRow({
    key: 'o/r#1', status: 'auto_approved', action: 'approve', reasons: [],
    verificationCheckpoint: { total: 5, confirmedCount: 5, conflicts: [] },
  }, {});
  assert.match(html, /Verificação de afirmações: 5 confirmadas de 5/);
  assert.doesNotMatch(html, /divergência/);
});

test('resolvedRow: com conflito no verificationCheckpoint, mostra o selo de divergência (além do texto já ir por reasons)', () => {
  const html = P.resolvedRow({
    key: 'o/r#1', status: 'auto_approved', action: 'approve',
    reasons: ['verificação de afirmações com problema (divergência de veredito na afirmação 1 entre passadas de verificação), então não posto sozinho'],
    verificationCheckpoint: { total: 2, confirmedCount: 1, conflicts: [{ entries: [] }] },
  }, {});
  assert.match(html, /Verificação de afirmações: 1 confirmadas de 2/);
  assert.match(html, /⚠ 1 divergência/);
  assert.match(html, /pontos? de atenção/, 'o texto do reasons já aparece no bloco de atenção existente, sem UI nova');
});

/* ---------- Diagnóstico: o log de falhas agrupado (visão do painel) ----------
   O log real tinha 159 linhas que eram 146 eventos de 4 episódios (70 de limite de
   plano, 35 de assinatura desligada, 16 de credencial/crédito, 13 de rede). O
   Diagnóstico despejava as 159 cruas, então "1 problema repetido 70 vezes" ficava
   indistinguível de "70 problemas". O agrupamento em si é do lib/log-taxonomy.js
   (triage, servido em /api/log/triage); o que mora aqui é só a FORMATAÇÃO. */

const GRUPOS = [
  { id: 'limite-plano', label: 'Limite do plano Claude', grupo: 'ambiente', kind: 'espera-reset', count: 70, first: '2026-08-07 17:32:15', last: '2026-08-07 21:28:03', refs: ['biudtech/biud-esg#193', 'biudtech/biud-core#262'], sample: 'x' },
  { id: 'assinatura-bloqueada', label: 'Org desligou o acesso por assinatura', grupo: 'credencial', kind: 'permanente', count: 35, first: '2026-08-04 13:46:00', last: '2026-08-07 21:24:10', refs: [], sample: 'y' },
  { id: 'rede', label: 'Rede indisponível', grupo: 'rede', kind: 'transitorio', count: 13, first: '2026-08-03 09:00:00', last: '2026-08-06 11:00:00', refs: [], sample: 'z' },
  { id: 'restart-fila', label: 'App reiniciado com revisão em andamento', grupo: 'operacional', kind: 'operacional', count: 4, first: '2026-08-03 08:00:00', last: '2026-08-03 08:00:59', refs: [], sample: 'w' },
];

test('fmtLogStamp recorta o carimbo do log sem reinterpretar fuso', () => {
  // o farol.log já grava em horário LOCAL: converter aqui (new Date(...)) moveria a
  // hora que a pessoa vê no arquivo. É recorte de texto, de propósito.
  assert.equal(P.fmtLogStamp('2026-08-07 17:32:15'), '07/08 17:32');
  assert.equal(P.fmtLogStamp('2026-01-01 00:00:00'), '01/01 00:00');
});

test('fmtLogStamp devolve o que veio quando não é carimbo (nunca "Invalid Date")', () => {
  assert.equal(P.fmtLogStamp(''), '');
  assert.equal(P.fmtLogStamp(null), '');
  assert.equal(P.fmtLogStamp('nao é data'), 'nao é data');
});

test('logGroupLine: contagem, rótulo, eixos, janela de tempo e os PRs citados', () => {
  const l = P.logGroupLine(GRUPOS[0]);
  assert.match(l, /^70x {2}Limite do plano Claude {2}\[ambiente\/espera-reset\] {2}07\/08 17:32 -> 07\/08 21:28/);
  assert.match(l, /\(2 PRs: biudtech\/biud-esg#193, biudtech\/biud-core#262\)/);
});

test('logGroupLine: sem refs não sobra parêntese vazio', () => {
  assert.doesNotMatch(P.logGroupLine(GRUPOS[1]), /\(/);
});

test('logGroupLine: episódio de um instante só não vira "x -> x"', () => {
  const l = P.logGroupLine({ ...GRUPOS[1], count: 1, first: '2026-08-04 13:46:00', last: '2026-08-04 13:46:20' });
  assert.match(l, /13:46/);
  assert.doesNotMatch(l, /->/);
});

test('logGroupLine: lista de PRs longa é cortada, com o resto contado', () => {
  const refs = ['o/r#1', 'o/r#2', 'o/r#3', 'o/r#4', 'o/r#5', 'o/r#6'];
  const l = P.logGroupLine({ ...GRUPOS[0], refs });
  assert.match(l, /\(6 PRs: o\/r#1, o\/r#2, o\/r#3, o\/r#4 e mais 2\)/);
  assert.doesNotMatch(l, /o\/r#5/);
});

test('logGroupLine: um PR só fala no singular', () => {
  assert.match(P.logGroupLine({ ...GRUPOS[0], refs: ['o/r#1'] }), /\(1 PR: o\/r#1\)/);
});

test('logReadingLine separa o que passa sozinho, o que exige gente e o que é operação', () => {
  // espera-reset e transitorio passam sozinhos; permanente (e o desconhecido, que
  // cai em permanente) exige ação humana; operacional nem é falha de verdade
  assert.equal(P.logReadingLine(GRUPOS),
    'Leitura: 83 evento(s) se resolvem sozinhos, 35 exigem ação humana, 4 são operacionais.');
});

test('logReadingLine: kind fora da tabela conta como ação humana (nunca some da conta)', () => {
  assert.match(P.logReadingLine([{ kind: 'coisa-nova', count: 7 }]), /7 exigem ação humana/);
});

test('logSummaryLines: uma linha por grupo, na ordem que veio, e a leitura no fim', () => {
  const linhas = P.logSummaryLines(GRUPOS);
  assert.equal(linhas.length, GRUPOS.length + 1);
  assert.match(linhas[0], /^70x/);
  assert.match(linhas[3], /^4x/);
  assert.match(linhas[4], /^Leitura:/);
});

test('logSummaryLines: sem grupo nenhum não inventa cabeçalho nem leitura', () => {
  assert.deepEqual(P.logSummaryLines([]), []);
  assert.deepEqual(P.logSummaryLines(null), []);
});

test('logTailLines corta o detalhe e diz quantas linhas ficaram de fora', () => {
  const linhas = Array.from({ length: 159 }, (_, i) => 'linha ' + (i + 1));
  const t = P.logTailLines(linhas, 40);
  assert.equal(t.length, 41);
  assert.equal(t[0], '... e mais 119 linhas anteriores');
  assert.equal(t[1], 'linha 120', 'o corte fica com as ÚLTIMAS, que são as recentes');
  assert.equal(t[40], 'linha 159');
});

test('logTailLines: log menor que o teto sai inteiro, sem linha de aviso', () => {
  assert.deepEqual(P.logTailLines(['a', 'b'], 40), ['a', 'b']);
  assert.deepEqual(P.logTailLines([], 40), []);
  assert.deepEqual(P.logTailLines(null, 40), []);
});

test('logSummaryShort: os 3 maiores grupos, com o resto contado (linha da aba Sistema)', () => {
  const s = P.logSummaryShort(GRUPOS, 3);
  assert.match(s, /^122 falhas em 4 grupos: /);
  assert.match(s, /70x Limite do plano Claude · 35x Org desligou o acesso por assinatura · 13x Rede indisponível/);
  assert.match(s, /e mais 1 grupo/);
  assert.doesNotMatch(s, /App reiniciado/);
});

test('logSummaryShort: sem grupo devolve vazio (a linha some, não mostra "0")', () => {
  assert.equal(P.logSummaryShort([], 3), '');
  assert.equal(P.logSummaryShort(null, 3), '');
});

/* ---------- "Meus PRs": PR oculto ----------
   O caso real: 3 PRs pessoais atualizados ha 738, 740 e 751 dias, que nunca vao mergear
   e ocupavam a aba pra sempre. O motor guarda as chaves ocultas e continua mandando
   myPRs COMPLETO, entao quem separa e a UI. */

const PRS = [
  { key: 'acme/app#1', title: 'um' },
  { key: 'acme/app#2', title: 'dois' },
  { key: 'acme/app#3', title: 'tres' }
];

test('splitHiddenPRs separa o que o motor marcou como oculto, preservando a ordem', () => {
  const { visiveis, ocultos } = P.splitHiddenPRs(PRS, ['acme/app#2']);
  assert.deepEqual(visiveis.map(p => p.key), ['acme/app#1', 'acme/app#3']);
  assert.deepEqual(ocultos.map(p => p.key), ['acme/app#2']);
});

test('splitHiddenPRs: sem oculto nenhum a lista sai inteira do lado visivel', () => {
  assert.deepEqual(P.splitHiddenPRs(PRS, []).visiveis.length, 3);
  assert.deepEqual(P.splitHiddenPRs(PRS, []).ocultos, []);
  assert.deepEqual(P.splitHiddenPRs(PRS, null).visiveis.length, 3);
});

test('splitHiddenPRs: com todos ocultos nao sobra visivel (o vazio que a tela precisa explicar)', () => {
  const r = P.splitHiddenPRs(PRS, ['acme/app#1', 'acme/app#2', 'acme/app#3']);
  assert.deepEqual(r.visiveis, []);
  assert.equal(r.ocultos.length, 3);
});

test('splitHiddenPRs compara sem caixa: chave gravada com outra caixa nao reaparece', () => {
  // o GitHub nao distingue maiuscula em owner/repo; comparar cru faria o PR ocultado
  // voltar sozinho na proxima renderizacao
  const r = P.splitHiddenPRs(PRS, ['ACME/App#2']);
  assert.deepEqual(r.ocultos.map(p => p.key), ['acme/app#2']);
});

test('splitHiddenPRs: lista vazia e chave inexistente nao lancam', () => {
  assert.deepEqual(P.splitHiddenPRs([], ['acme/app#9']), { visiveis: [], ocultos: [] });
  assert.deepEqual(P.splitHiddenPRs(null, null), { visiveis: [], ocultos: [] });
  assert.deepEqual(P.splitHiddenPRs([{}], []).visiveis.length, 1, 'PR sem key nunca conta como oculto');
});

test('effectiveHidden soma o que o motor confirmou com o que acabou de ser ocultado', () => {
  assert.deepEqual(P.effectiveHidden(['acme/app#1'], ['acme/app#2'], []).sort(),
    ['acme/app#1', 'acme/app#2']);
});

test('effectiveHidden tira o que acabou de ser reexibido, mesmo que o motor ainda liste', () => {
  // o card tem que voltar no clique, nao no proximo push de estado
  assert.deepEqual(P.effectiveHidden(['acme/app#1', 'acme/app#2'], [], ['acme/app#1']), ['acme/app#2']);
});

test('effectiveHidden: reexibir vence ocultar da mesma chave, e nao duplica', () => {
  assert.deepEqual(P.effectiveHidden(['acme/app#1'], ['acme/app#1'], []), ['acme/app#1'], 'sem duplicata');
  assert.deepEqual(P.effectiveHidden(['acme/app#1'], ['acme/app#1'], ['acme/app#1']), []);
});

test('effectiveHidden normaliza a caixa e aceita ausencia dos tres argumentos', () => {
  assert.deepEqual(P.effectiveHidden(['ACME/App#1'], [], ['acme/app#1']), []);
  assert.deepEqual(P.effectiveHidden(null, null, null), []);
});

test('hiddenFootLabel monta a linha do rodape, com plural e com a acao oposta', () => {
  assert.equal(P.hiddenFootLabel(3, false), '3 PRs ocultos · mostrar');
  assert.equal(P.hiddenFootLabel(3, true), '3 PRs ocultos · ocultar');
  assert.equal(P.hiddenFootLabel(1, false), '1 PR oculto · mostrar');
});

test('hiddenFootLabel: sem oculto a linha SOME, nao mostra zero', () => {
  assert.equal(P.hiddenFootLabel(0, false), '');
  assert.equal(P.hiddenFootLabel(0, true), '');
  assert.equal(P.hiddenFootLabel(null, false), '');
  assert.equal(P.hiddenFootLabel(-1, false), '');
});

test('myPRsEmptyMsg: loading e error continuam falando do MOTOR, nao dos ocultos', () => {
  assert.match(P.myPRsEmptyMsg('loading', {}), /Verificando/);
  assert.match(P.myPRsEmptyMsg('error', { ocultos: 3 }), /não foi possível|Não foi possível/);
});

test('myPRsEmptyMsg: sem PR nenhum, a mensagem depende do escopo escolhido', () => {
  assert.match(P.myPRsEmptyMsg('empty', { escopoTodas: true }), /organizações monitoradas/);
  assert.match(P.myPRsEmptyMsg('empty', { escopoTodas: false }), /nesta conta/);
});

test('myPRsEmptyMsg: com TODOS ocultos a tela diz por que esta vazia e como desfazer', () => {
  // o vazio em branco sem explicacao era o pior desfecho de ocultar tudo
  const m = P.myPRsEmptyMsg('list', { ocultos: 3 });
  assert.match(m, /3 PRs seus estão ocultos/);
  assert.match(m, /mostrar/, 'diz onde clicar pra ver de novo');
  assert.match(P.myPRsEmptyMsg('list', { ocultos: 1 }), /^1 PR seu está oculto/);
});

test('myPRsEmptyMsg: chamada sem opcoes nao lanca e cai no vazio de sempre', () => {
  assert.match(P.myPRsEmptyMsg('empty'), /organizações monitoradas/);
});

/* ---------- consumo: linha do tempo empilhada (area chart) ---------- */

test('usageStackLayers: empilha 2 camadas, area soma os dois valores no topo', () => {
  const series = [[10, 5], [20, 5], [0, 0]]; // 3 dias, 2 camadas cada
  const geo = P.usageStackLayers(series, ['a', 'b'], ['#111', '#222'], 200, 100);
  assert.equal(geo.layers.length, 2);
  assert.equal(geo.layers[0].color, '#111');
  assert.equal(geo.dayTotals[0], 15);
  assert.equal(geo.dayTotals[1], 25);
  assert.equal(geo.peakIndex, 1, 'dia com maior total (25) e o indice 1');
  assert.equal(geo.xs.length, 3);
  assert.ok(!geo.layers[0].d.includes('NaN'));
});

test('usageStackLayers: dia todo zerado nao quebra (maxV nunca fica 0)', () => {
  const geo = P.usageStackLayers([[0, 0], [0, 0]], ['a', 'b'], ['#111', '#222'], 200, 100);
  assert.ok(!geo.layers[0].d.includes('NaN'));
  assert.ok(!geo.layers[0].d.includes('Infinity'));
});

test('usageHoverIndex: mapeia posicao do mouse pro dia mais proximo, limitado as bordas', () => {
  const geo = P.usageStackLayers([[1], [2], [3], [4]], ['a'], ['#111'], 200, 100);
  assert.equal(P.usageHoverIndex(geo.padL - 50, geo), 0, 'antes do inicio -> primeiro dia');
  assert.equal(P.usageHoverIndex(geo.padL + geo.cw + 50, geo), 3, 'depois do fim -> ultimo dia');
});

test('usageStackLayers: serie vazia nao produz NaN na path (n=0 corner case)', () => {
  const geo = P.usageStackLayers([], ['a', 'b'], ['#111', '#222'], 200, 100);
  assert.equal(geo.layers.length, 0, 'serie vazia -> zero camadas');
  assert.equal(geo.xs.length, 0, 'serie vazia -> zero x-coords');
  assert.equal(geo.dayTotals.length, 0, 'serie vazia -> zero day totals');
  assert.ok(!JSON.stringify(geo).includes('NaN'), 'nenhuma parte do resultado contem NaN');
  assert.ok(!JSON.stringify(geo).includes('Infinity'), 'nenhuma parte do resultado contem Infinity');
});

test('usageMatrixRows: soma so os dias pedidos, calcula totais e intensidade', () => {
  const matrixSeries = [
    { day: '2026-08-01', cells: { review: { 'Opus 4.8': { inputTokens: 10, outputTokens: 0 }, 'Sonnet 4.5': { inputTokens: 2, outputTokens: 0 } } } },
    { day: '2026-08-02', cells: { review: { 'Opus 4.8': { inputTokens: 30, outputTokens: 0 } } } },
    { day: '2026-07-30', cells: { review: { 'Opus 4.8': { inputTokens: 999, outputTokens: 0 } } } }, // fora da janela
  ];
  const r = P.usageMatrixRows(matrixSeries, ['review', 'self'], ['Opus 4.8', 'Sonnet 4.5'], ['2026-08-01', '2026-08-02'], 'input');
  const linhaReview = r.rows.find(x => x.kind === 'review');
  assert.equal(linhaReview.cells.find(c => c.model === 'Opus 4.8').value, 40, '10+30, ignora o dia fora da janela');
  assert.equal(linhaReview.cells.find(c => c.model === 'Sonnet 4.5').value, 2);
  assert.equal(linhaReview.total, 42);
  const linhaSelf = r.rows.find(x => x.kind === 'self');
  assert.equal(linhaSelf.total, 0, 'tipo sem dado nenhum vem zerado, nao ausente');
  assert.equal(r.grand, 42);
  assert.equal(linhaReview.cells.find(c => c.model === 'Opus 4.8').intensity, 1, 'maior celula tem intensidade 1');
});
