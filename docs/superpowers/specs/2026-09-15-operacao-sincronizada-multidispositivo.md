# Operação sincronizada multidispositivo do Farol

**Data:** 2026-09-15  
**Status:** especificação de produto e arquitetura; desenvolvimento não iniciado  
**Escopo:** experiência compartilhada, distribuição automática de reviews, administração de dispositivos, continuidade, histórico, segurança, diagnóstico e reorganização da interface  
**Documento anterior relacionado:** [`docs/PLANO-SINCRONIZACAO-DISPOSITIVOS.md`](../../PLANO-SINCRONIZACAO-DISPOSITIVOS.md)

## 1. Resumo executivo

O Farol deve evoluir de instalações locais apenas coordenadas para um ambiente operacional compartilhado entre dispositivos.

Cada aparelho continua executando localmente, com suas próprias credenciais, ferramentas, repositórios e capacidade computacional. O Firebase Realtime Database (RTDB) transporta somente o estado operacional e os dados estruturados necessários para que todos os dispositivos mostrem a mesma operação, distribuam trabalho, recebam comandos e preservem continuidade.

A distinção central é:

> Ver e coordenar uma review em qualquer aparelho não significa processá-la naquele aparelho.

O dispositivo executor é quem possui o processo, acessa o checkout local, usa as credenciais locais e chama o provedor de IA. Os demais dispositivos observam uma projeção sincronizada e, quando autorizados, enviam comandos ao executor.

Depois da configuração inicial, a distribuição deve ser automática. O usuário define prioridades, limites e elegibilidade por dispositivo; o Farol seleciona sozinho o primeiro aparelho apto. No cenário principal:

1. o celular é o primeiro da ordem;
2. ele aceita no máximo uma review;
3. enquanto estiver ocupado ou inapto, o excesso segue automaticamente para o computador;
4. se nenhum aparelho estiver apto, o trabalho permanece na fila com uma justificativa objetiva;
5. o Farol não inicia uma sessão arriscada apenas para descobrir depois que o aparelho não a suportava.

O objetivo de continuidade inclui a possibilidade de outro aparelho assumir uma review. Isso será uma retomada coordenada a partir de dados e checkpoints compartilhados, e não a migração literal de um processo Claude ou Codex em execução.

## 2. Relação com a sincronização já existente

O plano de 09/09/2026 definiu e a implementação atual já contém partes importantes:

- autenticação Firebase por usuário;
- identidade e presença de dispositivos;
- leases para impedir processamento concorrente;
- recibos duráveis para evitar repetição sequencial;
- reservas de rodadas diárias;
- eventos consolidados de consumo;
- RTDB por REST, SSE e ETag/CAS;
- operação local preservada quando a sincronização está desligada.

Esta especificação **não descarta essa fundação**. Ela amplia o produto em quatro dimensões que o plano anterior considerava fora do MVP:

1. projeção compartilhada de operações, Panorama, Meus PRs e histórico;
2. políticas e agendamento distribuído por dispositivo;
3. comandos administrativos remotos;
4. checkpoints compartilhados e transferência controlada.

Consequentemente, afirmações antigas como “não sincronizar decisões de review” ou “não sincronizar configurações gerais” precisam ser lidas com maior precisão:

- não serão sincronizadas todas as configurações; somente políticas operacionais explicitamente compartilháveis;
- não será sincronizado conteúdo bruto indiscriminado; será sincronizado um envelope estruturado de review suficiente para acompanhamento, decisão remota e continuidade;
- logs pessoais, credenciais, arquivos locais, prompts completos e conteúdo arbitrário continuam fora do RTDB.

## 3. Decisões funcionais já fechadas

As seguintes decisões vieram diretamente da descoberta com o usuário e não devem ser reabertas sem evidência técnica nova ou pedido explícito:

1. Panorama também faz parte da experiência sincronizada.
2. Revisões recentes são compartilhadas e possuem filtro por dispositivo.
3. A visão compartilhada inclui “Precisa de você” e “Meus PRs”.
4. O usuário pode acompanhar e agir sobre uma review a partir de outro aparelho.
5. O comando normal espera o executor reconectar quando ele estiver offline.
6. Deve existir a possibilidade de assumir uma review em outro aparelho quando tecnicamente possível.
7. Credenciais GitHub, tokens, chaves de API e segredos de providers vivem somente no dispositivo.
8. Um dispositivo só pode executar ou assumir trabalho quando tiver localmente as credenciais e ferramentas necessárias.
9. Limite de paralelismo e prioridade são configurados por dispositivo.
10. Depois da configuração, a distribuição deve ser automática e exigir pouca interação.
11. Se o primeiro dispositivo não estiver apto ou não tiver vaga, o Farol tenta o próximo automaticamente.
12. Somente o aparelho administrador altera políticas de outros dispositivos.
13. O administrador é escolhido na lista de aparelhos mediante validação da senha real do Firebase.
14. A senha é enviada somente ao Firebase para reautenticação e não é sincronizada nem persistida no RTDB.
15. A recuperação ou troca do administrador usa somente a senha Firebase; não haverá código de recuperação adicional.
16. Logs do aplicativo são pessoais e permanecem locais.
17. O botão de exclusão remota fica oculto por padrão e é controlado por uma chave de configuração.
18. Habilitar ou desabilitar essa chave não exige senha.
19. A senha Firebase é exigida no ato efetivo da exclusão.
20. O usuário aceita uma reorganização profunda das abas.
21. O significado original de “PF” não foi recuperado e certamente não significa “perfil”. O termo não deve ser inventado.

## 4. Objetivos

### 4.1 Objetivos de produto

- Oferecer uma visão coerente da operação em todos os dispositivos conectados.
- Tornar explícito onde cada trabalho está sendo processado.
- Permitir acompanhamento remoto sem duplicar processamento.
- Distribuir reviews automaticamente conforme prioridade, capacidade e disponibilidade.
- Evitar desperdício de tempo e tokens causado por aparelho sem condições de executar.
- Permitir ações administrativas remotas sem transportar credenciais.
- Preservar e compartilhar o histórico operacional relevante.
- Permitir continuidade controlada em outro dispositivo.
- Tornar exclusão remota uma ação rara, consciente e difícil de disparar acidentalmente.
- Reduzir duplicação e opacidade nas telas de Sistema e Diagnóstico.
- Manter o Farol plenamente útil quando a sincronização estiver desligada.

### 4.2 Objetivos técnicos

- Reusar leases, recibos, reservas e consumo já implementados.
- Manter o estado local como autoridade sobre processos e segredos locais.
- Construir projeções remotas compactas e versionadas.
- Separar comandos, fatos, políticas e telemetria.
- Garantir idempotência em comandos, eventos e reconstrução de projeções.
- Operar honestamente sob desconexão e partição de rede.
- Evitar listeners amplos ou payloads que onerem celular e RTDB.
- Evoluir o esquema sem exigir migração destrutiva.

