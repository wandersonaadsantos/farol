import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { medirIntervalos } from '../lib/technical-review/intervalos-dos-achados.js';
import { classificarPorLinhas } from '../lib/technical-review/divida-fora-das-linhas.js';
import { blobHash } from '../lib/review-source/contract.js';

const snapshot = await fs.mkdtemp(path.join(os.tmpdir(), 'farol-intervalos-'));
const HEAD = 'a'.repeat(40);
after(() => fs.rm(snapshot, { recursive: true, force: true }));

const exemplos = [
  { nome: 'comentário de supressão', rule: 'core.suppression.declared', file: 'comentario.ts', linha: 1,
    text: ['/* @ts-expect-error', ' * legado', ' * legado', ' * legado', ' * legado', ' * legado',
      ' * legado', ' * novo motivo incompleto', ' */', 'executar();'].join('\n') },
  { nome: 'chamada de teste suprimido', rule: 'core.suppression.declared', file: 'teste.ts', linha: 1,
    text: ['test.skip(', "  'fluxo',", '  () => {', '    preparar();', '    preparar();', '    preparar();',
      '    preparar();', '    novoFluxo();', '  }', ');'].join('\n') },
  { nome: 'template de unidades escaláveis', rule: 'frontend.component.scalable-units', file: 'classes.tsx', linha: 2,
    text: ['const classe = clsx(', '  `flex', '  relative', '  block', '  mx-auto', '  p-2', '  flex-col',
      '  w-[480px]', '  `', ');'].join('\n') },
  { nome: 'controle canônico em JSX', rule: 'frontend.design-system.canonical-source', file: 'catalogo.tsx', linha: 1,
    text: ['const controle = <button', '  type="button"', '  name="acao"', '  title="ação"', '  id="acao"',
      '  data-local="catalogo"', '  aria-label="ação"', '  onClick={novoFluxo}', '>', '  agir', '</button>;'].join('\n') },
  { nome: 'mock de e2e', rule: 'core.testing.e2e-without-mocks', file: 'e2e.ts', linha: 1,
    text: ['vi.mock(', "  './servico',", '  () => ({', '    antigoA: true,', '    antigoB: true,',
      '    antigoC: true,', '    antigoD: true,', '    novo: true,', '  })', ');'].join('\n') },
  { nome: 'implementação do index', rule: 'frontend.component.index-only-reexports', file: 'index.ts', linha: 1,
    text: ['export const dados = {', '  antigoA: true,', '  antigoB: true,', '  antigoC: true,',
      '  antigoD: true,', '  antigoE: true,', '  antigoF: true,', '  novo: true,', '};'].join('\n') },
];

async function classificar(exemplo, linhaAlterada = 8, extra = {}) {
  await fs.writeFile(path.join(snapshot, exemplo.file), exemplo.text);
  const findings = await medirIntervalos(snapshot, [{ rule: exemplo.rule, file: exemplo.file,
    message: `violacao na linha ${exemplo.linha}: exemplo da ferramenta` }]);
  const inventario = { status: 'complete', headSha: HEAD, files: [{ path: exemplo.file,
    sha: blobHash(Buffer.from(exemplo.text)), status: 'modified', patchStatus: 'available',
    patch: `@@ -${linhaAlterada},1 +${linhaAlterada},1 @@\n-antigo\n+novo\n`, ...extra }] };
  return classificarPorLinhas({ findings, rules: [{ rule: exemplo.rule, verdict: 'fail' }] }, inventario, HEAD);
}

for (const exemplo of exemplos) test(`${exemplo.nome}: mudança longe do início, dentro da construção, continua bloqueando`, async () => {
  assert.ok(8 - exemplo.linha > 3, 'a mudança está além do contexto de três linhas');
  const r = await classificar(exemplo);
  assert.ok(r.findings[0].intervaloVerificado.fim >= 8);
  assert.equal(r.findings[0].foraDasLinhas, undefined);
  assert.equal(r.rules[0].dividaForaDasLinhas, undefined);
});

test('supressor antes de chamada longa não esconde mudança no argumento suprimido', async () => {
  const exemplo = { rule: 'core.suppression.declared', file: 'supressao.ts', linha: 1,
    text: ['// @ts-expect-error', 'executar({', '  a: 1,', '  b: 2,', '  c: 3,', '  d: 4,', '  e: 5,', '  novo: true,', '});'].join('\n') };
  const r = await classificar(exemplo);
  assert.equal(r.findings[0].intervaloVerificado.fim, 9);
  assert.equal(r.findings[0].foraDasLinhas, undefined);
});

test('linha vazia e comentário intermediário não encurtam o alcance da supressão', async () => {
  for (const intervalo of ['', '// nota intermediária']) {
    const exemplo = { rule: 'core.suppression.declared', file: 'intervalo.ts', linha: 1,
      text: ['// @ts-expect-error', intervalo, 'executar({', '  a: 1,', '  b: 2,', '  c: 3,', '  d: 4,', '  novo: true,', '});'].join('\n') };
    const r = await classificar(exemplo);
    assert.equal(r.findings[0].intervaloVerificado.fim, 9);
    assert.equal(r.findings[0].foraDasLinhas, undefined);
  }
});

test('supressor de alcance amplo não recebe intervalo limitado ao primeiro nó', async () => {
  for (const [codigo, marcador] of [
    ['/* eslint-disable no-console */', 'eslint-disable'], ['/* istanbul ignore file */', 'istanbul ignore'],
    ['// @ts-nocheck', '@ts-nocheck'], ["it.only('antigo', () => executar());", '.only'],
  ]) {
    const file = 'amplo.ts';
    await fs.writeFile(path.join(snapshot, file), codigo + '\nexecutar();\n');
    const findings = await medirIntervalos(snapshot, [{ rule: 'core.suppression.declared', file,
      message: `supressor "${marcador}" na linha 1 sem motivo` }]);
    assert.equal(findings[0].intervaloVerificado, undefined, marcador);
  }
});

test('construção antiga inteira fora da mudança continua sendo dívida', async () => {
  const exemplo = { ...exemplos[2], file: 'antiga.tsx', text: exemplos[2].text + '\n\n\n\n\n\nexport const novo = true;' };
  const r = await classificar(exemplo, 17);
  assert.equal(r.findings[0].foraDasLinhas, true);
  assert.equal(r.rules[0].dividaForaDasLinhas, true);
});

test('sintaxe inválida, intervalo de outro blob e regra desconhecida não recebem desconto', async () => {
  const invalido = await classificar({ ...exemplos[2], file: 'invalida.tsx', text: 'const classe = `sem fechamento' }, 30);
  assert.equal(invalido.findings[0].intervaloVerificado, undefined);
  assert.equal(invalido.rules[0].dividaForaDasLinhas, undefined);
  const outroBlob = await classificar(exemplos[2], 30, { sha: 'b'.repeat(40) });
  assert.equal(outroBlob.rules[0].dividaForaDasLinhas, undefined);
  const desconhecida = await classificar({ ...exemplos[2], rule: 'nova.regra' }, 30);
  assert.equal(desconhecida.findings[0].intervaloVerificado, undefined);
  assert.equal(desconhecida.rules[0].dividaForaDasLinhas, undefined);
});

test('arquivo fora do material não é lido para conceder dívida', async () => {
  const findings = await medirIntervalos(snapshot, [{ rule: 'core.suppression.declared', file: '../fora.ts', message: 'violacao na linha 1' }]);
  assert.equal(findings[0].intervaloVerificado, undefined);
});
