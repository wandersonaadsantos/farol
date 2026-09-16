# Evidência: C3a Presença v2, capacidade do aparelho e catálogo cifrado

Plano: `docs/superpowers/plans/2026-09-15-md-c3a-presenca-v2-e-catalogo.md` (escrito nesta execução). Branch `md/c3a`, cortada da ponta de `md/integracao` já com C1a, C0, A5, A1, A4, C0b, C1, C2a e C2b.

## Estado

Implementada e validada localmente. A presença passou a declarar o contrato e se a chave está aberta; existe o gate que decide se vale publicar; a capacidade do aparelho e o catálogo de PRs sobem cifrados, só com leitor e só quando o texto claro muda. As regras v2 ganharam os nós novos e as validações dos dois campos da presença.

**O que esta entrega NÃO faz, de propósito:**

- **Não publica andamento, pendência, história nem Panorama.** São as C3b a C3g. Aqui nasce a base: gate, capacidade e catálogo.
- **Não liga nada sozinha.** Com `sync.shared.enabled` desligado o corpo da presença é byte a byte o de hoje, comparado por igualdade de objeto.
- **Não deixa o catálogo decidir nada.** Ele nomeia PR na tela, e um teste varre `decision.js`, `review.js` e `skip-review.js` provando que nenhum o importa.
- **Não tem tela.** O desenho vem do Claude Design, em tarefa própria.

## Gate

    npm run check && npm run lint && npm test

| Medida | Antes (`md/integracao`) | `md/c3a` |
|---|---|---|
| arquivos do `check` | 409 | 418 |
| `tests` | 3430 | 3470 |
| `pass` | 3402 | 3442 |
| `fail` | 0 | 0 |
| `skipped` | 28 | 28 |
| lint | sem regressão | sem regressão |

Windows 11, Node v24.15.0. `node tools/sync-rules.js --check`: o arquivo publicado confere com o gerado.

## O defeito de segurança encontrado e corrigido nesta entrega

Ao acrescentar o catálogo, um teste que já existia (`sync-constants`: "toda concessão de escrita começa exigindo o próprio uid") reprovou. A concessão de **remoção** que a C2b deu aos nós pai (`live/devicePolicies`, `live/groups`, e agora `catalog` e `live/deviceStatus`) se apoiava só em `REC` e na chave de limpeza.

`REC` prova que o token é de login por senha e que a senha é recente. Ele **não prova que quem escreve é o dono daquela conta**. Sem `U`, um segundo usuário autenticado no MESMO projeto do Firebase apagaria o catálogo, a capacidade, as políticas e os grupos de outra pessoa sempre que a chave de limpeza dela estivesse ligada.

Corrigido: os quatro nós pai exigem `U && LIMPA`. Entrou um caso novo que varre **todas** as concessões atrás da checagem de dono, para o próximo nó novo não repetir o descuido, e o item 25 do roteiro manual do `firebase/README.md` pede a prova com um segundo usuário real. Contraprova manual, com regeneração: voltar ao `LIMPA` sozinho reprova os dois casos.

## Critério de aceite x teste

| Critério (7.C3, CT-COMPAT, CT-LEITURA) | Teste | Estado |
|---|---|---|
| Compartilhamento desligado: presença byte a byte igual | `sync-c3a-desligado` (igualdade de objeto) | comprovado |
| Sem outro aparelho v2, zero escritas de conteúdo compartilhado | `sync-c3a-desligado`, `sync-device-status`, `sync-catalogo-remoto` | comprovado |
| O próprio aparelho não satisfaz o gate | `sync-frota` | comprovado |
| `contract` e `keyReady` descrevem só o próprio aparelho, e agora | `sync-presenca-v2` | comprovado |
| Capacidade cifrada, sem login, hostname ou caminho | `sync-device-status` (varredura da árvore) | comprovado |
| Só escreve quando o texto claro muda | `sync-device-status`, `sync-catalogo-remoto` | comprovado |
| Catálogo cifrado, com a chave do nó em forma de tag | `sync-catalogo-remoto`, `sync-rules-contrato` | comprovado |
| Catálogo é regenerável e nunca decide nada | `sync-catalogo-remoto`: varredura do fonte | comprovado |
| Resumo estável e independente da ordem das chaves | `sync-catalogo` | comprovado |
| Leitura falha fechada | `sync-catalogo-remoto`: linha de outra época | comprovado |
| A presença do v1 continua gravável sob as regras novas | `sync-escritas-v1` | comprovado no estático |
| A limpeza alcança os nós novos | `sync-limpeza-ato`, `sync-rules-contrato` | comprovado |
| Toda concessão exige o dono | `sync-constants`, `sync-rules-contrato` | comprovado no estático |
| Comportamento das regras novas no servidor | roteiro manual do `firebase/README.md`, itens 22 a 25 | **aguardando validação externa** |

