# Contribuindo com o Farol

Obrigado por olhar o código. O Farol é um app de desktop (Electron + Node puro) que
monitora Pull Requests e dispara revisões com o Claude Code. Antes de mexer, leia o
[`CLAUDE.md`](../CLAUDE.md) (guia do mantenedor, manda nos invariantes do app) e o
[`docs/QUALITY.md`](../docs/QUALITY.md) (manda em como o código é organizado e verificado).

## Invariantes que não se negociam

Estão detalhados no `CLAUDE.md`, seção "Invariantes do projeto". Resumo do que reprova
um PR na hora:

1. **Zero dependências além do Electron.** O engine roda com Node puro. Não adicione pacote npm.
2. **Dados em `~/.farol`**, nunca em AppData ou Library.
3. **`farol.log` só recebe falha**, nunca ruído operacional, e a classificação delas mora só em `lib/log-taxonomy.js`.
4. **Nada é postado no GitHub sem gate.** Auto-approve e auto-reject passam por `shouldAutoApprove` / `shouldAutoReject`. Não afrouxe esses gates.
5. **Diferença de sistema operacional passa por `IS_WIN` / `IS_MAC` / `IS_LINUX`** (fonte única em `lib/paths.js`), nunca por checagem solta.
6. **Texto de UI e comentário em português, sem travessão.** Use vírgula, parênteses ou dois pontos.
7. **O zip de distribuição é auditado** por `tools/make-package.ps1`. Não enfraqueça a auditoria.

## Ambiente

- Node.js >= 22.12
- GitHub CLI (`gh`) autenticado
- Claude Code (`claude`) no PATH, se for mexer no caminho de revisão

Não é preciso instalar nada para rodar os testes: a suíte usa o runner nativo do Node
(`node --test`) e não toca em `node_modules`.

## Rodar local

```bash
npm start        # abre o app Electron nos dados reais (~/.farol)
node server.js   # sobe só o engine + UI em http://127.0.0.1:47170
```

Para testar sem estragar o seu estado real, aponte para outra pasta:

```bash
FAROL_HOME=/tmp/farol-teste node server.js
```

`FAROL_REVIEW_CMD` substitui o `claude` por um stub, útil para exercitar o fluxo de
revisão sem gastar sessão.

## Gate de qualidade (obrigatório antes de abrir PR)

```bash
npm run check && npm run lint && npm test
```

- `check`: valida a sintaxe de todos os `.js` do projeto.
- `lint`: gate de qualidade com catraca (`tools/quality/gate.js`) mais higiene de referências.
- `test`: a suíte inteira, mais de 1100 testes, roda em poucos segundos.

Os três precisam ficar verdes. A mesma trinca roda no CI (Linux, Windows e macOS) em todo
push e em todo PR, então PR vermelho não é mergeado. O CI no macOS existe justamente porque
o suporte a Mac foi construído sem um Mac de teste.

Se o `lint` acusar regressão, corrija o código. `npm run lint:update` só existe para
mover a catraca quando o número melhora de verdade, nunca para esconder piora.

## Padrão de commit e de branch

- Commits no formato `tipo: descrição` (`feat`, `fix`, `docs`, `chore`, `ci`, `refactor`, `test`).
- Descrição em português, no imperativo, minúscula, sem travessão.
- Sem rodapé de coautoria.
- Branch por assunto: `feat/nome-curto`, `fix/nome-curto`.
- **Sempre LF.** O `.gitattributes` cuida disso (`* text=auto eol=lf`), inclusive em `.cmd` e `.ps1`. Script shell com CRLF quebra o shebang no macOS em silêncio.

## Abrindo o PR

- Um assunto por PR. PR que mistura correção com feature nova é difícil de revisar e de versionar.
- Teste junto com o código. Comportamento novo sem teste não entra.
- Preencha o template do PR (o que muda, por quê, como validar).
- **Não mexa em versão.** `package.json`, `CHANGELOG.md` e o array `RELEASE_NOTES` do `ui/app.js` são bumpados pelo mantenedor no momento da release, contra a última release publicada. Contribuição que já vem bumpada gera colisão de número e o `test/release-consistency.test.js` fica vermelho.
- Mudou comportamento documentado? Atualize o `CLAUDE.md`, o `README.md` ou o `docs/QUALITY.md` no mesmo PR. Documento defasado é dívida.

## O que fica com o mantenedor

Versionamento, geração de instalador e publicação de release seguem o checklist do
`CLAUDE.md` (seções "Versionamento" e "Release") e são executados pela conta dona do
repositório. Nada disso é esperado de quem contribui.

## Reportando problema

- **Bug ou ideia**: abra uma issue usando um dos templates.
- **Falha de segurança**: não abra issue. Siga o [`SECURITY.md`](SECURITY.md).

Ao colar trecho do `farol.log` ou da configuração, confira antes: o log cita nomes de
repositório, de PR e de conta. Nunca cole token.
