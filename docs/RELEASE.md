# Release e versionamento do Farol

Extraído do `CLAUDE.md` na Fase 1.5 da reorganização. O `CLAUDE.md` da raiz é o sumário, e os
invariantes continuam lá.

<!-- indice:inicio (gerado; test/guias-navegaveis.test.js reprova se divergir das seções) -->

## Índice

- [Versionamento (regras firmes; houve erro demais aqui)](#versionamento-regras-firmes-houve-erro-demais-aqui)
- [Release (checklist obrigatório)](#release-checklist-obrigatório)
- [Governança do repositório público (17/08/2026)](#governança-do-repositório-público-17082026)
- [Reabertura silenciosa pós-update (v2.51.0)](#reabertura-silenciosa-pós-update-v2510)

<!-- indice:fim -->

## Versionamento (regras firmes; houve erro demais aqui)

Pedido explícito do Wanderson (10/08/2026) depois de erros REAIS acumulados:
fonte bumpado sem publicar (v2.28.0 no `package.json` com v2.26.1 instalada, e o
usuário achando que rodava o novo); spec citando uma versão e a release saindo
com outra (a releitura do Consumo foi escrita como "sai como v2.38.0" e
publicada como v2.39.0); e duas sessões paralelas escolhendo o MESMO número, com
a segunda sobrescrevendo a release da primeira em silêncio (o episódio da
v2.31.0/export do pure.js). Estas regras existem pra nenhum desses se repetir:

1. **A referência de sequência é UMA só: a última release PUBLICADA no GitHub.**
   ```
   gh release view --repo wandersonaadsantos/farol --json tagName --jq .tagName
   ```
   Nunca o `package.json` (pode estar bumpado sem publicar), nunca o
   `CHANGELOG.md`, nunca a versão escrita numa spec (spec registra INTENÇÃO; o
   número real se decide na hora de publicar, contra o publicado).
2. **Tabela de decisão do bump** (sobre a última publicada), na doutrina que o
   Wanderson já cobrou em episódios reais, não na do semver de livro:
   | mudança | bump |
   |---|---|
   | correção, refino ou CONSERTO de comportamento que já era esperado, mesmo com UI nova envolvida; refinar/completar uma feature recém-lançada (mesma leva de trabalho); filtro/separação que faltava desde o início | **patch** |
   | CAPACIDADE nova de verdade e independente (algo que o app não fazia em nenhuma forma) | **minor** |
   | quebra de compatibilidade de `config.json`/`state/` que exija migração manual | **major** (raro; o auto-update torna isso quase teórico) |
   Episódios que calibram a régua: "kudos respeita a conta" foi cobrado como
   PATCH (conserto do que devia funcionar desde o início, não feature); o
   redesenho da tela de Consumo logo após o lançamento dela foi cobrado como
   PATCH (2.24.0 foi deletada e republicada como 2.23.1: "não foi feature, era
   fix de uma feature"); e a v2.40.0 (10/08) foi errada NESTA direção de novo,
   era conserto da releitura recém-lançada do Consumo e devia ter sido v2.39.1.
   No sentido oposto: nível do modelo visível + fila transparente era capacidade
   nova e saiu como patch por engano (devia 1.7.0). **Misturou fix e feature na
   mesma leva: separar em duas releases (patch pro fix, minor pra feature); se
   não der, classificar pelo NÚCLEO da entrega, e o núcleo quase sempre é o
   conserto.** Na dúvida entre patch e minor, é patch: superestimar mente sobre
   o que é novo, e é o erro mais frequente do histórico.
3. **Uma release por entrega.** Versões intermediárias não publicadas não
   existem pro mundo: consolidar numa seção só de CHANGELOG e uma entrada só de
   RELEASE_NOTES, com o número final.
4. **O número só é seu DEPOIS de publicado.** Sessões paralelas colidem: conferir
   a última publicada imediatamente antes do bump E de novo colado no publish
   (mesmo comando). Se o número foi tomado no meio do caminho, renumerar TUDO
   (package.json + CHANGELOG + RELEASE_NOTES + spec) e publicar com o número
   novo; jamais sobrescrever a release do outro.
5. **NUNCA usar o bypass de admin na `main`** (decisão do Wanderson, 29/08/2026).
   O ruleset "main protegida" exige pull request e o check `ci`; o Repository
   admin tem `bypass_mode: always` e, até essa data, **todo** push direto na
   `main` passou por cima da própria regra (o git responde `Bypassed rule
   violations for refs/heads/main`). Isso acabou.
   O custo é baixo porque o ruleset pede **zero aprovações**
   (`required_approving_review_count: 0`): o fluxo é `branch → PR → CI verde →
   merge`, e você mesmo fecha o PR, sem depender de ninguém. De quebra, a matriz
   Linux/Windows/macOS passa a rodar ANTES da `main`, que era a metade que o gate
   local não cobre. A trava é mecânica, não moral: o `tools/hooks/pre-push`
   recusa qualquer push cujo ref remoto seja `refs/heads/main`. Emergência real
   usa `--no-verify` e fica registrada.
6. **Travas automáticas (não confiar em disciplina):**
   - `test/release-consistency.test.js` (roda no `npm test`): package.json,
     `## vX.Y.Z` do CHANGELOG e `RELEASE_NOTES[0]` do ui/telas/novidades.js têm que
     concordar, RELEASE_NOTES estritamente decrescente, CHANGELOG sem seção
     acima da versão atual. Bump incompleto = suíte vermelha.
   - `tools/publish-release.ps1`: recusa publicar versão MENOR ou IGUAL à última
     publicada e recusa sobrescrever release existente. Republicar a mesma
     versão de propósito (consertar nota/anexo) exige `FAROL_REPUBLISH=1`.

## Release (checklist obrigatório)

Toda release segue estes passos na ordem. Não pule nenhum.

### 1. Preparar a versão

- [ ] Ler a **última release publicada** (`gh release view --repo wandersonaadsantos/farol --json tagName --jq .tagName`) e decidir o bump pela tabela da seção "Versionamento" acima.
- [ ] Bump de `version` no `package.json`.
- [ ] Atualizar `CHANGELOG.md`: criar seção `## vX.Y.Z` com novidades e correções. Se houver versões intermediárias não publicadas, consolidar tudo numa seção só.
- [ ] Atualizar `RELEASE_NOTES` no `ui/telas/novidades.js` (saiu do `ui/app.js` na v2.59.5, quando cada aba virou módulo): adicionar entrada `['X.Y.Z', ['item 1', 'item 2']]` no topo do array. Se consolidou versões, uma entrada só. Verificar que a versão anterior publicada também tem entrada (corrigir se faltar).
- [ ] Os três acima andam JUNTOS: `test/release-consistency.test.js` falha se qualquer um ficar pra trás.

### 2. Gate de qualidade

```
npm run check && npm test
```

Verde nos dois é pré-requisito. Não publique com teste vermelho.

**Gate de pré-push (29/08/2026).** `npm run hooks:install` aponta o
`core.hooksPath` pra `tools/hooks/`, e o `pre-push` roda `check` + `lint` +
`test` antes de qualquer push. Existe porque o CI roda DEPOIS do push e a `main`
aceita push direto (o admin tem bypass do ruleset), então havia uma janela entre
"empurrei" e "descobri que quebrou". `core.hooksPath` é config LOCAL do clone:
cada clone instala uma vez. Escape hatch é o `--no-verify` do próprio git.

**O hook NÃO substitui o CI, e confundir os dois é o erro a evitar.** Parte da
suíte pula fora do POSIX, e isso depende do SISTEMA, não do shell: no Windows,
Git Bash não recupera nenhum desses casos. O que pula aqui e só fecha no CI:

| pula no Windows | por quê |
|---|---|
| 4 testes do `install.sh` | é o instalador do macOS: mexe em `Electron.app/Contents/Info.plist` e cria `~/Applications/Farol.app` |
| `spawn headless posix` | branch `/bin/sh -lc` + `detached`; `IS_WIN` é const de nível de módulo |
| `killTree posix` | semântica de grupo de processo POSIX |
| credencial não legível por outros | `chmod` não existe em NTFS |

Não existe "CI local completo" pra este repo: container cobriria Linux e nunca
macOS. **Quando a mudança tocar esses caminhos, o jeito de ver a matriz ANTES da
`main` é subir num branch e disparar o workflow nele** (o `ci.yml` tem
`workflow_dispatch`, então aceita ref arbitrário):

```
git push origin HEAD:refs/heads/prova
gh workflow run CI --repo wandersonaadsantos/farol --ref prova
gh run watch --repo wandersonaadsantos/farol
```

Verde nos três, então fast-forward na `main`. Para mudança que não toca
instalador nem spawn, o gate local já responde.

### 3. Commit e PR (não empurre na `main`)

- [ ] Commit com mensagem descritiva (ex.: `chore: release v2.27.0`).
- [ ] **Branch + PR + CI verde + merge.** Desde 29/08/2026 o push direto na
      `main` está proibido (regra 5 de "Versionamento") e o `pre-push` recusa.
      O bump de versão entra pela mesma porta que qualquer mudança:
      ```
      git switch -c release/vX.Y.Z && git push origin release/vX.Y.Z
      gh pr create --fill
      gh pr merge --merge --delete-branch      # depois do CI verde
      git switch main && git pull --ff-only
      ```
      Só então siga pro passo 4: o `publish-release.ps1` publica a partir da
      `main` já mergeada.
- [ ] Sobre o **push do branch**: desde 17/08/2026 o `origin` aponta pro alias SSH da conta pessoal (`git@github-pessoal:wandersonaadsantos/farol.git`, definido no `~/.ssh/config`), então ele não depende da conta ativa do `gh` e o 403 crônico descrito abaixo não acontece nesse passo. O que DEPENDE da conta ativa é o `gh pr create`/`gh pr merge` e a **release** (passo 4), que usam a API. **O bypass de admin na `main` existe no ruleset e não se usa** (regra 5 de "Versionamento"): ele é o motivo de este passo ter deixado de ser um push direto.
- [ ] **Conta do gh**: o repo é `wandersonaadsantos/farol`, então o push e a release têm que sair pela conta DONA do repo, não pela conta de trabalho (que costuma ser a ativa e devolve 403). Confira com `gh auth status` e, se precisar, `gh auth switch --user wandersonaadsantos`. **Confira de novo IMEDIATAMENTE antes de rodar o `publish-release.ps1`, num comando só com ele:** a conta ativa do `gh` mora no keyring e já foi observada revertendo entre um comando e o outro na mesma sessão. Em 01/08/2026 isso derrubou a publicação da v2.29.0 no meio: o push passou, os dois artefatos foram construídos, e só o `gh release create` falhou (o erro que aparece é um `gh auth refresh ... -s workflow`, que engana, porque o problema é a conta e não o escopo). Rodar de novo com a conta certa resolve, e o script é idempotente. **Não escreva o login da conta de trabalho neste arquivo**: o `CLAUDE.md` vai dentro do zip de distribuição e a auditoria do `make-package.ps1` reprova o pacote se achar (invariante 7).

### 4. Publicar a release

```
powershell -ExecutionPolicy Bypass -File tools\publish-release.ps1
```

O script faz tudo: builda o pacote leve (`dist/farol-vX.Y.Z.zip`, auditado) + instalador Windows (`dist/Farol-Setup-vX.Y.Z.exe`, NSIS), extrai notas do `CHANGELOG.md`, anexa rodapé de `tools/release-footer.md` e cria a release `vX.Y.Z` no GitHub. Se a release já existe, atualiza notas e sobrescreve os artefatos.

### 5. Pós-publicação

- [ ] Verificar a release no GitHub (notas, artefatos).
- [ ] **Restaurar a conta ativa do gh pra de trabalho** (`gh auth switch`), pra não deixar a máquina apontada pra conta pessoal no dia a dia.
- [ ] macOS (quando aplicável): `bash tools/make-offline-mac.sh` e anexar com `gh release upload vX.Y.Z dist/Farol-Instalar-mac.command --repo wandersonaadsantos/farol`.

### Referência rápida

| Artefato | Comando | Destino |
|---|---|---|
| Pacote leve (update) | `tools\make-package.ps1` | `dist/farol-vX.Y.Z.zip` |
| Instalador Windows | `tools\make-installer.ps1` | `dist/Farol-Setup-vX.Y.Z.exe` |
| Release GitHub | `tools\publish-release.ps1` | ambos acima + release |
| Instalador macOS | `tools/make-offline-mac.sh` | `dist/Farol-Instalar-mac.command` |

**Auto-update**: cópias instaladas (>= 1.15.0) leem a última release via `gh` a cada ciclo de polling (detecção). Desde a v2.46.0, a APLICAÇÃO também é automática: `maybeAutoUpdate` (`lib/engine/update.js`) roda logo depois do `checkUpdate` no `check()` e aplica sozinha quando há update no canal `remote` e o app está ocioso (gate `sessionsBusy`, o mesmo do botão manual). Opt-out em Sistema > Automação (config `autoUpdate: false`) volta ao clique manual. Canal `local` (fluxo de dev do mantenedor) nunca auto-aplica, só pelo botão. Bootstrap: cópias antigas precisam instalar 1.15.0 uma vez (offline).

**Fonte de verdade**: a release do GitHub. O app instalado atualiza só a partir das releases, nunca de código local não mergeado (a menos que `config.updateSource` aponte um caminho explícito).

**Distribuição offline**: o instalador Windows (`.exe`, NSIS) e o macOS (`.command`, autoextraível) não precisam de Node/npm/terminal. Nenhum dos dois é assinado/notarizado (SmartScreen/Gatekeeper avisam uma vez).

## Governança do repositório público (17/08/2026)

O repo é público desde sempre, mas até 17/08/2026 estava sem CI, sem proteção de branch e
com a aba de segurança inteiramente desligada. O que existe agora:

**CI (`.github/workflows/ci.yml`).** `npm run check`, `npm run lint` e `npm test` em todo
push na `main` e em todo PR, numa matriz Linux + Windows + macOS sem dependências
instaladas. Uma segunda matriz, `electron`, instala a versão mínima declarada no
manifesto e abre o aplicativo real com perfil temporário. O monitor externo fica
desligado nesse smoke: não consulta contas nem inicia revisões. Artefatos registram
runtime, janela, bandeja, notificação e autostart aplicável. O job agregador **`ci`**
exige sucesso das DUAS matrizes, inclusive o smoke dos três sistemas; uma matriz
cancelada ou pulada reprova. Veja `docs/ELECTRON-SMOKE.md` para os limites da prova.

**Todo job tem teto de tempo** (`timeout-minutes`, travado em `test/ci-teto-de-tempo.test.js`):
sem ele o default do GitHub é de SEIS HORAS, e em 30/08/2026 o job de macOS ficou preso no
passo de testes duas vezes no mesmo dia (a suíte roda em segundos), segurando PR em `BLOCKED`
e queimando runner até alguém cancelar na mão. Job eterno é pior que job vermelho: não informa
nada e ainda segura a fila. É a mesma doutrina que a suíte já aplicava por dentro, levada pro
workflow. **A trava do macOS em si não foi diagnosticada**, e a evidência aponta flake de
runner e não regressão: o mesmo commit passou em 40 segundos ao ser relançado, e a suíte
inteira roda no POSIX (WSL) sem travar. Se voltar, o teto dá o registro em 15 minutos em vez
de seis horas.

**Proteção da `main`** (ruleset `main protegida`, não branch protection clássica): PR
obrigatório com resolução de conversa, `ci` verde e branch atualizada, force push e
deleção bloqueados. **O ruleset ainda tem bypass pra Repository admin, e ele não se usa**
desde 29/08/2026 (regra 5 de "Versionamento" acima): o checklist de release entra por PR
(passo 3 de "Release") e o `tools/hooks/pre-push` recusa push direto na `main`. Pra fechar
de vez, é remover `bypass_actors` do ruleset.

**Tags `v*`** (ruleset `tags de release`): deleção e reescrita bloqueadas, **sem bypass**.
A cadeia de auto-update lê release do GitHub, então tag publicada é imutável. Republicar
com `FAROL_REPUBLISH=1` continua funcionando (atualiza notas e anexos, não mexe na tag).
Se algum dia precisar mesmo apagar uma tag, desative o ruleset, apague, reative.

**Segurança**: secret scanning com push protection (bloqueia commit que carregue token,
que é a mesma preocupação da auditoria do `make-package.ps1`, só que uma camada antes),
Dependabot com alertas e correções automáticas, CodeQL pelo setup padrão, e relato privado
de vulnerabilidade ligado. A política e o modelo de ameaça estão em `.github/SECURITY.md`,
inclusive o que é **fora de escopo** (a credencial na sessão do Claude, os binários sem
assinatura, a automação opt-in). Reportar coisa fora de escopo não vira correção.

**Perfil da comunidade**: `.github/CONTRIBUTING.md`, `.github/CODE_OF_CONDUCT.md`,
`.github/SECURITY.md`, `.github/PULL_REQUEST_TEMPLATE.md` e dois templates de issue
(`bug.yml`, `melhoria.yml`). O CONTRIBUTING repete os 7 invariantes do
[`CLAUDE.md`](../CLAUDE.md#invariantes-do-projeto-não-negociar) de
propósito: quem chega de fora não lê o `CLAUDE.md` primeiro.

## Reabertura silenciosa pós-update (v2.51.0)

O auto-update é ligado por padrão desde a v2.46.0, então o ciclo "fecha e reabre"
acontecia sozinho no meio do dia e a janela nova roubava o foco. Agora o app
reabre **escondido, direto na bandeja**, e quem avisa é uma notificação.

O sinal é um ARQUIVO (`state/reabrir-silencioso.json`), não um argumento de linha
de comando, porque no Windows quem reabre é `explorer.exe <atalho>` e os
argumentos vêm do `.lnk`. Ele é gravado antes de disparar o installer e consumido
(e apagado) pelo `main.js` no boot, uma vez só. **Tem prazo de 10 minutos de
propósito**: update que falha no meio deixaria o marcador no disco e a próxima
abertura MANUAL sairia sem janela, o que pareceria app quebrado.
