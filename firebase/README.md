# Sincronização entre dispositivos: configuração do Firebase

Esta pasta guarda o que o Farol precisa do lado do Firebase para coordenar análises e
consolidar consumo entre os seus aparelhos:

| arquivo | papel |
|---|---|
| `database.rules.json` | regras do Realtime Database: cada usuário só lê e escreve a própria árvore, lease tem validade máxima e rodada do dia exige o fuso de Brasília |
| `firebase.json` | aponta as regras e fixa as portas do emulador (banco em 9000, Auth em 9099) |

O recurso é opcional e nasce desligado. Com ele desligado, nada desta pasta é usado e o
Farol se comporta exatamente como antes.

O Farol fala com o Firebase só por REST, sem SDK e sem pacote npm. As regras são defesa
em profundidade: o cliente já faz a coordenação certa sem elas (lease e recibo usam
escrita condicionada por ETag), mas são elas que impedem outro usuário de ler a sua
árvore e um relógio adiantado de criar um lease que nunca vence.

## O que sobe para o banco

- **Presença do aparelho** (`users/{uid}/devices/{deviceId}`): nome do aparelho, sistema
  operacional, versão do Farol e o horário da última vez em que o aparelho foi visto
  (carimbo do servidor).
- **Coordenação de análise** (`leases`, `receipts`, `dailyRounds`): quem está revisando
  qual PR agora, o que já foi concluído e quantas rodadas automáticas o PR teve no dia.
- **Eventos de consumo** (`usageEvents`), só com a consolidação ligada: tokens, custo,
  modelo, perfil e tipo de cada sessão.

### Em claro, legível por quem abrir o banco

- o SHA do commit analisado, no lease e no recibo (ele pode levar direto ao repositório,
  quando o repositório é público);
- o nome do aparelho, que vazio usa o nome da máquina (hostname), o sistema operacional e
  a versão do Farol;
- no consumo: o modelo, o perfil do Claude, os tokens e o custo de cada sessão;
- identificadores e horários de cada análise (qual aparelho, quando começou, quando vence,
  como terminou e se foi publicada).

### Como resumo SHA-256 sem chave

Conta do GitHub e PR (dono, repositório e número). Sem chave quer dizer que quem já
conhece o nome consegue calcular o mesmo resumo e conferir.

### Nunca sai do aparelho

Prompts, diffs, relatórios, título do PR, nome do repositório em texto, texto de revisão,
logs e credenciais.

## Configurar (uma vez, no console do Firebase)

1. Em <https://console.firebase.google.com>, crie um projeto (o plano gratuito basta).
2. Em **Realtime Database**, crie o banco em **modo bloqueado**. Anote a URL que aparece
   no topo da aba Dados. Ela tem uma destas formas:
   - `https://<seu-projeto>-default-rtdb.<região>.firebasedatabase.app`
   - `https://<seu-projeto>-default-rtdb.firebaseio.com`
3. Na aba **Regras** do mesmo banco, apague o conteúdo e cole o arquivo
   `database.rules.json` desta pasta inteiro. Clique em **Publicar**.
   Alternativa pela linha de comando, com o `firebase-tools` instalado na sua máquina
   (ele NÃO entra no repositório do Farol), a partir desta pasta:

   ```
   firebase deploy --only database --project <seu-projeto>
   ```

4. Em **Authentication**, aba **Método de login**, habilite **E-mail/senha**.
5. Na aba **Usuários**, clique em **Adicionar usuário** e crie UM usuário com o seu
   e-mail e uma senha. É o mesmo usuário em todos os seus aparelhos: é isso que faz os
   aparelhos se enxergarem.
6. Em **Configurações do projeto** (engrenagem), aba **Geral**, copie a **Chave de API
   da Web** e o **ID do projeto**. A chave web não é segredo (a documentação do Firebase
   diz isso): quem protege os dados são as regras do passo 3 e o login do passo 5.

## Configurar em cada aparelho (no Farol)

1. Abra **Sistema > Sincronização entre dispositivos**.
2. Cole a chave web, a URL do banco e o ID do projeto. Dê um nome ao aparelho (é o que
   os outros aparelhos vão mostrar; vazio usa o nome da máquina).
