# Changelog do Farol

Notas de versão do Farol (radar de Pull Requests). O `tools/publish-release.ps1`
publica a seção da versão atual como corpo da release no GitHub, então escreva
aqui pensando em quem instala e usa, não no código.

Convenção: cada versão tem uma linha de resumo e os grupos **Novidades**,
**Melhorias** e **Correções** (só os que existirem). Descreva só o que mudou:
o `publish-release.ps1` anexa sozinho o rodapé padrão (**Instalar / Atualizar**
e **Anexos**, de `tools/release-footer.md`) e o título **Farol vX.Y.Z**.

## v2.45.1

Migração da plataforma de código e gate automático de qualidade, baseado em ratchet,
que segura a regressão de todas as correções da onda 1.

**Melhorias**
- **Código baseado em ESM puro.** O `package.json` declara `"type": "module"` e
  todo arquivo `.js` é importado como módulo nativo (zero emulação CommonJS). Fim
  do truque de carga dupla que a UI precisava pra rodar em ambos Node (testes)
  e navegador (Electron). O check de sintaxe passa a usar `node --check` em
  subprocesso, em vez de parser customizado, capturando erros reais. Engines
  declarado: `>=22.12` (abaixo disso o require/interop de ESM nos fluxos de
  teste não é confiável).
- **Gate de qualidade por ratchet.** O comando `npm run lint` (rodado antes de
  commitar) compara as violações reais do código contra a baseline gravada em
  `tools/quality/baseline.json`. Hoje monitora 10 regras: tamanho de arquivo,
  catch vazio, `var`, `JSON.parse` cru, `JSON.stringify` cru, acesso direto de
  `process.env`, ternário aninhado, tempo mágico, porta literal (escrita na
  mão fora de `lib/constants.js`) e profundidade de função excedida (a
  checagem de referência de card solta na documentação é irmã, separada
  dessas 10, e vive em `higiene.js`). Violação que regride sai vermelho;
  liberação de dívida documentada sai verde apenas com `npm run lint:update`.
  A baseline nunca sobe à mão.

**Correções**
- Redução de violações (baseline da onda 1): portaLiteral 6→0, processEnvDireto
  19→11, jsonParseCru 32→26, emptyCatch 20→17, tempoMagico 12→10,
  profundidadeExcedida 87→82, ternarioAninhado 99→98. Estáveis: maxLines 7,
  jsonStringifyCru 10.
- Extração e refino: `check()` reduziu de 297 linhas para 74, handler de
  sessão achatado com delegação clara aos colaboradores, e `buildFixPrompt` é
  função pura.

## v2.45.0

Suporte experimental a Linux: o Farol passa a rodar nos três sistemas.

**Novidades**
- **Linux (experimental).** Instalador próprio (`bash installer/install-linux.sh`):
  app em `~/.farol/app`, lançador `~/.farol/bin/farol` e atalho no menu de
  aplicativos (.desktop). Desinstalador junto (`uninstall-linux.sh`).
- **Sessões de terminal no Linux**: abrem no emulador disponível, na ordem
  x-terminal-emulator → gnome-terminal → konsole → xterm; sem nenhum instalado,
  o app avisa com instrução em vez de falhar em silêncio.
- **Auto-update no Linux**: mesmo contrato dos outros SOs, reabrindo o app pelo
  lançador ao final.
- Validação real num Ubuntu (WSL): suíte completa verde no Linux (1110 testes,
  incluindo os POSIX que só rodavam stubados: cancelamento de sessão matando o
  grupo de processos de verdade) e o app instalado abrindo com o engine no ar.

**Melhorias**
- Instalador do macOS e do Linux agora contornam npm que pula o postinstall do
  Electron (baixam o binário direto pelo install.js quando o dist não veio).
- Plataforma fora das três suportadas ganha aviso claro no boot.

Fora do escopo desta versão (decisão, não esquecimento): bandeja, autostart,
notificações polidas e instalador offline no Linux.

## v2.44.3

Revisão completa de suporte aos dois sistemas (Windows e macOS): auditoria em 4
frentes (engine, interface, instalação, testes) com os consertos aplicados.

**Correções (macOS)**
- **Sessão de terminal não fica mais presa** quando o config não tem porta: a
  URL de aviso de fim de sessão virava `:undefined` e o app nunca sabia que a
  sessão acabou (pill preso e botão Atualizar bloqueado por até 12h).
- **Conta sem token aborta com aviso.** Abrir sessão de terminal por uma conta
  não autenticada no gh agora falha alto (como no Windows), em vez de seguir em
  silêncio agindo pela conta errada do keyring.
- **Console de login não herda GH_TOKEN** exportado no profile do usuário, e o
  script de login ficou com permissão 0700 (era legível por qualquer usuário da
  máquina, podendo conter chave de API).
- **Instalador e auto-update não exigem mais Node.** O modo offline (Electron
  embutido) instalava e atualizava só com o que vem no pacote, mas um requisito
  indevido de Node derrubava os dois em Mac sem Node.
- **Validação da instalação confere o binário certo**: o Electron nativo que o
  lançador executa, não o wrapper que existe mesmo com a instalação quebrada.
- **Instalar.command oferece abrir o Farol ao final** (o app vai pra
  ~/Applications, que não aparece na barra lateral do Finder).
- Notificações e bandeja usam PNG (o mac não decodifica .ico), diagnóstico de
  processos (spawns.log) passou a registrar também as sessões do mac, e volume
  APFS case-sensitive não é mais tratado como se fosse Windows.

**Correções (Windows)**
- **Update remove arquivo deletado**: a cópia era aditiva e arquivo removido em
  versão nova sobrevivia pra sempre em ~/.farol/app.
- **O desinstalador acompanha a instalação**: quem instalou pelo Setup.exe e
  apagou o download não tinha como desinstalar.

**Correções (interface, os dois SOs)**
- Atalhos exibidos com a tecla do SO real: Cmd/⌘ no mac, Ctrl no Windows (modal
  de atalhos e botão da paleta, que misturava as duas convenções).
- Exemplos de caminho nos perfis do Claude seguem o SO (~/ no mac, C:\ no
  Windows), e a fonte mono tem par mac explícito (SF Mono/Menlo).

**Melhorias**
- Auditoria anti-vazamento do pacote passou a varrer também `*.sh` e
  `*.command` (os artefatos de mac viajavam sem pente de credencial).
- 8 testes novos de plataforma: script de update do mac (com caminho com espaço
  e apóstrofo), cancelamento de sessão posix com processo real, PATH do boot do
  mac como função pura, quoting dos scripts de sessão e paridade do console de
  login.

## v2.44.2

Completa o conserto da v2.44.1: o progresso honesto virou régua única e central
pra todo o app, não só pra autoanálise.

**Correções**
- **Revisão automática com barra de progresso.** Os cards do "Analisando agora"
  (Radar) mostravam só o feed e o cronômetro; agora têm barra e percentual,
  movidos pela mesma atividade real da sessão que alimenta o feed.
- **Chat por PR sem o 25% eterno.** A pill "Claude respondendo" tinha o mesmo
  defeito da autoanálise (percentual fixo até concluir do nada); agora cada
  passo real da sessão move a barra.
- **Régua central e travada.** O percentual dos três fluxos (autoanálise,
  revisão automática e chat) sai de uma única função (`sessionProgress`, em
  ui/pure.js): sempre crescente, teto em 90%, fechamento só quando a sessão
  termina de verdade. Um teste novo reprova qualquer percentual chutado que
  tente voltar pro código.

## v2.44.1

Conserto da barra de progresso da autoanálise em Meus PRs, que nunca funcionou
sem bug: ficava parada em 25% e concluía do nada.

**Correções**
- **A barra de progresso da autoanálise agora acompanha a sessão de verdade.**
  Os percentuais eram dois números fixos (5% ao clicar, 25% quando a sessão
  entrava na fila) e nada os atualizava depois. Agora o feed ao vivo da sessão
  alimenta o widget: cada ação do Claude (ler arquivo, rodar comando) move a
  barra e vira o texto do passo, o avanço é sempre crescente até o teto de 90%,
  e os 10% finais fecham quando a análise conclui de fato. A barra nunca mais
  promete um percentual que não mediu.

## v2.44.0

**Novidades**
- **Remover membro do Time.** Cada card do Time ganhou o botão **Remover**, pra
  quando alguém sai da equipe: apaga da máquina tudo o que o Farol guarda sobre
  a pessoa (dossiê de reviews em todos os grupos, destaques, papel e matriz de
  competência, registros de contestação). Nada é alterado no GitHub. Como é
  ação destrutiva, o botão só abre um modal de confirmação explicando o efeito;
  nada acontece sem o clique em Remover.

**Melhorias**
- **Adeus, popups fora da identidade do app.** A confirmação de "Atualizar
  agora" trocou o alerta nativo do sistema por um modal do próprio Farol, que
  explica o que vai acontecer (baixa e instala sozinho, fecha e reabre no fim,
  estado e configurações intactos, e sessão em andamento nunca é morta no
  meio). A confirmação de "Zerar log" recebeu o mesmo tratamento, e com isso
  não resta nenhum popup nativo no app.
- **Crédito de origem nos Créditos.** A seção Sistema > Sobre agora registra a
  origem do projeto: o Farol nasceu de uma iniciativa do Thiago
  (@thiagopcdev), um revisor de PRs que rodava numa janela de terminal, e o
  app atual foi reconstruído em cima dessa essência. O README conta a mesma
  história.

## v2.43.0

**Novidades**
- **Seção "Sobre" na aba Sistema.** Três cartões: **Privacidade** (o Farol não
  coleta nem envia nenhum dado a quem o mantém; não há telemetria, tudo fica em
  `~/.farol` e o tráfego de rede é todo em nome do usuário), **Licença** (MIT,
  com link pro texto completo no repositório) e **Créditos**, com o idealizador
  e os contribuidores do projeto, cada um com foto e link pro perfil no GitHub.
  A lista de créditos é sincronizada com o repositório de origem (a mesma fonte
  do auto-update), então colaborador novo que entrar no git aparece sozinho na
  seção, sem release nem edição manual; a busca roda no máximo uma vez por dia
  e falha de rede mantém a última lista boa em vez de esvaziar a tela.

## v2.42.2

**Melhorias**
- **Sessão antiga sem carimbo de versão deixou de aparecer vazia.** Na coluna
  "Farol" das Sessões recentes, sessões registradas antes da v2.42.0 (quando o
  carimbo de versão passou a existir) agora mostram "< 2.42.0", com explicação
  ao passar o mouse. É regra de exibição: o registro permanente em disco segue
  intocado, sem retro-carimbo inventado.

## v2.42.1

**Melhorias**
- **Licença e transparência.** O projeto ganhou o arquivo `LICENSE` (MIT, que
  o `package.json` já declarava sem o texto correspondente) e o README ganhou
  a seção "Privacidade e responsabilidade": o Farol não coleta nem envia dado
  nenhum ao mantenedor (não há telemetria; tudo fica em `~/.farol`), o tráfego
  de rede é todo em nome do usuário (GitHub via `gh`, Anthropic via Claude
  Code) e as automações de postagem são opt-in, sob responsabilidade de quem
  as liga.

## v2.42.0

**Novidades**
- **Cada sessão registra a versão do Farol que a produziu.** A tabela "Sessões
  recentes" da aba Consumo ganhou a coluna "Farol": toda revisão, autoanálise,
  pushback, chat ou ferramenta fica carimbada com a versão do app que rodou a
  sessão, dando contexto de auditoria junto do modelo e do custo. Sessões
  registradas antes desta versão aparecem com a célula vazia (registro
  permanente, sem retro-carimbo inventado). A versão NUNCA aparece no texto de
  review postado: a trava de linguagem pública passou a bloquear qualquer
  menção de proveniência com versão ("gerado pelo Farol vX.Y.Z"), continuando
  a permitir menção técnica legítima quando o assunto do PR é o próprio Farol.

## v2.41.4

Terceira e última onda da correção dos gaps da auditoria: ciclo de vida e
higiene. Fecha a campanha dos 21 gaps mapeados em 15/08.

**Correções**
- **Atualizar com sessão de terminal aberta não mata mais a sessão.** O
  auto-update passa a esperar sessões de terminal também (não só análises e
  chat). Sessão de terminal esquecida há mais de 12 horas é tratada como
  abandonada e deixa de segurar a atualização.
- **Revisão que falhou de vez continua parada depois de reiniciar.** O
  estacionamento (revisões aguardando sua ação após falha não-transitória ou
  cancelamento) agora persiste em disco: reiniciar o app (inclusive pelo
  auto-update) não relança mais sessões fadadas à mesma falha. A limpeza do
  estacionamento respeita falha de rede (não solta nada quando a busca do
  ciclo falhou) e PRs de organizações fora da sua configuração.
- **Teto de gasto vale até pra fila que já estava andando.** O orçamento do
  perfil é re-checado na boca de cada sessão: lote enfileirado antes do
  estouro não atravessa mais o teto; os PRs barrados estacionam com um aviso
  único por perfil e voltam por clique.
- **Voltar horas depois e concluir a revisão no terminal funciona.** A
  autorização de postagem da sessão de terminal vale enquanto a sessão viver
  (com teto de 12 horas), em vez de expirar em 2 horas no meio do seu almoço.
- **Duas contas pedindo o mesmo review: a conta capaz responde.** Se o mesmo
  PR chega por duas contas e a primeira está silenciada ou sem login, a outra
  assume, em vez de o PR ficar mudo.
- **Clique duplo no Merge não gera mais alerta vermelho falso.** A segunda
  chamada é recusada com aviso discreto, sem tocar o GitHub e sem sujar o log.
- **Downloads antigos de atualização são limpos.** Diretórios de update com
  mais de 24 horas são removidos a cada nova tentativa (o acúmulo chegava a
  centenas de MB).
- **Perfil de assinatura vale mesmo com chave de API no ambiente.** No
  macOS/Linux o login shell podia re-injetar credenciais do seu perfil de
  shell por cima do perfil configurado no app; agora as variáveis de
  autenticação são limpas dentro do próprio shell, depois do profile. O
  console de login também deixa de herdar credenciais soltas da máquina
  (inclusive GH_TOKEN). Limitação documentada: sessão automática no
  macOS/Linux com perfil de CHAVE ainda pode ser vencida por chave exportada
  no profile do shell (a chave não vai pra linha de comando de propósito).

## v2.41.3

Segunda onda da correção dos gaps da auditoria: o round 2 automático (lançado
na v2.41.0) fica resiliente a reinício, falha de rede e flake do GitHub, e as
pendências param de virar cards eternos.

**Correções**
- **Reinício não mata mais o round 2.** Fechar o app (ou o auto-update
  reiniciar) com uma re-revisão na fila queimava a âncora daquele commit pra
  sempre; agora o boot poda a âncora e o ciclo seguinte re-arma sozinho.
- **Flake do GitHub não engole o round 2.** A re-revisão relançada carrega o
  commit que a motivou; se a leitura do head falhar no início da sessão, esse
  commit vale como fallback e o achado novo não morre mais como "já revisado".
- **Queda de rede não rebaixa o round 2 a manual.** O relançamento pós-rede
  usa o pedido original guardado (não re-resolve pela fila), então a revisão
  continua automática e o card não mente "aguardando você" enquanto ela roda.
- **Rascunho não dispara re-revisão automática.** Push de trabalho em
  andamento não queima mais sessão nem posta review em cadência de robô; o
  botão Re-revisar continua disponível pra rascunho.
- **PR fechado sem merge resolve a pendência.** O card em "Precisa de você" de
  um PR que o autor fechou é cancelado com aviso, em vez de ficar eterno.
- **Aprovar à mão durante a análise resolve o card.** Review seu (aprovação ou
  pedido de mudanças) no MESMO commit que a sessão leu agora reconcilia a
  pendência, mesmo tendo sido submetido antes dela nascer. Comentário avulso
  anterior não resolve nada (só ação decisiva conta).
- **Review por clique ancora no commit analisado.** Se o autor empurrar commit
  entre a análise e o seu clique, o review sai carimbado no código que a
  análise leu, e o app percebe sozinho que o commit novo precisa de round novo.
- **Bloqueio do filtro de linguagem ganhou saída.** Quando a redação gerada é
  bloqueada, o card agora explica o motivo e aponta o chat do PR como caminho
  pra redigir e postar; o toast idem.

## v2.41.2

Primeira onda da correção dos 20 gaps da auditoria de 15/08: seis consertos de
integridade e custo. O review passa a dizer de qual commit ele fala, decisões
concorrentes não se atropelam mais, e dois vazamentos de dinheiro (sessão paga
em loop e re-revisão em rajada) foram fechados.

**Correções**
- **Review ancorado no commit que a revisão leu.** O review postado agora
  carrega o `commit_id` do head que a sessão analisou, em vez de deixar o
  GitHub carimbar o head do momento da postagem. Consequência importante: se o
  autor empurrar commit DURANTE a revisão, o app agora percebe que o review
  ficou defasado e a re-revisão automática arma de verdade (antes esse caminho
  ficava adormecido por acidente). Push durante a sessão passa a gerar um
  round novo, que é o comportamento correto.
