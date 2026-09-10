/* PROVA DE PROCESSO do servidor MCP do Jira (29/08/2026).

   Por que este arquivo existe: até a v2.54.6 o `tools/jira-mcp.js` era o único
   componente do Farol que roda como PROCESSO SEPARADO sem nenhum teste de
   processo. O que havia era estático dos dois lados: um teste lia o
   `--mcp-config` escrito (test/jira-composer.test.js) e outro lia a lista de
   pastas dos instaladores (test/pacote-runtime-tools.test.js). Os dois passavam
   verdes enquanto, na máquina do Guilherme, o servidor não subia de jeito
   nenhum. O gate aprovou o PR sem tocar no comportamento.

   O defeito de campo tinha DUAS causas somadas, cada uma suficiente sozinha:
   a pasta `tools/` não era copiada pro app instalado, e o `command` do MCP é o
   `process.execPath`, que no app é o binário do ELECTRON. A variável
   `ELECTRON_RUN_AS_NODE=1` garante o modo Node. Com a variável ausente, inicia
   em modo browser, mesmo quando consegue responder ao MCP.

   O DESENHO QUE IMPORTA: o comando e o env NÃO são digitados aqui. Eles são
   lidos do `--mcp-config` que a PRODUÇÃO escreve (`escreverConfig` em
   lib/engine/jira.js), e o teste lança exatamente aquilo. Se alguém trocar o
   nome da variável, o caminho do script ou o executável, este teste acompanha em
   vez de continuar provando uma constante que eu digitei. É o que separa teste
   ponta a ponta de teste que concorda consigo mesmo.

   Divisão de trabalho com o test/jira-composer.test.js: lá se prova que o config
   CARREGA o env (mutação que remove o env reprova lá, não aqui); aqui se prova
   que o env seleciona o modo Node real, e que sem ele o processo usa browser.
   Um é a fiação, o outro é a premissa da fiação.

   O que se prova, falando JSON-RPC de verdade com o processo:
   1. sob NODE o servidor responde `initialize` e `tools/list` (portátil, roda no
      job de qualidade da CI, que não instala Electron);
   2. sob ELECTRON, com o env que a produção escreveu, o resultado é o MESMO
      (pula quando o binário não está presente, mesmo idioma do
      installer-update-mac.test.js);
   3. sob ELECTRON o env produzido seleciona Node; removê-lo seleciona browser;
   4. site inexistente MORRE com erro legível em vez de travar o cliente MCP
      esperando resposta pra sempre.

   Isolamento: FAROL_HOME é fixado ANTES do `await import()` do módulo do repo,
   que é o idioma exigido pelo test-isolation.test.js. Credencial e site são
   fabricados e nenhuma chamada de rede acontece: `initialize` e `tools/list` não
   tocam o Jira. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-mcp-proc-'));

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const jira = await import('../lib/engine/jira.js');
const { electronVersionSatisfies } = await import('../lib/electron-runtime.js');

const SANDBOX = process.env.FAROL_HOME;
const RAIZ = path.join(import.meta.dirname, '..');
const ELECTRON = path.join(RAIZ, 'node_modules', 'electron', 'dist',
  process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron');
const TEM_ELECTRON = fs.existsSync(ELECTRON);
const SEM_ELECTRON = 'binário Electron não instalado neste checkout';
const REQUISITO_ELECTRON = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8')).dependencies.electron;
const PERFIL = { HOME: path.join(SANDBOX, 'home'), USERPROFILE: path.join(SANDBOX, 'home'),
  APPDATA: path.join(SANDBOX, 'appdata'), LOCALAPPDATA: path.join(SANDBOX, 'localdata'),
  XDG_CONFIG_HOME: path.join(SANDBOX, 'appdata'), XDG_CACHE_HOME: path.join(SANDBOX, 'localdata') };
for (const dir of Object.values(PERFIL)) fs.mkdirSync(dir, { recursive: true });

const SITE = { id: 'sandbox', label: 'sandbox', baseUrl: 'https://exemplo.atlassian.net', owners: ['orga'], projectKeys: ['XX'] };
// O FILHO lê site e credencial DO DISCO, por conta própria: o `--mcp-config`
// carrega só o id, porque o caminho dele vira linha de comando e o spawns.log
// gravaria segredo em texto puro. Então o sandbox precisa dos dois arquivos, não
// basta o objeto de engine que o `mcpArgsFor` recebe aqui do lado.
fs.writeFileSync(path.join(SANDBOX, 'config.json'), JSON.stringify({ jiraSites: [SITE] }));
// credencial FABRICADA: nada aqui alcança a rede, e o diretório morre no after()
fs.writeFileSync(path.join(SANDBOX, 'jira-credentials.json'), JSON.stringify({
  [SITE.id]: { email: 'ninguem@exemplo.invalido', token: 'token-de-teste-sem-valor' },
}));
after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best-effort */ } });

