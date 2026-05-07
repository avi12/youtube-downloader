/* global React, ReactDOM */
const { useState, useEffect, useRef, useCallback } = React;

// ============ ICONS ============
const Icon = {
  Download: ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  ),
  Check: ({ size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="m4 12 5 5L20 6" />
    </svg>
  ),
  X: ({ size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  ),
  Chevron: ({ size = 18, dir = "down" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: dir === "up" ? "rotate(180deg)" : "" }}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  ),
  Share: ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <path d="m16 6-4-4-4 4" />
      <path d="M12 2v13" />
    </svg>
  ),
  Save: ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  ),
  More: ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  ),
  Sparkle: ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" />
    </svg>
  ),
  Like: ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 22V11M2 13v7a2 2 0 0 0 2 2h13.4a2 2 0 0 0 2-1.7l1.4-9a2 2 0 0 0-2-2.3H15V4a2 2 0 0 0-2-2l-3 6v14" />
    </svg>
  ),
  Dislike: ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 2v11M22 11V4a2 2 0 0 0-2-2H6.6a2 2 0 0 0-2 1.7L3.2 13a2 2 0 0 0 2 2.3H9v3a2 2 0 0 0 2 2l3-6V2" />
    </svg>
  ),
  Cog: ({ size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  ),
  AlertCircle: ({ size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4M12 16h.01" />
    </svg>
  ),
  Wifi: ({ size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12.55a11 11 0 0 1 14 0" />
      <path d="M1.42 9a16 16 0 0 1 21.16 0" />
      <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
      <line x1="12" y1="20" x2="12.01" y2="20" />
    </svg>
  ),
  WifiOff: ({ size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="1" y1="1" x2="23" y2="23" />
      <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
      <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
      <path d="M10.71 5.05A16 16 0 0 1 22.58 9" />
      <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
      <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
      <line x1="12" y1="20" x2="12.01" y2="20" />
    </svg>
  ),
  Pause: ({ size = 22 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <rect x="7" y="6" width="3.5" height="12" rx="1" />
      <rect x="13.5" y="6" width="3.5" height="12" rx="1" />
    </svg>
  ),
};

// ============ TWEAKS ============
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "dark",
  "demoState": "idle",
  "showVideoBg": true
}/*EDITMODE-END*/;

// ============ DOWNLOAD POPOVER ============
const QUALITY_OPTIONS = {
  "video+audio": ["2160p 60fps (4K)", "1440p 60fps", "1080p 60fps", "1080p", "720p", "480p", "360p"],
  "video": ["2160p 60fps (4K)", "1440p 60fps", "1080p 60fps", "1080p", "720p", "480p", "360p"],
  "audio": ["High (256 kbps)", "Medium (128 kbps)", "Low (64 kbps)"],
};

const TYPE_LABELS = {
  "video+audio": "Video + Audio",
  "video": "Video only",
  "audio": "Audio only",
};

const VALID_EXTENSIONS = {
  "video+audio": ["mp4", "webm", "mkv"],
  "video": ["mp4", "webm", "mkv"],
  "audio": ["mp3", "m4a", "opus", "wav"],
};

const VIDEO_TITLE = "Building a self-hosted home cloud — full walkthrough";

function Dropdown({ label, value, options, onChange, theme }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  return (
    <div className="dl-field" ref={ref}>
      <label className="dl-label">{label}</label>
      <button type="button" className={`dl-select ${open ? "open" : ""}`} onClick={() => setOpen(o => !o)}>
        <span>{value}</span>
        <Icon.Chevron size={18} dir={open ? "up" : "down"} />
      </button>
      {open && (
        <div className="dl-menu" role="listbox">
          {options.map(opt => (
            <button
              key={opt}
              type="button"
              className={`dl-menu-item ${opt === value ? "selected" : ""}`}
              onClick={() => { onChange(opt); setOpen(false); }}
              role="option"
            >
              <span className="dl-menu-check">{opt === value && <Icon.Check size={16} />}</span>
              <span>{opt}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FilenameField({ name, ext, type, onName, onExt }) {
  const valid = VALID_EXTENSIONS[type].includes(ext.toLowerCase());
  return (
    <div className="dl-field">
      <label className="dl-label">Filename</label>
      <div className={`dl-filename ${!valid ? "invalid" : ""}`}>
        <input
          className="dl-filename-input"
          value={name}
          onChange={e => onName(e.target.value)}
          spellCheck={false}
        />
        <span className="dl-filename-dot">.</span>
        <input
          className="dl-filename-ext"
          value={ext}
          onChange={e => onExt(e.target.value.replace(/[^a-z0-9]/gi, "").toLowerCase())}
          spellCheck={false}
          maxLength={5}
        />
      </div>
      {!valid && (
        <div className="dl-error">
          <Icon.AlertCircle size={14} />
          <span>Unsupported extension. Try: {VALID_EXTENSIONS[type].join(", ")}</span>
        </div>
      )}
    </div>
  );
}

function DownloadPopover({ open, onClose, state, progress, onStart, onCancel, onResume, settings, setSettings, anchorRef, lastUsedSettings }) {
  const popRef = useRef(null);
  const [rect, setRect] = useState(null);

  // Recompute position synchronously when open flips true
  React.useLayoutEffect(() => {
    if (open && anchorRef && anchorRef.current) {
      setRect(anchorRef.current.getBoundingClientRect());
    }
  }, [open, anchorRef]);

  // Reposition on scroll/resize while open
  useEffect(() => {
    if (!open) return;
    const reposition = () => {
      if (anchorRef && anchorRef.current) {
        setRect(anchorRef.current.getBoundingClientRect());
      }
    };
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, anchorRef]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    const onDoc = (e) => {
      if (popRef.current && !popRef.current.contains(e.target) && !e.target.closest('[data-download-trigger]')) {
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDoc);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [open, onClose]);

  if (!open) return null;
  const anchorRect = rect;

  const { type, quality, filename, ext } = settings;
  const validExt = VALID_EXTENSIONS[type].includes(ext.toLowerCase());
  const downloading = state === "downloading";
  const done = state === "done";
  const error = state === "error";
  const interrupted = state === "interrupted";
  const resuming = state === "resuming";

  // Detect whether current settings differ from what was last downloaded
  const settingsChanged = lastUsedSettings && (
    lastUsedSettings.type !== type ||
    lastUsedSettings.quality !== quality ||
    lastUsedSettings.filename !== filename ||
    lastUsedSettings.ext !== ext
  );

  // Position relative to anchor (Download button)
  const style = anchorRect ? {
    top: anchorRect.bottom + 12,
    left: Math.max(16, anchorRect.left - 40),
  } : {};

  return (
    <div className="dl-popover" ref={popRef} style={style} role="dialog" aria-label="Download options">
      <div className="dl-pop-header">
        <h3>Download options</h3>
        <button className="dl-icon-btn" onClick={onClose} aria-label="Close"><Icon.X size={20} /></button>
      </div>

      <div className="dl-pop-body">
        <Dropdown
          label="Type"
          value={TYPE_LABELS[type]}
          options={Object.values(TYPE_LABELS)}
          onChange={(label) => {
            const k = Object.keys(TYPE_LABELS).find(key => TYPE_LABELS[key] === label);
            setSettings(s => ({
              ...s,
              type: k,
              quality: QUALITY_OPTIONS[k][0],
              ext: VALID_EXTENSIONS[k][0],
            }));
          }}
        />

        <Dropdown
          label="Quality"
          value={quality}
          options={QUALITY_OPTIONS[type]}
          onChange={(v) => setSettings(s => ({ ...s, quality: v }))}
        />

        <FilenameField
          name={filename}
          ext={ext}
          type={type}
          onName={(v) => setSettings(s => ({ ...s, filename: v }))}
          onExt={(v) => setSettings(s => ({ ...s, ext: v }))}
        />
      </div>

      {(downloading || done || error || interrupted || resuming) && (
        <div className="dl-progress-block">
          <div className={`dl-progress-track ${error ? "error" : ""} ${done ? "done" : ""} ${interrupted ? "interrupted" : ""} ${resuming ? "resuming" : ""}`}>
            <div
              className="dl-progress-fill"
              style={{ width: error ? "100%" : `${done ? 100 : progress}%` }}
            />
          </div>
          <div className="dl-progress-label">
            {error && <><Icon.AlertCircle size={14} /> <span>Download failed — connection lost</span></>}
            {interrupted && <><Icon.WifiOff size={14} /> <span>Paused at {Math.round(progress)}% — will auto-resume when online</span></>}
            {resuming && <><Icon.Wifi size={14} /> <span>Reconnecting… resuming at {Math.round(progress)}%</span></>}
            {done && !settingsChanged && <><Icon.Check size={14} /> <span>Saved to Downloads · {lastUsedSettings && lastUsedSettings.quality}</span></>}
            {done && settingsChanged && <><Icon.Check size={14} /> <span>Saved · settings changed since last download</span></>}
            {downloading && <span>{Math.round(progress)}% — Downloading · {settings.quality}</span>}
          </div>
        </div>
      )}

      <div className="dl-pop-footer">
        {downloading || resuming ? (
          <>
            <button className="dl-btn-ghost" onClick={onClose}>Hide</button>
            <button className="dl-btn-danger" onClick={onCancel}>Cancel download</button>
          </>
        ) : interrupted ? (
          <>
            <button className="dl-btn-ghost" onClick={onCancel}>Discard</button>
            <button className="dl-btn-primary" onClick={onResume}>
              <Icon.Download size={18} />
              <span>Resume now</span>
            </button>
          </>
        ) : (
          <>
            <button className="dl-btn-ghost" onClick={onClose}>Close</button>
            <button
              className="dl-btn-primary"
              disabled={!validExt}
              onClick={onStart}
            >
              <Icon.Download size={18} />
              <span>
                {error
                  ? "Retry download"
                  : done && settingsChanged
                    ? "Download with new settings"
                    : done
                      ? "Download again"
                      : "Download"}
              </span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ============ DOWNLOAD BUTTON (in action row) ============
function DownloadButton({ state, progress, onClick, onChevron, popoverOpen, rootRef, settings }) {
  const downloading = state === "downloading";
  const done = state === "done";
  const error = state === "error";
  const interrupted = state === "interrupted";
  const resuming = state === "resuming";

  // Circumference for the progress ring
  const r = 9;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - (progress / 100));

  const mainTip = downloading
    ? "Click to view progress"
    : resuming
      ? `Reconnecting at ${Math.round(progress)}%`
      : interrupted
        ? `Paused at ${Math.round(progress)}% — auto-resumes when online`
        : done
          ? `Download again · ${settings ? settings.quality : ""}`
          : error
            ? "Retry download"
            : `Download · ${settings ? `${settings.quality} · ${(settings.type === "audio") ? "Audio" : (settings.type === "video") ? "Video" : "Video + Audio"}` : ""}`;
  const chevTip = popoverOpen ? "Hide options" : "Download options";
  const mainLabel = downloading
    ? `${Math.round(progress)}%`
    : resuming
      ? "Reconnecting…"
      : interrupted
        ? `Paused ${Math.round(progress)}%`
        : done
          ? "Download again"
          : error
            ? "Retry"
            : "Download";

  return (
    <div ref={rootRef} className={`action-pill download-pill ${downloading ? "downloading" : ""} ${done ? "done" : ""} ${error ? "error" : ""} ${interrupted ? "interrupted" : ""} ${resuming ? "resuming" : ""}`} data-download-trigger>
      <button className="action-main has-tooltip" onClick={onClick} aria-label={mainLabel} data-tooltip={mainTip}>
        <span className="action-icon-wrap">
          {downloading ? (
            <svg width="22" height="22" viewBox="0 0 24 24" className="dl-ring">
              <circle cx="12" cy="12" r={r} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.4" />
              <circle
                cx="12" cy="12" r={r}
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeDasharray={c}
                strokeDashoffset={offset}
                transform="rotate(-90 12 12)"
                style={{ transition: "stroke-dashoffset 0.3s linear" }}
              />
              <rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor" />
            </svg>
          ) : interrupted ? (
            <svg width="22" height="22" viewBox="0 0 24 24" className="dl-ring">
              <circle cx="12" cy="12" r={r} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.4" />
              <circle
                cx="12" cy="12" r={r}
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeDasharray={c}
                strokeDashoffset={offset}
                transform="rotate(-90 12 12)"
              />
              <Icon.WifiOff size={11} />
            </svg>
          ) : resuming ? (
            <svg width="22" height="22" viewBox="0 0 24 24" className="dl-ring spinning">
              <circle cx="12" cy="12" r={r} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.4" />
              <circle
                cx="12" cy="12" r={r}
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeDasharray={`${c * 0.25} ${c}`}
                transform="rotate(-90 12 12)"
              />
            </svg>
          ) : done ? (
            <Icon.Check size={22} />
          ) : error ? (
            <Icon.AlertCircle size={22} />
          ) : (
            <Icon.Download size={22} />
          )}
        </span>
        <span className="action-label">{mainLabel}</span>
      </button>
      <span className="action-divider" />
      <button className={`action-chevron has-tooltip ${popoverOpen ? "active" : ""}`} onClick={onChevron} aria-label="Download options" data-tooltip={chevTip}>
        <Icon.Chevron size={18} dir={popoverOpen ? "up" : "down"} />
      </button>
    </div>
  );
}

// ============ ACTION ROW ============
function ActionRow({ children }) {
  return <div className="action-row">{children}</div>;
}

function PillButton({ icon, label, active }) {
  return (
    <button className={`action-pill ${active ? "active" : ""}`}>
      <span className="action-main">
        <span className="action-icon-wrap">{icon}</span>
        <span className="action-label">{label}</span>
      </span>
    </button>
  );
}

function LikeDislikePill() {
  return (
    <div className="action-pill split">
      <button className="action-main">
        <span className="action-icon-wrap"><Icon.Like size={22} /></span>
        <span className="action-label">12K</span>
      </button>
      <span className="action-divider" />
      <button className="action-side"><Icon.Dislike size={22} /></button>
    </div>
  );
}

// ============ TOAST ============
function Toast({ state, progress, filename, onDismiss, onRedownload, onResume }) {
  if (state !== "done" && state !== "error" && state !== "interrupted") return null;
  const isInterrupted = state === "interrupted";
  const title = state === "done"
    ? "Download complete"
    : isInterrupted
      ? "Download paused"
      : "Download failed";
  const sub = isInterrupted
    ? `${filename} · ${Math.round(progress)}% — auto-resuming when online`
    : filename;
  return (
    <div className={`toast ${state}`}>
      <span className="toast-icon">
        {state === "done"
          ? <Icon.Check size={18} />
          : isInterrupted
            ? <Icon.WifiOff size={18} />
            : <Icon.AlertCircle size={18} />}
      </span>
      <div className="toast-body">
        <div className="toast-title">{title}</div>
        <div className="toast-sub">{sub}</div>
      </div>
      {state === "error" && (
        <div className="toast-actions">
          <button className="toast-action" onClick={onRedownload}>Retry</button>
        </div>
      )}
      {isInterrupted && (
        <div className="toast-actions">
          <button className="toast-action" onClick={onResume}>Resume now</button>
        </div>
      )}
      <button className="toast-dismiss" onClick={onDismiss}><Icon.X size={16} /></button>
    </div>
  );
}

// ============ VIDEO PAGE MOCK ============
function VideoMock({ theme, showVideoBg }) {
  return (
    <div className="video-card">
      <div className="video-frame" data-bg={showVideoBg ? "on" : "off"}>
        <div className="video-placeholder">
          <div className="vp-stripes" />
          <div className="vp-label">[ video player ]</div>
        </div>
        <div className="video-controls">
          <div className="vc-progress"><div className="vc-progress-fill" /></div>
          <div className="vc-row">
            <div className="vc-cluster">
              <span className="vc-icon">▶</span>
              <span className="vc-icon">⏭</span>
              <span className="vc-time">14:22 / 28:47</span>
            </div>
            <div className="vc-cluster">
              <span className="vc-icon">⚙</span>
              <span className="vc-icon">⛶</span>
            </div>
          </div>
        </div>
      </div>

      <h1 className="video-title">{VIDEO_TITLE}</h1>

      <div className="video-meta-row">
        <div className="channel">
          <div className="avatar" />
          <div>
            <div className="channel-name">Lab Notes</div>
            <div className="channel-subs">438K subscribers</div>
          </div>
          <button className="subscribe">Subscribe</button>
        </div>
        {/* Action row injected by parent */}
        <div id="action-row-slot" />
      </div>
    </div>
  );
}

// ============ ROOT ============
function App() {
  const tweaks = window.useTweaks(TWEAK_DEFAULTS);
  const [t, setTweak] = tweaks;
  const theme = t.theme;

  const [popoverOpen, setPopoverOpen] = useState(false);
  const [state, setState] = useState("idle"); // idle | downloading | done | error
  const [progress, setProgress] = useState(0);
  const [anchorRect, setAnchorRect] = useState(null);
  const [showToast, setShowToast] = useState(false);
  const [settings, setSettings] = useState({
    type: "video+audio",
    quality: "2160p 60fps (4K)",
    filename: VIDEO_TITLE,
    ext: "mp4",
  });
  const [lastUsedSettings, setLastUsedSettings] = useState(null);

  const downloadBtnRef = useRef(null);
  const intervalRef = useRef(null);

  // Compute fresh anchor rect from the button's current position.
  const computeAnchor = useCallback(() => {
    if (downloadBtnRef.current) {
      const rect = downloadBtnRef.current.getBoundingClientRect();
      setAnchorRect(rect);
      return rect;
    }
    return null;
  }, []);

  // Sync state with demoState tweak
  useEffect(() => {
    if (t.demoState && t.demoState !== state) {
      if (t.demoState === "downloading") {
        setState("downloading");
        setProgress(42);
      } else if (t.demoState === "done") {
        setState("done");
        setProgress(100);
        setShowToast(true);
      } else if (t.demoState === "error") {
        setState("error");
        setShowToast(true);
      } else if (t.demoState === "interrupted") {
        setState("interrupted");
        if (progress < 5) setProgress(38);
        setShowToast(true);
      } else if (t.demoState === "resuming") {
        setState("resuming");
        if (progress < 5) setProgress(38);
        setShowToast(false);
      } else {
        setState("idle");
        setProgress(0);
        setShowToast(false);
      }
    }
  }, [t.demoState]);

  const updateAnchor = computeAnchor;

  useEffect(() => {
    computeAnchor();
    const onResize = () => computeAnchor();
    const onScroll = () => { if (popoverOpen) computeAnchor(); };
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [computeAnchor, popoverOpen]);

  const startDownload = useCallback((opts = {}) => {
    const startAt = opts.from || 0;
    setState("downloading");
    setProgress(startAt);
    setShowToast(false);
    if (!opts.from) {
      setLastUsedSettings({ ...settings });
    }
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      setProgress(p => {
        const next = p + (Math.random() * 4 + 1.5);
        if (next >= 100) {
          clearInterval(intervalRef.current);
          setState("done");
          setShowToast(true);
          setTweak("demoState", "done");
          return 100;
        }
        return next;
      });
    }, 120);
    setTweak("demoState", "downloading");
  }, [setTweak, settings]);

  const cancelDownload = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setState("idle");
    setProgress(0);
    setShowToast(false);
    setTweak("demoState", "idle");
  }, [setTweak]);

  // ref to read current progress in setTimeout/setInterval below
  const progressRef = useRef(0);
  useEffect(() => { progressRef.current = progress; }, [progress]);

  // Track which state we're in for the auto-resume watcher
  const stateRef = useRef("idle");
  useEffect(() => { stateRef.current = state; }, [state]);

  const interruptDownload = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setState("interrupted");
    setShowToast(true);
    setTweak("demoState", "interrupted");
  }, [setTweak]);

  const resumeDownload = useCallback(() => {
    setShowToast(false);
    setState("resuming");
    setTweak("demoState", "resuming");
    // simulate reconnect handshake
    setTimeout(() => {
      // only proceed if we're still in resuming (user didn't discard / cancel)
      if (stateRef.current === "resuming") {
        startDownload({ from: progressRef.current });
      }
    }, 1100);
  }, [setTweak, startDownload]);

  // Auto-resume: when interrupted, periodically "check connection" and resume when back online.
  // In a real extension this would listen on `navigator.connection`/`window.online` events.
  useEffect(() => {
    if (state !== "interrupted") return;
    // Simulate connection coming back after 2.5s — in production this is event-driven.
    const t = setTimeout(() => {
      if (stateRef.current === "interrupted") {
        resumeDownload();
      }
    }, 2500);
    return () => clearTimeout(t);
  }, [state, resumeDownload]);

  // One-click pill behavior depending on current state
  const oneClickDownload = useCallback(() => {
    if (state === "downloading" || state === "resuming") {
      computeAnchor();
      setPopoverOpen(true);
      return;
    }
    if (state === "interrupted") {
      // pill click resumes from where we paused
      resumeDownload();
      return;
    }
    setShowToast(false);
    startDownload();
  }, [state, startDownload, computeAnchor, resumeDownload]);

  const togglePopover = useCallback(() => {
    computeAnchor(); // read fresh rect BEFORE opening so popover renders at correct position
    setPopoverOpen(o => !o);
  }, [computeAnchor]);

  // Cleanup
  useEffect(() => () => { if (intervalRef.current) clearInterval(intervalRef.current); }, []);

  // Auto-dismiss toast
  useEffect(() => {
    if (showToast && state === "done") {
      const t = setTimeout(() => setShowToast(false), 4500);
      return () => clearTimeout(t);
    }
  }, [showToast, state]);

  return (
    <div className={`app theme-${theme}`}>
      <TopBar theme={theme} />

      <div className="page">
        <div className="main-col">
          <VideoMock theme={theme} showVideoBg={t.showVideoBg} />

          <ActionRowPortal>
            <ActionRow>
              <LikeDislikePill />
              <PillButton icon={<Icon.Share size={22} />} label="Share" />
              <DownloadButton
                rootRef={downloadBtnRef}
                state={state}
                progress={progress}
                onClick={oneClickDownload}
                onChevron={togglePopover}
                popoverOpen={popoverOpen}
                settings={settings}
              />
              <PillButton icon={<Icon.Sparkle size={22} />} label="Ask" />
              <PillButton icon={<Icon.Save size={22} />} label="Save" />
              <button className="action-pill icon-only" aria-label="More"><Icon.More size={22} /></button>
            </ActionRow>
          </ActionRowPortal>

          <DescriptionCard />
        </div>

        <SidebarMock />
      </div>

      <DownloadPopover
        open={popoverOpen}
        onClose={() => setPopoverOpen(false)}
        state={state}
        progress={progress}
        onStart={startDownload}
        onCancel={cancelDownload}
        onResume={resumeDownload}
        settings={settings}
        setSettings={setSettings}
        anchorRef={downloadBtnRef}
        lastUsedSettings={lastUsedSettings}
      />

      {showToast && (
        <Toast
          state={state}
          progress={progress}
          filename={`${settings.filename}.${settings.ext}`}
          onDismiss={() => setShowToast(false)}
          onRedownload={() => { setShowToast(false); startDownload(); }}
          onResume={() => { resumeDownload(); }}
        />
      )}

      {/* Tweaks panel */}
      <window.TweaksPanel title="Tweaks">
        <window.TweakSection title="Appearance">
          <window.TweakRadio
            label="Theme"
            value={t.theme}
            options={[{ value: "dark", label: "Dark" }, { value: "light", label: "Light" }]}
            onChange={(v) => setTweak("theme", v)}
          />
          <window.TweakToggle
            label="Show video background"
            value={t.showVideoBg}
            onChange={(v) => setTweak("showVideoBg", v)}
          />
        </window.TweakSection>
        <window.TweakSection title="Demo state">
          <window.TweakRadio
            label="Download state"
            value={t.demoState}
            options={[
              { value: "idle", label: "Idle" },
              { value: "downloading", label: "Downloading" },
              { value: "interrupted", label: "Paused (offline)" },
              { value: "resuming", label: "Resuming" },
              { value: "done", label: "Done" },
              { value: "error", label: "Error" },
            ]}
            onChange={(v) => setTweak("demoState", v)}
          />
          <window.TweakButton
            label="Start fresh download"
            onClick={() => { setShowToast(false); startDownload(); setPopoverOpen(true); }}
          />
          <window.TweakButton
            label="Simulate connection drop"
            onClick={() => { interruptDownload(); }}
          />
        </window.TweakSection>
      </window.TweaksPanel>
    </div>
  );
}

// Inline helper: render action row inline with the rest of the layout (we just keep it in normal flow)
function ActionRowPortal({ children }) {
  return <div className="action-row-wrapper">{children}</div>;
}

function TopBar({ theme }) {
  return (
    <header className="topbar">
      <div className="topbar-l">
        <div className="hamburger"><span /><span /><span /></div>
        <div className="logo-mark">
          <div className="logo-square" />
          <span className="logo-text">VidStream</span>
        </div>
      </div>
      <div className="topbar-c">
        <div className="search">
          <input placeholder="Search" />
          <button className="search-btn">⌕</button>
        </div>
      </div>
      <div className="topbar-r">
        <button className="tb-icon">+</button>
        <button className="tb-icon">⌥</button>
        <div className="tb-avatar" />
      </div>
    </header>
  );
}

function DescriptionCard() {
  return (
    <div className="desc-card">
      <div className="desc-meta">438,219 views · 3 days ago</div>
      <p className="desc-text">
        A complete walkthrough of building a low-power, self-hosted home cloud
        using off-the-shelf hardware. Covers storage layout, networking, backup
        strategy, and the small UX details that make it pleasant to live with.
      </p>
      <div className="desc-tags">
        <span className="tag">#homelab</span>
        <span className="tag">#selfhosted</span>
        <span className="tag">#backup</span>
      </div>
    </div>
  );
}

function SidebarMock() {
  const items = [
    { t: "Setting up Tailscale across 6 devices in 8 minutes", ch: "Network Notes", v: "212K", a: "1 week" },
    { t: "Why your NAS is slower than it should be", ch: "Lab Notes", v: "94K", a: "5 days" },
    { t: "Cheap rack-mount build that actually fits your closet", ch: "Closet Cluster", v: "1.2M", a: "2 months" },
    { t: "ZFS for people who don't want to think about ZFS", ch: "Lab Notes", v: "318K", a: "3 weeks" },
    { t: "The case against gigantic monitors", ch: "Desk Theory", v: "62K", a: "yesterday" },
    { t: "Mechanical keyboards: a re-introduction", ch: "Lab Notes", v: "188K", a: "1 month" },
  ];
  return (
    <aside className="sidebar">
      {items.map((it, i) => (
        <div className="side-item" key={i}>
          <div className="side-thumb">
            <div className="side-thumb-stripes" />
            <div className="side-duration">12:0{i}</div>
          </div>
          <div className="side-meta">
            <div className="side-title">{it.t}</div>
            <div className="side-channel">{it.ch}</div>
            <div className="side-stats">{it.v} views · {it.a} ago</div>
          </div>
        </div>
      ))}
    </aside>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
