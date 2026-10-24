# ERP Next

Novo ERP modular da Ávila Ops. O sistema nasce separado do ERP legado e usa um monólito modular para preservar transações, contratos entre domínios e rastreabilidade.

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
3. Execute `cargo run -p erp-next-api`.
4. Em outro terminal, execute `npm --prefix apps/web run dev`.

Endpoints iniciais:

- `GET /health/live`: processo ativo.
- `GET /health/ready`: API conectada ao PostgreSQL.

## Domínios planejados

Plataforma, Cadastros, Comercial, Estoque, Financeiro, Fiscal, Logística e Serviços. Um domínio não escreve diretamente nas tabelas de outro domínio.

