# Operação multidispositivo do Farol: design

**Data:** 15/09/2026
**Estado:** spec guarda-chuva escrita a partir das decisões do dono; aguardando a revisão dele. Nenhuma linha de código de produção foi escrita, e nenhum plano de execução existe ainda.
**Base medida:** `origin/main` em `f80394e` (v2.59.3 mais dois merges de documentação).
**Nome da iniciativa:** operação multidispositivo (ou sincronização v2). Esta spec não fixa número de versão: cada entrega é uma release própria, numerada na hora de publicar pela regra vigente de "Versionamento" do `CLAUDE.md`.

## 0. Como ler

| Documento | Papel |
|---|---|
| Esta spec | Fonte única das decisões e requisitos da iniciativa |
| `docs/superpowers/specs/2026-09-15-operacao-sincronizada-multidispositivo.md` | Rascunho gerado no Codex. **Superado por esta spec** onde divergirem; mantido como histórico |
| `docs/superpowers/handoff/2026-09-15-operacao-multidispositivo/HANDOFF.md` e `evidencias/` | Estado do planejamento e material de origem (mapas, desenhos, críticas) |
| `docs/PLANO-SINCRONIZACAO-DISPOSITIVOS.md` e `docs/superpowers/plans/2026-09-10-sync-00-contrato.md` | Sincronização v1 publicada na v2.59.0 |
| `docs/superpowers/specs/2026-09-14-reorganizacao-estrutural-design.md` | Reorganização estrutural (entregas B0 e B1 desta iniciativa) |

**Regra de referência.** Quando duas entregas dependem do mesmo mecanismo, ele é definido uma vez na seção 5 ("Contratos transversais") com um identificador `CT-*`, e as entregas referenciam o identificador em vez de redesenhar. Uma entrega que precise mudar um contrato muda o contrato, nunca uma cópia local dele.

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
| Token local | A: allowlist de Host na C1; autenticação local vira entrega própria e obrigatória (A4); mecanismo ainda a especificar | 7.C1, 7.A4 |
| S3-1 | B: grupo de consumo explícito, independente de credencial | CT-GRUPO |
| S3-2 | A: co-assinatura sob coordenação, com protocolo de resultado incerto | CT-POST, 7.C0b |
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

- **Recursos da sincronização** (visão compartilhada, distribuição, admin, comandos, teto do grupo, avisos cruzados, limpeza): **zero efeito** com a sincronização desligada, e comportamento de hoje com um aparelho só.
- **Melhorias para todo mundo** (consumo com erro fiel, falha durável, retomada durável, Plano e chaves explícito, Diagnóstico, autenticação local, redesenho): mudam o app de qualquer pessoa, porque são consertos e redesenho.

---

## 4. Base medida

Fatos verificados no código por analista e cético independentes, reconferidos contra `f80394e`. Detalhe em `evidencias/01-mapa-verificado-dos-pedidos.json`.

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
- O lease é por conta e PR (`/leases/{conta}/{pr}`), com o tipo de operação no corpo (`lib/sync/lease.js:18,41`).

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

**Garantias, cada uma com teste obrigatório:**

1. **Sincronização desligada = comportamento de hoje.** Com `FAROL_HOME` temporário e import dinâmico: zero requisição de rede nova e nenhum arquivo novo depois de boot e ciclo. A allowlist de Host (C1) é a única mudança observável, e ela só recusa Host fora da lista.
2. **Sincronização ligada, compartilhamento desligado (`sync.shared.enabled` falso, o padrão) = rede de hoje.** Presença, lease, recibo e payload de consumo byte a byte iguais aos de hoje.
3. **Um aparelho só, com tudo ligado = revisão, gates, fila e telas de hoje**, inclusive em latência (o admin que escolhe a si mesmo enfileira local).
4. **Nenhum update liga nada.** Todo interruptor novo só liga com `true` explícito, pela tela do próprio aparelho.

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

Detalhe completo em `evidencias/02-c1-contrato-dados-cifragem.json`, campos `gestao_de_chave`, `envelope_cifrado` e `identificadores_e_migracao`. O que é contrato:

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
- Toda mudança de vínculo tem regra escrita para o histórico: o consumo já registrado permanece no grupo em que foi feito, com o intervalo do vínculo gravado. Nada é apagado, duplicado ou reatribuído em silêncio; reatribuição, se algum dia existir, é ato explícito com contagem.

