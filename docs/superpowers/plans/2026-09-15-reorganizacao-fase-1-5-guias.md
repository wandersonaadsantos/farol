# Reorganização estrutural, Fase 1.5: o `CLAUDE.md` vira sumário e quatro guias operacionais

> **Para quem executa:** use `superpowers:subagent-driven-development` (recomendado) ou
> `superpowers:executing-plans`, tarefa a tarefa. Os passos usam caixa (`- [ ]`).
>
> **Autorização:** as mensagens do dono de 15/09/2026 autorizam **elaborar e revisar** este
> plano. Executar, commitar, dar push, fazer merge e publicar release dependem de autorização
> posterior, separada para o pré-requisito (PR do Setup.exe) e para a fase.

**Goal:** mover o conteúdo operacional do `CLAUDE.md` da raiz (199.161 bytes em `c34b7c9`) para
`docs/CONFIGURATION.md`, `docs/REVIEW-GATES.md`, `docs/MACOS.md` e `docs/RELEASE.md`, deixando
o `CLAUDE.md` como sumário, e fazer as **seis** rotas de distribuição levarem exatamente esses
quatro guias, por allowlist explícita e testada, sem aumentar materialmente o pacote.

**Architecture:** conteúdo **movido, nunca duplicado**, provado por uma verificação de
conservação linha a linha contra o `CLAUDE.md` do SHA fixo `c34b7c9`. Cada rota de distribuição
ganha uma lista de guias com variável própria (`$doc`/`doc`), e a pasta `docs/` do destino é
recriada a cada instalação. Os testes de guia derivam a lista de guias da allowlist do pacote.

**Tech Stack:** Markdown, PowerShell, Bash, `node --test`, zero dependências novas.

**Spec:** [`docs/superpowers/specs/2026-09-14-reorganizacao-estrutural-design.md`](../specs/2026-09-14-reorganizacao-estrutural-design.md), seção "Fase 1.5".

## As decisões do dono

**Primeira decisão (15/09/2026, tarde):** o pacote continua levando o `CLAUDE.md` como
sumário e leva somente quatro documentos operacionais extraídos; `docs/superpowers/`,
`docs/evidencias/`, planos, specs e documentos internos não viajam; o `README.md` aponta para
`docs/MACOS.md` no diagnóstico do macOS; as rotas usam allowlist explícita e testada, com
contraprova; a extração não aumenta materialmente o pacote; o `workspace-template/CLAUDE.md`
continua distribuído e fora da mudança.

**Revisão da decisão (15/09/2026, noite), depois da medição:** "não devemos forçar quatro nomes
definidos antes de conhecer a distribuição real do conteúdo".

| # | decisão |
|---|---|
| **D1** | A allowlist e os testes cobrem as **seis** rotas. O Setup.exe e o instalador offline do macOS são distribuição real e não podem ficar fora da garantia |
| **D2** | O `firebase/README.md` **permanece onde está**. Ele referencia `firebase/database.rules.json`, `firebase/firebase.json` e comandos rodados de dentro de `firebase/`, que não viaja: movê-lo criaria um guia instalado aparentemente útil, porém incompleto e não executável. A distribuição da documentação e dos artefatos de sincronização é tratada numa fase própria |
| **D3** | `docs/SYNC.md` é substituído por **`docs/CONFIGURATION.md`**. Assinatura do Claude, modelo e esforço e Jira são configuração operacional, nem sumário nem gate de postagem. O trecho de 308 bytes sobre sincronização **permanece no contexto atual** até existir a fase própria |
| **D4** | A falta de `tools/` no Setup.exe é corrigida num **PR independente e anterior** a esta fase: é defeito funcional preexistente, não reorganização documental. Depois da integração, a Fase 1.5 parte da **nova `main`**, sem excluir o Setup.exe do teste e **sem rebase** |
| **Base** | A verificação de conservação usa o **SHA fixo `c34b7c9`**, não `origin/main`, que é referência móvel |

Os quatro guias distribuídos são, portanto:

- `docs/CONFIGURATION.md`
- `docs/REVIEW-GATES.md`
- `docs/MACOS.md`
- `docs/RELEASE.md`

## Global Constraints

- **Zero dependências além do Electron.**
- **Texto em português, sem travessão.** Vírgula, parênteses ou dois pontos.
- **Mover, não duplicar.** Todo texto que sai do `CLAUDE.md` aparece em exatamente um destino.
  O único texto novo permitido é: o invariante 4 em forma curta, o bloco de ponteiros do
  sumário, os cabeçalhos dos quatro guias, os índices gerados e as referências cruzadas
  reescritas para apontar para o arquivo novo.
- **Nenhum comportamento do app muda** nesta fase. `lib/`, `ui/`, `server.js` e `main.js` só
  são tocados em linha de comentário que cita seção movida.
- **`workspace-template/CLAUDE.md` não é tocado.** **`firebase/README.md` não é tocado.**
- **Código com barra invertida se escreve com a ferramenta de escrita de arquivo, nunca por
  heredoc de shell.** Na elaboração deste plano, a camada de shell colapsou `\\` em `\` sem
  erro, e o regex resultante não casava nada.
- **Contraprova se desfaz restaurando de cópia**, nunca com `git checkout` sobre arquivo que
  tem trabalho não commitado (lição da Fase 1a).
- **Sem atribuição de IA** em commit ou PR.
- **Gate por tarefa:** `npm run check && npm run lint && npm test`. Antes do push, `npm run eng`.
- **Instalação real a partir do zip é obrigatória** nesta fase (spec, seção 7, item 3): ela
  cria pasta nova no destino da instalação.

## Linha de base medida (15/09/2026, `c34b7c9`, Windows)

| medida | valor |
|---|---|
| `CLAUDE.md` da raiz | 199.161 bytes, 1923 linhas, 21 seções `##` (20 fora do índice) |
| zip de update (`make-package.ps1`) | **995.938 bytes**; o `CLAUDE.md` comprime para 80.734 |
| `workspace-template/CLAUDE.md` | 20.457 bytes, distribuído dentro de `workspace-template/` |
| testes que leem o conteúdo do `CLAUDE.md` | 1 arquivo (`test/guias-navegaveis.test.js`), com o piso `>= 15` seções |
| citações do `CLAUDE.md` da raiz no código | 28 (as que mudam de destino estão listadas abaixo; 3 já estão mortas) |
| instruções ao usuário final | `README.md:43`, `installer/install.sh:7`, `tools/make-offline-mac.sh:16-17` |

## O que a medição achou

1. **São seis rotas de distribuição.** Além de `install.ps1`, `install.sh`, `install-linux.sh` e
   `make-package.ps1`, o **Setup.exe** (`tools/make-installer.ps1:44-47`, embutido por
   `installer/farol.nsi:41`) e o **instalador offline do macOS** (`tools/make-offline-mac.sh:51-58`)
   montam o app com listas próprias, e nenhum teste as confere.
2. **O Setup.exe sai sem `tools/` hoje** (`make-installer.ps1:47` não copia a pasta, e o
   `install.ps1:71` pula pasta ausente em silêncio). Quem instala por ele fica sem
   `tools/jira-mcp.js` até o primeiro auto-update. Tratado no pré-requisito (D4).
3. **Não existe seção de sincronização no `CLAUDE.md`.** O único trecho é o parágrafo do teto de
   rodadas compartilhado entre aparelhos, dentro de "### Autonomia completa do round" (D3: fica
   ali e viaja com a subseção).
4. **Nenhum instalador apaga arquivo que saiu da lista.** Um guia tirado da allowlist ficaria
   para sempre em `~/.farol/app/docs/`. A pasta de destino precisa ser recriada.