3. Ligue a sincronização e salve.
4. Entre com o e-mail e a senha do usuário criado no passo 5 acima.

A senha é usada uma vez, no login, e descartada. O que fica no aparelho é só o token de
renovação, em `~/.farol/sync-credentials.json`, fora do `config.json` e com permissão
restrita ao seu usuário. A identidade do aparelho fica em
`~/.farol/workspace/state/sync-device.json`.

Coordenação de análises e consolidação de consumo são dois interruptores separados, e
os dois dependem da chave geral estar ligada.

## Sair e desligar

- **Sair deste aparelho** apaga o token de renovação local e a chave do conjunto guardada
  aqui. O aparelho para de falar com o Firebase até um novo login.
- **Desligar a sincronização** para tudo e não apaga nada, nem local nem remoto. A chave
  local também FICA: é ela que permite recuperar o conteúdo cifrado depois de uma
  redefinição de senha por e-mail.

**Não existe mais "apagar dados sincronizados" pelo app.** Sob as regras v2 a raiz
`users/{uid}` não tem concessão de escrita, então o DELETE dela é negado pelo banco: um
botão que o chamasse só produziria erro. Para parar de usar o recurso de vez: desligue a
sincronização em cada aparelho e, se quiser, apague os dados (ou o projeto inteiro) pelo
console do Firebase, que é onde essa autoridade mora.

## Validação manual com o emulador (Fase 5)

O CI do Farol não roda o emulador (ele exige Java e o `firebase-tools`, e o Farol não
adiciona dependência ao repositório). A bateria automática usa um dublê em processo
(`test/helpers/fake-rtdb.js` e `test/helpers/fake-identity.js`). Esta validação é
manual, feita uma vez por mudança relevante nas regras ou no protocolo.

Pré-requisitos, instalados na sua máquina e fora do repositório: o `firebase-tools`
(`npm install -g firebase-tools`) e o Java na versão que ele pedir ao subir os emuladores.

### Parte 1: as regras no emulador

1. A partir desta pasta, suba os emuladores do banco e do Auth:

   ```
   firebase emulators:start --only database,auth --project farol-local
   ```

2. Crie o usuário de teste no emulador de Auth (qualquer chave serve no emulador):

   ```
   curl -s -X POST "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=chave-local" \
     -H "Content-Type: application/json" \
     -d '{"email":"teste@exemplo.com","password":"senha-de-teste","returnSecureToken":true}'
   ```

   Guarde o `idToken` e o `localId` (o uid) da resposta.

3. Confira as regras com o banco do emulador (`ns=farol-local` escolhe o banco do
   projeto local):
   - escrita em `users/<uid>/devices/x` com `?auth=<idToken>` é aceita;
   - a mesma escrita em `users/<outro-uid>/devices/x` é recusada;
   - um lease com `expiresAt` acima de agora mais 300000 ms é recusado;
   - um nó de `dailyRounds` com `dayPolicy` diferente de `America/Sao_Paulo` é recusado;
   - **lease vivo de outro dono é recusado**: com `users/<uid>/leases/<conta>/<pr>`
     já gravado e `expiresAt` no futuro, um PUT com `leaseId` DIFERENTE responde 401
     (o RTDB usa 401 tanto para token vencido quanto para regra que recusa a escrita;
     `lib/sync/errors.js` mapeia os dois para `nao_autorizado`).
     É esta regra que faz "um Farol por PR" valer no servidor, e não só no cliente;
   - **o mesmo PUT é aceito depois que o lease vence**: repita a escrita acima com o
     `expiresAt` do nó existente já no passado e ela passa. Sem este caso, a regra
     poderia estar recusando por outro motivo e o teste anterior enganaria;
   - **renovação não troca de aparelho**: sobre um lease vivo, um PUT com o MESMO
     `leaseId` e `deviceId` diferente é recusado (renovar é do dono, não de quem
     souber o id).

   **O que as regras NÃO garantem, e é preciso dizer com todas as letras.** Elas
   protegem o uid (ninguém lê nem escreve na árvore de outra pessoa) e a tomada de lease
   vivo pelo caminho normal. Dois furos continuam abertos ENTRE os aparelhos da MESMA
   pessoa, os dois conhecidos:

   1. **Remoção não é validada.** `.validate` não roda em DELETE, então um aparelho pode
      apagar o lease vivo de outro. Quem protege isso é o `if-match` do cliente
      (`lib/sync/rtdb.js`), que só apaga o lease cujo ETag ele leu.
   2. **Escrita direta num campo não roda a regra do nó pai.** No Realtime Database a
      `.validate` de um ancestral não é avaliada quando a escrita acontece num
      descendente: valem a regra do nó escrito e as dos filhos dele. Por isso a validação
      do lease é REPLICADA em `expiresAt`, `leaseId` e `deviceId`, senão um `PUT` em
      `leases/{acct}/{pr}/expiresAt` esticaria o lease de outro aparelho sem passar por
      nada. Campo novo no lease precisa da própria `.validate`, ou reabre esse furo.

   Nos dois casos o limite é o mesmo: as regras defendem a fronteira entre PESSOAS, e
   entre os aparelhos de uma mesma pessoa quem coordena é o cliente.

   Estes três casos não têm teste automatizado: nenhuma suíte do repositório executa
   as regras do banco. Rode-os à mão a cada mudança neste arquivo.

   Exemplo de escrita:

   ```
   curl -s -X PUT "http://127.0.0.1:9000/users/<uid>/devices/x.json?ns=farol-local&auth=<idToken>" \
     -H "Content-Type: application/json" -d '{"name":"teste"}'
   ```

