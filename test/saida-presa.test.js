// Processo da sessão que saiu com o pipe preso por um neto (30/10/2026).
//
// biblioteca-cnbb-api#144: o Codex saiu, mas quatro query.js abertos como app Electron
// seguravam o stdout herdado, o 'close' nunca chegou e a sessão ficou 75 minutos viva,
// cancelada, com a label `<conta>:revisando` no PR. Aqui o neto é um node que dorme.
import cp from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fecharSaidaPresa } from '../lib/session-deadline.js';
import { IS_WIN } from '../lib/paths.js';

const NETO_MS = 8000;
const PAI = `require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, ${NETO_MS})'], { stdio: 'inherit' }); process.stdout.write('feito\\n'); process.exit(0);`;

function sessaoComNeto() {
  const child = cp.spawn(process.execPath, ['-e', PAI], { stdio: ['pipe', 'pipe', 'pipe'] });
  let saida = '';
  child.stdout.on('data', (c) => { saida += c; });
  return { child, saida: () => saida };
}

test('pai saiu e o neto segura o pipe: o close chega depois da espera, com a saída entregue', async () => {
  const { child, saida } = sessaoComNeto();
  fecharSaidaPresa(child, 300);
  const inicio = Date.now();
  const code = await new Promise(resolve => child.on('close', resolve));
  assert.equal(code, 0);
  assert.ok(Date.now() - inicio < NETO_MS / 2, `o close esperou o neto (${Date.now() - inicio} ms)`);
  assert.equal(saida(), 'feito\n', 'o que o processo escreveu antes de sair chega inteiro');
});

// No Windows o neto node com stdio herdado não segura o pipe do pai (medido no pre-push de
// 30/10/2026): o close chega sem a correção e o controle não reproduz. Lá quem segurava era o
// Farol.exe aberto como app Electron, provado à mão no biblioteca-cnbb-api#144.
const SEM_CONTROLE_NO_WINDOWS = IS_WIN && 'no Windows o neto node não segura o pipe herdado';
test('sem o fechamento, o mesmo neto segura o close (o defeito que a correção cobre)', { skip: SEM_CONTROLE_NO_WINDOWS }, async () => {
  const { child } = sessaoComNeto();
  const fechou = await Promise.race([
    new Promise(resolve => child.on('close', () => resolve(true))),
    new Promise(resolve => setTimeout(() => resolve(false), 1500)),
  ]);
  assert.equal(fechou, false, 'sem o neto preso este teste não prova nada');
  for (const pipe of [child.stdout, child.stderr, child.stdin]) pipe.destroy();
});

test('processo que fecha normalmente não é tocado', async () => {
  const child = cp.spawn(process.execPath, ['-e', "process.stdout.write('ok')"], { stdio: ['pipe', 'pipe', 'pipe'] });
  fecharSaidaPresa(child, 50);
  let saida = '';
  child.stdout.on('data', (c) => { saida += c; });
  assert.equal(await new Promise(resolve => child.on('close', resolve)), 0);
  assert.equal(saida, 'ok');
});
