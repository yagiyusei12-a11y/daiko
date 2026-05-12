import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { useAuth } from "../auth";
import { Card, Err, StepWizard, Tabs, type StepWizardStep } from "../ui";

type Role = { id: string; name: string; permissions: unknown };
type UserRow = {
  id: string;
  email: string;
  displayName: string | null;
  employeeId: string | null;
  roles: { id: string; name: string }[];
};
type EmpRow = { id: string; familyName: string; givenName: string };

export default function Rbac(): JSX.Element {
  const { can } = useAuth();
  const manage = can("rbac.manage");
  const [rbacTab, setRbacTab] = useState("roles");
  const [roles, setRoles] = useState<Role[]>([]);
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [usersErr, setUsersErr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newPerms, setNewPerms] = useState("tenant.settings\npayroll.unlock");
  const [assignRole, setAssignRole] = useState<Record<string, string>>({});
  const [roleWizardOpen, setRoleWizardOpen] = useState(false);
  const [roleWizardSubmitting, setRoleWizardSubmitting] = useState(false);
  const [empsRbac, setEmpsRbac] = useState<EmpRow[]>([]);
  const [userEmpPick, setUserEmpPick] = useState<Record<string, string>>({});

  async function loadRoles(): Promise<void> {
    const r = await apiFetch<{ roles: Role[] }>("/roles");
    if (r.ok) setRoles(r.data.roles);
    else setErr(r.error);
  }

  async function loadUsers(): Promise<void> {
    if (!manage) return;
    const r = await apiFetch<{ users: UserRow[] }>("/users");
    if (!r.ok) {
      setUsers(null);
      setUsersErr(r.error);
      return;
    }
    setUsersErr(null);
    setUsers(r.data.users);
    const pick: Record<string, string> = {};
    for (const u of r.data.users) pick[u.id] = u.employeeId ?? "";
    setUserEmpPick(pick);
  }

  useEffect(() => {
    void (async () => {
      await loadRoles();
      if (manage) {
        await loadUsers();
        const er = await apiFetch<{ employees: EmpRow[] }>("/employees");
        if (er.ok) setEmpsRbac(er.data.employees);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 初回と manage 切替のみで十分
  }, [manage]);

  async function submitNewRole(): Promise<void> {
    if (!manage) return;
    setErr(null);
    setRoleWizardSubmitting(true);
    try {
      const permissions = newPerms
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      const r = await apiFetch<Role>("/roles", { method: "POST", json: { name: newName.trim(), permissions } });
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      setNewName("");
      setNewPerms("tenant.settings\npayroll.unlock");
      setRoleWizardOpen(false);
      await loadRoles();
    } finally {
      setRoleWizardSubmitting(false);
    }
  }

  const nameOk = newName.trim().length > 0;
  const permsOk = newPerms.trim().length > 0;

  const roleWizardSteps: StepWizardStep[] = [
    {
      id: "rname",
      title: "ロール名を入力してください",
      description: "既存と重ならない名前を付けます。",
      canProceed: nameOk,
      children: (
        <>
          <label>名前</label>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
        </>
      ),
    },
    {
      id: "rperms",
      title: "権限を入力してください",
      description: "1 行に 1 つの権限文字列（例: tenant.settings）。",
      canProceed: permsOk,
      children: (
        <>
          <label>権限（1 行 1 権限文字列）</label>
          <textarea rows={6} value={newPerms} onChange={(e) => setNewPerms(e.target.value)} style={{ width: "100%" }} />
        </>
      ),
    },
    {
      id: "rconfirm",
      title: "作成内容の確認",
      canProceed: nameOk && permsOk,
      children: (
        <dl className="step-wizard-summary">
          <dt>名前</dt>
          <dd>{newName.trim()}</dd>
          <dt>権限行数</dt>
          <dd>
            {
              newPerms
                .split(/\r?\n/)
                .map((s) => s.trim())
                .filter(Boolean).length
            }{" "}
            件
          </dd>
        </dl>
      ),
    },
  ];

  async function delRole(id: string, name: string): Promise<void> {
    if (!manage || !confirm(`ロール「${name}」を削除しますか？`)) return;
    setErr(null);
    const r = await apiFetch(`/roles/${id}`, { method: "DELETE" });
    if (!r.ok) setErr((r as { ok: false; error: string }).error);
    else await loadRoles();
  }

  async function assign(userId: string): Promise<void> {
    if (!manage) return;
    const roleId = assignRole[userId];
    if (!roleId) return;
    setErr(null);
    const r = await apiFetch(`/users/${userId}/roles`, { method: "POST", json: { roleId } });
    if (!r.ok) setErr((r as { ok: false; error: string }).error);
    else await loadUsers();
  }

  async function removeRole(userId: string, roleId: string): Promise<void> {
    if (!manage) return;
    setErr(null);
    const r = await apiFetch(`/users/${userId}/roles/${roleId}`, { method: "DELETE" });
    if (!r.ok) setErr((r as { ok: false; error: string }).error);
    else await loadUsers();
  }

  async function saveUserEmployee(userId: string): Promise<void> {
    if (!manage) return;
    setErr(null);
    const v = (userEmpPick[userId] ?? "").trim();
    const r = await apiFetch(`/users/${userId}`, {
      method: "PATCH",
      json: { employeeId: v === "" ? null : v },
    });
    if (!r.ok) setErr((r as { ok: false; error: string }).error);
    else await loadUsers();
  }

  const tabItems = [
    {
      id: "roles",
      label: "ロール一覧",
      children: (
        <table>
          <thead>
            <tr>
              <th>名前</th>
              <th>権限</th>
              {manage ? <th /> : null}
            </tr>
          </thead>
          <tbody>
            {roles.map((role) => (
              <tr key={role.id}>
                <td>{role.name}</td>
                <td>
                  <code style={{ fontSize: "0.75rem" }}>{JSON.stringify(role.permissions)}</code>
                </td>
                {manage ? (
                  <td>
                    {role.name !== "owner" ? (
                      <button type="button" onClick={() => void delRole(role.id, role.name)}>
                        削除
                      </button>
                    ) : (
                      "—"
                    )}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      ),
    },
    ...(manage
      ? [
          {
            id: "create",
            label: "ロール作成",
            children: (
              <>
                <p style={{ marginTop: 0 }}>
                  <button type="button" onClick={() => setRoleWizardOpen(true)}>
                    ロールを作成
                  </button>
                </p>
                <p style={{ fontSize: "0.9rem" }}>
                  権限テンプレ:{" "}
                  <button type="button" onClick={() => setNewPerms("staff.shift")}>
                    スタッフ（勤務ウィザード）
                  </button>{" "}
                  <button type="button" onClick={() => setNewPerms("nav.full")}>
                    管理者（全メニュー）
                  </button>
                </p>
                <StepWizard
                  open={roleWizardOpen}
                  onClose={() => {
                    setRoleWizardOpen(false);
                    setNewName("");
                    setNewPerms("tenant.settings\npayroll.unlock");
                  }}
                  title="ロールを作成"
                  steps={roleWizardSteps}
                  finishLabel="作成"
                  onFinish={submitNewRole}
                  isSubmitting={roleWizardSubmitting}
                />
              </>
            ),
          },
          {
            id: "assign",
            label: "ユーザー割当",
            children: (
              <>
                <Err msg={usersErr} />
                {users ? (
                  <table>
                    <thead>
                      <tr>
                        <th>メール</th>
                        <th>表示名</th>
                        <th>紐づけ従業員</th>
                        <th>付与済み</th>
                        <th>追加</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((u) => (
                        <tr key={u.id}>
                          <td>{u.email}</td>
                          <td>{u.displayName ?? "—"}</td>
                          <td>
                            <select
                              value={userEmpPick[u.id] ?? ""}
                              onChange={(e) => setUserEmpPick((m) => ({ ...m, [u.id]: e.target.value }))}
                            >
                              <option value="">なし</option>
                              {empsRbac.map((e) => (
                                <option key={e.id} value={e.id}>
                                  {e.familyName} {e.givenName}
                                </option>
                              ))}
                            </select>{" "}
                            <button type="button" onClick={() => void saveUserEmployee(u.id)}>
                              保存
                            </button>
                          </td>
                          <td>
                            {u.roles.map((r) => (
                              <span key={r.id} style={{ marginRight: 6 }}>
                                {r.name}
                                {r.name !== "owner" ? (
                                  <button type="button" onClick={() => void removeRole(u.id, r.id)}>
                                    ×
                                  </button>
                                ) : null}
                              </span>
                            ))}
                          </td>
                          <td>
                            <select
                              value={assignRole[u.id] ?? ""}
                              onChange={(e) => setAssignRole((m) => ({ ...m, [u.id]: e.target.value }))}
                            >
                              <option value="">ロールを選択</option>
                              {roles.map((r) => (
                                <option key={r.id} value={r.id}>
                                  {r.name}
                                </option>
                              ))}
                            </select>
                            <button type="button" onClick={() => void assign(u.id)}>
                              付与
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p style={{ fontSize: "0.9rem" }}>ユーザー一覧を読み込み中…</p>
                )}
              </>
            ),
          },
        ]
      : [
          {
            id: "assign",
            label: "ユーザー割当",
            children: <p style={{ fontSize: "0.9rem", margin: 0 }}>ユーザーへのロール付与は rbac.manage が必要です。</p>,
          },
        ]),
  ];

  return (
    <Card title="権限（RBAC）">
      <Err msg={err} />
      <Tabs aria-label="権限セクション" activeId={rbacTab} onActiveChange={setRbacTab} items={tabItems} />
    </Card>
  );
}
