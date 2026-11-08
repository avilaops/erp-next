const approvedSizes = new Set([12, 14, 18]);

/** Keep authenticated screens on the shared scale; document typography is data. */
export function validateTypography(files) {
  const errors = [];
  for (const [name, source] of files) {
    if (!name.startsWith("apps/web/src/") || name.startsWith("apps/web/src/app/entrar/")) continue;
    for (const [index, line] of source.split("\n").entries()) {
      // Public PageTitle fallback; internal headings override it in .erp-content.
      if (name.endsWith("app/workspace-ui.css") && line.startsWith(".workspace-page-title {")) continue;
      for (const match of line.matchAll(/font-size:\s*([^;}]+)/g)) {
        const size = match[1].trim();
        if (/^var\(--workspace-font-(title|body|auxiliary)\)$/.test(size)) continue;
        if (/^\d+px$/.test(size) && approvedSizes.has(Number.parseFloat(size))) continue;
        errors.push(`Tipografia fora da escala 18/14/12: ${name}:${index + 1}: ${size}`);
      }
      for (const match of line.matchAll(/text-\[(\d+(?:\.\d+)?)(px|rem|em)\]/g)) {
        const size = Number(match[1]) * (match[2] === "px" ? 1 : 16);
        if (!approvedSizes.has(size)) errors.push(`Tamanho de texto avulso: ${name}:${index + 1}: ${match[0]}`);
      }
      for (const match of line.matchAll(/font:\s*(\d+(?:\.\d+)?)(px|rem)/g)) {
        const size = Number(match[1]) * (match[2] === "px" ? 1 : 16);
        if (!approvedSizes.has(size)) errors.push(`Atalho font fora da escala: ${name}:${index + 1}: ${match[0]}`);
      }
      if (/\btext-[5-9]xl\b/.test(line)) errors.push(`Classe sem escala interna: ${name}:${index + 1}`);
    }
  }
  const shared = files.get("apps/web/src/app/workspace-ui.css");
  if (shared) for (const [token, size] of [["title", 18], ["body", 14], ["auxiliary", 12]]) {
    if (!shared.includes(`--workspace-font-${token}: ${size}px;`)) errors.push(`Token obrigatório de tipografia: ${token} = ${size}px`);
  }
  if (shared) for (const [token, role] of [["xs", "auxiliary"], ["sm", "body"], ["base", "body"], ["lg", "title"], ["xl", "title"], ["2xl", "title"], ["3xl", "title"], ["4xl", "title"]]) {
    if (!shared.includes(`--text-${token}: var(--workspace-font-${role});`)) errors.push(`Escala interna obrigatória: text-${token} -> ${role}`);
  }
  return errors;
}
