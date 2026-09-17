# C3a Presença v2, capacidade do aparelho e catálogo cifrado: plano de implementação

> **Ajustes de execução (15/09/2026):** worktree `C:\Users\wanderson\Documents\farol-md-exec`; branch `md/c3a` cortada da ponta de `md/integracao` (com C1a, C0, A5, A1, A4, C0b, C1, C2a e C2b). Sem `git fetch`/`merge origin/main`. Evidência em `docs/superpowers/handoff/2026-09-15-operacao-multidispositivo/evidencias-execucao/c3a.md`.

> **Para quem executa:** use superpowers:executing-plans, tarefa por tarefa.

> **Densidade declarada:** interfaces exatas e lista de casos obrigatórios, não o código de teste linha a linha. Caso que não puder ser provado como descrito é REGISTRADO na evidência, nunca apagado.

> **Regra de execução herdada:** o script de contraprova muta o arquivo no disco. Contraprova e suíte sempre em série, nunca em paralelo.

**Por que a 7.C3 é dividida.** A entrega 7.C3 da spec cobre sete assuntos que produzem software testável sozinhos: presença v2 e catálogo, andamento ao vivo, pendências e visto, história de revisões, Panorama e Meus PRs, memória de pushback e envio do histórico local. Um plano só seria grande demais para revisar, e a divisão segue o que já foi feito com a 7.C2. Esta é a **C3a**, e ela é a base: entrega o gate que decide se vale publicar alguma coisa, o que este aparelho consegue fazer, e o catálogo que nomeia um PR em qualquer aparelho. As outras seis dependem dela.

**Objetivo:** publicar, cifrado, a capacidade deste aparelho e o catálogo de PRs, só quando existe outro aparelho da v2 pronto para ler, e só quando o conteúdo mudou.

**Arquitetura:** duas folhas novas em `lib/sync/` (`frota.js`, `catalogo.js`) e um módulo de fiação em `lib/engine/` (`sync-publicacao.js`). O envelope, as tags e o nó assinado já existem (C1 e C2).

**Spec:** `docs/superpowers/specs/2026-09-15-operacao-multidispositivo-design.md`, seções 5 (CT-COMPAT, CT-ENV, CT-LEITURA) e 7.C3. Detalhe normativo no anexo C1, "Nós do banco" (`devices`, `live/deviceStatus`, `catalog`).

## Constraints globais

- **Zero dependências novas.** Texto e comentários em português, sem travessão.
- **Nada muda com o compartilhamento desligado.** `sync.shared.enabled` falso: presença byte a byte igual à de hoje, nenhum `contract`, nenhum `keyReady`, nenhuma escrita de `deviceStatus` ou `catalog`.
- **O GATE DE PUBLICAÇÃO é a regra central desta entrega:** só se publica conteúdo compartilhado quando existe **outro** aparelho com `contract === 2`, `keyReady === true` e `lastSeenAt` dentro de **24 h**. Sem ninguém para ler, escrever é gasto de cota e superfície de dado sem leitor. A spec exige o gate para andamento ao vivo e Panorama; **esta entrega aplica o mesmo gate a `deviceStatus` e ao catálogo, por decisão registrada**, porque o motivo é o mesmo.
- **`contract` e `keyReady` são de quem se descreve.** Cada aparelho escreve só o próprio nó. `keyReady` é "o material da chave está aberto NESTA sessão", nunca uma promessa sobre o futuro.
- **Só quando muda.** `deviceStatus` e cada linha do catálogo só sobem quando o TEXTO CLARO muda, medido por um resumo local do claro. Sem isso, o tick de presença reescreveria tudo a cada cinco minutos, cifrando de novo (IV novo a cada escrita, então o ciphertext sempre difere e o banco nunca deduplica sozinho).
- **O catálogo é regenerável.** Perder o catálogo custa um nome na tela, nunca um dado de decisão. Ele nunca é fonte de verdade para gate, postagem ou fila.
- **Nada em claro.** `catalog` e `deviceStatus` carregam só `v`, `u` e `enc` em claro; título, autor, repo, número e nome do aparelho vão dentro do envelope.
- **Leitura falha fechada.** Item que não decifra é descartado inteiro e some da tela; nunca vira texto parcial nem placeholder com dado de outro item.
- **O ratchet não pode subir.** Lógica nova nasce em módulo próprio.
- **Nenhum teste existente é enfraquecido**, e todo ajuste é declarado na evidência.
- **Nada toca `~/.farol` real, GitHub real ou Firebase real.** Nenhuma regra é publicada.

---

## Mapa de arquivos

