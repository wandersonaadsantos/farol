# Operação multidispositivo do Farol: design

**Data:** 15/09/2026
**Estado:** spec guarda-chuva revisada na rodada de correção de consistência de 15/09/2026. É a base do pacote de execução (`docs/superpowers/plans/2026-09-15-operacao-multidispositivo-mestre.md`). Nenhuma linha de código de produção foi escrita.
**Base medida:** `origin/main` em `f80394e` (v2.59.3 mais dois merges de documentação).
**Nome da iniciativa:** operação multidispositivo (ou sincronização v2). Esta spec não fixa número de versão: cada entrega é uma release própria, numerada na hora de publicar pela regra vigente de "Versionamento" do `CLAUDE.md`.

## 0. Como ler

| Documento | Papel |
|---|---|
| Esta spec | **Contrato vigente.** Fonte única das decisões e requisitos da iniciativa |
| `docs/superpowers/specs/2026-09-15-operacao-multidispositivo-anexos/C1-contrato-de-dados.md` | **Anexo normativo:** nós do banco, envelope, chaves, regras, limpeza e contraprovas da C1, com os trechos superados marcados no topo de cada seção |
| `docs/superpowers/specs/2026-09-15-operacao-multidispositivo-anexos/S3-agendador.md` | **Anexo normativo:** ciclo de atribuição, degradação, comandos, modos de falha e contraprovas do agendador, com os trechos superados marcados |
| `docs/superpowers/specs/2026-09-15-operacao-sincronizada-multidispositivo.md` | **Histórico.** Rascunho gerado no Codex, superado por esta spec |
| `docs/superpowers/handoff/2026-09-15-operacao-multidispositivo/HANDOFF.md` e `evidencias/` | **Histórico.** Estado do planejamento e material de origem (mapas, desenhos, críticas, decisões apresentadas) |
| `docs/PLANO-SINCRONIZACAO-DISPOSITIVOS.md` e `docs/superpowers/plans/2026-09-10-sync-00-contrato.md` | Sincronização v1 publicada na v2.59.0 |
| `docs/superpowers/specs/2026-09-14-reorganizacao-estrutural-design.md` | Reorganização estrutural (entregas B0 e B1 desta iniciativa) |

**Regra de referência.** Quando duas entregas dependem do mesmo mecanismo, ele é definido uma vez na seção 5 ("Contratos transversais") com um identificador `CT-*`, e as entregas referenciam o identificador em vez de redesenhar. São dez contratos: CT-COMPAT, CT-FIO, CT-ENV, CT-GRUPO, CT-ADM, CT-ADM-POL, CT-PRONT, CT-POST, CT-RET e CT-LEITURA. Uma entrega que precise mudar um contrato muda o contrato, nunca uma cópia local dele.

**Âncoras de código.** Citações usam o nome da função e, quando útil, a linha em `f80394e`. A Fase 1 da reorganização vai mover código de `ui/`; o nome da função é a referência estável.

---

## 1. Os pedidos e a leitura confirmada

Notas de voz de 14/09/2026, com a leitura confirmada pelo dono.

| Pedido | Leitura confirmada |
|---|---|
| Visão compartilhada do que roda em cada aparelho | Qualquer aparelho vê o andamento dos outros. Ver nunca dispara processamento |
| Configuração em Sistema valendo nos "positivos" | "Positivos" = dispositivos. Políticas definidas num aparelho valem nos outros; quantas revisões simultâneas **por aparelho** |
| Tirar o botão de apagar | O único é "Apagar dados sincronizados", em Sistema > Sincronização. Vira limpeza protegida |
| Tirar "Coordenação agora" | Sai a lista visual; a lógica (lease, recibo, presença) fica |
| Plano e chaves: "em qual PF foi atribuído" e nome do plano | **PF = path.** O perfil padrão passa a mostrar o diretório de config e a ter nome |
| Diagnóstico: copiar, Markdown adequado, menos duplicação | Diagnóstico unificado, falha copiável, Markdown de verdade |
| Salvar o progresso do check do PR no Firebase | Checkpoint compartilhado para outro aparelho retomar |
| Revisões recentes sincronizadas | Revisões recentes **e Panorama**, e também Precisa de você e Meus PRs |
| O Farol retém o log do erro e registra consumo com erro? | Investigação, respondida na seção 4.1 |
| Revisão de design do app inteiro | Redesenho de interface, com reorganização profunda de abas aceita, **vindo obrigatoriamente do Claude Design** |

---

## 2. Decisões registradas

Nenhuma decisão abaixo é reaberta sem evidência nova ou pedido explícito do dono. O detalhe de cada uma está na seção indicada.

### 2.1 Respostas às 12 perguntas iniciais

| # | Tema | Decisão |
|---|---|---|
| 1 | PF | Path |
| 2 | Revisão recente em outro aparelho | O básico bem feito; com D1, o resumo estruturado sobe cifrado |
| 3 | Observar ou agir | Acompanhar e agir |
| 4 | Outro aparelho assumir | Sim, é o ápice da feature, se possível (C7 e C8) |
| 5 | Limite de revisões | Por aparelho, e medir antes de iniciar se o aparelho aguenta (S3-7) |
| 6 | Quem edita capacidade dos outros | Só o aparelho admin, com consentimento local do alvo (D-c) |
| 7 | Configurações globais | Só políticas operacionais. Credenciais, caminhos, autostart, tema e porta ficam locais |
| 8 | Botão de apagar | Sai. Vira chave "permitir limpeza", desligada por padrão; apagar pede a senha do Firebase de novo |
| 9 | Logs | Logs do app não sincronizam |
| 10 | Revisões recentes | História única com filtro por aparelho |
| 11 | Precisa de você e Meus PRs | Entram |
| 12 | Abas | Reorganização profunda aceita |

### 2.2 Decisões de desenho

| ID | Decisão | Onde |
|---|---|---|
| D-a | Capacidade é mecânica; RAM é a causa mais provável de falha no celular | 7.C4 |
| D-b | Ligar a chave de limpeza não pede senha; só o clique em apagar pede | 7.C2 |
| D-c | Consentimento local por aparelho, nunca ligável remotamente | CT-ADM-POL |
| D1 | Conteúdo que sobe vai cifrado ponta a ponta | CT-ENV |
| D2 | Um teto de orçamento para o grupo de consumo, não por aparelho | CT-GRUPO |
| D3 | Todos os aparelhos notificam; um "visto" cala os outros | 7.C3 |
| D4 | Distribuição por agendador com fila global | 7.C5 |
| D5 | Agendador = admin, sem substituto; admin indisponível faz cada aparelho voltar ao modo local coordenado | CT-PRONT |
| D6 | Decomposição em entregas e ordem aprovadas (emendada na seção 6) | 6 |
| D7 | A chave de dados é aberta pela senha do Firebase, sem mínimo de caracteres; a tela pode recomendar senha longa só como texto | CT-ENV |
| D8 | Se o servidor não conseguir conferir senha recente, a limpeza não é publicada | 7.C2 |
| D9 | Todo design de tela vem do Claude Design | 8 |
| D10 | Nada disso afeta quem não liga a sincronização | CT-COMPAT |

### 2.3 Decisões desta rodada

| ID | Escolha | Onde |
|---|---|---|
| Token local | A: allowlist de Host (C1a); autenticação local vira entrega própria e obrigatória (A4), com o mecanismo especificado na própria A4 | 7.C1a, 7.A4 |
| S3-1 | B: grupo de consumo explícito, independente de credencial | CT-GRUPO |
| S3-2 | A: co-assinatura sob coordenação, com arbitragem comum no funil de postagem e protocolo de resultado incerto | CT-POST, 7.C0b |
| S3-3 | D: prontidão do agendador com retirada automática, mais o aviso de candidato esperando e o fallback da D5 | CT-PRONT |
| S3-4 | C: `orgTag` para o rodízio e nome do owner cifrado para apresentação | 7.C5 |
| S3-5 | A: retomada com contexto local não entra na distribuição | CT-RET |
| S3-6 | B: todas as execuções de IA contam; clique pode exceder o paralelismo com confirmação | CT-ADM |
| S3-7 | C: requisitos duros, piso de memória e etapa de medição com encerramento | 7.C4 |
| S3-8 | A: batimento, prontidão e fila entram no stream `live` | CT-LEITURA |
| Afinidade | Adiada para a C7, não cortada | 7.C7 |
| Cortes da síntese | Aprovados com as exceções da seção 9 | 9 |
| Cortes da C1 | Aprovados com as exceções da seção 9 | 9 |
| Memória de pushback | Sincroniza, cifrada, preservando a semântica | 7.C3 |
| Destaques, Kudos e Time | Ficam locais neste escopo | 7.C3 |
| Exportação do consolidado | Fora desta iniciativa | 9 |
| Diagnóstico | Ver renderizado e copiar Markdown, com conteúdo inerte | 7.A3 |

---

## 3. Duas naturezas de mudança

- **Recursos da operação multidispositivo** (visão compartilhada, distribuição, admin, comandos, teto do grupo, avisos cruzados, limpeza): **zero efeito** quando não habilitados. Com um aparelho só, preservam os invariantes operacionais, sem ida ao banco só para colocação local.
- **Melhorias universais** (consumo com erro fiel, falha durável, retomada durável, Plano e chaves explícito, Diagnóstico, autenticação local, allowlist de Host, redesenho): mudam o app de qualquer pessoa, porque são consertos e redesenho.

As duas naturezas têm garantias diferentes, e a lista exata de exceções está em CT-COMPAT (b).

---

## 4. Base medida

Fatos verificados no código por analista e cético independentes e reconferidos contra `f80394e` em três investigações da rodada de correção (postagem, consumo e retomada, sincronização e HTTP). Material de origem, histórico: `evidencias/01-mapa-verificado-dos-pedidos.json`.

### 4.1 Erro e consumo (resposta à investigação do dono)

**Consumo: quase sempre registrado, com buracos.** O registro acontece antes de decidir sucesso ou erro, e sessão morta antes do fim grava o parcial com custo estimado.

1. Codex que falha não registra nada: `turn.failed` monta resultado com uso vazio e custo zero, e `recordUsage` descarta tudo zerado.
2. Resultado recusado fica "ok": envelope fora do contrato, prosa sem JSON, pushback ilegível, autoanálise recusada. Só a autoanálise por commit novo chama `marcarDesfecho`.
3. App fechado no meio perde o consumo inteiro (acumulador em memória). O auto-update recusa aplicar com sessão rodando; o risco real é sair pela bandeja ou queda.
4. Custo "sem-base" entra como zero no teto de orçamento.
5. Suspeita de contagem dobrada do parcial: o acumulador soma cada evento `assistant` sem deduplicar por `message.id`. **Precisa ser medido no stream real antes de corrigir.**

Extras: o id de sessão (`a1`, `s1`...) zera a cada boot (`server.js:254`) e `marcarDesfecho` pega a entrada mais recente com aquele id, então um id reutilizado depois de reinício pode corrigir uma sessão antiga; pushback que falha ou sai ilegível não é marcado e tenta de novo a cada ciclo, com teto só de 2 por ciclo somando todos os PRs, sem teto por PR; correção de desfecho depois de o evento subir é reenviada com o mesmo `eventId`, mas se perde quando a consolidação está desligada ou sem `deviceId` naquele momento, porque o cursor não a pega de novo; a auditoria local põe "sem-base" no balde "medido".

**Log do erro: retido pouco e de forma frágil.** Mensagem cortada em 300 caracteres na origem (`session.js:1015-1016`, e o mesmo corte no Codex); o feed de atividade morre no `finally` da revisão e o stderr só sobrevive dentro da mensagem cortada (o tempo por etapa já é calculado antes do `finally`, em `result.stages`); falha de revisão não vira decisão; o motivo do estacionamento some ao relançar; **Limpar log apaga a única cópia** (`clearLog`); não há ligação entre a linha de consumo com erro, o motivo e o id da sessão do CLI.

### 4.2 Defeitos já publicados na sincronização

- PR bloqueado por recibo de outro aparelho oscila na fila a cada ciclo, com WARN em toda volta (`reconciliarVistos` contra a espera anotada). Pela leitura do código; não reproduzido em execução.
- Rota de configuração descarta campos e a tela diz "salvo".
- Recibo fica pendente para sempre depois de decisão por clique (`decide` não toca o recibo).
- Lease morto continua na tela até o próximo ciclo.
- Selos do Panorama divergem entre aparelhos: `reRequested` sai do histórico local, e um CHANGES_REQUESTED postado por outro aparelho aparece como aprovado.
- A promessa da tela de Sincronização já é imprecisa: sobem em claro o hostname, o head no lease e no recibo, `profileId` e modelo no consumo.
- `syncEraseRemote` apaga `/users/{uid}` inteiro, inclusive leases vivos.

### 4.3 Diagnóstico

- Três superfícies sobrepostas (relatório da IA, export determinístico, log bruto) e dois botões "Limpar" com efeitos diferentes.
- Export é texto, não Markdown estrutural; linhas cruas sem cerca; `@login` vira menção.
- "Diagnóstico com o Claude" roda com permissão irrestrita, o prompt `pr-health.md` manda editar o app, e esse prompt não está na lista ressincronizada do `prepareHome`.
- O triage agrupa por classe, não por episódio, e não devolve as linhas de cada grupo.
- O despejo cru na aba é contrato travado por teste (`test/ui-widgets.test.js`).

### 4.4 API local

- `GET /api/state` e `/api/events` sem autenticação; POST exige só o cabeçalho `x-farol: 1` (`lib/http-server.js:85`); o servidor escuta só `127.0.0.1` (`:200`); não existe verificação de Host.
- Hoje, sem sincronização nenhuma, um app no Android que alcance a porta consegue `POST /api/decide` (`:165`). O modo celular (engine em Termux) já está em uso.
- **Limitação exata de um segredo local:** ele não protege contra um processo que já tenha acesso ao segredo. No PC, qualquer processo do mesmo usuário lê `~/.farol`, então um segredo guardado ali não separa esse processo do app. Isso não amplia o escopo desktop desta iniciativa.

