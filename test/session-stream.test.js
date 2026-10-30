// Robustez do stream headless (runClaudeStream): decodificação utf8 (M4), exit code != 0
// com stream parcial (M3), handler de error no stdin (B4) e timeout vs cancelamento (B3).
// Mesmo padrão dos vizinhos: FAROL_HOME temporário e mock de child_process.spawn ANTES
// do require de lib/engine/session (que captura `spawn` no load do módulo).
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-stream-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import childProcess from 'node:child_process';
const realSpawn = childProcess.spawn;
let spawnImpl = null;
childProcess.spawn = function mockableSpawn(...args) {
  if (spawnImpl) return spawnImpl(...args);
  return realSpawn(...args);
};

const { runClaudeStream, cancelSession, parseEnvelope } = await import('../lib/engine/session.js');
const { escolheModelo } = await import('../lib/engine/model-router.js');
const { prepareSelfIsolation } = await import('../lib/engine/self-isolation.js');
const { IS_WIN } = await import('../lib/paths.js');
const io = (await import('../lib/io.js')).default;

after(() => {
  childProcess.spawn = realSpawn;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

// filho falso com stdout de STREAM REAL (PassThrough): o teste de multibyte precisa da
// maquinaria de verdade (StringDecoder via setEncoding), senão testaria o próprio fake.
// stdin é EventEmitter com write/end porque runClaudeStream registra handler de 'error'.
function filhoStream() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new EventEmitter();
  child.stdin = Object.assign(new EventEmitter(), { write() { }, end() { } });
  child.pid = 4242;
  return child;
}

function engineFalso() {
  return {
    config: {},
    ghEnv: () => ({ PATH: process.env.PATH }),
    running: new Map(),
    killTree() { },
    recordUsage() { },
    // padrão: sem perfil de chave de API (legado), authProfileId fica vazio
    resolveClaudeAuth: () => ({ kind: 'dir', id: '' }),
    toolSummary: () => '',
    parseEnvelope(raw) { return parseEnvelope(this, raw); },
  };
}

test('modo restrito cancelado durante --help não inicia modelo nem fallback', async () => {
  const root = path.join(FAROL_HOME, 'cli'); fs.mkdirSync(root);
  const cli = path.join(root, IS_WIN ? 'claude.exe' : 'claude'); fs.writeFileSync(cli, 'fixture');
  const source = { status: 'complete', manifest: { H: 'a'.repeat(40), files: [] },
    reader: { tree: async () => ({ complete: true, entries: [] }) } };
  const selfIsolation = await prepareSelfIsolation({ source }, { base: path.join(FAROL_HOME, 'isolated') });
  const e = engineFalso();
  e.activeReviews = new Map([['s-cancel', { mode: 'self', cancellable: true }]]);
  e.resolveClaudeAuth = () => ({ kind: 'dir', dir: path.join(FAROL_HOME, 'profile') });
  e.ghEnv = () => ({ PATH: root });
  let release, started; const arrived = new Promise(resolve => { started = resolve; });
  const original = io.run; let spawns = 0;
  io.run = async (_command, args) => {
    assert.deepEqual(args, ['--help']); started();
    return new Promise(resolve => { release = () => resolve({ ok: true, stdout: '--restricted --permission-prompts --no-session-persistence' }); });
  };
  spawnImpl = () => { spawns++; throw new Error('Nenhum modelo pode iniciar.'); };
  try {
    const running = runClaudeStream(e, 'fixture', { id: 's-cancel', operationKind: 'self', selfIsolation, extraArgs: [] });
    await arrived;
    assert.equal(cancelSession(e, 's-cancel').ok, true); release();
    await assert.rejects(running, /cancelada/); assert.equal(spawns, 0);
  } finally { io.run = original; spawnImpl = null; }
});

test('Claude restrito exige init válido no stream real, preserva modelo e recusa mesmo se kill falhar', async () => {
  const root = path.join(FAROL_HOME, 'cli-init'); fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, IS_WIN ? 'claude.exe' : 'claude'), 'fixture');
  const source = { status: 'complete', manifest: { H: 'a'.repeat(40), files: [] },
    reader: { tree: async () => ({ complete: true, entries: [] }) } };
  const selfIsolation = await prepareSelfIsolation({ source }, { base: path.join(FAROL_HOME, 'init-snapshots') });
  const original = io.run;
  io.run = async () => ({ ok: true, stdout: '--restricted --permission-prompts --no-session-persistence' });
  try {
    for (const tools of [null, ['Read', 'Grep', 'Glob', 'Bash'], ['Read', 'Grep', 'Glob']]) {
      const e = engineFalso(); e.config = { reviewModel: 'sonnet', reviewEffort: 'high' };
      e.resolveClaudeAuth = () => ({ kind: 'dir', dir: path.join(FAROL_HOME, 'profile') });
      e.ghEnv = () => ({ PATH: root });
      e.killTree = () => { throw new Error('fixture de interrupção recusada'); };
      spawnImpl = (_command, args) => {
        assert.ok(args.includes('--restricted')); assert.ok(!args.includes('--dangerously-skip-permissions'));
        assert.ok(args.includes('sonnet')); assert.ok(args.includes('high'));
        const child = filhoStream();
        setImmediate(() => {
          if (tools) child.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', tools }) + '\n');
          child.stdout.write(JSON.stringify({ type: 'result', result: 'ok', total_cost_usd: 0 }) + '\n');
          child.emit('close', 0);
        });
        return child;
      };
      const running = runClaudeStream(e, 'fixture', { id: 's-init', operationKind: 'self', selfIsolation, extraArgs: [],
        model: 'gpt-6.1-sol', modelRoutes: { claude: { model: 'sonnet', effort: 'high', fast: false } } });
      if (tools?.length === 3) assert.equal((await running).text, 'ok');
      else await assert.rejects(running, /restrit/);
    }
  } finally { io.run = original; spawnImpl = null; }
});