| Ação | Caminho |
|---|---|
| criar | `lib/sync/frota.js` (quem está na frota v2, PURO), `lib/sync/catalogo.js` (forma da linha do catálogo e o resumo do claro, PURO) |
| criar | `lib/engine/sync-publicacao.js` (o gate e as duas publicações) |
| criar | `test/sync-c3a-desligado.test.js`, `test/sync-frota.test.js`, `test/sync-catalogo.test.js`, `test/sync-device-status.test.js`, `test/sync-catalogo-remoto.test.js` |
| editar | `lib/engine/sync.js` (presença ganha `contract`/`keyReady` só com o compartilhamento ligado; fachadas), `server.js` |
| editar | `lib/sync/limpeza.js` (as categorias novas entram JUNTO com a regra de remoção delas) |
| editar | `firebase/database.rules.template.json` e o gerado; `test/sync-rules-contrato.test.js` |
| editar | `CLAUDE.md`, `firebase/README.md` |

---

## Tarefa 0: preparação e gate de partida

- [ ] **Passo 1:** `git checkout md/integracao && git checkout -b md/c3a`; `git status --short` vazio.
- [ ] **Passo 2:** `npm run check && npm run lint && npm test` verdes; anote os números.
- [ ] **Passo 3:** confirme as peças que esta entrega consome:

```bash
grep -n "function cifrar" lib/sync/envelope.js
grep -n "function prTag" lib/sync/tags.js
grep -n "function presencaDe" lib/engine/sync.js
grep -n "CATEGORIAS" lib/sync/limpeza.js
```

---

## Tarefa 1: caracterização do desligado

**Arquivo:** criar `test/sync-c3a-desligado.test.js`, que **nasce verde** contra o código de hoje.

- [ ] **Passo 1:** escrever os casos:
  - com `sync.shared.enabled` falso, o corpo da presença é **exatamente** `{name, platform, farolVersion, lastSeenAt}` (compare o objeto inteiro, não campo a campo: campo novo tem que reprovar);
  - com o compartilhamento desligado, nenhuma escrita em `live/deviceStatus` nem em `catalog` sai num ciclo completo;
  - com o compartilhamento LIGADO e nenhum outro aparelho v2 visto, também não sai nenhuma dessas escritas (é o gate, e ele precisa existir antes de a publicação existir);
  - nenhum arquivo novo em `state/` ou em `~/.farol`.
- [ ] **Passo 2:** rodar; verde contra o código atual.
- [ ] **Passo 3:** commit.

---

## Tarefa 2: quem está na frota v2

**Arquivos:** criar `lib/sync/frota.js` (PURO) e `test/sync-frota.test.js`.

**Interface:**
- `CONTRATO = 2`.
- `aparelhoV2(d, { agora, janelaMs })` → `true` só com `contract === 2`, `keyReady === true`, `retiredAt` ausente ou zero e `lastSeenAt` dentro da janela.
- `outrosV2(devices, { meuId, agora, janelaMs })` → lista dos ids de OUTROS aparelhos que passam.
- `valePublicar(devices, ctx)` → `outrosV2(...).length > 0`.
- `JANELA_PADRAO_MS` = 24 h, de `lib/constants.js`.

- [ ] **Passo 1:** escrever o teste que falha, com os casos:
  - aparelho com contrato 1, ou sem `keyReady`, não conta (um caso por motivo, e o motivo no nome do caso);
  - aparelho visto há 25 h não conta; há 23 h conta;
  - **o próprio aparelho nunca conta**: uma frota só com ele não vale publicar (é o caso que impede o Farol de publicar para si mesmo para sempre);
  - aparelho **aposentado** não conta, mesmo visto agora;
  - `lastSeenAt` no futuro (relógio adiantado do outro) conta como visto, e não quebra a janela;
  - entrada malformada (não objeto, `contract` texto) não conta e não lança.
- [ ] **Passo 2:** rodar; `Cannot find module`.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** rodar; verde.
- [ ] **Passo 5 (contraprova):** (a) deixe o próprio aparelho contar: reprova; (b) tire a exigência de `keyReady`: reprova; (c) troque a janela por infinita: reprova; (d) aceite aposentado: reprova.
- [ ] **Passo 6:** commit.

---

## Tarefa 3: a presença declara contrato e chave pronta

**Arquivos:** editar `lib/engine/sync.js` (só `presencaDe` e o que ela precisa); teste em `test/sync-frota.test.js` ou arquivo próprio de presença.