- **Decisões concorrentes não se engolem.** Clicar numa pendência enquanto
  outra revisão terminava podia remover o card errado da lista (o achado da
  outra revisão sumia pra sempre, sem histórico). O caminho do clique agora
  re-localiza a pendência pelo id antes de qualquer remoção, e histórico não
  duplica quando a reconciliação resolve a mesma pendência junto.
- **Merge só de commit analisado.** O botão Merge recusa quando o PR recebeu
  commit depois da sua autoanálise, com aviso pra re-analisar. Análises
  antigas sem carimbo de commit seguem funcionando como antes.
- **Fim do loop pago no radar de contestação.** Com a detecção automática de
  pushback ligada, um comentário de terceiro no PR fazia o app reclassificar a
  mesma conversa (uma sessão Claude paga) a cada ciclo, pra sempre. Agora só
  comentário NOVO do autor dispara reclassificação.
- **Duas contas: a queda de uma não apaga o estado da outra.** Falha de busca
  de uma conta preservava antes só parte do estado; agora os PRs, as
  autoanálises e os ocultos da conta que falhou ficam intactos até ela voltar.
- **`seen.txt` gravado de forma atômica.** Queda de energia no meio da
  gravação não trunca mais a lista de PRs vistos (truncar virava rajada de
  re-revisões pagas no boot seguinte).

## v2.41.1

A revisão automática fica mais precisa: seis lições medidas em reviews reais
(achados verificados um a um e contestações de autor confirmadas) entram no
protocolo que toda revisão lê. Nenhum gate afrouxou; muda a pontaria, não o rigor.

**Melhorias**
- **Precisão do achado.** O revisor passa a checar quatro erros que aconteceram
  em review real antes de escrever cada achado: descrever commit intermediário
  quando o diff acumulado da branch já mudou o fato; afirmar que um remédio
  "fecha" o problema sem listar o que ele não cobre; superdimensionar o raio de
  um achado verdadeiro; e chamar de "barra o merge" exigência que o time cumpre
  por disciplina, sem required check configurado no repo.
- **Menos falso blocker.** Duas calibrações vindas de contestações de autor que
  tinham razão (confirmadas na memória de pushback): código novo que segue
  padrão já existente e aceito no repo não é blocker (o alvo é o padrão, em
  card separado), e exigir mudança de processo ou configuração do repo (check
  obrigatório, branch protection) é assunto fora do diff, vira sugestão. O
  idioma deliberado de erro com mesma causa raiz (throw dentro do try) entra
  na lista de falsos positivos a descartar antes de marcar defeito.
- **Trava de regressão do protocolo.** Teste novo garante que essas lições
  existem nos arquivos semeados: edição futura que as remova fica vermelha.

## v2.41.0

O Farol fecha o ciclo do review sozinho: quando você pediu mudanças e o autor
empurrou a correção, a re-revisão dispara sem clique. E a fila anda mais rápido
quando você quiser: revisões em paralelo na mesma conta (opt-in) e PRs em
rascunho passam a entrar no radar.

**Novidades**
- **Re-revisão automática quando o autor responde.** PR onde o seu último review
  pediu mudanças e recebeu commit novo volta pra fila de revisão sozinho, no
  ciclo seguinte do polling. Era o elo manual do fluxo: o app abria o round
  rápido (review em minutos) e fechava passivo (a correção ficava parada até
  alguém notar o push). Cada estado do PR é relançado no máximo uma vez, falha
  cai no retry de sempre, e a postagem continua atrás dos mesmos gates
  (política da conta, card, dedup por commit). Aprovação antiga com commit novo
  segue no botão "Re-revisar", por clique.
- **Revisões paralelas por conta (opt-in).** Novo ajuste em Sistema >
  Automação: a mesma conta pode rodar até 4 revisões automáticas ao mesmo
  tempo. O padrão continua 1 (em série, como sempre foi); contas diferentes já
  revisavam em paralelo entre si e seguem assim. Subir o número acelera fila
  cheia ao custo de gastar o limite do plano mais rápido.
- **PRs em rascunho entram no radar.** Draft com revisão pedida a você aparece
  na fila e é revisado como qualquer PR, com selo "rascunho" no card (fluxo de
  time que abre PR cedo e quer o review antes do ready). O merge de rascunho
  continua bloqueado.

## v2.40.8

PR mergeado ou fechado enquanto esperava no retry de rede não gera mais cascata
de notificações a cada ciclo de polling.

**Correções**
- **Toasts repetitivos de PR mergeado no retry.** Quando uma revisão caía por
  algo transitório e o PR era mergeado antes da reconexão, cada ciclo de polling
  gerava uma cascata de "Conexão de volta: relançando..." seguida de "já foi
  mergeado; cancelei a revisão", sem parar. Agora o estado do PR é conferido
  ANTES de notificar e lançar: mergeado ou fechado sai do retry em silêncio, e
  só PRs ainda abertos (ou sem prova de merge) são relançados.

## v2.40.7

O texto apresentado como revisão agora contém somente o que ajuda quem abriu o
PR: o ponto técnico, o impacto e o próximo passo. Diagnóstico do funcionamento
do Farol não se mistura mais com a conversa entre revisor e autor.

**Melhorias**
- **Revisão técnica separada do diagnóstico interno.** O relatório operacional,
  as razões do gate, a cobertura da leitura e a memória continuam preservados no
  estado interno. A tela recebe uma projeção humanizada e explícita, sem payloads
  nem campos futuros atravessando por acidente. Registros antigos são limpos só
  na apresentação; o histórico bruto não é reescrito.
- **Mesmo contrato no headless, no clique, no terminal e no chat.** Os fluxos
  guiados de terminal e chat passam a usar o writer local com uma autorização
  temporária limitada ao PR e à conta da sessão. Chats já existentes também
  recebem as regras atuais ao serem retomados.

**Correções**
- **Linguagem interna bloqueada antes da postagem.** Corpo e comentários inline
  passam por validação determinística antes de credencial, arquivo temporário ou
  chamada ao GitHub. O caso real que motivou a correção virou regressão, junto de
  variações com Markdown, HTML, entidades e caracteres Unicode invisíveis.
- **Análise incompleta falha fechada.** Resultado sem o status completo, payload
  incompatível com a ação escolhida ou review sem substância não aprova nem pede
  mudanças sozinho; o PR permanece em "Precisa de você".
- **Postagens simultâneas não se atropelam.** Cada chamada usa um arquivo
  temporário próprio e a autorização por PR é reservada de forma atômica, sem
  duplicar um review nem cruzar o corpo de contas diferentes.

O writer e a autorização temporária protegem os caminhos suportados pelo app.
Sessões interativas ainda recebem uma credencial GitHub para investigar PRs
privados, portanto esse controle reduz bypass acidental, mas não é uma sandbox
contra um processo deliberadamente malicioso que ignore o protocolo.

## v2.40.6

A visão por Pessoas agora responde primeiro a quem mais entregou no período e
abre compacta, sem uma lista inteira de PRs ocupando a tela de saída.

**Melhorias**
- **Pessoas ordenadas por volume de entregas.** A quantidade de PRs mergeados no
  período, organização e busca atuais passa a ser o critério principal. O merge
  mais recente desempata; se até ele coincidir, o login mantém a ordem estável.
  Repositórios continuam ordenados por recência, sem mudança.
- **Grupos de Pessoas nascem recolhidos.** Abrir uma pessoa continua sendo uma
  ação persistente durante busca e "mostrar mais/menos", em vez de o cartão se
  fechar sozinho a cada atualização da tela. Trocar organização ou período
  começa novamente com todos recolhidos.
- **Atalho "@fulano na frente" abre o destino.** Além de rolar até a pessoa
  líder, o clique expande o grupo explicitamente, mesmo com o novo padrão
  recolhido.

**Correções**
- A seta do cartão agora gira quando o grupo está aberto. O seletor antigo nunca
  alcançava o próprio cabeçalho e deixava a seta apontando para a direita mesmo
  com os PRs visíveis.

## v2.40.5

Achado de segunda rodada parou de morrer dentro do app. Quando o autor corrige e
empurra código novo, a revisão nova volta a chegar no PR.

**Correções**
- **O 2º round de revisão não é mais engolido.** Antes de postar, o Farol
  perguntava "eu já pedi mudanças neste PR alguma vez?". Como a resposta era sim
  desde a primeira rodada, tudo que a revisão achava depois que o autor empurrava
  a correção ficava só na sua máquina. Caso real que motivou o conserto
  (biud-frontend#742): o Farol pediu mudanças por um open redirect, o autor
  corrigiu, e o Farol revisou de novo duas vezes, concluiu as duas que a correção
  não tinha fechado o buraco, e as duas vezes não postou nada. A pergunta agora é
  "eu já me manifestei sobre ESTE commit?", comparando o commit do review que já
  está no PR com o head atual. Rodada anterior não silencia a rodada atual, e a
  mesma rodada continua sem virar review duplicado.
- **Vale também pro clique.** O mesmo bloqueio existia no botão de postar em
  "Precisa de você": um review de rodada antiga convertia o clique explícito em
  "já revisado" e nada era postado.
- **O que não foi postado aparece na linha.** "Já revisado por você (não
  repostei)" era justamente o status em que os achados só existem dentro do app,
  e era o único que escondia os achados da linha. Agora abre em "N achados que
  ficaram só aqui".

## v2.40.4

O painel vazio passou a ter explicação. Ambiente verde não quer dizer que o
Farol vai achar alguma coisa.

**Correções**
- **Conta sem organização monitorada agora aparece como problema.** Era o pior
  silêncio do app: os 5 itens de Sistema → Visão geral ficavam verdes, o Farol
  não fazia busca nenhuma por aquela conta e o painel ficava vazio pra sempre,
  sem erro, sem log e sem nada na tela dizendo por quê. Agora Visão geral mostra
  uma linha de monitoramento por conta, e clicar leva direto à conta em Contas.
- **Conta sem token no gh também é sinalizada.** O item que já existia cobria só
  a conta principal; conta adicional sem `gh auth login` tinha as buscas puladas
  em silêncio.
- **Todas as contas silenciadas** passa a ser avisado: nada aparece no painel
  mesmo com PR esperando, e antes isso era indistinguível de "não tem nada".

## v2.40.3

A revisão de um PR agora abre direto da tabela de Consumo, e o histórico deixou
de ter teto prático.

**Novidades**
- **Caixa de revisão por clique na tabela de Consumo.** Cada linha de PR ganhou
  um atalho ao lado da referência que abre a revisão daquele PR ali mesmo, com
  veredito, pontos de atenção e o relatório completo. O texto continua abrindo o
  PR no GitHub: são dois destinos, então são dois elementos.
- **Histórico de revisões de 200 para 3000.** Antes, revisão que saísse das 200
  mais recentes desaparecia, e a tela só alcançava as 30 mais novas. Agora
  qualquer revisão guardada abre pelo atalho, mesmo as antigas e as de outra
  conta, sem inflar o que o app carrega a cada ciclo.

**Melhorias**
- PR sem revisão registrada e falha de busca passaram a ser mensagens
  diferentes. Ficariam idênticas na tela, e "não existe" parecendo "quebrou" é
  o tipo de coisa que faz você desconfiar do app inteiro.

## v2.40.2

Completa a navegação por clique da versão anterior: a coluna "PR / sessão" da
aba Consumo tinha sessão que não levava a lugar nenhum.

**Melhorias**
- **Sessão de ferramenta agora navega.** Na tabela de Sessões recentes, "Kudos"
  abre a aba Destaques no painel dos kudos compilados e "Diagnóstico do Farol"
  abre Sistema → Diagnóstico no relatório. Antes só a referência de PR era
  clicável, e a linha de ferramenta ficava como texto morto. Referência que o
  app não sabe abrir (sessão sem referência) continua texto puro, sem clique
  que não leva a nada.

**Correções**
- Trava nova no gate de qualidade: destino de navegação interna apontando pra
  uma aba, seção ou âncora que não existe passa a reprovar a suíte. O sintoma
  desse defeito é clique que simplesmente não faz nada, sem erro nenhum na
  tela nem no log, que é o tipo mais caro de achar.

## v2.40.1

Refinamento de usabilidade: o que a tela menciona agora leva até a coisa com um
clique, e toda menção de pessoa aparece com a foto dela.

**Melhorias**
- **Foto de quem abriu o PR no Panorama** (e na fila, nas decisões, em Destaques,
  no Time e na barra de identidade). A foto já existia em algumas telas e
  faltava em outras; agora toda menção de pessoa sai do mesmo lugar, com foto e
  link pro perfil no GitHub.
- **Clicar na menção leva até a coisa.** Nome de pessoa e de repositório abrem o
  perfil/repo no GitHub; a referência do PR na tabela de sessões do Consumo abre
  o PR; "Sistema → Plano e chaves", o nome do perfil no cartão de orçamento, "o
  log em Sistema", "organizações monitoradas", "Automação" e a versão no rodapé
  abrem a seção exata, já rolada e destacada.
- **Atalhos nos cartões de Entregas:** "@fulano na frente" e "repo na frente"
  levam ao grupo correspondente na lista (trocando a visão quando precisa), e
  "+N hoje" troca o período pra Hoje.
- Tudo isso funciona pelo teclado (Enter/espaço), com os itens anunciados como
  botão pra leitores de tela.

**Correções**
- **Título comprido escondia o autor no Panorama**, o mesmo defeito corrigido em
  "Revisões recentes" na versão anterior: agora quem trunca é o texto do título,
  e a foto com o @login ficam sempre visíveis.

## v2.40.0

Consumo e Entregas passaram por auditoria lógica completa. A aba Consumo agora
tem UMA fonte de verdade, e os painéis não se contradizem mais (o cartão de
tokens dizia 942k nos 7 dias enquanto a linha do tempo mostrava 43k, e até o dia
de hoje divergia entre painéis); a aba Entregas parou de contar merges que o
gráfico não desenhava e ganhou a ordenação pelo mais atual.

**Entregas**
- **Grupos ordenados pelo mais ATUAL primeiro.** Quem mergeou por último abre a
  lista (por repositório e por pessoa), descendo até o grupo parado há mais
  tempo; a contagem só desempata. O número de ranking da visão por pessoa saiu
  (viraria um placar falso); quem mais entrega segue nos cartões "na frente".
- **Dia sem merge aparecia como a 2ª barra mais alta do gráfico.** As barras
  escuras de altura cheia eram dias com ZERO merges: a classe da barra vazia
  colidia com o estilo do estado vazio geral do app (padding + borda tracejada)
  e inflava a barra pra 54px. Agora dia zerado é um toco de 2px, como devia.
- **Cartões e gráfico contavam janelas diferentes.** O corte no GitHub era por
  data seca (que o GitHub lê em UTC): a janela de 30 dias tinha 31 dias locais
  mais uma franja de 3h da véspera, e o total/média contavam ~50 merges que o
  gráfico nunca desenhava (média exibida 25,6 contra 24,0 real). O corte agora
  é por timestamp na meia-noite local do primeiro dia desenhado; "Hoje" começa
  às 00:00 de verdade, e total, média, pico, grupos e barras contam o MESMO
  período.
- **Teto de 1000 honesto.** Quando uma org passa do teto, o corte agora busca
  por atividade mais recente (antes era por "relevância" do GitHub, um recorte
  arbitrário), e o aviso diz que números e gráfico podem subestimar.
- O cache de entregas não atravessa mais a virada da meia-noite servindo a
  janela de ontem, e a barra de participação de grupo pequeno diz "<1%" em vez
  de "0%".

**Novidades**
- **Camada "Sem detalhamento" na linha do tempo e na matriz.** O registro
  anterior à v2.38.0 (e qualquer sessão gravada por versão antiga) não tem a
  quebra por tipo/modelo/conta; em vez de aparecer como consumo zero, essa
  fatia agora aparece em cinza, reconciliada dia a dia contra o total real. Os
  totais da linha do tempo, da matriz e dos cartões de KPI passam a bater
  SEMPRE, por construção, em qualquer janela e métrica.
- **Rodapé de cobertura em Sessões recentes.** A tabela declara desde quando o
  registro individual existe; sessões anteriores aparecem só nos agregados.

**Melhorias**
- **Orçamento por perfil ao vivo.** O cartão de orçamento (e o gasto mostrado
  na aba Sistema) agora recalcula a cada atualização de estado, com a MESMA
  conta que pausa a automação, em vez de congelar no último "Verificar agora".
  Estourou o teto, o cartão mostra na hora; virou o dia, o gasto de "hoje"
  zera junto com o gate.
- **Sessão cancelada com gasto agora registra.** Se o cancelamento chega depois
  do relatório final da sessão, o consumo já reportado entra no registro (antes
  era descartado). Sessão com custo reportado e zero tokens também registra.
- **Cartão de tokens declara o cache.** "Tokens" sempre foi entrada+saída; o
  custo inclui o cache. Agora o subtítulo mostra o cache do período, e as
  células da matriz mostram o valor exato no tooltip.
- **A variação (%) dos KPIs só aparece com base justa.** Além de caber na
  retenção, o período anterior precisa estar coberto pelo histórico registrado;
  senão o chip inflava a comparação contra dias estruturalmente vazios.
- **Lacuna declarada:** sessões interativas no terminal usam a credencial do
  perfil, mas o CLI não reporta o consumo delas, então não entram na medição
  nem no teto; o cartão de orçamento agora avisa.

