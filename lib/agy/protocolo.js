// O protocolo do Farol, do jeito que o Antigravity CLI consegue ler. PURO, mais a gravação.
//
// O `agy` não lê `CLAUDE.md`: lê `AGENTS.md`/`GEMINI.md` e os arquivos de `.agents/rules/` do
// workspace, e CORTA cada arquivo de regra em 24.000 bytes. Medido em 20/10/2026 (spec, seção
// 8): o protocolo copiado inteiro como `AGENTS.md` (25.958 bytes) chegou com o fim cortado em
// todas as rodadas (`Rule file ... truncated by 1974 bytes`). Aqui ele é partido por seção
// (`## `) em arquivos abaixo do teto, com folga, regravados a cada sessão do `agy` a partir do
// `CLAUDE.md` do workspace (que o boot ressincroniza do template).
//
// Junto vai a substituição do prompt da revisão para este provedor (spec, seção 8): sem o
// subagente `pr-reviewer` (com ele a revisão custou cerca de 50 pontos da cota semanal e
// aprovou um PR que quebra teste; sem ele, 16 pontos e o veredito certo duas vezes), e o
// marcador de checkpoint como LINHA DE TEXTO, porque aqui não há `description` de Bash.
import fs from 'node:fs';
import path from 'node:path';

const LIMITE_DO_ARQUIVO = 24000;
// o cabeçalho de cada parte e a folga do CLI cabem aqui dentro
const ALVO_DA_PARTE = LIMITE_DO_ARQUIVO - 2000;
const PREFIXO = 'farol-protocolo-';
const PASTA_DAS_REGRAS = path.join('.agents', 'rules');

function bytes(s) { return Buffer.byteLength(s, 'utf8'); }

// Corta um texto em pedaços de no máximo `alvo` bytes, no limite mais natural que couber:
// parágrafo, depois linha. Uma linha sozinha maior que o alvo (não acontece no protocolo)
// é cortada por caractere, para o teto nunca ser furado.
function cortar(texto, alvo, separador) {
  const pecas = texto.split(separador);
  const out = [];
  let atual = '';
  for (const p of pecas) {
    const junto = atual ? atual + separador + p : p;
    if (bytes(junto) <= alvo) { atual = junto; continue; }
    if (atual) out.push(atual);
    atual = p;
  }
  if (atual) out.push(atual);
  return out;
}

function caberNoAlvo(texto, alvo) {
  if (bytes(texto) <= alvo) return [texto];
  const porParagrafo = cortar(texto, alvo, '\n\n');
  return porParagrafo.flatMap((p) => {
    if (bytes(p) <= alvo) return [p];
    return cortar(p, alvo, '\n').flatMap((linha) => (bytes(linha) <= alvo ? [linha] : porCaractere(linha, alvo)));
  });
}

function porCaractere(texto, alvo) {
  const out = [];
  let atual = '';
  for (const ch of texto) {
    if (bytes(atual + ch) > alvo) { out.push(atual); atual = ''; }
    atual += ch;
  }
  if (atual) out.push(atual);
  return out;
}