5. **A auditoria do pacote varre todo `.md`** (`make-package.ps1:105-107`) e reprova `ghp_`,
   `github_pat_`, `gho_`, `ATATT` e `Bearer ` (com espaço). O `CONFIGURATION.md` descreve chaves
   de API e tokens e é o candidato mais provável a esbarrar nisso; o texto já passa hoje dentro
   do `CLAUDE.md`, então uma reprovação significa que algo novo entrou.
6. **O `CLAUDE.md` tem um link relativo para arquivo que não viaja:** `docs/QUALITY.md`, na seção
   "Como rodar e testar sem estragar nada" (linha 432 em `c34b7c9`).

## Mapa do conteúdo e tamanhos

Medido por título em `c34b7c9`. **Quem executa se orienta pelos títulos**, não pelos números de
linha, e confere tudo com a verificação de conservação.

| trecho do `CLAUDE.md` | destino | bytes |
|---|---|---|
| Título, "O que é", "Mapa de arquivos" | sumário | ~16.100 |
| Invariantes 1 a 3 e 5 a 7 | sumário, sem mudança | ~1.500 |
| Invariante 4: a regra-mãe em forma curta (texto novo) | sumário | ~1.200 |
| "Como rodar e testar sem estragar nada" | sumário | 5.082 |
| "Menções navegáveis" (só o corpo) | sumário | 4.493 |
| "Diagnóstico: ambiente x operação x runtime" | sumário | 3.731 |
| "Modelo e esforço das sessões autônomas" | `CONFIGURATION.md` | 3.909 |
| "Assinatura do Claude", **sem** a subseção de falhas de autenticação | `CONFIGURATION.md` | 13.594 |
| "Jira multi-tenant" | `CONFIGURATION.md` | 6.807 |
| Invariante 4: todos os parágrafos longos (políticas por conta, check vermelho, postagem que tenta de novo, motivo tem eixo, fronteira do review humano, ressalva, cobertura, fan-out e fachadas) | `REVIEW-GATES.md` | ~22.700 |
| "### Falhas de autenticação e conclusão da revisão", **1º parágrafo** (credencial expirada, renovação do login, isolamento de `CLAUDE_CODE_OAUTH_TOKEN`) | `CONFIGURATION.md`, sob `### Falhas de autenticação` (ver nota 1) | 393 |
| a mesma subseção, **2º parágrafo** (parser, resultado estruturado, `analysisStatus: "incomplete"`, proibição de postar revisão inconclusiva) | `REVIEW-GATES.md`, sob `## Conclusão da revisão` (ver nota 1) | 531 |
| Subseções penduradas em "Menções navegáveis": "Motivo é OBJETO", "A garantia mora no estrangulamento", "Justiça de fila", "Aprovação não é fungível" | `REVIEW-GATES.md` | ~10.900 |
| "Um Farol por PR", "Dedup é por ROUND", "Re-revisão automática" com todas as subseções (inclusive "Autonomia completa do round", com o trecho de sincronização dentro) | `REVIEW-GATES.md` | ~50.000 |
| "Autoanálise", "Checkpoint de verificação", "Retomada após falha transitória" | `REVIEW-GATES.md` | ~13.400 |
| "Pontos com branch de plataforma", "macOS: estado real" com as subseções, "Linux (experimental)" | `MACOS.md` | 30.792 |
| "### Reabertura silenciosa pós-update" (pendurada em "Menções navegáveis") | `RELEASE.md` | 755 |
| "Governança do repositório público", "Versionamento", "Release" | `RELEASE.md` | 15.419 |

**Tamanhos esperados:** sumário cerca de 32 KB, `REVIEW-GATES.md` cerca de 97 KB,
`MACOS.md` cerca de 31 KB, `CONFIGURATION.md` cerca de 25 KB, `RELEASE.md` cerca de 16 KB. Texto
novo total: cerca de 3 KB.

**Nota 1 (decisão do dono, 15/09/2026):** a subseção "### Falhas de autenticação e conclusão da
revisão" é **dividida pelo conteúdo**. A posição original juntava configuração de credenciais e
gate de postagem, e preservar esse agrupamento repetiria o problema estrutural que a fase
corrige. O **1º parágrafo** (393 bytes) vai para o `CONFIGURATION.md`, sob
`### Falhas de autenticação`, no fim da seção Assinatura, onde a subseção estava. O **2º
parágrafo** (531 bytes) vai para o `REVIEW-GATES.md`, sob `## Conclusão da revisão`.
Os dois parágrafos ficam **íntegros e sem duplicação**; mudam só o título (o antigo deixa de
existir, e os dois novos são texto novo) e as referências. A verificação de conservação confere
isso linha a linha com `--separacao`.

**Nota 2:** o `REVIEW-GATES.md` continua sendo o maior guia. Separar mais ali é decisão futura do
dono e fica fora desta fase.

## Referências que precisam mudar (inventário medido)

**Para o usuário final** (obrigatórias):
- `README.md:43` "a seção macOS do `CLAUDE.md`" passa a `docs/MACOS.md`.
- `README.md:64-66` "Ele é grande de propósito" deixa de ser verdade.
- `installer/install.sh:7` e `tools/make-offline-mac.sh:16-17` passam a `docs/MACOS.md`.
- `.github/CONTRIBUTING.md:86` ("Versionamento" e "Release") passa a `docs/RELEASE.md`.
- `.github/SECURITY.md:56` ("Fronteira do review humano") passa a `docs/REVIEW-GATES.md`.
- `.github/ISSUE_TEMPLATE/config.yml:10`: a descrição do link vira "sumário, invariantes e mapa
  de arquivos, com ponteiros para os guias".

**Código** (só comentários):
- `REVIEW-GATES.md`: `server.js:1430`; `lib/engine/decision.js:4` e `:443`;
  `lib/engine/public-review.js:125`; `lib/engine/pushback.js:81`; `lib/engine/session.js:707`;
  `lib/engine/review.js:5`, `:377` e `:1313`; `lib/engine/verification-checkpoint.js:8`.
- `RELEASE.md`: `lib/engine/update.js:4`; `tools/publish-release.ps1:24`; `tools/hooks/pre-push:44`.
- `MACOS.md`: `tools/make-offline-mac.sh:17`; `installer/install.sh:7`.
- `CONFIGURATION.md`: `test/pure.test.js:343` (precedência de `ANTHROPIC_AUTH_TOKEN`, seção
  Assinatura).
- **Mortas hoje:** `lib/io.js:140` ("regra 8 da receita ESM"), `lib/engine/pushback.js:5`
  ("Memória de pushback" não é seção) e `ui/app.js:4057` (`.section-head`). Corrigir para o
  destino real ou tirar a citação. O `ui/app.js` é tocado só nessa linha de comentário.

**Dentro do próprio `CLAUDE.md`** (as referências cruzadas):
- mapa de arquivos, linhas 56, 57, 62, 63 e 64, passam a `docs/REVIEW-GATES.md#...`;
- mapa de arquivos, linha 78 ("ver a seção do Jira"), passa a `docs/CONFIGURATION.md#...`;
- as citações de "invariante 4" nos trechos movidos passam a
  `../CLAUDE.md#invariantes-do-projeto-não-negociar`;
- a linha 114 (invariante 5) aponta para "Linux (experimental)", que vai para `docs/MACOS.md`;
- no `MACOS.md`, a frase "o CLAUDE.md proíbe o Claude Code logar em nome do usuário" (linha 249)
  passa a apontar para a regra em `CONFIGURATION.md` (seção Assinatura);
- no `CONFIGURATION.md`, "Ver `tools/jira-mcp.js` no mapa de arquivos" (linhas 469-470) passa a
  `../CLAUDE.md#mapa-de-arquivos`;
- em "Diagnóstico" (no sumário), "a correção do mesmo dia" (linha 1690, o `ghEnv` da Assinatura)
  passa a ponteiro explícito para `docs/CONFIGURATION.md`.

