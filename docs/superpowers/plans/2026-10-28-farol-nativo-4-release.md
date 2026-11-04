# Empacotamento, assinatura, update e release: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** transformar as duas cascas e o motor em instaladores assinados que se atualizam sozinhos (`.dmg` notarizado com Sparkle; `.msix` com App Installer), publicados numa release única do GitHub junto do pacote leve do motor; mais a release de ponte da linha 2.x e a retirada do Electron.

**Architecture:** o pacote leve do motor (já existe, `tools/make-package.ps1`) vira a semente dentro dos dois bundles; um script por SO monta o bundle, embute o Node oficial com hash conferido, assina e gera o instalador; a pipeline do GitHub roda os dois em runners próprios e publica tudo na mesma release; `tools/publish-release.ps1` passa a ser a porta única. A release de ponte é a última 2.x e só avisa e aponta para o instalador nativo.

**Tech Stack:** GitHub Actions (`macos-14`, `windows-latest`), `xcodebuild`, `codesign`, `notarytool`, `hdiutil`, Sparkle (`generate_appcast`), `dotnet publish`, `MakeAppx`, `signtool`, App Installer (`.appinstaller`), Node 24 LTS oficial (`nodejs.org/dist`, `SHASUMS256.txt`).

**Spec:** desenho seções 4.4, 4.5, 4.7, 6 e índice (layout do bundle).

## Global Constraints

- Nenhum segredo em arquivo versionado: identidades e chaves vêm de secrets do repositório (`APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_PASSWORD`, `MAC_SIGNING_CERT_P12` + senha, `SPARKLE_PRIVATE_KEY`, `WIN_SIGNING_CERT_PFX` + senha).
- Node embutido: SEMPRE a versão fixada em `.nvmrc`, baixada do `nodejs.org/dist/v<versão>/` e conferida contra `SHASUMS256.txt` antes de entrar no bundle. Download que não confere aborta o build.
- O pacote leve do motor continua sendo gerado pela auditoria de `tools/make-package.ps1` (invariante 7); nada passa por fora dela.
- As quatro listas de distribuição (`test/distribuicao-listas.test.js`) continuam travadas e descrevem o pacote leve; a casca é empacotada por scripts próprios que só CONSOMEM o pacote leve.
- Sem trailer de coautoria nos commits; sem rodapé de ferramenta nas releases.
- Branch `feat/release-nativo` a partir de `main` com os planos 1, 2 e 3 mergeados.

## Review Focus

1. **`SHASUMS256.txt` indisponível ou Node com hash diferente**: o build para com erro dizendo a versão e o hash esperado; teste na Task 1.
2. **`notarytool` rejeita** (entitlement errada, binário sem assinatura dentro do bundle, o `node` sem `allow-jit`): o script imprime o log do `notarytool log` e falha; teste manual na Task 3 com um bundle de propósito sem o `node` assinado.
3. **Appcast com versão menor que a instalada**: Sparkle ignora; o script de release recusa gerar appcast cuja versão não é maior que a última publicada; teste na Task 3.
4. **Instalação por cima de um Electron antigo com LaunchAgent**: o `.dmg` novo não roda script, então a limpeza é no primeiro boot do app (casca Mac, Task 8 do plano 2); este plano só confere, no smoke da Task 7, que o LaunchAgent `ROTULO` de `lib/autostart-mac.js` sumiu depois da primeira abertura.
5. **Cota do GitHub Actions**: minuto de macOS conta 10x; a pipeline de release roda só em tag e o `workflow_dispatch` gera artefato sem publicar; teste de leitura na Task 6.

---

### Task 1: semente do motor e download verificado do Node

**Files:**
- Create: `tools/release/baixar-node.sh` (POSIX) e `tools/release/baixar-node.ps1` (Windows): `--versao`, `--plataforma darwin-arm64|darwin-x64|win-x64`, `--destino`; baixa `node-v<v>-<plat>.tar.gz|.zip` e `SHASUMS256.txt`, confere, extrai só `bin/node` (ou `node.exe`) para `<destino>`
- Create: `tools/release/semente-do-motor.sh` / `.ps1`: gera o pacote leve por `tools/make-package.ps1` (porta POSIX: `tools/make-package.sh`, mesma lista e mesma auditoria) e o extrai em `<destino>/engine/app/`
- Test: `test/release-baixar-node.test.js` (o script com um servidor HTTP falso: hash certo passa, hash errado falha com a mensagem; `--plataforma` inválida falha), `test/release-make-package-sh.test.js` (o `.sh` produz a MESMA lista de arquivos que o `.ps1`, lida de `test/distribuicao-listas.test.js`)

