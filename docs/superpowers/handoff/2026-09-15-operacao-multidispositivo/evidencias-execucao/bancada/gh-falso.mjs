// Dublê do GitHub para a bancada, carregado com `node --import` SÓ no aparelho A.
//
// FRONTEIRA SIMULADA, declarada: toda chamada `gh` deste processo é respondida aqui, sem
// rede e sem credencial real. A busca "pedido de revisão a mim" devolve o PR do cenário, o
// token é um texto falso, o head é o do cenário, e todo o resto (postar review, labels, API)
// falha com "não simulado", então nada sai da máquina e nada é postado.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const raiz = process.env.FAROL_RAIZ;
const io = (await import(pathToFileURL(path.join(raiz, 'lib', 'io.js')).href)).default;

const HEAD = 'a'.repeat(40);
const PR = {
  url: 'https://github.com/acme-exemplo/app-web/pull/41', title: 'Ajusta o rodapé do relatório', isDraft: false,
  author: { login: 'bruno-exemplo' }, number: 41, repository: { nameWithOwner: 'acme-exemplo/app-web' },
  updatedAt: '2026-09-16T20:00:00Z', labels: [],
};

function resposta(stdout, ok = true) {
  return Promise.resolve({ ok, code: ok ? 0 : 1, stdout, stderr: ok ? '' : 'gh falso da bancada: chamada não simulada' });
}

function responder(args) {
  const a = args.join(' ');
  if (a.startsWith('auth token')) return resposta('token-falso-da-bancada\n');
  if (a.startsWith('auth status')) return resposta('');
  if (a.startsWith('search prs') && a.includes('--review-requested=@me')) return resposta(JSON.stringify([PR]));
  if (a.startsWith('search prs')) return resposta('[]');
  if (a.startsWith('pr view') && a.includes('headRefOid')) return resposta(`${HEAD}\n`);
  return resposta('', false);
}

const runReal = io.run;
io.run = (cmd, args, opts) => (cmd === 'gh' ? responder(args || []) : runReal(cmd, args, opts));
const shellReal = io.runShell;
io.runShell = (linha, opts) => (/^\s*gh\s/.test(String(linha)) ? resposta('', false) : shellReal(linha, opts));
