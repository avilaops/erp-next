# Contratos comerciais Ávila Ops

## Fluxo

Pedido → Contratos → Gerar contrato → Revisar → Enviar para assinatura →
Atualizar andamento → Abrir/baixar PDF assinado e trilha de assinatura.

- Pedido: `/vendas/pedidos/{id}/contratos`.
- Geração: `/vendas/pedidos/{id}/contratos/novo`.
- Contrato: `/servicos/contratos/{id}`.
- Cliente: `/cadastros/clientes-fornecedores/{id}/contratos`.
- Listagem geral: `/servicos/contratos`.

TSX cuida dos formulários; o BFF autentica a sessão, confere origem e tenant;
Rust autoriza, persiste e acessa a API HTTPS da instalação própria.
Não usa a API de contratos do laboratório nem o banco interno do DocuSeal.
Nenhuma operação fiscal é acionada.

## Instalação verificada em 29/10/2026

- Host SSH `apps-noclient`: `204.168.249.111`, usuário `root`.
- Diretório `/opt/contrato-avilaops-com/docuseal`, Compose `compose.yaml`.
- Container `contrato-docuseal-app`, imagem DocuSeal `3.3.3`, porta local 3111.
- Fonte em `source/`, remote `https://github.com/docusealco/docuseal.git`,
  SHA `8f8f69f0bc6ac2e59746cd6efac54a852289bec3`.
- Dados locais `./data` e PostgreSQL próprio `./pg_data`; não consultar esse
  banco como mecanismo de integração.
- `/api/templates` responde 401 sem chave. Nenhum segredo foi encontrado no
  arquivo de ambiente da implantação além da configuração do banco.
- SMTP é configurado na aplicação, em `/settings/email`. A ausência de SMTP no
  ambiente Docker não comprova ausência da configuração na aplicação.
- A API básica e webhooks existem na edição aberta. Assinatura incorporada e
  editor incorporado são recursos Pro e não são usados por esta implementação.

Referências oficiais:
[fonte e recursos](https://github.com/docusealco/docuseal/tree/3.3.3),
[API](https://www.docuseal.com/docs/api),
[termos de atribuição](https://github.com/docusealco/docuseal/blob/3.3.3/LICENSE_ADDITIONAL_TERMS).

## Configuração privada

Somente `api.env` do backend recebe:

```dotenv
DOCUSEAL_URL=https://contrato.avilaops.com
DOCUSEAL_API_TOKEN=<chave da nossa instalação>
DOCUSEAL_WEBHOOK_SECRET=<segredo aleatório com pelo menos 32 caracteres>
DOCUSEAL_TENANT_TEMPLATES={"<uuid-da-empresa>":[<id-do-modelo>]}
```

Não configurar essas variáveis no web, não usar prefixo `NEXT_PUBLIC_`, não
versionar valores e não usar chaves de `api.docuseal.com`. Sem configuração, a
tela informa que os modelos da empresa ainda não estão disponíveis.
Cada empresa só enxerga os IDs explicitamente associados a ela. A chave pode
consultar mais modelos, mas o ERP não os enumera nem aceita IDs livres.

Criar o webhook na interface da nossa instalação:
`https://erp.avilaops.com/api/webhooks/contracts/{uuid-da-empresa}`.
Configurar o cabeçalho secreto `X-Avila-Contract-Secret` com o mesmo segredo do
backend. A versão 3.3.3 permite cabeçalhos secretos personalizados e também
oferece HMAC; esta integração usa o cabeçalho personalizado sobre HTTPS.
Selecionar eventos de submissão e de formulário. O backend autentica, deduplica
e consulta o estado atual via API; não aplica estados recebidos cegamente.

## Modelos e campos

Usar modelos reais com nomes de campos únicos e papéis de assinatura definidos.
O primeiro papel recebe inicialmente nome e e-mail do cliente, editáveis na
conferência de destinatários. Outros papéis precisam de preenchimento explícito.

| Campo no modelo | Dado do ERP |
| --- | --- |
| `empresa_nome`, `empresa_documento`, `empresa_endereco` | Empresa ativa |
| `cliente_nome`, `cliente_documento`, `cliente_email`, `cliente_endereco` | Cliente e endereço principal |
| `pedido_numero`, `pedido_total`, `vencimento` | Pedido e vencimento financeiro |
| `itens` | Itens, unidades, quantidades e valores fixados no pedido |
| `condicoes`, `entrega` | Preenchimento explícito quando não disponível no pedido |

Os dados disponíveis no ERP são resolvidos novamente no backend. Campos
comerciais preenchidos são enviados como somente leitura ao provedor. Assinatura
e rubrica ficam para o signatário. Campos comerciais textuais, data, número,
telefone e seleção simples são aceitos; tipos complexos exigem um modelo
compatível. Campos obrigatórios ausentes bloqueiam a geração.

## Persistência e confirmação

- Snapshot, modelo e destinatários ficam imutáveis, protegidos por trigger.
- RLS e FKs compostas vinculam tenant, cliente e pedido.
- A criação registra uma intenção durável antes de chamar o provedor com
  `send_email=false`. O `external_id` de cada signatário contém a referência ERP.
- Repetir o comando ou o mesmo conteúdo retorna o contrato existente.
- Após timeout, somente consultas de reconciliação são feitas. Ausência de
  resultado não autoriza nova criação; problemas permanecem visíveis.
- A revisão exige permissão `sales.contracts.send`, além de gestão de pedidos.
  O envio exige revisão e compara o hash da prévia atual com a que foi revisada.
- Um envio reivindicado nunca é repetido automaticamente. Se o processo falhar
  entre destinatários, o andamento permanece pendente e exige conferência
  operacional. Não existe botão de reenvio automático nesta entrega.
- `sent_at` sozinho não comprova transmissão: o ERP exige o evento `send_email`,
  que nesta versão é gravado após `mail.deliver_now!`. Isso não comprova entrega
  na caixa de entrada. Erros de fila e SMTP detalhados permanecem no portal;
  o ERP exibe a ausência de confirmação e problemas da integração.
- Webhooks repetidos são deduplicados. Eventos antigos consultam o estado atual
  e não regridem conclusão já confirmada.
- Prévia, PDFs assinados e trilha são preservados em `commercial_contract_files`,
  com SHA-256, RLS, acesso autenticado, limite de 20 MiB por arquivo e dez PDFs.
  Seguem o armazenamento privado já usado para arquivos legados e entram no
  backup do banco ERP. URLs do provedor não são retornadas ao navegador.
- A atualização pode ser solicitada na interface; webhooks mantêm o estado sem
  depender da tela aberta. Falhas de arquivamento permitem nova consulta segura.

## Publicação e validação

Build e testes no workflow `production-release.yml`, por SHA exato. Depois,
`production-migrate.yml` com `schema_only=true`, usando o release aprovado.
O runner GitHub aplica o schema e as permissões do papel runtime; nunca executar
migrations ou compilar no servidor `applications`.

`contracts_tests.rs` verifica RLS, vínculo com pedido/cliente, snapshot, envio sem
revisão, resposta perdida, repetição, webhook duplicado/antigo e PDFs preservados.
`contracts-ui.spec.ts` verifica o percurso TSX/BFF com servidor de teste isolado.
Esses testes não são prova de envio ou assinatura real.

Para validar a instalação real ainda são necessários a chave, um modelo real
associado à empresa, e-mail confirmado na aplicação e autorização explícita do
destinatário e documento. Assinatura deve ser feita pelo destinatário, nunca
simulada em nome dele. Registrar separadamente versão publicada, configuração,
solicitação gerada, transmissão observada e assinatura concluída.