### Parte 2: dois Farols no mesmo usuário

Roda inteira offline, contra os emuladores da Parte 1. O login segue o banco: quando a
URL do banco é a do emulador (http em `127.0.0.1` ou `localhost`), o Farol faz login e
renova o token no emulador de Auth (`127.0.0.1:9099`, a porta que o `firebase.json`
fixa) em vez do Auth de produção. Com qualquer outra URL o login vai para o Firebase de
verdade.

1. Prepare duas pastas de dados separadas, uma por instância, cada uma com um
   `config.json` que troca a porta e desliga a revisão automática. Primeira instância:

   ```
   {"port": 47180, "autoReview": false}
   ```

   Segunda instância: o mesmo, com `"port": 47181`.

2. Suba cada instância com a pasta dela (`FAROL_HOME=<pasta-1> node server.js` e
   `FAROL_HOME=<pasta-2> node server.js`, em terminais separados).
3. Em cada uma, configure a sincronização como na seção "Configurar em cada aparelho",
   com estes valores e nomes de aparelho diferentes:
   - chave web: `chave-local` (o emulador aceita qualquer chave);
   - URL do banco: `http://127.0.0.1:9000`;
   - ID do projeto: `farol-local`.
4. Faça login nas duas com o usuário criado no passo 2 da Parte 1 e confira:
   - as duas aparecem na lista de aparelhos uma da outra;
   - sair de uma apaga só a credencial e a chave local dela;
   - desligar uma não apaga nada no banco.

## Validação manual das regras v2 (C1)

As regras são **geradas**: `npm run sync:rules` expande
`database.rules.template.json` e escreve `database.rules.json`. Nunca edite o `.json` à
mão, e rode `node tools/sync-rules.js --check` antes de publicar. A publicação continua
manual, uma vez, pelo dono, colando o arquivo no console.

As regras **não rodam no CI**: o dublê em processo não avalia regra. O que a bateria
automática prova é o TEXTO publicado (`test/sync-rules-contrato.test.js`) e que os
payloads reais do v1 satisfazem as validações (`test/sync-escritas-v1.test.js`). O
comportamento no servidor é esta lista, feita no emulador e, onde indicado, num projeto
real:

1. **`auth_time`:** entre com senha, grave o `keyring` (deve responder 200), espere 6
   minutos, renove o token e tente gravar de novo: precisa responder **401**. Refaça o
   login e tente de novo: **200**. Repita **no projeto real**, porque o comportamento do
   `auth_time` no emulador não é prova suficiente.
2. **`.length`:** grave um `enc` acima do teto do nó e confira a recusa.
3. **`matches` com classes:** grave um `enc` fora do formato `e1.g1.<iv>.<ct>.<tag>` e
   confira a recusa.
