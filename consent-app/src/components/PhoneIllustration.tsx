import type { WalkthroughStep } from '../config/walkthroughs';

type Kind = WalkthroughStep['illustration'];

const TEAL = '#006b73';
const DEEP = '#003f46';
const YELLOW = '#ffdc70';
const MIST = '#d9eef4';
const LINE = '#c8ddda';
const INK = '#113b3f';

function Row({ y, label, highlight = false, icon }: { y: number; label: string; highlight?: boolean; icon?: string }) {
  return (
    <g>
      {highlight && <rect x="14" y={y - 11} width="92" height="22" fill={YELLOW} />}
      {icon && <rect x="19" y={y - 6} width="12" height="12" rx="3" fill={icon} />}
      <text x={icon ? 36 : 19} y={y + 4} fontSize="7.5" fontFamily="Atkinson Hyperlegible, Arial, sans-serif" fontWeight={highlight ? 700 : 400} fill={INK}>
        {label}
      </text>
      <path d={`M98 ${y - 3} l3 3 -3 3`} stroke={highlight ? INK : LINE} strokeWidth="1.2" fill="none" />
    </g>
  );
}

function Bars({ y }: { y: number }) {
  const heights = [14, 22, 9, 18, 26, 12, 20];
  return (
    <g>
      {heights.map((h, i) => (
        <rect key={i} x={20 + i * 12} y={y + 30 - h} width="8" height={h} fill={i === 4 ? TEAL : MIST} />
      ))}
    </g>
  );
}