**Sem vínculo não é exceção.**
- Enquanto a identidade estiver indefinida, o perfil não participa da execução distribuída que depende do vínculo.
- Com o teto do grupo ligado, execução que dependa dessa garantia não escapa dele por falta de pareamento e não é redirecionada para execução local para contornar a pendência. O atalho em que o admin enfileira localmente é colocação, não teto: a verificação vale igual no ramo local.
- Com sincronização e teto do grupo desligados, vale o comportamento de hoje.
- Grupo configurado sem teto e perfil não identificado são estados diferentes, com textos e tratamentos diferentes na tela.

**Composição do gate.** O gate reusa `profileBudgetStatus`, que é puro, trocando o store em `budgetStatusFor` por um snapshot em memória do grupo, recalculado no ciclo (o gate é síncrono). O store do grupo depende do **banco**, nunca do admin.

**Lacunas registradas; a D2 não é declarada entregue sem elas:**
1. **Métrica controlada por tipo de perfil.** Unificar identidade não faz o teto funcionar onde `profileBudgetStatus` hoje o ignora, como no ramo do Codex. A entrega que ligar o teto do grupo define, por tipo de perfil, qual métrica é controlada (custo, tokens ou nenhuma). Métrica indisponível aparece como "não controlado" e nunca como consumo zero ou orçamento protegido.
2. **Admissão conjunta.** A entrega define como o controle considera execuções já admitidas e em andamento, atraso da sincronização e indisponibilidade do banco. Somar consumo concluído não garante admissão conjunta, e projeção de custo (mediana) não é garantia de gasto máximo. A tela declara o teto como macio na medida em que ele for.

### CT-ADM: admissão local e ocupação (S3-6)

- **Contam:** todas as execuções de IA iniciadas ou geridas pelo Farol enquanto estão efetivamente em execução: revisão, autoanálise, pushback, chat e ferramentas. Conversa salva e sessão encerrada não ocupam vaga.
- **Fora do contrato:** processos de IA que alguém abra por fora do Farol. A sessão de terminal aberta pelo Farol conta enquanto o Farol a considera viva (mesmo registro de `activeReviews`, mesmo teto de 12 h).
- **Reserva antes do provedor.** A admissão local reserva a vaga antes de iniciar o provedor, de forma atômica no processo, para que um clique e uma operação automática concorrentes não usem a mesma vaga. A reserva é liberada em qualquer desfecho (sucesso, erro, cancelamento, recusa antes do provedor).
- **Sem vaga, automático:** a operação fica em espera, sem perder a demanda e sem ser estacionada como falha.
- **Sem vaga, clique:** a tela oferece aguardar, cancelar ou confirmar uma exceção pontual ao limite de paralelismo. A execução que excede também entra na contagem.
- **A confirmação não é autorização genérica.** Não atravessa o piso de memória (C4), autenticação (A4), consentimento, coordenação de postagem (CT-POST) nem orçamento (CT-GRUPO). Não grava bypass permanente.
- **Fonte de verdade:** a admissão local é a autoridade de ocupação do aparelho. O admin pode receber um resumo mínimo derivado dela (quantas vagas ocupadas, por tipo de operação), nunca conteúdo de chat ou ferramenta.
- Leases e atribuições sozinhos não contabilizam as execuções que não usam lease; por isso este controle local existe mesmo com o nó remoto de operações vivas cortado.

### CT-ADM-POL: consentimento e políticas remotas (D-c)

- Uma política vinda do admin só é aplicada com `config.sync.aceitarAdmin` ligado **localmente**, assinatura Ed25519 válida da geração vigente, prontidão do admin válida (CT-PRONT), chaves dentro da allowlist e o mesmo saneador e clamp do consumidor.
- `aceitarAdmin` só liga com `true` explícito, pela tela do próprio aparelho. Nenhum payload remoto nem leitura do banco contém a chave.
- Política nunca toca gate de postagem, `config.json` ou credencial. O valor efetivo fica em memória, com origem visível na tela.
- A assinatura vale contra cliente honesto com defeito e contra versão divergente. **Ela não é controle de acesso:** o banco não verifica criptografia, e isso fica escrito na tela técnica e num teste.

