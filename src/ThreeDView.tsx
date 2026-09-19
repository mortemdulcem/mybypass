import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import type {
  VolumeData,
  Segment,
  CraniometricLandmarks,
  FrankfortLandmarks,
  Point3D,
} from "./types";
import { LM12_DEFS } from "./export-utils";

interface ThreeDViewProps {
  vol: VolumeData | null;
  segments: Segment[];
  landmarks: FrankfortLandmarks;
  lm12: CraniometricLandmarks;
  crosshair: { x: number; y: number; z: number };
}

export const ThreeDView: React.FC<ThreeDViewProps> = ({
  vol,
  segments,
  landmarks,
  lm12,
  crosshair,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const objectsGroupRef = useRef<THREE.Group | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || 400;
    const height = container.clientHeight || 300;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0e14);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, width / height, 1, 2000);
    camera.position.set(200, 200, 300);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    rendererRef.current = renderer;

    container.innerHTML = "";
    container.appendChild(renderer.domElement);

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(100, 200, 150);
    scene.add(dirLight);

    const objectsGroup = new THREE.Group();
    scene.add(objectsGroup);
    objectsGroupRef.current = objectsGroup;

    // Simple mouse controls for rotation & zoom
    let isDragging = false;
    let prevMouse = { x: 0, y: 0 };
    let rotation = { x: 0.3, y: -0.5 };
    let distance = 350;

    const updateCamera = () => {
      const cy = Math.cos(rotation.y);
      const sy = Math.sin(rotation.y);
      const cx = Math.cos(rotation.x);
      const sx = Math.sin(rotation.x);

      camera.position.x = distance * sy * cx;
      camera.position.y = distance * sx;
      camera.position.z = distance * cy * cx;
      camera.lookAt(0, 0, 0);
    };
    updateCamera();

    const onMouseDown = (e: MouseEvent) => {
      isDragging = true;
      prevMouse = { x: e.clientX, y: e.clientY };
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - prevMouse.x;
      const dy = e.clientY - prevMouse.y;
      prevMouse = { x: e.clientX, y: e.clientY };

      rotation.y += dx * 0.01;
      rotation.x = Math.max(
        -Math.PI / 2.2,
        Math.min(Math.PI / 2.2, rotation.x + dy * 0.01)
      );
      updateCamera();
    };

    const onMouseUp = () => {
      isDragging = false;
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      distance = Math.max(50, Math.min(1000, distance + e.deltaY * 0.5));
      updateCamera();
    };

    const domEl = renderer.domElement;
    domEl.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    domEl.addEventListener("wheel", onWheel, { passive: false });

    // Render loop
    let animId: number;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(animId);
      domEl.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      domEl.removeEventListener("wheel", onWheel);
      resizeObserver.disconnect();
      renderer.dispose();
      if (container.contains(domEl)) {
        container.removeChild(domEl);
      }
    };
  }, []);

  // Update 3D objects when vol, landmarks, or segments change
  useEffect(() => {
    const group = objectsGroupRef.current;
    if (!group) return;

    // Clear previous objects
    while (group.children.length > 0) {
      const obj = group.children[0];
      group.remove(obj);
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose());
        } else {
          obj.material.dispose();
        }
      } else if (obj instanceof THREE.Points) {
        obj.geometry.dispose();
        (obj.material as THREE.Material).dispose();
      }
    }

    if (!vol) {
      // Draw a default subtle coordinate grid when empty
      const grid = new THREE.GridHelper(150, 15, 0x2a323e, 0x1c232e);
      group.add(grid);
      return;
    }

    const { w, h, z, px, sl } = vol;
    const physW = w * px;
    const physH = h * px;
    const physZ = z * sl;

    // Helper to map voxel (x,y,z) to 3D centered world coordinates
    const toWorld = (p: Point3D): THREE.Vector3 => {
      return new THREE.Vector3(
        p.x * px - physW / 2,
        -(p.y * px - physH / 2),
        p.z * sl - physZ / 2
      );
    };

    // 1. Volume Bounding Box
    const boxGeom = new THREE.BoxGeometry(physW, physH, physZ);
    const boxEdges = new THREE.EdgesGeometry(boxGeom);
    const boxLine = new THREE.LineSegments(
      boxEdges,
      new THREE.LineBasicMaterial({ color: 0x4fc3d9, transparent: true, opacity: 0.35 })
    );
    group.add(boxLine);

    // 2. Crosshair Planes
    const curWorldX = crosshair.x * px - physW / 2;
    const curWorldY = -(crosshair.y * px - physH / 2);
    const curWorldZ = crosshair.z * sl - physZ / 2;

    // Axial plane wire
    const axialPlaneGeom = new THREE.PlaneGeometry(physW, physH);
    const axialEdges = new THREE.EdgesGeometry(axialPlaneGeom);
    const axialWire = new THREE.LineSegments(
      axialEdges,
      new THREE.LineBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.4 })
    );
    axialWire.position.z = curWorldZ;
    group.add(axialWire);

    // 3. Segmented 3D Voxels / Points
    segments.forEach((seg) => {
      if (!seg.visible) return;
      const maskMap = seg.filled.size ? seg.filled : seg.key;
      const points: number[] = [];

      // Sample voxels (subsampled for interactive 60fps performance)
      const stepX = Math.max(2, Math.floor(w / 80));
      const stepY = Math.max(2, Math.floor(h / 80));
      const stepZ = Math.max(1, Math.floor(z / 40));

      for (const [zz, mask] of maskMap.entries()) {
        if (zz % stepZ !== 0) continue;
        const worldZ = zz * sl - physZ / 2;
        for (let yy = 0; yy < h; yy += stepY) {
          const worldY = -(yy * px - physH / 2);
          const rowOffset = yy * w;
          for (let xx = 0; xx < w; xx += stepX) {
            if (mask[rowOffset + xx]) {
              const worldX = xx * px - physW / 2;
              points.push(worldX, worldY, worldZ);
            }
          }
        }
      }

      if (points.length > 0) {
        const pGeom = new THREE.BufferGeometry();
        pGeom.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(points, 3)
        );
        const pMat = new THREE.PointsMaterial({
          color: new THREE.Color(seg.color),
          size: 3.5,
          transparent: true,
          opacity: 0.75,
        });
        const pCloud = new THREE.Points(pGeom, pMat);
        group.add(pCloud);
      }
    });

    // 4. Frankfort Plane Landmarks (PoR, PoL, OrL)
    const fhPoints: THREE.Vector3[] = [];
    const fhColor = 0xff5555;
    const addFhMarker = (p: Point3D | null, label: string) => {
      if (!p) return;
      const v = toWorld(p);
      fhPoints.push(v);
      const sphereGeom = new THREE.SphereGeometry(3.5, 12, 12);
      const sphereMat = new THREE.MeshBasicMaterial({ color: fhColor });
      const mesh = new THREE.Mesh(sphereGeom, sphereMat);
      mesh.position.copy(v);
      mesh.name = label;
      group.add(mesh);
    };
    addFhMarker(landmarks.PoR, "PoR");
    addFhMarker(landmarks.PoL, "PoL");
    addFhMarker(landmarks.OrL, "OrL");

    if (fhPoints.length === 3) {
      const triGeom = new THREE.BufferGeometry().setFromPoints([
        fhPoints[0],
        fhPoints[1],
        fhPoints[2],
        fhPoints[0],
      ]);
      const triLine = new THREE.Line(
        triGeom,
        new THREE.LineBasicMaterial({ color: fhColor, linewidth: 2 })
      );
      group.add(triLine);
    }

    // 5. 12 Craniometric 3D Landmarks
    for (const def of LM12_DEFS) {
      const p = lm12[def.key];
      if (!p) continue;
      const v = toWorld(p);
      const isRight = def.side === "R";
      const col = isRight ? 0x57d99d : 0x7aa2f7; // Green for Right, Blue for Left

      const markerGeom = new THREE.SphereGeometry(3, 10, 10);
      const markerMat = new THREE.MeshBasicMaterial({ color: col });
      const mesh = new THREE.Mesh(markerGeom, markerMat);
      mesh.position.copy(v);
      group.add(mesh);
    }
  }, [vol, segments, landmarks, lm12, crosshair]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full min-h-[260px] relative cursor-grab active:cursor-grabbing rounded overflow-hidden"
    >
      <div className="absolute top-2 left-2 z-10 text-[10px] font-mono bg-black/60 px-2 py-1 rounded text-cyan-300 pointer-events-none">
        3B GÖRÜNÜM (Sol Tık: Döndür · Tekerlek: Yakınlaş)
      </div>
    </div>
  );
};
