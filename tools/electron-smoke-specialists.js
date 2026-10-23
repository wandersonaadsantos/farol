// Jornada real de curadoria via DOM, API e persistência. Só o GitHub é sintético.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import io from '../lib/io.js';
import { specialistSource } from '../test/helpers/specialist-source.js';

async function checkSpecialists(main, waitFor, output) {
  const remote = specialistSource(), previousRun = io.run;
  const e = main.engine;
  e.config.accounts = [{ user: 'dev', owners: ['org'], autoReview: false }];
  e.config.ghUser = 'dev'; e.config.voiceEnabled = false;
  e.tokens.dev = 'synthetic-fixture'; e.tokenOk = true;
  io.run = remote.run;
  try {
    e.pushState();
    await waitFor(() => main.win.webContents.executeJavaScript(`!!document.querySelector('#specialistAccount option[value="dev"]')`), 'conta disponível no formulário do especialista');
    await main.win.webContents.executeJavaScript(`(() => {
      document.querySelector('#tabbtn-sistema').click(); document.querySelector('#sysbtn-reviewers').click();
      for (const [id, value] of [['specialistAccount','dev'], ['specialistRepo','org/specialist'], ['specialistBranch','main']]) {
        const el = document.getElementById(id); el.value = value; el.dispatchEvent(new Event('input', {bubbles:true}));
      }
      document.querySelector('#specialistLoad').click();
    })()`);
    await waitFor(() => main.win.webContents.executeJavaScript(`document.querySelector('#specialistCurrent').textContent.includes('Nenhum contexto')`), 'escopo novo sem memória inventada');
    await main.win.webContents.executeJavaScript(`(() => {
      for (const [id,value] of [['specialistTitle','Camada de domínio'], ['specialistText','Serviços de domínio concentram as regras.'], ['specialistSources','CLAUDE.md:1-2']]) {
        const el = document.getElementById(id); el.value = value; el.dispatchEvent(new Event('input', {bubbles:true}));
      }
      document.querySelector('#specialistBuild').click();
    })()`);
    await waitFor(() => main.win.webContents.executeJavaScript(`!document.querySelector('#specialistConfirm').disabled`), 'prévia conferir evidências pela API real');
    const preview = await main.win.webContents.executeJavaScript(`document.querySelector('#specialistPreview').textContent`);
    assert.match(preview, /Use domain services/);
    await main.win.webContents.executeJavaScript(`document.querySelector('#specialistConfirm').click()`);
    await waitFor(() => main.win.webContents.executeJavaScript(`document.querySelector('#specialistCurrent').textContent.includes('Versão 1') && document.querySelector('#specialistEntries').textContent.includes('Fontes conferidas')`), 'curadoria persistida e verificada');
    remote.state.head = remote.second;
    await main.win.webContents.executeJavaScript(`document.querySelector('#specialistLoad').click()`);
    await waitFor(() => main.win.webContents.executeJavaScript(`document.querySelector('#specialistEntries').textContent.includes('Vencido')`), 'mudança arquitetural marcar contexto vencido');
    await main.win.webContents.executeJavaScript(`(() => {
      document.querySelector('[data-specialist-edit]').click();
      const el = document.querySelector('#specialistText'); el.value = 'Arquitetura usa portas e adaptadores.'; el.dispatchEvent(new Event('input',{bubbles:true}));
      document.querySelector('#specialistBuild').click();
    })()`);
    await waitFor(() => main.win.webContents.executeJavaScript(`!document.querySelector('#specialistConfirm').disabled`), 'reconstrução mostrar fontes novas');
    await main.win.webContents.executeJavaScript(`document.querySelector('#specialistConfirm').click()`);
    await waitFor(() => main.win.webContents.executeJavaScript(`document.querySelector('#specialistCurrent').textContent.includes('Versão 2') && document.querySelector('#specialistEntries').textContent.includes('Fontes conferidas')`), 'reconstrução curada');
    await main.win.webContents.executeJavaScript(`document.querySelector('[data-specialist-disable]').click()`);
    await waitFor(() => main.win.webContents.executeJavaScript(`document.querySelector('#specialistCurrent').textContent.includes('Versão 3') && document.querySelector('#specialistEntries').textContent.includes('Desativado')`), 'lição incorreta desativada');
    await main.win.webContents.executeJavaScript(`(() => { const s=document.querySelector('#specialistVersions'); s.value=s.options[0].value; document.querySelector('#specialistRestore').click(); })()`);
    await waitFor(() => main.win.webContents.executeJavaScript(`document.querySelector('#specialistCurrent').textContent.includes('Versão 4') && document.querySelector('#specialistEntries').textContent.includes('Desativado')`), 'versão anterior restaurada sem reativação automática');
    const image = await main.win.webContents.capturePage(); fs.writeFileSync(path.join(output, 'specialists.png'), image.toPNG());
    return { status: 'passed', github: 'synthetic boundary with real Git blob hashes',
      previewCurate: true, staleDetected: true, rebuilt: true, deactivated: true, restoredInactive: true };
  } finally { io.run = previousRun; }
}
export { checkSpecialists };
