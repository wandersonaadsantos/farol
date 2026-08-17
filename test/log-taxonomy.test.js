// lib/log-taxonomy.js: a FONTE ÚNICA de classificação de falha do Farol.
//
// Por que este módulo existe: hoje a classificação está duplicada. Em
// lib/engine/review.js quatro regexes inline (limitErr/netErr/toolErr/authErr)
// decidem se a revisão volta pra fila ou estaciona, e o painel de Diagnóstico
// só despeja a linha crua do farol.log sem entender nada. São dois lugares
// olhando pro mesmo texto com regras diferentes. Este módulo passa a servir os
// dois, e estes testes travam o contrato antes de qualquer migração.
//
// As mensagens usadas aqui NÃO são inventadas: saíram do farol.log real de
// produção (~/.farol/workspace/state/farol.log, 159 linhas, 03 a 07/08/2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLASSES, classify, resetAtFrom, parseLine, triage } from '../lib/log-taxonomy.js';

/* ---------- mensagens REAIS de produção (fixtures compartilhadas) ---------- */

const MSG = {
  limite: "sessão retornou erro: You've hit your weekly limit · resets 9pm (America/Sao_Paulo)",
  assinatura: 'sessão retornou erro: Your organization has disabled Claude subscription access for Claude Code · Use an Anthropic API key instead, or ask your admin to enable access',
  credencial: 'sessão retornou erro: Invalid API key · Fix external API key',
  credito: 'sessão retornou erro: API Error: 402 OpenRouter returned 402: {"error":{"message":"This request requires more credits...',
  rede: 'error connecting to api.github.com',
  redeSessao: 'sessão retornou erro: fetch failed',
  ghBuscas: 'ciclo de monitoramento: todas as buscas gh falharam (veja o log)',
  githubIndisponivel: 'postar review biudtech/biud-frontend#774 (APPROVE): gh: No server is currently available to service your request. Sorry about that. Please try resubmitting your request and contact us if the problem persists. (HTTP 503)',
  token: 'revisao biudtech/biud-esg#193: sem token no gh pra wandersonbiuder',
  binario: "claude saiu com código 1: '\"C:\\nvm4w\\nodejs\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe\"' não é reconhecido como um comando interno",
  stream: 'claude saiu com código 4294967295: stream interrompido antes do evento result',
  bashCd: 'review ai-assisted-scheduling-operations#362: bash cd falhou, cd: tmp-pr362: No such file or directory',
  restart: 'app reiniciado com revisão em andamento: biudtech/biud-core#262 devolvido(s) à fila',
  console: 'sessao "Login do Claude" saiu com codigo 3221225786',
  nadaVer: 'qualquer coisa que ninguém previu',
};

/* ---------- CLASSES: forma e ordem ---------- */

test('CLASSES: toda classe tem os cinco campos e um kind válido', () => {
  const KINDS = ['operacional', 'espera-reset', 'transitorio', 'permanente'];
  const GRUPOS = ['operacional', 'ambiente', 'credencial', 'rede', 'app'];
  assert.ok(Array.isArray(CLASSES) && CLASSES.length === 10, 'são 10 classes');
  for (const c of CLASSES) {
    assert.equal(typeof c.id, 'string');
    assert.ok(c.label, `${c.id} precisa de label humano`);
    assert.ok(GRUPOS.includes(c.grupo), `grupo inválido em ${c.id}: ${c.grupo}`);
    assert.ok(KINDS.includes(c.kind), `kind inválido em ${c.id}: ${c.kind}`);
    assert.ok(c.re instanceof RegExp, `${c.id} precisa de regex`);
    assert.ok(c.re.flags.includes('i'), `${c.id}: a classificação é case-insensitive`);
    assert.ok(!c.re.global, `${c.id}: regex global carrega lastIndex entre chamadas e quebra o teste na 2ª vez`);
  }
});

