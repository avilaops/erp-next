/** Preserve the API's sales flag while managing the person in Funcionários. */
export function staffAssignment(jobTitle: string | null | undefined, previous?: { jobTitle?: string | null; isSeller: boolean; isEmployee?: boolean }) {
  const normalize = (value: string | null | undefined) => (value || "").normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR").trim()
  const title = normalize(jobTitle)
  const isSeller = previous && title === normalize(previous.jobTitle) ? previous.isSeller : /\bvendedor(?:a|es|as)?\b/.test(title)
  return { isEmployee: previous?.isEmployee ?? true, isSeller }
}
