import { useId, type ReactNode } from "react";

export function AuthInput({ label, type = "text", placeholder, value, onChange, icon: Icon, right }: {
  label: string; type?: string; placeholder: string;
  value: string; onChange: (v: string) => void;
  icon?: any; right?: ReactNode;
}) {
  const inputId = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-xs font-semibold text-foreground">{label}</label>
      <div className="relative">
        {Icon && <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />}
        <input
          id={inputId}
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-full rounded-xl border border-border bg-input-background text-sm text-foreground placeholder-muted-foreground outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
          style={{ padding: Icon ? "10px 12px 10px 36px" : "10px 12px" }}
        />
        {right && <div className="absolute right-3 top-1/2 -translate-y-1/2">{right}</div>}
      </div>
    </div>
  );
}