## 5. Não objetivos e limites honestos

Esta iniciativa não deve:

- transmitir tokens GitHub, chaves de IA, senha Firebase ou refresh tokens entre aparelhos;
- sincronizar logs brutos do aplicativo;
- replicar checkouts, arquivos do repositório ou diretórios de sessão;
- prometer que um preflight preverá todas as falhas;
- prometer migração de um processo Claude/Codex vivo;
- prometer execução exatamente uma vez durante uma partição prolongada de rede;
- transformar o RTDB em armazenamento irrestrito de diffs, prompts, chats ou relatórios crus;
- permitir que um dispositivo sem credenciais locais publique no GitHub em nome de outro;
- bloquear o funcionamento local de quem não ativou a sincronização;
- habilitar sincronização automaticamente após atualização;
- apagar arquivos locais quando dados remotos forem limpos;
- confundir “comando solicitado” com “comando executado”.

### 5.1 O que a avaliação de capacidade pode prometer

O Farol pode identificar impedimentos objetivos e estimar risco com base em recursos e histórico. Ele não pode garantir que uma review terminará sem erro porque ainda existem falhas externas de rede, GitHub, provider, CLI, repositório e conteúdo inesperado.

O produto deve dizer:

- `apto`;
- `inapto`, com motivos;
- `capacidade desconhecida`, quando faltarem dados.

Internamente podem existir níveis de risco mais detalhados, mas a política automática deve produzir uma decisão inequívoca de elegibilidade.

## 6. Princípios e invariantes

### 6.1 Localidade dos segredos

Cada aparelho possui e protege suas próprias credenciais. Uma credencial local pode ser diferente da usada em outro dispositivo, desde que tenha permissões equivalentes para a operação.

Nunca trafegam pelo RTDB:

- token ou sessão do `gh`;
- token GitHub clássico, fine-grained ou OAuth;
- API key de provider;
- credencial Claude ou Codex;
- senha Firebase;
- cabeçalho `Authorization`;
- caminho absoluto sensível;
- conteúdo de arquivo de credenciais;
- variável de ambiente secreta.

### 6.2 Separação entre controle e execução

- O administrador define políticas e solicita ações.
- O agendador decide a atribuição com base nas políticas.
- O executor valida novamente sua condição local antes de iniciar.
- O executor chama ferramentas e providers localmente.
- O RTDB registra intenção, estado e resultado estruturado.
- Nenhum comando remoto contorna validações locais obrigatórias.

### 6.3 Compatibilidade opt-in

- Configuração ausente equivale a sincronização desligada.
- Com a função desligada, não há autenticação, listener ou escrita remota.
- Desligar não apaga dados locais nem remotos.
- Falha remota não corrompe histórico local.
- Leases distribuídos complementam, mas não removem, travas locais.
- Versão anterior do Farol deve ignorar campos novos que não conhece.

### 6.4 Estados honestos

A interface deve distinguir:

- solicitado;
- aguardando dispositivo;
- recebido;
- em validação local;
- executando;
- concluído;
- recusado;
- expirado;
- falhou;
- estado desconhecido.

Nunca mostrar sucesso antes do recibo do executor.

## 7. Glossário operacional

| Termo | Definição |
|---|---|
| Dispositivo | Instalação persistente do Farol identificada por `deviceId`. |
| Administrador | Dispositivo autorizado a alterar políticas globais e de outros aparelhos. |
| Executor | Dispositivo que possui o processo local da review. |
| Projeção | Representação compacta e sincronizada de um estado local. |
| Política | Configuração compartilhada que orienta o agendador. |
| Capacidade | Recursos, ferramentas e credenciais declarados pelo aparelho. |
| Preflight | Verificação realizada antes da atribuição e repetida antes do spawn. |
| Lease | Posse temporária e exclusiva de uma operação material. |
| Recibo | Evidência durável de uma operação concluída ou consolidada. |
| Comando | Solicitação administrativa enviada a um executor. |
| Checkpoint | Estado estruturado e reaproveitável de uma verificação. |
| Transferência | Entrega voluntária e coordenada entre executores. |
| Tomada | Continuação por outro aparelho quando o executor anterior não coopera ou não responde. |

## 8. Modelo de dispositivos e administração

### 8.1 Cadastro do dispositivo

Ao ativar a sincronização, cada instalação mantém um `deviceId` aleatório persistente e publica um registro sanitizado:

- nome amigável;
- plataforma;
- versão do Farol;
- capacidades declaradas;
- resumo de saúde;
- prioridade;
- limite de concorrência;
- estado operacional;
- última presença confirmada;
- indicador de administrador;
- versão do contrato suportado.

Hostname e caminhos locais não devem ser usados como identidade remota.

### 8.2 Definir administrador

Na lista de aparelhos haverá a ação **Definir como administrador**.

Fluxo obrigatório:

1. selecionar um dispositivo conhecido;
2. abrir confirmação que identifica origem e destino;
3. solicitar a senha Firebase;
4. reautenticar diretamente no Firebase;
5. somente após resposta válida, atualizar a geração administrativa;
6. propagar o novo administrador;
7. descartar a senha da memória assim que a operação terminar;
8. invalidar comandos administrativos pendentes assinados pela geração anterior, quando aplicável.

A senha não é armazenada no RTDB, em configuração, log, diagnóstico ou snapshot de UI.

### 8.3 Limite de segurança do modelo escolhido

Todos os dispositivos atualmente autenticam no mesmo UID. As regras do banco isolam usuários diferentes, mas não transformam `deviceId` em uma credencial independente. Portanto:

- o papel administrativo protege o fluxo normal do produto;
- a reautenticação comprova conhecimento da senha da conta Firebase;
- qualquer pessoa ou dispositivo que conheça essa senha pode, em princípio, recuperar a administração;
- este modelo não protege contra um cliente deliberadamente modificado que possua uma sessão Firebase válida e escreva diretamente no RTDB.

Segurança forte contra dispositivos maliciosos exigiria identidade Firebase por dispositivo, custom claims ou backend confiável. Isso fica fora do primeiro ciclo, mas o limite deve estar documentado na interface técnica e nos testes de ameaça.

### 8.4 Alterações permitidas

Somente o administrador pode, pela aplicação:

- renomear outros dispositivos;
- mudar prioridade;
- mudar limite de concorrência;
- pausar ou reativar dispositivo;
- alterar elegibilidade e regras de fallback;
- definir outro administrador;
- habilitar o botão de limpeza remota;
- iniciar a limpeza remota;
- emitir comandos de transferência ou tomada.

Cada aparelho pode atualizar somente sua presença, telemetria, capacidades observadas, recibos de comandos que executou e projeções das operações que possui.

## 9. Política distribuída de execução

### 9.1 Configuração por dispositivo

Cada dispositivo terá:

```text
enabled                  participa da execução automática
priority                 ordem preferencial; menor número vence
maxConcurrentReviews     teto local compartilhado
allowedAccounts          contas que pode atender
allowedRepositories      filtro opcional de repositórios
allowedOperationKinds    review, self, pushback e futuras operações
allowTakeover            aceita receber continuidade
paused                   não recebe trabalho novo
capabilityPolicy         limites mínimos e tolerâncias
fallbackGroup            grupo opcional de roteamento
```

Credenciais disponíveis não serão enumeradas em texto sensível. O dispositivo publica apenas capacidades abstratas, por exemplo:

- `github:ready` para determinada conta lógica ou hash;
- `provider:claude-ready`;
- `provider:codex-ready`;
- `repository:ready` para chave derivada;
- `tool:jira-ready`, quando aplicável.

### 9.2 Exemplo principal

```yaml
devices:
  mobile:
    priority: 1
    maxConcurrentReviews: 1
    enabled: true
  computador:
    priority: 2
    maxConcurrentReviews: 3
    enabled: true
```

Comportamento:

- a primeira review elegível vai para o mobile;
- enquanto o mobile estiver processando uma review, novas reviews tentam o computador;
- se o mobile estiver offline, inapto, pausado ou sem credencial compatível, o computador é avaliado imediatamente;
- ao terminar, o mobile volta a ser o primeiro candidato para o próximo item ainda não atribuído;
- uma review já atribuída não migra só porque um aparelho prioritário ficou livre.

### 9.3 Algoritmo de seleção

Para cada item da fila global:

1. identificar conta, repositório, PR, head, tipo de operação e requisitos conhecidos;
2. listar dispositivos habilitados e recentemente presentes;
3. remover dispositivos pausados ou incompatíveis com conta/operação/repositório;
4. remover dispositivos sem vaga;
5. avaliar o preflight publicado recentemente;
6. ordenar por prioridade;
7. resolver empate por capacidade adequada, menor carga, justiça temporal e identificador estável;
8. reservar a atribuição por CAS;
9. enviar comando de início ao vencedor;
10. exigir novo preflight local antes do spawn;
11. liberar e tentar o próximo se o vencedor recusar legitimamente;
12. manter na fila, com motivos, se não houver candidato.

O agendador não pode criar duas atribuições simultâneas para a mesma versão material.

### 9.4 Falha e fallback

| Situação | Ação automática |
|---|---|
| Primeiro dispositivo ocupado | tentar o próximo |
| Offline ou presença vencida | tentar o próximo |
| Credencial local incompatível | tentar o próximo |
| Preflight inapto | tentar o próximo |
| Estado de capacidade desconhecido | solicitar atualização curta; depois tentar o próximo |
| Todos inaptos | manter na fila com motivos |
| Reserva concorrente perdida | aceitar o vencedor e observar |
| Executor recusa antes do spawn | liberar e tentar próximo |
| Executor falha depois do spawn | aplicar política de retry; não duplicar automaticamente sem reconciliação |

### 9.5 Autonomia depois da configuração

O fluxo normal não deve solicitar escolha de dispositivo a cada review. Interação humana fica reservada para:

- falta de qualquer executor apto;
- conflito de política;
- credencial expirada;
- decisão substantiva da review;
- tomada forçada com risco de duplicidade;
- exclusão remota;
- troca de administrador.

## 10. Avaliação de capacidade antes da review

### 10.1 Duas avaliações complementares

O Farol cruza:

1. **capacidade do aparelho**;
2. **peso estimado da review**.

Avaliar somente o aparelho é insuficiente: um celular pode executar reviews pequenas e falhar em uma mudança muito grande. Avaliar somente o PR também é insuficiente: o mesmo trabalho pode ser adequado no computador e inadequado no telefone.

### 10.2 Sinais do dispositivo

Quando disponíveis e sem adicionar privilégio invasivo:

- memória total e disponível;
- espaço livre no volume de trabalho;
- carga recente de CPU;
- quantidade de reviews já executando;
- bateria e carregamento;
- condição térmica exposta pelo ambiente;
- conectividade com RTDB;
- conectividade com GitHub;
- disponibilidade do provider;
- versão e autenticação das CLIs;
- existência e condição do repositório;
- espaço esperado para worktree e artefatos;
- histórico recente de falhas de recurso.

Ausência de um sinal não deve ser convertida em valor zero ou saudável. Deve permanecer `unknown`.

### 10.3 Sinais da review

Antes do processamento pesado, coletar metadados baratos:

- quantidade de arquivos alterados;
- adições e remoções;
- tamanho dos maiores arquivos;
- presença de binários;
- presença de arquivos gerados ou minificados;
- quantidade de repositórios ou worktrees envolvidos;
- ferramentas adicionais necessárias;
- complexidade aproximada baseada em extensões e áreas tocadas;
- tamanho histórico de reviews semelhantes;
- head SHA e estabilidade do head;
- necessidade conhecida de Jira, navegador ou outra integração local.

### 10.4 Resultado da avaliação

```text
eligible: true | false
confidence: high | medium | low
reasons: reason[]
measuredAt
expiresAt
policyVersion
```

Exemplos de motivo:

- `memory-below-minimum`;
- `disk-below-minimum`;
- `provider-not-ready`;
- `github-account-not-ready`;
- `repository-not-ready`;
- `review-too-large-for-policy`;
- `thermal-state-unsafe`;
- `device-at-capacity`;
- `telemetry-stale`.

### 10.5 Calibração histórica

Após cada execução, o aparelho registra localmente:

- duração;
- tamanho do PR;
- tipo e modelo;
- pico de recursos quando observável;
- resultado;
- falha categorizada;
- tokens e custo quando disponíveis.

Somente métricas agregadas e sanitizadas são compartilhadas. Logs continuam locais.

O modelo inicial deve ser baseado em regras explícitas. Aprendizado estatístico pode ajustar limiares futuramente, mas não deve ser pré-requisito para entregar uma primeira versão explicável.

### 10.6 Contraprovas obrigatórias

- Remover o teste de memória deve fazer uma review acima do limite ser indevidamente aceita e reprovar o teste.
- Marcar telemetria vencida como saudável deve reprovar.
- Um mobile ocupado com limite 1 deve enviar o excesso ao segundo dispositivo.
- Dispositivo prioritário sem GitHub local compatível deve ser ignorado.
- Nenhum dispositivo apto deve abrir processo de IA.
- Empate deve produzir ordem determinística.

## 11. Projeção compartilhada da operação

### 11.1 Conteúdo mínimo

Cada operação sincronizada deve expor:

- ID global;
- chave canônica ou derivada do PR;
- URL do PR, quando o usuário aceitar referência legível;
- título e autor;
- conta GitHub lógica;
- repositório;
- head SHA;
- tipo de operação;
- executor atual;
- estado;
- etapa atual;
- progresso estruturado;
- início e última atualização;
- duração;
- modelo;
- quantidade de achados;
- quantidade de itens que exigem decisão;
- decisão/veredito quando disponível;
- estado de publicação;
- consumo conhecido, parcial ou desconhecido;
- histórico de atribuições e transferências;
- versão do contrato.

