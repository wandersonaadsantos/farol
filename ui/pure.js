'use strict';
/* Funcoes PURAS da UI: so dependem dos argumentos. Nao tocam DOM, nao leem STATE nem
   nenhuma global mutavel, e por isso sao as unicas do front que da pra testar com
   `node --test`. Sairam do ui/app.js, que tem ~2700 linhas e nunca teve teste nenhum
   (e a Onda 4 do docs/QUALITY.md).

   Carregado das duas pontas, sem build step: o navegador le por <script src> antes do
   app.js (as funcoes ficam no escopo global, exatamente como estavam), e o node le pelo
   rodape CommonJS la embaixo. `typeof module` no navegador e 'undefined' e nao lanca.

   REGRA: so entra aqui o que for puro. Funcao que precise de STATE, SCOPE ou document
   fica no app.js; se quiser trazer, passe o que ela le como parametro primeiro. */

// Fachada: o conteúdo mora em ui/pure/*.js desde a Fase 1a da reorganização. Cada linha
// de `export *` reexporta um módulo inteiro; nome novo nasce no módulo, nunca aqui.
export * from './pure/autoanalise.js';
export * from './pure/comum.js';
export * from './pure/consumo.js';
export * from './pure/contas.js';
export * from './pure/entregas.js';
export * from './pure/fila-justa.js';
export * from './pure/mencoes.js';
export * from './pure/meus-prs.js';
export * from './pure/pessoas.js';
export * from './pure/radar.js';
export * from './pure/review.js';
export * from './pure/sessao.js';
export * from './pure/sistema.js';
export * from './pure/sync.js';

/* ---------- folhas: sem dependencia nenhuma ---------- */


/* ---------- log de falhas agrupado (Diagnostico e aba Sistema) ----------
   O agrupamento em si e do lib/log-taxonomy.js (triage), servido em /api/log/triage:
   a UI nao pode dar require num modulo de lib/ (carrega por <script src>, sem build
   step), entao ela consome o JSON. O que mora aqui e SO a formatacao.

   Motivo de existir: o farol.log real tinha 159 linhas que eram 146 eventos de 4
   episodios (70 de limite de plano, 35 de assinatura desligada, 16 de credencial e
   credito, 13 de rede). O Diagnostico despejava as 159 cruas, e "1 problema repetido
   70 vezes" ficava indistinguivel de "70 problemas". */


/* ---------- regime x episódio: a TAXA da janela ----------
   Caso real (24/08/2026): o diagnóstico dizia "101 eventos se resolvem sozinhos, 0
   exigem ação humana" sobre 6 horas ININTERRUPTAS de falha de rede, madrugada
   inclusive. Cada evento se resolvia mesmo, e ainda assim a leitura estava errada:
   somar episódios transitórios e concluir tranquilidade esconde que aquilo não é
   episódio, é REGIME. Nesse ritmo, busca perdida e postagem que morre no meio
   voltam a acontecer o dia inteiro, e isso é decisão de gente (trocar de rede,
   cobrar o provedor), não do app.

   O cálculo é sobre o que o triage já entrega (`first`/`last`/`count`), então não
   custa dado novo. */


/* ---------- "Meus PRs": PR oculto ----------
   Motivo: experimento velho que nunca vai mergear ficava pra sempre na aba (havia PR
   pessoal parado ha 750 dias) e nao existia jeito de tirar da frente. O motor guarda as
   chaves ocultas (snapshot.hiddenPRs) e continua mandando myPRs COMPLETO: quem esconde
   e a UI, e por isso a separacao mora aqui, pura e testada.
   Ocultar nao e pra sempre: atividade nova no PR faz o motor reexibir sozinho. */


/* ---------- folhas com relogio: a hora entra por parametro, com default, pra dar pra testar ---------- */


/* ---------- ciclo de vida das operacoes (widgets showOp/updateOp/closeOp da UI) ---------- */


/* ---------- dependem das folhas ---------- */


