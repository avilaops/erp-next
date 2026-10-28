# Roadmap detalhado do frontend de Preferências

## Objetivo

Construir `Preferências` como primeiro fluxo vertical do ERP Next. Essa área estabelece empresa ativa, identidade empresarial, usuários, permissões, configurações, integrações e governança antes dos módulos operacionais.

Este documento é a fila oficial para agentes de implementação. `docs/architecture.md` prevalece em decisões arquiteturais e visuais.

## Contrato de execução

Antes de iniciar uma entrega, o agente deve ler:

1. `AGENTS.md` aplicável ao diretório;
2. `docs/architecture.md`;
3. este roadmap;
4. componentes e testes vizinhos;
5. documentação local da versão instalada do Next.js quando alterar convenções do framework.

Regras comuns:

- usar Next.js, React, TypeScript, Tailwind CSS e shadcn/ui já instalados;
- seguir o padrão Apple Ávila documentado;
- reutilizar shell, tokens e componentes compartilhados;
- adicionar componentes somente quando a entrega os utilizar;
- não inventar endpoints, credenciais ou resultados de backend;
- identificar dados simulados como demonstração;
- nunca expor tokens, senhas, certificados ou payloads sensíveis;
- implementar loading, vazio, erro, bloqueio e sucesso quando aplicável;
- manter desktop, tablet, celular, teclado e foco visível;
- executar lint, TypeScript e build antes de concluir;
- preservar o orçamento de CI de até um minuto com cache aquecido.

## Estado atual

| Área | Estado | Evidência |
| --- | --- | --- |
| Shell autenticado | Implementado | Barra superior, menus de domínio, busca visual e navegação móvel |
| Central de Preferências | Implementada | Navegação por categorias e rotas FP-01 a FP-14 |
| Empresa | Implementada com mocks | Resumo, formulário completo, marca Ludus e estados locais |
| Usuários e acessos | FP-01 implementada com mocks | Lista, busca, filtros e estados de carregamento, vazio, erro e bloqueio |
| Usuários, permissões e papéis | FP-02 a FP-04 implementadas com mocks | Formulários, matriz hierárquica, papéis e horários |
| Sistema e segurança | FP-05 e FP-06 implementadas com mocks | Tema, formatos, sessões e auditoria |
| Integrações e certificado | FP-07 a FP-09 implementadas com mocks | Catálogo, detalhes, estados seguros e certificado A1 local |
| Dados, fiscal e financeiro | FP-10 a FP-13 implementadas com mocks | Importação, exportação, fiscal e parâmetros financeiros |
| Busca e paleta de comandos | FP-14 implementada | Busca global por `Ctrl+K` e rotas existentes |
| Persistência | Não iniciada | Backend será integrado depois dos contratos e isolamento multiempresa |
| Tema claro | Implementado em FP-05 | Alternância claro, escuro e sistema |
| Testes automatizados de UI | FP-15 implementada | Playwright cobre rotas, cinco viewports, estados, temas, teclado, foco e overflow |

## Ordem das entregas

| ID | Entrega | Dependências | Área proprietária |
| --- | --- | --- | --- |
| FP-01 | Usuários e acessos | Shell e Empresa | `features/users` |
| FP-02 | Criação e edição de usuário | FP-01 | `features/users` |
| FP-03 | Matriz de permissões | FP-02 | `features/users` |
| FP-04 | Papéis e horários de acesso | FP-03 | `features/roles` |
| FP-05 | Preferências do sistema | Shell | `features/system-preferences` |
| FP-06 | Segurança e auditoria | FP-01 | `features/security` |
| FP-07 | Catálogo de integrações | Empresa | `features/integrations` |
| FP-08 | Detalhes da integração | FP-07 | `features/integrations` |
| FP-09 | Certificado digital | Empresa | `features/digital-certificate` |
| FP-10 | Importação de dados | Empresa | `features/data-import` |
| FP-11 | Exportação de dados | Empresa e FP-06 | `features/data-export` |
| FP-12 | Configurações fiscais | Empresa e FP-09 | `features/fiscal-settings` |
| FP-13 | Configurações financeiras | Empresa | `features/financial-settings` |
| FP-14 | Busca e paleta de comandos | Rotas FP-01 a FP-13 | `features/preferences-search` |
| FP-15 | Testes e regressão visual | FP-01 a FP-14 | `tests` |

## Progresso das entregas

