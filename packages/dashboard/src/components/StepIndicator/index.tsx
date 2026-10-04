import React from "react";
import {
  Globe,
  Database,
  FolderOpen,
  Mail,
  GitBranch,
  Cloud,
  Settings,
  Zap,
  Radio,
  Download,
  Link,
  Image,
  FileText,
  Search,
  Plus,
  Pencil,
  Trash2,
  BarChart3,
  BookOpen,
  FileDown,
  ClipboardList,
  Send,
  MessageCircle,
  GitCommit,
  ArrowUp,
  ArrowDown,
  ScrollText,
  Terminal,
  Film,
  FileOutput,
  CheckCircle,
  Info,
  Power,
  PowerOff,
  Upload,
  Megaphone,
  Users,
  XCircle,
  Monitor,
  Lightbulb,
  Clock,
  type LucideIcon,
} from "lucide-react";
import type { StepIndicatorProps, StepIconDef } from "./StepIndicator.types";

const STEP_ICONS: Record<string, StepIconDef> = {
  // Mutations
  "mutate:sensory": { icon: Globe, label: "Web" },
  "mutate:memory": { icon: Database, label: "BD" },
  "mutate:filesystem": { icon: FolderOpen, label: "Archivos" },
  "mutate:communication": { icon: Mail, label: "Email" },
  "mutate:versioncontrol": { icon: GitBranch, label: "Git" },
  "mutate:http": { icon: Cloud, label: "HTTP" },
  "mutate:system": { icon: Settings, label: "Sistema" },
  "mutate:monitor": { icon: Radio, label: "Monitor" },
  "mutate:realtime": { icon: Zap, label: "WebSocket" },
  // Sensory tools
  scrape_url: { icon: Download, label: "Scrape" },
  extract_links: { icon: Link, label: "Links" },
  extract_images: { icon: Image, label: "Imágenes" },
  fetch_api: { icon: Radio, label: "API" },
  scrape_metadata: { icon: FileText, label: "Meta" },
  extract_text: { icon: FileText, label: "Texto" },
  analyze_page: { icon: Search, label: "Analizar" },
  // Memory tools
  db_query: { icon: Search, label: "Query" },
  db_insert: { icon: Plus, label: "Guardar" },
  db_find: { icon: Search, label: "Buscar" },
  db_update: { icon: Pencil, label: "Actualizar" },
  db_delete: { icon: Trash2, label: "Borrar" },
  create_table: { icon: BarChart3, label: "Tabla" },
  // Filesystem tools
  read_file: { icon: BookOpen, label: "Leer" },
  write_file: { icon: FileDown, label: "Escribir" },
  delete_file: { icon: Trash2, label: "Borrar" },
  list_files: { icon: ClipboardList, label: "Listar" },
  copy_file: { icon: ClipboardList, label: "Copiar" },
  move_file: { icon: FileOutput, label: "Mover" },
  // Communication tools
  send_email: { icon: Send, label: "Email" },
  send_bulk_email: { icon: Send, label: "Bulk" },
  send_whatsapp: { icon: MessageCircle, label: "WhatsApp" },
  // Git tools
  git_status: { icon: BarChart3, label: "Status" },
  git_commit: { icon: GitCommit, label: "Commit" },
  git_push: { icon: ArrowUp, label: "Push" },
  git_pull: { icon: ArrowDown, label: "Pull" },
  git_add: { icon: Plus, label: "Add" },
  git_log: { icon: ScrollText, label: "Log" },
  // HTTP tools
  http_get: { icon: ArrowDown, label: "GET" },
  http_post: { icon: ArrowUp, label: "POST" },
  http_download: { icon: FileDown, label: "Download" },
  http_upload: { icon: Upload, label: "Upload" },
  // System tools
  execute_cli: { icon: Terminal, label: "CLI" },
  run_ffmpeg: { icon: Film, label: "FFmpeg" },
  run_imagemagick: { icon: Image, label: "ImageMagick" },
  run_pandoc: { icon: FileOutput, label: "Pandoc" },
  check_command: { icon: CheckCircle, label: "Check" },
  system_info: { icon: Info, label: "Info" },
  // WebSocket tools
  ws_start_server: { icon: Power, label: "WS Start" },
  ws_stop_server: { icon: PowerOff, label: "WS Stop" },
  ws_send: { icon: Send, label: "Enviar" },
  ws_broadcast: { icon: Megaphone, label: "Broadcast" },
  ws_list_clients: { icon: Users, label: "Clientes" },
  ws_disconnect_client: { icon: XCircle, label: "Desconectar" },
};

