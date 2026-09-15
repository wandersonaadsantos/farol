# Farol

[![CI](https://github.com/wandersonaadsantos/farol/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/wandersonaadsantos/farol/actions/workflows/ci.yml)
[![Licença MIT](https://img.shields.io/badge/licen%C3%A7a-MIT-informational)](LICENSE)

Radar de Pull Requests para Windows e macOS. O Farol monitora o GitHub em segundo plano (só comandos `gh`, zero tokens de IA), mostra um painel com os PRs abertos da organização, avisa quando pedem sua revisão e executa o protocolo de triagem e auto-approve seguro com Claude Code ou Codex CLI.

O Farol nasceu de uma iniciativa do Thiago ([@thiagopcdev](https://github.com/thiagopcdev)), o "PR Reviewer (Windows)" em PowerShell: um revisor de PRs que rodava numa janela de terminal e dependia de ação manual. O app atual capturou essa essência e reconstruiu o sistema do zero como app de desktop com interface, bandeja do sistema e instalador.

## Instalar

Requisitos do sistema: **Windows de 64 bits (x64 ou ARM64)**, **macOS 13 (Ventura) ou posterior** em Intel ou Apple Silicon, ou **Linux de 64 bits (x64 ou ARM64, experimental)**. O Electron 44 deixou de oferecer suporte a macOS 12, Windows de 32 bits e Linux ARM de 32 bits; os instaladores recusam esses sistemas antes de alterar uma instalação existente. [Compatibilidade do Electron 44](https://www.electronjs.org/docs/latest/breaking-changes/#removed-macos-12-support).

### Jeito mais fácil (offline, sem pré-requisitos)

Um arquivo único com o Electron já embutido: não precisa de Node, npm nem download.

- **Windows**: dê dois cliques em `Farol-Setup-vX.Y.Z.exe`. Instala e abre sozinho, sem extrair zip nem escolher arquivo.
- **macOS**: dê dois cliques em `Farol-Instalar-mac.command` (na 1ª vez, botão direito > Abrir, por causa da quarentena de arquivos baixados).

Ainda são necessários o **GitHub CLI** (`gh auth login`) e pelo menos um provedor de IA no PATH: **Claude Code** (`claude`) ou **Codex CLI** (`codex`, autenticado pelo ChatGPT). O instalador do Windows é gerado por `tools/make-installer.ps1` e o do macOS por `tools/make-offline-mac.sh` (roda em qualquer sistema: ele baixa o Electron do macOS e embute; o `.app` só é montado na hora da instalação, no Mac). Sem assinatura de código, o SmartScreen/Gatekeeper avisa uma vez.

### Jeito leve (precisa de Node)

1. Pré-requisitos: Node.js, GitHub CLI (`gh`, autenticado na conta de trabalho: `gh auth login`) e Claude Code (`claude`) ou Codex CLI (`codex`) autenticado na sua própria conta.
2. Dê dois cliques em `Instalar.cmd` (ou rode `installer\install.ps1`). O Electron é baixado via `npm` na primeira vez.
3. Abra o **Farol** pelo Menu Iniciar.

Na primeira execução o Farol detecta a conta ativa do seu `gh` e usa ela; se você tiver mais de uma, ajuste em **Sistema → Contas**. Nenhuma conta ou token viaja com o app: o token é pedido ao `gh` da sua máquina em tempo de execução, e cada conta pode usar um perfil Claude Code ou Codex configurado em **Sistema → Plano e chaves**.

O instalador copia o app para `%USERPROFILE%\.farol\app` (fora do AppData de propósito: o Claude Code empacotado enxerga o `%LOCALAPPDATA%` virtualizado e o estado divergiria), cria atalhos (Menu Iniciar e Desktop) e migra automaticamente o estado de instalações antigas (PRs já vistos, memória do time, destaques, log e config), inclusive mesclando o overlay MSIX se existir.

Para desinstalar: `Desinstalar.cmd`. O estado é preservado por padrão (`uninstall.ps1 -RemoveData` apaga tudo).

### macOS

1. Pré-requisitos: Node.js, GitHub CLI (`gh auth login`) e Claude Code ou Codex CLI no PATH.
2. No Terminal, na pasta do Farol: `bash Instalar.command` (o zip vindo do Windows não preserva a permissão de execução, então a primeira vez é com `bash`, não duplo clique).
3. Abra o **Farol** por `~/Applications` (ou Spotlight).

O instalador copia o app para `~/.farol/app` e cria o lançador `~/Applications/Farol.app`. Desinstalar: `bash Desinstalar.command` (estado preservado; `bash installer/uninstall.sh --remove-data` apaga tudo).

**Importante**: o suporte a macOS foi construído sem um Mac de teste. Se algo falhar, abra o Claude Code na pasta do Farol e peça pra ele seguir a seção "macOS" do `CLAUDE.md`, que tem o checklist de validação e o mapa do que é específico de cada sistema.

## Como funciona

```
%USERPROFILE%\.farol\
├─ app\               código do app (Electron + engine Node, sem outras dependências)
├─ workspace\         diretório de trabalho das sessões de IA
│  ├─ CLAUDE.md       protocolo de review (triagem, auto-approve, memória do time)
│  ├─ .claude\        comandos /pr-review, /pr-health, /pr-kudos + agente pr-reviewer
│  └─ state\          seen, autores, destaques, farol.log
└─ config.json        configurações do app
```

- **Radar**: sua fila de revisão + panorama de todos os PRs abertos das orgs monitoradas. Automático, só o que pediram a sua revisão; qualquer outro PR do panorama tem o botão **Revisar** pra rodar sob demanda, e nesses o resultado sempre cai em "Precisa de você" (nada é postado sem o seu clique).
- **Meus PRs (autoanálise)**: a seção lista os PRs abertos de autoria sua (inclusive rascunhos). O botão **Analisar** roda o provedor do perfil associado sobre o seu próprio PR e devolve, só pra você, um veredito (**aprovável** ou **precisa de ajuste**), o que ajustar antes de pedir review e dicas de melhoria não-bloqueantes. É diagnóstico puro: **nenhuma ação no git ou no GitHub**, nada é postado, o resultado fica na tela (e some sozinho quando o PR fecha, ou no botão **Descartar**).
- **Destaques**: os momentos exemplares registrados nos reviews, com o botão que compila internamente o resumo de kudos (resultado na tela, com copiar). O Diagnóstico em Sistema roda interno do mesmo jeito.
- **Time**: a memória por autor (recorrências e ganhos observados a cada review).
- **Sistema**: saúde do ambiente, versão e atualização, configurações e o log de falhas (`/pr-health` usa esse log pra corrigir o próprio Farol).

### Versão e atualização

A versão instalada aparece ao lado do logo e em **Sistema → Versão e atualização**. Quando há uma versão mais nova, aparece o botão **Atualizar agora**: o app encerra as instâncias, troca os arquivos sem duplicar a instalação (estado, memória do time e configurações ficam intactos, os atalhos são recriados no mesmo lugar) e reabre sozinho.

A **fonte de verdade do update é a release do GitHub** (`updateRepo`, por padrão `wandersonaadsantos/farol`): o app instalado checa a última release via o `gh` que você já usa e **se atualiza sozinho**. O download é leve (só os arquivos do app; o Electron já está instalado). Ou seja, o app instalado só sobe pra código que já está no git (mergeado e publicado), nunca pra trabalho local em andamento: uma fonte de verdade só.

Opt-in de desenvolvimento: se você quiser que o app instalado atualize a partir de uma **pasta-fonte local** (pra testar um build antes de publicar), defina o caminho em `updateSource` no config.json. Vazio (padrão) = usa só as releases.

### Revisão autônoma (padrão)

Quando chega PR, o Farol roda o review **internamente** com o provedor do perfil associado à conta (Claude Code ou Codex CLI, sem janela) e decide pelo protocolo. Sem blocker e com o card atendido, ele **posta o APPROVE sozinho**, registra a memória do time e te notifica ("aprovado sem você"). Nos casos especiais (blocker, card não-verificável, CI vermelho), nada é postado: o PR entra na seção **Precisa de você**, com o relatório completo e botões Aprovar / Pedir mudanças / Comentar / Pular, esperando você voltar.

Enquanto a análise roda, a seção **Analisando agora** mostra o passo a passo em tempo real (comandos, leitura do card, triagem), com o tempo decorrido e um botão **Cancelar** que mata a sessão e devolve o PR pra fila. Se a análise cair no meio (queda de internet, por exemplo), o PR volta visível pra fila na hora e o Farol relança sozinho quando a conexão volta (até 2 tentativas); se o app for fechado com análise em andamento, ela é retomada na próxima abertura em vez de sumir em silêncio.

### Conversar com a IA (por PR)

Todo PR tem um botão 💬 **Conversar** (no card da fila, no card de decisão e nas revisões recentes). Abre um chat lateral onde o provedor retoma a **própria sessão da revisão** (ele chega sabendo o diff, o card e o relatório) e pode examinar o PR com `gh`. Dá pra pedir esclarecimento sobre um achado, pedir um rascunho de resposta e mandar postar ("posta esse comentário no PR"); ele só posta no GitHub o que for pedido explicitamente na conversa. A conversa fica salva por PR e sobrevive a reinício do app.

O terminal interativo continua disponível como opção secundária (ícone de terminal no card da fila). O app cuida do ambiente nos dois modos (`GH_TOKEN` da conta de trabalho, Git Bash e pager desligado) e abre o CLI do perfil associado.

Tema escuro por padrão; o sol/lua no topo alterna pro claro.

## Perguntas frequentes: commit novo durante a revisão

### Por que o card aparece com o selo "COMMIT NOVO"?

O autor empurrou commit enquanto o Farol lia o PR. O texto da revisão fala do código anterior, então o Farol **não posta**: postar ancorado no commit antigo o GitHub recusa, e postar sem âncora deixaria um review falando de código que ninguém leu. Por isso o card de commit novo não tem Aprovar, Pedir mudanças nem Só comentar. O que vale é a revisão do commit atual.

### O Farol revisa de novo sozinho? Quanto tempo leva?

Sim, em conta com revisão automática ligada. A caixa azul do card diz a hora: "Reviso de novo sozinho a partir de 19:47". A conta é:

1. **5 minutos sem push novo** no PR (proteção contra rajada de commits);
2. mais **o próximo ciclo de verificação** (no mínimo 3 minutos, o intervalo configurado em Sistema);
3. mais **o tempo da própria revisão**.

Na prática o card fica de 10 a 25 minutos na mesa antes de ser substituído pela revisão nova. Enquanto a caixa estiver azul, não há nada pra fazer. **Revisar agora** é só um atalho: roda a revisão já, no commit atual, e a postagem segue as mesmas regras de sempre.

### Pedi revisão de novo no GitHub. O Farol do revisor pega?

Depende de onde o PR está no Farol de quem revisa:

| situação no Farol do revisor | o que o seu pedido faz |
|---|---|
| card de commit novo na mesa (caixa azul) | nada a mais, e não precisa: a revisão nova já sai sozinha |
| card de commit novo parado (caixa âmbar, "já tentei neste commit") | destrava: o Farol volta a tentar sozinho |
| revisão estacionada por falha | destrava: sai do estacionamento e volta pra fila automática |
| alguém clicou **Pular** e o PR segue pedindo a revisão dessa pessoa | destrava: o PR volta pra fila |
| revisão cancelada por quem revisa, ou PR **ignorado** | nada: foi decisão da pessoa, e só ela reabre |

Commit novo tem o mesmo efeito do pedido nas três linhas que destravam. O Farol só aceita commit ou pedido **posterior** à parada, e o mesmo sinal nunca destrava duas vezes. O pedido precisa ser pra conta que o Farol usa naquela org.

### Quando o Farol NÃO revisa de novo sozinho?

A caixa fica âmbar e diz o motivo. As saídas:

| o card diz | o que fazer |
|---|---|
| a revisão automática está desligada na conta | ligue em Sistema > Contas, ou use Revisar agora |
| a conta está silenciada | tire o silêncio, ou use Revisar agora |
| a conta está sem login no gh | rode `gh auth login` com essa conta |
| o orçamento do perfil desta conta estourou | espere liberar ou ajuste o teto em Consumo |
| o PR está como rascunho | o Farol volta a revisar quando o PR sair de rascunho |
| outra pessoa já está revisando este PR | espere a label `<conta>:revisando` sair |
| saí de cena porque outra pessoa pegou este PR | use Revisar agora se quiser revisar mesmo assim |
| outra pessoa já deu um review decisivo neste commit | o Farol confere de novo a cada 5 minutos e volta sozinho se o review sair |
| outro aparelho seu está cuidando deste PR | nada: a sincronização entre aparelhos evita revisão dobrada |
| a última tentativa falhou e ficou estacionada | volta sozinho com commit novo ou pedido de revisão; ou use Revisar agora |
| já tentei neste commit e a revisão não terminou | idem: commit novo ou pedido de revisão destrava |
| há outra decisão deste PR esperando você | decida o outro card primeiro |

### O autor continua empurrando commit durante cada revisão. O Farol fica gastando sessão?

Não indefinidamente. Depois de **3 revisões seguidas** que pegaram commit novo no meio, o Farol passa a esperar **30 minutos sem push** (em vez de 5) antes de tentar de novo, e a caixa diz "Próxima tentativa a partir de...". Ele volta sozinho depois disso, sem clique. A contagem zera quando uma revisão termina normalmente.

Até a v2.59.2 havia um teto de 3 revisões automáticas por PR por dia, e o 4º push do dia só era revisado com clique ou no dia seguinte. Esse teto local caiu. **Com a sincronização entre aparelhos ligada**, o teto compartilhado de 3 revisões automáticas por PR por dia continua valendo entre os seus aparelhos, e o card mostra esse caso como "outro aparelho seu está cuidando deste PR".

### Cliquei Pular por engano. E agora?

Se o PR ainda pede a sua revisão, ele volta sozinho pra fila quando chegar commit novo ou quando o autor pedir revisão de novo. Pra trazer na hora, abra o PR no Panorama e clique em Revisar.

## Compartilhando com o time

Pra distribuir, gere o pacote limpo:

```
powershell -ExecutionPolicy Bypass -File tools\make-package.ps1
```

Sai um `dist\farol-vX.Y.Z.zip` **auditado automaticamente**: o script falha se detectar config, estado, logs, `node_modules` ou qualquer coisa com cara de token/conta pessoal. É esse zip que você manda pro time (nunca compartilhe `%USERPROFILE%\.farol`, que contém o seu estado e a sua memória de reviews).

Cada pessoa do time precisa, na própria máquina:

1. **Node.js** (o instalador baixa o Electron via `npm install` na primeira vez).
2. **GitHub CLI** autenticado na conta corporativa dela: `gh auth login`.
3. **Claude Code** ou **Codex CLI** logado na conta dela (o CLI escolhido precisa estar no PATH).
4. Opcional, recomendado para perfis Claude: o conector do **Jira/Atlassian** configurado no Claude Code dela, pro review ler os cards BT. Sem ele o fluxo continua funcionando, só trata todo card como "não-verificável" (não faz auto-approve sozinho).

A revisão autônoma vem **ligada** de fábrica (é o propósito do app): ao chegar PR, o provedor associado à conta roda o review internamente e posta APPROVE quando o protocolo permite, na conta dela. Quem preferir só ser notificado desliga em **Sistema → Revisar automaticamente**. O modo terminal sem prompts (`--dangerously-skip-permissions`, no Claude) segue desligado por padrão.

## Privacidade e responsabilidade

O Farol **não coleta nem envia nenhum dado ao mantenedor**. Não existe telemetria, analytics nem servidor do projeto: tudo o que o app registra fica na sua máquina, em `~/.farol` (log de falhas, consumo das automações de IA, decisões de review, configurações). O app inclusive desliga a telemetria do próprio GitHub CLI nas sessões que dispara (`GH_TELEMETRY=false`).

O tráfego de rede que existe é todo em seu nome, com as suas credenciais:

- **GitHub**, via o `gh` da sua máquina (polling de PRs, postagem de reviews, checagem de release pro auto-update);
- **Anthropic**, quando o perfil usa Claude Code (assinatura ou chave de API suas);
- **OpenAI**, quando o perfil usa Codex CLI autenticado pelo seu plano ChatGPT.

Sobre responsabilidade: os reviews que o Farol posta saem **na sua conta do GitHub**, e as sessões de análise consomem **o plano ou os créditos do provedor configurado**. As automações de postagem (auto-approve pra todo PR, reprovação automática) são opt-in, e quem as liga responde pelo que é postado. O software é distribuído "no estado em que se encontra", sem garantia, nos termos da licença MIT (arquivo `LICENSE`).

Nunca compartilhe a sua pasta `~/.farol`: ela contém o seu estado, as suas configurações e a sua memória de reviews. Pra distribuir o app, use sempre o pacote auditado de `tools\make-package.ps1`.

## Contribuindo

Leia o [guia de contribuição](.github/CONTRIBUTING.md): invariantes do projeto, ambiente, gate de qualidade e padrão de PR. Todo push e todo PR passam pelo CI (`npm run check`, `npm run lint`, `npm test`) em Linux, Windows e macOS.

Encontrou uma falha de segurança? Não abra issue. Siga a [política de segurança](.github/SECURITY.md), que descreve o canal privado, o modelo de ameaça do app e o que está fora de escopo.

Quem participa do projeto segue o [Código de Conduta](.github/CODE_OF_CONDUCT.md).

## Licença

[MIT](LICENSE).

## Desenvolvimento

- `npm start` abre o app Electron apontando para os dados reais (`%USERPROFILE%\.farol`).
- `node server.js` sobe só o engine + UI em `http://127.0.0.1:47170` (modo navegador, útil pra depurar).
- Variáveis úteis: `FAROL_HOME` (muda a pasta de dados) e `FAROL_REVIEW_CMD` (substitui o `claude` por um stub em testes).
- Ícones: `tools\make-icons.ps1` gera os PNGs e `node tools\pack-ico.js` empacota o `.ico`.
