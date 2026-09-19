import React, { useState, useEffect, useRef, useCallback } from "react";
import type {
  VolumeData,
  Segment,
  Measurement,
  CurvePolygon,
  FrankfortLandmarks,
  CraniometricLandmarks,
  Point3D,
} from "./types";
import {
  parseDicomBuffer,
  buildVolumeFromDicomSlices,
  loadZipArchive,
  loadImagesFolder,
  createDemoOrbitalVolume,
  applyCTWindow,
} from "./dicom-loader";
import {
  computeAlignRotation,
  resampleVolumeFrankfort,
} from "./frankfort";
import { interpolateSlices } from "./sdf-interpolator";
import {
  LM12_DEFS,
  distMm,
  segVolumeCm3,
  curveAreaPerimMm,
  computeCentroidSize,
  generate43ParametersTable,
  exportToExcel,
  exportToCSV,
  saveProjectJson,
  rleDecode,
} from "./export-utils";
import { ThreeDView } from "./ThreeDView";

const PALETTE = [
  "#4fc3d9",
  "#f0895b",
  "#c792ea",
  "#57d99d",
  "#e2c95b",
  "#e2586b",
  "#7aa2f7",
  "#f6a0c3",
];

export default function App() {
  const [vol, setVol] = useState<VolumeData | null>(null);
  const [curZ, setCurZ] = useState<number>(0);
  const [crosshair, setCrosshair] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  const [tool, setTool] = useState<"paint" | "erase" | "ruler" | "nav" | "curve">("nav");
  const [brushSize, setBrushSize] = useState<number>(12);
  const [rulerPreset, setRulerPreset] = useState<string>("Sağ Orbital Genişlik");
  const [curvePreset, setCurvePreset] = useState<string>("Sağ Aperture");
  const [patientId, setPatientId] = useState<string>("175");
  const [pxSpacing, setPxSpacing] = useState<number>(0.488281);
  const [sliceThk, setSliceThk] = useState<number>(1.25);
  const [loadStatus, setLoadStatus] = useState<string>("Veri bekliyor (DICOM, ZIP veya Demo yükleyin).");
  const [showTableModal, setShowTableModal] = useState<boolean>(false);

  // CT Windowing
  const [ctWindow, setCtWindow] = useState<"bone" | "soft" | "brain">("bone");

  // Segments
  const [segments, setSegments] = useState<Segment[]>([
    {
      id: 1,
      name: "Sağ Orbita",
      color: "#4fc3d9",
      key: new Map(),
      filled: new Map(),
      visible: true,
    },
    {
      id: 2,
      name: "Sol Orbita",
      color: "#f0895b",
      key: new Map(),
      filled: new Map(),
      visible: true,
    },
  ]);
  const [curSegId, setCurSegId] = useState<number>(1);
  const [newSegName, setNewSegName] = useState<string>("");

  // Measurements & Curves
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [pendingRuler, setPendingRuler] = useState<Point3D | null>(null);
  const [curves, setCurves] = useState<CurvePolygon[]>([]);
  const [pendingCurve, setPendingCurve] = useState<{ z: number; points: { x: number; y: number }[] } | null>(null);

  // Frankfort Plane Landmarks
  const [landmarks, setLandmarks] = useState<FrankfortLandmarks>({
    PoR: null,
    PoL: null,
    OrL: null,
  });

  // 12 Craniometric Landmarks
  const [lm12, setLm12] = useState<CraniometricLandmarks>({});

  // Canvas Refs
  const axialCanvasRef = useRef<HTMLCanvasElement>(null);
  const corCanvasRef = useRef<HTMLCanvasElement>(null);
  const sagCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);

  const isPaintingRef = useRef<boolean>(false);

  // Initialize Demo volume on request
  const handleLoadDemo = () => {
    setLoadStatus("Demo 3B Orbita BT oluşturuluyor...");
    setTimeout(() => {
      const demoVol = createDemoOrbitalVolume();
      setVol(demoVol);
      setCurZ(Math.floor(demoVol.z / 2));
      setCrosshair({ x: Math.floor(demoVol.w / 2), y: Math.floor(demoVol.h / 2) });
      setPxSpacing(demoVol.px);
      setSliceThk(demoVol.sl);
      setPatientId("Demo_Hasta_175");
      setLoadStatus(`Yüklendi: ${demoVol.z} kesit, ${demoVol.w}×${demoVol.h} voksel (Demo BT)`);
    }, 50);
  };

  // Handle DICOM or ZIP upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    try {
      if (files.length === 1 && files[0].name.toLowerCase().endsWith(".zip")) {
        setLoadStatus("ZIP arşivi açılıyor ve DICOM kesitleri taranıyor...");
        const slices = await loadZipArchive(files[0]);
        if (slices.length === 0) {
          alert("ZIP içinde geçerli DICOM kesiti bulunamadı.");
          setLoadStatus("Hata: DICOM bulunamadı.");
          return;
        }
        const v = buildVolumeFromDicomSlices(slices, files[0].name.replace(".zip", ""));
        loadVolumeIntoState(v);
      } else {
        setLoadStatus(`${files.length} DICOM dosyası okunuyor...`);
        const slices = [];
        for (let i = 0; i < files.length; i++) {
          const buf = await files[i].arrayBuffer();
          const s = parseDicomBuffer(buf);
          if (s) slices.push(s);
        }
        if (slices.length === 0) {
          alert("Seçilen dosyalardan geçerli DICOM okunamadı.");
          setLoadStatus("Hata: Geçersiz DICOM formatı.");
          return;
        }
        const v = buildVolumeFromDicomSlices(slices, patientId);
        loadVolumeIntoState(v);
      }
    } catch (err) {
      console.error(err);
      alert("Dosya yüklenirken hata oluştu: " + String(err));
      setLoadStatus("Hata: Okuma başarısız.");
    }
  };

  const handleFolderUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    try {
      setLoadStatus(`${files.length} görüntü yükleniyor...`);
      const v = await loadImagesFolder(Array.from(files), pxSpacing, sliceThk, patientId);
      loadVolumeIntoState(v);
    } catch (err) {
      console.error(err);
      alert("Klasör okunurken hata oluştu.");
    }
  };

  const loadVolumeIntoState = (v: VolumeData) => {
    setVol(v);
    setCurZ(Math.floor(v.z / 2));
    setCrosshair({ x: Math.floor(v.w / 2), y: Math.floor(v.h / 2) });
    setPxSpacing(v.px);
    setSliceThk(v.sl);
    setLoadStatus(`Yüklendi: ${v.z} kesit, ${v.w}×${v.h}px (${v.isDicom ? "DICOM CT" : "Görüntü Serisi"})`);
  };

  // Change CT Window
  const handleWindowChange = (win: "bone" | "soft" | "brain") => {
    setCtWindow(win);
    if (!vol || !vol.rawHounsfield) return;

    let wc = 500, ww = 2000;
    if (win === "soft") {
      wc = 40; ww = 400;
    } else if (win === "brain") {
      wc = 40; ww = 80;
    }
    const newDisplay = new Uint8Array(vol.z * vol.h * vol.w);
    applyCTWindow(newDisplay, vol.rawHounsfield, wc, ww);

    setVol({
      ...vol,
      data: newDisplay,
      windowCenter: wc,
      windowWidth: ww,
    });
  };

  // ---------------- Segments ----------------
  const handleAddSegment = () => {
    const name = newSegName.trim();
    if (!name) return;
    const color = PALETTE[segments.length % PALETTE.length];
    const newSeg: Segment = {
      id: Date.now(),
      name,
      color,
      key: new Map(),
      filled: new Map(),
      visible: true,
    };
    setSegments([...segments, newSeg]);
    setCurSegId(newSeg.id);
    setNewSegName("");
  };

  const handleDeleteSegment = (id: number) => {
    const filtered = segments.filter((s) => s.id !== id);
    setSegments(filtered);
    if (curSegId === id && filtered.length > 0) {
      setCurSegId(filtered[0].id);
    }
  };

  const handleFillBetweenSlices = () => {
    const seg = segments.find((s) => s.id === curSegId);
    if (!seg || !vol) return;
    if (seg.key.size < 2) {
      alert("En az 2 farklı kesitte boyama yapmalısınız.");
      return;
    }
    const filled = interpolateSlices(seg.key, vol.w, vol.h);
    setSegments(
      segments.map((s) => (s.id === curSegId ? { ...s, filled } : s))
    );
  };

  // ---------------- Painting on Axial Slice ----------------
  const paintOnSlice = (pt: { x: number; y: number }, isPaint: boolean) => {
    if (!vol) return;
    const seg = segments.find((s) => s.id === curSegId);
    if (!seg) return;

    const { w, h } = vol;
    let sliceMask = seg.key.get(curZ);
    if (!sliceMask) {
      sliceMask = new Uint8Array(w * h);
    } else {
      sliceMask = new Uint8Array(sliceMask);
    }

    const r = brushSize;
    const x0 = Math.max(0, pt.x - r);
    const x1 = Math.min(w - 1, pt.x + r);
    const y0 = Math.max(0, pt.y - r);
    const y1 = Math.min(h - 1, pt.y + r);
    const val = isPaint ? 1 : 0;

    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        if ((xx - pt.x) ** 2 + (yy - pt.y) ** 2 <= r * r) {
          sliceMask[yy * w + xx] = val;
        }
      }
    }

    const newKey = new Map(seg.key);
    newKey.set(curZ, sliceMask);

    setSegments(
      segments.map((s) =>
        s.id === curSegId ? { ...s, key: newKey, filled: new Map() } : s
      )
    );
  };

  // ---------------- Frankfort Horizontal Plane Alignment ----------------
  const handleFrankfortAlign = () => {
    if (!vol) return;
    if (!landmarks.PoR || !landmarks.PoL || !landmarks.OrL) {
      alert("Lütfen önce Sağ Porion, Sol Porion ve Sol Orbitale noktalarını işaretleyin.");
      return;
    }
    if (
      !confirm(
        "Frankfort hizalaması tüm 3B hacmi bu düzleme göre döndürür ve yeniden örnekler. Mevcut segment boyamaları sıfırlanır, landmarklar yeni koordinatlara taşınır. Devam edilsin mi?"
      )
    ) {
      return;
    }

    setLoadStatus("Frankfort düzlemine göre 3B rijit rotasyon uygulanıyor...");
    setTimeout(() => {
      const { R, pivot } = computeAlignRotation(
        landmarks.PoR!,
        landmarks.PoL!,
        landmarks.OrL!,
        vol.px,
        vol.sl
      );
      const { newData, transformPoint } = resampleVolumeFrankfort(vol, R, pivot);

      // Transform existing landmarks
      const newPoR = transformPoint(landmarks.PoR!);
      const newPoL = transformPoint(landmarks.PoL!);
      const newOrL = transformPoint(landmarks.OrL!);

      const newLm12: CraniometricLandmarks = {};
      for (const [k, p] of Object.entries(lm12)) {
        if (p) newLm12[k] = transformPoint(p);
      }

      setVol({
        ...vol,
        data: newData,
      });
      setLandmarks({
        PoR: newPoR,
        PoL: newPoL,
        OrL: newOrL,
      });
      setLm12(newLm12);
      setSegments(
        segments.map((s) => ({ ...s, key: new Map(), filled: new Map() }))
      );
      setMeasurements([]);
      setCurves([]);

      const zSpread = Math.abs(newPoR.z - newPoL.z) * vol.sl;
      setLoadStatus(
        `Frankfort hizalaması tamamlandı. Kalan rotasyonel Z sapması: ${zSpread.toFixed(3)} mm.`
      );
    }, 50);
  };

  // ---------------- Render Views (Axial, Coronal, Sagittal) ----------------
  const renderAllSlices = useCallback(() => {
    if (!vol) return;
    const { w, h, z, data, px, sl } = vol;

    // Helper: convert hex to rgb
    const hexToRgb = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    };

    // 1. Axial Canvas
    const cA = axialCanvasRef.current;
    if (cA) {
      const ctx = cA.getContext("2d");
      if (ctx) {
        ctx.imageSmoothingEnabled = false;
        const imgData = ctx.createImageData(w, h);
        const sliceOffset = curZ * w * h;

        for (let i = 0; i < w * h; i++) {
          const val = data[sliceOffset + i];
          imgData.data[i * 4] = val;
          imgData.data[i * 4 + 1] = val;
          imgData.data[i * 4 + 2] = val;
          imgData.data[i * 4 + 3] = 255;
        }

        // Overlay segments
        segments.forEach((seg) => {
          if (!seg.visible) return;
          const mask = seg.filled.get(curZ) || seg.key.get(curZ);
          if (!mask) return;
          const { r, g, b } = hexToRgb(seg.color);
          const alpha = seg.id === curSegId ? 0.48 : 0.3;

          for (let i = 0; i < w * h; i++) {
            if (mask[i]) {
              imgData.data[i * 4] = Math.round(imgData.data[i * 4] * (1 - alpha) + r * alpha);
              imgData.data[i * 4 + 1] = Math.round(imgData.data[i * 4 + 1] * (1 - alpha) + g * alpha);
              imgData.data[i * 4 + 2] = Math.round(imgData.data[i * 4 + 2] * (1 - alpha) + b * alpha);
            }
          }
        });

        ctx.putImageData(imgData, 0, 0);

        // Draw crosshair
        ctx.strokeStyle = "rgba(255, 230, 0, 0.55)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(crosshair.x, 0);
        ctx.lineTo(crosshair.x, h);
        ctx.moveTo(0, crosshair.y);
        ctx.lineTo(w, crosshair.y);
        ctx.stroke();

        // Draw ruler lines on axial
        measurements.forEach((m) => {
          if (m.p1 && m.p2 && m.p1.z === curZ && m.p2.z === curZ) {
            ctx.strokeStyle = "#ffe066";
            ctx.fillStyle = "#ffe066";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(m.p1.x, m.p1.y);
            ctx.lineTo(m.p2.x, m.p2.y);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(m.p1.x, m.p1.y, 3, 0, Math.PI * 2);
            ctx.arc(m.p2.x, m.p2.y, 3, 0, Math.PI * 2);
            ctx.fill();
          }
        });

        if (pendingRuler && pendingRuler.z === curZ) {
          ctx.fillStyle = "#ffe066";
          ctx.beginPath();
          ctx.arc(pendingRuler.x, pendingRuler.y, 4, 0, Math.PI * 2);
          ctx.fill();
        }

        // Draw Curves
        curves.forEach((c) => {
          if (c.z !== curZ || c.points.length < 2) return;
          ctx.strokeStyle = "#7aa2f7";
          ctx.fillStyle = "#7aa2f7";
          ctx.lineWidth = 2;
          ctx.beginPath();
          c.points.forEach((p, idx) => {
            if (idx === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
          });
          ctx.closePath();
          ctx.stroke();
          c.points.forEach((p) => {
            ctx.beginPath();
            ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
            ctx.fill();
          });
        });

        if (pendingCurve && pendingCurve.z === curZ) {
          ctx.strokeStyle = "#ffe066";
          ctx.fillStyle = "#ffe066";
          ctx.lineWidth = 2;
          ctx.beginPath();
          pendingCurve.points.forEach((p, idx) => {
            if (idx === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
          });
          ctx.stroke();
          pendingCurve.points.forEach((p) => {
            ctx.beginPath();
            ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
            ctx.fill();
          });
        }
      }
    }

    // 2. Coronal Canvas (fixed y = crosshair.y)
    const cC = corCanvasRef.current;
    if (cC) {
      const ctx = cC.getContext("2d");
      if (ctx) {
        ctx.imageSmoothingEnabled = false;
        const imgData = ctx.createImageData(w, z);
        const cy = Math.max(0, Math.min(h - 1, crosshair.y));

        for (let zz = 0; zz < z; zz++) {
          const sliceBase = zz * h * w + cy * w;
          const rowBase = zz * w;
          for (let xx = 0; xx < w; xx++) {
            const val = data[sliceBase + xx];
            const p = (rowBase + xx) * 4;
            imgData.data[p] = val;
            imgData.data[p + 1] = val;
            imgData.data[p + 2] = val;
            imgData.data[p + 3] = 255;
          }
        }

        // Overlay segments in coronal view
        segments.forEach((seg) => {
          if (!seg.visible) return;
          const maskSource = seg.filled.size ? seg.filled : seg.key;
          const { r, g, b } = hexToRgb(seg.color);
          const alpha = 0.35;

          for (const [zz, mask] of maskSource.entries()) {
            const maskRowBase = cy * w;
            const targetRowBase = zz * w;
            for (let xx = 0; xx < w; xx++) {
              if (mask[maskRowBase + xx]) {
                const p = (targetRowBase + xx) * 4;
                imgData.data[p] = Math.round(imgData.data[p] * (1 - alpha) + r * alpha);
                imgData.data[p + 1] = Math.round(imgData.data[p + 1] * (1 - alpha) + g * alpha);
                imgData.data[p + 2] = Math.round(imgData.data[p + 2] * (1 - alpha) + b * alpha);
              }
            }
          }
        });

        ctx.putImageData(imgData, 0, 0);

        // Coronal crosshair: X = crosshair.x, Z = curZ
        ctx.strokeStyle = "rgba(255, 230, 0, 0.55)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(crosshair.x, 0);
        ctx.lineTo(crosshair.x, z);
        ctx.moveTo(0, curZ);
        ctx.lineTo(w, curZ);
        ctx.stroke();
      }
    }

    // 3. Sagittal Canvas (fixed x = crosshair.x)
    const cS = sagCanvasRef.current;
    if (cS) {
      const ctx = cS.getContext("2d");
      if (ctx) {
        ctx.imageSmoothingEnabled = false;
        const imgData = ctx.createImageData(h, z);
        const cx = Math.max(0, Math.min(w - 1, crosshair.x));

        for (let zz = 0; zz < z; zz++) {
          const sliceBase = zz * h * w;
          const rowBase = zz * h;
          for (let yy = 0; yy < h; yy++) {
            const val = data[sliceBase + yy * w + cx];
            const p = (rowBase + yy) * 4;
            imgData.data[p] = val;
            imgData.data[p + 1] = val;
            imgData.data[p + 2] = val;
            imgData.data[p + 3] = 255;
          }
        }

        // Overlay segments in sagittal view
        segments.forEach((seg) => {
          if (!seg.visible) return;
          const maskSource = seg.filled.size ? seg.filled : seg.key;
          const { r, g, b } = hexToRgb(seg.color);
          const alpha = 0.35;

          for (const [zz, mask] of maskSource.entries()) {
            const targetRowBase = zz * h;
            for (let yy = 0; yy < h; yy++) {
              if (mask[yy * w + cx]) {
                const p = (targetRowBase + yy) * 4;
                imgData.data[p] = Math.round(imgData.data[p] * (1 - alpha) + r * alpha);
                imgData.data[p + 1] = Math.round(imgData.data[p + 1] * (1 - alpha) + g * alpha);
                imgData.data[p + 2] = Math.round(imgData.data[p + 2] * (1 - alpha) + b * alpha);
              }
            }
          }
        });

        ctx.putImageData(imgData, 0, 0);

        // Sagittal crosshair: Y = crosshair.y, Z = curZ
        ctx.strokeStyle = "rgba(255, 230, 0, 0.55)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(crosshair.y, 0);
        ctx.lineTo(crosshair.y, z);
        ctx.moveTo(0, curZ);
        ctx.lineTo(h, curZ);
        ctx.stroke();
      }
    }
  }, [
    vol,
    curZ,
    crosshair,
    segments,
    curSegId,
    measurements,
    pendingRuler,
    curves,
    pendingCurve,
  ]);

  useEffect(() => {
    renderAllSlices();
  }, [renderAllSlices]);

  // Handle Axial mouse interaction
  const getAxialCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!vol || !axialCanvasRef.current) return { x: 0, y: 0 };
    const rect = axialCanvasRef.current.getBoundingClientRect();
    const scaleX = vol.w / rect.width;
    const scaleY = vol.h / rect.height;
    return {
      x: Math.max(0, Math.min(vol.w - 1, Math.round((e.clientX - rect.left) * scaleX))),
      y: Math.max(0, Math.min(vol.h - 1, Math.round((e.clientY - rect.top) * scaleY))),
    };
  };

  const handleAxialMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!vol) return;
    const pt = getAxialCoords(e);

    if (tool === "paint" || tool === "erase") {
      isPaintingRef.current = true;
      paintOnSlice(pt, tool === "paint");
    } else if (tool === "nav") {
      setCrosshair(pt);
    } else if (tool === "ruler") {
      if (!pendingRuler) {
        setPendingRuler({ x: pt.x, y: pt.y, z: curZ });
      } else {
        const newMeas: Measurement = {
          id: Date.now(),
          label: rulerPreset || `Ölçüm ${measurements.length + 1}`,
          p1: pendingRuler,
          p2: { x: pt.x, y: pt.y, z: curZ },
        };
        setMeasurements([...measurements, newMeas]);
        setPendingRuler(null);
      }
    } else if (tool === "curve") {
      if (!pendingCurve || pendingCurve.z !== curZ) {
        setPendingCurve({ z: curZ, points: [pt] });
      } else {
        setPendingCurve({
          ...pendingCurve,
          points: [...pendingCurve.points, pt],
        });
      }
    }
  };

  const handleAxialMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isPaintingRef.current || !vol) return;
    const pt = getAxialCoords(e);
    paintOnSlice(pt, tool === "paint");
  };

  const handleAxialMouseUp = () => {
    isPaintingRef.current = false;
  };

  // Coronal click -> jumps crosshair X & slice Z
  const handleCoronalClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!vol || !corCanvasRef.current) return;
    const rect = corCanvasRef.current.getBoundingClientRect();
    const scaleX = vol.w / rect.width;
    const scaleZ = vol.z / rect.height;
    const x = Math.max(0, Math.min(vol.w - 1, Math.round((e.clientX - rect.left) * scaleX)));
    const z = Math.max(0, Math.min(vol.z - 1, Math.round((e.clientY - rect.top) * scaleZ)));
    setCrosshair({ ...crosshair, x });
    setCurZ(z);
  };

  // Sagittal click -> jumps crosshair Y & slice Z
  const handleSagittalClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!vol || !sagCanvasRef.current) return;
    const rect = sagCanvasRef.current.getBoundingClientRect();
    const scaleY = vol.h / rect.width;
    const scaleZ = vol.z / rect.height;
    const y = Math.max(0, Math.min(vol.h - 1, Math.round((e.clientX - rect.left) * scaleY)));
    const z = Math.max(0, Math.min(vol.z - 1, Math.round((e.clientY - rect.top) * scaleZ)));
    setCrosshair({ ...crosshair, y });
    setCurZ(z);
  };

  // Save / Load Project JSON
  const handleOpenProject = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const proj = JSON.parse(reader.result as string);
        if (!vol || vol.w !== proj.volDims?.w || vol.h !== proj.volDims?.h) {
          alert("UYARI: Bu projeyi açmak için önce aynı boyutlardaki BT serisini yüklemelisiniz.");
          return;
        }
        setPatientId(proj.patientId || patientId);
        setPxSpacing(proj.px || pxSpacing);
        setSliceThk(proj.sl || sliceThk);

        const loadedSegments: Segment[] = proj.segments.map(
          (s: any, idx: number) => {
            const key = new Map<number, Uint8Array>();
            s.key.forEach((k: any) => {
              key.set(k.z, rleDecode(k.rle, vol.w * vol.h));
            });
            return {
              id: Date.now() + idx,
              name: s.name,
              color: s.color,
              key,
              filled: new Map(),
              visible: true,
            };
          }
        );
        setSegments(loadedSegments);
        setMeasurements(proj.measurements || []);
        setLandmarks(proj.landmarks || { PoR: null, PoL: null, OrL: null });
        setLm12(proj.lm12 || {});
        setCurves(proj.curves || []);
        alert("Proje başarıyla yüklendi.");
      } catch (err) {
        alert("Geçersiz proje dosyası: " + String(err));
      }
    };
    reader.readAsText(file);
  };

  const currentCentroidSize = vol ? computeCentroidSize(lm12, vol.px, vol.sl) : null;
  const table43 = vol
    ? generate43ParametersTable(vol, segments, measurements, curves, lm12)
    : [];

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[#0d1117] text-[#e8edf2] font-['IBM_Plex_Sans'] text-[13px] select-none">
      {/* HEADER */}
      <header className="flex flex-wrap items-center gap-3 px-4 py-2 bg-[#151b23] border-b border-[#2a323e] flex-none z-20">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-[#4fc3d9] animate-pulse"></div>
          <h1 className="text-[14px] font-bold text-[#8fe0ee] tracking-wide whitespace-nowrap">
            BAĞIMSIZ ORBİTA MORFOMETRİ
          </h1>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#1c232e] text-[#57d99d] border border-[#2a323e]">
            v2.4 CT-3D
          </span>
        </div>

        {/* Load Buttons */}
        <div className="flex items-center gap-2">
          <button
            id="btnLoadDicom"
            onClick={() => fileInputRef.current?.click()}
            className="px-3 py-1 bg-[#4fc3d9] hover:bg-[#8fe0ee] text-[#052226] font-semibold rounded text-[12px] transition"
          >
            DICOM / ZIP Yükle
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".dcm,.ima,.zip,application/zip"
            onChange={handleFileUpload}
            className="hidden"
          />

          <button
            id="btnLoadFolder"
            onClick={() => folderInputRef.current?.click()}
            className="px-2.5 py-1 bg-[#1c232e] hover:border-[#4fc3d9] border border-[#2a323e] rounded text-[12px] transition"
          >
            PNG Klasörü
          </button>
          <input
            ref={folderInputRef}
            type="file"
            // @ts-expect-error webkitdirectory directory support
            webkitdirectory="true"
            directory="true"
            multiple
            accept="image/png"
            onChange={handleFolderUpload}
            className="hidden"
          />

          <button
            id="btnLoadDemo"
            onClick={handleLoadDemo}
            className="px-2.5 py-1 bg-[#1c232e] hover:border-[#57d99d] text-[#57d99d] border border-[#2a323e] rounded text-[12px] transition"
          >
            ⚡ Demo BT Yükle
          </button>
        </div>

        {/* Calibration inputs */}
        <div className="flex items-center gap-3 text-[11.5px] text-[#8b98a8]">
          <label className="flex items-center gap-1">
            Sıra No:
            <input
              id="inputPatientId"
              type="text"
              value={patientId}
              onChange={(e) => setPatientId(e.target.value)}
              className="w-20 px-2 py-0.5 bg-[#1c232e] border border-[#2a323e] text-white rounded text-[11px] font-mono"
            />
          </label>
          <label className="flex items-center gap-1">
            Pixel Spacing:
            <input
              id="inputPixelSpacing"
              type="number"
              step="0.0001"
              value={pxSpacing}
              onChange={(e) => {
                const val = parseFloat(e.target.value) || 0.488;
                setPxSpacing(val);
                if (vol) setVol({ ...vol, px: val });
              }}
              className="w-16 px-1.5 py-0.5 bg-[#1c232e] border border-[#2a323e] text-white rounded text-[11px] font-mono"
            />
            mm
          </label>
          <label className="flex items-center gap-1">
            Kesit:
            <input
              id="inputSliceThk"
              type="number"
              step="0.01"
              value={sliceThk}
              onChange={(e) => {
                const val = parseFloat(e.target.value) || 1.25;
                setSliceThk(val);
                if (vol) setVol({ ...vol, sl: val });
              }}
              className="w-14 px-1.5 py-0.5 bg-[#1c232e] border border-[#2a323e] text-white rounded text-[11px] font-mono"
            />
            mm
          </label>
        </div>

        {/* CT Window selection */}
        <div className="flex items-center gap-1 text-[11px] border border-[#2a323e] p-0.5 rounded bg-[#1c232e]">
          <button
            onClick={() => handleWindowChange("bone")}
            className={`px-2 py-0.5 rounded ${ctWindow === "bone" ? "bg-[#4fc3d9] text-black font-semibold" : "text-[#8b98a8]"}`}
          >
            Kemik
          </button>
          <button
            onClick={() => handleWindowChange("soft")}
            className={`px-2 py-0.5 rounded ${ctWindow === "soft" ? "bg-[#4fc3d9] text-black font-semibold" : "text-[#8b98a8]"}`}
          >
            Yumuşak Doku
          </button>
          <button
            onClick={() => handleWindowChange("brain")}
            className={`px-2 py-0.5 rounded ${ctWindow === "brain" ? "bg-[#4fc3d9] text-black font-semibold" : "text-[#8b98a8]"}`}
          >
            Beyin
          </button>
        </div>

        <div className="flex-1"></div>

        {/* Project & Exports */}
        <div className="flex items-center gap-2">
          <button
            id="btnSaveProject"
            onClick={() => {
              if (!vol) {
                alert("Önce bir BT yükleyin.");
                return;
              }
              saveProjectJson(vol, segments, measurements, curves, landmarks, lm12, patientId);
            }}
            className="px-2.5 py-1 bg-[#1c232e] hover:border-[#4fc3d9] border border-[#2a323e] rounded text-[12px] transition"
          >
            Projeyi Kaydet
          </button>
          <button
            id="btnOpenProject"
            onClick={() => projectInputRef.current?.click()}
            className="px-2.5 py-1 bg-[#1c232e] hover:border-[#4fc3d9] border border-[#2a323e] rounded text-[12px] transition"
          >
            Projeyi Aç
          </button>
          <input
            ref={projectInputRef}
            type="file"
            accept=".json"
            onChange={handleOpenProject}
            className="hidden"
          />

          <button
            id="btnShow43Table"
            onClick={() => setShowTableModal(true)}
            className="px-3 py-1 bg-[#1c232e] hover:border-[#ffe066] text-[#ffe066] border border-[#2a323e] rounded text-[12px] font-semibold transition"
          >
            📊 43 Parametre
          </button>

          <button
            id="btnExportXlsx"
            onClick={() => {
              if (!vol) {
                alert("Önce bir BT yükleyin.");
                return;
              }
              exportToExcel(vol, segments, measurements, curves, lm12, patientId);
            }}
            className="px-3 py-1 bg-[#57d99d] hover:bg-[#8fe0ee] text-[#052226] font-bold rounded text-[12px] transition"
          >
            Excel İndir (.xlsx)
          </button>
        </div>
      </header>

      {/* SUB-HEADER STATUS BAR */}
      <div className="flex items-center justify-between px-4 py-1 bg-[#11161d] border-b border-[#222834] text-[11px] font-mono text-[#8b98a8]">
        <div className="flex items-center gap-2">
          <span className="text-[#4fc3d9]">Durum:</span>
          <span>{loadStatus}</span>
        </div>
        <div className="flex items-center gap-4 text-[10.5px]">
          <span>Gezinti: ({crosshair.x}, {crosshair.y}, {curZ})</span>
          <span className="text-emerald-400">Veri Güvenliği: Yerel Bellek Anonim</span>
          <span className="text-amber-300">GPU Modelleri: Çevrimdışı (Bağımsız Mod)</span>
        </div>
      </div>

      {/* MAIN WORKSPACE LAYOUT */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* 4-QUADRANT VIEWPORTS (Axial, Coronal, Sagittal, 3D) */}
        <div className="flex-1 grid grid-cols-2 grid-rows-2 gap-2 p-2 bg-[#090d12] min-w-0">
          {/* 1. AXIAL VIEW */}
          <div className="flex flex-col bg-[#151b23] border border-[#2a323e] rounded-lg p-2 min-w-0 overflow-hidden">
            <div className="flex items-center justify-between text-[11px] font-mono text-[#8b98a8] mb-1 uppercase tracking-wider">
              <span className="text-[#4fc3d9] font-bold">AKSIYEL (AXIAL) KESİT</span>
              <span>{vol ? `${vol.w}×${vol.h}px · Z:${curZ + 1}/${vol.z}` : "Hazır değil"}</span>
            </div>
            <div className="flex-1 bg-black rounded flex items-center justify-center overflow-hidden relative cursor-crosshair">
              {vol ? (
                <canvas
                  ref={axialCanvasRef}
                  width={vol.w}
                  height={vol.h}
                  onMouseDown={handleAxialMouseDown}
                  onMouseMove={handleAxialMouseMove}
                  onMouseUp={handleAxialMouseUp}
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <div className="text-[#8b98a8] text-center p-4">
                  BT serisi bekleniyor. Yukarıdaki <b>"DICOM / ZIP Yükle"</b> veya <b>"Demo BT Yükle"</b> butonuna tıklayın.
                </div>
              )}
            </div>
            {/* Slice slider controls */}
            {vol && (
              <div className="flex items-center gap-2 mt-2 pt-1 border-t border-[#222834]">
                <button
                  onClick={() => setCurZ(Math.max(0, curZ - 1))}
                  className="px-2 py-0.5 bg-[#1c232e] hover:border-[#4fc3d9] border border-[#2a323e] rounded text-xs"
                >
                  ◀
                </button>
                <input
                  id="axialSliceSlider"
                  type="range"
                  min={0}
                  max={vol.z - 1}
                  value={curZ}
                  onChange={(e) => setCurZ(parseInt(e.target.value, 10))}
                  className="flex-1 accent-[#4fc3d9] cursor-pointer"
                />
                <button
                  onClick={() => setCurZ(Math.min(vol.z - 1, curZ + 1))}
                  className="px-2 py-0.5 bg-[#1c232e] hover:border-[#4fc3d9] border border-[#2a323e] rounded text-xs"
                >
                  ▶
                </button>
                <span className="font-mono text-[11px] text-[#8b98a8] w-16 text-right">
                  {curZ + 1} / {vol.z}
                </span>
              </div>
            )}
          </div>

          {/* 2. CORONAL VIEW */}
          <div className="flex flex-col bg-[#151b23] border border-[#2a323e] rounded-lg p-2 min-w-0 overflow-hidden">
            <div className="flex items-center justify-between text-[11px] font-mono text-[#8b98a8] mb-1 uppercase tracking-wider">
              <span className="text-[#4fc3d9] font-bold">KORONAL (CORONAL) MPR</span>
              <span>{vol ? `Y=${crosshair.y} (${(crosshair.y * vol.px).toFixed(1)}mm)` : "—"}</span>
            </div>
            <div className="flex-1 bg-black rounded flex items-center justify-center overflow-hidden relative cursor-crosshair">
              {vol ? (
                <canvas
                  ref={corCanvasRef}
                  width={vol.w}
                  height={vol.z}
                  onClick={handleCoronalClick}
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <span className="text-[#8b98a8] text-xs font-mono">Koronal kesit hazır</span>
              )}
            </div>
          </div>

          {/* 3. SAGITTAL VIEW */}
          <div className="flex flex-col bg-[#151b23] border border-[#2a323e] rounded-lg p-2 min-w-0 overflow-hidden">
            <div className="flex items-center justify-between text-[11px] font-mono text-[#8b98a8] mb-1 uppercase tracking-wider">
              <span className="text-[#4fc3d9] font-bold">SAGİTTAL (SAGITTAL) MPR</span>
              <span>{vol ? `X=${crosshair.x} (${(crosshair.x * vol.px).toFixed(1)}mm)` : "—"}</span>
            </div>
            <div className="flex-1 bg-black rounded flex items-center justify-center overflow-hidden relative cursor-crosshair">
              {vol ? (
                <canvas
                  ref={sagCanvasRef}
                  width={vol.h}
                  height={vol.z}
                  onClick={handleSagittalClick}
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <span className="text-[#8b98a8] text-xs font-mono">Sagittal kesit hazır</span>
              )}
            </div>
          </div>

          {/* 4. 3D INTERACTIVE VIEW */}
          <div className="flex flex-col bg-[#151b23] border border-[#2a323e] rounded-lg p-2 min-w-0 overflow-hidden">
            <div className="flex items-center justify-between text-[11px] font-mono text-[#8b98a8] mb-1 uppercase tracking-wider">
              <span className="text-[#8fe0ee] font-bold">3B ORBİTA VE KRANİYAL REKONSTRÜKSİYON</span>
              <span className="text-[#57d99d]">Three.js WebGL</span>
            </div>
            <div className="flex-1 bg-[#0a0e14] rounded overflow-hidden">
              <ThreeDView
                vol={vol}
                segments={segments}
                landmarks={landmarks}
                lm12={lm12}
                crosshair={{ x: crosshair.x, y: crosshair.y, z: curZ }}
              />
            </div>
          </div>
        </div>

        {/* SIDEBAR TOOLS & CONTROLS */}
        <div className="w-80 bg-[#151b23] border-l border-[#2a323e] flex flex-col p-3 gap-3 overflow-y-auto flex-none">
          {/* TOOL PALETTE */}
          <div className="bg-[#1c232e] border border-[#2a323e] rounded-lg p-2.5">
            <h2 className="text-[11px] font-mono font-bold text-[#8b98a8] uppercase tracking-wider mb-2">
              ÇALIŞMA ARAÇLARI
            </h2>
            <div className="grid grid-cols-2 gap-1.5 text-[12px]">
              <button
                id="toolNav"
                onClick={() => setTool("nav")}
                className={`py-1 px-2 rounded border transition ${tool === "nav" ? "bg-[#4fc3d9] text-[#052226] font-bold border-[#4fc3d9]" : "bg-[#151b23] border-[#2a323e] hover:border-[#4fc3d9]"}`}
              >
                ✛ Gezinti
              </button>
              <button
                id="toolRuler"
                onClick={() => setTool("ruler")}
                className={`py-1 px-2 rounded border transition ${tool === "ruler" ? "bg-[#4fc3d9] text-[#052226] font-bold border-[#4fc3d9]" : "bg-[#151b23] border-[#2a323e] hover:border-[#4fc3d9]"}`}
              >
                📏 Cetvel (2 Nokta)
              </button>
              <button
                id="toolPaint"
                onClick={() => setTool("paint")}
                className={`py-1 px-2 rounded border transition ${tool === "paint" ? "bg-[#4fc3d9] text-[#052226] font-bold border-[#4fc3d9]" : "bg-[#151b23] border-[#2a323e] hover:border-[#4fc3d9]"}`}
              >
                🖌 Boya
              </button>
              <button
                id="toolErase"
                onClick={() => setTool("erase")}
                className={`py-1 px-2 rounded border transition ${tool === "erase" ? "bg-[#4fc3d9] text-[#052226] font-bold border-[#4fc3d9]" : "bg-[#151b23] border-[#2a323e] hover:border-[#4fc3d9]"}`}
              >
                ⌫ Sil
              </button>
              <button
                id="toolCurve"
                onClick={() => setTool("curve")}
                className={`col-span-2 py-1 px-2 rounded border transition ${tool === "curve" ? "bg-[#4fc3d9] text-[#052226] font-bold border-[#4fc3d9]" : "bg-[#151b23] border-[#2a323e] hover:border-[#4fc3d9]"}`}
              >
                ✏ Apertür Eğrisi (Alan/Çevre)
              </button>
            </div>

            {/* Brush Size */}
            {(tool === "paint" || tool === "erase") && (
              <div className="flex items-center gap-2 mt-2 text-[11px] text-[#8b98a8]">
                <span>Fırça:</span>
                <input
                  type="range"
                  min={2}
                  max={40}
                  value={brushSize}
                  onChange={(e) => setBrushSize(parseInt(e.target.value, 10))}
                  className="flex-1 accent-[#4fc3d9]"
                />
                <span className="font-mono text-white">{brushSize}px</span>
              </div>
            )}

            {/* Ruler Preset Select */}
            {tool === "ruler" && (
              <div className="mt-2 text-[11px]">
                <label className="text-[#8b98a8] block mb-1">Cetvel Etiketi:</label>
                <select
                  value={rulerPreset}
                  onChange={(e) => setRulerPreset(e.target.value)}
                  className="w-full bg-[#151b23] border border-[#2a323e] text-white p-1 rounded font-mono text-[11px]"
                >
                  <optgroup label="Orbital Boyutlar">
                    <option>Sağ Orbital Genişlik</option>
                    <option>Sol Orbital Genişlik</option>
                    <option>Sağ Orbital Yükseklik</option>
                    <option>Sol Orbital Yükseklik</option>
                    <option>Sağ Orbital Derinlik</option>
                    <option>Sol Orbital Derinlik</option>
                  </optgroup>
                  <optgroup label="Kenar Kalınlıkları">
                    <option>Superior Kenar Kalınlığı</option>
                    <option>İnferior Kenar Kalınlığı</option>
                    <option>Medial Kenar Kalınlığı</option>
                    <option>Lateral Kenar Kalınlığı</option>
                  </optgroup>
                  <optgroup label="Genişlikler">
                    <option>İnterorbital Mesafe (d-d)</option>
                    <option>Biorbital Genişlik (ek-ek)</option>
                  </optgroup>
                </select>
              </div>
            )}
          </div>

          {/* FRANKFORT PLANE ALIGNMENT */}
          <div className="bg-[#1c232e] border border-[#2a323e] rounded-lg p-2.5">
            <h2 className="text-[11px] font-mono font-bold text-[#8fe0ee] uppercase tracking-wider mb-2">
              FRANKFORT DÜZLEMİ HİZALAMA
            </h2>
            <div className="space-y-1.5 text-[11.5px]">
              {[
                { key: "PoR" as const, label: "Sağ Porion (PoR)", desc: "Dış kulak yolu üst kenarı" },
                { key: "PoL" as const, label: "Sol Porion (PoL)", desc: "Dış kulak yolu üst kenarı" },
                { key: "OrL" as const, label: "Sol Orbitale (OrL)", desc: "Göz çukuru alt kenarı" },
              ].map((def) => {
                const pt = landmarks[def.key];
                return (
                  <div
                    key={def.key}
                    className="flex items-center justify-between p-1.5 bg-[#151b23] border border-[#222834] rounded"
                  >
                    <div>
                      <div className="font-semibold text-white">{def.label}</div>
                      <div className="text-[10px] text-[#8b98a8]">
                        {pt ? `Kesit ${pt.z + 1} (${pt.x}, ${pt.y})` : "İşaretlenmedi"}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => {
                          if (!vol) return;
                          setLandmarks({
                            ...landmarks,
                            [def.key]: { x: crosshair.x, y: crosshair.y, z: curZ },
                          });
                        }}
                        className="px-2 py-0.5 bg-[#1c232e] hover:bg-[#4fc3d9] hover:text-black border border-[#2a323e] rounded text-xs"
                        title="Mevcut kesit ve imleç konumunu kaydet"
                      >
                        📍
                      </button>
                      {pt && (
                        <button
                          onClick={() => setLandmarks({ ...landmarks, [def.key]: null })}
                          className="px-1.5 py-0.5 text-red-400 hover:bg-red-950/40 rounded text-xs"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <button
              id="btnFrankfortAlign"
              onClick={handleFrankfortAlign}
              className="w-full mt-2 py-1.5 bg-[#4fc3d9] hover:bg-[#8fe0ee] text-[#052226] font-bold rounded text-[11.5px] transition"
            >
              Hizala (3B Rotasyon Uygula)
            </button>
            <p className="text-[10px] text-[#8b98a8] mt-1.5 leading-relaxed">
              Üç nokta da işaretlendikten sonra tüm hacim bu düzlem yatay olacak biçimde döndürülür.
            </p>
          </div>

          {/* SEGMENTS & VOLUME */}
          <div className="bg-[#1c232e] border border-[#2a323e] rounded-lg p-2.5">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-[11px] font-mono font-bold text-[#8b98a8] uppercase tracking-wider">
                SEGMENTLER &amp; HACİM
              </h2>
              <button
                onClick={handleFillBetweenSlices}
                className="px-2 py-0.5 bg-[#4fc3d9] hover:bg-[#8fe0ee] text-[#052226] font-semibold rounded text-[10.5px]"
                title="SDF morfolojik interpolasyon uygula"
              >
                Fill Slices
              </button>
            </div>

            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {segments.map((seg) => {
                const volCm3 = vol ? segVolumeCm3(seg, vol.px, vol.sl) : 0;
                const sliceCount = seg.filled.size || seg.key.size;
                const isSelected = seg.id === curSegId;

                return (
                  <div
                    key={seg.id}
                    onClick={() => setCurSegId(seg.id)}
                    className={`flex items-center justify-between p-1.5 rounded cursor-pointer border ${isSelected ? "bg-[#242e3d] border-[#4fc3d9]" : "bg-[#151b23] border-[#222834] hover:border-[#2a323e]"}`}
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded"
                        style={{ backgroundColor: seg.color }}
                      ></div>
                      <div>
                        <div className="font-semibold text-white text-[11.5px]">{seg.name}</div>
                        <div className="text-[10px] font-mono text-[#8b98a8]">
                          {sliceCount} kesit · <b className="text-[#8fe0ee]">{volCm3.toFixed(2)} cm³</b>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteSegment(seg.id);
                      }}
                      className="text-[#8b98a8] hover:text-red-400 p-1 text-xs"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Add segment row */}
            <div className="flex items-center gap-1.5 mt-2">
              <input
                type="text"
                placeholder="Yeni segment..."
                value={newSegName}
                onChange={(e) => setNewSegName(e.target.value)}
                className="flex-1 px-2 py-1 bg-[#151b23] border border-[#2a323e] text-white rounded text-[11px]"
              />
              <button
                onClick={handleAddSegment}
                className="px-2.5 py-1 bg-[#151b23] hover:border-[#4fc3d9] border border-[#2a323e] rounded text-[11px]"
              >
                + Ekle
              </button>
            </div>
          </div>

          {/* 12 CRANIOMETRIC 3D LANDMARKS */}
          <div className="bg-[#1c232e] border border-[#2a323e] rounded-lg p-2.5">
            <div className="flex items-center justify-between mb-1.5">
              <h2 className="text-[11px] font-mono font-bold text-[#8fe0ee] uppercase tracking-wider">
                12 3B LANDMARK &amp; CENTROID SIZE
              </h2>
            </div>
            <div className="text-[11px] bg-[#151b23] p-1.5 rounded border border-[#222834] mb-2 flex items-center justify-between">
              <span className="text-[#8b98a8]">Centroid Size (CS):</span>
              <span className="font-mono font-bold text-[#57d99d]">
                {currentCentroidSize !== null ? `${currentCentroidSize.toFixed(3)} mm` : "— (12 nokta gerekli)"}
              </span>
            </div>

            <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
              {LM12_DEFS.map((def) => {
                const pt = lm12[def.key];
                return (
                  <div
                    key={def.key}
                    className="flex items-center justify-between py-1 px-1.5 bg-[#151b23] border border-[#222834] rounded text-[11px]"
                  >
                    <div className="truncate mr-1">
                      <span className={def.side === "R" ? "text-emerald-300" : "text-sky-300"}>
                        {def.side === "R" ? "[Sağ]" : "[Sol]"}
                      </span>{" "}
                      {def.label}
                    </div>
                    <div className="flex items-center gap-1 font-mono text-[10px]">
                      {pt ? (
                        <span className="text-[#4fc3d9]">K:{pt.z + 1}</span>
                      ) : (
                        <span className="text-[#627284]">—</span>
                      )}
                      <button
                        onClick={() => {
                          if (!vol) return;
                          setLm12({
                            ...lm12,
                            [def.key]: { x: crosshair.x, y: crosshair.y, z: curZ },
                          });
                        }}
                        className="px-1.5 py-0.5 bg-[#1c232e] hover:bg-[#4fc3d9] hover:text-black rounded"
                        title="İmleç noktasını ata"
                      >
                        📍
                      </button>
                      {pt && (
                        <button
                          onClick={() => {
                            const copy = { ...lm12 };
                            delete copy[def.key];
                            setLm12(copy);
                          }}
                          className="text-red-400 hover:text-red-300 px-1"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* APERTURE CURVES */}
          <div className="bg-[#1c232e] border border-[#2a323e] rounded-lg p-2.5">
            <h2 className="text-[11px] font-mono font-bold text-[#8b98a8] uppercase tracking-wider mb-2">
              APERTÜR ALAN / ÇEVRE (EĞRİ)
            </h2>
            <div className="flex items-center gap-2 mb-2">
              <select
                value={curvePreset}
                onChange={(e) => setCurvePreset(e.target.value)}
                className="flex-1 bg-[#151b23] border border-[#2a323e] text-white p-1 rounded text-[11px]"
              >
                <option>Sağ Aperture</option>
                <option>Sol Aperture</option>
              </select>
            </div>
            <div className="flex gap-1.5">
              <button
                onClick={() => {
                  setTool("curve");
                  setPendingCurve({ z: curZ, points: [] });
                }}
                className="flex-1 py-1 bg-[#151b23] hover:border-[#4fc3d9] border border-[#2a323e] rounded text-[11px]"
              >
                Eğri Başlat
              </button>
              <button
                onClick={() => {
                  if (!pendingCurve || pendingCurve.points.length < 3) {
                    alert("En az 3 nokta işaretlemelisiniz.");
                    return;
                  }
                  const newC: CurvePolygon = {
                    id: Date.now(),
                    label: curvePreset || `Eğri ${curves.length + 1}`,
                    z: pendingCurve.z,
                    points: pendingCurve.points,
                  };
                  setCurves([...curves, newC]);
                  setPendingCurve(null);
                }}
                className="flex-1 py-1 bg-[#4fc3d9] hover:bg-[#8fe0ee] text-[#052226] font-semibold rounded text-[11px]"
              >
                Kapat &amp; Bitir
              </button>
              <button
                onClick={() => setPendingCurve(null)}
                className="px-2 py-1 bg-[#151b23] hover:border-red-400 border border-[#2a323e] rounded text-[11px] text-red-400"
              >
                İptal
              </button>
            </div>

            {curves.length > 0 && (
              <div className="mt-2 space-y-1 max-h-24 overflow-y-auto">
                {curves.map((c) => {
                  const res = vol ? curveAreaPerimMm(c.points, vol.px) : { area: 0, perim: 0 };
                  return (
                    <div
                      key={c.id}
                      className="flex items-center justify-between p-1 bg-[#151b23] border border-[#222834] rounded text-[10.5px]"
                    >
                      <span className="font-semibold text-white">{c.label}</span>
                      <span className="font-mono text-[#8fe0ee]">
                        {res.area.toFixed(1)} mm² · {res.perim.toFixed(1)} mm
                      </span>
                      <button
                        onClick={() => setCurves(curves.filter((x) => x.id !== c.id))}
                        className="text-red-400 hover:text-red-300 ml-1"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* LINEAR MEASUREMENTS LIST */}
          <div className="bg-[#1c232e] border border-[#2a323e] rounded-lg p-2.5">
            <h2 className="text-[11px] font-mono font-bold text-[#8b98a8] uppercase tracking-wider mb-2">
              LİNEER ÖLÇÜMLER (CETVEL)
            </h2>
            {measurements.length === 0 ? (
              <p className="text-[10px] text-[#8b98a8]">
                Cetvel aracıyla iki nokta tıklayarak ölçüm ekleyin.
              </p>
            ) : (
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {measurements.map((m) => {
                  const dist = m.p2 && vol ? distMm(m.p1, m.p2, vol.px, vol.sl).toFixed(2) : "…";
                  return (
                    <div
                      key={m.id}
                      className="flex items-center justify-between p-1 bg-[#151b23] border border-[#222834] rounded text-[11px]"
                    >
                      <input
                        type="text"
                        value={m.label}
                        onChange={(e) => {
                          const val = e.target.value;
                          setMeasurements(
                            measurements.map((x) => (x.id === m.id ? { ...x, label: val } : x))
                          );
                        }}
                        className="bg-transparent border-none text-white text-[11px] flex-1 mr-1"
                      />
                      <span className="font-mono text-[#4fc3d9] whitespace-nowrap mr-2">
                        {dist} mm
                      </span>
                      <button
                        onClick={() => setMeasurements(measurements.filter((x) => x.id !== m.id))}
                        className="text-red-400 hover:text-red-300"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 43-PARAMETER THESIS SUMMARY MODAL */}
      {showTableModal && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-6 backdrop-blur-sm">
          <div className="bg-[#151b23] border border-[#2a323e] rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between p-4 border-b border-[#2a323e]">
              <div>
                <h3 className="text-base font-bold text-[#8fe0ee]">
                  43-PARAMETRE ORBİTA MORFOMETRİ VE TEZ PROTOKOLÜ
                </h3>
                <p className="text-xs text-[#8b98a8] mt-0.5">
                  Hasta Sıra No: <b>{patientId}</b> · Spacing: {pxSpacing}mm · Kesit: {sliceThk}mm
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    if (vol) exportToCSV(vol, segments, measurements, curves, lm12, patientId);
                  }}
                  className="px-3 py-1 bg-[#1c232e] hover:border-[#4fc3d9] border border-[#2a323e] rounded text-xs"
                >
                  CSV İndir
                </button>
                <button
                  onClick={() => {
                    if (vol) exportToExcel(vol, segments, measurements, curves, lm12, patientId);
                  }}
                  className="px-3 py-1 bg-[#57d99d] hover:bg-[#8fe0ee] text-[#052226] font-bold rounded text-xs"
                >
                  Excel İndir (.xlsx)
                </button>
                <button
                  onClick={() => setShowTableModal(false)}
                  className="px-3 py-1 bg-[#2a323e] hover:bg-red-900 rounded text-xs ml-2"
                >
                  Kapat
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-[#2a323e] text-[#8b98a8] font-mono">
                    <th className="py-2 px-2">No</th>
                    <th className="py-2 px-2">Parametre</th>
                    <th className="py-2 px-2">Değer</th>
                    <th className="py-2 px-2">Birim</th>
                    <th className="py-2 px-2">Açıklama / Formül</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#222834]">
                  {table43.map((row, idx) => (
                    <tr key={idx} className="hover:bg-[#1c232e]/50">
                      <td className="py-1.5 px-2 font-mono text-[#8b98a8]">{row.no}</td>
                      <td className="py-1.5 px-2 font-semibold text-white">{row.name}</td>
                      <td className="py-1.5 px-2 font-mono font-bold text-[#4fc3d9]">{row.value}</td>
                      <td className="py-1.5 px-2 text-[#8b98a8] font-mono">{row.unit}</td>
                      <td className="py-1.5 px-2 text-[#8b98a8] text-[11px]">{row.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