**Correções**
- **O selo de orçamento estourado da aba Sistema tinha morrido junto com a
  centralização** (lia o dado no lugar antigo): agora lê a mesma fonte viva do
  resto, e Sistema, Consumo e o comportamento da automação sempre concordam.
- **Sessão cancelada aparecia como "ok" na tabela de sessões**: agora aparece
  como "cancelada" (gastou, mas não concluiu).

## v2.39.0

Releitura completa da aba Consumo (desenho do Wanderson no Claude Design):
cartões de KPI com sparkline e variação vs período anterior, linha do tempo em
área empilhada por tipo/modelo/conta com hover, matriz Tipo × Modelo pro período
selecionado, cartões de orçamento por perfil com medidor, e uma tabela de
sessões recentes com a referência do PR/chat/ferramenta de cada sessão (novo log
permanente em `usage-sessions.json`, sem poda). Métrica "Custo" nova ao lado de
Tokens/Input/Output/Cache.

**Correções**
- **O autor sumia de "Revisões recentes" quando o título do PR era comprido.** O `@login` vivia dentro do próprio título, e o título trunca com reticências; um título longo empurrava o autor pra fora e ele desaparecia sem aviso. Agora o autor tem linha própria, com a mesma foto de perfil (`avatar`) que a fila, "Precisa de você", Destaques e Time já usam, e o login em destaque, não mais apagado em cinza.

## v2.38.0

**Novidades**
- **Entregas ganhou uma tela nova.** Um campo de busca filtra por título, autor ou repositório; o período virou uma seleção rápida (Hoje/7/15/30 dias) no lugar do menu solto; e a visão por "Repositórios" ou "Pessoas" passa a mostrar 4 cartões de estatística (PRs mergeados, pessoas entregando, repositórios ativos, e a última entrega ou a média diária, conforme o período escolhido) e um gráfico de merges por dia. Cada grupo mostra, numa barrinha, quanto representa do período, e limita a 4 PRs visíveis por vez, com "mostrar mais" pra ver o resto; na visão por pessoa, o ranking vem numerado, com o avatar de cada uma.

## v2.37.1

**Correções**
- **O "Ocultar" de "Meus PRs" escondia só a autoanálise, nunca o PR.** A opção de ocultar foi pedida por causa de PR próprio que fica aberto e não vai a lugar nenhum (experimento antigo, prova de conceito, coisa de dois anos atrás), e era justamente esse caso que continuava sem solução: o card ocupava a aba pra sempre, com um botão escrito "Ocultar" ao lado que não fazia nada disso. Agora "Ocultar" oculta o PR, e o botão que existia virou "Ocultar análise", que é o que ele sempre fez.
- **Um rodapé mostra o que você escondeu.** Aparece `3 PRs ocultos · mostrar`; com os ocultos à mostra, o card fica esmaecido e o botão vira "Reexibir". O contador da sub-aba passou a contar o que está visível (senão diria 3 e mostraria 0) e, com tudo oculto, a tela explica isso em vez de ficar em branco.
- **Ocultar não vira ignorar a realidade.** O PR oculto volta sozinho se receber commit novo: o Farol guarda o carimbo de atualização do PR no momento em que você ocultou e desoculta quando esse carimbo muda. É só na sua tela, nada é escrito no GitHub, e queda de rede não desoculta nada.

## v2.37.0

**Novidades**
- **Diagnóstico agrupado: o log de falhas deixa de ser um despejo de linha crua.** O relatório abria com 159 linhas soltas, e não dava pra distinguir "um problema que repetiu 70 vezes" de "70 problemas". Agora ele começa por um resumo, uma linha por episódio, com quantas vezes aconteceu, de quando até quando, os PRs envolvidos e a natureza da falha (se resolve sozinha, se espera hora certa pra voltar, ou se depende de você). Fecha com a leitura direta: quantos eventos se resolvem sozinhos, quantos exigem ação humana e quantos são só operacionais. O detalhe cru continua embaixo, limitado às 40 linhas mais recentes, porque esse relatório é feito pra copiar e colar. A aba Sistema também mostra os três maiores grupos direto na linha do log.
- **A classificação de falha passou a morar num lugar só.** Antes o motor decidia "isso é transitório?" com regras escritas dentro do fluxo de revisão, enquanto o painel de Diagnóstico lia o mesmo texto sem entender nada dele. Agora os dois consultam a mesma tabela, então uma falha nova passa a ser reconhecida no retry e no diagnóstico de uma vez só.

**Correções**
- **Um PR podia entrar em loop infinito de revisão, queimando token a cada ciclo.** Quando uma revisão falhava por algo passageiro (rede, binário indisponível), o PR entrava numa lista de "tentar de novo". Se a falha seguinte fosse permanente (credencial recusada, acesso desligado pela organização), o app estacionava o PR, mas esquecia de tirá-lo daquela lista, e o próprio relançamento desfazia o estacionamento no ciclo seguinte. Resultado real, em 04/08/2026: 25 tentativas idênticas do mesmo PR em pouco mais de três horas, sem teto. Agora falha permanente e cancelamento limpam a lista de retentativa antes de estacionar.
- **Limite do plano Claude agora espera a hora do reset, em vez de tentar 12 vezes.** A própria mensagem de limite diz a que horas a cota volta, e o app ignorava isso, tratando como falha passageira qualquer e tentando de novo a cada ciclo: em 07/08/2026 foram 70 falhas registradas em 8 PRs pra uma única condição de hora conhecida. Agora ele lê a hora, segura a retentativa até lá e o aviso passa a dizer o horário ("retomo depois das 21:00"). Sem hora na mensagem, segue como antes.

## v2.36.1

**Correções**
- **Revisão headless podia postar review num PR que já tinha sido mergeado.** Faltava confrontar o estado real do PR no GitHub em dois pontos: uma pendência em "Precisa de você" ficava presa pra sempre quando o PR mergeava enquanto esperava sua decisão (por outro revisor, self-merge, ou na mão), e um PR na fila de revisão automática podia mergear enquanto esperava a vez (conta ocupada com outra revisão) e a sessão rodava e postava mesmo assim. Agora o ciclo de checagem cancela a pendência sozinho quando confirma o merge, e a revisão automática confere o estado do PR bem antes de começar, pulando sem gastar tokens se já foi mergeado. Sem prova de merge (rede caiu, sem token), nada é cancelado por engano.

## v2.36.0

**Novidades**
- **Checkpoint de verificação: a revisão headless deixa de reprocessar do zero depois de uma falha transitória.** Motivo real: uma sessão travada num loop de erro `529` (sobrecarga da API) perdia toda a verificação já feita até ali, e relançar a revisão custava tempo e tokens repetindo exatamente o que já tinha sido conferido. Agora, cada afirmação (`arquivo:linha`) que a sessão confirma contra o código real fica registrada num checkpoint incremental, específico do PR. Se a sessão precisa recomeçar (falha de rede, timeout, relançamento manual), ela é instruída a aproveitar o que já está confirmado em vez de reconferir tudo. O registro é sempre feito pelo motor do Farol, nunca pela sessão diretamente: ela só sinaliza o que verificou, o app é quem grava.
- **Divergência entre passadas nunca é resolvida em silêncio.** Se duas verificações da mesma afirmação discordam (uma confirma, outra refuta), isso vira um ponto de atenção explícito e passa a travar a postagem automática, tanto aprovação quanto reprovação, do mesmo jeito que já acontecia quando a cobertura de leitura ficava incompleta. "Revisões recentes" ganhou uma linha mostrando quantas afirmações foram confirmadas e se há alguma divergência pendente.
- **O checkpoint expira sozinho quando o PR ganha commit novo.** Uma divergência registrada contra um código que já não existe mais (o PR recebeu push depois) deixava a postagem automática travada pra sempre, mesmo sem nenhum problema real no código atual. Agora cada registro carrega o commit do PR no momento em que foi verificado, e só entradas do commit mais recente contam pro gate; o histórico completo continua no arquivo, só deixa de bloquear à toa.

## v2.35.2

**Correções**
- **Panorama mostrava "Revisando…" pra PR que só estava na fila, sem revisão nenhuma rodando ainda.** O card do PR só olhava se ele estava em `activeSessions` OU esperando (`headlessWaiting`), tratando os dois como o mesmo estado e disparando o mesmo rótulo. Enquanto isso, "Analisando agora" (aba Pra mim) já mostrava certo: 1 sessão rodando e o resto na fila. Agora o Panorama usa a mesma distinção de "Meus PRs": "Revisando…" só quando a sessão está de fato rodando, "Na fila (N)" quando só está esperando a vez.

## v2.35.1

**Correções**
- **"Meus PRs", "Pra mim" e "Panorama" podiam mostrar "você não tem nada" sem nunca ter confirmado isso.** As três telas decidiam só pelo tamanho da lista vinda do motor, sem checar se o primeiro ciclo de verificação já tinha terminado. No boot (antes do primeiro ciclo) ou quando esse primeiro ciclo falhava (rede, GitHub CLI), a tela assumia vazio de qualquer jeito, no lugar de avisar que ainda está verificando ou que a checagem falhou. Agora as três esperam uma resposta definitiva do motor antes de dizer que está vazio.

## v2.35.0

**Novidades**
- **Orçamento por perfil de chave de API.** Cada perfil de chave (Sistema > Plano e chaves) agora pode ter um teto diário e/ou um teto total (com data de início), fechando o buraco que deixou um perfil billado por token gastar sem freio até você notar. Estourar qualquer um dos dois pausa toda a automação de gasto daquele perfil (disparo automático de PR novo, retentativa automática pós-falha transitória, e o scan automático de pushback), sem bloquear clique manual nem a autoanálise de "Meus PRs" (que só roda por clique). O card do perfil e a aba Consumo (com quebra por perfil) mostram o gasto acumulado e um selo quando o orçamento estoura.
- Uma sessão que gastava tokens em várias idas e vindas de ferramenta e só falhava na última mensagem registrava zero custo em qualquer lugar. Agora o gasto é sempre contabilizado, mesmo quando a sessão termina em erro.

**Correções**
- Um perfil que já estourou o orçamento e depois é liberado (você aumenta o teto) podia ficar com o aviso de estouro mudo pro próximo estouro real, se a fila estivesse vazia no meio do caminho. Agora o estado é reconciliado a cada ciclo, independente da fila ter algo pra oferecer.

## v2.34.1

**Correções**
- **Form de "Adicionar perfil" (Plano e chaves) ficava colado.** O seletor de tipo (login por assinatura / chave de API) e a linha de campos abaixo dele coincidiam sem espaço nenhum entre si, virando uma faixa só. Agora tem 10px de respiro entre as duas linhas.

## v2.34.0

**Novidades**
- **Perfil de assinatura Claude por chave de API.** Até agora só existia login por assinatura (`CLAUDE_CONFIG_DIR`). Agora cada perfil pode ser "login por assinatura" (o de sempre) ou "chave de API" (`ANTHROPIC_API_KEY` + URL base opcional, billing por token em vez de assinatura). Os dois tipos convivem no mesmo gerenciador de perfis (Sistema > Plano e chaves) e são escolhidos por conta do GitHub do mesmo jeito de sempre. Cobre tanto as sessões automáticas (revisão, autoanálise, pushback, chat, ferramentas) quanto a sessão de terminal interativa da fila. Perfil de chave não tem fluxo de `claude login`, a chave já é a credencial, então o botão "Abrir sessão de login" só aparece pro tipo assinatura. A URL base é um escape hatch genérico pra qualquer endpoint compatível com a API de Mensagens da Anthropic (proxy próprio, gateway corporativo), não é garantia de funcionar com qualquer provedor.
- Uma chave de API já configurada em qualquer variável de ambiente da máquina (`ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`) deixa de vazar sozinha pras sessões do Farol: agora ela é sempre limpa antes de aplicar o perfil escolhido, pra um valor solto no ambiente nunca anular silenciosamente um perfil de assinatura configurado.

## v2.33.2

**Melhorias**
- **Panorama ganhou linha própria, no mesmo padrão de "Revisões recentes".** Cada PR empilhava título, autor e botão numa coluna só, porque a coluna da direita só tinha o horário; a metade direita da linha ficava em branco. Agora a linha ancora horário e ações à direita (conversar, revisar, copiar a URL, abrir no GitHub), título e autor dividem uma linha, e cada PR ocupa bem menos altura.
- **"Conversar" e "copiar URL" chegaram no Panorama.** Não existia como abrir o chat de um PR direto da linha do Panorama; o campo "Consultar um PR por URL" no topo da aba era o contorno pra isso. Agora o botão de conversa mora na própria linha, junto com copiar URL e abrir no GitHub (antes só dava pra abrir clicando no texto da referência, sem indicação visual de que era link).

## v2.33.1

**Correções**
- **"Meus PRs" ficava em branco, sem nenhum aviso, quando você não tinha PR aberto.** A sub-aba escondia o cabeçalho inteiro e zerava a lista sem deixar mensagem nenhuma, diferente de "Pra mim" e "Panorama", que já avisam quando não há nada. Agora o cabeçalho continua visível e aparece "Você não tem PRs abertos nas organizações monitoradas" (ou "nesta conta", conforme o escopo escolhido).

## v2.33.0

**Melhorias**
- **"Revisões recentes" mostra o dia, não só a hora.** O carimbo era `17:51` e nada mais, numa lista que guarda as 30 revisões mais recentes: a maioria não é de hoje, então o número sozinho não localizava nada no tempo. Agora sai `hoje 17:51`, `ontem 16:29`, `01/08 15:35` e, quando é de outro ano, `24/07/2025 09:12`, sempre com a data e hora completas no tooltip. Vale também pro card de "Precisa de você", que tinha o mesmo problema ao lado. O corte de dia é o local, então nada muda de dia às 21h.
- **A linha aproveita a largura toda e ganhou quatro ações.** A metade direita da linha ficava em branco, porque só o relógio morava naquela coluna. Agora ela ancora o carimbo e um grupo de ações sempre visíveis: conversar (com o contador de mensagens), revisar de novo, copiar a URL do PR e abrir no GitHub.
- **Aparece o que já existia e estava escondido.** Título do PR, autor e a etiqueta da conta (importante em "Todas", onde não dava pra saber de quem era o PR) passaram a ser mostrados, e o **relatório completo da revisão** virou expansível ali mesmo, do mesmo jeito que já era no card de "Precisa de você". Os dados sempre estiveram na tela, só não eram exibidos.
- **A linha ficou mais curta, não mais alta.** Título e autor dividem uma linha, e os três expansíveis (pontos de atenção, relatório, pushback) dividem uma faixa só, com tipografia uniforme; o que você abre passa a ocupar a linha inteira. Resultado: cada item ocupa menos altura do que antes, apesar de mostrar mais coisa.
- **O selo do desfecho ganhou cor** (verde aprovado, vermelho mudanças pedidas, azul comentado, cinza pulado), pra varrer a lista de olho. O texto continua o mesmo de sempre. Não entra barra colorida à esquerda: ali barra significa urgência, e esta seção é histórico. O carimbo também escureceu um tom, porque no tema claro o contraste do cinza antigo era baixo demais pra um texto que existe pra ser lido.

## v2.32.4

**Correções**
- **PR resolvido pelo chat continuava aparecendo em "Precisa de você".** Quando você pedia no chat do PR pra aprovar (ou pedir mudanças, ou comentar) e o review ia pro GitHub por ali, o card não saía da seção: o Farol só esvaziava a pendência quando você clicava num dos botões do card. Valia pro mesmo caso vindo de qualquer lugar de fora (review postado na web do GitHub ou por `gh` na mão). Agora o Farol confronta cada pendência com os reviews que já são seus no PR e fecha a pendência sozinho, registrando em Revisões recentes como "já revisado por você (não repostei)". Acontece na hora ao fim de uma conversa no chat e, pros casos de fora do app, no ciclo de checagem. A trava é o horário: só fecha com review seu postado DEPOIS da análise, então re-request (autor derruba a sua aprovação e pede de novo) continua caindo na sua mesa, e pendência nenhuma desaparece quando o Farol não consegue confirmar (conta sem token ou rede caída).

## v2.32.3

**Correções**
- **Linha "Perfil padrão do Farol" saía esmagada, com uma palavra por linha (bug que a v2.32.2 introduziu).** O manager de perfis morava dentro de um `.field`, e a regra `.field select` (mesma especificidade da `.set-ctl select`, declarada depois no arquivo, portanto vencedora) forçava `width: 100%` no seletor da linha. O controle comia a coluna de texto até sobrar uma palavra por linha. Plano e chaves passou a usar o mesmo formato de Contas (sem `.field` e sem `.settings` em volta), então o seletor volta a ter a largura do próprio conteúdo. O estilo dos campos de nome e diretório do perfil, que vinha de carona do `.field`, agora é declarado explicitamente.
- **Plano e chaves ocupava largura diferente das outras telas do Sistema.** Tinha um teto de 640px que Contas, Automação e Preferências não têm; removido, e a nota de apoio foi pro pé da seção. As quatro telas foram medidas em 900, 1150 e 1280px: mesma largura de card, controle ancorado à direita e texto em uma linha nas quatro.

## v2.32.2