/* ---------- checks de OPERAÇÃO (aba Sistema, ao lado dos de ambiente) ----------
   Os 5 checks que já existiam (gh, conta primária, Claude Code, Git Bash, pasta)
   respondem "o Farol consegue rodar?". Nenhum responde "o Farol vai achar
   alguma coisa?", e essa é a pergunta que fica sem resposta quando a tela vem
   vazia. O caso que motivou (Wanderson, 11/08/2026): conta cadastrada SEM
   organização nenhuma deixa os 5 verdes e o painel vazio pra sempre, porque o
   fan-out da busca é `accountList().flatMap(acc => acc.owners...)`: sem owner,
   a lista de alvos é vazia e o gh nunca é chamado. Silêncio total.

   Um check por conta (dizer QUAL conta é o que torna acionável com várias) mais
   um agregado pro caso de tudo silenciado. Sem conta nenhuma devolve vazio: aí
   quem fala é o banner de boas-vindas, e dois avisos pro mesmo problema é ruído. */


/* ---------- os três eixos de "por que isto está na sua mesa" ----------
   A pergunta que o agrupamento responde é a que o biud-frontend#774 deixou sem
   resposta: dos N motivos listados, quais foram JULGAMENTO da revisão, quais são
   regra deliberada do app e qual foi só a rede caindo? Numa lista plana os três
   se confundiam, e um 503 do GitHub lia igual a uma ressalva técnica sobre o
   código, o que fazia a automação parecer quebrada quando não estava.
   A ordem é a de quem lê: falha técnica primeiro (é a única acionável agora e
   costuma ser a que segurou tudo), regra depois (explica o comportamento), e o
   que a revisão achou por último (é o conteúdo, não o motivo do bloqueio). */


/* ---------- card de commit novo (pendência stale_head, v2.59.3) ----------
   A tela diz quem está com a bola. Até a v2.59.2 o card mandava "Peça uma revisão
   nova" e oferecia Aprovar/Pedir mudanças sobre um texto ancorado no commit anterior,
   num caso em que o round automático ia revisar sozinho minutos depois
   (Edicoes-CNBB/biblioteca-cnbb-api#22, 09/09/2026). O estado vem do engine
   (reRoundParaUi, lib/engine/review.js); aqui só vira frase. */


/* ---------- fila: o vazio que CONFIRMA ----------
   Sexto passo da onda 5. Vazio bom merece confirmar o que o app fez, nao so dizer que
   nao tem nada: quantos PRs foram aprovados sozinhos hoje, quais orgs sao monitoradas
   e de quanto em quanto tempo. Tudo isso e texto derivado de estado, entao e puro.

   `aprovadosHoje` continua no pure.js e e chamada pelo app.js, nao aqui: ela le
   `decisions.resolved`, que e estado, e o construtor recebe so o numero pronto. */


/* ---------- banner do topo ----------
   Sexto passo da onda 5. Os tres avisos que o banner pode mostrar (sem conta, conta
   sem token, falha na ultima checagem) sao decisao de TEXTO, nao de DOM: quem esconde
   e mostra o elemento continua no app.js.

   A forma e `if` plano de proposito, nao ternario encadeado: medido com scanFile, a
   escada de ternarios subiria o ternarioAninhado do pure.js de 16 pra 17, e o arquivo
   nao tem folga nenhuma nesse eixo.

   Sem `?.` tambem de proposito: snapshot sem `account` tem que explodir alto, como
   explode hoje, em vez de virar silenciosamente "Nenhuma conta detectada" e mentir
   pra quem esta olhando. */

/* ---------- painel Sistema: perfis do Claude e contas ----------
   Saiu do app.js na onda 5, quinto passo. Mesmo padrão dos anteriores: o render lê o
   estado e atribui; o CONSTRUTOR só recebe um ctx e devolve string.

   Dois pedaços ficaram no app.js de propósito, porque são DOM e não markup: o guarda
   de foco (não reconstruir enquanto a pessoa digita num campo do bloco) e o
   `hint.hidden = true` do fim dos perfis, que o listener do seletor desfaz. */


