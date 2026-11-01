import type { MDXComponents } from "mdx/types"
import { HelpOrders } from "@/features/help/help-orders"
import { HelpAction } from "@/features/help/help-actions"

const components: MDXComponents = {
  h2: ({ children }) => <h2 className="mb-3 mt-6 text-lg font-semibold">{children}</h2>,
  p: ({ children }) => <p className="my-3 text-sm leading-7">{children}</p>,
  ul: ({ children }) => <ul className="my-3 list-disc space-y-2 pl-5 text-sm">{children}</ul>,
  ol: ({ children }) => <ol className="my-3 list-decimal space-y-2 pl-5 text-sm">{children}</ol>,
  HelpAction,
  HelpOrders,
}

export function useMDXComponents(): MDXComponents {
  return components
}
