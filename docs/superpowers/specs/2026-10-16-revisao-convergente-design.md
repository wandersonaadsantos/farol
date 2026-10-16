# Revisão convergente: Claude, Codex e verificação (desenho)

Data: 16/10/2026. Estado: desenho aprovado para fatiar em issues; nada implementado.

## O pedido

Um contribuidor (João) propôs disparar, no mesmo PR, a revisão do Claude e a do Codex e um
terceiro agente para convergir os achados, em funcionalidade crítica que pede mais de uma
leitura. O dono quer tudo o que aumente a qualidade do revisor, e o custo do Farol é baixo
porque roda nas assinaturas.

O ganho esperado é de **cobertura**: dois modelos diferentes têm pontos cegos diferentes, e o
achado que um vê e o outro não é justamente o que uma revisão sozinha perde. O risco é o
contrário: dois relatórios somados dobram o ruído, e um "juiz" que é só mais um modelo opinando
troca uma opinião por outra, sem prova.

## O que já existe e este desenho reaproveita

| peça | onde | o que faz hoje |
|---|---|---|
| provedor por perfil | `runProvedor` em `lib/engine/session.js`, `lib/codex/stream.js`, `lib/engine/perfil-claude.js` | cada perfil de assinatura é Claude ou Codex; a revisão roda em um deles, com o mesmo prompt e o mesmo envelope |
| fatiamento de PR grande | `lib/engine/fanout.js` | lotes por afinidade de caminho, um subagente por lote, consolidação na sessão; todos do MESMO modelo |
| verificador de afirmação | `workspace-template/.claude/agents/claim-verifier.md` | verifica UMA afirmação contra o head, só leitura, com evidência reproduzível; não decide nada sobre o PR |
| ressalvas | `lib/engine/ressalvas.js` | a única coisa que separa aprovável limpo de aprovável com ressalvas; a política da conta decide o resto |
| gatilhos de criticidade | `gatilhoDeContexto` em `lib/engine/model-router.js` | repositório crítico, caminho sensível e PR grande, configuráveis em `autoOpus` |
| gates de postagem | `lib/engine/decision.js`, `docs/REVIEW-GATES.md` | invariante 4: nada é postado sem gate; aprovar sozinho exige revisão pedida, veredito e payload coerentes |
| orçamento e limite do plano | `lib/engine/usage.js`, `lib/engine/limite-plano.js`, `lib/engine/quota.js` | teto por perfil de Claude; Codex aparece como não controlado |

## Princípios (não negociáveis)

1. **O modelo produz evidência, o app decide.** Não existe "juiz" que vota no veredito. O que
   decide se um achado vale é a evidência dele, conferida contra o código no head da revisão.
2. **Independência antes da consolidação.** As duas revisões não leem uma à outra, nem o
   checkpoint da outra, antes de terminar. Quem lê primeiro ancora no outro, e aí a segunda
   opinião deixa de ser segunda.
3. **Divergência é informação, não gate.** Um achado que só um modelo viu e que a verificação
   não conseguiu confirmar nem derrubar vira ressalva visível, com o texto do achado. Ele nunca
   aprova nem reprova sozinho (invariante 4 e `ressalvas.js`).
4. **Um PR, um review publicado.** A conta posta UMA revisão consolidada. Duas revisões da mesma
   conta no mesmo PR denunciam a ferramenta e confundem o autor.
5. **Custo só quando o PR pede.** Desligado por padrão. Ligado por conta, e por padrão só nos
   PRs que já disparam a criticidade do roteador de modelo.

## Fluxo

