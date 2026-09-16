# `ui/telas/`: as telas da interface, uma tela por assunto

Aqui mora o código que toca DOM: cria elemento, escuta evento, lê `estado()` (o snapshot do
SSE, em `estado.js`). É por isso que este código não entra no `node --test` direto (o
`test/app-carrega.test.js` executa contra um DOM de mentira); o código que não precisa de
DOM nem de `estado()` fica em `ui/pure/`, não aqui. Função que hoje mora numa tela e passa a
não usar `document`/`estado()` deveria migrar para `ui/pure/`, com o que ela lê recebido por
parâmetro.

## Como é carregado

Módulo ES nativo, sem build. O `ui/index.html` recebe um único `<script type="module"
src="app.js">`, e o `ui/app.js` importa cada módulo deste diretório. Não existe carga dupla
nem descoberta automática de arquivo: uma tela nova só passa a existir quando o `app.js`
ganha o `import` dela.

A ORDEM de registro é a ordem em que o `app.js` importa cada módulo (import estático roda
antes de qualquer linha do arquivo, na ordem em que aparece), e essa ordem é travada por
teste: `telasRegistradas()` devolve na ordem de registro, e código que depende dela (o
fan-out de `aoEstado`/`aoRedimensionar` no bootstrap) depende dessa ordem continuar estável.

## O contrato do registro

`registrarTela({ id, aoEntrar, aoEstado, aoRedimensionar })`, em `registro.js`:

- `id` é o nome da aba (o `data-tab` do HTML) para tela com aba própria, ou um nome só da
  tela para a que não tem (a caixa de revisão, a paleta de comando, os atalhos de teclado).
- `aoEntrar()` roda quando a aba passa a ser a visível (`switchTab`, no bootstrap).
- `aoEstado()` roda a cada snapshot novo do SSE (evento `state`).
- `aoRedimensionar()` roda a cada resize da janela, já debounced pelo bootstrap: só quem
  precisa medir o próprio container (hoje, o gráfico do Consumo) declara este gancho.

Uma tela pode se registrar assim que é importada (é o caso da maioria: o import estático já
chama `registrarTela` no topo do módulo) ou expor uma função própria de registro que o
bootstrap chama explicitamente, quando a ordem relativa a outra tela importa (é o caso do
Consumo: ver o comentário no fim de `ui/app.js`).

**Nenhum módulo de `ui/telas/` importa `../app.js` de volta.** Import de volta é o ciclo que
a Fase 1b existe para evitar: em módulo ES ele não explode, o valor lido no topo vem
`undefined`, e o sintoma é tela em branco com a suíte verde. A trava mora em
`test/ui-telas-contrato.test.js`.

## Como o que mora no bootstrap chega às telas

Bastante coisa que uma tela precisa fazer só o bootstrap sabe fazer: trocar de aba
(`switchTab`), navegar para uma seção do Sistema, ou orquestrar um re-render que atravessa
várias telas. Isso chega por **injeção de dependência via função de inicialização**, nunca
por a tela importar o bootstrap:

- a tela expõe `initX(dependencia)` (por exemplo `initPaleta(switchTab)`,
  `initReviewersButton(switchTab)`, `initContasTriggers(rerenderScope)`);
- `initX` guarda a dependência numa **variável de módulo** (`let _switchTab = null;`, dono de
  escrita único: só `initX` escreve nela);
- os handlers ficam **nomeados no topo do módulo**, na mesma profundidade que tinham quando
  moravam no `ui/app.js`, e leem a variável de módulo quando precisam da dependência;
- `initX` só guarda a dependência e registra os handlers. Ela não os declara por dentro.

Essa forma é o que mantém a profundidade de aninhamento fora do ratchet: embrulhar os
handlers dentro do corpo de `initX` (`function initX(dep) { function handler() {...}
document.addEventListener(...) } }`) acrescenta um nível a cada um deles, e foi medido
subindo o contador `profundidadeExcedida` durante a execução desta fase. Ver `paleta.js`
para o exemplo mais completo do padrão.

## Teste que lê o fonte de uma tela lê o diretório inteiro

Teste que casa regex contra o texto de uma tela (contagem de `role`/`tabindex`, menção
escrita à mão, import morto) usa `arquivosDasTelas`/`fonteDasTelas` de
`test/helpers/fontes-ui.js`, nunca um `fs.readFileSync` avulso contra um arquivo só. Um
leitor preso a um arquivo fica cego quando o trecho que ele afirma muda de módulo: já
aconteceu com `ui/pure/` (o comentário do próprio helper registra o caso), e a estrutura de
`ui/telas/` tem o mesmo risco, só que maior, porque tem mais arquivos.
