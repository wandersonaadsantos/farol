# Evidência: C2c Fiação do aceite de política e grupo

Branch `md/c2c`, da ponta de `md/integracao` com a C5d. Entrega curta, sem plano
próprio: é a fiação que faltou na C2 e que a C4b pressupõe.

## O achado

Revisando o que a C4b consome, `aceitarPolitica` e `aceitarGrupo` não tinham nenhum
chamador fora dos testes. O admin publicava a política e o grupo, e nenhum aparelho
lia. Como a política efetiva da admissão sai do cache que só o aceite grava, a pausa e
o teto de paralelismo publicados nunca teriam efeito, e o grupo aceito que a C4b usa
nunca existiria. É o mesmo tipo de lacuna do batimento, achado na C5d.

## O que mudou

`lib/engine/sync-aceite.js` roda no relógio de 10 s, logo depois dos sinais: com
consentimento local e autoridade fresca, lê `live/control/admin`, a política deste
aparelho e `live/groups`, e entrega cada nó ao aceite que já existia. Sem uma das duas
condições não lê nada.

## Gate

| Medida | Antes | `md/c2c` |
|---|---|---|
| `tests` | 3681 | 3687 |
| `fail` | 0 | 0 |

## Critério x teste

| Critério | Teste | Estado |
|---|---|---|
| Política publicada chega à admissão sem clique | `sync-aceite` | comprovado |
| Reentrega não é novidade | `sync-aceite` | comprovado |
| Grupo publicado é aceito | `sync-aceite` | comprovado |
| Sem consentimento ou sem autoridade fresca, nenhuma leitura | `sync-aceite` | comprovado |
| Política de outro aparelho não é aplicada aqui | `sync-aceite` | comprovado |
| O relógio roda o aceite | `sync-aceite` | comprovado |

## Contraprovas

6 por script, todas reprovaram.
