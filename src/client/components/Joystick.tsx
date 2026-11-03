import { useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';

export function Joystick({ onChange, disabled }: { onChange: (throttle: number, steer: number) => void; disabled: boolean }) {
  const activePointer = useRef<number | null>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const notify = useRef(onChange);
  notify.current = onChange;

  useEffect(() => {
    function reset() {
      activePointer.current = null;
      notify.current(0, 0);
      setPosition({ x: 0, y: 0 });
    }
    function visibilityChanged() { if (document.visibilityState !== 'visible') reset(); }
    window.addEventListener('blur', reset);
    document.addEventListener('visibilitychange', visibilityChanged);
    return () => { window.removeEventListener('blur', reset); document.removeEventListener('visibilitychange', visibilityChanged); };
  }, []);

  useEffect(() => {
    if (!disabled) return;
    activePointer.current = null;
    notify.current(0, 0);
    setPosition({ x: 0, y: 0 });
  }, [disabled]);

  function move(event: PointerEvent<HTMLDivElement>) {
    if (activePointer.current !== event.pointerId || disabled) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const radius = rect.width * 0.32;
    let x = (event.clientX - rect.left - rect.width / 2) / radius;
    let y = (event.clientY - rect.top - rect.height / 2) / radius;
    const length = Math.hypot(x, y);
    if (length > 1) { x /= length; y /= length; }
    const deadzone = 0.12;
    onChange(Math.abs(y) < deadzone ? 0 : -y, Math.abs(x) < deadzone ? 0 : x);
    setPosition({ x: x * radius, y: y * radius });
  }

  function release(event: PointerEvent<HTMLDivElement>) {
    if (activePointer.current !== event.pointerId) return;
    activePointer.current = null;
    onChange(0, 0);
    setPosition({ x: 0, y: 0 });
  }

  return <div className={`joystick ${disabled ? 'is-disabled' : ''}`} role="group" aria-label="Driving joystick. Drag up to accelerate, down to reverse, left or right to steer."
    onPointerDown={(event) => {
      if (disabled || activePointer.current !== null) return;
      activePointer.current = event.pointerId;
      event.currentTarget.setPointerCapture(event.pointerId);
      move(event);
    }}
    onPointerMove={move} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}>
    <span className="joystick-mark joystick-mark--up">⌃</span>
    <span className="joystick-mark joystick-mark--down">⌄</span>
    <span className="joystick-mark joystick-mark--left">‹</span>
    <span className="joystick-mark joystick-mark--right">›</span>
    <div className="joystick-knob" style={{ transform: `translate(${position.x}px, ${position.y}px)` }}><span /></div>
  </div>;
}