### 4.5 Retomada e fila

- `recoverInflight` (`server.js:371`) move o id de sessão para memória (`retomadaPendente`) e grava `inflight.json` vazio (`:387`). Um segundo reinício antes de o PR reaparecer perde a única referência.
- `writeInflight` (`server.js:410`) grava os itens da fila só com `key`, `url` e `title` (`:415`), sem `retomarSid` nem `knownHead`.
- `retryAfterNet` (`server.js:303`), onde fica o id vindo de falha transitória, é só memória.

### 4.6 Postagem e co-assinatura

- `coAssinar` (`lib/engine/skip-review.js:422`) recebe `head`, mas posta sem `commit_id` (`:425`).
- O recuo de 422 do funil tira a âncora de um APPROVE sem comentário inline (`semAncoraPayload`, `lib/engine/decision.js:767`).
- A aprovação que fundamenta o endosso é filtrada por `!head || !x.commit_id || x.commit_id === head` (`reviewsDeOutros`, `skip-review.js:390`): com head vazio, aprovação de qualquer commit conta, e review sem `commit_id` também conta.
- `postLanes` e `postedReviews` são por processo (`decision.js:671-699`); dois aparelhos com a mesma conta não se enxergam por eles.
- A lista de operações coordenadas é `review`, `self` e `pushback` (`lib/sync/keys.js:11`); a co-assinatura não participa.
- O lease é por conta e PR (`/leases/{conta}/{pr}`), com o tipo de operação no corpo (`lib/sync/lease.js:18,41`); as regras do banco não restringem os valores de `operationKind`, `outcome` nem `publicationState`.
- A via de chat e terminal (`/api/review/post`) não consulta o GitHub antes de postar, ao contrário do que diz o comentário em `decision.js:642`.
- A tabela completa das seis vias está em CT-POST.

### 4.7 Capacidade

- O teto de paralelismo é por conta (`parallelLimit`, `review.js:426-429`) e o teto global nasce desligado.
- Pushback e chat chamam o CLI direto e não se registram como sessão ativa (`pushback.js:239`, `chat.js:91`). Ferramentas se registram, mas não passam pelo escalonador.
- Não existe nenhuma leitura de memória, carga ou disco no repositório.

### 4.8 Outros fatos usados pelo desenho

- Árvore remota de hoje sob `users/{uid}`: `devices`, `leases`, `receipts`, `dailyRounds`, `usageEvents`. Conta e PR sobem como SHA-256 sem sal (`lib/sync/keys.js`).
- O id do perfil do Claude é sorteado no front de cada aparelho e já sobe em todo evento de consumo.
- O login da sincronização é e-mail e senha por REST. Conta com segundo fator é detectada (código `SEGUNDO_FATOR`) e continua sem conectar. A senha nunca é gravada.
- Tamanho atual: `ui/app.js` com 4398 linhas e `ui/pure.js` com 3498.
- `headlessOrg` usa o owner, inclusive de repositório pessoal, e já converte para minúsculas (`review.js:446-449`).

---

## 5. Contratos transversais

### CT-COMPAT: compatibilidade e ativação

**Dois tipos de mudança, com garantias diferentes (seção 3).**

**(a) Recursos da operação multidispositivo: zero efeito quando não habilitados.** Cada um com teste obrigatório:
1. **Sincronização desligada:** nenhuma requisição ao banco, nenhum nó remoto, nenhum arquivo de sincronização novo (`sync-key.json`, `sync-admin.json`, cache de política) depois de boot e ciclo, com `FAROL_HOME` temporário e import dinâmico.
2. **Sincronização ligada e compartilhamento desligado (`sync.shared.enabled` falso, o padrão):** presença, lease, recibo e payload de consumo byte a byte iguais aos de hoje; sem sonda, keyring nem stream `live`.
3. **Distribuição desligada:** `enqueueHeadless` toma o ramo local de hoje e nenhum candidato é publicado.
4. **Nenhum update liga nada.** Todo interruptor novo só liga com `true` explícito, pela tela do próprio aparelho.

**(b) Melhorias universais: mudam o app de todo mundo, por decisão, e cada uma é exceção explícita às garantias acima.**

| Melhoria | Mudança observável com a sincronização desligada |
|---|---|
| A1 consumo fiel e falha durável | arquivo local novo de falhas por sessão e de tentativa interrompida; status de consumo `desconhecido`; id de sessão novo; linhas de erro onde antes havia "ok" |
| A5 retomada durável | `inflight.json` passa a guardar a referência de retomada e os itens da fila com mais campos, e deixa de ser esvaziado antes de a retomada ser consumida |
| A4 autenticação local | no modo que exige autenticação, a API recusa requisição sem credencial; arquivo local de sessões autorizadas |
| C1a allowlist de Host | requisição com Host ou `Origin` fora da lista é recusada |
| A2, A3 e o redesenho | telas e textos mudam |

Nenhuma dessas exceções pode mudar gate de postagem, decisão de revisão ou escrita no GitHub.

**(c) Um aparelho só, com os recursos ligados.** Testes dos invariantes operacionais pertinentes: mesma decisão de revisão, mesmos gates de postagem, mesmo dedup, a própria fila atendida sem esperar outro aparelho, e **nenhuma ida ao banco exclusivamente para colocação local** (o admin que escolhe a si mesmo enfileira sem publicar candidato). Telas e latência não são prometidas idênticas, porque as funcionalidades novas mudam as duas.

**Ativação por versão.** Uma garantia multidispositivo (coordenação da co-assinatura, teto do grupo, distribuição) só é declarada ativa para uma conta ou grupo quando todos os aparelhos que podem executar aquele caminho estão numa versão que participa do protocolo.
- A presença publica a versão do contrato de cada aparelho.
- Aparelho sem batimento recente **não prova que não vai voltar a executar**. Enquanto um aparelho visto com a conta estiver numa versão antiga, a tela declara a garantia como **não coberta** para aquela conta, nomeando o aparelho, em vez de mostrá-la como ativa.
- Aposentar um aparelho é ato explícito (C2), não inferência por ausência.
- Versão antiga continua coordenando revisões por lease como hoje; ela só não é contada como coberta pelos contratos novos.

**Rollback.** Voltar para a versão anterior funciona: as regras v2 aceitam as escritas v1, os nós novos ficam retidos sem uso, os interruptores novos são ignorados pelo saneador antigo e os arquivos novos ficam só em `~/.farol`.

### CT-FIO: o que chega pelo banco só restringe

Campo que chega pelo banco nunca amplia autonomia local.
- `requested` não viaja; o executor o rederiva localmente. Os testes de `shouldAutoApprove` e `shouldAutoReject` passam de `requested === false` para `requested !== true`, para falta de dado barrar.
- Comando ou atribuição remota nunca vira `pr.manual`, nunca desfaz saída de cena e nunca atravessa gate de consciência, checks obrigatórios ou override de coordenação.
- Um teste lê o fonte e proíbe qualquer caminho de atribuição ou comando de escrever `requested` ou `manual`.
- O invariante 4 do `CLAUDE.md` fica intacto: nada é postado sem gate, e o dedup por head continua valendo.

### CT-ENV: cifragem, chaves e identificadores (D1, D7)

Detalhe normativo no anexo C1 (seções "Gestão de chave", "Envelope cifrado" e "Identificadores e migração", com os trechos superados marcados). O que é contrato:

- **Só `node:crypto`.** Nenhuma dependência nova.
- **Material:** `K_id` (32 bytes, chave HMAC dos identificadores, estável por época); `K_enc[gN]` (32 bytes aleatórios por geração, AES-256-GCM, `authTagLength` 16, conferência de 12 bytes de IV e 16 de tag antes de `setAuthTag`); `K_adm` (par Ed25519 que nasce e mora só no admin).
- **KEK:** `scrypt` assíncrono sobre a senha do Firebase, N=16384 r=8 p=5, sal de 16 bytes por embrulho. Sem mínimo de caracteres (D7). Medir no Termux; acima de 3 s, N=8192 r=8 p=10. Parâmetros e sal no embrulho, então mudam sem migração.
- **Keyring** em `users/{uid}/keyring`, criado só depois de `signInWithPassword` bem-sucedido, com CAS por ETag. Keyring sumido depois de visto nunca é recriado sozinho (estado "chave do conjunto perdida", saída explícita com senha).
- **Cache local** em `~/.farol/sync-key.json`, modo 0600 em toda gravação, fora do `config.json` e de `state/`. O boot só lê; a cada conexão confere o `kcv`. Divergência descarta o cache e pede a senha.
- **Envelope** `e1.<kid>.<iv>.<ct>.<tag>`, com AAD em ordem fixa amarrando uid, caminho lógico, campo, geração e esquema, mais os campos extras por nó quando o contrato do nó exigir (por exemplo `orgTag` no candidato, S3-4). Texto claro completado até múltiplo de 256 bytes, sem compressão. Projeções saem das allowlists existentes, nunca de objeto serializado inteiro.
- **Leitura falha fechada:** prefixo, kid, IV, tag, JSON, esquema ou revisão inválidos descartam o item inteiro, que vira "não verificável" no Diagnóstico e fica fora de qualquer decisão, orçamento ou exibição parcial.
- **Identificadores novos:** `tag(domínio, valor) = HMAC-SHA256(K_id, 'farol' NUL 'v2' NUL domínio NUL valor)`, cortado em 32 hex. Domínios: `acct`, `pr`, `org`, `mat` (versão material), `event`, `review`, `pending`. `profileTag` derivado de credencial **não existe** (superado por CT-GRUPO).
- **Coordenação não muda de caminho.** Lease, recibo e rodada continuam em SHA-256 sem sal, porque o caminho é a exclusão mútua entre versões. Com o compartilhamento ligado, o corpo do lease leva `headSha` vazio e o recibo leva `materialVersion` como `h1:` + `tag('mat', versão)`. A tela declara que o commit continua casável por dicionário nesses caminhos.
- **Dado decifrado nunca vira HTML nem destino de execução.** Todo texto decifrado passa pelo escape de sempre; nenhum campo decifrado é usado como comando, caminho, URL ativa sem validação ou seletor.

**Senha, keyring e recuperação.** Recuperar a conta do Firebase e recuperar as chaves de dados são coisas diferentes. A redefinição de senha por e-mail devolve o acesso à conta; ela **não** abre o keyring, que continua embrulhado pela senha antiga.

| Situação | O que acontece | O que o Farol faz |
|---|---|---|
| **Troca de senha, sabendo a atual** | Os refresh tokens de todos os aparelhos expiram. O keyring segue embrulhado pela senha antiga | O primeiro aparelho que entrar com a senha nova e tiver cache válido (`kcv` confere, revisão igual) reembrulha com a senha nova. Sem nenhum cache, pede a senha anterior **uma vez**, localmente, só para abrir o embrulho antigo, e reembrulha |
| **Senha esquecida, com algum aparelho ainda desbloqueado** | A redefinição por e-mail devolve a conta. Os aparelhos perdem a sessão do Firebase, mas o cache local das chaves continua | O cache **não** é apagado quando a credencial do Firebase fica inválida (só "Sair deste aparelho" apaga). Ao entrar com a senha nova num aparelho com cache, ele reembrulha. Os demais aparelhos abrem o embrulho novo com a senha nova |
| **Senha esquecida, sem nenhuma chave recuperável** | A conta volta, o keyring não abre | Estado "chave do conjunto indisponível". O conteúdo cifrado existente é **preservado** e marcado como "cifrado com chave indisponível", nunca apagado. Consumo em claro e coordenação seguem. O dono pode, por ato explícito com a senha nova, **gerar uma época de chave nova** para o conteúdo futuro. O keyring da época antiga é mantido intacto, e se a senha antiga for lembrada ou um aparelho com cache reaparecer, a época antiga volta a abrir |

- **Risco declarado na tela, antes de trocar a senha e ao ligar o compartilhamento:** sem nenhum aparelho desbloqueado e sem a senha antiga, o histórico cifrado fica ilegível para sempre. O Farol não guarda cópia de recuperação da chave (D7 não muda, e nenhuma credencial nova é criada).
- Antes de uma troca de senha feita pelo próprio app, a tela confere se este aparelho está desbloqueado e avisa quando não está.
- Um keyring sumido depois de visto continua nunca sendo recriado sozinho.

### CT-GRUPO: grupo de consumo e orçamento compartilhado (S3-1, D2)

**Identidade.**
- Perfil local e grupo de consumo são identidades diferentes. Cada perfil mantém id e credenciais locais.
- Para participar da operação distribuída, o perfil é associado **explicitamente** a um grupo existente ou a um grupo novo, em todos os tipos de perfil (assinatura, chave de API, OpenRouter, Codex).
- O grupo tem identificador estável e opaco, independente de chave, token, nome do perfil ou caminho de diretório.
- O vínculo serve para contabilizar e aplicar política. Não transfere credencial e não autoriza ação nova.
- **Inferência automática por hash de credencial não é implementada.** O hash reconhece a mesma credencial, mas não resolve chaves diferentes que devem dividir um teto, nem a continuidade depois de rotação.

**Pareamento.**
- Antes de confirmar, a tela mostra o provedor, os perfis e aparelhos participantes e a política de orçamento resultante.
- Nome igual ou caminho parecido não é prova de identidade e não pré-seleciona nada.
- Teto e período de contabilização compartilhados têm definição única no grupo, assinada pelo admin. Limite local adicional pode restringir, nunca ampliar.

