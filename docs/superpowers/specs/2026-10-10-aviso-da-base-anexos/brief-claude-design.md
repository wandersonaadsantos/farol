# Brief para o Claude Design: o aviso de conflito e de PR superado em Meus PRs

**Para quem:** o Claude Design. Este brief descreve **estados, dados e ações**, não layout.
O desenho decide onde e como; a implementação (que já existe numa forma provisória) é
refeita depois dele.

**Pedido do dono (10/10/2026):** o Farol passou a avisar, em Meus PRs, quando um PR meu entra
em conflito com a base ou quando a base já tem tudo o que ele muda. O aviso foi entregue na
v2.71.10 reaproveitando a nota de "Merge bloqueado neste repo" (desenho de 03/10/2026), sem
passar por aqui. Este brief pede o desenho próprio do aviso.

**Regras de sempre:** texto em português e sem travessão; tema claro e escuro com contraste AA;
foco visível e teclado; desktop largo (1280 px ou mais) e celular estreito (360 a 400 px) sem
rolagem horizontal da página; alvo de toque de 44 px; dados sintéticos ("acme-exemplo", "Ana
Exemplo"); nada de biblioteca, fonte ou ícone remoto; falha não se disfarça de vazio; menções
navegáveis (PR leva ao PR no GitHub, branch é texto). Vocabulário visual do app atual
(`ui/app.css`: `--surface`, `--surface-2`, `--border`, `--accent`, `--info`, `--muted`, `.btn`,
`.pill`, `.verdict`).

## O caso que motivou

Uma promoção de branch ficou aberta e em conflito por 38 horas depois que outra promoção levou
a mesma branch inteira para a base. Não sobrava nada para entregar, e Meus PRs não dizia
nada: a mergeabilidade só era lida para PR com autoanálise aprovável, e a autoanálise só roda
pelo clique. Quem avisou foram dois colegas, no review. O dono só soube quando clicou na
autoanálise (18 horas depois), e ela gastou uma sessão de IA para dizer o que o GitHub já sabia.

O que o aviso tem que fazer: **eu bato o olho em Meus PRs e sei qual PR meu precisa de mim por
causa da base, e o que fazer com ele**, sem abrir o PR e sem rodar autoanálise.

## Onde isso vive hoje

Aba **Meus PRs**: uma lista de cards, um por PR aberto de minha autoria.

- **Topo do card:** ponto e avatar da conta, a chave do PR (`acme-exemplo/app#42`, link para o
  GitHub), selos (rascunho, veredito da autoanálise, chip da conta), título, branches
  (`feat/login → main`), "por você · @conta · atualizado há 2 h".
- **Ações à direita:** Analisar (autoanálise), Reviewers, Merge (ou as variantes Auto-merge e
  Merge admin), Ocultar.
- **Abaixo do topo, hoje:** a nota de merge bloqueado (uma linha discreta, só em repo que o dono
  bloqueou) e, depois, o painel da autoanálise quando existe (resumo, "Antes de pedir review",
  "Fora do PR", "Dá pra melhorar", relatório).
- **O aviso provisório** é mais uma linha discreta, logo abaixo da nota de merge bloqueado e
  antes do painel da autoanálise, no mesmo estilo dela (texto pequeno, cor apagada).
- O botão Merge já fica desabilitado com o motivo "O PR tem conflito com a branch de destino"
  quando há conflito, mas só nos PRs com autoanálise aprovável. Nos outros, o Merge nem aparece.

Fora do card, o mesmo aviso sai **uma vez por PR e commit** como toast dentro do app e como
notificação do sistema (Windows e macOS). Reiniciar o app avisa de novo, uma vez, do que
continua valendo.

## Os estados (o desenho cobre todos)

| estado | quando | o que precisa ficar claro |
|---|---|---|
| **sem aviso** | PR sem conflito e que ainda entrega algo | nada muda no card; o caso comum não pode ganhar ruído |
| **em conflito** | o GitHub diz que o PR conflita com a base | conflito com qual base, e o que fazer: atualizar a branch antes do merge |
| **em conflito, parte já está na base** | conflito, e alguns arquivos que o PR muda já estão iguais na base | o mesmo de cima, mais "3 dos 7 arquivos que ele muda já estão iguais lá", para eu saber se o trabalho de resolver é grande |
| **superado pela base** | tudo o que o PR muda já está na base (com ou sem conflito) | é o estado mais importante: não sobrou nada para entregar, dá para fechar sem merge. Precisa dizer **como o Farol sabe** ("conferido no código: 5 arquivos idênticos e 2 com as mesmas linhas"), porque mandar fechar sem prova é pedir que se acredite |
| **não deu para conferir** | conflito, mas a conferência não fechou (PR com mais de 300 arquivos, arquivo binário, leitura falhou) | aparece como **em conflito**, sem afirmar nada sobre superado. O Farol nunca diz "superado" na dúvida |
| **ainda não conferido** | app acabou de abrir, primeiro ciclo ainda não rodou | nada aparece (não é falha, é cedo); o desenho decide se vale um sinal de "conferindo" ou se o silêncio é o certo |
| **conta sem token ou busca falhou** | a leitura daquele ciclo falhou | o card mantém o último aviso conhecido, não apaga; o desenho decide se mostra "visto há 20 min" ou similar |
| **PR oculto** | o dono ocultou o PR em Meus PRs | o card oculto aparece esmaecido quando os ocultos estão à mostra; o aviso continua valendo nele |
| **com outras notas juntas** | repo bloqueado para merge e PR em conflito, ou autoanálise aberta | as duas notas e o painel convivem sem virar parede de aviso |

## O que a pessoa faz a partir do aviso

1. **Abrir o PR no GitHub** (já existe pelo link da chave; o aviso pode levar até lá também).
2. **Superado:** fechar o PR. **O Farol não fecha PR hoje**, e fechar é escrita no GitHub (passa
   por gate, como toda escrita do app). O desenho pode propor um botão "Fechar no GitHub" que só
   abre o PR, ou deixar só o texto; se propuser uma ação que o Farol execute, marque como
   proposta, porque ela vira decisão do dono e trabalho de engine.
3. **Conflito:** atualizar a branch. Também não é ação do Farol; o aviso diz o que fazer.
4. **Ocultar** o PR, como hoje.

## Dados reais para o desenho (sintéticos)

PR superado:
- `acme-exemplo/app#57`, título "Promoção develop → staging: novo relatório de vendas", branches `promote/relatorio-vendas → staging`, atualizado há 1 dia, conta `@ana-exemplo`.
- Conferência: 7 arquivos mudados desde o ancestral comum, 5 idênticos na base, 2 com as mesmas
  linhas (os manifestos de dependência, em que a base tem as linhas do PR e mais uma correção).
- Texto atual: "Tudo o que este PR muda já está em `staging`: não sobrou nada para entregar, dá
  para fechar sem merge. Conferido no código: 5 arquivos idênticos e 2 arquivos com as mesmas
  linhas."

PR em conflito, parte na base:
- `acme-exemplo/api#23`, "Ajuste no envio de e-mail de boas-vindas", `fix/email-boas-vindas → main`.
- 4 arquivos, 1 já igual na base.
- Texto atual: "Em conflito com `main`: atualize a branch antes do merge. 1 dos 4 arquivos que
  ele muda já estão iguais lá."

PR em conflito simples:
- `acme-exemplo/web#12`, "Filtro por data na lista de pedidos", `feat/filtro-data → develop`.
- Texto atual: "Em conflito com `develop`: atualize a branch antes do merge."

PR sem aviso (para ver o caso comum ao lado):
- `acme-exemplo/app#61`, "Paginação na busca de clientes", `feat/paginacao → develop`, autoanálise
  aprovável, Merge disponível.

Toast e notificação de hoje (o desenho pode reescrever):
- Superado: título "Farol · PR superado pela base", corpo "acme-exemplo/app#57: tudo o que ele
  muda já está em staging. Não sobrou nada para entregar, dá para fechar sem merge."
- Conflito: título "Farol · PR em conflito", corpo "acme-exemplo/web#12: em conflito com develop.
  Atualize a branch antes do merge."
- Clicar na notificação do sistema abre o app no PR.

## O que já está pronto no engine (não precisa desenhar)

O snapshot traz `baseDosMeusPRs`, por chave de PR:

```
{
  "acme-exemplo/app#57": {
    "mergeable": "CONFLICTING",
    "status": "DIRTY",
    "conflito": true,
    "base": "staging",
    "superado": { "veredito": "superado", "total": 7, "iguais": 5, "contidos": 2, "pendentes": [] },
    "at": 1791650000000
  }
}
```

- `veredito`: `superado`, `nao` (o PR ainda entrega) ou `inconclusivo` (não deu para provar).
- `pendentes`: os arquivos que não fecharam a conferência, se o desenho quiser mostrá-los.
- `at`: quando o estado foi lido (serve para "visto há 20 min").
- Lido a cada ciclo de polling (3 min), uma consulta ao GitHub por conta, sem IA.

## Celular

No celular (navegador no Android, via Termux), Meus PRs já empilha as ações embaixo do topo do
card. O aviso não pode empurrar o título para fora da primeira dobra nem ficar escondido atrás
de um toque para quem só bate o olho. Notificação do sistema não existe no navegador: lá, o
toast é o único aviso.

## O que eu espero de volta

O `HANDOFF.md` nesta mesma pasta, com os estados acima desenhados no computador e no celular,
nos dois temas, e o texto final de cada estado (card, toast e notificação).