/* O que a PRODUÇÃO manda o cliente MCP executar. Passa pelo mesmo
   `mcpArgsFor` que a sessão de review usa, lê o arquivo que ele escreveu e
   devolve o servidor declarado lá: comando, args e env, sem nada digitado aqui. */
function servidorDaProducao() {
  const engine = { config: { jiraSites: [SITE] }, log: () => {}, prCardSources: async () => ({ title: '', headRefName: '', body: '' }) };
  const args = jira.mcpArgsFor(engine, SITE);
  assert.equal(args[0], '--mcp-config', `a produção mudou a forma de declarar o MCP: ${JSON.stringify(args)}`);
  const arquivo = String(args[1]).replace(/^"|"$/g, '');
  const cfg = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  const srv = cfg.mcpServers && cfg.mcpServers['farol-jira'];
  assert.ok(srv && srv.command && Array.isArray(srv.args), `config sem servidor utilizável: ${JSON.stringify(cfg)}`);
  assert.equal(srv.env?.ELECTRON_RUN_AS_NODE, '1', 'a configuração precisa selecionar o modo Node em todos os sistemas');
  return srv;
}

const rpc = (id, method, params) => `${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) })}\n`;
const INIT = rpc(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'teste', version: '1' } });
const LISTA = rpc(2, 'tools/list');

/* Sobe o servidor, manda as mensagens e resolve assim que chegarem `esperadas`
   linhas de resposta (ou quando o processo morrer, ou no teto de tempo). Resolver
   por CONTAGEM e não por sleep fixo é o que mantém o teste rápido no Node e ainda
   tolerante com o boot mais lento do Electron. */
