# ERP

ERP modular da Ávila Ops, mantido em `avilaops/erp-next`. O sistema nasce separado do ERP legado e usa um monólito modular para preservar transações, contratos entre domínios e rastreabilidade.

## Fundação

- API: Rust, Axum e SQLx.
- Banco: PostgreSQL 18.
- Web: Next.js, React e TypeScript.
- Multiempresa: `tenant_id`, políticas RLS e contexto transacional.
- Segurança: Auth Ávila Ops será integrado por OIDC; permissões pertencem ao ERP.
- Integração: outbox transacional; n8n consome eventos e não contém regras centrais.
- Auditoria: registro append-only de ações relevantes.

## Desenvolvimento local

1. Copie `.env.example` para `.env`.
2. Execute `docker compose up -d postgres`.
3. Com a conta de migração em `DATABASE_URL`, execute `cargo run -p erp-next-api -- migrate`.
4. Com a conta de aplicação em `DATABASE_URL`, execute `cargo run -p erp-next-api`.
5. Em outro terminal, execute `pnpm --filter web dev`.

A API não executa DDL ao iniciar o servidor HTTP. Em produção, a conta da
aplicação deve ter `NOSUPERUSER NOBYPASSRLS` e permissões apenas sobre as
operações necessárias. Use outra conta para aplicar migrações.

Endpoints iniciais:

- `GET /health/live`: processo ativo.
- `GET /health/ready`: API conectada ao PostgreSQL.

Recursos empresariais implementados exigem Bearer válido e `X-Tenant-Id`:
`/api/v1/me`, `/api/v1/users`, `/api/v1/roles`, `/api/v1/permissions`
e `/api/v1/company`. O último oferece GET e PUT com ETag/If-Match.
O contrato gerado está em `/openapi.json`.

O primeiro ciclo comercial conecta produtos, clientes e fornecedores, estoque,
pedidos e contas a receber. Confirmar um pedido reserva saldo; concluí-lo registra
a saída e origina o título na mesma transação. Recebimentos integrais e estornos
são declarações manuais, sem integração bancária. Os contratos estão em
[pessoas](docs/PESSOAS-PERSISTENTES.md),
[estoque](docs/ESTOQUE-PERSISTENTE.md) e
[pedidos e financeiro](docs/PEDIDOS-FINANCEIRO.md).

Usuários existentes podem ter a associação e os papéis alterados com controle
de revisão. Papéis oferecem criação idempotente, alteração e exclusão autorizadas.
Os [contratos e limites de acessos](docs/API-ACESSOS.md) detalham as operações,
a proteção do último administrador e a pendência de convites no Auth.

Para a web, use as variáveis de `apps/web/.env.example` no ambiente do Next.js
(ou em `apps/web/.env.local` no desenvolvimento). A API Rust lê variáveis do
processo: copiar um arquivo `.env` não as exporta automaticamente para o Cargo.
Nunca publique os segredos como variáveis `NEXT_PUBLIC_`.

O [estado atual e as pendências](docs/STATUS-ERP.md) distinguem frontend
demonstrativo, persistência testada e integração com serviços reais.

A [continuidade fiscal e devoluções](docs/RETORNOS-E-CONTINUIDADE-FISCAL.md)
acrescenta cancelamento comercial, estorno de recebimentos de compra, emissão e
eventos NF-e 55/SP em homologação com adaptador interno, distribuição DF-e,
manifestação e conversão de XML em compra. O recorte de regras fiscais e a
configuração do motor estão documentados; não há inferência de tributação.
Mantenha `NFE_PRODUCTION_ENABLED=false`. Testes locais não substituem homologação
com certificado real nem publicam a funcionalidade em produção.

## Domínios planejados

O [verificador de rotas e fluxos](verification/README.md) gera um inventário
atualizado e relatórios locais com `pnpm verify:erp`. A descoberta estática não
aprova fluxos; probes e suítes de integração são registrados separadamente.

Plataforma, Cadastros, Comercial, Estoque, Financeiro, Fiscal, Logística e Serviços. Um domínio não escreve diretamente nas tabelas de outro domínio.

