/** Keep transport/parser details out of operational error messages. */
export function apiErrorMessage(reason: unknown, fallback: string): string {
  if (reason instanceof SyntaxError) return "O ERP retornou uma resposta inválida. Tente novamente."
  if (reason instanceof TypeError) return fallback
  return reason instanceof Error && reason.message ? reason.message : fallback
}
