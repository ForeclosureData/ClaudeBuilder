import { FileText, ScanSearch, MapPinned, Search, ArrowRight } from "lucide-react";

const STEPS = [
  { icon: FileText, title: "County publishes notices", description: "Hidalgo County posts new foreclosure-sale notices as PDFs." },
  { icon: ScanSearch, title: "ForeclosureData reads them", description: "Every notice is parsed for sale date, loan, and owner details." },
  { icon: MapPinned, title: "We identify the property", description: "Addresses are matched against county appraisal records." },
  { icon: Search, title: "Investors get clean, searchable data", description: "Browse, filter, and save opportunities in seconds." },
];

export function WorkflowSteps() {
  return (
    <div className="grid grid-cols-1 items-start gap-6 sm:grid-cols-4 sm:gap-4">
      {STEPS.map((step, i) => (
        <div key={step.title} className="flex sm:flex-col sm:items-center sm:text-center">
          <div className="flex flex-1 flex-col items-center gap-3 sm:flex-none">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700 dark:bg-brand-500/10">
              <step.icon className="h-5 w-5" />
            </div>
            <div className="ml-4 sm:ml-0">
              <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">{step.title}</div>
              <p className="mt-1 text-sm text-neutral-500">{step.description}</p>
            </div>
          </div>
          {i < STEPS.length - 1 && (
            <ArrowRight className="mx-4 mt-4 hidden h-5 w-5 shrink-0 self-start text-neutral-300 sm:mt-6 sm:block" />
          )}
        </div>
      ))}
    </div>
  );
}
