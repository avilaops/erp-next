# Módulos configuráveis do ERP

## Contrato da iniciativa

As opções indisponíveis das áreas Sistema, Vendas e Notas Fiscais serão
entregues como cortes verticais. Uma opção só recebe destino no catálogo depois
de possuir persistência real, autorização por empresa, isolamento RLS e testes.
Telas locais, valores demonstrativos ou formulários sem efeito não contam como
implementação.

Cancelamento, rejeição, reversão e exclusão são eventos diferentes. Consultas
administrativas preservam essa distinção e não oferecem restauração genérica de
documentos fiscais, movimentos ou registros cujo histórico deve ser imutável.

Configurações fiscais não presumem regime, CRT, série, numeração, ambiente, CSC,
CFOP, CST, CSOSN ou tributação. A ativação depende de valores informados e das
permissões específicas já adotadas pelo domínio fiscal.

## Lotes

1. Administração: exclusões, arquivos, relatórios, etiquetas, transições e
   campos customizados.
2. Comercial: configurações de propostas e frente de caixa, seguidas da
   persistência operacional do PDV.
3. Fiscal: NFC-e, inutilizações, correções e naturezas de operação.
4. Integração final: catálogo, regressão, migrations, release e validação
   autenticada.

## Entrega atual

- Consulta de exclusões realizadas usa a auditoria append-only existente e
  inclui somente ações concluídas com sufixo `deleted` ou `removed`.
- Cancelamentos comerciais e fiscais permanecem fora dessa consulta.
- A consulta exige `platform.audit.read` e nunca expõe detalhes, identificadores
  internos ou metadados privados da auditoria.
- O Gerenciador de arquivos consulta, filtra e pagina os metadados atuais e os
  arquivos imutáveis preservados do ERP anterior, sempre com isolamento RLS.
- Conteúdo legado pode ser baixado pela rota autenticada. Binários atuais
  continuam no storage que os originou; o PostgreSQL não recebe uma cópia
  artificial e a interface não promete upload sem storage configurado.
- O arquivamento altera somente o metadado atual, exige `If-Match`, incrementa a
  revisão e registra auditoria/outbox. Não apaga conteúdo, versões ou legado.
- O Gerenciador de transições mantém definições versionadas por empresa. Apenas
  rascunhos podem ser editados; versões publicadas são imutáveis e podem ser
  arquivadas, sem reabertura.
- Estados finais não aceitam transições de saída. Cada transição referencia uma
  permissão existente e pode exigir motivo.
- Essas definições são configuracionais: não substituem nem alteram as máquinas
  de estado de vendas, fiscal, estoque, produção ou pagamentos.