### CT-PRONT: prontidão do agendador (S3-3, D5)

**Três sinais separados:** presença do aparelho (está conectado), prontidão do agendador (o distribuidor está operacional agora) e renovação dos leases das operações. Nenhum substitui o outro.

**Prontidão recente, não sucesso antigo.**
- O admin publica a prontidão só depois de um ciclo de distribuição **saudável**, com validade limitada. A inicialização não assume sucesso antes da primeira verificação válida.
- **Ciclo saudável** é o que conseguiu ler candidatos, ocupação e políticas, e avaliou todos os itens, terminando com cada item atribuído, mantido em espera com motivo conhecido, ou isolado como defeituoso (abaixo).
- **Resultados legítimos, que renovam a prontidão:** fila vazia, falta de vaga, bloqueio de política ou de orçamento, nenhum aparelho apto.
- **Falhas, que não renovam:** exceção, leitura que não conclui, resposta de falha devolvida sem exceção, ciclo que não termina dentro do prazo, estado que impede avaliar ou distribuir. Nenhuma delas é disfarçada de fila vazia.
- **Fronteira do candidato defeituoso:** problema isolável num candidato (dado ilegível, envelope não verificável, publicador inconsistente) fica nesse candidato, com motivo, e o ciclo segue. Um item defeituoso não pode paralisar os demais indefinidamente: depois de falhar em ciclos consecutivos, ele sai da avaliação até mudar de versão material, com motivo visível. Se o problema compromete a integridade do ciclo (store de ocupação ilegível, políticas não verificáveis), o distribuidor perde a prontidão.

**Prazos.**
- O vencimento é medido sem comparar relógios entre aparelhos: cada aparelho mede há quanto tempo vê **o mesmo valor** de prontidão, com o próprio relógio. O valor muda a cada ciclo saudável e carrega a geração, então resultado atrasado de ciclo antigo não renova.
- A tolerância da D5 (três intervalos de publicação, 360 s com publicação a cada 120 s) é contada a partir da última prontidão válida observada.
- Prazo adicional de detecção no próprio admin: um ciclo que não termina em um intervalo de publicação conta como falha e suspende a renovação. O prazo é do ciclo de distribuição, não da duração de uma revisão de IA.
- Os 360 s **não** são um intervalo mínimo entre trocas de modo. Não existe cooldown nem histerese.
- **Retorno:** o modo distribuído volta quando cada aparelho observa uma prontidão nova e válida.

**Suspensão.**
- Ao perder prontidão, o admin para de iniciar atribuições e de renovar a prontidão. Não desliga a sincronização, não esconde o aparelho e não interrompe revisões saudáveis que mantêm os próprios leases.
- Ciclos e respostas atrasadas não renovam a prontidão nem reativam decisões antigas porque terminaram depois (conferência de geração e de revisão da atribuição).
- **Atribuições enviadas e não confirmadas:** cada atribuição tem TTL. Ao vencer sem aceitação, libera a vaga reservada e o candidato volta à elegibilidade. Atribuição aceita segue para a admissão por lease, que decide.
- **Atribuições pendentes na troca de modo:** o executor que passa ao modo local descarta atribuições não aceitas; o que já tem lease termina onde está.

**Recuperação.**
- Exige evidência nova de saúde e reconciliação com leases, atribuições e operações iniciadas durante o modo local. O retorno do timer, sozinho, não comprova recuperação.
- O admin monta a ocupação a partir dos leases vivos e das atribuições pendentes, e não reatribui o que já roda ou está numa fila local.

**Seguidores.** Não elegem outro admin, não assumem distribuição por idade do candidato e aplicam só a condição de fallback da D5. A segurança se mantém enquanto aparelhos diferentes percebem a transição em momentos diferentes, porque o lease continua sendo a autoridade final.

**O fallback preserva as garantias.** Modo local coordenado não é sincronização desligada nem retorno irrestrito ao legado: continuam valendo consentimento local, identidade, limites por aparelho (CT-ADM), coordenação das postagens (CT-POST) e as condições do teto do grupo (CT-GRUPO). Quando uma garantia necessária não pode ser verificada, a operação que depende dela fica segura em espera.

