// Roteador do modo Auto (lib/engine/model-router.js).
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

/* ---------- qualidade primeiro (26/09/2026) ----------
   O Auto nunca fica abaixo do Opus fixo: toda faixa é o Opus no esforço herdado, sem modo
   rápido. A auditoria que motivou (Haiku e Sonnet aprovando o que o Opus reprovaria) está
   no comentário de AUTO_POR_FAIXA, em lib/modelos.js. */

const OPUS_FIXO = { model: 'opus', effort: '', fast: false };
const SEM_GATILHO = { reposCriticos: [], caminhosSensiveis: [], prMuitoGrande: false };

test('toda faixa do Auto é o Opus fixo: pequeno, médio, grande e sem métrica', () => {
  const casos = [
    [{ lines: PEQUENO_LINHAS - 1, changedFiles: PEQUENO_ARQUIVOS - 1 }, 'auto-pequeno'],
    [{ lines: 400, changedFiles: 10 }, 'auto-medio'],
    [{ lines: MEDIO_LINHAS, changedFiles: 3 }, 'auto-grande'],
    [{ lines: 100, changedFiles: MEDIO_ARQUIVOS }, 'auto-grande'],
    [null, 'auto-sem-metrica'],
  ];
  for (const [metrics, origem] of casos) {
    const r = escolheModelo(metrics, { reviewModel: 'auto', autoOpus: SEM_GATILHO });
    assert.deepEqual({ model: r.model, effort: r.effort, fast: r.fast }, OPUS_FIXO, origem);
    assert.equal(r.origem, origem);
  }
});

test('o Auto ignora o modo rápido da config: rápido corta a verificação', () => {
  const r = escolheModelo({ lines: 300, changedFiles: 8 }, { reviewModel: 'auto', reviewFast: true, autoOpus: SEM_GATILHO });
  assert.equal(r.fast, false);
});

test('nenhuma faixa do Auto usa Haiku ou Sonnet', () => {
  for (const metrics of [null, { lines: 1, changedFiles: 1 }, { lines: 500, changedFiles: 10 }, { lines: 5000, changedFiles: 80 }]) {
    for (const autoOpus of [undefined, SEM_GATILHO]) {
      assert.doesNotMatch(escolheModelo(metrics, { reviewModel: 'auto', autoOpus }).model, /haiku|sonnet/);
    }
  }
});

test('rotuloOrigem: cobre as origens conhecidas', () => {
  assert.equal(rotuloOrigem('auto-pequeno'), 'auto: PR pequeno, opus');
  assert.equal(rotuloOrigem('auto-grande'), 'auto: PR grande, opus');
  assert.equal(rotuloOrigem('config'), 'modelo fixo da configuração');
});

/* ---------- contexto que sobe o raciocínio (25/09/2026; xhigh desde 26/09/2026) ---------- */

const ARQ = (...caminhos) => caminhos.map((path) => ({ path, lines: 10 }));
const MEDIO_COM = (...caminhos) => ({ lines: 300, changedFiles: caminhos.length, files: ARQ(...caminhos) });

test('repositório crítico sobe o raciocínio do Opus para xhigh, e o rótulo diz qual', () => {
  const r = escolheModelo(MEDIO_COM('src/a.js'), { reviewModel: 'auto', autoOpus: { reposCriticos: ['Acme-Exemplo/Infra'] } }, { repo: 'acme-exemplo/infra' });
  assert.deepEqual({ model: r.model, effort: r.effort, fast: r.fast, origem: r.origem }, { model: 'opus', effort: 'xhigh', fast: false, origem: 'auto-contexto' });
  assert.equal(rotuloOrigem(r.origem, r.gatilho), 'auto: repositório crítico acme-exemplo/infra, opus com esforço xhigh');
});

