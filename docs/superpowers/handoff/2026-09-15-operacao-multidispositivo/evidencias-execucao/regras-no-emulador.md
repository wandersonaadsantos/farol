# Regras do Realtime Database medidas contra os emuladores oficiais

16/09/2026. Execução automatizada e reproduzível do roteiro de `firebase/README.md`
(Parte 1 e os itens 1 a 42 das seções "Validação manual das regras v2"), num contêiner
isolado, com projeto `demo-farol`, dados sintéticos e nenhum contato com o Firebase real.

## O que mudou de fundo: o espaço de nomes

**O emulador do banco serve dois bancos, e só um deles tem regra.** Ele carrega o
`database.rules.json` em `<projeto>-default-rtdb` e serve `<projeto>` como um banco sem
regra nenhuma. Medido (saída bruta em
`verificacoes-saidas/regras-emulador-espaco-de-nomes.txt`), com uma escrita **anônima**,
sem token nenhum, na árvore de outra pessoa:

| requisição | `ns=demo-farol` | `ns=demo-farol-default-rtdb` |
|---|---|---|
| `PUT users/uid-de-outra-pessoa/devices/x.json` | **200** | **401** |

O roteiro deste repositório mandava usar `ns=farol-local`, o id do projeto cru. Quer
dizer que ele passaria inteiro, verde, sem medir uma única regra: o pior modo de falha
possível num roteiro de segurança, porque ele não falha, ele aprova. O `firebase/README.md`
foi corrigido (seção nova "O espaço de nomes: onde as regras VALEM no emulador"), e a
decisão está travada em `test/emulador-espaco-de-nomes.test.js`.

A mesma conta vale para o **Farol apontado ao emulador**: `lib/sync/rtdb.js` monta `?ns=`
com o ID do projeto configurado na tela (`ns=${projectId}`), então esse campo precisa
receber `demo-farol-default-rtdb`. Com o id cru, a validação de ponta a ponta fala com o
banco aberto e não prova nada. Os passos da Parte 2 do README foram corrigidos.

## Ferramentas

| peça | versão |
|---|---|
| imagem do contêiner | `farol-emuladores:15.30.1`, `sha256:b8f7a89109e1bbf3fea0278f4bfdb53cf4e6b236762d415388926d74d641a2b4` |
| Node (contêiner) | v24.21.0 |
| OpenJDK (contêiner) | 21.0.12.1 |
| firebase-tools | 15.30.1 |
| emulador do banco | `firebase-database-emulator-v4.11.2.jar` |
| Node (host, que roda o executor) | v24.15.0 |

Saída bruta em `verificacoes-saidas/regras-emulador-versoes.txt`. O contêiner é a única
instalação: nada foi instalado na máquina, nenhum PATH permanente mudou e o `package.json`
do produto não ganhou dependência.

## Arquivo de regras usado, e como foi confirmado como carregado

| arquivo | sha256 |
|---|---|
| `firebase/database.rules.json` | `0b3028ba31912a70168473a35236484e88856c15880d40f0209e543c4b495eef` |
| `firebase/database.rules.template.json` | `f1be58b018416f58a4935e81644c721e8323bd0497945b72170d44caa65ec1d2` |

`node tools/sync-rules.js --check` confere: o gerado bate com o publicado.

**A confirmação é a primeira coisa que o executor faz**, antes de medir qualquer caso:
ele lê `/.settings/rules.json` no espaço de nomes certo, com o token de dono do emulador,
e compara com o arquivo do commit, campo a campo, com as chaves canonicalizadas (só a
formatação do JSON é ignorada). Se não conferir, ele aborta e não mede nada. A linha
`regras carregadas no emulador conferem com firebase/database.rules.json` abre a saída
bruta.

Isso não é decorativo, e foi provado por mutação: com `".read"` de `users/$uid` trocado
por `"true"` no arquivo do commit (e o emulador ainda com as regras originais), o
executor respondeu `as regras carregadas no emulador DIVERGEM de
firebase/database.rules.json` e parou.

O executor também mede a **deriva do relógio** entre o emulador e a máquina (o `now` das
regras é o do servidor) e aborta acima de 30 s, em vez de reprovar caso por tempo. Na
execução final: 12 ms.

## Como o executor mede

`tools/emuladores/regras-v2.js` (mais `regras-contexto.js`, `regras-comum.js` e os cinco
módulos de casos). Node puro, zero dependência nova.

