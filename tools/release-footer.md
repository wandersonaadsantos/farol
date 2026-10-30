## 📦 Instalar / Atualizar

- **Farol nativo no macOS 14 ou mais novo (quando anexado):** baixe o `Farol-{VERSION}.dmg`, abra e arraste o Farol para Aplicativos. É assinado e notarizado, e se atualiza sozinho.
- **Farol nativo no Windows 10 1809 ou mais novo e no Windows 11 (quando anexado):** abra o `Farol.appinstaller` (ou o `Farol-{VERSION}.msix`). Instala pelo App Installer do Windows, e se atualiza sozinho.
- **Primeira instalação (Windows):** baixe o `Farol-Setup-v{VERSION}.exe` abaixo e dê um duplo clique. Instala e abre sozinho, sem extrair zip.
- **Primeira instalação (macOS):** baixe `Farol-Instalar-mac.command` para Apple Silicon ou `Farol-Instalar-mac-x64.command` para Intel, quando disponíveis nos anexos. Na 1ª vez o macOS bloqueia por não ter assinatura paga: clique com o botão direito no arquivo e escolha **Abrir**.
- **Quem já tem o Farol:** use **Atualizar agora** ou aguarde a atualização automática. A partir da 2.78.4, o app também baixa o instalador completo quando precisa trocar o Electron. Versões anteriores ainda podem exigir uma última instalação pelo pacote completo para receber essa melhoria.
- **Pré-requisitos** (uma vez, o time já costuma ter): `gh` autenticado (`gh auth login`) e pelo menos um provedor no PATH: Claude Code (`claude`) ou Codex CLI (`codex`, autenticado pelo ChatGPT). O instalador não traz esses CLIs.
- Na 1ª execução o SmartScreen pode avisar (app sem assinatura paga): **Mais informações → Executar assim mesmo**.

## Anexos

- `Farol-{VERSION}.dmg` (quando anexado): Farol nativo para macOS 14 ou mais novo.
- `appcast.xml` (junto do dmg): feed de atualização do Farol nativo no macOS (não precisa baixar à mão).
- `Farol-{VERSION}.msix` (quando anexado): Farol nativo para Windows 10 1809 ou mais novo e Windows 11.
- `Farol.appinstaller` (junto do msix): instala o msix e mantém o Farol nativo do Windows atualizado.
- `Farol-Setup-v{VERSION}.exe`: instalação no Windows (Electron embutido).
- `Farol-Instalar-mac.command` (quando anexado): instalação no macOS, Apple Silicon (Electron embutido).
- `Farol-Instalar-mac-x64.command` (quando anexado): instalação no macOS, Intel (Electron embutido).
- `farol-v{VERSION}.zip`: pacote leve do auto-update (não precisa baixar à mão).
