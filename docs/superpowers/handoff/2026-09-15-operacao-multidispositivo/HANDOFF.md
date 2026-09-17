# Handoff: operação sincronizada multidispositivo do Farol

> **Histórico.** O planejamento terminou em 15/09/2026. O contrato vigente é `docs/superpowers/specs/2026-09-15-operacao-multidispositivo-design.md`, o pacote de execução é `docs/superpowers/plans/2026-09-15-operacao-multidispositivo-mestre.md`, e o estado atual da execução está em `EXECUCAO.md`, nesta pasta. Onde este arquivo divergir deles, valem eles.

**Data:** 15/09/2026
**Estado:** planejamento (brainstorming) em andamento. **Nenhuma linha de código de produção foi escrita.** O que existe é documentação de planejamento.
**Por que existe:** a sessão original (Claude Code, Opus 5, ultracode ligado) foi encerrada para o dono continuar em outra conta. Este arquivo é autossuficiente: quem continuar não precisa da conversa original.

> **Commitado com autorização do dono em 15/09/2026, em branch própria, sem push.** Antes disso as evidências foram varridas (sem e-mail, token ou login de terceiros) e os caminhos locais da máquina foram trocados por marcador, porque o repositório é público. Qualquer evidência nova passa pela mesma varredura antes de entrar.

> ## ⚠ A base da análise é a v2.59.2, e a `main` remota já está adiante
>
> Tudo neste handoff foi medido no commit `7432f47` (v2.59.2), que era a `main` local. Ao encerrar a sessão, a `main` remota já tinha **11 commits a mais**, incluindo a **v2.59.3**, que mexe justamente onde o desenho mais cita:
>
> | Arquivo | Mudança na v2.59.3 |
> |---|---|
> | `lib/engine/review.js` | +239 linhas (destrave do round pós-push) |
> | `lib/engine/destrava.js` | módulo novo |
> | `lib/engine/decision.js`, `server.js`, `ui/pure.js`, `ui/app.js` | alterados |
>
> **Consequência prática:** os números de linha citados na Seção 3 (que fala de `review.js` o tempo todo) e parte dos da Seção 2 podem ter escorregado. O conteúdo dos achados continua valendo; **a âncora `caminho:linha` precisa ser reconferida** contra `origin/main` antes de virar plano.
>
> **Primeira coisa a fazer na retomada:** `git fetch origin && git log --oneline main..origin/main`, atualizar a `main` local, e reconferir as citações da Seção 3. Os documentos da reorganização (spec, plano da Fase 0 e handoff próprio) **já estão versionados na `main` remota** pelo PR #86, então ignore qualquer menção aqui a eles estarem sem commit.

---

## 0. Como retomar (leia antes de qualquer coisa)

1. **Processo em uso:** skill `superpowers:brainstorming`, caminho **arquitetural**. O ponto atual é "apresentar as seções do desenho ao dono, uma de cada vez, com aprovação". Faltam: fechar a Seção 3, apresentar a Seção 4, escrever a spec, o dono revisar a spec, e só então `superpowers:writing-plans` para a PRIMEIRA entrega. **Nada de implementação antes disso.**
2. **Ordem de leitura:**
   1. este arquivo inteiro;
   2. `docs/superpowers/specs/2026-09-15-operacao-sincronizada-multidispositivo.md` (rascunho gerado no Codex, 1492 linhas, não commitado). É a BASE, mas está desatualizado nos pontos da seção 4 deste handoff;
   3. `evidencias/` só quando precisar de `caminho:linha` (ver seção 10).
3. **Próximas ações, nesta ordem:**
   1. obter a resposta do dono sobre o token da API local (seção 7, item 1);
   2. apresentar a Seção 3 (seção 6.3, desenho pronto), declarar as divergências e perguntar as 8 decisões UMA de cada vez;
   3. apresentar a Seção 4 (seção 6.4);
   4. escrever a spec guarda-chuva e pedir revisão.
4. **Uma pergunta por vez**, com opções e recomendação. O dono já respondeu muita coisa: **não repita nada da seção 2.**
5. **Estilo que funcionou com o dono:** respostas diretas em português, sem travessão, tabela quando compara coisas, sempre dizer onde se discorda e por quê, e corrigir abertamente quando algo dito antes estava impreciso.

---

## 1. Os pedidos originais (notas de voz de 14/09/2026) e a leitura confirmada

A transcrição por voz trocou palavras. A coluna da direita é a leitura **confirmada com o dono**.

