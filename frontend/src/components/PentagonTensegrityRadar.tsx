"use client";

import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { UnifiedDecisionCard } from "@/types/swrt";
import {
  AlertTriangle,
  CheckCircle2,
  ShieldAlert,
  RotateCw,
  Layers,
} from "lucide-react";

interface Props {
  card: UnifiedDecisionCard;
}

export default function PentagonTensegrityRadar({ card }: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);

  // Camera preset and rotation controls
  const [cameraPreset, setCameraPreset] = useState<"isometric" | "topDown" | "profile">("isometric");
  const [autoRotate, setAutoRotate] = useState<boolean>(true);

  const cameraPresetRef = useRef(cameraPreset);
  cameraPresetRef.current = cameraPreset;

  const autoRotateRef = useRef(autoRotate);
  autoRotateRef.current = autoRotate;

  const isBuckled = card.cohomology_veto || card.h_arb > 0.65 || card.action !== "BUY";

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || 480;
    const height = 350;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x070b14);

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
    camera.position.set(3.2, 3.4, 4.2);
    camera.lookAt(0, 0.15, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.innerHTML = "";
    container.appendChild(renderer.domElement);

    // Subtle reference grid at the base
    const gridHelper = new THREE.GridHelper(6, 12, 0x1e293b, 0x0f172a);
    gridHelper.position.y = -0.9;
    scene.add(gridHelper);

    // Ambient and directional lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
    scene.add(ambientLight);

    const pointLight = new THREE.PointLight(isBuckled ? 0xf43f5e : 0x10b981, 3.5, 15);
    pointLight.position.set(0, 3.5, 2.0);
    scene.add(pointLight);

    const fillLight = new THREE.DirectionalLight(0x38bdf8, 0.5);
    fillLight.position.set(0, -2, 3);
    scene.add(fillLight);

    const tensegrityGroup = new THREE.Group();
    scene.add(tensegrityGroup);

    // Glowing outer reference ring on y=0 equilibrium plane
    const ringRadius = 1.85;
    const refRingGeo = new THREE.TorusGeometry(ringRadius, 0.018, 16, 96);
    refRingGeo.rotateX(Math.PI / 2); // Lay flat on XZ plane at y = 0
    const refRingMat = new THREE.MeshStandardMaterial({
      color: isBuckled ? 0x0ea5e9 : 0x10b981,
      emissive: isBuckled ? 0x0284c7 : 0x059669,
      emissiveIntensity: 0.75,
      roughness: 0.25,
      metalness: 0.75,
      transparent: true,
      opacity: 0.8,
    });
    const refRingMesh = new THREE.Mesh(refRingGeo, refRingMat);
    refRingMesh.position.set(0, 0, 0);
    tensegrityGroup.add(refRingMesh);

    // Outer subtle boundary ring at y = 0
    const outerRingGeo = new THREE.RingGeometry(2.1, 2.13, 64);
    outerRingGeo.rotateX(-Math.PI / 2);
    const outerRingMat = new THREE.MeshBasicMaterial({
      color: 0x334155,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
    });
    tensegrityGroup.add(new THREE.Mesh(outerRingGeo, outerRingMat));

    // 5 Pentagon Vertices:
    // 0: BDM (Sinkhorn OT), 1: LOB (Rough Path), 2: NLP (IDXNet), 3: MAC (Macro/LK), 4: EXE (Apex on base)
    const stalkOrder: Array<"BDM" | "LOB" | "NLP" | "MAC"> = ["BDM", "LOB", "NLP", "MAC"];
    const vertices: THREE.Vector3[] = [];

    for (let i = 0; i < 5; i++) {
      const angle = (i * 2 * Math.PI) / 5 - Math.PI / 2;
      const x = ringRadius * Math.cos(angle);
      const z = ringRadius * Math.sin(angle);

      let y = 0.0;
      if (i < 4) {
        const st = card.stalks[stalkOrder[i]];
        // In equilibrium, pentagon remains flat; when buckled, vertices warp by mu_5d divergence
        y = isBuckled ? st.mu_5d * 1.15 : st.mu_5d * 0.12;
      } else {
        // 5th vertex: EXE
        y = isBuckled ? -0.65 : 0.1;
      }
      vertices.push(new THREE.Vector3(x, y, z));
    }

    // Altitude drop-stems from y=0 equilibrium reference plane to vertex y position
    vertices.forEach((v) => {
      if (Math.abs(v.y) > 0.04) {
        const stemPts = [new THREE.Vector3(v.x, 0, v.z), new THREE.Vector3(v.x, v.y, v.z)];
        const stemGeo = new THREE.BufferGeometry().setFromPoints(stemPts);
        const stemMat = new THREE.LineDashedMaterial({
          color: v.y < 0 ? 0xf43f5e : 0x38bdf8,
          dashSize: 0.08,
          gapSize: 0.04,
          transparent: true,
          opacity: 0.75,
        });
        const stemLine = new THREE.Line(stemGeo, stemMat);
        stemLine.computeLineDistances();
        tensegrityGroup.add(stemLine);
      }
    });

    // Central Sheaf Cohomology Apex (spikes crimson when buckled)
    const spikeHeight = isBuckled
      ? Math.min(2.4, 0.85 + card.sheaf_phi * 1.35 + card.h_arb * 0.75)
      : 0.15;
    const apexCenter = new THREE.Vector3(0, spikeHeight, 0);

    const primaryColor = isBuckled ? 0xf43f5e : 0x10b981;
    const secondaryColor = isBuckled ? 0xfb7185 : 0x34d399;

    // Translucent tensegrity membrane connecting perimeter to apex
    const fanPositions: number[] = [];
    for (let i = 0; i < 5; i++) {
      const v1 = vertices[i];
      const v2 = vertices[(i + 1) % 5];
      fanPositions.push(v1.x, v1.y, v1.z, v2.x, v2.y, v2.z, apexCenter.x, apexCenter.y, apexCenter.z);
    }
    const surfaceGeo = new THREE.BufferGeometry();
    surfaceGeo.setAttribute("position", new THREE.Float32BufferAttribute(fanPositions, 3));
    surfaceGeo.computeVertexNormals();

    const surfaceMat = new THREE.MeshPhongMaterial({
      color: primaryColor,
      transparent: true,
      opacity: isBuckled ? 0.32 : 0.22,
      side: THREE.DoubleSide,
      shininess: 80,
    });
    const surfaceMesh = new THREE.Mesh(surfaceGeo, surfaceMat);
    tensegrityGroup.add(surfaceMesh);

    // Contradiction detection set for highlighting contradicting struts
    const contradictionSet = new Set<string>();
    card.edge_faults.forEach((ef) => {
      if (ef.is_contradiction) {
        contradictionSet.add(`${ef.source}<->${ef.target}`);
        contradictionSet.add(`${ef.target}<->${ef.source}`);
      }
    });

    // Helper to build 3D cylinder strut
    const createCylinderStrut = (
      p1: THREE.Vector3,
      p2: THREE.Vector3,
      radius: number,
      color: number,
      emissive: number,
      opacity = 0.95
    ) => {
      const dir = new THREE.Vector3().subVectors(p2, p1);
      const length = dir.length();
      if (length < 0.001) return null;
      const geom = new THREE.CylinderGeometry(radius, radius, length, 8);
      const mat = new THREE.MeshStandardMaterial({
        color,
        emissive,
        emissiveIntensity: 0.85,
        roughness: 0.2,
        metalness: 0.7,
        transparent: true,
        opacity,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.copy(p1).add(p2).multiplyScalar(0.5);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
      return mesh;
    };

    // Render tensegrity struts:
    // Separate normal cables and glowing bright crimson contradiction struts
    const normalLinePts: THREE.Vector3[] = [];

    for (let i = 0; i < 5; i++) {
      for (let j = i + 1; j < 5; j++) {
        let isContradict = false;
        if (i < 4 && j < 4) {
          const u = stalkOrder[i];
          const v = stalkOrder[j];
          isContradict = contradictionSet.has(`${u}<->${v}`);
        }

        if (isContradict) {
          // Highlight contradicting coboundary strut in bright crimson cylinder
          const strut = createCylinderStrut(vertices[i], vertices[j], 0.032, 0xff0055, 0xff0055, 1.0);
          if (strut) tensegrityGroup.add(strut);
        } else {
          normalLinePts.push(vertices[i], vertices[j]);
        }
      }
      // Strut to central apex
      normalLinePts.push(vertices[i], apexCenter);
    }

    if (normalLinePts.length > 0) {
      const lineGeo = new THREE.BufferGeometry().setFromPoints(normalLinePts);
      const strutMat = new THREE.LineBasicMaterial({
        color: secondaryColor,
        transparent: true,
        opacity: 0.85,
      });
      const lineSegments = new THREE.LineSegments(lineGeo, strutMat);
      tensegrityGroup.add(lineSegments);
    }

    let hazardConeMesh: THREE.Mesh | null = null;

    // Central Cohomology Spike & Wireframe Outer Hazard Cone when buckled
    if (isBuckled) {
      // Solid inner crimson spike cone
      const solidConeGeo = new THREE.ConeGeometry(0.28, spikeHeight + 0.4, 20);
      const solidConeMat = new THREE.MeshPhongMaterial({
        color: 0xf43f5e,
        emissive: 0x9f1239,
        emissiveIntensity: 0.85,
        transparent: true,
        opacity: 0.88,
        shininess: 90,
      });
      const spikeCone = new THREE.Mesh(solidConeGeo, solidConeMat);
      spikeCone.position.set(0, (spikeHeight + 0.4) * 0.45, 0);
      tensegrityGroup.add(spikeCone);

      // Wireframe outer hazard cone enveloping the solid crimson spike
      const hazardConeGeo = new THREE.ConeGeometry(0.55, spikeHeight + 0.65, 12);
      const hazardConeMat = new THREE.MeshBasicMaterial({
        color: 0xff0055,
        wireframe: true,
        transparent: true,
        opacity: 0.75,
      });
      hazardConeMesh = new THREE.Mesh(hazardConeGeo, hazardConeMat);
      hazardConeMesh.position.set(0, (spikeHeight + 0.65) * 0.45, 0);
      tensegrityGroup.add(hazardConeMesh);
    }

    // Vertex spheres
    vertices.forEach((v, idx) => {
      const sphereGeo = new THREE.SphereGeometry(0.13, 20, 20);
      let nodeColor = primaryColor;
      if (idx < 4) {
        const st = card.stalks[stalkOrder[idx]];
        nodeColor = st.mu_5d >= 0.2 ? 0x10b981 : st.mu_5d <= -0.2 ? 0xf43f5e : 0xf59e0b;
      }
      const sphereMat = new THREE.MeshPhongMaterial({
        color: nodeColor,
        emissive: nodeColor,
        emissiveIntensity: 0.4,
      });
      const sphere = new THREE.Mesh(sphereGeo, sphereMat);
      sphere.position.copy(v);
      tensegrityGroup.add(sphere);
    });

    // Central Apex sphere
    const apexSphere = new THREE.Mesh(
      new THREE.SphereGeometry(isBuckled ? 0.17 : 0.11, 20, 20),
      new THREE.MeshPhongMaterial({
        color: primaryColor,
        emissive: primaryColor,
        emissiveIntensity: 0.7,
      })
    );
    apexSphere.position.copy(apexCenter);
    tensegrityGroup.add(apexSphere);

    // Resize handler
    const handleResize = () => {
      if (!container) return;
      const newWidth = container.clientWidth;
      camera.aspect = newWidth / height;
      camera.updateProjectionMatrix();
      renderer.setSize(newWidth, height);
    };
    window.addEventListener("resize", handleResize);

    // Animation Loop with smooth camera transitions and optional auto-rotate
    let frameId = 0;
    let clock = 0;
    const targetCamPos = new THREE.Vector3();
    const targetLookAt = new THREE.Vector3(0, 0.15, 0);

    const animate = () => {
      frameId = requestAnimationFrame(animate);
      clock += 0.012;

      // Camera preset target positions
      if (cameraPresetRef.current === "topDown") {
        targetCamPos.set(0.001, 5.6, 0.001);
        targetLookAt.set(0, 0, 0);
      } else if (cameraPresetRef.current === "profile") {
        targetCamPos.set(5.2, 0.25, 0.0);
        targetLookAt.set(0, 0.15, 0);
      } else {
        // Isometric default
        targetCamPos.set(3.2, 3.4, 4.2);
        targetLookAt.set(0, 0.15, 0);
      }

      // Smooth camera interpolation
      camera.position.lerp(targetCamPos, 0.07);
      camera.lookAt(targetLookAt);

      if (autoRotateRef.current) {
        tensegrityGroup.rotation.y += 0.008;
      }

      if (isBuckled) {
        tensegrityGroup.position.y = Math.sin(clock * 3.0) * 0.05;
        if (hazardConeMesh) {
          hazardConeMesh.rotation.y = -clock * 0.35;
        }
      } else {
        tensegrityGroup.position.y = 0;
      }

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", handleResize);
      renderer.dispose();
    };
  }, [card, isBuckled]);

  const stalksList = [
    { key: "BDM" as const, label: "Pillar 1: BDM (Sinkhorn OT)", data: card.stalks.BDM },
    { key: "LOB" as const, label: "Pillar 2: LOB (Rough Path)", data: card.stalks.LOB },
    { key: "NLP" as const, label: "Pillar 3: NLP (IDXNet Catalyst)", data: card.stalks.NLP },
    { key: "MAC" as const, label: "Pillar 4: MAC (Macro & LK)", data: card.stalks.MAC },
  ];

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 flex flex-col gap-4 shadow-xl">
      {/* Header with Friendly Title and Agreement Badge */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div>
          <h2 className="text-base font-bold text-slate-100 tracking-wide flex items-center gap-2">
            5-AI SIGNAL AGREEMENT RADAR (3D VIEW)
          </h2>
          <p className="text-xs text-slate-400">
            Flat Green Shape = Signals Agree (Safe) &bull; Red Spike = Signals Conflict (Warning)
          </p>
        </div>

        <div
          className={`px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 ${
            isBuckled
              ? "bg-rose-950/70 border-rose-500/60 text-rose-300"
              : "bg-emerald-950/70 border-emerald-500/60 text-emerald-300"
          }`}
          data-testid="sheaf-status-badge"
        >
          {isBuckled ? (
            <>
              <ShieldAlert className="w-4 h-4 text-rose-400" />
              <span>SIGNALS CONFLICT (BUCKLED SPIKE: &Phi;(x) = {card.sheaf_phi.toFixed(4)})</span>
            </>
          ) : (
            <>
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>SIGNALS ALIGNED (EQUILIBRIUM: &Phi;(x) = {card.sheaf_phi.toFixed(4)})</span>
            </>
          )}
        </div>
      </div>

      {/* 3D WebGL Canvas with Friendly HUD Overlays */}
      <div className="relative rounded-lg overflow-hidden border border-slate-800 bg-[#070b14]">
        <div ref={mountRef} className="w-full h-[320px]" data-testid="three-radar-canvas" />

        {/* Friendly Summary Overlay (Top-Left) */}
        <div className="absolute top-3 left-3 bg-slate-950/85 backdrop-blur-sm border border-slate-800 rounded-md px-3 py-2 text-xs space-y-1 z-10">
          <div className="text-slate-300 font-semibold">
            {isBuckled ? "⚠️ Warning: Signals Conflict" : "✓ Signals Are Aligned"}
          </div>
          <div className="text-slate-400">
            Risk Near -7% Limit:{" "}
            <span className={card.h_arb > 0.65 ? "text-rose-400 font-bold" : "text-emerald-300 font-semibold"}>
              {(card.h_arb * 100).toFixed(1)}%
            </span>
          </div>
        </div>

        {/* Camera View Preset & Auto-Rotate Buttons (Top-Right) */}
        <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-slate-950/90 backdrop-blur-sm border border-slate-800 rounded-lg p-1 text-xs z-10">
          <button
            type="button"
            onClick={() => setCameraPreset("isometric")}
            className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-colors ${
              cameraPreset === "isometric"
                ? "bg-cyan-600 text-white shadow-sm"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
            }`}
          >
            3D View
          </button>
          <button
            type="button"
            onClick={() => setCameraPreset("topDown")}
            className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-colors ${
              cameraPreset === "topDown"
                ? "bg-cyan-600 text-white shadow-sm"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
            }`}
          >
            Top View
          </button>
          <button
            type="button"
            onClick={() => setCameraPreset("profile")}
            className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-colors ${
              cameraPreset === "profile"
                ? "bg-cyan-600 text-white shadow-sm"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
            }`}
          >
            Side View
          </button>
          <div className="w-[1px] h-4 bg-slate-800 mx-0.5" />
          <button
            type="button"
            onClick={() => setAutoRotate(!autoRotate)}
            className={`px-2 py-1 rounded text-[11px] font-semibold flex items-center gap-1.5 transition-colors ${
              autoRotate
                ? "bg-emerald-950/80 border border-emerald-500/50 text-emerald-300"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
            }`}
          >
            <RotateCw className={`w-3 h-3 ${autoRotate ? "animate-spin" : ""}`} />
            <span>Rotate</span>
          </button>
        </div>

        {/* Friendly 5-Node Legend Overlay (Bottom-Left) */}
        <div className="absolute bottom-3 left-3 bg-slate-950/90 backdrop-blur-sm border border-slate-800 rounded-lg p-2.5 text-[11px] text-slate-300 shadow-xl space-y-1 z-10 pointer-events-none">
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold border-b border-slate-800/80 pb-1 flex items-center gap-1.5">
            <Layers className="w-3 h-3 text-cyan-400" />
            <span>5 AI Checkpoints</span>
          </div>
          <div className="grid grid-cols-1 gap-0.5 pt-0.5 text-[10px]">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
              <span className="font-semibold text-slate-200">1. Big Money / Bandar Flow</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
              <span className="font-semibold text-slate-200">2. Orderbook Buying Cushion</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
              <span className="font-semibold text-slate-200">3. Company News &amp; Filings</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
              <span className="font-semibold text-slate-200">4. Financial Health &amp; Profit</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span
                className={`w-2 h-2 rounded-full ${
                  isBuckled ? "bg-rose-500 animate-pulse" : "bg-cyan-400"
                } inline-block`}
              />
              <span className="font-semibold text-slate-200">5. Overall AI Agreement</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
