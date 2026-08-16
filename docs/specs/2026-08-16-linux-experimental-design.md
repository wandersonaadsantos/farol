# Suporte experimental a Linux (v2.45.0)

Aprovado pelo Wanderson em 16/08/2026 (caminho B da conversa: fundação Linux,
sem port desktop completo). Este arquivo é apagado após a entrega, com o
essencial absorvido no CLAUDE.md (doutrina do repo).

## Motivação

Auditoria de 16/08 mostrou que `IS_MAC` era import morto: todo ramo não-Windows
caía nos caminhos do mac (`open -a Terminal`, `Farol.app`), então Linux
"subia e quebrava aos poucos". Não há usuário Linux concreto; a entrega é
completude honesta: os três SOs com ramo próprio, Linux funcional no essencial,
rotulado experimental.

## Escopo

1. `lib/paths.js`: `IS_LINUX`. Doutrina nova: POSIX genuíno fica em `!IS_WIN`
   (runShell, spawn headless, killTree, PATH do boot); o que é mac de verdade
   vira `IS_MAC` explícito; Linux ganha ramo ao lado. Aviso de boot só em
   plataforma fora das três.
2. Sessão de terminal: scripts bash atuais servem; muda o lançador.
   `pickLinuxTerminal(candidates, exists)` pura escolhe na cadeia
   x-terminal-emulator → gnome-terminal → konsole → xterm;
   `spawnConsoleLinux`/`spawnLoginConsoleLinux` espelham os do mac; nenhum
   terminal achado = toast claro, nunca silêncio.
3. Update: `buildUpdateScriptLinux` pura (mesmo escaping do mac), roda
   `install-linux.sh` e reabre via `setsid ~/.farol/bin/farol`. O ramo posix do
   applyUpdate escolhe instalador+script pela plataforma (`posixInstallerName`).
4. Instalador: `installer/install-linux.sh` + `uninstall-linux.sh`: app em
   `~/.farol/app`, Electron validado pelo binário nativo, lançador
   `~/.farol/bin/farol`, `.desktop` em `~/.local/share/applications`, ícone PNG.
   `FAROL_INSTALL_ROOT` pra teste sem tocar a instalação real. Sem offline.
5. UI: exemplos de caminho decidem por `ehWin()` (Linux vê `~/`); autostart só
   aparece no Windows (setLoginItemSettings é no-op no Linux).
6. Testes: puros pros itens 2 e 3 (rodam nos dois SOs); os posix existentes já
   cobrem Linux. Validação viva no WSL Ubuntu-24.04: boot isolado, npm test,
   install-linux.sh com root de teste.

## Fora de escopo (decisão, não esquecimento)

Tray/autostart/notificações polidos no Linux, AppImage, instalador offline.
WSLg não tem bandeja, então essa borda só se valida em desktop nativo, quando
houver usuário.
