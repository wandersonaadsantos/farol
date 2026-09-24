// Montagem do PROMPT da revisao headless (23/09/2026).
//
// Saiu do lib/engine/review.js, que ja estava na divida registrada de responsabilidade
// unica e cresceu de novo quando o vigia, o reparo do envelope e as licoes do
// repositorio entraram. O corte foi por RESPONSABILIDADE, e nao por tamanho: aqui mora
// tudo que decide O QUE A SESSAO LE antes de comecar (o protocolo do arquivo, o perfil
// do autor, o formato do review, a regra sobre review de terceiro, as licoes do repo e
// o instrutivo de fan-out), e nada que decida o que fazer com o resultado.
//
// Nao importa o review.js: o que ele precisa daqui chega pelo engine (engine.prFromUrl,
// engine.pushbacksFor), que ja e o contexto que todo colaborador recebe. Import de volta
// criaria ciclo entre dois arquivos que mudam junto, e e o comeco de os dois voltarem a
// ser um so.
import fs from 'node:fs';
import path from 'node:path';
import { WORKSPACE, TEMPLATE_DIR } from '../paths.js';
import { PAPEL_LEVELS, PAPEL_LABEL, PAPEL_TONE, DOMAINS, DOMAIN_LEVELS, DOMAIN_LABEL, DOMAIN_LEVEL_LABEL, DOMAIN_POSTURE } from '../taxonomy.js';
import { PUSHBACK_LABEL } from '../taxonomy.js';
import { checkpointPath } from './verification-checkpoint.js';
import pushbackMod from './pushback.js';
import fanoutMod from './fanout.js';

// bloco injetado no prompt de revisão: ajusta TOM + POSTURA, nunca a decisão.
// Papel dá o tom-base; a matriz por domínio calibra a postura por área do PR;
// o histórico de pushback calibra humildade/assertividade com aquela pessoa.
function personProfileBlock(engine, login) {
  const p = engine.personProfile(login);
  const papel = PAPEL_LEVELS.includes(p.papel) ? p.papel : '';
  const doms = (p.dominios && typeof p.dominios === 'object') ? p.dominios : {};
  const domEntries = DOMAINS.filter(d => DOMAIN_LEVELS.includes(doms[d]));
  const pushbacks = engine.pushbacksFor(login).slice(0, 5);
  if (!papel && !domEntries.length && !pushbacks.length) return ''; // sem perfil nem histórico = tom neutro
  let block = `\n\n## Perfil do autor\n`;
  if (papel) block += `Papel de @${login}: **${PAPEL_LABEL[papel]}** (${PAPEL_TONE[papel]})\n`;
  if (domEntries.length) {
    block += `Competência por domínio (cruze com a área que o PR mexe):\n`;
    for (const d of domEntries) block += `- ${DOMAIN_LABEL[d]} (nível **${DOMAIN_LEVEL_LABEL[doms[d]]}**): ${DOMAIN_POSTURE[doms[d]]}\n`;
  }
  if (pushbacks.length) {
    block += `\nHistórico de pushback com @${login} (revisões suas que ele contestou):\n`;
    for (const pb of pushbacks) block += `- ${pb.key}: ${PUSHBACK_LABEL[pb.outcome] || pb.outcome}${pb.note ? ` (${pb.note})` : ''}\n`;
    block += `Calibre a humildade e a assertividade por isso: onde ele já mostrou que estava certo, seja mais cuidadoso antes de afirmar algo parecido; onde você estava certo, mantenha a posição com clareza.\n`;
  }
  block += `\nAjuste APENAS o TOM e a POSTURA (o quanto explica, o quanto defere, como levanta os pontos) nos corpos dos payloads e nos comentários inline. ` +
    `NÃO mude a decisão técnica: verdict, decision, cardMet, findings e o gate seguem valendo só pelos fatos do código. O perfil muda COMO você escreve, nunca SE aprova ou reprova.\n`;
  return block;
}

