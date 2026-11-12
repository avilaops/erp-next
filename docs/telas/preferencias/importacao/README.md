# Importação de produtos

[Todas as telas](../../../README.md) · [Preferências](../README.md)

Conferir um CSV antes de confirmar sua importação.

**Onde acessar:** `/preferencias/dados/importacao`.

## O que aparece na tela

- Arquivo CSV
- Prévia, validações e conflitos
- Protocolo e resultado

## O que você pode fazer

- Selecionar o arquivo
- Gerar e conferir a prévia
- Confirmar a importação
- Retomar o protocolo para consultar o resultado

## Regras e limites

Somente os campos suportados pelo modelo atual são importados. Uma prévia não confirma a gravação. Em resposta incerta, consulte o mesmo protocolo antes de tentar outro envio.

## O que ainda precisa de atenção

Ampliar a transferência para categoria, dados técnicos e acabamentos ainda faz parte do trabalho seguinte; não tratar esses campos como suportados pelo CSV básico.

## Referências para manutenção

Guia conferido no código de 12/11/2026. As ações dependem das permissões e da configuração da empresa. Relatos técnicos antigos descrevem a etapa em que foram escritos.

- [data-import](../../../../apps/web/src/features/data/import/data-import.tsx)
