import type { TooltipProps, TooltipPosition } from "./Tooltip.types";

const positionClasses: Record<TooltipPosition, string> = {
  top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
  bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
  left: "right-full top-1/2 -translate-y-1/2 mr-2",
  right: "left-full top-1/2 -translate-y-1/2 ml-2",
};

/**
 * Tooltip component using CSS-only :hover and :focus-within.
 * No JavaScript event handlers needed — fully accessible via keyboard focus.
 */
export const Tooltip: React.FC<TooltipProps> = ({
  text,
  children,
  position = "top",
}) => {
  return (
    <span className="relative inline-flex group">
      {children}
      <span
        className={`absolute z-[100] px-4 py-2 text-xs text-white bg-gray-900 rounded shadow-lg pointer-events-none border border-gray-700 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-200 max-w-lg w-max ${positionClasses[position]}`}
        role="tooltip"
      >
        {text}
      </span>
    </span>
  );
};
