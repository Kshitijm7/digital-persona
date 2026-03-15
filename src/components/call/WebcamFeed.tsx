"use client";

import { Badge } from "@/components/ui/badge";
import { Camera, CameraOff } from "lucide-react";
import { cn } from "@/lib/utils";

interface WebcamFeedProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  isActive: boolean;
  facingMode?: "user" | "environment";
}

export function WebcamFeed({ videoRef, isActive, facingMode = "user" }: WebcamFeedProps) {
  return (
    <div className="relative w-full h-full rounded-xl overflow-hidden border border-border bg-card">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={cn(
          "w-full h-full object-cover",
          facingMode === "user" && "scale-x-[-1]"
        )}
      />

      {/* HUD Overlay */}
      <div className="absolute inset-0 pointer-events-none">
        {/* Corner brackets */}
        <div className="absolute top-2 left-2 w-4 h-4 border-l-2 border-t-2 border-cyan-400/50" />
        <div className="absolute top-2 right-2 w-4 h-4 border-r-2 border-t-2 border-cyan-400/50" />
        <div className="absolute bottom-2 left-2 w-4 h-4 border-l-2 border-b-2 border-cyan-400/50" />
        <div className="absolute bottom-2 right-2 w-4 h-4 border-r-2 border-b-2 border-cyan-400/50" />
      </div>

      {/* Status Badge */}
      <div className="absolute bottom-2 left-2">
        <Badge
          variant="outline"
          className="bg-card text-[10px] tracking-widest uppercase font-mono border-border text-muted-foreground"
        >
          {isActive ? (
            <Camera className="w-3 h-3 mr-1 text-cyan-400" />
          ) : (
            <CameraOff className="w-3 h-3 mr-1 text-red-400" />
          )}
          {isActive ? "USER_CAM" : "OFF"}
        </Badge>
      </div>
    </div>
  );
}
