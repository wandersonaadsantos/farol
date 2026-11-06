// Caminho protegido na sessão de revisão (06/11/2026): a fonte única da política, a projeção
// redigida com nome que o `deny: Read(.env.*)` do usuário não casa, a prova de leitura que o
// engine exige do protegido e as guardas de permissão da sessão.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-protegido-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const {
  PASTA_REDIGIDA, caminhoProtegido, politicaDoPatch, patchParaASessao, leituraInteiraPermitida, nomeMaterializado, caminhoDoPr,
} = await import('../lib/review-source/caminho-protegido.js');
const { KIND: ENV_KIND } = await import('../lib/review-source/env-changes.js');
const { prPathFromRead, arquivoMaterializado, materializeScope, scopeBlock, blocoDosRedigidos } = await import('../lib/engine/pr-scope.js');
const { observeReadEvent, observarLeitura, leiturasProvadas, observeSourceResult, lidosComProtegidoProvado } = await import('../lib/engine/read-evidence.js');
const { makeReader } = await import('../lib/review-source/reader.js');
const { blobHash } = await import('../lib/review-source/contract.js');
const { prepararCoberturaParaOGate, coverageGap, splitByProof, salvarProvaDaSessao, readFileProof } = await import('../lib/engine/file-proof.js');
const { ARQUIVO_DE_GUARDAS, guardasDaSessao } = await import('../lib/engine/guardas-da-sessao.js');
const { parseJson } = await import('../lib/io.js');

