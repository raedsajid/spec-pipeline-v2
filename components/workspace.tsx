"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Plus,
  Layers3,
  FileText,
  CheckCheck,
  MessageSquareText,
  Settings,
  LogOut,
  Clock,
  Eye,
  LoaderCircle,
  FolderOpen,
  ShieldCheck,
  RefreshCw,
  KeyRound,
  Trash2,
  Building2,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Toaster, toast } from "sonner";
import { Brand } from "./brand";
import { useWorkspaceTools } from "@/lib/use-workspace-tools";
import ReviewPanel from "./review-panel";
import { Requirement } from "@/lib/domain/models";
import PDFViewer from "./pdf-viewer";
import Workbench from "./project/workbench";
import { api } from "@/lib/api-client";
const pretty = (s: string) => s.replaceAll("_", " ");
const date = (n: number) =>
  new Date(n).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
function Status({ value }: { value: string }) {
  return (
    <span
      className={
        "badge " +
        (value === "approved" || value === "ready"
          ? "approved"
          : value === "rejected"
            ? "draft"
            : "review")
      }
    >
      {pretty(value)}
    </span>
  );
}
export default function Workspace() {
  const [me, setMe] = useState<any>(null),
    [authLoading, setAuthLoading] = useState(true),
    [signup, setSignup] = useState(false),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [authError, setAuthError] = useState(""),
    [authBusy, setAuthBusy] = useState(false),
    [projects, setProjects] = useState<any[]>([]),
    [detail, setDetail] = useState<any>(null),
    [view, setView] = useState("projects"),
    [projectLoading, setProjectLoading] = useState(false),
    [newProject, setNewProject] = useState(false),
    [name, setName] = useState(""),
    [description, setDescription] = useState(""),
    [creating, setCreating] = useState(false),
    [row, setRow] = useState<Requirement | null>(null),
    [tab, setTab] = useState("documents"),
    [apiKey, setApiKey] = useState(""),
    [settingsBusy, setSettingsBusy] = useState(false),
    [currentPass, setCurrentPass] = useState(""),
    [nextPass, setNextPass] = useState(""),
    [source, setSource] = useState<any>(null),
    [deleteProject, setDeleteProject] = useState(false),
    [emptyDoc, setEmptyDoc] = useState<any>(null),
    [emptyNote, setEmptyNote] = useState("");
  const currentId = useRef<string | null>(null);
  const refreshProjects = useCallback(async () => {
    const d = await api("projects");
    setProjects(d.projects);
  }, []);
  const refresh = useCallback(async (pid: string) => {
    const d = await api("projects/" + pid);
    if (currentId.current === pid) setDetail(d);
  }, []);
  useEffect(() => {
    setSignup(new URLSearchParams(location.search).has("signup"));
    api("me")
      .then(async (d) => {
        setMe(d);
        await refreshProjects();
      })
      .catch(() => {})
      .finally(() => setAuthLoading(false));
  }, [refreshProjects]);
  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setAuthBusy(true);
    setAuthError("");
    try {
      await api("auth/" + (signup ? "signup" : "login"), "POST", {
        username,
        password,
      });
      setPassword("");
      setMe(await api("me"));
      await refreshProjects();
    } catch (e) {
      setAuthError((e as Error).message);
    } finally {
      setAuthBusy(false);
    }
  }
  async function openProject(pid: string) {
    currentId.current = pid;
    setProjectLoading(true);
    setView("projects");
    setTab("documents");
    try {
      await refresh(pid);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setProjectLoading(false);
    }
  }
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const p = await api("projects", "POST", { name, description });
      setNewProject(false);
      setName("");
      setDescription("");
      await refreshProjects();
      await openProject(p.id);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCreating(false);
    }
  }
  async function saveReview(r: Requirement, confirmed: boolean) {
    await api("requirements/" + r.id, "PATCH", {
      data: r,
      status: r.status,
      reviewNote: r.reviewNote,
      revision: r.revision,
      confirmed,
    });
    await refresh(detail.project.id);
    toast.success("Submittal saved.");
  }
  async function keySave(test = false) {
    setSettingsBusy(true);
    try {
      await api("settings", "POST", { apiKey: apiKey || undefined, test });
      setApiKey("");
      setMe(await api("me"));
      toast.success(
        test
          ? "Both Gemini models connected."
          : "Shared API key saved securely.",
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSettingsBusy(false);
    }
  }
  useWorkspaceTools({
    signedIn: !!me,
    projects,
    startProject: (name) => {
      setName(name);
      setNewProject(true);
    },
  });
  if (authLoading)
    return (
      <div className="auth-loading">
        <Brand />
        <LoaderCircle className="spin" />
        <span>Opening your workspace…</span>
      </div>
    );
  if (!me)
    return (
      <div className="auth-page">
        <div className="auth-story">
          <a href="/">
            <Brand />
          </a>
          <div>
            <div className="eyebrow">A CLEARER WAY TO BUILD</div>
            <h1>
              The details make
              <br />
              the difference.
            </h1>
            <p>
              Give every specification a place.
              <br />
              Give every decision a source.
            </p>
            <div className="auth-detail">
              <FileText />
              <span>Specifications</span>
              <span className="line" />
              <CheckCheck />
              <span>Submittals</span>
            </div>
          </div>
          <small>BuildERP · Specification intelligence</small>
        </div>
        <div className="auth-form-area">
          <a className="back-link" href="/">
            <ArrowLeft size={16} /> Back to BuildERP
          </a>
          <form className="auth-form" onSubmit={signIn}>
            <span className="eyebrow">YOUR PROJECT WORKSPACE</span>
            <h2>{signup ? "Make room for better work." : "Welcome back."}</h2>
            <p>
              {signup
                ? "Create an account to keep your specifications and reviews together."
                : "Sign in to pick up where you left off."}
            </p>
            {authError && (
              <div role="alert" className="error-box">
                {authError}
              </div>
            )}
            <label>
              Username
              <input
                required
                autoComplete="username"
                pattern="[a-zA-Z0-9_]{3,32}"
                placeholder="Your username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </label>
            <label>
              Password
              <input
                required
                autoComplete={signup ? "new-password" : "current-password"}
                type="password"
                minLength={12}
                maxLength={128}
                placeholder="At least 12 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {signup && (
              <p className="small muted">
                Usernames use 3–32 letters, numbers, or underscores. Keep your
                password safe; email recovery is not configured.
              </p>
            )}
            <button className="button orange full" disabled={authBusy}>
              {authBusy ? (
                <LoaderCircle className="spin" size={18} />
              ) : signup ? (
                "Create account"
              ) : (
                "Sign in"
              )}{" "}
              {!authBusy && <ArrowRight size={18} />}
            </button>
            <p className="auth-switch">
              {signup ? "Already have an account?" : "New to BuildERP?"}{" "}
              <button
                type="button"
                onClick={() => {
                  setSignup(!signup);
                  setAuthError("");
                }}
              >
                {signup ? "Sign in" : "Create an account"}
              </button>
            </p>
          </form>
        </div>
      </div>
    );
  const requirements: Requirement[] = detail?.requirements || [];
  const approved = requirements.filter((r) => r.status === "approved").length;
  const unresolved = requirements.filter(
    (r) => !["approved", "rejected"].includes(r.status),
  ).length;
  return (
    <SidebarProvider>
      <Toaster richColors position="top-right" />
      <Sidebar className="app-sidebar">
        <SidebarHeader>
          <a className="sidebar-brand" href="/">
            <Brand />
          </a>
        </SidebarHeader>
        <SidebarContent>
          <div className="sidebar-caption">WORKSPACE</div>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={view === "projects"}
                onClick={() => {
                  setView("projects");
                  setDetail(null);
                  currentId.current = null;
                  refreshProjects();
                }}
              >
                <Layers3 />
                <span>Projects</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={view === "settings"}
                onClick={() => setView("settings")}
              >
                <Settings />
                <span>Settings</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          {detail && (
            <>
              <div className="sidebar-caption recent-title">PROJECT VIEWS</div>
              <SidebarMenu>
                {[
                  { id: "documents", label: "Specifications", Icon: FileText },
                  { id: "register", label: "Submittal log", Icon: CheckCheck },
                  { id: "specs", label: "Specs · source review", Icon: Eye },
                  {
                    id: "chat",
                    label: "Document chat",
                    Icon: MessageSquareText,
                  },
                  { id: "activity", label: "Activity", Icon: Clock },
                ].map(({ id, label, Icon }) => (
                  <SidebarMenuItem key={id}>
                    <SidebarMenuButton
                      isActive={view === "projects" && tab === id}
                      onClick={() => {
                        setView("projects");
                        setTab(id);
                      }}
                    >
                      <Icon />
                      <span>{label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </>
          )}
          <div className="sidebar-caption recent-title">RECENT PROJECTS</div>
          <SidebarMenu>
            {projects.slice(0, 5).map((p) => (
              <SidebarMenuItem key={p.id}>
                <SidebarMenuButton
                  onClick={() => openProject(p.id)}
                  isActive={detail?.project.id === p.id && view === "projects"}
                >
                  <FolderOpen />
                  <span>{p.name}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
          <div className="sidebar-help">
            <ShieldCheck size={20} />
            <b>Your project stays yours.</b>
            <p>Shared PDF processing. Private reviews and decisions.</p>
          </div>
        </SidebarContent>
        <SidebarFooter>
          <div className="profile">
            <span className="avatar">{me.user.username[0].toUpperCase()}</span>
            <div>
              <b>{me.user.username}</b>
              <small>
                {me.user.role === "admin" ? "Workspace owner" : "Member"}
              </small>
            </div>
            <button
              aria-label="Sign out"
              onClick={async () => {
                await api("auth/logout", "POST", {});
                setMe(null);
                setDetail(null);
                setPassword("");
              }}
            >
              <LogOut size={18} />
            </button>
          </div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="app-topbar">
          <div className="row">
            <SidebarTrigger />
            <span>Workspace</span>
            <span className="muted">/</span>
            <b>
              {view === "settings"
                ? "Settings"
                : detail?.project.name || "Projects"}
            </b>
          </div>
          <div className="topbar-note">
            <span className="tiny-brand">B</span> BuildERP
          </div>
        </header>
        <main
          className={
            "workspace-main " +
            (detail ? "project-main " : "") +
            (detail && tab === "chat" ? "chat-main" : "")
          }
        >
          {view === "settings" ? (
            <section>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">WORKSPACE PREFERENCES</div>
                  <h1>Settings</h1>
                  <p>Manage your account and shared AI connection.</p>
                </div>
              </div>
              {me.user.role === "admin" && (
                <div className="settings-card">
                  <div className="row">
                    <KeyRound size={23} />
                    <h2>Shared Gemini connection</h2>
                    <Status
                      value={me.aiConfigured ? "ready" : "not_connected"}
                    />
                  </div>
                  <p>
                    One owner-managed key powers every account. Your key is
                    encrypted and never returned to the browser after saving.
                  </p>
                  <div className="model-pair">
                    <div>
                      <small>EXTRACTION & CHAT</small>
                      <code>{me.chatModel}</code>
                    </div>
                    <div>
                      <small>EMBEDDINGS</small>
                      <code>{me.embeddingModel}</code>
                    </div>
                  </div>
                  <label>
                    Google AI Studio API key
                    <input
                      type="password"
                      autoComplete="off"
                      value={apiKey}
                      placeholder={
                        me.aiConfigured
                          ? "Enter a new key to replace the current one"
                          : "Paste your Gemini API key"
                      }
                      onChange={(e) => setApiKey(e.target.value)}
                    />
                  </label>
                  <div className="row wrap">
                    <button
                      className="button orange"
                      disabled={settingsBusy || !apiKey}
                      onClick={() => keySave(false)}
                    >
                      Save shared key
                    </button>
                    <button
                      className="button secondary"
                      disabled={settingsBusy || (!me.aiConfigured && !apiKey)}
                      onClick={() => keySave(true)}
                    >
                      {settingsBusy ? (
                        <LoaderCircle className="spin" size={16} />
                      ) : (
                        <RefreshCw size={16} />
                      )}{" "}
                      Test both models
                    </button>
                  </div>
                  <div className="warning-box">
                    For a zero-cost setup, use a Gemini project without paid
                    billing. BuildERP caps AI requests at 150 per day globally
                    and 75 per account; Google may apply lower quotas. A request
                    cap cannot prevent charges on a billing-enabled key.
                  </div>
                  <a
                    className="text-link"
                    target="_blank"
                    rel="noreferrer"
                    href="https://aistudio.google.com/apikey"
                  >
                    Get a Gemini API key <ArrowUpRight size={15} />
                  </a>
                </div>
              )}
              <div className="settings-card">
                <h2>Account security</h2>
                <p>
                  Signed in as <b>{me.user.username}</b>. Changing your password
                  signs out all sessions.
                </p>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    try {
                      await api("password", "POST", {
                        current: currentPass,
                        password: nextPass,
                      });
                      setMe(null);
                      setCurrentPass("");
                      setNextPass("");
                      toast.success("Password changed. Sign in again.");
                    } catch (e) {
                      toast.error((e as Error).message);
                    }
                  }}
                >
                  <label>
                    Current password
                    <input
                      type="password"
                      required
                      autoComplete="current-password"
                      value={currentPass}
                      onChange={(e) => setCurrentPass(e.target.value)}
                    />
                  </label>
                  <label>
                    New password
                    <input
                      type="password"
                      required
                      minLength={12}
                      maxLength={128}
                      autoComplete="new-password"
                      value={nextPass}
                      onChange={(e) => setNextPass(e.target.value)}
                    />
                  </label>
                  <button className="button secondary">Change password</button>
                </form>
              </div>
              <div className="settings-card">
                <h2>Document storage</h2>
                <p>
                  PDFs and extraction results are reused by file content.
                  Uploading an identical PDF gives your account a separate
                  review copy. Private project edits, approvals, and chats are
                  never reused across users.
                </p>
                <p>
                  Supported uploads: PDF · up to 10 MB and 200 pages per file.
                  Document processing advances while this workspace is open and
                  resumes from saved progress.
                </p>
              </div>
            </section>
          ) : projectLoading ? (
            <div className="empty-state">
              <LoaderCircle className="spin" />
              <h2>Opening project…</h2>
            </div>
          ) : !detail ? (
            <section>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">BUILD WITH CLARITY</div>
                  <h1>
                    Your projects<span className="heading-dot">.</span>
                  </h1>
                  <p>
                    A home for your specifications, submittals, and decisions.
                  </p>
                </div>
                <button
                  className="button orange"
                  onClick={() => setNewProject(true)}
                >
                  <Plus size={18} /> New project
                </button>
              </div>
              {!me.aiConfigured && (
                <div className="setup-banner">
                  <KeyRound size={20} />
                  <div>
                    <b>One connection to get started</b>
                    <p>
                      {me.user.role === "admin"
                        ? "Connect your Gemini key to enable extraction and document chat. Uploads and PDF parsing already work."
                        : "The workspace owner needs to connect Gemini. You can upload and parse PDFs now."}
                    </p>
                  </div>
                  {me.user.role === "admin" && (
                    <button
                      className="button secondary"
                      onClick={() => setView("settings")}
                    >
                      Connect Gemini <ArrowRight size={16} />
                    </button>
                  )}
                </div>
              )}
              <div className="summary-grid">
                <div>
                  <span>PROJECTS</span>
                  <b>{projects.length}</b>
                  <small>Organized in one place</small>
                </div>
                <div>
                  <span>SPECIFICATIONS</span>
                  <b>{projects.reduce((n, p) => n + p.document_count, 0)}</b>
                  <small>Your uploaded documents</small>
                </div>
                <div>
                  <span>REQUIREMENTS</span>
                  <b>{projects.reduce((n, p) => n + p.requirement_count, 0)}</b>
                  <small>Ready for your attention</small>
                </div>
              </div>
              <div className="section-row">
                <h2>Project library</h2>
                <span className="muted">
                  {projects.length} project{projects.length !== 1 ? "s" : ""}
                </span>
              </div>
              {projects.length ? (
                <div className="project-grid">
                  {projects.map((p) => (
                    <button
                      className="project-card"
                      onClick={() => openProject(p.id)}
                      key={p.id}
                    >
                      <div className="row space">
                        <span className="project-icon">
                          <Building2 size={23} />
                        </span>
                        <ArrowUpRight size={20} />
                      </div>
                      <h3>{p.name}</h3>
                      <p>
                        {p.description ||
                          "Specifications and submittals, connected."}
                      </p>
                      <div className="project-card-footer">
                        <span>
                          <FileText size={14} />
                          {p.document_count} files
                        </span>
                        <span>{p.requirement_count} requirements</span>
                      </div>
                      <small>Created {date(p.created)}</small>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <span className="empty-icon">
                    <Layers3 size={32} />
                  </span>
                  <h2>Start with your first project.</h2>
                  <p>
                    Give it a name, add your specification PDFs,
                    <br />
                    and bring the requirements into focus.
                  </p>
                  <button
                    className="button dark"
                    onClick={() => setNewProject(true)}
                  >
                    <Plus size={17} /> Create project
                  </button>
                </div>
              )}
            </section>
          ) : (
            <section className="project-detail">
              {tab === "documents" && (
                <div className="project-tools">
                  <span>
                    {detail.documents.length} specifications ·{" "}
                    {requirements.length} submittals
                  </span>
                  <button
                    className="text-link danger"
                    onClick={() => setDeleteProject(true)}
                    aria-label="Delete project"
                  >
                    <Trash2 size={15} /> Delete project
                  </button>
                </div>
              )}
              <Workbench
                key={detail.project.id}
                detail={detail}
                tab={tab}
                setTab={setTab}
                refresh={() => refresh(detail.project.id)}
                onReview={setRow}
                onSource={setSource}
                onEmpty={(d) => {
                  setEmptyDoc(d);
                  setEmptyNote("");
                }}
              />
            </section>
          )}
        </main>
        <footer className="workspace-footer">
          <span>BuildERP</span>
          <span>Every decision starts with the source.</span>
        </footer>
      </SidebarInset>
      <Dialog open={newProject} onOpenChange={setNewProject}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start a new project</DialogTitle>
            <DialogDescription>
              A dedicated space for your specifications and submittal register.
            </DialogDescription>
          </DialogHeader>
          <form className="stack-form" onSubmit={create}>
            <label>
              Project name
              <input
                autoFocus
                required
                maxLength={100}
                placeholder="e.g. Northpoint Office"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Description <span className="muted">(optional)</span>
              <textarea
                rows={3}
                maxLength={1000}
                placeholder="Location, scope, or project notes"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <button className="button orange full" disabled={creating}>
              {creating ? (
                <LoaderCircle className="spin" size={17} />
              ) : (
                <Plus size={17} />
              )}{" "}
              Create project
            </button>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog open={deleteProject} onOpenChange={setDeleteProject}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this project?</AlertDialogTitle>
            <AlertDialogDescription>
              Your register, reviews, and chats will be deleted. Shared original
              PDF processing remains available for reuse.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <button
            className="button destructive"
            onClick={async () => {
              try {
                await api("projects/" + detail.project.id, "DELETE");
                setDeleteProject(false);
                setDetail(null);
                currentId.current = null;
                await refreshProjects();
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
          >
            Delete project
          </button>
          <AlertDialogCancel>Keep project</AlertDialogCancel>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog
        open={!!emptyDoc}
        onOpenChange={(v) => {
          if (!v) setEmptyDoc(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm no submittals</DialogTitle>
            <DialogDescription>
              Only confirm after reviewing the original PDF. This decision is
              saved to your project.
            </DialogDescription>
          </DialogHeader>
          <a
            className="text-link"
            href={"/api/documents/" + emptyDoc?.id + "/pdf"}
            target="_blank"
            rel="noreferrer"
          >
            Open original PDF <ArrowUpRight size={15} />
          </a>
          <label>
            Review note
            <textarea
              value={emptyNote}
              onChange={(e) => setEmptyNote(e.target.value)}
              placeholder="What did you check?"
            />
          </label>
          <button
            className="button orange"
            disabled={emptyNote.trim().length < 8}
            onClick={async () => {
              try {
                await api(
                  "documents/" + emptyDoc.id + "/confirm-empty",
                  "POST",
                  { note: emptyNote },
                );
                setEmptyDoc(null);
                await refresh(detail.project.id);
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
          >
            Confirm source reviewed
          </button>
        </DialogContent>
      </Dialog>
      <ReviewPanel row={row} onClose={() => setRow(null)} onSave={saveReview} />
      <SourceDialog source={source} onClose={() => setSource(null)} />
    </SidebarProvider>
  );
}
function SourceDialog({
  source,
  onClose,
}: {
  source: any;
  onClose: () => void;
}) {
  const [data, setData] = useState<any>(null),
    [page, setPage] = useState(1);
  useEffect(() => {
    setData(null);
    setPage(source?.page || 1);
    if (source)
      api("documents/" + source.docId + "/evidence")
        .then(setData)
        .catch((e) => toast.error(e.message));
  }, [source]);
  return (
    <Dialog
      open={!!source}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="source-dialog">
        <DialogHeader>
          <DialogTitle>{source?.filename || "Source document"}</DialogTitle>
          <DialogDescription>Original PDF and cited evidence</DialogDescription>
        </DialogHeader>
        {source && (
          <>
            <div className="row space">
              <button
                className="button secondary small-button"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </button>
              <span>
                Page {page}
                {data?.pages ? " of " + data.pages : ""}
              </span>
              <button
                className="button secondary small-button"
                disabled={!data?.pages || page >= data.pages}
                onClick={() => setPage(page + 1)}
              >
                Next
              </button>
            </div>
            <PDFViewer
              docId={source.docId}
              page={page}
              evidence={(data?.evidence || []).filter((e: any) =>
                (source.evidenceIds || []).includes(e.id),
              )}
            />
            {source.text && <blockquote>{source.text}</blockquote>}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