```
PR pedido à conta
  └─ gatilho (conta + criticidade)  ── não ──> revisão de sempre (um provedor)
        │ sim
        ├─ revisão A: provedor da conta     ┐  em paralelo, mesmo head,
        └─ revisão B: provedor da 2ª opinião ┘  mesmo prompt, sem ver a outra
                 │
        consolidação determinística (app, sem modelo)
          ├─ mesmo defeito e mesmo peso nos dois ... concordante: vale sem verificar
          ├─ bloqueante de um lado só .............. vai ao verificador
          └─ não bloqueante de um lado só .......... sugestão marcada "uma das leituras"
                 │
        verificação (claim-verifier, uma chamada por bloqueante de um lado só)
          ├─ confirmado .............. vira bloqueante consolidado
          ├─ refutado ................ sai do review, fica registrado no app
          └─ parcial ou falha ........ inconclusivo: vira ressalva (não bloqueia, não some)
                 │
        UM envelope consolidado ──> gates de sempre ──> política da conta
```

### 1. Gatilho

Configuração nova por conta, `revisaoConvergente`:

- `nunca` (padrão): o Farol de hoje, sem custo nenhum a mais.
- `criticos`: liga quando `gatilhoDeContexto` devolve gatilho (repositório crítico, caminho
  sensível ou PR grande). Reaproveitar a função, nunca copiar a regra.
- `sempre`: todo PR pedido à conta.

E o perfil da segunda opinião, `perfilSegundaOpiniao`: o id de um perfil de assinatura de
OUTRO provedor (conta em Claude pede um perfil Codex, e o contrário). Sem perfil válido, o
gatilho não liga, e a tela da conta diz por quê. O card do PR mostra "revisão convergente" e o
gatilho que a ligou (o mesmo rótulo que o roteador já usa para o modelo).

### 2. As duas revisões

Mesmo head (o SHA é fixado antes de lançar as duas), mesmo prompt, mesmo card do Jira, mesmos
padrões do time e o mesmo fatiamento quando o PR é grande (os lotes são decididos uma vez e
valem para as duas, senão a cobertura fica incomparável).

O que muda em B:

- não herda o checkpoint de verificação de A, nem o publicado na frota (princípio 2);
- não posta nada nem escreve memória do autor: só devolve o envelope;
- conta como sessão na admissão e no orçamento do perfil dela (Codex continua "não controlado"
  no teto do grupo, como hoje, e isso aparece no card).

Falha de B (limite do plano, rede, envelope inválido) nunca segura A: a revisão segue como
simples, com a ressalva "a segunda opinião não concluiu: <motivo>". Falha de A segue a regra de
sempre (retry, estacionamento).

**Prazo de B.** B não tem o teto de 30 minutos da sessão como único limite: B ganha um prazo
relativo a A. Quando A termina, B tem no máximo mais 10 minutos (configurável, com teto) para
devolver o envelope, e o tempo esperando vaga conta dentro desse prazo. Estourou, o app cancela
B e segue com A e a ressalva "a segunda opinião não terminou a tempo". B travado, esperando vaga
ou com o provedor pendurado, nunca segura a publicação de A.

### 3. Contrato novo no envelope: `achados`

A consolidação precisa de achado estruturado, e o envelope de hoje não tem (há `reasons`, os
comentários inline dos payloads e o relatório em texto). Campo novo, aditivo, nos dois
provedores:

```json
"achados": [
  {
    "id": "a1",
    "arquivo": "lib/x.js",
    "linha": 42,
    "lado": "RIGHT | LEFT",
    "severidade": "bloqueante | sugestao | pergunta | detalhe",
    "categoria": "bug | seguranca | regressao | card | padrao | teste | desempenho | outro",
    "afirmacao": "uma linha verificável: o que está errado e em que condição",
    "comoVerificar": "o passo que confirma ou derruba (comando, arquivo:linha, caso)",
    "corpo": "o texto público do comentário, na voz do revisor"
  }
]
```

Regras:

- `afirmacao` e `comoVerificar` são obrigatórios em `bloqueante`;
- achado sem `arquivo` (ex.: card não atendido) usa `arquivo: null` e não entra na
  deduplicação por posição;
