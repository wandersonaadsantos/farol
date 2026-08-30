// O gate da constituição precisa FALHAR quando não consegue rodar, nunca passar
// calado. Gate que se cala quando não sabe passa a atestar o que não verificou,
// e é o modo de falha mais caro que existe aqui: o pre-push fica verde sem ter
// medido nada, e ninguém descobre até o dano aparecer em outro lugar.
//
// Os dois casos são as duas maneiras concretas de o pacote não estar
// disponível, e elas pedem mensagens diferentes: diretório ausente é problema de
// checkout, diretório presente sem `dist/` é problema de build. Mandar rodar o
// build num caminho que não existe manda a pessoa para o lugar errado.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolverCli, versaoDo } from '../tools/eng-behaviour/gate.js';

function temporario(prefixo) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefixo));
}

test('recusa quando o pacote nao esta no caminho', () => {
  const ausente = path.join(temporario('farol-eng-'), 'nao-existe');
  const r = resolverCli(ausente);
  assert.equal(r.cli, undefined);
  assert.match(r.erro, /nao encontrado/);
});

test('recusa quando o pacote existe mas nao foi construido, e diz que o problema e o build', () => {
  // A distinção importa: aqui o clone está no lugar, e mandar clonar de novo
  // seria a orientação errada.
  const home = temporario('farol-eng-');
  const r = resolverCli(home);
  assert.equal(r.cli, undefined);
  assert.match(r.erro, /sem build/);
  fs.rmSync(home, { recursive: true, force: true });
});

test('aceita quando dist/cli/main.js existe, e devolve o home junto', () => {
  const home = temporario('farol-eng-');
  fs.mkdirSync(path.join(home, 'dist', 'cli'), { recursive: true });
  fs.writeFileSync(path.join(home, 'dist', 'cli', 'main.js'), '', 'utf8');
  const r = resolverCli(home);
  assert.equal(r.erro, undefined);
  assert.equal(r.home, home);
  assert.ok(r.cli.endsWith(path.join('dist', 'cli', 'main.js')));
  fs.rmSync(home, { recursive: true, force: true });
});

test('a versao vem do package.json do pacote, e nao do farol', () => {
  const home = temporario('farol-eng-');
  fs.writeFileSync(path.join(home, 'package.json'), JSON.stringify({ version: '9.9.9' }), 'utf8');
  assert.equal(versaoDo(home), '9.9.9');
  fs.rmSync(home, { recursive: true, force: true });
});

test('versao ilegivel nao derruba o gate, so deixa de ser afirmada', () => {
  // A versão é transparência, não gate. Um package.json quebrado no pacote é
  // problema dele, e travar o Farol por causa disso trocaria uma informação
  // perdida por um bloqueio, que é pior.
  const home = temporario('farol-eng-');
  fs.writeFileSync(path.join(home, 'package.json'), '{ nao e json', 'utf8');
  assert.equal(versaoDo(home), 'desconhecida');
  fs.rmSync(home, { recursive: true, force: true });
});
