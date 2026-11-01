# Preferências: fila por etapas

Solicitação do usuário em 01/11/2026, com dez capturas das preferências do ERP.
Acompanhamento em `https://ml.avilaops.com/experiments/flows` e AVL-372.

Novos formulários devem deixar valores e escolhas de configuração para o
usuário preencher. Uma página, link ou captura de código não comprova operação
validada. Cada etapa deve registrar código, testes, versão publicada e limites.

| Frente | Pendências observadas nas capturas | Dependências e aceite |
| --- | --- | --- |
| Sistema | Exclusões, arquivos, relatórios, etiquetas, transições e campos customizados | Definir retenção, permissões e modelo por recurso; manter auditoria existente |
| Cadastros | Configurações de pessoas/produtos e tipos de contatos | Regras consumidas pelo cadastro real, com revisão e isolamento por empresa |
| Suprimentos | Estoque, compras, grupos de tags, tags, grupos de produtos e depósitos demonstrativos | Estoque por depósito e transferências conservando quantidades; integração com compras |
| Vendas | Parâmetros dos pedidos, propostas e frente de caixa | Primeira etapa: mínimo, prazo e contato na confirmação; propostas/PDV exigem persistência e reconciliação próprias |
| Fiscal | NFC-e, consulta consolidada de inutilizações/correções e naturezas de operação | Separar consulta dos eventos existentes de nova emissão; validar integrações fiscais com evidência própria |
| Finanças | Conta digital, Pix, taxas, importação, caixa e integrações de pagamento | Definir provedor e credenciais; conciliar eventos idempotentes e preservar lançamentos |
| Serviços | NFS-e, ordens de serviço, cobranças e CT-e | Definir documento/provedor e ciclo da ordem; preservar modelos e contratos operacionais existentes |
| Logística | Configurações e integrações logísticas | Contratos com provedores, estados de envio e rastreio sem marcar entrega por inferência |
| Contabilidade | Espaço do contador demonstrativo | Acesso autorizado e exportações com origem, período e conciliação demonstráveis |
| Importação e exportação | Produtos, vínculo multilojas, composições, campos, balança, listas de preços, contatos, compras, movimentos em massa, fornecedores, vendas e backup | Começar por produtos com prévia, erros por linha, deduplicação e exportação por empresa; AVL-379/AVL-380 |

## Etapa iniciada: configurações de Vendas

`/preferencias/vendas` e `/api/v1/sales-settings` armazenam os três parâmetros
por empresa. Ao confirmar pedido, o servidor verifica valor, prazo e contato
antes de reservar estoque. Campos sem configuração começam vazios; nenhum valor
de negócio é definido pela implementação. Falha na auditoria desfaz a gravação
e a outbox na mesma transação. Regras novas não reavaliam a conclusão de um
pedido já confirmado.

Os demais itens permanecem pendentes no catálogo de fluxos. Serão habilitados
conforme cada operação for implementada e validada.
