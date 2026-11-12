# NF-e de saída

[Todas as telas](../../../README.md) · [Fiscal](../README.md)

Preparar a nota, revisar os dados e acompanhar a autorização fiscal.

**Onde acessar:** `/fiscal/notas-saida`.

## O que aparece na tela

- Dados da nota e ambiente
- Destinatário e endereço
- Produtos e valores
- Tributação declarada
- Pagamentos
- Revisão e situação da emissão

## O que você pode fazer

- Criar ou abrir um rascunho
- Copiar dados do cliente e do pedido quando disponíveis
- Salvar e corrigir pendências
- Transmitir por ação separada quando a tela liberar
- Consultar processamento e documentos disponíveis

## Regras e limites

Salvar rascunho não transmite. O botão de transmissão exige uma nota salva e as verificações do ambiente, certificado, permissões e dados fiscais. Se estiver desabilitado, confira a mensagem de bloqueio da tela. O ERP não deve inventar tributação.

## O que ainda precisa de atenção

A liberação deve ser avaliada para a empresa e o documento concretos. A documentação não representa uma autorização da SEFAZ nem um teste de emissão em produção.

## Referências para manutenção

Guia conferido no código de 12/11/2026. As ações dependem das permissões e da configuração da empresa. Relatos técnicos antigos descrevem a etapa em que foram escritos.

- [FISCAL-AMBIENTES](referencias/FISCAL-AMBIENTES.md)
- [FISCAL-VALORES-COMERCIAIS](referencias/FISCAL-VALORES-COMERCIAIS.md)
- [NFE-SEFAZ-RECOVERY](referencias/NFE-SEFAZ-RECOVERY.md)
- [RETORNOS-E-CONTINUIDADE-FISCAL](referencias/RETORNOS-E-CONTINUIDADE-FISCAL.md)
- [nfe-draft-editor](../../../../apps/web/src/features/fiscal/nfe-draft-editor.tsx)
