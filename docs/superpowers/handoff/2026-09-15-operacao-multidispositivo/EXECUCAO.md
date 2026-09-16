# Registro de execução: operação multidispositivo

Registro único e curto. Atualizado ao começar e terminar cada entrega, ao bloquear e antes de mudanças grandes de contexto. O `HANDOFF.md` desta pasta é histórico do planejamento. Evidência detalhada de cada entrega fica em `evidencias-execucao/<id>.md`.

## Estado atual

- **Fase:** execução autônoma autorizada pelo dono em 15/09/2026, com o **adendo de 16/09/2026** (concluir as pendências, incluindo a experiência utilizável).
- **Estado em uma frase:** **trilhas A e C integradas, com a experiência funcional na tela.** Os serviços, regras e contratos de C0 a C8 seguem implementados e validados localmente, e agora existem pela tela: pareamento da API local (A4), Plano e chaves (A2), Diagnóstico unificado com as falhas registradas (A3), interruptores de compartilhar e distribuir com o cartão da chave do conjunto (C1), Aparelhos e administração (C2a), Grupos de consumo (C2b, C4b) e a visão compartilhada no Radar, com pendências, andamento, comandos, revisões de todos os aparelhos e envio do histórico (C3, C5, C6, C8). O que continua de fora está na tabela de pendências externas e na seção de capacidades desligadas, com o motivo de cada uma.
- **Frentes em curso (adendo):** desenho B2 publicado no Claude Design (canvas em três versões, a terceira alinhada à implementação do pareamento); telas de A2, A3, A4, C1, C2 e C3 integradas em 16/09/2026; verificações A, B, C e D feitas; jornadas refeitas na versão integrada, em desktop e em 390 px (`evidencias-execucao/jornada-integrada-2.md`).
- **Plano mestre:** `docs/superpowers/plans/2026-09-15-operacao-multidispositivo-mestre.md`
- **Spec:** `docs/superpowers/specs/2026-09-15-operacao-multidispositivo-design.md`
- **Base:** `origin/main` em `8c043bc` (v2.59.3, Fases 0 e 1a da reorganização), fixada em 15/09/2026. Reconciliada em 16/09/2026 com a `main` local `dde2ac1` (Fase 1b: `ui/app.js` virou bootstrap e as telas moram em `ui/telas/`; v2.59.5; guias operacionais em `docs/`). Merge `3ec5d10` em `md/reconcilia-main`, integrado por `6eb2232`.
- **Branch de integração:** `md/integracao`, worktree `C:\Users\wanderson\Documents\farol-md-exec`. O SHA atual fica na seção "Gate na linha de integração".
- **Worktree de referência da base:** `C:\Users\wanderson\Documents\farol-md-base` (detached em `8c043bc`, só leitura).
- **Roteiro de contraprova:** mutação aplicada na cópia de trabalho, testes rodados com tempo limite de 4 min por mutação, conteúdo restaurado e conferido byte a byte (script em scratchpad da sessão; o resultado de cada mutação fica na evidência da entrega).

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

## Gate na linha de integração (16/09/2026, em `443c91b`, com tudo do adendo)

| Gate | Resultado |
|---|---|
| `npm run check` | verde, 526 arquivos `.js` |
| `npm run lint` | verde, sem regressão |
| `npm test` | 3919 testes, 3891 aprovados, 28 pulados, 0 falhas |
| `tools/make-package.ps1` | pacote limpo, 249 arquivos, 1.224 KB, com os módulos novos dentro |

A primeira rodada desta última suíte teve UMA falha de arquivo inteiro sem nenhum caso reprovando dentro (`sync-relogio-publicacao`), o mesmo sintoma registrado na seção de instabilidade; o arquivo passou três vezes sozinho e a suíte refeita deu 0 falhas. Vale a rodada refeita, como o critério manda.

Saída completa da suíte guardada fora do repositório (scratchpad da sessão, `suite-reconcilia2.txt`). Na primeira rodada depois do merge, `test/http-host-allowlist.test.js` terminou como falha de arquivo com os 28 casos aprovados; rodado sozinho três vezes, passou nas três (mesma família da falha nativa registrada em "Observação de instabilidade na suíte").

Windows 11, Node v24.15.0. O `npm run eng` roda no pre-push, com as avaliações escritas.

## Gate na linha de integração (16/09/2026 à noite, com as telas integradas)

| Gate | Resultado |
|---|---|
| `npm run check` | verde, 551 arquivos `.js` |
| `npm run lint` | verde, sem regressão (a baseline nunca subiu) |
| `npm test` | 4098 testes, 4070 aprovados, 28 pulados, 0 falhas |
| POSIX em contêiner Linux | 3959 testes, 9 falhas, todas por falta de `git` na imagem (`evidencias-execucao/validacao-posix.md`) |
| `npm run eng` | **passa**, código de saída 0, em `fcec759`: 13 regras no escopo, 12 acionadas, 12 executadas, 8 achados conhecidos do baseline que não reprovam |

Windows 11, Node v24.15.0. Nenhuma falha de arquivo inteiro nesta rodada.

## Verificação D: diff, gates e eng-behaviour