test('Codex restrito rejeita comando e MCP inesperado no stream, sem engolir falha de protocolo', async () => {
  const root = path.join(FAROL_HOME, 'cli-codex'); fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, IS_WIN ? 'codex.exe' : 'codex'), 'fixture');
  const source = { status: 'complete', manifest: { H: 'a'.repeat(40), files: [] },
    reader: { tree: async () => ({ complete: true, entries: [] }) } };
  const selfIsolation = await prepareSelfIsolation({ source }, { base: path.join(FAROL_HOME, 'codex-snapshots') });
  const original = io.run;
  io.run = async () => ({ ok: true, stdout: '--ignore-user-config --ignore-rules --ephemeral --sandbox' });
  try {
    for (const item of [{ type: 'command_execution', command: 'forbidden' },
      { type: 'mcp_tool_call', server: 'foreign', tool: 'post_message', status: 'in_progress' }]) {
      const e = engineFalso(); e.resolveClaudeAuth = () => ({ kind: 'codex', id: 'configured-profile' });
      e.config = { codexReviewModel: 'auto', codexReviewEffort: 'low' };
      e.ghEnv = () => ({ PATH: root });
      e.killTree = () => { throw new Error('fixture de interrupção recusada'); };
      spawnImpl = (_command, args) => {
        const child = filhoStream();
        setImmediate(() => {
          if (args.includes('login')) child.stdout.write('Logged in using ChatGPT');
          else {
            assert.ok(args.includes('--ignore-user-config')); assert.ok(args.includes('default_permissions="farol_read"'));
            assert.equal(args[args.indexOf('--model') + 1], 'gpt-6.1-sol');
            assert.ok(args.includes('model_reasoning_effort="xhigh"'));
            child.stdout.write(JSON.stringify({ type: 'item.started', item }) + '\n');
          }
          child.emit('close', 0);
        });
        return child;
      };
      await assert.rejects(runClaudeStream(e, 'fixture', { id: 's-codex', operationKind: 'self', selfIsolation, extraArgs: [],
        model: 'opus', modelRoutes: { codex: { model: 'gpt-6.1-sol', effort: 'xhigh', fast: false } } }), /fora do contrato/);
      assert.equal(e.running.size, 0);
    }
  } finally { io.run = original; spawnImpl = null; }
});

