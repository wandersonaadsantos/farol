# Contrato de runtime

Desenvolvimento, testes e execução externa do motor suportam somente **Node 24
LTS, `>=24.22.1 <25`**. O piso concreto é 24.22.1; não se declara suporte desde
24.0 nem para futuras majors. `package.json` é a fonte do contrato; o lockfile,
`.nvmrc`, a CI nos três sistemas e a imagem de emuladores seguem esse piso.

## Decisões do piso

O contrato vigente adota a [versão de segurança Node 24.22.1](https://nodejs.org/en/blog/release/v24.22.1),
que atualiza os certificados, bloqueia cadeias TLS afetadas e inclui Undici 7.30.1.
O piso anterior 24.16.0 não representa o requisito atual. Isso não atribui uma
causa nem declara corrigidos os crashes locais anteriores.

O piso inicial 24.15.0 foi revisto por evidência upstream: um encerramento nativo
em conexões TCP no Windows foi relatado nessa versão, e um mantenedor confirmou
a correção em 24.16.0 na [issue Node #63620](https://github.com/nodejs/node/issues/63620).
As [notas oficiais de 24.16.0](https://nodejs.org/en/blog/release/v24.16.0)
registram libuv 1.52.1 e a correção de inicialização de estrutura Windows.
O crash local do Farol com `0xC0000409` não possui pilha nativa correlacionada;
semelhança de assinatura não comprova a mesma causa. Logs e medições de 24.15.0
são preservados como histórico. Os gates devem validar o novo piso.

## Selecionar o runtime

No ambiente do projeto, use `nvm install 24.22.1` e `nvm use` (ou o equivalente
no seu gerenciador). No nvm-windows, execute `nvm use 24.22.1`. Confira
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

O Node do sistema é diferente do Node embarcado no Electron. O desktop passa
à dependência `electron: ^44.9.3`; a CI instala exatamente 44.9.3 e executa o
smoke nativo nos três sistemas, registrando `process.versions`. A versão do Node
externo não atualiza esse runtime. O patch mitiga os certificados comprometidos
tanto em Chromium quanto em Node, conforme o [aviso oficial do Electron](https://github.com/advisories/GHSA-jr5w-w6x2-84p9).

Há uma limitação remanescente: [Electron 44.9.3 embarca Node 24.22.0](https://releases.electronjs.org/release/v44.9.3),
com Undici 7.29.1. O DoS de `fetch` descrito em [GHSA-xjj6-f33q-929c](https://github.com/advisories/GHSA-xjj6-f33q-929c)
continua pendente nesse runtime do desktop. O Undici npm 7.30.1 do lock é uma
dependência opcional de `@electron/get`, usada no download, e não substitui o
Undici embarcado. `npm audit` sem alertas não comprova correção desse DoS nem
segurança total do desktop. A pendência exige patch upstream do runtime.

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
