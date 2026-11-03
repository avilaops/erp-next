# Consultas de CEP, CNPJ e IE

Implementação no ERP Next (API Rust + BFF Next.js), vinculada a AVL-113 e AVL-114.
Pesquisa das 27 UFs em 03/11/2026:
[matriz no Linear](https://linear.app/avilaops/document/cep-cnpjie-e-ibpt-matriz-das-27-ufs-03112026-784051155cce).

## Comportamento

Os formulários de empresa e de clientes/fornecedores oferecem consulta explícita.
A resposta é uma prévia: a pessoa confirma antes de preencher campos vazios.
Valores já informados, inclusive os editados enquanto a fonte responde, continuam
preservados. O cadastro continua sendo gravado pelo fluxo existente, com sua
revisão e permissão. A consulta não salva automaticamente o cadastro.

Mudança do documento, CEP, UF da consulta IE ou empresa invalida a prévia. Uma
prévia vencida não pode ser aplicada. Erro de fonte, falta de cadastro e suporte
indisponível possuem estados próprios; nenhum deles invalida o documento. CEP
genérico preserva os campos ausentes e orienta a entrada manual.

Antes de preencher, a interface confere a empresa da sessão no servidor por
`/api/erp/me`; troca em outra aba ou sessão expirada impede aplicar a prévia.
Documento, UF, validade e permissão local são conferidos novamente após essa
espera. A gravação conserva a verificação de empresa e autorização já existente.

A consulta CNPJ preenche somente campos cadastrais necessários. Não retorna QSA,
CPF de sócios, capital social ou o corpo bruto do fornecedor. Número/situação de
IE não preenchem indicador de contribuinte, regime tributário ou regras fiscais.
Na empresa, a consulta IE permite selecionar explicitamente a inscrição da UF;
uma IE já digitada continua preservada.

## Contrato e autorização

POST `/api/v1/registry-lookups` (BFF `/api/erp/registry-lookups`), JSON:

```json
{"kind":"cep","context":"company","value":"01001-000"}
```

`kind`: `cep`, `cnpj`, `ie`. `context`: `company` ou `party`.
IE recebe CNPJ em `value` e UF em `state`. Ambos são obrigatórios nessa consulta.

O BFF exige sessão, mesma origem e `X-Tenant-Id` correspondente à sessão. Não
aceita filtros na URL nem outros métodos. A API exige associação ativa à empresa
e `platform.company.read` ou `catalog.parties.read`, conforme o contexto, antes
de consultar o provedor e novamente antes de devolver o resultado. Nenhuma nova
permissão é concedida por esta entrega.

Resposta: empresa, tipo/documento, `status`, campos mínimos, origem, data da
consulta, expiração do cache, data da fonte quando informada, avisos e resultados
das tentativas. `taxpayerStatus` permanece `unknown`. `not_found` significa
ausência na base consultada, não cadastro inválido na Receita.

## Fontes e limites

| Consulta | Fonte principal | Fallback | Cache positivo |
| --- | --- | --- | --- |
| CEP | ViaCEP | BrasilAPI CEP v2 | 24 horas |
| CNPJ | BrasilAPI CNPJ v1 | CNPJ.ws quando habilitado e documento numérico | 6 horas |
| IE | CNPJ.ws quando habilitado e UF documentada | Consulta estadual manual | 6 horas |

Timeout por provedor: 3 segundos, conexão de até 1 segundo. Respostas limitadas a
256 KiB, sem redirecionamento. URLs externas são fixas no servidor. Cache limitado
a 512 entradas e separado por tenant/tipo/documento/UF. Falhas não entram no
cache. Máximo de oito consultas simultâneas por processo, vinte consultas sem
cache por empresa/minuto e trinta chamadas por provedor/minuto (BrasilAPI CEP e
CNPJ compartilham o limite). CNPJ.ws usa janela deslizante de três chamadas/minuto.

Esses limites são por processo. Não habilitar CNPJ.ws com múltiplos processos
compartilhando o IP sem coordenação de quota no ponto de saída. Cache não é uma
cópia oficial da base, não tem persistência e é descartado na reinicialização.

## CNPJ.ws: habilitação condicionada

`ERP_CNPJ_WS_ENABLED` fica desabilitado por padrão; apenas `true` habilita a fonte.
Os termos restringem comercialização dos dados. O enquadramento do uso no ERP
multiempresa ainda precisa ser confirmado antes da habilitação em produção.
Não há credencial paga nem contratação automática nesta entrega.

A cobertura IE documentada compreende BA, GO, MG, PB, PR, PE, RS, SC, SP e SE.
CNPJ alfanumérico é preservado e consultado na BrasilAPI, cujo contrato o aceita.
Não se enviam letras ao CNPJ.ws enquanto esse suporte não for comprovado.

Validação de dígitos de CPF permanece local. Não foi contratada nem adicionada
consulta CPF à Receita/Serpro. Não há consulta SEFAZ com A1 neste serviço.

## Fontes verificadas

- [ViaCEP e limite de uso massivo](https://viacep.com.br/).
- [BrasilAPI CEP](https://github.com/BrasilAPI/BrasilAPI/blob/main/pages/docs/doc/cep.json).
- [BrasilAPI CNPJ](https://github.com/BrasilAPI/BrasilAPI/blob/main/pages/docs/doc/cnpj.json).
- [API pública CNPJ.ws](https://docs.cnpj.ws/referencia-de-api/api-publica/consultando-cnpj).
- [Cobertura de IE CNPJ.ws](https://docs.cnpj.ws/modelos-de-dados/inscricoes-estaduais).
- [Termos CNPJ.ws](https://www.cnpj.ws/termos-de-uso).

## Evidência de desenvolvimento

Os testes usam provedores HTTP locais e banco PostgreSQL descartável, sem dados
de empresa real. Os testes de navegador usam sessão e API sintéticas para verificar
o formulário e o BFF. Esses resultados não comprovam publicação ou exercício de
uma sessão real em produção. Registrar CI, commit/PR, publicação e teste externo
separadamente no Linear.
