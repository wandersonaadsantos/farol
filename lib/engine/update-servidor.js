// O update de quem roda só o motor (modo servidor, 15/10/2026): `node server.js`, sem a
// casca do Electron. É como rodam o celular (Termux + proot Debian, religado por um laço
// quando sai) e a instância da Hostinger (religada pelo cron do painel).
//
// POR QUE EXISTE: o caminho de sempre exige o runtime do Electron (`updateRuntimeError`) e
// roda o `install-linux.sh`, que instala em `~/.farol/app`, baixa o Electron e reabre pelo
// lançador da janela. Sem Electron o update era recusado antes de tocar em qualquer
// arquivo, e o aparelho ficava na versão velha para sempre (medido na v2.71.14: a release
// saiu, o admin a viu e o celular seguiu na 2.71.13).
//
// O QUE FAZ: troca, NO lugar de onde o motor roda (`APP_ROOT`), só o que o pacote leve traz,
// pasta por pasta (cópia ao lado e depois rename), preservando o resto: `node_modules`, a
// entrada própria da Hostinger e o que mais o operador tenha posto ali. Depois sai, e um
// script destacado religa o motor SÓ se ninguém responder na porta em 30 s. Quem
// supervisiona (o laço do celular, o cron da Hostinger) religa antes e o script se cala;
// processo solto volta pelo script. É a mesma regra de "esperar o supervisor" que o
// `buildUpdateScriptLinux` aprendeu em 29/09/2026 com o EADDRINUSE do celular.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { APP_ROOT, APP_VERSION, HOME, IS_WIN } from '../paths.js';
import { ensureDir } from '../io.js';
import { logSpawn } from '../spawnlog.js';
import { shEsc } from '../parse.js';
import { DEFAULT_PORT, TEMPOS } from '../constants.js';
import { validarParserDistribuido } from '../parser-runtime.js';
import { assertExternalNodeRuntime } from '../node-runtime.js';

// O mesmo conteúdo que o install-linux.sh copia do pacote leve. O que não está aqui fica.
const ARQUIVOS = ['main.js', 'server.js', 'package.json', 'README.md', 'CLAUDE.md'];
// uma por linha: duas pastas lado a lado nesta lista se leem como um path.join para a trava
// de test/pacote-runtime-tools.test.js, que procura arquivo da pasta de ferramentas usado em
// runtime e acharia um que não existe
const PASTAS = [
  'lib',
  'ui',
  'assets',
  'workspace-template',
  'installer',
  'docs',
  'tools',
];

// Troca os arquivos de `raiz` pelos de `origem`. Primeiro copia TUDO ao lado (falha aqui
// não mudou nada), depois troca por rename, com o package.json por último: é ele que diz
// a versão no próximo boot, então uma troca interrompida nunca anuncia a versão nova.
function trocarArquivos(origem, raiz, carimbo = Date.now()) {
  assertExternalNodeRuntime({ packageFile: path.join(origem, 'package.json') });
  validarParserDistribuido(origem);
  const itens = [...PASTAS, ...ARQUIVOS].filter((n) => fs.existsSync(path.join(origem, n)));
  if (!itens.includes('server.js') || !itens.includes('package.json')) {
    throw new Error('o pacote baixado não tem server.js ou package.json');
  }
  const novos = [];
  try {
    for (const nome of itens) {
      const novo = path.join(raiz, `${nome}.novo-${carimbo}`);
      fs.cpSync(path.join(origem, nome), novo, { recursive: true });
      novos.push([nome, novo]);
    }
  } catch (err) {
    for (const [, novo] of novos) fs.rmSync(novo, { recursive: true, force: true });
    throw err;
  }
  novos.sort((a, b) => Number(a[0] === 'package.json') - Number(b[0] === 'package.json'));
  for (const [nome, novo] of novos) {
    const atual = path.join(raiz, nome);
    const velho = path.join(raiz, `${nome}.velho-${carimbo}`);
    if (fs.existsSync(atual)) fs.renameSync(atual, velho);
    fs.renameSync(novo, atual);
    fs.rmSync(velho, { recursive: true, force: true });
  }
}

// O script que religa o motor, PURO para teste (mesmo escaping do update do mac e do
// linux): espera o processo atual sair, dá 30 s para um supervisor religar na porta e só
// então sobe o motor com o mesmo comando, na mesma pasta e com o mesmo ambiente.
function scriptDeReligar({ pid, porta, raiz, comando }) {
  const linha = comando.map((parte) => `'${shEsc(parte)}'`).join(' ');
  return [
    '#!/bin/bash',
    `for _ in $(seq 1 50); do kill -0 ${pid} 2>/dev/null || break; sleep 0.2; done`,
    `for _ in $(seq 1 30); do (exec 3<>/dev/tcp/127.0.0.1/${porta}) 2>/dev/null && { rm -f -- "$0"; exit 0; }; sleep 1; done`,
    `cd '${shEsc(raiz)}' && setsid ${linha} </dev/null >/dev/null 2>&1 &`,
    'rm -f -- "$0"',
  ].join('\n') + '\n';
}

function religar(engine, raiz) {
  const dir = path.join(HOME, 'sessions');
  ensureDir(dir);
  const arquivo = path.join(dir, `religar-${Date.now()}.sh`);
  const porta = Number(engine.config && engine.config.port) || DEFAULT_PORT;
  const comando = [process.execPath, ...process.argv.slice(1)];
  fs.writeFileSync(arquivo, scriptDeReligar({ pid: process.pid, porta, raiz, comando }), { mode: 0o700 });
  logSpawn('religarServidor', ['/bin/bash', arquivo]);
  spawn('/bin/bash', [arquivo], { stdio: 'ignore', detached: true }).unref();
  // sai depois de a resposta e o toast terem tempo de sair
  setTimeout(() => process.exit(0), TEMPOS.SAIDA_DEPOIS_DO_UPDATE_MS);
}

function recusa(engine, texto) {
  engine.emit('toast', { kind: 'error', text: texto });
  return { ok: false, error: texto };
}

// `deps.raiz`, `deps.ehWindows` e `deps.religar` são costuras de teste: o teste troca a
// pasta de verdade por uma temporária e nunca derruba o processo da suíte.
function aplicarNoServidor(engine, deps = {}) {
  const raiz = deps.raiz || APP_ROOT;
  if (deps.ehWindows ?? IS_WIN) {
    return recusa(engine, 'O Farol sem a janela, no Windows, não se atualiza sozinho: rode o instalador da versão nova.');
  }
  // checkout de desenvolvimento: sobrescrever a árvore de trabalho seria perder código
  if (fs.existsSync(path.join(raiz, '.git'))) {
    return recusa(engine, `O Farol roda de um repositório git (${raiz}): atualize com git pull. O update automático não sobrescreve código de desenvolvimento.`);
  }
  try { trocarArquivos(engine.update.source, raiz); }
  catch (err) { return recusa(engine, `Falha ao aplicar a atualização: ${err.message}`); }
  (deps.religar || religar)(engine, raiz);
  engine.emit('toast', { kind: 'info', text: `Atualizado para a ${engine.update.sourceVersion}: o Farol reinicia sozinho em instantes.` });
  return { ok: true, from: APP_VERSION, to: engine.update.sourceVersion };
}

export default { aplicarNoServidor, trocarArquivos, scriptDeReligar };
export { aplicarNoServidor, trocarArquivos, scriptDeReligar };