// As seções de nível 2 (`## `), cada uma com o próprio título. O que vem antes da primeira
// é uma seção também.
function secoes(texto) {
  const partes = String(texto || '').replace(/\r\n/g, '\n').split(/\n(?=## )/);
  return partes.filter((s) => s.trim());
}

/**
 * O protocolo em partes, cada uma (com o cabeçalho) abaixo de 24.000 bytes. Seções vizinhas
 * dividem o arquivo enquanto cabem; seção maior que o alvo é partida por parágrafo.
 * @returns {string[]}
 */
function partirProtocolo(texto, alvo = ALVO_DA_PARTE) {
  const blocos = secoes(texto).flatMap((s) => caberNoAlvo(s, alvo));
  const partes = [];
  let atual = '';
  for (const b of blocos) {
    const junto = atual ? `${atual}\n\n${b}` : b;
    if (bytes(junto) <= alvo) { atual = junto; continue; }
    partes.push(atual);
    atual = b;
  }
  if (atual) partes.push(atual);
  return partes.map((p, i) => `<!-- Protocolo do Farol, parte ${i + 1} de ${partes.length}. As partes juntas são um documento só, na ordem dos números. -->\n\n${p}\n`);
}

function nomeDaParte(i) { return `${PREFIXO}${String(i + 1).padStart(2, '0')}.md`; }

/**
 * Grava as partes em `<workspace>/.agents/rules/` e tira as partes que sobraram de uma
 * versão maior do protocolo. Só regrava o que mudou. Devolve os caminhos gravados.
 */
function escreverRegras(workspace, texto) {
  const pasta = path.join(workspace, PASTA_DAS_REGRAS);
  fs.mkdirSync(pasta, { recursive: true });
  const partes = partirProtocolo(texto);
  const caminhos = partes.map((conteudo, i) => {
    const alvo = path.join(pasta, nomeDaParte(i));
    let atual = null;
    try { atual = fs.readFileSync(alvo, 'utf8'); } catch { /* parte nova */ }
    if (atual !== conteudo) fs.writeFileSync(alvo, conteudo);
    return alvo;
  });
  const validos = new Set(partes.map((_, i) => nomeDaParte(i)));
  for (const n of fs.readdirSync(pasta)) {
    if (n.startsWith(PREFIXO) && !validos.has(n)) fs.rmSync(path.join(pasta, n), { force: true });
  }
  return caminhos;
}

// A substituição do prompt para o `agy`. Vai NO FIM do prompt da revisão, que já diz que as
// substituições prevalecem sobre o protocolo onde conflitarem.
const MOTIVO_SEM_SUBAGENTE = 'provedor Antigravity sem subagente: a revisão do pr-reviewer foi feita pela sessão principal';

// Só a revisão e a autoanálise seguem o protocolo do `pr-reviewer` e do checkpoint; chat,
// pushback e ferramentas recebem o prompt como veio.
function blocoDoProvedor(operacao = 'review') {
  if (operacao !== 'review' && operacao !== 'self') return '';
  return '\n\n## Neste provedor (Antigravity CLI)\n'
    + 'Estas regras prevalecem sobre o protocolo e sobre as substituições acima onde conflitarem:\n'
    + '1. **Não há o subagente `pr-reviewer` nesta sessão, nem `claim-verifier`.** No passo 4, faça você mesmo, aqui, a revisão que o `pr-reviewer` faria: leia o diff inteiro pelo `gh`, abra no head os arquivos alterados quando o trecho não se explica sozinho, procure o uso do código alterado fora do diff, rode as verificações em série e aplique o gate dos blockers. No envelope, declare '
    + `\`"protocolo": { "prReviewer": "dispensado", "motivo": "${MOTIVO_SEM_SUBAGENTE}" }\`.\n`
    + '2. **O marcador de checkpoint é uma LINHA DE TEXTO da sua resposta**, porque aqui não existe o campo `description` de Bash: escreva a linha `FAROL_CHECKPOINT: {...}` sozinha, no formato exato da seção do checkpoint, uma linha por veredito. O app captura a linha; continue sem escrever o arquivo de checkpoint.\n'
    + '3. **O envelope JSON é a sua ÚLTIMA mensagem, sozinho**: nada de texto nem de marcador de checkpoint na mesma mensagem dele.\n';
}

export default { LIMITE_DO_ARQUIVO, PASTA_DAS_REGRAS, MOTIVO_SEM_SUBAGENTE, partirProtocolo, escreverRegras, blocoDoProvedor, secoes };
export { LIMITE_DO_ARQUIVO, PASTA_DAS_REGRAS, MOTIVO_SEM_SUBAGENTE, partirProtocolo, escreverRegras, blocoDoProvedor, secoes };