**Correções**
- **Conexões e Plano e chaves ainda tinham espaço vazio, mesmo depois da v2.32.1.** O fix anterior só encolheu o card; faltava fazer o conteúdo usar a largura de verdade, do jeito que Preferências já fazia (linha cheia, texto à esquerda, controle ancorado à direita). Conexões virou `.set-list`/`.set-row` (mesmo padrão de Automação e Preferências); o campo "Perfil padrão do Farol" em Plano e chaves ganhou o mesmo tratamento. Reviewers não muda (segue precisando da largura total pros chips).

## v2.32.1

**Correções**
- **Espaço vazio à direita nos cards de Conexões e Plano e chaves.** Mesma causa da v2.32.0 (card mais largo que o conteúdo), num lugar que a v2.32.0 não cobriu: `.settings` desses dois painéis (campo estreito de label + input) esticava até a largura do container de 1150px da aba Sistema. Escopado só nesses dois (`#sys-connections`, `#sys-plans`); Reviewers continua de largura total, que é o que os chips precisam.
- **Novidades: rolagem automática virou botão explícito.** A v2.32.0 carregava mais versões sozinha ao rolar até o fim da lista (`IntersectionObserver`); trocado por um botão "Ver mais N versões (M restantes)" clicado por você, sem carregamento silencioso.

## v2.32.0

Dois ajustes de UI na aba Sistema, apontados pelo Wanderson usando o app no dia a dia.

**Melhorias**
- **Novidades carrega por rolagem, não tudo de uma vez.** A lista de versões (67 e crescendo) exibia todo o histórico de uma vez, pesado pra ler e pra rolar. Agora mostra 5 versões e carrega mais 5 conforme você desce (`IntersectionObserver` num sentinel no fim da lista), até esgotar o histórico.

**Correções**
- **Espaço vazio à direita nos cards de Reviewers por projeto.** `.rev-editor` tinha um `max-width: 640px` sobrando dentro do container de 1150px da aba Sistema, deixando uma faixa morta à direita de cada card de organização. Removido o limite; o card agora ocupa a largura real disponível.

## v2.31.0

Correção dos 52 gaps lógicos encontrados na análise completa de 01/08/2026: identidade de conta estrita, radar resiliente a falha parcial, gates de aprovação sem furos, instância única, update seguro, sessões robustas, contratos reais entre UI e servidor, widgets com ciclo de vida completo e persistência atômica. Executado em 9 ondas com TDD (suite foi de 392 pra 538 testes); os detalhes por onda seguem abaixo.

Onda 2 do plano de correção dos gaps lógicos (02/08/2026): resiliência do polling (`check()`).

**Correções**
- **Um ciclo ruim das buscas de "pedido a mim" não zera mais o radar (A2).** Quando só as buscas `--review-requested` falham (ex.: rate limit da API de search do GitHub), o `check()` preserva a fila, o "é meu" do panorama e os marcadores de re-request do último ciclo bom, no mesmo padrão que já valia pra `reviewedKeys` e `myPRs`. `markReRequests` agora distingue "busca falhou" (null, preserva) de "ninguém mais pedido" (Set vazio, limpa como sempre). Antes, a falha parcial zerava a fila, apagava os marcadores (ressuscitando PRs que você ignorou) e re-notificava tudo na recuperação.
- **Carência anti-lag de 10 minutos no re-request (M1).** Logo depois de um review ser postado, o PR ainda ecoa na busca `--review-requested` por atraso do índice do GitHub; esse eco deixou de contar como re-request (antes, cada auto-approve podia relançar uma revisão headless completa à toa). Registro antigo sem carimbo de horário segue valendo como sempre valeu; re-request real dentro da janela entra com atraso máximo de carência + 1 intervalo de polling.
- **`intervalSeconds` inválido no `config.json` é clampado no boot (M2).** Valor não numérico editado à mão virava `setTimeout(fn, NaN)`, ou seja, polling de ~1ms contra o GitHub até esgotar o rate limit. O boot agora aplica o mesmo clamp de 60 a 3600 segundos que o caminho HTTP (updateSettings) já aplicava.
- **`searchPRs` avisa quando o resultado bate o teto de 100 do gh (B10).** O gh corta no `--limit 100` sem avisar e, com best-match como ordenação, um PR pedido a você pode ficar fora do radar em silêncio. Agora fica um WARN no log dizendo qual busca truncou, análogo ao sinal `capped` que as entregas já tinham.

Onda 6 do plano de correção dos gaps lógicos (02/08/2026): robustez de sessão e spawn.

**Correções**
- **Acento não vira mais � na resposta da sessão (M4).** O stream da sessão headless decodificava cada chunk isolado, e um caractere multibyte cortado no limite de 64KB virava U+FFFD dentro do texto, inclusive em review postado. O stdout agora usa `setEncoding('utf8')`, que remonta o caractere entre chunks.
- **Claude que morre no meio da sessão vira erro de verdade, nunca "sucesso" com NDJSON cru (M3).** Quando o processo saía com código != 0 antes do evento result (ex.: heap out of memory), o NDJSON parcial era parseado como envelope e virava "texto" no chat ou SyntaxError genérico no review. Agora exit != 0 sem result é erro com o código real e o stderr embutido, então a classificação de erro transitório do review e o retry de resume do chat enxergam a causa verdadeira.
- **Processo morto antes de ler o prompt não derruba mais o engine (B4).** O stdin da sessão headless não tinha handler de error: um EPIPE assíncrono (prompt maior que o pipe, filho já morto) virava uncaughtException e matava o Farol inteiro. O erro agora é absorvido e a causa real da morte é reportada pelo close.
- **Cancelar uma sessão perto do timeout não vira mais "tempo esgotado" (B3).** Se o timer de 30 minutos vencia na janela entre o seu cancelamento e o close do processo, ele sobrescrevia a flag e o cancelamento aparecia como falha por tempo. O timeout agora respeita cancelamento em andamento.
- **No macOS, Terminal que não abre não deixa mais a sessão presa (M5).** O `open -a Terminal` saindo com código != 0 (permissão de automação negada, MDM) era ignorado: o pill ficava preso, as keys ficavam vistas pra sempre e o PR sumia da fila. Agora o exit != 0 desfaz o visto, remove a sessão, apaga o script órfão e avisa com toast. A mesma correção foi aplicada ao console de login de perfil do Claude, que tinha o mesmo buraco.
- **Duas mensagens rápidas no mesmo chat não geram mais duas respostas concorrentes (B1).** A guarda do chat lia o status, dava await no refresh de token e só então marcava running: duas mensagens na mesma janela passavam as duas. A vez agora é reservada de forma síncrona, sem await no meio; a segunda mensagem é recusada com aviso.
- **Clique duplo numa ferramenta não roda mais a sessão em dobro (B2).** Mesma corrida do chat no launchTool (kudos, diagnóstico): o segundo clique na janela do refresh de token disparava uma segunda sessão headless (custo em dobro, resultado sobrescrito). A marcação de running agora é síncrona e o segundo clique é recusado.

Onda 1 do plano de correção dos gaps lógicos (02/08/2026): identidade de conta (raiz P1).

**Correções**
- **O Farol nunca mais age no GitHub com a identidade errada (A1, a raiz).** Quando o token de uma conta falha no keyring do gh, o `ghEnv` herdava o token da primária: busca `@me`, review postado e sessão Claude saíam assinados pela conta errada, com resultado que parecia válido. Agora existe `tokenFor` (o token da conta pedida, sem nunca herdar) e o `ghEnv` falha alto pra conta pedida sem token; `ghEnv()` sem conta segue caindo na primária, o único fallback legítimo (contrato do update e do doctor).
- **Buscas gh pulam a conta sem token em vez de buscar como outra pessoa (A1, M11).** `searchPRs` e `myAuthoredPRs` devolvem null (falha de busca, que o radar já preserva desde a Onda 2) e as entregas marcam o recorte como parcial, com WARN no log dizendo qual conta está sem token e o que rodar. Antes a busca rodava com o token da primária e os PRs da conta com problema simplesmente sumiam, em silêncio.
- **Review nunca é postado pela conta errada (A1).** `postReview` exige o token da conta dona do PR (sem ele, erro claro e nada é postado) e `myReviewStates` sem token devolve "não sei" em vez de confirmar dedup consultando com a identidade errada.
- **Meus PRs gateiam pela conta dona do PR, não pela primária (M10, A1).** A guarda de `setReviewers` e `mergeSelfPR` tinha a precedência errada: conta do PR sem token passava se a primária tivesse token. Agora a conta do PR sem token recusa mesmo com a primária ok, e a conta do PR com token passa mesmo com a primária deslogada (antes recusava indevidamente). Os leitores best-effort (estado de merge, auto-merge, branch, staleness, pushback) devolvem incerteza pelo contrato de cada um em vez de ler com token herdado.
- **O chat do PR conversa com a conta dona do PR (A3).** `chatSend` deriva a conta e repassa ao `runClaudeStream`: o resume encontra a sessão da revisão headless (perfil Claude certo) e o gh dentro da conversa usa o token certo. Sem token da conta, a conversa nem abre, com mensagem acionável.
- **Revisão só abre sessão de conta com token, e "sem token" é transitório (A1).** `launchReview` filtra por conta: o PR da conta sem token fica na fila (não é marcado como visto nem some), os das contas autenticadas seguem. O ciclo automático filtra em silêncio (sem toast repetido a cada 60s; a barra de contas já mostra "sem token") e a falha por "sem token no gh" entrou na classe transitória: o PR tenta de novo no próximo ciclo em vez de estacionar aguardando ação manual.

Onda 4 do plano de correção dos gaps lógicos (02/08/2026): gates de aprovação e merge (segurança).

**Correções**
- **Cobertura com zero arquivos revisados deixou de ser passe livre (A4).** A rede de segurança do gate de postagem só acusava lacuna quando ao menos um arquivo tinha sido revisado: um envelope declarando o total do diff com leitura zero (o pior caso, nada foi lido) liberava auto-approve e auto-reject, e `reviewed` fora do contrato contava como leitura válida. Agora total declarado sem leitura é lacuna, a postagem automática é segurada e a decisão vai pro humano com a lista.
- **A identidade do PR na decisão vem da fila, nunca do envelope da sessão (M6).** `recordDecision` preferia o campo `pr` que a sessão devolvia (saída de modelo, nada valida): um envelope mentiroso redirecionaria um APPROVE pra outro repositório. Agora `item.pr` é sempre derivado do PR da fila, a postagem e o dedup usam só esse dado confiável, e a memória por autor (dossiês e destaques) é atribuída pela mesma identidade, inclusive no caminho automático.
- **A autoanálise carimba o commit que ela de fato leu (A6).** O SHA era capturado depois da sessão: um push no meio da análise carimbava SHA novo em análise velha (TOCTOU) e a invalidação nunca disparava, deixando o botão Merge em pé sobre código que a análise não leu. Agora o SHA é lido antes da sessão e re-checado no fim; se entrou commit novo, o resultado é descartado com aviso e sem re-analisar sozinho (relançar é decisão do usuário). Na atualização, autoanálises antigas sem SHA registrado são descartadas e pedem re-análise (segurança do botão Merge).
- **O gate de ruleset checa a base real do PR (B7).** `fetchMergeState` não devolvia `baseRefName`, então o fallback que o gate de ruleset usava era código morto: PR recém-analisado, ainda sem a base enriquecida pelo ciclo, consultava o ruleset sem saber a base. O campo agora vem na mesma chamada `gh pr view`, sem custo extra, e o "merge como admin" deixa de ser oferecido quando o ruleset da base bloqueia de verdade.
- **O refresh do estado de merge não engole mais escrita concorrente (B8).** `refreshMergeStates` trocava o mapa inteiro por atacado: uma autoanálise terminando durante os awaits do ciclo tinha o estado recém-gravado engolido, e o botão Merge daquele PR sumia até o próximo polling. A troca virou reconciliação por carimbo de tempo (entrada gravada durante o ciclo sobrevive), preservando as limpezas de sempre: PR que deixou de ser alvo sai e leitura que falhou derruba a entrada.

Onda 5 do plano de correção dos gaps lógicos (02/08/2026): instância única e fluxo de update.

**Correções**
- **Porta ocupada não deixa mais um segundo Farol monitorando o mesmo `~/.farol` (A7).** O listen na porta virou o lock de instância única, valendo também no modo `node server.js` (que o lock do Electron não cobre): o engine só agenda polling e inicia o ciclo depois do listen dar certo. Antes, um segundo processo com a porta ocupada seguia monitorando por conta própria: polling em dobro, risco de revisão dupla com dois posts no GitHub e escrita concorrente no estado local. Com a porta ocupada, a janela do Electron vira só um visor da instância que já roda, e o "Verificar agora" da bandeja não acorda o engine inerte.
- **O update funciona em perfil do Windows com espaço no nome (M14).** O Start-Process do PowerShell 5.1 junta os itens do -ArgumentList com espaço sem citar cada um: um perfil como "C:\Users\Nome Sobrenome" partia o caminho do script em dois argumentos e o installer morria numa janela oculta depois do toast de sucesso. O caminho do -File agora sai citado (aspas duplas embutidas, apóstrofo dobrado), numa função pura testada.
- **A pasta baixada do update não se perde mais quando o polling checa versão no meio do download (M13).** A atribuição do source resolvia a referência de `engine.update` antes do download (que dura minutos); o checkUpdate do ciclo reatribuía o objeto nesse meio tempo e a pasta extraída caía num objeto órfão: o update explodia em 500 e nunca aplicava. A atribuição agora é em dois tempos, gravando no objeto atual.
- **Revisão iniciada durante o download barra o installer (M15).** A checagem de "análise ou chat em andamento" só rodava antes do download; agora re-roda depois dele, nos dois SOs, então o installer não mata mais uma sessão headless que o polling iniciou enquanto o download rodava (possivelmente entre o APPROVE postado e a gravação do estado local).
- **Clique duplo em "Atualizar agora" não dispara mais dois updates ao mesmo tempo (M16).** Sem feedback visual durante o download, o segundo clique disparava um segundo download e dois installers copiando por cima de `~/.farol/app` simultaneamente. A guarda de reentrância liga antes de qualquer espera: o segundo clique é recusado na hora; falha destrava pro próximo clique, sucesso fica travado de propósito (o installer vai fechar e reabrir o app).

Onda 7 do plano de correção dos gaps lógicos (02/08/2026): pipeline de revisão, pushback e fan-out.

**Correções**
- **A recusa de auto-aprovação diz o motivo verdadeiro (M7).** O gate `shouldAutoApprove` devolvia só um booleano e o bloco de transparência tinha que adivinhar por que a aprovação automática não saiu, e adivinhava sempre "política da conta", mesmo quando o bloqueio veio de contestação a outro revisor ou de lacuna de cobertura. O gate agora devolve o motivo estruturado (`{ok, motivo}`) e a linha "a política da conta manda aguardar" só aparece quando a recusa veio de fato da política.
- **Lacuna de cobertura aparece uma vez só nos motivos da decisão (B5).** Dois blocos consecutivos prependavam cada um a sua redação da mesma lacuna, e a decisão pendente listava o mesmo problema duas vezes com textos diferentes. Ficou a redação que mostra a amostra dos arquivos não lidos e explica a consequência ("não posto sozinho").
- **A promessa do toast "tento de novo no próximo ciclo" vale pra qualquer revisão que caiu (M8).** O retry pós-falha transitória dependia de o PR seguir na fila "pra mim" e da política autoReview da conta: revisão iniciada por clique no panorama (que sai da fila no rebuild do ciclo) e conta com auto-revisão desligada nunca eram retomadas. O PR agora é guardado junto das tentativas e o relançamento não depende da fila nem da política, preservando a semântica do lançamento original (clique nunca auto-posta); ficam de fora conta silenciada e conta sem token no gh (guarda da Onda 1).
- **Pushback marcado à mão nunca é sobrescrito pelo scan automático (M9).** Registro manual confirmado é palavra final (contrato do recordPushback): sai do alvo do scan (não gasta gh nem sessão Claude com quem você já resolveu) e, se você marcar à mão enquanto uma classificação está em voo, o resultado dela não atropela o seu. Registro automático continua re-escaneável de propósito (o autor pode continuar a thread).
- **Classificação de pushback que falha não perde o pushback pra sempre (B6).** O marcador de "já escaneei" era gravado antes da sessão de classificação responder: uma falha transitória (rede, limite do plano) marcava o PR como visto e o gate por atividade nunca reabria. O marcador agora só grava quando a classificação responde (mesmo que a resposta seja "não é pushback"); falha reentra no próximo ciclo, sem furar o teto de 2 classificações por ciclo.
- **Fan-out fatia por arquivo quando o caminho não separa o diff (M12).** PR grande com o diff inteiro num diretório só (ou na raiz) produzia um lote único que o chamador descartava, degradando em silêncio pro passe único, exatamente no PR que mais precisa de fatiamento. Entrou um fallback determinístico por arquivo, balanceando linhas entre as partes. Efeito consciente: esses PRs passam a rodar fan-out de verdade e custam mais tokens, a mesma consequência documentada quando o fan-out foi ligado na v2.28.0.
- **O seletor de reviewers não fica 1 hora vazio depois de uma falha do gh (B9).** Um resultado inteiramente vazio da busca de candidatos é sintoma de falha total (rede caída, token vencido), não de org sem gente, e era cacheado pelo TTL de 1 hora. Falha total agora não entra no cache: o clique seguinte refaz a busca.