function Screen({ kind }: { kind: Kind }) {
  switch (kind) {
    case 'settings':
      return (
        <g>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
            const x = 20 + (i % 4) * 22;
            const y = 40 + Math.floor(i / 4) * 24;
            const isGear = i === 5;
            return (
              <g key={i}>
                {isGear && <rect x={x - 4} y={y - 4} width="24" height="24" fill={YELLOW} />}
                <rect x={x} y={y} width="16" height="16" rx="4" fill={isGear ? '#8e8e93' : [TEAL, DEEP, '#159fe1', '#bb1e50', MIST, '#8e8e93', TEAL, DEEP][i]} />
                {isGear && <circle cx={x + 8} cy={y + 8} r="3.5" fill="#fff" />}
                {isGear && <circle cx={x + 8} cy={y + 8} r="1.6" fill="#8e8e93" />}
              </g>
            );
          })}
          <text x="60" y="110" textAnchor="middle" fontSize="7" fontFamily="Atkinson Hyperlegible, Arial, sans-serif" fill={INK}>
            Settings
          </text>
        </g>
      );
    case 'screen-time-row':
      return (
        <g>
          <text x="19" y="38" fontSize="9" fontWeight="700" fontFamily="Fraunces, Georgia, serif" fill={INK}>
            Settings
          </text>
          <Row y={58} label="Notifications" icon="#bb1e50" />
          <Row y={82} label="Sounds" icon="#159fe1" />
          <Row y={106} label="Focus" icon={DEEP} />
          <Row y={130} label="Screen Time" icon="#7b61ff" highlight />
          <Row y={154} label="General" icon="#8e8e93" />
        </g>
      );
    case 'wellbeing-row':
      return (
        <g>
          <rect x="16" y="30" width="88" height="14" rx="7" fill={MIST} />
          <text x="24" y="40" fontSize="7" fontFamily="Atkinson Hyperlegible, Arial, sans-serif" fill="#5a7a7d">
            Search settings
          </text>
          <Row y={64} label="Display" icon="#159fe1" />
          <Row y={88} label="Sound" icon="#bb1e50" />
          <Row y={112} label="Digital Wellbeing" icon="#2fa36b" highlight />
          <Row y={136} label="Privacy" icon={DEEP} />
          <Row y={160} label="Location" icon="#8e8e93" />
        </g>
      );
    case 'see-all-activity':
      return (
        <g>
          <text x="19" y="36" fontSize="9" fontWeight="700" fontFamily="Fraunces, Georgia, serif" fill={INK}>
            Screen Time
          </text>
          <text x="19" y="50" fontSize="7" fontFamily="Atkinson Hyperlegible, Arial, sans-serif" fill="#5a7a7d">
            Daily average: 3h 12m
          </text>
          <Bars y={56} />
          <Row y={112} label="See All App & Website Activity" highlight />
          <Row y={140} label="Downtime" icon="#7b61ff" />
        </g>
      );
    case 'dashboard':
      return (
        <g>
          <circle cx="60" cy="58" r="20" fill="none" stroke={MIST} strokeWidth="7" />
          <path d="M60 38 a20 20 0 1 1 -17.3 30" fill="none" stroke={TEAL} strokeWidth="7" />
          <text x="60" y="61" textAnchor="middle" fontSize="8" fontWeight="700" fontFamily="Atkinson Hyperlegible, Arial, sans-serif" fill={INK}>
            3h 12m
          </text>
          <rect x="14" y="92" width="92" height="22" fill={YELLOW} />
          <Row y={103} label="Messages  48m" icon="#2fa36b" />
          <Row y={127} label="Video  41m" icon="#bb1e50" />
          <Row y={151} label="Games  30m" icon="#159fe1" />
        </g>
      );
    case 'week-view':
      return (
        <g>
          <rect x="18" y="32" width="84" height="16" rx="8" fill={MIST} />
          <rect x="60" y="34" width="40" height="12" rx="6" fill={YELLOW} />
          <text x="39" y="43" textAnchor="middle" fontSize="7" fontFamily="Atkinson Hyperlegible, Arial, sans-serif" fill={INK}>
            Day
          </text>
          <text x="80" y="43" textAnchor="middle" fontSize="7" fontWeight="700" fontFamily="Atkinson Hyperlegible, Arial, sans-serif" fill={INK}>
            Week
          </text>
          <Bars y={62} />
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
            <text key={i} x={24 + i * 12} y="102" textAnchor="middle" fontSize="6" fontFamily="Atkinson Hyperlegible, Arial, sans-serif" fill="#5a7a7d">
              {d}
            </text>
          ))}
          <Row y={126} label="Social  4h 05m" icon="#159fe1" />
          <Row y={150} label="Games  2h 40m" icon="#bb1e50" />
        </g>
      );
    case 'scroll':
      return (
        <g>
          <Row y={44} label="Social  4h 05m" icon="#159fe1" />
          <Row y={68} label="Games  2h 40m" icon="#bb1e50" />
          <Row y={92} label="Video  1h 55m" icon="#2fa36b" />
          <Row y={116} label="Music  1h 10m" icon="#7b61ff" />
          <path d="M60 134 v26 m-8 -9 l8 9 8 -9" stroke={TEAL} strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      );
    case 'screenshot':
      return (
        <g>
          <rect x="14" y="30" width="92" height="140" fill={MIST} />
          <text x="60" y="95" textAnchor="middle" fontSize="7" fontFamily="Atkinson Hyperlegible, Arial, sans-serif" fill={INK}>
            Press both
          </text>
          <text x="60" y="106" textAnchor="middle" fontSize="7" fontFamily="Atkinson Hyperlegible, Arial, sans-serif" fill={INK}>
            buttons together
          </text>
        </g>
      );
  }
}

/**
 * Simple, schematic phone screens. Decorative: the written instruction
 * carries the meaning, so the SVG is hidden from assistive technology.
 */
export function PhoneIllustration({ kind }: { kind: Kind }) {
  const screenshot = kind === 'screenshot';
  return (
    <svg className="mpmb-phone" viewBox="0 0 120 200" width="120" height="200" aria-hidden="true" focusable="false">
      <rect x="8" y="4" width="104" height="192" rx="16" fill={DEEP} />
      <rect x="14" y="14" width="92" height="172" rx="9" fill="#fff" />
      <rect x="44" y="8" width="32" height="4" rx="2" fill="#0b2b2f" />
      {/* side buttons */}
      <rect x="4" y="60" width="4" height="18" rx="1.5" fill={screenshot ? YELLOW : '#0b2b2f'} />
      <rect x="112" y="52" width="4" height="26" rx="1.5" fill={screenshot ? YELLOW : '#0b2b2f'} />
      {screenshot && (
        <g stroke={TEAL} strokeWidth="2.5" fill="none" strokeLinecap="round">
          <path d="M-2 69 h-6" transform="translate(6 0)" />
          <path d="M116 65 h8" />
        </g>
      )}
      <Screen kind={kind} />
    </svg>
  );
}
