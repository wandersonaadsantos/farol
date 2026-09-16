# C2b Grupo de consumo, gestão de aparelho, limpeza protegida e revogação: plano de implementação

> **Ajustes de execução (15/09/2026):** worktree `C:\Users\wanderson\Documents\farol-md-exec`; branch `md/c2b` cortada da ponta de `md/integracao` (com C1a, C0, A5, A1, A4, C0b, C1 e C2a). Sem `git fetch`/`merge origin/main`. Evidência em `docs/superpowers/handoff/2026-09-15-operacao-multidispositivo/evidencias-execucao/c2b.md`.

> **Para quem executa:** use superpowers:executing-plans, tarefa por tarefa.

> **Densidade deste plano, declarada.** Como no C2a: interfaces exatas e **lista de casos obrigatórios**, não o código de teste linha a linha. Quem executar escreve o teste de cada caso listado e, se um caso não puder ser provado como descrito, registra isso na evidência **em vez de apagar o caso**.

> **Regra de execução herdada da C2a:** o script de contraprova **muta o arquivo no disco**. Nunca rode `npm test` (nem outro `node --test`) em paralelo com ele. Contraprova e suíte sempre em série.

**Por que este plano é a outra metade da 7.C2.** A 7.C2 cobre quatro assuntos independentes. O C2a entregou autoridade do admin, consentimento local e políticas. Este traz os outros três, mais a revogação, e depende da assinatura e da autoridade que nasceram lá.

**Objetivo:** configurar (sem ativar) o grupo de consumo com teto e período assinados, deixar o dono renomear e aposentar aparelhos por ato explícito, e entregar a limpeza protegida e a revogação com os limites exatos que elas têm, escritos onde a pessoa lê.

**Arquitetura:** três folhas novas em `lib/sync/` (`grupo.js`, `vinculo.js`, `limpeza.js`) e dois módulos de fiação em `lib/engine/` (`sync-grupo.js`, `sync-limpeza.js`). Nenhuma linha nova em `lib/engine/sync.js` além da fiação de fachada: ele vive no teto de 400 linhas úteis do ratchet.

**Spec:** `docs/superpowers/specs/2026-09-15-operacao-multidispositivo-design.md`, seções 5 (CT-GRUPO) e 7.C2, decisões D2, D-b e D8. Detalhe normativo no anexo C1, "Nós do banco" (`live/groups`, `live/control/cleanup`, `cleanupLock`, `lastCleanup`, `revokedBefore`), respeitando os blocos de trechos superados.

## Constraints globais

- **Zero dependências novas.** Texto e comentários em português, sem travessão.
- **Configurar não é ativar.** Nada nesta entrega barra execução. O teto do grupo aparece como "configurado, ainda não ativo" e a ativação é da C4b, que exige A1, C2, C4 e as duas definições de métrica.
- **Identidade de grupo é explícita.** O id do grupo é opaco e estável, **independente** de chave, token, nome do perfil ou caminho de diretório. **Inferência automática por hash de credencial não é implementada**, e um teste guarda essa ausência: nome igual ou caminho parecido não pré-seleciona nada.
- **Sem vínculo não é exceção.** Perfil sem grupo não participa da execução distribuída que depende do vínculo, e não é redirecionado para execução local para contornar a pendência. "Grupo configurado sem teto" e "perfil não identificado" são estados diferentes, com textos diferentes.
- **Rotação não reinicia nada.** Rotacionar a credencial do mesmo vínculo não cria grupo novo nem zera a contagem. Trocar de conta ou de grupo exige associação explícita, e o consumo já registrado **permanece no grupo em que foi feito**, com o intervalo do vínculo gravado. Nada é apagado, duplicado ou reatribuído em silêncio.
- **Métrica por tipo de perfil:** assinatura, chave de API e OpenRouter são **controlados** (custo em dólar medido ou estimado); **Codex é não controlado**, e aparece assim, nunca como consumo zero nem como orçamento protegido. Grupo que mistura os dois mostra as duas partes separadas.
- **Aposentar é ato explícito.** Ausência de presença **nunca** infere aposentadoria. Aparelho aposentado continua no histórico; aposentar não apaga dado nem revoga chave, e a tela diz isso.
- **Limpeza protegida, as cinco condições:** chave `live/control/cleanup` ligada (assinada pelo admin, **sem** senha, decisão D-b); senha real no clique em apagar; `REC` conferido pelo servidor; trava `cleanupLock` viva do próprio ato; e **nenhuma operação viva**.
- **O que a limpeza NUNCA alcança:** `keyring`, `live/control/*`, `leases`, `receipts`, `dailyRounds`. Categoria fora da allowlist não é apagada.
- **D8:** se o servidor **não conseguir** conferir senha recente, a limpeza **não é publicada**, e a saída documentada é o console do Firebase. Não existe caminho alternativo no app.
- **Revogação, três coisas diferentes, e a tela não as confunde:** acesso ao Firebase (troca de senha, que expira refresh tokens; **o ID token já emitido vale até 1 h**), autorização do aparelho (aposentar e retirar o consentimento local) e cancelamento de processos de IA (só pelo próprio aparelho, ou por comando na C6). **Não se promete cancelamento imediato nem remoção de dados e chaves que o aparelho já recebeu.** O botão "encerrar sessões dos outros aparelhos" fica fora.
- **`revokedBefore` só cresce** e só aceita valor **menor** que o `auth_time` do token do ato: o aparelho que publica não pode se cortar fora com o próprio corte.
- **O ratchet não pode subir.** Lógica nova nasce em módulo próprio.
- **Nenhum teste existente é enfraquecido.** Ajuste ligado à forma antiga é permitido preservando a garantia, e precisa ser declarado na evidência.
- **Nada toca `~/.farol` real, GitHub real ou Firebase real.** Nenhuma regra é publicada.

