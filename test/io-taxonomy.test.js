// lib/io.js e lib/taxonomy.js: os dois últimos módulos de lib/ sem nenhum teste.
//
// io.js é a base de tudo (todo `gh` do Farol passa pelo run, todo estado passa pelo
// readJson, o boot semeia o workspace pelo copyRecursive). taxonomy.js é a fonte dos
// níveis de papel e domínio que entram no PROMPT da revisão: nível novo listado sem
// texto de tom correspondente vira `undefined` injetado no prompt, calado.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = path.join(os.tmpdir(), 'farol-test-io-tax-' + process.pid);
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const { ensureDir, readJson, writeJsonAtomic, writeTextAtomic, copyRecursive, detectGitBash, prependPathDirs } = await import('../lib/io.js');
const { run, runShell } = (await import('../lib/io.js')).default;
const { IS_WIN } = await import('../lib/paths.js');
const tax = (await import('../lib/taxonomy.js')).default;

const TMP = path.join(os.tmpdir(), 'farol-test-io-' + process.pid);
after(() => {
  for (const d of [TMP, FAROL_HOME]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ } }
});

/* ---------- io: ensureDir / readJson ---------- */

test('ensureDir cria a árvore inteira e é idempotente', () => {
  const alvo = path.join(TMP, 'a', 'b', 'c');
  ensureDir(alvo);
  assert.ok(fs.existsSync(alvo));
  assert.doesNotThrow(() => ensureDir(alvo), 'chamar de novo não pode lançar (roda em todo boot)');
});

test('readJson devolve o fallback quando o arquivo não existe', () => {
  // é o que faz o primeiro boot funcionar sem nenhum arquivo de estado
  assert.deepEqual(readJson(path.join(TMP, 'nao-existe.json'), { padrao: true }), { padrao: true });
  assert.deepEqual(readJson(path.join(TMP, 'nao-existe.json'), []), []);
});

test('readJson devolve o fallback quando o JSON está corrompido', () => {
  // config.json truncado por queda de energia não pode derrubar o app
  ensureDir(TMP);
  const arq = path.join(TMP, 'torto.json');
  fs.writeFileSync(arq, '{ "a": 1,');
  assert.deepEqual(readJson(arq, { ok: false }), { ok: false });
});

test('readJson: corrupção LOGA e preserva a evidência em .bad', () => {
  // queda de energia trunca o config.json; hoje isso vira reset silencioso a
  // DEFAULTS (multi-conta desfeita, política de auto-approve de volta ao default)
  ensureDir(TMP);
  const arq = path.join(TMP, 'corrompido.json');
  fs.writeFileSync(arq, '{ "a": 1,');
  const logs = [];
  assert.deepEqual(readJson(arq, { ok: false }, m => logs.push(m)), { ok: false });
  assert.equal(logs.length, 1, 'corrupção tem que ser logada');
  assert.match(logs[0], /corrompido/);
  assert.equal(fs.readFileSync(arq + '.bad', 'utf8'), '{ "a": 1,', 'o conteúdo corrompido vira .bad pra perícia');
  assert.equal(fs.readFileSync(arq, 'utf8'), '{ "a": 1,', 'a leitura não toca o original');
});

test('readJson: .bad existente NÃO é sobrescrito (a primeira evidência vence)', () => {
  ensureDir(TMP);
  const arq = path.join(TMP, 'corrompido2.json');
  fs.writeFileSync(arq, '{ "a": 1,');
  readJson(arq, null, () => {});
  fs.writeFileSync(arq, '{ "b": 2,');
  readJson(arq, null, () => {});
  assert.equal(fs.readFileSync(arq + '.bad', 'utf8'), '{ "a": 1,');
});

test('readJson: arquivo ausente segue SILENCIOSO (primeiro boot não é falha)', () => {
  const logs = [];
  assert.equal(readJson(path.join(TMP, 'nao-existe-2.json'), 'fb', m => logs.push(m)), 'fb');
  assert.equal(logs.length, 0, 'ENOENT não pode virar ruído no farol.log');
  assert.equal(fs.existsSync(path.join(TMP, 'nao-existe-2.json.bad')), false);
});

