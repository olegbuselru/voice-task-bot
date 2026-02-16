import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}

export default function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-purple-200 bg-white/50 px-8 py-12 text-center">
      {icon && (
        <div className="mb-4 text-4xl opacity-60" aria-hidden>
          {icon}
        </div>
      )}
      <h3 className="text-lg font-bold text-purple-800">{title}</h3>
      {description && <p className="mt-2 max-w-xs text-sm text-purple-600">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
