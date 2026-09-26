# Modo Auto com Opus pelo contexto do PR

> **Atualização de 26/09/2026:** o Auto passou a ser "qualidade primeiro". Toda faixa de tamanho usa o Opus no esforço herdado, e o contexto descrito aqui sobe o raciocínio para `xhigh` (antes baixava o Opus para o esforço médio). Os gatilhos, a lista de caminhos sensíveis e a tela continuam valendo; a lista inicial ganhou os caminhos do kustomize. O motivo está no comentário de `AUTO_POR_FAIXA`, em `lib/modelos.js`.

**Pedido do dono (25/09/2026):** "O modo auto precisa ser capaz de usar o opus tb dependendo do
contexto do PR."

**Decisões do dono, na mesma data:**

| pergunta | resposta |
|---|---|
| quais sinais sobem o PR para o Opus | caminhos sensíveis, repositórios críticos, PR muito grande (basta um) |
| sinal descartado | nível do autor |
| onde se configura | com a tela já nesta entrega, desenhada no Claude Design |
| esforço do Opus escolhido pelo Auto | médio, nos três gatilhos |

## O que muda

Hoje o Auto (`lib/engine/model-router.js`) olha só o tamanho do diff: Haiku no pequeno, Sonnet
no médio, Sonnet com esforço alto no grande. O comentário do roteador registrava a decisão
contrária a esta ("Opus no automático custaria o contrário do objetivo do modo auto"); ela é
revogada por este pedido, e o comentário muda junto.

Depois desta entrega, o Auto decide em duas etapas:

1. **Contexto.** Se qualquer gatilho ligado vale para o PR, o modelo é **Opus com esforço
   médio**, sem modo rápido. O primeiro gatilho que valer, na ordem abaixo, é o que o rótulo
   cita.
2. **Tamanho.** Se nenhum vale, a tabela de tamanho de hoje segue igual.

| ordem | gatilho | vale quando | desligável |
|---|---|---|---|
| 1 | repositório crítico | o `owner/repo` do PR está na lista | lista vazia desliga |
| 2 | caminho sensível | algum arquivo alterado casa um padrão da lista | lista vazia desliga |
| 3 | PR muito grande | o PR atinge o limiar do fan-out (1000 linhas ou 20 arquivos, `lib/engine/fanout.js`) | chave própria |

**PR muito grande substitui a faixa "grande" de hoje?** Não exatamente: a faixa grande do
roteador e o fan-out usam os mesmos limiares (1000 linhas, 20 arquivos). Com o gatilho ligado,
todo PR que hoje cai em "Sonnet com esforço alto" passa a Opus médio. Com ele desligado, a
faixa grande continua como está.

## Regras que não se negociam

- **Falta de dado nunca sobe nem desce sozinha.** Sem métrica, o caminho sensível e o PR muito
  grande não podem ser avaliados: vale o repositório crítico (que não depende de métrica) e,
  sem ele, a faixa "sem métrica" de hoje (Sonnet médio). O rótulo diz que a métrica faltou.
- **Os padrões de caminho usam a semântica do `CODEOWNERS`** (estilo gitignore), a que o
  Farol já tem em `lib/engine/codeowners.js` (`patternToRegex`). Um lugar só para dizer o que
  um padrão significa.
- **O Auto escolhe entre as seleções do catálogo** (`lib/modelos.js`): o Opus do gatilho é a
  seleção `opus`, com o que ela significar na versão do CLI. Nada de nome de modelo escrito no
  roteador.
- **Só vale no Auto.** Modelo fixado na configuração continua fixo.
- **O motivo é visível.** O rótulo da atividade da revisão diz qual gatilho subiu o PR e com
  qual evidência curta: "auto: repositório crítico acme-exemplo/infra, opus", "auto: caminho
  sensível k8s/deploy.yaml, opus", "auto: PR muito grande (1240 linhas), opus".
- **Orçamento continua mandando.** O gate de orçamento por perfil e o teto do grupo não sabem
  qual modelo foi escolhido e não mudam; Opus gasta mais do limite, e isso aparece no Consumo
  como já aparece hoje por modelo.

## Configuração

Três campos novos na config, dentro de um objeto só, saneados em `lib/parse.js`:

```json
"autoOpus": {
  "reposCriticos": ["acme-exemplo/infra"],
  "caminhosSensiveis": ["k8s/", "*.tf", ".github/workflows/"],
  "prMuitoGrande": true
}
```

- `reposCriticos`: `owner/repo`, comparado sem diferença de maiúscula; entrada fora da forma
  é descartada.
- `caminhosSensiveis`: padrões estilo gitignore; vazio, comentário e padrão com mais de 200
  caracteres são descartados; teto de 100 padrões.
- `prMuitoGrande`: só liga com `true` explícito.
- **Ausente é o padrão**, e o padrão é conservador: `reposCriticos` vazio,
  `caminhosSensiveis` com a lista inicial abaixo e `prMuitoGrande: true`. Quem já usa o Auto
  passa a ver Opus nos PRs grandes e nos caminhos da lista, que é o pedido.

**Lista inicial de caminhos sensíveis** (proposta; o dono ajusta na tela):

| área | padrões |
|---|---|
| infraestrutura | `k8s/`, `helm/`, `charts/`, `terraform/`, `*.tf`, `Dockerfile`, `docker-compose*.yml`, `.github/workflows/` |
| autenticação e segurança | `auth/`, `security/`, `**/*auth*`, `**/*secret*`, `**/*token*` |
| banco | `migrations/`, `**/migrations/`, `*.sql` |
| pagamento | `payment/`, `payments/`, `billing/` |

## Onde mexe

| arquivo | mudança |
|---|---|
| `lib/modelos.js` | entrada `AUTO_POR_CONTEXTO` (seleção `opus`, esforço `medium`, sem rápido) |
| `lib/engine/model-router.js` | a etapa de contexto antes da de tamanho; rótulos com a evidência |
| `lib/parse.js` | saneador de `autoOpus` |
| `lib/engine/review.js` | passa `pr` (repo) e a lista de arquivos ao roteador; ele já recebe as métricas |
| `ui/` | a configuração em Sistema > Automação, **pelo desenho do Claude Design** (brief anexo) |

## Fora do escopo

- Nível do autor como gatilho (descartado pelo dono).
- Opus em autoanálise, chat, pushback ou ferramentas: o Auto só existe na revisão headless.
- Codex: o Auto é do Claude.

## Brief do desenho

`2026-09-25-auto-com-opus-anexos/brief-claude-design.md`.
