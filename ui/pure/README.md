# `ui/pure/`: as funções puras da interface

Tudo aqui depende só dos argumentos: não toca DOM, não lê `STATE` nem nenhuma global
mutável. É por isso que é o único código de front que o `node --test` consegue exercitar
direto, e é a regra de entrada do diretório. Função que precise de `STATE`, `SCOPE` ou
`document` fica no `ui/app.js`; para trazer uma, passe primeiro o que ela lê como
parâmetro.

## Como é carregado

Módulo ES nativo, sem build. O navegador recebe um único `<script type="module"
src="app.js">` do `ui/index.html`; o `ui/app.js` importa de `./pure.js`, e a fachada
`ui/pure.js` reexporta todos os módulos deste diretório. O `node --test` importa os mesmos
arquivos pelo mesmo caminho. Não existe carga dupla nem rodapé CommonJS (os dois morreram
na migração ESM), e o servidor entrega subpasta de `ui/` normalmente: isso é travado em
`test/http.test.js`.

## Camadas

```
comum.js  <-  mencoes.js  <-  módulos de domínio
```

- **`comum.js`** formata e transforma valor solto (texto, número, data, duração) sem saber
  de que tela veio. Não importa nada do diretório. Também é o parser único de JSON da UI
  (`safeJsonParse`), e por isso é santuário em `tools/quality/rules.js`.
- **`mencoes.js`** transforma pessoa, repo, PR e sessão em menção navegável. Só importa de
  `comum.js`.
- **Os de domínio** (`consumo`, `entregas`, `radar`, `review`, `pessoas`, `autoanalise`,
  `meus-prs`, `contas`, `sistema`, `sessao`, `sync`, `fila-justa`) importam das duas camadas
  de baixo e, quando precisam, uns dos outros, sempre sem ciclo.

## Regras de quem mexe aqui

1. **Nome novo nasce no módulo do assunto, nunca na fachada.** O `ui/pure.js` só reexporta.
2. **A superfície pública é travada.** `test/ui-pure-superficie.test.js` congela os nomes
   exportados pela fachada: nome acrescentado entra na lista no mesmo commit, e nome
   removido exige motivo declarado.
3. **Nenhum nome é declarado em dois arquivos do diretório** (mesma trava, derivada do
   fonte). Uma duplicata assim já passou uma vez com a suíte verde.
4. **Import entre módulos é o que o código usa, e nada mais.** Import sobrando esconde
   dependência falsa e é o primeiro passo de um ciclo.
5. **Módulo abaixo de 400 linhas úteis.** O `maxLines` do ratchet dispara aí, e um módulo que
   não cabe costuma ser dois assuntos.
6. **Teste que lê o fonte como texto lê o diretório inteiro**, por
   `test/helpers/fontes-ui.js`, e não só um arquivo. Um leitor preso a um arquivo fica cego
   quando o trecho que ele afirma muda de módulo.
