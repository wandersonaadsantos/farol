## 📦 Instalar / Atualizar

- **Primeira instalação (Windows):** baixe o `Farol-Setup-v{VERSION}.exe` abaixo e dê um duplo clique. Instala e abre sozinho, sem extrair zip.
- **Primeira instalação (macOS):** baixe `Farol-Instalar-mac.command` para Apple Silicon ou `Farol-Instalar-mac-x64.command` para Intel, quando disponíveis nos anexos. Na 1ª vez o macOS bloqueia por não ter assinatura paga: clique com o botão direito no arquivo e escolha **Abrir**.
- **Quem já tem o Farol:** use **Atualizar agora** ou aguarde a atualização automática. A partir da 2.77.7, o app também baixa o instalador completo quando precisa trocar o Electron. Versões anteriores ainda podem exigir uma última instalação pelo pacote completo para receber essa melhoria.
- **Pré-requisitos** (uma vez, o time já costuma ter): `gh` autenticado (`gh auth login`) e pelo menos um provedor no PATH: Claude Code (`claude`) ou Codex CLI (`codex`, autenticado pelo ChatGPT). O instalador não traz esses CLIs.
- Na 1ª execução o SmartScreen pode avisar (app sem assinatura paga): **Mais informações → Executar assim mesmo**.

## Anexos

- `Farol-Setup-v{VERSION}.exe`: instalação no Windows (Electron embutido).
- `Farol-Instalar-mac.command` (quando anexado): instalação no macOS, Apple Silicon (Electron embutido).
- `Farol-Instalar-mac-x64.command` (quando anexado): instalação no macOS, Intel (Electron embutido).
- `farol-v{VERSION}.zip`: pacote leve do auto-update (não precisa baixar à mão).
