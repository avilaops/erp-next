# Configurações de cadastros e perfis tributários

Preferências / Cadastros oferece configurações de produtos (exigir NCM/CEST), clientes e fornecedores (exigir e-mail/telefone), sugestões de áreas/cargos dos contatos adicionais e perfis tributários. Exigências são verificadas na API nos próximos salvamentos; não reescrevem registros existentes. Tipos de contato são sugestões de preenchimento do campo área/cargo, sem alterar cliente/fornecedor nem conceder acesso ao ERP.

GET/PUT `/api/v1/registration-settings/{section}` aceita somente `products`, `parties`, `contact-types`, `tax-profiles`. PUT exige `platform.company.manage`, contexto da empresa e If-Match; a gravação tem auditoria e RLS forçada. Nenhum perfil é criado implicitamente para outras empresas.

O botão de preenchimento da Ludus prepara dois perfis editáveis: mercadorias importadas e adquiridas no Brasil, ambos com PIS 1.6500, COFINS 7.6000, CST IBS/CBS `000`, cClassTrib `000001`, conforme as informações fornecidas pelo cliente/contador. O usuário deve salvar para persistir na empresa ativa. Esses valores são declarações fornecidas, não determinação tributária pelo sistema.

No rascunho da NF-e, selecionar e aplicar um perfil copia natureza, referência/revisão, PIS, COFINS, CST IBS/CBS e cClassTrib. Outros campos são preservados e, quando ausentes, continuam pendentes. A classificação como importado não presume origem 1/2/6/7, CFOP, NCM, ICMS ou IPI. Regras e validações existentes da emissão continuam ativas. Aplicar um perfil não transmite nem reserva numeração. Notas históricas conservam sua cópia das declarações; editar ou remover um perfil não altera notas.

Aplicar a migração 202611030001 antes de publicar a API. Cadastro de equipe permanece no módulo de acessos, separado dos contatos de clientes/fornecedores.
