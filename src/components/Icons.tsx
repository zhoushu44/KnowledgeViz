import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

function S({ size = 16, children, ...rest }: P & { children: React.ReactNode }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      stroke="currentColor"
      fill="none"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconCap = (p: P) => (
  <S {...p}>
    <path d="M22 10L12 5 2 10l10 5 10-5z" />
    <path d="M6 12v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5" />
  </S>
);

export const IconBag = (p: P) => (
  <S {...p}>
    <rect x="3" y="7" width="18" height="13" rx="2" />
    <path d="M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2M3 12h18" />
  </S>
);

export const IconBook = (p: P) => (
  <S {...p}>
    <path d="M4 5.5A2.5 2.5 0 016.5 3H20v15H6.5A2.5 2.5 0 004 20.5z" />
    <path d="M4 20.5A2.5 2.5 0 016.5 18H20v3H6.5A2.5 2.5 0 014 20.5z" />
  </S>
);

export const IconUpload = (p: P) => (
  <S {...p}>
    <path d="M12 16V4m0 0L7 9m5-5l5 5" />
    <path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
  </S>
);

export const IconDownload = (p: P) => (
  <S {...p}>
    <path d="M12 4v12m0 0l-5-5m5 5l5-5" />
    <path d="M4 18v1a2 2 0 002 2h12a2 2 0 002-2v-1" />
  </S>
);

export const IconPlus = (p: P) => (
  <S {...p}>
    <path d="M12 5v14M5 12h14" />
  </S>
);

export const IconMinus = (p: P) => (
  <S {...p}>
    <path d="M5 12h14" />
  </S>
);

export const IconClose = (p: P) => (
  <S {...p}>
    <path d="M18 6L6 18M6 6l12 12" />
  </S>
);

export const IconSearch = (p: P) => (
  <S {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </S>
);

export const IconChevronRight = (p: P) => (
  <S {...p}>
    <path d="M9 6l6 6-6 6" />
  </S>
);

export const IconChevronDown = (p: P) => (
  <S {...p}>
    <path d="M6 9l6 6 6-6" />
  </S>
);

export const IconChevronLeft = (p: P) => (
  <S {...p}>
    <path d="M15 6l-6 6 6 6" />
  </S>
);

export const IconMindmap = (p: P) => (
  <S {...p}>
    <rect x="9" y="9" width="6" height="6" rx="1.5" />
    <path d="M12 9V4M12 15v5M9 12H4M15 12h5" />
  </S>
);

export const IconGrid = (p: P) => (
  <S {...p}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </S>
);

export const IconGraph = (p: P) => (
  <S {...p}>
    <circle cx="6" cy="7" r="2.4" />
    <circle cx="18" cy="9" r="2.4" />
    <circle cx="11" cy="18" r="2.4" />
    <path d="M8 8.4l7.6 1.2M7.2 9.2l2.8 6.6M16.6 11l-4 4.8" />
  </S>
);

export const IconRoute = (p: P) => (
  <S {...p}>
    <circle cx="5" cy="6" r="2.2" />
    <circle cx="19" cy="18" r="2.2" />
    <path d="M7.2 6H13a3.5 3.5 0 010 7h-3a3.5 3.5 0 000 7h6.8" />
  </S>
);

export const IconRefresh = (p: P) => (
  <S {...p}>
    <path d="M20 11a8 8 0 10-2.3 5.6" />
    <path d="M20 5v6h-6" />
  </S>
);

export const IconSettings = (p: P) => (
  <S {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.5 12a7.5 7.5 0 00-.1-1.1l2-1.5-2-3.4-2.3 1a7.6 7.6 0 00-1.9-1.1L15 3h-6l-.2 2.4c-.7.3-1.3.7-1.9 1.1l-2.3-1-2 3.4 2 1.5a7.5 7.5 0 000 2.2l-2 1.5 2 3.4 2.3-1c.6.4 1.2.8 1.9 1.1L9 21h6l.2-2.4c.7-.3 1.3-.7 1.9-1.1l2.3 1 2-3.4-2-1.5c.1-.3.1-.7.1-1.1z" />
  </S>
);

export const IconTrash = (p: P) => (
  <S {...p}>
    <path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2" />
    <path d="M6 7l1 13a1 1 0 001 1h8a1 1 0 001-1l1-13" />
    <path d="M10 11v6M14 11v6" />
  </S>
);

export const IconEdit = (p: P) => (
  <S {...p}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 013 3L8 18l-4 1 1-4z" />
  </S>
);

export const IconSparkle = (p: P) => (
  <S {...p}>
    <path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z" />
    <path d="M18.5 15.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" />
  </S>
);

export const IconFilter = (p: P) => (
  <S {...p}>
    <path d="M3 5h18l-7 8v6l-4 2v-8z" />
  </S>
);

export const IconExpand = (p: P) => (
  <S {...p}>
    <path d="M8 3H5a2 2 0 00-2 2v3M16 3h3a2 2 0 012 2v3M8 21H5a2 2 0 01-2-2v-3M16 21h3a2 2 0 002-2v-3" />
  </S>
);

export const IconZoomIn = (p: P) => (
  <S {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M11 8v6M8 11h6M20 20l-3.5-3.5" />
  </S>
);

export const IconZoomOut = (p: P) => (
  <S {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M8 11h6M20 20l-3.5-3.5" />
  </S>
);

export const IconClock = (p: P) => (
  <S {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </S>
);

export const IconCalendar = (p: P) => (
  <S {...p}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </S>
);

export const IconLink = (p: P) => (
  <S {...p}>
    <path d="M10 13a5 5 0 007 0l2-2a5 5 0 00-7-7l-1 1" />
    <path d="M14 11a5 5 0 00-7 0l-2 2a5 5 0 007 7l1-1" />
  </S>
);

export const IconBulb = (p: P) => (
  <S {...p}>
    <path d="M9 18h6M10 21h4" />
    <path d="M12 3a6 6 0 00-3.5 10.9V16h7v-2.1A6 6 0 0012 3z" />
  </S>
);

export const IconChart = (p: P) => (
  <S {...p}>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </S>
);

export const IconFile = (p: P) => (
  <S {...p}>
    <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" />
    <path d="M14 3v5h5" />
  </S>
);

export const IconTag = (p: P) => (
  <S {...p}>
    <path d="M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0l-8-8V4h8.6l8.4 8.4a2 2 0 010 2.8z" />
    <circle cx="7.5" cy="7.5" r="1.4" />
  </S>
);

export const IconMap = (p: P) => (
  <S {...p}>
    <path d="M9 4L3 7v13l6-3 6 3 6-3V4l-6 3z" />
    <path d="M9 4v13M15 7v13" />
  </S>
);

export const IconFolder = (p: P) => (
  <S {...p}>
    <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
  </S>
);

export const IconArrowRight = (p: P) => (
  <S {...p}>
    <path d="M4 12h16M14 6l6 6-6 6" />
  </S>
);

export const IconCheck = (p: P) => (
  <S {...p}>
    <path d="M4 12.5l5 5L20 6.5" />
  </S>
);

export const ICON_BY_NAME: Record<string, (p: P) => JSX.Element> = {
  cap: IconCap,
  bag: IconBag,
  book: IconBook,
};

export const IconSend = (p: P) => (
  <S {...p}>
    <path d="M21 3L10.5 13.5M21 3l-6.8 18-3.7-7.5L3 9.8z" />
  </S>
);

export const IconUndo = (p: P) => (
  <S {...p}>
    <path d="M9 7H5v4" />
    <path d="M5.5 11a7.5 7.5 0 1114.4 3.5" />
  </S>
);

export const IconAlert = (p: P) => (
  <S {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5.5M12 16.4v.2" />
  </S>
);