**Rotação e mudança de vínculo.**
- Rotacionar a credencial do mesmo vínculo não cria grupo novo nem reinicia a contagem.
- Trocar de conta ou de grupo exige associação explícita.
- O consumo já registrado permanece no grupo em que foi feito, com o intervalo do vínculo gravado. Nada é apagado, duplicado ou reatribuído em silêncio; reatribuição, se algum dia existir, é ato explícito com contagem.

**Sem vínculo não é exceção.**
- Enquanto a identidade estiver indefinida, o perfil não participa da execução distribuída que depende do vínculo.
- Com o teto do grupo ativo, execução que dependa dessa garantia não escapa dele por falta de pareamento e não é redirecionada para execução local para contornar a pendência. O atalho em que o admin enfileira localmente é colocação, não teto: a verificação vale igual no ramo local.
- Com sincronização e teto do grupo desligados, vale o comportamento de hoje.
- Grupo configurado sem teto e perfil não identificado são estados diferentes, com textos e tratamentos diferentes na tela.

**Configurar e ativar são passos separados.**
- **Configurar (C2):** criar o grupo, parear perfis, gravar teto e período assinados. O teto aparece como "configurado, ainda não ativo" e não barra nada.
- **Ativar (C4b):** o teto do grupo passa a barrar execuções. Só é possível quando existem, juntos: consumo confiável (A1, inclusive tentativa interrompida), identidade de grupo (C2), admissão local com reserva (C4) e as duas definições abaixo implementadas. Sem as quatro, a tela não oferece ativar.

**Métrica controlada, por tipo de perfil.**

| Tipo | Métrica do teto | Estado |
|---|---|---|
| Assinatura do Claude (diretório) | custo em dólar medido pelo CLI, ou estimado com base de preço | controlado |
| Chave de API da Anthropic | custo em dólar medido, ou estimado | controlado |
| OpenRouter | custo em dólar medido, ou estimado | controlado |
| Codex | nenhuma: o plano não informa custo por sessão | **não controlado** |

Tipo sem métrica aparece como "não controlado" na tela do grupo, nunca como consumo zero nem como orçamento protegido. Um grupo que mistura tipos controlados e não controlados mostra as duas partes separadas.

**Admissão conjunta.**
- Cada execução admitida em qualquer aparelho do grupo publica uma **reserva** do custo típico (mediana das revisões medidas do grupo) no resumo da admissão local (CT-ADM), até o evento de consumo real chegar.
- A decisão de admitir num aparelho usa: consumo concluído do grupo pela cobertura válida, mais as reservas vivas de todos os aparelhos, mais a reserva da execução candidata.
- A reserva de um aparelho sem resumo fresco continua contando até o TTL, e depois vira "cobertura incompleta" daquele aparelho.
- **Limite declarado:** a reserva é projeção, não teto de gasto máximo. Uma execução pode custar mais que a mediana, e aparelhos que admitem ao mesmo tempo com dados defasados podem passar do teto. A tela chama o teto do grupo de "teto macio" e mostra quanto dele é projeção.

**Cobertura incompleta.**
- O store do grupo mantém, por aparelho participante, até onde o consumo está completo e verificado.
- **Valor desconhecido** (tentativa interrompida sem medição, custo sem base): o evento existe e está contado, mas o valor não. O gate usa a reserva do custo típico no lugar do valor e marca o orçamento como "parcialmente estimado". A tela mostra o item como desconhecido, nunca como zero.
- **Evento inválido rejeitado, lacuna na sequência de eventos de um aparelho ou aparelho sem dados frescos:** a quantidade de consumo é desconhecida naquele trecho. O orçamento do grupo fica "não verificável", e não é mostrado como completo.
- Com o orçamento não verificável, execuções automáticas que dependem do teto do grupo ficam em espera com motivo, sem estacionar. O clique também não atravessa (CT-ADM). As saídas são: a fila de correção da A1 reenviar o trecho, ou o dono desligar o teto do grupo explicitamente, voltando aos tetos locais com aviso.

**Composição do gate.** O gate reusa `profileBudgetStatus`, que é puro, trocando o store em `budgetStatusFor` por um snapshot em memória do grupo, recalculado no ciclo (o gate é síncrono). O store do grupo depende do **banco**, nunca da autoridade do admin nem do distribuidor.

### CT-ADM: admissão local e ocupação (S3-6)

- **Contam:** todas as execuções de IA iniciadas ou geridas pelo Farol enquanto estão efetivamente em execução: revisão, autoanálise, pushback, chat e ferramentas. Conversa salva e sessão encerrada não ocupam vaga.
- **Fora do contrato:** processos de IA que alguém abra por fora do Farol. A sessão de terminal aberta pelo Farol conta enquanto o Farol a considera viva (mesmo registro de `activeReviews`, mesmo teto de 12 h).
- **Reserva antes do provedor.** A admissão local reserva a vaga antes de iniciar o provedor, de forma atômica no processo, para que um clique e uma operação automática concorrentes não usem a mesma vaga. A reserva é liberada em qualquer desfecho (sucesso, erro, cancelamento, recusa antes do provedor).
- **Sem vaga, automático:** a operação fica em espera, sem perder a demanda e sem ser estacionada como falha.
- **Sem vaga, clique:** a tela oferece aguardar, cancelar ou confirmar uma exceção pontual ao limite de paralelismo. A execução que excede também entra na contagem.
- **A confirmação não é autorização genérica.** Não atravessa o piso de memória (C4), autenticação (A4), consentimento, coordenação de postagem (CT-POST) nem orçamento (CT-GRUPO). Não grava bypass permanente.
- **Fonte de verdade:** a admissão local é a autoridade de ocupação do aparelho. Ela mantém três estados por execução (reserva, fila, execução) e publica um resumo mínimo derivado deles (contagem por estado e por tipo de operação, com o id da atribuição quando houver), nunca conteúdo de chat ou ferramenta. É esse resumo que CT-PRONT e CT-GRUPO leem.
- Leases e atribuições sozinhos não contabilizam as execuções que não usam lease; por isso este controle local existe mesmo com o nó remoto de operações vivas cortado.

### CT-ADM-POL: consentimento, autoridade do admin e políticas remotas (D-c)

**Dois sinais do admin, entregues em momentos diferentes.**
- **Autoridade do admin (nasce na C2):** diz qual aparelho é o admin vigente e se ele segue ativo como autoridade. É um batimento de autoridade assinado, publicado pelo admin desde a C2, independente de existir distribuidor.
- **Prontidão do distribuidor (nasce na C5):** diz se o agendador está operacional agora (CT-PRONT).

Políticas dependem só da **autoridade**; distribuição depende da **prontidão**. Antes da C5, as políticas da C2 funcionam com a autoridade, e não existe distribuição.

**Aceitação de uma política.** Exige, todos juntos: `config.sync.aceitarAdmin` ligado **localmente** (só com `true` explícito, pela tela do próprio aparelho; nenhum payload remoto nem leitura do banco contém a chave); assinatura Ed25519 válida da geração vigente; autoridade fresca (abaixo); chaves dentro da allowlist; o mesmo saneador e clamp do consumidor. Política nunca toca gate de postagem, `config.json` ou credencial.

**Valor efetivo: remoto só restringe o local, e a queda nunca amplia.**
- A última política aceita fica em cache local (`~/.farol/sync-policy.json`, modo 0600, fora do `config.json` e de `state/`), com geração e sequência.
- Combinação com a config local, campo a campo: pausa = pausado se qualquer um dos dois pausar; teto de paralelismo = o menor; contas elegíveis e tipos de operação = interseção.
- **Autoridade fresca:** vale a combinação da política aceita mais recente com a config local.
- **Autoridade indisponível, vencida ou ainda desconhecida** (queda do admin, boot, reconexão): continua valendo a mesma combinação com a última política aceita em cache. **A queda do admin nunca remove uma pausa nem amplia um limite.** Uma restrição remota só sai de três formas: política nova válida do admin; o dono desligando `aceitarAdmin` naquele aparelho (ato local explícito, que descarta o cache e volta à config local inteira, com aviso na tela); ou o dono desligando a sincronização naquele aparelho, também ato local explícito.
- Sem cache (aparelho que nunca aceitou política): vale a config local.
- A tela mostra a origem de cada valor efetivo (local, remoto, restrição mantida por autoridade indisponível).

**Frescor de um sinal assinado (vale para a autoridade e para a prontidão de CT-PRONT).**
- Cada publicação carrega uma **sequência** monotônica dentro da geração.
- Um valor recebido no snapshot inicial de uma conexão (primeiro acesso, reinício, reconexão) ou reentregue sem mudança **não prova frescor**, mesmo com assinatura válida. Keep-alive do stream também não.
- Frescor exige observar, depois do início da conexão atual, uma **mudança** para sequência maior que a última vista, medida pelo relógio local do próprio aparelho.
- A maior sequência vista é persistida localmente, então um valor antigo reentregue depois de reinício, com sequência menor ou igual, nunca é aceito como novo.
- Resultado atrasado de um ciclo antigo não renova, porque a sequência dele é menor.
- Vencimento: sem mudança por três intervalos de publicação, contados do último valor fresco.
- Até o primeiro valor fresco, o sinal é **desconhecido**, e vale a regra mais restritiva acima.

**A assinatura não é controle de acesso.** Ela vale contra cliente honesto com defeito e contra versão divergente. O banco não verifica criptografia, e isso fica escrito na tela técnica e num teste.

### CT-PRONT: prontidão do agendador (S3-3, D5)

**Quatro sinais separados, e nenhum substitui o outro:** presença do aparelho (está conectado), autoridade do admin (CT-ADM-POL), prontidão do distribuidor (o agendador está operacional agora) e renovação dos leases das operações.

**Prontidão recente, não sucesso antigo.**
- O admin publica a prontidão, com sequência monotônica, só depois de um ciclo de distribuição **saudável**. A validade segue a regra de frescor de CT-ADM-POL: snapshot inicial, keep-alive, reentrega de valor antigo e resultado atrasado nunca renovam.
- **Inicialização:** o admin não publica nada antes do primeiro ciclo saudável, e cada aparelho trata a prontidão como desconhecida até observar um valor fresco. Desconhecida equivale a indisponível para fins de distribuição.
- **Ciclo saudável** é o que conseguiu ler candidatos, ocupação e políticas, e avaliou todos os registros elegíveis, terminando com cada um atribuído, mantido em espera com motivo conhecido, ou isolado como defeituoso (abaixo).
- **Resultados legítimos, que renovam a prontidão:** fila vazia, falta de vaga, bloqueio de política ou de orçamento, nenhum aparelho apto.
- **Falhas, que não renovam:** exceção, leitura que não conclui, resposta de falha devolvida sem exceção, ciclo que não termina dentro do prazo, estado que impede avaliar ou distribuir. Nenhuma delas é disfarçada de fila vazia ou de sucesso.

**Registro ou publicador defeituoso.**
- A unidade isolada é o **registro que um aparelho publicou** para um candidato, não o PR.
- Um registro defeituoso de um publicador **não invalida o registro válido de outro publicador** do mesmo PR: o candidato segue elegível pelos publicadores válidos.
- Defeitos isoláveis: envelope não verificável, campo fora do contrato, geração de chave desconhecida, dependência consultada indisponível. O registro fica em espera, com motivo, sem derrubar o ciclo.
- **A reavaliação responde à mudança da causa, inclusive no mesmo commit.** Cada defeito guarda a impressão da causa: revisão do registro publicado, geração de chave usada e versão das dependências consultadas (políticas, autoridade, keyring). O registro volta a ser avaliado quando qualquer item dessa impressão muda (o coletor republicou, a chave ficou disponível, a política mudou), sem exigir HEAD novo.
- **Contra repetição inútil:** enquanto a impressão não muda, o registro não é reavaliado a cada ciclo. Para causa externa que a impressão não enxerga (dependência transitória), há revalidação com intervalo crescente e teto de 1 h.
- **Recuperação automática:** quando a causa muda e a reavaliação passa, o registro volta à elegibilidade sem ação humana.
- Problema que compromete a integridade do ciclo inteiro (store de ocupação ilegível, conjunto de políticas não verificável) faz o distribuidor perder a prontidão.

**Prazos.**
- O vencimento é medido sem comparar relógios entre aparelhos (frescor de CT-ADM-POL).
- A tolerância da D5 é de três intervalos de publicação (360 s com publicação a cada 120 s), contados a partir do último valor fresco observado.
- Prazo adicional de detecção no próprio admin: um ciclo que não termina dentro de um intervalo de publicação conta como falha e suspende a renovação. O prazo é do ciclo de distribuição, não da duração de uma revisão de IA.
- Os 360 s **não** são um intervalo mínimo entre trocas de modo. Não existe cooldown nem histerese.
- **Retorno:** o modo distribuído volta, em cada aparelho, quando ele observa uma prontidão fresca.

**Suspensão.**
- Ao perder a prontidão, o admin para de iniciar atribuições e de renovar a prontidão. Não desliga a sincronização, não esconde o aparelho, não altera a autoridade dele e não interrompe revisões saudáveis que mantêm os próprios leases.
- Ciclos e respostas atrasadas não renovam a prontidão nem reativam decisões antigas, porque a sequência e a revisão da atribuição são conferidas.
- **Atribuições enviadas e não aceitas:** têm TTL. Ao vencer sem aceitação, liberam a ocupação provisória e o candidato volta à elegibilidade. Atribuição aceita segue para a admissão local e o lease, que decidem.
- **Troca para o modo local:** o executor descarta atribuições não aceitas; o que já tem reserva ou execução termina onde está.

