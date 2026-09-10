# Plano — Sincronização opcional entre dispositivos

**Data:** 2026-09-09

**Status:** plano revisado para handoff; implementação não iniciada; execução pelo Claude Code com Opus ou Fable após autorização de início

**Escopo:** coordenação em tempo real de reviews/autoanálises e consolidação pessoal do histórico de consumo

**Premissa central:** a funcionalidade é complementar, opt-in e não substitui o funcionamento local atual do Farol

## 1. Objetivo

Adicionar ao Farol uma função opcional, habilitada explicitamente na aba **Sistema**, que permita:

1. identificar em tempo real quando outro Farol da mesma pessoa já está analisando um PR;
2. impedir que duas instalações iniciem review ou autoanálise concorrente para o mesmo PR usando a mesma conta GitHub;
3. impedir que uma instalação desligada volte depois e repita uma análise já concluída para a mesma versão material do PR;
4. coordenar também as classificações automáticas de pushback, que consomem IA fora da fila normal de review;
5. consolidar, sob demanda, o histórico de consumo de diferentes dispositivos;
6. manter cada dispositivo como proprietário do próprio histórico e plenamente funcional sem nuvem.

O problema principal não é apenas informar que existe outra análise. O gate precisa impedir o nascimento de uma segunda sessão de IA, pois é nesse ponto que o consumo evitável acontece.

## 2. Não objetivos

Esta iniciativa não deve:

- tornar o Firebase obrigatório para usar o Farol;
- mover para a nuvem decisões de review, relatórios, chats, diffs, prompts ou memória do time;
- substituir `usage.json`, `usage-sessions.json`, `inflight.json` ou `activeReviews`;
- sincronizar configurações gerais do Farol entre dispositivos;
- transformar o histórico consolidado em autoridade de orçamento no primeiro MVP;
- coordenar chats e ferramentas disparados explicitamente pelo usuário no primeiro MVP;
- publicar, fazer merge, release ou habilitar a função automaticamente;
- criar telemetria para o mantenedor;
- prometer execução distribuída exatamente uma vez durante partições prolongadas de rede.

## 3. Invariantes de compatibilidade com produção

1. A configuração nasce desabilitada.
2. Configuração ausente deve ser interpretada como `enabled: false`.
3. Com a função desabilitada, não pode ocorrer importação ou inicialização do SDK do Firebase, autenticação, conexão, listener, migração ou escrita remota.
4. O caminho local atual continua sendo a fonte de verdade do dispositivo.
5. Usuários que nunca habilitarem a função não devem perceber diferença funcional, visual relevante, de desempenho, rede ou inicialização.
6. Desabilitar a função deve restaurar imediatamente o funcionamento exclusivamente local.
7. Desabilitar não apaga dados locais nem remotos.
8. Exclusão remota deve ser uma ação independente, explícita e confirmada.
9. Falha remota nunca pode corromper, truncar ou reescrever o histórico local.
10. O gate distribuído complementa as travas locais; não remove nem enfraquece `activeReviews`, fila, orçamento, validação de head ou deduplicação de postagem.
11. Nenhum update do Farol pode habilitar a funcionalidade ou iniciar migração histórica em nome do usuário.
12. Credenciais não podem entrar em `config.json`, logs, SSE, snapshots da UI, prompts, diagnósticos públicos ou pacotes de distribuição.

## 4. Evidência do funcionamento atual

O desenho parte dos seguintes pontos observados no código atual:

- `server.js` mantém `activeReviews` apenas em memória da instância.
- `review.js` evita duplicidade consultando a fila e as sessões locais antes de enfileirar um review.
- `selfpr.js` possui deduplicação local separada para autoanálise.
- `inflight.json` permite recuperação local após reinício, mas não coordena duas instalações.
- o marcador GitHub `<login>:revisando` informa o time, porém a detecção de “outros revisando” exclui deliberadamente a própria conta;
- `usage.js` grava um log permanente de sessões em `usage-sessions.json` e um agregado local em `usage.json`;
- o gráfico diário local possui retenção de 120 dias, enquanto o log individual não é podado;
- o servidor HTTP atual escuta apenas em `127.0.0.1`;
- o projeto é Electron e não contém um cliente Android nativo, mas o uso real no celular já está documentado no `CLAUDE.md`: engine Node em Debian via Termux + proot;
- esse Android é uma instância independente capaz de iniciar provedor e, portanto, participa da coordenação;
- `scanPushbacks()` roda em background a cada ciclo quando o opt-in atual está ligado, classifica até dois candidatos com IA e mantém seu marcador apenas em arquivo local;
- `reReviewLaunched` e o teto de três rodadas automáticas por PR/dia também são locais;
- o pacote leve de auto-update exclui `node_modules`, e os instaladores preservam as dependências existentes quando a fonte do update não as traz.

### 4.1 Medição inicial do desperdício observável

Snapshot local medido em 2026-09-09:

| Métrica | Valor |
|---|---:|
| Sessões registradas | 671 |
| Custo total registrado | US$ 2.545,07 |
| Sessões de review | 430 |
| Custo de reviews | US$ 1.753,03 |
| Decisões `already_reviewed` | 32 |
| Decisões casadas com sessão de consumo em até 1 hora | 30 |
| Custo dessas 30 sessões | US$ 115,06 |
| Participação no custo total | 4,5% |
| Participação no custo de reviews | 6,6% |
| Janela observada | 28,97 dias corridos; 30 datas civis |
| Cenário mensal se a mesma taxa se repetir | até US$ 119,16 / 30 dias |
| Cenário anualizado se a mesma taxa se repetir | até US$ 1.449,81 / 365 dias |

O casamento usa a mesma referência de PR e o timestamp mais próximo. A mediana da distância encontrada foi 0,8 segundo, portanto a ligação sessão–decisão é forte.

Esse valor é um **limite superior do desperdício potencial detectável**, não uma medição da duplicação entre dispositivos. `already_reviewed` prova que a sessão terminou quando já havia review decisivo da mesma conta naquele head, mas o estado atual não registra `deviceId` nem a origem automática/manual. Assim, não é possível atribuir os US$ 115,06 ao Windows contra Android sem instrumentação nova. O plano deve preservar essa fronteira entre fato e hipótese.

As projeções apenas anualizam a taxa observada na janela entre 2026-08-11T13:28:10.096Z e 2026-09-09T12:40:15.548Z. Elas não são previsão nem economia garantida: parte dessas sessões pode ter sido intencional, manual ou causada por outro mecanismo. A ausência dos dados Android amplia a faixa possível do total combinado, mas **não transforma US$ 115,06 em piso**; esse número continua sendo teto da classe observável no Windows.

### 4.2 Buraco sequencial confirmado

Um lease efêmero resolve somente a corrida simultânea. Depois que o dispositivo A conclui e libera o lease, o dispositivo B pode iniciar mais tarde porque `seen`, `reReviewLaunched`, resultados de autoanálise e marcadores de pushback são locais. O dedup atual de postagem (`myReviewStates`) acontece depois do gasto da sessão.

Portanto, a coordenação precisa de duas estruturas diferentes:

1. **lease efêmero**, para impedir execuções simultâneas;
2. **recibo durável por operação material**, para impedir repetição sequencial.

## 5. Decisão arquitetural recomendada

Usar o **Firebase Realtime Database pela API REST** como coordenador opcional e armazenamento de eventos consolidáveis, sem torná-lo fonte de verdade do estado operacional local.

O SDK npm do Firebase não é a escolha do MVP. Hoje o pacote leve exclui `node_modules` e o instalador preserva o diretório já instalado quando o update não traz dependências. Acrescentar `firebase` ao `package.json` sem redesenhar empacotamento e atualização produziria uma versão cujo código chega, mas cuja dependência não chega. Isso viola a preservação do canal de produção.

Node 22 já oferece `fetch`. A API REST do Realtime Database oferece:

- leitura e escrita JSON;
- compare-and-swap com ETag e `if-match`, equivalente REST de transação;
- streaming por Server-Sent Events;
- autenticação por token;
- zero dependência npm adicional.

O cliente REST terá que implementar explicitamente retry de `412 Precondition Failed`, renovação, reconexão do stream e refresh de autenticação. O REST não oferece `onDisconnect`; isso é aceitável porque o lease já deve usar TTL como autoridade e a presença pode expirar por heartbeat.

| Camada | Responsabilidade | Fonte de verdade |
|---|---|---|
| Estado local | histórico, decisões, sessões, orçamento e recuperação do dispositivo | `~/.farol` |
| Firebase Authentication | comprovar que as instalações pertencem à mesma pessoa | Firebase UID |
| Realtime Database | leases, presença de dispositivos e eventos de consumo sincronizados | nuvem opt-in |
| Projeção consolidada | somar eventos dos dispositivos sem alterar os arquivos locais | cálculo para a UI |
| GitHub | marcador visível de review para o restante do time | GitHub |

O Realtime Database é apropriado para o lease porque sua API REST oferece SSE, compare-and-swap por ETag e valores de servidor. Para o volume pessoal atual, também é suficiente para os eventos de consumo. Caso o Farol evolua para analytics multiusuário ou consultas complexas, o armazenamento analítico deve ser reavaliado separadamente.

### 5.1 Alternativas avaliadas

| Alternativa | Vantagens | Limitações | Decisão para o MVP |
|---|---|---|---|
| Firebase SDK npm | transações, presença e `onDisconnect` prontos | dependência não chega pelo update leve atual; exige redesenhar pacote/instalador | não usar |
| Firebase REST + SSE | tempo real, ETag/CAS, zero dependência, atende consumo | cliente implementa retry, refresh e TTL | recomendado |
| Refs Git em `refs/farol/...` | usa autenticação existente, criação concorrente falha, zero dependência | não é tempo real; polling mínimo atual é de minutos; exige permissão de escrita de conteúdo; polui refs; não armazena metadados ricos nem consumo | manter como alternativa/prova, não backend principal |
| Somente labels GitHub | já existe e é visível ao time | não distingue dispositivos da mesma conta, não é CAS confiável e não cobre histórico | insuficiente |

`review-signal.js` demonstra que refs Git são tecnicamente possíveis e já sabe ler/limpar o namespace legado. Isso não as torna automaticamente a melhor solução: o próprio módulo atual é explicitamente transitório e não escreve novas refs. A alternativa só deve ser retomada se os repositórios-alvo tiverem a permissão necessária e se a exigência de tempo real puder ser relaxada.

### 5.2 Duas capacidades independentes

Coordenação e consolidação permanecem dois toggles independentes na interface e duas capacidades do adaptador:

- **Coordenação:** leases, recibos e contadores compartilhados; quente e sensível à latência.
- **Consolidação:** eventos idempotentes, com atualização do desfecho; fria e tolerante a atraso.

Ambas podem usar o mesmo Realtime Database REST no MVP, mas nenhuma deve obrigar a outra. Habilitar somente a coordenação não inicia migração de consumo; habilitar somente a consolidação não altera o gate das automações.

Contrato de configuração: `enabled` é a chave geral; `coordination.enabled` e `consolidation.enabled` são opções independentes, todas desligadas por padrão. O gate remoto só participa quando `enabled && coordination.enabled`; a outbox de consumo só envia quando `enabled && consolidation.enabled`. Nos protocolos abaixo, “coordenação ativa” significa exatamente a primeira condição.

## 6. Modelo de dados proposto

```text
users/{uid}/
  devices/{deviceId}/
    name
    platform
    farolVersion
    createdAt
    lastSeenAt

  presence/{deviceId}/{connectionId}/
    connectedAt
    lastSeenAt
    expiresAt

  leases/{accountHash}/{prHash}/
    leaseId
    deviceId
    operationKind
    headSha
    acquiredAt
    heartbeatAt
    expiresAt
    farolVersion

  receipts/{accountHash}/{prHash}/{operationFingerprint}/
    operationKind
    materialVersion
    deviceId
    leaseId
    completedAt
    lastVerifiedAt
    expiresAt
    outcome
    publicationState
    reviewId
    farolVersion

  dailyRounds/{accountHash}/{prHash}/{brasiliaDay}/
    dayPolicy
    updatedAt
    reservations/{attemptId}/
      operationFingerprint
      leaseId
      state
      reservedAt
      startedAt
      expiresAt

  usageEvents/{deviceId}/{eventId}/
    at
    kind
    accountHash
    model
    profileId
    inputTokens
    outputTokens
    cacheReadTokens
    cacheCreationTokens
    costUsd
    costSource
    status
    farolVersion
```

### 6.1 Identidade do dispositivo

- Gerar `deviceId` aleatório e persistente na primeira habilitação.
- Não usar hostname como identidade, pois ele é mutável e pode expor informação desnecessária.
- Permitir um nome amigável escolhido pelo usuário, como “Notebook Windows” ou “Celular”.
- Não reutilizar o contador local de sessões como identidade global.
- Atualizar `devices/{deviceId}/lastSeenAt` com timestamp de servidor enquanto a conexão da função estiver ativa, inclusive sem análise em andamento. A UI usa esse dado para informar a última atividade conhecida, não para afirmar que o dispositivo foi perdido definitivamente.

### 6.2 Chave do lease e recibo durável

O recurso disputado deve representar:

```text
Firebase UID + conta GitHub + repositório/PR
```

Review, autoanálise e classificação automática de pushback do mesmo PR disputam o mesmo lease efêmero. `operationKind` e `headSha` são metadados do lease, não componentes que permitam execuções simultâneas.

Isso impede que:

- dois dispositivos façam review do mesmo PR;
- um dispositivo faça review enquanto outro faz autoanálise;
- um head novo abra uma segunda sessão enquanto a anterior ainda consome tokens.

Contas GitHub diferentes podem trabalhar no mesmo PR, pois representam responsabilidades e identidades de postagem distintas.

O recibo durável usa um fingerprint específico por operação:

| Operação | Versão material do recibo |
|---|---|
| Review inicial ou re-review | `kind=review + headSha` |
| Autoanálise | `kind=self + headSha` |
| Classificação de pushback | `kind=pushback + marcador da atividade do autor` |

Isso preserva a diferença semântica: uma autoanálise concluída não substitui um review, embora ambas não possam rodar simultaneamente. Head novo permite novo review/autoanálise; a mesma atividade de pushback não é classificada duas vezes.

Antes de gastar tokens, a instalação consulta o recibo. Para review, também consulta de forma barata o GitHub por um review decisivo da própria conta no head atual, cobrindo decisões antigas feitas antes da ativação da sincronização. Se encontrar prova, grava ou reconcilia o recibo sem abrir IA. Falha nessa consulta não deve ser transformada em “já revisado”.

Consultar e suprimir uma execução não exige posse do lease. Criar, invalidar ou alterar recibos exige aquisição breve e confirmação da versão observada, para não sobrescrever conclusão concorrente; reconstruir metadados a partir do GitHub não reserva rodada nem chama IA.

O teto de re-review automático deve considerar as tentativas compartilhadas admitidas no dia, preservando a política local de quais rodadas contam, com limite global de três em vez de três por dispositivo. Recibos identificam trabalho concluído; reservas identificam tentativas. Por isso `attemptId` é distinto de `operationFingerprint`: uma retomada ou nova tentativa pode ter o mesmo head sem se tornar a mesma execução.

