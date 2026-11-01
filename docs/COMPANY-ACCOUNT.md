# Conta da empresa e assinaturas

As configurações começam em `/preferencias`. A categoria Empresa oferece Geral
e Alterar dados da empresa. Esta última tem menu lateral para cadastro, sócio,
senha, horários, pagamento, extrato, armazenamento, importações, planos e
cancelamento. Em telas pequenas, o menu é recolhido por um botão acessível.

## Cadastro

O cadastro continua usando `/api/v1/company`, revisão via ETag/If-Match,
permissões `platform.company.read` / `platform.company.manage`, auditoria e RLS.
Nome e celular do sócio são campos próprios no JSON de `company_profiles`.
Omissão por clientes antigos preserva esses campos; string vazia os limpa.
O contato comercial e o usuário do Ávila Auth permanecem independentes.
Alterar senha abre `/trocar-senha` no issuer configurado do Ávila Auth.

## Mercado Pago

O token pertence ao backend Rust. Configurar no gerenciador de segredos:

- `ERP_MP_ACCESS_TOKEN`: token da aplicação Mercado Pago da Ávila ERP.
- `ERP_MP_RETURN_URL`: URL HTTPS de retorno, normalmente
  `https://erp.avilaops.com/preferencias/empresa/conta/plano`.

Não usar token de outro produto sem confirmar a conta recebedora. Não colocar
credenciais no frontend, Git ou documentação. Sem token, as telas continuam
acessíveis e as ações comerciais ficam indisponíveis.

A consulta somente de leitura ao conector Mercado Pago encontrou a aplicação
`Avila Ops Checkout` (`263854325624775`), descrita como cobrança de serviços e
mensalidades da Ávila Ops. Nenhuma credencial foi lida ou alterada nesta entrega;
confirmar a aplicação recebedora ao configurar o ambiente.

Aplicar a migration `202611010006_company_subscriptions.sql` pelo processo de
release existente. Build e publicação são feitos pelo GitHub Actions.

O catálogo inicial foi autorizado pelo responsável pelo produto em 01/11/2026:

| Plano | Mensalidade | Dados | Usuários |
| --- | --- | --- | --- |
| Cobalto | R$ 60,00 | 60 MB | 5 |
| Titânio Faixa 1 | R$ 120,00 | 120 MB | 50 |
| Titânio Faixa 2 | R$ 200,00 | 360 MB | 50 |
| Titânio Faixa 3 | R$ 450,00 | 1.200 MB | 50 |
| Diamante | R$ 650,00 | 1.800 MB | 100 |
| Elite | A partir de R$ 1.250,00 | 5.000 MB | Ilimitado |

Elite exige proposta comercial e não oferece contratação automática. Somente
Cobalto tem franquia de importações definida nas referências: 200 pedidos/mês.
Os demais limites de importação não foram inferidos.

### Fluxos implementados

- GET `/api/v1/company-account`: catálogo, assinaturas vinculadas, usuários
  ativos e tamanho armazenado das fotos dos produtos da empresa.
- POST `/checkout`: reserva uma contratação no PostgreSQL antes de chamar
  `POST /preapproval` com `status=pending`. Preço e moeda vêm do catálogo Rust.
  O frontend só envia o identificador do plano e o e-mail do pagador.
- POST `/refresh`: consulta `GET /preapproval/{id}`. Uma criação incerta é
  reconciliada pela referência local com `/preapproval/search`, sem repetir POST.
- POST `/change-plan`: exige assinatura autorizada, confirma o novo valor na
  interface e altera o valor recorrente. Não calcula proporcional nem estorno.
- GET `/invoices`: consulta `/authorized_payments/search` para uma assinatura
  que pertença à empresa. Paginação de dez cobranças e exportação CSV da página.
- POST `/cancel`: exige confirmação `CANCELAR` e consulta o estado do provedor.
  Cancela a assinatura no Mercado Pago; não exclui cadastros nem estorna valores.

Todos os recursos exigem usuário autenticado e empresa ativa. As mutações
exigem `platform.company.manage`. O BFF verifica origem e empresa da sessão;
o Rust revalida as permissões. IDs de provedor são obtidos no banco, nunca
aceitos do navegador. Referência, ID, moeda, recorrência e valor são verificados
na resposta. O link de checkout aceita apenas HTTPS no host e caminho esperados.

Uma reserva de contratação permanece bloqueada se a resposta da criação for
incerta. “Atualizar assinatura” tenta reconciliar. Se não houver resultado único,
o administrador deve conferir o provedor antes de resolver a reserva. Não apagar
a reserva ou reenviar a criação sem essa conferência: isso pode duplicar cobranças.
Uma rejeição explícita de criação (HTTP 400, 401, 403, 404 ou 422) é registrada
como `rejected` e permite nova tentativa corrigida. Timeouts, 429, falhas de rede
e erros de servidor mantêm a reserva.

### Limites atuais

- A consulta do estado é explícita por “Atualizar assinatura”; esta entrega não
  possui webhook ou sincronização periódica. O retorno do checkout nunca é
  interpretado como pagamento aprovado ou autorização.
- As franquias são dados comerciais. Não há bloqueio automático de operação por
  plano, medição consolidada de armazenamento ou de importações por origem.
- Fotos representam apenas seu tamanho codificado no banco; não representam todo
  o armazenamento. A interface não mostra percentual total nem uma falsa série
  mensal de importações com zeros.
- Horários de acesso, NFS-e da assinatura, mudança do meio de pagamento já
  autorizado, contratação de espaço adicional e exclusão da conta não foram
  implementados. A interface não apresenta essas ações como concluídas.
- A configuração de marca e os campos adicionais da referência que não pertencem
  ao cadastro existente (faturamento anual e quantidade de funcionários) continuam
  fora deste contrato.

## Histórico de atividades

Em `/preferencias/seguranca`, ações e áreas usam descrições em português. Os
filtros oferecem as mesmas descrições e preservam os códigos esperados pela API.
Os identificadores originais ficam recolhidos em “Informações para o suporte”.
Eventos desconhecidos aparecem como “Atividade registrada”, sem inferir o
resultado de uma operação. Datas e filtros mantêm o contrato UTC existente.

## Verificação automatizada

Os testes de navegador interceptam APIs e usam sessão sintética. Os testes Rust
usam PostgreSQL isolado, papel sem bypass RLS e um servidor HTTP local que simula
o Mercado Pago. Eles não criam assinaturas ou cobranças reais.

Antes de ativar cobrança em produção, verificar o checkout com as credenciais e
contas de teste do próprio Mercado Pago, a conta recebedora e a URL de retorno.
Publicação de código e teste com provedor simulado não comprovam cobrança real.

Referências oficiais:

- [Assinatura com pagamento pendente](https://www.mercadopago.com.br/developers/pt/docs/subscriptions/integration-configuration/subscription-no-associated-plan/pending-payments)
- [Atualizar assinatura](https://www.mercadopago.com.br/developers/pt/reference/online-payments/subscriptions/update-preapproval/put)
- [Consultar faturas](https://www.mercadopago.com.br/developers/pt/reference/online-payments/subscriptions/authorized-payment-search/get)