**Tela.** Distingue "aparelho conectado, distribuidor indisponível" de "aparelho sem presença". O aviso de candidato esperando mostra o motivo conhecido e separa espera legítima (sem vaga, orçamento, política) de ausência inexplicada de progresso. O aviso não autoriza bypass.

**Limite declarado.** Este mecanismo não detecta todo erro lógico silencioso. "Não lançou exceção" não é prova de funcionamento correto.

### CT-POST: exclusão de postagem e resultado incerto (S3-2)

**Exclusão compartilhada.**
- A exclusão é a **mesma** para todas as vias que postam review num PR: o lease por conta GitHub e PR (`/leases/{conta}/{pr}`). Cada via pode ter tipo de operação e recibo próprios, mas não existe lock separado que impeça só duas co-assinaturas e deixe aberta a corrida com uma revisão normal.
- **Este contrato não redesenha as vias existentes de uma vez.** Cada entrega que coloca uma via sob o contrato demonstra, no plano dela, a interação com as demais vias como elas estão naquele momento. As vias hoje são: revisão automática e re-revisão (postam dentro da sessão que adquiriu o lease; o plano da C0b confirma se o lease ainda está vivo no instante do POST), reenvio automático de postagem que falhou (`retryFailedPosts`), decisão por clique (`decide`, que hoje não passa pelo coordenador), chat e co-assinatura.
- Via que não participa é declarada **não coberta** na tela e na documentação, nunca coberta por inferência. A C0b cobre a co-assinatura; a decisão remota entra na C6; as demais ficam declaradas até uma entrega as cobrir.
- **Depois de adquirir a posse**, a via relê o recibo e o estado relevante no GitHub (reviews meus no head, head atual). Consultas anteriores à aquisição não bastam.

**Três estados da postagem, persistidos antes do envio:**
1. **Envio não realizado:** a intenção foi registrada, o POST não saiu. Pode tentar.
2. **Publicação confirmada:** o GitHub respondeu com o review. O registro guarda o id do review e o `commit_id`.
3. **Resultado incerto:** o POST pode ter sido aceito (timeout, queda do processo, falha ao gravar o recibo depois do envio).

- O estado **incerto** sobrevive ao processo e é visível para outro aparelho (registro no recibo da operação).
- Ausência de recibo final ou expiração do lease **não autoriza, por si só, nova tentativa**.
- Com dúvida, a via tenta reconciliar automaticamente, procurando no GitHub um review meu no head com o mesmo veredito. Enquanto a dúvida persistir, não repete o POST às cegas e mostra o motivo na tela.
- **Limite declarado:** o protocolo não promete exactly-once. Ele garante no máximo uma tentativa por intenção enquanto a exclusão e o registro funcionam, e reconciliação explícita quando não funcionam. A spec de cada via escreve os limites, inclusive o caso de duas instâncias do mesmo aparelho.

**Posse válida.**
- Com a coordenação ligada e indisponível, a postagem automática não a contorna, inclusive no admin executando local.
- Perda de posse antes do envio cancela o envio. Posse expirada durante a operação faz o envio não sair; se já saiu, o estado vira incerto e segue a reconciliação.
- Um aparelho que volta de suspensão não retoma uma postagem nova com autorização vencida.
- O bloqueio atinge a operação afetada, nunca o app inteiro.
- Com a coordenação desligada, vale o comportamento de hoje, sem atribuir a ele garantia multidispositivo.

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
| A1 | Consumo fiel e falha durável | nada |
| A2 | Plano e chaves explícito | B1, B2 |
| A3 | Diagnóstico unificado | A1, B1, B2 |
| A4 | **Autenticação da API local** (correção de segurança prioritária) | nada técnico; ver 6.3 |
| A5 | **Retomada durável** (CT-RET) | nada |

**Trilha B, fundação**

| # | Entrega | Depende de |
|---|---|---|
| B0 | Reorganização, Fase 0 | nada |
| B1 | Reorganização, Fase 1 (`ui/`) | B0 |
| B2 | Brief e desenho do app inteiro no Claude Design | nada (artefato) |

**Trilha C, operação multidispositivo** (zero efeito com a sincronização desligada)

