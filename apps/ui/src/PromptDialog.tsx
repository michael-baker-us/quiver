import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A one-field dialog for create/rename actions. `transform` normalizes the
 * raw input (returning null when invalid) and drives the live preview;
 * submit passes both forms so a caller can use the display text and the
 * normalized name (e.g. collection name + derived directory). Server
 * rejections (409 conflicts etc.) surface inside the dialog.
 */
export function PromptDialog({
  title,
  hint,
  placeholder,
  initialValue = "",
  submitLabel,
  transform,
  preview,
  onSubmit,
  onClose,
}: {
  title: string;
  hint?: ReactNode;
  placeholder: string;
  initialValue?: string;
  submitLabel: string;
  transform: (input: string) => string | null;
  /** Renders the live preview line for a valid normalized value. */
  preview?: (normalized: string) => ReactNode;
  onSubmit: (raw: string, normalized: string) => Promise<void>;
  onClose: () => void;
}) {
  const [input, setInput] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const normalized = transform(input);
  const unchanged = initialValue !== "" && normalized === transform(initialValue);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  async function submit() {
    if (!normalized || unchanged) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(input, normalized);
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-label={title}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "Enter") void submit();
        }}
      >
        <h2>{title}</h2>
        {hint && <p className="hint">{hint}</p>}
        <input
          ref={inputRef}
          placeholder={placeholder}
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        {normalized && preview && <p className="hint">{preview(normalized)}</p>}
        {error && <p className="problem">{error}</p>}
        <div className="modal-actions">
          <button onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="primary"
            onClick={() => void submit()}
            disabled={!normalized || unchanged || busy}
          >
            {busy ? "Working…" : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