**Diff `443c91b..HEAD`:** 156 arquivos, 50.213 linhas acrescentadas e 295 removidas. Tirando
`docs/`, são 72 arquivos, 5.574 acrescentadas e 273 removidas. O volume de documentação vem
das evidências dos agentes, com as saídas de teste e de contraprova guardadas por inteiro.

**As rodadas que falharam foram preservadas**, com saída e código de saída, em
`evidencias-execucao/verificacoes-saidas/` (`tela-radar-test-2.txt`, `tela-radar-test-3.txt`,
`tela-aparelhos-rodada1-test.txt`, `tela-aparelhos-rodada2-test.txt`) e em
`suite-a2tela-rodada1-falhou.txt`. Duas causas, as duas medidas e fechadas:

1. **Queda nativa do Node no Windows** (`0xC0000409`), registrada na seção de instabilidade.
2. **Testes que dependiam da memória livre da máquina**, corrigido nesta linha: a admissão mede
   pelo MENOR entre `process.availableMemory()` e `os.freemem()`, e os testes fingiam só uma
   das duas. Com a máquina em 1031 MB livres, seis testes de quatro arquivos reprovavam e
   passavam sozinhos. O ajudante `test/helpers/memoria-livre.js` finge as duas; quem prova o
   comportamento SEM memória continua fixando na mão (`test/admissao-local.test.js`). Provado
   com a memória forçada para baixo: antes, 6 reprovações; depois, 71 de 71 aprovados. A
   contraprova (fingir só uma fonte) devolve 5 reprovações.

**`npm run eng` no HEAD final.** As 10 regras de julgamento acionadas receberam avaliação
escrita em `avaliacoes.jsonl` (fora do git, como manda o roteiro), com o fingerprint que o
próprio pacote calcula por `runAudit`: 9 `conforme`, 2 delas com confiança média e o motivo
escrito, e `core.file.single-responsibility` como **`violacao`** em cada um dos 8 arquivos do
baseline que a entrega tocou (`server.js`, `lib/log-taxonomy.js`, `lib/engine/session.js`,
`review.js`, `decision.js`, `selfpr.js`, `skip-review.js`, `usage.js`), porque a dívida
continua aberta. O baseline absorve os 8 e o veredito é `pass`. Saída guardada em
`evidencias-execucao/verificacoes-saidas/eng-final-fcec759.txt`.

## Entregas

Contagem: **39 linhas** (a 34 é a reconciliação e a 39 não tem evidência própria), 33 evidências em `evidencias-execucao/` (29 da execução até a C8; A1b, A4b e a validação POSIX do adendo). "Núcleo" é serviço, regra e contrato; "interface" é a tela que configura, aciona ou mostra a capacidade; "validação local" é gate verde mais contraprovas.

