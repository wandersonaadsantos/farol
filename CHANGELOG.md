# Changelog do Farol

Notas de versão do Farol (radar de Pull Requests). O `tools/publish-release.ps1`
publica a seção da versão atual como corpo da release no GitHub, então escreva
aqui pensando em quem instala e usa, não no código.

Convenção: cada versão tem uma linha de resumo e os grupos **Novidades**,
**Melhorias** e **Correções** (só os que existirem). Descreva só o que mudou:
o `publish-release.ps1` anexa sozinho o rodapé padrão (**Instalar / Atualizar**
e **Anexos**, de `tools/release-footer.md`) e o título **Farol vX.Y.Z**.

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