---

## Mapa de arquivos

| Ação | Caminho |
|---|---|
| criar | `lib/sync/grupo.js` (identidade e forma do grupo, PURO), `lib/sync/vinculo.js` (vínculo perfil→grupo, em `state/`), `lib/sync/limpeza.js` (categorias, allowlist e forma da trava, PURO) |
| criar | `lib/engine/sync-grupo.js` (publicar e ler o grupo), `lib/engine/sync-limpeza.js` (chave, trava, ato e corte) |
| criar | `test/sync-c2b-desligado.test.js`, `test/sync-grupo.test.js`, `test/sync-vinculo.test.js`, `test/sync-grupo-remoto.test.js`, `test/sync-aparelho.test.js`, `test/sync-limpeza-chave.test.js`, `test/sync-limpeza-ato.test.js`, `test/sync-revogacao.test.js` |
| editar | `lib/constants.js` (`SYNC`: arquivos e tempos novos), `lib/sync/config.js` (nada novo previsto; confirmar) |
| editar | `lib/engine/sync.js` (só fachada), `server.js`, `lib/http-server.js`, `lib/local-auth/inventario.js` |
| editar | `firebase/database.rules.template.json` e o gerado |
| editar | `CLAUDE.md`, `firebase/README.md`, `docs/CONFIGURATION.md` (o que é grupo de consumo e o que ele ainda não faz) |

**Rotas novas previstas:** `/api/sync/group` (POST, publicar o grupo), `/api/sync/link` (POST, vincular perfil), `/api/sync/device` (POST, renomear e aposentar), `/api/sync/cleanup-key` (POST, ligar e desligar a chave), `/api/sync/cleanup` (POST, o ato, recebe segredo), `/api/sync/revoke` (POST, recebe segredo). Seis rotas: o inventário da A4 vai de 48 para 54, e **cada uma precisa de classe** em `lib/local-auth/inventario.js` (`recebe-segredo` para as três últimas, `destrutiva` para o ato).

---

## Tarefa 0: preparação e gate de partida

- [ ] **Passo 1:** `git checkout md/integracao && git checkout -b md/c2b`; `git status --short` vazio.
- [ ] **Passo 2:** `npm run check && npm run lint && npm test` verdes; anote os números (a evidência compara com eles).
- [ ] **Passo 3:** confirme as peças da C2a que esta entrega consome:

```bash
grep -n "function assinar" lib/sync/assinatura.js
grep -n "function autoridadeFresca" lib/sync/autoridade.js
grep -n "aceitarPolitica" lib/engine/sync-politicas.js
grep -n "chaveServe" lib/sync/admin-chave.js
```

---

## Tarefa 1: caracterização do desligado

**Arquivo:** criar `test/sync-c2b-desligado.test.js`. **Este teste nasce verde contra o código de hoje** e continua verde no fim: é ele que prova que nada desta entrega muda o comportamento de quem não ligou nada.