**Ocupação na recuperação, pelo controle de CT-ADM.**
- A ocupação de cada aparelho vem do **resumo publicado pela admissão local** dele, que distingue três estados: **reserva** (vaga reservada antes do provedor, com o id da atribuição ou da operação local), **fila** (aguardando vaga, não ocupa) e **execução** (provedor iniciado, ocupa).
- O admin soma reserva e execução; fila só informa.
- Atribuição enviada e ainda não aceita conta como ocupação provisória no admin até o TTL. Quando o aparelho a aceita, ela aparece no resumo como reserva com o **id da atribuição**, e o admin deixa de contá-la como provisória. Não há dupla contagem nem omissão na passagem.
- Leases servem de verificação cruzada e para enxergar aparelho em versão antiga, que não publica resumo. Lease de aparelho com resumo fresco não soma de novo.
- Aparelho sem resumo fresco é inapto para atribuição nova; o que ele já roda continua.
- A recuperação exige ciclo saudável novo e reconciliação desse store antes da primeira atribuição. O retorno do timer, sozinho, não comprova recuperação. O admin não reatribui o que já está reservado, em fila local ou em execução.

**Seguidores.** Não elegem outro admin, não assumem distribuição por idade do candidato e aplicam só a condição de fallback da D5. A segurança se mantém enquanto aparelhos diferentes percebem a transição em momentos diferentes, porque a admissão local e o lease continuam sendo as autoridades finais.

**O fallback preserva as garantias.** Modo local coordenado não é sincronização desligada nem retorno irrestrito ao legado: continuam valendo consentimento e restrições de CT-ADM-POL, identidade, limites por aparelho (CT-ADM), coordenação das postagens (CT-POST) e as condições do teto do grupo (CT-GRUPO). Quando uma garantia necessária não pode ser verificada, a operação que depende dela fica em espera.

**Tela.** Distingue "aparelho conectado, distribuidor indisponível" de "aparelho sem presença", e "autoridade do admin indisponível" de "distribuidor indisponível". O aviso de candidato esperando mostra o motivo conhecido e separa espera legítima (sem vaga, orçamento, política, registro em espera) de ausência inexplicada de progresso. O aviso não autoriza bypass.

**Limite declarado.** Este mecanismo não detecta todo erro lógico silencioso. "Não lançou exceção" não é prova de funcionamento correto.

### CT-POST: arbitragem de postagem e resultado incerto (S3-2)

**Por que o controle mora no funil.** Todas as vias que publicam review no GitHub passam por uma função só, `postReview` (`lib/engine/decision.js:690`), que faz o POST em `io.run('gh', ['api', 'repos/.../pulls/N/reviews', ...])` na linha 761 e, no recuo, na 784. Nenhum código do Farol usa `gh pr review` ou `gh pr comment`. Por isso o controle comum mínimo é colocado no funil, com os chamadores passando só o que já sabem (qual via, qual head, se já têm posse), em vez de cada via implementar a própria arbitragem.

**As seis vias, hoje (medido em `f80394e`).**

| Via | Chamada | Adquire posse? | Posse conferida onde | Dedup contra o GitHub | Registro antes do POST | Morte do processo depois do aceite |
|---|---|---|---|---|---|---|
| Revisão automática e re-revisão | `review.js:1438` (APPROVE), `:1481` (REQUEST_CHANGES) | sim, na abertura da sessão | uma vez, antes de chamar o funil (`pararSeLeasePerdido`, `:1437`, `:1480`); **não depois da fila de espera nem antes do recuo** | `myReviewStates` antes; resposta `null` é tratada como "pode seguir" | nenhum item de decisão; só `inflight.json` | a próxima admissão vê review externo e não posta; com `myReviewStates` falhando duas vezes, **posta de novo** |
| Reenvio de postagem que falhou | `decision.js:370` (`retryFailedPosts`) | não | nunca | head e `myReviewStates` antes; `null` pula | a pendência com `postRetry` | a pendência fica; `reconcilePending` resolve no ciclo seguinte |
| Decisão por clique | `decision.js:1033` (`decide`) | não | nunca | head e `myReviewStates` antes; **`null` é tratado como "pode seguir"** | nada | clique repetido antes da reconciliação, com dedup `null`, **posta de novo** |
| Sessão de chat ou terminal | `decision.js:904` (`postReviewFromSession`, rota `/api/review/post`) | não | nunca | **nenhum**: só a capability em memória e a memória de 5 min | nada | depois de reinício, um turno novo pode postar de novo sem dedup no GitHub |
| Co-assinatura | `skip-review.js:425` (`coAssinar`) | não | nunca | `myReviewStates` antes; `null` não posta | nada | no ciclo seguinte vê APPROVED e não posta |

Dentro do funil, depois da espera na fila por processo, a única conferência é a memória `postedReviews` (`decision.js:705-714`). O recuo de 422 (`decision.js:765-784`) refaz normalização e gate de linguagem, mas não posse, head nem dedup, e tira o `commit_id` nos dois ramos (`inlineFallbackPayload` e `semAncoraPayload`). Nenhuma via fora da revisão automática escreve ou atualiza recibo: um recibo `failed` continua `failed` depois de o reenvio ou o clique darem certo.

**O controle comum mínimo (com a coordenação ligada).** O funil executa, para toda tentativa de envio de APPROVE ou REQUEST_CHANGES, em qualquer via:

1. **Posse:** usa o handle da via se ela já tiver um (revisão automática) ou adquire um lease de postagem para a mesma conta e PR (`/leases/{conta}/{pr}`, tipo `post`). É o **mesmo lock** das demais operações; não existe lock separado por via.
2. **Releitura depois da posse:** relê o registro de postagem do head (abaixo) e `myReviewStates` no head. Consultas anteriores à posse não valem. `myReviewStates` indisponível **não autoriza** postar: a tentativa termina como "não enviada, estado desconhecido", com motivo.
3. **Intenção durável antes da rede:** grava o registro de postagem com estado `enviando` (local, atômico, e remoto, no recibo da operação daquele head). Se a gravação remota falhar, não envia.
4. **Última conferência:** imediatamente antes de cada `io.run` que pode alcançar o GitHub, depois de qualquer espera (fila por processo, renovação de token, escrita do arquivo temporário), confere que a posse continua válida com margem até o vencimento. Posse inválida: grava `nao_enviada` (seguro, porque o `io.run` não foi chamado) e para.
5. **Envio e desfecho:** resposta de sucesso grava `confirmada` com o id do review e o `commit_id`. Resposta que prova recusa (422 com corpo de erro do GitHub) grava `recusada`. Timeout, erro de rede, 5xx, morte do processo ou falha ao gravar o desfecho deixam o estado em `enviando`, que na leitura significa **incerto**.
6. **Recuo:** o recuo sem âncora é uma tentativa nova, que repete os passos 3 a 5 com a própria intenção. **Na co-assinatura o recuo sem âncora é proibido.**
7. **Recibo:** o desfecho `confirmada` atualiza o `publicationState` do recibo da operação, em qualquer via.

**Estados do registro de postagem.**

| Estado | Significa | Autoriza nova tentativa? |
|---|---|---|
| (sem registro) | nenhuma tentativa desta intenção | sim, pelos passos acima |
| `nao_enviada` | a tentativa parou antes do `io.run` | sim |
| `enviando` | a tentativa pode ter alcançado a rede | **não**: entra em reconciliação |
| `confirmada` | o GitHub criou o review (id guardado) | não |
| `recusada` | o GitHub recusou o conteúdo | só com payload diferente |

**A fronteira que não pode vazar.** O único caminho que autoriza tentar de novo é um registro `nao_enviada` gravado **antes** do `io.run`, ou nenhum registro. `enviando` nunca é lido como "não enviado", e ausência de recibo final ou lease vencido não autorizam nada sozinhos. Como `enviando` é gravado de forma durável antes do `io.run`, o cenário "GitHub aceitou, processo caiu, recuperação acha envio não realizado" não existe.

**Reconciliação de `enviando`.**
- Automática, no aparelho que tiver posse: procura no GitHub um review meu naquele head com o mesmo veredito, criado depois da intenção. Achou: `confirmada`.
- Só conclui "não publicada" com duas leituras bem-sucedidas da lista de reviews, separadas por pelo menos 60 s e ambas começando pelo menos 60 s depois da intenção, sem review meu naquele head posterior à intenção. Aí grava `nao_enviada` e a via pode tentar de novo com intenção nova.
- Leitura que falha mantém a dúvida. Enquanto ela persistir, nenhum POST sai para aquele head e veredito, e a tela mostra o motivo.
- Qualquer aparelho vê o `enviando` pelo recibo remoto e não posta por cima.

**Garantias e limites.**
- Garante: no máximo uma tentativa em voo por conta, PR e head entre os aparelhos que participam; nenhuma repetição às cegas depois de uma tentativa que pode ter alcançado a rede; posse conferida no último ponto controlável de cada tentativa.
- Não garante exactly-once: entre a última conferência e o pacote sair existe uma janela que nenhum código fecha; a posse pode vencer nela. O que cobre essa janela é o registro `enviando` e a reconciliação, não o lease.
- Aparelho em versão antiga não participa (CT-COMPAT).
- Duas instâncias do Farol no mesmo aparelho e na mesma conta participam como dois aparelhos.

**Com a coordenação desligada:** comportamento de hoje, sem garantia multidispositivo.

**Posse e suspensão.**
- Com a coordenação ligada e indisponível, nenhuma via posta automaticamente, inclusive o admin executando local.
- Aparelho que volta de suspensão não retoma postagem com posse vencida: o passo 4 recusa.
- O bloqueio atinge a tentativa afetada, nunca o app inteiro.

**As vias com o controle comum.**

| Via | Participa da exclusão | Posse conferida | Reconciliação | Limite demonstrado (teste) |
|---|---|---|---|---|
| Revisão automática e re-revisão | sim, com o handle da sessão | antes da fila e no passo 4 de cada tentativa | sim | concorrência com co-assinatura; posse perdida durante a fila |
| Reenvio de postagem que falhou | sim, lease de postagem | passo 4 | sim | reenvio com `enviando` pendente não posta |
| Decisão por clique | sim, lease de postagem | passo 4 | sim | dois cliques em aparelhos diferentes; clique durante revisão automática |
| Sessão de chat ou terminal | sim, lease de postagem | passo 4 | sim, e ganha o dedup no GitHub do passo 2 | chat depois de reinício não duplica |
| Co-assinatura | sim, lease de postagem | passo 4 | sim; recuo sem âncora proibido | todos os critérios da C0b |

A C0b entrega o controle comum no funil e o aplica às cinco vias de uma vez. Nenhuma via é declarada coberta sem o teste da última coluna.

### CT-RET: retomada durável (S3-5)

- **Transição durável** entre retomada pendente, item na fila e tentativa em execução, reaproveitando `inflight.json`, sem janela em que a única referência recuperável desapareça. Vale para a retomada recuperada no boot e para a vinda de falha transitória (`retryAfterNet`).
- A referência sobrevive a reinício enquanto aguarda admissão ou vaga, não só depois que o CLI iniciou. Dois reinícios seguidos antes da retomada não a perdem.
- **Recusa temporária não consome a retomada:** lease, capacidade, orçamento ou indisponibilidade mantêm a referência. Desfecho equivalente já concluído ou invalidação comprovada têm tratamento próprio.
- **Validação antes de reutilizar:** a retomada precisa corresponder ao PR, à versão material e ao contexto local de provedor e perfil que a originou. O grupo de consumo não substitui essa identidade.
- Um HEAD salvo é evidência da tentativa anterior, não confirmação do estado atual quando a consulta ao GitHub falhou. Sem confirmação suficiente, aguarda ou revalida; o bloco "não releia o que já leu" só entra sobre material cuja correspondência foi comprovada.
- HEAD mudou ou contexto não serve: desfecho explícito. Uma revisão nova pode seguir pelas regras normais, sem herdar prova inválida e sem exigir confirmação humana adicional quando a política já permite.
- **Diagnóstico distingue** retomada bem-sucedida, retomada recusada pelo CLI e início de sessão nova. Sessão nova nunca aparece como retomada.
- **Escopo:** cobre `retomarSid` (interrupção e recuperação). Não altera a política própria do `resumeSid` da re-revisão incremental.

### CT-LEITURA: como os aparelhos leem o estado compartilhado (S3-8)

- No máximo duas conexões permanentes por aparelho: o stream de leases (que já existe) e o stream `live` (novo).
- Batimento, prontidão, fila de candidatos, atribuições, políticas, andamento, pendências e vistos chegam pelo `live`.
- Listas grandes (Revisões recentes, Panorama, Meus PRs, corpos) chegam por GET incremental quando um ponteiro muda no `live`. Nenhum nó grande tem stream.
- A UI recebe o estado remoto por eventos SSE dedicados (`sync-live`, `sync-lists`), nunca por `pushState`, que reenvia o snapshot inteiro.
- O Diagnóstico mostra um contador de bytes por stream e por escrita.

---

## 6. Decomposição e ordem

### 6.1 Trilhas

**Trilha A, melhorias para todo mundo**

| # | Entrega | Depende de |
|---|---|---|
| A1 | Consumo fiel, falha durável e tentativa interrompida | nada (a correção do acumulador depende da medição 1 da seção 13) |
| A2 | Plano e chaves explícito | B1, B2 |
| A3 | Diagnóstico unificado | A1, B1, B2 |
| A4 | Autenticação da API local (correção de segurança prioritária) | nada técnico; a exigência automática depende da tela de pareamento (B2) |
| A5 | Retomada durável (CT-RET) | nada |

**Trilha B, fundação**

| # | Entrega | Depende de |
|---|---|---|
| B0 | Reorganização, Fase 0 | nada (conduzida por outra sessão) |
| B1 | Reorganização, Fase 1 (`ui/`) | B0 |
| B2 | Brief e desenho do app inteiro no Claude Design | nada (artefato) |

**Trilha C, operação multidispositivo** (zero efeito quando não habilitada)