| Ordem | Entrega | Branch | Núcleo | Interface | Integração e validação local | Validação externa pendente | Condição de publicação e ativação | Evidência |
|---|---|---|---|---|---|---|---|---|
| 1 | C1a Allowlist de Host | `md/c1a` | sim | não se aplica | sim | `Origin` real do Chromium no Electron (CI) | ativa por padrão | `evidencias-execucao/c1a.md` |
| 2 | C0 Correções da sincronização publicada | `md/c0` | sim | sim (card existente) | sim | não | segue os interruptores de hoje | `evidencias-execucao/c0.md` |
| 3 | A5 Retomada durável | `md/a5` | sim | na (comportamento da fila) | sim | não | ativa por padrão | `evidencias-execucao/a5.md` |
| 4 | A1 Consumo fiel (itens 2 a 8) | `md/a1` | sim | sim (aba Consumo mostra desconhecido e interrompida) | sim | ramo POSIX do teste de interrupção | ativa por padrão | `evidencias-execucao/a1.md` |
| 5 | C0b Arbitragem de postagem no funil | `md/c0b` | sim | **não** (cobertura de postagem não aparece) | sim | ajustar `POSTAGEM_COORDENADA_DESDE` na release | com coordenação ligada | `evidencias-execucao/c0b.md` |
| 6 | A4 Autenticação local (núcleo) | `md/a4` | sim | **não** (sem tela de pareamento nem estados de autenticação) | sim | detecção e loopback no Termux real | **exigência automática desligada** (`ATIVACAO_AUTOMATICA_A4`) | `evidencias-execucao/a4.md` |
| 7 | C1 Contrato de dados v2 e cifragem | `md/c1` | sim | **não** (sem desbloqueio da chave nem interruptor de compartilhamento) | sim | regras no emulador e no projeto real; `scrypt` no Termux; 0600 em POSIX | regras publicadas pelo dono | `evidencias-execucao/c1.md` |
| 8 | C2a Autoridade do admin, consentimento e políticas | `md/c2a` | sim | **não** | sim | nós novos no servidor (itens 9 a 13); 0600 do cache de política | regras publicadas | `evidencias-execucao/c2a.md` |
| 9 | C2b Grupo, aparelho, limpeza e revogação | `md/c2b` | sim | **não** | sim | nós de limpeza, revogação e grupo (itens 14 a 21) | regras publicadas | `evidencias-execucao/c2b.md` |
| 10 | C3a Presença v2, capacidade e catálogo | `md/c3a` | sim | parcial (só a tabela de aparelhos, agora com versão) | sim | nós novos e checagem de dono com segundo usuário (itens 22 a 25) | compartilhamento ligado | `evidencias-execucao/c3a.md` |
| 11 | C3b Andamento ao vivo | `md/c3b` | sim | **não** | sim | `live/operations` no servidor (item 26); latência entre aparelhos | compartilhamento ligado | `evidencias-execucao/c3b.md` |
| 12 | C3c Pendências e visto | `md/c3c` | sim | **não** | sim | regras (itens 27 e 28) | compartilhamento ligado | `evidencias-execucao/c3c.md` |
| 13 | C3d História de revisões | `md/c3d` | sim | **não** | sim | regras (itens 29 e 30) | compartilhamento ligado | `evidencias-execucao/c3d.md` |
| 14 | C3e Panorama e Meus PRs | `md/c3e` | sim | **não** | sim | regras (itens 31 a 33) | compartilhamento ligado | `evidencias-execucao/c3e.md` |
| 15 | C3f Memória de pushback | `md/c3f` | sim | **não** | sim | regra (item 34) | compartilhamento ligado | `evidencias-execucao/c3f.md` |
| 16 | C3g Envio do histórico local | `md/c3g` | sim | **não** | sim | não | ação explícita do dono | `evidencias-execucao/c3g.md` |
| 17 | C4 Admissão local | `md/c4` | sim | **não** | sim | memória real por ambiente e peso do PR como preditor | compartilhamento ligado; **recusa por peso desligada** | `evidencias-execucao/c4.md` |
| 18 | C5a Candidato e escolha | `md/c5a` | sim | na (puro) | sim | não | com a C5c | `evidencias-execucao/c5a.md` |
| 19 | C5b Prontidão do distribuidor | `md/c5b` | sim | na (puro) | sim | não | com a C5c | `evidencias-execucao/c5b.md` |
| 20 | C5c Distribuição entre aparelhos | `md/c5c` | sim | **não** (sem interruptor nem estado da fila) | sim | regras (itens 35 a 38); latência de publicação até sessão aberta | interruptor `distribution` e admin vivo | `evidencias-execucao/c5c.md` |
| 21 | C5d Degradação e volta ao modo local | `md/c5d` | sim | **não** (a janela sem enfileiramento não aparece) | sim | não | com a C5c | `evidencias-execucao/c5d.md` |
| 22 | C2c Fiação do aceite de política e grupo | `md/c2c` | sim | na (fiação) | sim | não | com a C2 | `evidencias-execucao/c2c.md` |
| 23 | C3h Fiação da capacidade e do catálogo | `md/c3h` | sim | na (fiação) | sim | não | com a C3 | `evidencias-execucao/c3h.md` |
| 24 | C4b Ativação do teto do grupo | `md/c4b` | sim | **não** | sim | regra `usageDaily` (item 39); atraso do consumo entre dois aparelhos | **ativação desligada** (`ATIVACAO_TETO_GRUPO_C4B`) | `evidencias-execucao/c4b.md` |
| 25 | T0 Estabilidade da suíte | `md/t0` | não se aplica | não se aplica | sim | não | não se aplica | `evidencias-execucao/t0.md` |
| 26 | C6 Comandos remotos | `md/c6` | sim | **não** (a rota existe; sem tela de emitir nem de recibo) | sim | regras (itens 40 e 41) | admin vivo e consentimento local | `evidencias-execucao/c6.md` |
| 27 | C7a Checkpoint compartilhado | `md/c7a` | sim | **não** (o desfecho da herança só vai para o feed) | sim | regra (item 42) | compartilhamento ligado | `evidencias-execucao/c7a.md` |
| 28 | C7b Transferência voluntária | `md/c7b` | sim | **não** | sim | não | comando do admin; **afinidade adiada** | `evidencias-execucao/c7b.md` |
| 29 | C8 Tomada forçada | `md/c8` | sim | **não** (o aviso existe como texto; sem tela de confirmação) | sim | regra do lease sucessor no servidor | comando do admin com confirmação | `evidencias-execucao/c8.md` |
| 30 | A1b Medição real e correção do acumulador (A1, item 1) | `md/a1b` | sim | não se aplica | sim | estimativa da saída de tentativa interrompida (sem prova) | ativa por padrão | `evidencias-execucao/a1b.md` |
| 31 | A4b Autenticação exigida exercitada e guarda do celular para a C3 | `md/a4b` | sim | **não** (sem tela de pareamento) | sim (servidor real isolado) | Termux real | exigência automática desligada; C3 presa a ela no celular | `evidencias-execucao/a4b.md` |
| 33 | Contrato das telas (B2, seção 5) | `md/contrato-telas` | sim | **não** (é o que as telas vão chamar) | sim | não | não se aplica | `evidencias-execucao/contrato-telas.md` |
| 32 | Validação POSIX em Linux isolado | `md/a4b` | não se aplica | não se aplica | sim (container Linux, uid 1000, sem rede) | Android/Termux continua sem prova | não se aplica | `evidencias-execucao/validacao-posix.md` |
| 34 | Reconciliação com a `main` `dde2ac1` | `md/reconcilia-main` | não se aplica | transporte da A4 e textos da C0 portados para `ui/telas/` | sim, gate completo e quatro contraprovas nos testes ajustados | nenhuma | junto com a iniciativa | este registro, seção "Commits" |
| 35 | A3 Diagnóstico unificado (núcleo) | `md/a3` | sim | **não** (a visão única é desenho) | sim, 30 contraprovas | sessão real de diagnóstico no Claude e no Codex confirmando as ferramentas e o sandbox | junto com a iniciativa; a sessão de IA já nasce somente leitura | `evidencias-execucao/a3.md` |
| 36 | A2 Plano e chaves explícito (núcleo) | `md/a2` | sim | **não** (cartão guiado e selo são desenho) | sim, 22 contraprovas | um `claude auth status --json` com login ativo, para confirmar o campo do e-mail | junto com a iniciativa; testar é ato explícito e nunca grava | `evidencias-execucao/a2.md` |
| 37 | Estados de indisponibilidade na tela | `md/capacidades` | sim | sim (cartão na seção de sincronização) | sim, 18 contraprovas | nenhuma | nada é ligado por isto | `evidencias-execucao/capacidades-indisponiveis.md` |
| 38 | Jornada integrada na aplicação real isolada | `md/jornada` | correção de dois defeitos | verificada em desktop e em 375 px | sim, 6 contraprovas | jornadas que dependem de tela e de segundo aparelho | junto com a iniciativa | `evidencias-execucao/jornada-integrada.md` |
| 39 | Empacotamento com a auditoria corrigida | `md/empacotamento` | sim | não se aplica | sim, pacote gerado e conferido | nenhuma | pré-requisito de qualquer release | `evidencias-execucao/jornada-integrada.md`, seção 3, e o commit |
| 40 | Desenho B2 no Claude Design (canvas de 16 quadros) | `md/desenho` | não se aplica | é o desenho das telas | conferência de aderência quadro a quadro | nenhuma | não se aplica | `specs/...-anexos/B2-design/README.md` |
| 41 | A4 Tela de pareamento e vigília do stream | `md/a4-tela` | sim | sim (no lugar da interface inteira) | sim, 5 contraprovas, mais o defeito do stream aberto | Termux real | pareamento exigido continua desligado por padrão | `evidencias-execucao/a4-tela.md` |
| 42 | Verificações A, B e C (perfil, diagnóstico, pacote) | `md/verificacoes` | sim | não se aplica | sim, um defeito real corrigido em cada | sessão real de modelo (A3) e login ativo (A2) | as três fecham buraco, não abrem capacidade | `evidencias-execucao/verificacoes-a-b-c.md` |
| 43 | A3 e A2 na tela (falhas com ação, plano e chaves) | `md/a3-tela`, `md/a2-tela` | sim | sim | sim | as mesmas da A3 e da A2 | testar perfil nunca grava; diagnóstico é só leitura | `evidencias-execucao/a3.md`, `a2.md` |
| 44 | C1 na tela: compartilhar, distribuir e a chave do conjunto | `md/sync-tela` | sim | sim | sim, 13 contraprovas | regras v2 publicadas no Firebase | distribuir trava sem compartilhar e sem coordenar | `evidencias-execucao/sync-tela.md` |
| 45 | Aparelhos e Grupos de consumo na tela | `md/tela-aparelhos` | sim | sim | sim, 26 contraprovas na segunda rodada | mesmas de C2a, C2b e C4b | teto do grupo continua sem efeito | `evidencias-execucao/tela-aparelhos-grupos.md` |
| 46 | Visão compartilhada no Radar (pendências, andamento, comandos, revisões, envio) | `md/tela-radar` | sim | sim | sim, 21 contraprovas na segunda rodada | regras v2 e segundo aparelho real | só aparece com a visão valendo; transferir segue indisponível | `evidencias-execucao/tela-radar-compartilhado.md` |
| 47 | Jornada na versão integrada e memória livre fixa nos testes de admissão | `md/integracao` | sim (teste não hermético corrigido) | desktop e 390 px | sim, contraprova do ajudante de memória | jornadas com segundo aparelho e Termux | nenhuma capacidade ligada | `evidencias-execucao/jornada-integrada-2.md` |

