import * as XLSX from "xlsx";
import type {
  VolumeData,
  Segment,
  Measurement,
  CurvePolygon,
  CraniometricLandmarks,
  FrankfortLandmarks,
} from "./types";

export const LM12_DEFS = [
  { key: "dR", label: "Dakryon Sağ", side: "R" },
  { key: "dL", label: "Dakryon Sol", side: "L" },
  { key: "fmoR", label: "Frontomalare Orbitale Sağ", side: "R" },
  { key: "fmoL", label: "Frontomalare Orbitale Sol", side: "L" },
  { key: "ekR", label: "Ektokonşiyon Sağ", side: "R" },
  { key: "ekL", label: "Ektokonşiyon Sol", side: "L" },
  { key: "mfR", label: "Maksillofrontale Sağ", side: "R" },
  { key: "mfL", label: "Maksillofrontale Sol", side: "L" },
  { key: "sciR", label: "Sup. Orbital Kenar Orta Nokta Sağ", side: "R" },
  { key: "sciL", label: "Sup. Orbital Kenar Orta Nokta Sol", side: "L" },
  { key: "iorR", label: "İnf. Orbital Kenar Orta Nokta Sağ", side: "R" },
  { key: "iorL", label: "İnf. Orbital Kenar Orta Nokta Sol", side: "L" },
];

export function distMm(
  p1: { x: number; y: number; z: number },
  p2: { x: number; y: number; z: number },
  px: number,
  sl: number
): number {
  const dx = (p2.x - p1.x) * px;
  const dy = (p2.y - p1.y) * px;
  const dz = (p2.z - p1.z) * sl;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function segVolumeCm3(
  seg: Segment,
  px: number,
  sl: number
): number {
  const src = seg.filled.size ? seg.filled : seg.key;
  let voxels = 0;
  for (const mask of src.values()) {
    for (let i = 0; i < mask.length; i++) {
      voxels += mask[i];
    }
  }
  const voxVolMm3 = px * px * sl;
  return (voxels * voxVolMm3) / 1000;
}

export function curveAreaPerimMm(
  points: { x: number; y: number }[],
  px: number
): { area: number; perim: number } {
  const n = points.length;
  if (n < 3) return { area: 0, perim: 0 };
  let area = 0;
  let perim = 0;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    area += a.x * px * (b.y * px) - b.x * px * (a.y * px);
    perim += Math.hypot((b.x - a.x) * px, (b.y - a.y) * px);
  }
  return { area: Math.abs(area) / 2, perim };
}

export function computeCentroidSize(
  lm12: CraniometricLandmarks,
  px: number,
  sl: number
): number | null {
  const pts: [number, number, number][] = [];
  for (const def of LM12_DEFS) {
    const p = lm12[def.key];
    if (!p) return null;
    pts.push([p.x * px, p.y * px, p.z * sl]);
  }
  if (pts.length < 12) return null;

  const cx = pts.reduce((sum, p) => sum + p[0], 0) / pts.length;
  const cy = pts.reduce((sum, p) => sum + p[1], 0) / pts.length;
  const cz = pts.reduce((sum, p) => sum + p[2], 0) / pts.length;

  let sumSq = 0;
  for (const p of pts) {
    sumSq += (p[0] - cx) ** 2 + (p[1] - cy) ** 2 + (p[2] - cz) ** 2;
  }
  return Math.sqrt(sumSq);
}

export function pairMeasurementsBySide(
  measurements: Measurement[],
  px: number,
  sl: number
): { base: string; R: number; L: number }[] {
  const valMap = new Map<string, number>();
  for (const m of measurements) {
    if (m.p2) {
      valMap.set(m.label.trim().toLowerCase(), distMm(m.p1, m.p2, px, sl));
    }
  }

  const pairs: { base: string; R: number; L: number }[] = [];
  const seen = new Set<string>();

  for (const m of measurements) {
    if (!m.p2) continue;
    const lbl = m.label.trim();
    if (!/sağ/i.test(lbl)) continue;
    const key = lbl.toLowerCase();
    if (seen.has(key)) continue;

    const leftLbl = lbl.replace(/sağ/gi, (match) =>
      match[0] === "S" ? "Sol" : "sol"
    );
    const leftVal = valMap.get(leftLbl.trim().toLowerCase());
    if (leftVal !== undefined) {
      seen.add(key);
      const rVal = distMm(m.p1, m.p2, px, sl);
      pairs.push({
        base: lbl.replace(/sağ/gi, "").replace(/\s+/g, " ").trim(),
        R: rVal,
        L: leftVal,
      });
    }
  }
  return pairs;
}

