// Primeiro teste de codigo da UI do Farol.
//
// O ui/app.js tinha ~2860 linhas e ZERO teste: era o maior arquivo do projeto e o debito
// declarado como Onda 4 no docs/QUALITY.md. Nao dava pra testar porque e um script de
// navegador que toca `document` no topo. As 26 funcoes PURAS sairam pro ui/pure.js, que
// o navegador le por <script src> e o node le por require. Estas sao elas.
//
// A mais importante e o esc(): e a defesa contra injecao de HTML de ~240 interpolacoes
// espalhadas pelo app, e nunca teve uma linha de teste.
import path from 'node:path';

// fmtClock formata no fuso do processo; sem fixar, o teste passa na minha maquina e
// falha em outra. Tem que vir ANTES do require.
process.env.TZ = 'America/Sao_Paulo';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const P = await import('../ui/pure.js');

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

/* ---------- menções navegáveis (regra: citou X, clicou, chegou em X) ---------- */

test('personMention: foto + @login, link pro perfil no GitHub', () => {
  const html = P.personMention('alice');
  assert.match(html, /href="https:\/\/github\.com\/alice"/);
  assert.match(html, /target="_blank" rel="noreferrer"/, 'link externo abre fora, como o resto do app');
  assert.match(html, /class="avatar /, 'menção de pessoa SEMPRE vem com foto (o pedido do Panorama)');
  assert.match(html, /<span class="pm-login">@alice<\/span>/);
});

test('personMention: login vazio não vira link quebrado, e o texto é escapado', () => {
  const vazio = P.personMention('');
  assert.doesNotMatch(vazio, /<a /, 'sem login não há perfil pra abrir');
  assert.match(vazio, /desconhecido/);
  const xss = P.personMention('a"><script>x</script>');
  assert.doesNotMatch(xss, /<script>/, 'login hostil não injeta tag');
});

test('personMention: semFoto some com o avatar mas mantém o link', () => {
  const html = P.personMention('bob', 'xs', true);
  assert.doesNotMatch(html, /class="avatar /);
  assert.match(html, /href="https:\/\/github\.com\/bob"/);
});

test('repoMention: leva ao repo no GitHub, com cada segmento escapado na URL', () => {
  const html = P.repoMention('acme/app');
  assert.match(html, /href="https:\/\/github\.com\/acme\/app"/);
  assert.match(html, />acme\/app</);
  assert.equal(P.repoMention(''), '', 'repo vazio não vira link');
  assert.match(P.repoMention('acme/app', 'app'), />app</, 'label curta, link completo');
});

test('prRefMention: só owner/repo#N vira link; o resto continua texto', () => {
  const link = P.prRefMention('biudtech/farol#88', 'usage-sessions-ref');
  assert.match(link, /href="https:\/\/github\.com\/biudtech\/farol\/pull\/88"/);
  assert.match(link, /class="usage-sessions-ref pr-ref-mention"/, 'mantém a classe de layout de quem chamou');
  // ref de ferramenta e ausência de ref não podem virar URL inventada
  for (const cru of ['Kudos · BIUD trabalho', '(sem referência)', '', 'só/texto', 'owner/repo#abc']) {
    const span = P.prRefMention(cru, 'x');
    assert.doesNotMatch(span, /<a /, `"${cru}" não é referência de PR`);
  }
  assert.equal(P.ghPrUrl('biudtech/farol#88'), 'https://github.com/biudtech/farol/pull/88');
  assert.equal(P.ghPrUrl('Diagnóstico do Farol'), '');
});

/* Configuração de OPERAÇÃO (v2.40.4). Os 5 checks do doctor cobrem só o
   AMBIENTE (gh, claude, Git Bash, pasta), então uma conta cadastrada sem
   organização nenhuma deixava os 5 verdes enquanto o Farol não achava PR
   nenhum, sem nada na tela explicando por quê. Achado do Wanderson, 11/08/2026. */
test('operationChecks: conta sem organização é o motivo nº 1 de não achar PR, e agora aparece', () => {
  const [c] = P.operationChecks([{ user: 'bob', owners: [], tokenOk: true, muted: false }]);
  assert.equal(c.ok, false);
  assert.match(c.detail, /organiza/i, 'o detalhe diz o que falta, não só que está errado');
  assert.match(c.goto, /^sys:accounts:/, 'clicar leva pra conta em Sistema → Contas');
  assert.match(c.label, /bob/, 'diz QUAL conta, senão com várias contas não dá pra agir');
  // o check de AMBIENTE já rotula a conta primária como "Conta @X" (autenticação).
  // Rótulo igual aqui leria como linha duplicada, sendo outra dimensão: o que ela vigia.
  assert.doesNotMatch(c.label, /^Conta @/, 'o rótulo precisa nomear a dimensão, não repetir a do doctor');
  assert.match(c.label, /Monitoramento/);
});

test('operationChecks: conta sem token no gh não busca nada (o doctor só cobre a primária)', () => {
  const [c] = P.operationChecks([{ user: 'bob', owners: ['acme'], tokenOk: false, muted: false }]);
  assert.equal(c.ok, false);
  assert.match(c.detail, /gh auth login/, 'o detalhe traz o comando que resolve');
});

test('operationChecks: conta completa fica verde e declara o que está vigiando', () => {
  const [c] = P.operationChecks([{ user: 'bob', owners: ['acme', 'globex'], tokenOk: true, muted: false }]);
  assert.equal(c.ok, true);
  assert.match(c.detail, /acme/);
  assert.match(c.detail, /globex/, 'listar as orgs deixa o erro de digitação visível');
});

test('operationChecks: conta silenciada não é erro, mas TODAS silenciadas é', () => {
  const uma = P.operationChecks([
    { user: 'bob', owners: ['acme'], tokenOk: true, muted: true },
    { user: 'ana', owners: ['globex'], tokenOk: true, muted: false },
  ]);
  assert.ok(uma.every(c => c.ok), 'silenciar uma conta é escolha, não defeito');

  const todas = P.operationChecks([
    { user: 'bob', owners: ['acme'], tokenOk: true, muted: true },
    { user: 'ana', owners: ['globex'], tokenOk: true, muted: true },
  ]);
  const alerta = todas.find(c => !c.ok);
  assert.ok(alerta, 'com tudo silenciado o painel fica vazio sem explicação');
  assert.match(alerta.detail, /silenciad/i);
});

test('operationChecks: sem conta nenhuma devolve vazio (o banner de boas-vindas já cobre)', () => {
  assert.deepEqual(P.operationChecks([]), []);
  assert.deepEqual(P.operationChecks([{ user: '', owners: [], tokenOk: false }]), []);
  assert.deepEqual(P.operationChecks(null), []);
});

test('parseGoto: separa tipo, alvo e seletor (o seletor pode conter ":")', () => {
  assert.deepEqual(P.parseGoto('aba:radar'), { tipo: 'aba', alvo: 'radar', seletor: '' });
  assert.deepEqual(P.parseGoto('aba:destaques:#kudosPanel'), { tipo: 'aba', alvo: 'destaques', seletor: '#kudosPanel' });
  assert.deepEqual(P.parseGoto('sys:diag:#sys-row-log'), { tipo: 'sys', alvo: 'diag', seletor: '#sys-row-log' });
  assert.deepEqual(P.parseGoto('deliv:repo:acme/app'), { tipo: 'deliv', alvo: 'repo', seletor: 'acme/app' });
  // seletor CSS com ':' não pode ser picotado (o caso que motivou o resto.join(':'))
  assert.deepEqual(P.parseGoto('sys:accounts:.acct-label:nth-child(2)'),
    { tipo: 'sys', alvo: 'accounts', seletor: '.acct-label:nth-child(2)' });
  assert.deepEqual(P.parseGoto(''), { tipo: '', alvo: '', seletor: '' });
  assert.deepEqual(P.parseGoto(null), { tipo: '', alvo: '', seletor: '' });
});

test('toolRefGoto: ref de ferramenta aponta pro painel dela dentro do próprio app', () => {
  // o ref das sessões de ferramenta é o rótulo montado no lib/engine/tools.js:
  // `Kudos` / `Kudos · <escopo>` e 'Diagnóstico do Farol'
  assert.equal(P.toolRefGoto('Kudos'), 'aba:destaques:#kudosPanel');
  assert.equal(P.toolRefGoto('Kudos · BIUD trabalho'), 'aba:destaques:#kudosPanel');
  assert.equal(P.toolRefGoto('Diagnóstico do Farol'), 'sys:diag:#healthPanel');
  // o que não é ferramenta não pode ganhar destino inventado
  for (const cru of ['biudtech/farol#88', '(sem referência)', '', null, undefined, 'Kudoso', 'Diagnóstico']) {
    assert.equal(P.toolRefGoto(cru), '', `"${cru}" não é ref de ferramenta`);
  }
});

test('sessionRefMention: PR vai pro GitHub, ferramenta vai pro painel, resto fica texto', () => {
  const pr = P.sessionRefMention('biudtech/farol#88', 'usage-sessions-ref');
  assert.match(pr, /href="https:\/\/github\.com\/biudtech\/farol\/pull\/88"/);

  const tool = P.sessionRefMention('Kudos · BIUD trabalho', 'usage-sessions-ref');
  assert.match(tool, /data-goto="aba:destaques:#kudosPanel"/);
  assert.match(tool, /class="usage-sessions-ref is-goto"/, 'mantém a classe de layout de quem chamou');
  assert.match(tool, /role="button"/, 'navegável pelo teclado, igual aos outros data-goto');
  assert.match(tool, /tabindex="0"/);
  assert.doesNotMatch(tool, /<a /, 'destino é interno, não vira link externo');

  const nada = P.sessionRefMention('(sem referência)', 'usage-sessions-ref');
  assert.doesNotMatch(nada, /data-goto/, 'sem destino não ganha affordance de clique');
  assert.doesNotMatch(nada, /<a /);
  assert.match(nada, /\(sem referência\)/, 'o texto continua na tela, no mesmo lugar');
});

test('sessionRefCell: linha de PR ganha o atalho pra caixa de revisão, sem perder o link do GitHub', () => {
  const cel = P.sessionRefCell('biudtech/farol#88');
  assert.match(cel, /href="https:\/\/github\.com\/biudtech\/farol\/pull\/88"/, 'o texto continua indo pro GitHub');
  assert.match(cel, /data-review-key="biudtech\/farol#88"/, 'o atalho carrega a chave, não a URL');
  assert.match(cel, /<button/, 'destino interno é botão, não link');
  // ferramenta e sessão sem ref não têm revisão nenhuma pra abrir
  const tool = P.sessionRefCell('Kudos · BIUD trabalho');
  assert.match(tool, /data-goto="aba:destaques:#kudosPanel"/);
  assert.doesNotMatch(tool, /data-review-key/, 'ferramenta não tem caixa de revisão');
  assert.doesNotMatch(P.sessionRefCell('(sem referência)'), /data-review-key/);
  assert.doesNotMatch(P.sessionRefCell(''), /data-review-key/);
});

test('reviewBoxHtml: revisão resolvida mostra o review humano, sem diagnóstico operacional', () => {
  const html = P.reviewBoxHtml({
    key: 'acme/app#12', verdict: 'approve', status: 'auto_approved',
    pr: { title: 'Ajusta o carrinho', author: 'bob' },
    reasons: ['cobertura incompleta'],
    reportMarkdown: '## Achados\n- nada bloqueante',
  });
  assert.match(html, /acme\/app#12/);
  assert.match(html, /Ajusta o carrinho/);
  assert.doesNotMatch(html, /cobertura incompleta/, 'reason interna não se mistura ao review resolvido');
  assert.match(html, /<h4>Achados<\/h4>/, 'o relatório passa pelo md() (que rebaixa ## pra h4)');
  assert.match(html, /@bob/, 'o autor é menção de pessoa, com foto e link');
});

test('reviewBoxHtml: pendência mantém o motivo humanizado separado do review', () => {
  const html = P.reviewBoxHtml({
    key: 'acme/app#13', verdict: 'approve', status: 'pending',
    reasons: ['O CI ainda está em andamento.'],
    reportMarkdown: 'A validação em `src/config.ts:41` precisa de fallback.',
  });
  assert.match(html, /Por que precisa de você/);
  assert.match(html, /CI ainda está em andamento/);
  assert.match(html, /src\/config\.ts:41/);
});

test('reviewBoxHtml: revisão sem relatório diz isso, em vez de mostrar caixa vazia', () => {
  const html = P.reviewBoxHtml({ key: 'acme/app#12', verdict: 'approve' });
  assert.match(html, /sem relatório/i, 'ausência de relatório é informação, não silêncio');
  assert.doesNotMatch(html, /undefined|null/, 'campo ausente nunca vaza pra tela');
});

test('reviewBoxHtml: decisão inexistente vira aviso honesto, não caixa em branco', () => {
  const html = P.reviewBoxHtml(null);
  assert.match(html, /nenhuma revis(ã|a)o/i);
  assert.doesNotMatch(html, /undefined/);
});

test('sessionRefMention: rótulo de ferramenta com aspas não escapa do atributo', () => {
  // o escopo do kudos vem do nome da conta, que é config do usuário
  const html = P.sessionRefMention('Kudos · a"><b>x</b>', 'usage-sessions-ref');
  assert.doesNotMatch(html, /<b>/, 'markup do rótulo não pode virar markup na tela');
});

test('INVARIANTE: toda menção de autor da UI passa pelo personMention (foto + link)', () => {
  // o pedido do Wanderson (11/08/2026) foi de LÓGICA CENTRALIZADA: se um painel
  // voltar a escrever "@" + login na mão, a foto e o link somem só ali, que é
  // exatamente a assimetria que ele viu no Panorama. Este teste varre o fonte.
  const raiz = path.join(import.meta.dirname, '..', 'ui');
  const suspeitas = [];
  for (const arquivo of ['app.js', 'pure.js']) {
    const src = fs.readFileSync(path.join(raiz, arquivo), 'utf8');
    src.split(/\r?\n/).forEach((linha, i) => {
      // "@${...author...}" ou "@${...user...}" escrito à mão dentro de template
      if (!/@\$\{(esc\()?[\w.]*\b(author|autor|login|user)\b/i.test(linha)) return;
      // só conta o que RENDERIZA marcação: título de diálogo, texto copiado do
      // diagnóstico e afins são texto puro, onde link não existe
      if (!/</.test(linha)) return;
      // <option> não aceita markup dentro, então lá o @login fica texto mesmo
      if (/<option/.test(linha)) return;
      // atributo (title=/aria-label) é texto de acessibilidade, não conteúdo
      if (/(title|aria-label)="[^"]*@\$\{/.test(linha)) return;
      suspeitas.push(`${arquivo}:${i + 1}: ${linha.trim().slice(0, 120)}`);
    });
  }
  assert.deepEqual(suspeitas, [],
    'menção de pessoa escrita à mão: use personMention(login) pra a foto e o link virem de graça');
});

test('deliveriesByRepo escapa o conteúdo e ordena pelo merge mais RECENTE (decisão de 10/08/2026)', () => {
  const html = P.deliveriesByRepo([
    { repo: 'acme/<b>x</b>', key: 'acme/x#1', url: 'https://u/1', title: 'um', author: 'a', mergedAt: '2026-08-01' },
    { repo: 'acme/y', key: 'acme/y#2', url: 'https://u/2', title: 'dois', author: 'b', mergedAt: '2026-07-01' },
    { repo: 'acme/y', key: 'acme/y#3', url: 'https://u/3', title: 'tres', author: 'c', mergedAt: '2026-07-02' },
  ]);
  assert.doesNotMatch(html, /acme\/<b>/, 'nome de repo não vira tag');
  assert.match(html, /acme\/&lt;b&gt;x&lt;\/b&gt;/);
  assert.ok(html.indexOf('acme/&lt;b&gt;') < html.indexOf('acme/y'),
    'o repo com merge mais recente vem antes, mesmo entregando menos (o volume é papel dos cartões)');
  assert.match(html, /2 autores/, 'conta autores distintos');
});

test('deliveriesByRepo desempata recência igual por volume', () => {
  const html = P.deliveriesByRepo([
    { repo: 'acme/x', key: 'acme/x#1', url: 'u', title: 't1', author: 'a', mergedAt: '2026-08-01T10:00:00Z' },
    { repo: 'acme/y', key: 'acme/y#2', url: 'u', title: 't2', author: 'b', mergedAt: '2026-08-01T10:00:00Z' },
    { repo: 'acme/y', key: 'acme/y#3', url: 'u', title: 't3', author: 'b', mergedAt: '2026-07-20T10:00:00Z' },
  ]);
  assert.ok(html.indexOf('acme/y') < html.indexOf('acme/x'), 'no empate de último merge, quem entregou mais vem antes');
});

test('deliveriesByRepo mostra progresso e badge de contagem por grupo', () => {
  const html = P.deliveriesByRepo([
    { repo: 'acme/x', key: 'acme/x#1', url: 'u', title: 't1', author: 'a', mergedAt: '2026-08-03' },
    { repo: 'acme/x', key: 'acme/x#2', url: 'u', title: 't2', author: 'a', mergedAt: '2026-08-02' },
    { repo: 'acme/y', key: 'acme/y#3', url: 'u', title: 't3', author: 'b', mergedAt: '2026-08-01' },
  ]);
  assert.match(html, /deliv-progress/);
  assert.match(html, /<span class="count">2<\/span>/);
});

test('deliveriesByRepo pagina com "mostrar mais" acima do teto e some quando expandido', () => {
  const items = Array.from({ length: 6 }, (_, i) => (
    { repo: 'acme/x', key: `acme/x#${i}`, url: 'u', title: `t${i}`, author: 'a', mergedAt: `2026-08-0${i + 1}` }
  ));
  const fechado = P.deliveriesByRepo(items, { teto: 4 });
  assert.match(fechado, /mostrar mais 2/);
  const aberto = P.deliveriesByRepo(items, { teto: 4, expandedKeys: new Set(['repo:acme/x']) });
  assert.match(aberto, /mostrar menos/);
  assert.doesNotMatch(aberto, /mostrar mais/);
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

test('deliveriesByAuthor ordena por VOLUME, mesmo quando o menor grupo mergeou mais recentemente', () => {
  const html = P.deliveriesByAuthor([
    { repo: 'a/b', key: 'a/b#1', url: 'u', title: 't1', author: 'alice', mergedAt: '2026-08-01' },
    { repo: 'a/b', key: 'a/b#2', url: 'u', title: 't2', author: 'alice', mergedAt: '2026-08-02' },
    { repo: 'a/c', key: 'a/c#3', url: 'u', title: 't3', author: 'bob', mergedAt: '2026-08-03' },
  ]);
  assert.ok(html.indexOf('@alice') < html.indexOf('@bob'),
    'alice tem 2 entregas e vem antes de bob, mesmo que bob tenha o merge mais recente');
  assert.doesNotMatch(html, /deliv-rank/,
    'a contagem do card informa o volume sem reintroduzir um ranking numérico decorativo');
  // a legenda do sub-grupo é uma MENÇÃO de repo: leva ao repo no GitHub
  assert.match(html, /deliv-caption"><a class="repo-mention" href="https:\/\/github\.com\/a\/b"/);
});

test('deliveriesByAuthor desempata volume por recência e empate total por login', () => {
  const html = P.deliveriesByAuthor([
    { repo: 'a/b', key: 'a/b#1', url: 'u', title: 't1', author: 'alice', mergedAt: '2026-08-02T10:00:00Z' },
    { repo: 'a/c', key: 'a/c#2', url: 'u', title: 't2', author: 'alice', mergedAt: '2026-08-01T10:00:00Z' },
    { repo: 'a/b', key: 'a/b#3', url: 'u', title: 't3', author: 'bob', mergedAt: '2026-08-03T10:00:00Z' },
    { repo: 'a/c', key: 'a/c#4', url: 'u', title: 't4', author: 'bob', mergedAt: '2026-08-01T10:00:00Z' },
    // carol/dave têm o mesmo volume e o mesmo último merge; a entrada vem invertida
    // para provar que a última trava é o login, não a ordem acidental do payload.
    { repo: 'a/d', key: 'a/d#5', url: 'u', title: 't5', author: 'dave', mergedAt: '2026-07-01T10:00:00Z' },
    { repo: 'a/e', key: 'a/e#6', url: 'u', title: 't6', author: 'carol', mergedAt: '2026-07-01T10:00:00Z' },
  ]);
  assert.ok(html.indexOf('@bob') < html.indexOf('@alice'),
    'com 2 entregas cada, bob vence pelo merge mais recente');
  assert.ok(html.indexOf('@alice') < html.indexOf('@carol'),
    'volume 2 continua à frente de volume 1');
  assert.ok(html.indexOf('@carol') < html.indexOf('@dave'),
    'empate completo usa login crescente e fica determinístico');
});

test('grupos de Pessoas nascem recolhidos, preservam abertos explícitos e Repositórios seguem abertos', () => {
  const items = [
    { repo: 'a/b', key: 'a/b#1', url: 'u', title: 't1', author: 'alice', mergedAt: '2026-08-02' },
    { repo: 'a/c', key: 'a/c#2', url: 'u', title: 't2', author: 'bob', mergedAt: '2026-08-01' },
  ];
  const fechado = P.deliveriesByAuthor(items);
  assert.match(fechado, /<details data-deliv-group="author:alice">/,
    'a chave fica no details mesmo em grupo pequeno, sem depender de mostrar mais');
  assert.doesNotMatch(fechado, /<details data-deliv-group="author:[^"]+" open>/,
    'nenhuma pessoa nasce aberta');

  const aberto = P.deliveriesByAuthor(items, { openKeys: new Set(['author:alice']) });
  assert.match(aberto, /<details data-deliv-group="author:alice" open>/,
    'uma abertura explícita sobrevive ao próximo render');
  assert.match(aberto, /<details data-deliv-group="author:bob">/,
    'abrir alice não abre os demais grupos');

  const repos = P.deliveriesByRepo(items);
  assert.match(repos, /<details data-deliv-group="repo:a\/b" open>/,
    'o pedido é só para Pessoas; Repositórios preserva o default atual');
});

test('Pessoas combina openKeys com expandedKeys no segundo render', () => {
  const items = Array.from({ length: 6 }, (_, i) => ({
    repo: 'a/b', key: `a/b#${i + 1}`, url: 'u', title: `t${i + 1}`,
    author: 'alice', mergedAt: `2026-08-0${i + 1}`,
  }));
  const html = P.deliveriesByAuthor(items, {
    teto: 4,
    expandedKeys: new Set(['author:alice']),
    openKeys: new Set(['author:alice']),
  });
  assert.match(html, /<details data-deliv-group="author:alice" open>/,
    'o estado do disclosure é independente da paginação');
  assert.match(html, /mostrar menos/);
});

test('delivActivityChart: dia sem merge usa a classe "zero", NUNCA a "empty" global (que inflava a barra pra 54px)', () => {
  const agora = Date.parse('2026-08-10T12:00:00-03:00');
  const html = P.delivActivityChart([
    { mergedAt: '2026-08-10T13:00:00Z' }, // hoje tem 1 merge
  ], 7, agora);
  assert.match(html, /deliv-bar-fill zero" style="height:0%"/, 'dia zerado leva a classe zero com altura 0');
  assert.doesNotMatch(html, /deliv-bar-fill empty/,
    '.empty é o estado vazio GLOBAL do app (padding 26px + borda tracejada): na barra, virava a 2ª mais alta do gráfico');
  assert.match(html, /0 PRs/, 'tooltip do dia zerado diz 0');
});

test('delivCappedMsg fala o limite REAL vindo do server, nunca o 100 antigo', () => {
  // DELIVERIES_LIMIT = 1000 (lib/paths.js); a mensagem afirmava 100, fator de 10
  assert.match(P.delivCappedMsg(1000), /mais de 1000 entregas/);
  // "atividade mais recente", não "mais recentes": o corte do gh e por --sort
  // updated (aproximacao), e a mensagem nao pode prometer corte por data de merge
  assert.match(P.delivCappedMsg(1000), /1000 de atividade mais recente/);
  assert.match(P.delivCappedMsg(1000), /podem subestimar/);
  assert.doesNotMatch(P.delivCappedMsg(1000), /\b100\b/);
  assert.match(P.delivCappedMsg(undefined), /1000/, 'payload em cache sem limit cai no valor real atual');
});

/* ---------- Entregas v2: busca, estatísticas, atividade, paginação ---------- */

test('delivFilterItems filtra por título, autor ou repo, sem diferenciar caixa', () => {
  const items = [
    { repo: 'acme/api', title: 'corrige timeout', author: 'alice', mergedAt: '2026-08-01' },
    { repo: 'acme/web', title: 'feature nova', author: 'bob', mergedAt: '2026-08-02' },
  ];
  assert.equal(P.delivFilterItems(items, '').length, 2, 'busca vazia devolve tudo');
  assert.deepEqual(P.delivFilterItems(items, 'TIMEOUT').map(x => x.author), ['alice']);
  assert.deepEqual(P.delivFilterItems(items, 'bob').map(x => x.repo), ['acme/web']);
  assert.deepEqual(P.delivFilterItems(items, 'acme/web').map(x => x.author), ['bob']);
  assert.equal(P.delivFilterItems(items, 'nada-bate').length, 0);
});

test('delivDayBuckets soma por dia LOCAL, mais antigo primeiro, hoje por último', () => {
  const agora = new Date(2026, 7, 10, 15, 0, 0).getTime(); // seg-feira 10/08/2026 15h
  const items = [
    { mergedAt: new Date(2026, 7, 10, 8, 0).toISOString() },
    { mergedAt: new Date(2026, 7, 10, 9, 0).toISOString() },
    { mergedAt: new Date(2026, 7, 8, 23, 59).toISOString() },
  ];
  const buckets = P.delivDayBuckets(items, 7, agora);
  assert.equal(buckets.length, 7);
  assert.equal(buckets[buckets.length - 1].dayKey, '2026-08-10');
  assert.equal(buckets[buckets.length - 1].n, 2, 'os dois PRs de hoje caem no último bucket');
  assert.equal(buckets[buckets.length - 3].dayKey, '2026-08-08');
  assert.equal(buckets[buckets.length - 3].n, 1);
});

test('delivStats: com período > 0 traz "hoje" e "média por dia" com pico', () => {
  const agora = new Date(2026, 7, 10, 15, 0, 0).getTime();
  const items = [
    { repo: 'acme/api', author: 'alice', mergedAt: new Date(2026, 7, 10, 8, 0).toISOString() },
    { repo: 'acme/api', author: 'alice', mergedAt: new Date(2026, 7, 10, 9, 0).toISOString() },
    { repo: 'acme/web', author: 'bob', mergedAt: new Date(2026, 7, 9, 9, 0).toISOString() },
  ];
  const stats = P.delivStats(items, 7, agora);
  assert.equal(stats.length, 4);
  // `goto` é o atalho pra própria lista: "+N hoje" leva ao período Hoje
  assert.deepEqual(stats[0], { rotulo: 'PRs mergeados', valor: '3', sub: '+2 hoje', goto: 'deliv:days:0' });
  assert.equal(stats[1].valor, '2', 'duas pessoas entregando');
  assert.equal(stats[1].goto, 'deliv:author:alice', 'o sub "@alice na frente" leva ao grupo dela');
  assert.equal(stats[2].valor, '2', 'dois repos ativos');
  assert.equal(stats[2].goto, 'deliv:repo:acme/api', 'o sub "repo na frente" leva ao grupo do repo');
  assert.equal(stats[3].rotulo, 'Média por dia');
  assert.match(stats[3].sub, /pico de 2/);
});

test('delivStats usa o mesmo desempate volume, recência e login da lista de Pessoas', () => {
  const agora = new Date(2026, 7, 10, 15, 0, 0).getTime();
  const base = [
    { repo: 'a/x', author: 'alice', mergedAt: '2026-08-08T10:00:00Z' },
    { repo: 'a/y', author: 'bob', mergedAt: '2026-08-09T10:00:00Z' },
  ];
  assert.equal(P.delivStats(base, 7, agora)[1].goto, 'deliv:author:bob',
    'mesmo volume: o merge mais recente fica na frente');
  const empateTotal = [
    { repo: 'a/y', author: 'dave', mergedAt: '2026-08-09T10:00:00Z' },
    { repo: 'a/x', author: 'carol', mergedAt: '2026-08-09T10:00:00Z' },
  ];
  assert.equal(P.delivStats(empateTotal, 7, agora)[1].goto, 'deliv:author:carol',
    'empate total: login crescente mantém KPI e lista determinísticos');
});

test('delivStats: com período "Hoje" (0) traz "desde 00:00" e "último merge"', () => {
  const agora = new Date(2026, 7, 10, 15, 0, 0).getTime();
  const items = [{ repo: 'acme/api', author: 'alice', mergedAt: new Date(2026, 7, 10, 8, 0).toISOString() }];
  const stats = P.delivStats(items, 0, agora);
  assert.equal(stats[0].sub, 'desde 00:00');
  assert.equal(stats[3].rotulo, 'Último merge');
  assert.match(stats[3].sub, /@alice/);
});

test('delivStats devolve lista vazia quando não há entregas no período', () => {
  assert.deepEqual(P.delivStats([], 7, Date.now()), []);
});

test('delivSliceRows corta no teto, tira legenda órfã e ignora o teto quando expandido', () => {
  const rows = [
    { ehPr: false, ehCap: true, cap: 'repo-a' },
    { ehPr: true, id: 1 }, { ehPr: true, id: 2 },
    { ehPr: false, ehCap: true, cap: 'repo-b' },
    { ehPr: true, id: 3 },
  ];
  const fechado = P.delivSliceRows(rows, 2, false);
  assert.equal(fechado.resto, 1);
  assert.deepEqual(fechado.visiveis.map(r => r.id || r.cap), ['repo-a', 1, 2], 'a legenda órfã de repo-b sai da fatia');
  const aberto = P.delivSliceRows(rows, 2, true);
  assert.equal(aberto.resto, 0);
  assert.equal(aberto.visiveis.length, 5);
});

test('delivEmptyState varia o texto com e sem busca, e as ações com o contexto', () => {
  const semBusca = P.delivEmptyState({ query: '', canExpand: true, canClear: false });
  assert.match(semBusca, /Nenhum PR mergeado neste período/);
  assert.match(semBusca, /Ver 30 dias/);
  assert.doesNotMatch(semBusca, /Limpar busca/);
  const comBusca = P.delivEmptyState({ query: 'xyz', canExpand: false, canClear: true });
  assert.match(comBusca, /Nada com “xyz”/);
  assert.doesNotMatch(comBusca, /Ver 30 dias/);
  assert.match(comBusca, /Limpar busca/);
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

test('feedLine: linha de subagente ganha a etiqueta 👤 com o rótulo escapado', () => {
  const l = P.feedLine({ k: 'tool', t: '2026-08-17T12:00:00Z', text: 'Bash · comparar heads', a: 'claim-verifier <1>' });
  assert.match(l, /class="feed-line k-tool from-agent"/);
  assert.match(l, /👤 claim-verifier &lt;1&gt;/, 'rótulo do agente aparece e escapa HTML');
});

test('fmtDur: durações humanas curtas e vazio pro inválido', () => {
  assert.equal(P.fmtDur(38_000), '38s');
  assert.equal(P.fmtDur(250_000), '4m10s');
  assert.equal(P.fmtDur(240_000), '4m');
  assert.equal(P.fmtDur(3_720_000), '1h02m');
  assert.equal(P.fmtDur(0), '');
  assert.equal(P.fmtDur(null), '');
});

test('stagesLine: monta a linha de tempo por etapa e some sem traço', () => {
  const l = P.stagesLine({ totalMs: 720_000, stages: [
    { id: 'leitura', label: 'leitura', ms: 240_000 },
    { id: 'verificacao', label: 'verificação', ms: 300_000 },
    { id: 'redacao', label: 'redação', ms: 120_000 },
  ] });
  assert.equal(l, 'Tempo por etapa: leitura 4m · verificação 5m · redação 2m (total 12m)');
  assert.equal(P.stagesLine(null), '');
  assert.equal(P.stagesLine({ totalMs: 0, stages: [] }), '');
});

test('resolvedRow: decisão com stages mostra a linha de tempo por etapa', () => {
  const html = P.resolvedRow({
    key: 'org/app#9', status: 'posted', action: 'approve', verdict: 'approve', resolvedAt: Date.now(),
    pr: { url: 'https://github.com/org/app/pull/9', title: 't' },
    stages: { totalMs: 600_000, stages: [{ id: 'leitura', label: 'leitura', ms: 600_000 }] },
  }, {});
  assert.match(html, /rr-stages/);
  assert.match(html, /Tempo por etapa: leitura 10m \(total 10m\)/);
});

test('stageFlowFrom: acumula por estampa, herda etapa em linha sem estampa e marca a ativa', () => {
  const t0 = 1000_000;
  const flow = P.stageFlowFrom([
    { t: t0 + 5_000, s: 'preparo' },
    { t: t0 + 65_000, s: 'leitura' },
    { t: t0 + 70_000 },                    // sem estampa: herda leitura
    { t: t0 + 100_000, s: 'verificacao' },
  ], t0, t0 + 130_000);
  const porId = Object.fromEntries(flow.map(f => [f.id, f]));
  assert.equal(porId.preparo.ms, 5_000);
  assert.equal(porId.leitura.ms, 65_000, '60s da linha + 5s da linha sem estampa');
  assert.equal(porId.verificacao.ms, 60_000, '30s até a linha + 30s correndo até agora');
  assert.equal(porId.verificacao.state, 'active', 'a etapa do último item é a ativa');
  assert.equal(porId.leitura.state, 'done');
  assert.equal(porId.redacao.state, 'pending');
});

test('stageFlowFrom/Html: sem traço não desenha nada', () => {
  assert.deepEqual(P.stageFlowFrom([], null), []);
  assert.equal(P.stageFlowHtml(P.stageFlowFrom([], 1000, 2000)), '',
    'sem nenhum item, nenhuma etapa tem tempo e a esteira fica escondida');
});

test('stageFlowHtml: nós na ordem canônica com estado e duração, ligados por conector', () => {
  const html = P.stageFlowHtml(P.stageFlowFrom([
    { t: 2_000, s: 'leitura' },
  ], 1_000, 62_000));
  assert.match(html, /sf-node sf-active[^>]*title="leitura · 1m01s"/, 'ativa com tempo acumulando');
  assert.match(html, /sf-node sf-pending[^>]*title="redação"/);
  assert.match(html, /<span class="sf-link">/);
  assert.ok(html.indexOf('leitura') < html.indexOf('verificação'), 'ordem canônica preservada');
});

test('agentsTitle: uma linha por subagente, com tarefa e estado', () => {
  const t = P.agentsTitle([
    { label: 'claim-verifier 1', desc: 'checar ruleset', done: false },
    { label: 'claim-verifier 2', desc: '', done: true },
  ]);
  assert.equal(t, 'claim-verifier 1: checar ruleset (trabalhando)\nclaim-verifier 2 (concluído)');
  assert.equal(P.agentsTitle([]), '');
  assert.equal(P.agentsTitle(null), '');
});

test('feedLine: linha da sessão principal segue sem etiqueta de agente', () => {
  const l = P.feedLine({ k: 'tool', t: '2026-08-17T12:00:00Z', text: 'Bash · consolidar' });
  assert.doesNotMatch(l, /feed-agent/);
  assert.doesNotMatch(l, /from-agent/);
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

/* ---------- selfSessionKey + sessionProgress: a barra honesta da autoanálise ---------- */

test('selfSessionKey acha o PR da sessão self dona do evento de atividade', () => {
  const sessions = [
    { id: 's1', mode: 'auto', keys: ['a/b#1'] },
    { id: 's2', mode: 'self', keys: ['c/d#2'] }
  ];
  assert.equal(P.selfSessionKey(sessions, 's2'), 'c/d#2');
});

test('selfSessionKey devolve null pra sessão de revisão (auto) e pra id desconhecido', () => {
  const sessions = [{ id: 's1', mode: 'auto', keys: ['a/b#1'] }];
  assert.equal(P.selfSessionKey(sessions, 's1'), null, 'revisão headless não move o widget de autoanálise');
  assert.equal(P.selfSessionKey(sessions, 's9'), null);
  assert.equal(P.selfSessionKey(null, 's1'), null);
  assert.equal(P.selfSessionKey([{ id: 's3', mode: 'self' }], 's3'), null, 'sessão self sem keys não inventa destino');
});

test('sessionProgress cresce com a atividade, nunca recua e trava em 90', () => {
  // o bug relatado: barra fixa em 25% até concluir do nada; a régua nova tem
  // que MOVER a cada evento do feed e nunca prometer 100 antes do fim real
  let prev = -1;
  for (let n = 0; n <= 200; n++) {
    const p = P.sessionProgress(n);
    assert.ok(p >= prev, `recuou em n=${n}`);
    assert.ok(p >= 5 && p <= 90, `fora da faixa em n=${n}: ${p}`);
    prev = p;
  }
  assert.ok(P.sessionProgress(10) > P.sessionProgress(1), 'os primeiros eventos têm que mover a barra de forma visível');
  assert.equal(P.sessionProgress(0), 5);
  assert.equal(P.sessionProgress(1e6), 90);
  assert.equal(P.sessionProgress(undefined), 5, 'falta de dado não quebra nem inventa progresso');
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

// caso de teste real de 2026-07: validação de renderização do estado aprovado
function linhaResolvida(extra) {
  return {
    key: 'biudtech/biud-esg#172', status: 'auto_approved', action: 'approve',
    resolvedAt: Date.parse('2026-08-03T19:41:00Z'),
    pr: { url: 'https://github.com/biudtech/biud-esg/pull/172', title: 'Ajusta o cálculo', author: 'alex' },
    card: 'CARD-2026-07', attention: [], reasons: [], reportMarkdown: '# relatório',
    ...extra
  };
}
const CTX = { pushbacks: {}, chip: '', chatBadge: '', agora: AG };

test('resolvedRow: cabeçalho traz referência, card, selo e o quando com dia', () => {
  const html = P.resolvedRow(linhaResolvida(), CTX);
  assert.match(html, /biudtech\/biud-esg#172/);
  assert.match(html, /CARD-2026-07/); // validação de renderização do card
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

test('resolvedRow: autor vem com foto (avatar), numa linha própria fora do título', () => {
  const html = P.resolvedRow(linhaResolvida(), CTX);
  assert.match(html, /<div class="rr-person">/, 'bloco próprio pro autor');
  assert.match(html, /class="avatar sm"/, 'mesmo helper avatar() das outras telas, tamanho sm');
  assert.match(html, /github\.com\/alex\.png\?size=96/, 'foto de perfil do GitHub do autor');
  const tituloBloco = html.match(/<div class="rr-title"[^>]*>[\s\S]*?<\/div>/)[0];
  assert.doesNotMatch(tituloBloco, /@alex|rr-person|avatar/, 'autor não mora mais dentro do título truncado');
});

test('resolvedRow: título bem comprido não engole o autor (o bug relatado)', () => {
  const tituloLongo = 'x'.repeat(300);
  const html = P.resolvedRow(linhaResolvida({ pr: { url: 'https://x/y/pull/1', title: tituloLongo, author: 'alex' } }), CTX);
  assert.match(html, /@alex/, 'autor continua presente mesmo com título gigante');
  assert.match(html, /class="avatar sm"/, 'e continua com foto');
});

test('resolvedRow: sem autor, não sobra avatar nem @ soltos', () => {
  const html = P.resolvedRow(linhaResolvida({ pr: { url: 'https://x/y/pull/1', title: 'só título, sem autor' } }), CTX);
  assert.doesNotMatch(html, /rr-person/, 'nenhum bloco de autor vazio');
  assert.doesNotMatch(html, /class="avatar/, 'nenhum avatar sem login');
  assert.doesNotMatch(html, />@</, 'nenhum @ solto');
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

// #742: o dedup engoliu DOIS rounds (15:38 e 16:07, 4 reasons cada, attention vazio) e a
// linha não mostrava nenhum deles, porque o fallback pras reasons só valia pra
// auto_approved/auto_rejected. "Não repostei" quer dizer que o achado ficou SÓ aqui,
// então é justamente aqui que ele não pode estar escondido.
test('resolvedRow: já revisado (não repostei) mostra os achados que ficaram só no app', () => {
  const html = P.resolvedRow(linhaResolvida({
    status: 'already_reviewed', action: 'request_changes', attention: [],
    reasons: ['Open redirect ativo no head 2187af8', '2º round do mesmo blocker']
  }), CTX);
  assert.match(html, /2 achados que ficaram só aqui/, 'o expansor existe e diz que nada foi pro PR');
  assert.match(html, /Open redirect ativo no head 2187af8/, 'o achado aparece na linha');
});

test('resolvedRow: já revisado no singular não pluraliza', () => {
  const html = P.resolvedRow(linhaResolvida({
    status: 'already_reviewed', action: 'request_changes', attention: [], reasons: ['um só']
  }), CTX);
  assert.match(html, /1 achado que ficou só aqui/);
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
  // sem autor aqui de propósito: o teste é sobre título/card, e o avatar do
  // autor tem um <img> LEGÍTIMO (ver teste de rr-person acima), que poluiria
  // a asserção genérica de "nenhum <img> na saída".
  const html = P.resolvedRow(linhaResolvida({
    card: '<img src=x onerror=alert(1)>',
    pr: { url: 'https://x/y/pull/1', title: '<script>alert(1)</script>' }
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
  assert.match(linhas[0], /^70x/);
  assert.match(linhas[3], /^4x/);
  assert.match(linhas[4], /^Leitura:/, 'a leitura fecha o bloco de contagem');
  // desde a v2.52.3 pode vir linha de REGIME depois da leitura (grupo que passa
  // sozinho mas dura horas). O fixture tem um: 70 falhas de limite de plano em ~4h.
  const regime = linhas.slice(5);
  assert.equal(linhas.length, GRUPOS.length + 1 + regime.length, 'nada além de grupo, leitura e regime');
  assert.ok(regime.every(l => /é regime/.test(l)), 'o que vem depois da leitura é só regime');
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

/* ---------- G19 (I3): a recusa da guarda de merge nao e falha ---------- */

test('mergeToastKind: a recusa da guarda de double-click sai como aviso, nao como erro', () => {
  // o primeiro merge seguiu em frente; vermelho ali mente sobre o que aconteceu
  assert.equal(P.mergeToastKind(P.MERGE_EM_ANDAMENTO), 'info');
  assert.equal(P.mergeToastKind('merge já em andamento'), 'info');
});

test('mergeToastKind: qualquer outra falha continua vermelha', () => {
  assert.equal(P.mergeToastKind('o PR recebeu commit depois da sua análise'), 'error');
  assert.equal(P.mergeToastKind(''), 'error');
  assert.equal(P.mergeToastKind(undefined), 'error', 'sem mensagem, o fallback do handler e falha de verdade');
});

test('os tres botoes de merge da UI usam mergeToastKind, nenhum ficou com toast fixo', () => {
  // os tres (normal, auto, admin) passam pela MESMA guarda do mergeSelfPR: se um
  // deles voltar a chamar toast('error', ...) direto, o clique duplo dele volta a
  // piscar vermelho e so este teste avisa
  const APP = fs.readFileSync(path.join(import.meta.dirname, '..', 'ui', 'app.js'), 'utf8');
  const fixos = [...APP.matchAll(/toast\('error',\s*esc\(r\?\.error \|\| 'não consegui [^']*merge[^']*'\)\)/g)];
  assert.deepEqual(fixos.map(m => m[0]), [], 'toast de merge com cor fixa ignora a recusa benigna da guarda');
  assert.equal([...APP.matchAll(/mergeToastKind\(r\?\.error\)/g)].length, 3,
    'os tres handlers de merge roteiam a cor pelo helper');
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

test('usageMatrixRows: modelo sem dado nenhum na janela pedida vem com coluna zerada (nunca ausente)', () => {
  // u.modelNames (backend) nunca poda modelo aposentado: quem tem que decidir se
  // mostra a coluna e o renderer (drawUsageMatrix, ui/app.js), olhando colTotals.
  // Essa funcao so precisa devolver o dado CORRETO pro renderer filtrar (achado da
  // revisao final: a matriz mostrava colunas fantasma "US$ 0.00" pra sempre).
  const matrixSeries = [
    { day: '2026-08-01', cells: { review: { 'Opus 4.8': { inputTokens: 10, outputTokens: 0 } } } },
  ];
  const r = P.usageMatrixRows(matrixSeries, ['review', 'self'], ['Opus 4.8', 'Modelo Aposentado'], ['2026-08-01'], 'input');
  const jAtivo = 0, jAposentado = 1;
  assert.equal(r.colTotals[jAtivo], 10, 'coluna com dado soma normalmente');
  assert.equal(r.colTotals[jAposentado], 0, 'coluna sem NENHUM dado na janela vem zerada, nao ausente');
  const linhaReview = r.rows.find(x => x.kind === 'review');
  assert.equal(linhaReview.cells[jAposentado].value, 0);
  assert.equal(linhaReview.cells[jAposentado].model, 'Modelo Aposentado');
  assert.equal(r.grand, 10, 'grand total nao conta a coluna aposentada (ela e zero mesmo)');
});

test('usageSessionRow: formata quando, tipo, tokens, custo e estado', () => {
  const agora = Date.parse('2026-08-10T15:00:00-03:00');
  const s = { at: Date.parse('2026-08-10T14:12:00-03:00'), kind: 'review', ref: 'biudtech/farol#88', model: 'Sonnet 5', inputTokens: 80000, outputTokens: 16400, costUsd: 0.41, status: 'ok' };
  const r = P.usageSessionRow(s, agora);
  assert.match(r.whenLabel, /^hoje /);
  assert.equal(r.kindLabel, 'Revisão');
  assert.equal(r.ref, 'biudtech/farol#88');
  assert.equal(r.model, 'Sonnet 5');
  assert.equal(r.tokLabel, P.fmtTok(96400));
  assert.equal(r.costLabel, '0.41');
  assert.equal(r.stLabel, 'ok');
  assert.equal(r.stClass, 'ok');
});

test('usageSessionRow: sessao com erro e sem ref', () => {
  const s = { at: Date.now(), kind: 'tool', ref: null, model: 'Haiku 4.5', inputTokens: 1, outputTokens: 1, costUsd: 0, status: 'erro' };
  const r = P.usageSessionRow(s, Date.now());
  assert.equal(r.ref, '(sem referência)');
  assert.equal(r.stLabel, 'erro');
  assert.equal(r.stClass, 'erro');
});

// coluna FAROL da tabela "Sessoes recentes": mostra a versao que gravou a
// sessao. O carimbo nasceu na v2.42.0 (P.FAROL_STAMP_SINCE); sessao com o
// campo mostra o valor cru, sessao anterior a essa versao (sem o campo) mostra
// o rotulo de pre-carimbo, nunca celula vazia nem "?" nem travessao.
test('usageSessionRow: farol mostra a versão quando a sessão carrega o campo', () => {
  const s = { at: Date.now(), kind: 'review', ref: 'biudtech/farol#1', model: 'Sonnet 5', farol: '2.42.0', inputTokens: 1, outputTokens: 1, costUsd: 0, status: 'ok' };
  const r = P.usageSessionRow(s, Date.now());
  assert.equal(r.farol, '2.42.0');
});

test('usageSessionRow: farol com valor diferente do padrão continua mostrando o valor cru', () => {
  const s = { at: Date.now(), kind: 'review', ref: 'biudtech/farol#2', model: 'Sonnet 5', farol: '2.43.0', inputTokens: 1, outputTokens: 1, costUsd: 0, status: 'ok' };
  const r = P.usageSessionRow(s, Date.now());
  assert.equal(r.farol, '2.43.0');
});

test('usageSessionRow: sessão antiga sem farol mostra "< 2.42.0" (rótulo de pré-carimbo, nunca vazio)', () => {
  const s = { at: Date.now(), kind: 'review', ref: 'biudtech/farol#0', model: 'Sonnet 5', inputTokens: 1, outputTokens: 1, costUsd: 0, status: 'ok' };
  const r = P.usageSessionRow(s, Date.now());
  assert.equal(r.farol, P.FAROL_PRE_STAMP_LABEL);
  assert.equal(r.farol, '< 2.42.0');
});

/* ---------- creditsHtml: Sistema > Sobre ---------- */

test('creditsHtml sem dado explica a espera em vez de ficar mudo', () => {
  const html = P.creditsHtml(null);
  assert.match(html, /credits-wait/, 'estado de espera tem cara própria');
  assert.match(html, /gh/, 'diz de onde o dado vem e o que precisa');
});

test('creditsHtml: idealizador destacado, contribuidor via personMention, sem duplicar o dono', () => {
  const credits = {
    repo: 'wandersonaadsantos/farol',
    owner: { login: 'wandersonaadsantos', name: 'Wanderson Santos' },
    contributors: [
      { login: 'wandersonaadsantos', contributions: 500 },
      { login: 'thiagocarvalho-dev', contributions: 3 },
    ],
  };
  const html = P.creditsHtml(credits);
  assert.match(html, /Idealizador e mantenedor/, 'papel do dono nomeado');
  assert.match(html, /Wanderson Santos/, 'nome de exibição aparece');
  assert.match(html, /person-mention/, 'pessoa sai por personMention (menção navegável com foto)');
  assert.match(html, /thiagocarvalho-dev/);
  assert.match(html, /3 contribuições/, 'contagem de contribuições visível');
  // personMention gera "@login" no title E no texto visível; conta só o visível
  const donos = html.match(/pm-login">@wandersonaadsantos</g) || [];
  assert.equal(donos.length, 1, 'o dono não repete na lista de contribuidores');
  assert.match(html, /repo-mention/, 'o rodapé linka o repositório de origem da lista');
});

test('creditsHtml: só o dono no repo = sem bloco de contribuidores, nunca lista vazia', () => {
  const credits = {
    repo: 'wandersonaadsantos/farol',
    owner: { login: 'wandersonaadsantos', name: '' },
    contributors: [{ login: 'wandersonaadsantos', contributions: 500 }],
  };
  const html = P.creditsHtml(credits);
  assert.match(html, /Idealizador/, 'card do idealizador segue');
  assert.doesNotMatch(html, /credits-grid/, 'grade de contribuidores não aparece vazia');
});

test('safeJsonParse: objeto valido volta, lixo vira null, nunca lanca', () => {
  assert.deepEqual(P.safeJsonParse('{"a":1}'), { a: 1 });
  assert.equal(P.safeJsonParse('{torto'), null);
  assert.equal(P.safeJsonParse(''), null);
  assert.equal(P.safeJsonParse(undefined), null);
});

test('buildFixPrompt: PR com achados inclui url, título, card, resumo, bloqueios e dicas', () => {
  const p = P.buildFixPrompt({
    key: 'o/r#1',
    url: 'https://github.com/o/r/pull/1',
    title: 'Corrige X',
    card: 'card de exemplo',
    summary: 'PR ok, mas com pendências.',
    blockers: ['falta teste do caminho de erro'],
    tips: ['extrair função duplicada'],
  });
  assert.match(p, /corrija os pontos levantados na revisão do PR o\/r#1, começando pelo que trava a aprovação/);
  assert.match(p, /PR: https:\/\/github\.com\/o\/r\/pull\/1/);
  assert.match(p, /Título: Corrige X/);
  assert.match(p, /Card: card de exemplo/);
  assert.match(p, /Resumo da revisão: PR ok, mas com pendências\./);
  assert.match(p, /Pendências que travam a aprovação \(prioridade\):\n- falta teste do caminho de erro/);
  assert.match(p, /Melhorias sugeridas:\n- extrair função duplicada/);
});

test('buildFixPrompt: sem bloqueios muda a abertura pra "aplique as melhorias" e ignora campos ausentes', () => {
  const p = P.buildFixPrompt({ key: 'o/r#2', blockers: [], tips: ['ajustar nome de variável'] });
  assert.match(p, /aplique as melhorias sugeridas na revisão do PR o\/r#2/);
  assert.doesNotMatch(p, /^PR: /m);
  assert.doesNotMatch(p, /Pendências que travam/);
  assert.match(p, /Melhorias sugeridas:\n- ajustar nome de variável/);
});

/* ---------- resolvedRow: por que o PR veio pra mim (16/08/2026) ----------
   O #767 caiu na mesa por contestação, foi aprovado à mão, e a linha das Revisões
   recentes mostrava só "postado por você (APPROVE)". O motivo estava gravado em
   `reasons` desde sempre, sem nenhuma superfície: dava pra achar que a chave de
   aprovar sozinho tinha quebrado. Agora `posted` também abre os motivos. */

function linhaPostada(extra) {
  return {
    key: 'biudtech/biud-frontend#767', status: 'posted', action: 'approve',
    resolvedAt: Date.parse('2026-08-03T19:41:00Z'),
    pr: { url: 'https://github.com/biudtech/biud-frontend/pull/767', title: 'ci: pula a suite E2E', author: 'alex' },
    attention: [], reasons: ['1 discordância de outro review no PR, confira a redação antes de postar'],
    ...extra
  };
}

test('resolvedRow: aprovado por você mostra por que não saiu sozinho', () => {
  const html = P.resolvedRow(linhaPostada(), CTX);
  assert.match(html, /motivo de ter vindo pra você/, 'rótulo diz que é o motivo, não ponto de atenção do approve');
  assert.match(html, /1 discordância de outro review/, 'o motivo gravado aparece');
});

test('resolvedRow: vários motivos pluralizam o rótulo', () => {
  const html = P.resolvedRow(linhaPostada({ reasons: ['contestação', 'cobertura incompleta'] }), CTX);
  assert.match(html, /2 motivos de ter vindo pra você/);
});

test('resolvedRow: postado sem motivo nenhum não inventa bloco vazio', () => {
  const html = P.resolvedRow(linhaPostada({ reasons: [] }), CTX);
  assert.doesNotMatch(html, /resolved-attn/, 'sem reasons, nada de expansível vazio');
});

test('resolvedRow: o rótulo de aprovado sozinho continua falando de ponto de atenção', () => {
  const html = P.resolvedRow(linhaResolvida({ attention: ['ressalva técnica'] }), CTX);
  assert.match(html, /ponto de atenção/, 'auto_approved não herdou o texto novo');
  assert.doesNotMatch(html, /veio pra você/);
});

/* ---------- motivos agrupados por eixo (biud-frontend#774) ----------
   Antes tudo era uma <ul> plana, então "a rede caiu no meio do POST" lia igual a
   "a revisão achou um problema no código". O print do #774 mostrava "7 motivos de
   ter vindo pra você" misturando os dois, o que fazia o gate parecer quebrado. */

test('reasonGroups: separa os três eixos e respeita a ordem de leitura', () => {
  const g = P.reasonGroups([
    { text: 'achado da revisão', kind: 'content' },
    { text: 'a política manda esperar', kind: 'gate' },
    { text: 'falha ao postar o APPROVE: HTTP 503', kind: 'infra' },
  ]);
  assert.deepEqual(g.map(x => x.kind), ['infra', 'gate', 'content'],
    'infra primeiro (é o acionável), conteúdo por último');
});

test('reasonGroups: string solta (histórico antigo) entra como achado da revisão', () => {
  // decisions.json gravado antes da v2.48.0 não tem etiqueta; a leitura
  // conservadora nunca inventa um gate nem uma falha de infra que não houve
  const g = P.reasonGroups(['motivo antigo sem etiqueta']);
  assert.equal(g.length, 1);
  assert.equal(g[0].kind, 'content');
  assert.deepEqual(g[0].items, ['motivo antigo sem etiqueta']);
});

test('reasonGroups: agrupa vários motivos do mesmo eixo num bloco só', () => {
  const g = P.reasonGroups([
    { text: 'um', kind: 'gate' },
    { text: 'dois', kind: 'gate' },
  ]);
  assert.equal(g.length, 1);
  assert.deepEqual(g[0].items, ['um', 'dois']);
});

test('reasonGroups: lista vazia não inventa grupo', () => {
  assert.deepEqual(P.reasonGroups([]), []);
  assert.deepEqual(P.reasonGroups(null), []);
});

test('reasonGroupsHtml: falha de infra avisa que o app ainda vai tentar sozinho', () => {
  const html = P.reasonGroupsHtml(
    [{ text: 'falha ao postar o APPROVE: HTTP 503', kind: 'infra' }],
    { attempts: 1, exhausted: false });
  assert.match(html, /tentando de novo sozinho/, 'você não precisa fazer nada, e a tela diz isso');
  assert.match(html, /falha técnica ao postar/);
});

test('reasonGroupsHtml: retry esgotado diz que desistiu, e quantas vezes tentou', () => {
  const html = P.reasonGroupsHtml(
    [{ text: 'falha ao postar o APPROVE: HTTP 503', kind: 'infra' }],
    { attempts: 3, exhausted: true });
  assert.match(html, /desisti de tentar sozinho depois de 3 tentativa/);
  assert.doesNotMatch(html, /tentando de novo/, 'não pode dizer as duas coisas');
});

test('reasonGroupsHtml: sem postRetry o grupo de infra não promete retry nenhum', () => {
  const html = P.reasonGroupsHtml([{ text: 'falha ao postar', kind: 'infra' }], null);
  assert.doesNotMatch(html, /tentando de novo|desisti de tentar/);
});

test('reasonGroupsHtml: escapa o texto do motivo (não confia no que veio da sessão)', () => {
  const html = P.reasonGroupsHtml([{ text: '<img src=x onerror=alert(1)>', kind: 'content' }], null);
  assert.doesNotMatch(html, /<img/, 'nada de HTML cru vindo de texto de modelo');
});

test('resolvedRow: infra e conteúdo aparecem separados na mesma linha', () => {
  const html = P.resolvedRow(linhaPostada({
    reasons: [
      { text: 'a doc afirma algo que o GitHub não faz', kind: 'content' },
      { text: 'falha ao postar o APPROVE: HTTP 503', kind: 'infra' },
    ],
  }), CTX);
  assert.match(html, /2 motivos de ter vindo pra você/, 'a contagem total continua honesta');
  assert.match(html, /falha técnica ao postar/);
  assert.match(html, /ponto que a revisão levantou/);
});

/* ---------- onda 5: perfil por pessoa, reviewers e chat ----------
   As oito funções abaixo eram do app.js e liam global (STATE.config.people,
   reviewerCands, STATE.chats). Viraram puras com um parâmetro a mais, que é o
   passo que docs/QUALITY.md já deixava mapeado. O que os testes guardam aqui é
   justamente o que o global escondia: o comportamento quando o mapa NÃO chegou
   ainda, que na tela é o estado normal antes do primeiro SSE. */

const PEOPLE = {
  alice: { papel: 'senior', dominios: { backend: 'autoridade', frontend: 'basico' } },
  bob: { papel: 'junior' },
};

test('personOf: acha por login em minúsculas, e login com caixa diferente também', () => {
  assert.equal(P.personOf('alice', PEOPLE).papel, 'senior');
  assert.equal(P.personOf('ALICE', PEOPLE).papel, 'senior', 'o login vem do GitHub com a caixa do dono');
});

test('personOf: sem mapa, sem pessoa e sem login devolve objeto vazio, nunca undefined', () => {
  // é o caso real: STATE ainda null antes do primeiro SSE. Quem chama faz
  // .papel logo depois, então devolver undefined aqui viraria TypeError na tela.
  assert.deepEqual(P.personOf('alice', null), {});
  assert.deepEqual(P.personOf('ninguem', PEOPLE), {});
  assert.deepEqual(P.personOf('', PEOPLE), {});
  assert.deepEqual(P.personOf(undefined, undefined), {});
});

test('papelOf e domLevelOf: valor quando existe, string vazia quando não', () => {
  assert.equal(P.papelOf('alice', PEOPLE), 'senior');
  assert.equal(P.papelOf('bob', PEOPLE), 'junior');
  assert.equal(P.papelOf('ninguem', PEOPLE), '');
  assert.equal(P.domLevelOf('alice', 'backend', PEOPLE), 'autoridade');
  assert.equal(P.domLevelOf('bob', 'backend', PEOPLE), '', 'pessoa sem matriz não quebra');
  assert.equal(P.domLevelOf('alice', 'infra', PEOPLE), '', 'domínio não marcado é vazio');
});

test('papelPicker: marca selected no papel da pessoa, e só nele', () => {
  const html = P.papelPicker('alice', PEOPLE);
  assert.match(html, /<option value="senior" selected>/);
  assert.equal((html.match(/ selected/g) || []).length, 1, 'exatamente uma opção selecionada');
  assert.match(html, /data-login="alice"/);
});

test('papelPicker: sem pessoa cai na opção vazia, que é o rótulo "papel"', () => {
  const html = P.papelPicker('ninguem', PEOPLE);
  assert.match(html, /<option value="" selected>papel<\/option>/);
});

test('papelPicker: escapa o login (vem do GitHub, não é confiável)', () => {
  // Procurar a TAG com regex é asserção fraca (não pega <SCRIPT>, e o CodeQL
  // reprova com razão: js/bad-tag-filter). O que prova o escape de verdade é
  // que os caracteres perigosos do login viraram entidade: sem `<` cru não há
  // tag, e sem `"` cru o login não consegue fechar o atributo em que está.
  const login = 'a"><script>x</script>';
  const html = P.papelPicker(login, PEOPLE);
  // captura o VALOR do atributo em vez de recortar por posição: o slice amarrava
  // a asserção à ordem dos atributos no template, e se ela mudasse o recorte
  // sairia vazio e as duas asserções abaixo passariam à toa.
  const m = html.match(/data-login="([^"]*)"/);
  assert.ok(m, 'o atributo data-login precisa existir pra asserção significar algo');
  const atributo = m[1];
  assert.ok(!atributo.includes('<'), 'nenhum < cru no atributo: sem ele não se abre tag');
  assert.ok(!atributo.includes(login), 'o login não aparece cru em lugar nenhum');
  assert.match(html, /&lt;script&gt;/, 'ele aparece, mas escapado');
  assert.match(html, /&quot;/, 'a aspa virou entidade e não fecha o atributo');
});

test('domainMatrix: um seletor por domínio, com o nível certo marcado em cada', () => {
  const html = P.domainMatrix('alice', PEOPLE);
  assert.equal((html.match(/class="dom-level"/g) || []).length, P.DOMAIN_DEFS.length);
  assert.match(html, /data-domain="backend"[\s\S]*?<option value="autoridade" selected>/);
  assert.match(html, /data-domain="frontend"[\s\S]*?<option value="basico" selected>/);
});

test('domainMatrix: pessoa sem matriz marca "sem info" em todos os domínios', () => {
  const html = P.domainMatrix('bob', PEOPLE);
  assert.equal((html.match(/<option value="" selected>/g) || []).length, P.DOMAIN_DEFS.length);
});

test('reviewerLabel: pessoa é o próprio handle, sem enfeite', () => {
  assert.deepEqual(P.reviewerLabel('alice', {}), { label: 'alice', cls: '' });
});

test('reviewerLabel: time resolve o nome pelos candidatos da org', () => {
  const cands = { acme: { teams: [{ id: 'acme/plataforma', name: 'Plataforma' }] } };
  const r = P.reviewerLabel('acme/plataforma', cands);
  assert.equal(r.label, 'Plataforma (time)');
  assert.equal(r.cls, 'team');
});

test('reviewerLabel: sem candidatos carregados, o time degrada pro slug em vez de quebrar', () => {
  // é o estado real enquanto o fetch dos candidatos não voltou
  for (const cands of [null, undefined, {}, { outra: { teams: [] } }]) {
    assert.equal(P.reviewerLabel('acme/plataforma', cands).label, 'plataforma (time)');
  }
});

test('reviewerLabel: time enterprise é marcado como não pedível', () => {
  // o GitHub recusa esses; a UI precisa dizer isso em vez de deixar tentar
  const r = P.reviewerLabel('acme/ent:seguranca', {});
  assert.equal(r.ent, true);
  assert.equal(r.cls, 'bad');
  assert.match(r.label, /não pedível/);
});

test('chipHtml: leva o rótulo resolvido e o botão de remover com os data-attrs', () => {
  const cands = { acme: { teams: [{ id: 'acme/plataforma', name: 'Plataforma' }] } };
  const html = P.chipHtml('acme/plataforma', 'rev-def-x', 'data-org="acme"', cands);
  assert.match(html, /Plataforma \(time\)/);
  assert.match(html, /class="rev-chip team"/);
  assert.match(html, /class="rev-def-x" data-org="acme"/);
});

test('chipHtml: chip de enterprise ganha o title explicando por que não serve', () => {
  const html = P.chipHtml('acme/ent:seguranca', 'x', '', {});
  assert.match(html, /title="Time enterprise não pode ser reviewer/);
});

test('chatBadge: mostra a contagem, e some quando é zero ou não há chat', () => {
  assert.match(P.chatBadge('o/r#1', { 'o/r#1': { count: 3 } }), /<span class="count">3<\/span>/);
  assert.equal(P.chatBadge('o/r#1', { 'o/r#1': { count: 0 } }), '', 'zero não vira selo vazio');
  assert.equal(P.chatBadge('o/r#2', { 'o/r#1': { count: 3 } }), '');
});

test('chatBadge: sem mapa de chats devolve vazio em vez de quebrar', () => {
  // o app.js chama com STATE?.chats, que é undefined antes do primeiro SSE
  assert.equal(P.chatBadge('o/r#1', undefined), '');
  assert.equal(P.chatBadge('o/r#1', null), '');
});

/* As três abaixo são as portas de entrada: papelPicker, domainMatrix e chipHtml são
   exatamente as que o app.js chama, então são elas que recebem o parâmetro novo do
   chamador. Um chamador esquecido passa undefined, e é esse o único risco que a
   extração criou. Testar só as internas (personOf, reviewerLabel) deixaria o
   caminho de verdade descoberto. */

test('papelPicker: sem mapa de pessoas cai em "não marcado" em vez de quebrar', () => {
  for (const people of [undefined, null, {}]) {
    const html = P.papelPicker('alice', people);
    assert.match(html, /<option value="" selected>papel<\/option>/);
    assert.equal((html.match(/ selected/g) || []).length, 1, 'exatamente uma opção marcada');
  }
});

test('domainMatrix: sem mapa de pessoas marca "sem info" em todo domínio', () => {
  for (const people of [undefined, null, {}]) {
    const html = P.domainMatrix('alice', people);
    assert.equal((html.match(/<option value="" selected>/g) || []).length, P.DOMAIN_DEFS.length);
    assert.equal((html.match(/class="dom-level"/g) || []).length, P.DOMAIN_DEFS.length,
      'a matriz continua completa: some o nível, não a linha');
  }
});

test('chipHtml: sem candidatos o chip ainda sai, com o slug do time', () => {
  // estado real enquanto o fetch dos candidatos não voltou; o chip não pode sumir
  for (const cands of [undefined, null, {}]) {
    const html = P.chipHtml('acme/plataforma', 'rev-x', 'data-a="1"', cands);
    assert.match(html, /plataforma \(time\)/);
    assert.match(html, /class="rev-x" data-a="1"/, 'o botão de remover continua funcional');
  }
});

/* ---------- onda 5, segundo passo: os construtores da aba Consumo ----------
   O bloco já era puro: só montava string a partir do resumo que o engine manda.
   O que o prendia no app.js era a forma (cada um terminava atribuindo em
   `el.innerHTML`), não o conteúdo.

   O teste mais importante daqui é o mais bobo: EXECUTAR cada um. Ao mover o bloco
   eu deixei USAGE_KIND_COLOR e USAGE_PALETTE pra trás no app.js, e três funções
   passaram a referenciar constante inexistente. Nem `node --check` nem a suíte
   pegavam: é ReferenceError em runtime, e nada executava o código novo. Foi a
   comparação com o original que denunciou. Estes testes fecham essa porta. */

const usageDayKeysBackFake = (n) => P.usageDayKeysBack(n);

// Os nomes dos campos são os do engine (costUsd, inputTokens, outputTokens), não
// apelidos: usageMetricVal lê exatamente esses. Fixture com nome inventado passa
// pelo código sem erro e devolve zero, o que faria o teste medir o caminho vazio
// achando que mediu o cheio.
const bloco = (c, i, o) => ({ costUsd: c, inputTokens: i, outputTokens: o });
const USO = {
  series: usageDayKeysBackFake(14).map((day, i) => ({
    day, costUsd: 1.5 + i * 0.2, inputTokens: 6000 + i * 400, outputTokens: 6000 + i * 500, sessions: 3 + (i % 4),
  })),
  totals: { sessions: 42, costUsd: 22.5, inputTokens: 90000, outputTokens: 90000 },
  matrixKindNames: ['review', 'chat'], matrixModelNames: ['opus', 'sonnet'],
  // matrixSeries é por DIA e a matriz filtra pela janela (usageDayKeysBack), então
  // o dia precisa ser recente de verdade; data fixa cairia fora da janela
  matrixSeries: [{ day: P.usageDayKeysBack(1)[0], cells: { review: { opus: bloco(10, 4000, 5000) }, chat: { sonnet: bloco(1, 400, 400) } } }],
  budgets: [{ profileId: 'p1', label: 'Assinatura', spent: 12.5, limit: 100, blocked: false }],
  sessions: [{ id: 's1', at: Date.parse('2026-08-17T12:00:00Z'), kind: 'review', model: 'opus', costUsd: 0.42, inputTokens: 4000, outputTokens: 5000, ref: 'o/r#1', result: 'ok' }],
};

test('Consumo: os quatro construtores rodam e devolvem markup, com dados e sem', () => {
  // é o teste que teria pego a constante deixada pra trás
  for (const u of [USO, {}]) {
    assert.match(P.usageKpisHtml(u, 7), /</);
    const mtx = P.usageMatrixHtml(u, 'custo', 7);
    assert.equal(typeof mtx.html, 'string');
    assert.equal(typeof mtx.caption, 'string');
    assert.match(P.usageBudgetHtml(u), /</);
    assert.match(P.usageSessionsHtml(u), /</);
  }
});

test('Consumo: resumo vazio vira mensagem de vazio, não markup quebrado', () => {
  assert.match(P.usageMatrixHtml({}, 'custo', 7).html, /usage-empty/);
  assert.equal(P.usageMatrixHtml({}, 'custo', 7).caption, '', 'sem dado a legenda some junto');
  assert.match(P.usageBudgetHtml({}), /Nenhum perfil/);
  assert.match(P.usageSessionsHtml({}), /Nenhuma sessão/);
});

test('Consumo: perfil Codex explica tokens, custo zero e plano ChatGPT sem fingir orçamento em US$', () => {
  const html = P.usageBudgetHtml({ budgets: [{
    id: 'cx1', label: 'Codex ChatGPT', kind: 'codex', blocked: false,
    today: 0, sinceCutoff: 0, budgetDaily: 10, budgetTotal: null,
  }] });
  assert.match(html, /Codex · plano ChatGPT/);
  assert.match(html, /tokens das sessões autônomas/);
  assert.match(html, /US\$ 0,00/);
  assert.doesNotMatch(html, /usage-meter/, 'teto em dólar não se aplica ao plano ChatGPT');
});

test('usageMatrixHtml: a legenda acompanha a métrica escolhida', () => {
  // guarda-corpo antes das asserções: se o fixture parar de produzir matriz (nome
  // de campo errado, dia fora da janela), a função cai no early return, a legenda
  // volta '' e este teste passaria a medir o caminho VAZIO achando que mede o cheio.
  // Foi exatamente isso que aconteceu enquanto o fixture usava `cost` em vez de
  // `costUsd`: verde no caminho errado.
  const cheia = P.usageMatrixHtml(USO, 'custo', 7);
  assert.doesNotMatch(cheia.html, /usage-empty/, 'o fixture precisa produzir matriz de verdade');
  assert.match(cheia.caption, /custo estimado/);
  assert.match(P.usageMatrixHtml(USO, 'total', 7).caption, /tokens/);
});

test('usageColorsFor: cor fixa por tipo, cíclica nas outras dimensões', () => {
  assert.deepEqual(P.usageColorsFor('kind', ['review', 'chat']), ['var(--accent)', 'var(--ok)']);
  const muitos = P.usageColorsFor('model', ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  assert.equal(muitos.length, 7);
  assert.equal(muitos[6], muitos[0], 'a paleta cicla quando os nomes passam do tamanho dela');
});

test('usageColorsFor: _resto é sempre apagado, em qualquer dimensão', () => {
  // é registro antigo sem detalhamento: não pode parecer uma série de verdade
  assert.equal(P.usageColorsFor('kind', ['_resto'])[0], 'var(--faint)');
  assert.equal(P.usageColorsFor('model', ['_resto'])[0], 'var(--faint)');
});

test('fmtMoney e fmtUsageMetric: custo sai em dinheiro, o resto em contagem', () => {
  assert.match(P.fmtMoney(12.5), /12/);
  assert.equal(P.fmtUsageMetric(12.5, 'custo'), P.fmtMoney(12.5));
  assert.equal(P.fmtUsageMetric(12500, 'total'), P.fmtCompact(12500));
});

test('usageTooltipHtml: só entra na legenda a camada com valor', () => {
  const geo = { xs: [10, 50, 90, 130], y0: 5, y1: 100 };
  const html = P.usageTooltipHtml('2026-08-10', [3, 0], ['review', 'chat'], { review: 'Review' },
    ['#f00', '#0f0'], 'total', 2, geo, 300);
  assert.match(html, /Review/);
  assert.doesNotMatch(html, /chat/, 'camada zerada não polui o tooltip');
});

/* ---------- escape de valor em seletor de atributo ----------
   Achado pelo CodeQL ao mover o bloco de Consumo (js/incomplete-sanitization). O
   código era anterior à onda 5 e existia em QUATRO lugares, cada um repetindo o
   mesmo `.replace(/"/g, ...)` sem tratar a barra invertida. Não era teórico: id
   terminado em barra gerava [data-id="a\"], onde a barra escapa a aspa de
   fechamento, o seletor fica inválido e o clique não navega pra lugar nenhum,
   sem erro visível. */

test('escAttrSelector: aspa vira escapada e a barra invertida também', () => {
  assert.equal(P.escAttrSelector('normal'), 'normal');
  assert.equal(P.escAttrSelector('a"b'), 'a\\"b');
  assert.equal(P.escAttrSelector('a\\b'), 'a\\\\b');
});

test('escAttrSelector: id terminado em barra não engole a aspa de fechamento', () => {
  // o caso que o escape antigo quebrava
  const sel = `[data-id="${P.escAttrSelector('perfil\\')}"]`;
  assert.equal(sel, '[data-id="perfil\\\\"]');
  // a barra escapada vem em par, então a aspa final continua sendo delimitador
  const corpo = sel.slice('[data-id="'.length, -2);
  assert.equal(corpo.length % 2, 0, 'barras invertidas sempre em par antes do fecha-aspas');
});

test('escAttrSelector: aceita não-string sem quebrar', () => {
  assert.equal(P.escAttrSelector(42), '42');
  assert.equal(P.escAttrSelector(null), 'null');
  assert.equal(P.escAttrSelector(undefined), 'undefined');
});

test('nenhum seletor de atributo escapa só a aspa (a barra tem que vir junto)', () => {
  // trava a volta do padrão antigo nos dois arquivos de UI
  const fs2 = fs, path2 = path;
  for (const arq of ['app.js', 'pure.js']) {
    const src = fs2.readFileSync(path2.join(import.meta.dirname, '..', 'ui', arq), 'utf8');
    const soAspa = [...src.matchAll(/\[data-[\w-]+="\$\{String\([^)]*\)\.replace\(\/"\/g/g)];
    assert.deepEqual(soAspa.map(m => m[0]), [],
      `${arq}: use escAttrSelector em vez de escapar só a aspa`);
  }
});

/* ---------- onda 5, terceiro passo: o editor de reviewers ----------
   Diferente dos blocos anteriores, aqui não bastava um parâmetro: as funções liam
   SETE globais entre config, candidatos e três Sets de estado de tela. Todas só
   LEEM (quem muta os Sets são os handlers, que ficaram no app.js), então entra um
   ctx único, montado uma vez por renderização.

   A extração foi de baixo pra cima: primeiro as folhas, depois o renderOrgBlock
   que compõe todas elas. */

const CTX_REV = {
  defaults: { acme: ['alice', 'acme/plataforma'] },
  projects: { 'acme/api': ['bob'], 'acme/web': ['alice', 'acme/plataforma'] },
  cands: { acme: { members: ['alice', 'bob', 'eu'], teams: [{ id: 'acme/plataforma', name: 'Plataforma' }] } },
  candsLoaded: true,
  abertas: new Set(), pendentes: new Set(), expandidas: new Set(),
  prKeys: ['acme/api#1', 'acme/web#2', 'acme/site#3', 'outra/x#4'],
  owner2user: { acme: 'eu' }, ghUser: 'eu',
};

test('defaultFor e overrideFor: acham por chave exata e por minúscula', () => {
  assert.deepEqual(P.defaultFor('acme', CTX_REV), ['alice', 'acme/plataforma']);
  assert.deepEqual(P.defaultFor('ACME', CTX_REV), ['alice', 'acme/plataforma'], 'org vem do GitHub com a caixa do dono');
  assert.deepEqual(P.defaultFor('nao-existe', CTX_REV), [], 'sem padrão é lista vazia, nunca undefined');
  assert.deepEqual(P.overrideFor('acme/api', CTX_REV), ['bob']);
  assert.equal(P.overrideFor('nao/existe', CTX_REV), null, 'sem exceção é null, que é diferente de lista vazia');
});

test('defaultFor e overrideFor: ctx sem os mapas não quebra', () => {
  assert.deepEqual(P.defaultFor('acme', {}), []);
  assert.equal(P.overrideFor('acme/api', {}), null);
});

test('reposOfOrg: junta PRs, exceções e pendentes da org, sem repetir e ordenado', () => {
  const r = P.reposOfOrg('acme', CTX_REV);
  assert.deepEqual(r, ['acme/api', 'acme/site', 'acme/web']);
  assert.ok(!r.some(x => x.startsWith('outra/')), 'repo de outra org fica de fora');
});

test('reposOfOrg: repo pendente entra mesmo sem PR nem exceção salva', () => {
  // é o caso de criar exceção pra um projeto que ainda não apareceu em lugar nenhum
  const ctx = { ...CTX_REV, pendentes: new Set(['acme/novo']) };
  assert.ok(P.reposOfOrg('acme', ctx).includes('acme/novo'));
});

test('suggestDefault: sugere quem aparece em pelo menos metade das exceções', () => {
  // o limiar é ceil(n/2), então com 3 listas exige 2, e alice (em 2) passa
  const tres = { ...CTX_REV, defaults: {},
    projects: { 'a/1': ['alice'], 'a/2': ['alice'], 'a/3': ['bob'] }, prKeys: ['a/1#1', 'a/2#2', 'a/3#3'] };
  assert.deepEqual(P.suggestDefault('a', tres), ['alice'], 'bob, em 1 de 3, fica de fora');
});

test('suggestDefault: com exatamente 2 exceções o limiar vira 1 e tudo é sugerido', () => {
  // Aresta REAL do ceil(n/2), não intenção: com 2 listas o limiar é 1, então
  // qualquer reviewer que apareça numa delas entra na sugestão. Fica travado aqui
  // porque é surpreendente ao ler o nome da função, e porque mudar isso seria
  // decisão de produto, não refactor. O comportamento é idêntico ao de antes da
  // extração (provado na comparação com o original).
  assert.deepEqual(P.suggestDefault('acme', CTX_REV), ['acme/plataforma', 'alice', 'bob']);
});

test('suggestDefault: com menos de duas exceções não sugere nada', () => {
  const ctx = { ...CTX_REV, projects: { 'a/1': ['alice'] }, prKeys: ['a/1#1'] };
  assert.deepEqual(P.suggestDefault('a', ctx), []);
});

test('addControl: sem candidatos carregados mostra "carregando", não campo vazio', () => {
  const html = P.addControl('c', 'data-org="acme"', [], 'acme', { ...CTX_REV, candsLoaded: false });
  assert.match(html, /carregando/);
});

test('addControl: org sem membros enumeráveis cai no campo de digitar à mão', () => {
  // conta pessoal ou namespace sem org: o GitHub não lista membros
  const html = P.addControl('c', 'data-org="x"', [], 'x', CTX_REV);
  assert.match(html, /rev-manual/);
  assert.match(html, /digite um handle/);
});

test('addControl: não oferece quem já está na lista nem você mesmo', () => {
  const html = P.addControl('c', 'data-org="acme"', ['alice'], 'acme', CTX_REV);
  assert.doesNotMatch(html, /value="alice"/, 'já está na lista');
  assert.doesNotMatch(html, /value="eu"/, 'pedir review pra si mesmo não faz sentido');
  assert.match(html, /value="bob"/);
  assert.match(html, /value="acme\/plataforma"/);
});

test('renderOrgBlock: org com padrão mostra o padrão e as exceções', () => {
  const html = P.renderOrgBlock('acme', 'var(--accent)', CTX_REV);
  assert.match(html, /rev-chips/);
  assert.match(html, /acme\/api/, 'o repo com exceção aparece');
});

test('renderOrgBlock: lista colapsada só abre quando a org está expandida', () => {
  const fechada = P.renderOrgBlock('acme', 'var(--accent)', CTX_REV);
  const aberta = P.renderOrgBlock('acme', 'var(--accent)', { ...CTX_REV, expandidas: new Set(['acme']) });
  assert.doesNotMatch(fechada, /rev-folded-list/);
  assert.match(aberta, /rev-folded-list/);
  assert.match(fechada, /rev-fold-toggle/, 'o botão de abrir existe nos dois estados');
});

test('renderOrgBlock: org sem nada não quebra', () => {
  const html = P.renderOrgBlock('vazia', 'var(--muted)', { ...CTX_REV, defaults: {}, projects: {}, prKeys: [] });
  assert.equal(typeof html, 'string');
  assert.ok(html.length > 0);
});

/* ---------- onda 5, quarto passo: os cards do Radar ----------
   queueCardHtml e panoramaRowHtml são os dois maiores construtores de card que
   sobravam no app.js. O acctMark ficou lá: o ctx recebe o RESULTADO dele, porque
   ele depende de SCOPE, TWEAK e da tabela de contas, cadeia que não tem a ver com
   desenhar o card.

   O primeiro teste abaixo veio do ui-widgets.test.js, onde era regex sobre o texto
   do app.js. Agora que a função é pura, ele RENDERIZA e verifica a estrutura, que
   é o que o regex tentava aproximar. */

const MARK_T = { style: '--ac:#f00;', varStyle: '--ac:#f00;', dim: '', chip: '<span class="acct-chip">acme</span>', dot: '<span class="acct-dot"></span>', acct: { label: 'acme' } };
const PR_T = (o = {}) => ({ key: 'acme/api#7', url: 'https://github.com/acme/api/pull/7',
  title: 'Corrige o gate', author: 'alice', updatedAt: '2026-08-17T10:00:00Z', ...o });
const CTX_PANO = { mark: MARK_T, actions: {}, staleStates: {}, todasContas: true, chats: {}, running: new Set(), waiting: [] };

test('Panorama: o autor fica FORA da caixa que trunca o título', () => {
  // regressão do defeito de "Revisões recentes" (v2.39.0) reencontrado em 11/08:
  // com o @autor dentro do .pw-title (overflow hidden + ellipsis), título comprido
  // empurrava foto e login pra fora da tela, sem aviso. Era regex no ui-widgets;
  // agora renderiza.
  const html = P.panoramaRowHtml(PR_T({ title: 'T'.repeat(300) }), CTX_PANO);
  const linha = html.match(/<div class="pw-title">([\s\S]*?)<\/div>/);
  assert.ok(linha, 'a linha do título existe');
  assert.match(linha[1], /<span class="pw-title-txt"/, 'o texto do título tem elemento próprio, que é quem trunca');
  assert.match(linha[1], /person-mention/, 'o autor está na LINHA, irmão do texto');
  const txt = html.match(/<span class="pw-title-txt"[^>]*>([\s\S]*?)<\/span>/);
  assert.doesNotMatch(txt[1], /person-mention/, 'e nunca DENTRO da caixa que trunca');
});

test('cards do Radar: título e autor saem escapados', () => {
  // A asserção NÃO procura por uma tag específica: o CodeQL reprovou a primeira
  // versão deste teste (js/bad-tag-filter) porque /<script>/ não casa <SCRIPT>, ou
  // seja, um escape quebrado em caixa alta passaria batido. O que se verifica agora
  // é a propriedade de verdade: nenhum `<` do dado do usuário sobrevive cru, venha
  // ele em que caixa vier.
  const PAYLOADS = ['<img src=x onerror=1>', '<SCRIPT>x</SCRIPT>', '<ScRiPt>x</ScRiPt>', '"><b>', "'><b>"];
  for (const carga of PAYLOADS) {
    const mau = PR_T({ title: carga, author: carga });
    for (const html of [P.queueCardHtml(mau, { people: {}, mark: MARK_T }), P.panoramaRowHtml(mau, CTX_PANO)]) {
      assert.ok(!html.includes(carga), `a carga "${carga}" não pode aparecer crua`);
      assert.match(html, /&lt;|&quot;|&#39;/, 'e o que entrou saiu como entidade');
    }
  }
});

test('cards do Radar: o escape não depende da caixa da tag', () => {
  // trava explícita do que o CodeQL apontou
  for (const tag of ['<script>', '<SCRIPT>', '<ScRiPt>']) {
    const mau = PR_T({ title: tag });
    const html = P.panoramaRowHtml(mau, CTX_PANO);
    assert.doesNotMatch(html, new RegExp(tag.replace(/[<>]/g, m => '\\' + m), 'i'),
      `${tag} escapado em qualquer caixa`);
  }
});

test('queueCardHtml: rascunho e re-pedido ganham selo; PR comum não', () => {
  const limpo = P.queueCardHtml(PR_T(), { people: {}, mark: MARK_T });
  assert.doesNotMatch(limpo, /rascunho|pedida de novo/);
  assert.match(P.queueCardHtml(PR_T({ isDraft: true }), { people: {}, mark: MARK_T }), /rascunho/);
  assert.match(P.queueCardHtml(PR_T({ reRequested: true }), { people: {}, mark: MARK_T }), /pedida de novo/);
});

test('queueCardHtml: sem autor não renderiza o seletor de papel', () => {
  const html = P.queueCardHtml(PR_T({ author: '' }), { people: {}, mark: MARK_T });
  assert.doesNotMatch(html, /papel-level/, 'PR sem autor não tem papel a marcar');
});

test('panoramaRowHtml: a precedência do botão é rodando > fila > revisar', () => {
  const rodando = P.panoramaRowHtml(PR_T(), { ...CTX_PANO, running: new Set(['acme/api#7']), waiting: ['acme/api#7'] });
  assert.match(rodando, /Revisando…/, 'rodando ganha da fila');
  const naFila = P.panoramaRowHtml(PR_T(), { ...CTX_PANO, waiting: ['acme/api#7'] });
  assert.match(naFila, /Na fila \(1\)/);
  const livre = P.panoramaRowHtml(PR_T(), CTX_PANO);
  assert.match(livre, /act-review/, 'sem nada em curso, dá pra revisar');
});

test('panoramaRowHtml: estado resolvido troca o botão por rótulo', () => {
  const pedido = P.panoramaRowHtml(PR_T(), { ...CTX_PANO, actions: { 'acme/api#7': { kind: 'request_changes' } } });
  assert.match(pedido, /aguardando o autor/);
  assert.doesNotMatch(pedido, /act-review/, 'já pedi mudanças: não oferece revisar de novo');
  const pendente = P.panoramaRowHtml(PR_T(), { ...CTX_PANO, actions: { 'acme/api#7': { kind: 'pending' } } });
  assert.match(pendente, /aguardando você/);
});

test('panoramaRowHtml: commit novo depois da review reabre o botão', () => {
  const base = { ...CTX_PANO, actions: { 'acme/api#7': { kind: 'approve' } } };
  assert.doesNotMatch(P.panoramaRowHtml(PR_T(), base), /act-review/, 'aprovado e parado: nada a fazer');
  const stale = P.panoramaRowHtml(PR_T(), { ...base, staleStates: { 'acme/api#7': true } });
  assert.match(stale, /act-review/, 'entrou commit novo: revisar de novo');
  assert.match(stale, /commit novo/, 'e o tooltip diz por quê');
});

test('panoramaRowHtml: o selo da conta só aparece no escopo "todas"', () => {
  assert.match(P.panoramaRowHtml(PR_T(), CTX_PANO), /acct-chip/);
  const umaConta = P.panoramaRowHtml(PR_T({ mine: true }), { ...CTX_PANO, todasContas: false });
  assert.doesNotMatch(umaConta, /acct-chip/);
  assert.match(umaConta, /sua revisão/, 'numa conta só, o que importa é ser seu');
});

/* ---------- onda 5, quinto passo: o painel Sistema (perfis e contas) ----------
   Dois pedaços ficaram no app.js de propósito, porque são DOM e não markup: o guarda
   de foco (não reconstruir enquanto a pessoa digita num campo do bloco) e o
   `hint.hidden` do fim dos perfis, que o listener do seletor desfaz. */

const CTX_SIS = {
  config: { claudeProfiles: [{ id: 'p1', label: 'Pessoal', dir: '/home/x/.claude' }], claudeProfileId: 'p1' },
  usage: { budgets: [] },
  doctor: { claudeAuth: [{ id: 'p1', ready: true, account: 'alice' }, { id: '', ready: true }] },
  ehWin: true,
  accounts: [{ user: 'alice', owners: ['acme'], tokenOk: true }],
  acct: { alice: { label: 'Pessoal', color: '#f80' } },
};

test('claudeAuthBadge: acha o perfil, cai no padrão da máquina, e some sem dado', () => {
  assert.match(P.claudeAuthBadge('p1', CTX_SIS), /alice/);
  assert.match(P.claudeAuthBadge('', CTX_SIS), /a-claude/, 'id vazio acha a entrada do padrão');
  assert.equal(P.claudeAuthBadge('p1', { doctor: {} }), '', 'sem doctor não inventa selo');
});

test('claudeAuthBadge: perfil Codex mostra a causa real quando o login ChatGPT nao confirmou', () => {
  const ctx = {
    ...CTX_SIS,
    doctor: {
      codexChatGPT: false,
      codexLoginDetail: 'Logged in using API key',
      claudeAuth: [{ id: 'codex', label: 'Codex', codexMode: true, ready: true }]
    }
  };
  const html = P.claudeAuthBadge('codex', ctx);
  assert.match(html, /SEM CODEX/);
  assert.match(html, /Logged in using API key/);
});

test('claudeAuthBadge: perfil Codex confirma ChatGPT quando o doctor confirma', () => {
  const ctx = {
    ...CTX_SIS,
    doctor: {
      codexChatGPT: true,
      codexLoginDetail: 'Logged in using ChatGPT',
      claudeAuth: [{ id: 'codex', label: 'Codex', codexMode: true, ready: true }]
    }
  };
  assert.match(P.claudeAuthBadge('codex', ctx), /Codex ChatGPT/);
});

test('painel Sistema: os três construtores desenham com ctx cheio e com ctx vazio', () => {
  const vazio = { config: {}, usage: {}, doctor: {}, accounts: [], acct: {}, ehWin: false };
  for (const ctx of [CTX_SIS, vazio]) {
    assert.equal(typeof P.claudeAuthBadge('x', ctx), 'string');
    assert.match(P.claudeProfilesHtml(ctx), /^\s*(<|$)/, 'perfis devolve markup ou vazio');
    assert.equal(typeof P.accountsManagerHtml(ctx), 'string');
  }
});

test('accountsManagerHtml: sem contas mostra o vazio, com conta mostra a linha', () => {
  assert.match(P.accountsManagerHtml({ ...CTX_SIS, accounts: [] }), /Nenhuma conta configurada/);
  assert.match(P.accountsManagerHtml(CTX_SIS), /acct-color/);
});

test('accountsManagerHtml: conta silenciada muda rótulo e classe do botão', () => {
  const mudo = { ...CTX_SIS, accounts: [{ user: 'alice', owners: ['acme'], muted: true }] };
  const html = P.accountsManagerHtml(mudo);
  assert.match(html, /silenciada/, 'o estado aparece no texto de autenticação');
});

test('claudeProfilesHtml: sem perfil e com diretório legado oferece a migração', () => {
  const legado = { ...CTX_SIS, config: { claudeProfiles: [], claudeConfigDir: '/home/x/.claude' } };
  assert.match(P.claudeProfilesHtml(legado), /primeiro perfil/);
  assert.doesNotMatch(P.claudeProfilesHtml(CTX_SIS), /primeiro perfil/, 'com perfil salvo, some');
});

test('claudeProfilesHtml: perfil de chave de API mostra os campos de teto', () => {
  const api = { ...CTX_SIS, config: { claudeProfiles: [{ id: 'p2', label: 'API', kind: 'apikey', apiKey: 'k', budgetDaily: 10 }], claudeProfileId: 'p2' } };
  const html = P.claudeProfilesHtml(api);
  assert.match(html, /cp-budget-daily/);
  assert.match(html, /value="10"/, 'o teto salvo aparece preenchido');
});

test('claudeProfilesHtml: perfil OpenRouter mostra campos de chave e hint do Skin', () => {
  const ctx = {
    ...CTX_SIS,
    config: {
      claudeProfiles: [{
        id: 'or', label: 'OR', kind: 'openrouter', apiKey: 'sk-or-1',
        baseUrl: 'https://openrouter.ai/api',
      }],
      claudeProfileId: 'or',
    },
    doctor: { claudeAuth: [{ id: 'or', label: 'OR', openrouterMode: true, ready: true }] },
  };
  const html = P.claudeProfilesHtml(ctx);
  assert.match(html, /OpenRouter/);
  assert.match(html, /data-kind="openrouter"/);
  assert.doesNotMatch(html, /cp-login" data-id="or"/, 'OpenRouter não oferece login OAuth');
  assert.match(html, /Anthropic Skin/);
});

test('claudeAuthBadge: perfil OpenRouter pronto', () => {
  const ctx = {
    ...CTX_SIS,
    doctor: { claudeAuth: [{ id: 'or', label: 'OR', openrouterMode: true, ready: true }] },
  };
  assert.match(P.claudeAuthBadge('or', ctx), /OpenRouter/);
});

test('claudeProfilesHtml: perfil Codex tambem oferece abrir sessao de login', () => {
  const ctx = {
    ...CTX_SIS,
    config: { claudeProfiles: [{ id: 'codex', label: 'Codex', kind: 'codex' }], claudeProfileId: 'codex' },
    doctor: { codexChatGPT: false, claudeAuth: [{ id: 'codex', label: 'Codex', codexMode: true, ready: true }] },
  };
  const html = P.claudeProfilesHtml(ctx);
  assert.match(html, /class="btn sm cp-login" data-id="codex"/);
  assert.match(html, /Abrir sessão de login/);
});

/* ---------- onda 5, sexto passo: o banner do topo ----------
   Os três avisos (sem conta, conta sem token, falha na última checagem) são decisão de
   TEXTO; quem esconde e mostra o elemento continua no app.js.

   A precedência importa e por isso está travada aqui: "sem conta" ganha de "sem token"
   (uma conta que não existe não pode estar sem token), e `starting` cala os dois,
   porque durante o boot ainda não se sabe nada e o aviso seria mentira. */

test('banner: sem conta pede gh auth login, e ganha de qualquer outro aviso', () => {
  const s = { account: { user: '', tokenOk: false }, status: 'error', error: 'algo' };
  assert.match(P.statusBannerHtml(s), /Nenhuma conta do GitHub/);
});

test('banner: conta sem token nomeia a conta, escapada', () => {
  const s = { account: { user: 'a<b>&"x', tokenOk: false }, status: 'idle', error: null };
  const html = P.statusBannerHtml(s);
  assert.match(html, /não está autenticada/);
  assert.doesNotMatch(html, /<b>&"x/, 'o login vai escapado, não vira markup');
});

test('banner: durante o boot (starting) nenhum aviso de conta aparece', () => {
  // ainda não se sabe nada; avisar seria mentira
  for (const acc of [{ user: '', tokenOk: false }, { user: 'alice', tokenOk: false }]) {
    assert.equal(P.statusBannerHtml({ account: acc, status: 'starting', error: null }), '');
  }
});

test('banner: falha da checagem só aparece com status de erro E mensagem', () => {
  const ok = { account: { user: 'alice', tokenOk: true } };
  assert.match(P.statusBannerHtml({ ...ok, status: 'error', error: 'ECONNRESET' }), /Falha na última checagem/);
  assert.equal(P.statusBannerHtml({ ...ok, status: 'error', error: '' }), '', 'erro sem mensagem não vira banner vazio');
  assert.equal(P.statusBannerHtml({ ...ok, status: 'idle', error: 'resto antigo' }), '', 'mensagem velha sem status de erro não ressuscita');
});

test('banner: tudo em ordem devolve vazio (o app esconde o elemento)', () => {
  assert.equal(P.statusBannerHtml({ account: { user: 'alice', tokenOk: true }, status: 'idle', error: null }), '');
});

/* ---------- onda 5, sexto passo: o vazio da fila ----------
   Vazio bom CONFIRMA o que o app fez, em vez de só dizer que não tem nada. É o texto
   que a pessoa lê quando abre o Radar e não tem PR esperando, então a contagem e o
   plural precisam estar certos. */

test('vazio da fila: sem aprovação hoje, não inventa contagem', () => {
  const html = P.queueEmptyOkHtml({ aprovados: 0, owners: ['acme'], intervalSeconds: 300 });
  assert.match(html, /O Farol monitora/);
  assert.doesNotMatch(html, /aprovou/, 'zero não vira "aprovou 0"');
});

test('vazio da fila: singular e plural de PR e de minuto', () => {
  const um = P.queueEmptyOkHtml({ aprovados: 1, owners: ['acme'], intervalSeconds: 60 });
  assert.match(um, /aprovou 1 PR sozinho/);
  assert.match(um, /a cada 1 minuto\b/);
  const varios = P.queueEmptyOkHtml({ aprovados: 3, owners: ['acme'], intervalSeconds: 300 });
  assert.match(varios, /aprovou 3 PRs sozinho/);
  assert.match(varios, /a cada 5 minutos/);
});

test('vazio da fila: sem orgs configuradas usa o texto genérico', () => {
  assert.match(P.queueEmptyOkHtml({ aprovados: 0, owners: [] }), /as organizações configuradas/);
});

test('vazio da fila: nome de org sai escapado', () => {
  const html = P.queueEmptyOkHtml({ aprovados: 0, owners: ['a<b>&"x'] });
  assert.doesNotMatch(html, /<b>&"x/, 'org com HTML não vira markup');
  assert.match(html, /&lt;b&gt;/);
});

test('vazio da fila: sem intervalo cai no padrão de 5 minutos', () => {
  assert.match(P.queueEmptyOkHtml({ aprovados: 0, owners: [] }), /a cada 5 minutos/);
});

/* ---------- onda 5, sétimo passo: o diagnóstico ----------
   Este é o único texto do Farol que alguém lê FORA do Farol: a pessoa clica em "gerar
   diagnóstico", cola no chat e espera socorro. Estava sem um único teste. O que importa
   aqui não é o layout — é que o relatório diga a verdade e não leve segredo junto. */

const DIAG_BASE = {
  status: 'ok',
  app: { version: '2.48.3', platform: 'win32' },
  doctor: { node: 'v24', gh: 'gh 2.0', claude: '/bin/claude', ghAuth: true, workspace: '/w' },
  paths: { home: '/h', workspace: '/w' },
  config: { intervalSeconds: 300 },
  queue: [], panorama: [], myPRs: [], decisions: { pending: [] }, activeSessions: [],
};

test('diagnóstico: relatório vazio ainda traz versão, status e o aviso de sigilo', () => {
  const t = P.diagnosticsText({ s: DIAG_BASE, agora: '19/08/2026' });
  assert.match(t, /versão: v2\.48\.3 · plataforma: win32 · node: v24/);
  assert.match(t, /gerado: 19\/08\/2026/);
  assert.match(t, /não contém tokens nem senhas/);
});

test('diagnóstico: sem estado nenhum não explode, e admite o que não sabe', () => {
  const t = P.diagnosticsText();
  assert.match(t, /versão: v\?/);
  assert.match(t, /\(nenhuma\)/);
  assert.match(t, /\(sem falhas registradas\)/);
});

test('diagnóstico: ferramenta ausente é dita em voz alta, não omitida', () => {
  const s = { ...DIAG_BASE, doctor: { ...DIAG_BASE.doctor, gh: '', claude: '', ghAuth: false } };
  const t = P.diagnosticsText({ s });
  assert.match(t, /gh: NAO ENCONTRADO/);
  assert.match(t, /claude: NAO ENCONTRADO/);
  assert.match(t, /autenticada no gh: NAO/);
});

test('diagnóstico: conta sem token e conta silenciada aparecem marcadas', () => {
  const s = { ...DIAG_BASE, accounts: [
    { user: 'ana', primary: true, label: 'Pessoal', kind: 'pat', owners: ['acme'], tokenOk: true },
    { user: 'bia', tokenOk: false, muted: true },
  ] };
  const t = P.diagnosticsText({ s });
  assert.match(t, /Contas \(2\):/);
  assert.match(t, /@ana \[primária\].*orgs=acme · token=ok/);
  assert.match(t, /@bia.*token=NAO · silenciada/);
});

test('diagnóstico: assinatura Claude sem login é denunciada com o conserto junto', () => {
  const s = { ...DIAG_BASE, doctor: { ...DIAG_BASE.doctor, claudeAuth: [{ label: 'p', configDir: '/x', ready: false }] } };
  assert.match(P.diagnosticsText({ s }), /SEM LOGIN \(rode: claude login nesse dir\)/);
});

test('diagnóstico: log traz contagem de eventos, de grupos e de linhas', () => {
  const grupos = [{ id: 'a', count: 3 }, { id: 'b', count: 4 }];
  const t = P.diagnosticsText({ s: DIAG_BASE, grupos, log: ['x', 'y', 'z'] });
  assert.match(t, /Log de falhas \(7 evento\(s\) em 2 grupo\(s\), 3 linha\(s\)\)/);
  assert.match(t, /Resumo:/);
});

test('diagnóstico: log longo é cortado no teto e o texto diz quanto mostrou', () => {
  const log = Array.from({ length: 90 }, (_, i) => 'linha ' + i);
  const t = P.diagnosticsText({ s: DIAG_BASE, log, tail: 40 });
  assert.match(t, /Detalhe \(as 40 linhas mais recentes\)/);
});

test('diagnóstico: atualização disponível e em dia se descrevem diferente', () => {
  const dia = P.diagnosticsText({ s: { ...DIAG_BASE, update: { current: '2.48.3', available: false, channel: 'release' } } });
  assert.match(dia, /atualização: v2\.48\.3 · na mais recente \(release\)/);
  const nova = P.diagnosticsText({ s: { ...DIAG_BASE, update: { current: '2.48.3', available: true, sourceVersion: '2.49.0', channel: 'branch', repo: 'a/b', note: 'beta' } } });
  assert.match(nova, /v2\.49\.0 DISPONÍVEL \(branch a\/b\) · beta/);
});

test('diagnóstico: NÃO leva token, senha nem cabeçalho de autorização', () => {
  const s = {
    ...DIAG_BASE,
    accounts: [{ user: 'ana', tokenOk: true, token: 'ghp_SEGREDO123', password: 'senha!' }],
    config: { ...DIAG_BASE.config, githubToken: 'ghp_OUTRO', pat: 'ghp_MAIS' },
    doctor: { ...DIAG_BASE.doctor, authHeader: 'Bearer xyz' },
  };
  const t = P.diagnosticsText({ s, log: ['Authorization: Bearer xyz'], grupos: [] });
  for (const segredo of ['ghp_SEGREDO123', 'ghp_OUTRO', 'ghp_MAIS', 'senha!'])
    assert.ok(!t.includes(segredo), `vazou ${segredo} no diagnóstico`);
});

/* As duas invariantes que moravam em ui-widgets.test.js como casamento de regex contra o
   corpo de buildDiagnostics. Aqui elas olham a SAÍDA, que é o que de fato importa. */

test('diagnóstico: o Resumo agrupado vem ANTES do despejo cru', () => {
  const t = P.diagnosticsText({ s: DIAG_BASE, grupos: [{ id: 'a', count: 2 }], log: ['x', 'y'] });
  assert.ok(t.indexOf('  Resumo:') < t.indexOf('  Detalhe'), 'resumo antes do detalhe');
});

test('diagnóstico: log cru nunca sai inteiro, só o rabo limitado', () => {
  const log = Array.from({ length: 159 }, (_, i) => 'linha ' + i);
  const t = P.diagnosticsText({ s: DIAG_BASE, log, tail: 40 });
  assert.ok(!t.includes('linha 0'), 'a linha mais antiga das 159 não entra');
  assert.ok(t.includes('linha 158'), 'a mais recente entra');
  assert.match(t, /159 linha\(s\)/, 'mas o total continua sendo dito');
});

/* ---------- onda 5, sétimo passo: o cartão da sessão ao vivo ----------
   Os data-attributes deste cartão são contrato: o app volta neles depois pra atualizar
   tempo, modelo e progresso sem redesenhar. Perder um `data-id` não quebra o layout —
   quebra a atualização, em silêncio, e a barra fica parada pra sempre. */

test('cartão de sessão: os ganchos de atualização existem todos', () => {
  const html = P.sessionCardHtml({ id: 'abc', label: 'acme#12', startedAt: 1755600000000 }, 'preparo');
  for (const cls of ['session-card', 'session-stage', 'session-model', 'session-agents', 'session-elapsed', 'sess-progress', 'stage-flow', 'activity-feed'])
    assert.match(html, new RegExp(`class="[^"]*${cls}`), `sumiu o gancho .${cls}`);
  assert.equal((html.match(/data-id="abc"/g) || []).length, 6, 'todo gancho carrega o id da sessão');
  // metade do guarda de B13 (o rótulo de estágio congelava no primeiro paint): sem o
  // data-started aqui, o tickElapsed do app.js não tem de onde recalcular a idade.
  assert.match(html, /class="session-stage" data-started="1755600000000"/);
  assert.match(html, /class="session-elapsed" data-started="1755600000000"/);
});

test('cartão de sessão: sem PR não inventa link; com PR, abre em aba nova e sem referrer', () => {
  assert.doesNotMatch(P.sessionCardHtml({ id: 'a', label: 'x' }, ''), /<a href/);
  const com = P.sessionCardHtml({ id: 'a', label: 'x', pr: { url: 'https://github.com/a/b/pull/1' } }, '');
  assert.match(com, /target="_blank" rel="noreferrer"/);
});

test('cartão de sessão: o dono do PR aparece com foto e link, pelo personMention', () => {
  const html = P.sessionCardHtml({ id: 'a', label: 'x', pr: { url: 'https://github.com/a/b/pull/1', author: 'gabrielk5' } }, '');
  assert.match(html, /class="session-author">PR de <a class="person-mention"/, 'a menção sai do helper central, com a foto junto');
  assert.match(html, /github\.com\/gabrielk5\.png/, 'a foto é a do GitHub de quem escreveu o PR');
  assert.doesNotMatch(P.sessionCardHtml({ id: 'a', label: 'x', pr: { url: 'https://github.com/a/b/pull/1' } }, ''), /session-author/,
    'sem autor conhecido não sobra rótulo órfão ("PR de" sem ninguém)');
});

test('cartão de sessão: botão Cancelar só aparece quando dá pra cancelar', () => {
  assert.doesNotMatch(P.sessionCardHtml({ id: 'a', label: 'x' }, ''), /act-cancel/);
  assert.match(P.sessionCardHtml({ id: 'a', label: 'x', cancellable: true }, ''), /act-cancel" data-id="a"/);
});

test('cartão de sessão: id e label hostis não viram markup nem escapam do atributo', () => {
  const html = P.sessionCardHtml({ id: 'a"><b>', label: '<script>alert(1)</script>', pr: { url: 'x" onerror="y' } }, '');
  assert.ok(!html.includes('<script>'), 'label não vira tag');
  assert.ok(!html.includes('a"><b>'), 'id não escapa do atributo');
  // o payload sobra como TEXTO inerte; o que não pode é a aspa crua que o faria virar
  // atributo de verdade. Testar a ausência da string "onerror=" testaria a coisa errada.
  assert.ok(!html.includes('onerror="'), 'url não consegue fechar o atributo e abrir outro');
  assert.match(html, /href="x&quot; onerror=&quot;y"/, 'a aspa da url sai escapada');
});

/* ---------- site do Jira: a recusa é da TELA, o servidor só descarta ----------
   Medido no fonte: baseUrl fora de forma faz normalizeBaseUrl devolver '' e o
   parseJiraSites derrubar o site INTEIRO (rótulo, orgs e prefixos junto), com a
   tela dizendo "Configurações salvas". E projectKeys vazio faz o extractCardKeys
   aceitar qualquer PALAVRA-NUMERO do título ('feat: normaliza UTF-8 e SHA-256 no
   ISO-8601 (AB-7)' devolve UTF-8 primeiro), o Farol pedir esse "card" ao Jira,
   tomar 404 e o PR perder o auto-approve por uma falha que ele inventou. */
test('jiraBaseUrlProblema aceita origem pura https e recusa o resto', () => {
  assert.equal(P.jiraBaseUrlProblema('https://empresa.exemplo.com'), '');
  assert.equal(P.jiraBaseUrlProblema('  https://empresa.exemplo.com/  '), '', 'barra final e espaço são normalizados, como no servidor');
  assert.ok(P.jiraBaseUrlProblema('empresa.exemplo.com'), 'sem esquema o servidor apagaria o site inteiro');
  assert.ok(P.jiraBaseUrlProblema('http://empresa.exemplo.com'), 'http ofereceria a credencial em texto claro');
  assert.ok(P.jiraBaseUrlProblema('https://empresa.exemplo.com@evil.example'), 'userinfo troca o host real da requisição');
  assert.ok(P.jiraBaseUrlProblema('https://empresa.exemplo.com/jira'), 'caminho muda o destino da chamada');
  assert.ok(P.jiraBaseUrlProblema('https://empresa.exemplo.com/?a=1'), 'query muda o destino da chamada');
  assert.ok(P.jiraBaseUrlProblema(''), 'vazio não é URL');
});

test('jiraPrefixosProblema exige ao menos um prefixo de projeto', () => {
  assert.equal(P.jiraPrefixosProblema(['ABC']), '');
  assert.ok(P.jiraPrefixosProblema([]));
  assert.ok(P.jiraPrefixosProblema(['  ']));
  assert.ok(P.jiraPrefixosProblema(null));
});

test('a tela do Jira valida no cadastro E na edição, e não deixa credencial órfã', () => {
  const APP = fs.readFileSync(path.join(import.meta.dirname, '..', 'ui', 'app.js'), 'utf8');
  const add = APP.slice(APP.indexOf("t.id === 'btnJiraSiteAdd'"), APP.indexOf("t.classList.contains('js-site-remove')"));
  assert.match(add, /jiraBaseUrlProblema\(baseUrl\) \|\| jiraPrefixosProblema\(projectKeys\)/, 'cadastro valida antes de salvar');
  const edicao = APP.slice(APP.indexOf('function jiraEdicaoProblema'), APP.indexOf('function jiraCampoSalvo'));
  assert.match(edicao, /jiraBaseUrlProblema/);
  assert.match(edicao, /jiraPrefixosProblema/);
  const remover = APP.slice(APP.indexOf("t.classList.contains('js-site-remove')"), APP.indexOf("t.classList.contains('js-cred-save')"));
  assert.match(remover, /\/api\/jira\/credential\/remove/, 'remover o site tem que apagar a credencial dele antes');
  assert.ok(remover.indexOf('/api/jira/credential/remove') < remover.indexOf('saveJiraSites'), 'a credencial sai antes de o site sumir da lista');
});

/* Configuração de EXECUÇÃO (25/08/2026). Terceira pergunta do Diagnóstico, depois
   de "consegue rodar?" (doctor) e "vai achar algo?" (operationChecks): consegue
   ABRIR a sessão? No Farol em Android (Termux + proot Debian) o login padrão é
   root, o Claude Code recusa `--dangerously-skip-permissions` com uid 0, e toda
   revisão autônoma morria no spawn com os checks todos verdes. */
test('runtimeChecks: root é falha visível, com o motivo e a saída no detalhe', () => {
  const [c] = P.runtimeChecks({ root: true });
  assert.equal(c.ok, false);
  assert.match(c.detail, /root/i, 'o detalhe nomeia a causa');
  assert.match(c.detail, /skip-permissions/i, 'e a flag exata, que é o que aparece no log');
  assert.match(c.detail, /não-root/i, 'e a saída, senão o check só reclama');
  assert.equal(c.goto, undefined, 'nenhuma tela do app conserta isso: clique morto é pior que texto');
});

test('runtimeChecks: sem root não inventa linha (Windows nem tem uid)', () => {
  assert.deepEqual(P.runtimeChecks({ root: false }), []);
  assert.deepEqual(P.runtimeChecks({}), []);
  assert.deepEqual(P.runtimeChecks(null), [], 'doctor ainda não carregado não pode derrubar a tela');
  assert.deepEqual(P.runtimeChecks(undefined), []);
});

test('runtimeChecks: perfil Codex aparece na Visao geral com CLI e login separados', () => {
  const checks = P.runtimeChecks(
    { root: false, codex: 'codex-cli 0.150.0', codexChatGPT: true, codexLoginDetail: 'Logged in using ChatGPT' },
    { claudeProfiles: [{ id: 'codex', label: 'Codex', kind: 'codex' }] }
  );
  assert.equal(checks.length, 2);
  assert.deepEqual(checks.map(c => [c.label, c.ok]), [['Codex CLI', true], ['Login Codex', true]]);
  assert.ok(checks.every(c => c.goto === 'sys:plans:#claudeProfilesManager'));
});

test('runtimeChecks: perfil Codex denuncia quando o app nao acha o codex do terminal', () => {
  const checks = P.runtimeChecks(
    { root: false, codex: null, codexChatGPT: false, codexLoginDetail: 'codex login status falhou (código 1)' },
    { claudeProfiles: [{ id: 'codex', label: 'Codex', kind: 'codex' }] }
  );
  assert.equal(checks[0].ok, false);
  assert.match(checks[0].detail, /PATH/);
  assert.equal(checks[1].ok, false);
  assert.match(checks[1].detail, /codex login status falhou/);
});

/* ---------- quarta porta: a UI não reconstrói a autoridade do merge ----------
   O `canMerge` do app.js era `!!(a && a.approvable)`, uma quarta cópia da regra que
   o engine acabou de centralizar. A decisão saiu do render (que não tem harness) e
   virou função pura, pra ficar travada em teste em vez de depender de disciplina. */

test('canMergeSelfAnalysis decide por quality, nunca por approvable', () => {
  const q = (status) => ({ quality: { status, reasons: [] } });
  assert.equal(P.canMergeSelfAnalysis({ approvable: true, ...q('inconclusive') }), false,
    'approvable true não libera quando a evidência não fecha');
  assert.equal(P.canMergeSelfAnalysis({ approvable: false, ...q('eligible') }), true,
    'approvable false não impede: a UI também deixou de tratar o parecer como autoridade');
  assert.equal(P.canMergeSelfAnalysis({ approvable: true, ...q('ineligible') }), false);
  assert.equal(P.canMergeSelfAnalysis({ approvable: true }), false, 'sem quality, fecha');
  assert.equal(P.canMergeSelfAnalysis(null), false);
  assert.equal(P.canMergeSelfAnalysis(undefined), false);
});

test('qualityReasonLabel traduz código em frase; o engine nunca escreve copy', () => {
  assert.equal(P.qualityReasonLabel('COVERAGE_UNKNOWN'), 'Sem cobertura comprovada');
  assert.equal(P.qualityReasonLabel('CARD_UNKNOWN'), 'Atendimento ao card não comprovado');
  assert.equal(P.qualityReasonLabel('BLOCKER_PRESENT'), 'A análise apontou bloqueios');
  // código desconhecido não pode virar buraco na tela nem vazar o código cru
  assert.equal(P.qualityReasonLabel('COISA_NOVA'), 'Requisito de qualidade não atendido');
  assert.equal(P.qualityReasonLabel(''), 'Requisito de qualidade não atendido');
});

test('qualityBlockTitle lidera com a frase principal e lista os detalhes', () => {
  const titulo = P.qualityBlockTitle({
    status: 'inconclusive',
    reasons: [{ code: 'COVERAGE_UNKNOWN' }, { code: 'CARD_UNKNOWN' }]
  });
  assert.match(titulo, /não comprova qualidade suficiente/);
  assert.match(titulo, /Sem cobertura comprovada/);
  assert.match(titulo, /Atendimento ao card não comprovado/);
  assert.doesNotMatch(titulo, /COVERAGE_UNKNOWN/, 'código de máquina não vira copy');
});

test('os códigos do P0b também têm frase; nenhum vaza cru na tela', () => {
  const codigos = ['EVIDENCE_STALE', 'COVERAGE_LIMITS_MALFORMED', 'BLOCKERS_UNKNOWN'];
  for (const code of codigos) {
    const frase = P.qualityReasonLabel(code);
    assert.notEqual(frase, 'Requisito de qualidade não atendido', `${code} precisa de frase própria`);
    assert.doesNotMatch(frase, /[A-Z]{4,}_/, 'a frase não pode carregar o código');
  }
});