test('CLASSES: ids únicos', () => {
  const ids = CLASSES.map(c => c.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('CLASSES: a ordem é a documentada (primeira que casar vence)', () => {
  assert.deepEqual(CLASSES.map(c => c.id), [
    'restart-fila', 'console-fechado', 'limite-plano', 'assinatura-bloqueada',
    'credencial-invalida', 'credito-insuficiente', 'rede', 'github-indisponivel',
    'token-gh', 'ferramenta'
  ]);
});

/* ---------- classify: mensagens reais ---------- */

const CASOS = [
  ['limite-plano', MSG.limite],
  ['assinatura-bloqueada', MSG.assinatura],
  ['credencial-invalida', MSG.credencial],
  ['credito-insuficiente', MSG.credito],
  ['rede', MSG.rede],
  ['rede', MSG.redeSessao],
  ['rede', MSG.ghBuscas],
  ['github-indisponivel', MSG.githubIndisponivel],
  ['token-gh', MSG.token],
  ['ferramenta', MSG.binario],
  ['ferramenta', MSG.stream],
  ['ferramenta', MSG.bashCd],
  ['restart-fila', MSG.restart],
  ['console-fechado', MSG.console],
  ['desconhecido', MSG.nadaVer],
];

for (const [id, msg] of CASOS) {
  test(`classify: "${msg.slice(0, 60)}" => ${id}`, () => {
    assert.equal(classify(msg).id, id);
  });
}

test('classify: a ORDEM importa, console-fechado ganha de ferramenta', () => {
  // 'sessao "..." saiu com codigo 3221225786' casa com os DOIS: com o padrão de
  // console fechado (ordem 2) e com o 'saiu com c[óo]digo \d' de ferramenta
  // (ordem 9). Vence a primeira. Sem essa precedência, fechar a janela do login
  // no braço viraria "binário indisponível" no Diagnóstico.
  const c = classify(MSG.console);
  assert.equal(c.id, 'console-fechado');
  assert.equal(c.kind, 'operacional');
  assert.match(MSG.console, /saiu com c[óo]digo \d/i, 'confirma que o texto casaria com ferramenta também');
});

test('classify: nunca devolve null e nunca lança com entrada inválida', () => {
  for (const entrada of [null, undefined, '', 0, 42, {}, [], NaN, false, Symbol('x')]) {
    const c = classify(entrada);
    assert.equal(c.id, 'desconhecido', `entrada ${String(entrada)} devia cair no fallback`);
    assert.equal(c.kind, 'permanente');
    assert.equal(c.grupo, 'app');
    assert.equal(c.re, null);
    assert.ok(c.label);
  }
});

test('classify: é case-insensitive', () => {
  assert.equal(classify('SESSÃO RETORNOU ERRO: INVALID API KEY').id, 'credencial-invalida');
  assert.equal(classify('econnreset no meio da sessão').id, 'rede');
});

test('classify: devolve o objeto da classe, não uma cópia parcial', () => {
  const c = classify(MSG.limite);
  assert.equal(c.label, 'Limite do plano Claude');
  assert.equal(c.grupo, 'ambiente');
  assert.equal(c.kind, 'espera-reset');
});

/* ---------- CONTRATO CRÍTICO DE COMPATIBILIDADE ---------- */

test('compatibilidade: kind reproduz exatamente a decisão de retry de review.js hoje', () => {
  // Cópia LITERAL dos quatro regexes inline de lib/engine/review.js (runOneHeadless,
  // linhas 154 a 159 na v2.36.1). Hoje o transitório é limitErr||netErr||toolErr||authErr.
  // Depois da migração passa a ser kind === 'transitorio' || kind === 'espera-reset'.
  // Este teste prova que a troca NÃO muda o comportamento de nenhuma mensagem que
  // realmente chega naquele catch, ou seja: a migração é segura.
  const legado = (msg) => {
    const limitErr = /hit your (session|usage|weekly) limit|session limit|usage limit/i.test(msg);
    const netErr = /ECONNRESET|ENOTFOUND|ETIMEDOUT|Connection closed|Unable to connect|fetch failed|network/i.test(msg);
    const toolErr = /não é reconhecido|not recognized|No such file|ENOENT|command not found|saiu com c[óo]digo \d/i.test(msg);
    const authErr = /sem token no gh/i.test(msg);
    return limitErr || netErr || toolErr || authErr;
  };
  const novo = (msg) => {
    const k = classify(msg).kind;
    return k === 'transitorio' || k === 'espera-reset';
  };

  // corpus: só mensagens que de fato passam pelo catch de runOneHeadless, ou seja,
  // erro de uma sessão de revisão. Linha de log operacional não chega ali.
  const corpus = [
    MSG.limite, MSG.assinatura, MSG.credencial, MSG.credito,
    MSG.redeSessao, MSG.token, MSG.binario, MSG.stream, MSG.bashCd, MSG.nadaVer,
    'sessão retornou erro: ECONNRESET',
    'sessão retornou erro: Connection closed',
    'sessão retornou erro: ENOTFOUND api.anthropic.com',
    "sessão retornou erro: You've hit your session limit",
    'claude: command not found',
    'spawn claude ENOENT',
  ];
  for (const msg of corpus) {
    assert.equal(novo(msg), legado(msg), `divergência de transitoriedade em: ${msg.slice(0, 80)}`);
  }
});

test('compatibilidade: falha desconhecida CONTINUA não-transitória (estaciona)', () => {
  // É o comportamento de hoje e não pode mudar: sem saber o que houve, relançar
  // sozinho vira loop infinito de revisão queimando token. Fallback = permanente.
  const c = classify(MSG.nadaVer);
  assert.equal(c.id, 'desconhecido');
  assert.equal(c.kind, 'permanente');
  assert.ok(c.kind !== 'transitorio' && c.kind !== 'espera-reset');
});

test('compatibilidade: espera-reset é transitório, mas separado de transitorio', () => {
  // review.js já trata os dois de forma diferente (cap de 12 tentativas pro limite
  // do plano contra 3 pro resto). O kind preserva essa distinção, que um booleano
  // "transitório sim/não" perderia.
  assert.equal(classify(MSG.limite).kind, 'espera-reset');
  assert.equal(classify(MSG.redeSessao).kind, 'transitorio');
});

test('compatibilidade: divergência CONSCIENTE em console-fechado, fora do caminho de retry', () => {
  // Esta é a ÚNICA mensagem do log real onde o legado e o novo discordam: o
  // 'saiu com codigo \d' do toolErr casaria e chamaria de transitório. Ela nunca
  // chega no catch de runOneHeadless (é log da sessão de TERMINAL, não da
  // revisão headless), então a divergência não muda comportamento nenhum; e pro
  // Diagnóstico, "operacional" é a leitura certa (você fechou a janela).
  assert.equal(classify(MSG.console).kind, 'operacional');
  assert.match(MSG.console, /saiu com c[óo]digo \d/i);
});

/* ---------- resetAtFrom ---------- */

const AGORA = new Date(2026, 7, 7, 17, 32, 15); // 07/08/2026 17:32:15, hora local

test('resetAtFrom: "resets 9pm" antes da hora cai no mesmo dia', () => {
  const d = resetAtFrom(MSG.limite, AGORA);
  assert.ok(d instanceof Date);
  assert.equal(d.getDate(), 7);
  assert.equal(d.getMonth(), 7);
  assert.equal(d.getHours(), 21);
  assert.equal(d.getMinutes(), 0);
});

test('resetAtFrom: depois da hora rola pro dia seguinte', () => {
  // 22:00 já passou das 21h: o reset citado é o PRÓXIMO, não o de hoje
  const d = resetAtFrom(MSG.limite, new Date(2026, 7, 7, 22, 0, 0));
  assert.equal(d.getDate(), 8);
  assert.equal(d.getHours(), 21);
});

test('resetAtFrom: exatamente na hora também rola (limite é <=, não <)', () => {
  const d = resetAtFrom(MSG.limite, new Date(2026, 7, 7, 21, 0, 0));
  assert.equal(d.getDate(), 8);
  assert.equal(d.getHours(), 21);
});

test('resetAtFrom: aceita formato 24h', () => {
  const d = resetAtFrom("You've hit your usage limit · resets 21:00", AGORA);
  assert.equal(d.getHours(), 21);
  assert.equal(d.getMinutes(), 0);
  assert.equal(d.getDate(), 7);
});

test('resetAtFrom: aceita "resets 9 pm" (com espaço)', () => {
  assert.equal(resetAtFrom('resets 9 pm', AGORA).getHours(), 21);
});

test('resetAtFrom: aceita "resets 11am"', () => {
  const d = resetAtFrom("You've hit your weekly limit · resets 11am (America/Sao_Paulo)", AGORA);
  assert.equal(d.getHours(), 11);
  assert.equal(d.getDate(), 8, '11h de hoje já passou às 17:32, então é amanhã');
});

test('resetAtFrom: aceita "resets 9:30pm"', () => {
  const d = resetAtFrom('resets 9:30pm', AGORA);
  assert.equal(d.getHours(), 21);
  assert.equal(d.getMinutes(), 30);
});

test('resetAtFrom: 12am é meia-noite e 12pm é meio-dia', () => {
  assert.equal(resetAtFrom('resets 12am', AGORA).getHours(), 0);
  assert.equal(resetAtFrom('resets 12pm', AGORA).getHours(), 12);
});

test('resetAtFrom: zera segundos e milissegundos (instante estável pra comparar)', () => {
  const d = resetAtFrom('resets 9pm', AGORA);
  assert.equal(d.getSeconds(), 0);
  assert.equal(d.getMilliseconds(), 0);
});

test('resetAtFrom: sem hora nenhuma devolve null', () => {
  assert.equal(resetAtFrom(MSG.assinatura, AGORA), null);
  assert.equal(resetAtFrom("You've hit your weekly limit", AGORA), null);
  assert.equal(resetAtFrom('resets soon', AGORA), null);
});

test('resetAtFrom: hora impossível devolve null, não Date inválido', () => {
  assert.equal(resetAtFrom('resets 25:00', AGORA), null);
  assert.equal(resetAtFrom('resets 13pm', AGORA), null);
  assert.equal(resetAtFrom('resets 9:75pm', AGORA), null);
});

test('resetAtFrom: entrada inválida devolve null, não lança', () => {
  for (const entrada of [null, undefined, 0, {}, []]) {
    assert.equal(resetAtFrom(entrada, AGORA), null);
  }
});

test('resetAtFrom: sem now usa o relógio e devolve um instante no futuro', () => {
  const d = resetAtFrom('resets 9pm');
  assert.ok(d instanceof Date);
  assert.ok(d.getTime() > Date.now(), 'o reset é sempre o próximo');
});

/* ---------- parseLine ---------- */

test('parseLine: quebra a linha padrão do farol.log', () => {
  const r = parseLine('[2026-08-07 17:32:15] [WARN] revisao biudtech/biud-esg#193 caiu');
  assert.equal(r.ts, '2026-08-07 17:32:15');
  assert.equal(r.level, 'WARN');
  assert.equal(r.msg, 'revisao biudtech/biud-esg#193 caiu');
});

test('parseLine: aceita o carimbo novo com offset explícito (Brasília) e o antigo sem (UTC)', () => {
  // linhas novas saem do logStamp com o fuso na linha; as antigas do formato UTC
  // permanecem no arquivo e as duas gerações precisam parsear no mesmo triage
  const nova = parseLine('[2026-08-16 22:04:36 -03:00] [WARN] app reiniciado com revisão em andamento: biudtech/biud-frontend#763 devolvido(s) à fila');
  assert.equal(nova.ts, '2026-08-16 22:04:36');
  assert.equal(nova.level, 'WARN');
  assert.match(nova.msg, /^app reiniciado/);
  const positiva = parseLine('[2026-08-16 22:04:36 +00:00] [INFO] offset positivo também parseia');
  assert.equal(positiva.ts, '2026-08-16 22:04:36');
});

test('parseLine: aceita ERROR e mensagem com colchete dentro', () => {
  const r = parseLine('[2026-08-04 17:15:05] [ERROR] erro: {"error":{"message":"[402]"}}');
  assert.equal(r.level, 'ERROR');
  assert.equal(r.msg, 'erro: {"error":{"message":"[402]"}}');
});

test('parseLine: linha de continuação (multilinha) devolve null', () => {
  assert.equal(parseLine('check your internet connection or https://githubstatus.com'), null);
  assert.equal(parseLine('ou externo, um programa operável ou um arquivo em lotes.'), null);
});

test('parseLine: colchete que não é data também é continuação', () => {
  assert.equal(parseLine('[não é timestamp] alguma coisa'), null);
});

test('parseLine: aceita CRLF (log gravado no Windows)', () => {
  const r = parseLine('[2026-08-07 17:32:15] [WARN] mensagem\r');
  assert.equal(r.msg, 'mensagem', 'o \\r não pode vazar pro fim da mensagem');
});

test('parseLine: entrada inválida devolve null, não lança', () => {
  for (const entrada of [null, undefined, '', 0, {}, []]) {
    assert.equal(parseLine(entrada), null);
  }
});

/* ---------- triage ---------- */

const L = (ts, level, msg) => `[${ts}] [${level}] ${msg}`;

test('triage: array vazio entra e sai vazio, sem lançar', () => {
  assert.deepEqual(triage([]), []);
  assert.deepEqual(triage(), []);
  assert.deepEqual(triage(null), []);
  assert.deepEqual(triage('não é array'), []);
});

test('triage: agrupa por classe e ordena por count decrescente', () => {
  const linhas = [
    L('2026-08-07 10:00:00', 'ERROR', MSG.credencial),
    L('2026-08-07 10:01:00', 'WARN', MSG.limite),
    L('2026-08-07 10:02:00', 'WARN', MSG.limite),
    L('2026-08-07 10:03:00', 'WARN', MSG.limite),
    L('2026-08-07 10:04:00', 'ERROR', MSG.assinatura),
    L('2026-08-07 10:05:00', 'ERROR', MSG.assinatura),
  ];
  const r = triage(linhas);
  assert.deepEqual(r.map(g => [g.id, g.count]), [
    ['limite-plano', 3], ['assinatura-bloqueada', 2], ['credencial-invalida', 1]
  ]);
});

test('triage: carrega label, grupo e kind da classe', () => {
  const [g] = triage([L('2026-08-07 10:00:00', 'WARN', MSG.limite)]);
  assert.equal(g.label, 'Limite do plano Claude');
  assert.equal(g.grupo, 'ambiente');
  assert.equal(g.kind, 'espera-reset');
});

test('triage: first e last são o primeiro e o último evento do grupo', () => {
  const r = triage([
    L('2026-08-07 10:00:00', 'WARN', MSG.limite),
    L('2026-08-07 11:00:00', 'ERROR', MSG.assinatura),
    L('2026-08-07 12:00:00', 'WARN', MSG.limite),
    L('2026-08-07 13:00:00', 'WARN', MSG.limite),
  ]);
  const lim = r.find(g => g.id === 'limite-plano');
  assert.equal(lim.first, '2026-08-07 10:00:00');
  assert.equal(lim.last, '2026-08-07 13:00:00');
  const ass = r.find(g => g.id === 'assinatura-bloqueada');
  assert.equal(ass.first, '2026-08-07 11:00:00');
  assert.equal(ass.last, '2026-08-07 11:00:00', 'evento único: first === last');
});

test('triage: continuação é anexada ao evento anterior, não vira grupo nem conta', () => {
  // no log real, "error connecting to api.github.com" vem com a linha
  // "check your internet connection ..." embaixo, sem timestamp
  const r = triage([
    L('2026-08-06 13:40:50', 'WARN', 'gh search falhou (conta: --owner acme): error connecting to api.github.com'),
    'check your internet connection or https://githubstatus.com',
  ]);
  assert.equal(r.length, 1, 'a continuação não abre grupo próprio');
  assert.equal(r[0].id, 'rede');
  assert.equal(r[0].count, 1, 'a continuação não é contada como evento');
  assert.match(r[0].sample, /check your internet connection/, 'mas ela entra na mensagem do evento');
});

test('triage: continuação pode MUDAR a classe do evento (classifica a mensagem inteira)', () => {
  // é justamente o caso do binário quebrado: a 1ª linha corta e o "não é
  // reconhecido" cai na linha de baixo. Classificar linha a linha erraria.
  const r = triage([
    L('2026-08-04 16:07:23', 'WARN', "revisao acme/app#1: claude falhou: '\"C:\\claude.exe\"'"),
    'não é reconhecido como um comando interno ou externo.',
  ]);
  assert.equal(r[0].id, 'ferramenta');
  assert.equal(r[0].count, 1);
});

test('triage: continuação no topo (sem evento anterior) é ignorada', () => {
  const r = triage(['linha órfã sem timestamp', L('2026-08-07 10:00:00', 'WARN', MSG.limite)]);
  assert.equal(r.length, 1);
  assert.equal(r[0].id, 'limite-plano');
  assert.equal(r[0].count, 1);
});

test('triage: refs junta as chaves de PR, únicas e ordenadas', () => {
  const r = triage([
    L('2026-08-07 10:00:00', 'WARN', 'revisao biudtech/biud-esg#193: ' + MSG.limite),
    L('2026-08-07 10:01:00', 'WARN', 'revisao biudtech/biud-frontend#727: ' + MSG.limite),
    L('2026-08-07 10:02:00', 'WARN', 'revisao biudtech/biud-esg#193: ' + MSG.limite),
  ]);
  assert.deepEqual(r[0].refs, ['biudtech/biud-esg#193', 'biudtech/biud-frontend#727']);
});

test('triage: refs pega várias chaves na mesma linha', () => {
  const r = triage([
    L('2026-08-06 14:12:35', 'WARN', 'app reiniciado com revisão em andamento: biudtech/biud-esg#187, biudtech/internal-auth#46, biudtech/biud-core#264 devolvido(s) à fila'),
  ]);
  assert.deepEqual(r[0].refs, ['biudtech/biud-core#264', 'biudtech/biud-esg#187', 'biudtech/internal-auth#46']);
});

test('triage: refs corta em 12', () => {
  const linhas = [];
  for (let i = 1; i <= 30; i++) {
    linhas.push(L(`2026-08-07 10:${String(i).padStart(2, '0')}:00`, 'WARN', `revisao acme/app#${100 + i}: ` + MSG.limite));
  }
  const r = triage(linhas);
  assert.equal(r[0].count, 30, 'o corte é só na lista de refs, o count segue inteiro');
  assert.equal(r[0].refs.length, 12);
});

test('triage: grupo sem nenhuma chave de PR devolve refs vazio', () => {
  const r = triage([L('2026-08-06 13:40:50', 'ERROR', MSG.ghBuscas)]);
  assert.deepEqual(r[0].refs, []);
});

test('triage: sample é a mensagem do PRIMEIRO evento, truncada em 160', () => {
  const longa = 'x'.repeat(400) + ' Invalid API key';
  const r = triage([
    L('2026-08-07 10:00:00', 'ERROR', longa),
    L('2026-08-07 10:01:00', 'ERROR', 'segundo evento ' + MSG.credencial),
  ]);
  assert.equal(r[0].count, 2);
  assert.equal(r[0].sample.length, 160);
  assert.equal(r[0].sample, longa.slice(0, 160), 'é o primeiro, não o último');
});

test('triage: mensagem curta não é preenchida nem cortada', () => {
  const r = triage([L('2026-08-07 10:00:00', 'ERROR', MSG.credencial)]);
  assert.equal(r[0].sample, MSG.credencial);
});

test('triage: o que não casa com nada vira o grupo desconhecido', () => {
  const r = triage([
    L('2026-08-04 14:09:10', 'ERROR', 'review biudtech/biud-frontend#702: Read pr702.patch falhou, Invalid pages parameter'),
  ]);
  assert.equal(r[0].id, 'desconhecido');
  assert.equal(r[0].label, 'Falha não classificada');
  assert.equal(r[0].kind, 'permanente');
});

test('triage: linha vazia ou só espaço não vira evento', () => {
  const r = triage([L('2026-08-07 10:00:00', 'WARN', MSG.limite), '', '   ']);
  assert.equal(r.length, 1);
  assert.equal(r[0].count, 1);
});

test('triage: aceita CRLF nas linhas', () => {
  const r = triage([L('2026-08-07 10:00:00', 'WARN', MSG.limite) + '\r']);
  assert.equal(r[0].id, 'limite-plano');
  assert.equal(r[0].count, 1);
});

/* ---------- triage contra o log REAL de produção ---------- */

// Contagens MEDIDAS no farol.log real (159 linhas, 03 a 07/08/2026, máquina do
// Wanderson). O fixture abaixo é montado INLINE a partir das mensagens reais, com
// exatamente as mesmas contagens, pra provar que o triage reproduz o incidente
// como ele aconteceu. Não lemos o arquivo do usuário no teste, de propósito:
// teste não pode depender de estado de máquina.
const MEDIDO = [
  ['limite-plano', 70, MSG.limite],
  ['assinatura-bloqueada', 35, MSG.assinatura],
  ['rede', 13, MSG.rede],
  ['credencial-invalida', 9, MSG.credencial],
  ['credito-insuficiente', 7, MSG.credito],
  ['ferramenta', 4, MSG.binario],
  ['restart-fila', 3, MSG.restart],
  ['console-fechado', 3, MSG.console],
  ['desconhecido', 2, 'review biudtech/biud-frontend#702: Read pr702.patch falhou, Invalid pages parameter'],
];

function fixtureProducao() {
  const linhas = [];
  let n = 0;
  for (const [, count, msg] of MEDIDO) {
    for (let i = 0; i < count; i++) {
      n++;
      const hh = String(8 + Math.floor(n / 60)).padStart(2, '0');
      const mm = String(n % 60).padStart(2, '0');
      linhas.push(L(`2026-08-07 ${hh}:${mm}:00`, 'ERROR', `revisao biudtech/biud-frontend#${700 + (i % 5)}: ${msg}`));
      // metade dos eventos de rede vem com a continuação sem timestamp, como no log real
      if (msg === MSG.rede) linhas.push('check your internet connection or https://githubstatus.com');
    }
  }
  return linhas;
}

test('triage: reproduz o incidente real de 03 a 07/08/2026', () => {
  const r = triage(fixtureProducao());
  assert.deepEqual(r.map(g => [g.id, g.count]), MEDIDO.map(([id, count]) => [id, count]));
});

test('triage: os dois maiores grupos do log real são limite-plano e assinatura-bloqueada', () => {
  // é o diagnóstico que o painel precisa dar de cara: o Farol não parou por bug
  // dele, parou por limite de plano e por a org ter desligado a assinatura
  const r = triage(fixtureProducao());
  assert.equal(r[0].id, 'limite-plano');
  assert.equal(r[0].count, 70);
  assert.equal(r[1].id, 'assinatura-bloqueada');
  assert.equal(r[1].count, 35);
  assert.ok(r[0].count > r[1].count);
});

test('triage: as continuações do log real não inflam nenhuma contagem', () => {
  const linhas = fixtureProducao();
  const eventos = linhas.filter(l => parseLine(l)).length;
  const soma = triage(linhas).reduce((a, g) => a + g.count, 0);
  assert.equal(soma, eventos, 'a soma dos grupos é o total de eventos, não de linhas');
  assert.ok(linhas.length > eventos, 'o fixture tem continuações de verdade');
});

test('triage: no log real, 59 dos 146 eventos NÃO se resolvem sozinhos', () => {
  // leitura acionável do painel: limite (70) e rede (13) voltam sozinhos; o resto
  // exige ação humana. Prova que kind separa o que espera do que precisa de você.
  const r = triage(fixtureProducao());
  const espera = r.filter(g => g.kind === 'espera-reset' || g.kind === 'transitorio')
    .reduce((a, g) => a + g.count, 0);
  const preciso = r.filter(g => g.kind === 'permanente').reduce((a, g) => a + g.count, 0);
  const operacional = r.filter(g => g.kind === 'operacional').reduce((a, g) => a + g.count, 0);
  assert.equal(espera, 87, 'limite 70 + rede 13 + ferramenta 4');
  assert.equal(preciso, 53, 'assinatura 35 + credencial 9 + crédito 7 + desconhecido 2');
  assert.equal(operacional, 6, 'restart 3 + console fechado 3');
  assert.equal(espera + preciso + operacional, 146);
});