| Nota | Leitura confirmada |
|---|---|
| "visão compartilhada do que tá rodando no celular no computador [...] uma coisa é poder ver, outra é onde está sendo processado" | Qualquer aparelho vê o andamento das revisões dos outros; ver nunca dispara processamento |
| "a configuração em sistema se aplique nos positivos" | "positivos" = **dispositivos**. Políticas definidas no computador valem nos outros; quantas revisões simultâneas **por aparelho** |
| "não quero mais aquele botão de apagar da tela de consumo [...] apagar dados sincronizados não deve existir" | **O botão não fica na aba Consumo** (verificado: ela não tem nenhum). O único é "Apagar dados sincronizados", em Sistema > Sincronização (`ui/pure.js:3207`). Virou limpeza protegida (seção 2) |
| "parte de coordenação [...] Lizardo no dispositivo X [...] pode ser removido só essa parte visual" | A lista visual "Coordenação agora" sai; a lógica (lease, recibo, presença) fica. "Lizardo" casa com "sendo analisado no X" / "analisado no X" |
| "Plano e chaves [...] em qual PF que foi atribuído [...] nome do plano" | **PF = path** (o dono confirmou: "ou é path ou patch, isso é certo"; path é o que faz sentido). O perfil padrão não mostra em qual diretório de config aponta nem tem nome; ao validar pela primeira vez, o perfil nasce explícito, nomeado e editável |
| "diagnóstico [...] não consigo copiar e colar [...] exportar só copia, sem MD adequado [...] duplicando muita informação" | Diagnóstico unificado: falha copiável, export em Markdown de verdade, menos telas repetidas. "Cloud" = Claude |
| "salvar o progresso do cheque do PR através do firebase" | Salvar o progresso da revisão (checkpoint) no Firebase para outro aparelho retomar |
| "revisões recentes deve ser sincronizado" | Revisões recentes **e Panorama** (complemento do dono), e também Precisa de você e Meus PRs |
| "analisar se o farol retém o log do erro da revisão e registra o consumo com erro" | Investigação. **Respondida** na seção 5.1 |
| "preciso fazer revisões de design em todo o aplicativo" | Redesenho de interface do app inteiro, com reorganização profunda de abas aceita, **obrigatoriamente vindo do Claude Design** |

---

## 2. Decisões fechadas (não reabrir)

### 2.1 Respostas do dono às 12 perguntas do Codex

| # | Pergunta | Resposta |
|---|---|---|
| 1 | O que é "PF" | Não era perfil. **Depois confirmado: path** |
| 2 | Revisão recente em outro aparelho mostra o quê | "O básico bem feito". Com a cifragem ponta a ponta (D1), o resumo estruturado pode subir cifrado |
| 3 | Só observar ou agir remotamente | **Acompanhar e agir** |
| 4 | "Salvar progresso" inclui outro aparelho assumir | **Sim, é o ápice da feature, se possível** |
| 5 | Limite de revisões: total ou por conta | **Por aparelho.** E medir antes de iniciar se o aparelho aguenta a revisão, para não desperdiçar tempo e tokens |
| 6 | Quem edita a capacidade dos outros | **Somente o aparelho admin** |
| 7 | Quais configurações são globais | Concorda: só políticas operacionais. Credenciais, caminhos, autostart, tema e porta ficam locais |
| 8 | Remover o botão de apagar | Remove. Vira **chave "permitir limpeza" desligada por padrão**; ao clicar em apagar, **pede a senha do Firebase de novo**. "Quero isso bem dificultado" |
| 9 | Reter logs | **Logs do app não sincronizam**, são pessoais do aparelho |
| 10 | Revisões recentes: história única ou filtro | **História única com filtro por aparelho** |
| 11 | Incluir Precisa de você e Meus PRs | **Sim** |
| 12 | Reorganização das abas | **Aceita reorganização profunda** |

### 2.2 Decisões tomadas nesta sessão

| ID | Decisão | Observação |
|---|---|---|
| D-a | **Capacidade = mecânica, RAM é a causa mais provável** de falha no celular | O celular roda o engine Node em Termux/proot, UI no navegador dele |
| D-b | **Ligar a chave de limpeza não pede senha; só o clique em apagar pede** | |
| D-c | **Consentimento local por aparelho:** cada aparelho liga, NELE MESMO, a permissão de o admin agir por ele. Nunca ligável remotamente | Ideia do dono para segurança |
| D1 | **Conteúdo que sobe vai cifrado ponta a ponta** (título, URL, relatório estruturado, andamento) | Escolhida contra "só identificadores" e "texto legível" |
| D2 | **Um teto de orçamento só para o conjunto** de aparelhos com a mesma assinatura | Exige identidade de perfil estável entre aparelhos |
| D3 | **Avisos: todos os aparelhos notificam; um "visto" em qualquer um cala os outros** | |
| D4 | **Distribuição por agendador com fila global** | Escolhida CONTRA a recomendação (deferência sobre os leases). Respeitar |
| D5 | **Agendador = o admin, SEM substituto.** Admin fora: cada aparelho volta à configuração local e à revisão automática de hoje, coordenada por lease. Admin volta: retoma sem mexer no que roda | Resposta livre do dono, melhor que as opções dadas: elimina eleição e failover |
| D6 | **Decomposição em 15 entregas e a ordem (Seção 1) aprovadas** | "Faz bastante sentido, vamos seguir" |
| D7 | **A chave de dados é aberta pela senha do Firebase, SEM mínimo de caracteres** | Escolhida contra "mínimo de 12" e "frase separada". A tela pode recomendar senha longa só como texto, sem bloquear |
| D8 | **Se o servidor não conseguir conferir senha recente, a limpeza NÃO é publicada** | Até lá o caminho é o console do Firebase |
| D9 | **Todo design do Farol vem obrigatoriamente do Claude Design** | Precedente de canal: a tela de Sincronização foi desenhada no Claude Design pelo Claude Code (artefato em `docs/superpowers/plans/2026-09-10-sync-00-contrato.md:95`) |
| D10 | **Nada disso afeta o Farol de quem não liga a sincronização** | Já é invariante do código (`lib/sync/coordinator.js:207-209`); vira teste obrigatório |