test('readJson lê o conteúdo quando está válido', () => {
  ensureDir(TMP);
  const arq = path.join(TMP, 'bom.json');
  fs.writeFileSync(arq, JSON.stringify({ a: 1, b: [2, 3] }));
  assert.deepEqual(readJson(arq, null), { a: 1, b: [2, 3] });
});

/* ---------- io: writeJsonAtomic ---------- */

test('writeJsonAtomic grava, sobrescreve destino existente e não deixa .tmp', () => {
  // tmp + rename no MESMO diretório: queda de energia deixa o arquivo antigo OU o
  // novo, nunca um truncado. Sobrescrever destino existente é o caso Windows crítico.
  ensureDir(TMP);
  const arq = path.join(TMP, 'atomico.json');
  writeJsonAtomic(arq, { a: 1 });
  assert.deepEqual(readJson(arq, null), { a: 1 });
  writeJsonAtomic(arq, { a: 2 });
  assert.deepEqual(readJson(arq, null), { a: 2 }, 'rename por cima de existente tem que valer nos dois SOs');
  assert.equal(fs.existsSync(arq + '.tmp'), false, 'o .tmp não pode sobrar');
});

/* ---------- io: writeTextAtomic ---------- */

test('writeTextAtomic: grava via tmp e rename, conteúdo íntegro', () => {
  ensureDir(TMP);
  const f = path.join(TMP, 'seen.txt');
  writeTextAtomic(f, 'a#1\na#2\n');
  assert.equal(fs.readFileSync(f, 'utf8'), 'a#1\na#2\n');
  assert.equal(fs.existsSync(f + '.tmp'), false);
});

test('writeTextAtomic sobrescreve destino existente e não deixa .tmp', () => {
  // o caso real do saveSeen: todo markSeen/unsee grava por cima do seen.txt já
  // existente. Mesmo cenário Windows crítico que writeJsonAtomic já cobre.
  ensureDir(TMP);
  const f = path.join(TMP, 'seen2.txt');
  writeTextAtomic(f, 'a#1\n');
  assert.equal(fs.readFileSync(f, 'utf8'), 'a#1\n');
  writeTextAtomic(f, 'a#1\na#2\n');
  assert.equal(fs.readFileSync(f, 'utf8'), 'a#1\na#2\n', 'rename por cima de existente tem que valer nos dois SOs');
  assert.equal(fs.existsSync(f + '.tmp'), false, 'o .tmp não pode sobrar');
});

/* ---------- io: copyRecursive ---------- */

test('copyRecursive copia a árvore toda, criando o destino', () => {
  // é como o boot semeia o workspace-template em ~/.farol/workspace
  const src = path.join(TMP, 'src');
  const dst = path.join(TMP, 'dst');
  ensureDir(path.join(src, 'sub'));
  fs.writeFileSync(path.join(src, 'raiz.md'), 'raiz');
  fs.writeFileSync(path.join(src, 'sub', 'fundo.md'), 'fundo');
  copyRecursive(src, dst);
  assert.equal(fs.readFileSync(path.join(dst, 'raiz.md'), 'utf8'), 'raiz');
  assert.equal(fs.readFileSync(path.join(dst, 'sub', 'fundo.md'), 'utf8'), 'fundo');
});

test('copyRecursive com origem inexistente não lança', () => {
  assert.doesNotThrow(() => copyRecursive(path.join(TMP, 'fantasma'), path.join(TMP, 'saida')));
});

test('copyRecursive sobrescreve o destino existente', () => {
  // o boot re-sincroniza o protocolo de review a cada partida: tem que sobrescrever
  const src = path.join(TMP, 'src2'), dst = path.join(TMP, 'dst2');
  ensureDir(src); ensureDir(dst);
  fs.writeFileSync(path.join(src, 'p.md'), 'novo');
  fs.writeFileSync(path.join(dst, 'p.md'), 'velho');
  copyRecursive(src, dst);
  assert.equal(fs.readFileSync(path.join(dst, 'p.md'), 'utf8'), 'novo');
});

/* ---------- io: detectGitBash ---------- */

