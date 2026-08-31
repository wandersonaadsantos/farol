/* Dono do `workspace/tmp`, o diretório de rascunho que as SESSÕES criam por conta
   própria (clone de repositório, patch avulso, cópia de arquivo pra comparar).

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
import { WORKSPACE } from '../paths.js';
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

export default { workspaceTmpDir, pruneWorkspaceTmp };
export { workspaceTmpDir, pruneWorkspaceTmp };
