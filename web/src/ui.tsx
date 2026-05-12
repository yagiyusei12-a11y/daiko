import type { KeyboardEvent, ReactNode } from "react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

export function Card({ title, children }: { title?: string; children: ReactNode }): JSX.Element {
  return (
    <section className="card">
      {title ? <h2 className="card-title">{title}</h2> : null}
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

export type StepWizardStep = {
  id: string;
  title: string;
  description?: string;
  /** false で「次へ」無効（既定は true） */
  canProceed?: boolean;
  children: ReactNode;
};

export function StepWizard({
  open,
  onClose,
  title,
  steps,
  finishLabel = "登録する",
  onFinish,
  isSubmitting = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  steps: StepWizardStep[];
  finishLabel?: string;
  onFinish: () => void | Promise<void>;
  isSubmitting?: boolean;
}): JSX.Element | null {
  const [stepIndex, setStepIndex] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (open) setStepIndex(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      const el = panelRef.current?.querySelector<HTMLElement>(
        'button, [href], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      el?.focus();
    }, 50);
    return () => window.clearTimeout(t);
  }, [open, stepIndex]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: globalThis.KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const last = steps.length - 1;
  const step = steps[stepIndex];
  const canNext = step?.canProceed !== false;

  const goNext = useCallback(() => {
    if (stepIndex < last && canNext) setStepIndex((i) => i + 1);
  }, [stepIndex, last, canNext]);

  const goBack = useCallback(() => {
    if (stepIndex > 0) setStepIndex((i) => i - 1);
  }, [stepIndex]);

  const handleFinish = useCallback(() => {
    void onFinish();
  }, [onFinish]);

  if (!open || !steps.length || !step) return null;

  return (
    <div
      className="step-wizard-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="step-wizard-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="step-wizard-head">
          <h2 id={titleId} className="step-wizard-title">
            {title}
          </h2>
          <div className="step-wizard-progress" aria-hidden>
            {steps.map((s, i) => (
              <span key={s.id} className={`step-wizard-dot${i === stepIndex ? " active" : ""}`} />
            ))}
          </div>
        </div>
        <div className="step-wizard-body">
          <div key={step.id} className="step-wizard-panel-anim">
            <h3 className="step-wizard-step-title">{step.title}</h3>
            {step.description ? <p className="step-wizard-step-desc">{step.description}</p> : null}
            {step.children}
          </div>
        </div>
        <div className="step-wizard-footer">
          <button type="button" className="step-wizard-cancel" onClick={onClose} disabled={isSubmitting}>
            キャンセル
          </button>
          <span className="step-wizard-spacer" />
          {stepIndex > 0 ? (
            <button type="button" onClick={goBack} disabled={isSubmitting}>
              戻る
            </button>
          ) : null}
          {stepIndex < last ? (
            <button type="button" onClick={goNext} disabled={!canNext || isSubmitting}>
              次へ
            </button>
          ) : (
            <button type="button" onClick={() => void handleFinish()} disabled={!canNext || isSubmitting}>
              {isSubmitting ? "送信中…" : finishLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
