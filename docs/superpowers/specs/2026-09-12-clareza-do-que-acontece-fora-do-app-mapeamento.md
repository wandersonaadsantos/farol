# O que o Farol não explica: mapeamento das lacunas de clareza

Data: 12/09/2026. Origem: ao cadastrar uma conta nova de revisor (`agente70reviewer`),
o caminho inteiro aconteceu FORA do app, com o app dizendo só "rode gh auth login" e
sem dizer escopos, sem dizer que o login troca a conta ativa, e sem oferecer a
verificação. Este documento mapeia onde mais isso acontece.

Método: leitura de `ui/index.html`, `ui/app.js`, `ui/pure.js`, `lib/log-taxonomy.js`,
`lib/jira/errors.js` e das rotas de `lib/http-server.js`. Os números são contados,
não estimados.

## O achado central: a assimetria já existe no código

O app JÁ resolve esta classe de problema para o Claude e para o Codex, e não resolve
para o GitHub:

| credencial | caminho dentro do app | rota |
|---|---|---|
| Claude (assinatura) | botão "Abrir sessão de login" no card do perfil | `POST /api/claude-login` |
| Codex | mesmo botão, abre `codex login` + `codex login status` | a mesma |
| **GitHub (`gh`)** | **nenhum** | **não existe** |

`openClaudeLoginSession` abre um terminal próprio, sem PR, sem fila e sem token do
GitHub envolvido. É exatamente a forma que falta para o `gh`. A peça não precisa ser
inventada, precisa ser reusada.

## Lacuna 1: ações que só existem fora do app

Tudo abaixo é coisa que o Farol EXIGE e não oferece caminho nenhum para fazer:

| ação | onde o app cobra | o que ele oferece hoje |
|---|---|---|
| `gh auth login` de conta nova | Contas, Visão geral, banner de boas-vindas, selo da conta | a frase, em 8 lugares |
| voltar a conta ativa (`gh auth switch`) | em lugar nenhum | nada, e o login TROCA a conta ativa |
| conferir que o token da conta funciona | em lugar nenhum | nada |
| `claude login` no diretório do perfil | Plano e chaves | a frase + botão (ok) |
| chave de API da Anthropic | Plano e chaves | campo de senha, sem dizer onde obter |
| token do Atlassian | Jira, card da credencial | o texto "token criado em id.atlassian.com", não clicável |
| usuário e projeto do Firebase | Sincronização | uma frase, sem passo a passo |
| instalar o `gh` / o `claude` | Visão geral: "não encontrado no PATH" | nada |

## Lacuna 2: o app inteiro tem ZERO links de ajuda

Existem dois `href` externos em toda a interface, e nenhum dos dois é ajuda:
o perfil da conta no GitHub (`ui/pure.js:1519`) e a página de releases
(`ui/app.js:3252`). Não há link para documentação do `gh`, para a página de API
tokens do Atlassian, para o console do Firebase, para o README do próprio Farol.
Todo endereço que o usuário precisa alcançar está escrito como texto para ele
digitar à mão.

## Lacuna 3: o diagnóstico diz o que É, não o que FAZER

`lib/log-taxonomy.js` classifica falha com `{ id, label, grupo, kind, re }`.
**Não existe campo de ação.** O Diagnóstico mostra "Limite do plano Claude" ou
"Org desligou o acesso por assinatura" e o texto cru do erro, e para aí.

`lib/jira/errors.js` tem o mesmo desenho: os dez `MOTIVOS` são diagnósticos
("a credencial não tem permissão para ler este card"), nenhum é ação.

