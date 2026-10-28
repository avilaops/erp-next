# Cadastro autônomo de empresas

Contrato registrado no Linear antes de alterar o esquema. Desenvolvimento sem execução de migrations ou deploy em produção.

A identidade é confirmada pelo userinfo do Auth antes de qualquer acesso. GET /api/v1/companies lista apenas empresas ativas com vínculo ativo do sub autenticado, sem exigir X-Tenant-Id. POST na mesma rota recebe CompanyData e Idempotency-Key UUID: valida dados, cria empresa, perfil, vínculo, administrador local, auditoria e outbox atomicamente. Nunca concede acesso a empresa existente por e-mail ou CPF/CNPJ.

Repetir chave e dados devolve o mesmo resultado sem novos efeitos; mudar os dados da chave retorna 409. Documento indisponível retorna conflito genérico sem identificar a empresa existente. Qualquer erro desfaz a transação. Os testes devem usar papel PostgreSQL NOSUPERUSER NOBYPASSRLS no GitHub CI.

Plano: primeiro testes de contrato e isolamento; depois políticas de leitura por identidade e criação transacional; em seguida login sem empresa prévia, cadastro e seleção no web; por fim CI, revisão e atualização do Linear. Nenhum envio real, emissão fiscal ou ativação em produção faz parte deste módulo.

## Implementação

- Login sem seleção explícita ignora ERP_DEFAULT_TENANT_ID e consulta empresas após a autenticação. Zero empresas abre /cadastro/empresa; uma seleciona automaticamente; várias abrem /empresas.
- /api/erp/companies encaminha GET/POST com token apenas no servidor. POST /api/auth/company verifica origem e vínculo na API antes de cifrar a seleção, preservando expiresAt.
- As páginas exigem sessão de identidade. Cadastro e seleção não expõem tokens, não enviam convites e não habilitam emissão fiscal.
- PostgreSQL mantém FORCE RLS. As políticas adicionais de descoberta são somente SELECT, com identidade transacional confirmada pelo Auth, sem remover isolamento por empresa. Nenhuma migração foi executada fora da CI.
- O catálogo passa a 64 operações da API e 54 operações BFF. As 28 famílias pendentes do roadmap permanecem pendentes; este módulo não conclui P0 nem o backend inteiro.

Testes: PostgreSQL com papel NOSUPERUSER NOBYPASSRLS cobre descoberta, documentos indisponíveis, identidade nova com e-mail coincidente, concorrência/repetição e rollback de auditoria/outbox. Navegador usa Auth/API sintéticos para verificar roteamento OIDC, sessão de identidade, recusa de origem/vínculo, expiração preservada e recuperação do cadastro. A validação do fluxo com provedores reais depende da ativação posterior, autorizada apenas após terminar o backend.

O workflow mantém os dois jobs existentes, usa Chrome do runner e limita o trabalho de cada job a 65 segundos, reservando tempo para inicialização e encerramento. Não foram adicionados jobs de release ou deploy.

Acompanhamento: AVL-367, PR #5 baseado no PR #4 de contratos.