const DEFAULT_ICON: StepIconDef = { icon: Monitor, label: "?" };

function getStepDef(step: string): StepIconDef {
  return STEP_ICONS[step] ?? DEFAULT_ICON;
}

function getStepClasses(
  mode: StepIndicatorProps["mode"],
  index: number,
  currentStep: number | undefined,
): string {
  if (mode === "reflex") {
    return "border-green-500 bg-green-500/10 text-green-300";
  }
  if (mode === "hint") {
    return "border-gray-500 border-dashed bg-gray-700/30 text-gray-400";
  }
  // executing mode
  if (currentStep === undefined) {
    return "border-gray-500 bg-gray-700/30 text-gray-400";
  }
  if (index < currentStep) {
    return "border-green-500 bg-green-500/10 text-green-300";
  }
  if (index === currentStep) {
    return "border-blue-400 bg-blue-500/20 text-blue-300 ring-1 ring-blue-400/50";
  }
  return "border-gray-600 bg-gray-700/30 text-gray-500";
}

function getConnectorClasses(
  mode: StepIndicatorProps["mode"],
  index: number,
  currentStep: number | undefined,
): string {
  if (mode === "reflex") return "border-green-500/60";
  if (mode === "hint") return "border-gray-500/40 border-dashed";
  if (currentStep !== undefined && index < currentStep)
    return "border-green-500/60";
  return "border-gray-600/40";
}

function getModeIcon(mode: StepIndicatorProps["mode"]): React.ReactNode {
  if (mode === "reflex") return <Zap size={10} className="text-green-400" />;
  if (mode === "hint") return <Lightbulb size={10} className="text-gray-400" />;
  return <Clock size={10} className="text-blue-400" />;
}

function getModeLabel(mode: StepIndicatorProps["mode"]): string {
  if (mode === "reflex") return "Reflex";
  if (mode === "hint") return "Sugerido";
  return "Ejecutando";
}

function getModeLabelClass(mode: StepIndicatorProps["mode"]): string {
  if (mode === "reflex") return "text-green-400";
  if (mode === "hint") return "text-gray-400";
  return "text-blue-400";
}

export const StepIndicator: React.FC<StepIndicatorProps> = ({
  steps,
  mode,
  currentStep,
  failedStep,
}) => {
  if (!steps.length) return null;

  const hasFailed = failedStep !== undefined;
  const modeLabel = hasFailed ? "Error" : getModeLabel(mode);
  const modeIcon = hasFailed ? "❌" : getModeIcon(mode);
  const modeLabelClass = hasFailed ? "text-red-400" : getModeLabelClass(mode);

  return (
    <div className="mb-1.5">
      <div className="flex items-center gap-1 mb-1">
        <span
          className={`text-[10px] font-medium ${modeLabelClass} inline-flex items-center gap-0.5`}
        >
          {modeIcon} {modeLabel}
        </span>
        <span className="text-[10px] text-gray-500">
          ({steps.length} {steps.length === 1 ? "paso" : "pasos"})
        </span>
      </div>
      <div className="flex items-center gap-0 overflow-x-auto pb-1">
        {steps.map((step, i) => {
          const def = getStepDef(step);
          const isFailed = failedStep === i;
          const stepClass = isFailed
            ? "border-red-500 bg-red-500/10 text-red-400"
            : getStepClasses(mode, i, currentStep);
          const IconComponent = def.icon as LucideIcon;

          return (
            <React.Fragment key={`${step}-${i}`}>
              {i > 0 && (
                <div
                  className={`w-4 border-t ${isFailed ? "border-red-500/60" : getConnectorClasses(mode, i - 1, currentStep)} shrink-0`}
                />
              )}
              <div className="flex flex-col items-center shrink-0" title={step}>
                <div
                  className={`flex items-center justify-center rounded-full border w-9 h-9 ${stepClass}`}
                >
                  <IconComponent size={16} className="shrink-0" />
                </div>
                <span
                  className={`text-[9px] mt-1 leading-tight whitespace-nowrap ${isFailed ? "text-red-400" : "text-gray-400"}`}
                >
                  {def.label}
                </span>
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};
