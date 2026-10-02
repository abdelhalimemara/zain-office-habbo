import { useEffect, useId, useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";

interface ShellProps {
  title: ReactNode;
  accent?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  className?: string;
}

function accentStyle(accent?: string): CSSProperties | undefined {
  return accent ? ({ "--accent": accent } as CSSProperties) : undefined;
}

export function Panel({ title, accent, onClose, children, wide, className }: ShellProps) {
  const titleId = useId();
  return (
    <aside className={`zui-panel${wide ? " zui-panel--wide" : ""}${className ? ` ${className}` : ""}`} aria-labelledby={titleId} style={accentStyle(accent)}>
      <header className="zui-panel__header">
        <span className="zui-panel__dot" aria-hidden="true" />
        <h2 id={titleId} className="zui-heading">
          {title}
        </h2>
        <button type="button" className="zui-btn zui-btn--icon" onClick={onClose} aria-label="Close panel">
          ×
        </button>
      </header>
      <div className="zui-panel__body">{children}</div>
    </aside>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({ title, accent, onClose, children }: ShellProps) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const field = ref.current?.querySelector<HTMLElement>(".zui-panel__body input, .zui-panel__body select, .zui-panel__body textarea");
    (field ?? ref.current?.querySelector<HTMLElement>(FOCUSABLE))?.focus();
    return () => previous?.focus?.();
  }, []);

  const trapTab = (e: KeyboardEvent) => {
    if (e.key !== "Tab" || !ref.current) return;
    const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="zui-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className="zui-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={accentStyle(accent)}
        onKeyDown={trapTab}
      >
        <header className="zui-panel__header">
          <span className="zui-panel__dot" aria-hidden="true" />
          <h2 id={titleId} className="zui-heading">
            {title}
          </h2>
          <button type="button" className="zui-btn zui-btn--icon" onClick={onClose} aria-label="Close dialog">
            ×
          </button>
        </header>
        <div className="zui-panel__body">{children}</div>
      </div>
    </div>
  );
}
