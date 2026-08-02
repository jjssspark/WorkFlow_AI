import { cn } from "../../global/component/ui/utils";

export function ScreenshotFrame({
  src,
  alt,
  className,
  focusTop = true,
}: {
  src: string;
  alt: string;
  className?: string;
  focusTop?: boolean;
}) {
  return (
    <div className={cn("overflow-hidden rounded-xl border border-border bg-card shadow-sm", className)}>
      <div className="flex items-center gap-1.5 border-b border-border bg-muted/60 px-3 py-2">
        <span className="size-2.5 rounded-full bg-destructive/60" />
        <span className="size-2.5 rounded-full bg-amber-400/70" />
        <span className="size-2.5 rounded-full bg-emerald-400/70" />
      </div>
      <div className="h-56 overflow-hidden sm:h-64">
        <img
          src={src}
          alt={alt}
          className={cn("w-full object-cover object-left", focusTop ? "object-top" : "object-center")}
          loading="lazy"
        />
      </div>
    </div>
  );
}
