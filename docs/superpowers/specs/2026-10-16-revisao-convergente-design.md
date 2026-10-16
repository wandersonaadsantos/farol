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
          ├─ achado nos dois ............ concordante: vale sem verificar
          ├─ achado só num, bloqueante .. vai ao verificador
          └─ achado só num, não bloq. ... entra como sugestão marcada "uma das leituras"
                 │
        verificação (claim-verifier, uma chamada por achado exclusivo bloqueante)
          ├─ confirmado ...... vira bloqueante consolidado
          ├─ refutado ........ sai do review, fica registrado no app
          └─ inconclusivo .... vira ressalva (não bloqueia, não some)
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
    "severidade": "bloqueante | sugestao | pergunta | detalhe",
    "categoria": "bug | seguranca | regressao | card | padrao | teste | desempenho | outro",
    "afirmacao": "uma linha verificável: o que está errado e em que condição",
    "comoVerificar": "o passo que confirma ou derruba (comando, arquivo:linha, caso)",
    "corpo": "o texto público do comentário, na voz do revisor"
  }
]
```

Regras: `afirmacao` e `comoVerificar` são obrigatórios em `bloqueante`; achado sem `arquivo`
(ex.: card não atendido) usa `arquivo: null` e não entra na deduplicação por posição. O campo
existe também na revisão simples, e os comentários inline passam a ser gerados dele, para a
consolidação e a revisão de sempre falarem a mesma língua.

### 4. Consolidação (no app, sem modelo)

Função PURA (`consolidarAchados(a, b, diff)`), testável sem rede:

- **mesmo achado** quando: mesmo arquivo, linhas a no máximo 3 de distância (ou o mesmo hunk do
  diff), e mesma categoria. Empate de categoria diferente na mesma linha conta como dois achados;
- a severidade consolidada é a MAIOR das duas quando concordam no achado;
- **concordante** (nos dois): vale sem verificação, porque dois modelos independentes chegaram
  ao mesmo ponto;
- **exclusivo bloqueante**: vai à verificação (passo 5);
- **exclusivo não bloqueante**: entra como sugestão, com a marca interna "visto por uma das
  leituras" (a marca fica no app; o texto público não cita modelo nenhum);
- **vereditos divergentes** (A aprova, B pede mudanças, ou o contrário): o veredito consolidado
  vem dos achados que sobraram depois da verificação, nunca de voto; e a divergência em si vira
  ressalva com os dois vereditos.

### 5. Verificação dos exclusivos bloqueantes

Uma sessão curta, só leitura, que chama o `claim-verifier` uma vez por achado exclusivo
bloqueante, todas na mesma mensagem, passando `afirmacao`, `arquivo:linha`, repositório e o head
fixado. Ela devolve, por achado, `confirmado`, `refutado` ou `inconclusivo`, com a evidência.

- `confirmado`: o achado vira bloqueante consolidado;
- `refutado`: sai do review publicado; fica no relatório interno e no app, com a evidência,
  para medir quem errou (insumo da métrica do fim);
- `inconclusivo`: vira ressalva com o texto do achado. Não bloqueia e não some.

Teto de achados verificados por PR (sugestão: 8). Acima disso, os excedentes ficam como
inconclusivos, e o card diz que o teto foi atingido.

### 6. O envelope consolidado e a postagem

O app monta UM envelope com: o veredito derivado dos achados consolidados, os comentários
inline gerados dos achados, o corpo da revisão A (a da conta) acrescido dos achados novos que
vieram de B e sobreviveram, e as ressalvas de divergência e de inconclusivos. Esse envelope
passa pelo firewall de linguagem de sempre (`public-review.js`), pelos gates de sempre e pela
política da conta. Nada aqui contorna `shouldAutoApprove`: com ressalvas é com ressalvas, e a
conta decide se posta.

## Interações com o que já existe

- **Fan-out:** lotes decididos uma vez, valem para A e B. Dentro de cada revisão, a
  consolidação por lote continua como hoje; a convergente consolida depois, entre A e B.
- **Checkpoint de verificação:** B não herda o de A (princípio 2). Os dois gravam, cada um na
  sua loja, e a consolidação não lê checkpoint.
- **Admissão e vagas:** uma revisão convergente ocupa duas vagas no aparelho. Sem duas vagas, B
  espera a vaga sem estacionar A.
- **Distribuição entre aparelhos:** o item convergente executa inteiro num aparelho, e o
  aparelho precisa ter os dois provedores prontos (a capacidade publicada passa a dizer quais
  provedores estão logados). Sem aparelho apto, a revisão roda simples, com a ressalva.
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

1. Consolidação pura: concordante, exclusivo bloqueante, exclusivo não bloqueante, mesma linha
   com categorias diferentes, distância de linha no limite, achado sem arquivo.
2. Vereditos divergentes não decidem por voto: o veredito sai dos achados que sobraram.
3. Verificação: confirmado vira bloqueante, refutado sai do público e fica registrado,
   inconclusivo vira ressalva; teto de verificação respeitado e dito no card.
4. Falha de B não segura A e vira ressalva com o motivo.
5. B não recebe o checkpoint de A (independência), e os lotes de A e B são os mesmos.
6. Um envelope só chega aos gates, e a política da conta continua decidindo a postagem
   (invariante 4); com ressalvas nunca vira limpo.
7. Gatilho: `nunca` não lança B; `criticos` só com gatilho do roteador; perfil de segunda opinião
   ausente ou do mesmo provedor não liga, e a tela diz por quê.
8. Cancelamento derruba A, B e a verificação.

## Fatias de implementação (cada uma vira uma issue)

1. **Contrato `achados` no envelope** (aditivo, nos dois provedores), com parser, validação e
   os comentários inline gerados dele na revisão simples. Não muda comportamento de postagem.
2. **Consolidação pura** (`consolidarAchados`) com os testes 1 e 2. Sem orquestração.
3. **Configuração e gatilho por conta** (`revisaoConvergente`, `perfilSegundaOpiniao`), tela de
   Contas e o rótulo no card. Sem lançar B ainda.
4. **Orquestração de A e B** (head fixado, lotes compartilhados, independência do checkpoint,
   admissão de duas vagas, cancelamento, falha de B), com os testes 4, 5 e 8.
5. **Verificação dos exclusivos bloqueantes** pelo `claim-verifier`, com teto e ressalvas, e o
   envelope consolidado chegando aos gates (testes 3 e 6).
6. **Capacidade por provedor na frota** (o aparelho diz quais provedores estão logados) e a
   regra de distribuição do item convergente.
7. **Medição:** registrar, por PR convergente, quantos achados foram concordantes, exclusivos
   confirmados e refutados, por provedor, para decidir com dado se a convergência paga o custo.
