import React from "react";
import { CheckCircle, XCircle } from "lucide-react";
import type { StepRowProps } from "./StepRow.types";
import { SPINNER_EXECUTING } from "../../spinners";
import { toolLabel } from "../../toolLabels";
import { Spinner } from "../Spinner";

/** Una fila por paso de la cadena con su estado visual */
export const StepRow: React.FC<StepRowProps> = ({ step, index }) => {
  return (
    <li className="flex items-center gap-2 text-sm">
      <span className="flex h-5 w-5 items-center justify-center">
        {step.status === "pending" && (
          <span className="h-2 w-2 rounded-full bg-gray-600" aria-hidden />
        )}
        {step.status === "running" && (
          <Spinner src={SPINNER_EXECUTING} className="h-4 w-4 text-blue-400" />
        )}
        {step.status === "ok" && (
          <CheckCircle className="h-4 w-4 text-green-400" aria-hidden />
        )}
        {step.status === "error" && (
          <XCircle className="h-4 w-4 text-red-400" aria-hidden />
        )}
      </span>
      <span className="text-gray-500">{index + 1}.</span>
      <span
        className={
          step.status === "pending" ? "text-gray-500" : "text-gray-200"
        }
      >
        {toolLabel(step.tool)}
      </span>
    </li>
  );
};