**Texto já errado hoje, corrigido na mudança** (conserto de referência, não reescrita):
- linha 756: "ver 'As duas decisões de 28/08' **acima**", mas a seção está abaixo;
- linhas 1738-1743: a Governança diz que o checklist de release faz push direto na `main`, o
  que contradiz a regra 5 de "Versionamento" desde 29/08/2026;
- linhas 1759-1760: "os 7 invariantes desta seção acima", mas a Governança não é a seção de
  invariantes;
- `test/ui-widgets.test.js:320`: a mensagem de assert cita o `CLAUDE.md` sobre um assunto que não
  está nele.

**Não mudam:** `docs/superpowers/**` (registro histórico, fora da distribuição e do teste de
links), `workspace-template/**` (sem citação ao `CLAUDE.md` da raiz), `firebase/README.md` (D2).

## A verificação de conservação (roda em toda tarefa de movimentação)

Prova que o texto foi **movido e não reescrito nem duplicado**, contra o **SHA fixo `c34b7c9`**.
Toda linha não vazia do `CLAUDE.md` daquele commit precisa aparecer em **exatamente um** dos
arquivos de destino, com as exceções declaradas (linhas do índice gerado e as referências
cruzadas reescritas).

**Escreva este script com a ferramenta de escrita de arquivo** num diretório temporário fora do
repositório (por exemplo `conservacao-guias.mjs`) e rode com `node conservacao-guias.mjs`, a
partir da raiz da worktree:

```js
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const BASE = 'c34b7c9';
const antes = execSync(`git show ${BASE}:CLAUDE.md`, { encoding: 'utf8' }).split(/\r?\n/);
const destinos = ['CLAUDE.md', 'docs/CONFIGURATION.md', 'docs/REVIEW-GATES.md', 'docs/MACOS.md', 'docs/RELEASE.md']
  .filter((f) => fs.existsSync(f));
const onde = new Map();
for (const f of destinos) {
  for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    if (!l.trim()) continue;
    const lista = onde.get(l) || [];
    lista.push(f);
    onde.set(l, lista);
  }
}
const ehIndice = (l) => /^- \[.*\]\(#/.test(l) || /indice:(inicio|fim)/.test(l) || l === '## Índice';
// Títulos que deixam de existir por decisão do dono, e só eles: o conteúdo embaixo continua íntegro.
const TITULOS_SEPARADOS = new Set(['### Falhas de autenticação e conclusão da revisão']);
let sumiu = 0;
let duplicou = 0;
for (const l of antes) {
  if (!l.trim() || ehIndice(l)) continue;
  const arquivos = onde.get(l) || [];
  if (arquivos.length === 0 && TITULOS_SEPARADOS.has(l)) { console.log(`TITULO SEPARADO (esperado): ${l}`); continue; }
  if (arquivos.length === 0) { sumiu++; console.log(`SUMIU:     ${l.slice(0, 110)}`); }
  if (arquivos.length > 1 && l.trim().length > 40) {
    duplicou++;
    console.log(`DUPLICOU:  ${l.slice(0, 90)}  em ${arquivos.join(', ')}`);
  }
}

// Separação da subseção de falhas de autenticação (decisão de 15/09/2026). Com --separacao, cada
// parágrafo precisa estar INTEIRO (a linha completa) e em exatamente um arquivo, o guia certo.
// Roda a partir da Task 7, quando os dois já saíram do CLAUDE.md.
const DESTINO_ESPERADO = [
  ['`OAuth access token has expired` é credencial expirada', 'docs/CONFIGURATION.md'],
  ['O parser de revisão aceita JSON bruto', 'docs/REVIEW-GATES.md'],
];
let foraDoLugar = 0;
if (process.argv.includes('--separacao')) {
  for (const [inicio, esperado] of DESTINO_ESPERADO) {
    const original = antes.filter((l) => l.startsWith(inicio));
    if (original.length !== 1) {
      foraDoLugar++;
      console.log(`BASE INESPERADA: ${original.length} linhas comecam com "${inicio}"`);
      continue;
    }
    const arquivos = onde.get(original[0]) || [];
    if (arquivos.length !== 1 || arquivos[0] !== esperado) {
      foraDoLugar++;
      console.log(`FORA DO LUGAR: "${inicio}" esta em [${arquivos.join(', ')}], esperado ${esperado}`);
    }
  }
}
console.log(`base ${BASE} | sumiram: ${sumiu} | duplicadas: ${duplicou} | fora do lugar: ${foraDoLugar}`);
```

`SUMIU` é aceitável **só** para linha que continha referência cruzada reescrita, e cada uma
tem de estar na lista de referências acima. O título antigo da subseção separada aparece como
`TITULO SEPARADO (esperado)` e não conta. `FORA DO LUGAR` nunca é aceitável. `DUPLICOU` nunca é aceitável (linhas curtas, como
`|---|---|` de tabela, ficam de fora pelo corte de 40 caracteres).

---

## Pré-requisito: PR independente do Setup.exe (D4)

Este PR é **anterior e separado** da Fase 1.5. Ele não toca documentação e corrige um defeito
funcional: o Setup.exe instala o app sem `tools/jira-mcp.js`.

**Arquivos:**
- Modificar: `tools/make-installer.ps1` (depois do laço de pastas da linha 47)
- Modificar: `test/pacote-runtime-tools.test.js` (teste novo, no molde do teste do offline em
  `:121-128`)

- [ ] **Passo 1: branch a partir da `main`**

```bash
git fetch origin
git worktree add -b fix/setup-exe-tools ../farol-setup-tools origin/main
```

- [ ] **Passo 2: teste vermelho**

Em `test/pacote-runtime-tools.test.js`, depois do teste
`offline macOS copia a mesma whitelist de tools do pacote leve`, acrescente (o arquivo já tem
`empacotador` e `referenciados` definidos no topo):

```js
const setupExe = fs.readFileSync(path.join(raiz, 'tools/make-installer.ps1'), 'utf8').replace(/\r\n/g, '\n');
test('Setup.exe copia a mesma whitelist de tools do pacote leve', () => {
  const doPacote = empacotador.match(/foreach \(\$t in @\(([^)]*)\)\) \{\s*Copy-Item[^\n]*\$Src 'tools'/);
  assert.ok(doPacote, 'whitelist real de copia do pacote leve precisa ser encontrada');
  const permitidos = [...doPacote[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
  const doSetup = setupExe.match(/foreach \(\$t in @\(([^)]*)\)\) \{\s*Copy-Item[^\n]*\$Src 'tools'[^\n]*\$payload/);
  assert.ok(doSetup, 'o Setup.exe nao copia tools para o payload: quem instala por ele fica sem o jira-mcp.js');
  const copiados = [...doSetup[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(copiados, permitidos, 'o Setup.exe deve levar os mesmos arquivos de tools que o pacote leve');
  for (const ref of referenciados) assert.ok(copiados.includes(ref), `o Setup.exe omite tools/${ref} usado em runtime`);
});
```

```bash
node --test --test-force-exit test/pacote-runtime-tools.test.js
```

Esperado: FALHA com `o Setup.exe nao copia tools para o payload`.

- [ ] **Passo 3: a correção**

**Não** acrescente `tools` à lista de pastas do `make-installer.ps1`: isso levaria a pasta
inteira, com as ferramentas de build, enquanto o zip e o offline levam só os cinco arquivos de
runtime. Acrescente, logo depois do laço de pastas, o laço que o `make-package.ps1:46-49` já usa,
com o destino `$payload` deste script:

```powershell
New-Item -ItemType Directory -Force -Path (Join-Path $payload 'tools') | Out-Null
foreach ($t in @('jira-mcp.js', 'make-icons.ps1', 'pack-ico.js', 'make-package.ps1', 'make-icns.sh')) {
  Copy-Item (Join-Path (Join-Path $Src 'tools') $t) (Join-Path (Join-Path $payload 'tools') $t)
}
```