### 11.2 Conteúdo que não entra no primeiro recorte

- streaming integral de stdout/stderr;
- prompt completo;
- conversa completa com o agente;
- diff integral;
- arquivo completo do repositório;
- log bruto;
- diretório de sessão;
- segredo ou credencial;
- relatório arbitrário sem sanitização.

### 11.3 Progresso estruturado

O progresso não deve ser apenas uma porcentagem inventada. Ele deve refletir etapas observáveis, por exemplo:

```text
queued
assigned
preflight
preparing-workspace
collecting-context
analyzing
verifying-findings
awaiting-user
publishing
completed
failed
cancelled
unknown
```

Quando não houver medição real, não exibir percentual. Mostrar etapa, tempo e último evento confirmado.

### 11.4 Panorama, Meus PRs e Precisa de você

As três superfícies usam projeções compartilhadas, não uma nova consulta completa em cada dispositivo:

- **Panorama:** visão unificada do trabalho monitorado, origem e estado.
- **Meus PRs:** PRs da pessoa, com estado consistente entre aparelhos.
- **Precisa de você:** decisões pendentes, credenciais vencidas, conflitos, ausência de executor e tomadas que exigem confirmação.

Um dispositivo autorizado atualiza a projeção; os demais consomem o snapshot incremental. Deve existir indicação de atualização e origem para que dado remoto vencido não pareça atual.

## 12. Histórico compartilhado

### 12.1 Revisões recentes

Revisões recentes deixam de ser apenas a projeção das decisões locais do aparelho. A visão compartilhada permite filtrar por:

- todos os dispositivos;
- dispositivo específico;
- conta;
- repositório;
- autor;
- período;
- resultado;
- modelo;
- erro;
- transferência;
- tomada;
- consumo conhecido ou desconhecido;
- estado de publicação.

### 12.2 Retenção

O pedido é preservar os dados e não oferecer exclusão casual. A implementação deverá definir uma política explícita de retenção antes de podar qualquer histórico remoto.

Até essa decisão:

- não aplicar poda destrutiva automática às revisões consolidadas;
- manter arquivos locais intactos;
- usar paginação e índices em vez de cortar silenciosamente a história;
- indicar quando a UI mostra somente uma janela do histórico;
- diferenciar remoção de projeção regenerável de exclusão de fato histórico.

### 12.3 Consumo com erro

O status de consumo precisa admitir:

- `measured`;
- `partial`;
- `estimated`;
- `unknown`;
- `not-applicable`.

Falha da review não apaga consumo. Se o provider informou tokens antes da falha, o evento é registrado como parcial ou medido conforme a evidência. Se o processo morreu antes de fornecer qualquer dado, o Farol registra consumo desconhecido, nunca zero por suposição.

## 13. Comandos remotos

### 13.1 Regra de execução

O administrador envia uma intenção. O dispositivo executor decide se ainda pode executá-la de acordo com o estado atual, credenciais locais, head do PR e invariantes do produto.

### 13.2 Comandos previstos

- iniciar review em dispositivo escolhido;
- cancelar review;
- repetir review;
- mudar prioridade de item ainda não iniciado;
- pausar ou retomar a fila de um aparelho;
- aprovar decisão pendente;
- solicitar alterações;
- comentar;
- ignorar/dispensar pendência quando o fluxo permitir;
- transferir voluntariamente;
- solicitar tomada;
- atualizar capacidade;
- reconciliar estado.

Os comandos de publicação no GitHub somente são executados se o aparelho possuir credencial local válida para a conta exigida.

### 13.3 Envelope de comando

```text
commandId
kind
createdAt
expiresAt
requestedByDeviceId
targetDeviceId
operationId
expectedRevision
expectedHeadSha
payloadVersion
payload
adminGeneration
status
receivedAt
completedAt
resultCode
```

Não usar dados secretos no `payload`.

### 13.4 Idempotência e concorrência

- `commandId` é globalmente único.
- Reprocessar o mesmo comando devolve o mesmo recibo e não repete o efeito.
- `expectedRevision` impede ação sobre estado ultrapassado.
- `expectedHeadSha` impede publicar decisão preparada para outro head.
- Comando expirado não executa.
- Cancelamento e conclusão concorrentes precisam de transição CAS.
- Um aparelho não executa comando destinado a outro.

### 13.5 Executor offline

Quando o executor estiver offline:

- o comando fica `pending`;
- a interface mostra “aguardando o dispositivo voltar”;
- nenhuma outra máquina usa credenciais em nome dele;
- ao reconectar, o executor revalida o estado antes de agir;
- o administrador pode, separadamente, solicitar tomada da review.

## 14. Transferência e tomada de review

### 14.1 Restrição técnica

Não existe migração literal do processo em memória, terminal, PID, diretório de sessão ou contexto privado do provider. A continuidade possível é semântica: preservar fatos, checkpoint e estado suficiente para outro dispositivo retomar com seu próprio processo.

### 14.2 Transferência voluntária

Fluxo recomendado:

1. administrador solicita transferência para um destino;
2. destino faz preflight e declara aptidão;
3. executor atual recebe pedido de pausa segura;
4. executor conclui a unidade indivisível atual;
5. grava checkpoint compartilhado consistente;
6. interrompe o provider quando necessário;
7. marca a operação como `handoff-ready`;
8. libera o lease por CAS;
9. destino adquire o lease;
10. destino valida credenciais, repositório e head;
11. destino retoma ou reinicia de forma declarada;
12. histórico registra origem, destino e aproveitamento obtido.

### 14.3 Tomada com executor offline

Fluxo:

1. detectar presença vencida sem concluir que o processo morreu;
2. oferecer tomada somente ao administrador;
3. validar o destino;
4. aguardar expiração do lease e uma janela de segurança;
5. explicar que o aparelho antigo pode estar processando sem rede;
6. exigir confirmação para tomada forçada;
7. adquirir um lease sucessor sem apagar o registro anterior;
8. bloquear publicação tardia do executor antigo por geração/revisão;
9. reconciliar caso o aparelho antigo retorne.

### 14.4 Retomada versus reinício

O resultado deve ser classificado:

- **retomada integral:** checkpoint suficiente e mesmo head;
- **retomada parcial:** alguns fatos reaproveitados, nova análise necessária;
- **reinício controlado:** histórico preservado, mas análise reiniciada;
- **recusada:** destino inapto ou estado incompatível.

### 14.5 Checkpoint compartilhável

O checkpoint deverá ser estruturado, versionado e limitado a dados necessários:

