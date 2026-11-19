import d from './depth.module.css';

/**
 * The Market's own small signs, drawn in the kit's stroke: a quick buy's lightning, holders, volume, a fact
 * against a coin, the filters' sliders, a bot's turn. The kit's `Icon` draws the rest.
 */
const Svg = ({ children, fill = false, size = 's' }: { children: React.ReactNode; fill?: boolean; size?: 's' | 'm' }) => (
  <svg className={size === 's' ? d.glyph : d.glyphM} data-fill={fill ? '' : undefined} viewBox="0 0 24 24" aria-hidden="true">
    {children}
  </svg>
);

export const Zap = () => (
  <Svg fill>
    <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
  </Svg>
);

export const People = () => (
  <Svg>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.8.7 3 2.5 3.5 5.2" />
  </Svg>
);

export const Bars = () => (
  <Svg>
    <path d="M6 20v-6M12 20V8M18 20v-8" />
  </Svg>
);

export const Warn = () => (
  <Svg>
    <path d="M12 4 2.8 19.5h18.4zM12 10v4.2M12 17h.01" />
  </Svg>
);

export const Shield = () => (
  <Svg>
    <path d="M12 3.5 19 6v5.5c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6zM9 12l2 2 4-4" />
  </Svg>
);

export const Sliders = () => (
  <Svg>
    <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" />
    <circle cx="16" cy="6" r="2" />
    <circle cx="10" cy="12" r="2" />
    <circle cx="18" cy="18" r="2" />
  </Svg>
);

export const Turn = () => (
  <Svg size="m">
    <path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4" />
  </Svg>
);

export const Spark = () => (
  <Svg>
    <path d="M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7-4.7-1.8 4.7-1.8z" />
  </Svg>
);
