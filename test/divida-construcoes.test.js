import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { medirIntervalos } from '../lib/technical-review/intervalos-dos-achados.js';
import { classificarPorLinhas } from '../lib/technical-review/divida-fora-das-linhas.js';
import { blobHash, DEFAULTS } from '../lib/review-source/contract.js';

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
    message: exemplo.message ?? `violacao na linha ${exemplo.linha}: exemplo da ferramenta` }]);
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

// engine-ai#1031 (11/11/2026): controller NestJS com supressor anterior que só desceu de linha porque o
// PR inseriu um import acima. Sem o plugin de decorators o parse falhava e a dívida virava violação.
test('supressor antigo em arquivo com decorators fica como dívida quando a mudança está longe', async () => {
  const text = ["import { Controller, Get } from '@nestjs/common';", "import { novo } from './novo';", '',
    "@Controller('turno')", 'export class TurnoController {', "  @Get(':id')", '  ler(): string {',
    '    // eslint-disable-next-line no-restricted-syntax -- dado plano, validado antes',
    '    return JSON.stringify({ ok: true });', '  }', '}'].join('\n');
  const r = await classificar({ rule: 'core.suppression.declared', file: 'turno.controller.ts', linha: 8, text }, 2);
  assert.deepEqual(r.findings[0].intervaloVerificado && [r.findings[0].intervaloVerificado.inicio, r.findings[0].intervaloVerificado.fim], [8, 9]);
  assert.equal(r.findings[0].foraDasLinhas, true);
  assert.equal(r.rules[0].dividaForaDasLinhas, true);
});

test('supressor em arquivo com decorators continua bloqueando quando a mudança está na construção suprimida', async () => {
  const text = ["import { Controller, Get } from '@nestjs/common';", '', "@Controller('turno')",
    'export class TurnoController {', "  @Get(':id')", '  ler(): string {',
    '    // eslint-disable-next-line no-restricted-syntax -- dado plano, validado antes',
    '    return JSON.stringify({ novo: true });', '  }', '}'].join('\n');
  const r = await classificar({ rule: 'core.suppression.declared', file: 'turno-novo.controller.ts', linha: 7, text }, 8);
  assert.equal(r.findings[0].intervaloVerificado.fim, 8);
  assert.equal(r.findings[0].foraDasLinhas, undefined);
  assert.equal(r.rules[0].dividaForaDasLinhas, undefined);
});

// Com decorators, o comentário entre o decorator e o membro fica preso à chave, não ao método: medido
// só até a chave, ele daria desconto a uma mudança no corpo que ele de fato cobre.
test('supressor entre o decorator e o membro alcança o membro inteiro', async () => {
  const text = ["@Controller('turno')", 'export class TurnoController {', "  @Get(':id')",
    '  /* istanbul ignore next */', '  ler(): string {', '    preparar();', '    return novo();', '  }', '}'].join('\n');
  const r = await classificar({ rule: 'core.suppression.declared', file: 'membro.controller.ts', linha: 4, text }, 7);
  assert.equal(r.findings[0].intervaloVerificado.fim, 8);
  assert.equal(r.findings[0].foraDasLinhas, undefined);
});

test('supressor entre dois decorators de classe alcança a classe inteira', async () => {
  const text = ['@Injectable()', '// @ts-expect-error legado', "@Controller('turno')", 'export class TurnoController {',
    '  ler() {', '    return novo();', '  }', '}'].join('\n');
  const r = await classificar({ rule: 'core.suppression.declared', file: 'classe.controller.ts', linha: 2, text }, 6);
  assert.equal(r.findings[0].intervaloVerificado.fim, 8);
  assert.equal(r.findings[0].foraDasLinhas, undefined);
});

// biud-frontend#1992 (12/11/2026): o w-[334px] já estava na base, e a união de tudo o que começa na linha
// media a div inteira. Como o PR mexeu nos filhos dela, o px antigo virou cobrança do PR. A ferramenta diz
// qual valor viu, e o literal que o contém é a construção que a regra acusa.
const CARTAO = ['<div className="group flex w-[334px] shrink-0">', '  <button', '    onClick={abrir}',
  '    type="button"', '  >', '    {titulo}', '  </button>', '</div>'].join('\n');
const PX = { rule: 'frontend.component.scalable-units', file: 'Cartao.tsx', linha: 1, text: CARTAO,
  message: 'unidade fixa escalavel na linha 1: w-[334px]; use rem ou token escalavel' };

