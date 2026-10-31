# Segurança e auditoria

A tela `/preferencias/seguranca` consulta `GET /api/erp/audit` no BFF, que encaminha a sessão e a empresa para `GET /api/v1/audit` em Rust.

É necessário vínculo ativo e `platform.audit.read`. A consulta usa a transação com tenant e RLS existentes. Não concede permissões, não muda MFA e não escreve eventos ao listar.

São exibidos somente identificador do evento, data, nome atual do responsável (quando disponível), ação e tipo de registro. O nome não é um snapshot histórico. Ausência de responsável aparece como processo do sistema. Detalhes, identificadores da entidade, metadados da requisição e segredos não são retornados.

Filtros: `q` procura literalmente em nome/ação/tipo; `action` e `entity` exigem código exato; `startDate` e `endDate` são datas inclusivas em UTC. Datas e campos desconhecidos inválidos são rejeitados. Cada página possui até 25 eventos, ordenados por data e UUID decrescentes. `before` referencia o último evento da página anterior na mesma empresa; não depende de offset e não repete itens quando novos eventos são inseridos. Atualizar volta à primeira página. Não há promessa de snapshot congelado entre consultas.

Sessões, dispositivos e políticas atuais do Auth permanecem indisponíveis até existir integração autorizada. A tela não deduz login ou MFA a partir de eventos de negócio.
