# Brief para o Claude Design: quando o Auto usa Opus

**Para quem:** o Claude Design. Este brief descreve **estados, dados e ações**, não layout.
O desenho decide onde e como; a implementação começa depois dele.

**Base:** `docs/superpowers/specs/2026-09-25-auto-com-opus-design.md`.

**Regras de sempre (as mesmas do brief B2):** texto em português e sem travessão; tema claro e
escuro com contraste AA; foco visível e teclado; desktop largo (1280 px ou mais) e celular
estreito (360 a 400 px) sem rolagem horizontal; alvo de toque de 44 px; dados sintéticos
("acme-exemplo", "Ana Exemplo"); nada de biblioteca, fonte ou ícone remoto; falha não se
disfarça de vazio; menções navegáveis (repositório leva ao repositório no GitHub).

## Onde isso vive hoje

Sistema > Automação, no bloco do modelo e do raciocínio de cada CLI. A frase de ajuda atual diz
"No Claude, Auto (custo-benefício) escolhe Haiku ou Sonnet pelo tamanho do PR, só na revisão
headless". A seleção Auto é uma opção do seletor de modelo do Claude.

## O que a tela precisa permitir

1. **Ver e editar a lista de repositórios críticos.** Cada item é `owner/repo`. Adicionar,
   remover. Todo PR desses repositórios vai para o Opus quando o modelo é Auto.
2. **Ver e editar a lista de caminhos sensíveis.** Cada item é um padrão no estilo
   `CODEOWNERS` (`k8s/`, `*.tf`, `**/*auth*`). Adicionar, remover, e **voltar à lista
   padrão** (a lista inicial vem pronta, agrupada por área: infraestrutura, autenticação e
   segurança, banco, pagamento).
3. **Ligar e desligar "PR muito grande vai para o Opus"**, dizendo o limiar (1000 linhas ou 20
   arquivos, o mesmo em que a revisão é fatiada em lotes).
4. **Entender o efeito antes de salvar:** Opus gasta mais do limite do plano; esforço médio;
   só vale quando o modelo do Claude é Auto e só na revisão automática.

## Estados obrigatórios

| estado | quando | o que a tela diz |
|---|---|---|
| Auto não selecionado | o modelo do Claude é fixo | a configuração existe, mas não vale agora, e por quê; editar continua possível |
| Auto selecionado, gatilhos ligados | o normal | as três regras e o que cada uma sobe |
| todos os gatilhos desligados | listas vazias e PR muito grande desligado | o Auto volta a ser só por tamanho (Haiku, Sonnet, Sonnet com esforço alto) |
| padrão inválido recusado | o usuário digitou algo que o saneador descarta | qual entrada foi recusada e o porquê (forma de `owner/repo`, padrão vazio, longo demais, teto de 100) |
| salvando e falha ao salvar | a rota de config falhou | falha com motivo, sem fingir que salvou |
| lista padrão | nunca editada | deixar claro que é a lista inicial do Farol, e que dá para voltar a ela |

## Dados reais para o desenho (sintéticos)

- Repositórios críticos: `acme-exemplo/infra`, `acme-exemplo/pagamentos`.
- Caminhos sensíveis: a lista inicial da spec.
- Exemplo do que aparece na atividade de uma revisão, e que o desenho pode reaproveitar como
  prévia: "Modelo: opus · esforço medium (auto: caminho sensível k8s/deploy.yaml, opus)".

## Celular

A tela de Automação precisa caber em 360 px: listas editáveis sem tabela larga, item longo
(`**/migrations/`) quebrando sem rolagem horizontal.