// Como escrever o corpo POSTADO no PR: humano, personalizado, objetivo e
// profissional, adaptado à senioridade do autor (usa o Perfil do autor acima).
// PREVALECE sobre o formato do CLAUDE.md. Injetado SEMPRE, pra o review nunca
// sair com cara de bot (era a queixa: carimbos e template robótico).
function reviewFormatBlock(engine) {
  return `\n\n## Como escrever o corpo do review postado no PR (PREVALECE sobre o formato do CLAUDE.md)\n` +
    `Escreva como você escreveria: uma pessoa sênior revisando o PR de um colega, não uma ferramenta. Personalizado, objetivo e profissional.\n` +
    `- **Separe os campos:** \`reportMarkdown\` e \`reasons\` são diagnóstico INTERNO e podem explicar gate/processo. \`reviewMarkdown\`, os três \`payloads.*.body\` e todo \`comments[].body\` são REVIEW para o autor. Nunca copie "Ação", gate, política, cobertura, memória, prompt, agentes ou justificativa de postagem do relatório interno pros campos de review.\n` +
    `- **Sem cara de bot:** NADA de caixas de alerta (\`> [!NOTE]\`/\`> [!WARNING]\`), nem "Placar", nem checklist de critérios com \`- [x]\`, nem os prefixos de Conventional Comments no texto ("🟡 suggestion (non-blocking):", "🔴 issue (blocking):" e afins). NUNCA use automação, Farol, Claude, IA, modelo, bot, agente/subagente, prompt, memória interna, política/gate, \`auto_approve\`, "auto-aprovei/não auto-aprovei", "revisão automática" ou "ficou só no app" como origem, ator ou justificativa do review. Quando forem o próprio assunto técnico do PR, esses termos podem aparecer normalmente. O review fala apenas de código, impacto e ação do autor.\n` +
    `- **Use TODO o perfil do autor acima** (papel, competência por domínio, histórico de pushback) pra personalizar tom, profundidade e deferência, e adapte o FORMATO à senioridade:\n` +
    `  - Estágio/Júnior: prosa acolhedora de mentor. Abra reconhecendo o que ficou bom de verdade (específico, com o porquê), explique cada ajuste ensinando ("o que segura o merge é..."), enquadre como "quase lá", feche natural.\n` +
    `  - Pleno/Sênior/Tech Lead/Arquiteto: enxuto e direto, de par pra par. Vá aos pontos técnicos sem preâmbulo nem elogio de consolo, assumindo contexto compartilhado.\n` +
    `  - Especialista: no domínio dele, defira e foque na nuance; fora, trate como par.\n` +
    `  - Sem perfil marcado: tom neutro, direto e cordial.\n` +
    `- **Tom:** direto e claro, sem gíria nem subtexto, **sem travessão** (use vírgula, parênteses ou dois pontos). Elogio só quando sincero e específico (nunca de consolo). Português brasileiro.\n` +
    `- **Substância intacta:** blockers e ressalvas entram no texto de forma natural (o que é, por que importa, o que muda), com \`arquivo:linha\` quando ajudar. Muda só COMO você escreve, nunca a decisão nem o rigor. Comentários inline também sem os prefixos de label: escreva como observação humana. \`reviewMarkdown\` é essa mesma revisão humanizada para a tela, nunca o relatório operacional.\n` +
    `- **Aprovando COM ressalva, a ressalva vai no corpo do PR** (decisão de 29/07/2026): aprovar não é deixar passar em silêncio, e o autor tem direito de saber o que você notou. Escreva como um revisor sênior mencionaria de passagem (o ponto, por que importa, e que não segura o merge), sem checklist e sem seção de "ressalvas". **Filtro do que entra:** ressalva TÉCNICA sobre o código entra (validação que falta, dependência de endpoint inexistente, teste que não cobre o caso). Ressalva OPERACIONAL do nosso fluxo NÃO entra e fica só em \`reasons\`: card que não deu pra confirmar por falha de acesso ao Jira, review que não era pedido a você, discordância com outro review, política de conta, cobertura incompleta da leitura. Isso é assunto interno, não recado pro autor, e citar vazaria a automação.\n`;
}

