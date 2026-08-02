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
