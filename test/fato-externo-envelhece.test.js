// Fato de FORA do diff envelhece durante a sessao (23/09/2026).
//
// Caso medido: em biudtech/infra-k8s#151 o Farol reprovou o PR afirmando que o PR de
// que ele dependia (tenant-company#99) seguia aberto. O autor refutou, com razao: aquele
// PR tinha sido mesclado quatro minutos ANTES da revisao sair. O dado nao estava errado
// quando foi lido; ele envelheceu durante os ~10 minutos de sessao, e o blocker saiu
// apoiado na leitura velha (pushbacks.json, desfecho "mixed", 21/09/2026).
//
// A regra e barata e mora no prompt: fato externo se reconfere IMEDIATAMENTE antes de
// virar blocker, nao no comeco da analise. Sem poder reconferir, o ponto nao e blocker.
//
// Este teste trava o texto no template E no prompt montado, porque o template e
// ressincronizado a cada boot (server.js, lista `synced`): regra que existisse so no
// repositorio nunca chegaria nas copias ja instaladas.
import os from 'node:os';
import path from 'node:path';
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-fato-externo-' + process.pid);

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { Engine } = await import('../server.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { } });

const TEMPLATE = fs.readFileSync(path.join('workspace-template', 'prompts', 'pr-review-auto.md'), 'utf8');

test('o protocolo manda reconferir o fato externo ANTES de escrever o blocker', () => {
  assert.match(TEMPLATE, /fato.*(fora do diff|externo)/i);
  assert.match(TEMPLATE, /antes de (escrever|virar)/i, 'a hora da reconferência é o ponto da regra');
  assert.match(TEMPLATE, /envelhec/i);
});

test('e diz o que fazer quando a reconferência não é possível', () => {
  // a regra inteira mora em UMA linha do markdown: recortar a linha evita casar com a
  // palavra "blocker" do item seguinte, que foi o que deixou este caso passar verde
  // contra uma versão mutilada da regra.
  const linha = TEMPLATE.split(/\r?\n/).find(l => /Fato de FORA do diff/.test(l)) || '';
  assert.match(linha, /o ponto não é blocker/i,
    'sem poder reconferir, reprovar por leitura velha é justamente o defeito');
  assert.match(linha, /ressalva/i, 'o ponto não some: ele desce de blocker para ressalva');
});

test('a regra chega no prompt montado da revisão', () => {
  const e = new Engine();
  e.personProfileBlock = () => '';
  e.reviewFormatBlock = () => '';
  const prompt = e.headlessPromptFor('https://github.com/o/r/pull/1', 'alguem');
  assert.match(prompt, /envelhec/i, 'o prompt de verdade carrega a regra, não só o arquivo do repo');
});

test('o prompt do protocolo é ressincronizado a cada boot, senão a regra não chega em quem já instalou', () => {
  const server = fs.readFileSync('server.js', 'utf8');
  const bloco = server.slice(server.indexOf('const synced = ['), server.indexOf('const synced = [') + 900);
  assert.match(bloco, /pr-review-auto\.md/);
});