- head SHA;
- checks planejados;
- checks executados;
- evidências confirmadas;
- evidências refutadas;
- achados e estado de verificação;
- arquivos ou áreas já examinados por referência, sem copiar conteúdo arbitrário;
- decisões pendentes;
- versão do prompt/protocolo;
- compatibilidade de retomada;
- autor e timestamp de cada entrada.

O checkpoint local existente é append-only e deve continuar sendo a evidência primária do aparelho. A projeção remota não pode apagar ou reescrever silenciosamente a história local.

### 14.6 Riscos inevitáveis

- O aparelho antigo pode continuar consumindo tokens durante uma partição.
- O destino pode precisar reler o PR.
- Head novo pode invalidar parte do checkpoint.
- Providers diferentes podem não suportar continuidade equivalente.
- Uma tomada não pode reutilizar credencial que não existe no destino.

Esses riscos precisam aparecer no produto e nos testes; não podem ser escondidos por uma promessa de continuidade perfeita.

## 15. Configurações locais e compartilhadas

### 15.1 Compartilhadas

- administrador atual;
- nomes amigáveis dos dispositivos;
- prioridade e habilitação;
- teto de reviews por aparelho;
- regras de fallback;
- filtros de conta/repositório/operação;
- permissão para receber transferência;
- política de capacidade;
- chave que habilita a exibição da limpeza remota;
- preferências operacionais que precisem ser coerentes no conjunto.

### 15.2 Locais

- credenciais e sessões;
- tokens e API keys;
- caminhos;
- repositórios e worktrees;
- comandos de instalação;
- logs;
- preferências puramente visuais, salvo decisão futura;
- configuração específica de ferramenta local;
- detalhes sensíveis de ambiente.

### 15.3 Precedência

1. invariantes de segurança locais;
2. capacidade real observada localmente;
3. política compartilhada vigente;
4. preferência local permitida;
5. padrão da versão.

Uma política remota não pode declarar que uma ferramenta existe quando o dispositivo não a possui.

## 16. Limpeza dos dados sincronizados

### 16.1 Comportamento visual

Em **Sistema → Sincronização** haverá a chave:

> Permitir limpeza de dados sincronizados

Regras:

- padrão desligado;
- ligar ou desligar não solicita senha;
- desligada: o botão de exclusão não aparece;
- ligada: o botão aparece com linguagem destrutiva explícita;
- a chave é editável somente no aparelho administrador.

### 16.2 Execução da limpeza

Ao clicar em apagar:

1. mostrar quais categorias remotas serão apagadas;
2. avisar que arquivos locais não serão apagados;
3. solicitar a senha Firebase;
4. reautenticar no Firebase;
5. executar somente se a autenticação for válida e recente;
6. pedir confirmação final inequívoca;
7. efetuar a exclusão;
8. gravar recibo local sanitizado;
9. zerar ou redirecionar cursores locais que apontavam para o conjunto removido;
10. retornar a chave ao padrão desligado após a reconstrução da política.

### 16.3 Operações em andamento

A implementação atual apaga `/users/{uid}` inteiro. Isso remove inclusive leases de reviews vivas. Um executor pode perceber depois que perdeu o lease, descartar o resultado ou recriar presença e outros nós.

Portanto, a limpeza não deve acontecer silenciosamente enquanto existirem:

- reviews em execução;
- transferência em curso;
- tomada pendente;
- comando administrativo ainda não resolvido;
- outbox em estado não reconciliado.

Comportamento recomendado:

- listar os impedimentos;
- orientar a concluir ou cancelar as operações;
- manter o botão bloqueado enquanto o estado for materialmente inconsistente;
- nunca cancelar reviews automaticamente como efeito colateral de apagar dados.

O bloqueio não é uma senha adicional; é proteção de integridade.

### 16.4 Limite da reautenticação

A senha confirma a conta Firebase, não a saúde do banco nem a identidade criptográfica independente do aparelho. A operação ainda precisa validar que a UI está no dispositivo administrador e na geração administrativa vigente.

## 17. Logs e diagnóstico

### 17.1 Logs permanecem locais

Não sincronizar:

- log bruto do aplicativo;
- stdout/stderr integral;
- stack trace com caminhos pessoais;
- histórico de terminal;
- respostas completas de APIs;
- dados usados exclusivamente para depuração local.

### 17.2 Reorganização da experiência

A tela atual mistura diagnóstico gerado, exportação e log de falhas. A nova experiência terá três conceitos:

1. **Estado do sistema** — providers, GitHub, Firebase, ferramentas, atualização e dispositivos.
2. **Falhas locais** — lista selecionável, filtrável e copiável.
3. **Pacote de diagnóstico** — exportação Markdown sanitizada.

### 17.3 Requisitos de usabilidade

- Qualquer falha deve ser facilmente selecionada e copiada.
- Deve existir ação “Copiar como Markdown”.
- A exportação precisa ter títulos, contexto, timestamps e blocos de código adequados.
- Segredos devem ser mascarados antes de montar o texto.
- Diagnóstico com IA é opcional e atua sobre seleção explícita.
- “Atualizar”, “limpar log local” e “gerar diagnóstico” não devem aparecer como representações duplicadas da mesma ação.
- Limpar log local não altera histórico remoto ou dados de review.

## 18. Arquitetura de informação proposta

A reorganização visual deverá ser validada por desenho antes da implementação, mas a hipótese inicial é:

### Operação

- Agora;
- Fila;
- Precisa de você.

### Trabalho

- Panorama;
- Meus PRs.

### Histórico

- Revisões;
- filtros por dispositivo, conta, repositório e estado.

### Consumo

- este dispositivo;
- todos os dispositivos;
- filtros;
- sessões e qualidade da medição.

### Time

- pessoas e entregas já existentes, reorganizadas sem perda funcional.

### Sistema

- Dispositivos;
- Sincronização;
- Planos e chaves;
- Diagnóstico;
- demais configurações locais.

A seção visual isolada “Coordenação agora” deixa de existir. Seus dados úteis passam para **Operação** e **Dispositivos**. A remoção é visual; leases, recibos, presença e demais mecanismos continuam necessários.

### 18.1 Estados obrigatórios no desenho

- desktop largo;
- celular estreito;
- primeiro dispositivo;
- vários dispositivos;
- administrador e secundário;
- todos online;
- dispositivo offline;
- capacidade vencida;
- fila vazia;
- fila sem executor apto;
- review local;
- review remota;
- comando pendente;
- transferência;
- tomada forçada;
- autenticação expirada;
- sincronização degradada;
- histórico volumoso;
- erro copiável;
- botão de exclusão oculto, visível e bloqueado.

## 19. Planos, chaves e primeiro uso

Após a primeira validação, o usuário deve enxergar explicitamente:

- provider configurado;
- identidade detectada;
- nome configurável do plano ou vínculo;
- tipo de plano quando detectável;
- contas GitHub atribuídas;
- dispositivo em que cada credencial existe;
- estado de validação;
- limitações conhecidas do provider;
- última verificação.

