import React, { useState } from "react";
import { AlertTriangle, Check, AlertCircle } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Alert, AlertDescription } from "@/components/ui/Alert";
import { SectionNav } from "@/components/common/SectionNav";
import { useAuth } from "@/hooks/useAuth";
import { useCustomToast } from "@/hooks/useCustomToast";
import { apiV1UsersMeUpdateMe, apiV1UsersMePasswordUpdatePasswordMe, apiV1UsersMeDeleteMe } from "@/client/sdk.gen";

type SettingsSection =
  | "company"
  | "users_staff"
  | "projects"
  | "documents"
  | "business"
  | "notifications"
  | "integrations";

const settingsCopy: Record<SettingsSection, { title: string; description: string }> = {
  company: { title: "Company settings", description: "Star Africa Logistics company identity, contact details, currency and business-wide preferences belong here." },
  users_staff: { title: "Users & Staff", description: "Personal account settings are available now. Staff roles and permissions will be added in the dedicated access-control phase." },
  projects: { title: "Project settings", description: "Project statuses, categories, priorities and project defaults will be managed here." },
  documents: { title: "Document settings", description: "Document categories, OCR rules and review defaults will be managed here." },
  business: { title: "Business settings", description: "Quotation, invoice, purchase-order numbering and commercial defaults will be managed here." },
  notifications: { title: "Notification settings", description: "Task reminders, project deadlines, payment reminders and alert preferences will be managed here." },
  integrations: { title: "Integrations", description: "External services and future Star Africa Logistics integrations will be connected from this area." },
};

