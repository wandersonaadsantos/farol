# Operação multidispositivo: plano mestre e pacote de execução

**Spec (contrato vigente):** `docs/superpowers/specs/2026-09-15-operacao-multidispositivo-design.md`
**Anexos normativos:** `docs/superpowers/specs/2026-09-15-operacao-multidispositivo-anexos/` (`C1-contrato-de-dados.md`, `S3-agendador.md`)
**Registro de execução (único):** `docs/superpowers/handoff/2026-09-15-operacao-multidispositivo/EXECUCAO.md`
**Base:** `origin/main` em `8c043bc` (v2.59.3, com as Fases 0 e 1a da reorganização), mais os commits de documentação, na branch `md/integracao`.

**Autorização:** o dono autorizou em 15/09/2026 a execução autônoma da iniciativa inteira, não só do lote 1, com os limites da seção 4. A autorização vale para todas as entregas elegíveis na ordem de dependências; nenhuma entrega volta a pedir aprovação.

---

## 1. O lote 1, pronto para execução autônoma

| Ordem | Entrega | Plano | Depende de (dentro do lote) | O que fica fora desta entrega |
|---|---|---|---|---|
| 1 | C1a Allowlist de Host | `2026-09-15-md-c1a-allowlist-host.md` | nada | nada |
| 2 | C0 Correções da sincronização publicada | `2026-09-15-md-c0-correcoes-sync.md` | nada | nada |
| 3 | A5 Retomada durável | `2026-09-15-md-a5-retomada-duravel.md` | nada | nada |
| 4 | A1 Consumo fiel, falha durável e tentativa interrompida | `2026-09-15-md-a1-consumo-fiel.md` | A5 (consome `resumeOutcome`) | a captura do stream real e a correção do acumulador (item 1), que dependem de autorização para sessões reais do CLI |
| 5 | C0b Arbitragem de postagem no funil | `2026-09-15-md-c0b-arbitragem-postagem.md` | C0 (`syncAtualizarPublicacao`) | nada |
| 6 | A4 Autenticação da API local, núcleo | `2026-09-15-md-a4-autenticacao-local.md` | C1a (`validarHostEOrigem`) | a tela de pareamento e a exigência automática no celular, que dependem do Claude Design e de validação num Termux real |

**Por que esta ordem.** C1a e C0 são pequenas e independentes, e C0 produz a função de recibo que a C0b consome. A5 vem antes da A1 porque a A1 grava o desfecho de retomada que a A5 produz. A C0b é a entrega de maior risco (toca o funil de postagem) e entra com as bases prontas. A A4 fecha o lote porque consome a C1a e mexe no transporte da interface.

**O que "pronto" significa para cada entrega do lote:** implementada, com todos os critérios de aceite executáveis comprovados por teste e contraprova, `npm run check && npm run lint && npm test` verde, diff revisado, evidências no registro e merge local na branch de integração. Nada do lote é publicado.

**Uma entrega bloqueada não para o lote.** Se uma entrega travar, ela e as que dependem dela ficam bloqueadas no registro, e a execução segue para a próxima elegível. Dependências dentro do lote: A1 depende de A5; C0b depende de C0; A4 depende de C1a.

---

## 2. Fora do lote 1, com o motivo e a condição para entrar

| Entrega ou parte | Motivo | Condição |
|---|---|---|
| A1, item 1: captura do stream real e correção do acumulador | exige sessões reais do CLI do Claude, que usam a assinatura do dono | autorização para até 3 sessões headless triviais, sem PR, com `FAROL_HOME` isolado |
| A4: tela de pareamento, exigência automática, detecção validada | tela vem do Claude Design (D9); detecção e alcance do loopback precisam de um Termux real | desenho aprovado e validação no aparelho |
| B0, B1 | reorganização conduzida por outra sessão | fora desta execução |
| B2 e as telas de A2, A3, C2, C3 | todo desenho vem do Claude Design | autorizado conduzir o fluxo do Claude Design sem aprovação intermediária; se o artefato estiver inacessível, a parte visual fica bloqueada e o comportamento segue |
| C1 contrato de dados v2 e cifragem | plano ainda não escrito; os gates de regra dependem de emulador (Java e `firebase-tools` ausentes nesta máquina) e de projeto real | **lote 2**, autorizado: plano escrito e implementação feita durante a execução autônoma; os critérios que só se provam no emulador ou no projeto real ficam "aguardando validação externa" |
| C2, C3, C4, C4b, C5, C6, C7, C8 | dependem de C1, de telas e de medições entre aparelhos | lotes seguintes, autorizados; ativação protegida enquanto faltar a medição exigida |

Nenhum item acima foi retirado do escopo final: eles continuam na spec e no grafo da seção 6 dela.

---

## 3. Estratégia local de branches

