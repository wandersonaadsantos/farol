# Auditoria por amostra sorteada das aprovações do Opus (27/09/2026)

Protocolo escrito ANTES do sorteio e antes de olhar qualquer resultado.

## Pergunta

Quantas aprovações do Opus o Farol postou que uma revisão independente reprovaria?

## População

- Toda decisão com veredito `approve` e status `auto_approved` ou `posted`, de sessão com modelo Opus (Opus 5 ou Opus 5.5), com o head registrado, no `decisions.json` real.
- Um item por PR: a aprovação mais recente dele.
- Resultado: 418 PRs, de 16/08 a 26/09/2026. Lista em `populacao.txt` (sha256 do arquivo: `e1d9baafd162ef2ce61ebb2c2af0ade79f4a2cbe6dc301995313b23ea690e17a`).

## Amostra

- 16 PRs, sorteados sem reposição com a semente `farol-auditoria-2026-09-27` (mulberry32 sobre os 4 primeiros bytes do sha256 da semente), sobre a população na ordem de `populacao.txt`.
- Nada é excluído depois do sorteio. PR inacessível conta como "não avaliado", com o motivo.

## Como cada PR é avaliado

- Revisão independente no MESMO head que o Farol aprovou, lendo o código ao redor (quem chama, quem é chamado), somente leitura.
- O auditor forma o próprio veredito ANTES de ler a revisão que o Farol postou.
- Classificação de cada PR:
  - **erro**: o auditor daria REQUEST_CHANGES por um defeito bloqueante verificado no código;
  - **lacuna importante**: aprovar estava certo, mas ficou de fora um problema importante verificado;
  - **ok**: nada relevante que o Farol não tenha visto;
  - **inconclusivo**: não deu para verificar, com o motivo.
- Suspeita sem verificação não conta como erro.

## Limites declarados

- O auditor também é um Opus: vieses do mesmo modelo podem se repetir. A amostra mede um piso de erros, não o teto.
- 16 de 418 dá uma estimativa grosseira. Zero erros em 16 ainda é compatível com uma taxa real de até cerca de 17% (limite superior de 95%, regra de três).
