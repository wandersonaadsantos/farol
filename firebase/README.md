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

## Sair, desligar e apagar

- **Sair deste aparelho** apaga o token de renovação local. O aparelho para de falar com
  o Firebase até um novo login.
- **Desligar a sincronização** para tudo e não apaga nada, nem local nem remoto.
- **Apagar dados sincronizados** apaga a sua árvore inteira no banco
  (`users/{uid}`). Credencial e identidade locais ficam; se o aparelho continuar ligado,
  a presença dele volta a aparecer no próximo ciclo.

Para parar de usar o recurso de vez: apague os dados sincronizados, desligue a
sincronização em cada aparelho e, se quiser, apague o projeto no console do Firebase.

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
   - sair de uma apaga só a credencial dela;
   - desligar uma não apaga nada no banco;
   - apagar os dados sincronizados esvazia a árvore do usuário no banco.
