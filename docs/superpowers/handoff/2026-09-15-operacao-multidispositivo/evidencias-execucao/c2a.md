# Evidência: C2a Autoridade do admin, consentimento e políticas

Plano: `docs/superpowers/plans/2026-09-15-md-c2a-autoridade-e-politicas.md` (escrito nesta execução). Branch `md/c2a`, cortada da ponta de `md/integracao` já com C1a, C0, A5, A1, A4, C0b e C1.

## Estado

Implementada e validada localmente. Existe autoridade de admin com chave própria, assinatura amarrada a conta, caminho e geração, frescor por sequência observada, consentimento local para obedecer, política por aparelho com allowlist e clamp, e a combinação em que o remoto **só restringe**. As regras v2 ganharam os três nós novos, geradas pelo mesmo macro e conferidas byte a byte.

**O que esta entrega NÃO faz, de propósito:**

- **Não publica batimento nem política sozinha.** Os módulos existem, são chamados por fachada do engine (`syncPublicarPolitica`) e testados ponta a ponta contra o dublê do banco, mas nada no ciclo de polling começa a bater ou a aplicar política: quem liga a aplicação ao comportamento real é a C5 (prontidão, CT-PRONT) e as telas.
- **Não tem tela.** Todo o redesenho vem do Claude Design, em tarefa própria.
- **Não designa admin remotamente.** Aqui só existe "tornar ESTE aparelho admin", com a senha real. Designação remota é da C6.
- **Não distribui trabalho.** Autoridade é da C2a; prontidão do distribuidor é da C5.

Com `sync.shared.enabled` **desligado** e `aceitarAdmin` **desligado**, nada muda: `test/sync-admin-desligado.test.js` nasceu verde contra o código anterior e continua verde.

## Gate

    npm run check && npm run lint && npm test

| Medida | Antes (`md/integracao`) | `md/c2a` |
|---|---|---|
| arquivos do `check` | 375 | 390 |
| `tests` | 3290 | 3351 |
| `pass` | 3263 | 3323 |
| `fail` | 0 | 0 |
| `skipped` | 27 | 28 |
| lint | sem regressão | sem regressão |

Windows 11, Node v24.15.0. O `skipped` sobe em 1 por causa do caso de modo 0600 do cache de política, que pula fora do POSIX. `node tools/sync-rules.js --check`: o arquivo publicado confere com o gerado.

## Critério de aceite x teste

| Critério (7.C2 e CT-ADM-POL) | Teste | Estado |
|---|---|---|
| Desligado: nada muda | `sync-admin-desligado` | comprovado |
| Opt-in local `aceitarAdmin`, falso por padrão | `sync-config`, `settings`, `sync-politicas` | comprovado |
| Par Ed25519 só no aparelho admin, preso à geração | `sync-admin-chave` | comprovado |
| A privada nunca sobe nem aparece em resumo | `sync-admin-chave`, `sync-tornar-admin` | comprovado |
| Assinatura amarra conta, caminho, geração e valor | `sync-assinatura` | comprovado |
| A assinatura não é controle de acesso | `sync-assinatura` (caso explícito) e `firebase/README.md` | comprovado, com a nota no roteiro |
| Senha real ANTES de qualquer gravação | `sync-tornar-admin`: "senha errada não troca admin" | comprovado |
| Geração +1 a cada troca, com CAS por ETag | `sync-tornar-admin`, `sync-rules-contrato` | comprovado |
| Frescor por sequência, snapshot inicial não conta | `sync-autoridade` (10 casos, um por frase) | comprovado |
| A maior sequência vista sobrevive a reinício | `sync-autoridade`: caso 5 | comprovado |
| Vence sem mudança por três intervalos | `sync-autoridade`: caso 6 | comprovado |
| Allowlist descarta chave desconhecida sem recusar o pacote | `sync-politicas` | comprovado |
| `tetoParalelismo` clampado para 1 a 4 | `sync-politicas` | comprovado |
| Assinatura conferida ANTES de decifrar | `sync-politicas`: "recusada ANTES de decifrar" | comprovado |
| Autoridade não fresca: a anterior continua valendo | `sync-politicas` | comprovado |
| Versão antiga não sobrescreve a mais nova | `sync-politicas` | comprovado |
| Cache de política 0600, sem segredo | `sync-politicas` | comprovado no POSIX (pula no Windows) |
| Remoto só restringe; a queda nunca amplia | `sync-politica-efetiva` (9 casos, um por regra) | comprovado |
| Regras dos três nós novos | `sync-rules-contrato` (3 casos novos) | comprovado no estático |
| Comportamento das regras novas no servidor | roteiro manual do `firebase/README.md`, itens 9 a 13 | **aguardando validação externa** |

