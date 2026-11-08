# Modalidades fiscais e MCP Fiscal Brasil

Pedido: desenvolver as modalidades indisponíveis e instalar DeHor-Labs/mcp-fiscal-brasil no MCP único da Ávila Ops.

## Restrições

- Orientação posterior do usuário: todo desenvolvimento, configuração reproduzível e testes permanecem locais. Não publicar nem aplicar migrações no servidor. Instalação remota inicial já realizada antes desta orientação.
- Escopo confirmado: vendas de exportação direta, por trading/exportadora e indireta. O usuário pede todos os tipos de venda; registrar limites fiscais reais, sem habilitar somente rótulos.
- Pacote fornecido pelo usuário: PL_010g v1.03, ZIP SHA-256 b329ecbe7e4c05a41bfbc1527f105defb7047328acfeada7c77e1666da485eaf. Cinco arquivos NF-e copiados integralmente para runtime e fixtures locais.

- Preservar alterações locais e o backend fiscal existente.
- Git autorizado neste pedido para clonar o projeto externo; não versionar ou publicar o ERP.
- Não transmitir documentos fiscais reais durante desenvolvimento.
- Instalação MCP não comprova implementação das modalidades de emissão.

## Entregas

- [x] Clonar repositório externo localmente e no servidor de backends.
- [x] Construir e testar imagem, sem certificado A1 ou segredos do ERP.
- [x] Conectar backend privado ao workflow MCP existente, com prefixo próprio.
- [x] Validar listagem e chamada sintética através da integração.
- [ ] Implementar exportação no contrato Rust, editor, validações, XML e testes.
- [ ] Atualizar suporte de schemas para DANFE Simplificado Tipo 2 e implementar seu documento auxiliar.
- [ ] Implementar importação de XML autorizado com assinatura/protocolo, isolamento da empresa, persistência e idempotência.
- [ ] Implementar notas de crédito/débito com subtipos e regras oficiais vigentes.
- [ ] Verificar contrato, testes do motor, API e interface.

## Arquitetura

Servidor externo separado em /opt/mcp-fiscal-brasil, sem substituir fiscal-avilaops-com. Ferramentas agregadas ao workflow MCP - Avila Ops pelo nó fiscal_brasil. Gateway OAuth existente preservado. Modalidades do ERP permanecem no motor determinístico atual; consultas MCP são auxiliares.

Instalação verificada: 45 ferramentas novas, 124 no total; chamada sintética fiscal_brasil_validar_cpf passou. Credencial de entrada com referência ausente recuperada usando o token técnico existente. Detalhes em ../mcp.avilaops.com/backends/fiscal-brasil/README.md. Nenhuma modalidade nova de emissão foi habilitada por esta instalação.

Correção de diagnóstico anterior: o schema PL_010f v1.04 já inclui tpImp=6. O trabalho necessário é implementar regras, QR v3, fluxo de emissão e impressão específica. O gerador brazilfiscalreport 1.3.1 declara que não gera esse formato; portanto não deve ser usado como se gerasse o Tipo 2.

## Validação

Saúde do container, handshake MCP, catálogo de ferramentas e chamada offline com dados sintéticos. Modalidades exigem testes de XML contra XSD e testes de persistência/UI, sem emissão real.
