# Migração do ERP legado: preparação de 28/10/2026

> Registro histórico da preparação, anterior à execução. O resultado atual está
> em [RESULTADO-MIGRACAO-20261028.md](RESULTADO-MIGRACAO-20261028.md).

## Estado

A troca de aplicação e a importação em produção ainda não ocorreram.
O ERP legado continua atendendo `erp.avilaops.com`.
Revisão do destino examinada: `ad1d873d986c37717bf1eca1ea59da9de1fdf04f`.

## Evidência verificada

- Backup PostgreSQL custom completo de `erp`, com aproximadamente 17 MiB.
- Local remoto: `/mnt/HC_Volume_106542212/backups/erp-migration-20261028/legacy.dump`.
- SHA-256: `b55ae23bd25b9e1e791d34e8e629e89b466b393fcd2b95de7501be3856374bd4`.
- A cópia local apresentou o mesmo hash.
- Restauração integral executada com `pg_restore --exit-on-error`, sem proprietários
  ou permissões de produção, em PostgreSQL 18 local isolado.
- Inventário da restauração: 120 tabelas, 43 preenchidas, 1.167 registros,
  incluindo controles e históricos de migrations. Não são 1.167 entidades comerciais.
- Os 17 arquivos SQL do destino foram aplicados com sucesso em outro banco
  local vazio. Isso não constitui teste do migrador SQLx nem conversão do legado.
- A configuração privada original foi preservada no diretório remoto do backup.
  Ela é necessária para recuperar material criptografado e nunca deve ser versionada.

Os dados locais ficam em `var/migration-audit/`, ignorado pelo Git e com ACL
restrita ao usuário atual. O script `scripts/legacy-inventory.sql` contém apenas
consultas de contagem em transação somente leitura.

## Diferenças que impedem importação direta

| Origem | Quantidade | Tratamento necessário |
| --- | ---: | --- |
| Produtos | 158 | IDs inteiros para UUID; preço comercial vem de tabelas versionadas; preservar atributos adicionais |
| Fotos de produtos | 94 | Destino atual não possui armazenamento equivalente no cadastro de produtos |
| Catálogo de fornecedores | 119 | Preservar dados e imagens; não converter automaticamente cada item em produto vendável |
| Clientes | 3 | Converter identificação, papéis comerciais, endereços e contatos sem duplicar pessoas |
| Fornecedores | 1 | Validar regras de documento e dados bancários antes de importar |
| Pedidos | 2 | Um fechado e um em negociação; ambos têm desconto; um tem entrada; estados e efeitos transacionais diferem |
| Itens dos pedidos | 2 | Preservar vínculo à versão original da tabela de preços e valores efetivos |
| Fechamentos | 1 | Reconciliar valor histórico sem gerar novo recebimento ou saída de estoque |
| Versões de preços | 5 | Preservar 405 itens e 135 alíquotas associadas; destino tem preço simples por produto |
| Notas fiscais | 2 | Ambas canceladas em homologação, com XML; não são rascunhos nem notas recebidas |
| Eventos fiscais | 3 | Preservar vínculo às notas e seus efeitos históricos |
| Envios de e-mail fiscal | 5 | Preservar histórico sem reenviar mensagens |
| Trabalhos fiscais | 6 | Preservar histórico sem reexecutar transmissão |
| Certificado fiscal | 1 | Preservar criptografia e chave correspondente; não expor via histórico genérico |
| Compra | 1 | Mapear estado, moeda e vínculos sem inventar recebimento de estoque |
| Usuário | 1 | Associar ao `sub` real do Auth e reconciliar permissões |

Também existem configurações da empresa, contratos, automação, cores, categorias,
formas de pagamento, etapas comerciais e de produção, parâmetros de preços,
alíquotas, auditoria, integrações e credenciais. A importação deve classificar
todas as tabelas preenchidas; credenciais nunca entram em consultas genéricas.

## Decisão de comportamento pendente

Os dados sem equivalente precisam de módulos operacionais adaptados ou de uma
área de histórico autenticada, somente leitura, com isolamento por empresa.
Arquivar registros fora da aplicação não equivale a migrá-los funcionalmente.
A autorização para migrar todos os dados não resolve essa diferença de comportamento.

## Sequência para concluir

1. Definir o comportamento dos dados sem equivalente.
2. Implementar conversão idempotente, tabela de correspondência de IDs e controles
   que rejeitem valores não representáveis; preservar todos os documentos binários.
3. Ensaiar a conversão no backup restaurado e reconciliar contagens, vínculos,
   valores monetários e hashes dos arquivos. Não disparar eventos externos no ensaio.
4. Corrigir a CI e restabelecer o empacotamento de release no GitHub. A execução
   `40661922659` falhou por timeout no Clippy e na compilação Rust; a `main`
   examinada não contém o dispatch de release descrito em `deploy/README.md`.
5. Validar acesso OIDC, associação Ludus e operações da aplicação candidata.
6. Fazer cópia final consistente com as gravações suspensas, migrar via fluxo
   aprovado de CI, reconciliar novamente e então trocar o domínio.
7. Manter o legado preservado para retorno. Se houver novas gravações no destino,
   a reversão exige reconciliá-las; trocar o proxy sozinho não recupera essas gravações.

O banco `erp_next` de produção estava vazio na inspeção. Nenhuma migration,
conversão, build ou restauração de banco foi executada no servidor de produção.
O backup atual é preliminar; novas operações no legado exigem nova captura no corte.