- **Ele não sobe nada.** As URLs dos emuladores chegam por `--banco=`/`--auth=` ou por
  `FAROL_EMU_BANCO`/`FAROL_EMU_AUTH`, e ele falha dizendo o que falta quando não
  respondem.
- **Todo caso que prova permissão usa token de USUÁRIO.** O token de dono do emulador,
  que ignora as regras, só aparece nas funções marcadas PREPARAÇÃO (`preparar`, `semear`,
  `zerar`, `semearAdmin`, `semearLimpeza`, `semOperacoes`), para montar estado de partida.
- **Dois usuários** são criados no emulador de Auth, porque o item 25 exige um segundo
  dono autenticado no mesmo projeto.
- **A espera dos seis minutos é real.** Os itens 1, 11, 14 e 17 dependem de o `auth_time`
  vencer; o executor guarda o login de abertura, roda o resto da bateria e, no fim, espera
  o que faltar antes de renovar o token pelo refresh (acesso novo, `auth_time` antigo).
  Na execução final sobraram 329 s de espera.
- Uma linha por caso, um resumo por item do roteiro, e código de saída 1 no primeiro
  desacordo.

Comando para refazer (o roteiro completo, com o contêiner, está em `firebase/README.md`,
seção "Roteiro automático"):

```
docker run -d --name farol-emuladores-regras \
  -p 127.0.0.1:9010:9000 -p 127.0.0.1:9109:9099 \
  -v "$PWD":/farol:ro -w /home/node farol-emuladores:15.30.1 \
  sh -c 'mkdir -p /home/node/emu \
    && cp /farol/tools/emuladores/firebase.json /home/node/emu/firebase.json \
    && cp /farol/firebase/database.rules.json /home/node/emu/database.rules.json \
    && cd /home/node/emu \
    && firebase emulators:start --only database,auth --project demo-farol'

node tools/emuladores/regras-v2.js --banco=http://127.0.0.1:9010 \
  --auth=http://127.0.0.1:9109 --projeto=demo-farol

docker rm -f farol-emuladores-regras
```

## Resultado: 183 casos, 183 conferem

Saída bruta em `verificacoes-saidas/regras-emulador-executor.txt`.

