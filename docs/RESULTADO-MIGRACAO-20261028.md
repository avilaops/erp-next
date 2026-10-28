# Migração do ERP legado em 28/10/2026

## Publicação

O domínio `https://erp.avilaops.com` passou a servir o ERP Next.
A primeira release publicada é `5b3d40e5fd50bc2ecf7b1e7b29a0fe98f746374d`.
API e web foram iniciadas a partir de imagens prontas do GitHub, sem build no servidor.
O endpoint `/api/health` confirmou `ok: true`, `application: erp-next` e o SHA.
A release final publicada é `bee5cb568f6abb7aecb2b185584b902d4af57fe9`, incluindo
a correção de acesso aos cadastros. O endpoint público retornou HTTP 200 com
esse SHA; ambos os containers ficaram `healthy`. O catálogo autenticado foi
recarregado após a atualização e continuou exibindo 158 produtos.

## Execuções de referência

- Imagens iniciais: <https://github.com/avilaops/erp-next/actions/runs/40753873616>.
- Migração e reconciliação: <https://github.com/avilaops/erp-next/actions/runs/40758038292>,
  segunda tentativa aprovada, concluída às 17:00 de Brasília.
- Release com correção dos cadastros: <https://github.com/avilaops/erp-next/actions/runs/40759279014>.

A release final passou em formatação, Clippy, 114 testes da API, lint e build web
e 15 testes de navegador antes do empacotamento das imagens.

As 18 migrations, o bootstrap e a importação foram executados no runner GitHub,
por túnel SSH com destino restrito ao PostgreSQL. As URLs de conexão são
normalizadas para o túnel; credenciais não são impressas.
A tradução de endereços do Docker apresenta o IP do servidor ao PostgreSQL.
Foram adicionadas duas regras `hostssl` restritas à origem `/32`, aos bancos
`erp_next` e `erp` e aos papéis `erp_next_migrate` e `erp`, com SCRAM.
A configuração anterior foi preservada junto ao backup.

## Dados preservados e verificados

O importador comparou o conteúdo integral de cada linha antes e depois da cópia,
incluindo nova leitura da origem ao final. O resultado foi `verified: true` para
120 tabelas e 1.167 registros originais, incluindo controles e migrations.
Os schemas `erp_control` e `tenant_ludus` permanecem completos no banco destino,
sem acesso pelo papel de runtime HTTP.

| Verificação em produção | Resultado |
| --- | ---: |
| Produtos no cadastro novo | 158 de 158 |
| Clientes no cadastro novo | 3 de 3 |
| Fornecedores no cadastro novo | 1 de 1 |
| Registros no histórico consultável | 1.044 |
| Arquivos no histórico | 217 |
| Arquivos com hash divergente | 0 |
| Arquivos sem registro histórico correspondente | 0 |
| Pedidos preservados no histórico | 2 |
| Notas fiscais preservadas no histórico | 2 |
| Versões de preços preservadas no histórico | 5 |
| Fotos de produtos preservadas no histórico | 94 |
| Associações iniciais de acesso | 1 |

Produtos, pessoas, dados da empresa e formas de pagamento foram projetados para
os cadastros novos. Pedidos anteriores, documentos fiscais, tabelas versionadas,
fotos e demais registros autorizados ficam em `/historico`, somente leitura.
Isso não transforma pedidos históricos em operações editáveis dos módulos novos.
Nenhum recebimento, saída de estoque, transmissão fiscal ou e-mail foi repetido.
Credenciais, certificados e controles internos permanecem nos schemas originais
protegidos e no backup; não são publicados na consulta genérica.

O papel `erp_next_app` não é superusuário, não possui `BYPASSRLS` e não tem
`USAGE` no schema original. O script `scripts/verify-legacy-production.sql`
reproduz as verificações de contagens, integridade de arquivos e privilégios
em uma transação somente leitura.

## Backup e retorno

O legado foi parado antes da captura final. Seu banco, container e configuração
permanecem preservados; o container `erp` está parado e com reinício desativado
para não disputar a porta com o ERP Next.

- Diretório: `/mnt/HC_Volume_106542212/backups/erp-migration-20261028/`.
- Backup final: `final-cutover.dump`, 17.074.583 bytes, modo `600`.
- SHA-256: `531173612f74f6813f747f2b6812705c3ddf0d196d7e6fe979151660ff4d9cc9`.
- Backup preliminar: `legacy.dump`, restaurado integralmente em PostgreSQL 18
  local isolado antes da migração.
- Configuração original e chave necessária aos dados criptografados preservadas
  em arquivo privado no diretório do backup, nunca no Git.

O projeto Compose é `erp-next`. As releases ficam no volume de dados e usam
arquivos privados de `/opt/erp-next/shared`. O Caddy continua apontando para
`127.0.0.1:3140`; a API está publicada somente em `127.0.0.1:3141`.

Uma reversão deve primeiro suspender novas gravações e reconciliar o que foi
criado no destino. Parar `erp-next` e reiniciar `erp` sem essa análise perderia
o acesso às novas operações. Não restaurar banco por troca de imagem.

## Limites da verificação

O login real pelo Auth e o retorno OIDC foram concluídos no navegador em produção.
O cadastro autenticado exibiu 158 produtos; o histórico exibiu 1.044 registros,
os dois pedidos e as duas notas fiscais canceladas em homologação.
O XML autorizado da primeira nota foi baixado pelo BFF autenticado e seu SHA-256
coincidiu com o arquivo preservado no banco:
`8f0b2cb2f6f8bc5e7cb1de08c08545b4780b7fc58255d0ddd37233424760d481`.
A interface final foi validada no domínio após a atualização das imagens.

O cadastro fiscal do destino exige escolher entre lucro presumido e real para
o código legado `3` (regime normal), além de informar os segmentos novos.
Não se escolheu um regime tributário mais específico sem evidência no legado.
O regime original permanece no histórico.
A página inicial mantém indicadores explicitamente não conectados, conforme
o comportamento existente do ERP Next; a migração não implementa novos módulos.

O disco raiz estava com 97% de uso e cerca de 1,2 GiB livres;
o volume de dados tinha cerca de 36 GiB livres. Não foi feita limpeza ampla.
