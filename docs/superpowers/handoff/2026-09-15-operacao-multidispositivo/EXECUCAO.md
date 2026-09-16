# Registro de execução: operação multidispositivo

Registro único e curto. Atualizado ao começar e terminar cada entrega, ao bloquear e antes de mudanças grandes de contexto. O `HANDOFF.md` desta pasta é histórico do planejamento. Evidência detalhada de cada entrega fica em `evidencias-execucao/<id>.md`.

## Estado atual

- **Fase:** execução autônoma autorizada pelo dono em 15/09/2026 (iniciativa inteira, limites no plano mestre, seção 4).
- **Entrega em curso:** nenhuma. Próxima é a C5d (degradação e volta ao modo local). C1a, C0, A5, A1, A4, C0b, C1, C2a, C2b, C3a a C3g, C4 (código), C5a, C5b e C5c validadas localmente e **todas integradas** em `md/integracao`.
- **Plano mestre:** `docs/superpowers/plans/2026-09-15-operacao-multidispositivo-mestre.md`
- **Spec:** `docs/superpowers/specs/2026-09-15-operacao-multidispositivo-design.md`
- **Base:** `origin/main` em `8c043bc` (v2.59.3, Fases 0 e 1a da reorganização), fixada em 15/09/2026.
- **Branch de integração:** `md/integracao`, worktree `C:\Users\wanderson\Documents\farol-md-exec`. Os commits de documentação da antiga `docs/handoff-operacao-multidispositivo` foram trazidos por cherry-pick; aquela branch fica como histórico.
- **Worktree de referência da base:** `C:\Users\wanderson\Documents\farol-md-base` (detached em `8c043bc`, só leitura).
- **Roteiro de contraprova:** mutação aplicada na cópia de trabalho, testes rodados, conteúdo restaurado e conferido byte a byte (script em scratchpad da sessão; o resultado de cada mutação fica na evidência da entrega).

## INCIDENTE: dados de teste gravados na pasta real (15/09/2026, 22:29)

**O que aconteceu.** Durante a C2a (tarefa 7), uma versão NÃO commitada de `test/sync-politicas.test.js` importava `lib/paths.js` estaticamente. Import estático é avaliado antes da linha que isola o `FAROL_HOME`, então o teste, rodado sozinho com `node --test` e depois pelas contraprovas, resolveu a pasta de dados para o `~/.farol` REAL. O teste gravou lá: a seção `sync` do `config.json` (chave, URL do dublê local `127.0.0.1:53033`, projeto `farol-local`, nome `Notebook`), um `sync-credentials.json` de emulador **por cima da credencial real do Firebase**, e criou `sync-key.json`, `sync-admin.json` e `sync-policy.json` de teste. O banco de teste era o dublê local: **nada foi escrito no Firebase real**. O efeito visível foi o Farol instalado esperando um banco que não existe.

**Como foi achado.** Uma outra sessão (Fase 1b da reorganização) viu os arquivos e me avisou em 16/09. A trava estática (`test/test-isolation.test.js`) tinha pegado o import na suíte inteira, e o import foi corrigido antes do commit, mas a trava só roda na suíte, DEPOIS do estrago das execuções avulsas.

**Correção de código (`4c9a1ca`).** `lib/paths.js`: sob o executor de testes (`NODE_TEST_CONTEXT`) e sem `FAROL_HOME`, a pasta de dados é um diretório temporário e sai um aviso em stderr. Vale em qualquer processo de teste, inclusive arquivo avulso. Teste novo `test/paths-home-sob-teste.test.js`, com contraprova. Suíte inteira rodada depois: a pasta real não foi tocada.

**Correção dos dados (feita pela outra sessão, pela API do app).** Cópia do estado afetado em `~/.farol/quarentena-sync-2026-09-16/`. **Ação do dono:** conferir a sincronização em Sistema e, se a credencial real não voltou, entrar de novo com o e-mail e a senha do Firebase (a credencial real foi sobrescrita pelo teste e não tem cópia anterior). A chave do conjunto de teste (`sync-key.json`) não serve para o projeto real e não deve ser restaurada.

