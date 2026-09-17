# Jornada na versão integrada, 16/09/2026 à noite

Feita no navegador embutido, contra instâncias isoladas subidas do worktree `farol-md-exec`
com o código já integrado (merge das telas de Aparelhos e Grupos e da visão compartilhada no
Radar). Nenhuma delas toca `~/.farol`; nenhuma tem chave do Firebase, então nada sai da
máquina.

| Instância | `FAROL_HOME` | Porta | Particularidade |
|---|---|---|---|
| Desktop | `scratchpad/farol-smoke` | 47193 | sem autenticação local |
| Celular simulado | `scratchpad/farol-celular` | 47194 | `TERMUX_VERSION=0.118` no ambiente |
| Pareamento | `scratchpad/farol-par` | 47196 | `localAuth: "exigir"` |

## 1. Sistema, as duas seções novas (desktop, 1280 px)

- As abas **Aparelhos** e **Grupos de consumo** aparecem entre Sincronização e Plano e chaves.
- Com a sincronização desligada, as duas mostram o estado degradado e **não fingem lista
  vazia**: "A sincronização entre dispositivos está desligada", com o botão que leva à seção
  de Sincronização.
- Ligando a chave geral pela própria tela, "Distribuir a fila entre aparelhos" **continua
  travado**, porque depende de compartilhar e de coordenar. Ligando "Compartilhar a visão",
  ele segue travado por falta de coordenação. A regra que a tela aplica é a mesma do engine.
- Com a chave geral ligada, Aparelhos passa a mostrar administração ("sem admin", com o campo
  de senha), a lista vazia com a frase do primeiro aparelho, o consentimento, os navegadores
  pareados ("a API local deste aparelho não exige credencial") e a limpeza, com a chave de
  limpeza em "não se aplica" porque o compartilhamento cifrado não está valendo.
- Grupos mostra que só o admin cria, que este aparelho não aceita configuração de admin, e o
  vínculo de perfil com o perfil real do `config.json` da instância.

## 2. Radar, a visão compartilhada (desktop)

Com a visão compartilhada ligada, aparecem as quatro áreas, todas em estado vazio honesto:
"Precisa de você em todos os aparelhos" (com "agir continua sendo no aparelho dono"), "Em
outros aparelhos" (com "atualiza a cada 10 segundos"), "Revisões de todos os aparelhos" com o
par Todos/Só este, o envio do histórico com "Medir o histórico", e a frase do que é só deste
aparelho (Destaques, Kudos e Time).

## 3. Estreito, 390 px

- Radar, Aparelhos e Grupos medidos no celular simulado: `scrollWidth == clientWidth == 390`
  nos três, isto é, **sem transbordo horizontal**, e nenhum elemento passando da borda.
- Nenhum botão, campo ou seletor visível abaixo de 44 px de altura. O único elemento menor é a
  caixa do interruptor de consentimento (13 px), cujo alvo de toque é a linha inteira, medida
  em 141 px.
- No celular simulado, Grupos diz "O compartilhamento cifrado está desligado", que é o efeito
  real da guarda do celular, e não a configuração salva.

## 4. Pareamento (porta 47196, 390 px)

- Sem credencial, o app fica escondido e só a tela de pareamento aparece (`body.parear`).
- Código gerado por `node tools/farol-parear.js`, digitado na tela: **pareou, e o app abriu**,
  sem transbordo horizontal, com a fila carregada.
- `--revogar-todas` no terminal derruba a autorização, e a tela de pareamento volta.

### Limite do instrumento, não defeito do app

Na primeira tentativa o Enter não enviou o formulário. Medido: a automação do navegador
entrega o `keydown` com `key` **vazio**, e não `"Enter"`, então o ouvinte da tela (que existe
justamente para teclado virtual) não tem como reconhecer. Disparando um `keydown` com
`key: 'Enter'` de verdade, o formulário envia e o pareamento conclui. O clique no botão
funciona nas duas situações. Fica registrado como limitação da ferramenta de automação.
