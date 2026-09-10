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
   `process.execPath`, que no app é o binário do ELECTRON. Sem
   `ELECTRON_RUN_AS_NODE` o Electron não serve o script.

   O DESENHO QUE IMPORTA: o comando e o env NÃO são digitados aqui. Eles são
   lidos do `--mcp-config` que a PRODUÇÃO escreve (`escreverConfig` em
   lib/engine/jira.js), e o teste lança exatamente aquilo. Se alguém trocar o
   nome da variável, o caminho do script ou o executável, este teste acompanha em
   vez de continuar provando uma constante que eu digitei. É o que separa teste
   ponta a ponta de teste que concorda consigo mesmo.

   Divisão de trabalho com o test/jira-composer.test.js: lá se prova que o config
   CARREGA o env (mutação que remove o env reprova lá, não aqui); aqui se prova
   que o env FUNCIONA, e que sem ele não funciona. Um é a fiação, o outro é a
   premissa da fiação.

   O que se prova, falando JSON-RPC de verdade com o processo:
   1. sob NODE o servidor responde `initialize` e `tools/list` (portátil, roda no
      CI, que não faz `npm install` e por isso não tem Electron);
   2. sob ELECTRON, com o env que a produção escreveu, o resultado é o MESMO
      (pula quando o binário não está presente, mesmo idioma do
      installer-update-mac.test.js);
   3. sob ELECTRON sem esse env, o processo roda e NÃO serve (vazio não é ausente);
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

test('sob electron: ELECTRON_RUN_AS_NODE vazio ainda ativa o servidor, não representa variável ausente',
  { skip: TEM_ELECTRON ? false : SEM_ELECTRON },
  async () => {
    const srv = servidorDaProducao();
    assert.equal(srv.env?.ELECTRON_RUN_AS_NODE, '1', 'o cenário vazio é contraprova da configuração real');
    await provaDoHandshake(ELECTRON, srv.args, { ...srv.env, ELECTRON_RUN_AS_NODE: '' });
  });

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

test('Electron real: variável ausente usa browser; vazia ou 1 usa Node, na versão declarada',
  { skip: TEM_ELECTRON ? false : SEM_ELECTRON }, async () => {
    const probe = path.join(SANDBOX, 'modo-electron.cjs');
    fs.writeFileSync(probe, "console.log(JSON.stringify({version:process.versions.electron, mode:process.type || 'node', present:Object.hasOwn(process.env,'ELECTRON_RUN_AS_NODE')})); process.exit(0);");
    for (const value of [undefined, '', '1']) {
      const env = value === undefined ? {} : { ELECTRON_RUN_AS_NODE: value };
      const remover = value === undefined ? ['ELECTRON_RUN_AS_NODE'] : [];
      const { linhas, executou, erroDeSpawn } = await conversar(ELECTRON, [probe], env, [], 1, 8000, remover);
      assert.equal(erroDeSpawn, undefined);
      assert.equal(executou, true);
      const [result] = respostas(linhas);
      assert.ok(result, 'o processo deve informar o modo e a versão reais');
      assert.equal(electronVersionSatisfies(result.version, REQUISITO_ELECTRON), true);
      assert.equal(result.present, value !== undefined);
      assert.equal(result.mode, value === undefined ? 'browser' : 'node');
    }
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

/* Sem esse env o Electron não serve o script. O que se afirma é o efeito
   observável (o handshake NÃO acontece), nunca COMO ele falha: isso muda por
   plataforma e por versão do Electron, e teste preso ao formato da falha alheia
   quebra sozinho.

   A guarda do `erroDeSpawn` não é zelo: sem ela este teste passaria também
   quando o binário nem chega a executar (caminho errado, permissão, arquivo
   corrompido), que é aprovação VAZIA. Ela é o que separa "o Electron rodou e não
   conseguiu servir" de "nada aconteceu". Medido em 29/08/2026 no Windows: sem a
   variável o processo morria em ~70ms com código 134; no Electron 44 também
   pode encerrar normalmente como browser, sem servir MCP. O código de saída
   não comprova o handshake: a contraprova exige spawn real e nenhuma resposta. */
test('sob electron SEM o env da produção: o processo até roda, mas não há handshake',
  { skip: TEM_ELECTRON ? false : SEM_ELECTRON },
  async () => {
    const srv = servidorDaProducao();
    const removerEnv = Object.keys(srv.env || {});
    assert.ok(removerEnv.length, 'a produção parou de declarar env: se isso for intencional, este teste perdeu o objeto e tem que sair junto');
    // Electron 44 aceita até valor vazio como presença da variável. Removê-la
    // do ambiente FINAL do spawn preserva a contraprova, mesmo se o runner a herdar.
    const { linhas, erroDeSpawn, executou } = await conversar(ELECTRON, srv.args, {}, [INIT], 1, 8000, removerEnv);
    assert.equal(erroDeSpawn, undefined, 'o binário tem que ter executado, senão este teste não prova nada');
    assert.equal(executou, true, 'sem spawn confirmado não existe contraprova do handshake');
    assert.equal(respostas(linhas).filter(r => r.id === 1 && r.result).length, 0,
      'sem o env não pode existir handshake: se existir, ele virou código morto e o comentário do jira.js mente');
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
