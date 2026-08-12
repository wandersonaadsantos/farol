## 📦 Instalar / Atualizar

- **Primeira instalação (Windows):** baixe o `Farol-Setup-v{VERSION}.exe` abaixo e dê um duplo clique. Instala e abre sozinho, sem extrair zip.
- **Primeira instalação (macOS):** quando esta release trouxer o anexo `Farol-Instalar-mac.command`, baixe-o e dê um duplo clique. Se o arquivo não aparecer nos anexos, não há build de macOS publicado nesta versão. Na 1ª vez o macOS bloqueia por não ter assinatura paga: clique com o botão direito no arquivo e escolha **Abrir** (só nessa primeira vez). O anexo, quando presente, é para Apple Silicon; em Mac Intel, peça o build x64.
- **Quem já tem o Farol 1.15.0+:** não precisa fazer nada, a atualização chega sozinha (o app checa as releases e se atualiza).
- **Pré-requisitos** (uma vez, o time já costuma ter): `gh` autenticado (`gh auth login`) e `claude` no PATH. O Farol usa os dois; o instalador não os traz.
- Na 1ª execução o SmartScreen pode avisar (app sem assinatura paga): **Mais informações → Executar assim mesmo**.

## Anexos

- `Farol-Setup-v{VERSION}.exe`: instalação no Windows (Electron embutido).
- `Farol-Instalar-mac.command` (quando anexado): instalação no macOS, Apple Silicon (Electron embutido).
- `farol-v{VERSION}.zip`: pacote leve do auto-update (não precisa baixar à mão).