## Linha de base medida (15/09/2026, em `8c043bc`)

| Gate | Resultado |
|---|---|
| `npm run check` | verde, 287 arquivos `.js` |
| `npm run lint` | verde, sem regressão; higiene sem referência solta |
| `npm test` | 2841 testes, 2817 aprovados, 24 pulados, 0 falhas |
| `npm run eng` | `not-run` na base sem entrega (reprova por construção, o esperado); com entrega exige `avaliacoes.jsonl` |

## Gate na linha de integração (15/09/2026, com C1a, C0, A5, A1, A4, C0b, C1, C2a, C2b, C3a a C3g, C4, C5a, C5b e C5c)

| Gate | Resultado |
|---|---|
| `npm run check` | verde, 451 arquivos `.js` |
| `npm run lint` | verde, sem regressão |
| `npm test` | 3663 testes, 3635 aprovados, 28 pulados, 0 falhas |

Windows 11, Node v24.15.0. O `npm run eng` roda no pre-push, com as avaliações escritas.

## Entregas

| Ordem | Entrega | Branch | Estado | Evidência |
|---|---|---|---|---|
| 1 | C1a Allowlist de Host | `md/c1a` | validado localmente, integrado (`be95e67`) | `evidencias-execucao/c1a.md` |
| 2 | C0 Correções da sincronização publicada | `md/c0` | validado localmente, integrado | `evidencias-execucao/c0.md` |
| 3 | A5 Retomada durável | `md/a5` | validado localmente, integrado | `evidencias-execucao/a5.md` |
| 4 | A1 Consumo fiel (sem o item 1) | `md/a1` | validado localmente, integrado (`225165a`), item 1 bloqueado | `evidencias-execucao/a1.md` |
| 5 | C0b Arbitragem de postagem no funil | `md/c0b` | validado localmente, integrado (`355f6d8`) | `evidencias-execucao/c0b.md` |
| 6 | A4 Autenticação local, núcleo | `md/a4` | validado localmente, integrado (`7387179`); ativação automática desligada | `evidencias-execucao/a4.md` |
| 7 | C1 Contrato de dados v2 e cifragem | `md/c1` | validado localmente, integrado (`6540b5a`); regras não publicadas | `evidencias-execucao/c1.md` |
| 8 | C2a Autoridade do admin, consentimento e políticas | `md/c2a` | validada localmente e **integrada** | `evidencias-execucao/c2a.md` |
| 9 | C2b Grupo de consumo, aparelho, limpeza e revogação | `md/c2b` | validada localmente e **integrada** | `evidencias-execucao/c2b.md` |
| 10 | C3a Presença v2, capacidade e catálogo cifrado | `md/c3a` | validada localmente e **integrada** | `evidencias-execucao/c3a.md` |
| 11 | C3b Andamento ao vivo | `md/c3b` | validada localmente e **integrada** | `evidencias-execucao/c3b.md` |
| 12 | C3c Pendências e visto | `md/c3c` | validada localmente e **integrada** | `evidencias-execucao/c3c.md` |
| 13 | C3d História de revisões | `md/c3d` | validada localmente e **integrada** | `evidencias-execucao/c3d.md` |
| 14 | C3e Panorama e Meus PRs | `md/c3e` | validada localmente e **integrada** | `evidencias-execucao/c3e.md` |
| 15 | C3f Memória de pushback | `md/c3f` | validada localmente e **integrada** | `evidencias-execucao/c3f.md` |
| 16 | C3g Envio do histórico local | `md/c3g` | validada localmente e **integrada** | `evidencias-execucao/c3g.md` |
| 17 | C4 Admissão local (parte de código) | `md/c4` | validada localmente e **integrada**; medição pendente por natureza | `evidencias-execucao/c4.md` |
| 18 | C5a Candidato e escolha (parte pura) | `md/c5a` | validada localmente e **integrada** | `evidencias-execucao/c5a.md` |
| 19 | C5b Prontidão do distribuidor (parte pura) | `md/c5b` | validada localmente e **integrada** | `evidencias-execucao/c5b.md` |
| 20 | C5c Distribuição entre aparelhos | `md/c5c` | validada localmente e **integrada** | `evidencias-execucao/c5c.md` |
| seguintes | C5d, C4b, C6, C7, C8, telas | | planos a escrever | |

