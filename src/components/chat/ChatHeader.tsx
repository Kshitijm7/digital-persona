"use client";

import React from "react";
import { MessageSquare, Users, Palette, Settings, PanelRightClose } from "lucide-react";
import { StatusDot } from "@/components/shared/StatusDot";
import { TabItem, ExpandableTabs } from "@/components/ui/expandable-tabs";

export type ChatTab = "messages" | "participants" | "skins" | "config";

interface ChatHeaderProps {
  activeTab: ChatTab;
  onTabChange: (tab: ChatTab) => void;
  isConnected: boolean;
  showConfigTab?: boolean;
  onCollapse?: () => void;
}

export function ChatHeader({
  activeTab,
  onTabChange,
  isConnected,
  showConfigTab = false,
  onCollapse,
}: ChatHeaderProps) {
  const tabs: TabItem[] = [
    { title: "Transcript", icon: MessageSquare, id: "messages" },
    { title: "Presence", icon: Users, id: "participants" },
    { type: "separator" as const },
    { title: "Appearance", icon: Palette, id: "skins" },
    ...(showConfigTab
      ? [
          { type: "separator" as const },
          { title: "Cortex", icon: Settings, id: "config" },
        ]
      : []),
  ];

  const handleChange = (id: string | null) => {
    if (id === null) {
      // When clicking outside, keep the current active tab (don't deselect)
      return;
    }
    onTabChange(id as ChatTab);
  };

  return (
    <div className="px-4 pt-4 pb-0 md:px-6 md:pt-5">
      {/* Title row */}
      <div className="mb-4 flex items-center justify-between gap-3 md:mb-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <StatusDot
            status={isConnected ? "online" : "offline"}
            size="sm"
          />
          <h2 className="text-sm font-semibold text-foreground tracking-wide opacity-90">
            Persona Console
          </h2>
        </div>

        {onCollapse ? (
          <button
            type="button"
            onClick={onCollapse}
            aria-expanded={true}
            aria-label="Close chat panel"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
          >
            <PanelRightClose className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {/* Expandable Tabs */}
      <ExpandableTabs
        tabs={tabs}
        activeTab={activeTab}
        activeColor="text-primary"
        onChange={handleChange}
        className="bg-white/5 border-white/5 backdrop-blur-sm"
      />
    </div>
  );
}
