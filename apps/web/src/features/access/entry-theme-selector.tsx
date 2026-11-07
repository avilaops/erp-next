"use client"

import { useTheme } from "@/components/shell/theme-provider"

const themes = [
  { value: "light", label: "Claro" },
  { value: "dark", label: "Escuro" },
  { value: "system", label: "Sistema" },
] as const

export function EntryThemeSelector() {
  const [theme, setTheme] = useTheme()

  return <label className="block">
    <span className="sr-only">Tema da interface</span>
    <select
      aria-label="Tema da interface"
      className="min-h-8 w-auto rounded-md border-0 bg-transparent px-2 text-xs font-normal text-muted-foreground shadow-none outline-none transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
      value={theme}
      onChange={event => {
        const selected = themes.find(option => option.value === event.target.value)
        if (selected) setTheme(selected.value)
      }}
    >
      {themes.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </label>
}