function conversar(cmd, args, env, mensagens, esperadas, tetoMs = 20000, removerEnv = []) {
  return new Promise((resolve) => {
    const ambiente = { ...process.env, ...PERFIL, ...env };
    const removidos = new Set(removerEnv.map(k => k.toUpperCase()));
    for (const key of Object.keys(ambiente)) {
      if (removidos.has(key.toUpperCase())) delete ambiente[key];
    }
    const p = spawn(cmd, args, { env: ambiente, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '', pronto = false, executou = false;
    const fim = (extra = {}) => {
      if (pronto) return;
      pronto = true;
      clearTimeout(timer);
      try { p.kill(); } catch { /* já morreu */ }
      resolve({ linhas: out.split('\n').map(l => l.trim()).filter(Boolean), err, executou, ...extra });
    };
    const timer = setTimeout(fim, tetoMs);
    p.once('spawn', () => { executou = true; });
    p.on('error', (e) => fim({ erroDeSpawn: e.message }));
    p.on('exit', (code) => fim({ code }));
    p.stderr.on('data', (d) => { err += d; });
    p.stdout.on('data', (d) => {
      out += d;
      if (out.split('\n').filter(l => l.trim()).length >= esperadas) fim();
    });
    for (const m of mensagens) p.stdin.write(m);
  });
}

// o contrato que o cliente MCP espera: um envelope JSON-RPC por linha
const respostas = (linhas) => linhas.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

async function provaDoHandshake(cmd, args, env) {
  const { linhas, err, erroDeSpawn, executou } = await conversar(cmd, args, env, [INIT, LISTA], 2);
  assert.equal(erroDeSpawn, undefined, `não deu pra lançar o servidor: ${erroDeSpawn}`);
  assert.equal(executou, true, 'o processo precisa ter sido lançado de verdade');
  const rs = respostas(linhas);
  assert.equal(rs.length, 2, `esperava 2 envelopes JSON-RPC, veio ${rs.length}. stderr: ${err.slice(0, 400)}`);

  const init = rs.find(r => r.id === 1);
  assert.ok(init && init.result, `initialize sem result: ${JSON.stringify(init)}`);
  assert.equal(init.result.protocolVersion, '2024-11-05');
  assert.equal(init.result.serverInfo.name, 'farol-jira');

  const lista = rs.find(r => r.id === 2);
  assert.ok(lista && lista.result, `tools/list sem result: ${JSON.stringify(lista)}`);
  // as duas ferramentas são o contrato com o prompt de review (lib/engine/jira.js):
  // sumir com uma delas em silêncio quebraria a leitura de card sem nenhum erro
  assert.deepEqual(lista.result.tools.map(t => t.name).sort(), ['getJiraIssue', 'searchJiraIssuesUsingJql']);
}

test('Electron real: env da produção seleciona Node; removê-lo muda para browser',
  { skip: TEM_ELECTRON ? false : SEM_ELECTRON }, async (t) => {
    const srv = servidorDaProducao();
    const probe = path.join(SANDBOX, 'modo-electron.cjs');
    fs.writeFileSync(probe, "console.log(JSON.stringify({version:process.versions.electron, mode:process.type || 'node', present:Object.hasOwn(process.env,'ELECTRON_RUN_AS_NODE')})); process.exit(0);");
    async function modo(env, remover = []) {
      const { linhas, executou, erroDeSpawn } = await conversar(ELECTRON, [probe], env, [], 1, 8000, remover);
      assert.equal(erroDeSpawn, undefined);
      assert.equal(executou, true);
      const [result] = respostas(linhas);
      assert.ok(result, 'o processo deve informar o modo e a versão reais');
      assert.equal(electronVersionSatisfies(result.version, REQUISITO_ELECTRON), true);
      return result;
    }
    const produzido = await modo(srv.env);
    assert.equal(produzido.present, true);
    assert.equal(produzido.mode, 'node', 'o env escrito pela produção precisa selecionar Node');
    const removido = await modo({}, Object.keys(srv.env));
    assert.equal(removido.present, false);
    assert.equal(removido.mode, 'browser', 'remover o env deve reprovar o requisito de execução como Node');
    // Valor vazio não é contrato portátil: Electron 44 o trata como Node no
    // Windows e browser no macOS. Só caracterizamos, sem exigir esse modo.
    const vazio = await modo({ ...srv.env, ELECTRON_RUN_AS_NODE: '' });
    assert.equal(vazio.present, true);
    t.diagnostic(`Electron ${produzido.version} em ${process.platform}: produção=${produzido.mode}, ausente=${removido.mode}, vazio=${vazio.mode}`);
  });

test('sob node: o servidor MCP responde initialize e tools/list', async () => {
  const srv = servidorDaProducao();
  await provaDoHandshake(process.execPath, srv.args, {});
});

test('com o comando e o env que a PRODUÇÃO escreveu: mesmo handshake (o bug de campo da v2.54.6)',
  { skip: TEM_ELECTRON ? false : SEM_ELECTRON },
  async () => {
    const srv = servidorDaProducao();
    // o `command` da produção é o process.execPath de QUEM ESCREVEU o config, que
    // no teste é o node. Aqui o alvo é o binário do app, então troca-se só o
    // executável: os args e o env continuam sendo os que a produção declarou.
    await provaDoHandshake(ELECTRON, srv.args, srv.env || {});
  });

test('site inexistente: o servidor morre com erro legível em vez de travar o cliente', async () => {
  const srv = servidorDaProducao();
  const args = [...srv.args.slice(0, -1), 'nao-existe']; // mesmo script, site que não existe
  const { code, err, linhas } = await conversar(process.execPath, args, {}, [INIT], 1, 10000);
  assert.notEqual(code, 0, 'tem que sair com falha, senão o cliente MCP fica esperando resposta pra sempre');
  assert.equal(respostas(linhas).length, 0, 'não pode ter fingido um handshake');
  assert.match(err, /site do Jira não encontrado/,
    `o motivo tem que estar no stderr pra aparecer no log da sessão, veio: ${err.slice(0, 300)}`);
});