Para esse contador compartilhado, “dia” não pode depender do fuso do processo de cada aparelho. O contrato do MVP será a data civil em `America/Sao_Paulo`, gravada também como `dayPolicy`, calculada por `Intl.DateTimeFormat(...).formatToParts()` ou função equivalente e coberta por teste nas bordas de meia-noite. A regra de dia da semana deve operar sobre essa data canônica; quando precisar construir um instante, deve usar meio-dia no mesmo fuso, preservando a defesa já usada no código contra virada por horário de verão. Isso é uma normalização distribuída deliberada: hoje `localDay`/`diaLocal` seguem o fuso do processo e não servem como chave global.

### 6.3 Identidade dos eventos de consumo

Cada evento remoto precisa ser idempotente. A proposta é derivar `eventId` de campos imutáveis:

```text
deviceId + timestamp + id local + kind + referência + modelo + tokens + custo
```

O `status` não entra no hash, porque pode ser corrigido posteriormente de `ok` para `descartada`. Reexecutar uma migração deve encontrar os mesmos IDs e produzir zero duplicações.

## 7. Protocolo do lease

### 7.1 Aquisição

O gate não deve morar separadamente em `runHeadlessReview`, `runSelfAnalysis` e `classifyPushback`. A garantia deve morar no último estrangulamento comum antes de qualquer subprocesso de IA ser criado.

Direção recomendada:

- exigir `opts.operationKind` explícito em toda passagem por `runClaudeStream`; prefixo de ID (`a*`, `s*`, `pb*`) pode continuar útil para diagnóstico, mas não é autoridade de segurança;
- manter uma allowlist central e exaustiva: `review`, `self` e `pushback` exigem coordenação; `chat` e `tool` declaram bypass explícito; `terminal`, se algum dia passar por essa fachada, também deverá declarar seu tipo;
- com coordenação ativa, tipo ausente ou desconhecido falha alto antes do spawn; consolidação isolada não altera essa decisão;
- executar a classificação e o gate nas primeiras linhas efetivas de `runClaudeStream`, antes do stub, de qualquer seleção/spawn de provedor e, principalmente, antes do retorno antecipado `auth.kind === 'codex'`; assim Claude e Codex obedecem ao mesmo contrato;
- preparar head ou marcador material antes de chegar ao estrangulamento, mas executar consulta de recibo e aquisição imediatamente antes do spawn.

Fluxo no estrangulamento:

1. verificar novamente as travas locais e o orçamento;
2. calcular o fingerprint material da operação;
3. consultar recibo durável e, para review, o estado decisivo da própria conta no GitHub;
4. se já concluído, reconciliar estado local e não criar sessão;
5. adquirir o lease por ETag + `if-match`, aguardando confirmação do servidor e aceitando apenas nó ausente, retomada idempotente do mesmo proprietário ainda válido ou lease expirado segundo as regras do servidor;
6. reler o recibo sob o lease adquirido: outro dispositivo pode ter concluído entre o primeiro preflight e a aquisição; se concluído, reconciliar e liberar sem spawn;
7. reservar a rodada diária quando aplicável, vinculando `attemptId`, fingerprint e `leaseId`; somente o proprietário atual reserva;
8. revalidar cancelamento, head conhecido, travas locais, orçamento e propriedade válida do lease; marcar a tentativa como `started` por escrita condicional confirmada;
9. iniciar o provedor apenas após essas confirmações. Review/autoanálise sem head conhecido ficam em espera transitória com coordenação ativa, sem criar fingerprint vazio.

Se outro dispositivo vencer, o PR permanece visível, mas nenhuma sessão é criada.

O estado `reserved` tem expiração e não consome cota definitiva. `started` significa admissão durável para iniciar o provedor e conta no teto. Não há transação atômica entre Firebase e o spawn do processo local: se o app morrer entre esses dois passos, a tentativa conta conservadoramente, embora possa não ter consumido tokens. Falha de spawn comprovada sem criação do subprocesso pode liberar a cota; timeout ou resultado ambíguo não. Isso evita tanto cobrar rodada do perdedor do lease quanto prometer contabilidade exata de processos sob crash.

A implementação pode agrupar o estado de coordenação por PR num nó transacional ou usar transições condicionais entre nós. Deve preservar as invariantes: reserva exige lease válido, não ultrapassa o teto, retry da mesma requisição é idempotente e execução antiga não altera tentativa de um proprietário sucessor. A forma concreta da árvore é decisão técnica do executor, coberta pelo emulador.

A fachada do provedor controla a admissão; o ciclo de vida do lease abrange também validação do resultado, persistência local e gravação do recibo. O executor pode usar um handle/contexto compartilhado para concluir ou abortar a operação nos chamadores. Não liberar nem emitir recibo apenas porque `runClaudeStream` resolveu: `review.js` e `selfpr.js` ainda validam envelope, head e desfecho depois desse retorno. Quando não houver spawn por deduplicação, devolver um resultado tipado de coordenação, sem fabricar texto para os parsers de IA.

### 7.2 Renovação

- Renovar por heartbeat em intervalo menor que o TTL.
- Security Rules usam `now` como autoridade de validade: aquisição de novo proprietário só após expiração; renovação exige o mesmo `leaseId` ainda válido; `expiresAt` deve estar no futuro e dentro do TTL máximo permitido pelo servidor.
- Timestamps de servidor e estimativa de diferença de relógio auxiliam o cliente a propor prazos e exibir presença. O relógio local nunca autoriza tomar um lease; ETag protege a versão lida e as regras protegem a validade temporal. Lease expirado precisa de nova aquisição, não de renovação tardia.
- Renovar somente quando o `leaseId` persistido ainda for o proprietário.
- Tratar falha transitória como estado de coordenação incerta e torná-la visível.

### 7.3 Liberação

- Liberar no encerramento da operação, depois de persistir o resultado e confirmar o recibo quando houver conclusão válida; erro ou cancelamento também encerram o ciclo com liberação condicional.
- A remoção deve ser transacional e condicionada ao mesmo `leaseId`.
- Um dispositivo nunca pode remover ou renovar o lease atual de outro.
- como o cliente escolhido é REST, presença e lease caducam por heartbeat/TTL; não existe dependência de `onDisconnect`.

### 7.4 Conclusão e recibo

- Gravar recibo somente quando a operação produzir resultado válido para a versão material observada.
- Erro, cancelamento, parcial e resultado descartado por mudança de head não geram recibo de conclusão.
- O recibo deve ser idempotente, derivado do resultado local persistido e escrito antes da liberação voluntária do lease. Escrita exige propriedade ainda válida; resultado atrasado de um proprietário antigo não substitui o recibo de um sucessor.
- Resultado local continua sendo gravado localmente; o recibo remoto contém somente metadados mínimos.
- Encontrar recibo remoto deve reconciliar `seen`, autoanálise ou marcador de pushback conforme o tipo, sem fabricar localmente um relatório que aquele dispositivo não possui.
- Em review já comprovado pelo GitHub, o card pode sair da fila automática sem fingir que existe relatório local.

O recibo distingue conclusão da análise e publicação. `outcome` registra o desfecho técnico, e `publicationState` qualifica apenas reviews; não leva relatório, veredito textual nem payload de postagem para a nuvem.

| Situação | Recibo e efeito na automação |
|---|---|
| Análise válida concluída, aguardando decisão humana | `completed` / `pending`: impede nova IA no mesmo head, mesmo sem review publicado; informa em qual dispositivo está a pendência |
| Análise válida concluída, publicação falhou | `completed` / `failed`: impede refazer a análise; retry da postagem permanece no dispositivo que possui o payload |
| Review publicado com sucesso | `completed` / `published`, com `reviewId` quando disponível: reconcilia com o GitHub |
| Review decisivo já existia antes da sincronização | `external_review` / `published`: pode ser reconstruído pelo preflight sem IA |
| Autoanálise ou pushback válido persistido | `completed` / `not_applicable`: deduplica somente a operação material correspondente |
| Erro da análise, envelope incompleto, cancelamento ou resultado descartado | Não cria recibo de conclusão; pode registrar diagnóstico local e tentativa consumida |