| # | Entrega | Depende de |
|---|---|---|
| C0 | Correções da sincronização publicada | nada |
| C0b | **Co-assinatura coordenada** (CT-POST) | C0 |
| C1 | Contrato de dados v2, cifragem e allowlist de Host | C0 |
| C2 | Administração, políticas, grupo de consumo, limpeza protegida | C1 |
| C3 | Visão compartilhada | C1, B1, B2 |
| C4 | Capacidade, admissão local e medição | C2 |
| C5 | Agendador, prontidão e fila global | C3, C4, A5, C0b |
| C6 | Comandos remotos | C5 |
| C7 | Checkpoint compartilhado, transferência voluntária e decisão de afinidade | C6, A1 |
| C8 | Tomada forçada | C7 |

**Emendas à D6, declaradas:** entram A4, A5 e C0b. A5 sai de dentro da C5 porque beneficia todo mundo e é pré-requisito dela. C0b vira entrega própria porque o furo existe hoje, com a coordenação da v2.59 ligada e dois aparelhos na mesma conta, sem depender de distribuição.

### 6.2 Ordem

1. **Já, em paralelo:** A1, A4, A5, C0, B0, B2.
2. Depois: C0b; B1 junto com C1.
3. Onda de telas: A2, A3, C2, C3.
4. Por fim: C4 → C5 → C6 → C7 → C8.

**Por quê.** A1 cedo porque teto do grupo, checkpoint e Diagnóstico confiam em consumo e id de sessão que hoje mentem. A4 cedo porque o risco já existe no celular em uso. B1 antes da onda de telas para não pagar duas vezes o conflito com os 21 testes que casam regex em `ui/app.js` e `ui/pure.js`.

### 6.3 Condição de liberação da operação no celular

- **Condição de liberação:** a operação no celular não é declarada pronta para uso seguro antes da A4 publicada. Isso é independente de qualquer dependência técnica de implementação.
- **Consequência concreta:** a C3 coloca no snapshot local conteúdo decifrado de todos os aparelhos. A C3 não é ativável num aparelho em modo celular sem a A4.
- A A4 não depende da C6 e não bloqueia o planejamento das demais entregas.

---

## 7. Entregas

Cada entrega tem spec de plano própria (`superpowers:writing-plans`) antes de código, com PR próprio, gate de qualidade e contraprovas: toda garantia tem uma mutação que faz um teste falhar.

### 7.A1 Consumo fiel e falha durável

**Escopo.**
1. **Medir a contagem dobrada** antes de corrigir: capturar o `stream-json` de sessões reais com thinking, texto e tool_use; comparar a soma do acumulador com a soma deduplicada por `message.id` e com o `usage` do resultado final. Registrar a conclusão; só então corrigir.
2. **Codex com falha registra** o que for conhecido, com status de medição honesto.
3. **Resultado recusado vira desfecho de erro** em revisão, autoanálise, pushback e ferramenta (`marcarDesfecho`).
4. **Custo sem base não entra como zero** no teto: status `desconhecido`, contado à parte e tratado como "não controlado" no gate (CT-GRUPO, lacuna 1).
5. **Id de sessão estável:** id opaco por sessão, único entre boots e aparelhos; o rótulo curto fica só para exibição.
6. **Registro local durável de falha por sessão**, fora do `farol.log`: motivo sem corte de 300 caracteres (com teto próprio e máscara de segredo), classe da taxonomia, id da sessão do CLI, etapa e tempo por etapa até a falha, ligado à linha do Consumo e ao card estacionado. Limpar log não o apaga.
7. **Correção de desfecho chega ao banco:** fila de correção por `eventId`, independente do cursor da outbox, que sobrevive à consolidação desligada ou à falta de `deviceId` no momento da correção.
8. **Pushback que falha tem teto por PR** e passa pela taxonomia.

**Critérios de aceite.** Teste para cada item: sessão Codex falhando gera linha; recusa de envelope marca erro nos quatro caminhos; sem-base nunca soma zero no gate; dois boots não reutilizam id; falha estacionada mostra motivo depois de Limpar log; correção posterior ao cursor chega ao fake do banco; pushback falhando N vezes para no teto.

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

**Requisito.** Proteger leituras sensíveis, ações e eventos em tempo real, pelo inventário de rotas de `lib/http-server.js`. Inventário em `f80394e` (todo POST exige hoje só `x-farol: 1`):

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

