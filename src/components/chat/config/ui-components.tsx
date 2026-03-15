"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight } from "lucide-react";
import { type LightConfig } from "@/hooks/SceneConfigContext";

/* ─── Helpers ──────────────────────────────────────────────────────────────── */

export function fmt(n: number) {
  return parseFloat(n.toFixed(4));
}

/* ─── Toggle Row ───────────────────────────────────────────────────────────── */

export function ToggleSwitch({
  label,
  checked,
  onChange,
  description,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
  description?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5 py-1.5 px-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-muted-foreground/90">{label}</span>
        <button
          onClick={onChange}
          className={cn(
            "relative flex items-center h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            checked ? "bg-cyan-500" : "bg-white/10"
          )}
        >
          <span
            className={cn(
              "pointer-events-none block h-3.5 w-3.5 rounded-full bg-white shadow-lg ring-0 transition-transform duration-200",
              checked ? "translate-x-4" : "translate-x-0.5"
            )}
          />
        </button>
      </div>
      {description && <p className="text-[9px] text-muted-foreground/50 leading-tight pr-4">{description}</p>}
    </div>
  );
}

/* ─── Number Input ─────────────────────────────────────────────────────────── */

export function NumInput({
  label,
  value,
  onChange,
  step = 0.01,
  min,
  max,
  description,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  description?: string;
}) {
  return (
    <div className="flex flex-col gap-1 w-full">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] text-muted-foreground/60 shrink-0 truncate">{label}</span>
        <input
          type="number"
          value={fmt(value)}
          step={step}
          min={min}
          max={max}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className="w-16 shrink-0 bg-white/5 border border-white/10 rounded-md px-2 py-1 text-[11px] text-foreground/90 font-mono focus:outline-none focus:border-cyan-400/40 text-right transition-colors hover:bg-white/8"
        />
      </div>
      {description && <p className="text-[9px] text-muted-foreground/50 leading-tight">{description}</p>}
    </div>
  );
}

/* ─── Color Input ──────────────────────────────────────────────────────────── */

export function ColorInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[10px] text-muted-foreground/60 shrink-0 truncate">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-muted-foreground/50 font-mono">{value}</span>
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-8 h-6 rounded border border-white/10 bg-transparent cursor-pointer p-0 shrink-0"
        />
      </div>
    </div>
  );
}

/* ─── Vec3 Input ───────────────────────────────────────────────────────────── */

export function Vec3Input({
  label,
  value,
  onChange,
  step = 0.01,
  description,
}: {
  label: string;
  value: { x: number; y: number; z: number };
  onChange: (v: { x: number; y: number; z: number }) => void;
  step?: number;
  description?: string;
}) {
  const update = (axis: "x" | "y" | "z", v: number) => {
    onChange({ ...value, [axis]: v });
  };
  return (
    <div className="flex flex-col gap-1 w-full">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] text-muted-foreground/60 shrink-0 truncate">{label}</span>
        <div className="flex gap-2 shrink-0">
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground/50 font-medium">X</span>
            <input
              type="number"
              value={fmt(value.x)}
              step={step}
              onChange={(e) => update("x", parseFloat(e.target.value) || 0)}
              className="w-12 bg-white/5 border border-white/10 rounded-md px-1 py-1 text-[11px] text-foreground/90 font-mono focus:outline-none focus:border-cyan-400/40 text-center transition-colors hover:bg-white/8"
            />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground/50 font-medium">Y</span>
            <input
              type="number"
              value={fmt(value.y)}
              step={step}
              onChange={(e) => update("y", parseFloat(e.target.value) || 0)}
              className="w-12 bg-white/5 border border-white/10 rounded-md px-1 py-1 text-[11px] text-foreground/90 font-mono focus:outline-none focus:border-cyan-400/40 text-center transition-colors hover:bg-white/8"
            />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground/50 font-medium">Z</span>
            <input
              type="number"
              value={fmt(value.z)}
              step={step}
              onChange={(e) => update("z", parseFloat(e.target.value) || 0)}
              className="w-12 bg-white/5 border border-white/10 rounded-md px-1 py-1 text-[11px] text-foreground/90 font-mono focus:outline-none focus:border-cyan-400/40 text-center transition-colors hover:bg-white/8"
            />
          </div>
        </div>
      </div>
      {description && <p className="text-[9px] text-muted-foreground/50 leading-tight mt-0.5">{description}</p>}
    </div>
  );
}

/* ─── Collapsible Section ──────────────────────────────────────────────────── */

export function Section({
  title,
  accent = "#22d3ee",
  children,
  defaultOpen = false,
}: {
  title: string;
  accent?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-white/8 rounded-xl bg-black/20 overflow-hidden shrink-0">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2.5 bg-white/4 hover:bg-white/8 transition-colors border-b border-transparent data-[open=true]:border-white/5"
        data-open={open}
      >
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 shrink-0" style={{ color: accent }} />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 shrink-0" style={{ color: accent }} />
        )}
        <span
          className="text-[10px] font-bold uppercase tracking-[0.2em] flex-1 text-left truncate"
          style={{ color: accent }}
        >
          {title}
        </span>
      </button>
      {open && <div className="px-4 py-4 flex flex-col gap-4 border-t border-white/5 bg-white/2">{children}</div>}
    </div>
  );
}

/* ─── Setting Group ─────────────────────────────────────────────────────────── */

export function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 p-3 bg-white/3 rounded-lg border border-white/5">
      <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/40">{title}</p>
      <div className="flex flex-col gap-3">
        {children}
      </div>
    </div>
  );
}

/* ─── Light Editor ─────────────────────────────────────────────────────────── */

export function LightEditor({
  label,
  light,
  onChange,
}: {
  label: string;
  light: LightConfig;
  onChange: (l: LightConfig) => void;
}) {
  return (
    <div className="flex flex-col gap-2 p-2 bg-white/3 rounded-lg">
      <p className="text-[10px] font-semibold text-muted-foreground/70">{label}</p>
      <Vec3Input
        label="Position"
        value={light.position}
        onChange={(p) => onChange({ ...light, position: p })}
        step={0.1}
        description="Light source coordinates."
      />
      <NumInput
        label="Int"
        value={light.intensity}
        onChange={(v) => onChange({ ...light, intensity: v })}
        step={0.1}
        description="Lumen intensity / brightness."
      />
      <ColorInput
        label="Color"
        value={light.color}
        onChange={(c) => onChange({ ...light, color: c })}
      />
    </div>
  );
}