---

## 3. Duas naturezas de mudança (explicado ao dono, sem objeção)

- **Recursos da sincronização** (visão compartilhada, distribuição, admin, comandos, teto do conjunto, avisos cruzados, limpeza remota): **zero efeito** com a sincronização desligada. Um aparelho só com sincronização ligada = comportamento de hoje. Aparelho em versão antiga ignora nós e campos novos e continua coordenando por lease.
- **Melhorias para todo mundo** (consumo com erro contado direito, Plano e chaves explícito com o path, Diagnóstico unificado, reorganização das abas vinda do Claude Design): mudam o app de qualquer pessoa, porque são consertos e redesenho.

---

## 4. Correções ao rascunho do Codex (`2026-09-15-operacao-sincronizada-multidispositivo.md`)

| Seção do rascunho | O que diz | O que vale |
|---|---|---|
| §3.21, §19, §30.10 | "PF" não recuperado, não inventar | **PF = path** |
| §8.4 | Admin altera e comanda qualquer aparelho | Só aparelho com **consentimento local** ligado (D-c) |
| §8.2 | Escolher qualquer aparelho da lista como admin | Na primeira entrega (C2), só **"tornar ESTE aparelho admin"**, porque a chave privada do admin nasce onde vai morar. Designação remota entra com os comandos (C6) |
| §9 | Fila global, agendador reserva por CAS, sem dizer quem roda o agendador | **O agendador é o admin, sem substituto** (D5); com admin fora, modelo de hoje |
| §11.1, §23, §30.3 | Referência legível x hash pendente | **Cifrado ponta a ponta** (D1) |
| §12.3 | Consumo desconhecido quando o processo morre sem dado | Cobre um só dos buracos; ver seção 5.1 (há mais quatro) |
| §16 | Limpeza com senha só na aplicação | Senha recente **conferida pelo servidor** via `auth.token.auth_time`, ou a limpeza não sai (D8) |
| §17 | Diagnóstico com IA como ação opcional | A sessão hoje roda com permissão irrestrita e o prompt manda **editar o app instalado**; precisa virar somente leitura. Export escreve `@login`, que notifica pessoas se colado no GitHub |
| §18 | Proposta de abas | **Não é decisão**: vira insumo do brief do Claude Design (D9) |
| ausente | Orçamento entre aparelhos | **Teto único do conjunto** (D2) |
| ausente | Quem notifica | **Todos avisam, visto cala** (D3) |
| ausente | Defeitos já publicados na sincronização | Entrega C0 (seção 5.2) |
| ausente | Frota com versões mistas nos caminhos de coordenação | Caminhos de lease/recibo/rodada **não mudam** (seção 6.2) |

---

## 5. Achados verificados no código

Todos conferidos por um analista e um cético independente. Detalhe com `caminho:linha` em `evidencias/01-mapa-verificado-dos-pedidos.json` (campo `areas[].mapa` e `areas[].verificacao`).

### 5.1 Erro e consumo (resposta à investigação do dono)

**Consumo: quase sempre registrado, com cinco buracos.** O registro acontece antes de decidir sucesso ou erro (`lib/engine/session.js:1009`); sessão morta antes do fim grava o parcial com custo estimado pela mediana do modelo.

1. **Codex que falha não registra nada**: `turn.failed` monta resultado com uso vazio e custo zero, e o registro descarta (`lib/codex/stream.js:163-173`, `lib/engine/usage.js:277`).
2. **Resultado recusado fica "ok"**: envelope fora do contrato, prosa sem JSON, pushback ilegível, autoanálise recusada. Só a autoanálise por commit novo chama `marcarDesfecho`.
3. **App fechado no meio perde o consumo inteiro** (acumulador em memória). O auto-update recusa aplicar com sessão rodando, então o risco real é sair pela bandeja ou queda.
4. **Custo "sem-base" entra como zero no teto de orçamento** (`lib/engine/usage.js:91,100,290`).
5. **Suspeita de contagem dobrada do parcial**: o acumulador soma cada evento `assistant` sem deduplicar por `message.id` (`lib/engine/session.js:1079-1087`), e no transcrito o mesmo `message.id` se repete por bloco. **Precisa medir no stream real** antes de corrigir.

Extras: id de sessão (`a1`, `s1`...) zera a cada boot e faz `marcarDesfecho` corrigir a sessão errada (`server.js:253`, `lib/engine/usage.js:136-146`); pushback que falha repete sessão paga a cada ciclo sem teto por PR (`lib/engine/pushback.js:147-152`); correção de desfecho feita depois de o evento subir pode nunca chegar ao banco (`lib/sync/outbox.js:107-113`); auditoria local põe "sem-base" no balde "medido" enquanto o consolidado separa.

**Log do erro: retido pouco e de forma frágil.** Mensagem cortada em 300 caracteres na origem (`lib/engine/session.js:1015-1016`); stderr completo, feed de atividade e tempo por etapa morrem no `finally` (`lib/engine/review.js:1555-1556`); falha de revisão não vira decisão; motivo do estacionamento some ao relançar; **Limpar log apaga a única cópia** (`lib/engine/tools.js:149-158`); não há ligação entre a linha de consumo com erro, o motivo e o id da sessão do CLI.