- [ ] **Passo 1:** escrever os casos:
  - com `sync.shared.enabled` falso, publicar grupo, ligar a chave de limpeza, apagar e revogar recusam **sem tocar rede** (`fake.requests` vazio);
  - com o compartilhamento ligado e nenhum grupo configurado, a admissão local e a fila seguem exatamente como hoje (nenhuma consulta nova, nenhuma recusa nova);
  - a chave de limpeza **ausente** conta como desligada, e o ato recusa;
  - nenhum arquivo novo é criado em `~/.farol` nem em `state/` enquanto nada for configurado.
- [ ] **Passo 2:** rodar; verde contra o código atual. Se algum caso já falhar aqui, é defeito pré-existente: registre na evidência antes de mexer.
- [ ] **Passo 3:** commit.

---

## Tarefa 2: identidade do grupo de consumo

**Arquivos:** criar `lib/sync/grupo.js` (PURO) e `test/sync-grupo.test.js`.

**Interface:**
- `novoIdDeGrupo()` → 32 hex de `randomBytes(16)`. **Opaco e sem entrada**: nada de derivar de chave, nome ou caminho, porque derivar é justamente a inferência que a spec recusa.
- `TIPOS_DE_PERFIL = ['assinatura', 'api', 'openrouter', 'codex']`.
- `CONTROLADOS = ['assinatura', 'api', 'openrouter']` e `controlado(tipo)`.
- `PERIODOS = ['dia', 'semana', 'mes']`.
- `sanearGrupo(bruto)` → `{ id, nome, periodo, tetoUsd, tipos }`, com allowlist de campo igual à da C2a (chave fora da lista é descartada, não recusa o pacote), `tetoUsd` número finito ≥ 0 ou ausente, `periodo` dentro de `PERIODOS` ou ausente.
- `resumoDoGrupo(grupo, { vinculos })` → `{ id, nome, periodo, tetoUsd, controlados, naoControlados, estado }`, onde `estado` é `'sem-teto'`, `'configurado'` ou `'nao-identificado'`.

- [ ] **Passo 1:** escrever o teste que falha, com os casos:
  - dois ids seguidos são diferentes, têm 32 hex, e `novoIdDeGrupo` **não aceita argumento** que mude o resultado;
  - varredura do fonte de `lib/sync/grupo.js` e `lib/sync/vinculo.js` atrás de `createHash`, `createHmac` e `tag(`: **nenhuma ocorrência**, porque id derivado de credencial é o caminho recusado pela spec;
  - `sanearGrupo` descarta chave desconhecida e mantém o resto;
  - `tetoUsd` negativo ou não numérico é descartado (não vira zero: zero seria "teto de nada", que é mais restritivo do que o dono pediu);
  - `periodo` fora da lista é descartado;
  - `resumoDoGrupo` separa controlados de não controlados, e **Codex nunca aparece com consumo zero**: aparece na lista de não controlados;
  - grupo sem teto e perfil sem vínculo dão `estado` diferente.
- [ ] **Passo 2:** rodar; `Cannot find module`.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** rodar; verde.
- [ ] **Passo 5 (contraprova):** (a) faça `novoIdDeGrupo` derivar de um hash do nome: reprova o caso da varredura e o da unicidade; (b) faça `tetoUsd` inválido virar 0: reprova; (c) junte Codex aos controlados: reprova.
- [ ] **Passo 6:** commit.

---

## Tarefa 3: vínculo local do perfil ao grupo

**Arquivos:** criar `lib/sync/vinculo.js` e `test/sync-vinculo.test.js`. Estado em `state/sync-vinculos.json` (é dado de operação, não segredo: o cache de segredo mora em `~/.farol`).

**Interface:**
- `lerVinculos()` → `{ [perfilId]: { grupo, tipo, desde, ate } }`, saneado na leitura.
- `vincular(perfilId, { grupo, tipo, agora })` → fecha o vínculo anterior gravando `ate`, abre o novo com `desde`. **Nunca apaga o anterior.**
- `desvincular(perfilId, { agora })` → fecha o vínculo vigente e deixa o perfil `nao-identificado`.
- `vinculoVigente(perfilId)` → o aberto (`ate` ausente), ou `null`.
- `historicoDoVinculo(perfilId)` → a lista inteira, em ordem, para o consumo já registrado achar o grupo do intervalo.
- `grupoDoConsumo(perfilId, at)` → o grupo cujo intervalo `[desde, ate)` contém `at`, ou `null`.

