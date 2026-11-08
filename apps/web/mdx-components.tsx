import type { MDXComponents } from "mdx/types"

const components: MDXComponents = {
  h2: ({ children, ...props }) => <h2 {...props} className={props.className || "mb-3 mt-6 text-lg font-semibold"}>{children}</h2>,
  p: ({ children, ...props }) => <p {...props} className={props.className || "my-3 text-sm leading-7"}>{children}</p>,
  ul: ({ children, ...props }) => <ul {...props} className={props.className || "my-3 list-disc space-y-2 pl-5 text-sm"}>{children}</ul>,
  ol: ({ children, ...props }) => <ol {...props} className={props.className || "my-3 list-decimal space-y-2 pl-5 text-sm"}>{children}</ol>,
}

export function useMDXComponents(): MDXComponents {
  return components
}