## Capacidades desligadas: o que falta em cada uma (adendo, item 5)

| Capacidade | Implementado | Já testado | Evidência que falta | O que ela impede | Guarda contra uso prematuro |
|---|---|---|---|---|---|
| **Autenticação exigida no celular (A4)** | motor, pareamento de uso único, sessões com expiração, porteiro por classe de rota, transporte com `Authorization`, inventário de rotas | testes por classe e, em 16/09, servidor real isolado com `localAuth: 'exigir'` (`evidencias-execucao/a4b.md`) | tela de pareamento e de estados de autenticação (Claude Design); detecção do modo e alcance do loopback num Termux real | **ativação**: ligar sem a tela trancaria o usuário fora; sem a detecção validada, o modo pode não ser reconhecido | `ATIVACAO_AUTOMATICA_A4 = false` (teste trava o valor); a C3 não liga no celular sem exigência (`bloqueioCompartilhamento`, `a4b`) |
| **Teto do grupo de consumo (C4b)** | rollup por grupo, retrato no relógio, gate de estouro e de não verificável, admissão por grupo, requisitos da ativação | `sync-consumo-grupo*`, 24 contraprovas (`c4b.md`) | atraso real do consumo entre dois aparelhos físicos; regra `usageDaily` no servidor | **ativação**: com atraso grande, o teto macio passaria do limite sem ninguém ver | `ATIVACAO_TETO_GRUPO_C4B = false`; o admin recusa publicar `ativo` sem a medição; o consumidor confere de novo |
| **Recusa por peso de PR (C4)** | admissão com piso de memória, métrica gravada em cada reserva (ponto de coleta) | `admissao-local` (`c4.md`) | memória real dos processos por ambiente (desktop e Termux) e teste do peso como preditor | **implementação da regra**: não se inventa correlação; sem dado, não existe regra a implementar | a admissão só usa o piso de memória; peso só ordena, nunca recusa |
| **Afinidade de colocação (C7)** | preferência com prazo usada só pela transferência voluntária | `sync-transferencia` (`c7b.md`) | frequência real de troca de dono no mesmo head (operação real da C5 e da C6) | **implementação da heurística**: sem a frequência, qualquer prazo seria chute | a colocação só prefere um aparelho quando a transferência pede, por 10 minutos, e nunca segura o item para aparelho inelegível |