## Contraprovas (restauração byte a byte conferida)

23 mutações por script, mais 2 manuais com regeneração.

| Tarefa | Mutação | Falhas |
|---|---|---|
| 2 | o próprio aparelho conta; `keyReady` deixa de ser exigido; `keyReady` aceita truthy; a janela deixa de valer; aposentado volta a contar; contrato aceita texto; visto no futuro deixa de contar | 2, 1, 1, 1, 1, 1, 1 |
| 3 | `keyReady` publicado como `true` fixo; contrato publicado com o compartilhamento desligado | 2, 1 |
| 4 | o gate da frota some; o "só quando muda" some; o login entra no claro; publica sem a chave aberta; o resumo passa a incluir o instante | 1, 1, 1, 1, 1 |
| 5 | resumo passa a depender da ordem das chaves; allowlist da linha some; título deixa de ser truncado; catálogo publica sem gate; catálogo reescreve o que não mudou; leitura devolve a linha crua; o LRU deixa de guardar; a chave do nó vira a key do PR em claro | 1, 3, 1, 1, 2, 1, 1, 1 |
| 6 | (manual) tirar `$pr.matches(...)` do catálogo, **com regeneração** | 1, só o caso do catálogo |
| correção | (manual) voltar ao `LIMPA` sem `U`, **com regeneração** | 2, os dois casos do dono |

Uma contraprova da Tarefa 5 foi refeita: o trecho escolhido para mutar não existia no arquivo do jeito escrito (o gate mora em `podePublicar`, não na função do catálogo), e o script disse "trecho ausente" em vez de passar calado. Refeita contra o trecho certo, reprova.

## Ajustes técnicos em relação ao plano

- **`K_id` precisa dos 32 bytes.** O material guarda a chave em base64url, e as tags exigem `Buffer`. Sem `kek.bufferDe`, a publicação lançava em vez de recusar.
- **O resumo do claro nasceu em `lib/sync/catalogo.js`** e é usado também pela capacidade: é a mesma pergunta ("mudou?") nos dois lugares.
- **O resumo do que já subiu vive na SESSÃO**, não em disco. Guardar em disco faria o Farol confiar, depois de reiniciar, que o banco ainda tem o que ele mandou, e o banco pode ter sido limpo no meio.
- **O teste da presença v1 (`sync-escritas-v1`) foi ajustado**, preservando a garantia: ele afirmava a forma antiga (`devices` só com `.write`) e passou a afirmar, campo a campo, que nada valida o nó inteiro, que os campos novos só têm `.validate`, e que nenhum campo do v1 ganhou regra.
- **`live/deviceStatus` voltou à lista de categorias da limpeza**, agora com a regra de remoção dela, como a regra escrita na C2b manda.
- **Line endings, de novo:** escrever arquivo por script em Python converte para CRLF por padrão. Os arquivos tocados foram normalizados para LF antes do gate.

## Pendências desta entrega

| O que falta provar | Onde |
|---|---|
| Comportamento no servidor dos nós novos e da checagem de dono com um SEGUNDO usuário | emulador e projeto real, itens 22 a 25 do `firebase/README.md` |
| Publicação das regras v2 já com os nós da C3a | console do Firebase, manual, pelo dono |
