"use client";

import { ErrorRecovery } from "@/components/error-recovery";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return <ErrorRecovery reset={reset} />;
}