test('detectGitBash devolve null fora do Windows', { skip: IS_WIN ? 'só roda em POSIX' : false }, () => {
  assert.equal(detectGitBash(), null, 'CLAUDE_CODE_GIT_BASH_PATH só existe no Windows');
});

test('detectGitBash devolve caminho existente ou null, nunca lixo', { skip: IS_WIN ? false : 'só roda no Windows' }, () => {
  const p = detectGitBash();
  if (p !== null) assert.ok(fs.existsSync(p), `devolveu ${p}, que não existe`);
});

/* ---------- io: run / runShell ---------- */

test('run devolve o envelope completo no sucesso', async () => {
  const r = await run(process.execPath, ['-e', 'process.stdout.write("oi")']);
  assert.equal(r.ok, true);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, 'oi');
  assert.equal(typeof r.stderr, 'string', 'stderr é sempre string, nunca undefined');
});

test('run NÃO lança quando o comando falha: devolve ok:false', async () => {
  // o engine inteiro depende disso: todo chamador testa r.ok em vez de try/catch
  const r = await run(process.execPath, ['-e', 'process.exit(3)']);
  assert.equal(r.ok, false);
  assert.equal(r.code, 3);
});

test('run NÃO lança quando o binário não existe', async () => {
  const r = await run('binario-que-nao-existe-farol-teste', ['--versao']);
  assert.equal(r.ok, false);
  assert.equal(typeof r.stdout, 'string');
});

test('run captura o stderr separado do stdout', async () => {
  const r = await run(process.execPath, ['-e', 'process.stderr.write("erro"); process.stdout.write("saida")']);
  assert.equal(r.stdout, 'saida');
  assert.equal(r.stderr, 'erro');
});

test('runShell executa uma linha de comando e devolve o mesmo envelope', async () => {
  // sem aspas aninhadas de propósito: a linha vai pro cmd.exe /d /s /c (Windows) ou
  // /bin/sh -lc (mac), e cada um trata aspa embutida de um jeito
  const r = await runShell('node --version');
  assert.equal(r.ok, true);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^v\d+\./, 'a saída do comando chega inteira');
});

test('runShell NÃO lança quando o comando falha', async () => {
  const r = await runShell('binario-que-nao-existe-farol-teste --versao');
  assert.equal(r.ok, false);
  assert.equal(typeof r.stderr, 'string');
});

test('runShell no Windows força UTF-8 antes do comando', { skip: IS_WIN ? false : 'só roda no Windows' }, async () => {
  const r = await runShell('echo acentuação');
  assert.equal(r.ok, true);
  assert.match(r.stdout, /acentuação/);
  assert.doesNotMatch(r.stdout, /�/);
});

/* ---------- taxonomy ---------- */

test('taxonomy: todo papel listado tem rótulo E texto de tom', () => {
  // PAPEL_TONE é injetado no prompt da revisão (personProfileBlock). Papel na lista sem
  // texto correspondente injetaria "undefined" no prompt, sem erro nenhum.
  for (const nivel of tax.PAPEL_LEVELS) {
    assert.equal(typeof tax.PAPEL_LABEL[nivel], 'string', `PAPEL_LABEL falta ${nivel}`);
    assert.ok(tax.PAPEL_LABEL[nivel].length > 0, `PAPEL_LABEL vazio em ${nivel}`);
    assert.equal(typeof tax.PAPEL_TONE[nivel], 'string', `PAPEL_TONE falta ${nivel}`);
    assert.ok(tax.PAPEL_TONE[nivel].length > 20, `PAPEL_TONE curto demais em ${nivel}`);
  }
});

test('taxonomy: todo domínio tem rótulo, e todo nível de domínio tem rótulo E postura', () => {
  for (const d of tax.DOMAINS) {
    assert.equal(typeof tax.DOMAIN_LABEL[d], 'string', `DOMAIN_LABEL falta ${d}`);
  }
  for (const n of tax.DOMAIN_LEVELS) {
    assert.equal(typeof tax.DOMAIN_LEVEL_LABEL[n], 'string', `DOMAIN_LEVEL_LABEL falta ${n}`);
    assert.equal(typeof tax.DOMAIN_POSTURE[n], 'string', `DOMAIN_POSTURE falta ${n}`);
    assert.ok(tax.DOMAIN_POSTURE[n].length > 20, `DOMAIN_POSTURE curto demais em ${n}`);
  }
});

