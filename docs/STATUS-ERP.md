# Estado de implementação do ERP

## Continuidade local de 31/10/2026 — AVL-396

As novas implementações de devolução, emissão/eventos, distribuição e conversão
de recebidas estão descritas em [continuidade fiscal](RETORNOS-E-CONTINUIDADE-FISCAL.md).
A etapa seguinte acrescenta [comissões, produção e declaração CRT 3](COMISSOES-PRODUCAO-E-FISCAL.md).
São entregas locais para revisão; não representam publicação nem homologação
real. As contagens e limitações da consolidação abaixo são históricas e
antecedem essas entregas.

## Consolidação local de 28/10/2026

A [interface de compras e contas a pagar](COMPRAS-CONTAS-PAGAR-INTERFACE.md)
conecta pedidos, recebimentos parciais, cancelamento/encerramento e registros
de pagamento/estorno ao backend existente. Notas de entrada e sugestões de
reposição continuam demonstrativas. As contagens históricas abaixo antecedem
essa extensão do BFF.

As branches de desenvolvimento foram reunidas na `main`, incluindo cadastro
autônomo de empresas, endereços/contatos, funcionários/vendedores, cadeia de
compras e pagamentos, integração de recebidas/Lojas, recuperação SEFAZ e
observabilidade. A tela de chaves de serviço prevista na AVL-360 foi concluída
para os testes de navegador presentes na branch. Os resultados e limites desta
rodada constam em [consolidação local](../evidencias/consolidacao-local-2026-10-28.md).

O inventário consolidado contém 90 operações Rust e 61 BFF, com 25 famílias
pendentes e `p0Ready=false`. A migration fiscal recebeu a versão
`202610280005`, pois `202610280001` já pertence ao onboarding. Esta ordenação
foi validada em banco novo isolado; não é procedimento de atualização de um
banco que tenha aplicado a migration fiscal de uma branch com a versão antiga.

Os registros de 27/10 abaixo preservam o contexto anterior. A incorporação das
branches não significa implantação ou conclusão dos contratos fiscais: geração
de DANFE no GET, escopo de ambiente/paginação e ciclo de vida de credenciais
ainda diferem do desenho fiscal completo.

Verificação local de 27/10/2026, no checkout `erp-next`. Este arquivo acompanha
o código atual; os documentos transferidos anteriormente para `.old/` foram
preservados e continuam como referência arquitetural e de escopo.

## Primeiro fluxo com persistência

`Preferências > Empresa > Dados da empresa` lê e grava pela API Rust, com
PostgreSQL e contexto transacional de empresa. O resumo da empresa usa a mesma
API e não apresenta mais uma empresa fictícia nem percentual de conclusão.

- `GET /api/v1/company`: associação ativa, permissão de consulta, ETag e revisão.
- `PUT /api/v1/company`: permissão de alteração, validação, If-Match obrigatório.
- Duas gravações com a mesma revisão: uma confirma e a outra recebe HTTP 412.
- Empresa, perfil, auditoria e outbox são gravados na mesma transação.
- O navegador preserva a edição recusada e exige confirmação para descartá-la.
- Perfis e empresas possuem RLS forçada. A aplicação foi exercitada com um
  papel PostgreSQL sem superusuário nem BYPASSRLS.
- O contrato `/openapi.json` é gerado pelo Utoipa para os recursos implementados.
- O servidor HTTP não aplica migrações: `erp-next-api migrate` é um comando
  separado, executado com a conta autorizada a alterar o esquema.

O BFF do Next.js mantém o access token em cookie HttpOnly criptografado com
AES-GCM. A autenticação usa authorization code com PKCE S256 e validação de
state. O token é confirmado pela API no userinfo do Auth; os direitos de empresa
permanecem no ERP. O fluxo não usa o conteúdo de um ID token como identidade.
Cookies usam Secure em HTTPS e SameSite=Lax. Alterações pelo BFF verificam a
origem e se a empresa exibida continua sendo a da sessão.

## Gestão de usuários e papéis

As telas `/preferencias/usuarios` e `/preferencias/papeis` consultam a API real.
É possível editar situação e papéis das associações existentes e criar,
alterar ou excluir papéis não atribuídos. Nome e e-mail continuam sob
responsabilidade do Auth. Convites não são simulados nem enviados.