Nada deve parecer configurado “por trás dos panos”. O Farol deve diferenciar:

- detectado automaticamente;
- informado pelo usuário;
- validado pelo provider;
- inferido;
- desconhecido.

O termo “PF” permanece como pendência lexical. Como o usuário confirmou que não significa “perfil”, nenhuma modelagem ou rótulo deve usar essa expansão sem nova evidência. A ausência do termo não bloqueia o resultado funcional descrito acima.

## 20. Modelo de dados remoto proposto

O esquema abaixo é conceitual. Nomes finais podem mudar durante o plano executável, mas as responsabilidades não devem ser misturadas.

```text
users/{uid}/
  control/
    adminDeviceId
    adminGeneration
    updatedAt
    cleanupEnabled
    policyVersion

  devices/{deviceId}/
    name
    platform
    farolVersion
    contractVersion
    createdAt
    lastSeenAt
    state
    capabilitiesSummary
    healthSummary

  devicePolicies/{deviceId}/
    enabled
    paused
    priority
    maxConcurrentReviews
    allowedAccounts
    allowedRepositories
    allowedOperationKinds
    allowTakeover
    fallbackGroup
    capabilityPolicy
    revision
    updatedAt

  presence/{deviceId}/{connectionId}/
    connectedAt
    lastSeenAt
    expiresAt

  queue/{operationId}/
    operationKind
    accountHash
    prHash
    headSha
    requirements
    priority
    state
    assignedDeviceId
    assignmentRevision
    createdAt
    updatedAt

  operations/{operationId}/
    identity
    executor
    state
    stage
    progress
    decisionSummary
    publicationState
    usageSummary
    checkpointSummary
    startedAt
    updatedAt
    completedAt
    revision

  operationEvents/{operationId}/{eventId}/
    type
    deviceId
    at
    revision
    summary

  commands/{targetDeviceId}/{commandId}/
    kind
    operationId
    requestedByDeviceId
    adminGeneration
    expectedRevision
    expectedHeadSha
    createdAt
    expiresAt
    status
    payload

  commandReceipts/{commandId}/
    targetDeviceId
    receivedAt
    completedAt
    status
    resultCode
    resultingRevision

  checkpoints/{operationId}/{checkpointId}/
    headSha
    sourceDeviceId
    createdAt
    contractVersion
    resumeCompatibility
    summary
    entries

  panorama/{scopeHash}/{itemId}/
    summary
    sourceDeviceId
    observedAt
    expiresAt

  recentReviews/{reviewId}/
    summary
    deviceId
    operationId
    at
    outcome
    publicationState
    usageState

  leases/{accountHash}/{prHash}/...
  receipts/{accountHash}/{prHash}/{fingerprint}/...
  dailyRounds/{accountHash}/{prHash}/{day}/...
  usageEvents/{deviceId}/{eventId}/...
```

### 20.1 Separações obrigatórias

- `devicePolicies` expressa intenção; `devices.healthSummary` expressa realidade observada.
- `queue` representa trabalho ainda distribuível; `operations` representa execução.
- `commands` representa pedidos; `commandReceipts` representa efeitos confirmados.
- `operationEvents` é append-only; `operations` é projeção atual.
- `checkpoints` preserva continuidade; `recentReviews` otimiza histórico e filtro.
- leases e recibos existentes continuam sendo as travas materiais.

### 20.2 Volume e listeners

- Ouvir apenas nós necessários à tela e ao dispositivo atual.
- Comandos devem ser particionados por destino.
- Histórico deve usar paginação e índices.
- Eventos detalhados não devem ser baixados para montar um cartão simples.
- Presença e progresso precisam de frequência limitada.
- Atualizações de progresso devem agrupar eventos rápidos para não onerar celular e RTDB.

## 21. Regras do RTDB e autorização

As regras atuais permitem leitura e escrita ampla para qualquer sessão do mesmo UID. A evolução precisa:

- preservar isolamento entre UIDs;
- validar formatos, tamanhos e campos permitidos;
- validar TTL e transições de lease;
- impedir payloads arbitrários em comandos, operações e checkpoints;
- limitar strings e coleções;
- rejeitar campos desconhecidos em objetos sensíveis;
- impedir que um recibo antigo sobrescreva geração nova;
- impedir que executor antigo publique depois de uma tomada;
- amarrar recebimento de comando ao dispositivo de destino no protocolo da aplicação.

Como o RTDB não conhece uma credencial independente por dispositivo no modelo escolhido, parte da autorização administrativa será uma garantia cooperativa da aplicação. Isso deve ser declarado e testado sem ser vendido como isolamento criptográfico forte.

## 22. Estado offline e reconciliação

### 22.1 Dispositivo observador offline

- mantém último snapshot local marcado como desatualizado;
- não inventa progresso;
- reconcilia por revisão ao retornar.

### 22.2 Executor perde RTDB antes do spawn

- não inicia a IA;
- libera intenção local quando seguro;
- aguarda reconexão ou redistribuição.

### 22.3 Executor perde RTDB durante a review

- processo pode continuar segundo a política já definida para lease;
- estado remoto fica `unknown` ou `degraded`;
- resultado não é publicado automaticamente sem confirmar propriedade vigente;
- ao reconectar, reconcilia lease, head, comando e revisão.

### 22.4 Administrador offline

- execução já configurada pode continuar;
- dispositivos não ganham poder administrativo temporário;
- mudanças de política aguardam recuperação/autenticação.

### 22.5 Retorno do executor antigo após tomada

- ele não recupera automaticamente a posse;
- não publica resultado produzido sob geração vencida;
- envia evento de reconciliação;
- preserva artefato local para diagnóstico;
- a UI apresenta possível consumo duplicado, se houver evidência.

## 23. Privacidade e classificação dos dados

| Classe | Exemplos | Destino |
|---|---|---|
| Segredo | token, senha, API key | somente local |
| Conteúdo privado bruto | logs, prompt, diff, stdout | somente local no primeiro recorte |
| Dado operacional | etapa, executor, estado, timestamps | RTDB |
| Dado de review estruturado | achado, decisão, checkpoint sanitizado | RTDB quando necessário |
| Telemetria técnica | memória resumida, duração, falha categorizada | local + agregado remoto |
| Consumo | tokens, custo, qualidade da medição | local + evento remoto opt-in |
| Configuração operacional | prioridade, limite, elegibilidade | RTDB |
| Configuração sensível/local | caminhos, comandos, credenciais | somente local |

Dados de review ainda podem ser sensíveis mesmo sem segredo. O desenho executável deverá definir tamanho, retenção, sanitização e opção de referência legível versus hash antes da implementação.

## 24. Fases de implementação recomendadas

### Fase 0 — Contrato e desenho

- validar esta especificação contra o código atual;
- fechar o contrato do dado de review trafegável;
- desenhar nova arquitetura de informação desktop/mobile;
- desenhar estados de fila, capacidade, comando e tomada;
- produzir plano executável por entregas pequenas;
- reconciliar com a reorganização estrutural já planejada.

