"use client"

import { useTheme } from "@/components/shell/theme-provider"

const themes = [
  { value: "light", label: "Claro" },
  { value: "dark", label: "Escuro" },
  { value: "system", label: "Sistema" },
] as const

export function EntryThemeSelector() {
  const [theme, setTheme] = useTheme()

  return <label>
    <span className="sr-only">Tema</span>
    <select
      className="min-h-11 w-28 rounded-lg border border-input bg-card px-3 text-sm font-medium text-foreground"
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