O `install.ps1` que roda de dentro do Setup.exe já espelha a pasta `tools` do payload
(`install.ps1:69-72`), então o instalador não muda. Rode o teste: esperado PASSA.

- [ ] **Passo 4: contraprovas**

1. Tire `'jira-mcp.js'` do laço novo. Esperado: FALHA `o Setup.exe omite tools/jira-mcp.js`.
2. Troque `$payload` por `$Src` no destino do `Copy-Item`. Esperado: FALHA `nao copia tools para
   o payload`.

Restaure **de cópia** e confira com `cmp`.

- [ ] **Passo 5: prova no artefato**

Rode `tools/make-installer.ps1` (exige `makensis`; ver "Referência rápida" em `docs/RELEASE.md`
depois da fase, hoje na seção Release do `CLAUDE.md`). Antes de o NSIS empacotar, confira na pasta
de payload que o script monta que `tools/` contém exatamente os cinco arquivos. **Não rode o
Setup.exe gerado nesta máquina**: ele instala em `~/.farol` de verdade.

- [ ] **Passo 6: gate, commit, PR** (cada um com autorização do dono)

```bash
npm run check && npm run lint && npm test
git add tools/make-installer.ps1 test/pacote-runtime-tools.test.js
git commit -m "fix(dist): o Setup.exe volta a levar os arquivos de runtime de tools"
```

PR com CI verde nos três sistemas, merge, e só então a Fase 1.5 começa.

---

## Início da Fase 1.5

- [ ] **A fase parte da nova `main`, sem rebase.** Depois do merge do pré-requisito:

```bash
git fetch origin
git worktree add -b docs/reorganizacao-fase-1-5 ../farol-fase-1-5-exec origin/main
```

- [ ] **A base da conservação continua válida.** O `CLAUDE.md` não pode ter mudado desde
`c34b7c9`:

```bash
git diff --stat c34b7c9 HEAD -- CLAUDE.md
```

Esperado: saída vazia. **Se não for vazia, pare**: a verificação de conservação contra
`c34b7c9` deixou de medir o que diz, e a base precisa ser remedida e o dono avisado.

- [ ] **Linha de base da máquina:** `npm test` (contagem de testes) e o tamanho do zip, para
comparar no fim.

---

### Task 1: as seis rotas no teste de listas

Com o pré-requisito integrado, o Setup.exe já leva `tools/`. Este teste nasce **verde** e quem o
valida são as contraprovas.

**Arquivos:**
- Modificar: `test/distribuicao-listas.test.js`
- Modificar: `tools/make-offline-mac.sh:51-52` (só a forma dos laços, ver passo 2)

**Interfaces:**
- Produz: `ROTAS_COMPLETAS` e a chave `t` em `RE_SH`. A Task 2 generaliza a leitura para as seis
  rotas em `LEITOR_DA_ROTA`.

- [ ] **Passo 1: o teste**

Em `test/distribuicao-listas.test.js`, acrescente `t: /^for t in (.+); do$/gm` ao `RE_SH`, as
duas rotas novas ao conjunto lido, e um teste que as compara com o instalador e com o pacote.
Duas regras de comparação, as duas medidas:

- as rotas de instalador completo carregam `node_modules` a mais (é o que as torna offline), e
  só esse item sai da comparação de pastas;
- `tools/` viaja por **arquivos nomeados** em toda rota que monta pacote (o resto da pasta é
  ferramenta de build). A pasta `tools` sai da comparação de pastas, e no lugar dela a lista
  `$t`/`t` de cada rota tem de ser igual à do pacote.

```js
const EMBUTEM_RUNTIME = new Set(['node_modules']);
const PASTA_POR_ARQUIVOS = 'tools';

const ROTAS_COMPLETAS = {
  'tools/make-installer.ps1': (t, a) => ({
    arquivos: listaPowershell(t, 'f', a), pastas: listaPowershell(t, 'd', a), tools: listaPowershell(t, 't', a),
  }),
  'tools/make-offline-mac.sh': (t, a) => ({
    arquivos: listaBash(t, 'f', a), pastas: listaBash(t, 'd', a), tools: listaBash(t, 't', a),
  }),
};
const completas = Object.fromEntries(Object.entries(ROTAS_COMPLETAS).map(([arq, fn]) => [arq, fn(ler(arq), arq)]));

test('os instaladores completos (Setup.exe e offline do mac) levam o mesmo que o instalador', () => {
  const pastasDoInstalador = instalado.pastas.filter((d) => d !== PASTA_POR_ARQUIVOS);
  for (const [arq, l] of Object.entries(completas)) {
    assert.deepEqual(l.arquivos, instalado.arquivos, `${arq} diverge nos arquivos de raiz`);
    const pastas = l.pastas.filter((d) => !EMBUTEM_RUNTIME.has(d));
    assert.deepEqual(pastas, pastasDoInstalador, `${arq} diverge nas pastas (fora node_modules e tools)`);
    assert.deepEqual(l.tools, pacoteTools, `${arq} nao leva os mesmos arquivos de tools que o pacote`);
  }
});
```

- [ ] **Passo 2: fazer o offline do mac legível pelo teste**

`tools/make-offline-mac.sh:51-52` escreve os laços `f` e `d` numa linha só
(`...; do cp ...; done`), que o regex `^for f in (.+); do$` não casa. Quebre cada um em três
linhas, sem mudar o corpo:

```bash
for f in main.js server.js package.json README.md CLAUDE.md; do
  cp "$SRC/$f" "$STAGING/$f"
done
```

Faça o mesmo no laço `d`. O laço `t` (linhas 55-58) já está em várias linhas.

- [ ] **Passo 3: ver passar**

```bash
node --test --test-force-exit test/distribuicao-listas.test.js
```

Esperado: PASSA.

- [ ] **Passo 4: contraprovas**

1. Tire `'workspace-template'` da lista de pastas do `make-installer.ps1`. Esperado: FALHA
   `tools/make-installer.ps1 diverge nas pastas`.
2. Tire `jira-mcp.js` do laço `t` do `make-offline-mac.sh`. Esperado: FALHA `nao leva os mesmos
   arquivos de tools que o pacote`.
3. Acrescente `docs` à lista de pastas do `make-offline-mac.sh`. Esperado: FALHA.

Restaure **de cópia** depois de cada uma e confira com `cmp`.

- [ ] **Passo 5: gate e commit**

```bash
npm run check && npm run lint && npm test
git add test/distribuicao-listas.test.js tools/make-offline-mac.sh
git commit -m "test(dist): as seis rotas de distribuicao passam a ser conferidas"
```

---

### Task 2: a allowlist dos quatro guias nas seis rotas, com esqueletos

**Arquivos:**
- Criar: `docs/CONFIGURATION.md`, `docs/REVIEW-GATES.md`, `docs/MACOS.md`, `docs/RELEASE.md`
  (esqueleto)
- Modificar: as seis rotas e `test/distribuicao-listas.test.js`
- Modificar: `tools/make-package.ps1:24` (guarda de árvore suja)

**Interfaces:**
- Consome: `ROTAS_COMPLETAS` e `RE_SH` da Task 1.
- Produz: a lista `$doc`/`doc` em cada rota, lida pelo helper da Task 3.

- [ ] **Passo 1: os quatro esqueletos**

Cada um com título, uma frase dizendo que o conteúdo veio do `CLAUDE.md`, e o bloco de índice
vazio no mesmo formato do `CLAUDE.md`. Exemplo do `docs/CONFIGURATION.md`:

```markdown
# Configuração operacional do Farol

Extraído do `CLAUDE.md` na Fase 1.5 da reorganização. O `CLAUDE.md` da raiz é o sumário, e os
invariantes continuam lá.

<!-- indice:inicio (gerado; test/guias-navegaveis.test.js reprova se divergir das seções) -->

## Índice

<!-- indice:fim -->
```