O plano da A4 confirma o inventário contra o código do momento; rota nova sem classe reprova num teste.

**Requisitos do mecanismo, ainda não escolhido:**
1. **Nenhuma solução está aprovada.** A proposta "link com o segredo impresso no terminal do Termux, trocado por cookie `HttpOnly`" é candidata a avaliar, não decisão. A proposta da síntese da C1 (segredo no fragmento do endereço) também.
2. **Avaliar a RFC 6265, seção 8.5:** cookie não é isolado por porta. Outro processo servindo em outra porta de `127.0.0.1` pode receber o mesmo cookie do navegador. A spec do plano demonstra como o desenho impede outro aplicativo local de obter ou reutilizar a credencial.
3. **Estabelecimento da sessão** sem expor o segredo em HTML público, em log (inclusive `state/spawns.log` e `farol.log`) ou em URL persistente (histórico do navegador, atalho).
4. **Código de pareamento, se houver:** temporário e de uso único.
5. **Expiração, revogação e comportamento depois de reinício** definidos.
6. **A exigência é decidida pelo servidor, pelo modo de execução, nunca pelo User-Agent.** A detecção do modo celular é parte da spec do plano.
7. **Funciona com a sincronização desligada.**
8. **Limitação exata declarada:** o segredo não protege contra processo que já tenha acesso a ele. Nesta iniciativa o escopo é o modo celular; o desktop continua como hoje, sem ampliação.

**Critérios de aceite.** Testes provando que, no modo que exige autenticação, requisição sem credencial não recebe estado, relatório, log, chat nem evento SSE e não executa ação; que o segredo não aparece em log, HTML ou snapshot; que o código de pareamento não funciona duas vezes nem depois do prazo; e que o modo é decidido no servidor mesmo com User-Agent forjado.

### 7.A5 Retomada durável

Implementa CT-RET.

**Critérios de aceite.** Retomada local válida; recusa antes do provedor sem sessão iniciada e sem consumir a retomada; referência preservada durante espera por vaga e por lease; dois reinícios antes da retomada; operação equivalente concluída em outro aparelho (não retoma); HEAD alterado ou não confirmado; contexto local ausente ou incompatível; fallback permitido para sessão nova sem herança indevida; diagnóstico distinguindo retomada, recusa do CLI e sessão nova.

### 7.C0 Correções da sincronização publicada

**Escopo:** os cinco defeitos da seção 4.2 que não dependem de contrato novo (oscilação do PR bloqueado por recibo, rota de configuração que descarta campos, recibo pendente depois de clique, lease morto na tela, selos divergentes do Panorama) e a correção da frase da tela de Sincronização para o que de fato sobe hoje.

**Critérios de aceite.** Um teste de ciclo inteiro por defeito (não só dentro de uma chamada); a frase da tela e o `firebase/README.md` batem com os campos em claro enviados.

### 7.C0b Co-assinatura coordenada

Implementa CT-POST para a co-assinatura, mantendo-a opt-in.

**Gates próprios preservados:** opt-in local, identidade e token corretos, restrição de autoridade e CODEOWNERS (`autoridadeNaSaida`), aprovação válida da pessoa que fundamentou a saída de cena.

**Endosso ancorado no commit.**
- A aprovação que fundamenta o endosso precisa ser **no mesmo SHA**. O filtro de `reviewsDeOutros` deixa de aceitar head vazio ou review sem `commit_id` como prova. Falta de informação não autoriza a postagem.
- A elegibilidade é confirmada antes do envio, depois de adquirir a posse.
- A postagem carrega explicitamente o `commit_id` confirmado. Nenhuma tentativa nem fallback remove a âncora ou a troca pelo HEAD mais recente; o recuo sem âncora do funil é proibido para esta via.
- HEAD mudou: o endosso anterior não autoriza aprovar o novo commit. Isso é desfecho explícito e reavaliação, nunca fallback.
- A co-assinatura não é revisão fictícia: sem envelope fabricado para `shouldAutoApprove` e sem contabilizar como sessão de IA.

**Compatibilidade.** Versão antiga que coordena revisões por lease mas co-assina por fora não participa. A garantia só é declarada para uma conta quando todos os aparelhos que podem co-assinar com ela estão numa versão que participa (CT-COMPAT).