export const SettingsPage: React.FC = () => {
  const { user, refreshProfile, logout } = useAuth();
  const { showSuccessToast, showErrorToast } = useCustomToast();
  const [section, setSection] = useState<SettingsSection>("company");
  const [activeTab, setActiveTab] = useState<"profile" | "password" | "danger">("profile");

  const settingsSections = [
    { id: "company" as const, label: "Company" },
    { id: "users_staff" as const, label: "Users & Staff" },
    { id: "projects" as const, label: "Projects" },
    { id: "documents" as const, label: "Documents" },
    { id: "business" as const, label: "Business" },
    { id: "notifications" as const, label: "Notifications" },
    { id: "integrations" as const, label: "Integrations" },
  ];

  // Profile Form State
  const [fullName, setFullName] = useState<string>(user?.full_name || "");
  const [email, setEmail] = useState<string>(user?.email || "");
  const [isUpdatingProfile, setIsUpdatingProfile] = useState<boolean>(false);
  const [profileEmailError, setProfileEmailError] = useState<string | null>(null);

  // Password Form State
  const [currentPassword, setCurrentPassword] = useState<string>("");
  const [newPassword, setNewPassword] = useState<string>("");
  const [confirmPassword, setConfirmPassword] = useState<string>("");
  const [isUpdatingPassword, setIsUpdatingPassword] = useState<boolean>(false);
  const [currentPasswordError, setCurrentPasswordError] = useState<string | null>(null);
  const [newPasswordError, setNewPasswordError] = useState<string | null>(null);
  const [confirmPasswordError, setConfirmPasswordError] = useState<string | null>(null);

  // Danger Zone State
  const [isDeleteOpen, setIsDeleteOpen] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email.trim() || !emailRegex.test(email.trim())) {
      setProfileEmailError("Invalid email address");
      return;
    }
    setProfileEmailError(null);

    setIsUpdatingProfile(true);

    try {
      const res = await apiV1UsersMeUpdateMe({
        body: {
          full_name: fullName.trim() || null,
          email: email.trim(),
        },
      });

      if (res.response?.ok) {
        showSuccessToast("User updated successfully");
        await refreshProfile();
      } else {
        const msg = res.error ? String(res.error) : "User with this email already exists";
        showErrorToast(msg);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update profile.";
      showErrorToast(msg);
    } finally {
      setIsUpdatingProfile(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    let isValid = true;

    if (!currentPassword) {
      setCurrentPasswordError("Password is required");
      isValid = false;
    } else {
      setCurrentPasswordError(null);
    }

    if (!newPassword) {
      setNewPasswordError("Password is required");
      isValid = false;
    } else if (newPassword.length < 8) {
      setNewPasswordError("Password must be at least 8 characters");
      isValid = false;
    } else {
      setNewPasswordError(null);
    }

    if (!confirmPassword) {
      setConfirmPasswordError("Password confirmation is required");
      isValid = false;
    } else if (newPassword !== confirmPassword) {
      setConfirmPasswordError("The passwords don't match");
      isValid = false;
    } else {
      setConfirmPasswordError(null);
    }

    if (!isValid) return;

    if (currentPassword === newPassword) {
      setNewPasswordError("New password cannot be the same as the current one");
      return;
    }

    setIsUpdatingPassword(true);

    try {
      const res = await apiV1UsersMePasswordUpdatePasswordMe({
        body: {
          current_password: currentPassword,
          new_password: newPassword,
        },
      });

      if (res.response?.ok) {
        showSuccessToast("Password updated successfully");
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        const msg = res.error ? String(res.error) : "Incorrect password";
        showErrorToast(msg);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update password.";
      showErrorToast(msg);
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  const handleDeleteAccount = async () => {
    setIsDeleting(true);
    setDeleteErr(null);

    try {
      const res = await apiV1UsersMeDeleteMe();
      if (res.response?.ok) {
        showSuccessToast("Your account has been successfully deleted");
        await logout();
      } else {
        const msg = res.error ? String(res.error) : "Super users are not allowed to delete themselves";
        setDeleteErr(msg);
        showErrorToast(msg);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to delete account.";
      setDeleteErr(msg);
      showErrorToast(msg);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure Star Africa Logistics company settings, work standards, access and integrations from one place.
        </p>
      </div>

      <SectionNav
        items={settingsSections}
        active={section}
        onChange={setSection}
        ariaLabel="Settings sections"
      />

      {section === "users_staff" ? (
        <>
      {/* Tabs Header */}
      <div className="flex gap-2 border-b border-border pb-2">
        <button
          onClick={() => setActiveTab("profile")}
          className={`px-4 py-2 text-xs font-medium rounded-lg transition-colors ${
            activeTab === "profile"
              ? "bg-accent text-accent-foreground font-semibold"
              : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
          }`}
        >
          My profile
        </button>
        <button
          onClick={() => setActiveTab("password")}
          className={`px-4 py-2 text-xs font-medium rounded-lg transition-colors ${
            activeTab === "password"
              ? "bg-accent text-accent-foreground font-semibold"
              : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
          }`}
        >
          Password
        </button>
        {!user?.is_superuser && (
          <button
            onClick={() => setActiveTab("danger")}
            className={`px-4 py-2 text-xs font-medium rounded-lg transition-colors ${
              activeTab === "danger"
                ? "bg-destructive/15 text-destructive font-semibold"
                : "text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            }`}
          >
            Danger zone
          </button>
        )}
      </div>

      {/* Profile Tab */}
      {activeTab === "profile" && (
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>User Information</CardTitle>
            <CardDescription>Update your personal information</CardDescription>
          </CardHeader>

          <form onSubmit={handleUpdateProfile} className="space-y-4" noValidate>
            <Input
              id="settings_fullname"
              type="text"
              label="Full name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />

            <Input
              id="settings_email"
              type="email"
              label="Email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (profileEmailError) setProfileEmailError(null);
              }}
              error={profileEmailError ?? undefined}
              required
            />

            <div className="pt-2 flex justify-start">
              <Button type="submit" loading={isUpdatingProfile}>
                Save
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* Password Tab */}
      {activeTab === "password" && (
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Change Password</CardTitle>
            <CardDescription>Update your account password</CardDescription>
          </CardHeader>

          <form onSubmit={handleUpdatePassword} className="space-y-4" noValidate>
            <PasswordInput
              id="current_password"
              label="Current Password"
              placeholder="••••••••"
              value={currentPassword}
              onChange={(e) => {
                setCurrentPassword(e.target.value);
                if (currentPasswordError) setCurrentPasswordError(null);
              }}
              error={currentPasswordError ?? undefined}
              required
            />

            <PasswordInput
              id="new_password"
              label="New Password"
              placeholder="••••••••"
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value);
                if (newPasswordError) setNewPasswordError(null);
              }}
              error={newPasswordError ?? undefined}
              required
            />

            <PasswordInput
              id="confirm_password"
              label="Confirm Password"
              placeholder="••••••••"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                if (confirmPasswordError) setConfirmPasswordError(null);
              }}
              error={confirmPasswordError ?? undefined}
              required
            />

            <div className="pt-2 flex justify-start">
              <Button type="submit" loading={isUpdatingPassword}>
                Update Password
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* Danger Zone Tab */}
      {activeTab === "danger" && (
        <div className="max-w-md mt-4 rounded-lg border border-destructive/50 p-4">
          <h3 className="font-semibold text-destructive">Delete Account</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Permanently delete your account and all associated data.
          </p>

          <Button
            variant="destructive"
            className="mt-3"
            onClick={() => setIsDeleteOpen(true)}
          >
            Delete Account
          </Button>

          <Modal
            isOpen={isDeleteOpen}
            onClose={() => setIsDeleteOpen(false)}
            title="Confirmation Required"
            description="All your account data will be permanently deleted. If you are sure, please click Confirm to proceed. This action cannot be undone."
          >
            {deleteErr && (
              <Alert variant="destructive" className="mb-4">
                <AlertDescription>{deleteErr}</AlertDescription>
              </Alert>
            )}

            <div className="mt-6 flex justify-end gap-3 border-t border-border pt-4">
              <Button variant="outline" onClick={() => setIsDeleteOpen(false)} disabled={isDeleting}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleDeleteAccount} loading={isDeleting}>
                Delete
              </Button>
            </div>
          </Modal>
        </div>
      )}
        </>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{settingsCopy[section].title}</CardTitle>
            <CardDescription>{settingsCopy[section].description}</CardDescription>
          </CardHeader>
          <div className="rounded-lg border border-dashed border-border p-5">
            <p className="text-sm font-medium">Dedicated configuration area established</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Step 2 creates the correct home for this configuration. The deeper controls will be implemented in their dedicated functional phases instead of being mixed into account settings.
            </p>
          </div>
        </Card>
      )}
    </div>
  );
};

export default SettingsPage;