export function generate43ParametersTable(
  vol: VolumeData,
  segments: Segment[],
  measurements: Measurement[],
  curves: CurvePolygon[],
  lm12: CraniometricLandmarks
): Array<{ no: number | string; name: string; value: string; unit: string; description: string }> {
  const px = vol.px;
  const sl = vol.sl;
  const rows: Array<{
    no: number | string;
    name: string;
    value: string;
    unit: string;
    description: string;
  }> = [];

  const measMap = new Map<string, number>();
  for (const m of measurements) {
    if (m.p2) {
      measMap.set(m.label.trim().toLowerCase(), distMm(m.p1, m.p2, px, sl));
    }
  }

  const getMeas = (names: string[]): number | null => {
    for (const n of names) {
      const v = measMap.get(n.toLowerCase());
      if (v !== undefined) return v;
    }
    return null;
  };

  const segMap = new Map<string, number>();
  for (const s of segments) {
    segMap.set(s.name.trim().toLowerCase(), segVolumeCm3(s, px, sl));
  }
  const getVol = (names: string[]): number | null => {
    for (const n of names) {
      const v = segMap.get(n.toLowerCase());
      if (v !== undefined) return v;
    }
    return null;
  };

  const curveMap = new Map<string, { area: number; perim: number }>();
  for (const c of curves) {
    curveMap.set(c.label.trim().toLowerCase(), curveAreaPerimMm(c.points, px));
  }
  const getCurve = (names: string[]) => {
    for (const n of names) {
      const v = curveMap.get(n.toLowerCase());
      if (v !== undefined) return v;
    }
    return null;
  };

  // 1-6 Linear
  const rW = getMeas(["sağ orbital genişlik", "sag orbital genislik", "orbital genişlik sağ"]);
  const lW = getMeas(["sol orbital genişlik", "orbital genişlik sol"]);
  const rH = getMeas(["sağ orbital yükseklik", "sag orbital yukseklik", "orbital yükseklik sağ"]);
  const lH = getMeas(["sol orbital yükseklik", "orbital yükseklik sol"]);
  const rD = getMeas(["sağ orbital derinlik", "sag orbital derinlik", "orbital derinlik sağ"]);
  const lD = getMeas(["sol orbital derinlik", "orbital derinlik sol"]);

  rows.push({ no: 1, name: "Sağ Orbital Genişlik", value: rW ? rW.toFixed(2) : "—", unit: "mm", description: "mf-ek veya d-ek yatay orbital genişliği" });
  rows.push({ no: 2, name: "Sol Orbital Genişlik", value: lW ? lW.toFixed(2) : "—", unit: "mm", description: "mf-ek veya d-ek yatay orbital genişliği" });
  rows.push({ no: 3, name: "Sağ Orbital Yükseklik", value: rH ? rH.toFixed(2) : "—", unit: "mm", description: "sci-ior dikey orbital yüksekliği" });
  rows.push({ no: 4, name: "Sol Orbital Yükseklik", value: lH ? lH.toFixed(2) : "—", unit: "mm", description: "sci-ior dikey orbital yüksekliği" });
  rows.push({ no: 5, name: "Sağ Orbital Derinlik", value: rD ? rD.toFixed(2) : "—", unit: "mm", description: "Apertür merkezinden optik kanal orbital girişine mesafe" });
  rows.push({ no: 6, name: "Sol Orbital Derinlik", value: lD ? lD.toFixed(2) : "—", unit: "mm", description: "Apertür merkezinden optik kanal orbital girişine mesafe" });

  // 7-8 Volume
  const rV = getVol(["sağ orbita", "sag orbita", "sağ orbital hacim"]);
  const lV = getVol(["sol orbita", "sol orbital hacim"]);
  rows.push({ no: 7, name: "Sağ Orbital Hacim", value: rV ? rV.toFixed(2) : "—", unit: "cm³", description: "Frankfort hizalı kemik sınırları orbital kavite hacmi" });
  rows.push({ no: 8, name: "Sol Orbital Hacim", value: lV ? lV.toFixed(2) : "—", unit: "cm³", description: "Frankfort hizalı kemik sınırları orbital kavite hacmi" });

  // 9-10 Orbital Index
  const rOI = rW && rH ? (rH / rW) * 100 : null;
  const lOI = lW && lH ? (lH / lW) * 100 : null;
  rows.push({ no: 9, name: "Sağ Orbital İndeks", value: rOI ? rOI.toFixed(2) : "—", unit: "", description: "(Sağ Yükseklik / Sağ Genişlik) × 100" });
  rows.push({ no: 10, name: "Sol Orbital İndeks", value: lOI ? lOI.toFixed(2) : "—", unit: "", description: "(Sol Yükseklik / Sol Genişlik) × 100" });

  // 11-14 Rim Thickness
  const supT = getMeas(["superior kenar kalınlığı", "superior kenar kalinligi"]);
  const infT = getMeas(["inferior kenar kalınlığı", "inferior kenar kalinligi"]);
  const medT = getMeas(["medial kenar kalınlığı", "medial kenar kalinligi"]);
  const latT = getMeas(["lateral kenar kalınlığı", "lateral kenar kalinligi"]);
  rows.push({ no: 11, name: "Superior Kenar Kalınlığı", value: supT ? supT.toFixed(2) : "—", unit: "mm", description: "Üst orbital kemik rim kalınlığı" });
  rows.push({ no: 12, name: "İnferior Kenar Kalınlığı", value: infT ? infT.toFixed(2) : "—", unit: "mm", description: "Alt orbital kemik rim kalınlığı" });
  rows.push({ no: 13, name: "Medial Kenar Kalınlığı", value: medT ? medT.toFixed(2) : "—", unit: "mm", description: "İç orbital kemik rim kalınlığı" });
  rows.push({ no: 14, name: "Lateral Kenar Kalınlığı", value: latT ? latT.toFixed(2) : "—", unit: "mm", description: "Dış orbital kemik rim kalınlığı" });

  // 15-16 Interorbital & Biorbital
  const ioDist = getMeas(["interorbital mesafe", "interorbital mesafe (d-d)"]);
  const bioDist = getMeas(["biorbital genişlik", "biorbital genislik", "biorbital mesafe"]);
  rows.push({ no: 15, name: "İnterorbital Mesafe (d-d)", value: ioDist ? ioDist.toFixed(2) : "—", unit: "mm", description: "Sağ ve sol dakryon arası anatomik mesafe" });
  rows.push({ no: 16, name: "Biorbital Genişlik (ek-ek)", value: bioDist ? bioDist.toFixed(2) : "—", unit: "mm", description: "Sağ ve sol ektokonşiyon arası maksimum genişlik" });

  // 17-18 Aperture
  const rAp = getCurve(["sağ aperture", "sag aperture", "sağ orbital aperture"]);
  const lAp = getCurve(["sol aperture", "sol orbital aperture"]);
  rows.push({ no: "17a", name: "Sağ Apertür Alanı", value: rAp ? rAp.area.toFixed(2) : "—", unit: "mm²", description: "Sağ orbital giriş yüzey alanı (shoelace)" });
  rows.push({ no: "17b", name: "Sağ Apertür Çevresi", value: rAp ? rAp.perim.toFixed(2) : "—", unit: "mm", description: "Sağ orbital rim kontur çevre uzunluğu" });
  rows.push({ no: "18a", name: "Sol Apertür Alanı", value: lAp ? lAp.area.toFixed(2) : "—", unit: "mm²", description: "Sol orbital giriş yüzey alanı (shoelace)" });
  rows.push({ no: "18b", name: "Sol Apertür Çevresi", value: lAp ? lAp.perim.toFixed(2) : "—", unit: "mm", description: "Sol orbital rim kontur çevre uzunluğu" });

  // 19-25 Asymmetry Indices: |R - L| / ((R + L) / 2) * 100
  const calcAI = (r: number | null, l: number | null): string => {
    if (r === null || l === null || r + l === 0) return "—";
    return ((Math.abs(r - l) / ((r + l) / 2)) * 100).toFixed(2);
  };
  rows.push({ no: 19, name: "Genişlik Asimetri İndeksi", value: calcAI(rW, lW), unit: "%", description: "|Sağ - Sol| / Ort × 100" });
  rows.push({ no: 20, name: "Yükseklik Asimetri İndeksi", value: calcAI(rH, lH), unit: "%", description: "|Sağ - Sol| / Ort × 100" });
  rows.push({ no: 21, name: "Derinlik Asimetri İndeksi", value: calcAI(rD, lD), unit: "%", description: "|Sağ - Sol| / Ort × 100" });
  rows.push({ no: 22, name: "Hacim Asimetri İndeksi", value: calcAI(rV, lV), unit: "%", description: "|Sağ - Sol| / Ort × 100" });
  rows.push({ no: 23, name: "Orbital İndeks Asimetri İndeksi", value: calcAI(rOI, lOI), unit: "%", description: "|Sağ - Sol| / Ort × 100" });
  rows.push({ no: 24, name: "Apertür Alanı Asimetri İndeksi", value: calcAI(rAp ? rAp.area : null, lAp ? lAp.area : null), unit: "%", description: "|Sağ - Sol| / Ort × 100" });
  rows.push({ no: 25, name: "Apertür Çevresi Asimetri İndeksi", value: calcAI(rAp ? rAp.perim : null, lAp ? lAp.perim : null), unit: "%", description: "|Sağ - Sol| / Ort × 100" });

  // 26-37 12 3D Landmarks
  let lmIndex = 26;
  for (const def of LM12_DEFS) {
    const p = lm12[def.key];
    const val = p
      ? `${(p.x * px).toFixed(2)}, ${(p.y * px).toFixed(2)}, ${(p.z * sl).toFixed(2)}`
      : "—";
    rows.push({
      no: lmIndex++,
      name: def.label,
      value: val,
      unit: "mm (x,y,z)",
      description: "3B Kraniyometrik referans koordinatı",
    });
  }

  // 38 Centroid Size
  const cs = computeCentroidSize(lm12, px, sl);
  rows.push({
    no: 38,
    name: "Centroid Size (12 Landmark)",
    value: cs !== null ? cs.toFixed(3) : "—",
    unit: "mm",
    description: "12 noktanın ağırlık merkezine olan mesafelerinin karekök toplamı",
  });

  // 39-43 Statistical / GPA / PCA cohort metrics
  rows.push({ no: 39, name: "Generalized Procrustes Analysis (GPA)", value: "Protokol Hazır", unit: "", description: "Kohort seviyesi 3B landmark şekil hizalama" });
  rows.push({ no: 40, name: "Principal Component 1 (PC1)", value: "Kohort Analizi", unit: "%", description: "Orbital şekil varyansı birinci temel bileşeni" });
  rows.push({ no: 41, name: "Principal Component 2 (PC2)", value: "Kohort Analizi", unit: "%", description: "Orbital şekil varyansı ikinci temel bileşeni" });
  rows.push({ no: 42, name: "Thin-Plate Spline (TPS) Deformasyonu", value: "Kohort Analizi", unit: "", description: "Cinsiyetler arası ortalama şekil deformasyon haritası" });
  rows.push({ no: 43, name: "Cinsiyet Tayini Sınıflandırıcı Skoru", value: "Kohort Modeli", unit: "AUC/Doğruluk", description: "Morfometrik parametrelerden cinsiyet tahmin modeli" });

  return rows;
}

