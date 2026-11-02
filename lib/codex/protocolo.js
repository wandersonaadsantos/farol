// O protocolo do workspace pode ter sido escrito para outro provedor.
// A revisão usa as ferramentas da sessão atual, sem criar dependência de outro login.
function protocoloCodex(prompt, operationKind) {
  if (!['review', 'self'].includes(operationKind)) return prompt;
  return prompt + `\n\n## Execução da revisão no Codex (prevalece sobre instruções de ferramentas de outro provedor)
O provedor desta sessão é o Codex. Não execute claude, agy ou outro provedor para
cumprir o passo pr-reviewer ou claim-verifier; não dependa do login de outro perfil.
Leia o protocolo em .claude/agents/pr-reviewer.md e faça a análise completa com as
ferramentas disponíveis aqui. Se a sessão disponibilizar subagentes nativos, use-os;
sem essa capacidade, execute você mesmo a revisão e a verificação, sem inventar delegação.
No envelope, registre protocolo.prReviewer como dispensado com motivo explícito
quando o trabalho foi feito pela sessão principal. Isso não dispensa leitura,
critérios, cobertura, verificação de afirmações nem evidência técnica.
Para o checkpoint, emita FAROL_CHECKPOINT: {...} em mensagem separada antes do
envelope final, com o formato e as provas exigidos no protocolo. Não escreva o arquivo.
Uma falha anterior de autenticação de outro provedor não prova falha no Codex:
execute o trabalho pendente aqui. Se uma ferramenta desta sessão realmente falhar,
registre o impedimento e preserve analysisStatus incomplete; nunca invente conclusão.
O resultado final continua sendo apenas o envelope JSON do protocolo desta sessão.\n`;
}

export { protocoloCodex };
