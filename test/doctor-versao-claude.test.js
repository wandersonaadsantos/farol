import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const taskHome = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-doctor-versao-'));
process.env.FAROL_HOME = taskHome;
const { Engine } = await import('../server.js');
const { startServer } = await import('../lib/http-server.js');
const versao = (await import('../lib/engine/versao-claude.js')).default;
const { versaoClaudeCheck } = await import('../ui/pure.js');
const io = (await import('../lib/io.js')).default;
const originais = { run: io.run, runShell: io.runShell, fetch: globalThis.fetch };
let instalada, consultasCli, consultasRegistro, registro;
const antigo = () => versao.avaliarVersao({ instalada: '2.1.301', maisRecente: '2.1.310', datas: { '2.1.302': '2026-10-01T00:00:00Z' } });
function motor() {
  const e = new Engine(); e.log = () => {}; e.pushState = () => {}; e.checkUpdate = async () => {};
  e.claudeVersao = antigo(); e.versaoClaudeLidaEm = Date.now();
  return e;
}
beforeEach(() => {
  instalada = '2.1.310'; consultasCli = 0; consultasRegistro = 0;
  registro = { 'dist-tags': { latest: '2.1.310' }, time: { '2.1.302': '2026-10-01T00:00:00Z' } };
  io.run = async () => ({ ok: false, stdout: '', stderr: '' });
  io.runShell = async cmd => {
    if (cmd === 'claude --version') { consultasCli++; return { ok: !!instalada, stdout: instalada ? `${instalada} (Claude Code)` : '' }; }
    return { ok: false, stdout: '', stderr: '' };
  };
  globalThis.fetch = async (url, options) => {
    if (String(url) === 'https://registry.npmjs.org/@anthropic-ai/claude-code') {
      consultasRegistro++; if (registro instanceof Error) throw registro;
      return { ok: !!registro, json: async () => registro };
    }
    return originais.fetch(url, options);
  };
});
after(() => { io.run = originais.run; io.runShell = originais.runShell; globalThis.fetch = originais.fetch; fs.rmSync(taskHome, { recursive: true, force: true }); });

test('HTTP de Reverificar saúde atualiza versão e aviso antes da resposta, dentro do cache', async () => {
  const e = motor(); e.config.port = 0; const server = startServer(e); await once(server, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/doctor`);
    assert.equal(response.status, 200); assert.equal((await response.json()).claude, '2.1.310 (Claude Code)');
    assert.equal(e.claudeVersao.instalada, '2.1.310'); assert.equal(e.claudeVersao.atualizada, true);
    assert.equal(versaoClaudeCheck(e.claudeVersao)[0].ok, true);
    assert.equal(consultasCli, 1, 'reutiliza a versão já lida no diagnóstico'); assert.equal(consultasRegistro, 1);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('novo clique também relê o registro quando o CLI não mudou', async () => {
  const e = motor(); await e.doctor({ forcarVersaoClaude: true });
  registro = { 'dist-tags': { latest: '2.1.311' }, time: { '2.1.311': new Date(Date.now() - 4 * 86400000).toISOString() } };
  await e.doctor({ forcarVersaoClaude: true });
  assert.equal(e.claudeVersao.instalada, instalada); assert.equal(e.claudeVersao.maisRecente, '2.1.311');
  assert.equal(e.claudeVersao.atrasada, true); assert.equal(consultasRegistro, 2);
});

test('registro indisponível não conserva aviso de outra versão nem inventa atualização confirmada', async () => {
  registro = null; const e = motor(); await e.doctor({ forcarVersaoClaude: true });
  assert.equal(e.doctorInfo.claude, '2.1.310 (Claude Code)'); assert.equal(e.claudeVersao.instalada, instalada);
  assert.equal(e.claudeVersao.indisponivel, true); assert.notEqual(e.claudeVersao.atualizada, true);
  assert.match(versaoClaudeCheck(e.claudeVersao)[0].detail, /indisponível/);
});

test('CLI ausente remove a comparação antiga; presença fica sem versão', async () => {
  instalada = ''; const e = motor(); await e.doctor({ forcarVersaoClaude: true });
  assert.equal(e.doctorInfo.claude, null); assert.equal(e.claudeVersao, null); assert.deepEqual(versaoClaudeCheck(e.claudeVersao), []);
});

test('diagnóstico automático que confirma CLI ausente também remove a comparação antiga', async () => {
  instalada = ''; const e = motor(); await e.doctor();
  assert.equal(e.doctorInfo.claude, null); assert.equal(e.claudeVersao, null);
});

test('falha e referência inválida expõem indisponibilidade sem revelar o erro da rede', async () => {
  for (const resposta of [new Error('synthetic network detail'), { 'dist-tags': { latest: 'invalid' } }]) {
    registro = resposta; const e = motor(); await e.doctor({ forcarVersaoClaude: true });
    const aviso = versaoClaudeCheck(e.claudeVersao)[0]; assert.equal(aviso.ok, false);
    assert.equal(e.claudeVersao.instalada, instalada); assert.match(aviso.detail, /indisponível/);
    assert.doesNotMatch(aviso.detail, /synthetic|2\.1\.301|a mais recente/);
  }
});

test('doctor automático mantém o cache para o mesmo CLI, mas invalida após trocar a versão', async () => {
  const e = motor(); instalada = '2.1.301'; await e.doctor(); assert.equal(consultasRegistro, 0);
  instalada = '2.1.310'; await e.doctor(); assert.equal(consultasRegistro, 1);
  assert.equal(e.claudeVersao.instalada, instalada); assert.equal(e.claudeVersao.atualizada, true);
});

test('consulta periódica antiga não sobrescreve a reverificação manual mais recente', async () => {
  const e = motor(); e.versaoClaudeLidaEm = 0; let liberar;
  const pendente = new Promise(resolve => { liberar = resolve; });
  const leituraAntiga = versao.atualizarVersaoClaude(e, { lerVersao: async () => '2.1.301', lerRegistro: () => pendente });
  await e.doctor({ forcarVersaoClaude: true });
  liberar({ maisRecente: '2.1.310', datas: { '2.1.302': '2026-10-01T00:00:00Z' } }); await leituraAntiga;
  assert.equal(e.claudeVersao.instalada, instalada); assert.equal(e.claudeVersao.atualizada, true);
});

test('diagnóstico antigo que termina depois não restaura a versão anterior', async () => {
  const e = motor(); let liberar, avisar; let primeira = true;
  const entrou = new Promise(resolve => { avisar = resolve; });
  const pendente = new Promise(resolve => { liberar = resolve; });
  io.run = async () => { if (primeira) { primeira = false; avisar(); await pendente; } return { ok: false, stdout: '' }; };
  instalada = '2.1.301'; const antigoDoctor = e.doctor({ forcarVersaoClaude: true }); await entrou;
  instalada = '2.1.310'; await e.doctor({ forcarVersaoClaude: true }); liberar(); await antigoDoctor;
  assert.equal(e.doctorInfo.claude, '2.1.310 (Claude Code)'); assert.equal(e.claudeVersao.instalada, instalada);
});
