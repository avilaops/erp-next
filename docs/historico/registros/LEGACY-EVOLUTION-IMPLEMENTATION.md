# Evolucao do legado e das consultas

## Escopo entregue

As migrations 202611040002 a 202611040004 acrescentam configuracao de sistema,
estruturas normalizadas de preservacao e autorizacao das consultas. A numeracao
202611040001 pertence a sales_order_numbers, incorporada da main antes da entrega.

O schema legacy_evolution possui nove tabelas com RLS forcada e registros
imutaveis: price_books, price_versions, price_items, price_version_seals,
product_cost_snapshots, product_attribute_snapshots, file_references,
record_links e order_price_versions.

## Reconciliacao

deploy/reconcile-legacy-evolution.sql usa exclusivamente as projecoes ja
autorizadas public.legacy_history e public.legacy_files. Nao abre acesso aos
schemas originais nem le credenciais. A transacao tem trava consultiva, limites
de tempo e verificacao de cobertura, hashes e conversao monetaria exata.

Cada registro historico recebe origem, chave original, hash, versao da regra,
destino conhecido e estado da conversao. Produtos e pessoas usam a mesma regra
deterministica de UUID do importador original. Relacoes nao verificadas ficam
history_only ou review_required. A quantidade de pedidos, cliente, valor ou
data nunca e usada para adivinhar uma correspondencia.

Custos e atributos sao preservados em snapshots separados. As versoes de
precos e seus itens sao copiadas como historical, com os parametros originais
e sem ativacao comercial. A moeda fica NULL quando nao existe no documento
original: a migracao nao inventa uma moeda ou republica um preco.

Versoes seladas rejeitam novos itens. Todas as versoes e itens rejeitam UPDATE
e DELETE. Uma nova associacao de pedido exige uma versao published, selada e
vigente. Nao se associam os pedidos existentes automaticamente. Os comandos
atuais continuam usando as regras de venda ja publicadas; adotar uma nova tabela
ativa e uma decisao comercial explicita, nao um efeito da recuperacao historica.

file_references vincula os arquivos aos registros e produtos identificados,
com chave estrangeira composta que impede apontar o arquivo para outro
historico. system_config.file_catalog unifica os metadados usando
security_invoker, mantendo os binarios originais e seus downloads autenticados.
Nao houve externalizacao nem exclusao de copias.

## Consultas

- legacy_files_history_idx suporta busca por empresa, historico e arquivo.
- A API de historico aceita after_collection e after_id, retorna nextCursor e
  continua aceitando offset. Cursor incompleto, offset junto a cursor ou colecao
  conflitante sao rejeitados. Anexos possuem ordenacao deterministica.
- queries/system-configuration.sql oferece primeira/proxima pagina para
  arquivos, campos e relatorios. NULL usa 25 registros; limites ficam entre 1 e
  100. O cursor usa a mesma ordem e desempate do indice.
- Campos personalizados exigem produto existente/acessivel e permissoes.
- Relatorios possuem RLS restritiva para identidade, propriedade privada e
  permissao do dataset. Nao recebem ID do proprietario como parametro.
- Transicoes sao filtradas por permissao. O futuro executor ainda precisa
  revalidar estado e permissao dentro da transacao do agregado.
- queries/legacy-evolution.sql permite consultar precos historicos, itens e
  pendencias de conversao com parametros e permissao platform.legacy.read.

O contexto transacional exige app.tenant_id e app.auth_subject provenientes
da sessao autenticada. SQLx usa bind por valor. Os PREPARE SQL fornecidos sao
contratos de consulta por conexao, nao comandos para registrar globalmente num
pool. Endpoints novos de configuracao nao foram adicionados nesta entrega.

## Extensoes e demais listas

pgvector ja estava instalado; esta entrega nao cria embeddings ou novas
extensoes. A auditoria nao demonstrou necessidade de pg_trgm para os 158
produtos atuais. A busca existente, seus caracteres literais e contratos foram
preservados. A paginacao por cursor foi implantada no historico e nos templates
novos; os demais modulos mantem OFFSET e devem mudar com seus consumidores.

## Validacao e publicacao

system-schema.yml aplica o historico completo em PostgreSQL 18, executa testes
de RLS, reconciliacao repetida, ausencia de efeitos comerciais, precos e
documentos imutaveis, cursores com datas iguais, limites e relatorios privados.
O teste Rust cobre isolamento, autorizacao, cursor e compatibilidade de offset
do endpoint de historico. Os testes gerais de contrato/API/interface continuam
obrigatorios.

production-migrate.yml em schema_only aplica as migrations, reconcilia o
historico e concede somente SELECT nas novas estruturas. Nenhuma permissao de
funcionalidade e atribuida automaticamente aos usuarios. A publicacao da API
usa a imagem validada pelo CI. Os scripts de reconciliacao nao criam pedidos,
recebimentos, movimentos de estoque, eventos de outbox ou transmissoes fiscais.

## Limites operacionais

Registros review_required sao uma fila explicita de reconciliacao, nao falhas
silenciosas nem conversoes concluidas. Recuperar a operacao desses registros
exige confirmar equivalencia de estados e efeitos por dominio. Os schemas
originais permanecem preservados. Essa entrega nao os aposenta e nao altera
precos comerciais vigentes.