test('Claude com eventos úteis segue além de 30min; ruído e api_retry não sustentam sessão parada', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const child = filhoStream();
  const engine = engineFalso();
  const killed = [];
  engine.killTree = pid => killed.push(pid);
  spawnImpl = () => child;
  const p = runClaudeStream(engine, 'prompt', { id: 'progresso' });
  spawnImpl = null;
  const rejected = assert.rejects(p, err => {
    assert.match(err.message, /sem progresso/);
    assert.equal(err.sessionId, 'sessao-retomavel');
    return true;
  });
  child.stdout.write('{"type":"system","subtype":"init","session_id":"sessao-retomavel"}\n');
  for (let i = 0; i < 3; i++) {
    t.mock.timers.tick(15 * 60 * 1000);
    child.stdout.write('{"type":"assistant","message":{"content":[{"type":"text","text":"lendo"}]}}\n');
    assert.equal(killed.length, 0);
  }
  t.mock.timers.tick(15 * 60 * 1000);
  child.stderr.emit('data', 'ruído de rede');
  child.stdout.write('{"type":"system","subtype":"api_retry","attempt":1,"max_retries":3}\n');
  child.stdout.write('linha inválida\n');
  t.mock.timers.tick(15 * 60 * 1000);
  await rejected;
  assert.deepEqual(killed, [child.pid]);
  child.emit('close', null);
});

// biudtech/biud-frontend#1627 (30/10/2026): a recuperação reescrevia o envelope inteiro
// e o stream ficou mudo por mais de 5 minutos; o prazo matou a sessão no meio da escrita.
test('Claude escrevendo (stream_event) renova o prazo da recuperação; silêncio ainda encerra', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const child = filhoStream();
  const engine = engineFalso();
  const killed = [];
  engine.killTree = pid => killed.push(pid);
  let cmd = '';
  spawnImpl = (...args) => { cmd = JSON.stringify(args); return child; };
  const p = runClaudeStream(engine, 'prompt', { id: 'recuperacao', recovery: true });
  spawnImpl = null;
  assert.match(cmd, /--include-partial-messages/, 'sem a flag o CLI não emite stream_event');
  const rejected = assert.rejects(p, err => { assert.match(err.message, /5min sem progresso/); return true; });
  child.stdout.write('{"type":"system","subtype":"init","session_id":"s-rec"}\n');
  for (let i = 0; i < 6; i++) {
    t.mock.timers.tick(2 * 60 * 1000);
    child.stdout.write('{"type":"stream_event","session_id":"s-rec","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"{"}}}\n');
    assert.equal(killed.length, 0, 'modelo escrevendo há 12 minutos não é sessão parada');
  }
  t.mock.timers.tick(5 * 60 * 1000);
  await rejected;
  assert.deepEqual(killed, [child.pid]);
  child.emit('close', null);
});

test('runClaudeStream: multibyte cortado no limite do chunk não vira U+FFFD (M4)', async () => {
  const child = filhoStream();
  spawnImpl = () => child;
  const p = runClaudeStream(engineFalso(), 'prompt', {});
  spawnImpl = null;

  const texto = 'revisão aprovada: atenção na validação do módulo de sessão';
  const linha = Buffer.from(JSON.stringify({ type: 'result', result: texto, session_id: 's1' }) + '\n', 'utf8');
  const corte = linha.findIndex(b => b >= 0x80) + 1; // corta DENTRO do primeiro caractere multibyte
  assert.ok(corte > 0, 'o texto de teste precisa ter caractere multibyte');

  // duas metades em DOIS eventos data separados: em flowing mode, escritas enfileiradas
  // no mesmo tick seriam concatenadas num Buffer só e o corte sumiria
  const primeiroChunk = new Promise(r => child.stdout.once('data', r));
  child.stdout.write(linha.slice(0, corte));
  await primeiroChunk;
  child.stdout.once('end', () => child.emit('close', 0));
  child.stdout.write(linha.slice(corte));
  child.stdout.end();

  const res = await p;
  assert.doesNotMatch(res.text, /�/, 'U+FFFD = chunk decodificado como Buffer isolado');
  assert.equal(res.text, texto);
  assert.equal(res.sessionId, 's1');
});