test('taxonomy: todo desfecho de pushback tem rótulo em português', () => {
  for (const o of tax.PUSHBACK_OUTCOMES) {
    assert.equal(typeof tax.PUSHBACK_LABEL[o], 'string', `PUSHBACK_LABEL falta ${o}`);
  }
});

test('taxonomy: nenhum mapa tem chave sobrando fora da lista', () => {
  // o inverso do teste acima: rótulo órfão é sinal de nível removido pela metade
  const sobra = (mapa, lista, nome) => {
    const extras = Object.keys(mapa).filter(k => !lista.includes(k));
    assert.deepEqual(extras, [], `${nome} tem chave(s) fora da lista: ${extras.join(', ')}`);
  };
  sobra(tax.PAPEL_LABEL, tax.PAPEL_LEVELS, 'PAPEL_LABEL');
  sobra(tax.PAPEL_TONE, tax.PAPEL_LEVELS, 'PAPEL_TONE');
  sobra(tax.DOMAIN_LABEL, tax.DOMAINS, 'DOMAIN_LABEL');
  sobra(tax.DOMAIN_LEVEL_LABEL, tax.DOMAIN_LEVELS, 'DOMAIN_LEVEL_LABEL');
  sobra(tax.DOMAIN_POSTURE, tax.DOMAIN_LEVELS, 'DOMAIN_POSTURE');
  sobra(tax.PUSHBACK_LABEL, tax.PUSHBACK_OUTCOMES, 'PUSHBACK_LABEL');
});

test('taxonomy: a paleta de contas tem cores distintas em hex', () => {
  assert.ok(tax.ACCOUNT_PALETTE.length >= 4, 'paleta pequena demais pra multi-conta');
  for (const c of tax.ACCOUNT_PALETTE) assert.match(c, /^#[0-9a-f]{6}$/i, `cor inválida: ${c}`);
  assert.equal(new Set(tax.ACCOUNT_PALETTE).size, tax.ACCOUNT_PALETTE.length, 'cor repetida na paleta');
});

test('taxonomy: papel e nível de domínio não se confundem', () => {
  // parsePeople valida os dois eixos contra estas listas; nome em comum faria um valor
  // de um eixo passar como válido no outro
  const comum = tax.PAPEL_LEVELS.filter(p => tax.DOMAIN_LEVELS.includes(p));
  assert.deepEqual(comum, [], `valor ambíguo entre os dois eixos: ${comum.join(', ')}`);
});

/* ---------- prependPathDirs: o PATH do boot posix, agora com teste ---------- */
// Era bloco inline no server.js sem nenhum assert (auditoria 16/08): o código que
// decide se gh e claude existem quando o app abre pelo Dock falhava em silêncio.

test('prependPathDirs: prepend só do que existe e falta, na ordem dada', () => {
  const exists = d => d !== '/nao-existe';
  const out = prependPathDirs('/usr/bin:/bin', ['/opt/homebrew/bin', '/nao-existe', '/usr/local/bin'], exists);
  assert.equal(out, '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin');
});

test('prependPathDirs: dir já presente não duplica; nada faltando devolve null', () => {
  const exists = () => true;
  assert.equal(prependPathDirs('/opt/homebrew/bin:/usr/bin', ['/opt/homebrew/bin'], exists), null,
    'null = o chamador não mexe no env à toa');
});

test('prependPathDirs: PATH vazio não vira ":dir" nem quebra', () => {
  const out = prependPathDirs('', ['/opt/homebrew/bin'], () => true);
  assert.equal(out, '/opt/homebrew/bin:');
  assert.equal(prependPathDirs(undefined, [], () => true), null);
});

test('prependPathDirs: respeita ponto-e-virgula de PATH Windows', () => {
  const out = prependPathDirs('C:\\A;C:\\B', ['C:\\Novo'], p => p === 'C:\\Novo');
  assert.equal(out, 'C:\\Novo;C:\\A;C:\\B');
});