## Observação de instabilidade na suíte (16/09/2026)

Três vezes hoje, uma rodada de `npm test` disparada **logo depois de um merge**, com a máquina ainda ocupada, terminou com UMA falha que não se repete. O sintoma é sempre o mesmo: o arquivo inteiro aparece como `✖`, **sem nenhum caso reprovando dentro dele**, e a contagem total fica menor que a normal (um arquivo não terminou). Foram arquivos diferentes (`sync-manual`, `sync-chaveiro`), e rodando o arquivo sozinho e a suíte de novo dá verde. A leitura mais provável é contenção (o `npm test` roda os arquivos em paralelo, e `sync-chaveiro` faz `scrypt` de verdade), somada ao `--test-force-exit` do script.

**Não está fechado**, e por isso fica escrito: se voltar FORA dessa condição (sem merge antes, máquina ociosa), é defeito e merece investigação própria. O primeiro passo barato seria rodar a suíte com `--test-concurrency=1` na hora em que acontecer: se sumir, é contenção; se ficar, é defeito de verdade.

## Bloqueios

| Entrega | Causa | Evidência | Tentado | Condição para continuar |
|---|---|---|---|---|
| A1, item 1 | exige sessões reais do CLI (assinatura do dono; autorização proíbe ampliar gastos) | spec 13 | não se aplica | autorização específica |
| A4, exigência automática validada | Termux real | spec 7.A4 | não se aplica | aparelho |

## Validações externas pendentes

| Entrega | O que falta provar | Onde |
|---|---|---|
| C1a | `Origin` real do Chromium na janela do Electron | job `electron` do CI, na publicação |
| A1 | `test/usage-interrompida-processo.test.js` no POSIX (o ramo `/bin/sh -lc` com grupo destacado só existe fora do Windows) | WSL ou CI |
| C0b | ajustar `POSTAGEM_COORDENADA_DESDE` para a versão publicada | PR de release desta entrega |
| C1 | comportamento das regras v2 (`auth_time`, `.length`, `matches`, `child()` dinâmico, cada escrita v1 literal, recusa do DELETE da raiz) | emulador e projeto real, pelo roteiro do `firebase/README.md` |
| C1 | publicação das regras v2 no console do Firebase | manual, uma vez, pelo dono |
| C1 | custo do `scrypt` no Termux (acima de 3 s cai para N=8192, r=8, p=10) | aparelho |
| C1 | modo 0600 do cache de chave | rodada POSIX (pula no Windows) |
| C2a | comportamento no servidor dos nós novos (geração +1, `REC` no nó do admin, janela de 60 s do batimento, teto do envelope da política) | emulador e projeto real, itens 9 a 13 do `firebase/README.md` |
| C2a | publicação das regras v2 já com os nós da C2a | console do Firebase, manual, pelo dono |
| C2a | modo 0600 do cache de política | rodada POSIX (pula no Windows) |
| C2b | comportamento no servidor dos nós de limpeza, revogação e grupo (chave sem senha, `rev` monotônico, janela de 10 min da trava, corte abaixo do `auth_time`, remoção pelo pai) | emulador e projeto real, itens 14 a 21 do `firebase/README.md` |
| C2b | publicação das regras v2 já com os nós da C2b | console do Firebase, manual, pelo dono |
| C4 | medição do consumo real de memória por ambiente e teste do peso do PR como preditor; revalidar o piso de 1024 MB | execuções reais, por ambiente |
| C3b | regras de `live/operations` no servidor e latência real entre aparelhos | item 26 do `firebase/README.md`; medição entre aparelhos |
| C3a | comportamento no servidor dos nós novos e a checagem de dono com um SEGUNDO usuário autenticado | emulador e projeto real, itens 22 a 25 do `firebase/README.md` |

