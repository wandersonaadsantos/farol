# Farol para macOS (casca nativa)

Casca nativa do Farol em Swift 6 (AppKit) para macOS 14 ou mais novo, arm64 e x64. Ela sobe o
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
scripts/build.sh      # gera o Farol.xcodeproj com o xcodegen e compila o app em Debug, sem assinatura
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

## Limites conhecidos

- **Sair com o motor travado**: o Sair espera o motor parar por até 8 s e então deixa o app sair
  assim mesmo. Nesse caso o motor segue rodando até perceber o fim da entrada padrão (o pipe que a
  casca segura fecha quando o app sai); essa detecção é trabalho do lado do motor e ainda não
  existe, então hoje ele fica de pé até ser parado à mão (a próxima abertura do app o encontra
  vivo e abre como visor).