## Observação de instabilidade na suíte (16/09/2026)

Três vezes hoje, uma rodada de `npm test` disparada **logo depois de um merge**, com a máquina ainda ocupada, terminou com UMA falha que não se repete. O sintoma é sempre o mesmo: o arquivo inteiro aparece como `✖`, **sem nenhum caso reprovando dentro dele**, e a contagem total fica menor que a normal (um arquivo não terminou). Foram arquivos diferentes (`sync-manual`, `sync-chaveiro`), e rodando o arquivo sozinho e a suíte de novo dá verde. A leitura mais provável é contenção (o `npm test` roda os arquivos em paralelo, e `sync-chaveiro` faz `scrypt` de verdade), somada ao `--test-force-exit` do script.

**Medição de 16/09/2026, com a suíte já maior (C7b).** A falha passou a aparecer em cerca de 1 rodada a cada 3 ou 4, sempre num arquivo diferente e sempre sem nenhum caso reprovando dentro dele. Limitar a concorrência do runner reduziu, mas NÃO eliminou: com `--test-concurrency=4` foram 3 rodadas verdes; com 8, quatro verdes e uma com o mesmo sintoma; com o padrão (32 na máquina), três rodadas seguidas verdes logo depois. Como o tempo dobra com concorrência 4 e o defeito não some, a configuração do `npm test` fica como está. O critério de verde continua o mesmo: só vale a rodada completa sem falha e sem cancelado, e uma rodada com esse sintoma é REFEITA, nunca declarada verde.

**Não está fechado**, e por isso fica escrito: se voltar FORA dessa condição (sem merge antes, máquina ociosa), é defeito e merece investigação própria. O primeiro passo barato seria rodar a suíte com `--test-concurrency=1` na hora em que acontecer: se sumir, é contenção; se ficar, é defeito de verdade.

**Causa medida na C5d (16/09/2026).** O quarto episódio (`sync-device-status`, logo depois do merge da C5d) foi reproduzido rodando o arquivo 24 vezes em paralelo com o repórter TAP: uma das execuções saiu com `exitCode: 3221226505` (0xC0000409, encerramento nativo do processo Node no Windows) em cerca de 340 ms, antes de qualquer caso rodar. Outras 24 execuções paralelas do mesmo arquivo e 36 de três outros arquivos não repetiram. Não é asserção de teste nem estado vazando entre casos: é o processo filho morrendo na partida, sob carga, no Node v24.15.0. A suíte refeita em seguida deu 3681 testes e 0 falhas. Fica registrado como limite do ambiente, e o critério segue o mesmo: só vale como verde a rodada completa sem falha.

### Instabilidade da suíte, 16/09/2026 à tarde (medição com código de saída)

Rodadas completas guardadas no scratchpad da sessão (`suite-*.txt` e `instab/`), com o código
de saída de cada uma. O que foi medido, sem repetir até dar verde:

| Rodada | Concorrência | Resultado |
|---|---|---|
| gate da A2 (tela), 1ª | padrão (32) | `rc=1`: `sync-desbloqueio` inteiro falhou, nenhum caso reprovado |
| TAP completa | padrão (32) | `rc=1`: `sync-pushback-remoto` inteiro falhou com `exitCode: 3221226505` (`0xC0000409`) aos 1057 ms |
| `sync-desbloqueio` isolado | 1, oito vezes em série | 8 de 8 com `rc=0` |
| `sync-desbloqueio` isolado | 16 processos em paralelo | 16 de 16 com `rc=0` |
| só `test/sync-*.test.js` (91 arquivos) | padrão, quatro vezes | 4 de 4 com `rc=0`, nenhuma queda |
| completa, TAP | 16, duas vezes | 2 de 2 com `rc=0`, nenhuma queda |
| gate da A2 (tela), 2ª; gates das fatias seguintes | padrão (32) | `rc=0` |

