// CODEOWNERS: quem é AUTORIDADE sobre cada arquivo do PR (v2.51.0). Tudo PURO,
// então dá pra provar sem rede. Os casos usam os CODEOWNERS REAIS medidos em
// 20/08/2026, porque a feature nasceu de um furo achado em produção: sair de cena
// porque alguém está revisando tratava aprovação como fungível, e ela não é.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const co = (await import('../lib/engine/codeowners.js')).default;
const { parseCodeowners, ownersForPath, souAutoridade, cobreMinhaExigencia } = co;

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

/* ---------- autoridade ---------- */

test('souAutoridade: caixa do login não importa', () => {
  assert.equal(souAutoridade(ENGINE_AI, ['src/x.ts'], 'alexpraxedes'), true);
  assert.equal(souAutoridade(ENGINE_AI, ['src/x.ts'], 'ALEXPRAXEDES'), true);
  assert.equal(souAutoridade(ENGINE_AI, ['src/x.ts'], 'thiagocarvalho-dev'), false);
});

/* ---------- a pergunta que decide a saída de cena ----------
   Os quatro casos reais que a feature existe pra acertar. */

test('front: Thiago pega, Wanderson pode sair (mesma linha, CODEOWNERS é OU)', () => {
  const arquivos = ['src/app.tsx', 'src/components/Botao.tsx'];
  assert.equal(cobreMinhaExigencia(FRONTEND, arquivos, 'wandersonbiuder', 'thiagocarvalho-dev'), true);
});

test('front: Alex pega, Wanderson NÃO pode sair (Alex não é dono do *)', () => {
  const arquivos = ['src/app.tsx'];
  assert.equal(cobreMinhaExigencia(FRONTEND, arquivos, 'wandersonbiuder', 'Alexpraxedes'), false);
});

// o PR mexe em package.json (dono: Alex) E em código (dono: Wanderson/Thiago).
// Thiago não cobre o package.json, então o Farol do Alex tem que revisar.
test('front: PR que mexe no package.json, Thiago pega, Alex NÃO pode sair', () => {
  const arquivos = ['src/app.tsx', 'package.json'];
  assert.equal(cobreMinhaExigencia(FRONTEND, arquivos, 'Alexpraxedes', 'thiagocarvalho-dev'), false);
});

// o caso medido no #60: quem se calou era o dono do repo inteiro
test('engine-ai: Thiago pega, Alex NÃO pode sair (era o bug do #60)', () => {
  assert.equal(cobreMinhaExigencia(ENGINE_AI, ['src/x.ts'], 'Alexpraxedes', 'thiagocarvalho-dev'), false);
});

test('quem não é dono de nada pode sair de cena (não há exigência a preservar)', () => {
  assert.equal(cobreMinhaExigencia(ENGINE_AI, ['src/x.ts'], 'guilherme-lima-dev', 'thiagocarvalho-dev'), true);
});

test('repo sem CODEOWNERS: ninguém é exigido, então pode sair', () => {
  assert.equal(cobreMinhaExigencia([], ['src/x.ts'], 'ana', 'bia'), true);
});

// limite declarado: time não dá pra resolver sem outra chamada de rede, então
// arquivo com dono de time é inconclusivo e cai sempre no lado seguro
test('dono que é TIME torna a análise inconclusiva (nunca sai de cena)', () => {
  const comTime = parseCodeowners('* @biudtech/squad-engine');
  assert.equal(cobreMinhaExigencia(comTime, ['src/x.ts'], 'ana', 'bia'), false);
  assert.equal(co.temDonoDeTime(comTime, ['src/x.ts']), true);
});

test('time em UM arquivo contamina a decisão do PR inteiro (conservador)', () => {
  const regras = parseCodeowners('* @ana\ninfra/ @biudtech/plataforma');
  assert.equal(cobreMinhaExigencia(regras, ['src/x.ts'], 'ana', 'ana'), true, 'sem tocar infra, resolve normal');
  assert.equal(cobreMinhaExigencia(regras, ['src/x.ts', 'infra/a.yaml'], 'ana', 'ana'), false);
});