## Decisões e ajustes técnicos

- Retenção da autoanálise sincronizada decidida pelo dono na autorização; registrada na spec, seção 16.
- Planos escritos na worktree de documentação recebem no topo a nota "Ajustes de execução" (worktree, branch `md/<id>`, evidência em arquivo próprio) em vez de edição linha a linha.
- C1a: contagem esperada de uma mutação corrigida de 4 para 5; testes de estático incluem `/pure/comum.js`.
- A `main` remota andou depois da base (reorganização Fase 1.5: seções do `CLAUDE.md` foram para `docs/REVIEW-GATES.md`, `docs/CONFIGURATION.md`, `docs/MACOS.md`, `docs/RELEASE.md`). A base segue fixa; as seções que as entregas acrescentam ao `CLAUDE.md` são reconciliadas com os guias na preparação da publicação.
- A5: isolamento de estado persistido no teste novo e ajuste do teste de rodada cega, detalhados na evidência.
- A1: `lib/engine/usage-desfechos.js` criado fora do plano para manter `usage.js` abaixo do teto de linhas do ratchet, em vez de subir a baseline. Detalhes e as outras correções de forma na evidência.
- A1: uma contraprova da Tarefa 13 não provava nada (mutava uma marca redundante) e foi refeita. Contraprova que não falha não é contraprova.
- C0b: três contraprovas do plano não falhavam e foram refeitas, duas delas exigindo reforçar o teste (guarda da coordenação desligada e exigência do 422). Numa delas ficou registrado que duas travas da co-assinatura são independentemente suficientes, o que é redundância, não prova. Detalhes na evidência.
- C0b: `POSTAGEM_COORDENADA_DESDE` nasce `2.59.4` e precisa ser ajustada no PR de release para a versão publicada.
- C1: a sonda escrita no plano provava a versão da regra tentando o `DELETE` de `/users/{uid}`, o que **apagaria a árvore do usuário** justamente no caso detectado. A implementação passou a escrever num caminho que as regras v2 negam. Defeito do plano, corrigido na execução.
- C1: `lib/engine/sync-chave.js` nasceu fora do plano, porque `lib/engine/sync.js` estava no teto de 400 linhas úteis; junto, a remoção do apagão foi antecipada.
- C1: **remoção de comportamento coberto por teste**, mandada pela spec 7.C1: o apagão remoto saiu com o caso de ponta a ponta que o provava. Sob as regras v2 o banco nega o `DELETE` da raiz.
- C1: as regras v2 **não foram publicadas**. O `npm run sync:rules` gera o arquivo e o `--check` confere; publicar é ato manual do dono.

## Commits

