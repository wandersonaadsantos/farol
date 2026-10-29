# Farol para macOS (casca nativa)

Casca nativa do Farol em Swift (SwiftUI e AppKit) para macOS 14 ou mais novo, arm64 e x64. Ela sobe o
motor em Node (`server.js`) como sidecar e é só cliente dele: nunca escreve no GitHub e nunca decide.

O desenho mora em
[`docs/superpowers/specs/2026-10-27-farol-nativo-swiftui-winui-design.md`](../../docs/superpowers/specs/2026-10-27-farol-nativo-swiftui-winui-design.md),
e o índice dos planos (com as interfaces entre eles) em
[`docs/superpowers/plans/2026-10-28-farol-nativo-indice.md`](../../docs/superpowers/plans/2026-10-28-farol-nativo-indice.md).
O plano desta casca é
[`docs/superpowers/plans/2026-10-28-farol-nativo-2-casca-mac.md`](../../docs/superpowers/plans/2026-10-28-farol-nativo-2-casca-mac.md).

## Estrutura

| caminho | papel |
|---|---|
| `project.yml` | definição do projeto para o XcodeGen (o `Farol.xcodeproj` é gerado e não é versionado) |
| `Farol/` | o alvo do app: ponto de entrada, `Info.plist` e entitlements |
| `Packages/FarolKit/` | pacote Swift local com os módulos `FarolContrato` (puro), `FarolSidecar` e `FarolApp` |
| `scripts/` | `build.sh`, `test.sh` e `lint.sh` |

## Pré-requisitos

Xcode 16 ou mais novo (Swift 6), `xcodegen` e `swift-format`:

```sh
brew install xcodegen swift-format
```

## Compilar

```sh
xcodegen generate     # gera o Farol.xcodeproj a partir do project.yml
scripts/build.sh      # regenera o projeto e compila o app em Debug, sem assinatura
```

O app compilado fica em `DerivedData/Build/Products/Debug/Farol.app`.

## Testar

```sh
scripts/test.sh
```

Roda `swift test` no pacote `FarolKit` (Swift Testing) e depois compila o app.

## Formatação

```sh
scripts/lint.sh
```

Roda `swift-format lint --strict` com a configuração de `.swift-format`. Os três scripts funcionam a
partir de qualquer pasta.
