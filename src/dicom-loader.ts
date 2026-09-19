import * as dicomParser from "dicom-parser";
import { unzipSync } from "fflate";
import type { VolumeData } from "./types";

interface ParsedSlice {
  instanceNumber: number;
  sliceLocation: number;
  zCoord: number;
  rows: number;
  cols: number;
  pixelSpacing: [number, number];
  sliceThickness: number;
  windowCenter: number;
  windowWidth: number;
  rescaleSlope: number;
  rescaleIntercept: number;
  pixelData: Int16Array;
}

export function parseDicomBuffer(buffer: ArrayBuffer): ParsedSlice | null {
  try {
    const byteArray = new Uint8Array(buffer);
    const dataSet = dicomParser.parseDicom(byteArray);

    const rows = dataSet.uint16("x00280010") || 512;
    const cols = dataSet.uint16("x00280011") || 512;
    const bitsAllocated = dataSet.uint16("x00280100") || 16;
    const pixelRepresentation = dataSet.uint16("x00280103") || 0; // 0=unsigned, 1=signed

    const rescaleSlope = parseFloat(dataSet.string("x00281053") || "1");
    const rescaleIntercept = parseFloat(dataSet.string("x00281052") || "0");
    const windowCenter = parseFloat(dataSet.string("x00281050") || "40");
    const windowWidth = parseFloat(dataSet.string("x00281051") || "400");

    let pixelSpacing: [number, number] = [0.488281, 0.488281];
    const spacingStr = dataSet.string("x00280030");
    if (spacingStr) {
      const parts = spacingStr.split("\\").map((p) => parseFloat(p));
      if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        pixelSpacing = [parts[0], parts[1]];
      }
    }

    const sliceThickness =
      parseFloat(dataSet.string("x00180050") || "1.0") || 1.0;
    const instanceNumber =
      parseInt(dataSet.string("x00200013") || "0", 10) || 0;
    const sliceLocation =
      parseFloat(dataSet.string("x00201041") || "0") || instanceNumber;

    let zCoord = sliceLocation;
    const ippStr = dataSet.string("x00200032");
    if (ippStr) {
      const parts = ippStr.split("\\").map((p) => parseFloat(p));
      if (parts.length >= 3 && !isNaN(parts[2])) {
        zCoord = parts[2];
      }
    }

    const pixelDataElement = dataSet.elements.x7fe00010;
    if (!pixelDataElement) {
      return null;
    }

    const numPixels = rows * cols;
    const huData = new Int16Array(numPixels);
    const offset = pixelDataElement.dataOffset;

    if (bitsAllocated === 16) {
      const isSigned = pixelRepresentation === 1;
      const dataView = new DataView(
        buffer,
        offset,
        Math.min(buffer.byteLength - offset, numPixels * 2)
      );
      for (let i = 0; i < numPixels; i++) {
        if (i * 2 + 1 < dataView.byteLength) {
          const raw = isSigned
            ? dataView.getInt16(i * 2, true)
            : dataView.getUint16(i * 2, true);
          huData[i] = Math.round(raw * rescaleSlope + rescaleIntercept);
        }
      }
    } else if (bitsAllocated === 8) {
      for (let i = 0; i < numPixels; i++) {
        const raw = byteArray[offset + i] || 0;
        huData[i] = Math.round(raw * rescaleSlope + rescaleIntercept);
      }
    }

    return {
      instanceNumber,
      sliceLocation,
      zCoord,
      rows,
      cols,
      pixelSpacing,
      sliceThickness,
      windowCenter: windowCenter || 40,
      windowWidth: windowWidth || 400,
      rescaleSlope,
      rescaleIntercept,
      pixelData: huData,
    };
  } catch (err) {
    console.error("DICOM parse error:", err);
    return null;
  }
}