4. **`child()` dinâmico:** confira que as regras que leem `root.child(...)` avaliam.
5. **Raiz sem escrita:** `DELETE /users/{uid}` precisa responder **401**.
6. **Cada escrita v1 literal responde 200:** presença (PATCH e PUT), GET de `devices`,
   PUT e DELETE de lease com `if-match`, PUT e DELETE de recibo (inclusive a faxina e o
   Refazer), PUT de rodada e PATCH de poda, PATCH de consumo e o stream de leases.
7. **`keyring` com `rev` repetido:** precisa responder **401**; com `rev + 1`, **200**.
8. **Sonda:** escrever em `rulesProbe/v1/{aparelho}` precisa responder **401** (é o
   caminho sem concessão que distingue regra nova de velha); em `rulesProbe/v2/{aparelho}`,
   **200**.

## Validação manual das regras v2 (C2a, autoridade e políticas)

**O banco não verifica assinatura.** O Realtime Database não avalia criptografia: as
regras conferem dono, forma, geração e frescor de login, e nada mais. Qualquer aparelho
com a credencial da conta consegue ESCREVER em `live/control/admin`, em
`live/control/beat` e em `live/devicePolicies/{aparelho}`. Quem recusa um valor mal
assinado é sempre o CLIENTE que lê, antes de aplicar. Os itens abaixo provam o que o
servidor consegue barrar, e só isso.

9. **`live/control/admin`, primeira geração:** com o nó ausente, gravar
   `{deviceId, generation: 1, publicKey, setAt}` precisa responder **200**; gravar com
   `generation: 2` no nó ausente precisa responder **401**.
10. **`live/control/admin`, geração +1:** com o nó em `generation: 1`, gravar `2` responde
    **200**; gravar `1` de novo, ou `3`, precisa responder **401**. É o que impede um
    admin deposto de reescrever a geração vigente com a própria chave pública.
11. **`live/control/admin` e senha recente (REC):** repita o item 1 apontando para este nó,
    inclusive a parte do **projeto real**: sem o `auth_time` conferível pelo servidor, a
    tela não pode dizer que trocar de admin exige a senha, e o nó fica protegido só por
    geração, ETag e assinatura.
12. **`live/control/beat`:** com o admin em `generation: 2` e `deviceId` A, gravar um
    batimento com `generation: 2` e `dev: A` responde **200**; com `generation: 1`, ou com
    `dev: B`, precisa responder **401**. `beatAt` fora da janela de 60 s (para trás ou para
    frente) também precisa responder **401**.
13. **`live/devicePolicies/{aparelho}`:** política com `{v, generation, enc, sig}` na
    geração vigente responde **200**; com geração diferente, **401**; com `enc` fora do
    formato `e1.gN.<iv>.<ct>.<tag>` ou acima de 2048 caracteres, **401**.

## Validação manual das regras v2 (C2b, limpeza, revogação e grupo)

Mesma advertência da seção anterior: **o banco não verifica assinatura**. O que estes itens
provam é o que o servidor consegue barrar sozinho.

14. **`live/control/cleanup` sem senha:** entre com senha, espere 6 minutos, renove o token
    e grave a chave: precisa responder **200**. É a decisão D-b escrita como regra, e é o
    único nó de controle que NÃO exige senha recente.
15. **`rev` monotônico da chave:** gravar com o mesmo `rev`, ou com um menor, precisa
    responder **401**; com `rev + 1`, **200**.
16. **`live/control/cleanupLock`:** com a chave DESLIGADA, criar a trava precisa responder
    **401**; com a chave ligada e senha recente, **200**. `x` acima de `now + 600000`
    precisa responder **401**. **Apagar a trava precisa responder 200 sempre**, inclusive
    com a chave desligada: trava que não sai deixaria o conjunto parado até vencer.
17. **`live/control/lastCleanup`:** com senha recente, **200**; passados 6 minutos e com o
    token renovado, **401**.
18. **`live/control/revokedBefore`:** gravar um valor MAIOR ou igual ao `auth_time` do
    token do ato precisa responder **401** (é o que impede quem revoga de se cortar fora);
    um valor menor, **200**; e depois disso um valor ainda menor, **401**.
19. **Remoção pela limpeza:** com chave ligada, senha recente e `live/operations` ausente,
    `DELETE` em `live/groups` e em `live/devicePolicies` precisa responder **200**; com a
    chave desligada, **401**; com `live/operations` existindo, **401**.
