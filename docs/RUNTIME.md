# Contrato de runtime

Desenvolvimento, testes e execução externa do motor suportam somente **Node 24
LTS, `>=24.16.0 <25`**. O piso concreto é 24.16.0; não se declara suporte desde
24.0 nem para futuras majors. `package.json` é a fonte do contrato; o lockfile,
`.nvmrc`, a CI nos três sistemas e a imagem de emuladores seguem esse piso.

## Por que o piso é 24.16.0

O piso inicial 24.15.0 foi revisto por evidência upstream: um encerramento nativo
em conexões TCP no Windows foi relatado nessa versão, e um mantenedor confirmou
a correção em 24.16.0 na [issue Node #63620](https://github.com/nodejs/node/issues/63620).
As [notas oficiais de 24.16.0](https://nodejs.org/en/blog/release/v24.16.0)
registram libuv 1.52.1 e a correção de inicialização de estrutura Windows.
O crash local do Farol com `0xC0000409` não possui pilha nativa correlacionada;
semelhança de assinatura não comprova a mesma causa. Logs e medições de 24.15.0
são preservados como histórico. Os gates devem validar o novo piso.

## Selecionar o runtime

No ambiente do projeto, use `nvm install 24.16.0` e `nvm use` (ou o equivalente
no seu gerenciador). No nvm-windows, execute `nvm use 24.16.0`. Confira
`node --version` e `node lib/node-runtime.js` antes de `npm install`.
Depois execute `npm run check`, `npm run lint`, `npm run eng` e `npm test`.
Não altere outros projetos ou instâncias em execução para validar o Farol.

`npm run server` e `node server.js` verificam o contrato antes de iniciar o motor.
Um Node incompatível é recusado com instrução de atualização. O update do modo
servidor confere o contrato do pacote recebido antes de copiar arquivos; não
instala nem troca Node automaticamente. Operadores de uma instalação antiga que
ainda roda Node 22 devem atualizar o runtime do serviço, em uma janela apropriada,
antes de aplicar esta entrega. O código de uma versão antiga não recebe este
preflight retroativamente.

## Desktop e instaladores

O Node do sistema é diferente do Node embarcado no Electron. O desktop continua
com a dependência `electron: ^44.1.0`; a CI instala exatamente 44.1.0 e executa o
smoke nativo nos três sistemas, registrando `process.versions`. A versão do Node
externo não atualiza esse runtime. Não houve atualização de Electron nesta rodada.

Os instaladores offline e os lançadores nativos continuam dispensando Node
externo. Se precisarem baixar Electron por npm, os instaladores verificam o Node
antes do staging, de encerrar processos ou de copiar código. Um runtime recusado
preserva a instalação anterior e orienta atualizar o ambiente ou usar o pacote
offline. Os builders também conferem o contrato antes de produzir artefatos.

## Histórico de Node 22

Classificação: **“Ocorrência sem causa determinada em runtime que deixou de fazer
parte do contrato de suporte.”**

Os resultados, logs e reproduzidor de Node 22.12 permanecem como registro
histórico. Não se declara o crash corrigido, nem que sua causa seja Node, parser,
hardware ou outro componente. A investigação deixou de ser obrigação desta
entrega por decisão de produto; um defeito demonstrado em runtime suportado
continua exigindo correção. Comparações históricas que citam Node 22 não são
evidência de suporte vigente.

Seleção de contexto continua em `off` por padrão. Esta política não promove
ganhos de qualidade ou economia de tokens nem habilita voz.