### 5.2 Defeitos já publicados na sincronização (entrega C0)

- **PR bloqueado por recibo de outro aparelho oscila na fila a cada ciclo**, com WARN em toda volta (`server.js:549-570` contra `lib/engine/review.js:113-121`). Pela leitura do código; não reproduzido em execução.
- **Rota de configuração descarta campos e a tela diz "salvo"** (`lib/http-server.js:168`).
- **Recibo fica pendente para sempre** depois de decisão por clique (`lib/engine/decision.js:956-1002` não toca o recibo).
- **Lease morto continua na tela** até o próximo ciclo (`lib/engine/sync-stream.js:82-85`).
- **Selos do Panorama divergem entre aparelhos**: `reRequested` sai do histórico local (`server.js:1272-1290`), e um CHANGES_REQUESTED postado por outro aparelho aparece como aprovado.

### 5.3 Diagnóstico

- Três superfícies sobrepostas (relatório da IA, export determinístico, log bruto) e dois botões "Limpar" com efeitos diferentes.
- Export é texto, não Markdown estrutural (`ui/pure.js:2716-2797`); linhas cruas sem cerca; `@login` vira menção.
- "Diagnóstico com o Claude": sessão com permissão irrestrita, prompt `workspace-template/.claude/commands/pr-health.md` manda editar o app, e esse prompt **não está** na lista ressincronizada do `prepareHome` (`server.js:446-457`).
- O triage agrupa por CLASSE, não por episódio no tempo, e não devolve as linhas de cada grupo (`lib/log-taxonomy.js:281-328`): "copiar um episódio" exige mudar o contrato do triage.
- Manter o despejo cru na aba é contrato travado por teste (`test/ui-widgets.test.js:321`).

### 5.4 API local

- `GET /api/state` e `/api/events` sem autenticação; POST exige só o cabeçalho `x-farol: 1` (`lib/http-server.js:85`); servidor escuta só `127.0.0.1` (`lib/http-server.js:200`).
- **Hoje, sem sincronização nenhuma, um app no Android que alcance a porta consegue `POST /api/decide` e aprovar uma pendência** (`lib/http-server.js:165`). No PC um processo da mesma conta já lê `~/.farol` direto, então token não protegeria nada lá.

### 5.5 Outros fatos que o desenho usa

- Árvore remota de hoje sob `users/{uid}`: `devices`, `leases`, `receipts`, `dailyRounds`, `usageEvents`. Conta e PR sobem como SHA-256 **sem sal** (`lib/sync/keys.js:28-41`).
- **A promessa atual da tela de Sincronização já é imprecisa**: sobem em claro o hostname (`lib/engine/sync.js:78-80`), o head no lease e no recibo (`lib/sync/lease.js:43`, `lib/sync/receipts.js:40-46`), `profileId` e modelo no consumo (`lib/sync/outbox.js:83-84`).
- `syncEraseRemote` apaga `/users/{uid}` inteiro, inclusive leases vivos (`lib/engine/sync.js:436-445`).
- O id do perfil Claude é sorteado no front de cada aparelho (`ui/app.js:574-576`) e já sobe em todo evento de consumo.
- O login da sincronização é e-mail e senha por REST; conta com segundo fator não conecta (`lib/sync/auth.js:68-88`). A senha nunca é gravada (`lib/sync/credentials.js:1-5`).
- `ui/app.js` tem 4391 linhas e `ui/pure.js` 3401; 21 arquivos de teste casam regex contra eles.

---

## 6. O desenho

### 6.1 Seção 1: decomposição e ordem (**APROVADA**, D6)

**Trilha A, melhorias para todo mundo**

| # | Entrega | Depende de |
|---|---|---|
| A1 | **Consumo fiel e falha durável**: medir contagem dobrada; Codex com falha; resultado recusado vira erro; sem-base no teto; id de sessão estável; motivo da falha guardado e ligado à linha do Consumo | nada |
| A2 | **Plano e chaves explícito**: perfil materializado na primeira validação, com path, nome editável, identidade detectada; id de perfil estável entre aparelhos | B1, B2 |
| A3 | **Diagnóstico unificado**: falha copiável, Markdown sanitizado sem `@` que notifica, IA só leitura, fim das duplicações | A1, B1, B2 |

**Trilha B, fundação**

| # | Entrega | Depende de |
|---|---|---|
| B0 | Reorganização Fase 0 (`docs/superpowers/plans/2026-09-14-reorganizacao-fase-0.md`, não commitado) | nada |
| B1 | Reorganização Fase 1: quebrar `ui/app.js` e `ui/pure.js` (`docs/superpowers/specs/2026-09-14-reorganizacao-estrutural-design.md`, não commitado) | B0 |
| B2 | **Brief e desenho no Claude Design do app inteiro**: arquitetura de abas e todos os estados novos | nada (artefato, paralelo) |

**Trilha C, sincronização v2** (zero efeito com a sincronização desligada)

