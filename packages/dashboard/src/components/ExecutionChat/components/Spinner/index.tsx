import React from "react";
import type { SpinnerProps } from "./Spinner.types";

/**
 * Renderiza un SVG de svg-spinners como máscara para que tome el color
 * de Tailwind. Con <img> el fill="currentColor" del SVG queda en negro.
 */
export const Spinner: React.FC<SpinnerProps> = ({
  src,
  className = "h-5 w-5",
}) => {
  const mask = `url("${src}")`;
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 bg-current ${className}`}
      style={{
        maskImage: mask,
        WebkitMaskImage: mask,
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
        maskPosition: "center",
        WebkitMaskPosition: "center",
        maskSize: "contain",
        WebkitMaskSize: "contain",
      }}
    />
  );
};