test('runClaudeStream: onSession dispara UMA vez, assim que session_id chega, não só no fim (Task 2)', async () => {
  const child = filhoStream();
  spawnImpl = () => child;
  const chamadas = [];
  const p = runClaudeStream(engineFalso(), 'prompt', { onSession: (sid) => chamadas.push(sid) });
  spawnImpl = null;

  child.stdout.write('{"type":"system","subtype":"init","model":"claude-opus-5","session_id":"s1"}\n');
  // sid repetido em evento seguinte (comportamento real do CLI) não dispara de novo
  child.stdout.write(JSON.stringify({ type: 'result', result: 'ok', session_id: 's1' }) + '\n');
  child.stdout.once('end', () => child.emit('close', 0));
  child.stdout.end();

  const res = await p;
  assert.equal(res.sessionId, 's1');
  assert.deepEqual(chamadas, ['s1'], 'onSession chamado uma única vez, com o sid');
});

test('runClaudeStream: exit != 0 com stream parcial (sem evento result) é ERRO, não sucesso (M3)', async () => {
  const child = filhoStream();
  spawnImpl = () => child;
  const p = runClaudeStream(engineFalso(), 'prompt', {});
  spawnImpl = null;

  // o claude morre DEPOIS de emitir NDJSON e ANTES do evento result
  child.stdout.write('{"type":"system","subtype":"init","model":"claude-opus-5","session_id":"s1"}\n');
  child.stdout.write('{"type":"assistant","message":{"content":[{"type":"text","text":"analisando o diff"}]}}\n');
  child.stderr.emit('data', 'FATAL ERROR: JavaScript heap out of memory');
  child.stdout.once('end', () => child.emit('close', 134));
  child.stdout.end();

  await assert.rejects(p, (err) => {
    assert.match(err.message, /saiu com código 134/, 'o exit code real tem que aparecer');
    assert.match(err.message, /heap out of memory/, 'o stderr real tem que aparecer');
    assert.doesNotMatch(err.message, /"type":"system"/, 'NDJSON cru não é mensagem de erro');
    return true;
  });
});

test('runClaudeStream: envelope do stub com exit 0 continua valendo (regressão do fallback)', async () => {
  const child = filhoStream();
  spawnImpl = () => child;
  const p = runClaudeStream(engineFalso(), 'prompt', {});
  spawnImpl = null;

  child.stdout.once('end', () => child.emit('close', 0));
  child.stdout.write('{"result":"envelope do stub","is_error":false}\n');
  child.stdout.end();

  const res = await p;
  assert.equal(res.text, 'envelope do stub', 'contrato do FAROL_HEADLESS_CMD: envelope + exit 0');
});

test('runClaudeStream: timeout de 30min não engole cancelamento em andamento (B3)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const engine = engineFalso();
  const child = filhoStream();
  spawnImpl = () => child;
  const p = runClaudeStream(engine, 'prompt', { id: 'sess-1' });
  spawnImpl = null;

  // o usuário cancela: killTree disparado, mas o close do processo ainda não chegou
  assert.equal(cancelSession(engine, 'sess-1').ok, true);
  // o timer de 30min vence NESSA janela, antes do close
  t.mock.timers.tick(30 * 60 * 1000);
  child.emit('close', null); // processo morto pelo killTree do cancelamento

  await assert.rejects(p, (err) => {
    assert.equal(err.cancelled, true, 'cancelamento do usuário virou outra coisa');
    assert.match(err.message, /cancelada por você/);
    return true;
  });
});

