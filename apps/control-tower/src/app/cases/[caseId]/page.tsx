import { AppShell } from "@/components/shell/AppShell";
import { Cockpit } from "@/components/cockpit/Cockpit";

export default async function CasePage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  return (
    <AppShell wide>
      <Cockpit caseId={caseId} />
    </AppShell>
  );
}
