// Guarda de "fui executado direto?" pós-ESM (regressão achada num Mac em 17/08/2026).
//
// Em CommonJS a guarda era `require.main === module`, e comparava OBJETOS de módulo,
// que o Node chaveia pelo caminho REAL. Symlink no caminho não mudava nada. A versão
// ESM escrita na migração compara strings:
//
//     import.meta.url === pathToFileURL(process.argv[1]).href
//
// e os dois lados não vêm da mesma fonte: `import.meta.url` já vem resolvido por
// realpath, enquanto `process.argv[1]` é o caminho como o usuário digitou. Com um
// caminho ABSOLUTO que passe por symlink os dois divergem, a guarda dá falso, e
// `node /caminho/com/symlink/server.js` carrega o módulo inteiro, NÃO sobe o servidor
// e sai com código 0: silêncio total, sem erro e sem log.
//
// No macOS isso não é hipótese: /tmp e /var/folders SÃO symlinks (/tmp -> private/tmp),
// e o próprio CLAUDE.md documenta `FAROL_HOME=/tmp/farol-teste node server.js` como o
// jeito de rodar isolado. Vale pros três pontos que usam a guarda: server.js (modo
// servidor) e os dois gates de qualidade, onde é pior ainda, porque um gate que sai 0
// sem ter checado nada passa por verde.
//
// Caminho RELATIVO continua funcionando por acidente feliz (pathToFileURL resolve
// contra o cwd, e o getcwd do sistema já devolve o caminho canônico), e é por isso que
// `npm run lint` nunca denunciou o problema.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

import { executadoDireto } from '../lib/paths.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-exec-direta-'));
after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ } });

const real = path.join(dir, 'alvo.js');
fs.writeFileSync(real, '// alvo\n');
const urlReal = pathToFileURL(fs.realpathSync(real)).href;

test('caminho idêntico conta como execução direta', () => {
  assert.equal(executadoDireto(urlReal, real), true);
});

// No Windows, criar symlink exige privilégio ou modo desenvolvedor; sem ele o
// symlinkSync sai com EPERM e o teste falharia por limitação da MÁQUINA, não do
// código. O cenário que importa (symlink em /tmp) é do macOS/Linux, cobertos na
// matriz do CI, então aqui o pulo é honesto, mesmo padrão dos testes posix.
let linkOk = true;
const link = path.join(dir, 'link.js');
try { fs.symlinkSync(real, link); } catch (e) {
  if (process.platform === 'win32' && e.code === 'EPERM') linkOk = false;
  else throw e;
}
test('caminho ABSOLUTO por symlink ainda conta como execução direta',
  { skip: linkOk ? false : 'symlink indisponível neste Windows (sem modo desenvolvedor)' }, () => {
    assert.equal(executadoDireto(urlReal, link), true,
      'sem isto, node /caminho/symlink/server.js carrega tudo e sai 0 sem subir nada');
  });

test('outro arquivo NÃO conta como execução direta (import continua sendo import)', () => {
  const outro = path.join(dir, 'outro.js');
  fs.writeFileSync(outro, '// outro\n');
  assert.equal(executadoDireto(urlReal, outro), false);
});

test('sem argv[1] devolve false, nunca lança', () => {
  assert.equal(executadoDireto(urlReal, undefined), false);
  assert.equal(executadoDireto(urlReal, ''), false);
});

test('argv[1] inexistente devolve false em vez de explodir no realpath', () => {
  // processo embutido (node -e) tem argv[1] que não é arquivo: não pode derrubar o boot
  assert.equal(executadoDireto(urlReal, path.join(dir, 'nao-existe.js')), false);
});

test('os três pontos do repo usam a guarda única, não a comparação crua', () => {
  const raiz = path.join(import.meta.dirname, '..');
  for (const alvo of ['server.js', 'tools/quality/gate.js', 'tools/quality/higiene.js']) {
    const src = fs.readFileSync(path.join(raiz, alvo), 'utf8');
    assert.ok(src.includes('executadoDireto'), `${alvo} usa a guarda única`);
    assert.equal(/import\.meta\.url\s*===\s*pathToFileURL/.test(src), false,
      `${alvo} não pode voltar à comparação crua, que quebra sob symlink`);
  }
});
