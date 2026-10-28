const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const countBy = (items, key) => Object.fromEntries([...new Set(items.map(item => item[key]))].sort().map(value => [value, items.filter(item => item[key] === value).length]));

export function summary(report) {
  const { inventory } = report;
  return { pages: inventory.pages.length, nextHandlers: inventory.bff.length, rustPaths: inventory.api.length,
    rustOperations: inventory.api.reduce((sum, item) => sum + item.methods.length, 0),
    possibleHttpLinks: inventory.pages.filter(item => item.staticLinks.length).length,
    browserTestFiles: inventory.browserTests.length, findings: countBy(report.findings, 'severity'),
    probes: countBy(report.runtime, 'verdict'), suites: report.suites.map(({ id, verdict }) => ({ id, verdict })),
    flows: report.suites.flatMap(suite => suite.flow ? [{ id: suite.flow.id, verdict: suite.flow.verdict, checks: countBy(suite.flow.checks, 'status') }] : []),
    contracts: report.contracts ? { status: report.contracts.status, apiOperations: report.contracts.apiOperations,
      cataloguedOperations: report.contracts.cataloguedOperations, bffOperations: report.contracts.bffOperations,
      pendingFlows: report.contracts.pendingFlows, p0Ready: report.contracts.p0Ready,
      runtimeVerdict: report.contracts.runtimeVerdict } : { status: 'not_collected' },
    sourceChangedDuringRun: report.sourceHashAfter !== inventory.sourceHash };
}

export function markdown(report) {
  const data = summary(report);
  const lines = ['# Verificação do ERP-Next', '', `Execução: ${report.runId}`, `Início: ${report.startedAt}`, `Snapshot SHA-256: ${report.inventory.sourceHash}`, '',
    '**Descoberta estática e testes executados são evidências diferentes. Nenhuma página é aprovada apenas por existir.**', '',
    `Páginas: ${data.pages}; handlers Next.js: ${data.nextHandlers}; caminhos Rust: ${data.rustPaths}; operações Rust: ${data.rustOperations}.`,
    `Arquivos de testes de navegador encontrados: ${data.browserTestFiles}. Encontrar um arquivo não comprova sua execução.`,
    `Código mudou durante a coleta: ${data.sourceChangedDuringRun ? 'sim; resultados não formam uma verificação de uma única versão' : 'não detectado nos arquivos observados'}.`, '',
    '## Contratos de ações', '', `Definição/cobertura estática: ${JSON.stringify(data.contracts)}.`,
    'Um contrato catalogado não é teste aprovado. Fluxos com decisões pendentes impedem considerar a P0 concluída.', '',
    '## Execução', '', `Probes: ${JSON.stringify(data.probes)}.`, `Suítes: ${JSON.stringify(data.suites)}.`, `ML: ${report.ml.status}.`, '',
    '## Fluxos com evidência associada', '',
    ...report.suites.flatMap(suite => suite.flow ? [
      `### ${suite.flow.title}`, '', `Resultado: ${suite.flow.verdict}. Ambiente: ${suite.flow.environment}; Auth: ${suite.flow.authAdapter}; MCP: ${suite.flow.mcpAdapter}.`, '',
      `Página: ${suite.flow.page}; BFF: ${suite.flow.bff}; API: ${suite.flow.api}.`,
      `Plano SHA-256: ${suite.flow.planSha256}; log SHA-256: ${suite.flow.logSha256}.`, '',
      ...suite.flow.checks.map(check => `- [${check.status}] ${check.criterion} — ${check.test}`), '',
      `Ainda não verificado: ${suite.flow.unverified.join(', ')}.`, '',
    ] : []),
    '## Achados estáticos', '', ...report.findings.map(item => `- [${item.severity}] ${item.code} | ${item.path}: ${item.detail} Evidência: ${item.evidence.join(', ')}`), '',
    '## Páginas', '', '| Rota | Referências HTTP possíveis | Callbacks vazios | Execução da página |', '| --- | ---: | ---: | --- |',
    ...report.inventory.pages.map(item => `| \`${item.path}\` | ${item.staticLinks.length} | ${item.emptyActions.length} | ${item.runtimeVerdict} |`), '',
    '## API Rust', '', '| Rota | Métodos | Fonte |', '| --- | --- | --- |',
    ...report.inventory.api.map(item => `| \`${item.path}\` | ${item.methods.join(', ')} | ${item.file}:${item.line} |`), '',
    '## Limites', '',
    '- Imports revelam dependências possíveis, não a execução de um componente ou botão.',
    '- O scanner Rust reconhece registro literal de rotas; composição dinâmica exige revisão.',
    '- Os aliases internos reconhecidos são caminhos relativos e @/ para apps/web/src, conforme o tsconfig atual.',
    '- Probes usam GET anônimo e não seguem redirecionamentos. Não comprovam gravação, isolamento ou autorização de usuário autenticado.',
    '- O harness de fluxos usa banco e identidade sintéticos. Não valida integrações externas de produção.',
    '- Um modelo de anomalias nunca transforma uma verificação reprovada em aprovada.', '',
  ];
  return lines.join('\n');
}