Títulos dos outros três: `# Gates de revisão e postagem do Farol` (`REVIEW-GATES.md`),
`# macOS, Linux e os pontos com branch de plataforma` (`MACOS.md`) e
`# Release e versionamento do Farol` (`RELEASE.md`).

- [ ] **Passo 2: teste vermelho da allowlist**

Em `test/distribuicao-listas.test.js`, acrescente a variável nova aos regexes
(`doc: /foreach \(\$doc in @\(([\s\S]*?)\)\)/g` em `RE_PS` e `doc: /^for doc in (.+); do$/gm`
em `RE_SH`) e monte as duas tabelas que os testes consomem:

```js
const LEITOR_DA_ROTA = {
  'installer/install.ps1': listaPowershell,
  'installer/install.sh': listaBash,
  'installer/install-linux.sh': listaBash,
  'tools/make-package.ps1': listaPowershell,
  'tools/make-installer.ps1': listaPowershell,
  'tools/make-offline-mac.sh': listaBash,
};
const textoDaRota = Object.fromEntries(Object.keys(LEITOR_DA_ROTA).map((arq) => [arq, ler(arq)]));
const docsPorRota = Object.fromEntries(Object.entries(LEITOR_DA_ROTA)
  .map(([arq, leitor]) => [arq, leitor(textoDaRota[arq], 'doc', arq)]));
const pastasPorRota = Object.fromEntries(Object.entries(LEITOR_DA_ROTA)
  .map(([arq, leitor]) => [arq, leitor(textoDaRota[arq], 'd', arq)]));

/* A allowlist dos guias distribuídos é CONGELADA de propósito e é a única lista curada deste
   arquivo: a decisão do dono (15/09/2026, revista no mesmo dia) nomeou exatamente estes quatro,
   e o que não pode acontecer é um quinto entrar por descuido. Mudar esta lista é decisão, não
   ajuste. */
const GUIAS_APROVADOS = ['CONFIGURATION.md', 'REVIEW-GATES.md', 'MACOS.md', 'RELEASE.md'];

test('as seis rotas levam exatamente os quatro guias aprovados', () => {
  for (const [arq, docs] of Object.entries(docsPorRota)) {
    assert.deepEqual([...docs].sort(), [...GUIAS_APROVADOS].sort(), `${arq} diverge da allowlist de guias`);
  }
});

test('docs/ nunca viaja como pasta inteira', () => {
  for (const [arq, pastas] of Object.entries(pastasPorRota)) {
    assert.ok(!pastas.includes('docs'), `${arq} copia a pasta docs inteira, e docs/superpowers iria junto`);
  }
});

test('cada guia aprovado existe e o protocolo do workspace continua distribuido', () => {
  for (const d of GUIAS_APROVADOS) assert.ok(fs.existsSync(path.join(RAIZ, 'docs', d)), `docs/${d} nao existe`);
  assert.ok(fs.existsSync(path.join(RAIZ, 'workspace-template', 'CLAUDE.md')), 'o protocolo das sessoes sumiu');
  for (const [arq, pastas] of Object.entries(pastasPorRota)) {
    assert.ok(pastas.includes('workspace-template'), `${arq} deixou de levar workspace-template (e o CLAUDE.md das sessoes)`);
  }
});
```

Rode e veja falhar: nenhuma rota tem a lista ainda.

- [ ] **Passo 3: a lista em cada rota**

Variável `$doc`/`doc` (nunca `$f`/`f`, que faria o teste achar duas listas de arquivos no mesmo
script).

**Instaladores: a pasta de destino é apagada e recriada** a cada instalação, porque nenhum deles
remove arquivo que saiu da lista, e `docs/` não guarda estado do usuário (o estado mora em
`~/.farol/workspace`). `Die` existe em `install.ps1:22` e `die` em `install.sh:18` e
`install-linux.sh:17`, medidos em `c34b7c9`.

`installer/install.ps1`, depois da cópia de `Desinstalar.cmd`:

```powershell
# Guias distribuídos: allowlist explícita (decisão de 15/09/2026). A pasta é recriada para
# um guia que saia da lista não ficar para sempre na cópia instalada.
$docsDst = Join-Path $App 'docs'
if (Test-Path -LiteralPath $docsDst) { Remove-Item -LiteralPath $docsDst -Recurse -Force }
New-Item -ItemType Directory -Force -Path $docsDst | Out-Null
foreach ($doc in @('CONFIGURATION.md', 'REVIEW-GATES.md', 'MACOS.md', 'RELEASE.md')) {
  $origem = Join-Path (Join-Path $Src 'docs') $doc
  if (-not (Test-Path -LiteralPath $origem)) { Die "Guia ausente na origem: docs/$doc" }
  Copy-Item -LiteralPath $origem -Destination (Join-Path $docsDst $doc) -Force
}
```

`installer/install.sh` e `installer/install-linux.sh`, depois do laço de pastas:

```bash
# Guias distribuídos: allowlist explícita (decisão de 15/09/2026). A pasta é recriada para
# um guia que saia da lista não ficar para sempre na cópia instalada.
rm -rf "${APP:?}/docs"
mkdir -p "$APP/docs"
for doc in CONFIGURATION.md REVIEW-GATES.md MACOS.md RELEASE.md; do
  [ -f "$SRC/docs/$doc" ] || die "Guia ausente na origem: docs/$doc"
  cp "$SRC/docs/$doc" "$APP/docs/$doc"
done
```

**Ferramentas de build:** o staging é novo a cada execução, então não há o que apagar, e as três
já abortam no primeiro erro (`$ErrorActionPreference = 'Stop'` em `make-package.ps1:4` e
`make-installer.ps1:5`; `set -euo pipefail` em `make-offline-mac.sh:19`).

`tools/make-package.ps1`, logo depois da cópia de `tools`:

```powershell
New-Item -ItemType Directory -Force -Path (Join-Path $staging 'docs') | Out-Null
foreach ($doc in @('CONFIGURATION.md', 'REVIEW-GATES.md', 'MACOS.md', 'RELEASE.md')) {
  Copy-Item (Join-Path (Join-Path $Src 'docs') $doc) (Join-Path (Join-Path $staging 'docs') $doc)
}
```

`tools/make-installer.ps1`, depois do laço de `tools` que o pré-requisito criou:

```powershell
New-Item -ItemType Directory -Force -Path (Join-Path $payload 'docs') | Out-Null
foreach ($doc in @('CONFIGURATION.md', 'REVIEW-GATES.md', 'MACOS.md', 'RELEASE.md')) {
  Copy-Item (Join-Path (Join-Path $Src 'docs') $doc) (Join-Path (Join-Path $payload 'docs') $doc)
}
```

`tools/make-offline-mac.sh`, depois da cópia de `tools`:

```bash
mkdir -p "$STAGING/docs"
for doc in CONFIGURATION.md REVIEW-GATES.md MACOS.md RELEASE.md; do
  cp "$SRC/docs/$doc" "$STAGING/docs/$doc"
done
```

`tools/make-package.ps1:24`: acrescente os quatro guias e o `CLAUDE.md` à guarda de árvore suja,
senão um guia não commitado viaja sem aviso.

- [ ] **Passo 4: contraprovas**

1. Acrescente `'EXTRA.md'` à lista do `install.sh`. Esperado: FALHA `diverge da allowlist de guias`.
2. Tire `'RELEASE.md'` só do `make-offline-mac.sh`. Esperado: FALHA nomeando o arquivo.
3. Acrescente `docs` à lista de pastas do `install-linux.sh`. Esperado: FALHA `copia a pasta docs
   inteira`.
4. Renomeie `workspace-template/CLAUDE.md` temporariamente. Esperado: FALHA `o protocolo das
   sessoes sumiu`.

Restaure **de cópia** depois de cada uma e confira com `cmp`.

- [ ] **Passo 5: instalação real**

