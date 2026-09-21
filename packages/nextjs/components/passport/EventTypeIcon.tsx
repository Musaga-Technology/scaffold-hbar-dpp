import {
  ArrowPathIcon,
  ArrowsRightLeftIcon,
  ClipboardDocumentCheckIcon,
  CubeIcon,
  QuestionMarkCircleIcon,
  TruckIcon,
  WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline";

const ICONS: Record<string, typeof CubeIcon> = {
  "product.registered": CubeIcon,
  "product.shipped": TruckIcon,
  "product.inspected": ClipboardDocumentCheckIcon,
  "product.repaired": WrenchScrewdriverIcon,
  "product.recycled": ArrowPathIcon,
  "custody.transferred": ArrowsRightLeftIcon,
  malformed: QuestionMarkCircleIcon,
};

/** Human label for an event type, including unknown and custom ones. */
export function eventLabel(type: string): string {
  const labels: Record<string, string> = {
    "product.registered": "Registered",
    "product.shipped": "Shipped",
    "product.inspected": "Inspected",
    "product.repaired": "Repaired",
    "product.recycled": "Recycled",
    "custody.transferred": "Custody transferred",
    malformed: "Unreadable message",
  };
  if (labels[type]) return labels[type];
  // A custom type is shown as written rather than hidden; an indexer that has
  // not been taught a type still recorded that it happened.
  return type.startsWith("custom.") ? type.slice("custom.".length).replace(/[_.]/g, " ") : type;
}

export const EventTypeIcon = ({ type, className = "h-5 w-5" }: { type: string; className?: string }) => {
  const Icon = ICONS[type] ?? QuestionMarkCircleIcon;
  return <Icon className={className} />;
};