test('runClaudeStream: chama recordUsage mesmo quando a sessão termina em erro (achado do incidente de 04/08)', async () => {
  const chamadas = [];
  const engine = engineFalso();
  engine.recordUsage = (id, account, resultEvent, model, profileId) => {
    chamadas.push({ id, account, resultEvent, model, profileId });
  };
  // conta 'bob' resolve pra um perfil de chave de API: o authProfileId tem que chegar
  // em recordUsage mesmo no caminho de erro
  engine.resolveClaudeAuth = (account) => account === 'bob'
    ? { kind: 'apikey', id: 'chave-bob' }
    : { kind: 'dir', id: '' };
  // FAROL_HEADLESS_CMD (stub) precisa devolver um envelope com is_error:true E usage
  // preenchido, simulando uma sessão que gastou token nos turnos anteriores e falhou
  // só no evento final (o cenário real do incidente).
  process.env.FAROL_HEADLESS_CMD = `node -e "console.log(JSON.stringify({type:'result', is_error:true, result:'erro simulado', usage:{input_tokens:100,output_tokens:20}, total_cost_usd:0.05}))"`;
  // este teste é o único do arquivo que faz spawn de verdade (os outros usam
  // spawnImpl falso): precisa que o WORKSPACE (cwd do spawn) exista de fato
  fs.mkdirSync(path.join(FAROL_HOME, 'workspace'), { recursive: true });
  try {
    await assert.rejects(() => runClaudeStream(engine, '/pr-review x', { account: 'bob', id: 'a1' }));
  } finally {
    delete process.env.FAROL_HEADLESS_CMD;
  }
  assert.equal(chamadas.length, 1, 'recordUsage foi chamado mesmo com is_error:true');
  assert.equal(chamadas[0].resultEvent.is_error, true);
  assert.equal(chamadas[0].resultEvent.usage.input_tokens, 100);
  assert.equal(chamadas[0].profileId, 'chave-bob', 'authProfileId do perfil apikey resolvido chega em recordUsage');
});

test('runClaudeStream: cancelamento DEPOIS do result ainda registra o consumo (auditoria 10/08)', async () => {
  // o kill pode chegar na janela entre a última linha do stdout (o result) e o close
  // do processo: o gasto está em mãos e tem que entrar no registro, mesmo com a
  // sessão terminando como cancelada. Antes o branch de cancelled vinha primeiro e
  // descartava o resultEvent inteiro.
  const chamadas = [];
  const engine = engineFalso();
  engine.recordUsage = (id, account, resultEvent) => { chamadas.push({ id, resultEvent }); };
  const child = filhoStream();
  spawnImpl = () => child;
  const p = runClaudeStream(engine, 'prompt', { id: 'sess-c1', account: 'trabalho' });
  spawnImpl = null;

  child.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: 'ok', usage: { input_tokens: 50, output_tokens: 9 }, total_cost_usd: 0.02 }) + '\n');
  assert.equal(cancelSession(engine, 'sess-c1').ok, true);
  child.stdout.end();
  child.emit('close', null);

  await assert.rejects(p, (err) => {
    assert.equal(err.cancelled, true, 'a sessão continua terminando como cancelada');
    return true;
  });
  assert.equal(chamadas.length, 1, 'o consumo já parseado não pode ser descartado pelo cancelamento');
  assert.equal(chamadas[0].resultEvent.usage.input_tokens, 50);
  assert.equal(chamadas[0].resultEvent.farol_cancelled, true, 'a linha do log tem que sair como cancelada, não ok');
});

