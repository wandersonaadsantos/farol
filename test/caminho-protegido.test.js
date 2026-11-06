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
const { observeReadEvent, observarLeitura, leiturasProvadas } = await import('../lib/engine/read-evidence.js');
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

// As regras de `permissions.deny` do Claude Code seguem o gitignore: padrão sem barra casa o
// nome-base em qualquer profundidade, e `*` casa qualquer trecho do nome. Medido em 06/11/2026
// no CLI 2.1.308: `Read(.env.*)` recusou `.../pr-scope/<pr>/.env.example` (caminho absoluto, fora
// do projeto) e aceitou `_.env.example.redigido`.
const REGRAS_DE_DENY = ['.env', '.env.*', '.env*', '**/.env*', '*.env', '.secrets'];
function casaDeny(caminho) {
  const nome = caminho.split('/').at(-1);
  return REGRAS_DE_DENY.some((regra) => {
    const padrao = regra.replace(/^\*\*\//, '');
    const re = new RegExp(`^${padrao.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
    return re.test(nome);
  });
}

const PROTEGIDOS = ['.env', '.env.example', 'apps/web/.env.local', 'deploy/prod.env', 'env.production', '.env.production.local'];

test('o nome original casa o deny do usuário e o nome redigido não', () => {
  for (const original of PROTEGIDOS) {
    assert.equal(casaDeny(original) || original === 'env.production', true, `${original} deveria casar ao menos uma regra`);
    const redigido = nomeMaterializado(original);
    assert.equal(casaDeny(redigido), false, `${redigido} não pode casar o deny`);
    assert.equal(redigido.split('/')[0], PASTA_REDIGIDA);
    assert.ok(redigido.endsWith('.redigido'));
    assert.equal(caminhoDoPr(redigido), original, 'o nome redigido volta ao caminho do PR');
  }
});

test('caminho comum fica onde está, e o protegido lido no lugar comum não vira cobertura', () => {
  assert.equal(nomeMaterializado('src/a.js'), 'src/a.js');
  assert.equal(caminhoDoPr('src/a.js'), 'src/a.js');
  assert.equal(caminhoDoPr('.env.example'), null, 'no lugar comum nada foi escrito');
  assert.equal(caminhoDoPr('apps/.env'), null);
  for (const torto of [`${PASTA_REDIGIDA}`, `${PASTA_REDIGIDA}/x.js`, `${PASTA_REDIGIDA}/_.redigido`, `${PASTA_REDIGIDA}/_src.js.redigido`, '']) {
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
  assert.deepEqual(r.redigidos, { 'apps/web/.env.example': `${PASTA_REDIGIDA}/apps/web/_.env.example.redigido` });
  assert.equal(fs.existsSync(path.join(root, 'apps', 'web', '.env.example')), false, 'nada no nome original');
  const redigido = arquivoMaterializado(root, 'apps/web/.env.example');
  assert.equal(redigido, path.join(root, PASTA_REDIGIDA, 'apps', 'web', '_.env.example.redigido'));
  assert.equal(fs.readFileSync(redigido, 'utf8'), '# projeção\n+DEBUG=true\n');
  assert.equal(fs.existsSync(path.join(root, PASTA_REDIGIDA, 'colide.js')), false, 'colisão com a pasta redigida não é escrita');
  assert.equal(prPathFromRead(root, redigido), 'apps/web/.env.example');
  assert.equal(prPathFromRead(root, path.join(root, 'apps', 'web', '.env.example')), null);
  assert.equal(prPathFromRead(root, path.join(root, 'src', 'a.js')), 'src/a.js');
  const bloco = scopeBlock(r);
  assert.match(bloco, /PROTEGIDO/);
  assert.match(bloco, /_farol_redigido_\/apps\/web\/_\.env\.example\.redigido/);
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