**Leitura:** o processo filho do Node é abortado pelo próprio runtime (`0xC0000409`, encerramento
por falha rápida) em arquivos diferentes a cada vez, sem asserção envolvida, e só com a suíte
inteira na concorrência padrão desta máquina (32). Isolado, em paralelo com ele mesmo, ou no
subconjunto de sincronização, não reproduziu. Com concorrência 16, duas rodadas limpas: é indício
de contenção, não prova. Não foi achado recurso local sem encerramento: os dois arquivos que
caíram encerram servidor e duplos no `after`, e o arquivo cai antes de relatar qualquer caso.

**Impacto:** uma rodada completa pode sair `rc=1` sem defeito de código. O critério continua o
mesmo: a rodada que falhou fica guardada e é contada, o arquivo é rodado isolado, e a suíte é
refeita uma vez; persistindo, é defeito e vira investigação própria. **Fica em aberto:** confirmar
com mais rodadas se limitar a concorrência do `npm test` elimina a queda (decisão do dono, porque
dobra o tempo da suíte).

## Bloqueios

| Entrega | Causa | Evidência | Tentado | Condição para continuar |
|---|---|---|---|---|
| A1, item 1: estimativa da SAÍDA de tentativa interrompida | a medição (A1b, três sessões autorizadas, lote esgotado) provou a duplicação e a corrigiu, mas mostrou que o stream sem mensagens parciais não traz o total de saída antes do fim; validar `thinking_tokens` como estimativa exige mais sessões | `evidencias-execucao/a1b.md` | três sessões reais | nova autorização de sessões, se o dono quiser essa estimativa |
| A4, exigência automática validada | Termux real | spec 7.A4 | não se aplica | aparelho |

## Validações externas pendentes

Tipos de impedimento, sem misturar: **(A)** autorização esgotada ou ausente; **(C)** CLI ou
ferramenta não instalada nesta máquina, e instalar exige autorização; **(L)** autenticação
pendente do dono; **(F)** ambiente físico indisponível (aparelho, segundo aparelho real);
**(P)** ação de produção não autorizada (publicar regras, projeto real, release).

| Entrega | Evidência que falta | Ambiente ou acesso | O que isso bloqueia | Roteiro pronto | Guarda que impede uso prematuro | Tipo |
|---|---|---|---|---|---|---|
| C1, C2a, C2b, C3a, C3b | comportamento das regras v2 no servidor (itens 1 a 42) | emulador do Firebase (Java e `firebase-tools` ausentes; baixar imagem ou instalar não autorizado) e projeto real | publicar as regras v2 e ligar compartilhamento em produção | `firebase/README.md`, itens 1 a 42 | sonda de regras recusa conectar com regra v1; compartilhamento nasce desligado | C, P |
| C1, C2a, C2b | publicação das regras v2 no console | console do Firebase, pelo dono | toda a trilha C em produção | `firebase/README.md` | idem | P |
| C1 | custo do `scrypt` no Termux | aparelho Android com Termux | calibrar o custo da KEK no celular | `docs/superpowers/handoff/.../roteiros/` (medição manual) | custo cai para N=8192 acima de 3 s | F |
| A4 | detecção do modo, navegador do aparelho e alcance do loopback num Termux real | aparelho | ligar `ATIVACAO_AUTOMATICA_A4` | tela de pareamento pronta; `node tools/farol-parear.js` | `ATIVACAO_AUTOMATICA_A4 = false`, travada em teste; C3 bloqueada no celular sem exigência | F |
| C4 | memória real por ambiente e o peso do PR como preditor | execuções reais por ambiente | recusa por peso; revalidar o piso de 1024 MB | `evidencias-execucao/c4.md` | a admissão só usa o piso; peso só ordena | F |
| C4b | atraso real do consumo entre dois aparelhos | dois aparelhos físicos e banco | ativar o teto do grupo | `evidencias-execucao/c4b.md` | `ATIVACAO_TETO_GRUPO_C4B = false`; admin recusa publicar `ativo` sem medição | F, P |
| C3b | latência real do andamento entre aparelhos | dois aparelhos físicos | nenhuma ativação; qualidade da visão | `firebase/README.md`, item 26 | nenhuma necessária | F |
| A1 | estimativa da saída de tentativa interrompida | novas sessões reais de modelo | a estimativa de saída (o resto da A1 está provado) | `evidencias-execucao/a1b.md` | a linha interrompida diz "custo desconhecido" | A |
| A3 | sessão real de diagnóstico no Claude, confirmando só Read, Grep e Glob e nenhum hook ou plugin | nova sessão real de modelo | nada: a linha de comando está provada | `verificacoes-a-b-c.md`, seção B | as flags de leitura são fixas e testadas | A |
| A3 | sessão real de diagnóstico no Codex, confirmando que `--sandbox read-only` recusa escrita | máquina com o Codex CLI | nada no Claude; o diagnóstico com Codex fica só com o argumento provado | idem | argumento emitido e testado | C, A |
| A2 | `claude auth status --json` com login ativo, para conferir o campo de e-mail | assinatura logada numa pasta de teste | nada: sem e-mail no status, a tela cai para o e-mail do arquivo, marcado como detectado | `a2.md`, seção 5 | origem de cada campo na tela | L |
| C1a | `Origin` real do Chromium na janela do Electron | CI com Electron, na publicação | release | job `electron` do CI | allowlist ativa por padrão | P |
| C0b | ajustar `POSTAGEM_COORDENADA_DESDE` para a versão publicada | PR de release | release | `EXECUCAO.md`, deploy | constante travada em teste | P |
| Pacote | segredo quebrado em duas linhas, formatos fora do padrão, segredo em binário comprimido | não se aplica: limite conhecido do detector | nada; registrado | `verificacoes-a-b-c.md`, seção C | o pente cobre os seis formatos provados | limite |
| Perfil (A2) | `chmod 0700` da cópia efêmera e a varredura em POSIX | contêiner com `claude` falso no PATH do sistema | nada no Windows (provado); POSIX pendente | `validacao-posix.md`, segunda rodada | cópia apagada no `finally`, varredura das velhas | C |