20. **O que a limpeza não alcança:** `DELETE` em `keyring`, `leases`, `receipts`,
    `dailyRounds` e em qualquer filho de `live/control` precisa responder **401**, mesmo
    com a chave ligada e senha recente.
21. **`live/groups/{grupo}`:** grupo com `{v, generation, enc, sig}` na geração vigente
    responde **200**; com geração diferente, **401**; com `enc` acima de 2048 caracteres ou
    fora do formato, **401**.

**Limite declarado:** `usageEvents` continua com concessão de escrita ampla (`.write` do
próprio dono), herdada do v1, então a remoção dele não depende da chave de limpeza no lado
do servidor. Quem protege esse nó é o cliente, pelas cinco condições do ato.

## Validação manual das regras v2 (C3a, presença v2, capacidade e catálogo)

22. **Campos novos da presença:** gravar `contract` como texto, ou `keyReady` como número,
    precisa responder **401**; com número e booleano, **200**. E a presença de um aparelho
    ANTIGO (sem os dois campos) precisa continuar respondendo **200**.
23. **`live/deviceStatus/{dev}` e `catalog/{prTag}`:** com `{v, u, enc}` e envelope dentro
    de 2048 caracteres, **200**; faltando um campo, ou com `enc` maior, **401**. Chave do
    catálogo fora do formato de tag (por exemplo `dono-repo-12`) precisa responder **401**.
24. **Remoção pela limpeza nos dois:** com a chave ligada, senha recente e sem operação
    viva, `DELETE` responde **200**; com a chave desligada, **401**.
25. **Dono:** com um SEGUNDO usuário autenticado no mesmo projeto, toda escrita e toda
    remoção em `users/{uid-do-primeiro}` precisa responder **401**, inclusive as de
    limpeza. Este item existe por causa de um defeito real encontrado na C3a: a concessão
    de remoção se apoiava só na senha recente, que não prova quem é o dono.

## Validação manual das regras v2 (C3b, andamento ao vivo)

26. **`live/operations/{op}`:** com `{v, dev, t0, x, enc}`, `x` entre agora e agora + 5 min
    e id hexadecimal, **200**; `x` no passado ou além de 5 min, **401**; regravar com `dev`
    ou `t0` diferentes do gravado, **401**; `DELETE`, **200** sempre (a remoção é
    cooperativa e só afeta exibição).

## Validação manual das regras v2 (C3c, pendências e visto)

27. **`live/pending/{i}`:** com `{v, at, dev, enc}` e envelope até 4096, **200**; regravar
    com `at` ou `dev` diferentes, **401**; `DELETE`, **200**.
28. **`live/seen/{i}`:** a primeira gravação `{at, dev}`, **200**; a segunda sobre o mesmo
    nó, **401**; `DELETE` com a pendência ainda existente e visto recente, **401**; com a
    pendência já apagada, **200**.

## Validação manual das regras v2 (C3d, história de revisões)

29. **`recentReviews`:** consulta `orderBy="t"&limitToLast=30` responde **200** e sem
    aviso de índice ausente no log do banco; o mesmo para `orderBy="dt"`. Regravar um
    índice com `t`, `d` ou `dt` diferentes, **401**.
30. **`reviewBodies/{r}/{v}`:** a primeira gravação, **200**; a segunda na mesma versão,
    **401**; versão não numérica, **401**; envelope acima de 48000, **401**.
31. **`live/rev/{tipo}/{id}`:** número em `recentReviews`, **200**; tipo fora da lista,
    **401**; `DELETE`, **401**.

## Validação manual das regras v2 (C3e, Panorama e Meus PRs)

32. **`panorama/{item}` e `myPrs/{item}`:** linha com `{v, su, u, ctag, enc}` dentro do
    teto (2048 e 8192), **200**; tombstone `{v, su, u, ctag, del: true}`, **200**;
    `DELETE` de tombstone com menos de 24 h, **401**; com mais, **200**; `DELETE` de linha
    viva fora da limpeza, **401**. Consulta `orderBy="su"` sem aviso de índice ausente.
33. **`panoramaMeta/{scope}` e `myPrsMeta/{scope}`:** `x` até agora + 20 min, **200**;
    além disso, **401**.