- [ ] **Passo 1:** escrever o teste que falha:
  - com o compartilhamento LIGADO, a presença leva `contract: 2` e `keyReady` refletindo `rt.material`;
  - com o compartilhamento DESLIGADO, o corpo é o de hoje, comparado por igualdade de objeto (este caso já existe na Tarefa 1 e continua valendo);
  - `keyReady` é `false` enquanto a chave não abriu, e vira `true` depois do desbloqueio, **no mesmo ciclo** (a presença não pode anunciar chave pronta por otimismo);
  - `lastSeenAt` continua sendo o sentinela do servidor.
- [ ] **Passo 2:** rodar; reprova.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** rodar; verde.
- [ ] **Passo 5 (contraprova):** (a) publique `keyReady: true` fixo: reprova; (b) publique `contract` com o compartilhamento desligado: reprova o caso da Tarefa 1.
- [ ] **Passo 6:** commit.

---

## Tarefa 4: capacidade do aparelho, cifrada e só quando muda

**Arquivos:** criar `lib/engine/sync-publicacao.js`; teste em `test/sync-device-status.test.js`.

**Conteúdo do claro** (anexo C1): nome escolhido, contas cobertas (`acctTag`), token presente, IA pronta, paralelismo efetivo, RAM livre resumida, `aceitarAdmin` (espelho informativo) e `keyReady`. **Nunca** login em claro, caminho de diretório, hostname ou credencial.

**Interface:**
- `capacidadeDe(engine, cfg)` → o objeto do claro, PURO o suficiente para ser testado sem rede.
- `publicarCapacidade(engine, cfg)` → publica `live/deviceStatus/{deviceId}` = `{v, u, enc}`, **só** se `valePublicar` e se o resumo do claro mudou desde a última publicação desta sessão.

- [ ] **Passo 1:** escrever o teste que falha:
  - sem outro aparelho v2, nenhuma escrita (afirme sobre `fake.requests`, não só sobre a árvore);
  - com outro aparelho v2, sobe `{v, u, enc}` e o `enc` tem forma de envelope;
  - **o login da conta não aparece em claro no banco** (varra a árvore inteira pelo texto);
  - publicar duas vezes sem mudança faz **uma** escrita só;
  - mudar o paralelismo efetivo faz a segunda escrita sair;
  - a chave que fecha e reabre muda `keyReady` e publica de novo;
  - o claro não contém hostname nem caminho de diretório (varredura por `os.hostname()` e por separador de caminho).
- [ ] **Passo 2:** rodar; reprova.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** rodar; verde.
- [ ] **Passo 5 (contraprova):** (a) tire o gate: reprova o caso das zero escritas; (b) tire o "só quando muda": reprova o caso da escrita única; (c) inclua o login no claro: reprova.
- [ ] **Passo 6:** commit.

---

## Tarefa 5: catálogo cifrado de PR

**Arquivos:** criar `lib/sync/catalogo.js` (PURO) e completar `lib/engine/sync-publicacao.js`; testes em `test/sync-catalogo.test.js` (puro) e `test/sync-catalogo-remoto.test.js` (com o dublê).

**Interface pura:**
- `linhaDoCatalogo(pr)` → `{ key, url, title, author, repo, number, isDraft }`, com allowlist e truncamento do título.
- `resumoDaLinha(linha)` → resumo estável do claro (o `ctag`), para decidir se mudou. **Estável entre execuções** e **independente da ordem das chaves**.

**Interface de engine:**
- `publicarNoCatalogo(engine, cfg, prs)` → escreve `catalog/{prTag}` = `{v, u, enc}` só para as linhas cujo resumo mudou, e só com `valePublicar`.
- `lerDoCatalogo(engine, cfg, prTag)` → GET pontual, decifra, devolve a linha ou `null`; LRU de 500 em memória.

- [ ] **Passo 1 (puro):** escrever o teste que falha:
  - a linha leva só os sete campos, e campo desconhecido do PR é descartado;
  - título gigante é truncado, e o truncamento é estável;
  - o resumo **não muda** quando só a ordem das chaves muda;
  - o resumo **muda** quando o título muda;
  - o resumo é estável entre execuções (calcule duas vezes, em processos diferentes do teste, ou afirme contra um valor fixo).
- [ ] **Passo 2 (remoto):** escrever o teste que falha:
  - sem outro aparelho v2, nenhuma escrita;
  - com outro aparelho, sobe uma linha por PR, e o TÍTULO não aparece em claro no banco;
  - republicar os mesmos PRs não escreve de novo;
  - mudar o título de um PR escreve **só a linha dele**;
  - `lerDoCatalogo` devolve a linha decifrada, e a segunda leitura não faz GET (LRU);
  - linha que não decifra (chave de outra época) devolve `null`, e não derruba as outras;
  - o catálogo nunca é consultado por caminho de decisão: uma varredura do fonte prova que `lib/engine/decision.js` e `lib/engine/review.js` não importam o catálogo.
