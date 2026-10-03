# Sistema > Conexões sai, e "Repos bloqueados pra merge" vai para onde age

Data: 03/10/2026. Pedido do dono, olhando Sistema > Conexões: "Essa tela hoje pra mim não faz
muito sentido". Este documento descreve ESTADOS, DADOS e JORNADAS. O desenho sai do Claude
Design.

## O problema, medido

A seção tem três campos. Dois não fazem nada:

| campo | o que faz hoje |
|---|---|
| Conta do GitHub (trabalho) | grava `ghUser`, que só vale quando não há conta nenhuma cadastrada. Desde 30/09/2026 a migração das contas transforma o modo simples em conta da lista na primeira carga, então essa lista nunca fica vazia e o campo nunca tem efeito. Na instalação do dono há três contas, e editar aqui não muda nada |
| Organizações monitoradas | grava `owners`, a mesma reserva sem efeito. Mostra uma org só, mas quem monitora é o campo de organizações de CADA conta em Sistema > Contas (uma das contas do dono monitora quatro orgs que não aparecem aqui) |
| Repos bloqueados pra merge | o único vivo: lista de repositórios (`owner/repo`, separados por vírgula) em que o botão Merge de Meus PRs fica desativado, para respeitar regra de review do time. Também evita gastar leitura de mergeabilidade nesses repos |

Decisão: a seção Conexões sai de Sistema. O dado `mergeBlockedRepos` continua existindo e
precisa de um lugar para ser editado.

## Os dados

- `config.mergeBlockedRepos`: lista de `owner/repo`. Pode estar vazia (é o caso do dono hoje).
- Meus PRs: cada card de PR meu tem o botão Merge, que só fica ativo quando a autoanálise diz
  "aprovável" E o GitHub diz que dá para mergear. Quando o repo está na lista, o botão fica
  desativado com o título "Merge bloqueado para este repo (edite a lista na aba Sistema)".
- O repo de cada PR é conhecido no card (`owner/repo#N`).

## O que precisa existir

1. Um lugar para ver e editar a lista inteira (incluir e tirar repo), com a explicação do que
   ela faz. Candidatos para o desenho avaliar: Sistema > Automação (onde moram as outras regras
   de agir sozinho ou não) ou Sistema > Preferências.
2. No card de Meus PRs com o repo bloqueado, o motivo do botão desativado precisa apontar para
   esse lugar de verdade (hoje diz "aba Sistema", vago), com atalho navegável.
3. Opcional, para o desenho decidir: bloquear ou desbloquear o repo direto do card de Meus PRs.
4. A busca de configurações de Sistema (campo "Buscar configuração...") precisa achar a lista
   no lugar novo pelos termos "merge", "bloqueio", "repo".
5. O atalho de Entregas que hoje diz "confira as organizações monitoradas em Sistema" passa a
   levar a Sistema > Contas, que é onde as organizações moram.

## Estados obrigatórios

- Lista vazia (padrão do dono): o lugar existe, explica o efeito e convida a incluir.
- Lista com 1 e com vários repos.
- Card de Meus PRs com repo bloqueado (botão Merge desativado e o motivo).
- Largura de celular, claro e escuro.

## Restrições

- Português, sem travessão. Clique que não leva a lugar nenhum é pior que texto.
- Tokens de `ui/app.css`. Nada disso é escrito no GitHub.