O contraexemplo bom está em `ui/pure.js:1612`: de seis tipos de estacionamento, só
`autenticacao` diz onde resolver ("renove o login do perfil em Sistema > Plano e
chaves antes de clicar em Revisar"). Os outros cinco param no diagnóstico. Esse é o
formato que falta generalizar.

## Lacuna 4: a mesma frase escrita oito vezes, cada uma diferente

"rode gh auth login" aparece em 8 lugares (5 em `pure.js`, 3 em `app.js`), com
redações distintas: "(conta de trabalho)", "para esta conta", "Se ainda não estiver
logada", "no terminal e clique em Verificar agora". Nenhuma traz escopo, hostname,
ou o passo seguinte. É a mesma classe de problema que o CLAUDE.md já nomeia em outro
eixo: fonte de verdade única. Aqui a fonte é o texto de orientação.

## Lacuna 5: comando dado numa sintaxe de shell só

O comando de verificação que serviu neste caso (`GH_TOKEN=$(...) gh api user`) é
POSIX e morre no PowerShell, que é o shell padrão de quem roda o Farol no Windows.
O app já sabe a plataforma (`snapshot.app.platform`, fonte única desde a v2.28.0) e
não usa isso para nada de texto de comando. Qualquer comando mostrado na tela tem
que sair do ramo da plataforma, como já acontece no resto do engine.

## Lacuna 6: vocabulário interno sem glossário

Termos que aparecem na tela e só estão explicados no `CLAUDE.md`: saiu de cena,
estacionada, cobertura, checkpoint de verificação, pushback, co-assinatura, fila
justa, prova por arquivo, head. São 123 ocorrências somando `pure.js` e `app.js`.
Parte tem `title` explicando; parte não.

## O que já está bom e não deve ser mexido

Para não corrigir o que funciona:

- **Os vazios que confirmam** (`ui/pure.js:1111`): "achei e está vazio" é distinguido
  de "não achei", e o vazio com automação pausada avisa. Isso é melhor que a média do
  mercado.
- **Motivo com eixo** (infra / gate / content): a separação existe e é clara.
- **Estacionamento visível** no card da fila, com hora e motivo.
- **Checks de operação e runtime** separados dos de ambiente: o app já responde três
  perguntas diferentes em vez de uma.
- **As `set-desc`**: 25 descrições de campo e 22 de seção. O app explica bem O QUE
  cada coisa é. A lacuna inteira deste documento é sobre COMO FAZER.

## Ordem sugerida de correção

1. **Sessão de login do `gh` dentro do app**, no molde do `openClaudeLoginSession`,
   com os escopos certos e voltando a conta ativa no fim. Fecha a Lacuna 1 no ponto
   que mais dói e é reuso, não peça nova.
2. **Campo de ação na taxonomia de falha** (`lib/log-taxonomy.js` e
   `lib/jira/errors.js`), no formato do `PARKED_FRASE.autenticacao`. Fonte única,
   vale no Diagnóstico e no card ao mesmo tempo, como o `kind` já vale.
3. **Bloco de comando copiável, por plataforma**, para o que não puder virar botão.
   Um helper em `ui/pure.js`, ramo por `ehWin()`, botão de copiar (o app já tem
   clipboard em cinco lugares).
4. **Links de ajuda** nos três pontos onde o usuário precisa de um endereço externo:
   API token do Atlassian, console do Firebase, chave da Anthropic.
5. **Unificar as oito frases do `gh auth login`** num helper só.
6. **Glossário**, provavelmente uma seção nova em Sistema, linkada pelas menções
   navegáveis que já existem (`data-goto`).

Os itens 1 a 3 são o núcleo: eles transformam "o app te manda embora" em "o app
te leva até o fim". O resto é acabamento.

## Lacuna 7 (é BUG, não falta de texto): o vazio da fila cita a org errada

Achado do Wanderson em 12/09/2026, olhando o próprio app: "Nada esperando por você.
O Farol monitora **biudtech** a cada 3 minutos". A frase sai de
`queueEmptyOkHtml` (`ui/pure.js:1159`), que recebe `owners: STATE.config?.owners`
(`ui/app.js:2544`). São três defeitos empilhados no mesmo parâmetro.

**1. A fonte é um campo que o motor DESCARTA.** `accountList()` (`server.js:614`) só
cai em `this.config.owners` quando NÃO existe nenhuma conta em `config.accounts`. Com
uma conta cadastrada que seja, o campo legado deixa de ter efeito sobre a busca e
continua sendo o que a tela mostra. É o anti-padrão que este repo já nomeia noutro
eixo: setting que a UI mostra e o engine descarta.

Medido no `~/.farol/config.json` desta máquina:

| fonte | valor |
|---|---|
| `config.owners` (o que a tela mostra) | `biudtech` |
| `accounts[].owners` (o que o motor busca) | `biudtech`, `lovelace-eng`, `useALWAys`, `wandersonaadsantos`, `Edicoes-CNBB`, e `biudtech` pela conta do revisor |

A tela promete monitorar uma org enquanto o motor monitora cinco. Quem olha não tem
como saber que as outras quatro estão cobertas.

**2. O escopo é ignorado.** A lista da fila é filtrada por `scopeVisible`, a frase do
vazio não. Com o seletor numa conta, o vazio segue citando o campo global: escolher
`wandersonaadsantos` mostra "monitora biudtech", uma org que aquela conta nem cobre.
O app já sabe fazer essa distinção noutro vazio (`ui/app.js:223`, "nas organizações
monitoradas" contra "nesta conta").

**3. Conta silenciada contaria.** Uma org monitorada só por conta silenciada apareceria
na frase como monitorada, quando ela está fora da automação por escolha.
`automacaoPausadaPor`, no mesmo arquivo, já pula `a.muted`. Esta não pula.

O conserto não precisa de peça nova: `orgsWithAccount()` (`ui/app.js:2042`) já faz a
união dos owners das contas com o legado como fallback, na ordem certa. Falta filtrar
por `SCOPE` e por `muted`, e passar isso no lugar do campo legado. A regra de exibição
fica: escopo numa conta cita as orgs DAQUELA conta; escopo em Todas cita a união das
contas não silenciadas; nenhuma org cadastrada cai no genérico que já existe.

**Por que isto é mais grave que as outras seis lacunas:** elas são ausência de
explicação, e o usuário percebe que não sabe. Esta é explicação ERRADA, com a cara de
quem sabe. Um vazio que nomeia a org é exatamente o vazio em que se confia.