As gravações usam revisão, autorização atual, auditoria e outbox na mesma
transação. A criação de papel exige chave de idempotência. O ERP recusa
delegação além dos direitos do operador, bloqueio próprio e remoção do último
administrador local, inclusive em alterações simultâneas. Uma associação
pendente não pode contornar a confirmação no Auth por bloqueio e reativação.
A escrita de empresa passou a recarregar os direitos depois do bloqueio
transacional, para respeitar revogações ocorridas enquanto aguardava.

Os [contratos e limites](API-ACESSOS.md) detalham recursos e precondições.
O catálogo de produtos presente no checkout também recebeu proteção de sessão
na renderização e testes de navegador sobre criação, edição e consulta.

## Evidências e seus limites

- 47 testes Rust aprovados, incluindo cenários HTTP com PostgreSQL real para
  empresa, acessos, catálogo, estoque, fiscal, pessoas, pedidos e recebíveis.
- 29 testes de navegador passaram com API Rust, PostgreSQL, Next.js compilado
  no modo de produção e Auth explicitamente sintético: sete de acessos, três
  de catálogo, quatro de empresa, três de estoque, cinco de pessoas, seis
  de operações comerciais/financeiras e um da central de ajuda.
- 48 testes gerais de frontend passaram na rodada anterior, incluindo
  navegação, preferências, temas e rotas demonstrativas ainda presentes.
  Esse resultado anterior não representa uma nova execução nesta entrega.
- O harness confirmou persistência de empresa, papéis e associação de usuário,
  incluindo revisões, saldos, reservas, pedidos, contas e históricos de
  estoque/recebimentos após reinício do processo da API.
- Capturas desktop e móvel ficam em `evidencias/screenshots/`.
- Rustfmt, Clippy e as verificações web são executados antes da entrega;
  resultados finais e comandos constam na evidência desta rodada.

Esses testes não confirmam login de produção. O discovery público do Auth foi
consultado e anuncia os endpoints utilizados, mas este checkout não contém
as credenciais de um cliente ERP nem uma associação real provisionada.

A validação de CPF/CNPJ verifica formato e dígitos, sem consultar situação
cadastral. O CNPJ alfanumérico usa ASCII menos 48 e módulo 11 conforme o
[manual da Receita Federal](https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/documentos-tecnicos/cnpj/manual-dv-cnpj.pdf/@@download/file).
Isso não implementa apuração tributária, emissão fiscal ou aprovação de crédito.

## Notas fiscais recebidas e integração com o Lojas

O ERP Next agora possui o contrato de persistência para importar um `nfeProc`
autorizado cujo destinatário seja a empresa ativa. O XML original é append-only,
isolado por RLS e idempotente por empresa/chave de acesso. Credenciais de serviço
vinculadas à empresa são armazenadas apenas como SHA-256 e podem ser revogadas.

O Lojas pode listar as notas e baixar XML ou DANFE pelas rotas
`/api/v1/notas-recebidas`. A geração do PDF continua dependendo do serviço fiscal
configurado e mantém os limites de validação descritos na documentação de DANFE.

O [contrato, provisionamento e limites](INTEGRACAO-LOJAS-NOTAS-RECEBIDAS.md)
detalham o fluxo de importação. O [monitor fiscal canônico](MONITOR-FISCAL-CANONICO.md)
acrescenta distribuição NSU e manifestação explícita, desativadas por padrão até
configuração e aceite externo. A coleta não lança compras, contas a pagar ou
estoque, nem substitui uma consulta atual de cancelamento.

## Configuração do acesso real

1. Aplicar as migrações com uma conta própria para migração.
2. Provisionar empresa, identidade pelo `sub` real, associação ativa e papel
   com `platform.company.read/manage`. Para administrar acessos, o papel inicial
   também precisa de `platform.users.read/manage` e `platform.roles.read/manage`.
   Cada par representa duas permissões separadas.
3. Registrar o cliente confidencial do ERP no Auth, com callback exato
   `<ERP_WEB_ORIGIN>/api/auth/callback`, authorization code e PKCE S256.
