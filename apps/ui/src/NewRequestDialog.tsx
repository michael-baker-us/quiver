import { useEffect, useRef, useState } from "react";

/** Normalizes user input like "users/create user" to a valid request path. */
export function toRequestPath(input: string): string | null {
  const cleaned = input
    .trim()
    .replace(/^[/.]+/, "")
    .replace(/\.request\.ya?ml$/i, "")
    .replace(/\.ya?ml$/i, "")
    .replace(/\s+/g, "-");
  if (!cleaned || cleaned.includes("..")) return null;
  return `${cleaned}.request.yaml`;
}

export function NewRequestDialog({
  onCreate,
  onClose,
}: {
  onCreate: (path: string) => void;
  onClose: () => void;
}) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const path = toRequestPath(input);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function submit() {
    if (path) onCreate(path);
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
        aria-label="New request"
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "Enter") submit();
        }}
      >
        <h2>New request</h2>
        <p className="hint">
          Folders group related requests and are created automatically, e.g.{" "}
          <code>users/create-user</code>. Requests run in alphabetical order,
          so use numeric prefixes (<code>01-login</code>) when order matters.
        </p>
        <input
          ref={inputRef}
          placeholder="users/create-user"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        {path && (
          <p className="hint">
            Will create <code>{path}</code>
          </p>
        )}
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={submit} disabled={!path}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
