# Modelo do pedido e cadastro fiscal — continuidade AVL-432

**Objetivo:** Consolidar os ajustes revisados pelo usuário no pedido e no cadastro, validar a revisão por CI e preparar a entrega da API e da interface.

**Referência:** AVL-432, simulador comercial completo antes do pedido. A consulta de 12/11/2026 encontrou registros de implementação anteriores ao código atual; não repetir entregas que já estão na main. Linear permanece somente para consulta, seguindo a orientação registrada nas execuções recentes.

**Escopo:** Selecionar novamente um produto acrescenta uma unidade, preservando acabamentos e preços, inclusive com 100 produtos distintos. O peso cadastral dos equipamentos multiplicado pela quantidade aparece na montagem, no simulador, no pedido, na impressão/PDF e no anexo de e-mail. Endereços sem código IBGE são completados pelo serviço de CEP existente, com conferência de cidade, UF, empresa e validade, sem substituir informação manual.

## Restrições

- Preservar a interface de revisão local na porta 3002 e as alterações anteriores desta conversa.
- Não criar pedido, alterar cadastro real, enviar e-mail, efetuar pagamento ou transmitir documento fiscal como teste.
- Não introduzir migrações, dependências ou mudanças na configuração fiscal/comercial.
- Peso corresponde ao cadastro consultado; não estimar embalagem nem acrescentar congelamento histórico.
- Compilar localmente ou em CI, nunca no servidor de produção.
- Distinguir validação local, CI, integração, publicação, saúde e aceite autenticado. O épico não é concluído apenas por uma entrega ou pelo health.

## Etapas

- [x] Consultar o projeto ERP - Next, os critérios e a discussão da AVL-432.
- [x] Conferir a base local/origin e preservar o trabalho em branch própria.
- [x] Validar os ajustes e obter revisão independente sem achados importantes pendentes.
- [ ] Versionar a entrega e obter CI aprovada na revisão correspondente.
- [ ] Conferir artefatos compatíveis com Linux e seus hashes, preservando as dependências de runtime existentes.
- [ ] Integrar e publicar pelo procedimento autorizado, com rollback e configuração privada preservados.
- [ ] Conferir revisão pública, contrato atualizado da API e saúde dos quatro serviços; registrar o que ainda depende de aceite real.

## Evidências anteriores à integração

- 467 testes Rust aprovados; um teste existente ignorado.
- 93 testes de modelo da web aprovados.
- 26 testes de navegador comerciais/pedidos na build de produção aprovados.
- 17 testes de cadastro/endereço/CNPJ aprovados, incluindo gravação dos códigos IBGE e mudança de CNPJ após enriquecimento automático.
- Build web, TypeScript, lint dos arquivos alterados e formatação Rust aprovados. Lint completo conserva oito avisos anteriores em arquivos não alterados.
- Executável local e tipos OpenAPI regenerados; campo `equipmentWeight` conferido. API local, página e health na porta 3002 responderam normalmente.
- SMTP local sem configuração; geração do anexo foi validada com testes, sem envio real.