**Saída:** contrato versionado, fluxos, protótipos e tarefas com testes.

### Fase 1 — Administração, políticas e exclusão segura

- papel de administrador;
- reautenticação Firebase;
- políticas por dispositivo;
- chave de limpeza desligada por padrão;
- exclusão com senha no ato;
- proteção contra limpeza inconsistente;
- regras e projeção de UI.

**Saída:** controle administrativo utilizável sem ainda distribuir reviews novas.

### Fase 2 — Capacidade e preflight

- coleta local de recursos;
- declaração abstrata de credenciais/ferramentas;
- estimativa barata do peso da review;
- elegibilidade explicável;
- expiração da telemetria;
- histórico para calibração.

**Saída:** cada dispositivo sabe aceitar ou recusar trabalho antes do spawn.

### Fase 3 — Visão compartilhada

- projeção de operações;
- progresso estruturado;
- Panorama;
- Meus PRs;
- Precisa de você;
- revisões recentes compartilhadas;
- filtros por dispositivo;
- consumo consolidado integrado.

**Saída:** todos os dispositivos enxergam a mesma operação sem duplicar processamento.

### Fase 4 — Agendador distribuído

- fila global;
- prioridade por dispositivo;
- teto por aparelho;
- fallback automático;
- reserva idempotente;
- justiça e desempate determinístico;
- cenário mobile primeiro, computador para excesso.

**Saída:** distribuição automática após configuração.

### Fase 5 — Comandos remotos

- cancelar, repetir e priorizar;
- decidir e publicar usando credencial local do executor;
- recibos, expiração e idempotência;
- espera honesta quando executor estiver offline.

**Saída:** acompanhamento e ação remota com executor online ou posteriormente reconectado.

### Fase 6 — Checkpoint compartilhado e transferência voluntária

- contrato versionado do checkpoint;
- pausa segura;
- handoff entre dispositivos aptos;
- retomada integral, parcial ou reinício declarado.

**Saída:** continuidade cooperativa sem transportar processo ou segredo.

### Fase 7 — Tomada forçada

- lease sucessor;
- janela de segurança;
- confirmação de risco;
- bloqueio de publicação tardia;
- reconciliação do executor antigo;
- evidência de possível consumo duplicado.

**Saída:** ápice da feature, entregue sem promessa falsa de exatamente uma vez.

### Fase 8 — Planos, chaves e onboarding explícito

- transparência de provider, plano, contas e dispositivos;
- origem e qualidade de cada informação;
- tratamento do termo “PF” quando houver evidência.

### Fase 9 — Diagnóstico e acabamento da reorganização

- estado do sistema;
- falhas locais copiáveis;
- Markdown sanitizado;
- eliminação de duplicações visuais;
- revisão completa de responsividade e acessibilidade.

## 25. Estratégia de entrega

- Um PR pequeno e integrável por capacidade coerente.
- Flags novas desligadas por padrão.
- Não acumular todas as fases em uma branch longa.
- Separar mudanças de arquitetura estrutural da mudança de comportamento quando isso melhorar revisão e rollback.
- Não executar rebase.
- Não fazer push, merge, release ou ativação sem a autorização correspondente.
- Cada fase deve partir da `main` atualizada e comprovar compatibilidade com Windows, macOS e Linux; o piloto operacional precisa incluir Android/Termux.
- Mudanças de esquema devem ser aditivas antes de qualquer retirada de campo antigo.

## 26. Testes e contraprovas obrigatórios

### 26.1 Administração

- senha inválida não troca administrador;
- senha válida troca somente após resposta confirmada do Firebase;
- senha não aparece em config, log, SSE, snapshot ou diagnóstico;
- dispositivo secundário não altera política pela UI/API normal;
- troca concorrente de administrador tem um único vencedor;
- comando da geração anterior não executa depois da troca.

### 26.2 Agendamento

- mobile prioridade 1 e limite 1 recebe a primeira review;
- segunda review simultânea vai ao computador;
- mobile inapto é ignorado;
- computador inapto mantém trabalho na fila se não houver terceiro dispositivo;
- liberar vaga no mobile não rouba review já iniciada no computador;
- dois agendadores concorrentes não atribuem a mesma operação duas vezes;
- remover o CAS faz a contraprova concorrente falhar.

### 26.3 Capacidade

- telemetria ausente não vira aptidão automática;
- dado vencido não é usado como atual;
- ferramenta ausente bloqueia somente operações que dependem dela;
- credencial GitHub local incompatível bloqueia publicação/execução correspondente;
- review pequena e grande podem produzir decisões diferentes no mesmo dispositivo;
- erro externo não é reclassificado falsamente como falta de capacidade.

### 26.4 Comandos

- comando duplicado produz um efeito;
- comando expirado não executa;
- comando para head antigo é recusado;
- executor offline mantém estado pendente;
- reconexão revalida antes de executar;
- sucesso só aparece após recibo;
- remover idempotência faz a contraprova repetir o efeito.

### 26.5 Transferência e tomada

- transferência só ocorre para destino apto;
- checkpoint de outro head não é retomado integralmente;
- lease antigo não pode remover lease sucessor;
- executor antigo não publica depois da tomada;
- retorno do executor antigo reconcilia sem recuperar posse;
- tomada durante partição registra risco de duplicidade;
- credencial ausente no destino impede continuidade;
- remoção da validação de geração deve fazer teste de publicação tardia falhar.

### 26.6 Histórico e privacidade

- filtro “Todos” inclui dispositivos sem duplicar eventos;
- filtro por dispositivo não mistura origem;
- logs brutos nunca entram no RTDB;
- segredo injetado em erro é mascarado;
- consumo parcial permanece parcial;
- ausência de medição aparece como desconhecida, não zero;
- paginação não perde nem reordena itens com timestamps iguais.

### 26.7 Exclusão

- chave desligada oculta botão;
- ligar/desligar não solicita senha;
- senha inválida não apaga;
- senha válida sem confirmação final não apaga;
- arquivos locais permanecem;
- limpeza não deixa cursor afirmando que dados apagados ainda estão sincronizados;
- review ativa impede limpeza inconsistente;
- remover o bloqueio deve fazer uma contraprova demonstrar lease apagado durante execução.

### 26.8 Interface

- desktop e viewport estreito;
- strings longas sem quebra;
- nomes longos de dispositivos;
- muitos aparelhos;
- estados vazios, offline e desconhecidos;
- ações destrutivas sem executá-las em teste visual;
- teclado, foco, contraste e leitores de tela;
- dados remotos vencidos claramente marcados.

## 27. Critérios de aceite por jornada

### Jornada A — Mobile primeiro, computador recebe excesso