| # | Entrega | Depende de |
|---|---|---|
| C0 | Correções da sincronização publicada (seção 5.2) | nada |
| C1 | Contrato de dados v2 e cifragem (seção 6.2) | C0 |
| C2 | Administração: admin por reautenticação, consentimento local, políticas por aparelho, teto do conjunto, limpeza protegida | C1 |
| C3 | Visão compartilhada: andamento ao vivo, Panorama, Meus PRs, Precisa de você, Revisões recentes com filtro por aparelho, avisos com visto; sai "Coordenação agora" | C1, B1, B2 |
| C4 | Capacidade e preflight (RAM contra peso do PR) | C2 |
| C5 | Agendador do admin, coletores, fila global, degradação | C3, C4 |
| C6 | Comandos remotos (cancelar, decidir/postar com lease na postagem, iniciar em outro aparelho) | C5 |
| C7 | Checkpoint compartilhado e transferência voluntária | C6, A1 |
| C8 | Tomada forçada | C7 |

**Ordem:** já e em paralelo A1, C0, B0, B2 → depois B1 com C1 junto → onda de telas A2, A3, C2, C3 → por fim C4 → C5 → C6 → C7 → C8.
**Por quê:** A1 primeiro porque teto do conjunto, checkpoint e Diagnóstico confiam no consumo e no id de sessão, que hoje mentem. B1 antes da onda de telas para não pagar duas vezes o conflito com os 21 testes que casam regex nos arquivos gigantes.

### 6.2 Seção 2: contrato de dados v2 e cifragem, C1 (**decisões fechadas**; aprovação formal na revisão da spec)

Produzida por painel: 3 desenhos independentes (segurança, compatibilidade, custo no celular), 3 críticos com documentação oficial do Firebase, síntese. Nenhum erro fatal apontado. Detalhe completo em `evidencias/02-c1-contrato-dados-cifragem.json` (campo `sintese`: `nos`, `gestao_de_chave`, `identificadores_e_migracao`, `estrategia_de_regras`, `limpeza_protegida`, `admin_e_auth_time`, `compatibilidade`, `custo_e_banda`, `contraprovas` (44), `fatos_firebase`, `riscos_residuais`).

**Confirmado na documentação oficial**
- `auth.token.auth_time` é legível nas regras do RTDB, em segundos, e é a hora do login, não da renovação. `auth.token.firebase.sign_in_provider` existe.
- `.read`/`.write` cascateiam (filho não revoga o pai); `.validate` não roda em DELETE.
- Spark do RTDB: 1 GB armazenado, 10 GB/mês de download, 100 conexões; operação negada também é cobrada.
- ETag em qualquer método exceto PATCH; `if-match` em PUT e DELETE com 412.

**NÃO confirmado (vira gate de emulador e projeto real)**: operador `*` e `.length` nas regras; emulador de Auth carimbar `auth_time` igual a `iat` (relato não oficial); avaliação de regra por caminho num PATCH multi-caminho; `.indexOn` sob curinga.

**Como fica**
- **Coordenação não muda de caminho** (lease, recibo, rodada com SHA-256 sem sal), porque o caminho é a exclusão mútua entre versões. Com o compartilhamento ligado, só o corpo perde o commit em claro (`lease.headSha` vazio, `receipt.materialVersion` com tag).
- **Material de chave (só `node:crypto`)**: `K_id` (HMAC dos identificadores), `K_enc[gN]` aleatória por geração (AES-256-GCM, `authTagLength` 16, AAD amarrando uid, caminho, campo, geração), `K_adm` par Ed25519 que nasce e mora só no admin. KEK por `scrypt` **assíncrono** N=16384 r=8 p=5, sal de 16 bytes por embrulho (medir no Termux; se passar de 3 s, N=8192 r=8 p=10).
- **Keyring** em `users/{uid}/keyring`, criado só depois de `signInWithPassword` ok, com CAS; keyring sumido nunca é recriado sozinho. Cache local `~/.farol/sync-key.json` 0600, fora do config e de `state/`. Aparelho logado antes da feature fica "bloqueado neste aparelho" e opera no modo legado até digitar a senha uma vez (rota nova de desbloqueio).
- **Identificadores novos por HMAC** com `K_id` (sal público não protege contra dicionário). `profileTag` derivado do e-mail da assinatura ou do hash da chave, sem reescrever o id sorteado.
- **Leitura enxuta**: um stream só (`live`) para andamento, pendências, políticas e vistos; listas grandes por GET quando um ponteiro muda; UI por evento SSE dedicado, nunca `pushState` inteiro.
- **Admin assina** políticas, batimento (a cada 120 s; admin fora com `beatAt` + 360 s vencido) e chave de limpeza. Política só aplica com `config.sync.aceitarAdmin` ligado localmente, assinatura válida, batimento vivo, allowlist e o mesmo saneador. Nunca toca o gate de postagem nem o `config.json`.
- **Regras v2**: sem `.write` em `users/$uid`; concessão por nó; histórico, consumo e aparelhos write-once, removíveis só pela condição de limpeza (senha recente + chave ligada + nenhuma operação viva). Keyring, controle e coordenação nunca entram na limpeza.
- **Interruptor novo `sync.shared.enabled`**, desligado por padrão: sincronização ligada + compartilhamento desligado = rede idêntica à de hoje.
- **Liberação em três passos**: sai o app com tudo desligado e sem o apagão (com allowlist de Host); o dono publica as regras v2 (que aceitam os payloads v1); cada aparelho liga. Uma sonda (`rulesProbe`) deixa tudo dormente se as regras não foram publicadas.
- **Frase da tela** reescrita com honestidade: o que sobe cifrado; o que qualquer cópia do banco enxerga (horários, custos, tokens, tamanhos, qual aparelho); contra quem a cifra NÃO protege (quem sabe a senha, quem controla o e-mail, quem tem um aparelho, o Google). A frase atual é corrigida na mesma entrega.
- **Custo estimado (não medido)**: cerca de 180 MB/mês com 3 aparelhos (2% do Spark); cerca de 100 MB/ano armazenados sem apagar nada.