| # | Entrega | Depende de |
|---|---|---|
| C0 | Correções da sincronização publicada | nada |
| C0b | Arbitragem de postagem no funil, com a co-assinatura coordenada (CT-POST) | C0 |
| C1a | Allowlist de Host | nada |
| C1 | Contrato de dados v2 e cifragem | C0 |
| C2 | Administração, autoridade, políticas, grupo de consumo (configurar), limpeza protegida | C1 |
| C3 | Visão compartilhada | C1, B1, B2, e A4 para ativar em modo celular |
| C4 | Capacidade, admissão local e medição de memória | C2 |
| C4b | **Ativação do teto do grupo** (D2) | A1, C2, C4 |
| C5 | Agendador, prontidão e fila global | C3, C4, A5, C0b |
| C6 | Comandos remotos | C5 |
| C7 | Checkpoint compartilhado, transferência voluntária e decisão de afinidade | C6, A1 |
| C8 | Tomada forçada | C7 |

**Emendas à D6, declaradas:**
- entram A4, A5, C0b, C1a e C4b;
- A5 sai de dentro da C5 porque beneficia todo mundo e é pré-requisito dela;
- C0b vira entrega própria porque o furo existe hoje, com a coordenação da v2.59 ligada e dois aparelhos na mesma conta;
- C1a sai da C1 porque não depende de cifragem nem do banco;
- C4b separa ativar de configurar o teto do grupo, que só pode barrar execuções com consumo confiável, identidade e admissão conjunta prontos.

### 6.2 Ordem

1. **Primeira onda, independente:** A1, A5, C0, C1a, A4 (sem a exigência automática), B0, B2.
2. **Segunda onda:** C0b; B1 junto com C1.
3. **Onda de telas:** A2, A3, C2, C3, e a tela de pareamento da A4.
4. **Por fim:** C4 → C4b → C5 → C6 → C7 → C8.

**Por quê.** A1 cedo porque teto do grupo, checkpoint e Diagnóstico confiam em consumo e id de sessão que hoje mentem. A4 cedo porque o risco já existe no celular em uso. B1 antes da onda de telas para não pagar duas vezes o conflito com os 21 testes que casam regex em `ui/app.js` e `ui/pure.js`. Uma pendência de entrega futura não bloqueia as independentes.

### 6.3 Condição de liberação da operação no celular

- **Condição de liberação:** a operação no celular não é declarada pronta para uso seguro antes da A4 completa, com a exigência automática ligada. Essa condição é de liberação, e é independente das dependências técnicas de implementação de cada entrega.
- **Consequência concreta:** a C3 coloca no snapshot local conteúdo decifrado de todos os aparelhos, e não é ativável num aparelho em modo celular sem a A4.
- A A4 não depende da C6 e não bloqueia o planejamento nem a implementação das demais entregas.

---

## 7. Entregas

Cada entrega tem plano próprio (`superpowers:writing-plans`) antes de código, gate de qualidade e contraprovas: toda garantia tem uma mutação que faz um teste falhar. Na publicação, cada entrega vira um PR próprio.

### 7.A1 Consumo fiel e falha durável

**Escopo.**
1. **Medir a contagem dobrada antes de corrigir:** capturar o `stream-json` de sessões reais com thinking, texto e tool_use; comparar a soma do acumulador (`acumularParcial`) com a soma deduplicada por `message.id` e com o `usage` do resultado final. Registrar a conclusão; só então corrigir. A medição usa sessões reais do CLI e depende de autorização (seção 13).
2. **Codex com falha registra** a tentativa, com status de medição honesto (sem tokens conhecidos = custo desconhecido).
3. **Resultado recusado vira desfecho de erro** em revisão (`lerResultadoDaRevisao`), autoanálise (`falhaDaAutoanalise`), pushback (resultado ilegível) e ferramenta sem texto, via `marcarDesfecho`.
4. **Custo sem base não entra como zero:** status de custo `desconhecido`, contado à parte, e no gate tratado pela regra de valor desconhecido de CT-GRUPO (reserva do custo típico, orçamento "parcialmente estimado"). O mesmo vale para o orçamento local por perfil.
5. **Id de sessão estável:** id opaco por sessão, único entre boots e aparelhos; o rótulo curto (`a1`, `s1`) fica só para exibição. `marcarDesfecho` passa a achar a sessão pelo id opaco.
6. **Registro local durável de falha por sessão**, fora do `farol.log`: motivo sem o corte de 300 caracteres (com teto próprio e máscara de segredo), classe da taxonomia, id da sessão do CLI, etapa e tempo por etapa até a falha, desfecho da retomada (retomada, recusada pelo CLI, sessão nova), ligado à linha do Consumo e ao card estacionado. Limpar log não o apaga.
7. **Correção de desfecho chega ao banco:** fila de correção por `eventId`, independente do cursor da outbox, que sobrevive à consolidação desligada ou à falta de `deviceId` no momento da correção.
8. **Pushback que falha tem teto por PR** e passa pela taxonomia.
9. **Encerramento abrupto do processo:**
   - Toda sessão de IA gerida pelo Farol abre, antes de iniciar o provedor, um registro de tentativa em arquivo local atômico (`state/usage-tentativas.json`), com id opaco, tipo, conta, perfil, modelo, referência e hora.
   - Durante a sessão, o consumo parcial observado é gravado nesse registro com intervalo mínimo entre gravações e no fim de cada turno.
   - No fechamento normal, o consumo é registrado como hoje e a tentativa sai do arquivo, na mesma operação lógica: primeiro grava o consumo, depois remove a tentativa, e o boot trata tentativa já registrada como concluída pelo id opaco (sem duplicar).
   - No boot, cada tentativa que sobrou vira uma linha de consumo com desfecho novo **`interrompida`**: tokens parciais observados quando houver, custo estimado quando houver base, e custo **desconhecido** quando não houver tokens nem base. A tentativa nunca é apagada nem registrada como zero.
   - **Limite declarado:** no POSIX o processo do provedor é destacado do engine e pode continuar consumindo depois que o engine morre; esse consumo não é observado, e a linha `interrompida` diz isso.

A A5 preserva a referência de retomada; ela não substitui este registro de consumo.

**Critérios de aceite.** Teste para cada item:
- sessão Codex falhando gera linha com custo desconhecido;
- recusa de envelope marca erro nos quatro caminhos;
- sem-base nunca soma zero no gate local;
- dois boots não reutilizam id, e `marcarDesfecho` corrige a sessão certa;
- falha estacionada mostra motivo depois de Limpar log;
- correção posterior ao cursor chega ao fake do banco com a consolidação desligada no momento da correção;
- pushback falhando N vezes para no teto;
- **encerramento abrupto:** processo filho rodando uma sessão com provedor simulado que já emitiu consumo parcial é terminado à força; o boot seguinte, com o mesmo `FAROL_HOME`, registra a linha `interrompida` com os tokens parciais;
- encerramento abrupto antes de qualquer consumo gera linha `interrompida` com custo desconhecido, não zero e não ausência;
- fechamento normal seguido de boot não duplica a linha;
- erro devolvido normalmente pelo CLI continua registrado como hoje.

### 7.A2 Plano e chaves explícito

**Escopo.**
- "Primeira validação" é o ato explícito de testar o perfil, no molde de "Testar leitura" do Jira e "Testar conexão" da Sincronização.
- Perfil materializado nessa validação, com **path** do diretório de config, nome editável e identidade detectada (e-mail do `oauthAccount`, tipo de autenticação). O nome comercial do plano não é exposto porque não é detectável de forma confiável; a tela diz isso.
- Quem já usa sem perfil recebe um cartão guiado com confirmação. Nunca há escrita silenciosa no `config.json`.
- Fim das quedas silenciosas para o legado quando um perfil não resolve (`resolveClaudeAuth`): aviso na tela e check no Diagnóstico.
- Estado de origem de cada informação: detectado, informado, validado, inferido ou desconhecido.
- O vínculo com grupo de consumo mora em CT-GRUPO e é mostrado aqui, não redefinido.

**Critérios de aceite.** Perfil apagado ou override apontando para id inexistente aparece como erro na tela, nunca como "usa o padrão"; o selo atualiza depois do fim da sessão de login; nenhuma validação escreve config sem confirmação.

### 7.A3 Diagnóstico unificado

**Escopo.**
- **Uma visão só:** estado do sistema, falhas locais (do registro durável da A1) e resumo do triage. Os dois botões "Limpar" viram ações com nomes que dizem o efeito.
- **Unidade de cópia:** a falha registrada pela A1, que já traz o episódio da sessão. O triage continua agrupando por classe para o resumo; o contrato dele não muda nesta entrega.
- **Ver e copiar (decisão 10):** a tela renderiza o Markdown; o botão copia a representação textual, nunca o HTML.
- **Conteúdo inerte:** HTML escapado; nenhum script, handler vindo do texto, imagem ou avatar externo carregado automaticamente; nenhuma URL de protocolo perigoso. Link só fica ativo depois da validação aplicável; senão aparece como texto.
- **Menções inertes:** nada dispara consulta, notificação ou publicação. `@login` sai sem virar menção no Markdown copiado.
- **Credenciais e tokens mascarados** na tela e na cópia.
- Visualizar e copiar não executam comando nem enviam o diagnóstico a terceiros.
- **Diagnóstico com IA somente leitura**, alimentado pelo mesmo Markdown, sem permissão de edição; `pr-health.md` entra na lista ressincronizada do `prepareHome`.
- O contrato do despejo cru em `test/ui-widgets.test.js` é renegociado de propósito, com o teste atualizado na mesma tarefa.

**Critérios de aceite.** Testes com texto malicioso (script, `javascript:`, imagem remota, handler inline, token no meio da linha) provando saída inerte e mascarada na tela e na cópia; sessão de diagnóstico sem ferramentas de escrita.

### 7.A4 Autenticação da API local

**Classificação:** correção de segurança prioritária, porque o modo celular já está em uso.

**Requisito.** Proteger leituras sensíveis, ações e eventos em tempo real, pelo inventário de rotas de `lib/http-server.js`. Inventário em `f80394e`: **46 caminhos distintos** (todo POST exige hoje só `x-farol: 1`; nenhum GET é protegido):

| Classe | Rotas |
|---|---|
| Leitura sensível | `GET /api/state` (snapshot inteiro), `/api/chat`, `/api/decision` (relatório), `/api/highlights`, `/api/team`, `/api/log`, `/api/log/triage`, `/api/doctor` (ambiente e caminhos), `/api/sync/consolidated` |
| Leitura de baixo risco, a confirmar no plano | `/api/deliveries`, `/api/reviewer-candidates` |
| Evento em tempo real | `/api/events` (SSE com estado, chat e atividade) |
| Ação que recebe segredo | `/api/jira/credential`, `/api/sync/login` |
| Ação que posta ou escreve no GitHub | `/api/decide`, `/api/review/post`, `/api/self-review/merge`, `/api/self-review/reviewers` |
| Ação que abre sessão paga | `/api/review`, `/api/self-review`, `/api/chat/send`, `/api/tool` |
| Ação destrutiva | `/api/sync/erase-remote`, `/api/log/clear`, `/api/team/remove` |
| Demais ações | `/api/check`, `/api/jira/credential/remove`, `/api/jira/test`, `/api/sync/logout`, `/api/sync/test`, `/api/sync/redo`, `/api/sync/consolidate`, `/api/claude-login`, `/api/self-review/visibility`, `/api/self-review/cancel`, `/api/pr/hide`, `/api/pr/unhide`, `/api/ignore`, `/api/restore`, `/api/settings` (que devolve a config inteira), `/api/pushback`, `/api/tool/clear`, `/api/cancel`, `/api/session-exit`, `/api/update`, `/api/chat/stop` |

Rota nova sem classe reprova num teste que compara o inventário com as rotas do servidor.

**Mecanismo.**

1. **Quem exige.** O servidor decide pelo modo de execução, nunca pelo User-Agent. O modo celular é detectado por qualquer um destes sinais do próprio processo: `process.platform === 'android'` (Node nativo do Termux); variáveis de ambiente do Termux (`TERMUX_VERSION`, ou `PREFIX` sob `/data/data/com.termux`); ou kernel Android em `/proc/sys/kernel/osrelease`, que cobre o proot, onde o ambiente do Termux pode não chegar. Um sinal basta. A config `localAuth: 'exigir'` pode ligar a exigência em qualquer ambiente, e nenhuma config desliga a exigência no modo celular detectado. A detecção é validada num Termux real (seção 13).
2. **Credencial: sem cookie.** Depois do pareamento, o servidor devolve no corpo da resposta um token de sessão de 32 bytes aleatórios. A página guarda o token em `localStorage` e o envia no cabeçalho `Authorization: Bearer` em toda chamada.
   - **Por que isso responde à RFC 6265, seção 8.5:** cookie não é isolado por porta, então outro processo servindo em outra porta de `127.0.0.1` receberia o cookie do navegador. `localStorage` é isolado por **origem**, que inclui esquema, host e porta: uma página servida por outro processo em outra porta é outra origem e não lê o token; uma página de site externo também não; um site com DNS rebinding é outra origem e, além disso, a allowlist de Host recusa o pedido dele.
   - O SSE deixa de usar `EventSource`, que não aceita cabeçalho, e passa a ler o stream com `fetch` e o mesmo cabeçalho. O token nunca vai em URL.
3. **Pareamento, sem segredo em HTML, log ou URL persistente.**
   - O código é gerado por um comando local no terminal do próprio aparelho (`node tools/farol-parear.js`), que imprime o código só na saída do terminal. Ele nunca passa por `engine.log`, `farol.log`, `state/spawns.log` nem pela linha de comando de outro processo.
   - O arquivo de pareamentos (`~/.farol/local-auth/pareamentos.json`, 0600) guarda só o hash do código com sal, a validade e o contador de tentativas.
   - Código de 10 caracteres base32, válido por 10 minutos, **de uso único**, invalidado depois de 5 tentativas erradas.
   - A página de pareamento envia o código em `POST /api/auth/pair` (com `x-farol` e allowlist de Host) e recebe o token.
   - O HTML, o JavaScript e o CSS da interface continuam públicos e sem segredo nenhum.
