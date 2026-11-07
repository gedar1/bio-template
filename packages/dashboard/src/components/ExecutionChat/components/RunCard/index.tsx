import React, { useEffect, useState } from "react";
import {
  CheckCircle,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  XCircle,
} from "lucide-react";
import type { RunCardProps } from "./RunCard.types";
import { StepRow } from "../StepRow";
import { Spinner } from "../Spinner";
import {
  SPINNER_DETECTING,
  SPINNER_EXECUTING,
  SPINNER_PERSISTING,
} from "../../spinners";

/** Tiempo que el resultado se muestra antes de contraer los pasos */
const AUTO_COLLAPSE_MS = 1500;

/**
 * Tarjeta de una ejecución. Los pasos están abiertos mientras corre,
 * se contraen solos si todo sale bien y quedan abiertos si falla.
 * El usuario puede alternarlos en cualquier momento.
 */
export const RunCard: React.FC<RunCardProps> = ({ run, onRetry }) => {
  const [autoCollapsed, setAutoCollapsed] = useState(false);
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);

  useEffect(() => {
    if (run.stage !== "done") return;
    const timer = setTimeout(() => setAutoCollapsed(true), AUTO_COLLAPSE_MS);
    return () => clearTimeout(timer);
  }, [run.stage]);

  const isOpen = manualOpen ?? !(run.stage === "done" && autoCollapsed);
  const stepsId = `run-${run.id}-steps`;

  return (
    <div className="flex flex-col gap-2">
      <div className="self-end max-w-[85%] rounded-lg bg-blue-600 px-3 py-2 text-sm text-white">
        {run.prompt}
      </div>

      <div
        role="status"
        aria-live="polite"
        className="flex max-w-[92%] flex-col gap-2 rounded-lg border border-gray-700 bg-gray-800 p-3"
      >
        {run.stage === "detecting" && (
          <StageLabel
            spinner={SPINNER_DETECTING}
            colorClass="text-sky-400"
            text="Entendiendo tu solicitud…"
          />
        )}
        {run.stage === "executing" && (
          <StageLabel
            spinner={SPINNER_EXECUTING}
            colorClass="text-blue-400"
            text="Realizando la tarea…"
          />
        )}
        {run.stage === "persisting" && (
          <StageLabel
            spinner={SPINNER_PERSISTING}
            colorClass="text-amber-400"
            text="Guardando la información…"
          />
        )}
        {run.stage === "done" && (
          <p className="flex items-center gap-2 text-sm text-green-400">
            <CheckCircle className="h-4 w-4" aria-hidden />
            {run.summary}
          </p>
        )}
        {run.stage === "error" && (
          <div className="flex flex-col gap-2">
            <p className="flex items-center gap-2 text-sm text-red-400">
              <XCircle className="h-4 w-4" aria-hidden />
              {run.errorMessage}
            </p>
            {/* {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="flex flex-row items-center gap-1.5 self-start rounded-md border border-red-500/40 px-2.5 py-1 text-xs font-medium text-red-300 hover:bg-red-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                Reintentar
              </button>
            )} */}
          </div>
        )}

        {run.steps.length > 0 && (
          <div className="flex flex-row w-full justify-between">
            <button
              type="button"
              onClick={() => setManualOpen(!isOpen)}
              aria-expanded={isOpen}
              aria-controls={stepsId}
              className="flex items-center gap-1 self-start text-xs text-gray-400 hover:text-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
            >
              {isOpen ? (
                <ChevronUp className="h-3 w-3" aria-hidden />
              ) : (
                <ChevronDown className="h-3 w-3" aria-hidden />
              )}
              {isOpen ? "Ocultar pasos" : `Ver pasos (${run.steps.length})`}
            </button>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="flex flex-row items-center gap-1.5 self-start rounded-md border border-red-500/40 px-2.5 py-1 text-xs font-medium text-red-300 hover:bg-red-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                Reintentar
              </button>
            )}
          </div>
        )}

        {isOpen && run.steps.length > 0 && (
          <ol
            id={stepsId}
            className="flex flex-col gap-1 border-t border-gray-700 pt-2"
          >
            {run.steps.map((step, i) => (
              <StepRow key={`${step.tool}-${i}`} step={step} index={i} />
            ))}
          </ol>
        )}
      </div>
    </div>
  );
};

interface StageLabelProps {
  spinner: string;
  colorClass: string;
  text: string;
}

const StageLabel: React.FC<StageLabelProps> = ({
  spinner,
  colorClass,
  text,
}) => (
  <p className="flex items-center gap-2 text-sm text-gray-300">
    <Spinner src={spinner} className={`h-5 w-5 ${colorClass}`} />
    {text}
  </p>
);