test('caminho sensível da lista inicial sobe para Opus, com o arquivo no rótulo', () => {
  const r = escolheModelo(MEDIO_COM('src/a.js', 'deploy/k8s/app.yaml'), { reviewModel: 'auto' }, { repo: 'acme-exemplo/app' });
  assert.equal(r.model, 'opus');
  assert.equal(rotuloOrigem(r.origem, r.gatilho), 'auto: caminho sensível deploy/k8s/app.yaml, opus com esforço xhigh');
});

test('padrão de caminho segue o CODEOWNERS: *.tf em qualquer pasta, **/*auth* no nome', () => {
  const cfg = { reviewModel: 'auto', autoOpus: { caminhosSensiveis: ['*.tf', '**/*auth*'], prMuitoGrande: false } };
  assert.equal(escolheModelo(MEDIO_COM('infra/rede/main.tf'), cfg).origem, 'auto-contexto');
  assert.equal(escolheModelo(MEDIO_COM('src/middleware/oauth.js'), cfg).origem, 'auto-contexto');
  assert.equal(escolheModelo(MEDIO_COM('src/tela.js'), cfg).origem, 'auto-medio');
});

test('PR muito grande sobe para xhigh no padrão, e desligado fica no Opus fixo', () => {
  const grande = { lines: MEDIO_LINHAS, changedFiles: 3, files: ARQ('a.js', 'b.js', 'c.js') };
  const ligado = escolheModelo(grande, { reviewModel: 'auto', autoOpus: { caminhosSensiveis: [] } });
  assert.equal(ligado.effort, 'xhigh');
  assert.equal(rotuloOrigem(ligado.origem, ligado.gatilho), `auto: PR muito grande (${MEDIO_LINHAS} linhas, 3 arquivos), opus com esforço xhigh`);
  const desligado = escolheModelo(grande, { reviewModel: 'auto', autoOpus: { caminhosSensiveis: [], prMuitoGrande: false } });
  assert.equal(desligado.origem, 'auto-grande');
  assert.deepEqual({ model: desligado.model, effort: desligado.effort }, { model: 'opus', effort: '' });
});

test('a ordem é repositório, caminho e tamanho: o primeiro que vale é o citado', () => {
  const r = escolheModelo({ lines: 5000, changedFiles: 2, files: ARQ('k8s/a.yaml') }, { reviewModel: 'auto', autoOpus: { reposCriticos: ['acme-exemplo/infra'] } }, { repo: 'acme-exemplo/infra' });
  assert.equal(r.gatilho.tipo, 'repo');
  const s = escolheModelo({ lines: 5000, changedFiles: 2, files: ARQ('k8s/a.yaml') }, { reviewModel: 'auto' }, { repo: 'acme-exemplo/app' });
  assert.equal(s.gatilho.tipo, 'caminho');
});

test('sem métrica, só o repositório crítico vale; senão fica o Opus fixo', () => {
  const critico = escolheModelo(null, { reviewModel: 'auto', autoOpus: { reposCriticos: ['acme-exemplo/infra'] } }, { repo: 'acme-exemplo/infra' });
  assert.equal(critico.effort, 'xhigh');
  const comum = escolheModelo(null, { reviewModel: 'auto' }, { repo: 'acme-exemplo/app' });
  assert.equal(comum.origem, 'auto-sem-metrica');
  assert.deepEqual({ model: comum.model, effort: comum.effort }, { model: 'opus', effort: '' });
});

test('nenhum gatilho ligado: o Auto fica no Opus fixo em todo tamanho', () => {
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

test('kustomize é caminho sensível na lista inicial: overlays e kustomization', () => {
  const cfg = { reviewModel: 'auto' };
  for (const p of ['plataforma/zonas/engine-ai/overlays/hmg/patch-configmap.yaml', 'apps/x/base/kustomization.yaml', 'apps/x/base/app-configmap.yaml']) {
    const r = escolheModelo(MEDIO_COM(p), cfg, { repo: 'acme-exemplo/infra' });
    assert.equal(r.origem, 'auto-contexto', p);
    assert.equal(r.effort, 'xhigh', p);
  }
});
