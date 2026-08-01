# Farol

Radar de Pull Requests para Windows e macOS. O Farol monitora o GitHub em segundo plano (só comandos `gh`, zero tokens de IA), mostra um painel com os PRs abertos da organização, avisa quando pedem sua revisão e, com um clique, abre uma sessão do Claude Code com `/pr-review` seguindo o protocolo de triagem e auto-approve seguro.

É a evolução do antigo "PR Reviewer (Windows)" em PowerShell: mesma lógica, agora como app de desktop com interface, bandeja do sistema e instalador.

## Instalar

### Jeito mais fácil (offline, sem pré-requisitos)

Um arquivo único com o Electron já embutido: não precisa de Node, npm nem download.

- **Windows**: dê dois cliques em `Farol-Setup-vX.Y.Z.exe`. Instala e abre sozinho, sem extrair zip nem escolher arquivo.
- **macOS**: dê dois cliques em `Farol-Instalar-mac.command` (na 1ª vez, botão direito > Abrir, por causa da quarentena de arquivos baixados).

Ainda são necessários o **GitHub CLI** (`gh auth login`) e o **Claude Code** (`claude`) no PATH pra o Farol funcionar (é o que ele orquestra), mas não pra instalar. O instalador do Windows é gerado por `tools/make-installer.ps1` e o do macOS por `tools/make-offline-mac.sh` (roda em qualquer sistema: ele baixa o Electron do macOS e embute; o `.app` só é montado na hora da instalação, no Mac). Sem assinatura de código, o SmartScreen/Gatekeeper avisa uma vez.

### Jeito leve (precisa de Node)

1. Pré-requisitos: Node.js, GitHub CLI (`gh`, autenticado na conta de trabalho: `gh auth login`) e Claude Code (`claude`, logado na sua própria conta).
2. Dê dois cliques em `Instalar.cmd` (ou rode `installer\install.ps1`). O Electron é baixado via `npm` na primeira vez.
3. Abra o **Farol** pelo Menu Iniciar.

Na primeira execução o Farol detecta a conta ativa do seu `gh` e usa ela; se você tiver mais de uma, ajuste em **Sistema → Conta do GitHub**. Nenhuma conta ou token viaja com o app: o token é pedido ao `gh` da sua máquina em tempo de execução, e a sessão de review usa o seu Claude Code.

O instalador copia o app para `%USERPROFILE%\.farol\app` (fora do AppData de propósito: o Claude Code empacotado enxerga o `%LOCALAPPDATA%` virtualizado e o estado divergiria), cria atalhos (Menu Iniciar e Desktop) e migra automaticamente o estado de instalações antigas (PRs já vistos, memória do time, destaques, log e config), inclusive mesclando o overlay MSIX se existir.

Para desinstalar: `Desinstalar.cmd`. O estado é preservado por padrão (`uninstall.ps1 -RemoveData` apaga tudo).

### macOS

1. Pré-requisitos: Node.js, GitHub CLI (`gh auth login`) e Claude Code no PATH (via Homebrew ou npm).
2. No Terminal, na pasta do Farol: `bash Instalar.command` (o zip vindo do Windows não preserva a permissão de execução, então a primeira vez é com `bash`, não duplo clique).
3. Abra o **Farol** por `~/Applications` (ou Spotlight).

O instalador copia o app para `~/.farol/app` e cria o lançador `~/Applications/Farol.app`. Desinstalar: `bash Desinstalar.command` (estado preservado; `bash installer/uninstall.sh --remove-data` apaga tudo).

**Importante**: o suporte a macOS foi construído sem um Mac de teste. Se algo falhar, abra o Claude Code na pasta do Farol e peça pra ele seguir a seção "macOS" do `CLAUDE.md`, que tem o checklist de validação e o mapa do que é específico de cada sistema.

## Como funciona

```
%USERPROFILE%\.farol\
├─ app\               código do app (Electron + engine Node, sem outras dependências)
├─ workspace\         diretório de trabalho das sessões do Claude
│  ├─ CLAUDE.md       protocolo de review (triagem, auto-approve, memória do time)
│  ├─ .claude\        comandos /pr-review, /pr-health, /pr-kudos + agente pr-reviewer
│  └─ state\          seen, autores, destaques, farol.log
└─ config.json        configurações do app
```

- **Radar**: sua fila de revisão + panorama de todos os PRs abertos das orgs monitoradas. Automático, só o que pediram a sua revisão; qualquer outro PR do panorama tem o botão **Revisar** pra rodar sob demanda, e nesses o resultado sempre cai em "Precisa de você" (nada é postado sem o seu clique).
- **Meus PRs (autoanálise)**: a seção lista os PRs abertos de autoria sua (inclusive rascunhos). O botão **Analisar** roda o Claude sobre o seu próprio PR e devolve, só pra você, um veredito (**aprovável** ou **precisa de ajuste**), o que ajustar antes de pedir review e dicas de melhoria não-bloqueantes. É diagnóstico puro: **nenhuma ação no git ou no GitHub**, nada é postado, o resultado fica na tela (e some sozinho quando o PR fecha, ou no botão **Descartar**).
- **Destaques**: os momentos exemplares registrados nos reviews, com o botão que compila internamente o resumo de kudos (resultado na tela, com copiar). O Diagnóstico em Sistema roda interno do mesmo jeito.
- **Time**: a memória por autor (recorrências e ganhos observados a cada review).
- **Sistema**: saúde do ambiente, versão e atualização, configurações e o log de falhas (`/pr-health` usa esse log pra corrigir o próprio Farol).