/* ---------- editor de orçamento por perfil (v2.50.0) ----------
   Centralizado: o MESMO bloco vale pra perfil de assinatura e de chave de API
   (Claude, OpenRouter, qualquer um), e cada perfil guarda o seu, independente.
   Três granularidades, do geral pro específico, que é a mesma ordem em que o
   dailyCapFor resolve: teto base, teto por dia da semana, teto de uma data só. */


/* ---------- Radar: os cards da fila e do panorama ----------
   Saiu do app.js na onda 5, quarto passo. Sao os dois maiores construtores de card
   que sobraram, e a forma e a mesma dos passos anteriores: o render le o estado,
   filtra e seta os contadores; o CARD em si so recebe o PR e um ctx.

   O acctMark ficou no app.js de proposito, e o ctx recebe o RESULTADO dele
   (ctx.mark). Ele depende de SCOPE, TWEAK e da tabela de contas, uma cadeia que
   nao tem a ver com desenhar o card: puxa-la junto arrastaria meio painel de
   contas pra ca sem ganho nenhum de teste. */


/* ---------- editor de reviewers: padrao da org e excecoes por repo ----------
   Saiu do app.js na onda 5, terceiro passo. Diferente dos blocos anteriores, aqui
   nao bastava um parametro: as funcoes liam SETE globais entre config, candidatos
   e tres Sets de estado de tela. Todas so LEEM (quem muta os Sets sao os handlers,
   que ficaram no app.js), entao o que entra e um ctx unico, montado uma vez por
   renderizacao (revCtx no app.js). E o mesmo motivo do peopleOf do primeiro passo:
   os blocos de uma mesma passada tem que enxergar o mesmo estado.

   A extracao foi de BAIXO PRA CIMA: primeiro as folhas (defaultFor, overrideFor,
   reposOfOrg, suggestDefault, addControl), e so entao o renderOrgBlock, que compoe
   todas elas. Tentar o compositor primeiro exigiria arrastar as folhas impuras
   junto.

   Fica de fora o seedException: ele muta os Sets e persiste via API, ou seja, nao e
   render. E o renderReviewersEditor, que escreve no DOM. */


/* ---------- aba Consumo: os construtores de HTML/SVG ----------
   Saiu do app.js na onda 5, segundo passo. O bloco inteiro ja era puro: nao lia
   nenhuma global, so montava string a partir do resumo de uso que o engine manda.
   O que prendia ele no app.js era a forma, nao o conteudo: cada funcao terminava
   atribuindo em `el.innerHTML`, entao parecia render de DOM. Separado o build da
   atribuicao, o app.js fica so com `el.innerHTML = xHtml(...)`.

   Fica de fora, de proposito, o drawUsageTimeline: ele mede `el.clientWidth` e ata
   listener de mouse, ou seja, precisa do elemento de verdade. O que da pra fazer
   por ele e o usageTooltipHtml, que ele chama e que veio junto.

   usageMatrixHtml devolve { html, caption } porque a versao antiga escrevia em DOIS
   lugares (a matriz e a legenda ao lado); um objeto pequeno e o jeito de manter os
   dois sem devolver o elemento. */


/* ---------- perfil de review por pessoa: papel + matriz por domínio ----------
   Molda o TOM e a POSTURA da revisão automática, nunca a decisão.
   Saiu do app.js na onda 5; o mapa de pessoas entra por parâmetro (era lido de
   STATE.config.people, global proibida aqui). Todo o grupo desce de personOf, que
   era a única leitura de global: com `people` no argumento, os cinco viram puros
   de uma vez.

   As três tabelas abaixo DUPLICAM as chaves de lib/taxonomy.js, e a duplicação é
   estrutural, não descuido: o servidor estático só serve UI_DIR (ver o
   startsWith em lib/http-server.js), então o navegador não consegue importar
   lib/. O que impede a duplicação de virar divergência é test/taxonomy-ui.test.js,
   que compara os CONJUNTOS DE CHAVES com o engine. Os rótulos ficam livres de
   propósito: aqui eles são mais curtos pra caber no <select> ("Infra" em vez de
   "Infra/DevOps", "Interm." em vez de "Intermediário"). */

