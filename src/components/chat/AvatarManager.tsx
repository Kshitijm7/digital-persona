"use client";

import { useCallback, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { useSceneConfig } from "@/hooks/SceneConfigContext";
import { downloadAvatarAsOrGetUrl, type AvatarEntry } from "@/lib/avatars";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Download, LinkIcon, Plus, Trash2 } from "lucide-react";

const READY_PLAYER_ME_GUIDE_LINK = "https://readyplayer.me/avatar?id=";

function triggerDownload(url: string, filename: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

export function AvatarManager() {
  const {
    config,
    updateConfig,
    avatarRegistry,
    addClientAvatar,
    removeClientAvatar,
  } = useSceneConfig();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [avatarUrlInput, setAvatarUrlInput] = useState("");
  const [avatarLabelInput, setAvatarLabelInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const selectedAvatar = useMemo(
    () => avatarRegistry.find((a) => a.id === config.avatar.model) ?? avatarRegistry[0],
    [avatarRegistry, config.avatar.model],
  );
  const clientAvatars = useMemo(
    () => avatarRegistry.filter((a) => a.isCustom),
    [avatarRegistry],
  );

  const handleSelectAvatar = useCallback(
    (id: string) => {
      updateConfig({ avatar: { ...config.avatar, model: id } });
    },
    [config.avatar, updateConfig],
  );

  const handleImportAvatar = useCallback(async () => {
    if (!avatarUrlInput.trim()) {
      setError("Paste a Ready Player Me URL, direct GLB URL, or avatar ID.");
      return;
    }

    setIsImporting(true);
    setError(null);
    try {
      const { sourceUrl, file } = await downloadAvatarAsOrGetUrl(avatarUrlInput);
      const id = `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      const label = avatarLabelInput.trim() || `My Avatar ${clientAvatars.length + 1}`;

      const entry: AvatarEntry = {
        id,
        label,
        file: file,
        sourceUrl,
        isCustom: true,
      };

      addClientAvatar(entry);
      updateConfig({ avatar: { ...config.avatar, model: id } });
      setAvatarUrlInput("");
      setAvatarLabelInput("");
      setDialogOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import avatar.");
    } finally {
      setIsImporting(false);
    }
  }, [
    addClientAvatar,
    avatarLabelInput,
    avatarUrlInput,
    clientAvatars.length,
    config.avatar,
    updateConfig,
  ]);

  const handleDownloadSelected = useCallback(async () => {
    if (!selectedAvatar) return;

    const fileName = `${selectedAvatar.label.replace(/\s+/g, "-").toLowerCase()}.glb`;

    if (selectedAvatar.file.startsWith("data:")) {
      triggerDownload(selectedAvatar.file, fileName);
      return;
    }

    try {
      const res = await fetch(selectedAvatar.file);
      if (!res.ok) throw new Error("Could not download selected avatar.");
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      triggerDownload(objectUrl, fileName);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch {
      // As a fallback, open source URL (if present)
      if (selectedAvatar.sourceUrl) {
        window.open(selectedAvatar.sourceUrl, "_blank", "noopener,noreferrer");
      }
    }
  }, [selectedAvatar]);

  const handleRemoveClientAvatar = useCallback(
    (id: string) => {
      const fallback = avatarRegistry.find((a) => !a.isCustom)?.id ?? avatarRegistry[0]?.id;
      removeClientAvatar(id);
      if (config.avatar.model === id && fallback) {
        updateConfig({ avatar: { ...config.avatar, model: fallback } });
      }
    },
    [avatarRegistry, config.avatar, removeClientAvatar, updateConfig],
  );

  return (
    <div className="rounded-xl border border-white/10 bg-white/4 p-3">
      <p className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-widest mb-2">
        Avatar Source
      </p>

      <select
        value={config.avatar.model}
        onChange={(e) => handleSelectAvatar(e.target.value)}
        className="w-full bg-white/5 border border-white/10 rounded-lg px-2.5 py-2 text-[11px] text-foreground/90 font-medium focus:outline-none focus:border-cyan-400/40 cursor-pointer"
      >
        {avatarRegistry.map((avatar) => (
          <option key={avatar.id} value={avatar.id} className="bg-zinc-900 text-white">
            {avatar.label}{avatar.isCustom ? " (Local)" : ""}
          </option>
        ))}
      </select>

      <div className="mt-2 flex gap-2">
        <button
          onClick={() => setDialogOpen(true)}
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-2 text-[11px] font-semibold text-cyan-300 hover:bg-cyan-400/15 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Import Avatar
        </button>
        <button
          onClick={handleDownloadSelected}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-2 text-[11px] font-semibold transition-colors",
            selectedAvatar
              ? "border-white/20 bg-white/8 text-foreground hover:bg-white/12"
              : "border-white/10 bg-white/5 text-muted-foreground cursor-not-allowed",
          )}
          disabled={!selectedAvatar}
          title="Download currently selected avatar"
        >
          <Download className="w-3.5 h-3.5" />
          Download
        </button>
      </div>

      {clientAvatars.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {clientAvatars.map((avatar) => (
            <button
              key={avatar.id}
              onClick={() => handleRemoveClientAvatar(avatar.id)}
              className="inline-flex items-center gap-1 rounded-full border border-rose-400/30 bg-rose-400/10 px-2 py-1 text-[10px] text-rose-300 hover:bg-rose-400/15 transition-colors"
              title={`Remove ${avatar.label}`}
            >
              <Trash2 className="w-3 h-3" />
              {avatar.label}
            </button>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl border-white/10 bg-zinc-950/95 backdrop-blur-xl">
          <DialogHeader>
            <DialogTitle className="text-base">Import Your Ready Player Me Avatar</DialogTitle>
            <DialogDescription className="text-xs">
              Bring your own avatar, store it locally in your browser, and keep it available across reloads on this device.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-xs text-muted-foreground">
            <div className="rounded-lg border border-white/10 bg-white/4 p-3">
              <p className="font-semibold text-foreground mb-1">Guide</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>Create/sign in and generate avatar on Ready Player Me.</li>
                <li>Use link pattern like <code>https://readyplayer.me/avatar?id=&lt;avatar_id&gt;</code>.</li>
                <li>Paste URL (or direct GLB URL, or raw ID) below.</li>
                <li>Click <code>Download &amp; Save Locally</code>.</li>
              </ol>
              <a
                href={READY_PLAYER_ME_GUIDE_LINK}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1.5 text-cyan-300 hover:text-cyan-200"
              >
                <LinkIcon className="w-3.5 h-3.5" />
                Open Ready Player Me
              </a>
            </div>

            <div className="space-y-2">
              <label className="block">
                <span className="text-[11px] text-foreground/80">Avatar URL / ID</span>
                <input
                  value={avatarUrlInput}
                  onChange={(e) => setAvatarUrlInput(e.target.value)}
                  placeholder="https://readyplayer.me/avatar?id=... or models.readyplayer.me/...glb"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-[11px] text-foreground/90 focus:outline-none focus:border-cyan-400/40"
                />
              </label>

              <label className="block">
                <span className="text-[11px] text-foreground/80">Display Name (optional)</span>
                <input
                  value={avatarLabelInput}
                  onChange={(e) => setAvatarLabelInput(e.target.value)}
                  placeholder="My Persona Avatar"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-[11px] text-foreground/90 focus:outline-none focus:border-cyan-400/40"
                />
              </label>
            </div>

            {error && (
              <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-2 text-[11px] text-rose-300">
                {error}
              </p>
            )}
          </div>

          <DialogFooter>
            <button
              onClick={handleImportAvatar}
              disabled={isImporting}
              className={cn(
                "inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors",
                isImporting
                  ? "bg-white/10 text-muted-foreground cursor-not-allowed"
                  : "bg-cyan-500 text-black hover:bg-cyan-400",
              )}
            >
              {isImporting ? "Downloading..." : "Download & Save Locally"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