after(() => { try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const PATCH_ENV = '@@ -1,2 +1,2 @@\n PORT=3000\n-DEBUG=false\n+DEBUG=true\n';
const PATCH_COMUM = '@@ -1 +1 @@\n-a\n+b\n';
const SEGREDO = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0';

/* ---------- a política única ---------- */

test('politicaDoPatch: arquivo de ambiente vira projeção das linhas alteradas, nunca o patch cru', () => {
  const v = politicaDoPatch('apps/web/.env.example', null, PATCH_ENV);
  assert.equal(v.protegido, true);
  assert.equal(v.sensitivePath, true);
  assert.equal(v.politica, ENV_KIND);
  assert.equal(v.patchAvailable, false);
  assert.ok(v.envChanges && v.envChanges.text.includes('+DEBUG=true'));
  assert.ok(!v.envChanges.text.includes('PORT=3000'), 'linha de contexto não entra na projeção');
  assert.equal(patchParaASessao('apps/web/.env.example', null, PATCH_ENV), v.envChanges.text);
});

test('politicaDoPatch: protegido que não é arquivo de ambiente não chega de jeito nenhum', () => {
  for (const caminho of ['.ssh/config', 'deploy/credentials.json', 'certs/server.key']) {
    const v = politicaDoPatch(caminho, null, PATCH_COMUM);
    assert.equal(v.politica, 'protected-path', caminho);
    assert.equal(v.patchAvailable, false);
    assert.equal(v.envChanges, null);
    assert.equal(patchParaASessao(caminho, null, PATCH_COMUM), '');
  }
  // rename vindo de caminho protegido: o patch traz o conteúdo de lá
  assert.equal(politicaDoPatch('config/app.txt', '.env', PATCH_COMUM).sensitivePath, true);
});

test('politicaDoPatch: caminho comum entrega o patch, e segredo reconhecido no conteúdo o segura', () => {
  const comum = politicaDoPatch('src/a.js', null, PATCH_COMUM);
  assert.equal(comum.protegido, false);
  assert.equal(comum.patchAvailable, true);
  assert.equal(comum.politica, null);
  assert.equal(patchParaASessao('src/a.js', null, PATCH_COMUM), PATCH_COMUM);
  const comSegredo = politicaDoPatch('src/a.js', null, `@@ -1 +1 @@\n+const t = "${SEGREDO}";\n`);
  assert.equal(comSegredo.politica, 'sensitive-content');
  assert.equal(comSegredo.patchAvailable, false);
  assert.equal(patchParaASessao('src/a.js', null, `@@ -1 +1 @@\n+const t = "${SEGREDO}";\n`), '');
});

test('politicaDoPatch: o template público só chega como chaves na execução restrita, que pede projeção', () => {
  const projection = { id: 'p', version: 1, project: () => ({ text: '', digest: '', redactions: [] }) };
  const restrito = politicaDoPatch('.env.example', null, PATCH_ENV, projection);
  assert.equal(restrito.template, true);
  assert.equal(restrito.sensitivePath, false);
  assert.equal(restrito.politica, 'template-keys');
  assert.equal(restrito.envChanges, null, 'na execução restrita a política é a do template');
  assert.equal(politicaDoPatch('.env.dev', null, PATCH_ENV, projection).politica, 'protected-path', 'só o template vira chaves');
});

test('leituraInteiraPermitida: o arquivo inteiro só de caminho comum, e o template só com projeção', () => {
  assert.equal(leituraInteiraPermitida('src/a.js'), true);
  assert.equal(leituraInteiraPermitida('.env.example'), false);
  assert.equal(leituraInteiraPermitida('.env.example', { id: 'p' }), true);
  assert.equal(leituraInteiraPermitida('.env.dev', { id: 'p' }), false);
  assert.equal(leituraInteiraPermitida('.ssh/id_rsa', { id: 'p' }), false);
});

/* ---------- o nome que o deny não casa ---------- */

// As regras de `permissions.deny` do Claude Code seguem o gitignore: padrão sem barra casa
// QUALQUER componente do caminho em qualquer profundidade (arquivo ou diretório: `.env.d/prod.env`
// cai pelo `.env.d`), e `*` casa qualquer trecho do nome. O teste avalia o caminho inteiro. Medido em 06/11/2026
// no CLI 2.1.308: `Read(.env.*)` recusou `.../pr-scope/<pr>/.env.example` (caminho absoluto, fora
// do projeto) e aceitou `_.env.example.redigido`.
const REGRAS_DE_DENY = ['.env', '.env.*', '.env*', '**/.env*', '*.env', '.secrets'];
function casaDeny(caminho) {
  return caminho.split('/').some((componente) => REGRAS_DE_DENY.some((regra) => {
    const padrao = regra.replace(/^\*\*\//, '');
    const re = new RegExp(`^${padrao.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
    return re.test(componente);
  }));
}

const PROTEGIDOS = ['.env', '.env.example', 'apps/web/.env.local', 'deploy/prod.env', 'env.production', '.env.production.local',
  '.env.d/prod.env', '.envs/.production/.django', 'config/.env/dev', 'a%2Fb/.env', 'x/%25/.env.local'];

test('o nome original casa o deny do usuário e o nome redigido não', () => {
  for (const original of PROTEGIDOS) {
    assert.equal(casaDeny(original) || original === 'env.production', true, `${original} deveria casar ao menos uma regra`);
    const redigido = nomeMaterializado(original);
    assert.equal(casaDeny(redigido), false, `${redigido} não pode casar o deny`);
    assert.equal(redigido.split('/')[0], PASTA_REDIGIDA);
    assert.equal(redigido.split('/').length, 2, `${redigido}: nenhum diretório do caminho original sobra no disco`);
    assert.ok(redigido.endsWith('.redigido'));
    assert.equal(caminhoDoPr(redigido), original, 'o nome redigido volta ao caminho do PR');
  }
});

test('caminho comum fica onde está, e o protegido lido no lugar comum não vira cobertura', () => {
  assert.equal(nomeMaterializado('src/a.js'), 'src/a.js');
  assert.equal(caminhoDoPr('src/a.js'), 'src/a.js');
  assert.equal(caminhoDoPr('.env.example'), null, 'no lugar comum nada foi escrito');
  assert.equal(caminhoDoPr('apps/.env'), null);
  for (const torto of [`${PASTA_REDIGIDA}`, `${PASTA_REDIGIDA}/x.js`, `${PASTA_REDIGIDA}/_.redigido`, `${PASTA_REDIGIDA}/_src.js.redigido`, '',
    `${PASTA_REDIGIDA}/.env.d/_prod.env.redigido`, `${PASTA_REDIGIDA}/_.env.d%2fprod.env.redigido`, `${PASTA_REDIGIDA}/_%2E.env.redigido`]) {
    assert.equal(caminhoDoPr(torto), null, torto);
  }
});

test('o diretório materializado grava a projeção só no nome redigido e o mapeia de volta', () => {
  const root = path.join(FAROL_HOME, 'escopo-redigido');
  const r = materializeScope(root, [
    { path: 'src/a.js', patch: PATCH_COMUM, status: 'modified' },
    { path: 'apps/web/.env.example', patch: '# projeção\n+DEBUG=true\n', status: 'modified' },
    { path: `${PASTA_REDIGIDA}/colide.js`, patch: PATCH_COMUM, status: 'added' },
  ]);
  assert.deepEqual(r.total, ['src/a.js', 'apps/web/.env.example', `${PASTA_REDIGIDA}/colide.js`]);
  assert.deepEqual(r.redigidos, { 'apps/web/.env.example': `${PASTA_REDIGIDA}/_apps%2Fweb%2F.env.example.redigido` });
  assert.equal(fs.existsSync(path.join(root, 'apps', 'web', '.env.example')), false, 'nada no nome original');
  const redigido = arquivoMaterializado(root, 'apps/web/.env.example');
  assert.equal(redigido, path.join(root, PASTA_REDIGIDA, '_apps%2Fweb%2F.env.example.redigido'));
  assert.equal(fs.readFileSync(redigido, 'utf8'), '# projeção\n+DEBUG=true\n');
  assert.equal(fs.existsSync(path.join(root, PASTA_REDIGIDA, 'colide.js')), false, 'colisão com a pasta redigida não é escrita');
  assert.equal(prPathFromRead(root, redigido), 'apps/web/.env.example');
  assert.equal(prPathFromRead(root, path.join(root, 'apps', 'web', '.env.example')), null);
  assert.equal(prPathFromRead(root, path.join(root, 'src', 'a.js')), 'src/a.js');
  const bloco = scopeBlock(r);
  assert.match(bloco, /PROTEGIDO/);
  assert.match(bloco, /_farol_redigido_\/_apps%2Fweb%2F\.env\.example\.redigido/);
  assert.match(bloco, /PROIBIDO/);
  assert.equal(blocoDosRedigidos({}), '');
});

/* ---------- a prova de leitura do protegido ---------- */

function fixture(root, batched = false) {
  const review = { scopeRoot: root, filesRead: new Set() };
  const opts = { id: 'rev' };
  const engine = { config: { reviewBatchedReads: batched }, activeReviews: new Map([[opts.id, review]]) };
  const request = (file, id) => {
    const block = { type: 'tool_use', name: 'Read', id, input: { file_path: file } };
    observeReadEvent(engine, opts, { type: 'assistant', parent_tool_use_id: null, message: { content: [block] } });
    observarLeitura(engine, opts, block);
  };
  const response = (file, id, lines) => {
    observeReadEvent(engine, opts, { type: 'user', parent_tool_use_id: null,
      tool_use_result: { type: 'text', file: { filePath: file, content: lines.join('\n'), startLine: 1, numLines: lines.length, totalLines: lines.length } },
      message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: false, content: lines.map((l, i) => ` ${i + 1}→${l}`).join('\n') }] } });
  };
  return { engine, opts, review, request, response };
}

test('a leitura da projeção redigida é conferida e credita o caminho do PR', () => {
  const root = path.join(FAROL_HOME, 'prova');
  materializeScope(root, [{ path: '.env.example', patch: 'linha um\nlinha dois\n', status: 'modified' }]);
  const f = fixture(root);
  const redigido = arquivoMaterializado(root, '.env.example');
  f.request(redigido, 'r1');
  f.response(redigido, 'r1', ['linha um', 'linha dois']);
  assert.deepEqual([...leiturasProvadas(f.engine, 'rev')], ['.env.example']);
  assert.deepEqual([...f.review.filesRead], ['.env.example']);
});

test('o pedido no nome original, que o deny recusa, não credita nada', () => {
  const root = path.join(FAROL_HOME, 'prova-original');
  materializeScope(root, [{ path: '.env.example', patch: 'linha um\n', status: 'modified' }]);
  const f = fixture(root);
  f.request(path.join(root, '.env.example'), 'r1');
  assert.equal(f.review.filesRead.size, 0, 'nem a regra do Read credita o lugar onde nada foi escrito');
  assert.equal(leiturasProvadas(f.engine, 'rev').size, 0);
  assert.equal(leiturasProvadas({ activeReviews: new Map() }, 'x').size, 0);
});

test('o protegido declarado como lido sem leitura observada é lacuna de cobertura', () => {
  const atuais = [{ path: 'docs/a.md', sha: 'a1', status: 'modified' }, { path: '.env.example', sha: 'e1', status: 'modified' }];
  const declarado = () => ({ coverage: { total: 2, reviewed: ['docs/a.md', '.env.example'], missing: [] } });
  const semProva = declarado();
  prepararCoberturaParaOGate(semProva, atuais, { ativa: false, unchanged: [], changed: [] }, new Set(['docs/a.md']));
  assert.deepEqual(semProva.protegidosSemLeitura, ['.env.example']);
  assert.deepEqual(semProva.protegidosObservados, []);
  assert.deepEqual(coverageGap(semProva), ['caminho protegido sem leitura observada da projeção redigida: .env.example']);
  const comProva = declarado();
  prepararCoberturaParaOGate(comProva, atuais, { ativa: false, unchanged: [], changed: [] }, new Set(['.env.example']));
  assert.deepEqual(comProva.protegidosSemLeitura, []);
  assert.deepEqual(comProva.protegidosObservados, ['.env.example']);
  assert.deepEqual(coverageGap(comProva), []);
  const semMedicao = declarado();
  prepararCoberturaParaOGate(semMedicao, null, { ativa: false, unchanged: [], changed: [] });
  assert.equal(semMedicao.protegidosSemLeitura, undefined, 'sem o diff medido não há o que conferir');
});

test('o protegido só herda cobertura quando a prova anterior diz que a leitura foi observada', () => {
  const atuais = [{ path: '.env.example', sha: 'e1', status: 'modified' }, { path: 'src/a.js', sha: 'a1', status: 'modified' }];
  const files = atuais.map((f) => ({ ...f, lines: 2 }));
  const antiga = { head: 'h1', files, reviewed: ['.env.example', 'src/a.js'] };
  assert.deepEqual(splitByProof(atuais, antiga).unchanged, ['src/a.js'], 'prova sem a lista não herda o protegido');
  const observada = { ...antiga, observados: ['.env.example'] };
  assert.deepEqual(splitByProof(atuais, observada).unchanged.sort(), ['.env.example', 'src/a.js']);
  // herdado nesta rodada não é lacuna
  const result = { coverage: { total: 2, reviewed: ['src/a.js'], missing: ['.env.example'] } };
  prepararCoberturaParaOGate(result, atuais, { ativa: true, unchanged: ['.env.example'], changed: ['src/a.js'] }, new Set());
  assert.deepEqual(result.protegidosSemLeitura, []);
  assert.deepEqual(result.coverage.inherited, ['.env.example']);
});

test('a prova gravada guarda os observados e tira o protegido que ninguém leu', () => {
  const pr = { key: 'o/r#9' };
  const arquivos = [{ path: '.env.example', sha: 'e1', status: 'modified', lines: 2 }, { path: 'src/a.js', sha: 'a1', status: 'modified', lines: 2 }];
  const result = { coverage: { reviewed: ['.env.example', 'src/a.js'] }, protegidosSemLeitura: ['.env.example'], protegidosObservados: [] };
  salvarProvaDaSessao(pr, 'h2', arquivos, result);
  const prova = readFileProof(pr.key);
  assert.deepEqual(prova.reviewed, ['src/a.js']);
  assert.deepEqual(prova.observados, []);
  const lida = { coverage: { reviewed: ['.env.example', 'src/a.js'] }, protegidosSemLeitura: [], protegidosObservados: ['.env.example'] };
  salvarProvaDaSessao(pr, 'h3', arquivos, lida);
  assert.deepEqual(readFileProof(pr.key).observados, ['.env.example']);
});

/* ---------- as guardas da sessão ---------- */

test('a sessão de revisão recebe o arquivo de guardas por --settings, e ele só nega as rotas do patch cru', () => {
  const args = guardasDaSessao();
  assert.equal(args[0], '--settings');
  assert.equal(args[1], `"${ARQUIVO_DE_GUARDAS}"`);
  assert.ok(fs.existsSync(ARQUIVO_DE_GUARDAS), ARQUIVO_DE_GUARDAS);
  const guardas = parseJson(fs.readFileSync(ARQUIVO_DE_GUARDAS, 'utf8'));
  assert.deepEqual(Object.keys(guardas), ['permissions']);
  assert.deepEqual(Object.keys(guardas.permissions), ['deny'], 'só deny: allow por aqui ampliaria o que a sessão pode');
  for (const regra of ['Bash(gh pr diff*)', 'Bash(gh api *pulls/*/files*)', 'Bash(gh api *tarball*)', 'Bash(gh repo clone*)']) {
    assert.ok(guardas.permissions.deny.includes(regra), regra);
  }
  const semeado = parseJson(fs.readFileSync(path.join(path.dirname(ARQUIVO_DE_GUARDAS), 'settings.json'), 'utf8'));
  assert.deepEqual(semeado.permissions.deny, guardas.permissions.deny, 'o settings semeado e as guardas dizem o mesmo');
});

test('caminhoProtegido continua a régua de sempre', () => {
  for (const p of ['.env', '.env.example', 'a/.ssh/x', 'secrets.yaml', 'x.pem']) assert.equal(caminhoProtegido(p), true, p);
  for (const p of ['src/env.ts', 'README.md', '']) assert.equal(caminhoProtegido(p), false, p);
});

/* ---------- pontos da revisão de 06/11/2026 ---------- */

test('sem herança ativa, coverage.inherited escrito pelo modelo não dispensa a leitura do protegido', () => {
  // caso reproduzido no review: reviewed e inherited declarados, nenhuma leitura observada
  const forjado = { coverage: { reviewed: ['.env.example'], inherited: ['.env.example'] } };
  prepararCoberturaParaOGate(forjado, [{ path: '.env.example' }], { ativa: false }, new Set());
  assert.deepEqual(forjado.protegidosSemLeitura, ['.env.example']);
  assert.match(coverageGap(forjado).join(' | '), /caminho protegido sem leitura observada da projeção redigida: \.env\.example/);
  // herança ativa que NÃO traz o protegido entre os inalterados também não dispensa
  const outro = { coverage: { reviewed: ['.env.example'], inherited: ['.env.example'], missing: [] } };
  prepararCoberturaParaOGate(outro, [{ path: '.env.example', sha: 'e1' }, { path: 'src/a.js', sha: 'a1' }],
    { ativa: true, unchanged: ['src/a.js'], changed: ['.env.example'] }, new Set());
  assert.deepEqual(outro.protegidosSemLeitura, ['.env.example']);
});

test('rename de arquivo de ambiente para template público continua protegido na execução restrita', () => {
  // every(isSourceTemplate): basta um dos lados não ser template para o patch não chegar
  const projection = { id: 'p', version: 1, project: () => ({ text: '', digest: '', redactions: [] }) };
  const v = politicaDoPatch('.env.example', '.env.dev', PATCH_ENV, projection);
  assert.equal(v.template, false);
  assert.equal(v.sensitivePath, true);
  assert.equal(v.politica, 'protected-path');
  assert.equal(v.patchAvailable, false);
  assert.equal(politicaDoPatch('.env.sample', '.env.example', PATCH_ENV, projection).politica, 'template-keys', 'os dois lados template');
});

function leitorDeFixture(entradas) {
  const texto = 'SEGREDO_CRU=valor\n';
  const H = 'a'.repeat(40), blob = blobHash(Buffer.from(texto));
  const guardado = new Map([
    [`tree:${H}`, { commit: H, tree: 'c'.repeat(40), truncated: false,
      entries: entradas.map((p) => ({ path: p, blob, type: 'blob', mode: '100644', size: texto.length, readable: true })) }],
    [`blob:${blob}`, { blob, size: texto.length, content: Buffer.from(texto).toString('base64'), cacheable: false }],
  ]);
  const store = { root: 'fixture', metrics: { acquisitions: 0 }, get: async (k) => guardado.get(k) || null, put: async () => {} };
  const manifest = { H, B: H, M: H, files: [] };
  return makeReader({}, { repo: 'o/r' }, manifest, store, null, { limits: { maxFiles: 100, maxFileBytes: 1e6 } });
}

test('o leitor do arquivo inteiro recusa caminho protegido mesmo fora do manifesto, antes de tocar a árvore', async () => {
  const leitor = leitorDeFixture(['.env', 'deploy/prod.env', 'src/a.js']);
  for (const protegido of ['.env', 'deploy/prod.env']) {
    const r = await leitor.read(protegido);
    assert.equal(r.status, 'excluded', protegido);
    assert.equal(r.text, null);
  }
  assert.equal((await leitor.read('src/a.js')).status, 'available', 'caminho comum segue legível');
});

test('a prova pela fonte restrita só credita caminho dentro da raiz do escopo', () => {
  const root = path.join(FAROL_HOME, 'fonte-restrita', 'patches');
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, '..', 'fora.txt'), 'linha\n');
  fs.writeFileSync(path.join(root, 'dentro.txt'), 'linha\n');
  const review = { scopeRoot: root, filesRead: new Set() };
  const engine = { config: {}, activeReviews: new Map([['rev', review]]) };
  const entrega = (p) => observeSourceResult(engine, { id: 'rev' }, { path: p, text: 'linha', start: 1, count: 1 }, ' 1→linha');
  entrega('../fora.txt');
  assert.equal(leiturasProvadas(engine, 'rev').size, 0, 'arquivo fora da raiz nunca vira prova');
  entrega('dentro.txt');
  assert.deepEqual([...leiturasProvadas(engine, 'rev')], ['dentro.txt']);
});

test('a autoanálise só conta o protegido como lido com a entrega conferida', () => {
  const root = path.join(FAROL_HOME, 'prova-self');
  materializeScope(root, [{ path: '.env.example', patch: 'linha um\n', status: 'modified' }, { path: 'src/a.js', patch: PATCH_COMUM, status: 'modified' }]);
  const f = fixture(root);
  f.request(arquivoMaterializado(root, '.env.example'), 'r1');
  assert.deepEqual([...f.review.filesRead], ['.env.example'], 'a regra do Read viu o pedido');
  f.review.filesRead.add('src/a.js');
  assert.deepEqual([...lidosComProtegidoProvado(f.engine, 'rev', f.review.filesRead)], ['src/a.js'], 'pedido sem entrega conferida não conta');
  f.response(arquivoMaterializado(root, '.env.example'), 'r1', ['linha um']);
  assert.deepEqual([...lidosComProtegidoProvado(f.engine, 'rev', f.review.filesRead)].sort(), ['.env.example', 'src/a.js']);
  assert.equal(lidosComProtegidoProvado(f.engine, 'rev', undefined).size, 0);
});

// Matcher das regras `Bash(...)` de deny: `*` casa qualquer trecho, inclusive espaço e aspas.
function negado(regras, comando) {
  return regras.some((regra) => {
    const corpo = regra.replace(/^Bash\(/, '').replace(/\)$/, '');
    const re = new RegExp(`^${corpo.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
    return re.test(comando);
  });
}

test('as guardas recusam o diff pedido por cabeçalho e deixam as leituras do protocolo', () => {
  const { deny } = parseJson(fs.readFileSync(ARQUIVO_DE_GUARDAS, 'utf8')).permissions;
  for (const cru of [
    'gh api repos/o/r/pulls/7 -H "Accept: application/vnd.github.diff"',
    "gh api repos/o/r/pulls/7 -H 'Accept: application/vnd.github.patch'",
    'gh api repos/o/r/pulls/7 --header "Accept: application/vnd.github.v3.diff"',
    'gh api -H "Accept: application/vnd.github.v3.patch" repos/o/r/commits/abc',
    'gh pr diff 7 --repo o/r', 'gh api repos/o/r/pulls/7/files --paginate', 'gh api repos/o/r/tarball/main',
  ]) assert.equal(negado(deny, cru), true, cru);
  for (const legitimo of [
    'gh api "repos/o/r/contents/src/a.js?ref=abc" --jq .content',
    'gh pr view 7 --repo o/r --json files --jq .files[].path',
    'gh api repos/o/r/pulls/7/reviews',
    'gh api repos/o/r/pulls/7 -H "Accept: application/vnd.github+json"',
  ]) assert.equal(negado(deny, legitimo), false, legitimo);
});

test('caminho protegido não entra no índice entre PRs nem herda de lá: declaração de outro PR não é leitura observada', async () => {
  const repoProof = await import('../lib/engine/prova-do-repositorio.js');
  const H1 = '1'.repeat(40);
  const env = { path: '.env.example', sha: 'se', status: 'modified', patch: '+DEBUG=true', patchStatus: 'available' };
  const comum = { path: 'src/a.js', sha: 'sa', status: 'modified', patch: PATCH_COMUM, patchStatus: 'available' };
  repoProof.registrarNoIndiceDoRepositorio({ key: 'o/idx#1', repo: 'o/idx' }, H1, [env, comum],
    { coverage: { reviewed: ['.env.example', 'src/a.js'], missing: [] } }, {});
  assert.deepEqual(Object.values(repoProof.lerIndiceDoRepositorio('o/idx')).map((e) => e.caminho), ['src/a.js']);
  // índice forjado com o protegido também não herda
  const forjada = { [repoProof.chaveDoArquivo(env)]: { caminho: env.path, pr: 'o/idx#1', head: H1, at: Date.now(), status: 'modified' } };
  assert.deepEqual(repoProof.herancaDoRepositorio({ key: 'o/idx#2' }, [env], forjada, []).unchanged, []);
  const renomeado = { ...comum, path: 'config/app.txt', previousPath: '.env' };
  const forjadaRename = { [repoProof.chaveDoArquivo(renomeado)]: { caminho: renomeado.path, pr: 'o/idx#1', head: H1, at: Date.now(), status: 'modified' } };
  assert.deepEqual(repoProof.herancaDoRepositorio({ key: 'o/idx#2' }, [renomeado], forjadaRename, []).unchanged, [], 'rename vindo de protegido também');
});

test('rename vindo de caminho protegido: inventário, prova por arquivo e índice entre PRs olham os dois lados', async () => {
  const { parseFilesStdout } = await import('../lib/engine/pr-inventory.js');
  const repoProof = await import('../lib/engine/prova-do-repositorio.js');
  const medidos = parseFilesStdout(JSON.stringify([{ path: 'config.txt', sha: 'sc', status: 'renamed', lines: 2, previousPath: '.env.example' },
    { path: 'src/a.js', sha: 'sa', status: 'modified', lines: 2 }]));
  assert.equal(medidos[0].previousPath, '.env.example', 'o inventário não perde o lado de antes');
  assert.equal(Object.hasOwn(medidos[1], 'previousPath'), false, 'arquivo comum mantém a forma de sempre');
  // prova por arquivo sem a leitura observada não herda o destino do rename
  const prova = { head: 'h1', files: medidos, reviewed: ['config.txt', 'src/a.js'] };
  assert.deepEqual(splitByProof(medidos, prova).unchanged, ['src/a.js']);
  assert.deepEqual(splitByProof(medidos, { ...prova, observados: ['config.txt'] }).unchanged.sort(), ['config.txt', 'src/a.js']);
  // o destino do rename declarado sem leitura observada é lacuna
  const result = { coverage: { reviewed: ['config.txt', 'src/a.js'], missing: [] } };
  prepararCoberturaParaOGate(result, medidos, { ativa: false }, new Set());
  assert.deepEqual(result.protegidosSemLeitura, ['config.txt']);
  // e não entra no índice entre PRs
  const H1 = '2'.repeat(40);
  const comPatch = [{ path: 'config.txt', previousPath: '.env.example', sha: 'sc', status: 'renamed', patch: '+X=1', patchStatus: 'available' },
    { path: 'src/a.js', sha: 'sa', status: 'modified', patch: PATCH_COMUM, patchStatus: 'available' }];
  repoProof.registrarNoIndiceDoRepositorio({ key: 'o/ren#1', repo: 'o/ren' }, H1, comPatch, { coverage: { reviewed: ['config.txt', 'src/a.js'], missing: [] } }, {});
  assert.deepEqual(Object.values(repoProof.lerIndiceDoRepositorio('o/ren')).map((e) => e.caminho), ['src/a.js']);
});

test('lidosComProtegidoProvado usa os metadados do diff para o rename vindo de protegido', () => {
  const engine = { activeReviews: new Map() };
  const lidos = new Set(['config.txt', 'src/a.js']);
  assert.deepEqual([...lidosComProtegidoProvado(engine, 'x', lidos, [{ path: 'config.txt', previousPath: '.env.example' }, { path: 'src/a.js' }])], ['src/a.js']);
  assert.deepEqual([...lidosComProtegidoProvado(engine, 'x', lidos, [{ path: 'config.txt', previousPath: 'docs/old.txt' }])].sort(), ['config.txt', 'src/a.js']);
});