4. **Sessões, expiração, revogação e reinício.**
   - O servidor guarda só o hash de cada token em `~/.farol/local-auth/sessoes.json` (0600), com criação, último uso e um rótulo descritivo.
   - Expiração: 30 dias sem uso ou 90 dias desde a criação.
   - Revogação: `node tools/farol-parear.js --revogar-todas` apaga todas as sessões e códigos; a tela de revogação individual vem com o desenho.
   - Reinício: sessões e códigos válidos sobrevivem, porque estão em disco; o token no navegador continua valendo.
5. **Rotas no modo que exige.** Todo `/api/*` exige `Authorization` válido, exceto `POST /api/auth/pair` e `GET /api/auth/status`, que devolve só se a autenticação é exigida e se a requisição está autenticada.
6. **Funciona com a sincronização desligada**, porque não depende dela.
7. **Fora do modo que exige** (desktop), nada muda.

**Limites declarados.**
- O token não protege contra processo que já tenha acesso a ele. No celular, isso inclui um app com acesso de acessibilidade ou root; no desktop, qualquer processo do mesmo usuário. O escopo desta entrega é o modo celular.
- Uma falha de escape na própria interface (XSS) exporia o token; o Diagnóstico inerte (A3) e o escape de sempre são a defesa.

**Condição de ativação.** A exigência automática no modo celular só é ligada quando a tela de pareamento existir, vinda do Claude Design (D9). Antes disso, ligar a exigência trancaria o usuário para fora da interface. O motor, o comando de pareamento, as rotas e o transporte autenticado podem ser implementados e testados antes, com a exigência automática desligada por uma constante verificada em teste.

**Critérios de aceite.**
- no modo que exige, requisição sem credencial não recebe estado, relatório, log, chat nem evento SSE, e não executa ação (um teste por classe do inventário);
- o segredo não aparece em log, HTML, snapshot, URL nem linha de comando;
- o código de pareamento não funciona duas vezes, nem depois do prazo, nem depois de 5 erros;
- o modo é decidido no servidor mesmo com User-Agent forjado;
- sessão sobrevive a reinício e some depois da revogação;
- um servidor de teste em outra porta de `127.0.0.1` não obtém o token pelo navegador (teste do transporte: nenhum cookie é emitido e o token só sai no corpo da resposta de pareamento);
- rota nova sem classe reprova.

### 7.A5 Retomada durável

Implementa CT-RET.

**Critérios de aceite.** Retomada local válida; recusa antes do provedor sem sessão iniciada e sem consumir a retomada; referência preservada durante espera por vaga e por lease; dois reinícios antes da retomada; operação equivalente concluída em outro aparelho (não retoma); HEAD alterado ou não confirmado; contexto local ausente ou incompatível; fallback permitido para sessão nova sem herança indevida; diagnóstico distinguindo retomada, recusa do CLI e sessão nova.

### 7.C0 Correções da sincronização publicada

**Escopo, com a causa medida de cada defeito:**

1. **PR bloqueado por recibo oscila na fila.** `reconciliarVistos` (`server.js:553-573`) trata "visto sem decisão local" como revisão que caiu, e não conhece o visto por recibo (`registrarRecibo`, `lib/sync/coordinator.js:78-89`). O PR volta à fila, é admitido, esbarra no mesmo recibo e loga WARN a cada ciclo. **Correção:** `reconciliarVistos` não devolve à fila chave vista por recibo; o conjunto de recibos vistos passa a ser persistido, para não haver WARN nem depois de reinício.
2. **Rota de configuração descarta `ignoradas`.** `lib/http-server.js:168` joga fora o retorno de `updateSettings`, então os ramos de erro de `saveSync`, do mapa de settings e dos sites do Jira em `ui/app.js` nunca rodam e a tela sempre diz "salvo". **Correção:** a rota devolve o resultado inteiro de `updateSettings` junto da config, e os três handlers passam a mostrar o que foi ignorado.
3. **Recibo fica `pending` depois de postagem fora da revisão automática.** `decide`, `retryFailedPosts` e o ramo `already_reviewed` nunca atualizam o recibo; outro aparelho pode oferecer "Refazer" pago para um PR já postado, e a linha diz "pendente lá" até para recibo `published`. **Correção:** função única que atualiza o `publicationState` do recibo do head com CAS por ETag, chamada nos três pontos; a linha do recibo passa a mostrar o `publicationState` real. (A C0b passa a chamar a mesma função a partir do funil, para todas as vias.)
4. **Lease vencido fica na tela.** A visão só é recalculada por evento do stream ou pelo ciclo; lease de aparelho que morreu não gera evento. **Correção:** um timer agendado para o menor `expiresAt` visível recalcula a visão, limpo ao fechar o stream. O teste que hoje trava o comportamento "sai no tick seguinte" é atualizado de propósito.
5. **Selos do Panorama divergem.** `reRequested` vem do histórico local, e `reviewedByMe` sem estado vira "aprovado" em qualquer aparelho que não postou. **Correção:** o selo passa a usar o último estado decisivo meu no head vindo do GitHub (`staleInfo[key].lastState`, que já é buscado e não chega à UI), e o histórico local fica só como complemento do aparelho que postou.
6. **Frase de privacidade da tela de Sincronização e do `firebase/README.md`.** Hoje promete que o repositório nunca é enviado, mas o SHA do commit sobe em claro no lease e no recibo (e leva direto ao repositório público), o nome do aparelho sobe como hostname, `profileId` e modelo sobem no consumo. **Correção:** texto novo listando o que sobe em claro, o que sobe como resumo sem chave e o que nunca sai.

**Critérios de aceite.** Um teste de ciclo inteiro por defeito (dois `check()` seguidos, não uma chamada só): o PR bloqueado por recibo não volta à fila nem loga WARN no segundo ciclo, nem depois de reinício; `/api/settings` com campo inválido devolve `ignoradas` e a tela mostra; `decide` com postagem ok deixa o recibo `published` no fake do banco; lease vencido some da visão sem ciclo; um CHANGES_REQUESTED postado por outro aparelho aparece como "aguardando o autor"; o texto da tela e do README bate com os campos em claro de `buildLease`, `buildReceipt`, presença e `payloadFor`, num teste que lê os três lados.

### 7.C0b Arbitragem de postagem no funil, com a co-assinatura coordenada

Implementa CT-POST inteiro: o controle comum no funil `postReview`, aplicado às cinco vias, e as regras próprias da co-assinatura, que continua opt-in.

**Gates próprios da co-assinatura, preservados:** opt-in local, identidade e token corretos, restrição de autoridade e CODEOWNERS (`autoridadeNaSaida`), aprovação válida da pessoa que fundamentou a saída de cena.

**Endosso ancorado no commit.**
- A aprovação que fundamenta o endosso precisa ser **no mesmo SHA**. O filtro de `reviewsDeOutros` deixa de aceitar head vazio ou review sem `commit_id` como prova. Falta de informação não autoriza a postagem.
- A elegibilidade é confirmada depois de adquirir a posse, antes do envio (passo 2 de CT-POST).
- A postagem carrega explicitamente o `commit_id` confirmado. Nenhuma tentativa nem recuo remove a âncora ou a troca pelo HEAD mais recente: nesta via o recuo sem âncora é proibido.
- HEAD mudou: o endosso anterior não autoriza aprovar o novo commit. Isso é desfecho explícito e reavaliação, nunca fallback.
- A co-assinatura não é revisão fictícia: sem envelope fabricado para `shouldAutoApprove` e sem contabilizar como sessão de IA.
- Co-assinatura que não saiu por dedup grava a marca de concluída, para não consultar o GitHub a cada ciclo.

**Demais vias.** A revisão automática passa o handle da sessão ao funil; reenvio, clique e chat ou terminal adquirem o lease de postagem. A via de chat e terminal ganha o dedup contra o GitHub que hoje não tem. Um desfecho `nao_enviada` por posse perdida é devolvido à revisão automática como perda de coordenação, nunca como falha de rede, para o reenvio automático não postar sem lease.

**Compatibilidade.** Versão antiga que coordena revisões por lease mas posta por fora não participa. A garantia só é declarada para uma conta quando todos os aparelhos que podem postar por ela estão numa versão que participa (CT-COMPAT).

**Critérios de aceite.**
- duas co-assinaturas concorrentes em dois aparelhos simulados geram um único POST;
- co-assinatura concorrendo com revisão normal gera um único POST;
- HEAD mudando entre a conferência e o POST não aprova o commit novo;
- recuo sem âncora na co-assinatura não é tentado;
- publicação aceita seguida de queda antes de gravar o desfecho: o registro fica `enviando`, a recuperação não posta de novo, e a reconciliação acha o review e grava `confirmada`;
- queda na fronteira: `enviando` gravado e processo encerrado antes do `io.run`: a recuperação não trata como não enviado, e só conclui `nao_enviada` com as duas leituras da regra de reconciliação;
- perda de lease durante a espera na fila por processo: o `io.run` não é chamado;
- perda de lease e retomada depois de suspensão: o aparelho não posta com posse vencida;
- reenvio automático com `enviando` pendente não posta;
- dois cliques em aparelhos diferentes e clique durante revisão automática: um único POST;
- chat depois de reinício não duplica review já publicado;
- `myReviewStates` indisponível não autoriza postagem em nenhuma via;
- convivência com versão antiga: a tela declara a conta como não coberta;
- coordenação desligada: comportamento de hoje, byte a byte nas chamadas ao `gh`.

### 7.C1a Allowlist de Host

**Escopo.**
- Validação central antes do atendimento de qualquer rota, cobrindo leituras, SSE, POST e arquivos estáticos.
- Hosts locais explicitamente permitidos (`127.0.0.1` e `localhost`) com a porta efetivamente usada pelo servidor, sem curinga.
- Proteções existentes mantidas: `x-farol` nos POST e a capability de postagem das sessões.
- `Origin`: requisição com `Origin` presente e diferente de `http://127.0.0.1:<porta>` ou `http://localhost:<porta>` é recusada; ausência de `Origin` (navegação direta, Electron, `curl` local) é aceita. Nenhum cabeçalho CORS de permissão é emitido, então nenhuma origem externa ganha leitura.
- **Host permitido não é autenticação** de um aplicativo local; isso é a A4.

**Critérios de aceite.** Host inválido recebe 403 sem estado, sem SSE e sem executar ação, com um teste por classe do inventário da A4; `Origin` externo recebe 403; a janela do Electron e o navegador do próprio aparelho continuam funcionando (teste com o `Host` e o `Origin` que cada um envia); o servidor ouvindo em porta configurada diferente da padrão aceita a porta efetiva e recusa a padrão.

### 7.C1 Contrato de dados v2 e cifragem

**Escopo.**
- CT-ENV implementado: keyring, cache, envelope, identificadores, interruptor `sync.shared.enabled`, desbloqueio de aparelho logado antes da feature (rota de desbloqueio), sonda de regras e o ciclo de recuperação de senha e chaves.
- Regras v2 (seção 10), geradas por macro com teste byte a byte.
- Remoção do apagão (`syncEraseRemote`, a rota e o botão).
- Frase da tela reescrita (seção 11).

**Critérios de aceite.** As contraprovas do anexo C1 (seção 0), com os itens de emulador no roteiro manual; as três situações de recuperação de senha e chaves de CT-ENV em teste com fake do banco e fake de identidade; cache de chave preservado quando a credencial do Firebase fica inválida.

### 7.C2 Administração, políticas, grupo de consumo e limpeza protegida

**Escopo.**
- Tornar **este** aparelho admin por reautenticação com a senha real do Firebase. Designação remota entra com os comandos (C6).
- Consentimento local e políticas por aparelho (CT-ADM-POL): prioridade, teto 1 a 4, pausa, contas elegíveis por tag, tipos de operação.
- Grupo de consumo **configurado** (CT-GRUPO): criação, pareamento, teto e período assinados, exibidos como "configurado, ainda não ativo". A ativação é a C4b.
- Gestão de aparelho: renomear, aposentar (ato explícito, nunca inferido por ausência).
- **Limpeza protegida:** chave desligada por padrão; ligar não pede senha (D-b); o clique em apagar pede a senha; LIMPA exige login por senha recente conferido pelo servidor, chave ligada e nenhuma operação viva. Keyring, controle, leases, recibos e rodadas nunca entram na limpeza. Se o servidor não conseguir conferir senha recente, **a limpeza não é publicada** (D8), e a saída documentada é o console do Firebase.
- **Revogação de acesso**, separando três coisas: revogação de acesso ao Firebase (troca de senha, que expira refresh tokens; o ID token já emitido vale até 1 h), autorização do aparelho (aposentar e retirar o consentimento local) e cancelamento de processos de IA (só pelo próprio aparelho, ou por comando na C6). A tela documenta o procedimento disponível, os limites e quando cada passo passa a valer. **Não promete cancelamento imediato nem remoção de dados e chaves que o aparelho já recebeu.** O botão "encerrar sessões dos outros aparelhos" fica fora.

**Critérios de aceite.** Os da síntese (senha inválida não troca admin, geração +1, assinatura, opt-in local) e: política assinada com `aceitarAdmin` falso não muda nada; perfil sem vínculo não entra na execução distribuída; rotação de credencial não zera a contagem; mudança de vínculo preserva histórico; limpeza sem prova de senha recente não é publicada.

### 7.C3 Visão compartilhada