Onda 3 do plano de correção dos gaps lógicos (02/08/2026): contratos UI e servidor (raiz P3).

**Correções**
- **A paleta de comandos (Ctrl+K) decide de verdade (A5).** Os itens de decisão montavam um `decide()` que nunca existiu em script carregado: o clique morria num ReferenceError engolido e você achava que tinha aprovado. Agora existe um caminho único de decisão (o mesmo do card), o "Pedir mudanças" pela paleta ganha a mesma confirmação do card antes de postar REQUEST_CHANGES no GitHub, a paleta fecha antes de rodar a ação (falha vira toast, nunca paleta travada) e o lote "Aprovar as N pendentes" aprova só as decisões visíveis no escopo atual, não a lista inteira.
- **O botão Cancelar da autoanálise cancela de verdade (M18).** Ele postava `/api/cancel-op`, rota que nunca existiu: o 404 era engolido e a sessão seguia rodando com a UI dizendo "Cancelado". Agora existe a rota `POST /api/self-review/cancel`, que cancela pelo key do PR nos dois estados possíveis (ainda na fila: remove e avisa; rodando: encerra a sessão de verdade), e o botão só afirma "Cancelado" quando o servidor confirma. De quebra, o contrato inteiro virou teste: toda rota `/api` que a UI chama tem que existir no servidor, então rota fantasma nunca mais passa em silêncio.
- **O widget de autoanálise nasce com o key certo, sobrevive ao re-render e fecha quando a análise termina (M20).** O key era montado errado (virava `repo#pull#123`), o re-render da lista destruía o widget menos de 1 segundo depois do clique e nenhum caminho o fechava no fim (acúmulo silencioso de operações órfãs). Agora o key canônico vem do card (com função pura testada como fallback pela URL), o widget é reanexado vivo após cada re-render e o fechamento vem do snapshot do servidor, com proteção explícita contra a corrida do SSE (um estado atrasado não fecha o widget recém-nascido como "concluído").
- **Pushback pendente confirma num clique (M21).** Quando o Farol suspeitava de contestação e sugeria o desfecho, re-selecionar a opção já selecionada não dispara o evento de mudança: o "confirme num toque" prometido não existia. O estado pendente agora traz um botão Confirmar que grava o desfecho sugerido como confirmado; o controle virou função pura testada, incluindo o escape da nota vinda do classificador.
- **"Revisar tudo" não revisa mais a fila inteira por acidente (B22).** Se a fila visível esvaziava entre o render e o clique, a UI mandava `{}` e o servidor interpretava ausência de lista como "revise TUDO", inclusive PRs de outras contas fora do escopo visível. O contrato mudou: `urls` é obrigatório no `POST /api/review` (sem lista, 400 com mensagem explicando), e o botão manda sempre a lista explícita do escopo visível, avisando com toast quando não sobrou nada pra revisar.

Onda 8 do plano de correção dos gaps lógicos (02/08/2026): UI, widgets de operação e estado.

**Correções**
- **Pill de erro não é mais imortal: todo estado terminal expira (M22).** O ciclo de vida das operações virou máquina de estados pura (running anda pra done, error ou cancelled; estado terminal não vira outro nem volta): done some em 3s, erro e cancelamento ficam 6s na tela pra dar tempo de ler, mas sempre somem. Antes, a pill de erro nunca expirava e acumulava uma por tentativa. Reusar o mesmo id de operação também não deixa mais a pill anterior órfã no DOM, e um timer velho de id reutilizado não apaga a operação nova.
- **O widget "Verificando PRs" aparece no lugar certo e volta depois de um erro (B11).** A pill de polling ancorava num id que não existe no HTML (o seletor devolvia null e ela caía no rodapé da página), e uma checagem com erro deixava a operação terminal no mapa, barrando o widget pra sempre: a checagem seguinte nunca mais mostrava feedback. Agora a pill vive ao lado da linha "Última checagem" e o ciclo novo purga o que já terminou antes de criar o widget novo.
- **Resposta velha não vence mais na aba Entregas (M19).** Trocar org ou período com a rede lenta disparava cargas concorrentes e a resposta que chegasse por último pintava a tela, mesmo sendo da escolha antiga. Cada carga agora pega um token de requisição e resposta superada é descartada (a mesma guarda que o chat já fazia por chave), sem encerrar a operação da carga nova.
- **O rótulo de estágio da sessão acompanha o tempo real (B13).** O "(iniciando…)" do card de análise congelava no texto do primeiro paint e só mudava se chegasse snapshot novo. Agora ele envelhece pelo mesmo ticker de 1 segundo do tempo decorrido: "(iniciando…)" até 5s, "(processando…)" até 15s, e some depois.
- **Escopo salvo de conta removida não esvazia mais o Radar (B15).** O filtro de conta persistido no navegador podia apontar pra uma conta removida ou renomeada há meses: o Radar abria vazio, sem nenhum segmento ativo, pra sempre. O escopo órfão agora volta sozinho pra "Todas", validado a cada snapshot (e só quando a lista de contas está presente, pra não resetar uma escolha válida no boot).
- **A barra de contas só aparece onde o filtro por conta age (B14).** A visibilidade virou allowlist (Radar, Destaques e Time, as abas que respeitam o escopo): a barra some da Entregas, que filtra pela org própria e mostrava um filtro que não filtrava nada. Aba nova nasce sem a barra até alguém decidir que ela respeita o escopo.
- **A atividade do chat atualiza a pill em vez de destruí-la, e fechar o painel encerra a operação (B16).** O texto de atividade sobrescrevia o container e matava a pill "Claude respondendo" (a operação ficava órfã no mapa de operações), e a fase genérica sorteada a cada snapshot atropelava o texto real da sessão. Agora o texto vivo entra como etapa da mesma pill, a fase genérica roda só no primeiro paint e fechar o chat no meio da resposta encerra a operação de verdade.
- **Os botões Auto-merge e Merge (admin) reabilitam sozinhos quando o repo muda (B17).** As recusas do repo (sem "Allow auto-merge", ruleset da base) eram marcadas num conjunto que nunca expirava: você ligava a opção no GitHub e o botão continuava desabilitado até fechar o Farol. Os marcadores agora guardam a geração do refresh no momento da recusa e expiram quando chega um refresh de estado de merge mais novo que a marcação.

Onda 9 do plano de correção dos gaps lógicos (02/08/2026): persistência, consumo e cosméticos.

**Correções**
- **Estado corrompido não vira mais reset silencioso (M23, leitura).** Um JSON de estado truncado (queda de energia, por exemplo) era engolido pelo mesmo catch do "arquivo não existe" e voltava a DEFAULTS sem nenhum sinal: multi-conta desfeita, política de auto-approve de volta ao padrão. `readJson` agora distingue os dois casos: primeiro boot segue silencioso, corrupção loga WARN no `farol.log` e preserva o conteúdo em `.bad` pra perícia, sem sobrescrever a primeira evidência.
- **Gravação de estado virou atômica: queda de energia deixa o arquivo antigo ou o novo, nunca um truncado (M23, escrita).** Todos os JSON de estado (config, decisões, pushbacks, chats, autoanálises, consumo, ferramentas, inflight) agora gravam num `.tmp` ao lado e renomeiam por cima do destino. No Windows, um EPERM transitório de antivírus cai em copiar e apagar, que não é atômico mas nunca é pior que a escrita direta de antes.
- **O card "Hoje" do Consumo não zera mais às 21h de Brasília (M17).** O bucket diário do consumo cortava o dia em UTC: entre 21h e meia-noite locais, a sessão ia pro dia seguinte e o card "Hoje" e o gráfico desalinhavam. Server e UI agora cortam no dia local do processo, juntos. Buckets antigos gravados em dia UTC ficam como estão (sem migração, o registro é permanente); a transição pode deslocar por um dia as sessões da noite anterior na série.
- **O "vazio bom" do Radar volta a contar os aprovados de hoje (B12).** O contador comparava epoch em milissegundos fatiado como texto com data ISO e nunca batia (ramo morto da v2.30.0): a fila vazia sempre dizia que nada tinha sido aprovado. A comparação agora é por dia local, na mesma régua do Consumo.
- **Código inline não vira mais markup corrompido no chat e nos relatórios (B18).** `f(*args, **kwargs)` entre crases virava itálico dentro do próprio `<code>`, e link dentro de código virava âncora. O conteúdo de código agora é protegido antes de bold, itálico e link, e restaurado no fim; fora do código tudo formata como sempre.
- **Contagem na fronteira do milhão não mostra mais "1000k" (B19).** O arredondamento do k promovia 999.500 pra "1000k", mentindo a unidade. A promoção pra M agora acompanha o arredondamento: de 999.500 pra cima vira "1,0M".
- **Modelo com major único não exibe mais a data de snapshot como versão (B20).** `claude-sonnet-4-20250514` aparecia como "Sonnet 4.20250514" na tela Consumo; agora é "Sonnet 4", e `claude-haiku-4-5-20251001` segue "Haiku 4.5". Chaves antigas gravadas com o rótulo errado convivem na tela até a história envelhecer (sem migração, mesma decisão do M17).
- **O aviso de teto das Entregas fala o limite real (B21).** A mensagem afirmava 100 quando o teto real da busca é 1000 (fator de 10). O server agora manda o limite no payload e a mensagem usa esse número (fonte única: se o teto mudar, a mensagem acompanha); payload em cache gravado antes do campo existir cai no 1000 atual.

## v2.30.1

Melhoria de UX: feedback visual unificado em todas as operações assíncronas.

**Melhorias**
- **Operações assíncronas nunca ficam silenciosas.** Nove categorias de ação (polling, data loading, análise de PR, merge, chat, ferramentas, update check, settings, session startup) agora mostram feedback visual: spinner animado, progresso com % e texto de etapa, com os padrões consolidados em widgets reutilizáveis (operation widget com progresso, inline pill, toasts de confirmação e typing dots pra respostas).
- **Sistema unificado de operações (`showOp`, `updateOp`, `closeOp`).** Toda ação assíncrona entra no mapa de operações ativas, com atualização de UI em tempo real, ETA visual quando disponível, possibilidade de cancelamento em operações longas, e auto-dismiss após conclusão. Não há mais confusão sobre se o app está travado ou processando.
- **Spinner com CSS animations**, sem gif externo: 6 variações (spin, bounce, fade), todas tematizáveis e suaves em qualquer rede (até 3G). Progress bar com transição suave de %, não em saltos.
- **Três padrões visuais reusáveis:** operation widget (completo, com passo a passo) pra ações focadas, inline pill (compacto, discreto) pra background jobs, e toasts (transientes, confirmação rápida) pra operações one-shot.
- **389 testes green** com cobertura completa dos novos padrões, incluindo cenários de slow network, múltiplas operações simultâneas, erro e cancelamento.

## v2.30.0

Segue o documento de design `Farol Interface` (blocos 1b, 2a, 2c, 2d e 2e).

**Novidades**
- **O Radar virou 3 sub-abas: Pra mim, Meus PRs e Panorama.** A faixa de atalhos que existia antes rolava de lado em janela estreita e escondia metade dos destinos sem avisar que existiam. A busca de PR por URL foi pro Panorama.
- **A borda esquerda dos cards agora indica urgência, não a conta.** Âmbar pro que espera você, vermelho pro que tem bloqueio, azul pro que está rodando, verde pro aprovável. A conta continua visível no ponto e na etiqueta. Como a opção "Só barra" ficaria sem nenhum marcador de conta, as opções de "Identidade nos cards" viraram "Ponto + etiqueta" e "Só ponto", e quem usava a antiga é migrado sozinho.
- **Menu de três pontos no card da fila.** Os 4 botões viraram 1 principal, o chat e um menu. Ignorar é destrutivo e estava a um toque do Revisar: foi pro menu, junto do terminal. O menu abre dentro do card em vez de flutuar por cima.
- **A paleta de comandos traz as decisões pendentes**, incluindo "aprovar as N pendentes", e ganhou botão visível em janela estreita. Antes ela era montada uma vez só ao abrir o app, então as decisões nunca entravam.

**Melhorias**
- **O título do PR não é mais cortado com reticências.** É a informação que faz você decidir se vai revisar, e cortá-la custa mais que a linha extra.
- **Fila vazia passou a confirmar o que o Farol fez** (quantos aprovou hoje, o que monitora, de quanto em quanto tempo), em vez de só dizer que não tem nada.
- **Queda de conexão aparece no meio da tela**, com o número da tentativa. Antes só mudava uma etiqueta no topo, que em janela estreita fica fora de vista.
- **Janela estreita de verdade:** em 380px nada fica abaixo de 11,5px, a ação principal ocupa a linha inteira, a barra de abas quebra em duas linhas, o chat vira uma folha que sobe de baixo e as três sub-abas mantêm os nomes inteiros.
- O emoji de sino saiu das contas silenciadas: o ponto apagado na cor da conta já diz que aquilo está dormindo.

**Correções**
- A contagem ao lado de "Analisando" tinha texto escuro sobre fundo âmbar translúcido em tema escuro, e não dava pra ler.
- As contagens de contexto (Panorama, Meus PRs) deixaram de ser âmbar: se toda contagem é âmbar, nenhuma é urgente.

## v2.29.1

Versão de manutenção: **nada muda na tela nem no comportamento**. Ela existe porque o
código da interface foi reorganizado por dentro e o número da versão precisa acompanhar,
pra uma mesma versão nunca significar dois conteúdos diferentes.

**Por dentro**
- As funções de formatação e de escape da interface (que preparam texto pra ir pra tela) saíram do arquivo de 2.860 linhas onde moravam e ganharam arquivo próprio, com 45 testes. Era o maior arquivo do projeto e o único sem nenhum teste. Entre elas está a que neutraliza HTML antes de exibir, usada em cerca de 240 lugares do app e que nunca tinha sido verificada.

## v2.29.0

**Melhorias**
- **Todas as telas passaram a explicar pra que servem.** O refino de espaçamento que a v2.28.0 fez só na aba Sistema chegou nas outras cinco. Cada seção do app agora tem uma frase abaixo do título dizendo o que ela mostra, com a mesma largura de leitura em todo lugar: eram três tratamentos diferentes pro mesmo tipo de texto, e o Radar não tinha nenhum, apesar de ter seis seções. A descrição do Consumo, que era a maior do app, ficava espremida ao lado do título dentro do cabeçalho; agora é um parágrafo de verdade.
- **O app ficou usável no celular.** Entregas, Destaques e Time não tinham uma linha sequer de regra pra tela estreita. Agora os controles de Entregas ocupam a faixa inteira em vez de se espremer no canto, os cartões de Destaques e Time viram coluna, os botões dos cards de PR ganham largura em vez de sobrar meio botão fora da tela, e o título do PR passa a quebrar em duas linhas em vez de virar reticências.
- **O gráfico do Consumo virou legível no celular.** Ele era desenhado sempre com 820px de largura e depois encolhido pra caber, então num celular os rótulos das datas ficavam com 4 pixels. Agora ele mede o espaço disponível e desenha no tamanho certo, mostrando menos datas quando o espaço é menor. A quebra por tipo/conta/modelo também deixou de espremer a barra num traço.
- **A barra de seções do Radar parou de descolar do topo.** O deslocamento estava cravado em 54 pixels, mas a barra do topo muda de altura (encolhe no celular, cresce quando você monitora mais de uma conta). Dava uma faixa vazada, ou a navegação passava por trás. Agora a altura é medida.

**Acessibilidade**
- **A página passou a ter estrutura.** Não havia nenhum título de nível 1 no documento inteiro, e as abas eram só botões com uma classe: quem usa leitor de tela não tinha como saber quantas abas existem nem qual está aberta. Agora as duas navegações (as 6 abas do topo e as 9 seções do Sistema) se anunciam corretamente, e o estado é mantido junto com a aparência, então os dois não podem mais divergir.
- **Os ícones pararam de ser lidos em voz alta** e os botões que são só ícone (tema, conversar, terminal, fechar) ganharam nome. Os campos de busca, de consulta de PR, de organização, de período e o do chat também: antes o texto só existia como dica que some quando você começa a digitar.
- **Os avisos passaram a ser anunciados.** O toast que confirma "configuração salva" e a faixa de aviso mudavam sem nenhum sinal pra quem não está olhando pra tela.

**Correções**
- O toast podia ficar mais largo que a tela num celular.
- Os controles segmentados (Entregas e Consumo) tinham estilo declarado duas vezes, e a primeira declaração era código morto que nunca pegava. Uma regra de quebra de linha apontava pra uma classe que não existe no app, enquanto os cards de PR, que precisavam dela, ficavam de fora.
- O mesmo seletor de nível aparecia em três tamanhos diferentes dependendo da tela.

## v2.28.0