- [ ] **Passo 1:** escrever o teste que falha, com os casos:
  - vincular e ler de volta; o arquivo é JSON e sobrevive a releitura;
  - **rotação de credencial não aparece aqui:** vincular o MESMO perfil ao MESMO grupo de novo não abre intervalo novo e não muda `desde` (é o caso que prova "rotação não reinicia a contagem");
  - trocar de grupo fecha o intervalo anterior com `ate` e abre outro: o histórico tem dois, não um;
  - `grupoDoConsumo` devolve o grupo do intervalo, não o vigente: consumo de antes da troca continua no grupo antigo;
  - `grupoDoConsumo` fora de qualquer intervalo devolve `null`, e `null` **não** é o grupo vigente;
  - desvincular deixa `vinculoVigente` nulo e preserva o histórico;
  - arquivo corrompido lê como vazio, sem lançar.
- [ ] **Passo 2:** rodar; reprova.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** rodar; verde.
- [ ] **Passo 5 (contraprova):** (a) faça `vincular` sobrescrever o registro em vez de fechar o intervalo: reprova o histórico e o `grupoDoConsumo`; (b) faça `grupoDoConsumo` devolver o vigente quando não achar intervalo: reprova; (c) faça revincular ao mesmo grupo abrir intervalo novo: reprova o caso da rotação.
- [ ] **Passo 6:** commit.

---

## Tarefa 4: o grupo no banco, publicado pelo admin

**Arquivos:** criar `lib/engine/sync-grupo.js` e `test/sync-grupo-remoto.test.js`.

O nó é `live/groups/{grupo}`, com a MESMA forma dos nós assinados da C2a: `{ v, generation, enc, sig }`, `enc` cifrado pelo envelope (esquema `grupo1`, teto 2048) e `sig` sobre `{ v, generation, enc }` no caminho `live/groups/<grupo>`.

**Interface:**
- `syncPublicarGrupo(engine, cfg, { grupo })` → publica como a política: exige `sharedActive`, chave do conjunto aberta, ser admin da geração vigente, `v` anterior + 1 e CAS por ETag.
- `aceitarGrupo(engine, cfg, { no, admin, autoridade, grupo })` → **a mesma ordem de recusa da C2a**: compartilhamento, `aceitarAdmin`, forma, geração, assinatura, frescor, versão, e só então decifra.

- [ ] **Passo 1:** escrever o teste que falha, com os casos:
  - publicar sobe `{v, generation, enc, sig}` e o teto **não aparece em claro** no banco;
  - quem não é admin da geração vigente não publica;
  - aceitar com `aceitarAdmin` desligado não muda nada;
  - assinatura inválida recusa **antes de decifrar** (o mesmo `enc` de lixo com forma válida da C2a, afirmando o código `assinatura`);
  - autoridade não fresca: o grupo anterior continua valendo;
  - **o teto aceito não barra nada:** depois de aceitar um teto de zero dólar, a admissão local e a fila seguem iguais (é o caso que prova "configurado, ainda não ativo");
  - limite local adicional pode restringir e **nunca ampliar** o teto do grupo.
- [ ] **Passo 2:** rodar; reprova.
- [ ] **Passo 3:** implementar reusando `lib/engine/sync-politicas.js` no que for a mesma coisa. Se a duplicação passar de trivial, extraia o trecho comum (verificar, decifrar, versionar) para uma função só, em `lib/sync/` e não copie: `core.duplication.business-rule` vale aqui.
- [ ] **Passo 4:** rodar; verde.
- [ ] **Passo 5 (contraprova):** (a) faça o teto aceito entrar no caminho de admissão: reprova o caso "não barra nada"; (b) inverta a ordem de assinatura e decifrar: reprova.
- [ ] **Passo 6:** commit.

---

## Tarefa 5: gestão de aparelho, renomear e aposentar

**Arquivos:** editar `lib/engine/sync.js` só na fachada; a lógica em `lib/engine/sync-grupo.js` ou módulo próprio se passar de 60 linhas. Teste em `test/sync-aparelho.test.js`.

**Interface:** `syncAparelho(engine, { deviceId, nome, aposentar })` → renomeia (grava `name`) e/ou grava `retiredAt` em `users/{uid}/devices/{deviceId}`.