export function html(report) {
  const data = summary(report);
  const flows = report.suites.flatMap(suite => suite.flow ? [suite.flow] : []);
  const flowSections = flows.map(flow => `<section><h2>${escape(flow.title)}</h2><p>Resultado dos checks: <strong>${escape(flow.verdict)}</strong>. Ambiente: ${escape(flow.environment)}. Auth: ${escape(flow.authAdapter)}. MCP: ${escape(flow.mcpAdapter)}.</p><p><code>${escape(flow.page)}</code> → <code>${escape(flow.bff)}</code> → <code>${escape(flow.api)}</code></p><table><thead><tr><th>Check</th><th>Resultado</th><th>Teste observado</th></tr></thead><tbody>${flow.checks.map(check => `<tr><td>${escape(check.criterion)}</td><td>${escape(check.status)}</td><td><code>${escape(check.test)}</code></td></tr>`).join('')}</tbody></table><p class="notice">Ainda não verificado: ${escape(flow.unverified.join(', '))}.</p><details><summary>Proveniência dos checks</summary><pre>${escape(JSON.stringify({ planSha256: flow.planSha256, logSha256: flow.logSha256, source: flow.source, sourceHashAfter: flow.sourceHashAfter }, null, 2))}</pre></details></section>`).join('');
  const rows = report.inventory.pages.map(item => `<tr><td><code>${escape(item.path)}</code></td><td>${escape(item.module)}</td><td>${item.staticLinks.length}</td><td>${item.emptyActions.length}</td><td>Sem verificação individual associada</td><td><details><summary>Fontes e possíveis ligações</summary><pre>${escape(JSON.stringify({ file: item.file, links: item.staticLinks, unresolvedFetches: item.unresolvedFetches, emptyActions: item.emptyActions }, null, 2))}</pre></details></td></tr>`).join('');
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Verificação do ERP-Next</title>
<style>body{font:15px system-ui,sans-serif;color:#172b29;background:#f6f8f7;margin:0}main{max-width:1400px;margin:auto;padding:30px}h1{font-size:28px}section{background:white;border:1px solid #d7e2dd;border-radius:10px;padding:20px;margin:18px 0}table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;vertical-align:top;padding:10px;border-bottom:1px solid #e4eae7}th{background:#eef4f1}code,pre{font-family:ui-monospace,monospace}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}input{padding:12px;width:min(90%,600px);border:1px solid #b7cac1;border-radius:6px}.notice{border-left:4px solid #0f766e;padding:12px;background:#edf6f2}.scroll{overflow:auto}summary{cursor:pointer}li{margin:9px 0}.muted{color:#51645d}</style>
<main><h1>Verificação do ERP-Next</h1><p class="muted">${escape(report.startedAt)} · ${escape(report.runId)}</p>
<p class="notice">Inventário de código e evidências de execução. Existência de rota, import ou arquivo de teste não comprova funcionamento.</p>
<section><h2>Coleta</h2><p>${data.pages} páginas · ${data.nextHandlers} handlers Next.js · ${data.rustPaths} caminhos na API · ${data.rustOperations} operações</p><p>Probes: ${escape(JSON.stringify(data.probes))}. Suítes: ${escape(JSON.stringify(data.suites))}.</p><p>ML: ${escape(report.ml.status)}. Mudança de código durante a coleta: ${data.sourceChangedDuringRun ? 'detectada' : 'não detectada'}.</p><details><summary>Proveniência e análise de anomalias</summary><pre>${escape(JSON.stringify({ sourceHash: report.inventory.sourceHash, sourceHashAfter: report.sourceHashAfter, git: report.git, ml: report.ml, history: report.comparison }, null, 2))}</pre></details></section>
<section><h2>Contratos de ações</h2><p class="notice">Definição e cobertura estáticas não aprovam a execução de um fluxo. Pendências contratuais mantêm a P0 incompleta.</p><pre>${escape(JSON.stringify(data.contracts, null, 2))}</pre></section>
${flowSections}
<section><h2>Achados estáticos (${report.findings.length})</h2><ul>${report.findings.map(item => `<li><strong>${escape(item.severity)} · ${escape(item.code)}</strong> <code>${escape(item.path)}</code><br>${escape(item.detail)}<br><small>${escape(item.evidence.join(', '))}</small></li>`).join('') || '<li>Nenhuma inconsistência reconhecida pelas regras desta versão.</li>'}</ul></section>
<section><h2>Rotas e ligações possíveis</h2><label for="filter">Filtrar por caminho ou módulo</label><p><input id="filter" type="search" placeholder="Ex.: produtos, estoque, financeiro"></p><p id="visible"></p><div class="scroll"><table id="routes"><thead><tr><th>Rota</th><th>Módulo</th><th>Refs. HTTP</th><th>Ações vazias</th><th>Fluxo</th><th>Evidência</th></tr></thead><tbody>${rows}</tbody></table></div></section>
<section><h2>Probes HTTP</h2><pre>${escape(JSON.stringify(report.runtime, null, 2))}</pre><h2>Suítes</h2><pre>${escape(JSON.stringify(report.suites, null, 2))}</pre></section>
<section><h2>Limites</h2><p>A árvore de imports pode incluir componentes não renderizados nesta página. O scanner Rust cobre registros literais. GET anônimo não comprova operação autenticada ou persistência. Testes de fluxo usam dados sintéticos; integrações de produção exigem evidências próprias.</p></section></main>
<script>const input=document.querySelector('#filter'),rows=[...document.querySelectorAll('#routes tbody tr')];function filter(){const q=input.value.toLocaleLowerCase('pt-BR');let n=0;for(const row of rows){row.hidden=!row.cells[0].textContent.toLocaleLowerCase('pt-BR').includes(q)&&!row.cells[1].textContent.toLocaleLowerCase('pt-BR').includes(q);if(!row.hidden)n++}document.querySelector('#visible').textContent=n+' de '+rows.length+' rotas'}input.addEventListener('input',filter);filter();</script></html>`;
}
