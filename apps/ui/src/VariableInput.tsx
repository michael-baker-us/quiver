import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  resolveVariableForDisplay,
  tokenizeVariables,
  type VariableResolution,
} from "./varHighlight.js";
import { highlightSyntax, type BodySyntax } from "./bodyHighlight.js";

// Overlay technique: the real <input>/<textarea> keeps focus, editing, and
// scrolling, but renders its text transparent. A mirror <div> with identical
// metrics sits on top and paints the same text with {{variable}} tokens
// colored. Only the tokens accept pointer events (for hover tooltips); clicks
// everywhere else fall through to the control.

const MIRRORED_PROPS = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "letterSpacing",
  "lineHeight",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
] as const;

type Control = HTMLInputElement | HTMLTextAreaElement;

type Tooltip = {
  name: string;
  resolution: VariableResolution;
  left: number;
  top: number;
};

function caretIndexFromPoint(x: number, y: number, span: HTMLSpanElement): number | null {
  const textNode = span.firstChild;
  if (!textNode) return null;
  type CaretDoc = Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const doc = document as CaretDoc;
  if (doc.caretPositionFromPoint) {
    const pos = doc.caretPositionFromPoint(x, y);
    if (pos && pos.offsetNode === textNode) return pos.offset;
  } else if (doc.caretRangeFromPoint) {
    const range = doc.caretRangeFromPoint(x, y);
    if (range && range.startContainer === textNode) return range.startOffset;
  }
  return null;
}

function HighlightOverlay({
  text,
  variables,
  controlRef,
  multiline,
  syntax,
}: {
  text: string;
  variables: Record<string, string>;
  controlRef: RefObject<Control | null>;
  multiline: boolean;
  /** When set, literal runs between {{variables}} are syntax-colored. */
  syntax?: BodySyntax;
}) {
  const mirrorRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);

  // Copy the control's computed metrics every render: the body textarea is
  // user-resizable and fonts differ between the URL bar and editors.
  useLayoutEffect(() => {
    const control = controlRef.current;
    const mirror = mirrorRef.current;
    if (!control || !mirror) return;
    const cs = getComputedStyle(control);
    for (const prop of MIRRORED_PROPS) {
      mirror.style[prop] = cs[prop];
    }
    mirror.scrollTop = control.scrollTop;
    mirror.scrollLeft = control.scrollLeft;
  });

  useEffect(() => {
    const control = controlRef.current;
    const mirror = mirrorRef.current;
    if (!control || !mirror) return;
    const sync = () => {
      mirror.scrollTop = control.scrollTop;
      mirror.scrollLeft = control.scrollLeft;
    };
    control.addEventListener("scroll", sync);
    return () => control.removeEventListener("scroll", sync);
  }, [controlRef]);

  // Viewport coordinates: the tooltip is portaled to <body> with fixed
  // positioning so overflow clipping and stacking contexts in ancestor
  // panes can't hide it.
  function showTooltip(e: React.MouseEvent<HTMLSpanElement>, name: string) {
    const spanRect = e.currentTarget.getBoundingClientRect();
    const center = spanRect.left + spanRect.width / 2;
    setTooltip({
      name,
      resolution: resolveVariableForDisplay(name, variables),
      left: Math.min(Math.max(center, 16), window.innerWidth - 16),
      top: spanRect.bottom,
    });
  }

  // Let a click on a token still place the caret in the underlying control.
  function passClickThrough(e: React.MouseEvent<HTMLSpanElement>, tokenStart: number) {
    const control = controlRef.current;
    if (!control || control.disabled) return;
    e.preventDefault();
    control.focus();
    const offset = caretIndexFromPoint(e.clientX, e.clientY, e.currentTarget);
    const index = offset === null ? tokenStart : tokenStart + offset;
    control.setSelectionRange(index, index);
  }

  const tokens = tokenizeVariables(text);

  return (
    <>
      <div
        ref={mirrorRef}
        className={multiline ? "var-mirror multiline" : "var-mirror"}
        aria-hidden
      >
        {tokens.map((token) =>
          token.kind === "var" ? (
            <span
              key={token.start}
              className={
                resolveVariableForDisplay(token.name, variables).status === "missing"
                  ? "var-token is-missing"
                  : "var-token"
              }
              onMouseEnter={(e) => showTooltip(e, token.name)}
              onMouseLeave={() => setTooltip(null)}
              onMouseDown={(e) => passClickThrough(e, token.start)}
            >
              {token.raw}
            </span>
          ) : syntax ? (
            highlightSyntax(token.raw, syntax).map((span, i) =>
              span.className === null ? (
                span.text
              ) : (
                <span key={`${token.start}-${i}`} className={span.className}>
                  {span.text}
                </span>
              ),
            )
          ) : (
            token.raw
          ),
        )}
        {multiline && "​"}
      </div>
      {tooltip &&
        createPortal(
          <div className="var-tooltip" style={{ left: tooltip.left, top: tooltip.top + 4 }}>
          <div className="var-tooltip-name">{`{{${tooltip.name}}}`}</div>
          {tooltip.resolution.status === "resolved" && (
            <div className="var-tooltip-value">{tooltip.resolution.value || "(empty string)"}</div>
          )}
          {tooltip.resolution.status === "env" && (
            <div className="var-tooltip-note">
              OS environment variable <code>{tooltip.resolution.envName}</code> — resolved on the
              server when sending.
            </div>
          )}
          {tooltip.resolution.status === "missing" && (
            <div className="var-tooltip-note">
              Not set in the current environment. It may be captured by an earlier request during
              a run — otherwise sending will fail.
            </div>
          )}
          </div>,
          document.body,
        )}
    </>
  );
}

export function VariableInput({
  value,
  onChange,
  variables,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  variables: Record<string, string>;
  placeholder?: string;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="var-wrap">
      <input
        ref={ref}
        className="var-control"
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      <HighlightOverlay text={value} variables={variables} controlRef={ref} multiline={false} />
    </div>
  );
}

export function VariableTextarea({
  value,
  onChange,
  variables,
  className,
  syntax,
}: {
  value: string;
  onChange: (value: string) => void;
  variables: Record<string, string>;
  className?: string;
  /** Syntax-color the body between {{variables}} (JSON/XML editors). */
  syntax?: BodySyntax;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <div className="var-wrap block">
      <textarea
        ref={ref}
        className={className ? `${className} var-control` : "var-control"}
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <HighlightOverlay
        text={value}
        variables={variables}
        controlRef={ref}
        multiline
        syntax={syntax}
      />
    </div>
  );
}
