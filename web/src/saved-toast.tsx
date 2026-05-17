import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

type SavedToastCtx = {
  flashSaved: () => void;
  /** 画面下部にメッセージを約1秒表示（保存トーストと同じ見た目） */
  flashMessage: (message: string, durationMs?: number) => void;
};

const Ctx = createContext<SavedToastCtx | null>(null);

export function SavedToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [message, setMessage] = useState<string | null>(null);
  const tref = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashMessage = useCallback((text: string, durationMs = 1000) => {
    if (tref.current) clearTimeout(tref.current);
    setMessage(text);
    tref.current = setTimeout(() => {
      setMessage(null);
      tref.current = null;
    }, durationMs);
  }, []);

  const flashSaved = useCallback(() => flashMessage("保存しました"), [flashMessage]);

  return (
    <Ctx.Provider value={{ flashSaved, flashMessage }}>
      {children}
      {message ? (
        <div className="saved-toast" role="status" aria-live="polite">
          {message}
        </div>
      ) : null}
    </Ctx.Provider>
  );
}

export function useSavedToast(): SavedToastCtx {
  const v = useContext(Ctx);
  if (!v) {
    return { flashSaved: () => {}, flashMessage: () => {} };
  }
  return v;
}
