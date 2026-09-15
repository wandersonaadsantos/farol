// A divida registrada de uma regra de julgamento so cumpre a ADR-0004 do eng-behaviour
// se continuar descrevendo o repositorio: um arquivo listado que foi movido, dividido ou
// apagado vira assinatura que nunca absorve nem sai, e o numero para de significar a
// divida. A reorganizacao estrutural mexe justamente nesses arquivos, entao este teste
// obriga a atualizar o baseline na mesma entrega que move o arquivo.
//
// O pacote eng-behaviour nao roda no CI (ver docs/QUALITY.md), entao a forma que ele
// confere na leitura e conferida aqui tambem, sem depender dele instalado.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { argumentosDoAudit } from '../tools/eng-behaviour/gate.js';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CAMPOS = ['repositoryId', 'catalogVersion', 'rule', 'openedAt', 'initialFindings', 'currentFindings', 'closureCondition', 'known'];

function caminhoDoArgumento(args, flag) {
  const i = args.indexOf(flag);
  assert.ok(i >= 0 && args[i + 1], `o audit do gate nao passa ${flag}`);
  return args[i + 1];
}

const args = argumentosDoAudit('origin/main');
const arquivoDosBaselines = caminhoDoArgumento(args, '--baselines');
const baselines = JSON.parse(fs.readFileSync(path.join(RAIZ, arquivoDosBaselines), 'utf8'));

test('o gate passa o baseline versionado e a identidade fixa do repositorio', () => {
  assert.ok(fs.existsSync(path.join(RAIZ, arquivoDosBaselines)), `${arquivoDosBaselines} nao existe`);
  // Sem --repo-id a CLI usa o nome do diretorio, e numa worktree o baseline de `farol`
  // deixaria de valer.
  assert.equal(caminhoDoArgumento(args, '--repo-id'), 'farol');
  assert.equal(caminhoDoArgumento(args, '--assessments'), 'avaliacoes.jsonl');
});

test('cada baseline tem a forma que a CLI aceita e e deste repositorio', () => {
  assert.ok(Array.isArray(baselines) && baselines.length > 0, 'o arquivo precisa ser uma lista nao vazia');
  const regras = new Set();
  for (const b of baselines) {
    assert.deepEqual(Object.keys(b).sort(), [...CAMPOS].sort(), `campos do baseline de ${b.rule}`);
    assert.equal(b.repositoryId, 'farol', `baseline de ${b.rule} com outra identidade`);
    assert.ok(!regras.has(b.rule), `mais de um baseline para ${b.rule}`);
    regras.add(b.rule);
    assert.ok(b.closureCondition.trim().length > 0, `baseline de ${b.rule} sem condicao de fechamento`);
    assert.ok(b.currentFindings <= b.initialFindings, `baseline de ${b.rule} subiu: a divida so desce`);
    assert.equal(b.known.length, b.currentFindings, `baseline de ${b.rule}: contagem e lista divergem`);
    assert.equal(new Set(b.known).size, b.known.length, `baseline de ${b.rule} com assinatura repetida`);
  }
});

test('todo arquivo da divida registrada existe, no caminho que a assinatura diz', () => {
  // Arquivo movido sem atualizar o baseline e divida que nunca absorve nem sai: a
  // assinatura antiga fica parada, e a violacao no caminho novo reprova como nova.
  for (const b of baselines) {
    for (const assinatura of b.known) {
      const partes = assinatura.split('|');
      assert.equal(partes.length, 3, `assinatura fora do formato regra|arquivo|violacao: ${assinatura}`);
      const [regra, arquivo, veredito] = partes;
      assert.equal(regra, b.rule, `assinatura de outra regra dentro do baseline de ${b.rule}: ${assinatura}`);
      assert.equal(veredito, 'violacao', `assinatura de julgamento termina em violacao: ${assinatura}`);
      assert.ok(!arquivo.includes('\\') && !arquivo.startsWith('./') && !path.isAbsolute(arquivo),
        `caminho fora da forma normalizada: ${arquivo}`);
      assert.ok(fs.existsSync(path.join(RAIZ, arquivo)), `${arquivo} esta no baseline de ${b.rule} e nao existe mais`);
    }
  }
});
