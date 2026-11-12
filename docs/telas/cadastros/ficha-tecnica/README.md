# Ficha técnica do produto

[Todas as telas](../../../README.md) · [Cadastros](../README.md)

Manter as especificações do equipamento e a origem das informações no cadastro do produto.

**Onde acessar:** `/cadastros/produtos/{id}`, na seção **Ficha técnica**.

## O que aparece na tela

- Fabricante, modelo e nome no catálogo
- Linha, grupo corporal e categoria técnica
- Comprimento, largura e altura em milímetros
- Peso, bateria de pesos e área de treino publicada
- Descrição, URL da fonte e páginas do PDF e do catálogo

## O que você pode fazer

- Consultar a ficha no produto
- Editar e salvar a ficha separadamente do cadastro básico
- Adicionar ou remover referências do catálogo

## Regras e limites

Medidas, pesos e descrições devem ter fonte. Os catálogos Premium não comprovam dados da linha Core. A opção de anilheiro indica a escolha comercial, sem comprovar o diâmetro de fábrica.

## O que ainda precisa de atenção

Manter Nacional/Core sem preenchimento adicional e não cadastrar os dez modelos fora do escopo, conforme decisão do cliente.

## Referências para manutenção

Guia conferido no código de 12/11/2026. As ações dependem das permissões e da configuração da empresa. Relatos técnicos antigos descrevem a etapa em que foram escritos.

- [catalog-profile](../../../../apps/web/src/features/catalog/catalog-profile.tsx)
- [catalog-profile-fields](../../../../apps/web/src/features/catalog/catalog-profile-fields.tsx)
- [Especificação da ficha técnica](../../../superpowers/specs/2026-11-12-product-technical-sheet-design.md).
