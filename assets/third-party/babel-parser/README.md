# Parser distribuído

`dist/parser.cjs` é a cópia byte a byte de `lib/index.js` do pacote oficial
`@babel/parser` 7.28.5, publicado sob a licença MIT anexa. É código gerado de
terceiro, não fonte escrita pelo Farol. `dist/` já é a categoria ignorada pelos
verificadores de estilo e sintaxe; os testes do artefato verificam explicitamente
versão, SHA256, licença, sintaxe e execução de parse em isolamento.

O manifesto registra a origem npm, sua integridade SHA512 e os tamanhos/hashes dos
dois arquivos necessários. A integridade identifica o tarball de origem; os hashes
SHA256 verificam os arquivos distribuídos. Não são uma assinatura da release.

O runtime oficial é autocontido. `@babel/types` é usado pelas declarações de tipos
do pacote npm e não é necessário à execução do parser. Não distribuímos types,
declarações, CLI ou sourcemap: o parser tem 512.279 bytes e a licença, 1.086 bytes.
O comentário de sourceMappingURL upstream permanece intacto; o mapa não participa
da execução e não é distribuído.

Para reproduzir, instale o pin de desenvolvimento em um diretório isolado e copie
`node_modules/@babel/parser/lib/index.js` para `dist/parser.cjs` e `LICENSE` para
esta pasta, sem transformar os bytes. Confira os hashes do manifesto. Atualizar
o parser exige revisão explícita de versão, origem, licença, hashes e dos testes;
o loader não procura outra implementação npm como fallback.

Os pacotes existentes incluem `assets/` e `lib/` integralmente. Instalação nova,
instalador offline e upgrade que preserva `node_modules` recebem o mesmo artefato.
Isso também vale para o modo servidor, que troca essas pastas sem instalar
Electron ou executar npm. O verificador recusa artefato ausente/corrompido antes
da troca pelo servidor e nas checagens de runtime dos caminhos desktop.