**Cortes de excesso propostos ao dono** (apresentados com "você pode vetar"; nenhum veto até o encerramento; **confirmar na revisão da spec**)

| Item | Síntese | Proposta apresentada |
|---|---|---|
| Migrar eventos de consumo antigos para a chave nova | na C1 | **Fora**; a tela conta quantos existem |
| "Encerrar sessões dos outros aparelhos" (`revokedBefore`) | na C1 | **Fora**; trocar a senha já derruba os refresh tokens |
| Designar outro aparelho como admin | só o próprio | Concordo: remoto entra na C6 |
| Enviar o histórico local existente (até 3000 decisões) | tudo, ato explícito | Concordo (~25 MB uma vez por aparelho) |
| Nome do aparelho | rótulo neutro em claro, nome cifrado | Concordo |
| Aparelho antigo sem `profileTag` | conta contra o teto de todos os perfis | Concordo |

Recomendações da síntese **não apresentadas** ao dono: autoanálise sincronizada permanente (write-once por versão); migração futura dos caminhos de coordenação numa entrega própria com corte decidido pelo servidor.

**Medições obrigatórias antes de release**: `auth_time` no emulador **e** num projeto real (entrar, esperar 6 min, renovar, tentar gravar admin: esperado 401; login novo: 200); tempo do scrypt no Termux; 24 h de banda com dois aparelhos, com contador por stream no Diagnóstico.

### 6.3 Seção 3: agendador, capacidade e comandos (**DESENHO PRONTO, AINDA NÃO APRESENTADO AO DONO**)

Workflow de 5 agentes concluído: mapa da fila automática de hoje, desenho, dois críticos adversariais (concorrência e virada; invariantes e excesso) e síntese. Resultado completo em `evidencias/03-s3-agendador-capacidade-completo.json`. O campo `sintese` traz `papeis`, `quem_e_dono_de_cada_estado`, `ciclo_de_atribuicao`, `degradacao_e_volta`, `capacidade_e_preflight`, `teto_do_conjunto`, `comandos_esboco`, `continuidade_esboco`, `modos_de_falha` (21), `contraprovas` (19), `corte_yagni` e `decisoes_para_o_dono`. Os campos `mapa`, `desenho` e `criticas` guardam o material de origem.

**Próximo passo:** apresentar esta seção enxuta ao dono, declarar as divergências e perguntar as 8 decisões abaixo, uma de cada vez.

**O desenho: uma camada fina sobre a máquina existente**

- **Coletor**, por conta, em todo aparelho. É o `check()` de hoje sem uma linha a menos, inclusive os filtros do `toReview` e o gate de consciência, porque todos exigem o token da conta. Publica um PONTEIRO de candidato (hashes), nunca o PR.
- **A credencial se resolve pela própria modelagem.** Os executores possíveis de um PR são exatamente os aparelhos que PUBLICARAM aquele candidato, e só publica quem tem token e passou pelos gates. O agendador nunca precisa saber quem tem qual token.
- **Agendador**, que é o admin. Roda a mesma escolha de ordem do `proximoHeadless` (`lib/engine/review.js:487-501`), refatorada para função pura sobre `acctTag`/`orgTag`. Depois escolhe ONDE com `escolherAparelho(item, publicadores, politicas, ocupacao)`, também pura. Quando o escolhido é o próprio admin, enfileira local sem passar pelo banco, então um aparelho só se comporta como hoje, inclusive na latência.
- **Executor.** Confere `aceitarAdmin`, assinatura, geração, batimento, head e token, e chama `enqueueHeadless` pelo ramo local. Dali em diante nada muda. **O lease continua sendo a autoridade final**: a atribuição decide só ordem e colocação.
- **Ocupação é DERIVADA, não declarada:** leases vivos do `deviceId` (já streamados em `lib/engine/sync-stream.js:212`) mais as atribuições pendentes dentro do TTL.
- **O teto por aparelho precisa de enforcement local novo.** Hoje o clamp é por conta (`review.js:426-429`), então três atribuições de três contas diferentes passariam juntas no celular.
- **Teto do conjunto.** Reusa `profileBudgetStatus` e troca só o store em `budgetStatusFor` (`lib/engine/usage.js:498-500`), somando o consumo dos outros aparelhos. **Depende de identidade de perfil entre aparelhos, que não existe hoje.**

**Três correções que a crítica provou obrigatórias**