`pending` não basta por si só: um envelope incompleto também pode virar pendência local. O recibo exige análise tecnicamente concluída, head válido e resultado persistido; aguardar decisão humana ou falhar na publicação não invalida esse trabalho.

O preflight reutiliza `headSha` e `engine.myReviewStates(pr, headSha)` para a semântica decisiva `APPROVED`/`CHANGES_REQUESTED`. A consulta existente pode ser estendida para expor identificadores e falhas necessárias, preservando uma única fonte dessa semântica.

- recibos `pending` e `failed` continuam válidos na ausência de review no GitHub; o dispositivo proprietário atualiza o estado quando a publicação acontecer;
- para recibos `published`, ausência decisiva confirmada, inclusive após `DISMISSED`, invalida condicionalmente a âncora de publicação e permite nova análise; invalidar também a supressão local derivada desse recibo;
- estado decisivo confirmado mantém ou reconstrói a âncora publicada; falha técnica é `unknown`, não confirma dismiss nem apaga recibo;
- ação manual pode ignorar um recibo após confirmação para reexecução intencional; continua disputando o lease, sem tomar uma execução ativa de outro dispositivo;
- o aparelho que não possui o relatório mostra “concluído/pendente no dispositivo X”; nenhum botão de aprovação ou merge recebe autoridade apenas do recibo remoto.

Se a gravação remota do recibo falhar após o save local, persistir a finalização pendente para retry e manter o lease renovado enquanto possível. Depois de perda de propriedade, reconciliar antes de qualquer gravação; não sobrescrever estado sucessor. Esse intervalo de falha pode permitir repetição após expiração e deve aparecer no teste de recuperação, dentro da garantia limitada da seção 7.5.

**Pendência em dispositivo ausente.** Recibos `pending` e `failed` precisam de uma recuperação visível quando o aparelho que guarda o payload deixa de aparecer. No MVP, após sete dias sem atividade confirmada do proprietário, mostrar “pendência em dispositivo sem atividade há N dias” e a ação **Refazer neste dispositivo**. Esse prazo é parâmetro centralizado e pode ser calibrado durante o piloto. A marcação é uma projeção de possível orfandade, sem apagar o recibo nem declarar que o aparelho morreu.

A classificação exige leitura atual bem-sucedida do servidor, `lastSeenAt` válido de origem servidor e prazo decorrido também desde a criação/última atualização do recibo. Um recibo recente não vira órfão por um cadastro de dispositivo antigo. Data ausente, futura, inconsistente ou snapshot obtido somente do cache produzem “atividade do dispositivo desconhecida”; nunca liberam automação. O padrão conceitual vem de `standDownCaducou`, em `lib/engine/skip-review.js`: falta de evidência não autoriza caducar. A função atual trata sinais/reviews de colegas, portanto sua lógica temporal não deve ser reutilizada como se já implementasse presença de dispositivos.

A recuperação manual informa que o resultado original existe apenas no outro aparelho e que refazer consome tokens. Após confirmação, adquire lease, relê recibo e estado atual do GitHub, respeita os gates de ação manual e substitui condicionalmente a supressão anterior. Se houver lease ativo ou conclusão concorrente, atualiza a tela e não toma a execução silenciosamente. O dispositivo antigo, caso retorne, reconcilia o recibo substituído antes de tentar publicar automaticamente um payload pendente. Não há reanálise automática por ausência no MVP; a rede de segurança de 180 dias continua separada desse aviso e recuperação antecipados.

Política inicial de ciclo de vida para o MVP, a validar tecnicamente durante a execução:

- leases e presença expiram pelo TTL/heartbeat;
- `dailyRounds` anteriores a oito dias podem ser podados por qualquer cliente autenticado do mesmo UID;
- recibos são removidos quando o PR for confirmado fechado/mergeado e, como rede de segurança, expiram após 180 dias por coleta oportunista; o preflight do GitHub continua impedindo review próprio já decisivo mesmo após a poda;
- eventos de consumo não recebem expiração automática no MVP, pois são o histórico que o usuário pediu para consolidar; exclusão é explícita e separada por UID/dispositivo/período.

### 7.5 Expiração e partições de rede

TTL e heartbeat reduzem leases órfãos, mas não eliminam a impossibilidade distribuída: se um dispositivo perde conexão com o Firebase enquanto o CLI continua consumindo tokens, outro dispositivo pode assumir após a expiração. Portanto, a garantia do MVP é:

> Sob coordenação acessível, somente uma instalação inicia a análise do PR para aquela conta.

Não deve ser prometido “exatamente uma execução” sob qualquer falha de rede.

Ponto de partida para validação: heartbeat a cada 30 segundos e TTL de 120 segundos. O executor pode ajustar esses valores com evidência de latência, suspensão e reconexão do Windows/Android. Ao perder confirmação de renovação, retentar com backoff dentro da validade conhecida. Sem recuperar confirmação antes da margem de expiração, solicitar cancelamento da IA e aguardar encerramento pelo mecanismo existente. Se a suspensão do sistema ou falha de cancelamento impedir essa parada, registrar estado incerto; não publicar recibo ou iniciar nova tentativa como se o lease ainda pertencesse ao dispositivo. Uma perda confirmada da propriedade também bloqueia postagem automática até nova aquisição e reconciliação. Essa política é específica da coordenação ativa e será validada antes do piloto.

## 8. Política de falha

### 8.1 Função desabilitada

Comportamento atual integral. Firebase não participa de nenhuma decisão.

### 8.2 Função habilitada — automação

Se não for possível confirmar a aquisição do lease:

- não iniciar a IA;
- manter em espera transitória sem marcar o PR como processado e sem usar o estacionamento persistente;
- mostrar o motivo “coordenação entre dispositivos indisponível”;
- retentar de forma limitada após reconexão;
- não transformar falha técnica em confirmação de que outro dispositivo está trabalhando.

`coordenacao-indisponivel` deve entrar em `log-taxonomy.js` como classe transitória, antes de padrões mais genéricos que possam capturá-la. Espera de coordenação antes do spawn mantém a intenção pendente, com backoff limitado e nova validação das travas locais. O executor pode reutilizar as filas existentes ou criar um mecanismo comum pequeno. Falhas depois do início da IA continuam sujeitas à política de cada operação: review já usa `retryAfterNet`, autoanálise não deve ganhar relançamento automático indiscriminado e pushback mantém o marcador não consumido quando falha. A espera por coordenação não deve ser confundida com falha de análise nem com estacionamento persistente.

### 8.3 Função habilitada — ação manual

Quando o usuário clicar explicitamente:

- tentar adquirir o lease;
- se houver lease alheio, mostrar qual dispositivo e desde quando;
- se a coordenação estiver indisponível, oferecer “Executar sem coordenação” mediante confirmação explícita;
- registrar localmente que o gate foi contornado por decisão manual.

### 8.4 Pushback automático

O pushback não passa pela fila de review nem registra `activeReviews`. Quando `autoPushback` está ligado, até duas classificações podem nascer por ciclo em cada dispositivo.

O gate deve entrar no estrangulamento do provedor com:

- `operationKind: pushback`;
- conta GitHub;
- PR;
- marcador da atividade do autor retornado por `detectAuthorPushback`.

Se existir recibo para o mesmo marcador, o dispositivo apenas avança/reconcilia `pushbackScanned` e não chama IA. Se perder o lease, aguarda o recibo vencedor ou tenta novamente após expiração. Falha técnica mantém o marcador não consumido, preservando o retry já existente.

## 9. Consolidação do consumo

### 9.1 Princípio

O histórico local permanece intacto. O consolidado é uma projeção separada, não uma importação destrutiva para `usage.json`.

### 9.2 Migração inicial

- Iniciar somente após o usuário habilitar “Consolidar consumo”.
- Ler `usage-sessions.json` local.
- Criar eventos idempotentes.
- Enfileirar em uma outbox local.
- Enviar em lotes limitados.
- Persistir progresso sem alterar o conteúdo histórico original.
- Permitir pausa e retomada.
- Mostrar quantidade enviada, pendente e rejeitada.