export function buildVolumeFromDicomSlices(
  slices: ParsedSlice[],
  patientId = "Hasta_01"
): VolumeData {
  // Sort slices spatially
  slices.sort((a, b) => {
    if (Math.abs(a.zCoord - b.zCoord) > 0.001) {
      return a.zCoord - b.zCoord;
    }
    return a.instanceNumber - b.instanceNumber;
  });

  const z = slices.length;
  const h = slices[0].rows;
  const w = slices[0].cols;
  const px = (slices[0].pixelSpacing[0] + slices[0].pixelSpacing[1]) / 2;
  const sl = slices[0].sliceThickness || 1.0;

  let windowWidth = slices[0].windowWidth || 2000;
  let windowCenter = slices[0].windowCenter || 500;
  // Default to Bone window for orbital craniometry if standard soft tissue
  if (windowWidth < 1000) {
    windowWidth = 2000;
    windowCenter = 500;
  }

  const rawHu = new Int16Array(z * h * w);
  const displayData = new Uint8Array(z * h * w);

  let minHu = Infinity;
  let maxHu = -Infinity;

  for (let s = 0; s < z; s++) {
    const sliceHu = slices[s].pixelData;
    const base = s * h * w;
    for (let i = 0; i < h * w; i++) {
      const val = sliceHu[i] ?? -1000;
      rawHu[base + i] = val;
      if (val < minHu) minHu = val;
      if (val > maxHu) maxHu = val;
    }
  }

  // Calculate normalized display data based on window
  applyCTWindow(displayData, rawHu, windowCenter, windowWidth);

  return {
    z,
    h,
    w,
    data: displayData,
    rawHounsfield: rawHu,
    px,
    sl,
    patientId,
    isDicom: true,
    minHu,
    maxHu,
    windowWidth,
    windowCenter,
  };
}

export function applyCTWindow(
  outDisplay: Uint8Array,
  rawHu: Int16Array | Float32Array,
  wc: number,
  ww: number
): void {
  const low = wc - ww / 2;
  const high = wc + ww / 2;
  const range = high - low || 1;

  for (let i = 0; i < rawHu.length; i++) {
    const hu = rawHu[i];
    if (hu <= low) {
      outDisplay[i] = 0;
    } else if (hu >= high) {
      outDisplay[i] = 255;
    } else {
      outDisplay[i] = Math.round(((hu - low) / range) * 255);
    }
  }
}

export async function loadZipArchive(file: File): Promise<ParsedSlice[]> {
  const buffer = await file.arrayBuffer();
  const unzipped = unzipSync(new Uint8Array(buffer));
  const parsedSlices: ParsedSlice[] = [];

  for (const [filename, fileBytes] of Object.entries(unzipped)) {
    if (filename.startsWith("__MACOSX") || filename.endsWith("/")) continue;
    // Check if likely dicom
    if (
      filename.toLowerCase().endsWith(".dcm") ||
      filename.toLowerCase().endsWith(".ima") ||
      !filename.includes(".")
    ) {
      const slice = parseDicomBuffer(fileBytes.buffer);
      if (slice) {
        parsedSlices.push(slice);
      }
    }
  }

  return parsedSlices;
}

export async function loadImagesFolder(
  files: File[],
  px: number,
  sl: number,
  patientId = "Hasta"
): Promise<VolumeData> {
  const sortedFiles = Array.from(files).sort((a, b) => {
    const na = parseInt((a.name.match(/(\d+)/) || [0, 0])[1], 10);
    const nb = parseInt((b.name.match(/(\d+)/) || [0, 0])[1], 10);
    return na - nb;
  });

  const loadImage = (f: File): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = URL.createObjectURL(f);
    });
  };

  const first = await loadImage(sortedFiles[0]);
  const w = first.width;
  const h = first.height;
  const z = sortedFiles.length;

  const off = document.createElement("canvas");
  off.width = w;
  off.height = h;
  const octx = off.getContext("2d")!;
  const data = new Uint8Array(z * h * w);

  octx.drawImage(first, 0, 0);
  let d = octx.getImageData(0, 0, w, h).data;
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    data[i] = d[p];
  }
  URL.revokeObjectURL(first.src);

  for (let k = 1; k < sortedFiles.length; k++) {
    const img = await loadImage(sortedFiles[k]);
    octx.clearRect(0, 0, w, h);
    octx.drawImage(img, 0, 0, w, h);
    d = octx.getImageData(0, 0, w, h).data;
    const base = k * h * w;
    for (let i = 0, p = 0; i < w * h; i++, p += 4) {
      data[base + i] = d[p];
    }
    URL.revokeObjectURL(img.src);
  }

  return {
    z,
    h,
    w,
    data,
    px,
    sl,
    patientId,
    isDicom: false,
    windowWidth: 255,
    windowCenter: 128,
  };
}

