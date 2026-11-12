# Propostas comerciais

[Todas as telas](../../../README.md) · [Vendas](../README.md)

Preparar um orçamento, acompanhar sua decisão e preservar as versões negociadas.

**Onde acessar:** `/vendas/propostas`.

## O que aparece na tela

- Cliente e produtos
- Quantidade, preço e acabamentos por item
- Validade
- Pagamento, entrega e observações
- Histórico de versões e situação

## O que você pode fazer

- Pesquisar e criar uma proposta
- Salvar e editar o rascunho
- Imprimir ou salvar PDF
- Enviar por e-mail quando disponível e autorizado
- Registrar envio, aceite, rejeição ou cancelamento
- Revisar uma versão ou converter uma proposta aceita em pedido

## Regras e limites

Para enviar, abra **Enviar por e-mail**, confira destinatário, assunto e mensagem e confirme o envio com anexo. O servidor precisa estar configurado para e-mail. O anexo atual é um documento HTML da proposta; o PDF pode ser salvo pela impressão do navegador.

Marcar como enviada registra uma situação interna; isso não envia um e-mail. Se o envio ficar sem confirmação, consulte o histórico antes de reenviar. Uma proposta não movimenta estoque nem contas a receber. A conversão cria um pedido que ainda segue suas etapas de confirmação.

## O que ainda precisa de atenção

A escolha do tipo de anilheiro deve ficar no item: Standard, Olímpico ou Não se aplica. A separação definitiva das paletas de braços e estofado está em desenvolvimento.

## Referências para manutenção

Guia conferido no código de 12/11/2026. As ações dependem das permissões e da configuração da empresa. Relatos técnicos antigos descrevem a etapa em que foram escritos.

- [sales-proposals](referencias/sales-proposals.md)
- [proposals](../../../../apps/web/src/features/sales/proposals.tsx)