Gere o zip com `tools/make-package.ps1`, extraia numa pasta temporária e rode o `install.ps1`
dali com `FAROL_INSTALL_ROOT` apontando para outra pasta temporária (**nunca** a instalação real).
Confira que o `docs/` do destino tem exatamente os quatro guias e que o
`workspace-template/CLAUDE.md` está no destino. Ponha um arquivo qualquer em `docs/` do destino e
rode de novo: ele precisa **sumir**.

- [ ] **Passo 6: gate e commit**

```bash
npm run check && npm run lint && npm test
git add docs/CONFIGURATION.md docs/REVIEW-GATES.md docs/MACOS.md docs/RELEASE.md installer/ tools/make-package.ps1 tools/make-installer.ps1 tools/make-offline-mac.sh test/distribuicao-listas.test.js
git commit -m "feat(dist): allowlist dos quatro guias nas seis rotas, com docs recriada na instalacao"
```

---

### Task 3: as travas de guia

**Arquivos:**
- Criar: `test/helpers/guias-distribuidos.js`
- Modificar: `test/guias-navegaveis.test.js`
- Modificar: `CLAUDE.md` (o link para `docs/QUALITY.md`)

**Interfaces:**
- Consome: a lista `$doc` de `tools/make-package.ps1` (Task 2).
- Produz: `guiasDistribuidos()` e `alvosDistribuidos()`.

- [ ] **Passo 1: o helper, derivado do pacote**

Crie `test/helpers/guias-distribuidos.js` com exatamente este conteúdo. **Ele foi executado** em
15/09/2026 contra uma cópia do `tools/make-package.ps1` com uma lista `$doc` simulada (devolveu o
`CLAUDE.md` mais os guias da lista, e `tools/jira-mcp.js` entre os arquivos que viajam) e contra
a cópia sem a lista (lançou `sem a lista $doc`). **Escreva com a ferramenta de escrita de
arquivo**: por heredoc, as barras do regex somem.

```js
// Os guias que viajam com o app instalado, lidos do empacotador.
//
// POR QUE EXISTE: desde a Fase 1.5 da reorganização o CLAUDE.md da raiz é sumário e o
// conteúdo operacional mora em quatro guias de docs/, que viajam por allowlist explícita.
// Os testes de guia (índice, âncora, link só para o que viaja, nada duplicado) precisam da
// MESMA lista que o pacote usa; uma lista escrita à mão aqui envelheceria sozinha. Os testes
// de distribuição continuam lendo as seis rotas por conta própria, porque o que eles provam
// é justamente a concordância entre elas.
//
// Sem efeito colateral no import: o `node --test` executa test/**/*.js, e um arquivo que só
// exporta funções passa vazio.
import fs from 'node:fs';
import path from 'node:path';

const RAIZ = path.join(import.meta.dirname, '..', '..');

function listaDoPacote(variavel) {
  const fonte = fs.readFileSync(path.join(RAIZ, 'tools', 'make-package.ps1'), 'utf8');
  const m = fonte.match(new RegExp(`foreach \\(\\$${variavel} in @\\(([\\s\\S]*?)\\)\\)`));
  if (!m) throw new Error(`tools/make-package.ps1 sem a lista $${variavel}`);
  return (m[1].match(/'([^']+)'/g) || []).map((s) => s.slice(1, -1));
}

/** Caminhos relativos dos guias distribuídos: o CLAUDE.md e os guias da allowlist. */
function guiasDistribuidos() {
  return ['CLAUDE.md', ...listaDoPacote('doc').map((d) => `docs/${d}`)];
}

/** Tudo que viaja: arquivos (raiz, tools nomeados, guias) e pastas inteiras. */
function alvosDistribuidos() {
  return {
    arquivos: new Set([
      ...listaDoPacote('f'),
      ...listaDoPacote('t').map((t) => `tools/${t}`),
      ...guiasDistribuidos(),
    ]),
    pastas: listaDoPacote('d'),
  };
}

export { guiasDistribuidos, alvosDistribuidos };
```

- [ ] **Passo 2: os testes de guia**

Em `test/guias-navegaveis.test.js`, importe o helper e **substitua** o teste
`o indice do CLAUDE.md lista TODAS as secoes, na ordem, com ancora valida` por estes quatro. O
`slugDeTitulo`, o `ler`, o `fs`, o `path` e o `RAIZ` que o arquivo já tem continuam sendo usados.

**O README fica fora destas quatro travas, de propósito:** ele viaja, mas é a página pública do
repositório, lida no GitHub, e aponta legitimamente para `.github/` e para o que não viaja. O que
o README precisa provar (apontar para `docs/MACOS.md`) tem teste próprio na Task 5.

```js
import { guiasDistribuidos, alvosDistribuidos } from './helpers/guias-distribuidos.js';

const LINK_RELATIVO = /\[[^\]]*\]\(([^)\s]+)\)/g;
const EXTERNO = /^(https?:|mailto:)/;

// Piso de seções por guia: existe para o teste não passar vazio, não para travar tamanho.
// A Task 8 troca cada zero pelo número MEDIDO de seções daquele guia.
const PISO_DE_SECOES = {
  'CLAUDE.md': 0,
  'docs/CONFIGURATION.md': 0,
  'docs/REVIEW-GATES.md': 0,
  'docs/MACOS.md': 0,
  'docs/RELEASE.md': 0,
};

function destinoDoLink(guia, alvo) {
  const arquivo = alvo.split('#')[0];
  if (!arquivo) return guia;
  const absoluto = path.join(path.dirname(path.join(RAIZ, guia)), arquivo);
  return path.relative(RAIZ, absoluto).split(path.sep).join('/');
}

function ancorasDe(texto) {
  return new Set(texto.split('\n')
    .filter((l) => /^#{1,6} /.test(l))
    .map((l) => slugDeTitulo(l.replace(/^#{1,6} /, '').trim())));
}

test('cada guia distribuido tem indice igual as proprias secoes', () => {
  for (const guia of guiasDistribuidos()) {
    const texto = ler(guia);
    const inicio = texto.indexOf('<!-- indice:inicio');
    const fim = texto.indexOf('<!-- indice:fim');
    assert.ok(inicio >= 0 && fim > inicio, `${guia} nao tem o bloco de indice delimitado`);
    const fora = texto.slice(0, inicio) + texto.slice(fim);
    const titulos = fora.split('\n').filter((l) => l.startsWith('## ')).map((l) => l.slice(3).trim());
    const piso = PISO_DE_SECOES[guia] ?? 1;
    assert.ok(titulos.length >= piso, `${guia}: ${titulos.length} secoes, abaixo do piso ${piso}`);
    const esperado = titulos.map((t) => `- [${t}](#${slugDeTitulo(t)})`);
    const linhas = texto.slice(inicio, fim).split('\n').filter((l) => l.startsWith('- ['));
    assert.deepEqual(linhas, esperado, `o indice de ${guia} divergiu das secoes do arquivo`);
  }
});

test('toda ancora citada num guia distribuido existe no documento de destino', () => {
  for (const guia of guiasDistribuidos()) {
    for (const m of ler(guia).matchAll(LINK_RELATIVO)) {
      const alvo = m[1];
      if (EXTERNO.test(alvo) || !alvo.includes('#')) continue;
      const destino = destinoDoLink(guia, alvo);
      if (!destino.endsWith('.md') || !fs.existsSync(path.join(RAIZ, destino))) continue;
      const ancora = alvo.split('#')[1];
      assert.ok(ancorasDe(ler(destino)).has(ancora), `${guia} cita ${alvo}, e ${destino} nao tem esse titulo`);
    }
  }
});

