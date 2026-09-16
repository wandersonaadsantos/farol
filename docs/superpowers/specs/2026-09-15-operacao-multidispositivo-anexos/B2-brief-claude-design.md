# B2: brief para o Claude Design (operação multidispositivo e melhorias gerais)

**Para quem:** o Claude Design, que desenha as telas (D9). Este brief descreve **estados,
dados e ações**, não layout. O layout, a arquitetura de abas e o estado visual saem do
desenho; a implementação só começa depois dele.

**Base:** spec `2026-09-15-operacao-multidispositivo-design.md` (seções 5 a 8), anexos C1
e S3, e o código integrado em `md/integracao`. Estado da implementação em
`docs/superpowers/handoff/2026-09-15-operacao-multidispositivo/EXECUCAO.md`.

**Regras que valem para o desenho inteiro**

- O **Farol atual é a referência**: seis abas (Radar, Entregas, Destaques, Time, Consumo,
  Sistema) e, em Sistema, as seções Visão geral, Contas, Automação, Conexões, Jira,
  Sincronização, Plano e chaves, Reviewers, Preferências, Novidades, Diagnóstico e Sobre.
  Reorganizar é permitido quando o desenho justificar; **nenhuma capacidade aprovada some**
  e **nenhuma capacidade nova é inventada**.
- Interface sem framework, Node puro, **zero dependências novas**. O desenho não pode
  pressupor biblioteca de componentes, fonte externa carregada em tempo de execução nem
  ícone remoto.
- Texto em **português**, **sem travessão** (vírgula, parênteses ou dois pontos).
- **Menções navegáveis** (regra de usabilidade do `CLAUDE.md`): pessoa leva ao perfil com
  foto, repositório ao repositório, PR ao PR, ferramenta ao painel dela; dois destinos no
  mesmo lugar são dois elementos; clique que não leva a lugar nenhum é proibido.
- **Tema claro e escuro**, contraste AA, foco visível, navegação por teclado, alvo de toque
  de 44 px no celular.
- **Dois tamanhos obrigatórios em toda tela:** desktop largo (1280 px ou mais) e celular
  estreito (360 a 400 px). No celular: navegador do próprio aparelho, conexão instável,
  nenhuma rolagem horizontal.
- **Dados sintéticos** e identificados como tais em todo artefato de desenho: pessoas
  "Ana Exemplo", "Bruno Teste"; organização "acme-exemplo"; aparelhos "Notebook de teste",
  "Celular de teste", "Desktop antigo"; nada de login, PR, commit ou texto de colega real;
  nenhum token, e-mail ou chave, nem mascarado de forma que pareça real.
- **Proteção desligada não aparece como ativa.** Capacidade presa por medição ou por
  validação mostra o estado "ainda não ativo" e o porquê, nunca um selo de protegido.
- **Falha não se disfarça de vazio.** Todo painel tem, separados: carregando, vazio
  legítimo, falha com motivo, indisponível (dependência fora) e desligado (escolha).

---

## 1. Problemas medidos que o desenho resolve (insumo obrigatório da spec)

1. **Diagnóstico com nomes divergentes das ferramentas e dois botões "Limpar"** que fazem
   coisas diferentes com o mesmo nome (A3).
2. **Plano e chaves** tem descrição de assinatura, mas a tela configura chave de API,
   OpenRouter e Codex (A2).
3. **Promessa de privacidade imprecisa** na Sincronização: a tela precisa dizer o que é
   local, o que é compartilhado cifrado e o que a coordenação expõe (resumos sem chave:
   conta, PR e commit são descobríveis testando nomes conhecidos).
4. **Lacunas de clareza** (`2026-09-12-clareza-do-que-acontece-fora-do-app-mapeamento.md`):
   ações que só existem fora do app (login do `gh`, trocar conta ativa, conferir token,
   token do Atlassian, projeto do Firebase, instalar `gh` e `claude`); **zero links de
   ajuda**; diagnóstico que diz o que É e não o que FAZER; a mesma frase escrita em oito
   lugares; comando numa sintaxe de shell só; vocabulário interno sem glossário; o vazio
   da fila citando a organização errada.
5. **Local x compartilhado:** Destaques, Kudos e Time são locais; a tela precisa deixar
   isso claro onde houver compartilhamento por perto.

---

## 2. Inventário de telas

