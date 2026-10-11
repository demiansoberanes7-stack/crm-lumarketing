import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function ChartCard({
  title,
  children,
  className,
  contentClassName,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <article className={cn("chart-card min-w-0 rounded-xl border p-3 sm:p-4", className)}>
      <h3 className="mb-2 text-xs font-medium text-muted-foreground">{title}</h3>
      <div className={cn("min-w-0", contentClassName)}>{children}</div>
    </article>
  );
}