1. Administrador configura mobile com prioridade 1 e limite 1.
2. Configura computador com prioridade 2 e limite maior.
3. Duas reviews elegíveis entram na fila.
4. Mobile recebe uma.
5. Computador recebe a outra automaticamente.
6. Ambos mostram executor e progresso das duas.
7. Nenhuma sessão duplicada nasce.

### Jornada B — Mobile não suporta a review

1. Review entra na fila.
2. Preflight cruza peso e capacidade.
3. Mobile é considerado inapto com motivos.
4. Computador é avaliado e recebe a review.
5. A operação registra por que o mobile foi ignorado.
6. Nenhuma interação humana foi necessária.

### Jornada C — Ação remota com celular offline

1. Review está no celular.
2. Celular perde conexão.
3. Administrador envia uma ação.
4. Comando aparece como aguardando celular.
5. Computador não publica usando credencial alheia.
6. Celular retorna, revalida e executa.
7. Todos recebem o recibo e o novo estado.

### Jornada D — Assumir no computador

1. Review está no celular e ele fica indisponível.
2. Administrador solicita tomada no computador.
3. Computador valida credenciais, ferramentas, repositório e capacidade.
4. Farol explica o risco de processo antigo ainda existir.
5. Após lease e confirmação, computador assume.
6. O produto informa se retomou, reaproveitou parcialmente ou reiniciou.
7. Celular antigo não publica resultado ultrapassado ao retornar.

### Jornada E — Limpeza protegida

1. A chave está desligada e não há botão.
2. Administrador liga a chave sem informar senha.
3. Botão aparece.
4. Ao clicar, a UI apresenta escopo e solicita senha Firebase.
5. Senha inválida não altera dados.
6. Senha válida permite confirmação final.
7. Limpeza remove somente dados remotos declarados.
8. Arquivos e logs locais permanecem.
9. Controle retorna ao estado seguro.

### Jornada F — Diagnóstico simples

1. Uma review falha.
2. Falha aparece na lista local pesquisável.
3. Usuário seleciona e copia.
4. Markdown contém contexto suficiente e formatação adequada.
5. Segredos e caminhos sensíveis estão mascarados.
6. Histórico compartilhado informa que houve falha, sem receber o log pessoal.

## 28. Riscos principais e mitigação

| Risco | Consequência | Mitigação |
|---|---|---|
| UID compartilhado não isola dispositivos | secundário comprometido pode escrever diretamente | declarar limite; validar protocolo; considerar identidade forte em evolução |
| Telemetria superestima capacidade | falha e desperdício | margens conservadoras, expiração, calibração e motivos |
| Telemetria subestima capacidade | fila desnecessária | histórico, ajuste de política e diagnóstico |
| Partição de rede durante tomada | consumo duplicado | janela, confirmação, geração e reconciliação |
| Payload de review cresce demais | custo e lentidão no celular | envelope mínimo, paginação, limites e projeções |
| Head muda durante comando | publicação incorreta | `expectedHeadSha` e nova validação local |
| Exclusão durante trabalho | estado inconsistente | bloquear, listar impedimentos e nunca cancelar silenciosamente |
| Reorganização visual esconde funções | regressão operacional | inventário completo, protótipo e testes de jornada |
| História remota vira autoridade indevida | inconsistência com arquivos locais | fontes de verdade explícitas e reconciliação idempotente |

## 29. Métricas de sucesso

Não medir sucesso apenas por “sincronizou”. Medir:

- reviews duplicadas bloqueadas antes do spawn;
- reviews redirecionadas por capacidade;
- tempo em fila por ausência de executor;
- taxa de preflight apto que conclui sem falha de recurso;
- falsos bloqueios de capacidade;
- comandos remotos concluídos, expirados e recusados;
- transferências integrais, parciais e reinícios;
- consumo potencialmente duplicado após tomada;
- divergências de estado reconciliadas;
- payload e download por dispositivo;
- tempo para encontrar e copiar uma falha;
- exclusões abortadas antes do efeito destrutivo.

Métrica não pode ser apresentada como economia garantida sem contrafactual comprovado.

## 30. Pendências conscientes

Estas pendências não impedem a documentação, mas precisam ser fechadas antes das respectivas implementações:

1. conteúdo exato do envelope de decisão publicável;
2. política de retenção do histórico remoto;
3. referência legível do PR versus hash por padrão;
4. limiares iniciais de capacidade para Windows e Android/Termux;
5. janela de segurança para tomada após presença/lease vencido;
6. comportamento quando nenhum dispositivo estiver apto por período prolongado;
7. limite de tamanho e fragmentação do checkpoint remoto;
8. quais ações remotas entram no primeiro release de comandos;
9. definição final da arquitetura de informação após protótipo;
10. significado original de “PF”, caso volte a ser relevante.

## 31. Definição de pronto do conjunto

A iniciativa completa estará pronta somente quando:

1. a sincronização desligada preservar integralmente o comportamento local;
2. dispositivos compartilharem a mesma visão sem duplicar processamento;
3. Panorama, Meus PRs, Precisa de você e revisões recentes estiverem sincronizados;
4. histórico puder ser filtrado por dispositivo;
5. mobile prioritário com limite 1 encaminhar excesso automaticamente ao computador;
6. dispositivo inapto não iniciar provider;
7. credenciais permanecerem exclusivamente locais;
8. comandos remotos tiverem recibos e estados offline honestos;
9. administrador for definido por reautenticação Firebase;
10. secundário não editar políticas pela aplicação normal;
11. tomada ou transferência preservarem checkpoint quando possível e admitirem reinício quando necessário;
12. executor ultrapassado não publicar depois da tomada;
13. logs permanecerem locais;
14. diagnóstico for copiável e exportável em Markdown sanitizado;
15. botão de exclusão nascer oculto, depender da chave e exigir senha no ato;
16. limpeza não apagar dados locais nem ocorrer em estado inconsistente;
17. consumo com erro distinguir medido, parcial e desconhecido;
18. nova navegação funcionar em desktop e celular;
19. testes de concorrência, falha, privacidade e mutação provarem as travas;
20. piloto real em computador e Android/Termux confirmar as jornadas principais.

## 32. Nota para o futuro plano executável

Este documento define intenção, fronteiras e critérios. Ele não deve ser convertido diretamente em uma única tarefa de implementação.

Antes de começar o código:

1. conferir o estado da `main`, porque a sincronização já evoluiu desde o plano de 09/09;
2. mapear as mudanças contra a reorganização estrutural de `ui/` e `server.js`;
3. dividir cada fase em PRs pequenos;
4. nomear interfaces e migrações;
5. escrever primeiro os testes e as contraprovas dos gates;
6. validar Security Rules no Firebase Emulator;
7. desenhar as jornadas completas antes de alterar abas;
8. preservar os rascunhos e históricos anteriores em vez de reescrevê-los retroativamente.

Uma execução verde local não prova sozinha distribuição, segurança, atualização instalada ou jornada real entre dispositivos. Esses estados devem ser evidenciados separadamente.