**Critérios de aceite.** Duas co-assinaturas concorrentes; co-assinatura concorrendo com revisão normal; HEAD mudando entre a conferência e o POST; tentativa de fallback sem âncora; publicação aceita seguida de timeout ou queda antes do recibo; perda de lease e retomada depois de suspensão; convivência com versão antiga.

### 7.C1 Contrato de dados v2, cifragem e allowlist de Host

**Escopo.**
- CT-ENV implementado: keyring, cache, envelope, identificadores, interruptor `sync.shared.enabled`, desbloqueio de aparelho logado antes da feature (rota de desbloqueio), sonda de regras.
- Regras v2 (seção 10), geradas por macro com teste byte a byte.
- Remoção do apagão (`syncEraseRemote` e a rota).
- **Allowlist de Host:**
  - validação central antes do atendimento de qualquer rota, cobrindo leituras, SSE e POST;
  - hosts locais explicitamente permitidos (`127.0.0.1` e `localhost`) com a porta efetivamente usada, sem curinga;
  - proteções existentes mantidas (`x-farol` nos POST);
  - tratamento de `Origin` e CORS definido sem quebrar os clientes legítimos (janela do Electron, navegador do próprio aparelho);
  - **Host permitido não é autenticação** de um aplicativo local; isso é a A4.

**Critérios de aceite.** Host inválido não recebe estado, SSE nem dispara ação (um teste por classe de rota); cliente legítimo continua funcionando; as 44 contraprovas da síntese da C1 (`evidencias/02`, campo `contraprovas`), com os itens de emulador no roteiro manual.

### 7.C2 Administração, políticas, grupo de consumo e limpeza protegida

**Escopo.**
- Tornar **este** aparelho admin por reautenticação com a senha real do Firebase. Designação remota entra com os comandos (C6).
- Consentimento local e políticas por aparelho (CT-ADM-POL): prioridade, teto 1 a 4, pausa, contas elegíveis por tag, tipos de operação.
- Grupo de consumo e teto do grupo (CT-GRUPO), incluindo a tela de pareamento e as duas lacunas resolvidas antes de declarar a D2 entregue.
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

**Pendências para o plano da C3:** retenção da autoanálise sincronizada (a síntese recomenda permanente, write-once por versão; não decidido pelo dono).

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

**Critérios de aceite.** Os da síntese (`evidencias/03`, campo `contraprovas`) mais os de CT-PRONT (exceção só no distribuidor com presença ativa; falha devolvida sem exceção; ciclo que nunca termina depois de um sucesso; inicialização; fila vazia; bloqueio legítimo de orçamento e capacidade; falha isolada de candidato; resultado atrasado depois de suspensão; retorno com trabalho local em andamento; alternância entre falha e recuperação) e os da S3-4 (mesma org agrupada entre aparelhos e contas, inclusive caixa e owner pessoal; rodízio equivalente ao atual independente do nome; ausência do nome em claro no registro remoto; rejeição de troca ou adulteração do metadado entre candidatos; funcionamento com rótulo indisponível).

### 7.C6 Comandos remotos

**Escopo.** Cancelar, repetir, decidir e postar, iniciar em outro aparelho, designar outro admin.
- Forma: identificador, alvo, tipo, argumentos, emissão, TTL, geração e assinatura; idempotente pelo identificador, com recibo de desfecho.
- Aplicação só com consentimento local, assinatura, geração e prontidão válidas. Sem os quatro, o comando é ignorado e o recibo diz por quê.
- Comando nunca vira `pr.manual` (CT-FIO).
- **Decidir e postar** é roteado ao aparelho dono da pendência e passa por CT-POST.
- Executor offline: comando fica pendente; ao voltar, revalida estado, head e posse antes de agir.
- Sucesso só aparece depois do recibo do executor.

### 7.C7 Checkpoint compartilhado, transferência voluntária e afinidade

**Escopo.**
- Checkpoint de verificação compartilhado, cifrado, com lojas `review` e `self` separadas, entrada inválida falhando fechada, alimentando o gate de postagem só com entradas verificáveis.
- Transferência voluntária entre aparelhos aptos, com retomada integral, parcial ou reinício declarado.
- **Decisão de afinidade:** preferência temporária pelo aparelho com contexto local, com limite de tempo e sem reserva indefinida de PR para aparelho indisponível. Decidida com os dados de quantas vezes a troca de dono acontece de verdade.

