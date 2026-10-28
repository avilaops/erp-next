# Cadastro autônomo de empresas

Contrato registrado no Linear antes de alterar o esquema. Desenvolvimento sem execução de migrations ou deploy em produção.

A identidade é confirmada pelo userinfo do Auth antes de qualquer acesso. GET /api/v1/companies lista apenas empresas ativas com vínculo ativo do sub autenticado, sem exigir X-Tenant-Id. POST na mesma rota recebe CompanyData e Idempotency-Key UUID: valida dados, cria empresa, perfil, vínculo, administrador local, auditoria e outbox atomicamente. Nunca concede acesso a empresa existente por e-mail ou CPF/CNPJ.

Repetir chave e dados devolve o mesmo resultado sem novos efeitos; mudar os dados da chave retorna 409. Documento indisponível retorna conflito genérico sem identificar a empresa existente. Qualquer erro desfaz a transação. Os testes devem usar papel PostgreSQL NOSUPERUSER NOBYPASSRLS no GitHub CI.

Plano: primeiro testes de contrato e isolamento; depois políticas de leitura por identidade e criação transacional; em seguida login sem empresa prévia, cadastro e seleção no web; por fim CI, revisão e atualização do Linear. Nenhum envio real, emissão fiscal ou ativação em produção faz parte deste módulo.
