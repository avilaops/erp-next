"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bell,
  CalendarDays,
  CheckCircle2,
  Globe2,
  MonitorCog,
  Save,
} from "lucide-react";
import { Button } from "@/components/ui/button";

type Theme = "light" | "dark" | "system";

export function SystemPreferences() {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === "undefined") return "dark";
    const stored = window.localStorage.getItem("erp-theme");
    return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
  });
  const [language, setLanguage] = useState("pt-BR");
  const [dateFormat, setDateFormat] = useState("dd/MM/yyyy");
  const [numberFormat, setNumberFormat] = useState("pt-BR");
  const [pageSize, setPageSize] = useState("25");
  const [notifications, setNotifications] = useState({
    assignments: true,
    fiscal: true,
    integrations: false,
  });
  const [saved, setSaved] = useState(false);
  const preview = useMemo(
    () => ({
      date:
        dateFormat === "yyyy-MM-dd"
          ? "2026-10-24"
          : dateFormat === "MM/dd/yyyy"
            ? "10/24/2026"
            : "24/10/2026",
      number: numberFormat === "en-US" ? "1,234,567.89" : "1.234.567,89",
    }),
    [dateFormat, numberFormat],
  );

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && media.matches));
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [theme]);

  function applyTheme(next: Theme) {
    setTheme(next);
    window.localStorage.setItem("erp-theme", next);
    const dark =
      next === "dark" ||
      (next === "system" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
    setSaved(false);
  }

  return (
    <div className="mx-auto max-w-5xl px-4 pb-24 pt-8 lg:px-6">
      <header className="border-b border-border pb-7">
        <p className="text-sm font-medium text-primary">
          Preferências / Sistema
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          Preferências do sistema
        </h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          Ajuste a experiência da empresa. A aparência é aplicada imediatamente;
          as demais escolhas exigem salvamento.
        </p>
      </header>
      {saved && (
        <div
          className="mt-6 flex gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm"
          role="status"
        >
          <CheckCircle2 className="size-5 text-emerald-500" />
          Preferências salvas apenas nesta demonstração.
        </div>
      )}
      <div className="mt-6 space-y-6">
        <Section
          icon={MonitorCog}
          title="Aparência"
          description="Mudança imediata e persistida neste navegador."
        >
          <fieldset>
            <legend className="sr-only">Tema</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              {(["light", "dark", "system"] as Theme[]).map((item) => (
                <label
                  className="flex cursor-pointer items-center gap-3 rounded-xl border border-border p-4 has-[:checked]:border-primary/50 has-[:checked]:bg-primary/10"
                  key={item}
                >
                  <input
                    checked={theme === item}
                    name="theme"
                    type="radio"
                    value={item}
                    onChange={() => applyTheme(item)}
                  />
                  <span className="capitalize">
                    {item === "light"
                      ? "Claro"
                      : item === "dark"
                        ? "Escuro"
                        : "Sistema"}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </Section>
        <Section
          icon={Globe2}
          title="Idioma e região"
          description="Formatos usados em toda a interface."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label="Idioma"
              value={language}
              onChange={setLanguage}
              options={[{ value: "pt-BR", label: "Português (Brasil)" }]}
            />
            <SelectField
              label="Fuso horário"
              value="America/Sao_Paulo"
              onChange={() => {}}
              options={[
                { value: "America/Sao_Paulo", label: "America/Sao_Paulo" },
              ]}
            />
            <SelectField
              label="Formato de data"
              value={dateFormat}
              onChange={setDateFormat}
              options={[
                { value: "dd/MM/yyyy", label: "DD/MM/AAAA" },
                { value: "yyyy-MM-dd", label: "AAAA-MM-DD" },
                { value: "MM/dd/yyyy", label: "MM/DD/AAAA" },
              ]}
            />
            <SelectField
              label="Formato numérico"
              value={numberFormat}
              onChange={setNumberFormat}
              options={[
                { value: "pt-BR", label: "1.234.567,89" },
                { value: "en-US", label: "1,234,567.89" },
              ]}
            />
          </div>
          <div className="mt-4 grid gap-3 rounded-xl bg-muted/50 p-4 sm:grid-cols-2">
            <p className="text-sm">
              <span className="text-muted-foreground">Data:</span>{" "}
              {preview.date}
            </p>
            <p className="text-sm">
              <span className="text-muted-foreground">Número:</span>{" "}
              {preview.number}
            </p>
          </div>
        </Section>
        <Section
          icon={CalendarDays}
          title="Listagens"
          description="Quantidade padrão de registros por página."
        >
          <SelectField
            label="Itens por página"
            value={pageSize}
            onChange={setPageSize}
            options={["10", "25", "50", "100"].map((value) => ({
              value,
              label: value,
            }))}
          />
        </Section>
        <Section
          icon={Bell}
          title="Notificações internas"
          description="Avisos exibidos dentro do ERP."
        >
          <div className="space-y-3">
            {(
              [
                { id: "assignments", label: "Tarefas e atribuições" },
                { id: "fiscal", label: "Alertas fiscais" },
                { id: "integrations", label: "Falhas em integrações" },
              ] as const
            ).map(({ id, label }) => (
              <label
                className="flex items-center justify-between gap-4 rounded-xl border border-border p-4"
                key={id}
              >
                <span className="text-sm font-medium">{label}</span>
                <input
                  checked={notifications[id]}
                  className="size-5 accent-primary"
                  type="checkbox"
                  onChange={(event) => {
                    setNotifications((current) => ({
                      ...current,
                      [id]: event.target.checked,
                    }));
                    setSaved(false);
                  }}
                />
              </label>
            ))}
          </div>
        </Section>
      </div>
      <div className="sticky bottom-20 mt-6 flex justify-end rounded-2xl border border-border bg-background/95 p-3 backdrop-blur lg:bottom-4">
        <Button onClick={() => setSaved(true)}>
          <Save />
          Salvar preferências
        </Button>
      </div>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof MonitorCog;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <div className="mb-5 flex gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <Icon className="size-5" />
        </span>
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-2 text-sm font-medium">
      {label}
      <select
        className="h-10 rounded-lg border border-input bg-background px-3 text-sm"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
