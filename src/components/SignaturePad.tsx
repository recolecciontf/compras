import { Eraser, PenLine } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Props = {
  label: string;
  disabled?: boolean;
  onChange: (dataUrl: string) => void;
};

export function SignaturePad({ label, disabled = false, onChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const ink = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const width = Math.max(280, Math.round(canvas.getBoundingClientRect().width));
    const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    canvas.width = width * ratio;
    canvas.height = 170 * ratio;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.scale(ratio, ratio);
    context.lineWidth = 2.2;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#123d2a";
  }, []);

  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    drawing.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    const next = point(event);
    context.beginPath();
    context.moveTo(next.x, next.y);
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || disabled) return;
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    const next = point(event);
    context.lineTo(next.x, next.y);
    context.stroke();
    ink.current = true;
    setHasInk(true);
  }

  function finish(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    drawing.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (ink.current) {
      onChange(event.currentTarget.toDataURL("image/png"));
    }
  }

  function clear() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    ink.current = false;
    setHasInk(false);
    onChange("");
  }

  return (
    <div className={`signature-pad ${hasInk ? "signed" : ""}`}>
      <div className="signature-pad-heading">
        <span><PenLine size={18} /><strong>{label}</strong></span>
        <button type="button" className="signature-clear" disabled={disabled || !hasInk} onClick={clear}><Eraser size={16} /> Limpiar</button>
      </div>
      <canvas
        ref={canvasRef}
        aria-label={`Zona de firma: ${label}`}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={finish}
      />
      <small>{hasInk ? "Firma capturada" : "Firma con el dedo, ratón o lápiz digital"}</small>
    </div>
  );
}
