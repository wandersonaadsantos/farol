// Roteador de modelo por custo-benefício (lib/engine/model-router.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isAutoModel, escolheModelo, rotuloOrigem, parseAutoOpus,
  PEQUENO_LINHAS, PEQUENO_ARQUIVOS, MEDIO_LINHAS, MEDIO_ARQUIVOS,
} from '../lib/engine/model-router.js';

test('isAutoModel: só a string auto (caixa ignorada)', () => {
  assert.equal(isAutoModel('auto'), true);
  assert.equal(isAutoModel('AUTO'), true);
  assert.equal(isAutoModel(' auto '), true);
  assert.equal(isAutoModel('sonnet'), false);
  assert.equal(isAutoModel(''), false);
  assert.equal(isAutoModel(null), false);
});

test('escolheModelo: modelo pinado devolve a config, sem olhar métricas', () => {
  const r = escolheModelo({ lines: 50, changedFiles: 2 }, {
    reviewModel: 'opus', reviewEffort: 'xhigh', reviewFast: true,
  });
  assert.deepEqual(r, { model: 'opus', effort: 'xhigh', fast: true, origem: 'config' });
});

test('escolheModelo: auto + PR pequeno -> haiku + fast', () => {
  const r = escolheModelo(
    { lines: PEQUENO_LINHAS - 1, changedFiles: PEQUENO_ARQUIVOS - 1 },
    { reviewModel: 'auto' },
  );
  assert.equal(r.model, 'haiku');
  assert.equal(r.effort, '');
  assert.equal(r.fast, true);
  assert.equal(r.origem, 'auto-pequeno');
});

test('escolheModelo: auto + PR médio -> sonnet', () => {
  const r = escolheModelo(
    { lines: 400, changedFiles: 10 },
    { reviewModel: 'auto', reviewFast: false },
  );
  assert.equal(r.model, 'sonnet');
  assert.equal(r.effort, 'medium');
  assert.equal(r.fast, false);
  assert.equal(r.origem, 'auto-medio');
});

test('escolheModelo: auto + PR grande (limiar fan-out) -> sonnet high, com o gatilho de PR muito grande desligado', () => {
  const r = escolheModelo(
    { lines: MEDIO_LINHAS, changedFiles: 3 },
    { reviewModel: 'auto', autoOpus: { prMuitoGrande: false } },
  );
  assert.equal(r.model, 'sonnet');
  assert.equal(r.effort, 'high');
  assert.equal(r.fast, false);
  assert.equal(r.origem, 'auto-grande');
});

test('escolheModelo: auto + muitos arquivos também é grande', () => {
  const r = escolheModelo(
    { lines: 100, changedFiles: MEDIO_ARQUIVOS },
    { reviewModel: 'auto', autoOpus: { prMuitoGrande: false } },
  );
  assert.equal(r.origem, 'auto-grande');
});

test('escolheModelo: auto sem métrica degrada pra sonnet (nunca haiku)', () => {
  const r = escolheModelo(null, { reviewModel: 'auto' });
  assert.equal(r.model, 'sonnet');
  assert.equal(r.effort, 'medium');
  assert.equal(r.fast, false);
  assert.equal(r.origem, 'auto-sem-metrica');
});

test('escolheModelo: auto no médio herda reviewFast da config', () => {
  const r = escolheModelo(
    { lines: 300, changedFiles: 8 },
    { reviewModel: 'auto', reviewFast: true },
  );
  assert.equal(r.origem, 'auto-medio');
  assert.equal(r.fast, true);
});

test('rotuloOrigem: cobre as origens conhecidas', () => {
  assert.match(rotuloOrigem('auto-pequeno'), /haiku/i);
  assert.match(rotuloOrigem('auto-grande'), /sonnet/i);
  assert.equal(rotuloOrigem('config'), 'modelo fixo da configuração');
});

/* ---------- contexto que sobe para o Opus (25/09/2026) ---------- */

const ARQ = (...caminhos) => caminhos.map((path) => ({ path, lines: 10 }));
const MEDIO_COM = (...caminhos) => ({ lines: 300, changedFiles: caminhos.length, files: ARQ(...caminhos) });

test('repositório crítico sobe para Opus médio, e o rótulo diz qual', () => {
  const r = escolheModelo(MEDIO_COM('src/a.js'), { reviewModel: 'auto', autoOpus: { reposCriticos: ['Acme-Exemplo/Infra'] } }, { repo: 'acme-exemplo/infra' });
  assert.deepEqual({ model: r.model, effort: r.effort, fast: r.fast, origem: r.origem }, { model: 'opus', effort: 'medium', fast: false, origem: 'auto-contexto' });
  assert.equal(rotuloOrigem(r.origem, r.gatilho), 'auto: repositório crítico acme-exemplo/infra, opus');
});