export function exportToExcel(
  vol: VolumeData,
  segments: Segment[],
  measurements: Measurement[],
  curves: CurvePolygon[],
  lm12: CraniometricLandmarks,
  patientId: string
): void {
  const wb = XLSX.utils.book_new();

  // Sheet 1: 43-Parametre Tez Tablosu
  const paramTable = generate43ParametersTable(
    vol,
    segments,
    measurements,
    curves,
    lm12
  );
  const wsParamsData = [
    ["No", "Parametre Adı", "Ölçüm Değeri", "Birim", "Açıklama / Protokol"],
    ...paramTable.map((r) => [r.no, r.name, r.value, r.unit, r.description]),
  ];
  const wsParams = XLSX.utils.aoa_to_sheet(wsParamsData);
  XLSX.utils.book_append_sheet(wb, wsParams, "43_Parametre_Morfometri");

  // Sheet 2: Ham Ölçümler ve Detaylar
  const rawData: (string | number)[][] = [
    ["Kategori", "Etiket / İsim", "Değer", "Birim", "Detay"],
    [
      "Metadata",
      "Hasta Sıra No",
      patientId || "Belirtilmedi",
      "",
      `Voxel: ${vol.w}x${vol.h}x${vol.z}`,
    ],
    ["Metadata", "Pixel Spacing", vol.px.toFixed(6), "mm", ""],
    ["Metadata", "Slice Thickness", vol.sl.toFixed(4), "mm", ""],
  ];

  for (const s of segments) {
    rawData.push([
      "Segment Hacmi",
      s.name,
      segVolumeCm3(s, vol.px, vol.sl).toFixed(4),
      "cm³",
      `${(s.filled.size || s.key.size)} kesit`,
    ]);
  }

  for (const m of measurements) {
    if (m.p2) {
      rawData.push([
        "Lineer Cetvel",
        m.label,
        distMm(m.p1, m.p2, vol.px, vol.sl).toFixed(3),
        "mm",
        `P1(${m.p1.x},${m.p1.y},${m.p1.z}) -> P2(${m.p2.x},${m.p2.y},${m.p2.z})`,
      ]);
    }
  }

  for (const c of curves) {
    const res = curveAreaPerimMm(c.points, vol.px);
    rawData.push([
      "Apertür Alanı",
      c.label,
      res.area.toFixed(3),
      "mm²",
      `Kesit: ${c.z + 1}, ${c.points.length} nokta`,
    ]);
    rawData.push([
      "Apertür Çevresi",
      c.label,
      res.perim.toFixed(3),
      "mm",
      `Kesit: ${c.z + 1}`,
    ]);
  }

  for (const def of LM12_DEFS) {
    const p = lm12[def.key];
    if (p) {
      rawData.push([
        "3B Landmark",
        def.label,
        `${(p.x * vol.px).toFixed(3)} \\ ${(p.y * vol.px).toFixed(3)} \\ ${(p.z * vol.sl).toFixed(3)}`,
        "mm (X\\Y\\Z)",
        `Voksel: (${p.x}, ${p.y}, ${p.z})`,
      ]);
    }
  }

  const wsRaw = XLSX.utils.aoa_to_sheet(rawData);
  XLSX.utils.book_append_sheet(wb, wsRaw, "Ham_Olcumler");

  const fileName = `${patientId || "hasta"}_orbita_morfometri.xlsx`;
  XLSX.writeFile(wb, fileName);
}