test('runClaudeStream: repassa opts.ref pra recordUsage (Task 4, plumbing PR/chat/ferramenta)', async () => {
  const chamadas = [];
  const engine = engineFalso();
  engine.recordUsage = (id, account, resultEvent, model, profileId, ref) => {
    chamadas.push({ id, account, resultEvent, model, profileId, ref });
  };
  process.env.FAROL_HEADLESS_CMD = `node -e "console.log(JSON.stringify({type:'result', is_error:false, result:'ok', usage:{input_tokens:1,output_tokens:1}, total_cost_usd:0.01}))"`;
  fs.mkdirSync(path.join(FAROL_HOME, 'workspace'), { recursive: true });
  try {
    const res = await runClaudeStream(engine, 'prompt', { id: 'a1', account: 'trabalho', ref: 'biudtech/farol#88' });
    assert.equal(res.text, 'ok');
  } finally {
    delete process.env.FAROL_HEADLESS_CMD;
  }
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].ref, 'biudtech/farol#88', 'opts.ref precisa chegar em recordUsage');
});

test('runClaudeStream: perfil Codex confirma ChatGPT, limpa API key e registra tokens sem custo', async () => {
  const chamadasSpawn = [];
  const filhos = [];
  spawnImpl = (cmd, args, opcoes) => {
    const child = filhoStream();
    chamadasSpawn.push({ cmd, args, opcoes, child });
    filhos.push(child);
    return child;
  };
  const chamadasUso = [];
  const engine = engineFalso();
  engine.config = {
    reviewModel: 'opus', reviewEffort: 'low',
    codexReviewModel: 'gpt-5.6-terra', codexReviewEffort: 'high',
  };
  engine.ghEnv = () => ({ PATH: process.env.PATH, OPENAI_API_KEY: 'nao-usar', CODEX_API_KEY: 'nao-usar' });
  engine.resolveClaudeAuth = () => ({ kind: 'codex', id: 'codex-oss' });
  engine.recordUsage = (id, account, resultEvent, model, profileId, ref) => {
    chamadasUso.push({ id, account, resultEvent, model, profileId, ref });
  };
  const p = runClaudeStream(engine, 'prompt', { id: 'a1', account: 'trabalho', ref: 'o/r#1' });
  await new Promise(r => setImmediate(r));
  filhos[0].stdout.write('Logged in using ChatGPT\n');
  filhos[0].stdout.end();
  filhos[0].emit('close', 0);
  await new Promise(r => setImmediate(r));
  filhos[1].stdout.write(JSON.stringify({ type: 'thread.started', thread_id: 'ct1' }) + '\n');
  filhos[1].stdout.write(JSON.stringify({ type: 'turn.started' }) + '\n');
  filhos[1].stdout.write(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'ok codex' } }) + '\n');
  filhos[1].stdout.write(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 12, cached_input_tokens: 3, output_tokens: 4 } }) + '\n');
  filhos[1].stdout.end();
  filhos[1].emit('close', 0);
  spawnImpl = null;

  const res = await p;
  assert.equal(res.text, 'ok codex');
  assert.equal(res.sessionId, 'ct1');
  assert.deepEqual(chamadasSpawn[0].args, ['login', 'status']);
  assert.equal(chamadasSpawn[0].opcoes.env.OPENAI_API_KEY, undefined);
  assert.equal(chamadasSpawn[1].args.includes('--model'), true);
  assert.equal(chamadasSpawn[1].args[chamadasSpawn[1].args.indexOf('--model') + 1], 'gpt-5.6-terra');
  assert.equal(chamadasSpawn[1].opcoes.env.CODEX_API_KEY, undefined);
  assert.equal(chamadasUso.length, 1);
  assert.equal(chamadasUso[0].profileId, 'codex-oss');
  assert.equal(chamadasUso[0].model, 'gpt-5.6-terra', 'Consumo registra o modelo enviado ao Codex, nunca o alias Claude');
  assert.equal(chamadasUso[0].resultEvent.usage.input_tokens, 12);
  assert.equal(chamadasUso[0].resultEvent.total_cost_usd, 0);
});