// Como lidar com reviews de TERCEIROS no mesmo PR (Acrity, SonarQube, Snyk, colegas).
// Regra do Wanderson (29/07/2026): revisão independente primeiro; contestar SÓ com
// certeza comprovada, senão fica calado. O silêncio é o default: não contestar não
// custa nada, contestar errado queima a credibilidade da contestação legítima, e
// pior, do review inteiro. Qualquer contestação vai pro `contested` e força
// needs_decision (nunca sai pro PR sem o Wanderson ver).
function thirdPartyReviewBlock() {
  return `\n\n## Reviews de terceiros no mesmo PR (Acrity, Sonar, Snyk, colegas)\n` +
    `Um PR pode já ter review de outra ferramenta ou pessoa. Trate assim, nesta ordem:\n` +
    `1. **Sua revisão é INDEPENDENTE e vem primeiro.** Forme seu veredito a partir do código, do diff e do card, ANTES de ler o que os outros apontaram. Não ancore: achado de terceiro não vira seu achado sem você confirmar no código, e aprovação de terceiro não relaxa seu gate.\n` +
    `2. **Se o achado do outro é REAL e você não tinha visto, ADOTE.** Confirme no código, incorpore com a severidade que você mesmo daria e siga sua própria regra de blocker. Esse é o principal ganho de ler o review alheio: pegar o que passou por você. Não minimize por orgulho.\n` +
    `3. **Discordar é a exceção, e cada tipo tem um rótulo e uma barra própria.** Nunca use "falso positivo" como rótulo genérico de discordância:\n` +
    `   - **falso_positivo** (o FATO está errado): só quando TODAS valem: (a) é afirmação factual sobre o código, não preferência, convenção ou escopo; (b) você ABRIU o arquivo no ponto citado e conferiu; (c) você tem \`arquivo:linha\` que REFUTA a afirmação; (d) não existe leitura razoável em que a afirmação seja verdadeira (outro caminho, outro arquivo, outra versão do diff). Faltando qualquer uma, NÃO é falso positivo.\n` +
    `   - **fora_de_escopo** (o fato procede, o endereço não): só quando o PR, a spec ou o card DOCUMENTAM o adiamento. Cite o texto que documenta. Sem documento explícito, não discuta escopo.\n` +
    `   - **pre_existente** (o fato procede, não veio deste PR): só com o diff como prova (arquivo não tocado pelo PR). Diga como confirmou.\n` +
    `   - **criterio_nao_vigente** (a convenção citada não é praticada no repo): só com CONTAGEM medida por você no repo (ex.: "98 stories para 1084 componentes"). Sem o número, fique calado.\n` +
    `4. **Na dúvida, FIQUE CALADO sobre o apontamento do outro e entregue a sua análise.** Silêncio não é erro. Se você não consegue provar em uma linha, não escreva. Prefira ❓ question ("isso é intencional?") a afirmar que o outro errou.\n` +
    `5. **NUNCA conteste:** severidade/tom que é preferência ("eu classificaria diferente"), decisão de produto que não é sua, funcionamento interno da outra ferramenta (você não sabe como ela decide), nem nada só pra economizar trabalho. Se o apontamento é real e barato de resolver, o certo é resolver, não contestar.\n` +
    `6. **Conceda antes de discordar.** Se dos 4 apontamentos 3 procedem, diga isso primeiro, com clareza. Contestação que não concede nada lê como fuga.\n` +
    `7. **Registro:** cada discordância vira um item em \`contested\` (schema abaixo) e uma linha no \`reportMarkdown\`. Item em \`contested\` obriga \`decision = "needs_decision"\`: contestação pública nunca sai sozinha, fica para decisão humana, sempre. No corpo dos payloads, escreva a contestação como uma PESSOA revisando (o ponto, a prova, o que muda), sem citar automação, sem nomear ferramenta como adversária e sem ironia.\n`;
}

// O que ESTE repositorio ja me ensinou, pelo eixo que o bloco do autor nao cobre. O
// historico de pushback entrava no prompt so por PESSOA (pushbacksFor), entao a licao
// que um autor ensinou nunca chegava na revisao de outro na mesma base. O autor atual
// fica de fora daqui porque o bloco dele ja veio logo acima, e o PR em revisao nao
// ensina a si mesmo.
function licoesDesteRepo(engine, pr, author) {
  if (!pr || !pr.repo) return '';
  return pushbackMod.licoesDoRepoBlock(
    pushbackMod.licoesDoRepo(engine, pr.repo, { excluirKey: pr.key, excluirAutor: author }));
}

