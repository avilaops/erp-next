# AVL-111 — vínculos comerciais de CT-e conferido

O critério de aceite exige vincular transportadora, frete e compra/venda
mediante conferência. O PR #76 registra fatos locais do XML; este trabalho
acrescenta associações manuais a registros comerciais existentes do tenant.
O objetivo dos seis tickets continua integral, incluindo homologação externa.

## Comportamento

- Na conferência de um CT-e, mostrar vínculos ativos e o total de frete
  associado. Escolher explicitamente compra ou venda existente, transportadora
  e valor; registrar justificativa de conferência com 3–500 caracteres.
- A transportadora cadastrada deve estar ativa e ter o mesmo CNPJ do XML.
  Se o emitente for a própria empresa, representar essa condição sem exigir
  cadastro duplicado de si mesma. Não criar pessoa automaticamente.
- Oferecer compras confirmadas, parcialmente recebidas, recebidas ou fechadas;
  vendas confirmadas ou concluídas. Rascunhos e cancelados não recebem vínculo.
  A permissão de leitura do domínio comercial correspondente é obrigatória.
- A associação é uma decisão humana. Referências NF-e do XML ajudam a conferir,
  mas não provam por si só qual pedido corresponde. Não inferir pedido pelo
  fornecedor, cliente, valor ou primeira chave coincidente.
- Cada vínculo possui valor exato de frete, inclusive zero. A soma dos vínculos
  ativos não pode exceder o valor da prestação do CT-e. Não duplicar vínculo
  ativo do mesmo CT-e/pedido. Até 50 vínculos ativos por documento.
- Desfazer vínculo exige justificativa e conserva seu registro original.
  O usuário pode corrigir associação/valor desfazendo e criando outro vínculo.
- XML, cursor e conferência permanecem imutáveis. Não alterar pedidos, custos,
  estoque, contas a pagar/receber, tributos ou situação fiscal externa.

## Garantias

- Exigir conferência atual `cte-received-v1`, hash do XML e CNPJ da empresa
  iguais aos da captura. Somente ambiente de homologação suportado.
- Leitura: `fiscal.cte.read`. Comandos: também `fiscal.cte.link`, leitura de
  pessoas e leitura da compra/venda alvo. Não conceder a nova permissão no
  onboarding automaticamente. Opções comerciais obedecem às mesmas leituras.
- Usar Idempotency-Key e If-Match da revisão agregada do documento. Serializar
  comandos pelo lock de tenant existente; conferir alvo atual dentro da mesma
  transação. Resposta incerta deve permitir repetir exatamente o comando.
- Persistir vínculo/desfazimento, comando, auditoria e outbox atomicamente.
  RLS forçada, FKs compostas por tenant e registros append-only.
- Na tela, revalidar tenant, usuário e permissões atuais antes/depois do I/O;
  descartar resultados de contexto anterior. Listar opções paginadas, sem
  entrada manual de UUID. Preservar edição após conflito para reconferência.
- Testes, formatação, Clippy e compilação Rust somente no GitHub Actions.
  Sem migração, habilitação fiscal, merge ou deploy de produção nesta etapa.

## Verificação

Exercitar HTTP com PostgreSQL/RLS reais: permissões, precondições, empresa
divergente, conferência ausente, transportadora/alvo incompatíveis, limites,
duplicidade, replay, concorrência e rollback de auditoria/outbox. Verificar
que pedidos/estoque/financeiro/XML/cursor não sofrem alteração. Na UI, testar
associação/desfazimento explícitos, erro/conflito/retry e troca de contexto;
conferir 320, 390, 768, 1280 e 1920 px.