1. **Furo fatal: `requested` não pode viajar pelo fio.** É ele que libera a postagem automática (`lib/engine/decision.js:418` e `:461`). Regra de ouro: campo que chega pelo banco só pode RESTRINGIR, nunca ampliar autonomia. O executor REDERIVA `requested` localmente, e os testes em `decision.js` mudam de `=== false` para `!== true`.
2. **O desvio no `enqueueHeadless` acontece ANTES do consumo destrutivo do sid de retomada** (`review.js:347-354`, `:400-406`). Item com retomada nunca é publicado.
3. **`enqueueHeadless` deixa de recusar em silêncio** (`review.js:390`) e passa a devolver desfecho. Junto, o round automático deixa de queimar a âncora na publicação (`review.js:1929`), senão reabre o bug de campo da v2.54.3.

**Divergências com o que foi dito ao dono (declarar ao apresentar)**

- **Histerese cortada.** Foi dito que haveria "uma folga de tempo contra oscilação" na volta do admin, e a síntese CORTOU isso: a folga criaria justamente uma janela de 240 s com dois escalonadores, e a descida já tem três batimentos de tolerância.
- **Cão de guarda e afinidade cortados.** O rascunho sugeria cão de guarda contra admin travado e afinidade como desempate; a síntese cortou os dois (ver a lista de cortes abaixo).
- **RAM não recusa no primeiro corte.** Peso do PR contra RAM só ORDENA, porque a correlação nunca foi medida. Isso fica aquém do pedido literal do dono: "medir se o celular aguenta ANTES de iniciar, evitar desperdício". **Apresentar com honestidade e deixar o dono escolher.** Desde o primeiro dia recusam:
  - presença vencida;
  - aparelho rodando como root;
  - provedor não pronto;
  - versão sem o contrato;
  - aparelho pausado;
  - aparelho sem vaga.

**Cortes de excesso, os principais**

- nó próprio de operações vivas;
- teto global de simultâneas do conjunto;
- peso do PR no ponteiro, e devolução mecânica do trabalho;
- gate duro de RAM no primeiro corte;
- afinidade por checkpoint ou prova;
- cão de guarda do admin;
- histerese;
- migração de sessão viva;
- eleição de agendador;
- fila com payload;
- levar o gate de consciência para o admin;
- centralizar a postagem;
- persistir a memória de rodízio;
- sincronizar `seen`, estacionamento e retry como escrita mútua.

**Decisões para o dono (NÃO perguntadas ainda)**