- **Worktree de execução:** `C:\Users\wanderson\Documents\farol-md-exec`, criada sobre `origin/main` `8c043bc`. O checkout principal (`C:\Users\wanderson\Documents\farol`) e as worktrees de outras sessões não são tocados.
- **Branch de integração:** `md/integracao`, nascida de `origin/main` `8c043bc` com os commits de documentação trazidos por cherry-pick.
- **Uma branch por entrega:** `md/c1a`, `md/c0`, `md/a5`, `md/a1`, `md/c0b`, `md/a4`, cortada da ponta de `md/integracao` no momento em que a entrega começa.
- **Integração local:** entrega pronta entra em `md/integracao` com `git merge --no-ff md/<id>`, depois do gate verde na branch da entrega e de novo na integração.
- **Sem rebase de trabalho integrado**, sem `git stash`, sem push. A branch de cada entrega fica preservada para, na publicação, virar um PR próprio sobre a `main` da época.
- **Base fixa:** a execução não puxa a `main` remota no meio do lote. Se a `main` andar, o registro anota os commits novos, e a reconciliação acontece na preparação da publicação.
- **Commits:** mensagem em português, convencional, sem nenhuma atribuição de IA. O hook de atribuição do usuário continua ativo.

---

## 4. Limites de atuação

**Autorizado depois da aprovação deste pacote, sem nova pergunta:**
- criar a worktree de execução e as branches locais `md/*`;
- editar código, testes e documentação do repositório dentro do escopo dos planos do lote;
- ajustar nomes, divisão de funções, organização de módulos e sequência técnica quando isso preservar os contratos, registrando o ajuste;
- rodar `npm run check`, `npm run lint`, `npm test`, `node --test`, `node` para scripts de teste e `npm run eng`;
- rodar o engine ou a interface **só** com `FAROL_HOME` temporário e com os stubs `FAROL_HEADLESS_CMD`/`FAROL_REVIEW_CMD`;
- usar o fake do banco (`test/helpers/fake-rtdb.js`) e o fake de identidade;
- commits locais, merges locais em `md/integracao`, atualização do registro de execução;
- revisar o diff de cada entrega e corrigir defeitos concretos achados;
- abrir subagentes de revisão ou investigação existentes, sem criar sistema de orquestração novo;
- escrever e executar os planos das entregas seguintes, na ordem de dependências;
- conduzir o fluxo do Claude Design a partir do brief da seção 8 da spec;
- iniciar instâncias isoladas do Farol e emuladores de teste, com estado, portas e diretórios isolados.

**Não autorizado (exige autorização específica):**
- `git push`, abrir PR, merge na `main`, criar tag, release;
- escrever no Jira, alterar permissões de contas, contratar serviços;
- instalar ou atualizar o Farol em uso, tocar o `~/.farol` real, abrir o app instalado;
- sessões reais do Claude ou do Codex, inclusive as triviais de medição (mantido fora por consumir a assinatura do dono; a autorização de 15/09 proíbe ampliar gastos);
- qualquer escrita no GitHub real (review, comentário, label) e uso de PR real para teste;
- qualquer operação no Firebase real ou instalação de `firebase-tools`, Java ou outro pacote;
- ativar funcionalidade para uso (ligar interruptor em config real, virar `ATIVACAO_AUTOMATICA_A4`);
- desativar teste, afrouxar regra, subir baseline de lint ou de eng-behaviour, usar `--no-verify`;
- ampliar permissões do Claude Code ou desligar proteções;
- mudar decisão de produto, reduzir escopo ou enfraquecer garantia.

---

## 5. Ciclo de execução

Para cada entrega, na ordem da seção 1, pulando as bloqueadas:

1. **Selecionar e conferir:** ler a entrega na spec e o plano; conferir no registro que as dependências estão integradas; conferir que as premissas de código do plano (arquivos, linhas, nomes) ainda valem na ponta de `md/integracao`. Premissa que mudou por causa de uma entrega anterior do lote é ajuste técnico: corrigir o plano, registrar e seguir.
2. **Cortar a branch** `md/<id>` da ponta de `md/integracao`.
3. **Implementar tarefa por tarefa**, com o teste que falha antes, a implementação, o teste passando e a **contraprova** (mutação temporária, teste certo falhando, restauração conferida).
4. **Gate da entrega:** `npm run check && npm run lint && npm test` verde. Contagem de testes igual ou maior que a da base mais os testes novos; nenhum teste pulado a mais.
5. **Revisão do diff** da branch contra `md/integracao`, procurando defeitos concretos (correção, contrato quebrado, garantia enfraquecida, vazamento de segredo). Achado confirmado é corrigido e volta ao passo 4. Melhoria opcional não abre ciclo.
6. **Evidência e commit:** registrar no `EXECUCAO.md` os critérios comprovados, os testes que os provam, as contraprovas feitas, os resultados dos gates e os ajustes técnicos.
7. **Integrar** com `git merge --no-ff` em `md/integracao` e rodar o gate de novo na integração.
8. **Seguir** para a próxima entrega elegível. A execução só termina quando não houver entrega do lote desbloqueada.

