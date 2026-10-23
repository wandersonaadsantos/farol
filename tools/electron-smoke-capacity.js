// Jornada da política real; cota e tabela de processos sintéticas, sem comandos externos.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import io, { safeStringify } from '../lib/io.js';
function syntheticQuota() {
  const buckets = [{ id: 'gemini-five_hour', janela: 'five_hour', restante: 0.2, reset: Date.now() + 3600000 }];
  const grupos = [{ grupo: 'gemini', buckets }];
  return { ok: true, em: Date.now(), conta: 'fixture@example.invalid', arquivo: true, reservaVerificada: true, grupos };
}
async function checkCapacity(main, waitFor, output) {
  const e = main.engine, previousRun = io.run;
  e.config.claudeProfiles = [{ id: 'quota-fixture', label: 'Cota sintética', kind: 'agy', email: 'fixture@example.invalid' }, { id: 'backup-fixture', label: 'Alternativa autorizada', kind: 'maquina' }];
  e.config.cadeiaPerfis = [{ id: 'quota-fixture', ativo: true }, { id: 'backup-fixture', ativo: true }];
  e.config.claudeProfileId = 'quota-fixture'; e.config.quotaReservations = {};
  e.config.accounts = [{ user: 'dev', owners: ['org'] }];
  e.agyCotas = new Map([['quota-fixture', { leitura: syntheticQuota() }]]);
  // O probe anterior isolou a IA; restaura a resolução real da cadeia para esta jornada.
  const { authDaConta } = await import('../lib/engine/cadeia-perfis.js');
  e.resolveClaudeAuth = account => authDaConta(e, account);
  io.run = async () => ({ ok: true, stdout: safeStringify([{ ProcessId: process.pid, ParentProcessId: 0, WorkingSetSize: process.memoryUsage().rss,
    KernelModeTime: 100000, UserModeTime: 100000, Born: new Date(Date.now() - 10000).toISOString() }]), stderr: '' });
  try {
    e.pushState();
    await main.win.webContents.executeJavaScript(`(() => { document.querySelector('#tabbtn-sistema').click(); document.querySelector('#sysbtn-plans').click(); document.querySelector('#capacityLoad').click(); })()`);
    await waitFor(() => main.win.webContents.executeJavaScript(`document.querySelector('#capacityProfile').options.length === 2`), 'perfis no painel da cota');
    assert.deepEqual(e.config.quotaReservations, {}); assert.equal(e.config.voiceEnabled, false);
    await main.win.webContents.executeJavaScript(`(() => { document.querySelector('#capacityProfile').value='quota-fixture'; document.querySelector('#capacityProfile').dispatchEvent(new Event('change')); document.querySelector('#capacityMode').value='observe'; document.querySelector('#capacitySave').click(); })()`);
    await waitFor(() => e.config.quotaReservations['quota-fixture']?.mode === 'observe', 'salvar modo de observação');
    assert.equal(e.resolveClaudeAuth('dev').id, 'quota-fixture');
    await main.win.webContents.executeJavaScript(`(() => { document.querySelector('#capacityMode').value='enforce'; document.querySelector('#capacitySave').click(); })()`);
    await waitFor(() => e.config.quotaReservations['quota-fixture']?.mode === 'enforce', 'salvar reserva efetiva');
    assert.equal(e.resolveClaudeAuth('dev').id, 'backup-fixture');
    e.config.accounts[0].claudeProfileId = 'quota-fixture'; assert.equal(e.resolveClaudeAuth('dev').id, 'quota-fixture');
    await main.win.webContents.executeJavaScript(`document.querySelector('#capacityMeasure').click()`);
    await waitFor(() => main.win.webContents.executeJavaScript(`document.querySelector('#capacityResources').textContent.includes('Farol e subprocessos')`), 'diagnóstico de recursos separado por escopo');
    await main.win.webContents.executeJavaScript(`new Promise(resolve => { document.querySelector('#capacityManager').scrollIntoView({block:'start',behavior:'instant'}); requestAnimationFrame(() => requestAnimationFrame(resolve)); })`);
    const image = await main.win.webContents.capturePage(); fs.writeFileSync(path.join(output, 'capacity.png'), image.toPNG());
    return { status: 'passed', boundaries: 'synthetic quota and process table; real DOM, HTTP, policy and chain',
      defaultOff: true, observationPreservesProfile: true, authorizedFallback: true, exclusiveProfilePreserved: true, resourcesSeparated: true, voiceDefault: false };
  } finally { io.run = previousRun; }
}
export { checkCapacity };
