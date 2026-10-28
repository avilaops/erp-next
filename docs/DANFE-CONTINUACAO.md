# Continuação do DANFE e da verificação fiscal

## Checkout e escopo

Repositório: `avilaops/erp-next`. Nome do produto: ERP.
Checkout principal: `D:\Projetos\erp-next`.

A consolidação reuniu os domínios existentes e o incremento de DANFE na mesma
linha de desenvolvimento. O incremento original está em `dcff9d5`, no worktree
`D:\Projetos\Worktrees\erp-next-danfe`, preservado para rastreabilidade.
O snapshot anterior `6a19ae3` continha pré-requisitos copiados durante o
desenvolvimento e não deve ser aplicado por cima da consolidação.

Foi preservada a numeração do checkout principal: 008 para cadastros de referência
e 009 para o lookup de pagamentos. Não executar as versões de numeração invertida
do worktree antigo em um banco já migrado.

## Verificações reproduzíveis

Com PostgreSQL local dedicado a testes e permissão para criar bases e papéis:

```powershell
$env:DATABASE_URL = 'postgres://USUARIO_DE_TESTE@127.0.0.1:PORTA/postgres'
$env:ERP_VERIFY_TEST_DATABASE_URL = $env:DATABASE_URL
cargo test --workspace --jobs 2 -- --test-threads=1
cargo clippy --workspace --all-targets --jobs 2 -- -D warnings
pnpm test:verification
pnpm --filter web build
pnpm --filter web test:danfe
pnpm verify:erp --suite danfe
```

O navegador usa apenas as portas locais 33118 e 33119. Conflitos não autorizam
encerrar aplicações de outras pessoas. O relatório do verificador identifica
12 testes Rust; o relatório Chromium registra quatro cenários separados.
Nenhum desses resultados positivos autentica a fixture fiscal na SEFAZ.

Os relatórios gerados ficam em `artifacts/verification/` e
`artifacts/danfe-browser/`, ignorados pelo Git. Cada execução conserva seus
arquivos e identificadores. O inventário estático inclui rotas demonstrativas;
a aprovação do fluxo fiscal não aprova todas as rotas do inventário.

## Pendências externas

1. Provisionar `DANFE_MCP_URL` e `DANFE_MCP_TOKEN` para o serviço da API.
2. Definir o bundle público de confiança quando for necessário atestar a cadeia.
3. Executar o encadeamento completo com identidade/empresa reais e XML autorizado
   de acesso legítimo, incluindo uma recusa real de assinatura inválida.
4. Implantar pelo processo do projeto após CI aprovado e validar no ambiente alvo.

O incremento não inclui emissão, consulta de situação atual na SEFAZ ou
armazenamento imutável de XML/PDF. O contrato e os limites estão em
[DANFE-XML-AUTORIZADO.md](DANFE-XML-AUTORIZADO.md).
