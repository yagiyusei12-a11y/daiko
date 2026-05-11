import type { KeyboardEvent, ReactNode } from "react";

export function Card({ title, children }: { title?: string; children: ReactNode }): JSX.Element {
  return (
    <section className="card">
      {title ? <h2 style={{ margin: "0 0 0.5rem", fontSize: "1rem" }}>{title}</h2> : null}
      {children}
    </section>
  );
}

export function Err({ msg }: { msg: string | null }): JSX.Element | null {
  if (!msg) return null;
  return <p className="err">{msg}</p>;
}

export type TabDef = { id: string; label: string; children: ReactNode };

export function Tabs({
  items,
  activeId,
  onActiveChange,
  "aria-label": ariaLabel = "セクション",
}: {
  items: TabDef[];
  activeId: string;
  onActiveChange: (id: string) => void;
  "aria-label"?: string;
}): JSX.Element | null {
  if (!items.length) return null;

  const idx = items.findIndex((x) => x.id === activeId);
  const selectedIndex = idx >= 0 ? idx : 0;
  const effectiveId = items[selectedIndex].id;

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      const next = (selectedIndex + 1) % items.length;
      onActiveChange(items[next].id);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = (selectedIndex - 1 + items.length) % items.length;
      onActiveChange(items[next].id);
    } else if (e.key === "Home") {
      e.preventDefault();
      onActiveChange(items[0].id);
    } else if (e.key === "End") {
      e.preventDefault();
      onActiveChange(items[items.length - 1].id);
    }
  }

  return (
    <div className="tabs">
      <div role="tablist" className="tabs-list" aria-label={ariaLabel} onKeyDown={onKeyDown}>
        {items.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={effectiveId === tab.id}
            aria-controls={`panel-${tab.id}`}
            tabIndex={effectiveId === tab.id ? 0 : -1}
            className={`tabs-trigger${effectiveId === tab.id ? " active" : ""}`}
            onClick={() => onActiveChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {items.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`panel-${tab.id}`}
          aria-labelledby={`tab-${tab.id}`}
          hidden={effectiveId !== tab.id}
          className="tabs-panel"
        >
          {tab.children}
        </div>
      ))}
    </div>
  );
}
