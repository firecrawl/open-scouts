"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import Button from "@/components/ui/shadcn/button";
import { Skeleton } from "@/components/ui/shadcn/skeleton";
import { Connector } from "@/components/shared/layout/curvy-rect";
import {
  RefreshCw,
  Users,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Trash2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/shadcn/dialog";

type UserData = {
  id: string;
  email: string;
  createdAt: string;
  lastSignIn: string | null;
  emailConfirmed: boolean;
  scoutCount: number;
  executionCount: number;
  completedExecutions: number;
  failedExecutions: number;
  firecrawlStatus: string | null;
  hasLocation: boolean;
};

type AdminData = {
  users: UserData[];
  totalUsers: number;
  totalScouts: number;
  totalExecutions: number;
  fetchedAt: string;
};

const ADMIN_EMAIL_DOMAIN = "@sideguide.dev";
const ROWS_PER_PAGE = 10;

export default function AdminPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const [data, setData] = useState<AdminData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<UserData | null>(null);
  const [deleting, setDeleting] = useState(false);

  const isAdmin = user?.email?.endsWith(ADMIN_EMAIL_DOMAIN);

  const fetchData = async () => {
    setRefreshing(true);

    try {
      const response = await fetch("/api/admin");
      const result = await response.json();

      if (!response.ok) {
        setData(null);
      } else {
        setData(result);
        setCurrentPage(1);
      }
    } catch {
      setData(null);
    }

    setRefreshing(false);
    setLoading(false);
  };

  useEffect(() => {
    if (authLoading) return;

    if (!user || !isAdmin) {
      router.push("/");
      return;
    }

    fetchData();
  }, [user, authLoading, isAdmin, router]);

  // Pagination calculations
  const totalPages = data ? Math.ceil(data.users.length / ROWS_PER_PAGE) : 0;
  const startIndex = (currentPage - 1) * ROWS_PER_PAGE;
  const endIndex = startIndex + ROWS_PER_PAGE;
  const currentUsers = data?.users.slice(startIndex, endIndex) || [];

  const goToPage = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  const openDeleteDialog = (userData: UserData) => {
    setUserToDelete(userData);
    setDeleteDialogOpen(true);
  };

  const closeDeleteDialog = () => {
    setDeleteDialogOpen(false);
    setUserToDelete(null);
  };

  const confirmDelete = async () => {
    if (!userToDelete) return;

    setDeleting(true);
    try {
      const response = await fetch("/api/admin", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ userId: userToDelete.id }),
      });

      const result = await response.json();

      if (!response.ok) {
        alert(result.error || "Failed to delete user");
      } else {
        // Refresh the data after successful deletion
        await fetchData();
      }
    } catch (error) {
      alert("Failed to delete user");
    }

    setDeleting(false);
    closeDeleteDialog();
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "-";
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const formatDateTime = (dateString: string | null) => {
    if (!dateString) return "-";
    return new Date(dateString).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getFirecrawlStatusBadge = (status: string | null) => {
    switch (status) {
      case "active":
        return (
          <span className="inline-flex items-center gap-4 px-8 py-2 rounded-4 bg-accent-forest/10 text-accent-forest text-mono-x-small">
            <CheckCircle2 className="w-12 h-12" />
            Active
          </span>
        );
      case "pending":
        return (
          <span className="inline-flex items-center gap-4 px-8 py-2 rounded-4 bg-accent-honey/10 text-accent-honey text-mono-x-small">
            <Clock className="w-12 h-12" />
            Pending
          </span>
        );
      case "failed":
      case "invalid":
        return (
          <span className="inline-flex items-center gap-4 px-8 py-2 rounded-4 bg-accent-crimson/10 text-accent-crimson text-mono-x-small">
            <XCircle className="w-12 h-12" />
            {status === "failed" ? "Failed" : "Invalid"}
          </span>
        );
      case "fallback":
        return (
          <span className="inline-flex items-center gap-4 px-8 py-2 rounded-4 bg-accent-honey/10 text-accent-honey text-mono-x-small">
            <AlertTriangle className="w-12 h-12" />
            Fallback
          </span>
        );
      default:
        return (
          <span className="text-mono-x-small text-black-alpha-32">-</span>
        );
    }
  };

  // Show loading state
  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-background-base">
        <div className="h-1 w-full bg-border-faint" />
        <div className="container relative">
          <Connector className="absolute -top-10 -left-[10.5px]" />
          <Connector className="absolute -top-10 -right-[10.5px]" />

          <div className="py-48 lg:py-64 relative">
            <div className="h-1 bottom-0 absolute w-screen left-[calc(50%-50vw)] bg-border-faint" />
            <div className="px-24">
              <Skeleton className="h-32 w-200 mb-8" />
              <Skeleton className="h-20 w-300" />
            </div>
          </div>

          <div className="py-32">
            <Skeleton className="h-400 w-full rounded-12" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background-base">
      <div className="h-1 w-full bg-border-faint" />

      <div className="container relative">
        <Connector className="absolute -top-10 -left-[10.5px]" />
        <Connector className="absolute -top-10 -right-[10.5px]" />

        {/* Header */}
        <div className="py-48 lg:py-64 relative">
          <div className="h-1 bottom-0 absolute w-screen left-[calc(50%-50vw)] bg-border-faint" />
          <Connector className="absolute -bottom-10 -left-[10.5px]" />
          <Connector className="absolute -bottom-10 -right-[10.5px]" />

          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-24 px-24">
            <div>
              <h1 className="text-title-h3 lg:text-title-h2 font-semibold text-accent-black">
                Admin Panel
              </h1>
              <p className="text-body-large text-black-alpha-56 mt-4">
                User overview and statistics
              </p>
            </div>
            <Button
              onClick={fetchData}
              disabled={refreshing}
              variant="secondary"
              className="flex items-center gap-8 shrink-0"
            >
              <RefreshCw
                className={`w-16 h-16 ${refreshing ? "animate-spin" : ""}`}
              />
              {refreshing ? "Updating..." : "Update"}
            </Button>
          </div>
        </div>

        {/* Stats Summary */}
        <div className="py-24 lg:py-32 relative">
          <div className="h-1 bottom-0 absolute w-screen left-[calc(50%-50vw)] bg-border-faint" />

          <div className="flex items-center gap-16">
            <div className="w-2 h-16 bg-heat-100" />
            <div className="flex gap-12 items-center text-mono-x-small text-black-alpha-32 font-mono">
              <Users className="w-14 h-14" />
              <span className="uppercase tracking-wider">Overview</span>
              {data && (
                <>
                  <span>-</span>
                  <span className="text-heat-100">
                    {data.totalUsers} users - {data.totalScouts} scouts -{" "}
                    {data.totalExecutions} executions
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="pb-64">
          {data && data.users.length > 0 ? (
            <div className="bg-white rounded-12 border border-border-faint overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border-faint bg-background-base">
                      <th className="text-left px-16 py-12 text-label-small font-semibold text-black-alpha-56">
                        Email
                      </th>
                      <th className="text-center px-16 py-12 text-label-small font-semibold text-black-alpha-56">
                        Scouts
                      </th>
                      <th className="text-center px-16 py-12 text-label-small font-semibold text-black-alpha-56">
                        Executions
                      </th>
                      <th className="text-center px-16 py-12 text-label-small font-semibold text-black-alpha-56">
                        Completed
                      </th>
                      <th className="text-center px-16 py-12 text-label-small font-semibold text-black-alpha-56">
                        Failed
                      </th>
                      <th className="text-center px-16 py-12 text-label-small font-semibold text-black-alpha-56">
                        Firecrawl
                      </th>
                      <th className="text-left px-16 py-12 text-label-small font-semibold text-black-alpha-56">
                        Created
                      </th>
                      <th className="text-left px-16 py-12 text-label-small font-semibold text-black-alpha-56">
                        Last Sign In
                      </th>
                      <th className="text-center px-16 py-12 text-label-small font-semibold text-black-alpha-56">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentUsers.map((u, index) => (
                      <tr
                        key={u.id}
                        className={`border-b border-border-faint last:border-b-0 ${
                          index % 2 === 0 ? "bg-white" : "bg-background-base/50"
                        }`}
                      >
                        <td className="px-16 py-12">
                          <div className="flex items-center gap-8">
                            <span className="text-body-small text-accent-black">
                              {u.email}
                            </span>
                            {!u.emailConfirmed && (
                              <span className="text-mono-x-small text-accent-honey bg-accent-honey/10 px-6 py-2 rounded-4">
                                unverified
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-16 py-12 text-center">
                          <span className="text-body-small text-accent-black font-medium">
                            {u.scoutCount}
                          </span>
                        </td>
                        <td className="px-16 py-12 text-center">
                          <span className="text-body-small text-accent-black">
                            {u.executionCount}
                          </span>
                        </td>
                        <td className="px-16 py-12 text-center">
                          <span className="text-body-small text-accent-forest">
                            {u.completedExecutions}
                          </span>
                        </td>
                        <td className="px-16 py-12 text-center">
                          <span className="text-body-small text-accent-crimson">
                            {u.failedExecutions}
                          </span>
                        </td>
                        <td className="px-16 py-12 text-center">
                          {getFirecrawlStatusBadge(u.firecrawlStatus)}
                        </td>
                        <td className="px-16 py-12">
                          <span className="text-mono-x-small text-black-alpha-48">
                            {formatDate(u.createdAt)}
                          </span>
                        </td>
                        <td className="px-16 py-12">
                          <span className="text-mono-x-small text-black-alpha-48">
                            {formatDateTime(u.lastSignIn)}
                          </span>
                        </td>
                        <td className="px-16 py-12 text-center">
                          <button
                            onClick={() => openDeleteDialog(u)}
                            className="p-6 rounded-6 hover:bg-accent-crimson/10 text-black-alpha-32 hover:text-accent-crimson transition"
                            title="Delete user"
                          >
                            <Trash2 className="w-14 h-14" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Footer with pagination */}
              <div className="px-16 py-12 border-t border-border-faint bg-background-base flex items-center justify-between">
                <p className="text-mono-x-small font-mono text-black-alpha-32">
                  Showing {startIndex + 1}-{Math.min(endIndex, data.users.length)} of {data.users.length} users
                </p>

                {totalPages > 1 && (
                  <div className="flex items-center gap-8">
                    <button
                      onClick={() => goToPage(currentPage - 1)}
                      disabled={currentPage === 1}
                      className="p-8 rounded-6 hover:bg-black-alpha-4 disabled:opacity-30 disabled:cursor-not-allowed transition"
                    >
                      <ChevronLeft className="w-16 h-16 text-black-alpha-48" />
                    </button>

                    <div className="flex items-center gap-4">
                      {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                        <button
                          key={page}
                          onClick={() => goToPage(page)}
                          className={`min-w-28 h-28 rounded-6 text-mono-x-small font-mono transition ${
                            page === currentPage
                              ? "bg-heat-100 text-white"
                              : "hover:bg-black-alpha-4 text-black-alpha-48"
                          }`}
                        >
                          {page}
                        </button>
                      ))}
                    </div>

                    <button
                      onClick={() => goToPage(currentPage + 1)}
                      disabled={currentPage === totalPages}
                      className="p-8 rounded-6 hover:bg-black-alpha-4 disabled:opacity-30 disabled:cursor-not-allowed transition"
                    >
                      <ChevronRight className="w-16 h-16 text-black-alpha-48" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-12 border border-border-faint p-48 text-center">
              <p className="text-body-large text-black-alpha-48">
                No users found
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="p-24">
          <DialogHeader>
            <DialogTitle>Delete User</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{" "}
              <strong>{userToDelete?.email}</strong>? This will permanently
              delete:
            </DialogDescription>
          </DialogHeader>
          <ul className="text-body-small text-black-alpha-56 list-disc list-inside space-y-4 mt-8">
            <li>
              {userToDelete?.scoutCount || 0} scout
              {userToDelete?.scoutCount !== 1 ? "s" : ""}
            </li>
            <li>
              {userToDelete?.executionCount || 0} execution
              {userToDelete?.executionCount !== 1 ? "s" : ""}
            </li>
            <li>All messages and preferences</li>
          </ul>
          <p className="text-body-small text-accent-crimson mt-12">
            This action cannot be undone.
          </p>
          <div className="flex flex-row gap-12 justify-end mt-16">
            <Button
              variant="secondary"
              onClick={closeDeleteDialog}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting ? "Deleting..." : "Delete User"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
