const paths: Record<string, string> = {
  parent: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm8 2a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2 20c0-3.3 3.1-6 7-6s7 2.7 7 6H2Zm14.5 0c0-1.6-.5-3-1.4-4.2 1.3-.6 2.9-.8 4.4-.4 1.9.5 3.5 2.3 3.5 4.6h-6.5Z',
  young: 'M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm-8 9c0-3.9 3.6-7 8-7s8 3.1 8 7H4Z',
  phone: 'M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm0 3v13h10V5H7Zm3 15h4v1h-4v-1Z',
  hand: 'M9 11V4a1.5 1.5 0 0 1 3 0v6h1V3a1.5 1.5 0 0 1 3 0v7h1V5a1.5 1.5 0 0 1 3 0v10c0 3.9-3.1 7-7 7h-.5c-2.3 0-4.5-1.1-5.8-3l-3.2-4.5a1.6 1.6 0 0 1 2.5-2l2 2.3V7a1.5 1.5 0 0 1 3 0v4h-1Z',
  check: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z',
  camera: 'M9 3h6l1.5 2H20a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h3.5L9 3Zm3 5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Zm0 2.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z',
  image: 'M4 3h16a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm0 2v10.6l4.5-4.5 3.5 3.5 3-3 5 5V5H4Zm11.5 3a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z',
  shield: 'M12 2 4 5v6c0 5.2 3.4 9.8 8 11 4.6-1.2 8-5.8 8-11V5l-8-3Zm-1.2 13.8L7.5 12.5l1.4-1.4 1.9 1.9 4.3-4.3 1.4 1.4-5.7 5.7Z',
  lock: 'M7 10V7a5 5 0 0 1 10 0v3h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1Zm2 0h6V7a3 3 0 0 0-6 0v3Z',
  edit: 'M3 17.3V21h3.7L17.8 9.9l-3.7-3.7L3 17.3Zm17.7-10.2a1 1 0 0 0 0-1.4l-2.4-2.4a1 1 0 0 0-1.4 0l-1.8 1.8 3.7 3.7 1.9-1.7Z',
  bin: 'M6 7h12l-1 14H7L6 7Zm3-4h6l1 2h4v2H4V5h4l1-2Z',
  refresh: 'M12 5V2L7 6l5 4V7a5 5 0 1 1-4.9 6H5a7 7 0 1 0 7-8Z',
  info: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 15h-2v-6h2v6Zm0-8h-2V7h2v2Z',
  warning: 'M12 2 1 21h22L12 2Zm1 15h-2v-2h2v2Zm0-4h-2V9h2v4Z',
  eye: 'M12 5C6.5 5 2.3 8.6 1 12c1.3 3.4 5.5 7 11 7s9.7-3.6 11-7c-1.3-3.4-5.5-7-11-7Zm0 11.5a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9Zm0-7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z',
  sparkle: 'M12 2l1.8 5.4L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.6L12 2Zm7 12 1 2.8L23 18l-3 1-1 3-1-3-3-1 3-1.2 1-2.8ZM4 14l.8 2.2L7 17l-2.2.8L4 20l-.8-2.2L1 17l2.2-.8L4 14Z',
};

interface Props {
  name: keyof typeof paths | string;
  size?: number;
  className?: string;
  label?: string;
}

export function Icon({ name, size = 22, className = '', label }: Props) {
  const d = paths[name] ?? paths.info;
  return (
    <svg className={`mpmb-icon ${className}`.trim()} width={size} height={size} viewBox="0 0 24 24" aria-hidden={label ? undefined : true} role={label ? 'img' : undefined} focusable="false">
      {label && <title>{label}</title>}
      <path d={d} fill="currentColor" />
    </svg>
  );
}