| ID | Estado | Evidência |
| --- | --- | --- |
| FP-01 | Concluída | Lista, busca, filtros e estados simulados em `/preferencias/usuarios` |
| FP-02 | Concluída | Rotas `/preferencias/usuarios/novo` e `/preferencias/usuarios/[id]`, formulário compartilhado e alterações locais |
| FP-03 | Concluída | Matriz pesquisável por domínio, permissões subordinadas, seleção parcial e proteção de ações sensíveis |
| FP-04 | Concluída | Gestão local de papéis, duplicação, matriz reutilizada e horários em America/Sao_Paulo |
| FP-05 | Concluída | Aparência clara/escura, região, formatos, paginação e notificações locais |
| FP-06 | Concluída | Sessões, políticas e auditoria com estados e filtros completos |
| FP-07 | Concluída | Catálogo pesquisável com categorias, estados e contas mascaradas |
| FP-08 | Concluída | Detalhes, saúde, teste e reconexão simulados sem exposição sensível |
| FP-09 | Concluída | Certificado A1 com validade, alertas, seleção local e senha efêmera |
| FP-10 | Concluída | Importação local em seis etapas com mapeamento, validação e prévia |
| FP-11 | Concluída | Exportação simulada com entidades, filtros, permissão adicional e histórico |
| FP-12 | Concluída | Configuração fiscal compartilhando os mocks da empresa e estados de preparo |
| FP-13 | Concluída | Catálogo financeiro sem saldos ou movimentações reais |
| FP-14 | Concluída | Busca global Ctrl+K indexando somente rotas existentes |
| FP-15 | Concluída | Playwright cobre rotas, viewports 320/375/768/1024/1440, estados, teclado, foco e overflow |

### Comandos locais da regressão visual

```powershell
pnpm --filter web build
pnpm --filter web exec playwright install chromium
pnpm --filter web test:e2e
```

## FP-01 — Usuários e acessos

### Escopo

- Criar `/preferencias/usuarios`.
- Listar usuários da empresa ativa.
- Oferecer busca e filtros por status e papel.
- Exibir avatar, nome, e-mail, papel principal, último acesso e status.
- Tratar `ativo`, `convite pendente` e `bloqueado`.
- Implementar loading, vazio, erro e ausência de permissão com mocks.

### Arquivos proprietários

- `apps/web/src/app/preferencias/usuarios/**`
- `apps/web/src/features/users/**`

### Aceite

- Lista funciona entre 320 e 1440 pixels sem overflow.
- Filtros e busca operam sobre os mocks.
- Rota atual possui identificação acessível.
- Nenhum link conduz a rota inexistente.

## FP-02 — Criação e edição de usuário

### Escopo

- Criar `/preferencias/usuarios/novo` e `/preferencias/usuarios/[id]`.
- Compartilhar formulário entre criação e edição.
- Incluir nome, e-mail, celular, status, papel, comunicações e restrição de horários.
- Diferenciar novo usuário, usuário existente e convite pendente.
- Detectar alterações e confirmar saída sem salvar.

### Aceite

- Salvar é simulado e identificado como local.
- Cancelar restaura os valores iniciais.
- Erros de validação são associados aos campos.
- Nenhuma senha real é solicitada ou armazenada.

## FP-03 — Matriz de permissões

### Escopo

- Agrupar permissões por Cadastros, Suprimentos, Vendas, Finanças, Serviços, Preferências, Fiscal e Outros.
- Suportar permissões principais e subordinadas.
- Separar visualizar, gerenciar, excluir, exportar e administrar credenciais.
- Implementar busca, expansão de grupos e seleção parcial.

### Aceite

- Checkboxes têm rótulos, teclado e estado indeterminado.
- Selecionar um grupo não concede ações destrutivas silenciosamente.
- Alterações aparecem como pendentes antes do salvamento simulado.

## FP-04 — Papéis e horários de acesso

### Escopo

- Listar papéis e quantidade de membros.
- Visualizar e editar permissões de um papel.
- Duplicar papel localmente.
- Configurar dias, intervalos e fuso `America/Sao_Paulo`.

### Aceite

- Papel em uso não pode ser excluído sem confirmação e explicação.
- Intervalos inválidos apresentam erro no campo correspondente.
- Horários permanecem compreensíveis no celular.

## FP-05 — Preferências do sistema

### Escopo

- Criar `/preferencias/sistema`.
- Incluir aparência, idioma, fuso, formatos de data e número, paginação e notificações internas.
- Apresentar prévia dos formatos.

### Aceite

- Switch é usado apenas para efeito imediato.
- Escolhas exclusivas usam radio ou select.
- Configurações em lote exigem salvar.
- Tema claro passa a existir nesta entrega.

## FP-06 — Segurança e auditoria

### Escopo

- Criar `/preferencias/seguranca`.
- Exibir sessões recentes e políticas de autenticação como somente leitura.
- Listar eventos de auditoria com filtros por usuário, ação, entidade e período.
- Mascarar valores sensíveis.

### Aceite

- Revogar sessão e alterar MFA ficam indisponíveis enquanto não houver contrato de backend.
- Eventos não exibem segredos ou payload bruto.
- A tela diferencia sem eventos, erro e sem permissão.