**Novidades**
- **Escolha quanto o Claude pensa antes de responder.** Em Sistema > Automação, um controle novo de **esforço de raciocínio**, com cinco níveis (padrão do Claude, baixo, médio, alto e muito alto), cada um explicando o que muda e o quanto custa do teu limite. Vale pras sessões autônomas (revisão, autoanálise, pushback, chat e ferramentas); a sessão no terminal não é afetada. O padrão continua sendo deixar o Claude decidir pelo modelo, que é o que o Farol sempre fez, então quem não mexer não vê diferença. Escolhendo Haiku, os cartões desabilitam e explicam o motivo (esse modelo não aceita nível de esforço).
- **Mais modelos pra escolher.** O seletor de modelo das revisões passou de 4 pra 6 opções, com os rótulos dizendo o trade-off de cada uma: além de Opus, Sonnet e Haiku, agora tem **Melhor disponível** (o Claude escolhe o topo da tua conta) e **Fable** (raciocínio longo). Pra caso raro, o `config.json` também aceita o nome completo de um modelo, sem precisar de versão nova do Farol.
- **Busca do Sistema com resultados de verdade.** Digitar na busca da aba Sistema agora devolve uma lista de resultados nomeados, cada um com a seção de onde vem; clicar leva direto pra configuração e pisca a linha. Antes ela acendia várias seções ao mesmo tempo e empilhava tudo na tela. Funciona sem acento (buscar "revisao" acha "Revisão") e avisa quando não encontra nada.
- **As 9 seções do Sistema entraram na paleta de comandos (Ctrl+K).**

**Melhorias**
- **A aba Sistema respira.** As configurações viraram uma linha cada, com o texto à esquerda, o controle à direita e uma divisória entre elas, no lugar do bloco corrido em que tudo ficava colado. A sidebar se separa do conteúdo por espaço em branco em vez de uma borda encostada, a aba ganhou mais largura útil, e cada seção agora tem um título maior com uma frase explicando pra que ela serve. Versão instalada e caminho dos dados foram pro rodapé da sidebar, visíveis de qualquer seção.

**Correções**
- **A revisão em lotes de PR grande nunca tinha funcionado.** Desde a v2.26.0 o Farol media o PR, decidia fatiar em 2 a 4 lotes e montava o plano, mas o plano era descartado antes de chegar no Claude por causa de um argumento perdido no caminho. Na prática, PR grande seguia sendo lido de uma vez só: um PR de 8700 linhas era lido parcialmente e aprovado. Agora o fan-out roda de verdade, com um subagente por lote em paralelo. **A revisão de PR grande fica bem mais completa, e consome mais do teu limite.**
- **Dez divisórias da tela de Sistema não estavam sendo desenhadas.** A cor delas era usada sem nunca ter sido definida, então as separações internas dos cards de conta, do editor de reviewers e do perfil na aba Time simplesmente não apareciam. É boa parte da sensação de "tudo colado".
- **O texto de ajuda dos campos ficava espremido ao lado do campo**, em vez de abaixo dele, em 8 lugares da tela de Sistema.
- **O botão "👥 Reviewers" num PR sem reviewers configurados levava pra uma tela invisível.** Ele abria a aba Sistema mas não a seção de Reviewers, então o usuário via a Visão geral e um aviso falando de algo que não estava na frente dele.
- **O selo de assinatura do Claude aparecia como texto solto**, sem o formato de etiqueta, em Contas e em Plano e chaves.
- **Modelo inválido no `config.json` agora é barrado na largada.** Esse campo entra na linha de comando que o Farol executa e, até aqui, só era validado quando salvo pela tela; editado à mão, passava direto.
- **A tela de Consumo passa a mostrar a versão dos modelos da geração nova** (Opus 5, Sonnet 5, Fable 5), que antes apareciam sem número. Modelos já usados podem aparecer em duas linhas por um tempo, até o histórico novo tomar conta.
- **A UI passa a perguntar ao motor em qual sistema ele está rodando**, em vez de adivinhar pelo navegador. As duas respostas divergiam ao abrir a interface de uma máquina diferente da que roda o Farol.

## v2.27.0

**Novidades**
- **Aba Sistema reorganizada com sidebar de navegação.** No lugar da lista corrida de seções, agora a aba tem uma sidebar fixa à esquerda com 9 seções: Visão geral, Contas, Automação, Conexões, Plano e chaves, Reviewers, Preferências, Novidades e Diagnóstico. Cada seção agrupa as configurações por tema (ex.: os toggles de auto-review, auto-approve, pushback e o modelo ficam em Automação; identidade nos cards, contas silenciadas, som e autostart ficam em Preferências). Um campo de busca no topo da sidebar filtra por texto e mostra só as seções que contêm o termo. Em telas estreitas (abaixo de 720px) a sidebar vira uma faixa horizontal com os mesmos itens. Os controles, IDs e o fluxo de persistência continuam iguais.
- **Perfis nomeados de assinatura do Claude, e um por conta GitHub se você quiser.** O campo único "Assinatura do Claude" (Sistema) vira um gerenciador de perfis: crie quantos precisar (ex.: "BIUD Trabalho", "Pessoal Max"), cada um com o próprio diretório de config, escolha um como padrão do Farol e, opcionalmente, atribua um perfil diferente pra cada conta GitHub monitorada (Sistema > Contas). Sem nenhum perfil criado, nada muda: o campo `claudeConfigDir` legado continua valendo do mesmo jeito, 100% compatível com quem nunca mexeu nisso.
- **Selo de status por conta e por perfil.** Tanto a tabela de contas quanto o gerenciador de perfis mostram, ao lado de cada um, o e-mail logado no diretório de config correspondente, ou "SEM LOGIN" se faltar o `claude login` ali. O selo se atualiza sozinho ao salvar.
- **Botão de login dedicado pras assinaturas Claude, sem precisar sequestrar um PR.** Tanto o perfil padrão quanto cada perfil salvo ganham um botão "Abrir sessão de login", que abre um terminal só com o `claude`, sem tocar em PR, fila ou token do GitHub nenhum.

**Correções**
- **Fechar a sessão de terminal sem terminar a revisão não faz mais o PR sumir da fila.** Fechar a sessão sempre devolve o PR à fila (é seguro: se a revisão foi mesmo postada, o GitHub já não lista mais o PR como pendente).
- **`config.json` editado à mão (ou corrompido) não derruba mais o Farol.** Se o campo dos perfis de assinatura Claude viesse num formato inesperado, toda busca de PR e toda sessão de review quebravam. Agora o Farol se protege desse dado na largada.
- **Caminho de perfil com aspas ou quebra de linha não roda mais comando nenhum.** Um diretório de perfil malformado conseguia escapar do script gerado (Windows ou macOS) e executar o que estivesse escrito ali. Corrigido rejeitando esses caracteres ao salvar.
- **Remover um perfil usado por mais de uma conta não deixa mais ninguém "preso" a ele.**
- **O perfil padrão legado não fica mais invisível depois de virar um perfil novo.** Migrar o campo antigo pra um perfil agora já marca esse perfil como o padrão na hora.
- Salvar cor, rótulo ou org de uma conta não dispara mais, à toa, a checagem de status da assinatura Claude.

## v2.26.1

**Correções**
- **Atualizar no macOS voltou a funcionar.** O pacote de atualização era gerado no Windows com `\` separando as pastas, e o zip exige `/`. No Mac isso derrubava a atualização com "falha ao extrair (unzip): appears to use backslashes as path separators", e nenhuma versão publicada até aqui era instalável por lá pelo botão Atualizar (só pelo instalador offline). O empacotador passa a gravar os caminhos certos e a auditoria do pacote reprova antes de publicar se o defeito voltar.
- **Aviso do unzip não derruba mais a atualização.** O Farol tratava qualquer saída diferente de zero do `unzip` como erro, inclusive o código 1, que no Info-ZIP significa aviso e não falha. Agora quem decide se o pacote presta é a checagem do instalador dentro dele, então um aviso cosmético não interrompe mais quem está atualizando (inclusive vindo de um pacote antigo).

## v2.26.0

**Novidades**
- **PR grande passa a ser revisado em lotes, por vários revisores em paralelo.** Acima de 1000 linhas ou 20 arquivos, o Farol divide os arquivos do PR em 2 a 4 lotes coesos (por afinidade de pasta, então arquivos da mesma feature ficam juntos) e dispara um revisor por lote, ao mesmo tempo. Cada um lê por completo só o lote dele, sabendo quais arquivos estão nos outros lotes, pra poder sinalizar dependência cruzada sem opinar sobre arquivo que não leu. No fim, tudo é consolidado num relatório único, com a decisão tomada uma vez só sobre o conjunto. PR abaixo do limiar (72% dos casos) continua exatamente como era.
- **Motivo, medido e não achado:** revendo 44 reviews reais, o tamanho dos PRs varia 4359 vezes e o tamanho do relatório varia 3; a relação entre linhas do diff e citações de `arquivo:linha` é estatisticamente nula. Nos PRs acima de 2000 linhas, 3 de 5 saíram sem uma única citação ancorada. Uma leitura só não dá conta de 8 mil linhas com atenção, e o resultado aparecia como "nada encontrado".
- **Cobertura da leitura virou informação de primeira classe.** A revisão agora declara quantos arquivos do diff realmente revisou e quais ficaram fora. Se ficou algum de fora (um revisor de lote falhou, por exemplo), o PR vai pra "Precisa da sua atenção" com a lista, em vez de aprovar sozinho. Antes, "nenhum achado" num PR de 74 arquivos era indistinguível de "li um quinto e não vi nada".

**Melhorias**
- **Aprovando com ressalva, a ressalva agora aparece no PR**, escrita com naturalidade, como um revisor sênior mencionaria de passagem. Aprovar segue sendo aprovar (ressalva nunca bloqueia), mas o autor passa a saber o que foi notado. Fica de fora do PR, propositalmente, o que é assunto interno nosso e não recado pro autor: card que não deu pra confirmar por falha de acesso, review que não era pedido a você, discordância com outro review, política de conta e cobertura incompleta.

## v2.25.0

**Novidades**
- **Revisão independente quando outra ferramenta já revisou o PR** (Acrity, SonarQube, Snyk, ou um colega). O Farol passa a formar o veredito dele pelo código e pelo card ANTES de ler o review alheio, pra não ancorar. Se o apontamento do outro é real e passou pela nossa revisão, ele **adota** com a severidade própria: pegar o que a gente perdeu é o principal ganho de ler o review deles.
- **Discordar virou exceção com barra alta, e cada tipo tem nome próprio.** Em vez de chamar tudo de "falso positivo", agora há quatro rótulos, cada um exigindo prova específica: *falso positivo* (o fato está errado; exige `arquivo:linha` que refuta e que não exista leitura razoável em que o apontamento seja verdadeiro), *fora do escopo pactuado* (exige o texto do PR, spec ou card que documenta o adiamento), *pré-existente* (exige o diff provando que o arquivo não foi tocado) e *critério não vigente no repo* (exige contagem medida). **Faltando prova, o Farol fica calado sobre o apontamento e entrega só a análise dele:** silêncio não é erro, e contestar errado queimaria a credibilidade do review inteiro.
- **Contestação nunca sai sozinha pro PR.** Dizer publicamente que outro revisor errou é afirmação séria, então qualquer discordância força o PR pra "Precisa da sua atenção", com o apontamento e a prova na tela, mesmo que a conta esteja configurada pra aprovar sozinha. Vale também pro reprovar sozinho. Discordância sem prova é descartada e não conta como discordância.
- O Farol também não contesta preferência de severidade ou tom, decisão de produto que não é dele, funcionamento interno da outra ferramenta, nem nada só pra economizar trabalho: apontamento real e barato se resolve, não se discute. E concede antes de discordar (se 3 dos 4 apontamentos procedem, isso vem primeiro).

## v2.24.2

**Correções**
- Re-request de review (autor pede sua revisão de novo num PR que você já revisou) agora é identificado de forma confiável e volta a ser revisado sozinho, sem precisar de clique. A causa: a detecção comparava dois resultados de busca diferentes do GitHub (quem me pediu de novo x quem eu já revisei), e essa segunda busca tem indexação assíncrona, então às vezes ficava atrasada em relação à primeira no mesmo ciclo, e o re-request nunca era reconhecido. Agora o "já revisei" vem do histórico local do próprio Farol (instantâneo, sem depender de índice externo), e a auto-revisão relança sozinha assim que detecta, do jeito que já funcionava pra PR novo.

## v2.24.1

**Novidades**
- **Mini-navegação no Radar.** Uma barra de âncoras logo no topo da aba lista só as seções que têm algo pra ver agora (Analisando, Precisa de você, Sua fila, Recentes, Meus PRs, Panorama), com a contagem ao lado; clicar rola suave até lá. Quando a fila cresce, some o scroll de caça.
- **Paleta de comando (`Ctrl+K` / `Cmd+K`).** Abre uma busca central pra ir a qualquer aba ou seção do Radar, disparar Verificar agora ou Alternar tema, e também reconhece uma URL de PR do GitHub ou uma key (`org/repo#NN`) colada ou digitada, abrindo a conversa salva na hora. Navega com <kbd>↑</kbd>/<kbd>↓</kbd>, confirma com <kbd>Enter</kbd>, fecha com <kbd>Esc</kbd>.

## v2.24.0

**Novidades**
- **Clique no alerta leva direto ao PR.** Clicar em qualquer notificação de revisão (aprovado sem/com ressalvas, reprovado, precisa da sua atenção, PR novo único) abre o Farol já no card certo: a tela rola até ele e dá um pulso de destaque. Antes o clique só abria a janela e você caçava o card.
- **Badge de pendências sem abrir o app.** Enquanto houver decisão esperando você, o ícone na barra de tarefas ganha uma bolinha (Windows) ou o Dock mostra o número (macOS), e o tooltip da bandeja diz quantas são. Zerou, o badge some.
- **Atalhos de teclado.** <kbd>J</kbd>/<kbd>K</kbd> navegam nas decisões pendentes, <kbd>A</kbd> aprova, <kbd>M</kbd> pede mudanças, <kbd>C</kbd> comenta, <kbd>P</kbd> pula, <kbd>/</kbd> foca a consulta de PR por URL, <kbd>1</kbd> a <kbd>6</kbd> trocam de aba e <kbd>?</kbd> mostra a lista completa. Nada dispara enquanto você digita num campo, com diálogo aberto ou no chat.

**Melhorias**
- Com a janela do Farol em foco, o aviso aparece só dentro do app (toast); a notificação do sistema não duplica mais o mesmo aviso por cima.

## v2.23.8

**Melhorias**
- Os alertas de revisão dizem o desfecho e o motivo, em vez do tom de "sem você". A taxonomia agora é: **Aprovado sem ressalvas** (revisão completa, nenhum ponto de atenção), **Aprovado com ressalvas** (mostra a primeira ressalva e aponta pra Revisões recentes, onde estão todas), **Reprovado** (mudanças pedidas, com o motivo) e **Precisa da sua atenção** (lidera com o motivo real, não com uma contagem de motivos). A mudança vale pros três canais: notificação do sistema, avisos dentro do app (toasts) e notificação do navegador.

## v2.23.7

Ajuste de quando o pushback aparece, e a aba Novidades de volta em dia.

**Correções**
- O pushback (detecção automática de contestação do autor) agora só é avaliado quando o seu review de fato apontou algo: PR que você bloqueou (pediu mudanças) ou aprovou com ressalva. Aprovação limpa, sem nenhum ponto de atenção, não gera mais pushback (antes qualquer review seu entrava no scan, inclusive aprovação sem ressalva). A resposta do autor depois do review continua sendo condição pra aparecer.
- A aba Novidades tinha parado na 2.23.4; agora lista de novo todas as versões (2.23.5, sobre o "terminal piscando", e 2.23.6, com as correções do macOS, incluídas).

## v2.23.6

**Correções**
- macOS: o Farol agora abre de verdade pelo Finder, Spotlight e Launchpad. O lançador executava o Electron por um script que dependia de `node` no PATH; aberto pelo Finder (que lança com PATH mínimo), morria em silêncio, sem janela e sem log. Agora o lançador executa o binário nativo do Electron direto, sem depender de nada no PATH. Primeira correção validada num Mac de verdade (Apple Silicon), vinda do PR #3 de @thiagocarvalho-dev.
- macOS: a janela sobe na frente e com foco, tanto na abertura quanto no clique seguinte no ícone. Antes ela subia atrás de tudo e sem foco, dando a impressão de que o app não tinha aberto.
- macOS: ícone do Farol no Finder/Spotlight (o `.icns` agora vem no pacote) e também no Dock em execução (antes aparecia o ícone cru do Electron).

## v2.23.5

**Correções**
- Acabou o "terminal piscando": aquela janela de console que abria e fechava sozinha de tempos em tempos enquanto o Farol rodava. A causa não era um comando do Farol (todos já rodam com janela oculta): era a telemetria do GitHub CLI, que dispara um processo próprio desanexado (`gh send-telemetry`), e esse processo, sem console herdado, faz o Windows abrir um console novo visível (na prática, uma janela do Windows Terminal piscando a cada lote). O Farol agora desliga a telemetria do `gh` em tudo o que dispara (`GH_TELEMETRY=false`, o desligamento oficial documentado pelo próprio GitHub CLI), cobrindo os comandos diretos, os `gh` de dentro das revisões e as sessões de terminal. Diagnóstico feito com o registro de processos da v2.23.4 mais um observador de janelas: o flash coincidia com `gh send-telemetry` + `tzutil /g`, nunca com os comandos do Farol.

## v2.23.4

**Correções**
- Quando o autor pede sua revisão DE NOVO (re-request review) num PR que você já tinha revisado, o Farol volta a mostrar o PR na sua fila como "pedida de novo", em vez de deixá-lo parado no Panorama como "aguardando o autor". Antes, como o PR já tinha sido visto na 1ª revisão, a re-solicitação não reaparecia na sua tela. Agora reaparece uma vez (e some quando você re-revisa ou ignora), com o botão "Re-revisar".

