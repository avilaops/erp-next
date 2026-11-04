"use client"

import { useEffect, useRef, type ComponentProps } from "react"
import { Input } from "@/components/ui/input"

type Props = Omit<ComponentProps<"input">, "ref"> & {
  onSearch: (value: string, form: HTMLFormElement | null) => void
}

/** Only invokes a read callback; never submits an enclosing business form. */
export function SearchInput({ onSearch, onChange, onCompositionStart, onCompositionEnd, onKeyDown, defaultValue, ...props }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const composing = useRef(false)
  const callback = useRef(onSearch)
  const submitted = useRef(String(defaultValue ?? ""))
  useEffect(() => { callback.current = onSearch }, [onSearch])
  useEffect(() => {
    if (defaultValue !== undefined && String(defaultValue) !== submitted.current && input.current) {
      input.current.value = String(defaultValue)
      submitted.current = String(defaultValue)
    }
  }, [defaultValue])
  function cancel() { if (timer.current) clearTimeout(timer.current); timer.current = null }
  useEffect(() => {
    const form = input.current?.form
    form?.addEventListener("submit", cancel, true)
    return () => { cancel(); form?.removeEventListener("submit", cancel, true) }
  }, [])
  function schedule(element: HTMLInputElement) {
    cancel()
    if (composing.current) return
    const value = element.value
    timer.current = setTimeout(() => {
      timer.current = null
      if (!element.isConnected || element.disabled || element.closest("fieldset[disabled]") || element.value !== value) return
      submitted.current = value
      callback.current(value, element.form)
    }, 300)
  }
  return <Input {...props} ref={input} defaultValue={defaultValue} autoComplete="off"
    onChange={event => { onChange?.(event); schedule(event.currentTarget) }}
    onCompositionStart={event => { composing.current = true; cancel(); onCompositionStart?.(event) }}
    onCompositionEnd={event => { composing.current = false; onCompositionEnd?.(event); schedule(event.currentTarget) }}
    onKeyDown={event => { if (event.key === "Escape" || event.key === "Enter") cancel(); onKeyDown?.(event) }} />
}
