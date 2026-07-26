# Changelog do Farol

Notas de versão do Farol (radar de Pull Requests). O `tools/publish-release.ps1`
publica a seção da versão atual como corpo da release no GitHub, então escreva
aqui pensando em quem instala e usa, não no código.

Convenção: cada versão tem uma linha de resumo e os grupos **Novidades**,
**Melhorias** e **Correções** (só os que existirem). Descreva só o que mudou:
o `publish-release.ps1` anexa sozinho o rodapé padrão (**Instalar / Atualizar**
e **Anexos**, de `tools/release-footer.md`) e o título **Farol vX.Y.Z**.

## v2.13.0

Contas diferentes passam a ser revisadas em paralelo.

### Novidades
- **Uma revisão por conta ao mesmo tempo.** Antes o Farol revisava um PR por vez no total, então uma análise demorada de uma conta segurava a fila das outras. Agora cada conta roda a sua revisão em paralelo (a BIUD e a pessoal, por exemplo, ao mesmo tempo), e dentro da mesma conta continua uma por vez, pra não pesar demais na máquina. A separação por conta que veio no patch anterior já garante que nada se mistura na tela.

## v2.12.1

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