**Já provado localmente, fora desta lista:** modo 0600 dos caches e o ramo POSIX da A1
(contêiner Linux, `validacao-posix.md`); o viewport estreito nunca vale como Android ou Termux.

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
| merges `ed125e7`, `17ac164`, `8c1773e`, `f9f00a0` | `md/integracao` | adendo: A1b, brief B2, A4b e contrato das telas |
| `a9ccced`, merge `d3e5b9d` | `md/a3` | A3: Markdown único e inerte do diagnóstico, rota, renderização inerte, sessão de IA somente leitura nos dois provedores, prompt do workspace reescrito e ressincronizado, botões que dizem o efeito |
| `6eff2d5`, merge `c3abd65` | `md/a2` | A2: regra única de perfil utilizável, problemas de perfil no snapshot e no Diagnóstico, teste explícito com origem por campo, adoção guiada com confirmação literal, selo atualizado no fim do login nos três sistemas |
| `ec8a5c0`, merge `d24ccbd` | `md/capacidades` | estados de indisponibilidade: retrato no engine, cartão na tela, nada ligado |
| `5173a35`, merge `3903e49` | `md/jornada` | jornada integrada: o bloqueio passa a provar o pedido, e a guarda do celular deixa de apagar a escolha no disco |
| `5f04766`, merge `443c91b` | `md/empacotamento` | auditoria do pacote por forma de segredo, com teste que lê o padrão do próprio empacotador |
| `3ec5d10`, merge `6eb2232` | `md/reconcilia-main` | reconciliação com a `main` `dde2ac1`: transporte da A4 em `ui/telas/infra.js`, textos da C0 nas telas, apagão remoto fora de `ui/telas/sistema-sync.js`, retomada durável portada para `docs/REVIEW-GATES.md`; três testes passaram a ler o bootstrap e todas as telas (`settings-ignoradas`, `sync-sem-apagao`, `ui-transporte-app`), com a mesma garantia |
| `285bcad` | `md/integracao` | desenho B2: fonte dos 16 quadros e o canvas publicado no Claude Design |
| `1457eb1`, `7b44b13`, `b2054ac`, `7333ca3`, merge `7bde756` | `md/verificacoes` | verificações A, B e C: cópia efêmera no teste de perfil, sessão de leitura sem hooks nem plugins, varredura de credencial em todo arquivo do pacote |
| `223f28d`, `c4a3817`, merge `cf5cdac` | `md/a4-tela` | A4 na tela: pareamento no lugar da interface inteira, e o stream aberto que não sobrevive à própria credencial |
| `f973465`, merge `285e8c6` | `md/a3-tela` | A3 na tela: falhas registradas com a ação sugerida, e um texto só para tela e sessão |
| `62ce3f6`, merge `e9f8183` | `md/a2-tela` | A2 na tela: testar o perfil, origem de cada campo, aviso do perfil quebrado e varredura das cópias efêmeras |
| `bb51db8`, merge `85bf7fc` | `md/sync-tela` | C1 na tela: compartilhar e distribuir, cartão da chave do conjunto, e o pedido que sobrevive à guarda do celular |
| `a576729`, `0c6cc38` | `md/integracao` | medição da queda nativa da suíte e a tabela de pendências externas por tipo de impedimento |
| `73eb777`, `89b4603`, `bc54fcc`, `2778e60`, `15ce282`, `51229f0`, merge `3cfe582` | `md/tela-radar` | visão compartilhada no Radar: prazo gravado no nó, puras, tela, reforço das contraprovas inertes e evidência |
| `957a10b`, `eff62b4`, `c4438a3`, `b0f5592`, `2b50ed3`, merge `4158305` | `md/tela-aparelhos` | Aparelhos e Grupos de consumo: puras, seções no Sistema, reforço das travas inertes e evidência |
| `d5021ab`, `984c60b` | `md/integracao` | memória livre fixa nos testes de admissão, e a jornada na versão integrada |


