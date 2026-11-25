// A sessão de revisão não lê o arquivo de credencial do Claude (porte do fork, 24/11/2026).
//
// O `.credentials.json` da pasta do perfil guarda o token da assinatura. A sessão roda com o
// workspace como raiz e ferramentas de leitura e de shell; sem `deny`, um subagente curioso ou um
// texto de PR com instrução escondida poderia ler o token. A regra vale nas guardas que toda
// sessão recebe por `--settings` (guardas-da-sessao.js, que alcançam instalação existente no
// mesmo boot) e no `settings.json` semeado, para a instalação nova nascer igual.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const { ARQUIVO_DE_GUARDAS } = await import('../lib/engine/guardas-da-sessao.js');
const SEMEADO = path.join(path.dirname(ARQUIVO_DE_GUARDAS), 'settings.json');
const negados = (arquivo) => JSON.parse(fs.readFileSync(arquivo, 'utf8')).permissions.deny;

for (const [nome, arquivo] of [['guardas da sessão', ARQUIVO_DE_GUARDAS], ['settings.json semeado', SEMEADO]]) {
  test(`${nome}: nega ler o arquivo de credencial pelo Read e pelo Bash`, () => {
    const deny = negados(arquivo);
    assert.ok(deny.includes('Read(**/.credentials.json)'), deny.join(', '));
    assert.ok(deny.includes('Bash(*.credentials.json*)'), deny.join(', '));
    // padrão de Read sem prefixo vale relativo ao diretório da sessão: a credencial mora fora dele,
    // na pasta do Claude ou na do perfil, então a guarda precisa do caminho da casa e do absoluto
    assert.ok(deny.includes('Read(~/.claude/**/.credentials.json)'), deny.join(', '));
    assert.ok(deny.includes('Read(//**/.credentials.json)'), deny.join(', '));
    assert.ok(deny.includes('Bash(*/.credentials*)'), 'o shell com caminho abreviado também é negado');
  });
}

test('as duas listas de negação continuam iguais', () => {
  assert.deepEqual(negados(SEMEADO), negados(ARQUIVO_DE_GUARDAS));
});
