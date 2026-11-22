/**
 * Equipment faults (22 November 2026), as the portal shows them: the same
 * lists as firebase/functions/src/issues.ts, which checks them.
 */

export type DeviceKind = 'headset' | 'laptop' | 'ipad' | 'other';
export const DEVICE_KINDS: [DeviceKind, string][] = [
  ['headset', 'EEG headset'],
  ['laptop', 'Laptop'],
  ['ipad', 'iPad/tablet'],
  ['other', 'Other equipment'],
];
export const FAULTS: { key: string; label: string; kinds: DeviceKind[] }[] = [
  { key: 'no-signal', label: 'No EEG signal (all grey)', kinds: ['headset'] },
  { key: 'left-grey', label: 'Left side grey', kinds: ['headset'] },
  { key: 'right-grey', label: 'Right side grey', kinds: ['headset'] },
  { key: 'channels', label: 'Particular channels', kinds: ['headset'] },
  { key: 'poor-signal', label: 'Poor or patchy signal', kinds: ['headset'] },
  { key: 'not-registering', label: 'Green but not registering', kinds: ['headset'] },
  { key: 'motion-only', label: 'Motion works, EEG doesn’t', kinds: ['headset'] },
  { key: 'contact', label: 'Contact quality', kinds: ['headset'] },
  { key: 'bluetooth', label: 'Bluetooth: won’t connect', kinds: ['headset', 'laptop', 'ipad', 'other'] },
  { key: 'disconnects', label: 'Disconnects mid-task', kinds: ['headset', 'laptop', 'ipad', 'other'] },
  { key: 'battery', label: 'Battery or charging', kinds: ['headset', 'laptop', 'ipad', 'other'] },
  { key: 'wont-start', label: 'Won’t turn on', kinds: ['laptop', 'ipad', 'other'] },
  { key: 'crash', label: 'App or task crashed', kinds: ['laptop', 'ipad'] },
  { key: 'screen', label: 'Screen, touch or keyboard', kinds: ['laptop', 'ipad'] },
  { key: 'network', label: 'Wi-Fi or network', kinds: ['laptop', 'ipad'] },
  { key: 'damage', label: 'Physical damage', kinds: ['headset', 'laptop', 'ipad', 'other'] },
  { key: 'other', label: 'Something else', kinds: ['headset', 'laptop', 'ipad', 'other'] },
];
/** The 14 sensors of the EPOC headsets, left to right. */
export const CHANNELS = ['AF3', 'F7', 'F3', 'FC5', 'T7', 'P7', 'O1', 'O2', 'P8', 'T8', 'FC6', 'F4', 'F8', 'AF4'];
export const SEVERITIES: [string, string, string][] = [
  ['low', 'Low', 'works, with a bit of patience'],
  ['medium', 'Medium', 'unreliable'],
  ['high', 'High', 'not usable'],
];
export const DEVICE_STATUSES: [string, string][] = [
  ['ok', 'In use'],
  ['care', 'Use with care'],
  ['out', 'Out of service'],
  ['repair', 'Away for repair'],
  ['retired', 'Retired'],
];

export const kindLabel = (k: string) => DEVICE_KINDS.find(([x]) => x === k)?.[1] ?? k;
export const statusLabel = (s: string) => DEVICE_STATUSES.find(([x]) => x === s)?.[1] ?? s;
export const severityLabel = (s: string | null) => (s ? (SEVERITIES.find(([x]) => x === s)?.[1] ?? s) : '');
/** "Bluetooth: won’t connect; O1, P8" — the channels in place of "Particular channels". */
export const faultText = (faults: string[], channels: string[]) => faults.map((f) => (f === 'channels' && channels.length ? channels.join(', ') : (FAULTS.find((x) => x.key === f)?.label ?? f))).join('; ');
/** A device code as typed: capitals, spaces to hyphens. */
export const deviceCode = (v: string) => v.trim().toUpperCase().replace(/\s+/g, '-').slice(0, 40);
export const DEVICE_CODE = /^[A-Z0-9][A-Z0-9-]{1,39}$/;
/** Which kind of device a problem type is about, if it is one. */
export const kindsFor = (type: string): DeviceKind[] => (type === 'eeg' ? ['headset'] : type === 'equipment' ? ['laptop', 'ipad', 'headset', 'other'] : type === 'software' ? ['laptop', 'ipad'] : []);

export interface OpenFault {
  id: string;
  deviceAt: string;
  authorName: string;
  faults: string[];
  channels: string[];
  severity: string | null;
  note: string;
  comments: number;
  importedFrom: string;
}
export interface DeviceRow {
  code: string;
  kind: DeviceKind;
  batch: string;
  status: string;
  notes: string;
  history: { at: string; byName: string; changes: Record<string, { from: unknown; to: unknown }>; note?: string }[];
  open: string[];
  all: number;
  worst: string | null;
  faults: string[];
  channels: string[];
  lastReported: string | null;
  openEntries: OpenFault[];
}
export interface EquipmentList {
  devices: DeviceRow[];
  listImported: boolean;
}
