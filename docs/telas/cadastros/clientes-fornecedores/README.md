# Clientes e fornecedores

[Todas as telas](../../../README.md) · [Cadastros](../README.md)

Usar um único cadastro para uma pessoa que pode ser cliente, fornecedor ou ambos.

**Onde acessar:** `/cadastros/clientes-fornecedores`.

## O que aparece na tela

- CPF ou CNPJ e tipo de pessoa
- Nome ou razão social e nome fantasia
- E-mail e telefone
- Relacionamento comercial e situação
- Endereços e contatos adicionais
- Indicador de ICMS e inscrição estadual

## O que você pode fazer

- Buscar por nome ou documento, filtrar e paginar
- Criar, consultar ou editar uma pessoa
- Consultar CNPJ e CEP e conferir os dados antes de aplicar
- Definir endereço e contato principal
- Arquivar ou reativar sem apagar o histórico

## Regras e limites

Selecione pelo menos um relacionamento. Documento duplicado na mesma empresa é recusado, inclusive quando o cadastro está arquivado. Inscrição estadual e indicador de ICMS são dados declarados; salvá-los não comprova regularidade fiscal.

O formulário recupera o rascunho na mesma sessão e avisa sobre alterações pendentes antes da saída. A emissão ainda depende dos campos e das validações da própria nota.

## Referências para manutenção

Guia conferido no código de 12/11/2026. As ações dependem das permissões e da configuração da empresa. Relatos técnicos antigos descrevem a etapa em que foram escritos.

- [PESSOAS-PERSISTENTES](referencias/PESSOAS-PERSISTENTES.md)
- [ENDERECOS-CONTATOS-PESSOAS](referencias/ENDERECOS-CONTATOS-PESSOAS.md)
- [CONSULTAS-CADASTRAIS-AVL-113-114](referencias/CONSULTAS-CADASTRAIS-AVL-113-114.md)
- [CADASTRO-CNPJ-2026-11-05](referencias/CADASTRO-CNPJ-2026-11-05.md)
- [party-workspace](../../../../apps/web/src/features/parties/party-workspace.tsx)
- [party-draft](../../../../apps/web/src/features/parties/party-draft.ts)
- [Dados fiscais e recuperação de rascunho](../../../superpowers/specs/2026-11-12-party-fiscal-drafts.md).