**Escopo.**
- Andamento ao vivo (etapa, tempo por etapa, subagentes, modelo, aparelho) no card de análise, pelo `live`, publicado só quando existe outro aparelho v2 visto nas últimas 24 h.
- Panorama, Meus PRs e Precisa de você (visível; ação só no aparelho dono até a C6).
- Revisões recentes em história única com filtro por aparelho; catálogo cifrado de PR para nomear qualquer PR em qualquer aparelho.
- Avisos: todos os aparelhos notificam; um visto em qualquer um cala os outros (D3).
- **Sai "Coordenação agora"** só depois que o card do PR e o andamento ao vivo mostram recibo pendente e recuperação.
- **Envio do histórico local existente:** ato explícito, cifrado e restrito às categorias autorizadas. Antes da confirmação a tela mostra o conteúdo abrangido e o **tamanho medido** (a estimativa de cerca de 25 MB não é garantia). O envio retoma depois de interrupção e não duplica registros se repetido. Nunca inclui credencial, configuração inteira ou histórico bruto do CLI.
- **Memória de pushback sincronizada:**
  - só registros confirmados, cifrados, preservando origem, identidade e escopo;
  - "confirmado automaticamente" e "confirmado por mim" continuam distinguíveis;
  - precedência da decisão manual mantida;
  - correções e invalidações se propagam, e nenhum aparelho ressuscita registro corrigido ou retirado;
  - o mesmo registro recebido de novo não vira segunda evidência de recorrência;
  - conflito não resolvido não é combinado em silêncio como concordância;
  - a memória calibra só tom e postura, nunca autoriza postagem nem substitui gate;
  - marcadores locais de scan e retry não sincronizam.
- **Destaques, Kudos e Time ficam locais**, e a tela diz isso, sem prometer memória unificada.
- **Retenção declarada:** a tela e a documentação dizem o que é preservado, onde, e quais limites existem. A sincronização não é apresentada como backup.

**Depende de decisão do dono:** retenção da autoanálise sincronizada (seção 16). O restante da C3 não depende dela.

**Critérios de aceite.** Sem outro aparelho v2, zero escritas de andamento e Panorama; eventos de UI por SSE dedicado e zero `pushState` vindo do remoto; filtro "Todos" sem duplicar; envio de histórico interrompido e repetido sem duplicata; pushback corrigido num aparelho não volta no outro; visto em A cala B; C3 não ativável em modo celular sem A4.

### 7.C4 Capacidade, admissão local e medição

**Escopo.**
- CT-ADM implementado (reserva antes do provedor, espera sem estacionar, exceção de clique).
- **Requisitos duros, recusando desde o primeiro dia:** presença vencida, aparelho como root, provedor não pronto para o perfil da conta, versão sem o contrato, aparelho pausado, aparelho sem vaga.
- **Piso de memória** para iniciar qualquer sessão:
  - a spec do plano define a métrica disponível em cada ambiente (por exemplo `/proc/meminfo`, `os.freemem`, `process.availableMemory`), a margem adotada e o escopo em que o piso foi validado;
  - reavaliado antes de iniciar, considerando execuções e admissões já existentes;
  - **medição indisponível é estado desconhecido, não memória suficiente**;
  - o piso protege contra iniciar numa condição já insuficiente; não comprova que qualquer PR cabe nem elimina encerramento pelo sistema operacional.
- **Etapa de medição com encerramento:** observar o consumo real de memória dos processos relevantes (engine, CLI, subagentes) em execuções reais e testar se o peso do PR é preditor útil. Se não for, registrar a conclusão e propor regra sustentada pelos dados. Critério de encerramento definido no plano da C4 (quantidade mínima de execuções medidas por ambiente e o teste estatístico usado). Não se inventa correlação para cumprir a entrega.
- Peso do PR só ordena enquanto a medição não concluir.

**Critérios de aceite.** Três atribuições de três contas num aparelho com teto 1 abrem uma sessão; clique e automático concorrentes não usam a mesma vaga; exceção de clique não atravessa o piso; medição indisponível não admite; espera por vaga não estaciona.

### 7.C4b Ativação do teto do grupo

**Escopo.** Liga o gate do teto do grupo (D2) sobre o que C2 configurou, com a métrica por tipo de perfil, a admissão conjunta e o tratamento de cobertura incompleta de CT-GRUPO.

**Critérios de aceite.**
- o consumo de B no mesmo grupo barra a admissão em A;
- reservas vivas de três aparelhos admitindo ao mesmo tempo são somadas;
- evento de valor desconhecido usa a reserva e marca "parcialmente estimado";
- evento inválido ou lacuna deixa o orçamento "não verificável" e segura as execuções automáticas dependentes, sem estacionar, e o clique também;
- Codex aparece como "não controlado";
- rotação de credencial não zera a contagem;
- a tela não oferece ativar sem A1, C2 e C4 presentes.

### 7.C5 Agendador, prontidão e fila global

**Papéis.**
- **Coletor** por conta, em todo aparelho: o `check()` de hoje sem uma linha a menos. Publica ponteiro de candidato, nunca o PR.
- **Credencial pela modelagem:** os executores possíveis de um PR são os aparelhos que publicaram aquele candidato, e só publica quem tem token e passou pelos gates.
- **Agendador** = admin (D5): a escolha de ordem de `proximoHeadless` refeita como função pura sobre tags; depois a escolha de aparelho, também pura. Quando o escolhido é o próprio admin, enfileira local sem passar pelo banco.
- **Executor:** confere consentimento, assinatura, geração, prontidão, head e token, e chama `enqueueHeadless` pelo ramo local. O lease continua sendo a autoridade final.

**Candidato (ponteiro).**
- Campos: identificador do item, `prTag` e caminho de coordenação do PR, `acctTag`, `orgTag`, nome do owner cifrado, tag da versão material, rascunho, rodada automática, publicação e TTL.
- **Não viajam:** `requested` (CT-FIO), peso, estacionamento, texto legível.
- **Head protegido e verificável:** o candidato leva `tag('mat', head)`. O executor calcula a tag do head atual e compara com a atribuída; se não bater, recusa com código. Nunca presume que o HEAD atual é o atribuído.
- Candidatos do mesmo PR e versão material de aparelhos diferentes são um item com vários publicadores.

**Org do candidato (S3-4).**
- `orgTag = tag('org', owner normalizado)`, com a mesma normalização de `headlessOrg` (owner, inclusive pessoal, em minúsculas). Mesmo owner produz o mesmo tag entre aparelhos e contas da mesma malha. Não é derivado por aparelho, perfil ou grupo.
- Usa `K_id` e o versionamento da CT-ENV. Rotação segue a CT-ENV sem dividir uma org em grupos independentes: `K_id` não gira em rotação comum.
- **Nome do owner cifrado é apresentação, não autoridade:** não decide elegibilidade, prioridade, credencial, orçamento ou postagem. O envelope amarra o nome ao caminho do candidato e ao `orgTag` na AAD; texto cifrado transplantado de outro candidato não é aceito.
- Nome indisponível com ponteiro válido: rótulo genérico e o rodízio segue pelo tag. Adulteração ou falha de integridade do ponteiro segue a rejeição do contrato, nunca vira "sem nome".
- Texto decifrado nunca vira HTML nem destino de execução.
- Autorizado só o nome do owner. Repositório, URL ou outros campos não entram por estarem cifráveis. O nome não aparece em claro em caminho, índice, log remoto ou dado associado. A tela registra que o tag permite correlacionar candidatos da mesma org e que outros metadados operacionais continuam observáveis; não há promessa de anonimato.

**Ciclo.** Publicar, fundir, escolher qual (rodízio), escolher onde, atribuir com TTL, aceitar ou recusar com código, executar, fechar.
- **Atribuição recusada, expirada ou não iniciada** libera a reserva correspondente e mantém ou devolve o candidato à elegibilidade, com proteção contra resposta atrasada (geração e revisão). Isso não migra sessão viva nem redistribui o que já roda.
- A recusa carrega a espera conhecida (saída de cena, sem token, head mudou, orçamento com a virada do dia, sem vaga, inapto), e o agendador a respeita.
- Três correções obrigatórias: `requested` não viaja; o desvio em `enqueueHeadless` acontece antes de consumir a retomada (CT-RET: item com retomada não é publicado); `enqueueHeadless` passa a devolver desfecho em vez de recusar em silêncio, e o round automático deixa de queimar a âncora na publicação.
- **Retomada fora da distribuição (S3-5):** o item com retomada fica no aparelho que consegue executá-la, **sem privilégios**: não recebe `pr.manual`, não desfaz saída de cena, não atravessa gates, e conta na ocupação (CT-ADM), no orçamento (CT-GRUPO) e na coordenação. Ficar fora da escolha de aparelho não reserva o PR para esse aparelho: o lease decide. Disputar e não obter o lease antes do início não abre sessão de IA nem conta como sessão iniciada. Quando o aparelho original volta, verifica recibo e resultado equivalente, além do lease; se outro aparelho já concluiu, não retoma só porque o lease ficou livre. Perda de posse depois de sessão iniciada segue o contrato de interrupção e reconciliação, sem se misturar com recusa de admissão. **Custo aceito neste corte:** o trabalho parcial no aparelho indisponível mais uma análise completa em outro aparelho sem aquele contexto.
- **Distribuição exige coordenação:** o saneador zera a distribuição quando a coordenação não está ligada.
- Prontidão e fallback: CT-PRONT. Leitura: CT-LEITURA.
- Volta ao modo local: relógio curto no seguidor, recálculo sobre a fila já coletada com guarda contra concorrência com o ciclo, jitter por aparelho e teto de lançamentos por virada; classe nova de rate limit do GitHub na taxonomia como transitória.

**Critérios de aceite.** As contraprovas do anexo S3 mais os de CT-PRONT (exceção só no distribuidor com presença ativa; falha devolvida sem exceção; ciclo que nunca termina depois de um sucesso; inicialização; fila vazia; bloqueio legítimo de orçamento e capacidade; falha isolada de candidato; resultado atrasado depois de suspensão; retorno com trabalho local em andamento; alternância entre falha e recuperação) e os da S3-4 (mesma org agrupada entre aparelhos e contas, inclusive caixa e owner pessoal; rodízio equivalente ao atual independente do nome; ausência do nome em claro no registro remoto; rejeição de troca ou adulteração do metadado entre candidatos; funcionamento com rótulo indisponível).

### 7.C6 Comandos remotos

**Escopo.** Cancelar, repetir, decidir e postar, iniciar em outro aparelho, designar outro admin.
- Forma: identificador, alvo, tipo, argumentos, emissão, TTL, geração e assinatura; idempotente pelo identificador, com recibo de desfecho.
- Aplicação só com consentimento local, assinatura, geração e autoridade fresca. Sem as quatro, o comando é ignorado e o recibo diz por quê.
- Comando nunca vira `pr.manual` (CT-FIO).
- **Decidir e postar** é roteado ao aparelho dono da pendência e passa por CT-POST.
- Executor offline: comando fica pendente; ao voltar, revalida estado, head e posse antes de agir.
- Sucesso só aparece depois do recibo do executor.

**Critérios de aceite.**
- comando duplicado produz um efeito; remover a idempotência faz a contraprova repetir o efeito;
- comando expirado não executa;
- comando para head antigo é recusado;
- executor offline mantém o estado pendente, e ao reconectar revalida antes de executar;
- sucesso só aparece depois do recibo;
- comando sem consentimento local, com assinatura inválida ou geração antiga é ignorado com recibo explicando;
- comando nunca produz `requested` nem `manual` (teste de fonte);
- "decidir e postar" com o executor offline: nenhum outro aparelho posta com credencial alheia;
- designação remota de admin exige a senha digitada no aparelho de destino.

### 7.C7 Checkpoint compartilhado, transferência voluntária e afinidade

**Escopo.**
- Checkpoint de verificação compartilhado, cifrado, com lojas `review` e `self` separadas, entrada inválida falhando fechada, alimentando o gate de postagem só com entradas verificáveis.
- Transferência voluntária entre aparelhos aptos, com retomada integral, parcial ou reinício declarado.
- **Decisão de afinidade:** preferência temporária pelo aparelho com contexto local, com limite de tempo e sem reserva indefinida de PR para aparelho indisponível, decidida com os dados de quantas vezes a troca de dono acontece de verdade (medição da seção 13).

**Critérios de aceite.**
- transferência só ocorre para destino apto;
- checkpoint de outro head não é retomado integralmente;
- entrada de checkpoint inválida ou não decifrável não entra no gate;
- lojas `review` e `self` nunca se misturam;
- credencial ausente no destino impede a continuidade;
- a operação registra se retomou, reaproveitou parcialmente ou reiniciou;
- afinidade nunca reserva o PR para aparelho sem presença além do limite de tempo.

### 7.C8 Tomada forçada

**Escopo.** Lease sucessor, janela de segurança, confirmação de risco, bloqueio de publicação tardia por geração, reconciliação do executor antigo e evidência de possível consumo duplicado. Sem promessa de exactly-once.

**Critérios de aceite.**
- lease antigo não remove o lease sucessor;
- executor antigo não publica depois da tomada; remover a validação de geração faz o teste de publicação tardia falhar;
- retorno do executor antigo reconcilia sem recuperar a posse;
- tomada durante partição registra o risco de duplicidade na tela e no histórico;
- o computador explica o risco de o processo antigo ainda existir antes de confirmar;
- o aparelho antigo não publica resultado ultrapassado ao retornar.

---

## 8. Brief do Claude Design (B2)

Todo layout, arquitetura de abas e estado visual vem do Claude Design antes do HTML (D9). Esta spec descreve estados e dados, não layout.

**Insumos obrigatórios do brief:**
- Inventário de telas atuais e dos problemas medidos: nomes divergentes das ferramentas do Diagnóstico, dois botões Limpar, Plano e chaves com descrição de assinatura enquanto a tela configura chave, OpenRouter e Codex, a promessa de privacidade imprecisa e as lacunas de `docs/superpowers/specs/2026-09-12-clareza-do-que-acontece-fora-do-app-mapeamento.md`.
- Restrições do celular (tela estreita, navegador do aparelho, conexão instável).
- Dados reais, sem conteúdo de colegas inventado.