test('guia distribuido so aponta para o que tambem viaja com o app instalado', () => {
  const { arquivos, pastas } = alvosDistribuidos();
  for (const guia of guiasDistribuidos()) {
    for (const m of ler(guia).matchAll(LINK_RELATIVO)) {
      const alvo = m[1];
      if (EXTERNO.test(alvo) || alvo.startsWith('#')) continue;
      const destino = destinoDoLink(guia, alvo);
      const viaja = arquivos.has(destino) || pastas.some((d) => destino === d || destino.startsWith(`${d}/`));
      assert.ok(viaja, `${guia} aponta para ${destino}, que nao viaja com o app instalado (escreva o caminho entre crases, sem link)`);
    }
  }
});

test('nenhum paragrafo longo aparece em dois guias distribuidos', () => {
  const dono = new Map();
  const repetidos = [];
  for (const guia of guiasDistribuidos()) {
    const paragrafos = ler(guia).split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p.length > 120);
    for (const p of paragrafos) {
      if (dono.has(p) && dono.get(p) !== guia) repetidos.push(`${guia} repete um paragrafo de ${dono.get(p)}: ${p.slice(0, 60)}`);
      else dono.set(p, guia);
    }
  }
  assert.deepEqual(repetidos, [], 'conteudo duplicado entre guias: a extracao move, nunca copia');
});
```

- [ ] **Passo 3: o único link do sumário que não viaja**

A medição de `c34b7c9` achou **um** link relativo no `CLAUDE.md` para algo que não viaja:
`docs/QUALITY.md`, na seção "Como rodar e testar sem estragar nada". Troque o link por caminho
entre crases (`` `docs/QUALITY.md` ``), que continua dizendo onde está sem prometer um arquivo que
a cópia instalada não tem. Faça o mesmo com qualquer link do mesmo tipo que as Tasks 4 a 7
trouxerem para os guias: o teste do passo 2 aponta cada um pelo nome.

- [ ] **Passo 4: contraprovas**

1. Link `superpowers/plans/2026-09-15-handoff-reorganizacao.md` no `docs/MACOS.md`. Esperado:
   FALHA `que nao viaja com o app instalado`.
2. Link `docs/RELEASE.md#nao-existe` no `CLAUDE.md`. Esperado: FALHA de âncora.
3. Um parágrafo longo do `CLAUDE.md` colado no `docs/CONFIGURATION.md`. Esperado: FALHA de
   duplicação.
4. Seção nova no `docs/RELEASE.md` sem entrada no índice. Esperado: FALHA de índice.

Restaure **de cópia** depois de cada uma.

- [ ] **Passo 5: gate e commit**

```bash
npm run check && npm run lint && npm test
git add test/helpers/guias-distribuidos.js test/guias-navegaveis.test.js CLAUDE.md
git commit -m "test(docs): travas de indice, ancora, link distribuido e duplicacao nos guias"
```

---

### Task 4: `RELEASE.md`

**Move:** "Governança do repositório público", "Versionamento", "Release (checklist
obrigatório)" e "### Reabertura silenciosa pós-update".

- [ ] **Passo 1:** cortar os trechos do `CLAUDE.md` e colar em `docs/RELEASE.md`, na ordem:
  Versionamento, Release, Governança, Reabertura silenciosa.
- [ ] **Passo 2:** reescrever as referências cruzadas. Dentro do `RELEASE.md`, as referências
  entre Versionamento e Release continuam como estão. Corrigir as duas afirmações já erradas da
  Governança (push direto na `main`, e "os 7 invariantes desta seção acima", que passa a
  `../CLAUDE.md#invariantes-do-projeto-não-negociar`).
- [ ] **Passo 3:** atualizar `lib/engine/update.js:4`, `tools/publish-release.ps1:24`,
  `tools/hooks/pre-push:44`, `.github/CONTRIBUTING.md:86` e o comentário de
  `test/release-consistency.test.js:10`.
- [ ] **Passo 4:** rodar `tools/make-package.ps1` e conferir `pacote limpo`.
- [ ] **Passo 5:** regerar os índices, rodar a verificação de conservação (só `SUMIU` de
  referência reescrita), gate e commit.

---

### Task 5: `MACOS.md`

**Move:** "Pontos com branch de plataforma", "macOS: estado real" com as duas subseções, e
"Linux (experimental)".

- [ ] **Passo 1:** cortar e colar, nessa ordem. A frase "Este arquivo é a memória do port" passa a
  valer para o `MACOS.md` e fica como está.
- [ ] **Passo 2:** o invariante 5 do sumário ganha o ponteiro para `docs/MACOS.md`, no lugar de
  "ver a seção 'Linux (experimental)'". A frase do `MACOS.md` sobre o `CLAUDE.md` proibir logar
  em nome do usuário passa a apontar para a seção Assinatura, que a Task 6 leva para o
  `CONFIGURATION.md`. **Enquanto a Task 6 não roda**, aponte para
  `../CLAUDE.md#assinatura-do-claude-qual-contaplano-o-farol-usa-e-como-alternar`; a Task 6
  corrige para `CONFIGURATION.md`, e o teste de âncora da Task 3 garante que a troca não fique
  para trás.
- [ ] **Passo 3:** `README.md:43` passa a apontar para `docs/MACOS.md`, dizendo que o arquivo
  também existe na pasta instalada (`~/.farol/app/docs/MACOS.md`). Atualizar
  `installer/install.sh:7`, `tools/make-offline-mac.sh:16-17` e os comentários de
  `test/skip-review.test.js:16` e `test/execucao-direta.test.js:16`.
- [ ] **Passo 4:** acrescentar a `test/guias-navegaveis.test.js`:

```js
test('o README manda o usuario de macOS para o guia distribuido', () => {
  const blocoMac = README.split('### macOS')[1]?.split('\n## ')[0] || '';
  assert.ok(blocoMac.includes('docs/MACOS.md'), 'o bloco de instalacao do macOS no README nao aponta para docs/MACOS.md');
  assert.ok(!/se[cç][aã]o ["“]?macOS["”]? do `CLAUDE\.md`/.test(blocoMac), 'o README ainda manda abrir a secao macOS do CLAUDE.md');
});
```

Antes de escrever, confira o título real do bloco de instalação do macOS no `README.md` e ajuste
o `split` para ele. Contraprova: volte a frase para "seção macOS do `CLAUDE.md`" e veja falhar.

- [ ] **Passo 5:** índices, conservação, gate, commit.

---

### Task 6: `CONFIGURATION.md`

**Move:** "Modelo e esforço das sessões autônomas", "Assinatura do Claude", o **1º parágrafo** da
subseção "### Falhas de autenticação e conclusão da revisão" (nota 1) e "Jira multi-tenant".

- [ ] **Passo 1:** cortar e colar, na ordem em que estão no `CLAUDE.md`: Modelo e esforço,
  Assinatura, Jira.