test('runClaudeStream: rota Auto do Codex chega ao processo e ao consumo com modelo e xhigh', async () => {
  const chamadas = [];
  const filhos = [];
  spawnImpl = (cmd, args) => {
    const child = filhoStream();
    chamadas.push({ cmd, args });
    filhos.push(child);
    return child;
  };
  const engine = engineFalso();
  engine.config = { reviewModel: 'auto', codexReviewModel: 'auto', codexReviewEffort: 'low', reviewFast: true };
  engine.resolveClaudeAuth = () => ({ kind: 'codex', id: 'codex-auto' });
  const usos = [];
  engine.recordUsage = (...args) => usos.push(args);
  const metrics = { lines: 5, changedFiles: 1, files: [{ path: 'src/auth/token.js' }] };
  const modelRoutes = { claude: escolheModelo(metrics, engine.config), codex: escolheModelo(metrics, engine.config, { provedor: 'codex' }) };
  // A preparação viu Claude; a sessão passou ao Codex antes do spawn.
  const p = runClaudeStream(engine, 'revisar', { ...modelRoutes.claude, modelRoutes, id: 'codex-auto', account: 'trabalho' });
  try {
    await new Promise(r => setImmediate(r));
    filhos[0].stdout.write('Logged in using ChatGPT\n');
    filhos[0].stdout.end();
    filhos[0].emit('close', 0);
    await new Promise(r => setImmediate(r));
    filhos[1].stdout.write(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } }) + '\n');
    filhos[1].stdout.end();
    filhos[1].emit('close', 0);
    await p;
    const args = chamadas[1].args;
    assert.equal(args[args.indexOf('--model') + 1], 'gpt-6.1-sol');
    assert.ok(args.includes('model_reasoning_effort="xhigh"'));
    assert.equal(args.includes('auto'), false);
    assert.equal(args.includes('opus'), false);
    assert.equal(usos[0][3], 'gpt-6.1-sol');
  } finally {
    spawnImpl = null;
  }
});

test('runClaudeStream: perfil Codex recusa login por API key antes do prompt', async () => {
  const filhos = [];
  spawnImpl = () => {
    const child = filhoStream();
    filhos.push(child);
    return child;
  };
  const engine = engineFalso();
  engine.resolveClaudeAuth = () => ({ kind: 'codex', id: 'codex-oss' });
  const p = runClaudeStream(engine, 'prompt', { id: 'a1' });
  await new Promise(r => setImmediate(r));
  filhos[0].stdout.write('Logged in using an API key\n');
  filhos[0].stdout.end();
  filhos[0].emit('close', 0);
  spawnImpl = null;

  await assert.rejects(p, /login ativo nao usa o plano ChatGPT/);
  assert.equal(filhos.length, 1, 'nao deve iniciar o modelo quando o preflight falha');
});

test('runClaudeStream: cancelamento durante preflight Codex nao tenta matar child ausente', async () => {
  const filhos = [];
  spawnImpl = () => {
    const child = filhoStream();
    filhos.push(child);
    return child;
  };
  const engine = engineFalso();
  engine.resolveClaudeAuth = () => ({ kind: 'codex', id: 'codex-oss' });
  const p = runClaudeStream(engine, 'prompt', { id: 'a1' });
  await new Promise(r => setImmediate(r));
  assert.equal(cancelSession(engine, 'a1').ok, true);
  filhos[0].stdout.write('Logged in using ChatGPT\n');
  filhos[0].stdout.end();
  filhos[0].emit('close', 0);
  spawnImpl = null;

  await assert.rejects(p, (err) => {
    assert.equal(err.cancelled, true);
    return true;
  });
  assert.equal(filhos.length, 1);
});

test('runClaudeStream: erro após api_retry ganha sufixo de reconexão e err.sessionId (Task 1)', async () => {
  const child = filhoStream();
  spawnImpl = () => child;
  const p = runClaudeStream(engineFalso(), 'prompt', {});
  spawnImpl = null;

  child.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'abc-123' }) + '\n');
  child.stdout.write(JSON.stringify({ type: 'system', subtype: 'api_retry', attempt: 1, max_retries: 10 }) + '\n');
  child.stdout.write(JSON.stringify({ type: 'system', subtype: 'api_retry', attempt: 2, max_retries: 10 }) + '\n');
  child.stdout.write(JSON.stringify({ type: 'result', is_error: true, result: 'API Error: Connection error' }) + '\n');
  child.stdout.once('end', () => child.emit('close', 1));
  child.stdout.end();

  await assert.rejects(p, (err) => {
    assert.match(err.message, /após 2 tentativa\(s\) de reconexão/);
    assert.equal(err.sessionId, 'abc-123');
    return true;
  });
});