- [ ] **Passo 1:** escrever o teste que falha, com os casos:
  - renomear grava o nome novo e **não** mexe em `lastSeenAt` nem em `createdAt`;
  - renomear o próprio aparelho também atualiza `sync.deviceName` local, e o contrário não vale: renomear outro aparelho **não** muda a config deste;
  - aposentar grava `retiredAt` e o aparelho some da lista de ativos, **sem sair do histórico**;
  - **ausência não aposenta:** um aparelho com `lastSeenAt` de 30 dias atrás continua sem `retiredAt` depois de qualquer ciclo de presença;
  - aposentar **não** apaga dado do aparelho, **não** revoga chave e **não** encerra sessão: o teste afirma que `keyring`, `live/control` e as chaves locais continuam intactos;
  - desaposentar (o mesmo ato com `aposentar: false`) remove o `retiredAt`, porque aposentar por engano precisa ter volta.
- [ ] **Passo 2:** rodar; reprova.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** rodar; verde.
- [ ] **Passo 5 (contraprova):** (a) faça a presença marcar `retiredAt` por inatividade: reprova "ausência não aposenta"; (b) faça aposentar apagar o nó do aparelho: reprova o caso do histórico.
- [ ] **Passo 6:** commit.

---

## Tarefa 6: a chave da limpeza, e a trava

**Arquivos:** criar `lib/sync/limpeza.js` (PURO) e `lib/engine/sync-limpeza.js`; teste em `test/sync-limpeza-chave.test.js`.

**Interface de `lib/sync/limpeza.js`:**
- `CATEGORIAS` = a allowlist do que a limpeza alcança (conteúdo sincronizado: `live/deviceStatus`, `live/devicePolicies`, `live/groups`, `usageEvents`, catálogo e história cifrada quando existirem).
- `PROIBIDOS` = `['keyring', 'live/control', 'leases', 'receipts', 'dailyRounds']`.
- `alcancavel(caminho)` → booleano, e **`false` para tudo que não estiver explicitamente em `CATEGORIAS`**.
- `formaDaTrava({ dev, agora })` → `{ dev, x }` com `x = agora + 600000`.

**Interface de `lib/engine/sync-limpeza.js` (esta tarefa):**
- `syncChaveDeLimpeza(engine, cfg, { ligada })` → publica `live/control/cleanup` = `{ enabled, generation, rev, sig }`, assinado, **sem pedir senha** (D-b), `rev` monotônico.
- `chaveDeLimpezaLigada(engine, { no, admin, autoridade })` → só `true` com assinatura válida da geração vigente; **nó ausente conta como desligada**.

- [ ] **Passo 1:** escrever o teste que falha, com os casos:
  - ligar a chave **não pede senha** e publica com assinatura (D-b);
  - a chave sozinha **não apaga nada**: depois de ligar, nenhuma escrita de remoção sai;
  - nó ausente conta como desligada;
  - chave com assinatura inválida ou geração antiga conta como desligada (fail-closed);
  - `rev` monotônico: repetir o mesmo `rev` é recusado;
  - `alcancavel` devolve `false` para cada um dos `PROIBIDOS`, um caso por item, **e** para um caminho inventado;
  - a trava vence em 10 minutos e a forma é `{dev, x}`.
- [ ] **Passo 2:** rodar; reprova.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** rodar; verde.
- [ ] **Passo 5 (contraprova):** (a) faça `alcancavel` virar allowlist negativa (tudo que não é proibido é alcançável): reprova o caminho inventado; (b) faça a chave sem assinatura contar como ligada: reprova; (c) tire o `rev` monotônico: reprova.
- [ ] **Passo 6:** commit.

---

## Tarefa 7: o ato de apagar

**Arquivos:** completar `lib/engine/sync-limpeza.js`; teste em `test/sync-limpeza-ato.test.js`.

**Interface:** `syncLimpar(engine, cfg, fetchImpl, { password, categorias })`, **nesta ordem**:
1. `sharedActive` e chave ligada (com assinatura válida); senão recusa sem tocar em nada;
2. `signInWithPassword` com a senha real; senão recusa **sem gravar trava**;
3. nenhuma operação viva (leases vivos, sessões locais e outbox): senão recusa com código próprio;
4. grava `cleanupLock` com o token do ato;
5. apaga **só** as categorias pedidas que passam por `alcancavel`;
6. grava `lastCleanup` = `{ at, dev, categorias }`;
7. apaga a trava, sempre, inclusive em falha no meio.

