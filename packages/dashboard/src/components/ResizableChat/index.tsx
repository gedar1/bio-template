import { useState, useRef } from "react";
import type { ResizableChatProps } from "./ResizableChat.types";
import { ErrorBoundary } from "../ErrorBoundary";
import { ChatPanel } from "../ChatPanel";

export const ResizableChat: React.FC<ResizableChatProps> = ({ tenantId }) => {
  const [width, setWidth] = useState(320);
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const handleMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true;
    startX.current = e.clientX;
    startWidth.current = width;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handleMouseMove = (ev: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = startX.current - ev.clientX;
      const newWidth = Math.max(250, Math.min(600, startWidth.current + delta));
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  return (
    <aside className="flex shrink-0" style={{ width }}>
      {/* Drag handle */}
      <div
        role="separator"
        aria-orientation="vertical"
        tabIndex={0}
        className="w-1 cursor-col-resize hover:bg-emerald-500/50 active:bg-emerald-500 transition-colors"
        onMouseDown={handleMouseDown}
      />
      {/* Chat content */}
      <div className="flex-1 flex flex-col border-l border-gray-800 overflow-hidden">
        <ErrorBoundary name="Chat">
          <ChatPanel tenantId={tenantId} />
        </ErrorBoundary>
      </div>
    </aside>
  );
};