- [ ] **Step 1:** testes falham. **Step 2:** implementar. **Step 3:** passam; `npm run check && npm run lint && npm test` verdes.
- [ ] **Step 4: Commit** `feat(release): semente do motor e Node oficial com hash conferido`

---

### Task 2: montagem do bundle Mac

**Files:**
- Create: `tools/release/montar-mac.sh`: `xcodebuild archive` em `shell/mac` (universal arm64+x64), copia `engine/app` e `engine/node/bin/node` (arm64 e x64 em `lipo`) para `Contents/Resources/engine/`, grava `Contents/Resources/engine/VERSAO` com a versão do motor
- Test: `test/release-montar-mac.test.js` (só a parte determinística: dado um `.app` falso e uma semente falsa, o script produz o layout do índice; roda só com `IS_MAC`)

- [ ] **Step 1:** teste falha. **Step 2:** implementar. **Step 3:** passa; `open` do bundle montado sobe o motor e a `ui/`.
- [ ] **Step 4: Commit** `feat(release): montagem do Farol.app com motor e Node embutidos`

---

### Task 3: assinatura, notarização, `.dmg` e appcast do Sparkle

**Files:**
- Create: `tools/release/assinar-mac.sh`: `codesign --deep --options runtime --entitlements shell/mac/Farol/Farol.entitlements --sign "Developer ID Application: <TEAM>"` em `node` PRIMEIRO (com `allow-jit`) e depois no bundle; `notarytool submit --wait` com as credenciais dos secrets; `stapler staple`
- Create: `tools/release/dmg-mac.sh` (`hdiutil` com o `.app` e o atalho para `/Applications`), `tools/release/appcast-mac.sh` (`generate_appcast` do Sparkle com a chave EdDSA do secret; recusa versão não maior que a última do `appcast.xml` publicado)
- Test: `test/release-appcast.test.js` (a regra de "versão maior" em função pura `tools/release/versao-maior.js`, reusando `cmpVersion` de `lib/engine/update.js`)

- [ ] **Step 1:** teste falha. **Step 2:** implementar. **Step 3:** passa; smoke manual: `spctl --assess --type execute` aceita o `.app` do `.dmg` numa máquina sem o certificado; `notarytool` com um bundle sem o `node` assinado falha e o log aparece (Review Focus 2).
- [ ] **Step 4: Commit** `feat(release): assinatura Developer ID, notarização, dmg e appcast`

---

### Task 4: montagem, assinatura e App Installer do Windows

**Files:**
- Create: `tools/release/montar-win.ps1`: `dotnet publish shell/win/Farol.App -r win-x64 -p:Platform=x64 -p:GenerateAppxPackageOnBuild=true`, copia `engine\app` e `engine\node\node.exe` para dentro do layout do pacote antes do `MakeAppx pack`
- Create: `tools/release/assinar-win.ps1` (`signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /f <pfx>`), `tools/release/appinstaller-win.ps1` (gera `Farol.appinstaller` com `Uri` da release, `HoursBetweenUpdateChecks="0"`, `ShowPrompt="false"`, `UpdateBlocksActivation="false"`)
- Test: `test/release-appinstaller.test.js` (o XML gerado por função pura `tools/release/appinstaller.js` tem versão de 4 partes, `Uri` e `MainPackage` corretos)

- [ ] **Step 1:** teste falha. **Step 2:** implementar. **Step 3:** passa; smoke manual: instalar o `.msix` numa VM limpa (Windows 10 1809 e 11), o SmartScreen aceita com o certificado, o `StartupTask` aparece em Configurações > Aplicativos > Inicialização.
- [ ] **Step 4: Commit** `feat(release): MSIX assinado e App Installer do Windows`

---

### Task 5: release unificada

**Files:**
- Modify: `tools/publish-release.ps1` (sobe na MESMA release: pacote leve `farol-<v>.zip` (update do Termux e servidores), `Farol-<v>.dmg`, `appcast.xml`, `Farol-<v>.msix`, `Farol.appinstaller`; nota da release a partir do `CHANGELOG.md`, sem rodapé de ferramenta)
- Modify: `lib/engine/update.js:28-43` (`resolveUpdateSource`: o pacote leve continua sendo o alvo do update do motor em todos os modos; nada muda para Termux e servidor)
- Modify: `docs/RELEASE.md` (checklist nova: versão em três `package.json`/`project.yml`/`appxmanifest` iguais, `engines.farolShell`, tag, artefatos esperados)
- Test: `test/release-versoes-iguais.test.js` (motor `package.json`, `shell/mac/project.yml` `MARKETING_VERSION`, `shell/win/Farol.App/Package.appxmanifest` `Version` e `engines.farolShell` coerentes)