| # | Pergunta | Recomendação da síntese |
|---|---|---|
| S3-1 | Identidade de perfil entre aparelhos (sem ela, o teto do conjunto não soma nada) | Derivar automaticamente onde dá (hash da credencial nos perfis de chave de API e OpenRouter) e parear à mão só o perfil de assinatura por diretório. Perfil não pareado fica FORA do teto do conjunto, com aviso |
| S3-2 | A co-assinatura fica coberta pela coordenação? | Ganha lease e recibo antes de postar. É a única via que posta sem sessão e roda em todos os aparelhos com a conta, com risco de dois APPROVE (o incidente do biud-esg#230 entre aparelhos) |
| S3-3 | Admin batendo mas sem distribuir: o seguidor volta a enfileirar sozinho? | Não. Só mostra e registra "candidato há N minutos sem atribuição"; voltar sozinho contraria a D5 |
| S3-4 | O candidato publica a org em claro ou em hash? | Hash (`orgTag`). A tela do admin diz "outra org" e conta |
| S3-5 | Revisão que pode retomar a sessão anterior entra na distribuição? | Não. Enfileira local, como o clique |
| S3-6 | O teto por aparelho conta quais sessões? | Todas as sessões de IA (revisão, autoanálise, pushback, chat e ferramentas). O pushback passa a se registrar como sessão |
| S3-7 | Telemetria: presença vencida e RAM sem medição | Presença vencida é inapta desde já; peso contra memória só ordena até medir no Termux real (ver divergência acima) |
| S3-8 | Como os aparelhos leem batimento, fila e políticas? | Segunda conexão SSE dedicada, reusando a vigia e o backoff do stream de leases. Custa uma conexão permanente por aparelho, e isso aparece na tela |

### 6.4 Seção 4: trilha A e brief do Claude Design (**NÃO INICIADA**)

Cobrir, em nível de desenho (não layout):
- **A1**: como medir a contagem dobrada no stream real; forma do registro durável de falha (local, ligado à linha do Consumo e ao card estacionado); id de sessão estável; status `desconhecido` em vez de zero.
- **A2**: o que a "primeira validação" é (precedentes: "Testar leitura" do Jira, "Testar conexão" da Sincronização); perfil materializado com path, nome e identidade (e-mail do `oauthAccount`, tipo de autenticação; o nome comercial do plano NÃO é exposto de forma confiável); migração de quem já usa sem perfil (cartão guiado com confirmação, nunca escrita silenciosa no config); fim das quedas silenciosas para o legado (`server.js:1567-1571`).
- **A3**: uma visão só; decidir com o dono se ele quer **ver o Markdown renderizado na tela ou só copiar** (dúvida levantada pelo cético e não perguntada); IA somente leitura alimentada pelo mesmo Markdown; incluir `pr-health.md` na lista ressincronizada; mudar o triage se "copiar um episódio" for exigido.
- **B2**: brief para o Claude Design com inventário de telas e estados obrigatórios (lista inicial no §18.1 do rascunho do Codex), dados reais, restrições do celular, e as lacunas de clareza de `docs/superpowers/specs/2026-09-12-clareza-do-que-acontece-fora-do-app-mapeamento.md`.

---

## 7. Pendências abertas

1. **Token na API local (aguardando resposta do dono).** Ele perguntou "realmente necessário?". Resposta dada: **não para a C1.** No PC não protege nada; contra sites a porta já está protegida e só falta a allowlist de Host (entra na C1); no celular o risco real é anterior à sincronização (`POST /api/decide` alcançável). **Proposta:** allowlist de Host na C1; token vira endurecimento próprio da API local no celular, protegendo as ações, antes da C6. Pendente: o dono aceitar isso ou pedir que o token nunca exista.
2. **As 8 decisões da Seção 3** (tabela S3-1 a S3-8 na seção 6.3), e as divergências a declarar ao dono.
3. **Escopo fino não confirmado:** memória de pushback sincronizada (recomendada, porque calibra o tom das revisões e diverge entre aparelhos em silêncio) e Destaques/Kudos/Time locais. O rascunho do Codex exclui chats e não fala de pushback.
4. **Exportação local do consolidado** (proposta: complemento honesto de "o app nunca apaga"; não decidida).
5. **Diagnóstico: Markdown renderizado na tela ou só cópia** (seção 6.4).
6. **Rebase da branch deste handoff sobre a main atualizada**, se for abrir PR: ela nasceu na v2.59.2. O rascunho do Codex entrou no mesmo commit desta pasta; os documentos da reorganização já estão na main remota.

---

## 8. Gates e travas que qualquer plano precisa carregar

- Sincronização desligada: comportamento idêntico, com teste. Um aparelho só: idêntico. Versão antiga: continua coordenando.
- Nenhuma dependência nova (só `node:crypto`).
- Emulador **e** projeto real para `auth_time`, `*`, `.length` e PATCH multi-caminho antes de publicar regras.
- Regras republicadas **uma vez** (ato manual do dono no console), com sonda que detecta regra velha.
- Contraprovas: cada garantia tem uma mutação que faz um teste falhar (44 listadas na C1).
- Design de toda tela nova ou mudada vem do Claude Design antes do HTML.
- Invariante 4 do `CLAUDE.md` intacto: nada postado sem gate, dedup por head; `postLanes` é por processo, então postagem vinda de comando remoto precisa de lease na postagem.

---

## 9. Regras de trabalho que valem para quem continuar

- `CLAUDE.md` do projeto inteiro vale (invariantes, versionamento contra a release publicada, checklist de release).
- **Proibida qualquer atribuição de IA** em commit, PR ou release (instrução global do dono).
- **Nunca push direto na `main`**: branch, PR, CI verde, merge (o `pre-push` recusa).
- Gate de qualidade antes de entregar: `npm run check && npm run lint && npm test`, e `npm run eng` antes do push.
- Agentes de análise em modo somente leitura; nada toca `~/.farol`, GitHub ou Firebase sem pedido.
- Memória do dono (se a nova conta usar o mesmo diretório de config): `design-vem-do-claude-design` foi criada nesta sessão.

---

## 10. Artefatos

| Arquivo | O que é |
|---|---|
| `HANDOFF.md` | Este documento |
| `evidencias/01-mapa-verificado-dos-pedidos.json` | Mapa das 8 áreas (visão ao vivo, config remota, retenção e tela de sync, Plano e chaves, Diagnóstico, checkpoint, listas, erro e consumo), cada uma com a verificação do cético, mais o crítico de completude (conflitos, pedidos implícitos, decisões fundacionais, subprojetos) |
| `evidencias/02-c1-contrato-dados-cifragem.json` | Síntese, 3 críticas e 3 desenhos da C1 |
| `evidencias/03-s3-agendador-capacidade-completo.json` | Seção 3 completa: síntese, mapa da fila, desenho e críticas |
| `evidencias/03-s3-workflow-script.js.txt` | Script do workflow da Seção 3 (extensão .txt de propósito: ele tem return de nível superior, válido no runtime de workflow e inválido para o gate de sintaxe, que varre docs/) |
| `docs/superpowers/specs/2026-09-15-operacao-sincronizada-multidispositivo.md` | Rascunho do Codex (base, com as correções da seção 4) |
| `docs/superpowers/specs/2026-09-14-reorganizacao-estrutural-design.md` e `docs/superpowers/plans/2026-09-14-reorganizacao-fase-0.md` | Reorganização (B0, B1). Já versionados na main remota pelo PR #86 |
| `docs/superpowers/plans/2026-09-15-handoff-reorganizacao.md` | Handoff da reorganização escrito por OUTRA sessão no mesmo dia (não lido por esta) e já na main remota. Ler antes de tocar B0/B1, para não duplicar nem contradizer |
| `docs/PLANO-SINCRONIZACAO-DISPOSITIVOS.md` e `docs/superpowers/plans/2026-09-10-sync-00-contrato.md` | Plano e contrato da sincronização v1 publicada na v2.59.0 |
