# Auditoria das estruturas e consultas

## Escopo e metodo

Inspecao em 2026-11-04 do banco erp_next pelo papel erp_next_app, com
default_transaction_read_only=on e statement_timeout=10000. Foram consultados
catalogos, contagens agregadas, integridade dos arquivos historicos e planos
EXPLAIN (ANALYZE, BUFFERS) de SELECT. Nenhuma estrutura ou registro de producao
foi alterado. Os dados das tabelas originais continuam inacessiveis ao runtime;
a inspecao de suas colunas e restricoes usou os catalogos do PostgreSQL.

## Por que existe legado

scripts/import-legacy.py preserva integralmente erp_control e tenant_ludus,
confere manifesto de contagens e hashes antes/depois e recusa sobrescrever uma
importacao existente. deploy/import-legacy.sql converte apenas cadastros com
equivalencia segura e copia uma lista permitida para legacy_history/legacy_files.

A separacao tem motivos funcionais concretos:

- IDs inteiros e identidade por email no modelo anterior; UUID, Auth e vinculos
  por empresa no modelo atual.
- Precos versionados com parametros no anterior; o importador projeta o ultimo
  preco de tabela para products.price_cents, preservando as versoes no historico.
- Pedidos, descontos, entradas e estados antigos nao equivalem automaticamente
  aos comandos novos de estoque, recebimento e fiscal.
- Credenciais e documentos originais precisam permanecer protegidos.

Portanto, legado significa origem e contrato anteriores, nao ausencia de
integridade. tenant_ludus tem 113 chaves estrangeiras e 672 CHECKs; nenhuma de
suas FKs esta marcada como nao validada. Esses numeros nao medem qualidade por
si so, mas invalidam a suposicao de que o schema seja apenas armazenamento solto.

## Situacao verificada

| Schema | Tabelas | RLS forcada | Acesso USAGE pelo runtime | Tamanho aproximado |
| --- | ---: | ---: | --- | ---: |
| public | 95 | 92 | Sim | 29,7 MiB |
| tenant_ludus | 117 | 0 | Nao | 19,9 MiB |
| erp_control | 3 | 0 | Nao | 0,08 MiB |

As tres tabelas public sem RLS sao identities, permissions e _sqlx_migrations.
Elas nao devem receber uma politica generica tenant_id: possuem outras
responsabilidades e a tabela de migrations ja recusa SELECT pelo runtime.

Para a empresa configurada no frontend, foram confirmados 158 produtos,
3 parties, 2 pedidos atuais, 1.044 registros historicos e 217 arquivos. Todos
os 217 arquivos passaram na comparacao de SHA-256. O historico tem 2 pedidos,
2 notas fiscais, 5 versoes de precos, 405 itens de precos e 94 fotos. A igualdade
entre a quantidade de pedidos atuais e historicos nao prova correspondencia.

pg_stat_user_tables apresentou n_live_tup=0 para algumas tabelas preenchidas.
Esses valores sao estimativas/estatisticas, nao contagens de integridade.
Avaliar ANALYZE controlado para atualizar estatisticas; nao usar esses zeros
para concluir que houve perda de dados.

## Evolucao estrutural recomendada

1. Preservar os schemas originais sem liberar acesso direto ao runtime.
2. Criar correspondencia explicita entre origem, chave original, destino,
   estado da conversao, versao da regra e evidencia de reconciliacao. Os UUIDs
   deterministas usados pelo importador ajudam, mas nao substituem esse registro.
3. Recuperar o modelo de precos versionados com empresa, moeda, vigencia,
   parametros e itens imutaveis. Pedidos novos devem referenciar a versao usada;
   pedidos historicos preservam os valores e efeitos ja ocorridos.
4. Separar dados mestres de produto, custo de aquisicao, precificacao, atributos
   e arquivos. Evitar repetir todos os campos antigos em products ou esconder
   campos usados em filtros e relacionamentos dentro de JSONB generico.
5. Consolidar metadados de arquivos e referencias por dominio. legacy_files
   permanece imutavel; eventual externalizacao do bytea exige verificacao de
   hash, permissao e recuperacao antes de remover qualquer copia.
6. Mapear estados comerciais antigos para os atuais antes de promover um
   registro historico para operacao. Migracao nao deve emitir outbox, receber
   pagamentos ou movimentar estoque novamente.
7. Levar capacidades comerciais uteis ao novo modelo e manter apenas o
   historico como arquivo. Avaliar aposentadoria do legado por dominio, com
   reconciliacao, cobertura funcional e regra de retencao definida.

## Consultas atuais da API

### Historico e anexos

apps/api/src/domains/legacy.rs usa subconsulta correlacionada para anexos e
LIMIT 25 OFFSET. legacy_history tem indice (tenant_id, collection, id), mas
legacy_files so tem a PK (tenant_id, id), sem indice no vinculo history_id.

Em uma consulta de leitura da primeira pagina, projetando ID e anexos:

| Medida | Consulta correlacionada | Pagina materializada e anexos agrupados |
| --- | ---: | ---: |
| Execucoes da varredura de legacy_files | 25 | 1 |
| Shared buffer hits de execucao | 153 | 15 |
| Tempo de execucao | 0,782 ms | 0,873 ms |
| Tempo de planejamento | 0,371 ms | 3,930 ms |

Medicoes isoladas, sem benchmark repetido ou promessa de ganho de latencia.
A segunda consulta fez menos acessos, mas teve mais custo de planejamento e
nao foi mais rapida. Nenhuma executou o endpoint completo nem transferiu todos
os details. A prioridade e testar primeiro o indice abaixo em uma copia com
volume representativo, mantendo a consulta simples:

```sql
CREATE INDEX legacy_files_history_idx
    ON public.legacy_files (tenant_id, history_id, id);
```

O indice e uma proposta, nao foi instalado. Nao incluir content no indice.
Caso o agrupamento seja adotado, ordenar jsonb_agg por f.id para retorno estavel.

### Catalogo, pessoas e estoque

catalog.rs, parties.rs e inventory.rs usam strpos(lower(...), lower($n)).
As consultas sao parametrizadas; esse predicado de substring nao e atendido
pelos indices B-tree de nome existentes. pg_trgm pode ajudar, mas instalar a
extensao isoladamente nao modifica o plano: e necessario formular LIKE/ILIKE
compativel com o indice e manter a semantica literal de %, _ e barra invertida.
Medir tambem o plano com RLS e o papel real, pois uma medicao como superusuario
nao representa necessariamente o plano da aplicacao.

Com apenas 158 produtos, nao ha evidencia de urgencia para um indice textual.
Termos curtos, consulta vazia e filtros de status devem ser casos separados no
ensaio. Nao substituir busca por codigo ou documento por similaridade vetorial.

### Paginacao e planejamento

Ha OFFSET em historico, catalogo, pessoas, financeiro, estoque e outros dominios.
Para listas grandes, introduzir cursor composto com o mesmo desempate UUID da
ordenacao. Preservar contratos existentes durante a migracao dos clientes.

Predicados opcionais como ($2 IS NULL OR collection=$2) merecem comparar plano
generico e personalizado. Se houver regressao comprovada, usar duas consultas
estaticas parametrizadas, com e sem filtro. Nao montar SQL com entrada livre
nem forcar plan_cache_mode globalmente como primeira medida.

## Revisao das quatro consultas da PR 87

| Consulta | Melhoria proposta |
| --- | --- |
| list_system_files | Adicionar proxima pagina e cursor coerente com created_at DESC, id; definir explicitamente limite padrao para NULL |
| get_product_custom_fields | Verificar produto existente e acessivel antes de retornar definicoes; paginar se houver muitos campos |
| list_report_definitions | Adicionar limite/cursor; derivar proprietario da identidade autenticada e validar permissao do dataset |
| list_published_workflow_transitions | Continuar tratando como lista de candidatos; conferir permissao e estado novamente dentro da transacao que executa a mudanca |

As quatro consultas sao templates SQL preparados, ainda nao integrados a
endpoints. Parametrizacao previne mistura de valores e sintaxe SQL, mas nao
substitui autorizacao. A identidade e a empresa devem vir da sessao verificada.
Os limites atuais nao sao uniformes; a consulta de arquivos retorna limite 1
para parametro NULL por causa do comportamento de GREATEST no PostgreSQL.

Para uma futura ordenacao de arquivos em created_at DESC, id DESC, usar indice
com essas mesmas direcoes e predicado (created_at,id) < ($cursor_time,$cursor_id).
Nao aplicar essa comparacao sem ajustar a ordenacao atual, que usa id ASC.
Preferir consultas distintas para primeira e proxima pagina, sem um OR para
cursor ausente no caminho principal.

Testes adicionais antes de integrar:

- Datas iguais e UUIDs distintos, sem duplicacao ou salto entre paginas.
- Limites NULL, zero, negativos e acima do maximo.
- Empresa diferente, identidade diferente e sessao sem contexto.
- Produto inexistente ou inacessivel.
- Relatorio privado de outro membro da mesma empresa.
- Plano generico e personalizado em conjuntos representativos.

## pgvector

vector 0.8.1 esta instalado. Nao foram encontradas colunas vector, halfvec ou
sparsevec em public e tenant_ludus. document_chunks tem search_vector do tipo
tsvector: isso e busca textual, nao embedding vetorial. A extensao instalada
nao significa que exista busca semantica implementada.

## Referencias

- scripts/import-legacy.py e deploy/import-legacy.sql.
- migrations/202610280006_legacy_history.sql.
- apps/api/src/domains/legacy.rs, catalog.rs, parties.rs e inventory.rs.
- queries/system-configuration.sql.
- [Indices e busca textual](https://www.postgresql.org/docs/18/pgtrgm.html).
- [Planos de consultas](https://www.postgresql.org/docs/18/sql-explain.html).
- [Paginacao](https://www.postgresql.org/docs/18/sql-select.html).
