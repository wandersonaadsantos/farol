# Validação do Electron

A matriz `electron` da CI instala e executa exatamente a versão mínima declarada
em `package.json`. Assim, `^44.1.0` testa o binário 44.1.0, sem substituir a prova
por uma versão posterior permitida pelo range. Linux, Windows e macOS precisam
passar junto com a matriz de qualidade para o check obrigatório `ci` ficar verde.

Desde o Electron 44, `npm install` não baixa o executável no postinstall. A CI
executa `node node_modules/electron/install.js` e confere a versão do binário antes
do smoke. Prepare o binário da mesma forma para a execução local.

A matriz também executa o handshake real do servidor MCP/Jira com o comando e o
ambiente produzidos pelo Farol. Site e credencial são sintéticos; initialize e
tools/list não consultam o Jira. A configuração deve selecionar o modo Node;
remover a variável deve produzir modo browser. Valor vazio é apenas caracterizado,
pois seu efeito varia entre os sistemas.

O comando é `node tools/electron-smoke.js --output artifacts/electron-smoke`.
Fora da CI, acrescente `--allow-desktop`: ele abre uma janela e uma notificação
nativas. O roundtrip de autostart no Windows também exige
`--allow-autostart-probe` fora da CI.

O bootstrap carrega o `main.js`, o servidor HTTP e a interface reais. Cada execução
usa diretórios temporários, porta local própria, configuração sem contas e perfil
Electron separado. O ciclo do monitor externo fica desativado no bootstrap para
impedir consultas ao GitHub, atualizações e sessões de revisão. O teste exercita o
shell desktop; não constitui uma revisão de PR nem prova integração com provedores.

As evidências ficam nos artefatos `electron-smoke-<sistema>` da execução da CI:
relatório JSON, captura da janela e saídas do processo. O relatório distingue
versões do aplicativo e do Electron, carregamento da UI, bandeja, notificação e
autostart aplicável. No Linux, Xvfb, D-Bus, gerenciador de janelas, bandeja e daemon
de notificações fornecem um desktop real para o processo.

Autostart está disponível no produto no Windows e no macOS. No Windows, o probe usa
uma entrada de registro com nome aleatório e a remove ao final, sem alterar a entrada
Farol. No macOS (desde 18/09/2026), o roundtrip grava e apaga o LaunchAgent dentro do
HOME isolado do smoke, com o lançador semeado ali, e confere que a opção aparece na tela.
Linux não é tratado como aprovação de um recurso que o app não oferece. Os roundtrips
verificam o registro, sem simular reinício ou login do usuário.
A notificação verifica a aceitação pela API nativa e reprova falha ou timeout;
isso não comprova exibição visual nem interação do usuário.

No runner Linux, o helper `chrome-sandbox` recebe proprietário root e modo 4755,
conforme exigido pelo Chromium distribuído. O smoke mantém o sandbox habilitado.

No runner macOS efêmero, o Electron 44 recebe uma assinatura com identidade de
teste, seguindo o mecanismo de keychain do usuário usado nos testes do Electron.
A distribuição npm observada tinha apenas assinatura ad-hoc do linker, sem selo
do bundle, e o macOS recusou a autorização de notificações com `UNErrorDomain 1`.
A preparação de teste não altera o código do Farol nem concede permissão de
notificação: a chamada nativa ainda precisa ser aceita para o smoke passar.
Essa assinatura é exclusiva da CI; não é assinatura de distribuição ou notarização.

Os artefatos da CI valem para o commit identificado na execução. O smoke usa o
runtime declarado, com a preparação de assinatura de teste descrita acima no
macOS, sem validar assinatura ou notarização do bundle personalizado pelo
instalador. Também não demonstra que um instalador foi
publicado ou que um aplicativo já instalado foi atualizado.

## Compatibilidade de instalação

Electron 44 exige macOS 13 ou posterior e deixa de distribuir Windows de 32 bits
e Linux armv7l. Os instaladores verificam a plataforma antes de alterar uma
instalação existente. A versão do runtime também deve satisfazer o manifesto:
ter `electron.exe` ou `Electron.app` no disco não comprova compatibilidade.

O pacote leve não transporta o runtime. Quando o Electron em execução não atende
ao manifesto baixado, a atualização é recusada antes de substituir o aplicativo,
com orientação para usar o instalador completo. Os builders também recusam
runtime incompatível, para evitar distribuir manifesto novo com binário antigo.

Referências: [Electron 44](https://www.electronjs.org/blog/electron-44-0) e
[mudanças incompatíveis](https://www.electronjs.org/docs/latest/breaking-changes/),
[identidade de teste do Electron 44](https://github.com/electron/electron/blob/v44.1.0/script/codesign/generate-identity.sh)
e [preparação do runtime nos testes upstream](https://github.com/electron/electron/blob/v44.1.0/.github/workflows/pipeline-segment-electron-test.yml#L258-L277).
