"use client";

import { useRef, useState, useCallback } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { useSceneConfig } from "@/hooks/SceneConfigContext";

// How many frames to skip between reads (6 = ~10 fps at 60 fps)
const POLL_INTERVAL = 6;

interface CameraReading {
  px: number;
  py: number;
  pz: number;
  fov: number;
  tx: number;
  ty: number;
  tz: number;
  width: number;
  height: number;
}

function fmt(n: number) {
  return n.toFixed(4);
}

/**
 * DebugCameraPanel — renders inside the R3F <Canvas>.
 *
 * Displays live camera position, FOV, OrbitControls target and canvas
 * dimensions. Copy button writes a ready-to-paste Scene.tsx snippet to the
 * clipboard. Set button persists the reading to localStorage so Scene.tsx
 * can pick it up on the next reload.
 */
export default function DebugCameraPanel() {
  const { camera, size, controls } = useThree();
  const { updateConfig } = useSceneConfig();
  const frameCount = useRef(0);
  const [reading, setReading] = useState<CameraReading>({
    px: 0,
    py: -0.4,
    pz: 0.8,
    fov: 38,
    tx: 0,
    ty: -0.4,
    tz: 0,
    width: size.width,
    height: size.height,
  });
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  useFrame(() => {
    frameCount.current += 1;
    if (frameCount.current % POLL_INTERVAL !== 0) return;

    const p = camera.position;
    const fov =
      camera instanceof THREE.PerspectiveCamera ? camera.fov : 38;

    // OrbitControls target is stored on the controls object
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctrl = controls as any;
    const target: THREE.Vector3 = ctrl?.target ?? new THREE.Vector3(0, -0.4, 0);

    setReading({
      px: p.x,
      py: p.y,
      pz: p.z,
      fov,
      tx: target.x,
      ty: target.y,
      tz: target.z,
      width: size.width,
      height: size.height,
    });
  });

  const buildSnippet = useCallback(
    (r: CameraReading) =>
      JSON.stringify(
        {
          position: { x: Number(fmt(r.px)), y: Number(fmt(r.py)), z: Number(fmt(r.pz)) },
          fov: Math.round(r.fov),
          target: { x: Number(fmt(r.tx)), y: Number(fmt(r.ty)), z: Number(fmt(r.tz)) }
        },
        null,
        2
      ),
    []
  );

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(buildSnippet(reading)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [reading, buildSnippet]);

  const handleSet = useCallback(async () => {
    const payload = {
      camera: {
        position: { x: reading.px, y: reading.py, z: reading.pz },
        fov: Math.round(reading.fov),
        target: { x: reading.tx, y: reading.ty, z: reading.tz },
      }
    };
    
    // Update context instantly so Scene reacts without reload
    updateConfig(payload);

    setSaved(true);
    setTimeout(() => setSaved(false), 2000);

    try {
      await fetch("/api/scene", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      console.error("Failed to save camera config via API:", e);
    }
  }, [reading, updateConfig]);

  return (
    <Html
      wrapperClass="debug-camera-panel-wrapper"
      style={{ pointerEvents: "none" }}
      /* Position bottom-right of the canvas */
      position={[0, 0, 0]}
      calculatePosition={() => [size.width - 20, size.height - 20, 0]}
      zIndexRange={[200, 210]}
    >
      <div
        style={{
          pointerEvents: "auto",
          /* Anchor to the bottom-right corner of the calculatePosition point */
          transform: "translate(-100%, -100%)",
          fontFamily:
            "'JetBrains Mono', 'Fira Mono', 'Cascadia Code', ui-monospace, monospace",
          fontSize: "11px",
          lineHeight: "1.6",
          background: "rgba(10, 12, 20, 0.88)",
          backdropFilter: "blur(12px)",
          border: "1px solid rgba(34, 211, 238, 0.25)",
          borderRadius: "10px",
          padding: "10px 14px",
          color: "#e2e8f0",
          minWidth: "260px",
          boxShadow: "0 4px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(34,211,238,0.08)",
        }}
      >
        {/* Header */}
        <div
          style={{
            color: "#22d3ee",
            fontWeight: 700,
            fontSize: "10px",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            marginBottom: "8px",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <span style={{ opacity: 0.7 }}>🎥</span> Camera Debug
        </div>

        {/* Readings table */}
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <tbody>
            <Row label="Position" value={`[${fmt(reading.px)}, ${fmt(reading.py)}, ${fmt(reading.pz)}]`} accent="#22d3ee" />
            <Row label="FOV" value={`${Math.round(reading.fov)}°`} accent="#22d3ee" />
            <Row label="Target" value={`[${fmt(reading.tx)}, ${fmt(reading.ty)}, ${fmt(reading.tz)}]`} accent="#a78bfa" />
            <Row label="Canvas" value={`${Math.round(reading.width)} × ${Math.round(reading.height)}`} accent="#6ee7b7" />
          </tbody>
        </table>

        {/* Snippet preview */}
        <pre
          style={{
            margin: "10px 0 10px",
            padding: "8px 10px",
            background: "rgba(255,255,255,0.05)",
            borderRadius: "6px",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
            color: "#94a3b8",
            fontSize: "10px",
            lineHeight: "1.5",
            maxHeight: "90px",
            overflow: "auto",
          }}
        >
          {buildSnippet(reading)}
        </pre>

        {/* Buttons */}
        <div style={{ display: "flex", gap: "6px" }}>
          <Btn onClick={handleCopy} accent="#22d3ee">
            {copied ? "✅ Copied!" : "📋 Copy"}
          </Btn>
          <Btn onClick={handleSet} accent="#a78bfa">
            {saved ? "✅ Saved!" : "💾 Set"}
          </Btn>
        </div>
      </div>
    </Html>
  );
}

/* ─── small helpers ────────────────────────────────────────────────────── */

function Row({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <tr>
      <td
        style={{
          color: accent,
          paddingRight: "10px",
          paddingBottom: "2px",
          fontSize: "10px",
          whiteSpace: "nowrap",
          opacity: 0.85,
        }}
      >
        {label}
      </td>
      <td style={{ color: "#f8fafc", paddingBottom: "2px" }}>{value}</td>
    </tr>
  );
}

function Btn({
  onClick,
  children,
  accent,
}: {
  onClick: () => void;
  children: React.ReactNode;
  accent: string;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        flex: 1,
        padding: "5px 8px",
        background: hover ? `${accent}22` : "rgba(255,255,255,0.06)",
        border: `1px solid ${hover ? accent : "rgba(255,255,255,0.12)"}`,
        borderRadius: "6px",
        color: hover ? accent : "#cbd5e1",
        cursor: "pointer",
        fontSize: "10px",
        fontFamily: "inherit",
        fontWeight: 600,
        transition: "all 0.15s ease",
        letterSpacing: "0.04em",
      }}
    >
      {children}
    </button>
  );
}