### 7.C8 Tomada forçada

**Escopo.** Lease sucessor, janela de segurança, confirmação de risco, bloqueio de publicação tardia por geração, reconciliação do executor antigo e evidência de possível consumo duplicado. Sem promessa de exactly-once.

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
- Cortar o teto global do conjunto **não** retira a consideração de trabalho já admitido ou em andamento na D2 (CT-GRUPO, lacuna 2).

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

Detalhe por nó em `evidencias/02-c1-contrato-dados-cifragem.json`, campos `nos` e `estrategia_de_regras`. Resumo:

| Nó | Conteúdo | Escritor | Retenção |
|---|---|---|---|
| `keyring` | chaves embrulhadas | aparelho com login recente | permanente, fora da limpeza |
| `live/control/admin`, `beat`, `cleanup`, `cleanupLock`, `lastCleanup` | admin, prontidão, chave e trava de limpeza | admin | sobrescrito |
| `devices/{id}` | presença (com contrato e prontidão da chave) | o próprio aparelho | só limpeza remove |
| `live/deviceStatus/{id}` | capacidade resumida, cifrada | o próprio aparelho | sobrescrito |
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

## 13. Medições obrigatórias

| Medição | Antes de |
|---|---|
| Contagem dobrada no stream real | corrigir o acumulador (A1) |
| `auth_time`, `*`, `.length`, `matches`, `child()` dinâmico, PATCH v1 no emulador e em projeto real | publicar regras v2 (C1) |
| Tempo do `scrypt` no Termux | release da C1 |
| 24 h de banda com dois aparelhos | ligar compartilhamento no celular (C3) |
| Memória real dos processos e utilidade do peso do PR | ligar recusa por peso (C4) |
| Atraso do consumo entre aparelhos | declarar o teto do grupo (C2) |
| Latência de publicação até sessão aberta | declarar a distribuição (C5) |
| Frequência real de troca de dono no mesmo head | decidir afinidade e checkpoint compartilhado (C7) |

---

## 14. Riscos residuais declarados

- O Google recebe a senha a cada login e pode derivar a KEK (D1 com senha do Firebase).
- Quem sabe a senha ou controla o e-mail tem controle total: abre a chave, vira admin e limpa.
- Aparelho comprometido ou cópia de `~/.farol` abre o conteúdo das gerações em cache; rotação protege só o futuro.
- Senha fraca cai em ataque offline ao keyring, mesmo com `scrypt` (D7 não impõe mínimo).
- `deviceId` não é credencial: quem tem só o refresh token consegue apagar itens de exibição, sobrescrever projeções com lixo detectável e apagar lease vivo, como hoje.
- Coordenação em SHA-256 sem sal continua descobrível por dicionário.
- Teto do grupo é macio na medida do atraso do consumo, até a lacuna 2 de CT-GRUPO ser fechada.
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

## 16. Pronto do conjunto

A iniciativa está pronta quando:

1. CT-COMPAT se sustenta com teste: sincronização desligada idêntica, compartilhamento desligado com rede de hoje, um aparelho só idêntico, nenhum update liga nada.
2. Toda garantia declarada ativa na tela está coberta para todos os aparelhos que podem executar aquele caminho.
3. A4 publicada antes de a operação no celular ser declarada pronta.
4. Com a coordenação ligada, toda via de postagem declarada coberta segue CT-POST, as não cobertas estão declaradas na tela, e a co-assinatura aprova só o commit que fundamentou o endosso.
5. O teto do grupo tem métrica e admissão conjunta definidas, ou não é declarado.
6. Aparelhos veem o andamento uns dos outros sem duplicar processamento.
7. O excesso do celular vai ao computador sem interação e sem abrir sessão num aparelho inapto.
8. Retomada, recusa do CLI e sessão nova são distinguíveis, e a retomada sobrevive a reinícios.
9. Diagnóstico copiável, inerte e mascarado; consumo com erro distingue medido, parcial e desconhecido.
10. Nenhum dado local é apagado pela limpeza, e a limpeza não existe sem prova de senha recente conferida pelo servidor.
11. Todas as medições da seção 13 feitas, com os números registrados.