Cada item traz: **dados** (de onde vêm), **ações** (rota e desfechos) e **estados**. Os
nomes de campo e de rota são o contrato real; onde o contrato ainda não existe, o item
diz "contrato a completar" e ele é implementado junto da tela, sem inventar
funcionalidade.

### 2.1 Primeiro uso e autenticação local (A4)

**Dados.** `GET /api/auth/status` → `{ exigida, autenticado }`.

**Ações.**
- Parear: `POST /api/auth/pair` com `{ codigo, rotulo }` → `{ ok: true, token }` ou
  código inválido. O código é gerado **no terminal do próprio aparelho** por
  `node tools/farol-parear.js` (10 caracteres base32, 10 minutos, uso único, 5 tentativas).
- Revogar todas as sessões: comando local `node tools/farol-parear.js --revogar-todas`.
- Revogação individual de sessão: **contrato a completar** (a spec prevê a tela; hoje só
  existe o comando de revogar todas).

**Estados.**
- autenticação não exigida (desktop): nada muda, nenhuma tela extra;
- exigida e não autenticado: **a interface inteira troca pelo pareamento**; nada do estado,
  relatório, log, chat ou eventos aparece antes;
- código errado (com tentativas restantes), código vencido, código já usado, bloqueado
  por tentativas;
- sessão expirada ou revogada no meio do uso: volta ao pareamento sem perder o que o
  usuário estava digitando;
- exigência automática no celular **ainda não ativa** (`ATIVACAO_AUTOMATICA_A4` falso):
  a tela de Sistema diz isso, sem selo de protegido.

### 2.2 Plano e chaves (A2)

**Dados.** `config.claudeProfiles` (perfis: id, nome, tipo claude, apikey, openrouter,
codex; diretório de config), `doctor` (identidade detectada), vínculo do perfil ao grupo
de consumo (`sync.gruposDeConsumo[].controlados|naoControlados`).

**Ações.**
- **Testar perfil** (primeira validação, no molde de "Testar conexão"): **contrato a
  completar**; devolve identidade detectada (e-mail do `oauthAccount`, tipo de
  autenticação) e a origem de cada informação.
- Abrir sessão de login do perfil: `POST /api/claude-login` (já existe).
- Salvar perfil: `POST /api/settings` (já existe). **Nunca escrita silenciosa**: quem usa
  sem perfil recebe cartão guiado com confirmação.
- Vincular perfil a grupo: `POST /api/sync/link` com `{ perfilId, grupo, tipo }` ou
  `{ perfilId, desvincular: true }`.

**Estados.** perfil detectado, informado, validado, inferido ou desconhecido (origem de
cada campo); nome comercial do plano **não detectável** (dizer isso); perfil apagado ou
override para id inexistente = **erro**, nunca "usa o padrão"; selo que atualiza depois
do fim da sessão de login; Codex sem custo por sessão ("não controlado" em grupo).

### 2.3 Diagnóstico unificado (A3)

**Dados.** `GET /api/doctor`, `GET /api/log/triage`, falhas duráveis da A1
(`falhasRecentes`, `falhaDaSessao`), checks de ambiente, operação e runtime.

**Ações.** Ver falha (Markdown renderizado **inerte**); **copiar** a representação
textual (nunca HTML); "Diagnóstico com o Claude" em modo somente leitura; exportar
diagnóstico; os dois "Limpar" renomeados pelo efeito (por exemplo "Apagar log de falhas"
e "Limpar resultado da ferramenta").

**Estados.** sem falhas; falhas agrupadas por classe com a ação sugerida; falha com
episódio da sessão; conteúdo malicioso (script, `javascript:`, imagem remota, handler,
token no meio da linha) aparecendo escapado e mascarado; menção `@login` inerte.

### 2.4 Sincronização: conexão, chave e interruptores (C0, C1)

**Dados.** `sync.enabled|coordination|consolidation|shared`, `sync.status`,
`sync.lastError`, `sync.uid` (cortado), `sync.email`, `sync.deviceId|deviceName`,
`sync.chave` (`desligada|bloqueada|pronta|perdida`), `sync.outbox`.