export function createDemoOrbitalVolume(): VolumeData {
  const z = 48;
  const h = 180;
  const w = 180;
  const px = 0.8;
  const sl = 1.25;

  const rawHu = new Int16Array(z * h * w);
  const displayData = new Uint8Array(z * h * w);

  // Default to air (-1000 HU)
  rawHu.fill(-1000);

  const cx = w / 2;
  const cy = h / 2;
  const cz = z / 2;

  for (let zz = 0; zz < z; zz++) {
    const dz = (zz - cz) * sl;
    const sliceBase = zz * h * w;

    for (let yy = 0; yy < h; yy++) {
      const dy = (yy - cy) * px;
      const rowBase = sliceBase + yy * w;

      for (let xx = 0; xx < w; xx++) {
        const dx = (xx - cx) * px;
        const rHead = Math.sqrt(dx * dx * 1.0 + dy * dy * 1.3 + dz * dz * 1.2);

        // Soft tissue envelope
        if (rHead <= 65) {
          rawHu[rowBase + xx] = 40; // Soft tissue
        }

        // Cranial bone outer shell
        if (rHead <= 60 && rHead >= 54) {
          rawHu[rowBase + xx] = 950; // Cortical bone
        }

        // Facial skeleton anterior bone
        if (dy > 15 && dy < 48 && Math.abs(dx) < 50 && Math.abs(dz) < 25) {
          rawHu[rowBase + xx] = 750; // Facial bone
        }

        // Right Orbit Cavity (Anterior right)
        // Center around dx = -24, dy = 32, dz = 2
        const rOrbitR = Math.sqrt(
          (dx - (-24)) ** 2 / 18 ** 2 +
            (dy - 32) ** 2 / 24 ** 2 +
            (dz - 2) ** 2 / 16 ** 2
        );
        if (rOrbitR < 1.0) {
          // Inside orbital cone
          rawHu[rowBase + xx] = -50; // Retrobulbar fat
          // Orbital bone rim & wall
          if (rOrbitR > 0.88) {
            rawHu[rowBase + xx] = 850; // Orbital wall
          }
        }

        // Left Orbit Cavity (Anterior left)
        // Center around dx = 24, dy = 32, dz = 2
        const rOrbitL = Math.sqrt(
          (dx - 24) ** 2 / 18 ** 2 +
            (dy - 32) ** 2 / 24 ** 2 +
            (dz - 2) ** 2 / 16 ** 2
        );
        if (rOrbitL < 1.0) {
          rawHu[rowBase + xx] = -50;
          if (rOrbitL > 0.88) {
            rawHu[rowBase + xx] = 850;
          }
        }

        // External acoustic meatus (Porion reference regions lateral/posterior)
        if (Math.abs(dx) > 46 && Math.abs(dx) < 52 && Math.abs(dy + 15) < 8 && Math.abs(dz + 8) < 6) {
          rawHu[rowBase + xx] = 600;
        }
      }
    }
  }

  applyCTWindow(displayData, rawHu, 500, 2000);

  return {
    z,
    h,
    w,
    data: displayData,
    rawHounsfield: rawHu,
    px,
    sl,
    patientId: "BT_Demo_Olgu",
    isDicom: true,
    minHu: -1000,
    maxHu: 950,
    windowWidth: 2000,
    windowCenter: 500,
  };
}