- [ ] **Passo 1:** escrever o teste que falha, com os casos:
  - caminho feliz: as categorias pedidas somem, `lastCleanup` fica gravado e a trava some;
  - **senha errada não apaga nada e não grava trava** (a ordem é o ponto: afirme o código da recusa, não só que recusou);
  - chave desligada recusa antes da senha;
  - operação viva recusa, e a árvore fica intacta;
  - categoria proibida pedida junto com uma alcançável: a proibida **não** é apagada e a alcançável é (recusar o pacote inteiro faria o dono perder o caminho legítimo por causa de um pedido torto);
  - `keyring`, `live/control`, `leases`, `receipts` e `dailyRounds` continuam lá depois do caminho feliz, um `assert` por nó;
  - falha no meio (a segunda remoção devolve erro) **apaga a trava do mesmo jeito** e devolve o que foi e o que não foi;
  - **D8:** com o servidor recusando por senha não recente (`401` na escrita), nada é publicado, e o resultado traz o código que a tela usa para mandar a pessoa ao console do Firebase;
  - a senha não sobrevive: não está no `config`, nem em `state/`, nem em `~/.farol`.
- [ ] **Passo 2:** rodar; reprova.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** rodar; verde.
- [ ] **Passo 5 (contraprova):** (a) mova a gravação da trava para antes da conferência da senha: reprova "senha errada não grava trava"; (b) tire o `alcancavel` do laço de remoção: reprova os casos dos proibidos; (c) tire o `finally` que apaga a trava: reprova o caso da falha no meio.
- [ ] **Passo 6:** commit.

---

## Tarefa 8: revogação

**Arquivos:** completar `lib/engine/sync-limpeza.js` (ou módulo próprio se passar do teto); teste em `test/sync-revogacao.test.js`.

**Interface:** `syncRevogar(engine, cfg, fetchImpl, { password })` → entra com a senha real e grava `live/control/revokedBefore` com um valor **menor** que o `auth_time` do token do ato.

- [ ] **Passo 1:** escrever o teste que falha, com os casos:
  - grava o corte e o valor é menor que o `auth_time` do ato (o aparelho que revoga **não se corta fora**);
  - o valor **só cresce**: tentar gravar um corte menor que o vigente é recusado;
  - senha errada não grava;
  - **retirar o consentimento local** (`aceitarAdmin` para falso) descarta o cache de política e volta à config local inteira, com aviso, sem tocar no banco;
  - o resumo para a tela (`resumoDaRevogacao`) traz, em campos separados: o corte vigente, o aviso de que **o ID token já emitido vale até 1 h**, e que cancelar processo de IA só acontece no próprio aparelho;
  - o resumo **não** afirma remoção de dados ou chaves que o outro aparelho já recebeu, e um teste varre o texto atrás das palavras que prometeriam isso.
- [ ] **Passo 2:** rodar; reprova.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** rodar; verde.
- [ ] **Passo 5 (contraprova):** (a) permita corte maior ou igual ao `auth_time`: reprova; (b) deixe o corte diminuir: reprova; (c) tire a frase da 1 h do resumo: reprova.
- [ ] **Passo 6:** commit.

---

## Tarefa 9: regras v2 dos nós novos

**Arquivos:** editar `firebase/database.rules.template.json`, regerar, editar `test/sync-rules-contrato.test.js`.

Nós, com as regras do anexo C1:
- `live/groups/$grupo`: `@U@ && @H(['v','generation','enc','sig'])@ && @GEN@ && @ENC(2048)@ && newData.child('v').isNumber()`;
- `live/control/cleanup`: `@U@ && @H(['enabled','generation','rev','sig'])@ && newData.child('enabled').isBoolean() && @GEN@ && newData.child('rev').isNumber() && (!data.exists() || newData.child('rev').val() > data.child('rev').val())`;
- `live/control/cleanupLock`: `@U@ && (!newData.exists() || (@REC@ && @C@.child('cleanup').child('enabled').val() == true && @H(['dev','x'])@ && newData.child('x').val() <= now + 600000))`;
- `live/control/lastCleanup`: `@U@ && @REC@ && @H(['at','dev','categorias'])@`;
- `live/control/revokedBefore`: `@U@ && @REC@ && newData.isNumber() && newData.val() < auth.token.auth_time && (!data.exists() || newData.val() >= data.val())`;
- **`LIMPA` nas categorias alcançáveis**, e em nenhuma outra: confira, no gerado, que `keyring`, `leases`, `receipts` e `dailyRounds` **não** têm `LIMPA` na regra.