- `lado` diz a qual lado do diff a `linha` pertence, como o `side` que o contrato de comentário
  inline já exige (`pr-review-auto.md`): `RIGHT` para a versão nova, `LEFT` para linha removida
  ou substituída. Achado sem `lado` válido, ou com linha fora do diff, não vira comentário inline:
  vai para o corpo do review, citando arquivo e linha.

**Transição sem perder achado.** O campo é aditivo, e um envelope válido ainda pode vir sem ele
(atualização no meio, retentativa, sessão retomada). Por isso:

- **revisão simples:** com `achados` presente e válido, os comentários inline são gerados dele;
  com `achados` ausente, valem os `payloads.*.comments` de sempre, como hoje. Nunca se descartam
  os comentários do payload só porque o campo novo existe no contrato;
- **revisão convergente:** exige `achados` válido nos dois envelopes. Envelope de B sem `achados`
  é falha de B (a revisão segue simples, com a ressalva); envelope de A sem `achados` desliga a
  convergência daquele PR, e A segue como revisão simples, com os comentários do payload.

### 4. Consolidação (no app, sem modelo)

Função PURA (`consolidarAchados(a, b, diff)`), testável sem rede:

- **posição não é concordância.** Dois achados próximos (mesmo arquivo, linhas a no máximo 3 de
  distância, mesma categoria) são só **candidatos** a concordar: um erro de referência nula e uma
  falha de autorização na mesma linha são dois defeitos, mesmo na mesma categoria. Eles só viram
  o mesmo achado quando as `afirmacao` coincidem por uma regra determinística (texto normalizado
  em minúsculas, sem pontuação nem números de linha, e similaridade de termos de pelo menos 0,8).
  Candidatos que não passam nessa régua continuam como dois achados;
- **concordante** (mesma posição, mesma categoria, mesma afirmação e **mesma severidade** nos
  dois): vale sem verificação, porque dois modelos independentes chegaram ao mesmo defeito com o
  mesmo peso;
- **bloqueante de um lado só** vai à verificação (passo 5). Isso inclui o achado exclusivo e
  também o concordante em que só um dos revisores o marcou como bloqueante: o fato pode estar
  corroborado, mas o peso de bloquear o merge veio de uma leitura só. A severidade nunca é
  promovida pela maior das duas sem verificar;
- **não bloqueante de um lado só** entra como sugestão, com a marca interna "visto por uma das
  leituras" (a marca fica no app; o texto público não cita modelo nenhum);
- **vereditos divergentes** (A aprova, B pede mudanças, ou o contrário): o veredito consolidado
  vem dos achados que sobraram depois da verificação, nunca de voto; e a divergência em si vira
  ressalva com os dois vereditos.

### 5. Verificação dos exclusivos bloqueantes

Uma sessão curta, só leitura, que chama o `claim-verifier` uma vez por bloqueante de um lado só
(passo 4), todas na mesma mensagem, passando `afirmacao`, `arquivo:linha`, repositório e o head
fixado. O verificador já devolve um vocabulário fechado, `confirmado`, `refutado` ou `parcial`,
e esse contrato não muda; a consolidação lê assim:

- `confirmado`: o achado vira bloqueante consolidado;
- `refutado`: sai do review publicado; fica no relatório interno e no app, com a evidência,
  para medir quem errou (insumo da métrica do fim);
- `parcial`, falha da chamada ou resposta fora do vocabulário: o desfecho é **inconclusivo**, e
  o achado vira ressalva com o texto dele. Não bloqueia e não some.

Teto de achados verificados por PR (sugestão: 8). Acima disso, os excedentes ficam como
inconclusivos, e o card diz que o teto foi atingido.

### 6. O envelope consolidado e a postagem

O app monta UM envelope com: o veredito derivado dos achados consolidados, os comentários
inline gerados dos achados, o corpo público e as ressalvas de divergência e de inconclusivos.

