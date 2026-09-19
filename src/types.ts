export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface Point2D {
  x: number;
  y: number;
}

export interface VolumeData {
  z: number;
  h: number;
  w: number;
  data: Uint8Array; // 8-bit normalized CT display data
  rawHounsfield?: Int16Array | Float32Array; // Original HU if DICOM
  px: number; // Pixel spacing in mm
  sl: number; // Slice thickness in mm
  patientId?: string;
  isDicom?: boolean;
  minHu?: number;
  maxHu?: number;
  windowWidth: number;
  windowCenter: number;
}

export interface Segment {
  id: number;
  name: string;
  color: string;
  key: Map<number, Uint8Array>; // Keyframe slice index -> binary mask
  filled: Map<number, Uint8Array>; // Interpolated slice index -> binary mask
  visible: boolean;
}

export interface Measurement {
  id: number;
  label: string;
  p1: Point3D;
  p2: Point3D | null;
}

export interface CurvePolygon {
  id: number;
  label: string;
  z: number;
  points: Point2D[];
}

export interface FrankfortLandmarks {
  PoR: Point3D | null; // Right Porion
  PoL: Point3D | null; // Left Porion
  OrL: Point3D | null; // Left Orbitale
}

export interface CraniometricLandmarkDef {
  key: string;
  label: string;
  anatomicalName: string;
  side: "R" | "L" | "B";
}

export type CraniometricLandmarks = Record<string, Point3D | null>;

export interface DerivedParameter {
  label: string;
  value: number;
  unit: string;
  category: "index" | "asymmetry" | "geometry";
}

export interface CTWindowPreset {
  name: string;
  windowWidth: number;
  windowCenter: number;
}