## Contraprovas (restauração byte a byte conferida)

25 mutações por script, todas medidas, nenhuma inerte, mais 1 manual com regeneração.

| Tarefa | Mutação | Falhas |
|---|---|---|
| 2 | chave serve para geração diferente; resumo leva a privada junto | 1, 1 |
| 3 | pré-imagem sem o caminho lógico; sem a geração | 2, 2 |
| 4 | gravação antes da conferência da senha; geração não anda para cima; privada sobe junto com a pública | 1, 2, 1 |
| 5 | snapshot inicial passa a provar frescor; `maior` vira `maior ou igual`; sequência deixa de ser persistida; autoridade nunca vence; sinal sem assinatura válida passa a atualizar | 1, 2, 2, 1, 2 |
| 6 | consentimento liga com qualquer valor presente | 1 |
| 7 | `aceitarAdmin` deixa de ser exigido; assinatura conferida DEPOIS de decifrar; frescor deixa de ser exigido; versão antiga volta a sobrescrever; allowlist some; teto deixa de ser clampado | 1, 1, 1, 1, 4, 2 |
| 8 | teto passa a ser o do remoto; a queda da autoridade volta a valer o local; pausa deixa de ser OU; lista vira união; lista ausente vira lista vazia; `restricao-mantida` deixa de ser marcada | 1, 1, 1, 2, 5, 1 |
| 9 | (manual) tirar o `+ 1` da geração do admin no template, **com regeneração** | 1, e só o caso do admin |

A contraprova da Tarefa 9 foi feita à mão de propósito: mutar o template **sem** regenerar faria falhar a comparação byte a byte, que é outro guarda. Mutando e rodando `npm run sync:rules`, quem reprova é o caso específico (`live/control/admin: senha recente e geração +1`), com os outros 10 verdes; restaurando e regerando, 11/11 verdes.

**A contraprova da ordem de recusa** (Tarefa 7, segunda linha) não desliga a verificação: ela **reordena** o bloco, pondo `decifrar` antes de `verificar`. Com essa ordem, o caso do `enc` de lixo passa a recusar por cifra em vez de por assinatura, e o teste reprova. É a única forma honesta de provar ordem: um teste que só olhasse o resultado final ficaria verde nos dois arranjos.

## Ajustes técnicos em relação ao plano

- **`lib/engine/sync-politicas.js` nasceu fora do plano.** O plano punha publicar e aceitar dentro de `lib/engine/sync-admin.js`, que já tem um assunto próprio (tornar-se admin, com senha). Separar mantém cada arquivo com uma responsabilidade e não custa nada ao chamador, que fala com o engine por fachada.
- **O campo de versão do nó de política é `v`, não `sequencia`.** O plano escreveu `sequencia`; o anexo C1 é a fonte do contrato e usa `['v','generation','enc','sig']`, como o `keyring`, o `deviceStatus` e o `profiles`. Coerência entre os nós vale mais que a palavra do plano.
- **O batimento GANHOU `sequencia` na forma exigida.** O plano listava `['dev','generation','beatAt','sig']`, mas o frescor definido na própria Tarefa 5 é por sequência: sem ela, o sinal que o banco aceita não serve para o que o cliente precisa provar.
- **`rt.cur` passou a existir no runtime.** O material aberto tinha as chaves por geração, mas não qual é a corrente, e é ela que diz com qual K_enc cifrar o que sobe. `guardarMaterial` passa a guardá-la, e `esquecerChave` a limpa junto.
- **`null` numa lista da política efetiva é "ninguém restringiu"**, diferente de `[]`, que é "nada é elegível". Sem essa distinção, um lado sem lista viraria lista vazia e pararia o Farol por omissão. O plano não separava os dois.
- **Um teste importava `lib/paths.js` estaticamente** e a trava de isolamento pegou: `FAROL_HOME` precisa estar no ambiente antes de qualquer módulo do repositório carregar.

## Pendências desta entrega

| O que falta provar | Onde |
|---|---|
| Comportamento no servidor dos três nós novos (geração +1, REC no nó do admin, janela de 60 s do batimento, teto do envelope) | emulador e projeto real, itens 9 a 13 do `firebase/README.md` |
| Publicação das regras v2 já com os nós da C2a | console do Firebase, manual, pelo dono |
| Modo 0600 do cache de política | rodada POSIX (pula no Windows) |