**O corpo público é montado do zero, nunca reaproveitado.** Hoje o bloqueio aparece em três
lugares do envelope de A (`payloads.request_changes.body`, os comentários do payload e o
`reviewMarkdown`); filtrar só os `achados` deixaria um bloqueio refutado no texto. Por isso, na
revisão convergente, o corpo é composto pelo app a partir de duas partes:

- um campo novo do envelope, `resumoPublico`, que a sessão escreve sem citar achado nenhum:
  contexto do PR, aderência ao card e ao que o repositório declara, em poucas linhas;
- o `corpo` de cada achado que sobreviveu à consolidação e à verificação, agrupado por
  severidade.

Achado refutado não tem como reaparecer, porque nenhum texto livre de A ou de B vai direto ao
PR. Sem `resumoPublico` válido, o corpo sai só com os achados. O resultado passa pelo firewall de
linguagem de sempre (`public-review.js`), pelos gates de sempre e pela política da conta. Nada
aqui contorna `shouldAutoApprove`: com ressalvas é com ressalvas, e a conta decide se posta.

## Interações com o que já existe

- **Fan-out:** lotes decididos uma vez, valem para A e B. Dentro de cada revisão, a
  consolidação por lote continua como hoje; a convergente consolida depois, entre A e B.
- **Checkpoint de verificação:** hoje existe uma loja só para a revisão oficial
  (`checkpointPath(prKey, 'review')`, o caminho que o `headlessPromptFor` injeta no prompt), e a
  sincronização só aceita as lojas `review` e `self` (`LOJAS` em `lib/sync/checkpoint.js`). Se A e
  B usassem `review`, B leria a evidência de A e da frota, quebrando o princípio 2. A decisão:
  - A continua na loja `review`, com herança e publicação na frota como hoje;
  - B usa uma loja local própria, `segunda` (`checkpointPath(prKey, 'segunda')`, que já cai em
    `state/verification/segunda/`), e o `headlessPromptFor` passa a receber a loja para injetar o
    caminho certo;
  - a loja `segunda` **não** entra no `LOJAS` da sincronização: B nem herda da frota nem publica
    nela, e o teste de independência prova as duas coisas;
  - a consolidação não lê checkpoint.
- **Admissão e vagas:** uma revisão convergente ocupa duas vagas no aparelho. Sem a segunda vaga,
  B espera, sem estacionar A, e essa espera conta dentro do prazo de B (passo 2).
- **Distribuição entre aparelhos:** o item convergente executa inteiro num aparelho, e esse
  aparelho precisa resolver **o perfil exato** da segunda opinião, não só "ter Codex". Perfis são
  configuração local de cada aparelho, e a resolução de hoje cai na assinatura padrão quando o id
  não existe ali: o aparelho errado cobraria a assinatura errada ou falharia depois de aceitar o
  trabalho. Por isso a capacidade publicada passa a trazer, por conta, a tag opaca (HMAC da chave
  do conjunto, como as tags de conta) de cada perfil utilizável e o provedor dele, e o agendador
  só atribui o item convergente a aparelho que tenha a tag do `perfilSegundaOpiniao` configurado.
  O executor confere a tag de novo antes de reservar a vaga. Sem aparelho apto, a revisão roda
  simples, com a ressalva.
- **Cancelamento:** cancelar a revisão cancela A, B e a verificação.
- **Limite do plano e orçamento:** cada sessão consulta o próprio perfil. Estouro em B segue a
  regra de falha de B.
- **Revisão pedida a mim (`requested`):** inalterado. A convergência não muda quem pode aprovar
  sozinho.

## Custo estimado

- A: 1 revisão. B: 1 revisão no outro provedor (no Codex, sai da cota do ChatGPT, não do teto
  do Claude). Verificação: uma sessão curta por PR com exclusivos bloqueantes, tipicamente 0,1 a
  0,3 de uma revisão.
- Total: **2,1 a 2,5 vezes** uma revisão simples, em tokens. Em tempo de relógio, A e B em
  paralelo: o tempo da mais lenta mais a verificação, perto de 1,3 vez.