**Diagnóstico**
- Novo interruptor "Registrar processos (diagnóstico)" na aba Sistema (vem desligado): quando ligado, registra em `workspace/state/spawns.log` cada comando que o Farol dispara, com horário, pra ajudar a caçar um "terminal piscando" (correlacionar o flash com o comando). Registra só o comando, nunca token.

## v2.23.3

**Melhorias**
- A interface responde melhor a janelas estreitas (útil porque o app já tem bastante aba e painel). Em telas menores: a barra de abas encolhe e rola em vez de estourar o topo, o botão "Verificar agora" vira só o ícone, e as linhas de lista e barras de ação quebram em vez de cortar botão ou texto. Em telas largas nada muda. Testado de 1280px até 400px sem overflow.

## v2.23.2

**Correções**
- A aba Consumo não mostra mais a barra de filtro por conta no topo. Ali a medição é do Farol como um app (uso total de tokens), não de uma conta específica, então o filtro não se aplicava e só dava a falsa sensação de bug (selecionar uma conta e o número não mudar). A quebra "Por conta", que é explícita, continua. O texto da tela deixa isso claro.

## v2.23.1

Ajuste do Consumo de tokens (introduzido na v2.23.0).

**Melhorias**
- O Consumo de tokens saiu da aba Sistema e virou uma **aba própria** (Consumo), uma tela dedicada só pra acompanhar o uso. Agora com gráficos: uma **linha do tempo** (barras por dia) com a métrica selecionável (total, input, output ou cache) e a janela selecionável (7, 30 ou 90 dias), e uma **quebra** por tipo, conta ou modelo. Gráficos leves, sem dependências. Segue sendo só rastreio pessoal: não influencia nenhuma decisão da automação.
- O registro passou a ser permanente: saiu o botão de zerar, pra o histórico não se perder.

## v2.23.0

Registro de consumo de tokens e mais histórico de revisões recentes.

**Novidades**
- Novo painel **Consumo de tokens** (aba Sistema): mostra quanto as sessões autônomas do Claude gastaram (revisão, autoanálise, pushback, ferramentas e chat), com total, hoje e últimos 7 dias, e quebras por tipo, por conta e por modelo. É só rastreio pra você ter noção do gasto no dia a dia; não muda nada na automação, a qualidade segue sendo o único critério das decisões. O registro é local e sem custo extra (lê o que a própria sessão já reporta).

**Melhorias**
- "Revisões recentes" mostra mais histórico: a tela passa a receber as 30 mais recentes (era 8) e o histórico guardado sobe pra 200 (era 30), pra você não perder o que fez faz tempo.

## v2.22.0

Aba Entregas: a visão do que entrou nos projetos e de quem está entregando.

### Novidades
- **Aba Entregas.** Uma tela nova mostra os PRs mergeados, por qualquer pessoa (não só o que o Farol revisou), em duas fatias: **por repositório** (o pulso de cada projeto) e **por responsável** (quem está entregando). Cada grupo mostra a contagem e expande pra lista de PRs. Escolha o período no topo: **Hoje, 7, 15 ou 30 dias**. É só leitura, nada é postado. Quando uma organização tem entregas demais no período, a tela avisa que está mostrando as mais recentes.
- **Seletor de organização na aba Entregas.** A visão é por organização: a sua principal (a primeira monitorada) já vem selecionada, e você troca pra outra org num clique. Com mais de uma conta, cada org aparece com a conta dona.

## v2.21.0

As revisões postadas passam a parecer escritas por você, não por um bot.

### Novidades
- **Review humano e personalizado.** O corpo que o Farol posta no PR deixa de ter cara de máquina: saíram os carimbos que entregavam a automação ("aprovado automaticamente pelo Farol", "pedido de mudanças automático", "por isso não auto-aprovei") e o formato rígido de template (caixas de alerta, "Placar", checklist de critérios, prefixos "suggestion (non-blocking)"). No lugar, o review sai no seu tom, direto e sem travessão, e o formato **se adapta à senioridade do autor**: com estágio/júnior vira uma prosa de mentor (reconhece o que ficou bom, explica os ajustes, enquadra como "quase lá"); com pleno/sênior/arquiteto fica enxuto e direto, de par pra par. Usa todo o perfil da pessoa (papel, competência por área, histórico de pushback) pra personalizar, sem mudar a decisão nem o rigor. As ressalvas de um PR auto-aprovado seguem visíveis pra você em Revisões recentes, só não vão mais coladas no PR com carimbo.

## v2.20.0

Consulte a conversa de qualquer PR pela URL, mesmo os que já saíram da lista.

### Novidades
- **Consultar um PR por URL.** Um campo discreto embaixo de "Revisões recentes": cole a URL de um PR e o Farol abre a conversa salva dele (o teu chat com o Claude sobre aquele review), mesmo que o PR não apareça mais na lista, seja porque saiu pelo limite de 30 recentes, seja porque está numa conta que não é a selecionada. Reusa o mesmo painel de chat de sempre; nada do fluxo atual muda. As conversas ficam guardadas mesmo depois que a revisão sai do histórico.

## v2.19.1

Qualidade de volta como padrão: Opus e pushback ligados, com a economia disponível pra quem quiser.

### Correções
- **Padrões voltaram pra qualidade.** Na v2.19.0 eu tinha deixado Sonnet e o pushback desligado como padrão (mirando economia). Revertido: o padrão volta a ser o **Opus** (melhor) e a **detecção de pushback ligada**. As opções de economia (Sonnet/Haiku, desligar o pushback) continuam ali em Sistema pra quem um dia quiser, mas não são mais o padrão. O conserto que importa segue: se o limite do plano estourar, o Farol retoma sozinho no reset, sem largar o PR sem análise, então dá pra priorizar qualidade sem se preocupar com o teto.

## v2.19.0

O Farol gasta muito menos do teu limite do Claude, e se recupera sozinho quando o limite reseta.

### Novidades
- **Modelo leve nas revisões (Sonnet por padrão).** As sessões autônomas do Farol (review, pushback, autoanálise) passam a rodar em Sonnet, que consome bem menos do teto do teu plano Claude que o Opus. Dá pra escolher o modelo em Sistema (Sonnet, Haiku, Opus ou o padrão do claude); a sessão no terminal não é afetada. Se você quer a revisão mais afiada e não se importa com o gasto, é só voltar pra Opus.
- **Detecção automática de pushback agora é opt-in.** Como ela roda uma sessão do Claude por PR contestado (consumindo do teu limite), passou a vir **desligada**; ligue em Sistema se quiser. A marcação manual de pushback continua funcionando sempre.

### Correções
- **Erro transitório não estaciona mais o PR sem análise.** Quando a revisão falha por algo que se resolve sozinho (limite do plano atingido, queda de rede, ou o `claude` temporariamente indisponível), o Farol agora **retoma sozinho** no próximo ciclo (o limite volta no reset), em vez de largar o PR na fila sem análise esperando você clicar. Só estaciona de vez depois de várias tentativas.

## v2.18.0

Escolha qual assinatura do Claude o Farol usa, sem mexer no seu login principal.

### Novidades
- **Assinatura do Claude por diretório (Sistema).** Antes o Farol usava sempre o login do `claude` da máquina, então as revisões e a classificação de pushback consumiam a sua conta principal (por exemplo, a de trabalho). Agora dá pra apontar, no campo "Assinatura do Claude" em Sistema, um diretório de config próprio, logado noutra conta: as sessões do Farol (as automáticas e as de terminal) passam a usar aquela assinatura, sem tocar no seu `claude` de codar. Alternar entre assinaturas é só trocar esse caminho (vazio volta pra padrão da máquina). Você faz o `claude login` nesse diretório uma vez; a aba Saúde mostra a conta em uso e avisa se o diretório ainda não tem login. Sem isso configurado, nada muda.

## v2.17.0

O pushback agora é detectado sozinho, direto do PR, sem você marcar à mão.

### Novidades
- **Detecção automática de pushback.** Quando o autor contesta um review seu no próprio PR (responde, rebate, re-pede review), o Farol percebe sozinho e classifica o desfecho (o autor tinha razão, você tinha, ou meio-termo), sem depender da sua marcação. Como funciona: um gatilho barato olha se o autor teve atividade depois do seu review; só aí o Farol lê a thread (leitura pura, nunca posta nada) pra julgar. Quando o desfecho fica claro, ele registra sozinho; quando fica em dúvida, aparece um "confirmar?" em Revisões recentes com o desfecho sugerido, e você resolve num toque, só os ambíguos. Tudo isso alimenta o perfil da pessoa e calibra o tom dos reviews futuros dela, sem mexer na decisão técnica. A marcação manual continua existindo, agora como correção quando você discordar do que o Farol inferiu.

## v2.16.1

Pente-fino: correções encontradas numa revisão do projeto.

### Correções
- **Não duplica mais a revisão de um PR já em análise.** Clicar "Revisar" (ou dois cliques rápidos) num PR que já estava sendo revisado sozinho não abre mais uma segunda revisão do mesmo PR.
- **Aprovação por conta mais segura.** Se você põe uma conta pra aguardar sua ação nos PRs impecáveis, os PRs com ressalva também aguardam (antes, num caso de configuração, o PR com ressalva podia ser aprovado sozinho enquanto o impecável esperava).
- **O seletor de papel no card do PR não fecha mais sozinho.** Enquanto você escolhe o papel de alguém no card, uma atualização de fundo não interrompe mais a escolha.
- **Kudos sempre da conta certa ao abrir Destaques.** Não aparece mais, por um instante, o resumo da conta anterior.
- **Novidades completas.** As versões 2.0.0 (a cara nova) e 1.19.0 (multi-conta) voltaram pra lista de novidades do app, que as tinha pulado.

## v2.16.0

O Farol passa a lembrar dos pushbacks pra calibrar os reviews futuros de cada pessoa.

### Novidades
- **Memória de pushback.** Quando um review seu é contestado e o autor tinha razão (ou não), você registra isso num clique na linha de "Revisões recentes": o desfecho (o autor tinha razão · nós tínhamos razão · meio-termo) e uma nota curta opcional. A partir daí, nas próximas revisões automáticas daquela pessoa, o Farol leva o histórico em conta pra calibrar a postura: onde ela já mostrou que estava certa, ele afirma com mais humildade antes de apontar algo parecido; onde você estava certo, mantém a posição com clareza. Como o resto do perfil, isso mexe só no tom e na postura, nunca na decisão técnica.

## v2.15.0

A senioridade vira um perfil de verdade: papel da pessoa + competência por domínio.

### Novidades
- **Perfil de review por pessoa (papel + matriz por domínio).** A marcação única de senioridade deu lugar a dois eixos. O **papel** cobre carreira e posição (Estágio, Júnior, Pleno, Sênior, e agora também Tech Lead, Arquiteto e Especialista) e dá o tom-base do review. A **matriz por domínio** (Backend, Frontend, Dados, Infra, cada um em Básico → Autoridade) reconhece que a mesma pessoa pode ser autoridade numa área e estar começando em outra: no domínio onde ela é autoridade o review defere e foca no alto nível; onde ela está começando, explica mais e pega os fundamentos com cuidado. Continua valendo a regra de ouro: isso muda só o tom e a postura, nunca a decisão técnica (aprovar, pedir mudanças, o card, o gate seguem pelos fatos do código). O papel se marca no card do PR e na aba Time; a matriz por domínio fica na aba Time. Quem você já tinha marcado como Estágio/Júnior/Pleno/Sênior é migrado sozinho pro papel, nada se perde.

## v2.14.0

Dá pra marcar a senioridade de alguém direto do card do PR, não só na aba Time.

### Novidades
- **Seletor de senioridade no card do PR (fila e "Precisa de você").** Antes a senioridade só era marcável na aba Time, que lista quem já foi revisado ao menos uma vez, então o primeiro PR de alguém novo (um estágio que acabou de chegar, por exemplo) saía sempre com o tom neutro. Agora o seletor aparece junto do autor no próprio card, tanto na fila quanto em "Precisa de você", então você marca no momento em que vê o PR e a revisão já sai no tom certo. A marcação é a mesma da aba Time (uma por pessoa), só ganhou mais um lugar pra ser feita.

## v2.13.0

Contas diferentes passam a ser revisadas em paralelo.

### Novidades
- **Uma revisão por conta ao mesmo tempo.** Antes o Farol revisava um PR por vez no total, então uma análise demorada de uma conta segurava a fila das outras. Agora cada conta roda a sua revisão em paralelo (a BIUD e a pessoal, por exemplo, ao mesmo tempo), e dentro da mesma conta continua uma por vez, pra não pesar demais na máquina. A separação por conta que veio no patch anterior já garante que nada se mistura na tela.

## v2.12.1

A revisão em andamento no Radar passa a respeitar a conta selecionada.

### Correções
- **"Analisando agora" e a fila passam a respeitar a conta selecionada.** Antes, a revisão em andamento e a fila apareciam iguais em qualquer conta, então enquanto o Farol analisava um PR de uma conta você via aquilo mesmo estando em outra. Agora a seção do Radar filtra pela conta escolhida (em "Todas" mostra tudo), sem misturar trabalho e pessoal. As demais seções (Precisa de você, panorama, fila de cards) já respeitavam.

## v2.12.0

A revisão automática passa a falar no tom certo pra cada pessoa, pela senioridade dela.

### Novidades
- **Senioridade por pessoa (aba Time).** Cada pessoa do time ganha um seletor de senioridade (Estágio, Júnior, Pleno ou Sênior), marcado à mão. A revisão automática usa isso pra ajustar o TOM e a forma de comunicar o veredito: com um estágio, reconhece a iniciativa e explica os ajustes como aprendizado, sem desanimar mesmo quando pede mudança; com uma pessoa sênior, vai direto ao ponto. É só linguagem: a decisão técnica (aprovar, pedir mudanças, o card, o gate) continua igual pra todo mundo, valendo só pelos fatos do código. Quem você não marcar recebe o tom neutro de sempre. Vale na revisão autônoma (a que o Farol posta); a sessão de terminal segue como está.

## v2.11.0

A automação por conta agora age no que já estava esperando, explica quando segura um aprovável, e ganha a opção de reprovar sozinho.

### Correções
- **"Revisa na hora" passa a valer pros PRs que já estavam na fila.** Antes a auto-revisão só disparava pra PR que acabava de chegar, então se você ligava "revisa na hora" numa conta, o que já estava esperando ficava parado até o clique manual (era o "configurei e não agiu"). Agora vale pra toda a fila elegível da conta. PRs que você cancelou, ou que falharam por motivo que não é rede, ficam de fora até você reabrir, pra não ficar relançando sozinho.
- **Quando um aprovável fica esperando por causa da sua política, agora fica claro o porquê.** Antes o PR ia pra "Precisa de você" mostrando só os motivos técnicos; agora o motivo diz que foi a política da conta que segurou (e como mudar em Sistema > Contas), pra você não achar que o Farol ignorou a regra.

### Novidades
- **Reprovar sozinho, opt-in por conta.** Cada conta ganha um quarto controle, "quando tem bloqueios": por padrão espera você, mas você pode ligar "reprova sozinho" pra que, num review pedido a você e com bloqueios reais, o Farol poste o "pedir mudanças" com os pontos anexados (marcado como automático). Desligado por padrão; clique no panorama nunca posta; e ele não re-pede mudanças se você já pediu.

## v2.10.0

O resumo de kudos agora respeita a conta selecionada, e os controles de automação por conta ficaram mais claros.

### Correções
- **Kudos compilados passam a respeitar o filtro de conta.** Antes o resumo de destaques do time aparecia igual em qualquer conta, então na conta pessoal você via kudos de trabalho (e vice-versa). Agora o kudos é por conta: cada conta tem a sua compilação, gerada só com os destaques daquela conta, e o painel some quando a conta selecionada ainda não tem kudos gerado. Em "Todas" ele compila o conjunto todo, como antes.

### Melhorias
- **Rótulos da automação por conta reescritos pra ficarem óbvios.** Os três controles do painel Contas agora dizem em palavras diretas o que fazem ("quando chega um PR pra você", "quando fica aprovável sem ressalvas", "quando fica aprovável com ressalvas"), com uma linha explicando que o que você não escolher segue o padrão geral, e opções sem jargão ("revisa na hora", "só põe na fila", "aprova e destaca as ressalvas", "espera você aprovar").

## v2.9.0

Cada conta do GitHub decide sozinha como o Farol age nos PRs dela.

### Novidades
- **Política automática por conta (painel Contas, aba Sistema).** Cada conta ganha três controles próprios: (1) **quando chega revisão** (revisa sozinho, só põe na fila ou herda o padrão global); (2) **PR aprovável sem ressalva** (aprova sozinho ou aguarda sua ação); (3) **PR aprovável com ressalva** (aprova ressaltando os pontos de atenção ou aguarda você). Assim a conta do trabalho pode revisar e aprovar sozinha o que é seguro, enquanto a pessoal só põe na fila e espera você decidir, sem misturar as regras. O que você não configurar por conta segue o padrão global (os dois toggles gerais em Sistema), que continua valendo pra tudo.

