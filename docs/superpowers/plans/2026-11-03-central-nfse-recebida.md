# Central de NFS-e recebida — AVL-112

Parte da meta AVL-101/104/108/110/111/112. Não encerra captura incremental,
eventos, conferência fiscal individual ou homologação externa.

## Desenho

Página `/fiscal/nfses`, ligada à central fiscal. Apresentar empresa ativa,
origem manual nacional, ambiente do arquivo e pendências de assinatura/situação.
Listar somente documentos do tenant e permitir detalhes e XML original íntegro.
Importação por arquivo UTF-8 de até 1 MiB, somente com permissão explícita.
Emitente, prestador e tomador permanecem distintos; valores usam strings exatas.

BFF expõe somente as quatro operações já existentes na API. Todas exigem
tenant igual à sessão; POST também exige Origin e JSON. Nenhuma URL livre,
consulta à autoridade, certificado, emissão ou lançamento comercial.

Falha ou troca de empresa limpa documentos/detalhe visíveis. Reenvio do mesmo
arquivo na mesma empresa conserva a chave idempotente após resposta incerta;
seleção fica somente em memória. Mudança de empresa invalida a seleção. Download
confere tipo, limite, SHA-256 do conteúdo e header antes de criar o arquivo.

## Execução

- [ ] Escrever testes browser/BFF antes das rotas e confirmar falha no Actions.
- [ ] Implementar quatro handlers BFF com sessão/tenant/origem e limites.
- [ ] Implementar validação de respostas, importação UTF-8 e download com hash.
- [ ] Implementar tela, estados, leitura, detalhes, importação e paginação.
- [ ] Atualizar catálogo e superfície de rotas, sem alegar execução pelo catálogo.
- [ ] Revisar e validar CI/browser com cinco tamanhos de tela.

Branch empilhada sobre o PR #72 em `3c9650e`; PR separado em rascunho.
Rust: nenhuma ferramenta local; compilação/lint/testes somente no Actions.
Next 16.4.3 confirmado no package.json e guias do pacote da mesma versão lidos
no checkout compartilhado, sem alterar esse checkout.