## FP-07 — Catálogo de integrações

### Escopo

- Criar `/preferencias/integracoes`.
- Listar provedor, finalidade, estado, conta externa mascarada e última sincronização.
- Filtrar por categoria e estado.

### Aceite

- Estados: desconectado, conectado, atenção e erro.
- Nenhuma credencial aparece no frontend.
- Conectar e desconectar são demonstrativos até existir backend.

## FP-08 — Detalhes da integração

### Escopo

- Criar `/preferencias/integracoes/[provider]`.
- Exibir capacidades, conta externa, última sincronização, último erro seguro e histórico resumido.
- Simular testar conexão e reconectar.

### Aceite

- Tratar saudável, degradada, erro e sem permissão.
- Mensagens de erro não revelam tokens, cabeçalhos ou payloads.

## FP-09 — Certificado digital

### Escopo

- Criar `/preferencias/certificado-digital`.
- Exibir tipo A1, titular, documento mascarado, emissor, início, validade e situação.
- Preparar seleção local de arquivo e senha sem transmissão.

### Aceite

- Avisar validade próxima e expiração.
- Senha nunca reaparece depois de digitada.
- A interface informa que o envio permanece desabilitado.

## FP-10 — Importação de dados

### Escopo

- Criar `/preferencias/dados/importacao`.
- Implementar fluxo local em etapas: entidade, arquivo, mapeamento, validação, prévia e resumo.
- Permitir voltar sem perder a configuração da sessão.

### Aceite

- Nenhum arquivo é transmitido.
- Erros indicam linha, coluna e motivo.
- A documentação registra que a execução real exigirá idempotência, auditoria e tenant.

## FP-11 — Exportação de dados

### Escopo

- Criar `/preferencias/dados/exportacao`.
- Selecionar entidades com checkboxes.
- Configurar filtros e registros excluídos com permissão adicional.
- Exibir histórico simulado de solicitações.

### Aceite

- Usar o termo `exportação`, nunca `backup`.
- Estados: solicitado, processando, pronto, falhou e expirado.
- Não gerar arquivo real.
- Explicar que downloads futuros serão temporários, auditados e limitados ao tenant.

## FP-12 — Configurações fiscais

### Escopo

- Criar `/preferencias/fiscal`.
- Organizar regime tributário, CNAE, inscrições, séries, ambientes e documentos habilitados.
- Reutilizar a fonte de dados mock da empresa.

### Aceite

- Estados: não configurado, incompleto e pronto para homologação.
- A interface não afirma que emissão fiscal está ativa.
- Não duplicar dados empresariais em fontes conflitantes.

## FP-13 — Configurações financeiras

### Escopo

- Criar `/preferencias/financeiro`.
- Listar contas financeiras, categorias, formas e condições de pagamento, centros de custos e comissões.
- Mostrar contagem, status e descrição.

### Aceite

- Não implementar saldos ou movimentações reais.
- Ações destrutivas permanecem indisponíveis ou exigem confirmação.

## FP-14 — Busca e paleta de comandos

### Escopo

- Tornar funcional a busca de Preferências.
- Implementar paleta global acionada por `Ctrl+K`.
- Indexar somente rotas já existentes.

### Arquivos adicionais permitidos

- `apps/web/src/components/app-shell.tsx`
- componentes compartilhados diretamente relacionados à busca

### Aceite

- Busca considera título, descrição e categoria.
- Paleta suporta teclado, Escape, foco inicial e retorno de foco.
- Nenhum resultado conduz a 404.

## FP-15 — Testes e regressão visual

### Escopo

- Criar testes das rotas de Preferências.
- Cobrir desktop e celular, teclado, foco, overflow e estados comuns.
- Registrar snapshots somente de superfícies estáveis.

### Aceite

- Selecionar a menor ferramenta compatível com Next.js 16 e React 19 depois de verificar as dependências atuais.
- Documentar comandos locais.
- Integrar ao CI sem ultrapassar o orçamento de um minuto com cache aquecido.
- Executar testes independentes em paralelo quando seguro.

## Definição de pronto da trilha

A trilha de Preferências estará concluída quando:

1. todas as rotas FP-01 a FP-14 existirem e forem navegáveis;
2. nenhuma tela depender de link falso ou rota 404;
3. claro e escuro forem verificados;
4. teclado, foco e leitores de tela tiverem cobertura proporcional;
5. viewports de 320, 375, 768, 1024 e 1440 pixels não apresentarem overflow;
6. loading, vazio, erro, bloqueio, sucesso e alterações pendentes forem consistentes;
7. lint, TypeScript, build e testes automatizados passarem;
8. o frontend continuar declarando mocks e limites de backend com precisão.
