## O que muda

<!-- Uma frase direta. Se precisar de parágrafo, o PR provavelmente tem mais de um assunto. -->

## Por quê

<!-- O problema que isso resolve, ou o comportamento que passa a existir. Link da issue, se houver: Closes #123 -->

## Como validar

<!-- O caminho pelo app, ou o teste que cobre. Quem revisa precisa conseguir repetir. -->

## Checklist

- [ ] `npm run check && npm run lint && npm test` verdes localmente
- [ ] Teste novo cobrindo o comportamento novo (ou justificativa de por que não cabe)
- [ ] Nenhuma dependência npm nova (invariante 1)
- [ ] Nenhum gate de postagem afrouxado (invariante 4)
- [ ] Diferença de sistema operacional passando por `IS_WIN` / `IS_MAC` / `IS_LINUX` (invariante 5)
- [ ] Texto em português, sem travessão (invariante 6)
- [ ] Documentação atualizada no mesmo PR (`CLAUDE.md`, `README.md` ou `docs/QUALITY.md`), se o comportamento documentado mudou
- [ ] `package.json`, `CHANGELOG.md` e `RELEASE_NOTES` **não** foram tocados (versão é do mantenedor, na hora da release)

## Risco

<!-- O que pode quebrar se isso estiver errado, e o que fazer para reverter. "Nenhum" é resposta válida, desde que seja verdade. -->
