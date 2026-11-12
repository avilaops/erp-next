# Avaliação e instalação local das bibliotecas Siscomex

Avaliação em 08/11/2026. As duas bibliotecas foram preparadas em diretórios separados do ERP. A biblioteca Python serve como referência para consulta do cadastro público de NCM; o projeto Java fornece interfaces e modelos de integração com o Portal Único. Nenhum deles determina automaticamente a classificação fiscal de um produto ou substitui a emissão de NF-e.

## Instalações locais

| Projeto | Local | Versão e licença | Verificação |
| --- | --- | --- | --- |
| [siscomex-ncm](https://github.com/leogregianin/siscomex-ncm) | `C:\Users\nicol\source\siscomex-ncm` | 1.0.2, MIT; revisão `cacd1cda19acf22e34a82e30c9b31cc508ee73e9` | Instalado em `.venv` com Python 3.11.15; 15 testes passaram sem rede, 1 teste de download foi excluído. |
| [portalunico.siscomex.gov.br](https://github.com/samuelfac/portalunico.siscomex.gov.br) | `C:\Users\nicol\source\portalunico.siscomex.gov.br` | `r77-azuis-RELEASE`, MIT; revisão `34388c10ff2f5ac69c72063614cea25faaefdb4f` | 1.038 fontes compiladas; `mvn install` concluído com `BUILD SUCCESS`; JAR instalado em `.m2-local`. |

O Python foi instalado em modo editável, com `urllib3 1.26.20` e `pytest 7.4.4`. O backend original `poetry.masonry.api` falhou por não implementar `build_editable`. Apenas o clone local recebeu a troca para `poetry.core.masonry.api`, com `poetry-core>=2.0`. A configuração original está em `pyproject.toml.original`.

O Java usa ferramentas portáveis dentro de `.tools`: Maven 3.9.11 e Temurin JDK 17.0.21+9. Os downloads tiveram SHA-512 e SHA-256 conferidos, respectivamente. O projeto declara compatibilidade Java 8. A compilação limita o heap a 512 MB e usa `.m2-local`, sem alterar o Java global ou publicar pacotes.

## Utilidade e limites do Python

`FetchNcm` consulta código, descrição, início e fim de vigência e ato normativo no [endpoint público de nomenclatura do Siscomex](https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json?perfil=PUBLICO). O cliente faz GET com timeout de dez segundos e retentativas; não contém operações de escrita aduaneira.

O cache `ncm.json` fica no diretório corrente e vence pela data de modificação do arquivo, em sete dias. Copiar um JSON antigo pode fazê-lo parecer recente. O construtor pode acessar a rede implicitamente; código inexistente retorna um objeto com código e descrição vazios. A consulta não escolhe a vigência pela data da nota, e `refresh_data` captura qualquer exceção e retorna `False`.

A biblioteca não fornece unidade tributável de exportação, CFOP, ICMS, IBS/CBS ou classificação automática a partir da descrição comercial. Para exportação, a tabela oficial NCM/uTrib baixada em `artifacts/fiscal-reference-downloads` continua sendo uma fonte separada. A dependência restrita à série urllib3 1.x deve ser revisada antes de uso operacional; esta avaliação funcional não equivale a uma auditoria completa de dependências.

## Utilidade e limites do Java

O clone contém 1.038 fontes Java, principalmente modelos e interfaces JAX-RS/Swagger. Inclui módulos de DU-E, classificação fiscal, cargas, anexação e plataforma, com operações GET, POST e PUT declaradas. É uma biblioteca de contratos, não um aplicativo pronto ou um serviço MCP.

A interface pública de download de NCM declara retorno `void`, exigindo adaptação para consumo tipado. Os modelos e rotas precisam ser confrontados com a [documentação oficial atual do Portal Único](https://docs.portalunico.siscomex.gov.br/) antes de qualquer integração. Não há diretório de testes Java no clone. Autenticação, certificados e operações aduaneiras não fizeram parte da execução local.

## Aplicação possível no ERP

Uma consulta de NCM somente para leitura seria útil no cadastro e no MCP: retornar código, descrição, vigência, ato normativo e proveniência do snapshot. As ferramentas existentes de produtos armazenam o NCM; a cotação IBPT resolve outro problema. A inspeção dos nomes das ferramentas conectadas não encontrou uma consulta dedicada de nomenclatura.

A integração recomendada usa um snapshot oficial versionado e validado, com data e hash, servido pelo backend existente. Deve aceitar uma data de consulta explícita e comunicar código inexistente ou expirado. A biblioteca Python pode apoiar importação e comparação local, sem iniciar processos Python durante a emissão de cada nota. O projeto Java é útil para estudar contratos de DU-E e preparar um adaptador separado quando esse fluxo for solicitado.

## Repetição dos testes locais

No clone Python:

```powershell
./.venv/Scripts/python.exe run-offline-tests.py
```

No clone Java:

```powershell
$env:JAVA_HOME = (Get-ChildItem .tools -Directory | Where-Object Name -Like 'jdk-*' | Select-Object -First 1).FullName
$env:MAVEN_OPTS = '-Xmx512m'
./.tools/apache-maven-3.9.11/bin/mvn.cmd -B '-Dmaven.repo.local=.m2-local' '-DskipTests' install
```

Os testes Python bloqueiam chamadas HTTP reais e excluem o teste de download. `install` do Maven grava o JAR apenas no repositório local indicado. Não houve alterações em servidores do ERP, bancos remotos, certificados, declarações ou autorizações fiscais.