## Deploy e notas de versão propostos (16/09/2026)

Nada disto foi executado: publicar release, mexer no Firebase real e instalar no Farol em
uso são atos do dono.

### Versão

**v2.60.0** (minor). É funcionalidade nova, compatível com quem não liga nada: com
`sync.enabled` desligado o comportamento é o de sempre, e cada capacidade nova tem
interruptor próprio.

### Ordem do deploy

1. **Publicar as regras do banco ANTES do app.** `firebase/database.rules.json` (gerado;
   nunca editar à mão) no console do projeto pessoal, e depois o roteiro manual do
   `firebase/README.md`, itens 1 a 42. As regras novas negam o que o app antigo não
   escreve, então publicá-las antes é seguro; publicar o app antes delas faria os nós
   novos serem recusados em silêncio.
2. **Gate completo na máquina do dono:** `npm run check && npm run lint && npm test`, e
   `npm run eng` antes do push (ele exige as avaliações escritas do diff, uma por regra de
   julgamento acionada; sem elas o pre-push reprova).
3. **Versão e pacote:** `npm version 2.60.0` (ou editar `package.json`), gerar o pacote
   leve e o instalador (`tools/make-package.ps1`, `tools/make-installer.ps1`) e publicar
   com `tools/publish-release.ps1`.
4. **Instalar em UM aparelho primeiro** e conferir a aba Sistema: aparelhos com a versão
   nova, coordenação e chave do conjunto.
5. **Ligar os interruptores em ordem, um por vez, medindo entre eles:** coordenação →
   compartilhamento cifrado → consolidação de consumo → distribuição. Cada um só faz
   sentido com o anterior ligado, e a tela diz o que falta.

### O que NÃO liga sozinho (proteções declaradas)

- **Teto do grupo de consumo:** `ATIVACAO_TETO_GRUPO_C4B` nasce `false`. Só ligar depois
  de medir o atraso do consumo entre dois aparelhos reais.
- **Exigência de autenticação local no modo celular:** `ATIVACAO_AUTOMATICA_A4` nasce
  `false` até existir a tela de pareamento e a validação num Termux real.
- **Recusa por peso de PR (C4):** depende da medição de memória em execuções reais.
- **Afinidade de colocação (C7):** depende da medição de troca de dono no mesmo head.

### Notas de versão (rascunho para a release)

**Farol v2.60.0, operação multidispositivo**

- **Um conjunto de aparelhos, não vários Faróis soltos.** Presença, capacidade e catálogo
  cifrados; cada aparelho enxerga o que os outros estão fazendo, sem o PR aparecer em
  claro no banco.
- **Revisão distribuída (opcional).** Com a distribuição ligada, o admin coloca cada
  revisão no aparelho com vaga, respeitando o rodízio por organização. Quando o admin
  some, cada aparelho volta sozinho ao modo local, com atraso próprio para a frota não
  disparar junta.
- **Nada é postado sem gate, como sempre.** O que chega pelo banco só restringe: comando
  ou atribuição remota nunca vira clique manual nem revisão pedida a você.
- **Teto de gasto do conjunto (desligado nesta versão).** Rollup diário por grupo, reservas
  de todos os aparelhos e "não verificável" quando o conjunto não fecha, esperando sem
  estacionar. A ativação espera uma medição.
- **Comandos remotos com recibo.** Cancelar, repetir, decidir e postar, iniciar em outro
  aparelho e designar admin (esta última exige a senha digitada no destino). Sucesso só
  existe quando o aparelho alvo responde.
- **Memória de verificação compartilhada.** O que uma sessão confirmou contra o código
  viaja cifrado, e quem pega o PR depois não refaz o que já foi feito.
- **Transferência voluntária e tomada forçada.** Transferir exige destino apto e com
  credencial; tomar exige confirmação e explica o risco: o processo do outro aparelho não
  é encerrado, e a análise pode custar duas vezes.
- **Autenticação local no modo celular** e **retomada durável de sessão interrompida**.
- **Consumo fiel:** custo desconhecido aparece como desconhecido, nunca como zero.
- **Na tela de Sistema, cada aparelho mostra a versão do Farol que está rodando.**

### Depois do deploy, o que fica pendente

Telas das capacidades novas (Claude Design), as quatro medições acima e a reconciliação
desta linha com a `main` (a base desta execução é `8c043bc`; a `main` está em `b0911b1`).

## Próxima ação concreta

Código e telas da iniciativa estão integrados em `md/integracao`, com gate completo e
`npm run eng` verdes. Nada foi empurrado. O que falta está em "Validações externas
pendentes", cada item com o tipo de impedimento, e depende do dono:

1. decidir o push da branch e a abertura do PR (fora da autorização);
2. publicar as regras v2 no console do Firebase, ou autorizar a instalação do emulador para
   rodar os itens 1 a 42 do `firebase/README.md` localmente;
3. autorizar as sessões reais de modelo que faltam (diagnóstico no Claude e no Codex, a
   estimativa da saída interrompida da A1);
4. rodar os roteiros de aparelho físico (Termux, dois aparelhos);
5. reconfigurar a sincronização real depois do incidente registrado acima.
