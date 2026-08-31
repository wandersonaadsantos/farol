/* Dono do RASCUNHO que as SESSÕES deixam no workspace (clone de repositório, patch
   avulso, cópia de arquivo pra comparar), nos dois lugares em que ele aparece: dentro
   de `tmp/` e solto na raiz.

   POR QUE ELE PRECISA DE DONO (medido em 31/08/2026): o `~/.farol/workspace` estava
   com 4,3 GB em 411.321 arquivos, e 4,0 GB deles (394.683 arquivos) eram 20 clones
   deixados ali, cada um com `.git` e `node_modules` completos, o mais novo de 27/08.
   O app já poda o que ELE cria (`state/pr-scope` em 7 dias, `state/file-proof` em 30),
   e a assimetria não era descuido de implementação: até aqui nenhuma linha do engine
   nem do protocolo do workspace citava `tmp/`, então o diretório existia sem ninguém
   responder por ele. Poda sem dono é o que não acontece.

   O engine NUNCA lê daqui, então apagar não pode quebrar revisão nenhuma: o material
   que a revisão precisa preservar vive em `state/` (escopo, prova por arquivo,
   checkpoint), e é lá que as outras podas agem. */
import fs from 'node:fs';
import path from 'node:path';
import { WORKSPACE, TEMPLATE_DIR } from '../paths.js';
import { TEMPOS } from '../constants.js';

// Resolvido a cada chamada, e não numa const de módulo: os testes fixam FAROL_HOME
// antes do import, e o WORKSPACE já vem resolvido, mas manter a função deixa o alvo
// explícito pra quem lê e pra quem testa.
function workspaceTmpDir() { return path.join(WORKSPACE, 'tmp'); }

/* Poda por idade, best-effort e POR ENTRADA (padrão G20 do pruneFileProofs): lixo que
   não sai hoje sai amanhã, e derrubar o boot por um diretório travado seria pior.

   Sete dias, a mesma régua do escopo materializado, e a folga é deliberada: uma sessão
   headless vive no máximo 30 minutos (SESSAO_HEADLESS_MS), então material com uma
   semana não pode pertencer a nada em andamento. Some a isso o momento da chamada, que
   é o BOOT: ali `activeReviews` está vazio por construção, porque ele é memória. */
function pruneWorkspaceTmp(maxAgeMs = TEMPOS.TMP_SESSAO_MAX_AGE_MS, agora = Date.now()) {
  const base = workspaceTmpDir();
  let entradas;
  try { entradas = fs.readdirSync(base, { withFileTypes: true }); } catch { return 0; }
  let removidos = 0;
  for (const e of entradas) {
    const alvo = path.join(base, e.name);
    try {
      if (agora - fs.statSync(alvo).mtimeMs <= maxAgeMs) continue;
      fs.rmSync(alvo, { recursive: true, force: true });
      removidos++;
    } catch { /* best-effort: entrada em uso ou caminho longo tenta de novo no próximo boot */ }
  }
  return removidos;
}

/* A RAIZ do workspace acumula o mesmo rascunho, só que um nível acima.

   Medido em 31/08/2026, DEPOIS da poda do tmp/: sobraram 331 MB em 16.638 arquivos na
   raiz, sendo 152 MB só no `_pr849/`, mais `biud-esg-256/258`, `_esg204` e `esg208`.
   São clones e patches que as sessões largaram ali em vez de em `tmp/`.

   AQUI A REGRA É DE PRESERVAÇÃO, e não de descarte, porque na raiz mora coisa que não
   pode sair: `state/` (dados do usuário), o protocolo que o app sincroniza a cada boot
   e o `tmp/`, que tem poda própria. E a lista do que preservar é DERIVADA do que o app
   semeia (o conteúdo do workspace-template), nunca curada à mão: uma lista escrita aqui
   envelheceria calada no dia em que o template ganhasse um arquivo novo, e o app
   passaria a apagar o próprio protocolo.

   FALHA FECHADA, e é a trava que importa: template ilegível significa não saber o que
   preservar, e aí não se apaga nada. Sem isso, uma falha de leitura viraria a remoção
   de `CLAUDE.md`, `prompts/` e `.claude/` do workspace de quem estiver rodando. */
function pruneWorkspaceRaiz(maxAgeMs = TEMPOS.TMP_SESSAO_MAX_AGE_MS, agora = Date.now(), templateDir = TEMPLATE_DIR) {
  let semeados;
  try { semeados = fs.readdirSync(templateDir); } catch { return 0; }
  if (!semeados.length) return 0;
  const preservar = new Set([...semeados, 'state', 'tmp']);
  let entradas;
  try { entradas = fs.readdirSync(WORKSPACE, { withFileTypes: true }); } catch { return 0; }
  let removidos = 0;
  for (const e of entradas) {
    if (preservar.has(e.name)) continue;
    const alvo = path.join(WORKSPACE, e.name);
    try {
      if (agora - fs.statSync(alvo).mtimeMs <= maxAgeMs) continue;
      fs.rmSync(alvo, { recursive: true, force: true });
      removidos++;
    } catch { /* best-effort por entrada, igual à poda do tmp/ */ }
  }
  return removidos;
}

export default { workspaceTmpDir, pruneWorkspaceTmp, pruneWorkspaceRaiz };
export { workspaceTmpDir, pruneWorkspaceTmp, pruneWorkspaceRaiz };
