interface IconProps {
  className?: string;
}

export function ChevronIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m6.5 9 5.5 5.5L17.5 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SettingsIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 8.25A3.75 3.75 0 1 0 12 15.75 3.75 3.75 0 0 0 12 8.25Z" stroke="currentColor" strokeWidth="1.8" />
      <path d="M19.1 13.8a7.3 7.3 0 0 0 .05-3.55l1.55-1.2-1.8-3.1-1.82.73a7.35 7.35 0 0 0-3.08-1.77L13.73 3h-3.58l-.28 1.92a7.34 7.34 0 0 0-3.08 1.77l-1.8-.73-1.8 3.1 1.53 1.2a7.3 7.3 0 0 0 0 3.55l-1.54 1.2 1.8 3.1 1.81-.73a7.35 7.35 0 0 0 3.08 1.77l.28 1.92h3.58l.27-1.92a7.35 7.35 0 0 0 3.08-1.77l1.81.73 1.8-3.1-1.58-1.21Z" stroke="currentColor" strokeWidth="1.55" strokeLinejoin="round" />
    </svg>
  );
}

export function SearchIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="10.8" cy="10.8" r="6.3" stroke="currentColor" strokeWidth="2" />
      <path d="m15.6 15.6 4.1 4.1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function CloseIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m6.5 6.5 11 11m0-11-11 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function RefreshIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M19 8.5A8 8 0 1 0 20 14" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M19 4.5v4h-4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
