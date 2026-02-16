export default function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-xl bg-gradient-to-r from-purple-100 to-pink-100 ${className}`}
      aria-hidden
    />
  );
}
