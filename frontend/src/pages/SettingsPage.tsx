import React, { useMemo, useState } from "react";
import { KeyRound, LogOut, ShieldCheck, UserRoundCog, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { SectionNav } from "@/components/common/SectionNav";
import { StaffDirectory } from "@/features/people/StaffDirectory";
import { useAuth } from "@/hooks/useAuth";
import { useCustomToast } from "@/hooks/useCustomToast";

export const SettingsPage: React.FC = () => {
  const {
    user,
    isPlatformAdmin,
    requestPasswordReset,
    resetPasswordWithOtp,
    logout,
  } = useAuth();
  const { showSuccessToast, showErrorToast } = useCustomToast();
  const [section, setSection] = useState<"staff" | "account">(isPlatformAdmin ? "staff" : "account");
  const [resetRequested, setResetRequested] = useState(false);
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const sections = useMemo(() => [
    ...(isPlatformAdmin ? [{ id: "staff" as const, label: "Staff & Access" }] : []),
    { id: "account" as const, label: "My Account" },
  ], [isPlatformAdmin]);

  const sendResetCode = async () => {
    if (!user?.email || busy) return;
    setBusy(true);
    try {
      await requestPasswordReset(user.email);
      setResetRequested(true);
      showSuccessToast(`A password reset code was sent to ${user.email}.`, "Reset code sent");
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : "Password reset could not be started.");
    } finally { setBusy(false); }
  };

  const updatePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user?.email) return;
    if (!otp.trim()) {
      showErrorToast("Enter the reset code sent to your email.");
      return;
    }
    if (newPassword.length < 8) {
      showErrorToast("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      showErrorToast("The new passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await resetPasswordWithOtp(user.email, otp.trim(), newPassword);
      setOtp(""); setNewPassword(""); setConfirmPassword(""); setResetRequested(false);
      showSuccessToast("Your password has been updated.", "Password changed");
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : "Password could not be updated.");
    } finally { setBusy(false); }
  };

  return (
    <div className="max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage staff access and your own secure Star Africa Logistics account from one place.</p>
      </div>

      <SectionNav items={sections} active={section} onChange={setSection} ariaLabel="Settings sections" />

      {section === "staff" && isPlatformAdmin && (
        <div className="space-y-5">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="p-5 lg:col-span-2">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-primary/10 p-2 text-primary"><UsersRound className="h-5 w-5" /></div>
                <div>
                  <h2 className="font-semibold">Staff directory is the access list</h2>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">Add an employee here before they use Star Africa Logistics. Active staff appear in task/project assignment dropdowns and can sign in with the same email through Google or the configured authentication method. Deactivate a staff member to remove them from assignments and block future session verification.</p>
                </div>
              </div>
            </Card>
            <Card className="p-5">
              <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-emerald-500" /><h2 className="font-semibold">Platform administrator</h2></div>
              <p className="mt-3 text-sm font-medium">automindsafrica@gmail.com</p>
              <p className="mt-1 text-xs text-muted-foreground">Only the configured platform administrator can create/deactivate employees and access payroll administration.</p>
            </Card>
          </div>
          <StaffDirectory compact />
        </div>
      )}

      {section === "account" && (
        <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
          <Card className="p-5">
            <div className="flex items-center gap-3"><div className="rounded-lg bg-primary/10 p-2 text-primary"><UserRoundCog className="h-5 w-5" /></div><div><h2 className="font-semibold">Signed-in account</h2><p className="text-xs text-muted-foreground">Identity verified before the application is opened.</p></div></div>
            <div className="mt-5 space-y-4">
              <div><p className="text-xs text-muted-foreground">Name</p><p className="mt-1 font-medium">{user?.full_name || "Star Africa Logistics user"}</p></div>
              <div><p className="text-xs text-muted-foreground">Email</p><p className="mt-1 font-medium">{user?.email}</p></div>
              <div><p className="text-xs text-muted-foreground">Access level</p><p className="mt-1 font-medium">{isPlatformAdmin ? "Platform administrator" : "Staff member"}</p></div>
            </div>
            <Button variant="outline" className="mt-6" onClick={() => void logout()}><LogOut className="mr-2 h-4 w-4" /> Sign out</Button>
          </Card>

          <Card className="p-5">
            <div className="flex items-center gap-3"><div className="rounded-lg bg-primary/10 p-2 text-primary"><KeyRound className="h-5 w-5" /></div><div><h2 className="font-semibold">Password security</h2><p className="text-xs text-muted-foreground">Reset your password through the verified email attached to this account.</p></div></div>
            {!resetRequested ? (
              <div className="mt-6"><Button onClick={() => void sendResetCode()} disabled={busy}>{busy ? "Sending…" : "Send password reset code"}</Button></div>
            ) : (
              <form onSubmit={updatePassword} className="mt-5 space-y-4">
                <Input label="Reset code" value={otp} onChange={(event) => setOtp(event.target.value)} placeholder="Enter the code from your email" />
                <Input label="New password" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
                <Input label="Confirm new password" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
                <div className="flex gap-2"><Button type="submit" disabled={busy}>{busy ? "Updating…" : "Update password"}</Button><Button type="button" variant="outline" onClick={() => setResetRequested(false)}>Cancel</Button></div>
              </form>
            )}
          </Card>
        </div>
      )}
    </div>
  );
};

export default SettingsPage;