- [ ] **Step 1:** teste falha. **Step 2:** implementar. **Step 3:** passa.
- [ ] **Step 4: Commit** `feat(release): release única com motor, dmg, msix e manifestos de update`

---

### Task 6: pipeline do GitHub Actions

**Files:**
- Create: `.github/workflows/release-nativo.yml`: gatilho `push: tags: ['v*']` e `workflow_dispatch` (sem publicar); jobs `motor` (ubuntu: gate `npm run check && npm run lint && npm test`, semente), `mac` (`macos-14`: Tasks 2 e 3), `win` (`windows-latest`: Task 4), `publicar` (precisa dos três; só em tag)
- Test: `test/release-workflow.test.js` (o YAML lido como texto: os quatro jobs existem, `publicar` depende dos três, `workflow_dispatch` não chama `publish-release`; Review Focus 5)

- [ ] **Step 1:** teste falha. **Step 2:** escrever o workflow. **Step 3:** passa; rodar por `workflow_dispatch` e conferir os artefatos.
- [ ] **Step 4: Commit** `ci(release): pipeline com motor, mac, win e publicação por tag`

---

### Task 7: release de ponte 2.x

**Files:**
- Modify: `lib/engine/update.js` (`checkUpdateRemote`: release cuja tag é `>= 3.0.0` e esta instalação roda com Electron → não baixa; marca `engine.update.ponte = { versao, dmg, msix }`), `ui/pure/sistema.js` e `ui/telas/sistema.js` (banner "Esta é a última versão nesta casca. Baixe o Farol nativo" com o link do instalador do SO), `main.js` (notificação única com o mesmo texto)
- Test: `test/update-ponte.test.js` (com Electron e release 3.x: não baixa, `ponte` preenchido; em modo servidor: baixa o pacote leve 3.x normalmente)

- [ ] **Step 1:** teste falha. **Step 2:** implementar. **Step 3:** passa; publicar como `v2.<última>.x`.
- [ ] **Step 4: Commit** `feat(update): release de ponte avisa e aponta para o instalador nativo`

---

### Task 8: retirada do Electron

**Files:**
- Delete: `main.js`, `lib/electron-runtime.js`, `lib/update-installer.js`, `lib/autostart-mac.js`, `lib/desktop-identity.js`, `installer/electron-runtime.*`, `installer/native-bundle-mac.sh`, `installer/farol.nsi`, `tools/make-installer.ps1`, `tools/make-offline-mac.sh`, `tools/electron-smoke-*`, `tools/benchmark-ui-native.js`, os testes que importam `electron` (`test/desktop-identity.test.js`, `test/native-bundle-mac.test.js`, `test/electron-smoke-*.test.js`, `test/installer-update-mac.test.js`)
- Modify: `package.json` (sem `electron`, sem script `start` do Electron; `start` vira `node server.js`), `lib/engine/update.js` (ramos Mac/Linux/Windows do instalador completo saem; ficam `aplicarNoServidor` e `aplicarNaCasca`), `lib/paths.js` (`modoServidor` passa a ser "sem casca e sem Electron", documentado), `installer/install.sh`, `install.ps1`, `install-linux.sh` (instalam o pacote leve para o modo servidor, sem Electron), `test/distribuicao-listas.test.js`, `tools/quality/baseline.json` (`npm run lint:update`, só pode descer), `CLAUDE.md` (invariante 1 com a redação da seção 3 do desenho, mapa sem os arquivos retirados), `README.md`

- [ ] **Step 1:** `npm run check && npm run lint && npm test` verdes depois da retirada; `npm run eng` verde.
- [ ] **Step 2:** smoke: `FAROL_HOME=/tmp/x node server.js` sobe; `FAROL_SHELL=mac` sobe; os dois instaladores de servidor instalam o pacote leve.
- [ ] **Step 3: Commit** `refactor: retira o Electron; a casca nativa e o modo servidor são os dois jeitos de rodar`
- [ ] **Step 4:** tag `v3.0.0` pela pipeline da Task 6; piloto com o time.