test('caminho sensível da lista inicial sobe para Opus, com o arquivo no rótulo', () => {
  const r = escolheModelo(MEDIO_COM('src/a.js', 'deploy/k8s/app.yaml'), { reviewModel: 'auto' }, { repo: 'acme-exemplo/app' });
  assert.equal(r.model, 'opus');
  assert.equal(rotuloOrigem(r.origem, r.gatilho), 'auto: caminho sensível deploy/k8s/app.yaml, opus');
});

test('padrão de caminho segue o CODEOWNERS: *.tf em qualquer pasta, **/*auth* no nome', () => {
  const cfg = { reviewModel: 'auto', autoOpus: { caminhosSensiveis: ['*.tf', '**/*auth*'], prMuitoGrande: false } };
  assert.equal(escolheModelo(MEDIO_COM('infra/rede/main.tf'), cfg).model, 'opus');
  assert.equal(escolheModelo(MEDIO_COM('src/middleware/oauth.js'), cfg).model, 'opus');
  assert.equal(escolheModelo(MEDIO_COM('src/tela.js'), cfg).model, 'sonnet');
});

test('PR muito grande sobe para Opus no padrão, e desligado volta ao Sonnet alto', () => {
  const grande = { lines: MEDIO_LINHAS, changedFiles: 3, files: ARQ('a.js', 'b.js', 'c.js') };
  const ligado = escolheModelo(grande, { reviewModel: 'auto', autoOpus: { caminhosSensiveis: [] } });
  assert.equal(ligado.model, 'opus');
  assert.equal(rotuloOrigem(ligado.origem, ligado.gatilho), `auto: PR muito grande (${MEDIO_LINHAS} linhas, 3 arquivos), opus`);
  const desligado = escolheModelo(grande, { reviewModel: 'auto', autoOpus: { caminhosSensiveis: [], prMuitoGrande: false } });
  assert.equal(desligado.origem, 'auto-grande');
  assert.equal(desligado.model, 'sonnet');
});

test('a ordem é repositório, caminho e tamanho: o primeiro que vale é o citado', () => {
  const r = escolheModelo({ lines: 5000, changedFiles: 2, files: ARQ('k8s/a.yaml') }, { reviewModel: 'auto', autoOpus: { reposCriticos: ['acme-exemplo/infra'] } }, { repo: 'acme-exemplo/infra' });
  assert.equal(r.gatilho.tipo, 'repo');
  const s = escolheModelo({ lines: 5000, changedFiles: 2, files: ARQ('k8s/a.yaml') }, { reviewModel: 'auto' }, { repo: 'acme-exemplo/app' });
  assert.equal(s.gatilho.tipo, 'caminho');
});

test('sem métrica, só o repositório crítico vale; senão fica o Sonnet de sempre', () => {
  const critico = escolheModelo(null, { reviewModel: 'auto', autoOpus: { reposCriticos: ['acme-exemplo/infra'] } }, { repo: 'acme-exemplo/infra' });
  assert.equal(critico.model, 'opus');
  const comum = escolheModelo(null, { reviewModel: 'auto' }, { repo: 'acme-exemplo/app' });
  assert.equal(comum.origem, 'auto-sem-metrica');
  assert.equal(comum.model, 'sonnet');
});

test('nenhum gatilho ligado: o Auto volta a ser só por tamanho', () => {
  const cfg = { reviewModel: 'auto', autoOpus: { reposCriticos: [], caminhosSensiveis: [], prMuitoGrande: false } };
  assert.equal(escolheModelo(MEDIO_COM('k8s/a.yaml'), cfg, { repo: 'acme-exemplo/infra' }).origem, 'auto-medio');
});

test('modelo fixo ignora os gatilhos', () => {
  const r = escolheModelo(MEDIO_COM('k8s/a.yaml'), { reviewModel: 'haiku', autoOpus: { reposCriticos: ['acme-exemplo/infra'] } }, { repo: 'acme-exemplo/infra' });
  assert.equal(r.origem, 'config');
  assert.equal(r.model, 'haiku');
});

test('saneador: ausente é a lista inicial; entrada torta é descartada, não vira outra coisa', () => {
  const padrao = parseAutoOpus(undefined);
  assert.deepEqual(padrao.reposCriticos, []);
  assert.ok(padrao.caminhosSensiveis.includes('k8s/'));
  assert.equal(padrao.prMuitoGrande, true);
  const s = parseAutoOpus({ reposCriticos: ['acme/infra', 'sem-barra', 'a/b/c', ' Acme/Pagamentos '], caminhosSensiveis: ['', '# comentario', 'x'.repeat(201), 'k8s/'], prMuitoGrande: 'sim' });
  assert.deepEqual(s.reposCriticos, ['acme/infra', 'acme/pagamentos']);
  assert.deepEqual(s.caminhosSensiveis, ['k8s/']);
  assert.equal(s.prMuitoGrande, false, 'só liga com true explícito');
  assert.equal(parseAutoOpus({ caminhosSensiveis: Array.from({ length: 150 }, (_, i) => `p${i}/`) }).caminhosSensiveis.length, 100);
});