| item | o que prova | casos | resultado |
|---|---|---|---|
| P1 | dono da árvore, tetos do lease, lease vivo de outro dono, lease vencido, renovação que não troca de aparelho, e os dois furos declarados | 10 | ok |
| 1 | `auth_time`: `keyring` com senha recente, com token renovado e vencido, e depois de refazer o login | 3 | ok |
| 2 | `.length`: envelope no teto e um caractere acima | 2 | ok |
| 3 | `matches` com classes: envelope fora do formato `e1.gN.<iv>.<ct>.<tag>` | 1 | ok |
| 4 | `child()` dinâmico: a regra do batimento lê `root.child(admin)` e os dois lados diferem | 2 | ok |
| 5 | raiz sem escrita: `DELETE /users/{uid}` | 1 | ok |
| 6 | as escritas v1 literais: presença (PATCH e PUT), GET de `devices`, PUT e DELETE de lease com `if-match`, PUT e DELETE de recibo, PUT de rodada e PATCH de poda, PATCH de consumo, stream SSE de leases | 11 | ok |
| 7 | `keyring` com `rev` repetido e com `rev + 1` | 3 | ok |
| 8 | sonda: `rulesProbe/v1` recusado, `rulesProbe/v2` aceito | 2 | ok |
| 9 | `live/control/admin`, primeira geração e o salto recusado | 2 | ok |
| 10 | `live/control/admin`, geração + 1; repetir ou pular é recusado | 3 | ok |
| 11 | `live/control/admin` e senha recente, dos dois lados do vencimento | 2 | ok |
| 12 | `live/control/beat`: geração, aparelho e a janela de 60 s (para trás e para frente) | 5 | ok |
| 13 | `live/devicePolicies/{aparelho}`: geração, formato e teto do envelope | 4 | ok |
| 14 | a chave de limpeza é o único nó de controle que NÃO exige senha recente (decisão D-b) | 1 | ok |
| 15 | `rev` monotônico da chave de limpeza | 3 | ok |
| 16 | `live/control/cleanupLock`: chave desligada, chave ligada, teto de `x`, e apagar sempre passa | 4 | ok |
| 17 | `live/control/lastCleanup`, dos dois lados do vencimento da senha | 2 | ok |
| 18 | `live/control/revokedBefore`: quem revoga não se corta fora, e a marca não recua | 3 | ok |
| 19 | remoção pela limpeza: chave ligada, chave desligada, operação viva | 4 | ok |
| 20 | o que a limpeza não alcança (`keyring`, `live/control/*`) e o que é concessão de dono do v1 | 6 | ok |
| 21 | `live/groups/{grupo}`: geração, teto e formato | 4 | ok |
| 22 | campos novos da presença (`contract`, `keyReady`) e a presença antiga que continua passando | 4 | ok |
| 23 | `live/deviceStatus/{dev}` e `catalog/{prTag}`: forma, teto e formato da chave | 5 | ok |
| 24 | remoção pela limpeza nos dois, com a chave ligada e desligada | 4 | ok |
| 25 | dono: o SEGUNDO usuário não lê, não escreve e não remove na árvore do primeiro, nem pelo caminho da limpeza | 4 | ok |
| 26 | `live/operations/{op}`: janela de `x`, imutabilidade de `dev` e `t0`, remoção cooperativa | 6 | ok |
| 27 | `live/pending/{i}`: teto de 4096, imutabilidade de `at` e `dev`, remoção | 4 | ok |
| 28 | `live/seen/{i}`: janela de `at`, primeira e segunda gravação, remoção com e sem a pendência | 5 | ok |
| 29 | `recentReviews`: consulta `orderBy="t"` e `orderBy="dt"`, e o índice que não pode ser regravado | 4 | ok |
| 30 | `reviewBodies/{r}/{v}`: primeira gravação, segunda na mesma versão, versão não numérica, teto de 48000 | 4 | ok |
| 31 | `live/rev/{tipo}/{id}`: tipo da lista, tipo fora dela, remoção | 3 | ok |
| 32 | `panorama/{item}` e `myPrs/{item}`: linha, lápide, os dois lados das 24 h, linha viva fora da limpeza, consulta `orderBy="su"` | 12 | ok |
| 33 | `panoramaMeta/{scope}` e `myPrsMeta/{scope}`: teto de 20 min | 4 | ok |
| 34 | `pushbacks/{prTag}`: teto, lápide, formato da chave, remoção fora da limpeza | 4 | ok |
| 35 | `live/queue/{item}/{dev}`: os oito campos, formato do id, teto de 30 min | 4 | ok |
| 36 | `live/assign/{item}`: geração, `rev` monotônico, teto de 10 min | 4 | ok |
| 36b | `live/assign/{item}/espera`: forma, teto de 10 min, formato do envelope, remoção | 4 | ok |
| 37 | `live/ack/{item}`: forma e a janela de 60 s | 2 | ok |
| 38 | `live/control/ready`: admin do momento e sequência crescente | 3 | ok |
| 39 | `usageDaily/{dev}/{dia}`: forma do dia, `v`, `seq`, grupos, e a remoção dos dois lados da chave | 7 | ok |
| 40 | `live/commands/{cmdId}`: teto de 1 h, geração, formato da chave, remoção antes e depois do `ttl` | 6 | ok |
| 41 | `commandReceipts/{cmdId}`: recibo do alvo, segundo recibo, aparelho errado, janela de 60 s, remoção com o comando lá | 6 | ok |
| 42 | `checkpoints/{loja}/{prTag}/{id}`: lojas válidas, loja inventada, id fora de 32 hex, segunda escrita, remoção sem a chave | 6 | ok |

## Defeitos achados e corrigidos

Todos os três são do ROTEIRO, não das regras nem do código do Farol. As regras
publicadas se comportaram exatamente como deveriam em todos os 183 casos.

### 1. O roteiro apontava para o banco sem regra

Descrito acima. Corrigido em `firebase/README.md` e travado em
`test/emulador-espaco-de-nomes.test.js`.

### 2. O item 20 afirmava o que as regras não dizem

O item mandava conferir que `DELETE` em `leases`, `receipts` e `dailyRounds` responde
**401** "mesmo com a chave ligada e senha recente". Medido: responde **200**, com a chave
ligada ou desligada. E tem que responder: os três têm `".write": "@U@"`, a concessão de
dono herdada do v1, que é o MESMO caminho que o item 6 exige que funcione (`DELETE` de
lease e de recibo, inclusive a faxina e o Refazer). O que a chave de limpeza governa são
os nós que a exigem por `@LIMPA@`.

Corrigido no README, com o porquê. Os três casos continuam medidos, marcados `LIMITE` na
saída: assim a descrição para de valer no dia em que o comportamento mudar.

