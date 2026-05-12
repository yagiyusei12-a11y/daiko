import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

type SavedToastCtx = {
  flashSaved: () => void;
};

const Ctx = createContext<SavedToastCtx | null>(null);

export function SavedToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [visible, setVisible] = useState(false);
  const tref = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashSaved = useCallback(() => {
    if (tref.current) clearTimeout(tref.current);
    setVisible(true);
    tref.current = setTimeout(() => {
      setVisible(false);
      tref.current = null;
    }, 1000);
  }, []);

  return (
    <Ctx.Provider value={{ flashSaved }}>
      {children}
      {visible ? (
        <div className="saved-toast" role="status" aria-live="polite">
          保存しました。
        </div>
      ) : null}
    </Ctx.Provider>
  );
}

export function useSavedToast(): SavedToastCtx {
  const v = useContext(Ctx);
  if (!v) {
    return { flashSaved: () => {} };
  }
  return v;
}