### Melhorias
- **Filtro por conta reforçado no Time e no Destaques.** As duas visões respeitam a conta selecionada na barra, então dá pra ver só o que pertence àquele GitHub sincronizado.

## v2.8.3

Confirmação com impacto nas ações que mexem no GitHub.

### Melhorias
- **Merge, Merge como admin e Pedir mudanças agora confirmam com impacto.** Essas ações escrevem no GitHub (e o merge admin fura o gate de review do time), então passam a abrir a caixa de confirmação, igual ao Remover conta, explicando o que a ação faz antes de agir, no lugar do aviso genérico do navegador.

### Interno
- **Build do instalador de macOS reproduzível em qualquer SO.** O `tools/make-offline-mac.sh` foi refeito pra baixar o Electron darwin e embutir (o Mac descompacta na instalação), então dá pra gerar o `.command` sem um Mac, de forma repetível.

## v2.8.2

Primeiro instalador de macOS (beta) de verdade, anexado à release.

### macOS
- **Instalador beta pra macOS (Apple Silicon), montado sem um Mac.** A release passa a incluir o `Farol-Instalar-mac.command`. O truque: em vez de montar o app do Electron no Windows (o que quebraria os symlinks do `.app`), o instalador embute o Electron para macOS e deixa o próprio Mac descompactar na hora da instalação, offline. Como o suporte a macOS nunca rodou num Mac de verdade, é beta: baixe, na 1ª vez abra com botão direito > Abrir (quarentena), e se algo quebrar use "Exportar diagnóstico" (Sistema > Saúde) e mande o relatório. Com esse retorno a gente corrige e libera a versão final. Macs Intel (x64) ainda não têm instalador; peça que a gente gera.

## v2.8.1

Preparação do suporte a macOS.

### macOS
- **Instalação de macOS mais robusta.** O `install.sh` passou a garantir o bit de execução do Electron ao instalar, pra não depender de o pacote preservar as permissões (importante pro instalador montado fora do Mac).

## v2.8.0

Um jeito de pedir socorro (e um freio antes de remover conta).

### Novidades
- **Exportar diagnóstico** (Sistema > Saúde). Um clique gera um relatório com o essencial pra corrigir um problema: versão, plataforma, ambiente (gh/claude/git bash), contas, config, estado atual e o log de falhas. Não inclui token nem senha. Você copia e manda pra quem mantém o Farol. É especialmente útil pra destravar o suporte a macOS: quem instalar no Mac gera o relatório e manda, e dá pra reparar o que estiver quebrando sem precisar de acesso à máquina.

### Melhorias
- **Remover conta com confirmação clara.** O botão Remover (no painel Contas) agora abre uma caixa que explica o impacto antes de agir: o que para de ser monitorado, o que não é apagado (o seu GitHub e a memória de reviews ficam intactos) e que dá pra readicionar depois. No lugar do aviso genérico do navegador.

## v2.7.0

Contas gerenciáveis pela tela, e a auto-aprovação passa a ser opt-in.

### Novidades
- **Editor de contas na aba Sistema.** Dá pra adicionar e remover conta, e editar o rótulo, a cor, o tipo (Trabalho/Pessoal) e as organizações de cada uma, direto na tela, sem precisar abrir o config.json. O tipo é o que faz a faixa de identidade dizer "1 de trabalho e 1 pessoal"; a cor é a que separa as contas no painel.

### Mudanças
- **"Aprovar sozinho tudo que for aprovável" agora vem DESLIGADO por padrão.** Antes vinha ligado; como o Farol é público e usado por mais gente, cada pessoa passa a decidir o próprio nível de automação. Se você quer que ele poste o APPROVE sozinho nos PRs aprováveis, ligue em Sistema > Configurações. O gate estrito de sempre (aprova sozinho só os casos sem ressalva) continua valendo com a opção desligada.
- **A barra de contas não mostra mais o contador de PRs pendentes fora do Radar.** Em Destaques e Time o número não tinha a ver com o conteúdo da aba.

## v2.6.1

O seletor de reviewers só oferece quem faz parte da organização.

### Correções
- **Candidatos de reviewer por organização.** Ao configurar os reviewers de um projeto, o dropdown listava as pessoas de todas as orgs monitoradas juntas, então na conta pessoal apareciam colegas do trabalho (e vice-versa), o que não faz sentido: não dá pra pedir review de quem não é da org. Agora cada org oferece só os próprios membros e times. Se uma org não tem membros enumeráveis (ex.: um namespace pessoal sem organização no GitHub), o campo vira uma entrada pra digitar o handle na mão.

## v2.6.0

Destaques e Time separados por conta: nada de misturar trabalho e pessoal.

### Novidades
- **Destaques e Time agora separam por conta.** Quando você monitora mais de uma conta do GitHub, as abas Destaques e Time agrupam por conta (e a barra de contas volta pra elas, pra filtrar como no Radar), em vez de jogar tudo num balaio só. Cada review passa a guardar a organização de origem, então a memória sabe de qual conta veio.
- **Registros antigos num grupo "Geral".** A memória gravada antes desta versão não tinha essa marca de conta (principalmente no Time), então esses registros aparecem juntos num grupo "Geral" até o autor ser revisado de novo. Daqui pra frente, tudo entra já separado.

## v2.5.0

Reviewers por projeto reinventado: um padrão por organização, e só as exceções aparecem.

### Novidades
- **Padrão por organização.** Você define uma vez o grupo de reviewers de uma org (ex.: os 8 do biudtech), e ele vale pra todos os projetos dela quando você clica em "👥 Reviewers". Chega de repetir a mesma lista repo a repo (era a maior fonte de poluição visual da tela de Sistema).
- **Só as exceções aparecem.** Os projetos que fogem do padrão viram uma linha enxuta com o diff ("padrão − fulano", "padrão + ciclano"); os que seguem o padrão colapsam numa linha só ("14 projetos seguem o padrão"). De dezenas de blocos altos pra um padrão + poucas exceções.
- **Migração num clique.** Quem já tinha listas repetidas por repo vê um botão "Criar padrão" que detecta o grupo comum, vira o padrão e recolhe os projetos iguais na hora, deixando só as diferenças como exceção.
- **O botão "👥 Reviewers" agora funciona em qualquer repo da org**, mesmo sem config própria: ele cai no padrão da org. Antes, num repo sem lista, o botão não fazia nada.

## v2.4.2

A barra de contas só onde ela filtra: no Radar.

### Correções
- **Barra de contas some das abas onde não fazia nada.** Antes, o seletor de contas (Todas / por conta) aparecia também em Sistema, Time e Destaques, mas trocar de conta ali não mudava o conteúdo (Sistema é global; Time e Destaques são memória do time, sem separação por conta). Agora a barra aparece só no Radar, que é onde ela realmente filtra, e some nas outras abas pra não confundir.

## v2.4.1

Atualização não mente mais: se o Farol não conseguiu ler as releases, ele diz.

### Correções
- **Diagnóstico de atualização honesto.** Quando o Farol não consegue ler as releases do canal de update (o repositório está sem acesso pra sua conta, ainda não tem release, ou a rede falhou), a aba Sistema passa a deixar isso claro, em vez de mostrar "você está na versão mais recente" e esconder que existia atualização. Se o repo de update for privado, a conta primária do gh precisa ter acesso a ele (ou o repo precisa ser público).

## v2.4.0

Aprovável é aprovado na hora: o Farol não fica mais dependendo do seu clique, e deixa os pontos de atenção claros.

### Novidades
- **Aprova sozinho tudo que for aprovável.** Quando a revisão automática conclui que o PR está aprovável (veredito approve), o Farol posta o APPROVE na mesma hora, sem esperar sua decisão, em vez de parar em "Precisa de você" nos casos com ressalva. Vale só pros reviews que pediram a você (revisão iniciada por clique no panorama continua nunca postando sozinha).
- **Pontos de atenção sempre claros.** Ao aprovar sozinho, o Farol anexa as ressalvas ao próprio comentário do APPROVE no PR (ex.: "card não totalmente comprovado", checks em andamento), e mostra esses pontos em "Revisões recentes" (é só expandir o item). Nada de aprovar no escuro.
- **Controle em Configurações.** O comportamento vem ligado. Em Sistema > Configurações, "Aprovar sozinho tudo que for aprovável" desliga isso: aí o Farol só aprova sozinho os casos sem ressalva (protocolo estrito de antes) e chama você no resto.

## v2.3.0

O "Re-revisar" do panorama voltou a ser útil: só aparece quando o código mudou.

### Melhorias
- **Panorama detecta review desatualizada.** Um PR que você já aprovou (ou pediu mudanças) volta a mostrar o botão "Re-revisar" quando, e só quando, entra commit novo depois da sua review. Sem commit novo, ele fica como "nada a fazer" (aprovado) ou "aguardando o autor" (mudanças pedidas), sem o botão que não fazia sentido. O Farol compara o commit da sua última review com o topo atual do PR, best-effort: em qualquer incerteza, não reintroduz o botão.

## v2.2.0

Menos poluição no editor de reviewers: cada projeto sob a sua conta dona.

### Melhorias
- **Reviewers por projeto agrupados por conta.** Quando você monitora mais de uma conta, a lista de reviewers por projeto (aba Sistema) deixa de ser um bloco único e passa a mostrar cada projeto sob a conta dona (Pessoal, BIUD, etc.), com a cor da conta no cabeçalho. Projetos de orgs fora das suas contas caem em "Outros". Conta única continua com a lista simples de sempre.

## v2.1.0

Suas contas do GitHub, separadas e claras: de quem é o PR, por qual conta você responde, e o que silenciar.

### Novidades
- **Barra de contas.** Uma barra no topo alterna entre Todas e cada conta do GitHub que você monitora (trabalho, pessoal, mais de um emprego). Cada conta ganha cor e identidade próprias, e a visão foca só naquela conta com um clique, sem misturar.
- **De quem e por quem.** Cada card mostra o autor do PR (quem escreveu, @handle da pessoa) separado da sua conta (a cor e a etiqueta). Ao focar uma conta, a faixa do topo diz "revisando e postando como @você", pra nunca haver dúvida de qual identidade responde.
- **Contas silenciadas.** Aquele PR de teste antigo, de uma empresa que você não mexe mais, sai da visão Todas, dos avisos e da auto-revisão, sem ser perdido: ele continua ali, intacto, e reaparece ao selecionar a conta. Silencie e reative na aba Sistema > Contas.
- **Painel de contas.** A aba Sistema lista suas contas com identidade, org e estado, e um botão pra silenciar ou reativar cada uma.

### Melhorias
- **Panorama mais honesto.** Um PR que você já aprovou não mostra mais o botão "Re-revisar" (que só faz sentido quando entra commit novo); no lugar, fica o estado ("nada a fazer" ou "aguardando o autor").
- **Dois ajustes de exibição** (Sistema): como as contas silenciadas aparecem na visão Todas (recolher, esmaecer ou ocultar) e quanto marcador de conta cada card mostra (barra e etiqueta, só barra ou só ponto).
- **Reviewers por projeto** mais enxuto na aba Sistema.

## v2.0.0

A cara nova do Farol: um painel de comando pras suas revisões, com o Radar no centro.

### Novidades
- **Navegação lateral no lugar das abas do topo.** Radar, Destaques, Time e Sistema agora ficam numa barra à esquerda, com a conta sempre à vista no rodapé e um aviso no Radar quando alguma decisão está esperando por você.
- **Resumo do dia no Radar.** Uma faixa no topo mostra num relance quantas decisões precisam de você, o tamanho da sua fila, o que está sendo analisado agora e quantos PRs você já revisou hoje. Tudo lido do estado real, sem número inventado.

### Melhorias
- **Cards e listas mais legíveis.** A fila, o panorama, os Meus PRs e o feed ao vivo das revisões ganharam respiro e hierarquia melhores, mantendo a identidade do farol e exatamente os mesmos fluxos (revisar, conversar sobre o PR, autoanálise, pedir reviewers e mergear).

## v1.19.0

Um Farol para todas as suas contas do GitHub: o trabalho e o pessoal no mesmo radar.

### Novidades
- **Acompanhe várias contas ao mesmo tempo.** O Farol agora observa mais de uma conta do GitHub de uma vez (a do trabalho e a pessoal, por exemplo) e junta os PRs das duas no mesmo painel. Cada PR sabe de qual conta veio, e toda ação (buscar, revisar, comentar, pedir reviewers, mergear, abrir no terminal) usa o token certo daquela conta, sem misturar identidade nem te obrigar a trocar de login. Quem usa uma conta só não muda nada: continua como estava.

### Notas
- **Como ativar o multi-conta.** Preencha o bloco `accounts` no `~/.farol/config.json` (uma entrada por conta, com o login e as organizações que ela observa). Sem esse bloco, o Farol segue no modo de conta única de sempre.
- **Novo endereço das atualizações.** A partir desta versão o Farol se atualiza a partir do repositório pessoal (`wandersonaadsantos/farol`).

## v1.18.0

Autoanálise que virou passado não engana mais: commit novo zera o veredito.

### Melhorias
- **A autoanálise de um PR é descartada quando entra commit novo.** Se você analisa, vê o veredito, e depois empurra um commit que muda o cenário, o card volta pra "não analisado" (em vez de mostrar o resultado velho, que já não vale). É só reanalisar quando quiser.
- **"Merge (admin)" não aparece quando não resolve.** Se o repo usa ruleset que o `--admin` não fura, o card mostra "Precisa de aprovação" em vez do botão que ia falhar.

### Correções
- Times enterprise (que o GitHub não aceita como reviewer de PR) saíram do seletor de reviewers e não são mais tentados, então o log parou de encher de aviso. Merge admin barrado por ruleset virou aviso, não erro, no log.
- **Fonte de update = release do GitHub (git), uma só.** O app instalado passa a atualizar só a partir das releases publicadas, nunca de código local ainda não mergeado. A pasta-fonte local vira opt-in (só se `updateSource` apontar um caminho no config).

## v1.17.0

Configurar quem revisa ficou visual: escolha as pessoas e times de uma lista, por projeto.

### Novidades
- **Seletor de reviewers por projeto.** Em Sistema, cada repo tem seus reviewers escolhidos de uma lista dos membros e times da organização (chips), sem digitar handle na mão (nada de typo). Os times aparecem pelo nome.
- **Copiar o grupo pra outros repos.** Cada projeto tem um "copiar pra…" que replica a lista inteira de reviewers em quantos repos você quiser de uma vez, sem re-selecionar todo mundo.
- **Botão "Reviewers" sem config leva pra tela de configuração.** Se o repo ainda não tem reviewers definidos, clicar no botão abre a configuração já com o projeto pronto pra você escolher, em vez de mostrar um erro.

### Correções
- Release notes deixam de sair com acentos e emojis quebrados (o publish-release passou a ler o CHANGELOG como UTF-8).

## v1.16.0

Instalar ficou um clique: um único `.exe` que instala e abre. E cada PR seu passou a mostrar de onde pra onde ele vai.

### Novidades
- **Instalador de arquivo único (Windows).** Agora é um `Farol-Setup-vX.Y.Z.exe` só: duplo clique instala e abre o Farol. Sem extrair zip, sem procurar o `Instalar.cmd` no meio de vários arquivos, sem terminal.
- **De/para de branch nos cards.** Cada PR em "Meus PRs" mostra a branch de origem e a de destino (ex.: `feature/x → develop`), pra você bater o olho e saber o rumo do merge.
- **Botão "👥 Reviewers" por PR.** Configure os reviewers padrão de cada projeto (aba Sistema) e, num clique no card, o Farol te atribui e pede review dessa lista, na hora, sem confirmação. Aceita pessoas e times (`org/time`).

### Correções
- O instalador não exige mais `node`/`npm` no modo offline (o Electron já viaja embutido e só é copiado), coerente com o "sem pré-requisitos".

## v1.15.0

As cópias instaladas passam a se atualizar sozinhas.

### Novidades
- **Atualização automática por GitHub Releases.** Cada máquina checa a última release (pelo `gh` que você já usa) e se atualiza sozinha quando sai versão nova. O download é leve: só os arquivos do app, o Electron já está instalado. Assim, toda versão publicada chega no time sem reinstalar na mão.

### Notas
- Bootstrap: cópias anteriores à 1.15.0 não têm o auto-update; instale a 1.15.0+ uma vez pra ligar o mecanismo. Daí pra frente, automático.

## Versões anteriores (resumo)

- **v1.14.0** — Instalador offline com o Electron embutido (sem Node/npm/download).
- **v1.13.0** — Auto-merge só é oferecido quando o repo permite; senão, sobra o Merge (admin) com aviso.
- **v1.12.0** — Aba Sistema passou a listar as novidades de cada versão.
- **v1.11.0** — O botão Merge só aparece quando dá pra mergear de verdade (lê a mergeabilidade real do PR).
- **v1.10.0** — Quando a proteção de branch bloqueia, o Farol oferece Auto-merge ou Merge como admin.
- **v1.9.0** — Botão pra copiar um prompt de correção/melhoria a partir da autoanálise, pronto pra colar no chat.
- **v1.8.0** — Botão Merge nos "Meus PRs" aprováveis (só os seus, com as travas de segurança).
- **v1.7.0** — Nível do agente (Opus/Sonnet) visível na análise e fila de análise transparente (um por vez, com posição).