- [ ] **Passo 1:** acrescentar os nós ao template e rodar `npm run sync:rules`.
- [ ] **Passo 2:** um caso por nó novo no `test/sync-rules-contrato.test.js`, **mais** o caso "só estes nós concedem", atualizado: é ele que pega nó novo entrando sem revisão. Acrescente também o caso negativo do `LIMPA`.
- [ ] **Passo 3:** rodar `sync-rules-contrato` e `sync-escritas-v1`; verdes.
- [ ] **Passo 4 (contraprova, manual e com regeneração):** tire o `newData.val() < auth.token.auth_time` do `revokedBefore`, rode `npm run sync:rules` e o teste: reprova o caso do corte. Restaure, regere, verde. (Mutar sem regerar prova só a comparação byte a byte, que é outro guarda.)
- [ ] **Passo 5:** commit.

---

## Tarefa 10: documentação, gate e evidência

- [ ] **Passo 1:** `CLAUDE.md`: uma linha por módulo novo, dizendo o que decide e o que **nunca** faz.
- [ ] **Passo 2:** `firebase/README.md`: acrescentar ao roteiro manual os casos de `cleanup` (chave sem senha, `rev` monotônico), `cleanupLock` (janela de 10 min e exigência da chave ligada), `lastCleanup` e `revokedBefore` (só cresce, e menor que o `auth_time`), repetindo no **projeto real** o que depende de `REC`.
- [ ] **Passo 3:** `docs/CONFIGURATION.md`: o que é grupo de consumo, por que configurar não é ativar, e o que a revogação **não** promete.
- [ ] **Passo 4:** `npm run check && npm run lint && npm test`; `node tools/sync-rules.js --check`.
- [ ] **Passo 5:** conferir `git diff --name-status md/integracao...HEAD -- test/`: só `A`, fora os ajustes declarados (o inventário de rotas muda de 48 para 54, e isso é declarado no próprio comentário do teste).
- [ ] **Passo 6:** escrever `evidencias-execucao/c2b.md` e atualizar o `EXECUCAO.md`.
- [ ] **Passo 7:** commit e merge em `md/integracao`, com o gate verde nos dois lados e a identidade da árvore conferida.

---

## Critérios de aceite da spec x testes

| Critério (7.C2, CT-GRUPO, D2, D-b, D8) | Teste |
|---|---|
| Perfil sem vínculo não entra na execução distribuída | `sync-vinculo`, `sync-grupo-remoto` |
| Rotação de credencial não zera a contagem | `sync-vinculo`: "revincular ao mesmo grupo" |
| Mudança de vínculo preserva histórico | `sync-vinculo`: `grupoDoConsumo` por intervalo |
| Inferência por hash de credencial não existe | `sync-grupo`: varredura do fonte |
| Configurado não barra nada | `sync-grupo-remoto`: teto zero sem efeito |
| Codex aparece como não controlado | `sync-grupo`: `resumoDoGrupo` |
| Aposentar é ato explícito, ausência não infere | `sync-aparelho` |
| Ligar a chave de limpeza não pede senha | `sync-limpeza-chave` |
| O clique em apagar pede a senha | `sync-limpeza-ato` |
| Keyring, controle, leases, recibos e rodadas nunca entram | `sync-limpeza-ato` (um `assert` por nó) e `sync-rules-contrato` |
| Limpeza sem prova de senha recente não é publicada (D8) | `sync-limpeza-ato` |
| `revokedBefore` só cresce e não se corta fora | `sync-revogacao`, `sync-rules-contrato` |
| A tela não promete o que a revogação não faz | `sync-revogacao`: varredura do texto |
| Desligado: nada muda | `sync-c2b-desligado` |

## Limites declarados

- **Ativar o teto é da C4b.** Aqui o teto é configurado, assinado e exibido, e não barra nada.
- **Encerrar sessões de outros aparelhos fica fora**, por decisão da spec.
- **O banco não verifica assinatura**, como na C2a: as regras conferem dono, forma, geração e frescor de login.
- **`REC` depende do emulador e do projeto real.** Se o servidor não conferir `auth_time`, a limpeza não é publicada (D8) e a tela manda a pessoa ao console: não existe caminho alternativo no app.
- **Telas são do Claude Design**, em tarefa própria; aqui nasce só o comportamento e o dado que a tela vai ler.