test('runClaudeStream: sem api_retry, a mensagem de erro NÃO ganha o sufixo (Task 1)', async () => {
  const child = filhoStream();
  spawnImpl = () => child;
  const p = runClaudeStream(engineFalso(), 'prompt', {});
  spawnImpl = null;

  child.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'abc-123' }) + '\n');
  child.stdout.write(JSON.stringify({ type: 'result', is_error: true, result: 'API Error: Connection error' }) + '\n');
  child.stdout.once('end', () => child.emit('close', 1));
  child.stdout.end();

  await assert.rejects(p, (err) => {
    assert.doesNotMatch(err.message, /tentativa\(s\) de reconexão/);
    assert.equal(err.sessionId, 'abc-123');
    return true;
  });
});

test('runClaudeStream: stdin tem handler de error (EPIPE de processo morto não derruba o engine) (B4)', async () => {
  const child = filhoStream();
  spawnImpl = () => child;
  const p = runClaudeStream(engineFalso(), 'x'.repeat(128 * 1024), {}); // prompt maior que o pipe de 64KB
  spawnImpl = null;

  const handlers = child.stdin.listenerCount('error');
  // só emite se tem quem ouça: sem handler, o emit derrubaria o PROCESSO do teste
  // (uncaughtException), que é exatamente o modo de falha do achado
  if (handlers > 0) {
    child.stdin.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE', syscall: 'write' }));
  }
  child.stderr.emit('data', 'morreu antes de ler o prompt');
  child.stdout.once('end', () => child.emit('close', 1));
  child.stdout.end();
  await assert.rejects(p, /saiu com código 1/, 'a causa real da morte vem pelo close, não pelo EPIPE');

  assert.ok(handlers >= 1, 'child.stdin sem handler de error: EPIPE assíncrono vira uncaughtException e mata o engine');
});

test('runClaudeStream: quatro Reads na mesma mensagem só contam após cada conteúdo completo retornar', async () => {
  const scopeRoot = fs.mkdtempSync(path.join(FAROL_HOME, 'scope-'));
  const review = { scopeRoot, filesRead: new Set() };
  const engine = engineFalso(); engine.config.reviewBatchedReads = true; engine.activeReviews = new Map([['batch', review]]);
  const names = ['a.js', 'b.js', 'c.js', 'd.js'];
  for (const name of names) fs.writeFileSync(path.join(scopeRoot, name), 'one\ntwo\n');
  const child = filhoStream(); spawnImpl = () => child;
  const pending = runClaudeStream(engine, 'prompt', { id: 'batch' }); spawnImpl = null;
  const send = event => child.stdout.write(JSON.stringify(event) + '\n');
  send({ type: 'assistant', message: { content: names.map(name => ({ type: 'tool_use', name: 'Read', id: name, input: { file_path: path.join(scopeRoot, name) } })) } });
  assert.equal(review.filesRead.size, 0);
  for (const name of names.slice(0, 3)) send({ type: 'user',
    tool_use_result: { type: 'text', file: { filePath: path.join(scopeRoot, name), content: 'one\ntwo\n', startLine: 1, numLines: 2, totalLines: 2 } },
    message: { content: [{ type: 'tool_result', tool_use_id: name, content: ' 1→one\n 2→two' }] } });
  send({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'd.js', is_error: true, content: 'Read failed' }] } });
  send({ type: 'result', result: 'done' });
  child.stdout.once('end', () => child.emit('close', 0)); child.stdout.end(); await pending;
  assert.deepEqual([...review.filesRead].sort(), names.slice(0, 3));
});
