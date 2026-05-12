/** 必須項目ラベル用（帳票・名簿などで統一） */

export function ReqMark(): JSX.Element {
  return (
    <span style={{ color: "#c62828", fontWeight: 700, marginRight: "0.25em" }} aria-hidden>
      ※
    </span>
  );
}

export function ReqLabel({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <label>
      <ReqMark />
      {children}
    </label>
  );
}