/* ---------- reviewers: rótulo e chip ----------
   Saiu do app.js na onda 5. `cands` é o mapa de candidatos por org (era o global
   reviewerCands): só serve pra achar o NOME de um time a partir do id; sem ele o
   rótulo degrada pro slug do time, que é exatamente o que acontecia enquanto os
   candidatos ainda não tinham carregado. */

/* ---------- chat: o contador de mensagens no card ----------
   Saiu do app.js na onda 5; o mapa de chats entra por parâmetro (era STATE.chats,
   e o `?.` de lá cobria justamente o STATE ainda null antes do primeiro SSE). */

/* ---------- pushback: o controle das Revisões recentes ----------
   Saiu do app.js pra ganhar teste; o mapa de pushbacks entra por parâmetro
   (era lido de STATE, global proibida aqui). */

/* ---------- Revisões recentes: a linha inteira ----------
   Três colunas: ícone | conteúdo | quando + ações. A coluna da direita era só o
   relógio e todo o resto empilhava na do meio, então a metade direita da linha ficava
   em branco em qualquer largura usável. Título do PR, autor e o relatório da revisão
   já chegavam no estado e não apareciam.
   A barra esquerda colorida NÃO entra aqui: ela significa urgência (ver acctMark no
   app.js) e esta seção é histórico resolvido. A cor do desfecho vive no selo.
   O que depende de estado global (chip da conta, contador de chat, mapa de pushbacks)
   entra por ctx já resolvido em valor, porque aqui não se lê global.
   Autor em linha própria (.rr-person), fora do .rr-title: o título tem
   white-space:nowrap + ellipsis, e o autor vivia dentro dele, então um título
   comprido empurrava o autor pra fora e ele sumia sem aviso nenhum (era o bug
   relatado). Foto vem do mesmo avatar() que a fila, "precisa de você",
   destaques e time já usam, fechando a inconsistência visual desta tela com
   o resto do app. */


/* ---------- montagem da aba Entregas v2 (busca, estatísticas, atividade,
   grupos com progresso/rank/paginação). Releitura desenhada no Claude Design,
   projeto "Revisão página entregas" (`Entregas v2.dc.html`). ---------- */


/* ---------- Sistema > Sobre: créditos sincronizados com o GitHub ----------
   Idealizador = dono do repo do update; contribuidores = API de contributors
   do mesmo repo (colaborador novo no git aparece sozinho, sem manutenção).
   Toda pessoa sai por personMention (menção navegável com foto, regra do app).
   Sem dado ainda (boot, gh sem login, rede) = aviso explicativo, nunca vazio
   mudo: silêncio sem explicação é o defeito do check de monitoramento (M-op). */


/* ---------- diagnóstico ----------
   O texto que a pessoa copia e cola quando vem pedir ajuda. É a única saída do app que
   alguém lê fora do app, então mudança aqui é mudança de contrato com quem socorre.
   Cada ternário mora no seu próprio `const` porque o ratchet conta '?' por statement e
   este arquivo não tem folga nesse eixo. */


/* ---------- site do Jira: o que a tela recusa antes de mandar pro servidor ----------
   O saneador do servidor (normalizeBaseUrl/parseJiraSites, lib/jira/sites.js) não
   corrige nem avisa: URL fora de forma faz o site INTEIRO ser descartado, então
   rótulo, orgs e prefixos somem enquanto a tela diz "Configurações salvas". As
   regras espelhadas aqui são as de lá, e o porquê de cada uma mora naquele arquivo.
   Prefixo é exigência da TELA, não do modelo: sem nenhum, o extractCardKeys aceita
   qualquer PALAVRA-NUMERO do título (UTF-8, SHA-256, ISO-8601), o Farol pede esse
   "card" ao Jira, toma 404 e o PR perde o auto-approve por falha inventada. */


/* ---------- U4: o Consumo de todos os aparelhos ----------

   O resumo vem inteiro do engine (consolidatedSummary, em lib/sync/consolidated.js):
   a tela só formata. Envelope com ok:false mostra o MOTIVO, nunca uma tela vazia muda,
   que seria indistinguível de "não gastei nada". */