### 3. A janela de 60 s do `commandReceipts` não estava escrita no roteiro

Achado por mutação, não por leitura. A primeira tentativa de contraprova apagou
`newData.child('at').val() <= now + 60000` do template, e a substituição de texto pegou a
PRIMEIRA ocorrência, que é a do `commandReceipts` e não a do `live/ack` que eu mirava
(saída em `verificacoes-saidas/regras-emulador-mutacao-primeira-tentativa.txt`). O
executor passou **180/180** com a regra enfraquecida: o teto não tinha caso nenhum.

Três nós repetem essa condição (`live/seen`, `live/ack` e `commandReceipts`) e só um
tinha caso. Os três têm caso agora, e o item 28 e o item 41 do README ganharam a
condição por escrito.

## Contraprova por mutação

1. `sha256` de `firebase/database.rules.json` e do template registrados antes
   (`verificacoes-saidas/regras-emulador-hashes-antes.txt`).
2. Mutação dirigida ao `live/ack` do **template** (`.write` perde
   `&& newData.child('at').val() <= now + 60000`), com a substituição conferida como
   única antes de aplicar; `node tools/sync-rules.js` regerou o `.json`; o contêiner foi
   reiniciado para carregar a regra enfraquecida.
3. O executor **reprovou**: `FALHOU item 37  resposta com at além de agora + 60 s é
   recusada  (esperava 401, veio 200)`, `182/183 casos conferem`, código de saída **1**
   (`verificacoes-saidas/regras-emulador-mutacao-live-ack.txt`).
4. Restauração pelo git, `sha256` conferido byte a byte contra o registro do passo 1
   (`verificacoes-saidas/regras-emulador-hashes-restaurado.txt`), e
   `node tools/sync-rules.js --check` verde.
5. Execução final limpa: **183/183**, código de saída 0.

## Os limites que continuam fora do emulador

| limite | item | por quê |
|---|---|---|
| `auth_time` no projeto REAL | 1, 11, 17 | o próprio README já dizia que o comportamento do `auth_time` no emulador não é prova suficiente. O executor roda os três com espera REAL de seis minutos e eles passam; o que isso prova é que a regra está escrita e é avaliada. A confirmação no projeto do dono continua pendente, e é do dono |
| assinatura | 9 a 13, 21, 36, 38, 40 | o Realtime Database não avalia criptografia. Nenhum `sig` é verificado pelo servidor, em nenhum nó. Quem recusa um valor mal assinado é sempre o cliente que lê, antes de aplicar. O que estes itens medem é dono, forma, geração e frescor de login |
| aviso de índice ausente | 29, 32 | as consultas `orderBy="t"`, `orderBy="dt"` e `orderBy="su"` são medidas (respondem 200) e o `.indexOn` está no arquivo de regras conferido, que é o que evita o aviso. Ler o log do emulador de dentro do executor exigiria acoplá-lo ao contêiner, e ele é, de propósito, um cliente HTTP que não sobe nada |
| remoção não validada (furo 1) | P1 | `.validate` não roda em `DELETE`, então um aparelho apaga o lease vivo de outro. Quem protege é o `if-match` do cliente. Medido como caso `LIMITE` |
| concessão de dono do v1 | 20 | `leases`, `receipts` e `dailyRounds` aceitam remoção do próprio dono. Quem coordena entre os aparelhos de uma mesma pessoa é o cliente. Medido como caso `LIMITE` |
| `usageEvents` | 21 (nota) | continua com concessão de escrita ampla, herdada do v1; a remoção dele não depende da chave de limpeza no servidor |
| Parte 2 (dois Farols no mesmo usuário) | — | continua manual: exige subir duas instâncias do app e operar a tela |

Nenhum item do roteiro ficou pendente de publicação: os 42, mais a Parte 1 e o campo
`espera`, foram executados de verdade contra o emulador.

## Gates

| gate | resultado | saída |
|---|---|---|
| `npm run check` | sintaxe validada em 586 arquivos `.js` | `verificacoes-saidas/regras-emulador-gate-check.txt` |
| `npm run lint` | sem regressão (a baseline não subiu) e higiene limpa | `verificacoes-saidas/regras-emulador-gate-lint.txt` |
| `npm test` | 4309 passam, 0 falham, 28 pulados | `verificacoes-saidas/regras-emulador-gate-test.txt` |

O contêiner `farol-emuladores-regras` foi removido ao final. O `farol-emuladores` de
outra rodada não foi tocado.
