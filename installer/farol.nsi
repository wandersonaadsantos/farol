; Farol: instalador de arquivo unico (Windows). Gera Farol-Setup-vX.Y.Z.exe.
; A pessoa da UM duplo clique: nada de extrair zip nem escolher arquivo. O exe
; carrega o app + o Electron embutidos, roda o install.ps1 (copia pra ~/.farol,
; cria o atalho, migra estado) e abre o Farol. Sem Node, sem npm, sem terminal.
;
; Compilado por tools/make-installer.ps1, que passa VERSION/PAYLOAD/OUTFILE.
Unicode true
!include "LogicLib.nsh"

!ifndef VERSION
  !define VERSION "0.0.0"
!endif
!ifndef PAYLOAD
  !error "PAYLOAD nao definido (pasta com o app + node_modules). Use make-installer.ps1."
!endif
!ifndef OUTFILE
  !define OUTFILE "Farol-Setup.exe"
!endif

Name "Farol ${VERSION}"
OutFile "${OUTFILE}"
Icon "${PAYLOAD}\assets\farol.ico"
; instala no perfil do usuario, sem exigir admin. NAO usamos $INSTDIR/InstallDir:
; quem decide o destino real e o install.ps1 (~/.farol), pra onde este .nsi
; extrai o payload ($PLUGINSDIR) e delega. Desinstalacao: pelo Desinstalar.cmd
; que acompanha a instalacao (uma entrada em "Aplicativos e recursos" fica como
; follow-up, ja que o app se instala em ~/.farol, nao via $INSTDIR).
RequestExecutionLevel user
SetCompressor /SOLID lzma
ShowInstDetails show
BrandingText "Farol v${VERSION}"

Page instfiles

Section "Farol"
  SetDetailsPrint both
  DetailPrint "Preparando o Farol v${VERSION}..."
  ; extrai o payload pra uma pasta temporaria (limpa sozinha ao sair)
  InitPluginsDir
  SetOutPath "$PLUGINSDIR\farol"
  File /r "${PAYLOAD}\*.*"

  DetailPrint "Instalando (copiando arquivos e criando o atalho)..."
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\farol\installer\install.ps1" -NoDesktop'
  Pop $0
  ${If} $0 != 0
    DetailPrint "Falha na instalacao (codigo $0)."
    Abort "Nao consegui instalar o Farol. Veja os detalhes acima."
  ${EndIf}

  DetailPrint "Pronto. Abrindo o Farol..."
  ; abre pelo atalho do Menu Iniciar (herda icone e AUMID corretos)
  Exec '"$APPDATA\Microsoft\Windows\Start Menu\Programs\Farol.lnk"'
SectionEnd