### Versão e atualização

A versão instalada aparece ao lado do logo e em **Sistema → Versão e atualização**. Quando há uma versão mais nova, aparece o botão **Atualizar agora**: o app encerra as instâncias, troca os arquivos sem duplicar a instalação (estado, memória do time e configurações ficam intactos, os atalhos são recriados no mesmo lugar) e reabre sozinho.

A **fonte de verdade do update é a release do GitHub** (`updateRepo`, por padrão `wandersonaadsantos/farol`): o app instalado checa a última release via o `gh` que você já usa e **se atualiza sozinho**. O download é leve (só os arquivos do app; o Electron já está instalado). Ou seja, o app instalado só sobe pra código que já está no git (mergeado e publicado), nunca pra trabalho local em andamento: uma fonte de verdade só.

Opt-in de desenvolvimento: se você quiser que o app instalado atualize a partir de uma **pasta-fonte local** (pra testar um build antes de publicar), defina o caminho em `updateSource` no config.json. Vazio (padrão) = usa só as releases.

### Revisão autônoma (padrão)

Quando chega PR, o Farol roda o review **internamente** (Claude Code headless, sem janela): lê o card no Jira, roda o agente `pr-reviewer` e decide pelo protocolo. Sem blocker e com o card atendido, ele **posta o APPROVE sozinho**, registra a memória do time e te notifica ("aprovado sem você"). Nos casos especiais (blocker, card não-verificável, CI vermelho), nada é postado: o PR entra na seção **Precisa de você**, com o relatório completo e botões Aprovar / Pedir mudanças / Comentar / Pular, esperando você voltar.

Enquanto a análise roda, a seção **Analisando agora** mostra o passo a passo em tempo real (comandos, leitura do card, triagem), com o tempo decorrido e um botão **Cancelar** que mata a sessão e devolve o PR pra fila. Se a análise cair no meio (queda de internet, por exemplo), o PR volta visível pra fila na hora e o Farol relança sozinho quando a conexão volta (até 2 tentativas); se o app for fechado com análise em andamento, ela é retomada na próxima abertura em vez de sumir em silêncio.

### Conversar com o Claude (por PR)

Todo PR tem um botão 💬 **Conversar** (no card da fila, no card de decisão e nas revisões recentes). Abre um chat lateral onde o Claude retoma a **própria sessão da revisão** (ele chega sabendo o diff, o card e o relatório) e pode examinar o PR com `gh`. Dá pra pedir esclarecimento sobre um achado, pedir um rascunho de resposta e mandar postar ("posta esse comentário no PR"); ele só posta no GitHub o que for pedido explicitamente na conversa. A conversa fica salva por PR e sobrevive a reinício do app.

O terminal interativo continua disponível como opção secundária (ícone de terminal no card da fila). O app cuida do ambiente nos dois modos (`GH_TOKEN` da conta de trabalho, Git Bash, pager desligado) e pré-registra o workspace como confiável no Claude Code, então nenhuma sessão trava em diálogo de confiança.

Tema escuro por padrão; o sol/lua no topo alterna pro claro.

## Compartilhando com o time

Pra distribuir, gere o pacote limpo:

```
powershell -ExecutionPolicy Bypass -File tools\make-package.ps1
```

Sai um `dist\farol-vX.Y.Z.zip` **auditado automaticamente**: o script falha se detectar config, estado, logs, `node_modules` ou qualquer coisa com cara de token/conta pessoal. É esse zip que você manda pro time (nunca compartilhe `%USERPROFILE%\.farol`, que contém o seu estado e a sua memória de reviews).

Cada pessoa do time precisa, na própria máquina:

1. **Node.js** (o instalador baixa o Electron via `npm install` na primeira vez).
2. **GitHub CLI** autenticado na conta corporativa dela: `gh auth login`.
3. **Claude Code** logado na conta dela (o `claude` precisa estar no PATH).
4. Opcional, recomendado: o conector do **Jira/Atlassian** configurado no Claude Code dela, pro review ler os cards BT. Sem ele o fluxo continua funcionando, só trata todo card como "não-verificável" (não faz auto-approve sozinho).

A revisão autônoma vem **ligada** de fábrica (é o propósito do app): ao chegar PR, o Claude Code da pessoa roda o review internamente e posta APPROVE quando o protocolo permite, na conta dela. Quem preferir só ser notificado desliga em **Sistema → Revisar automaticamente**. O modo terminal sem prompts (`--dangerously-skip-permissions`) segue desligado por padrão.

## Desenvolvimento

- `npm start` abre o app Electron apontando para os dados reais (`%USERPROFILE%\.farol`).
- `node server.js` sobe só o engine + UI em `http://127.0.0.1:47170` (modo navegador, útil pra depurar).
- Variáveis úteis: `FAROL_HOME` (muda a pasta de dados) e `FAROL_REVIEW_CMD` (substitui o `claude` por um stub em testes).
- Ícones: `tools\make-icons.ps1` gera os PNGs e `node tools\pack-ico.js` empacota o `.ico`.
