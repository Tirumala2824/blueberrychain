import { AppShell } from "@/components/shell/AppShell";
import { ProofPage } from "@/components/cockpit/ProofPage";

export default async function CaseProofPage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  return (
    <AppShell wide>
      <ProofPage caseId={caseId} />
    </AppShell>
  );
}