**Ao terminar o lote:** rodar `npm run eng` na ponta de `md/integracao`, com as avaliações de julgamento escritas pelo roteiro de `docs/QUALITY.md` (uma por regra acionada, com fundamentação própria sobre o diff; arquivos do baseline de responsabilidade única tocados sem resolver a dívida recebem `violacao` absorvida pelo baseline); depois escrever os planos do lote 2 e atualizar o registro.

---

## 6. Bloqueios

- Erro de teste, lint ou implementação é trabalho, não bloqueio.
- Antes de bloquear, investigar a causa e tentar resolver dentro do escopo, sem repetir a mesma tentativa sem mudança.
- Se não resolver: registrar causa, evidência, o que foi tentado e a condição para continuar; bloquear só a entrega afetada e as dependentes; seguir para a próxima elegível.
- **Parar e preservar o estado, sem improvisar liberação,** quando houver conflito entre contratos da spec, risco de perda de dados, necessidade de ampliar autorização ou de mudar decisão de produto.

---

## 7. Decisões do dono

Nenhuma pendente. A retenção da autoanálise sincronizada foi decidida na autorização de 15/09/2026 e está registrada na seção 16 da spec: sem poda destrutiva automática, versão com identidade estável e reenvio idempotente, leitura paginada, exclusão só pela limpeza protegida.

---

## 8. Estados de evidência

Cada entrega e cada critério de aceite ficam num destes estados, no registro:

| Estado | Significa |
|---|---|
| implementado | código e testes escritos |
| validado localmente | gates verdes, contraprovas feitas, diff revisado, integrado em `md/integracao` |
| aguardando validação externa | o critério só se prova em Termux, dois aparelhos, emulador, projeto real ou sessão real |
| pronto para publicação | validado localmente e com as validações externas exigidas pela spec feitas |
| publicado | PR mergeado e release publicada, com autorização |

Nenhum comportamento em Termux, integração real ou medição entre aparelhos é declarado comprovado por teste simulado.

---

## 9. Verificação de ambiente (medida em 15/09/2026, nesta máquina)

| Item | Resultado |
|---|---|
| Node e npm | Node v24.15.0, npm 11.12.1 |
| Suíte na base `8c043bc` (worktree `farol-md-base`) | 2841 testes, 2817 aprovados, 24 pulados (os POSIX), 0 falhas, cerca de 10 s |
| `npm run check`, `npm run lint` | verdes; `check` com 287 arquivos `.js` |
| `npm run eng` | na base sem entrega o veredito é `not-run` e o gate reprova, o esperado; com entrega exige `avaliacoes.jsonl` do head (roteiro em `docs/QUALITY.md`); usa o pacote local em `C:\Users\wanderson\Documents\eng-behaviour` (0.12.0) |
| `node_modules` | ausente na worktree e desnecessário para a suíte |
| Hooks | `core.hooksPath` aponta para `tools/hooks` do checkout principal; o pre-push só roda em push, que não está autorizado |
| Claude Code CLI | 2.1.268 presente (não será usado para sessões reais sem autorização) |
| Codex CLI | ausente (caminhos do Codex são testados só com stubs) |
| Java e `firebase-tools` | ausentes: nenhum gate de emulador pode rodar nesta máquina |
| `gh` | autenticado; não será usado para escrita |
| Permissões do Claude Code | modo `auto`; `node`, `npm run *`, `git worktree add`, `git rebase`, `git commit` e escrita de arquivos rodaram nesta sessão sem pedir confirmação |
| Proteções ativas | hook que bloqueia atribuição de IA em comandos; `git push --force` negado |
| Claude Design | não usado no lote; a primeira chamada de leitura pode pedir escopo de acesso |

**Etapas que podem abrir confirmação ou exigir presença, todas fora do lote 1:** primeira chamada ao Claude Design; qualquer `git push` ou `gh pr`; instalação de pacote; sessão real do CLI; login no Firebase. Dentro do lote, nenhuma etapa conhecida exige confirmação. Se o modo `auto` pedir confirmação para um comando novo, a execução não amplia a permissão: registra o comando, trata como bloqueio da tarefa e segue para a próxima elegível.

---

## 10. Continuidade

- O registro único é `EXECUCAO.md`. Ele é atualizado ao começar e ao terminar cada entrega, ao bloquear e antes de qualquer mudança grande de contexto.
- Conteúdo mínimo: entrega atual, base e branch, commits concluídos, testes e resultados, ajustes técnicos relevantes, bloqueios com condição de desbloqueio, próxima ação concreta.
- Quem retomar lê, nesta ordem: o registro, este plano mestre, o plano da entrega atual e as seções da spec citadas nele.
