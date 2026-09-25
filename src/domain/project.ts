/** Source times are seconds in the original media. Project time starts at trim.start. */
export interface VideoTrim { start: number; end: number }
export interface LocalVideo { name: string; size: number; lastModified: number; url: string }
export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
export function timecode(seconds: number): string {
  const tenths = Math.floor(Math.max(0, seconds) * 10 + 0.00001);
  const hours = Math.floor(tenths / 36000);
  const mins = Math.floor(tenths / 600) % 60;
  const secs = Math.floor(tenths / 10) % 60;
  return `${hours ? `${hours}:` : ''}${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths % 10}`;
}
