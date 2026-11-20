export interface WalkPose {
  x: number;
  y: number;
  z: number;
  angle: number;
  pitch: number;
}
export function walkPose(value: unknown): WalkPose | undefined {
  if (!value || typeof value !== "object") return;
  const { x, y, z, angle, pitch } = value as WalkPose;
  if (
    ![x, y, z, angle, pitch].every(Number.isFinite) ||
    Math.abs(x) > 4050 ||
    z < -3720 ||
    z > 4630 ||
    y < -5 ||
    y > 260 ||
    Math.abs(pitch) > 1.15
  )
    return;
  return {
    x,
    y,
    z,
    angle: Math.atan2(Math.sin(angle), Math.cos(angle)),
    pitch,
  };
}
