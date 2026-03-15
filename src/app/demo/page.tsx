import { LiquidButton } from "@/components/ui/liquid-glass-button";

export default function DemoPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 font-sans">
      <h1 className="mb-6 text-center text-xl font-bold text-foreground sm:mb-8 sm:text-2xl">Liquid Glass Button Demo</h1>
      <div className="relative h-56 w-full max-w-3xl rounded-xl border border-border bg-zinc-950/5 isolate overflow-hidden sm:h-64 dark:bg-zinc-950/50"> 
        <div className="absolute inset-0 bg-linear-to-br from-cyan-500/20 to-emerald-500/20 -z-10" />
        <LiquidButton className="absolute top-1/2 left-1/2 z-10 -translate-x-1/2 -translate-y-1/2" size="xxl">
          Liquid Glass
        </LiquidButton> 
      </div>
    </div>
  )
}