4. Configurar as variáveis de `apps/web/.env.example` no ambiente do Next.js.
   O segredo da sessão precisa ter pelo menos 32 bytes aleatórios.
5. Configurar o processo Rust com conta de banco sem superusuário nem BYPASSRLS.
6. Validar login, associação, gravação e logout contra a implantação escolhida.

O logout encerra a sessão local do ERP. Não revoga a sessão global do Auth.
Não há renovação automática: ao expirar, é necessário entrar novamente.
Nenhum token deve usar prefixo `NEXT_PUBLIC_`.

## Pendências para terminar o ERP

| Frente | Estado real | Próxima entrega verificável |
| --- | --- | --- |
| Empresa | Persistência implementada e testada localmente | Provisionamento e teste com identidade real |
| Usuários, papéis e permissões | Gestão de associações e papéis conectada e testada localmente | Provisionamento real e convites conforme contrato do Auth |
| Produtos | API e formulário persistentes, verificados localmente | Completar o escopo de cadastro e os fluxos dependentes |
| Clientes e fornecedores | Cadastro persistente, papéis comerciais, contatos e revisão por empresa | Endereços e dados complementares conforme os fluxos dependentes |
| Tabelas auxiliares | Superfícies de frontend disponíveis | Persistência e invariantes do marco M1 |
| Estoque | Saldos, entradas, saídas, estornos manuais e reservas de pedidos conectados à API | Depósitos, inventário, lotes, produção e devoluções |
| Compras | Interfaces demonstrativas | Pedido e recebimento com efeitos transacionais no estoque |
| Pedidos de venda | Criação e edição de rascunho, reserva, cancelamento e conclusão com saída e título na mesma transação | Descontos, frete, devoluções e integração fiscal |
| Contas a receber | Títulos vinculados a pedidos, recebimento integral declarado e estorno persistentes | Recebimentos parciais, conciliação externa e integração bancária |
| Financeiro e comercial restantes | Interfaces demonstrativas | Contas a pagar, contas financeiras, caixa, propostas e canais |
| Fiscal | Preparação NF-e 55, DANFE, armazenamento de recebidas e monitor NSU com manifestação explícita por A1, desativado por padrão | Ativação/aceite externo do monitor, reconciliação de eventos desconhecidos, XML/XSD/XMLDSig/A1 para emissão e primeira autorização real |
| Logística e serviços | Superfícies previstas e demonstrativas | Contratos, adaptadores e integrações verificadas por domínio |
| Preferências restantes | Mocks e comportamento local | Contratos específicos e persistência por empresa |
| Implantação do ERP Next | Não realizada nesta rodada | Destino próprio, credenciais, migração, healthchecks e rollback |

O ERP completo não está concluído. O laboratório `experiments/` não foi alterado
para substituir os testes transacionais do ERP ou se tornar sua API de produção.

A [entrega de estoque conectado](ESTOQUE-PERSISTENTE.md) detalha o fluxo,
as garantias de idempotência e os limites de recuperação de rascunhos. A página
inicial deixou de exibir indicadores, séries e eventos fictícios; indicadores
sem fonte conectada permanecem indisponíveis, sem serem interpretados como zero.

O [cadastro de pessoas](PESSOAS-PERSISTENTES.md) e o
[fluxo pedido–reserva–conta a receber](PEDIDOS-FINANCEIRO.md) descrevem os
contratos operacionais. Concluir um pedido não emite NF-e nem comprova entrega;
registrar recebimento não comprova liquidação bancária. Essas fronteiras aparecem
nas telas correspondentes.

O [primeiro lote das pendências](EXECUCAO-RELATORIOS.md) acrescenta edição de
rascunhos com preservação de preços, revisão e repetição idempotente, além de
orientações funcionais na ajuda. Os comandos e resultados desta extensão estão
na [evidência de rascunhos e ajuda](../evidencias/erp-rascunhos-ajuda-2026-10-27.md).

A [entrega fiscal e seus limites](FISCAL-NFE-HOMOLOGACAO.md) descreve a preparação
da AVL-328. Rascunhos não possuem numeração, XML ou protocolo. O cadastro de um
alias A1 não verifica nem armazena um certificado. Nenhuma emissão está liberada.