- Com `criticos`, isso vale só para a fração de PRs que já dispara o roteador.

## O que fica fora, de propósito

- **Voto por maioria e terceiro modelo:** três opiniões não somam evidência; o desempate é a
  verificação.
- **Juiz que decide o veredito:** contraria o princípio 1.
- **B lendo A** (revisão da revisão): perde a independência, que é o ganho.
- **Postar duas revisões:** contraria o princípio 4.

## Testes que provariam o comportamento

1. Consolidação pura: concordante, bloqueante de um lado só, não bloqueante de um lado só, mesma
   linha com categorias diferentes, distância de linha no limite, achado sem arquivo.
2. Posição não é concordância: dois defeitos diferentes da mesma categoria na mesma linha ficam
   como dois achados; o mesmo defeito com severidades diferentes vai à verificação, e a
   severidade nunca é promovida sem verificar.
3. Vereditos divergentes não decidem por voto: o veredito sai dos achados que sobraram.
4. Verificação: confirmado vira bloqueante, refutado sai do público e fica registrado, `parcial`
   e falha viram inconclusivo e ressalva; teto de verificação respeitado e dito no card.
5. O corpo público é montado do `resumoPublico` e dos achados sobreviventes: um bloqueio refutado
   de A não aparece em lugar nenhum do que é postado.
6. Achado com `lado` válido vira comentário inline no lado certo; sem `lado`, ou fora do diff,
   vai para o corpo. Envelope sem `achados` na revisão simples mantém os comentários do payload.
7. Falha de B e B que estoura o prazo não seguram A, e viram ressalva com o motivo; a espera por
   vaga conta no prazo.
8. Independência: B grava na loja `segunda`, não herda nem publica na frota, e os lotes de A e B
   são os mesmos.
9. Um envelope só chega aos gates, e a política da conta continua decidindo a postagem
   (invariante 4); com ressalvas nunca vira limpo.
10. Gatilho: `nunca` não lança B; `criticos` só com gatilho do roteador; perfil de segunda
    opinião ausente ou do mesmo provedor não liga, e a tela diz por quê.
11. Distribuição: item convergente só vai a aparelho que publica a tag do perfil configurado, e o
    executor confere de novo antes de reservar.
12. Cancelamento derruba A, B e a verificação.

## Fatias de implementação (cada uma vira uma issue)

1. **Contrato `achados` no envelope** (aditivo, nos dois provedores, com `lado`) e o
   `resumoPublico`, com parser e validação; na revisão simples, inline gerado dos achados quando
   eles vêm, e os comentários do payload mantidos quando não vêm (teste 6). Não muda a postagem.
2. **Consolidação pura** (`consolidarAchados`), com a régua de afirmação e a regra de severidade
   de um lado só (testes 1 a 3). Sem orquestração.
3. **Configuração e gatilho por conta** (`revisaoConvergente`, `perfilSegundaOpiniao`), tela de
   Contas e o rótulo no card (teste 10). Sem lançar B ainda.
4. **Orquestração de A e B** (head fixado, lotes compartilhados, loja `segunda` fora da
   sincronização, admissão de duas vagas, prazo de B, cancelamento, falha de B), com os testes 7,
   8 e 12.
5. **Verificação e envelope consolidado**: `claim-verifier` para os bloqueantes de um lado só,
   `parcial` como inconclusivo, teto, e o corpo público montado do `resumoPublico` e dos achados
   sobreviventes (testes 4, 5 e 9).
6. **Perfil utilizável na frota**: a capacidade publica a tag opaca de cada perfil utilizável, e
   a distribuição do item convergente exige a tag do perfil configurado (teste 11).
7. **Medição:** registrar, por PR convergente, quantos achados foram concordantes, exclusivos
   confirmados e refutados, por provedor, para decidir com dado se a convergência paga o custo.