// QUEM a sessao e (23/09/2026). Caso medido em biudtech/biud-frontend#1150: rodando na
// conta @Gabrielk5, o Farol postou um comentario dizendo "@Gabrielk5 ja deixou isso
// registrado na review de aprovacao". Quem escreveu e quem foi citado eram a MESMA
// conta: o texto falava de si em terceira pessoa, como se a aprovacao anterior fosse de
// outra pessoa. E a assinatura mais clara de que nao foi gente que escreveu.
//
// A sessao nao tinha como saber: o prompt dizia como escrever, para quem, sobre o que, e
// nunca dizia QUEM ela e. Sem conta conhecida o bloco sai vazio, porque inventar uma
// identidade seria pior que nao ter nenhuma.
function identidadeBlock(login) {
  const quem = String(login || '').trim();
  if (!quem) return '';
  return '\n\n## Quem é você neste PR\n'
    + `Tudo que você escrever vai ser postado pela conta **@${quem}**, que é a sua. Review, `
    + `aprovação, comentário, label ou resposta de @${quem} neste PR foram feitos por VOCÊ.` + '\n'
    + 'Fale deles na primeira pessoa ("já registrei isso na aprovação", "como comentei acima"), '
    + 'nunca na terceira pessoa, e nunca se mencione com arroba: escrever "@' + quem + ' já deixou registrado" '
    + 'é falar de si como se fosse outra pessoa, e é o que denuncia na hora que não foi gente que escreveu.\n'
    + 'Citar OUTRAS pessoas com arroba continua normal.' + '\n';
}

function headlessPromptFor(engine, url, author, lotes, metrics) {
  const candidates = [
    path.join(WORKSPACE, 'prompts', 'pr-review-auto.md'),
    path.join(TEMPLATE_DIR, 'prompts', 'pr-review-auto.md')
  ];
  const pr = engine.prFromUrl(url);
  const checkpointFile = pr ? checkpointPath(pr.key) : '(indisponível)';
  // fora do return de propósito: lá já existe o ternário do fan-out, e dois no mesmo
  // statement é o que o gate mecânico conta como ternário aninhado
  const quemSouEu = identidadeBlock(pr ? engine.accountForPr(pr) : '');
  for (const f of candidates) {
    try {
      let base = fs.readFileSync(f, 'utf8').replaceAll('{{URL}}', url)
        .replaceAll('{{CHECKPOINT_PATH}}', checkpointFile);
      if (engine.config.teamHighlights !== true) {
        // Remove o trabalho na ORIGEM, não só a persistência: a sessão nem recebe
        // o campo nem a regra que a fariam procurar um elogio compartilhável.
        base = base.replace(/,\r?\n\s*"highlight":.*\r?\n/, '\n')
          .replace(/^\s*- `memory\.highlight`.*\r?\n/m, '')
          + '\n\n## Destaques do time desligado\n' +
            'Não procure nem produza destaque ou kudos. O objeto `memory` contém somente `author` e `bullets`; omita `highlight`.\n';
      }
      return base
        + quemSouEu + engine.personProfileBlock(author) + licoesDesteRepo(engine, pr, author)
        + engine.reviewFormatBlock() + thirdPartyReviewBlock()
        + (lotes ? fanoutMod.fanOutBlock(lotes, metrics) : '');
    } catch {
      // candidato ausente ou ilegivel: tenta o proximo da lista (o template do pacote e a
      // rede de seguranca do workspace semeado). Sem nenhum, o throw abaixo diz isso.
    }
  }
  throw new Error('template prompts/pr-review-auto.md não encontrado');
}

export default { identidadeBlock, personProfileBlock, reviewFormatBlock, thirdPartyReviewBlock, licoesDesteRepo, headlessPromptFor };
export { identidadeBlock, personProfileBlock, reviewFormatBlock, thirdPartyReviewBlock, licoesDesteRepo, headlessPromptFor };