### 9.3 Eventos novos

- Registrar localmente primeiro.
- Acrescentar o evento à outbox depois do save local confirmado.
- Sincronizar em segundo plano.
- Falha de envio não desfaz o registro local.
- Correções de desfecho atualizam o mesmo evento remoto.
- Ao reiniciar, reconciliar o log local com o progresso da outbox para recuperar o caso de queda entre save local e enfileiramento; a idempotência deve cobrir também essa janela.

### 9.4 Apresentação

Na aba **Consumo**, acrescentar:

- seletor `Este dispositivo` / `Todos os dispositivos`;
- filtro por dispositivo;
- última sincronização;
- quantidade de eventos pendentes;
- separação já existente entre custo medido, estimado e sem base;
- origem do evento na tabela de sessões.

### 9.5 Orçamento

No MVP, tetos e bloqueios de orçamento continuam locais. O consolidado remoto é informativo.

Um orçamento verdadeiramente global exigiria reserva atômica do custo previsto antes da sessão. Somar valores depois da execução não impede dois dispositivos de ultrapassarem o teto ao mesmo tempo. Essa evolução fica fora deste plano inicial.

## 10. Privacidade e autenticação

### 10.1 Dados permitidos no MVP

- identidade técnica do dispositivo;
- estado de presença;
- lease e timestamps;
- tipo da sessão;
- modelo;
- tokens;
- custo e origem do custo;
- desfecho;
- versão do Farol.

### 10.2 Dados proibidos

- token do GitHub;
- token do provedor de IA;
- refresh token em arquivo aberto;
- prompts;
- diff ou conteúdo de arquivo;
- relatório de review;
- mensagens de chat;
- comentários do PR;
- memória do time;
- conteúdo bruto de log.

### 10.3 Referência do PR

Usar por padrão uma chave derivada de referência canônica, mantendo `owner/repo#n` em texto somente no dispositivo. Normalização deve ser idêntica nas instalações. Hash simples reduz exposição casual, mas não equivale a criptografia. Sincronizar a referência legível é uma opção futura que exige escolha do usuário; não bloqueia o MVP com chaves derivadas.

### 10.4 Autenticação

- Não reutilizar automaticamente o token existente do `gh`.
- Preferir uma identidade Firebase separada ou GitHub OAuth próprio com escopos mínimos.
- Isolar todo caminho por `auth.uid` nas Security Rules.
- Tratar o Firebase UID como identidade da **pessoa que sincroniza**, não como identidade de uma conta GitHub monitorada.
- Manter as contas GitHub como dimensão interna sob o mesmo UID; uma pessoa pode monitorar várias contas sem criar vários espaços de sincronização.
- Definir explicitamente como Windows e Android autenticam no mesmo UID antes de fechar a Fase 0.
- Armazenar credenciais persistentes em arquivo próprio fora de `config.json`, seguindo o precedente de `lib/jira/credentials.js`, com gravação atômica e permissão restrita em POSIX.
- Nunca colocar segredo Firebase administrativo no cliente.

O MVP pressupõe dispositivos cooperativos pertencentes ao mesmo UID. As regras isolam pessoas diferentes e validam as transições de coordenação, mas `deviceId` não é uma credencial independente: um dispositivo comprometido com acesso ao mesmo UID está fora dessa garantia. Não criar autenticação própria por dispositivo para o MVP. O mecanismo de armazenamento de credenciais deve ser escolhido e verificado no Windows e no Termux/proot; o exemplo Jira é referência de isolamento de arquivo, não prova automática de criptografia ou proteção equivalente nas duas plataformas.

**Atos do usuário:** criar o projeto Firebase real, habilitar o provedor de Authentication, gerar/provisionar credenciais iniciais e realizar login/consentimento são ações do dono da conta. A ordem de início do desenvolvimento não delega esses atos ao executor, mesmo que ele encontre navegador autenticado ou credenciais acessíveis. O Claude Code implementa o fluxo, prepara instruções de configuração e valida o acesso disponibilizado pelo usuário; pode usar o emulador para desenvolver e testar enquanto essa configuração não estiver pronta. Refresh normal de tokens pelo código implementado faz parte do funcionamento autorizado da função, sem confundir isso com provisionamento de conta ou geração de credenciais administrativas.

Ler ou copiar `usage-sessions.json` e `decisions.json` do Android exige autorização específica para aquela coleta, indicando arquivos e destino local. A autorização geral de desenvolvimento não cobre esse ato. Uma autorização específica já concedida continua válida para a coleta descrita; não pedir novamente durante a mesma operação. O executor não publica nem inclui os arquivos pessoais no Git.

### 10.5 Modelo operacional

Para o primeiro uso pessoal, a recomendação é **Firebase configurado pelo próprio usuário**. Isso preserva a promessa de que o Farol não envia dados ao mantenedor.

No volume local atual — 671 eventos em 28,97 dias, arquivo de sessões com aproximadamente 283 KiB e duas conexões SSE esperadas para Windows + Android — o armazenamento está mais de três ordens de grandeza abaixo de 1 GB e as duas conexões ficam abaixo de 100 simultâneas. Esses são limites publicados para o plano Spark do Realtime Database, que também inclui 10 GB/mês de download. Isso torna o plano gratuito tecnicamente plausível para o MVP pessoal, mas banda ainda precisa ser medida com o listener real e não é garantia de custo zero futuro: listeners amplos, reconexões, aumento de dispositivos e retenção mudam download e armazenamento.

Se futuramente existir um Firebase central do projeto, será necessário assumir explicitamente:

- política de privacidade;
- retenção e exclusão;
- disponibilidade;
- orçamento e alertas de custo;
- resposta a abuso;
- suporte e recuperação de conta;
- proteção adicional do cliente desktop.

## 11. Desenho obrigatório via Claude Design

Nenhum HTML, CSS ou comportamento visual deve ser implementado antes desta etapa.

“Desktop e mobile” significa a interface existente do Farol adaptada ao Windows e ao navegador usado com o engine Node no Termux/proot Android. Não há aplicativo Android nativo novo neste escopo. Claude Design orienta a experiência e a implementação reaproveita componentes, estilo e comportamento já existentes.

### 11.1 Superfícies a desenhar

1. **Sistema → Conexões → Sincronização entre dispositivos**.
2. Fluxo de habilitação e autenticação.
3. Nome e lista de dispositivos.
4. Controles independentes de coordenação e consolidação.
5. Estado “outro dispositivo está analisando”.
6. Estado de coordenação indisponível.
7. Confirmação de execução manual sem coordenação.
8. Filtros consolidados da aba Consumo.
9. Pausa, desconexão e exclusão remota.
10. Versões desktop e mobile.
11. Pendência em dispositivo sem atividade, atividade desconhecida e recuperação “Refazer neste dispositivo”.

### 11.2 Estados que o desenho deve cobrir

- desabilitada;
- habilitada, não configurada;
- autenticando;
- conectada sem outro dispositivo;
- conectada com vários dispositivos;
- lease local;
- lease remoto;
- conexão degradada;
- autenticação expirada;
- migração em progresso;
- migração parcialmente falha;
- sincronização pausada;
- dados remotos removidos.
- recibo pendente em dispositivo possivelmente ausente, com última atividade conhecida;
- presença desconhecida, sem inferir abandono;
- confirmação e conflito concorrente durante recuperação de pendência.

### 11.3 Direção inicial de conteúdo

Título sugerido:

> Sincronização entre dispositivos

Descrição sugerida:

> Opcional. Evita análises duplicadas entre seus dispositivos e permite visualizar o consumo consolidado. Seu histórico continua armazenado localmente.

Controles sugeridos:

- `Sincronizar entre dispositivos`;
- `Evitar análises simultâneas`;
- `Consolidar histórico de consumo`;
- `Nome deste dispositivo`;
- `Desconectar este dispositivo`;
- `Apagar dados sincronizados`.

O Claude Design pode alterar hierarquia, composição e microcopy, mas não os invariantes funcionais e de privacidade deste documento.

### 11.4 Ambiente de desenho e desenvolvimento

O desenvolvimento será conduzido no **Claude Code, com Opus ou Fable**, conforme escolha do usuário na execução. O **Claude Design será utilizado por esse ambiente** para a etapa visual. O plano define resultados, invariantes e evidências; organização de módulos, nomes internos, sequência de commits locais e soluções técnicas equivalentes ficam a cargo do executor.

Uma autorização de início cobre o desenvolvimento do escopo aprovado até a entrega validada. Não solicitar nova autorização a cada fase, arquivo, teste, ajuste de interface ou refatoração necessária. Aprovação apenas do documento continua distinta de uma ordem de início; esta revisão do plano não inicia o desenvolvimento.

O executor deve:

- ler este MD integralmente e garantir que a mesma versão esteja disponível no checkout/worktree usado pelo Claude Code; se ainda estiver untracked, incluí-lo na entrega local do trabalho sem depender de sua presença em outro checkout;
- escolher e documentar detalhes técnicos, corrigir problemas encontrados e avançar ao satisfazer os critérios das fases, sem esperar aprovações intermediárias de rotina;
- usar os padrões existentes de produção e manter a nova função opt-in, com histórico local preservado;
- produzir o desenho no Claude Design, verificar os estados previstos e implementar a experiência correspondente; refinamentos visuais e de acessibilidade fazem parte dessa autonomia;
- registrar decisões relevantes e evidências no handoff, atualizando o plano quando uma solução técnica equivalente ficar melhor demonstrada;
- pedir direção quando faltar uma escolha material do usuário, houver mudança de escopo ou impacto em produção que a autorização vigente não cubra; respeitar também os atos pessoais de provisionamento/login e a autorização específica de coleta Android da seção 10.4, mesmo se houver acesso técnico disponível; continuar o trabalho independente enquanto isso.

As fases são marcos de dependência e validação, não pedidos sucessivos de permissão. Publicação, merge, release, ativação geral e mudanças no ambiente de produção seguem as autorizações e convenções do repositório. Codex pode apoiar planejamento ou revisão quando solicitado; a execução permanece no Claude Code.

### 11.5 Branches e integração incremental

Entregar incrementalmente na `main`, por branches curtas e **um PR por fase**, mantendo os flags desligados. Uma fase grande pode ser dividida em PRs menores e independentes; não acumular toda a feature em uma branch longa. Fases de contrato/design podem entregar documentação e referências de desenho, sem inserir funcionalidade incompleta no caminho ativo.

Cada PR parte da `main` atualizada e deve ser integrável com o comportamento legado preservado. A próxima fase dependente parte da `main` após a integração anterior; enquanto aguarda integração, o executor pode adiantar trabalho independente ou uma dependência curta explicitamente registrada, sem formar uma cadeia longa de branches. Atualizações da base seguem as convenções do repositório, sem rebase, force-push, push direto na `main` ou bypass de admin.

O fluxo de integração é branch → PR → checks e reviews exigidos → merge autorizado. Registrar no PR os testes locais e os resultados da matriz Linux/Windows/macOS do workflow `.github/workflows/ci.yml`, distinguindo-os dos testes de emulador e do piloto Android. Conferir os requisitos remotos vigentes na execução; esta estratégia não autoriza ignorar proteção nem antecipa autorização de merge/release. Integrar código inativo por PR não liga a função nem dispensa testar regressões de boot e atualização.

### 11.6 Regras mecânicas para a implementação

Ler `tools/quality/rules.js`, `tools/quality/gate.js`, `test/test-isolation.test.js` e as orientações de `CLAUDE.md` antes do primeiro código. Pontos confirmados no checkout desta revisão:

- **Ratchet por arquivo e regra:** `npm run lint` reprova qualquer contagem acima de `tools/quality/baseline.json`; arquivo novo parte de zero. Não subir baseline, ampliar exceções ou mover dívida entre arquivos para aceitar o adaptador. `lint:update` deve ser usado apenas para registrar reduções verificadas. Atenção: a implementação atual de `--update` sobrescreve a baseline sem impor essa monotonicidade; o comando sozinho não prova que a atualização é permitida.
- **Fontes centralizadas:** acesso direto a ambiente pertence a `lib/env.js`/`lib/paths.js`; parse e serialização JSON a `lib/io.js`; constantes devem seguir o módulo apropriado. O cliente deve consumir essas abstrações, evitando novas violações `processEnvDireto`, `jsonParseCru`, `jsonStringifyCru` e tempos mágicos.
- **Tamanho e profundidade:** `maxLines: 400` conta linhas úteis após limpeza do código, e `maxDepth: 3` usa a aproximação de profundidade de chaves implementada no gate. Organizar responsabilidades antes de escrever o adaptador: transporte REST/CAS, streaming SSE, autenticação/refresh, coordenação e outbox/projeção. O executor escolhe arquivos e composição coesos; não concentrar tudo num módulo nem fragmentar artificialmente só para satisfazer a contagem.
- **Isolamento ESM:** em testes que fixam `FAROL_HOME`, usar diretório temporário próprio e carregar os módulos que alcançam `lib/paths.js` com `await import()` depois da atribuição. Import estático desses módulos é avaliado antes da configuração e pode tocar no home real. Imports puros sem essa dependência continuam permitidos.
- **Verificação por entrega:** executar `npm run check`, `npm run lint` e `npm test`; antes do push executar também `npm run eng` e cumprir o hook do repositório. O workflow atual executa check/lint/test em Node 22.12 na matriz Linux/Windows/macOS e agrega no check `ci`; `npm run eng` é evidência local de pré-push, não parte dessa matriz atual. Testes com Firebase Emulator precisam ter sua execução explicitamente documentada e automatizada na CI quando adicionados, sem depender de credenciais pessoais.

## 12. Fases de execução

Após autorização de início, percorrer as fases autonomamente. “Critério de avanço” significa evidência a produzir pelo executor. A fundação técnica pode avançar em paralelo ao desenho quando não depender de decisões visuais; integração visual usa o resultado do Claude Design.

### Fase 0 — Fechamento do contrato funcional

Entregáveis:

- registrar a medição inicial: até US$ 115,06 em 30 sessões que terminaram como `already_reviewed`, sem atribuir causalidade entre dispositivos;
- confirmar em execução que Windows e Android usam homes e motores independentes;
- obter, somente com autorização específica para essa coleta e destino local, cópias de `usage-sessions.json` e `decisions.json` do Android; consolidar as duas fontes por conta, PR, head e tempo, mantendo separadas as categorias “cross-device comprovável”, “potencialmente evitável” e “origem indeterminada”;
- registrar a projeção meramente anualizada da amostra Windows — até US$ 119,16 por 30 dias e US$ 1.449,81 por 365 dias se a mesma taxa se repetir — sem apresentá-la como ROI ou economia garantida;
- selecionar um fluxo suportado de Firebase Authentication que permita o mesmo UID em Windows e Android sem segredo administrativo no cliente; registrar configuração, persistência e refresh necessários;
- adotar Firebase pessoal como baseline do MVP; serviço central é expansão de produto e não precisa bloquear esta execução;
- campos remotos permitidos;
- política de falha;
- TTL e heartbeat preliminares;
- contrato dos fingerprints de review, autoanálise e pushback;
- contrato de `operationKind` explícito e allowlist exaustiva no estrangulamento;
- fuso canônico de `dailyRounds` e política de invalidação/retenção dos recibos;
- decisão registrada de usar REST/SSE/ETag no MVP, ou justificativa explícita para redesenhar o canal de update caso se escolha SDK;
- critérios de aceitação.