**Ações.** Entrar (`/api/sync/login`), testar (`/api/sync/test`), sair
(`/api/sync/logout`), **desbloquear a chave com a senha** (`/api/sync/unlock`),
**gerar chave nova** (`/api/sync/new-epoch`, com aviso do que se perde), interruptores
(`/api/settings`: `sync.enabled`, `coordination`, `consolidation`, **`shared`**,
**`distribution`**), consolidar histórico de consumo (`/api/sync/consolidate`).

**Estados.** desligada; conectando; conectada; degradada ("o Firebase não respondeu no
último ciclo", automação esperando, clique continua com confirmação); chave bloqueada
(pede senha); chave perdida (saída explícita com senha, nunca recriada sozinha); senha que
não abre a chave; redefinição de senha do Firebase **não** abre a chave antiga (dizer).
Privacidade: o que é local, o que sobe cifrado, o que a coordenação expõe.

### 2.5 Aparelhos e administração (C2a, C2b, C6 designação)

**Dados.** `sync.devices[]` (nome, sistema, **versão do Farol**, visto por último,
aposentado, "este"), admin vigente e geração (**contrato a completar** na projeção),
consentimento local `sync.aceitarAdmin`, `sync.designacaoAdmin`.

**Ações.** Tornar este aparelho admin (`/api/sync/admin` com a senha); renomear e
aposentar aparelho (`/api/sync/device`); **publicar política de um aparelho**
(pausar, teto de paralelismo, tipos permitidos: fachada existe, **rota a completar**);
consentir ou retirar consentimento de obedecer ao admin (`/api/settings`
`sync.aceitarAdmin`); revogar o conjunto (`/api/sync/revoke`, com senha).

**Estados.** primeiro aparelho; vários; admin e secundário; admin sem sinal de vida
(autoridade vencida); aparelho em versão antiga (**garantia não coberta**, por conta:
`sync.coberturaPostagem`); pedido de designação esperando a senha deste aparelho;
política aceita, recusada (com o motivo da ordem comum: forma, geração, assinatura,
autoridade, antiga, cifra) ou sem consentimento.

### 2.6 Grupos de consumo e teto (C2b, C4b)

**Dados.** `sync.gruposDeConsumo[]`: id, nome, período, teto, `ativo`, `estado`
(`nao-identificado|sem-teto|configurado|ativo`), `controlados`, `naoControlados`,
`requisitos` (o que falta para ativar: `compartilhamento`, `sem-grupo`, `sem-teto`,
`medicao-pendente`), `verificavel`, `custoUsd`, `parcialmenteEstimado`.

**Ações.** Criar ou editar grupo (`/api/sync/group`, admin); ativar (`ativo: true`,
recusado com `ativacao-bloqueada` e a lista do que falta); vincular perfis
(`/api/sync/link`).

**Estados.** perfil sem vínculo; grupo sem teto; teto configurado e **não ativo**
(medição pendente, sem selo de protegido); ativo e verificável; **não verificável** (com o
motivo: lacuna, rollup inválido, aparelho sem dados, reserva vencida, retrato velho,
perfil não identificado) segurando o automático **e o clique**, sem estacionar; teto
estourado (projeção da reserva mostrada como projeção, "teto macio"); parcialmente
estimado; tipo não controlado (Codex) em seção própria, nunca como consumo zero.

### 2.7 Visão compartilhada (C3a a C3h)

**Dados.**
- capacidade e presença dos aparelhos (tabela de aparelhos);
- **andamento remoto** (etapa, tempo, subagentes, modelo): evento SSE próprio
  `sync-live` (`{ operacoes }`), a cada giro do relógio, nunca pelo snapshot;
- **pendências remotas** ("precisa de você") e visto: evento SSE `sync-pending`
  (`{ pendencias, novas }`); marcar visto `POST /api/sync/seen`;
- história de revisões de outros aparelhos: `POST /api/sync/reviews` (lista),
  `POST /api/sync/review-body` (corpo);
- Panorama e Meus PRs de outros aparelhos (escopos) e memória de pushback;
- envio do histórico local: `POST /api/sync/history-measure` (quanto seria enviado),
  `POST /api/sync/history-send` (com a impressão da medida).

**Estados.** revisão local e remota; sem outro aparelho pronto (nada sobe, dizer por
quê); leitura que falhou (visão anterior mantida, envelhecendo); conteúdo que não abre
(fica de fora e é contado como não verificável); histórico volumoso (medição antes de
enviar); notificação em todos e "visto" que cala os outros; o que é local (Destaques,
Kudos, Time).

### 2.8 Distribuição e fila global (C4, C5)

**Dados.** interruptor `sync.distribution`; modo do aparelho (`distribuido|local`,
runtime `sync.sinais.modo`); itens esperando distribuição (`headlessDistribuindo`),
admissão local (reservas, execuções, teto efetivo, pausa, memória); **projeção a
completar** para os três.

**Ações.** Ligar ou desligar a distribuição; nenhuma ação manual de colocação além dos
comandos (2.9).

**Estados.** candidato esperando com motivo (e sem progresso inexplicado); fila vazia;
**sem executor apto**; admin (distribuidor) indisponível e **janela de até três
intervalos sem ninguém enfileirar** mostrada como estado, não como silêncio; volta ao
modo local (itens devolvidos aos poucos); recusa do executor com código (`saida_de_cena`,
`sem_token`, `head_mudou`, `orcamento`, `sem_vaga`, `inapto`) e espera; aparelho pausado;
sem vaga; memória desconhecida (não admite); **recusa por peso ainda não ativa**.

### 2.9 Comandos remotos, transferência e tomada (C6, C7b, C8)

**Dados.** comandos emitidos e seus recibos (`estado`: `aplicado|recusado|ignorado|
pendente`, `code`, `at`): recibo lido por `desfechoDe`, **rota a completar**; tomadas
feitas e sofridas (`sync.tomadas`, `sync.tomadasSofridas`: de, para, geração, risco
`provavel|possivel`, quando).

**Ações.** `POST /api/sync/command` com `{ alvo, tipo, args }`, tipos: `cancelar`,
`repetir`, `decidir` (vai ao aparelho dono da pendência), `iniciar`, `transferir`
(`destino`), `tomar` (**exige `confirmado: true` depois de mostrar o aviso**),
`designar-admin`. **Aviso da tomada antes de confirmar**: texto pronto em
`avisoDaTomada`, **rota a completar**.

**Estados.** comando enviado (**nunca "concluído" sem recibo**); pendente com executor
offline (vale até o prazo, revalida ao voltar); recusado com código; ignorado com o porquê
(sem consentimento, geração antiga, assinatura inválida, admin sem sinal, vencido);
concluído; transferência recusada por destino inapto (sem resumo, pausado, sem IA, sem
vaga, **sem credencial**); herança da memória (integral, parcial, reinício); tomada com o
aviso de que o processo do outro aparelho não é encerrado e a análise pode custar duas
vezes; tomada sofrida (este aparelho foi tomado, nada será postado por ele).

### 2.10 Limpeza protegida e revogação (C2b)

**Dados.** estado da chave de limpeza (**projeção a completar**), categorias alcançáveis.

**Ações.** ligar e desligar a chave de limpeza (`/api/sync/cleanup-key`), limpar
(`/api/sync/cleanup` com senha recente e categorias), revogar (`/api/sync/revoke`).

**Estados.** chave desligada, ligada, **bloqueada** (servidor não confere senha recente:
a limpeza não é publicada, D8); limpeza em andamento (trava de 10 minutos); o que nunca é
apagado (chaveiro, leases, recibos).

### 2.11 Postagem coordenada e retomada (C0b, A5)

**Estados.** postagem com **resultado incerto** (enviando sem desfecho: entra em
reconciliação, não tenta de novo); não enviada com motivo (posse alheia, posse perdida,
**posse tomada**); retomada de sessão, recusa do `--resume` pelo CLI e sessão nova;
falha copiável da sessão.

---

## 3. Estados obrigatórios (lista da spec, seção 8), para conferência

desktop largo e celular estreito; primeiro aparelho e vários; admin e secundário;
aparelho conectado com distribuidor indisponível e aparelho sem presença; candidato
esperando com motivo e sem progresso inexplicado; fila vazia e sem executor apto; revisão
local e remota; retomada, recusa do CLI e sessão nova; comando pendente; transferência e
tomada; autenticação local exigida e pareamento; sincronização degradada; garantia "não
coberta" por aparelho em versão antiga; perfil sem vínculo, grupo sem teto e teto não
controlado; postagem com resultado incerto; histórico volumoso; falha copiável; chave de
limpeza desligada, ligada e bloqueada; o que é local (Destaques, Kudos, Time) e o que é
compartilhado.

## 4. Critérios de aceite do desenho

1. Cada item da seção 2 tem tela ou estado desenhado nos dois tamanhos.
2. Cada estado da seção 3 aparece em pelo menos um quadro.
3. Nenhum quadro usa dado real, credencial ou pessoa real.
4. Nenhuma capacidade desligada aparece como ativa; nenhuma capacidade nova aparece.
5. Toda ação tem o desfecho de sucesso, de recusa com motivo e de indisponibilidade.
6. O desenho não exige dependência nova nem recurso remoto em tempo de execução.
7. Os textos seguem as regras (português, sem travessão, ação sugerida junto do
   diagnóstico, links de ajuda onde a ação é fora do app).

## 5. Contrato a completar (implementado antes das telas, sem funcionalidade nova)

| Tela | Contrato | Estado |
|---|---|---|
| 2.1 | sessões da A4: `POST /api/auth/sessions` (id público, rótulo, datas, `atual`) e `POST /api/auth/revoke` `{ id }` (`eraAtual` quando revoga a própria) | **feito** |
| 2.2 | teste do perfil com identidade detectada e origem de cada campo (`POST /api/claude/profile-test`, `POST /api/claude/profile-adopt`) | **feito** |
| 2.4 | `sync.bloqueioCompartilhamento` (`autenticacao-local` no celular sem exigência) | **feito** |
| 2.5 | `sync.admin` (`deviceId`, `generation`, `souEu`, `fresca`); `POST /api/sync/policy` `{ deviceId, politica }` | **feito** |
| 2.7 | andamento e pendências remotas por SSE (`sync-live`, `sync-pending`) | já existia |
| 2.8 | `sync.distribuicao` (`modo`, `esperando[{ key, desde }]`), `sync.admissao` (`ocupadas`, `porEstado`, `porTipo`, `teto`, `pausado`) | **feito** |
| 2.9 | `sync.comandosEmitidos[{ cmdId, tipo, alvo, at }]`; `POST /api/sync/command-status` `{ cmdId }` → `recibo` ou `null`; `POST /api/sync/takeover-notice` `{ prKey, account }` → `podeTomar`, `dono`, `risco`, `aviso` | **feito** |
| 2.10 | `POST /api/sync/cleanup-state` → `estado` (`compartilhamento-desligado`, `desligada`, `ligada`, `desligada-ou-nao-verificavel`) | **feito** |

Acrescentado na rodada de fechamento das lacunas (16/09/2026 à noite), sempre projeção do
que o engine já sabia, sem funcionalidade nova:

| Tela | Contrato | Estado |
|---|---|---|
| 2.3 | `GET /api/diagnostics` → `{ ok, markdown, falhas }`, com a ação sugerida por classe | **feito** |
| 2.5 | `POST /api/sync/policy-read` (política vigente no banco, para o formulário abrir com ela); `POST /api/sync/designation-decline` (recusar a designação, com recibo); `sync.admin.ultimoBatimentoEm`; `sync.versaoPostagemCoordenada`; `devices[].semPresenca`, `.contract` e `.keyReady` | **feito** |
| 2.6 | `resumoParaTela` com `motivos`, `calculadoEm`, `tetoAtingido` e `projecaoUsd`; `POST /api/sync/link` devolve o `vinculo`; `sync.vinculosDePerfis` | **feito** |
| 2.7 | `POST /api/sync/lists` e evento `sync-lists` (Panorama e Meus PRs de outros aparelhos, leitura incremental); `pr: { key, account, title, author } \| null` nas pendências, no andamento e nas revisões, resolvido pelo catálogo cifrado (`prDaTag`); `POST /api/sync/reviews` responde `naoAbriram` e falha como falha; medida e lote do envio levam `lote` e `lotes` | **feito** |
| 2.9 | `POST /api/sync/transfer-targets` `{ dono, acctTag }` → destinos com `apto` e `motivo`; `sync-live.operacoes[].matTag`, `.heranca` e `.pr`; `sync.comandosEmitidos[].prTag|prKey|destino`; `sync.distribuicao.esperando[].motivo` | **feito** |
| 2.10 | `cleanup-state` devolve a trava viva, as categorias alcançáveis e as nunca apagadas; `POST /api/sync/cleanup` devolve `apagadas`, `falharam` e `corteGravado` | **feito** |
