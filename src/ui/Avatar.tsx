export type AvatarSize = "sm" | "md" | "lg";

export function initials(name: string): string {
  const words = (name.split("·").pop() ?? name).match(/[A-Za-z0-9]+/g) ?? [];
  const letters = words.length > 1 ? words[0]![0]! + words[1]![0]! : (words[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

export function Avatar({ name, color, size = "sm", vacant }: { name: string; color?: string; size?: AvatarSize; vacant?: boolean }) {
  return (
    <span
      className={`zui-avatar zui-avatar--${size}${vacant ? " zui-portrait--vacant" : ""}`}
      style={color ? { background: color } : undefined}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}
