// CODEOWNERS: quem é AUTORIDADE sobre cada arquivo do PR (v2.51.0). Tudo PURO,
// então dá pra provar sem rede. Os casos usam os CODEOWNERS REAIS medidos em
// 20/08/2026. Desde 28/08/2026 a cobertura de exigência (cobreMinhaExigencia)
// saiu do módulo junto com a regra plana da saída de cena (ver o cabeçalho de
// lib/engine/codeowners.js); o que fica testado é o parse, o casamento de
// padrão e a AUTORIDADE, que segue gateando a co-assinatura.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const co = (await import('../lib/engine/codeowners.js')).default;
const { parseCodeowners, ownersForPath, souAutoridade } = co;

// os dois repos reais que motivaram a feature
const ENGINE_AI = parseCodeowners(`
# Aprovacao de code owner exigida pelo ruleset das linhas continuas
* @Alexpraxedes
`);

const FRONTEND = parseCodeowners(`
*                       @wandersonbiuder @thiagocarvalho-dev
/package.json           @Alexpraxedes
/pnpm-lock.yaml         @Alexpraxedes
**/package.json         @Alexpraxedes
`);

/* ---------- parse ---------- */

test('parseCodeowners: ignora comentário, linha vazia e linha sem dono', () => {
  const r = parseCodeowners('# comentario\n\n*  @ana\nsem-dono-aqui\n/x @bia @zoe\n');
  assert.deepEqual(r, [{ pattern: '*', owners: ['@ana'] }, { pattern: '/x', owners: ['@bia', '@zoe'] }]);
});

test('parseCodeowners: comentário no fim da linha não vira dono', () => {
  assert.deepEqual(parseCodeowners('* @ana # dono de tudo'), [{ pattern: '*', owners: ['@ana'] }]);
});

test('parseCodeowners: entrada vazia ou torta devolve lista vazia', () => {
  assert.deepEqual(parseCodeowners(''), []);
  assert.deepEqual(parseCodeowners(null), []);
});

/* ---------- casamento de padrão ---------- */

test('ownersForPath: `*` casa em qualquer nível', () => {
  assert.deepEqual(ownersForPath(ENGINE_AI, 'src/a/b/c.ts'), ['@Alexpraxedes']);
  assert.deepEqual(ownersForPath(ENGINE_AI, 'README.md'), ['@Alexpraxedes']);
});

// semântica do GitHub: a ÚLTIMA linha que casa vence, não acumula
test('ownersForPath: a última regra que casa vence', () => {
  assert.deepEqual(ownersForPath(FRONTEND, 'src/app.tsx'), ['@wandersonbiuder', '@thiagocarvalho-dev']);
  assert.deepEqual(ownersForPath(FRONTEND, 'package.json'), ['@Alexpraxedes']);
});

test('ownersForPath: `/x` ancora na raiz, `**/x` casa em qualquer nível', () => {
  const regras = parseCodeowners('* @ana\n/package.json @bia\n');
  assert.deepEqual(ownersForPath(regras, 'package.json'), ['@bia'], 'raiz casa');
  assert.deepEqual(ownersForPath(regras, 'apps/web/package.json'), ['@ana'], 'aninhado NÃO casa o ancorado');
  // o front tem a linha **/package.json justamente pra pegar o aninhado
  assert.deepEqual(ownersForPath(FRONTEND, 'apps/web/package.json'), ['@Alexpraxedes']);
});

test('ownersForPath: diretório com barra no fim pega tudo dentro', () => {
  const regras = parseCodeowners('* @ana\ninfra/ @bia\n');
  assert.deepEqual(ownersForPath(regras, 'infra/k8s/deploy.yaml'), ['@bia']);
  assert.deepEqual(ownersForPath(regras, 'infra.md'), ['@ana'], 'nome parecido não é o diretório');
});

test('ownersForPath: extensão casa em qualquer nível', () => {
  const regras = parseCodeowners('* @ana\n*.sql @bia\n');
  assert.deepEqual(ownersForPath(regras, 'db/migrations/001.sql'), ['@bia']);
  assert.deepEqual(ownersForPath(regras, 'db/migrations/001.ts'), ['@ana']);
});

test('ownersForPath: arquivo sem regra que case não tem dono', () => {
  assert.deepEqual(ownersForPath(parseCodeowners('/docs/ @ana'), 'src/x.ts'), []);
});

/* ---------- autoridade (é o que gateia a co-assinatura) ---------- */

test('souAutoridade: caixa do login não importa', () => {
  assert.equal(souAutoridade(ENGINE_AI, ['src/x.ts'], 'alexpraxedes'), true);
  assert.equal(souAutoridade(ENGINE_AI, ['src/x.ts'], 'ALEXPRAXEDES'), true);
  assert.equal(souAutoridade(ENGINE_AI, ['src/x.ts'], 'thiagocarvalho-dev'), false);
});

test('souAutoridade: basta UM arquivo do PR em que eu sou dono', () => {
  assert.equal(souAutoridade(FRONTEND, ['src/app.tsx', 'package.json'], 'Alexpraxedes'), true, 'dono só do package.json ainda é autoridade no PR');
  assert.equal(souAutoridade(FRONTEND, ['src/app.tsx'], 'Alexpraxedes'), false, 'fora do arquivo dele, não é');
});

test('souAutoridade: repo sem CODEOWNERS não tem autoridade nenhuma', () => {
  assert.equal(souAutoridade([], ['src/x.ts'], 'ana'), false);
});

// limite declarado: dono que é TIME não se resolve sem outra chamada de rede,
// então time nunca prova autoridade minha (souDono só olha menção individual)
test('souAutoridade: dono que é TIME não vira autoridade individual', () => {
  const comTime = parseCodeowners('* @biudtech/squad-engine');
  assert.equal(souAutoridade(comTime, ['src/x.ts'], 'ana'), false);
});