- [ ] **Passo 3:** rodar; reprova.
- [ ] **Passo 4:** implementar.
- [ ] **Passo 5:** rodar; verde.
- [ ] **Passo 6 (contraprova):** (a) tire o gate; (b) tire o "só quando muda"; (c) faça o resumo depender da ordem das chaves: reprova o caso da ordem; (d) faça a leitura devolver a linha crua sem decifrar: reprova.
- [ ] **Passo 7:** commit.

---

## Tarefa 6: regras v2 dos nós novos

**Arquivos:** editar `firebase/database.rules.template.json`, regerar, editar `test/sync-rules-contrato.test.js` e `lib/sync/limpeza.js`.

- `devices/$device`: acrescentar `.validate` em `contract` (número) e `keyReady` (booleano), **sem tocar** nas validações de hoje dos outros campos (regra de ouro dos nós legados);
- `live/deviceStatus`: `.write` de remoção no pai (`@LIMPA@`), e `$dev`: `@U@ && @H(['v','u','enc'])@ && @ENC(2048)@`;
- `catalog`: `.write` de remoção no pai (`@LIMPA@`), e `$pr`: `@U@ && @H(['v','u','enc'])@ && $pr.matches(/^[0-9a-f]+$/) && @ENC(2048)@`.

- [ ] **Passo 1:** template e `npm run sync:rules`.
- [ ] **Passo 2:** um caso por nó novo no `test/sync-rules-contrato.test.js`, e **atualize as duas listas** (nós com concessão e filhos de `live`).
- [ ] **Passo 3:** acrescentar `live/deviceStatus` e `catalog` a `CATEGORIAS` em `lib/sync/limpeza.js`, **junto** com a regra de remoção, e um caso no `test/sync-limpeza-ato.test.js` provando que as duas somem no caminho feliz.
- [ ] **Passo 4:** rodar `sync-rules-contrato`, `sync-escritas-v1`, `sync-limpeza-ato`, `sync-limpeza-chave`; verdes.
- [ ] **Passo 5 (contraprova, manual e com regeneração):** tire o `$pr.matches(...)` do catálogo, regere e rode: reprova o caso do catálogo. Restaure, regere, verde.
- [ ] **Passo 6:** commit.

---

## Tarefa 7: documentação, gate e evidência

- [ ] **Passo 1:** `CLAUDE.md`: uma linha por módulo novo, dizendo o que decide e o que nunca faz.
- [ ] **Passo 2:** `firebase/README.md`: itens de `deviceStatus` e `catalog` no roteiro manual (forma, teto do envelope, remoção pela limpeza) e o `contract`/`keyReady` na presença.
- [ ] **Passo 3:** `npm run check && npm run lint && npm test`; `node tools/sync-rules.js --check`.
- [ ] **Passo 4:** conferir `git diff --name-status md/integracao...HEAD -- test/`: só `A`, fora os ajustes declarados.
- [ ] **Passo 5:** escrever `evidencias-execucao/c3a.md` e atualizar o `EXECUCAO.md`.
- [ ] **Passo 6:** commit e merge em `md/integracao`, com o gate verde nos dois lados e a identidade da árvore conferida.

---

## Critérios de aceite da spec x testes

| Critério (7.C3, CT-COMPAT, CT-LEITURA) | Teste |
|---|---|
| Sem outro aparelho v2, zero escritas de conteúdo compartilhado | `sync-c3a-desligado`, `sync-device-status`, `sync-catalogo-remoto` |
| Compartilhamento desligado: presença byte a byte igual | `sync-c3a-desligado` (igualdade de objeto) |
| `contract` e `keyReady` descrevem só o próprio aparelho | `sync-frota`, `sync-device-status` |
| Catálogo nomeia PR em qualquer aparelho, cifrado | `sync-catalogo-remoto` |
| Catálogo é regenerável e nunca decide nada | `sync-catalogo-remoto`: varredura do fonte |
| Só escreve quando o texto claro muda | `sync-device-status`, `sync-catalogo-remoto` |
| Leitura falha fechada | `sync-catalogo-remoto`: linha de outra época |
| A limpeza alcança os nós novos | `sync-limpeza-ato`, `sync-rules-contrato` |

## Limites declarados

- **Andamento ao vivo, pendências, história, Panorama, pushback e envio do histórico são as C3b a C3g.** Aqui nasce só o gate, a capacidade e o catálogo.
- **O gate é por presença, não por prontidão.** Prontidão do distribuidor é CT-PRONT, da C5.
- **Telas são do Claude Design**, em tarefa própria.
- **O banco não verifica criptografia**, como nas entregas anteriores.
