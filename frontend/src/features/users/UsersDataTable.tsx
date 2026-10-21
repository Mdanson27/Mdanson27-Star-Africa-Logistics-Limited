import React, { useCallback, useState } from "react";
import { Search, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { AddUser } from "@/features/users/AddUser";
import { UserActionsMenu } from "@/features/users/UserActionsMenu";
import { SyncStatus } from "@/components/common/SyncStatus";
import { EmptyState } from "@/components/common/EmptyState";
import { apiV1UsersListUsers } from "@/client/sdk.gen";
import type { UserRead } from "@/client/types.gen";
import { useAuth } from "@/hooks/useAuth";
import { useBackgroundRefresh } from "@/hooks/useBackgroundRefresh";
import { readSectionCache, writeSectionCache } from "@/lib/sectionCache";
import { cn } from "@/lib/utils";

export const UsersDataTable: React.FC = () => {
  const { user: currentUser } = useAuth();
  const [initialCache] = useState(() => readSectionCache<UserRead[]>(currentUser?.id, "users"));
  const [users, setUsers] = useState<UserRead[]>(initialCache?.data ?? []);
  const [search, setSearch] = useState<string>("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(initialCache?.savedAt ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setIsRefreshing(true);
    setLoadError(null);
    try {
      const res = await apiV1UsersListUsers({
        query: { skip: 0, limit: 100 },
      });
      const nextUsers = res.data?.data
        ? res.data.data
        : Array.isArray(res.data)
          ? (res.data as UserRead[])
          : [];
      setUsers(nextUsers);
      setLastSyncedAt(writeSectionCache(currentUser?.id, "users", nextUsers));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Users could not be refreshed.");
    } finally {
      setIsRefreshing(false);
    }
  }, [currentUser?.id]);

  useBackgroundRefresh(fetchUsers);

  const filteredUsers = users.filter(
    (u) =>
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      (u.full_name && u.full_name.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">User Governance</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage system administrators, provision accounts, and govern role-based access.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <SyncStatus isRefreshing={isRefreshing} error={loadError} lastSyncedAt={lastSyncedAt} />
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchUsers()}
            disabled={isRefreshing}
            className="gap-1.5 text-xs"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin text-primary")} />
            Refresh
          </Button>
          <AddUser onSuccess={fetchUsers} />
        </div>
      </div>

      <div className="relative w-full max-w-sm">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Filter users..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-md border border-input bg-background pl-9 pr-4 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden shadow-xs">
        {filteredUsers.length === 0 ? (
          <EmptyState
            title="No Users Found"
            description={search ? "No users match your filter criteria." : "No platform users registered yet."}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-muted/50 text-muted-foreground font-semibold uppercase tracking-wider text-xs">
                <tr>
                  <th className="px-6 py-3.5 font-medium">Full Name</th>
                  <th className="px-6 py-3.5 font-medium">Email</th>
                  <th className="px-6 py-3.5 font-medium">Role</th>
                  <th className="px-6 py-3.5 font-medium">Status</th>
                  <th className="px-6 py-3.5 text-right font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredUsers.map((u) => {
                  const isCurrentUser = currentUser?.id === u.id;

                  return (
                    <tr key={u.id} className="hover:bg-muted/50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "font-medium",
                              !u.full_name && "text-muted-foreground"
                            )}
                          >
                            {u.full_name || "N/A"}
                          </span>
                          {isCurrentUser && (
                            <Badge variant="outline" className="text-xs">
                              You
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-muted-foreground text-xs font-mono">
                        {u.email}
                      </td>
                      <td className="px-6 py-4">
                        <Badge variant={u.is_superuser ? "default" : "secondary"}>
                          {u.is_superuser ? "Superuser" : "User"}
                        </Badge>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "h-2 w-2 rounded-full",
                              u.is_active ? "bg-emerald-500" : "bg-zinc-400"
                            )}
                          />
                          <span className={u.is_active ? "text-foreground" : "text-muted-foreground text-xs"}>
                            {u.is_active ? "Active" : "Inactive"}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <UserActionsMenu user={u} onSuccess={fetchUsers} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default UsersDataTable;
