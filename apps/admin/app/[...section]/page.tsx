import { notFound } from "next/navigation";
import { DashboardShell } from "../../components/Shell";
import { sections } from "../../components/navigation";
import { OperationalPage } from "../../components/OperationalPage";
import { requireAgencyPage } from "../../lib/server";

export const dynamic = "force-dynamic";
const valid = new Set(sections.filter((s) => s !== "Overview").map((name) => name.toLowerCase().replaceAll(" & ", "-").replaceAll(" ", "-")));
export default async function SectionPage({ params }: { params: Promise<{ section: string[] }> }) {
  const { section: parts } = await params; const section = parts.join("/"); if (parts.length !== 1 || !valid.has(section)) notFound();
  const capability = section === "team" ? "agency.manage" : section === "feature-flags" ? "feature_flag.manage" : section === "audit-logs" ? "audit.read" : section === "agent-playground" ? "run.execute" : "business.read";
  await requireAgencyPage(capability);
  return <DashboardShell><OperationalPage section={section} /></DashboardShell>;
}