Critério de avanço: contratos acima registrados e dúvidas materiais identificadas. Provas técnicas isoladas de autenticação, CAS e SSE podem ser feitas nesta fase; detalhes técnicos resolvidos pelo executor não exigem aprovação adicional. A medição Android pode continuar depois se depender de acesso ao aparelho, sem bloquear fundação e testes em emulador.

### Fase 1 — Claude Design

Entregáveis:

- sessão executada no Claude Code usando Claude Design;
- fluxo completo;
- telas e estados;
- desktop e mobile;
- microcopy de privacidade e falha;
- revisão de acessibilidade;
- proposta visual verificável e coerente com o escopo, pronta para implementação e revisão do usuário.

Critério de avanço: desenho produzido no Claude Design, cobrindo os estados especificados e os componentes existentes. O executor pode seguir a implementação e incorporar feedback; uma aprovação visual separada só será exigida se o usuário a solicitar.

### Fase 2 — Fundação atrás da configuração opt-in

Entregáveis:

- campos de configuração com defaults desligados;
- `deviceId` persistente;
- adaptador REST remoto isolado, baseado em `fetch`, ETag/`if-match` e SSE;
- implementação de autenticação e refresh, testada em emulador e depois com projeto/provedor/credenciais provisionados pelo usuário;
- armazenamento seguro;
- estado de conexão no snapshot;
- outbox;
- regras e ambiente emulador.

Critério de avanço: comportamento antigo comprovadamente equivalente com configuração ausente ou desligada e consolidação isolada sem alterar automações.

### Fase 3 — Gate distribuído, recibos e pushback

Entregáveis:

- aquisição transacional;
- heartbeat;
- liberação condicional;
- recibo durável por versão material;
- preflight de review próprio no head antes de gastar, reutilizando `headSha` e `engine.myReviewStates(pr, headSha)`;
- bloqueio conjunto de review/autoanálise/pushback enquanto ativos;
- fingerprints distintos para conclusão de review, autoanálise e pushback;
- teto compartilhado de re-review automático por PR/dia;
- estados visuais;
- espera transitória de coordenação sem estacionamento;
- override manual explícito.

Critério de avanço: duas instâncias concorrentes e somente uma chamada ao stub do provedor; uma terceira instância iniciada depois encontra o recibo e também não chama o provedor. Cobrir ainda pending sem publicação, dismiss, perda de lease e a janela entre preflight e aquisição.

### Fase 4 — Histórico consolidado

Entregáveis:

- migração idempotente;
- sincronização incremental;
- correção de desfecho;
- projeção consolidada;
- filtro por dispositivo;
- status e recuperação da outbox.

Critério de avanço: importar duas vezes sem duplicar e operar offline sem perda local, inclusive após queda entre save e outbox.

### Fase 5 — Validação controlada

Ordem:

1. Firebase Emulator;
2. dois `FAROL_HOME` locais separados;
3. duas instâncias Windows controladas;
4. Windows e fluxo Android real;
5. uso pessoal prolongado;
6. revisão de segurança e privacidade;
7. decisão humana sobre disponibilização pública.

Critério de conclusão: evidências dos testes e do piloto registradas, com limitações reais do Android e da rede explicitadas. A passagem de fases não constitui autorização de merge, release ou ativação geral.

## 13. Testes e contraprovas obrigatórios

### Compatibilidade

- config antiga sem campos novos inicia normalmente;
- `enabled: false` não carrega módulo remoto, não abre `fetch`/SSE e não conecta ao Firebase;
- nenhum arquivo local muda apenas por atualizar o Farol;
- snapshots e decisões permanecem equivalentes no modo legado;
- Firebase indisponível não afeta usuários sem a função habilitada.
- `enabled: true`, `coordination.enabled: false` e `consolidation.enabled: true` sincronizam consumo sem consultar lease ou bloquear automações;
- nenhuma combinação dos toggles liga a outra capacidade implicitamente.

### Concorrência

- duas instâncias tentam adquirir simultaneamente e somente uma vence;
- somente a vencedora chama o provedor;
- o gate roda antes dos ramos de stub e Codex; trocar a conta para `auth.kind === 'codex'` não o contorna;
- `operationKind` ausente/desconhecido falha alto com coordenação ativa, enquanto `chat`/`tool` só passam por bypass declarado;
- uma instância iniciada depois da conclusão encontra o recibo e não repete a sessão;
- A lê ausência de recibo, B conclui e libera, A adquire depois: a releitura sob lease impede que A abra IA;
- perdedor do lease não reserva rodada; reserva expirada antes de `started` não consome cota; retry da mesma admissão não incrementa duas vezes;
- crash depois de `started` e antes do spawn mantém a cota conservadora, sem inventar evento de consumo;
- review, autoanálise e pushback do mesmo PR entram em conflito enquanto um deles está ativo;
- autoanálise concluída não suprime review, e review concluído não fabrica autoanálise;
- o mesmo head e tipo de operação com recibo válido não são processados outra vez automaticamente;
- head novo gera nova versão material elegível;
- review `DISMISSED` confirmado no GitHub invalida o recibo do mesmo head e permite nova revisão;
- análise concluída `pending` e publicação `failed` continuam deduplicadas sem review decisivo no GitHub;
- envelope incompleto salvo como pendência local não produz recibo de conclusão;
- recibo remoto não habilita aprovação/merge sem a evidência local exigida;
- resolução do stream antes de validação/persistência não libera lease nem grava recibo;
- falha do GitHub durante a reconciliação produz `unknown`, não apaga recibo e não abre IA automática;
- recibo `pending`/`failed` com proprietário sem atividade confirmada por sete dias mostra aviso e recuperação antecipada, sem esperar a retenção de 180 dias;
- `lastSeenAt` ausente, inválido ou apenas em cache mantém o recibo e mostra atividade desconhecida; não libera IA;
- recibo recente não é classificado como órfão por `lastSeenAt` antigo; retorno do proprietário remove a marca de ausência;
- recuperação manual disputa lease, revalida GitHub e recibo e não atropela conclusão concorrente; retorno do antigo proprietário não posta automaticamente payload de recibo substituído;
- dispositivos em fusos diferentes disputam a mesma chave `dailyRounds` definida por `America/Sao_Paulo`, inclusive nas bordas de meia-noite;
- poda de `dailyRounds` e recibos respeita a retenção sem apagar eventos de consumo;
- a mesma atividade do autor não dispara duas classificações de pushback;
- contas GitHub diferentes não se bloqueiam;
- lease expirado pode ser assumido;
- relógio local incorreto não cria lease imortal;
- lease alheio não pode ser renovado ou removido;
- liberação atrasada não remove lease sucessor.
- renovação tardia não revive lease expirado; recibo atrasado não substitui o do sucessor.

### Falhas

- rede cai antes da aquisição: nenhuma sessão nasce;
- rede cai durante a sessão: estado incerto fica visível;
- perda de heartbeat exercita backoff, cancelamento e reconciliação após suspensão; resultado sem propriedade não autoriza postagem automática;
- save local concluído e escrita do recibo interrompida preservam finalização pendente recuperável;
- autenticação expira: automação não gasta tokens;
- restart recupera outbox e presença sem duplicar evento;
- Firebase rejeita payload: histórico local permanece intacto.
- classe `coordenacao-indisponivel` é transitória, mas cada tipo de operação segue sua política de retry declarada;
- falha de coordenação nunca cria entrada de estacionamento persistente.

### Consumo

- migração repetida não duplica;
- sessões com o mesmo contador local em boots diferentes não colidem;
- `profileId` sobrevive à sincronização;
- atualização de `status` não cria outro evento;
- crash entre save local e inserção na outbox é recuperado pela reconciliação;
- valores medidos, estimados e sem base permanecem distinguíveis;
- `Este dispositivo` reproduz o total local;
- `Todos os dispositivos` não é gravado sobre `usage.json`;
- evento remoto de outro UID nunca é visível.

