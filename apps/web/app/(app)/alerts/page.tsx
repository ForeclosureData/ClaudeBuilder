import { Card, CardContent } from "@/components/ui/card";
import { Bell } from "lucide-react";

const upcomingAlertTypes = [
  "New foreclosures in your counties",
  "Auction cancellations",
  "Commercial only",
  "Residential only",
  "Value thresholds",
  "Specific cities",
];

/**
 * Placeholder UI only — no delivery backend yet. The data model
 * (NotificationPreference / NotificationEvent) already exists in
 * packages/database for when this is built out; see docs/BACKLOG.md.
 */
export default function AlertsPage() {
  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-neutral-900 dark:text-neutral-50">Alerts</h1>
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <Bell className="h-8 w-8 text-neutral-300 dark:text-neutral-600" />
          <p className="font-medium text-neutral-700 dark:text-neutral-300">Alerts are coming soon.</p>
          <p className="max-w-sm text-sm text-neutral-500">
            You'll be able to get notified about:
          </p>
          <ul className="text-sm text-neutral-500">
            {upcomingAlertTypes.map((t) => <li key={t}>{t}</li>)}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
