// As guardas de permissão da sessão de revisão (06/11/2026): o arquivo de settings do Farol que
// toda sessão headless de revisão e de autoanálise recebe por `--settings`.
//
// Por que por linha de comando, e não no `settings.json` do workspace: o `prepareHome` nunca
// regrava o `settings.json` semeado (é do usuário), então uma regra nova nunca chegaria a uma
// instalação existente; o `--settings` soma um arquivo que viaja com o app, e a regra vale no
// mesmo boot em que o motor atualiza. O conteúdo é só `deny`: as rotas pelas quais uma sessão
// barrada de ler a projeção redigida buscou o patch cru no GitHub (`gh pr diff`,
// `gh api .../pulls/N/files`), e o pacote inteiro do repositório (tarball, zipball, clone), que
// um subagente baixou para o /tmp. Regra de `deny` vale mesmo com
// `--dangerously-skip-permissions`, que é o que fazia o `Read(.env.*)` do usuário barrar a
// projeção. O arquivo mora em `workspace-template/.claude/guardas.json`, fora das listas de
// prompt que o `prepareHome` sincroniza, e é lido pelo CLI na hora, nunca copiado.
import path from 'node:path';
import { TEMPLATE_DIR } from '../paths.js';

const ARQUIVO_DE_GUARDAS = path.join(TEMPLATE_DIR, '.claude', 'guardas.json');

// Argumentos de linha de comando, no mesmo molde do `--mcp-config` (lib/engine/jira.js): o
// caminho vai entre aspas porque a linha passa pelo shell.
function guardasDaSessao() {
  return ['--settings', `"${ARQUIVO_DE_GUARDAS}"`];
}

export { ARQUIVO_DE_GUARDAS, guardasDaSessao };