**Estados que precisam existir no desenho:** desktop largo e celular estreito; primeiro aparelho e vários; admin e secundário; aparelho conectado com distribuidor indisponível e aparelho sem presença; candidato esperando com motivo e sem progresso inexplicado; fila vazia e sem executor apto; revisão local e remota; retomada, recusa do CLI e sessão nova; comando pendente; transferência e tomada; autenticação local exigida e pareamento; sincronização degradada; garantia "não coberta" por aparelho em versão antiga; perfil sem vínculo, grupo sem teto e teto não controlado; postagem com resultado incerto; histórico volumoso; falha copiável; chave de limpeza desligada, ligada e bloqueada; o que é local (Destaques, Kudos, Time) e o que é compartilhado.

---

## 9. Cortes e exceções

### 9.1 Cortes aprovados da síntese do agendador

Fora desta iniciativa: teto global de simultâneas do conjunto; peso do PR no ponteiro e devolução mecânica por peso; migração de sessão viva; eleição de agendador; fila com payload; gate de consciência no admin; postagem centralizada; memória de rodízio persistida; `seen`, estacionamento e retry como escrita mútua; nó remoto próprio de operações vivas; cão de guarda nos seguidores; histerese.

**Exceções que ficam, porque sustentam garantias aprovadas:**
- O **controle local de ocupação** (CT-ADM) fica, mesmo sem o nó remoto de operações vivas.
- O **tratamento mecânico** de atribuições recusadas, expiradas ou não iniciadas fica (7.C5).
- Cortar a postagem centralizada **não** retira a coordenação das vias conflitantes (CT-POST).
- Adiar o peso do PR no ponteiro **não** elimina a etapa de medição (7.C4).
- Cortar o teto global do conjunto **não** retira a consideração de trabalho já admitido ou em andamento na D2 (CT-GRUPO, admissão conjunta).

### 9.2 Cortes da C1

- **Eventos de consumo antigos:** sem migração automática para formato ou chave nova. Ficam identificados como **legado**, com período e cobertura do consolidado explícitos. A mudança não zera orçamento vigente, não duplica consumo e não apresenta total parcial como completo. O plano da C1 define o corte de contabilização e o tratamento do legado. Proteção retroativa não é atribuída a dado não migrado.
- **Encerrar sessões de outros aparelhos:** fora deste corte; a revogação disponível e seus limites ficam documentados (7.C2).
- **Designar outro aparelho como admin:** só o próprio na C2; remoto na C6.
- **Histórico local:** envio explícito, cifrado, com tamanho medido, retomável e idempotente (7.C3).
- **Nome do aparelho:** rótulo neutro em claro, nome escolhido cifrado.
- **Aparelho antigo:** fica sob CT-GRUPO (fora da execução distribuída que depende do grupo) e CT-COMPAT (não apresentado como coberto por orçamento ou coordenação de postagem enquanto executar caminhos fora dos contratos).

### 9.3 Fora desta iniciativa

- **Exportação local do consolidado.** Isso não autoriza apresentar a sincronização como backup nem prometer retenção irrestrita.
- Destaques, Kudos e Time sincronizados.
- Chat sincronizado.
- Prova por arquivo compartilhada.
- Migração dos caminhos de coordenação para tags (entrega futura própria, com corte decidido pelo servidor; não decidido).

---

## 10. Modelo de dados remoto e regras

Detalhe normativo por nó no anexo C1 (seções "Nós do banco" e "Estratégia de regras"). Resumo:

| Nó | Conteúdo | Escritor | Retenção |
|---|---|---|---|
| `keyring` | chaves embrulhadas | aparelho com login recente | permanente, fora da limpeza |
| `live/control/admin`, `beat`, `cleanup`, `cleanupLock`, `lastCleanup` | admin, autoridade do admin (C2), prontidão do distribuidor (C5), chave e trava de limpeza | admin | sobrescrito |
| `devices/{id}` | presença (com contrato e prontidão da chave) | o próprio aparelho | só limpeza remove |
| `live/deviceStatus/{id}` | capacidade resumida e resumo da admissão local, cifrados | o próprio aparelho | sobrescrito |
| `live/devicePolicies/{id}` | política assinada, cifrada | admin | sobrescrito |
| `live/groups/{grupo}` | teto e período do grupo, assinados, cifrados | admin | permanente |
| `live/queue`, `live/assignments` | candidatos e atribuições (7.C5) | coletores e admin | TTL |
| `live/operations/{op}` | andamento, cifrado | executor | TTL curto |
| `live/pending/{item}`, `live/seen/{item}` | Precisa de você e vistos | dono da pendência; qualquer aparelho | enquanto aberta; 30 dias |
| `catalog/{prTag}` | nome do PR, cifrado | quem conhece o PR | regenerável |
| `recentReviews`, `reviewBodies` | índice e corpo das revisões, cifrados | aparelho que revisou | permanente, write-once por versão |
| `panorama`, `myPrs` | projeções por conta, cifradas | publicador por CAS | regenerável |
| `pushbacks/{registro}` | memória confirmada, cifrada | aparelho que confirmou | versões, com invalidação |
| `usageEvents`, `usageDaily` | consumo por sessão e rollup | outbox do aparelho | permanente |
| `leases`, `receipts`, `dailyRounds` | coordenação v1, validações byte a byte as de hoje | v1 e v2 | por protocolo, fora da limpeza |
| `rulesProbe/v2/{id}` | sonda de regras | cliente v2 | sobrescrito |

**Regras.** Raiz só com leitura; uma concessão de escrita por registro; remoção sempre como cláusula explícita; nós legados com validações byte a byte; nada novo dependente de PATCH multi-caminho; índices em nó fixo. Publicação **uma vez**, manual, pelo dono, com sonda que detecta regra velha.

**Gates de emulador e projeto real antes de publicar:** `auth_time` (entrar, esperar 6 min, renovar, tentar gravar admin: 401; login novo: 200), operador `*`, `.length`, `matches` com classes, `child()` dinâmico, PATCH v1 literal (variante A ou B do consumo).

---

## 11. Privacidade e frase da tela

Com o compartilhamento ligado, a tela diz, sem prometer mais:
- **o que sobe cifrado:** títulos, endereços e autores de PR (no catálogo), relatórios e resumos, andamento, Panorama, Meus PRs, Precisa de você, políticas, grupos, nome do aparelho, nome do owner no candidato, memória de pushback confirmada;
- **o que qualquer cópia do banco enxerga:** horários, custos e tokens por sessão, quantidade e tamanho aproximado dos itens, qual aparelho fez cada coisa, correlação entre itens da mesma org e do mesmo PR pelos tags;
- **o que a coordenação expõe:** conta, PR e commit por resumo sem chave, descobríveis testando nomes conhecidos; aparelhos em versão antiga continuam enviando nome da máquina e commit;
- **contra quem a cifra não protege:** quem sabe a senha ou controla o e-mail da conta, o Google (que recebe a senha no login), quem tem acesso a um aparelho seu;
- **o que nunca sai do aparelho:** logs, prompts, chats, saída de terminal, credenciais, caminhos de arquivo, Destaques, Kudos e Time;
- **o que a sincronização não é:** backup.

Título e autor de PR são dados de colegas. Eles só sobem cifrados, e a tela nomeia isso.

---

## 12. Custo e banda (estimativa, não medição)

- Conexões: no máximo 2 por aparelho (6 de 100 no Spark com 3 aparelhos).
- Cerca de 2 MB/dia típico e 15 MB/dia no pior caso por aparelho; cerca de 180 MB/mês com 3 aparelhos (2% dos 10 GB do Spark).
- Armazenamento sem apagar: cerca de 100 MB/ano.
- **Medição obrigatória antes de ligar no celular:** 24 h com dois aparelhos, com contador de bytes por stream e por escrita no Diagnóstico.

---

## 13. Medições e validações externas obrigatórias

Nenhuma delas é declarada comprovada por teste simulado.

| Medição ou validação | Precisa de | Antes de |
|---|---|---|
| Contagem dobrada no stream real | sessões reais do CLI do Claude (autorização de uso da assinatura) | corrigir o acumulador (A1, item 1) |
| `auth_time`, operador `*`, `.length`, `matches`, `child()` dinâmico, PATCH v1 | emulador do Firebase (Java e `firebase-tools`) **e** um projeto real | publicar regras v2 (C1) |
| Tempo do `scrypt` | Termux real | release da C1 |
| Detecção do modo celular e alcance de outros apps ao loopback | Termux e proot reais | ligar a exigência automática da A4 |
| 24 h de banda com dois aparelhos | dois aparelhos reais com o compartilhamento ligado | ligar compartilhamento no celular (C3) |
| Memória real dos processos e utilidade do peso do PR | Termux e desktop reais | ligar recusa por peso (C4) |
| Atraso do consumo entre aparelhos | dois aparelhos reais | ativar o teto do grupo (C4b) |
| Latência de publicação até sessão aberta | dois aparelhos reais | declarar a distribuição (C5) |
| Frequência real de troca de dono no mesmo head | operação real da C5 e da C6 | decidir afinidade e checkpoint compartilhado (C7) |

---

## 14. Riscos residuais declarados

- O Google recebe a senha a cada login e pode derivar a KEK (D1 com senha do Firebase).
- Quem sabe a senha ou controla o e-mail tem controle total: abre a chave, vira admin e limpa.
- Aparelho comprometido ou cópia de `~/.farol` abre o conteúdo das gerações em cache; rotação protege só o futuro.
- Senha fraca cai em ataque offline ao keyring, mesmo com `scrypt` (D7 não impõe mínimo).
- `deviceId` não é credencial: quem tem só o refresh token consegue apagar itens de exibição, sobrescrever projeções com lixo detectável e apagar lease vivo, como hoje.
- Coordenação em SHA-256 sem sal continua descobrível por dicionário.
- O teto do grupo é macio: a reserva é projeção, não gasto máximo, e aparelhos com dados defasados podem passar do teto.
- A prontidão do agendador não detecta erro lógico silencioso.
- A postagem não é exactly-once; é no máximo uma tentativa por intenção, com reconciliação explícita.
- O piso de memória não impede encerramento pelo sistema operacional.
- O alcance de outros apps ao loopback no Android não foi verificado em execução.
- O comportamento do Spark ao estourar a cota é desconhecido.

---

## 15. Regras de trabalho

- `CLAUDE.md` inteiro vale: invariantes, versionamento contra a release publicada, checklist de release.
- Nenhuma atribuição de IA em commit, PR ou release.
- Nunca push direto na `main`: branch, PR, CI verde, merge.
- Gate antes de entregar: `npm run check && npm run lint && npm test`, e `npm run eng` antes do push.
- Nenhuma dependência nova.
- Nada toca `~/.farol` real, GitHub ou Firebase sem pedido.
- Um PR por entrega; nenhuma entrega de reorganização mistura correção de comportamento.

---

## 16. Decisões pendentes do dono

Só decisões de produto que o código, os testes ou a investigação não resolvem. Nenhuma bloqueia as entregas que não dependem dela.

| Decisão | Consequência de cada saída | Recomendação | Entregas que dependem |
|---|---|---|---|
| **Retenção da autoanálise sincronizada** | Permanente, write-once por versão: histórico completo de pareceres em todos os aparelhos, cerca de 48 KB por versão no teto do envelope, e nenhuma remoção fora da limpeza protegida. Removível depois de o PR fechar (por exemplo 30 dias): menos armazenamento, mas o parecer some dos outros aparelhos e abre uma exceção à regra de retenção das revisões | Permanente, pelo mesmo tratamento das revisões | C3 (só a parte de Meus PRs com autoanálise) |

**Fora da iniciativa, com limite registrado:** migração dos caminhos de coordenação (lease, recibo e rodada) para identificadores com chave. Enquanto não existir, conta, PR e commit continuam descobríveis por dicionário nesses caminhos, e a tela diz isso (seção 11).

---

## 17. Pronto do conjunto

A iniciativa está pronta quando:

1. CT-COMPAT se sustenta com teste: recursos não habilitados sem efeito, exceções universais só as listadas, um aparelho só com os invariantes operacionais, nenhum update liga nada.
2. Toda garantia declarada ativa na tela está coberta para todos os aparelhos que podem executar aquele caminho.
3. A4 completa, com a exigência automática ligada, antes de a operação no celular ser declarada pronta.
4. Com a coordenação ligada, todas as vias de postagem seguem CT-POST pelo funil, e a co-assinatura aprova só o commit que fundamentou o endosso.
5. **D2 entregue:** teto do grupo ativo (C4b) com métrica por tipo de perfil, admissão conjunta e cobertura incompleta tratada; tipos sem métrica suportada explicitamente não controlados. Uma release parcial pode sair com o teto do grupo não ativo, dizendo isso na tela, mas isso não conclui a D2.
6. Aparelhos veem o andamento uns dos outros sem duplicar processamento.
7. O excesso do celular vai ao computador sem interação e sem abrir sessão num aparelho inapto.
8. Retomada, recusa do CLI e sessão nova são distinguíveis, e a retomada sobrevive a reinícios.
9. Consumo com erro distingue medido, estimado, desconhecido e interrompido, inclusive depois de encerramento abrupto; Diagnóstico copiável, inerte e mascarado.
10. Nenhum dado local é apagado pela limpeza, e a limpeza não existe sem prova de senha recente conferida pelo servidor.
11. O ciclo de recuperação de senha e chaves de CT-ENV funciona nas três situações, com o risco declarado.
12. Todas as medições e validações da seção 13 feitas, com os números registrados.
