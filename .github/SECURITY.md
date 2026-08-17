# Política de segurança

O Farol roda na máquina de quem usa, com as credenciais de quem usa, e é capaz de
**escrever no GitHub em nome da pessoa** (aprovar PR, pedir mudanças, comentar, mergear).
Falha de segurança aqui tem consequência real na conta de terceiros, então este arquivo
existe.

## Versões com suporte

| Versão | Suporte |
|---|---|
| Última release publicada | sim |
| Qualquer versão anterior | não |

O app se atualiza sozinho a partir das releases do GitHub. Correção de segurança sai
sempre como uma release nova, nunca como remendo em versão antiga. Se você está numa
versão anterior, atualize antes de reportar.

## Como reportar

**Não abra issue pública para falha de segurança.**

1. Preferido: [**Report a vulnerability**](https://github.com/wandersonaadsantos/farol/security/advisories/new), na aba Security do repositório. O canal é privado entre você e o mantenedor.
2. Alternativa: e-mail para **wandersonsantos@biud.com.br**, com `[SEGURANÇA] Farol` no assunto.

Ajuda muito no relato: versão do Farol, sistema operacional, o que o atacante consegue
fazer, e o passo a passo mínimo para reproduzir. Nunca inclua token, credencial ou conteúdo
de repositório privado no relato.

## Prazos

O projeto é mantido por uma pessoa, no tempo dela. O compromisso é de melhor esforço, sem
SLA contratual:

- confirmação de recebimento em até 5 dias corridos;
- avaliação e posição (procede, não procede, precisa de mais informação) em até 15 dias corridos;
- correção publicada assim que possível, com crédito a quem reportou, se a pessoa quiser.

Pedimos divulgação coordenada: aguarde a correção sair antes de publicar detalhes.

## Modelo de ameaça (o que está em escopo)

O que interessa reportar:

- **Escapar de um gate de postagem.** Qualquer caminho que faça o app aprovar, reprovar, comentar ou mergear no GitHub sem o gate correspondente (`shouldAutoApprove`, `shouldAutoReject`, cobertura da leitura, clique explícito em Meus PRs).
- **Vazamento de credencial.** Token do `gh`, credencial de sessão do Claude ou conteúdo de repositório privado indo parar em log, em arquivo de estado, no corpo de um review postado ou em qualquer tráfego que não seja GitHub e Anthropic.
- **Vazamento no pacote de distribuição.** Estado, configuração, token ou conta pessoal passando pela auditoria do `tools/make-package.ps1` e entrando no zip ou no instalador.
- **Superfície HTTP local.** O engine sobe um servidor em `127.0.0.1:47170` sem autenticação. Qualquer forma de alcançar esse servidor de fora da máquina, ou de fazer uma página web chamar os endpoints dele (CSRF, DNS rebinding, CORS frouxo), é falha.
- **Execução de código.** Conteúdo controlado por terceiros (título de PR, nome de branch, corpo de comentário, resposta do `gh`) que vire comando de shell, injeção no prompt com efeito de escrita ou execução arbitrária.
- **Cadeia de atualização.** Qualquer forma de fazer o auto-update aplicar código que não veio da release oficial do repositório.

## Fora de escopo (limitações conhecidas e assumidas)

Estes pontos são decisão de projeto, estão documentados, e reportá-los não gera correção:

- **Sessão do Claude Code com credencial.** As sessões de revisão recebem uma credencial do GitHub para investigar PRs, inclusive privados. A capability efêmera do `/api/review/post` evita bypass acidental do gate de linguagem, mas **não é uma fronteira contra um processo deliberadamente malicioso** que ignore o protocolo e use a credencial diretamente. Está escrito no `CLAUDE.md`, seção "Fronteira do review humano".
- **Binários sem assinatura de código.** O instalador do Windows e o `.command` do macOS não são assinados, então SmartScreen e Gatekeeper avisam na primeira execução. É custo de certificado, não bug.
- **Quem liga a automação responde por ela.** `autoApproveAll`, `onReject: request_changes` e `autoApproveContested` são opt-in, e o que elas postam sai na conta de quem ligou. Comportamento indesejado de uma automação que você ligou é configuração, não vulnerabilidade.
- **Acesso local à máquina.** Quem já tem sessão de usuário na máquina lê `~/.farol` e fala com `127.0.0.1:47170`. O app não protege contra o dono da máquina nem contra malware já rodando com o seu usuário.
- **Prompt injection sem efeito colateral.** Conteúdo de PR que influencia o TEXTO de uma revisão, sem escapar de nenhum gate de postagem, é qualidade de review, não segurança. Abra issue normal.

## Compromissos do projeto

- Sem telemetria, sem analytics, sem servidor do projeto. Nada é enviado ao mantenedor, e o app ainda desliga a telemetria do GitHub CLI nas sessões que dispara.
- Todo tráfego de rede é em seu nome, com as suas credenciais: GitHub via o `gh` da sua máquina e Anthropic via o seu Claude Code.
- Nenhum token ou conta viaja dentro do app. O token é pedido ao `gh` local em tempo de execução.
- O pacote de distribuição é auditado automaticamente e a build falha se detectar estado, configuração, token ou conta pessoal.

Nunca compartilhe a sua pasta `~/.farol`: ela contém o seu estado, as suas configurações e
a sua memória de reviews.
