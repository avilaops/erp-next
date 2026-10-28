# Convites de usuários

Em Preferências > Usuários, use **Convidar usuário**, informe nome e e-mail e selecione os acessos da empresa.

- **Pode convidar e gerenciar usuários** adiciona o papel Gestor de usuários: consulta de empresa, consulta de papéis e consulta/gerenciamento de usuários. Outros módulos são concedidos pelos papéis adicionais.
- Quem convida só pode delegar permissões que possui. O convidado também fica sujeito a esse limite quando convida outras pessoas.
- O Auth central cria ou localiza a conta, libera o aplicativo ERP e envia o e-mail. Contas existentes usam a senha atual; contas novas recebem instruções de definição de senha.
- O ERP registra o convite antes de solicitar o envio. Falha ou resultado incerto do envio aparece na interface; não é apresentado como e-mail entregue. O serviço confirma envio, não recebimento na caixa do destinatário.
- Convites duram sete dias. Na listagem é possível reenviar, com intervalo mínimo de um minuto e limite adicional do Auth, ou cancelar. Após expirar, cancele e emita outro convite.
- A associação é ativada na descoberta de empresas, somente com e-mail confirmado pelo Auth. Os papéis e a autoridade atual de quem convidou são conferidos novamente. Aumento posterior das permissões do papel exige novo convite.
- Um convite nunca reativa uma associação bloqueada nem substitui papéis de uma associação existente. Bloqueio e papéis continuam na edição do usuário. Cancelar o convite não revoga o aplicativo ERP em outras empresas.

## Configuração privada da API

Defina `ERP_AUTH_CLIENT_ID`, `ERP_AUTH_CLIENT_SECRET` e `ERP_WEB_ORIGIN` também no ambiente privado da API. Use o cliente existente `erp-next`, cujo aplicativo é `erp`. `AUTH_ISSUER` identifica o Auth central. Não crie outro cliente nem altere o legado `erp`.

Sem credenciais de provisionamento, a API continua funcionando e a interface informa que o envio não está configurado. Não persista nem devolva ao navegador links de recuperação retornados pelo Auth.

## Persistência e publicação

A migração `202610280007_user_invitations.sql` cria o registro de convites, com RLS de empresa e descoberta por e-mail confirmado. Ações de criação, reenvio, cancelamento e aceitação geram auditoria e outbox. Chaves de idempotência evitam repetir o primeiro envio ao repetir a criação.

Publique as imagens aprovadas e aplique a migração pelo workflow de produção com `schema_only=true`, sem executar novamente a importação legada. Conceda ao papel de runtime acesso à nova tabela pelo mesmo workflow.
