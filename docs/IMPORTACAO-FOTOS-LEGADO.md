# Fotos preservadas do ERP anterior

O workflow `Import preserved product photos` promove as imagens de `legacy_files`
para `products.photo_data_url`, sem reativar o ERP antigo ou alterar o histórico.
Ele executa pelo GitHub com túnel restrito ao banco, usando a credencial de
migração existente. Nenhuma compilação ou dependência é instalada no servidor.

## Correspondência e proteção

- A origem é exclusivamente a coleção `product_photos` do tenant informado.
- O destino usa `md5('ludus:products:' || product_id)::uuid`, exatamente como a
  migração original. Nomes e SKUs semelhantes não são usados como alternativa.
- A prévia informa quantas fotos existem, quantos produtos não foram encontrados,
  quantos já têm foto e quantos estão aptos para importar. Não grava produtos.
- A conversão verifica o SHA-256 original, aceita JPEG/PNG/WebP, aplica orientação,
  fundo branco e limite de 1024 pixels, removendo metadados da nova imagem.
- Fotos já preenchidas são preservadas. Uma associação ambígua ou arquivo inválido
  impede a gravação do lote, em vez de produzir uma importação silenciosamente parcial.
- A aplicação bloqueia a mesma linha de tenant dos handlers Rust e exige que a
  revisão e o campo vazio do produto continuem iguais aos da captura.
- A transação grava apenas foto, revisão, data de atualização e auditoria por item.
  Não altera preço, estoque, cores, dados fiscais nem dispara e-mails/eventos.
- Conflito desfaz o lote completo. Após o commit, uma nova captura confere se
  restaram imagens elegíveis. Nova execução preserva as fotos já importadas.

## Execução

1. Disparar `.github/workflows/import-legacy-photos.yml` com `apply=false` e o UUID
   exato da empresa. Conferir as contagens da prévia.
2. Disparar com `apply=true` para importar as fotos faltantes.
3. Conferir o resumo de reconciliação e as miniaturas no cadastro autenticado.

O workflow verifica conversão, isolamento entre tenants, idempotência,
preservação de foto concorrente e rollback com PostgreSQL isolado antes de
conectar ao banco real. Os logs não contêm imagens, dados de clientes ou URLs
privadas de conexão. Os arquivos originais continuam disponíveis no histórico.