### Segurança

- Security Rules negam leitura e escrita cruzada entre UIDs;
- regras rejeitam tomada antecipada, TTL acima do limite e transições de tentativa sem lease válido, mesmo com relógio local adiantado;
- payloads fora do contrato são rejeitados;
- tokens não aparecem em config, log, SSE ou pacote;
- exclusão remota não apaga arquivos locais;
- desabilitar não equivale a excluir.

### Teste de mutação do gate

Remover ou neutralizar a aquisição transacional deve fazer um teste concorrente falhar, demonstrando que duas sessões seriam iniciadas sem o gate. Remover a consulta de recibo deve fazer o teste sequencial falhar; remover somente a releitura após adquirir o lease deve reprovar a corrida descrita acima. Retirar `operationKind` ou `coordinationContext` de review, autoanálise ou pushback deve fazer a fachada recusar o spawn com coordenação ativa. Mover o gate para depois do retorno Codex também deve fazer uma contraprova falhar. Um teste que permanece verde após remover qualquer uma dessas travas não prova a regra.

## 14. Observabilidade

Registrar localmente, sem credenciais ou payload sensível:

- sync habilitado/desabilitado;
- autenticação estabelecida ou expirada;
- lease adquirido, recusado, renovado, perdido e liberado;
- recibo encontrado, gravado e reconciliado;
- dispositivo que detém o lease, por nome amigável;
- quantidade de eventos pendentes;
- última sincronização bem-sucedida;
- falhas sanitizadas por categoria;
- override manual do gate.
- possível orfandade, atividade desconhecida e recuperação confirmada, com identificadores mínimos do recibo/dispositivo.

Não registrar tokens, conteúdo remoto bruto nem respostas integrais do Firebase.

## 15. Rollback

Rollback operacional:

1. desligar a função em Sistema;
2. remover listeners e interromper heartbeat;
3. manter arquivos locais intactos;
4. continuar pelo fluxo legado;
5. preservar a outbox para diagnóstico ou retomada, sem enviar enquanto desligado.

Rollback de versão não pode depender de migração reversa. Campos novos em `config.json` devem ser ignoráveis por versões anteriores ou permanecer isolados em arquivo próprio.

## 16. Estimativa preliminar

| Etapa | Estimativa |
|---|---:|
| Contrato funcional, medição e Claude Design | 2–3 dias |
| Fundação opt-in | 3–4 dias |
| Gate, lease, recibos, pushback e teto compartilhado | 5–8 dias |
| Consolidação de consumo | 3–4 dias |
| Validação Windows/Android e hardening | 3–5 dias |
| **Total do MVP pessoal sólido** | **16–24 dias** |

O aumento em relação à estimativa inicial vem de trabalho que já existia implicitamente no objetivo, mas estava ausente do plano: recibo sequencial, pushback e preservação do teto global de re-review. Uma prova técnica reduzida pode ser concluída antes, mas não deve ser apresentada como versão segura para produção.

Essa faixa é uma referência preliminar de esforço de engenharia, não um prazo mínimo nem previsão de duração do Opus ou Fable. O executor deve recalibrar após a prova de autenticação/CAS e a primeira entrega validada. Progresso será medido por funcionalidades e evidências concluídas, permitindo avançar mais rápido quando o código e os testes sustentarem isso. Tempo de acesso ao Android, feedback e observação do piloto deve ser informado separadamente.

## 17. Baseline e pendências de execução

Baseline para o handoff: Claude Code com Opus ou Fable; Claude Design nesse ambiente; Firebase pessoal por REST/SSE/ETag; chaves derivadas de PR; capacidades independentes desligadas por padrão; Android pela interface existente com Termux/proot; políticas iniciais de lease, recibos e retenção descritas acima.

Depois da autorização de início, resolver no fluxo normal do desenvolvimento:

- [ ] Garantir acesso à versão integral deste MD no checkout do Claude Code.
- [ ] Organizar branches curtas e PRs por fase, integrar incrementalmente na `main` com flags desligados e registrar CI por entrega.
- [ ] Planejar decomposição e imports dos testes conforme ratchet, limites e isolamento ESM da seção 11.6.
- [ ] Selecionar e provar autenticação, refresh e armazenamento de credenciais nos dois ambientes.
- [ ] Validar transições de lease, recibos e reservas no emulador e ajustar a estrutura técnica se necessário.
- [ ] Calibrar TTL/heartbeat e validar cancelamento, suspensão, reconexão e retomada.
- [ ] Produzir o desenho no Claude Design e implementar os estados, inclusive exclusão e exportação.
- [ ] Implementar aviso de possível orfandade e recuperação de pendências em dispositivos ausentes, com contraprovas de presença desconhecida e concorrência.
- [ ] Validar a retenção inicial: `dailyRounds` por 8 dias, recibos por até 180 dias/fechamento do PR e consumo sem expiração automática.
- [ ] Confirmar a instalação Android real, obter a medição complementar e realizar o piloto nos dois dispositivos.
- [ ] Registrar testes, limitações e instruções de configuração/rollback na entrega.

Dependências pessoais do usuário: criar o projeto Firebase, habilitar Authentication, provisionar credenciais e fazer login/consentimento; autorizar especificamente a coleta de arquivos Android, com arquivos e destino identificados. Acesso técnico já disponível e ordem de início não substituem esses atos. Essas dependências não impedem atividades independentes em ambiente isolado. A ordem de início cobre as fases de desenvolvimento; publicação e alterações de produção continuam com o escopo de autorização próprio.

## 18. Critérios de conclusão do MVP

O MVP estará concluído somente quando:

1. produção permanecer inalterada para quem não habilitou a função;
2. duas instalações autenticadas como a mesma pessoa não iniciarem análise concorrente sob conectividade normal;
3. uma instalação que entrar depois não repetir automaticamente uma operação já concluída para a mesma versão material enquanto seu recibo for válido, inclusive quando aguarda decisão humana;
4. review, autoanálise e pushback compartilharem o mesmo lease por PR e conta, com recibos semanticamente separados;
5. a indisponibilidade remota tiver estados honestos e não for confundida com lease alheio;
6. o histórico local continuar completo e autônomo;
7. o consolidado não duplicar eventos após retry, restart ou nova importação;
8. as regras isolarem integralmente os usuários;
9. o desenho produzido no Claude Design estiver implementado na interface existente em desktop e mobile, incorporando o feedback recebido;
10. testes locais, concorrentes e de emulador passarem;
11. qualquer release continuar dependendo de autorização e dos gates normais do repositório.
12. pendências em dispositivos ausentes tiverem aviso acionável e recuperação validada, sem supor que ausência de dado comprova abandono.

## 19. Referências técnicas

- Firebase Realtime Database — leitura, escrita e transações: <https://firebase.google.com/docs/database/web/read-and-write>
- Firebase Realtime Database REST — ETag e requisições condicionais: <https://firebase.google.com/docs/database/rest/save-data>
- Firebase Realtime Database REST — streaming SSE: <https://firebase.google.com/docs/database/rest/retrieve-data#section-rest-streaming>
- Firebase Realtime Database — presença e `onDisconnect`: <https://firebase.google.com/docs/database/web/offline-capabilities>
- Firebase Realtime Database — regras de segurança: <https://firebase.google.com/docs/database/security>
- Firebase Realtime Database — referência de regras e tempo `now`: <https://firebase.google.com/docs/reference/security/database>
- Firebase Realtime Database — referência REST e requisições condicionais: <https://firebase.google.com/docs/reference/rest/database>
- Firebase Authentication com GitHub: <https://firebase.google.com/docs/auth/web/github-auth>
- Firebase Realtime Database — cobrança: <https://firebase.google.com/docs/database/usage/billing>
- Firebase Realtime Database — limites: <https://firebase.google.com/docs/database/usage/limits>
