// Cobre o colaborador de update (lib/engine/update.js): cmpVersion puro,
// resolveUpdateSource e a delegação da Engine. Runner nativo, ZERO deps.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-update-' + process.pid);

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const update = (await import('../lib/engine/update.js')).default;
const { APP_ROOT } = await import('../lib/paths.js');
const { TEMPOS } = await import('../lib/constants.js');
const { Engine } = await import('../server.js');
const decision = (await import('../lib/engine/decision.js')).default;

const scratch = path.join(os.tmpdir(), 'farol-test-update-src-' + process.pid);
after(() => {
  try { fs.rmSync(scratch, { recursive: true, force: true }); } catch { /* best-effort */ }
  try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

test('cmpVersion compara semver numericamente (não lexicograficamente)', () => {
  assert.equal(update.cmpVersion('1.2.0', '1.2.0'), 0);
  assert.ok(update.cmpVersion('1.3.0', '1.2.9') > 0);
  assert.ok(update.cmpVersion('1.2.0', '1.10.0') < 0, '10 > 2 numérico, não "1" < "2" textual');
  assert.ok(update.cmpVersion('2.0.0', '1.9.9') > 0);
  assert.equal(update.cmpVersion('1.2', '1.2.0'), 0, 'partes faltantes valem 0');
});

test('resolveUpdateSource: sem updateSource explícito devolve null', () => {
  assert.equal(update.resolveUpdateSource({ config: {} }), null);
  assert.equal(update.resolveUpdateSource({ config: { updateSource: '   ' } }), null);
});

test('resolveUpdateSource: apontar pra própria fonte (dev) devolve null', () => {
  assert.equal(update.resolveUpdateSource({ config: { updateSource: APP_ROOT } }), null);
});

test('resolveUpdateSource: pasta com package.json farol válido vira fonte', () => {
  fs.mkdirSync(scratch, { recursive: true });
  fs.writeFileSync(path.join(scratch, 'package.json'), JSON.stringify({ name: 'farol', version: '9.9.9' }));
  assert.deepEqual(update.resolveUpdateSource({ config: { updateSource: scratch } }), { path: scratch, version: '9.9.9' });
});

test('resolveUpdateSource: package.json de outro projeto é ignorado', () => {
  const other = path.join(scratch, 'other');
  fs.mkdirSync(other, { recursive: true });
  fs.writeFileSync(path.join(other, 'package.json'), JSON.stringify({ name: 'outra-coisa', version: '1.0.0' }));
  assert.equal(update.resolveUpdateSource({ config: { updateSource: other } }), null);
});

test('Engine delega para o colaborador (fachada fina, mesmo comportamento)', () => {
  const engine = new Engine();
  assert.equal(typeof engine.cmpVersion, 'function');
  assert.ok(engine.cmpVersion('1.1.0', '1.0.0') > 0, 'delegação de cmpVersion');
  assert.equal(engine.resolveUpdateSource(), null, 'config default não tem updateSource');
});

test('buildUpdateLaunchCommand: caminho com espaço sai citado no -File (M14)', () => {
  // PS 5.1: Start-Process junta o -ArgumentList com espaço SEM citar cada item.
  // Perfil "C:\Users\Nome Sobrenome" partia o -File em dois argumentos e o
  // installer morria numa janela oculta DEPOIS do ok:true e do toast de sucesso.
  const script = 'C:\\Users\\Nome Sobrenome\\.farol\\sessions\\update-1.ps1';
  const cmd = update.buildUpdateLaunchCommand(script);
  assert.ok(cmd.startsWith('Start-Process powershell.exe -WindowStyle Hidden -ArgumentList '),
    'forma geral do comando preservada');
  assert.ok(cmd.endsWith(`'-File','"` + script + `"'`),
    'aspas duplas embutidas sobrevivem à junção do -ArgumentList e chegam inteiras no filho');
});

test('buildUpdateLaunchCommand: apóstrofo no caminho é dobrado (string single-quoted do PS)', () => {
  const cmd = update.buildUpdateLaunchCommand("C:\\Users\\O'Brien\\.farol\\sessions\\update-2.ps1");
  assert.ok(cmd.includes("O''Brien"), 'apóstrofo dobrado, a string do -Command não quebra');
});

test('applyUpdate: sem update disponível devolve ok:false (baseline, sem rede)', async () => {
  const engine = new Engine();
  engine.config.updateRepo = '';
  engine.config.updateSource = '';
  const r = await update.applyUpdate(engine, {});
  assert.deepEqual(r, { ok: false, error: 'nenhuma atualização disponível' });
});

test('applyUpdate: usa o checkUpdate injetado (costura de teste)', async () => {
  const engine = new Engine();
  engine.config.updateRepo = '';
  let usado = false;
  const r = await update.applyUpdate(engine, {
    checkUpdate: async (e) => {
      usado = true;
      e.update = { current: '0.0.1', channel: 'remote', repo: 'x/y', source: null, sourceVersion: null, available: false, checkedAt: Date.now() };
    }
  });
  assert.equal(usado, true, 'o applyUpdate honrou deps.checkUpdate');
  assert.equal(r.ok, false);
});

// engine.update remoto com release disponível, como o checkUpdate real deixaria
function updateRemotoDisponivel(e) {
  e.update = { current: '0.0.1', channel: 'remote', repo: 'x/y', source: null, sourceVersion: '9.9.9', available: true, checkedAt: Date.now() };
}

test('applyUpdate: checkUpdate concorrente durante o download não órfã o source (M13)', async () => {
  const engine = new Engine();
  engine.config.updateRepo = '';
  const dir = path.join(scratch, 'm13-extracted');
  fs.mkdirSync(dir, { recursive: true }); // de propósito SEM installer/: o fluxo para ANTES de qualquer spawn
  const r = await update.applyUpdate(engine, {
    checkUpdate: async (e) => updateRemotoDisponivel(e),
    downloadRemoteUpdate: async (e) => {
      // o ciclo de polling rodou checkUpdate no MEIO do download e reatribuiu engine.update
      updateRemotoDisponivel(e);
      return dir;
    }
  });
  assert.equal(r.ok, false);
  assert.match(String(r.error), /installer não encontrado/, 'parou no installer ausente, não em path.join(null)');
  assert.equal(engine.update.source, dir, 'source gravado no objeto ATUAL de engine.update, não no órfão');
});

test('applyUpdate: revisão iniciada DURANTE o download barra o installer (M15)', async () => {
  const engine = new Engine();
  engine.config.updateRepo = '';
  const dir = path.join(scratch, 'm15-extracted');
  fs.mkdirSync(dir, { recursive: true }); // sem installer/: nem um fluxo quebrado chega ao spawn
  const r = await update.applyUpdate(engine, {
    checkUpdate: async (e) => updateRemotoDisponivel(e),
    downloadRemoteUpdate: async (e) => {
      // o polling iniciou uma revisão headless enquanto o download (minutos) rodava
      e.headlessQueue.push({ key: 'org/repo#1', url: 'https://github.com/org/repo/pull/1' });
      return dir;
    }
  });
  assert.equal(r.ok, false);
  // compara com a constante exportada, não com o texto: a mensagem já mudou de
  // redação uma vez (I1, pra citar a sessão de terminal) e o que este teste afirma
  // é a RE-checagem, não a frase
  assert.equal(String(r.error), update.BUSY_ERROR,
    'a checagem de ocupado precisa RE-rodar depois do download, não só antes');
});

test('applyUpdate: segundo clique durante o download é recusado e falha destrava (M16)', async () => {
  const engine = new Engine();
  engine.config.updateRepo = '';
  const dir = path.join(scratch, 'm16-extracted');
  fs.mkdirSync(dir, { recursive: true }); // sem installer/: a primeira chamada termina em ok:false sem spawn
  let libera;
  const downloadTravado = new Promise(res => { libera = res; });
  const primeira = update.applyUpdate(engine, {
    checkUpdate: async (e) => updateRemotoDisponivel(e),
    downloadRemoteUpdate: async () => { await downloadTravado; return dir; }
  });
  // segunda chamada com deps PRÓPRIOS e instantâneos: sem a guarda ela resolve
  // rápido com a mensagem errada (vermelho limpo, sem deadlock no teste)
  let chamouSegundoDownload = false;
  const segunda = await update.applyUpdate(engine, {
    checkUpdate: async (e) => updateRemotoDisponivel(e),
    downloadRemoteUpdate: async () => { chamouSegundoDownload = true; return dir; }
  });
  assert.equal(segunda.ok, false);
  assert.match(String(segunda.error), /atualização já em andamento/);
  assert.equal(chamouSegundoDownload, false, 'a guarda barrou ANTES de qualquer download novo');
  libera();
  const r1 = await primeira;
  assert.equal(r1.ok, false, 'primeira chamada morre no installer ausente (fixture sem installer/)');
  const terceira = await update.applyUpdate(engine, {
    checkUpdate: async (e) => updateRemotoDisponivel(e),
    downloadRemoteUpdate: async () => dir
  });
  assert.match(String(terceira.error), /installer não encontrado/, 'ok:false destrava a guarda pro próximo clique');
});

test('sessionsBusy: sessão de TERMINAL aberta também segura o update', () => {
  // engine mínimo no padrão dos casos M15 do arquivo
  const engine = new Engine();
  engine.activeReviews.set('t1', { id: 't1', mode: 'terminal', keys: ['acme/repo#1'] });
  assert.equal(update.sessionsBusy(engine), true);
});

// I1 (G14 x G17): a entrada de terminal em activeReviews é APAGADA pelo aviso de
// saída do script (trap EXIT). O trap é pendência conhecida do macOS: janela morta
// cujo aviso nunca chegou deixa entrada fantasma pra vida inteira do processo. O
// G17 já tinha julgado esse mesmo fantasma na capability de postagem, com teto de
// 12h; sem o mesmo teto aqui, um fantasma travava o update PRA SEMPRE e a única
// saída era reiniciar o app. Mesma entrada, mesmo critério, mesma constante.
const HORA_MS = 60 * 60 * 1000;

test('sessionsBusy: terminal FANTASMA (mais de 12h) não segura o update (I1)', () => {
  const engine = new Engine();
  engine.activeReviews.set('t1', {
    id: 't1', mode: 'terminal', keys: ['acme/repo#1'],
    startedAt: Date.now() - 13 * HORA_MS,
  });
  assert.equal(update.sessionsBusy(engine), false,
    'sessão de 13h é fantasma pelo mesmo critério do G17: não pode travar o update pra sempre');
});

test('sessionsBusy: terminal de 1h continua segurando o update (I1)', () => {
  const engine = new Engine();
  engine.activeReviews.set('t1', {
    id: 't1', mode: 'terminal', keys: ['acme/repo#1'],
    startedAt: Date.now() - HORA_MS,
  });
  assert.equal(update.sessionsBusy(engine), true,
    'uso humano normal (almoço, reunião) segue protegido: o installer mataria a sessão viva');
});

test('sessionsBusy: terminal sem startedAt confiável segue segurando (I1, falha fechado)', () => {
  const engine = new Engine();
  engine.activeReviews.set('t1', { id: 't1', mode: 'terminal', keys: ['acme/repo#1'] });
  assert.equal(update.sessionsBusy(engine), true,
    'sem idade provada não dá pra afirmar que é fantasma; matar sessão viva é pior');
});

test('sessionsBusy: o teto de 12h é a MESMA constante do G17 (fonte única)', () => {
  assert.equal(decision.TERMINAL_SESSION_MAX_MS, 12 * HORA_MS);
  const engine = new Engine();
  // exatamente no teto ainda é sessão viva; um milissegundo além é fantasma
  engine.activeReviews.set('t1', {
    id: 't1', mode: 'terminal', startedAt: Date.now() - decision.TERMINAL_SESSION_MAX_MS + 5000,
  });
  assert.equal(update.sessionsBusy(engine), true);
});

test('BUSY_ERROR cita a sessão de terminal (I1)', () => {
  assert.match(update.BUSY_ERROR, /terminal/,
    'o usuário precisa saber ONDE olhar; "análise ou chat" não nomeia a janela aberta');
});

test('pruneOldDownloads: poda update-dl-* com mais de 24h, mantém o recente (G20)', () => {
  const sessionsDir = path.join(scratch, 'g20-sessions');
  const velho = path.join(sessionsDir, 'update-dl-1');
  const recente = path.join(sessionsDir, 'update-dl-2');
  fs.mkdirSync(velho, { recursive: true });
  fs.mkdirSync(recente, { recursive: true });
  const DIA = 24 * 60 * 60 * 1000;
  const antigo = (Date.now() - DIA - 60 * 60 * 1000) / 1000; // 25h atrás, em segundos (utimesSync)
  fs.utimesSync(velho, antigo, antigo);
  update.pruneOldDownloads(sessionsDir);
  assert.equal(fs.existsSync(velho), false, 'diretório com mais de 24h foi removido');
  assert.equal(fs.existsSync(recente), true, 'diretório recente permanece');
});

test('pruneOldDownloads: pasta sessions inexistente não lança (best-effort)', () => {
  assert.doesNotThrow(() => update.pruneOldDownloads(path.join(scratch, 'nao-existe-jamais')));
});

/* ---------- buildUpdateScriptMac: o gêmeo mac do buildUpdateLaunchCommand ---------- */
// Extraído puro pelo MESMO motivo do lado Windows (M14): caminho com espaço ou
// apóstrofo só é testável com a montagem fora do spawn. O apóstrofo cobre nome
// de usuário tipo O'Brien, que a interpolação crua quebrava.

test('buildUpdateScriptMac: caminho com espaço fica inteiro dentro das aspas', () => {
  const s = update.buildUpdateScriptMac('/Users/ana/farol dir/installer/install.sh', '/Users/ana/.farol/workspace/state/update.log');
  assert.match(s, /^#!\/bin\/bash\n/);
  assert.ok(s.includes("bash '/Users/ana/farol dir/installer/install.sh' > '/Users/ana/.farol/workspace/state/update.log' 2>&1"));
  assert.ok(s.includes('open "$HOME/Applications/Farol.app"'));
  assert.ok(s.includes('rm -f -- "$0"'), 'o script se apaga ao terminar');
});

test('buildUpdateScriptMac: apóstrofo no caminho não escapa da atribuição', () => {
  const s = update.buildUpdateScriptMac("/Users/O'Brien/farol/installer/install.sh", "/Users/O'Brien/log");
  assert.ok(s.includes("'/Users/O'\\''Brien/farol/installer/install.sh'"), 'aspa simples escapada no padrão POSIX');
  assert.ok(!s.includes("bash '/Users/O'Brien"), 'a interpolação crua antiga não pode voltar');
});

// O pkill do install.sh NÃO alcança o Farol no caminho do auto-update, e isso é
// regra documentada do macOS, não acidente: `man pkill` diz que "the current pgrep
// or pkill process and all of its ANCESTORS are excluded" por padrão. O script de
// update é spawnado PELO próprio app, então o installer é descendente dele e o app
// nunca casa o padrão. Medido num Mac real em 17/08/2026: o installer matava só os
// processos auxiliares do Electron e o principal seguia vivo; os arquivos novos
// chegavam no disco, o app continuava rodando o código VELHO, e o `open` seguinte
// só focava a janela já aberta. Resultado pro usuário: o toast prometia "vai fechar
// e reabrir sozinho" e nada acontecia até reiniciar na mão.
// A saída é matar pelo PID, que não tem a regra de ancestral (verificado no mesmo
// Mac: kill por PID no ancestral sai 0 e o processo morre).
test('buildUpdateScriptMac: mata o app pelo PID ANTES de rodar o installer', () => {
  const s = update.buildUpdateScriptMac('/Users/ana/farol/installer/install.sh', '/Users/ana/log', 4242);
  assert.match(s, /kill 4242\b/, 'mata pelo PID: o pkill do installer não alcança ancestral no macOS');
  assert.ok(s.indexOf('kill 4242') < s.indexOf("bash '/Users/ana/farol/installer/install.sh'"),
    'o kill vem ANTES do installer: ele sobrescreve os arquivos que o app em execução usa');
});

test('buildUpdateScriptMac: espera o app morrer antes de seguir (sem corrida com o installer)', () => {
  const s = update.buildUpdateScriptMac('/i/install.sh', '/l', 4242);
  assert.match(s, /kill -0 4242/, 'confere que o processo saiu em vez de assumir');
});

test('buildUpdateScriptMac: sem PID conhecido não inventa kill (degrada pro comportamento antigo)', () => {
  const s = update.buildUpdateScriptMac('/i/install.sh', '/l');
  assert.equal(/\bkill\b/.test(s), false, 'sem pid não emite kill nenhum');
  assert.ok(s.includes("bash '/i/install.sh'"), 'e o resto do script segue igual');
});

/* ---------- Linux experimental (v2.45.0): script de update e instalador ---------- */

test('buildUpdateScriptLinux: mesmo escaping do mac, reabre pelo lançador com setsid', () => {
  const s = update.buildUpdateScriptLinux("/home/O'Hara/farol dir/installer/install-linux.sh", '/home/x/log');
  assert.match(s, /^#!\/bin\/bash\n/);
  assert.ok(s.includes("'/home/O'\\''Hara/farol dir/installer/install-linux.sh'"), 'apóstrofo escapado');
  assert.ok(s.includes('setsid "$HOME/.farol/bin/farol"'), 'reabertura via lançador, desprendida do grupo');
  assert.ok(s.includes('rm -f -- "$0"'));
});

test('posixInstallerName: mac usa install.sh, linux usa install-linux.sh', () => {
  assert.equal(update.posixInstallerName(true), 'install.sh');
  assert.equal(update.posixInstallerName(false), 'install-linux.sh');
});

/* ---------- maybeAutoUpdate: aplica sozinho quando ocioso (v2.46.0) ---------- */

function engineOcioso() {
  const engine = new Engine();
  engine.update = { current: '0.0.1', channel: 'remote', repo: 'x/y', source: null, sourceVersion: '9.9.9', available: true, checkedAt: Date.now() };
  return engine;
}

test('maybeAutoUpdate: ocioso + available + remote + config default aplica sozinho', async () => {
  const engine = engineOcioso();
  let chamou = false;
  const r = await update.maybeAutoUpdate(engine, {
    applyUpdate: async () => { chamou = true; return { ok: true, from: '0.0.1', to: '9.9.9' }; }
  });
  assert.equal(chamou, true, 'applyUpdate injetado foi chamado sem config.autoUpdate definido');
  assert.equal(r.ok, true);
  assert.equal(engine.updateApplying, true,
    'sucesso MANTÉM a guarda ligada (simetria com o applyUpdate público: o installer vai matar o processo)');
});

test('maybeAutoUpdate: skipped "ocupado" quando há sessão viva (sessionsBusy)', async () => {
  const engine = engineOcioso();
  engine.activeReviews.set('t1', { id: 't1', mode: 'terminal', keys: ['acme/repo#1'], startedAt: Date.now() });
  let chamou = false;
  const r = await update.maybeAutoUpdate(engine, {
    applyUpdate: async () => { chamou = true; return { ok: true }; }
  });
  assert.equal(chamou, false, 'não deve tentar aplicar com sessão ocupada');
  assert.deepEqual(r, { ok: false, skipped: 'ocupado' });
});

test('maybeAutoUpdate: skipped "nada" quando canal é local (fluxo de dev)', async () => {
  const engine = new Engine();
  engine.update = { current: '0.0.1', channel: 'local', source: '/x', sourceVersion: '9.9.9', available: true, checkedAt: Date.now() };
  let chamou = false;
  const r = await update.maybeAutoUpdate(engine, {
    applyUpdate: async () => { chamou = true; return { ok: true }; }
  });
  assert.equal(chamou, false, 'canal local fica no botão, nunca auto-aplica');
  assert.deepEqual(r, { ok: false, skipped: 'nada' });
});

test('maybeAutoUpdate: skipped "nada" quando não há update disponível', async () => {
  const engine = new Engine();
  engine.update = { current: '0.0.1', channel: 'remote', repo: 'x/y', source: null, sourceVersion: null, available: false, checkedAt: Date.now() };
  const r = await update.maybeAutoUpdate(engine, { applyUpdate: async () => ({ ok: true }) });
  assert.deepEqual(r, { ok: false, skipped: 'nada' });
});

test('maybeAutoUpdate: skipped "desligado" quando config.autoUpdate === false', async () => {
  const engine = engineOcioso();
  engine.config.autoUpdate = false;
  let chamou = false;
  const r = await update.maybeAutoUpdate(engine, {
    applyUpdate: async () => { chamou = true; return { ok: true }; }
  });
  assert.equal(chamou, false);
  assert.deepEqual(r, { ok: false, skipped: 'desligado' });
});

test('maybeAutoUpdate: falha real entra em backoff, segunda chamada é skipped "backoff"', async () => {
  const engine = engineOcioso();
  const r1 = await update.maybeAutoUpdate(engine, {
    applyUpdate: async () => ({ ok: false, error: 'algumacoisa' })
  });
  assert.equal(r1.ok, false);
  assert.ok(Number.isFinite(engine.autoUpdateFailedAt) && engine.autoUpdateFailedAt > 0,
    'falha real grava o carimbo de backoff');
  let chamou = false;
  const r2 = await update.maybeAutoUpdate(engine, {
    applyUpdate: async () => { chamou = true; return { ok: true }; }
  });
  assert.equal(chamou, false, 'segunda tentativa logo em seguida é barrada pelo backoff');
  assert.deepEqual(r2, { ok: false, skipped: 'backoff' });
});

test('maybeAutoUpdate: falha por BUSY_ERROR NÃO entra em backoff (corrida esperada)', async () => {
  const engine = engineOcioso();
  const r = await update.maybeAutoUpdate(engine, {
    applyUpdate: async () => ({ ok: false, error: update.BUSY_ERROR })
  });
  assert.equal(r.ok, false);
  assert.equal(engine.autoUpdateFailedAt, 0, 'BUSY_ERROR é corrida esperada, não backoff');
});

test('maybeAutoUpdate: falha zera a guarda pro próximo ciclo poder tentar', async () => {
  const engine = engineOcioso();
  const r = await update.maybeAutoUpdate(engine, {
    applyUpdate: async () => ({ ok: false, error: update.BUSY_ERROR })
  });
  assert.equal(r.ok, false);
  assert.equal(engine.updateApplying, false, 'falha destrava a guarda');
});

test('maybeAutoUpdate: updateApplying volta a false no finally mesmo com applyUpdate lançando', async () => {
  const engine = engineOcioso();
  await assert.rejects(() => update.maybeAutoUpdate(engine, {
    applyUpdate: async () => { throw new Error('boom'); }
  }));
  assert.equal(engine.updateApplying, false, 'finally sempre zera a guarda, mesmo em exceção');
});

/* ---------- update agendado: clique com sessão ativa agenda em vez de erro (v2.46.1) ---------- */

test('applyUpdate ocupado devolve queued:true e seta engine.updateQueued', async () => {
  const engine = new Engine();
  engine.config.updateRepo = '';
  engine.headlessQueue.push({ key: 'org/repo#1', url: 'https://github.com/org/repo/pull/1' });
  const r = await update.applyUpdate(engine, {
    checkUpdate: async (e) => updateRemotoDisponivel(e)
  });
  assert.equal(r.ok, false);
  assert.equal(r.queued, true, 'ocupado não é erro seco: o clique vira agendamento');
  assert.equal(r.error, update.BUSY_ERROR);
  assert.equal(engine.updateQueued, true, 'o pedido do usuário fica armado pro auto-update');
});

test('maybeAutoUpdate: autoUpdate false + updateQueued true APLICA (one-shot) e zera o queued', async () => {
  const engine = engineOcioso();
  engine.config.autoUpdate = false;
  engine.updateQueued = true;
  let chamou = false;
  const r = await update.maybeAutoUpdate(engine, {
    applyUpdate: async () => { chamou = true; return { ok: true, from: '0.0.1', to: '9.9.9' }; }
  });
  assert.equal(chamou, true, 'clique explícito vence o toggle desligado');
  assert.equal(r.ok, true);
  assert.equal(engine.updateQueued, false, 'o pedido é one-shot, consumido ao aplicar');
});

test('maybeAutoUpdate: autoUpdate false SEM queued segue skipped "desligado"', async () => {
  const engine = engineOcioso();
  engine.config.autoUpdate = false;
  engine.updateQueued = false;
  const r = await update.maybeAutoUpdate(engine, { applyUpdate: async () => ({ ok: true }) });
  assert.deepEqual(r, { ok: false, skipped: 'desligado' });
});

test('maybeAutoUpdate: BUSY na janela pós-consumo RE-ARMA o queued (corrida, não tentativa real)', async () => {
  const engine = engineOcioso();
  engine.config.autoUpdate = false;
  engine.updateQueued = true;
  const r = await update.maybeAutoUpdate(engine, {
    applyUpdate: async () => ({ ok: false, error: update.BUSY_ERROR })
  });
  assert.equal(r.ok, false);
  assert.equal(engine.updateQueued, true,
    'sessão que nasceu durante o download não pode matar o pedido explícito do usuário');
});

test('maybeAutoUpdate: queued consumido não re-arma sozinho após falha', async () => {
  const engine = engineOcioso();
  engine.config.autoUpdate = false;
  engine.updateQueued = true;
  const r = await update.maybeAutoUpdate(engine, {
    applyUpdate: async () => ({ ok: false, error: 'algumacoisa' })
  });
  assert.equal(r.ok, false);
  assert.equal(engine.updateQueued, false, 'queued foi consumido ANTES do apply; falha não re-arma');
  const r2 = await update.maybeAutoUpdate(engine, { applyUpdate: async () => ({ ok: true }) });
  assert.deepEqual(r2, { ok: false, skipped: 'desligado' }, 'sem queued e com toggle desligado, volta ao gate normal');
});

test('maybeAutoUpdate: skipped "em-andamento" quando updateApplying já é truthy', async () => {
  const engine = engineOcioso();
  engine.updateApplying = true;
  let chamou = false;
  const r = await update.maybeAutoUpdate(engine, {
    applyUpdate: async () => { chamou = true; return { ok: true }; }
  });
  assert.equal(chamou, false);
  assert.deepEqual(r, { ok: false, skipped: 'em-andamento' });
});

/* ---------- reabertura silenciosa pos-update (v2.51.0) ----------
   Pedido do Wanderson: o auto-update fechava e reabria o app com a janela
   VISIVEL, roubando o foco no meio do trabalho. O marcador tem PRAZO de
   proposito: update que falhou nao pode deixar a proxima abertura MANUAL sem
   janela, porque isso pareceria app quebrado. */

test('reaberturaEhRecente: dentro da janela vale', () => {
  const agora = 1_000_000_000;
  assert.equal(update.reaberturaEhRecente({ at: agora - 1000 }, agora), true);
});

test('reaberturaEhRecente: fora da janela NAO vale (update que falhou)', () => {
  const agora = 1_000_000_000;
  const velho = agora - TEMPOS.REABERTURA_SILENCIOSA_MS - 1;
  assert.equal(update.reaberturaEhRecente({ at: velho }, agora), false);
});

test('reaberturaEhRecente: carimbo torto nunca vale', () => {
  const agora = 1_000_000_000;
  assert.equal(update.reaberturaEhRecente(null, agora), false);
  assert.equal(update.reaberturaEhRecente({}, agora), false);
  assert.equal(update.reaberturaEhRecente({ at: 'ontem' }, agora), false);
  // carimbo no FUTURO (relogio mexido) tambem nao vale
  assert.equal(update.reaberturaEhRecente({ at: agora + 5000 }, agora), false);
});

test('consumir: marcador de uso unico, some mesmo quando vencido', () => {
  update.marcarReaberturaSilenciosa('9.9.9');
  assert.equal(fs.existsSync(update.REABRIR_SILENCIOSO), true);
  const lido = update.consumirReaberturaSilenciosa();
  assert.equal(lido.to, '9.9.9');
  assert.equal(fs.existsSync(update.REABRIR_SILENCIOSO), false, 'apagado na leitura');
  assert.equal(update.consumirReaberturaSilenciosa(), null, 'segunda leitura nao devolve nada');
});

test('consumir: vencido devolve null E apaga (nao fica preso no disco)', () => {
  update.marcarReaberturaSilenciosa('9.9.9');
  const muitoDepois = Date.now() + TEMPOS.REABERTURA_SILENCIOSA_MS + 1000;
  assert.equal(update.consumirReaberturaSilenciosa(muitoDepois), null);
  assert.equal(fs.existsSync(update.REABRIR_SILENCIOSO), false);
});
