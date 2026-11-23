import { CircleCheck, CircleDashed, CircleX } from "lucide-react";
import type { MasteryStatus } from "@/lib/types";

export default function StatusPill({ status, threshold }: { status: MasteryStatus; threshold: number }) {
  if (status.passed) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2.5 py-1 text-xs font-semibold text-success">
        <CircleCheck className="h-3.5 w-3.5" aria-hidden /> Lulus · {status.best_score}
      </span>
    );
  }
  if (status.attempts > 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2.5 py-1 text-xs font-semibold text-warning">
        <CircleX className="h-3.5 w-3.5" aria-hidden /> Belum lulus · terbaik {status.best_score}/{threshold}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-semibold text-muted">
      <CircleDashed className="h-3.5 w-3.5" aria-hidden /> Belum dikerjakan
    </span>
  );
}
