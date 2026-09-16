# Evidência: estados de indisponibilidade na interface (adendo, item 5)

Branch `md/capacidades`, da ponta de `md/integracao` (`457d792`).

## 1. O defeito que isso fecha

Três capacidades desta iniciativa estão implementadas e **não estão valendo**: a autenticação
exigida no celular (A4, `ATIVACAO_AUTOMATICA_A4 = false`), o teto do grupo de consumo (C4b,
`ATIVACAO_TETO_GRUPO_C4B = false`) e o compartilhamento no celular, que o engine desliga
sozinho quando a autenticação não está sendo exigida (`syncComGuardaDoCelular`).

O bloqueio do compartilhamento já viajava no snapshot desde a A4b, e **nenhuma tela lia**.
Ou seja: a seção de sincronização podia mostrar o interruptor ligado enquanto o engine
mantinha tudo desligado. Numa tela de proteção, isso é pior que não ter a proteção.

## 2. O que passou a existir

| Peça | Onde |
|---|---|
| Retrato do que foi PEDIDO e do que está APLICADO | `lib/engine/capacidades.js` (puro) e a fachada `estadoDasCapacidades()`, que junta modo celular, as duas constantes de ativação, a configuração de sincronização, o bloqueio do engine e a existência de grupo aceito |
| O retrato no snapshot | `capacidades` em `snapshot()` |
| A lista do que precisa aparecer como indisponível | `capacidadesIndisponiveis` (`ui/pure/capacidades.js`), com três estados: `indisponivel`, `bloqueado`, `configurado-sem-efeito` |
| O cartão | `capacidadesIndisponiveisHtml`, mostrado no topo da seção de sincronização **inclusive com a chave geral desligada**, que é onde a pessoa acredita estar lendo o estado da proteção |

Cada item diz três coisas: o que está fora, por que, e o que já existe pronto por trás. Sem a
terceira, o aviso faria parecer que a capacidade não foi construída; sem a segunda, viraria
um erro sem saída.

## 3. Testes e contraprova

`test/capacidades-indisponiveis.test.js` (14 casos): desktop limpo (lista vazia), autenticação
no celular sem e com `localAuth: 'exigir'`, compartilhamento pedido e bloqueado, distribuição
sozinha, teto do grupo configurado e ativado, completude dos três campos de cada item, o
snapshot do engine com as ativações reais, o caso em que tudo está aplicado (silêncio), o
cartão vazio, o cartão nas duas posições da seção e o fio da tela.

Contraprova: 18 mutações. Na primeira rodada 14 reprovaram e **três passaram**, todas por
teste fraco meu: faltava o caso da distribuição sozinha, o teste de escape apontava para um
campo que o cartão não renderiza (todo texto do cartão é constante do módulo) e nada cobria a
ligação da tela. Com o teste do fio (leitura do fonte, declarada no próprio arquivo, porque
sem DOM não há como exercitar) e os casos novos, as quatro mutações refeitas reprovaram.

## 4. Gates

| Gate | Resultado |
|---|---|
| `npm run check` | verde, 525 arquivos `.js` |
| `npm run lint` | verde, sem regressão |
| `npm test` | 3913 testes, 3885 aprovados, 28 pulados, 0 falhas |

## 5. O que isto NÃO faz

Não liga nada. As três capacidades continuam desligadas, com as mesmas guardas, e a lista
some sozinha quando cada uma passar a valer. A apresentação definitiva (onde o aviso mora em
cada tela) continua dependendo do desenho do Claude Design.
