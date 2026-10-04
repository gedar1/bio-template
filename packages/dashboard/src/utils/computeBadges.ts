import type {
  NotificationBadge,
  BadgeType,
  SectionId,
} from "../types/dashboard";

export interface BadgeEvent {
  sectionId: SectionId;
  type: BadgeType;
}

/**
 * Computes notification badges for inactive sections.
 * Only sections that are NOT the active section get badges.
 * Each badge count equals the number of events targeting that section.
 */
export function computeBadges(
  events: BadgeEvent[],
  activeSection: SectionId,
): NotificationBadge[] {
  const counts = new Map<SectionId, { count: number; type: BadgeType }>();

  for (const event of events) {
    // Skip events for the active section
    if (event.sectionId === activeSection) {
      continue;
    }

    const existing = counts.get(event.sectionId);
    if (existing) {
      existing.count += 1;
      // Escalate type: error > warning > info
      existing.type = higherPriority(existing.type, event.type);
    } else {
      counts.set(event.sectionId, { count: 1, type: event.type });
    }
  }

  return Array.from(counts.entries()).map(([sectionId, { count, type }]) => ({
    sectionId,
    count,
    type,
  }));
}

function higherPriority(a: BadgeType, b: BadgeType): BadgeType {
  const priority: Record<BadgeType, number> = { error: 3, warning: 2, info: 1 };
  return priority[a] >= priority[b] ? a : b;
}
