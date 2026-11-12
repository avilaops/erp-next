"use client"

import { useId, type ComponentProps } from "react"
import { CalendarDays } from "lucide-react"

type DateFieldProps = Omit<ComponentProps<"input">, "type"> & { label: string; emptyLabel?: string }

/** A sized native control: the empty indication never intercepts input or keyboard events. */
export function OrderDateField({ label, emptyLabel, id, className, onClick, value, ...props }: DateFieldProps) {
  const generatedId = useId()
  const inputId = id || generatedId
  return <label className="order-date-field" htmlFor={inputId}>
    <span>{label}</span>
    <span className="order-date-control" data-empty={!value && !!emptyLabel || undefined}>
      <input {...props} id={inputId} aria-label={props["aria-label"] || label} aria-describedby={[props["aria-describedby"], !value && emptyLabel ? `${inputId}-empty` : ""].filter(Boolean).join(" ") || undefined} type="date" className={`order-native-date ${className || ""}`} value={value} onClick={event => {
        onClick?.(event)
        if (event.defaultPrevented || event.currentTarget.disabled || event.currentTarget.readOnly) return
        try { event.currentTarget.showPicker?.() } catch { /* Native focus/keyboard selection remains available. */ }
      }} />
      {!value && emptyLabel && <span id={`${inputId}-empty`} aria-hidden="true" className="order-date-empty">{emptyLabel}</span>}
      <CalendarDays aria-hidden="true" className="order-date-icon" />
    </span>
  </label>
}