- [ ] **Passo 2: a separação da subseção (nota 1).** No fim da seção Assinatura do
  `CONFIGURATION.md`, crie o título `### Falhas de autenticação` e mova para baixo dele, **íntegro**,
  o 1º parágrafo da subseção (o que começa com "`OAuth access token has expired` é credencial
  expirada"). No `CLAUDE.md` ficam, até a Task 7, o título antigo e o 2º parágrafo. Não resuma,
  não reescreva e não copie: a verificação de conservação acusa linha duplicada.
- [ ] **Passo 3:** referências. No `CLAUDE.md`, a linha do mapa de arquivos "ver a seção do Jira"
  passa a `docs/CONFIGURATION.md#jira-multi-tenant-v2520`. Em "Diagnóstico", "a correção do mesmo
  dia" passa a ponteiro explícito para `docs/CONFIGURATION.md`. No `MACOS.md`, a referência
  provisória da Task 5 passa a `CONFIGURATION.md#assinatura-do-claude-qual-contaplano-o-farol-usa-e-como-alternar`.
  No `CONFIGURATION.md`, "Ver `tools/jira-mcp.js` no mapa de arquivos" passa a
  `../CLAUDE.md#mapa-de-arquivos`. Atualizar o comentário de `test/pure.test.js:343`.
- [ ] **Passo 4: a auditoria.** Rodar `tools/make-package.ps1`. O `CONFIGURATION.md` descreve
  chave de API e token; se aparecer padrão proibido, o texto já estava no `CLAUDE.md` e já
  passava, então uma reprovação significa que algo novo entrou: descubra o quê antes de mexer.
- [ ] **Passo 5:** índices, conservação, gate, commit.

---

### Task 7: `REVIEW-GATES.md`

É a maior tarefa e a de maior risco de referência quebrada.

- [ ] **Passo 1: o invariante 4 curto no sumário.** Texto novo:

```markdown
4. **Nada é postado no GitHub sem gate.** Auto-approve exige revisão pedida a mim
   (`requested === true`), veredito `approve` e payload `APPROVE`, com default estrito por
   conta; reprovar sozinho e co-assinar são opt-in; clique manual nunca é bloqueado pelos
   gates automáticos; e check obrigatório vermelho nunca sai como APPROVE sozinho. O desenho
   completo, com o porquê de cada gate e os incidentes que os criaram, está em
   [`docs/REVIEW-GATES.md`](docs/REVIEW-GATES.md).
```

- [ ] **Passo 2:** mover todos os parágrafos longos do invariante 4 para o topo do
  `REVIEW-GATES.md`, sob `## Invariante 4, em detalhe`, e em seguida, na ordem em que estão hoje
  no `CLAUDE.md`: `## Conclusão da revisão` (título novo), com o 2º parágrafo da antiga subseção de
  falhas de autenticação movido **íntegro** para baixo dele, e o título antigo removido do `CLAUDE.md`
  (nota 1); as quatro subseções
  penduradas em "Menções navegáveis" ("Motivo é OBJETO", "A garantia mora no estrangulamento",
  "Justiça de fila", "Aprovação não é fungível"), promovidas a `##` próprias; "Um Farol por PR",
  "Dedup é por ROUND", "Re-revisão automática" com todas as subseções; "Autoanálise",
  "Checkpoint de verificação" e "Retomada após falha transitória".
- [ ] **Passo 3: o trecho de sincronização viaja sem mudança.** O parágrafo do teto de rodadas
  compartilhado entre aparelhos continua dentro de "### Autonomia completa do round" (D3). Não
  extraia, não resuma, não crie ponteiro.
- [ ] **Passo 4: referências.** Os dez comentários de código listados; `.github/SECURITY.md:56`;
  as linhas 56, 57, 62, 63 e 64 do mapa de arquivos; "acima" corrigido para "abaixo" na
  referência que já estava errada; no `CONFIGURATION.md`, logo depois do parágrafo de `### Falhas de autenticação`, a
  referência cruzada (texto novo, uma frase): "O que acontece com a revisão estacionada, e quando
  ela volta a rodar, está em [`REVIEW-GATES.md`](REVIEW-GATES.md#ancora)", com a âncora da seção
  que trata do estacionamento ("Ciclo de vida e higiene"), gerada por `slugDeTitulo` e conferida
  pelo teste de âncora da Task 3; as três citações mortas (`lib/io.js:140`,
  `lib/engine/pushback.js:5`, `ui/app.js:4057`) e a mensagem de `test/ui-widgets.test.js:320`;
  os comentários de `test/seen-vazado.test.js:116`, `test/fanout.test.js:220` e
  `test/merge-gates.test.js:4`.
- [ ] **Passo 5:** índices; conservação com `node conservacao-guias.mjs --separacao` (esperado:
  `TITULO SEPARADO (esperado)` para o título antigo, zero `DUPLICOU` e zero `FORA DO LUGAR`);
  auditoria do pacote; gate; commit.

---

### Task 8: fechar a fase

- [ ] **Passo 1: pisos definitivos dos índices.** Medir o número de seções `##` de cada guia e
  escrever em `PISO_DE_SECOES` o número medido de cada um.
- [ ] **Passo 2: o sumário.** Bloco de ponteiros logo depois do índice do `CLAUDE.md`:

```markdown
## Os guias operacionais

O conteúdo detalhado mora em quatro guias, que viajam junto com o app instalado:

| guia | assunto |
|---|---|
| [`docs/REVIEW-GATES.md`](docs/REVIEW-GATES.md) | o invariante 4 em detalhe: gates de postagem, dedup, re-revisão, autoanálise, checkpoint |
| [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md) | assinatura e perfis do Claude, orçamento, modelo e esforço, Jira |
| [`docs/MACOS.md`](docs/MACOS.md) | macOS, Linux e os pontos com branch de plataforma |
| [`docs/RELEASE.md`](docs/RELEASE.md) | versionamento, checklist de release e governança do repositório |

A documentação de sincronização entre dispositivos ainda não viaja com o app: ela depende de
`firebase/`, que não faz parte da distribuição, e tem fase própria.
```

- [ ] **Passo 3:** `README.md:64-66` deixa de dizer que o `CLAUDE.md` é grande e passa a apontar o
  sumário e os guias. `.github/ISSUE_TEMPLATE/config.yml:10`: descrição do link. Mapa de arquivos
  do `CLAUDE.md`: uma linha para `docs/` explicando que só os quatro guias viajam.
- [ ] **Passo 4: o tamanho do pacote.** Gere o zip e compare com a linha de base (**995.938
  bytes**). A expectativa é cerca de +1 KB (texto novo). **Aumento acima de 1% (cerca de 10 KB)
  reprova a fase**: significa duplicação que a conservação não pegou.
- [ ] **Passo 5: registrar.** Spec, seção "Fase 1.5": marcar como executada, registrar a revisão
  da decisão (D1 a D4), e acrescentar a fase futura "documentação de sincronização distribuível",
  com a razão da D2. Handoff: atualizar as pendências.
- [ ] **Passo 6: verificação final.**

| o que | como | esperado |
|---|---|---|
| nada sumiu nem duplicou, e a subseção separada ficou certa | `node conservacao-guias.mjs --separacao`, contra `c34b7c9` | só `SUMIU` de referência reescrita, o título antigo como `TITULO SEPARADO (esperado)`, zero `DUPLICOU` e zero `FORA DO LUGAR` |
| a base não andou | `git diff --stat c34b7c9 origin/main -- CLAUDE.md` no início da fase | vazio |
| as seis rotas concordam | `node --test test/distribuicao-listas.test.js` | verde |
| o Setup.exe leva tools | `node --test test/pacote-runtime-tools.test.js` | verde (do pré-requisito) |
| guias navegáveis | `node --test test/guias-navegaveis.test.js` | verde |
| pacote | `make-package.ps1` | `pacote limpo`, aumento abaixo de 1% |
| instalação real | zip extraído, `install.ps1` com `FAROL_INSTALL_ROOT` temporário | `docs/` com exatamente quatro guias, `workspace-template/CLAUDE.md` presente, arquivo estranho em `docs/` removido |
| `firebase/README.md` intacto | `git diff --stat c34b7c9 HEAD -- firebase/` | vazio |
| suíte | `npm run check && npm run lint && npm test` | `fail 0` |
| eng | `npm run eng` | verde |

## O que esta fase deliberadamente NÃO faz

- **Não distribui documentação de sincronização** nem nada de `firebase/` (D2). Isso é fase
  própria.
- **Não cria um quinto guia.**
- **Não distribui `docs/QUALITY.md`, `docs/ELECTRON-SMOKE.md` nem o plano de sincronização.**
  Guia instalado que aponte para eles reprova o teste de links distribuídos.
- **Não reescreve conteúdo.** Referência cruzada é reescrita; texto não.
- **Não toca `workspace-template/CLAUDE.md`.**
- **Não corrige o Setup.exe**: isso é o pré-requisito, em PR próprio e anterior.
- **Não publica release.**