export function exportToCSV(
  vol: VolumeData,
  segments: Segment[],
  measurements: Measurement[],
  curves: CurvePolygon[],
  lm12: CraniometricLandmarks,
  patientId: string
): void {
  const paramTable = generate43ParametersTable(
    vol,
    segments,
    measurements,
    curves,
    lm12
  );
  let csv = "No,Parametre,Deger,Birim,Aciklama\n";
  for (const r of paramTable) {
    csv += `"${r.no}","${r.name.replace(/"/g, '""')}","${r.value.replace(/"/g, '""')}","${r.unit}","${r.description.replace(/"/g, '""')}"\n`;
  }

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${patientId || "hasta"}_43_parametre.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function rleEncode(mask: Uint8Array): { first: number; runs: number[] } {
  const runs: number[] = [];
  let cur = mask[0] || 0;
  let count = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === cur) {
      count++;
    } else {
      runs.push(count);
      cur = mask[i];
      count = 1;
    }
  }
  runs.push(count);
  return { first: mask[0] || 0, runs };
}

export function rleDecode(
  rle: { first: number; runs: number[] },
  n: number
): Uint8Array {
  const mask = new Uint8Array(n);
  let val = rle.first;
  let pos = 0;
  for (const len of rle.runs) {
    if (val) {
      mask.fill(1, pos, pos + len);
    }
    pos += len;
    val = 1 - val;
  }
  return mask;
}

export function saveProjectJson(
  vol: VolumeData,
  segments: Segment[],
  measurements: Measurement[],
  curves: CurvePolygon[],
  landmarks: FrankfortLandmarks,
  lm12: CraniometricLandmarks,
  patientId: string
): void {
  const proj = {
    version: 1,
    patientId: patientId || "hasta",
    px: vol.px,
    sl: vol.sl,
    volDims: { w: vol.w, h: vol.h, z: vol.z },
    segments: segments.map((seg) => ({
      name: seg.name,
      color: seg.color,
      key: Array.from(seg.key.entries()).map(([z, m]) => ({
        z,
        rle: rleEncode(m),
      })),
    })),
    measurements: measurements.map((m) => ({
      label: m.label,
      p1: m.p1,
      p2: m.p2,
    })),
    landmarks,
    lm12,
    curves: curves.map((c) => ({
      label: c.label,
      z: c.z,
      points: c.points,
    })),
  };

  const blob = new Blob([JSON.stringify(proj, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${proj.patientId}_proje.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