| Commit | Branch | Conteúdo |
|---|---|---|
| `6f56c12`, `6377b08`, `e8dc8a6`, `626a16f` | `md/integracao` | handoff, spec, correção da spec e anexos, plano mestre e plano da C1a (cherry-pick) |
| `081e9f4` | `md/integracao` | autorização, retenção decidida, base `8c043bc` |
| `716650d`, `06d06bb`, merge `be95e67` | `md/c1a` | C1a: função pura, guarda no servidor, mapa e evidência |
| `a71f485`, `6ca587e`, `39cbb11`, `1d22d32`, `173c6d2`, `bdd960c` | `md/c0` | C0: os seis defeitos, um commit cada |
| `fe1ab5e`, `0181acb`, `3f5c486`, `24e1ff3`, `6c927ec` | `md/a5` | A5: módulo puro, persistência, referência com contexto, validação, desfechos |
| `5bbde8b`, `160b581`, `7ab3fc5`, `659642f`, `3ab53d3`, `75a3d15`, `a488424`, `1fd7f38`, `436305b`, `c684e38`, `8256b95`, `d436c9c`, `d478abf`, `2557b05`, `106d5bb`, `eed54ed`, `7c3bfac`, merge `225165a` | `md/a1` | A1: instrumento de medição, id opaco, falha durável, custo desconhecido, reserva no gate, Codex, recusa de envelope, teto de pushback, correção pelo carimbo da linha, diário de tentativas, fiação, prova com processo real, mapa e evidência |
| `4f8b475`, `8f0a06a`, `473de56`, `826c0b5`, `a90041c`, `855512f`, `3dbec40`, `d446efa`, `6d50526`, `bc5a872`, merge `7387179` | `md/a4` | A4: modo celular decidido no servidor, chave de arquivo fora da tela, pareamento de uso único, sessões por token, inventário das rotas, porteiro da API, comando de pareamento, transporte autenticado da UI, mapa e evidência |
| `ed27d04`, `ce3c6a5`, `8e24193`, `7cc0c93`, `961666c`, `73b3743`, `df58c12`, `f0fab5e`, `fcf4714`, `7828a27` | `md/c0b` | C0b: caracterização do caminho desligado, posse com margem e recibo que preserva postagens, posse de postagem, registro durável, reconciliação, arbitragem no funil com as cinco vias, reconciliação no ciclo, co-assinatura coordenada, cobertura por versão, trava de fonte |
| `bfa65b7` | `md/integracao` | plano da C1 |
| `3ccbef2`, `56c5149`, `73e1545`, `bbe849a`, `06256a7`, `f423eec`, `2e28f7e`, `8be628a`, `cc8d4f1`, `d6f99cc`, `fa2a850`, `99189b8` | `md/c1` | C1: caracterização do desligado, interruptor, tags v2, KEK, chaveiro, cache, envelope, desbloqueio e remoção do apagão, sonda, regras v2 por macro, ciclo de recuperação, frase da tela e mapa |
| `b13c46a`, `71be6a5`, `6300c38`, `85208d9`, `e408f47`, `dda3565`, `556604c`, `69f88e0`, `ec4833b`, `736b93f` | `md/c2a` | C2a: consentimento local, chave Ed25519 do admin, assinatura, tornar-se admin com senha, frescor por sequência, publicar e aceitar política, valor efetivo, regras v2 dos nós novos e documentação |
| `335c0c1`, `6e1830e`, `ace44cb`, `b4545ef`, `9c33a1f`, `6a8c6a9`, `4c4a775`, `ab9a072`, `8c1abdd`, `76ea423`, `ceb41cf`, `1d76d58` | `md/c2b` | C2b: caracterização do desligado, identidade do grupo, vínculo por intervalo, grupo no banco com a ordem de recusa comum, renomear e aposentar, chave da limpeza, ato de apagar, revogação, regras v2 dos nós novos, seis rotas e documentação |
| `35f40f2`, `9e56a4f`, `56e0cb6`, `d119de0`, `e263a7e`, `020fcab`, `8f4e076` | `md/c3a` | C3a: caracterização do desligado, frota v2, presença com contrato e chave pronta, capacidade cifrada, catálogo cifrado, regras v2 e a correção do dono na concessão de remoção |

## Próxima ação concreta

Seguir a C5 pelas partes que faltam: C5b (prontidão do distribuidor, CT-PRONT), C5c (publicar, atribuir, aceitar e recusar, com a fiação no `enqueueHeadless` e as três correções obrigatórias do anexo S3) e C5d (degradação e volta ao modo local). A C5c é a que muda comportamento de verdade e merece o cuidado maior: ela mexe no caminho que hoje enfileira a revisão.

Segue pendente, e só o dono fecha: publicar as regras v2 no console do Firebase (roteiro do `firebase/README.md`, itens 1 a 34), conferir a sincronização depois do incidente registrado acima, e a medição de memória da C4.