test('unidade fixa antiga no className fica como dívida quando o PR muda só os filhos do elemento', async () => {
  const r = await classificar(PX, 3);
  assert.deepEqual([r.findings[0].intervaloVerificado.inicio, r.findings[0].intervaloVerificado.fim], [1, 1]);
  assert.equal(r.findings[0].foraDasLinhas, true);
  assert.equal(r.rules[0].dividaForaDasLinhas, true);
});

test('unidade fixa continua bloqueando quando o PR muda a linha do className', async () => {
  const r = await classificar({ ...PX, file: 'Cartao2.tsx' }, 1);
  assert.equal(r.findings[0].foraDasLinhas, undefined);
});

test('unidade fixa num literal de várias linhas mede o literal inteiro', async () => {
  const text = ['const classe = clsx(', '  `flex', '  relative', '  w-[480px]', '  `,', ');', 'export const novo = 1;'].join('\n');
  const dentro = await classificar({ rule: 'frontend.component.scalable-units', file: 'clsx.tsx', linha: 2, text,
    message: 'unidade fixa escalavel na linha 2: w-[480px]; use rem ou token escalavel' }, 4);
  assert.deepEqual([dentro.findings[0].intervaloVerificado.inicio, dentro.findings[0].intervaloVerificado.fim], [2, 5]);
  assert.equal(dentro.findings[0].foraDasLinhas, undefined);
  const fora = await classificar({ rule: 'frontend.component.scalable-units', file: 'clsx2.tsx', linha: 2, text,
    message: 'unidade fixa escalavel na linha 2: w-[480px]; use rem ou token escalavel' }, 7);
  assert.equal(fora.findings[0].foraDasLinhas, true);
});

// A ferramenta acusa pelo texto já interpretado. Um template que escreve o valor com escape tem de entrar
// na medida, senão um literal vizinho com o valor sem escape encolheria a faixa e esconderia a mudança.
test('valor escrito com escape no literal acusado entra na medida', async () => {
  const text = ['<div title="w-[334px]" className={`flex', '  w-\\[334px]', '  shrink-0', '  gap-2', '  novo`}>', '</div>'].join('\n');
  const r = await classificar({ rule: 'frontend.component.scalable-units', file: 'escape.tsx', linha: 1, text,
    message: 'unidade fixa escalavel na linha 1: w-[334px]; use rem ou token escalavel' }, 5);
  assert.equal(r.findings[0].intervaloVerificado.fim, 5);
  assert.equal(r.findings[0].foraDasLinhas, undefined);
});

test('valor que não aparece em literal nenhum da linha mantém a união conservadora', async () => {
  const r = await classificar({ ...PX, file: 'Cartao3.tsx', message: 'unidade fixa escalavel na linha 1: w-[999px]; use rem' }, 3);
  assert.deepEqual([r.findings[0].intervaloVerificado.inicio, r.findings[0].intervaloVerificado.fim], [1, 8]);
  assert.equal(r.findings[0].foraDasLinhas, undefined);
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

test('o blob do intervalo é o dos bytes lidos, e arquivo acima do teto ou que não é arquivo não é medido', async () => {
  const texto = exemplos[2].text;
  await fs.writeFile(path.join(snapshot, 'lido.tsx'), texto);
  const [lido] = await medirIntervalos(snapshot, [{ rule: exemplos[2].rule, file: 'lido.tsx', message: 'violacao na linha 2' }]);
  assert.equal(lido.intervaloVerificado.blob, blobHash(Buffer.from(texto)));
  const grande = texto + '\n' + '/'.repeat(DEFAULTS.maxFileBytes);
  await fs.writeFile(path.join(snapshot, 'grande.tsx'), grande);
  const [acima] = await medirIntervalos(snapshot, [{ rule: exemplos[2].rule, file: 'grande.tsx', message: 'violacao na linha 2' }]);
  assert.equal(acima.intervaloVerificado, undefined, 'acima do teto não é lido');
  await fs.mkdir(path.join(snapshot, 'pasta.tsx'), { recursive: true });
  const [pasta] = await medirIntervalos(snapshot, [{ rule: exemplos[2].rule, file: 'pasta.tsx', message: 'violacao na linha 2' }]);
  assert.equal(pasta.intervaloVerificado, undefined, 'diretório não é arquivo do material');
});
