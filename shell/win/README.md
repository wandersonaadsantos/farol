# Farol: casca Windows

A casca Windows é o `Farol.exe`, um aplicativo C# em WinUI 3 (Windows App SDK),
empacotado em MSIX. Ela não tem regra de negócio: sobe o motor Node do Farol
(`server.js`) como processo filho (sidecar), pareia com ele, mostra a interface
num WebView2 e cuida do que é do sistema (bandeja, badge, notificação, abrir com
o Windows, instância única). O motor continua sendo quem decide tudo.

Alvo: Windows 10 1809 (build 17763) ou mais novo, x64.

## Onde está o desenho

- Desenho geral: [`docs/superpowers/specs/2026-10-27-farol-nativo-swiftui-winui-design.md`](../../docs/superpowers/specs/2026-10-27-farol-nativo-swiftui-winui-design.md) (seções 4.1 e 4.3)
- Índice dos planos e interfaces fixadas: [`docs/superpowers/plans/2026-10-28-farol-nativo-indice.md`](../../docs/superpowers/plans/2026-10-28-farol-nativo-indice.md)

## Estrutura

| projeto | alvo | papel |
|---|---|---|
| `Farol.Contrato` | `net8.0` | lógica pura e testável (políticas, parsers, decisões atrás de interface). Sem WinUI e sem Windows App SDK, para rodar no xUnit sem janela e fora do Windows |
| `Farol.Sidecar` | `net8.0-windows10.0.17763.0` | o motor como processo filho: arranque, Job Object, recuo de religação |
| `Farol.App` | `net8.0-windows10.0.19041.0` (mínimo 10.0.17763.0) | a casca WinUI 3: janela, WebView2, bandeja, notificações, `Package.appxmanifest`. Só compila no Windows |
| `Farol.Tests` | `net8.0-windows10.0.17763.0` | xUnit sobre Contrato e Sidecar. Teste que depende de WinRT em tempo de execução usa `[WindowsFact]`, que pula fora do Windows |

`Farol.sln` tem os quatro projetos. `Farol.Portable.slnf` é um filtro com
Contrato, Sidecar e Tests, que compilam em qualquer sistema.

## Compilar e testar no Windows

Requer o SDK do .NET 8 (ou mais novo) e as cargas de trabalho do Windows App SDK. A solução é
escrita em C# 12 (`LangVersion` fixada no `Directory.Build.props`), então o SDK do .NET 8 basta.

```powershell
.\scripts\build.ps1            # compila a solução inteira (Debug; -Configuration Release)
.\scripts\test.ps1             # roda os testes
.\scripts\lint.ps1             # confere a formatação (-Fix para aplicar)
```

Para abrir a janela, rode o `Farol.App` pelo Visual Studio (perfil empacotado),
que implanta o pacote MSIX de desenvolvimento.

## O subconjunto portátil no macOS e no Linux

Contrato, Sidecar e Tests compilam fora do Windows (`EnableWindowsTargeting`).
Os testes marcados com `[WindowsFact]` aparecem como pulados.

```sh
export DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1
# Só se não houver runtime do .NET 8 instalado: deixa o testhost rodar no runtime maior.
export DOTNET_ROLL_FORWARD=Major
dotnet build shell/win/Farol.Portable.slnf
dotnet test shell/win/Farol.Portable.slnf
dotnet format shell/win/Farol.Portable.slnf --verify-no-changes
```

Com PowerShell instalado, `scripts/build.ps1 -Portable`, `scripts/test.ps1 -Portable` e
`scripts/lint.ps1 -Portable` fazem o mesmo.

## O contrato com o motor (resumo)

O detalhe mora no índice; aqui só o que a casca precisa lembrar.

- **Variáveis de ambiente** que a casca passa ao motor: `FAROL_SHELL=win` e
  `FAROL_SHELL_VERSION` (a versão semântica da casca, ex. `3.0.0`, que o motor
  confere contra o `engines.farolShell` do `package.json`). `FAROL_HOME` é opcional.
- **Descoberta**: depois de abrir o socket, o motor grava `~/.farol/state/casca.json`
  com `porta`, `pid`, `versao`, `codigoPareamento` (uso único), `iniciadoEm` e
  `proximaVersao`. A casca pareia por `POST /api/auth/pair` e guarda o token só no
  PasswordVault.
- **Chamadas HTTP** levam sempre `Host: 127.0.0.1:<porta>` e `x-farol: 1`; as
  autenticadas, `Authorization: Bearer <token>`. A casca nunca escreve no GitHub: o
  único POST fora da autenticação é `/api/check`.
- **Eventos SSE** que a casca lê: `aviso-nativo`, `casca` e `casca-saida`. Ela não
  lê `state` nem `state-patch`.
- **Códigos de saída** do motor: `0` é fim; `75` é saída de propósito (update ou
  reinício), e a casca religa na hora; qualquer outro é falha, com recuo de 1 s, 2 s,
  4 s até o teto de 30 s, parando depois de 5 falhas seguidas.

## Update do pacote

O App Installer baixa e aplica o MSIX sozinho; a casca não baixa nada. O único
papel dela é escolher a hora de reiniciar: de hora em hora o `UpdateWatcher`
(`Farol.App`) pergunta ao App Installer se há versão nova
(`Package.CheckUpdateAvailabilityAsync`) e, quando há, pede o reinício ao
`UpdateGate` (`Farol.Contrato`, puro e testado). O gate só libera com o motor
livre (`Busy` falso no último evento `casca`, que chega pela composição):
pedido com o motor ocupado espera o primeiro retrato livre, e o reinício sai uma
vez só. Antes de `AppInstance.Restart` o motor é encerrado pelo caminho ordenado;
se o sistema recusar o reinício, o motor volta e a próxima checagem tenta de
novo. Esse é o update do pacote da casca; o do motor (`casca-saida` e código 75)
segue o contrato acima.

## Medição de memória

O método, o comando e a tabela estão em [`docs/medicao.md`](docs/medicao.md).
A medição ainda não foi feita: a tabela espera uma máquina Windows.
