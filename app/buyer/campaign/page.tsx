import { requireProfile } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { CampaignStudio, type CampaignListing } from "@/components/campaign-studio";
import { WelcomeBand } from "@/components/dashboard/welcome-band";

export const metadata = { title: "Campaign Studio" };

export default async function CampaignPage() {
  const { supabase, profile } = await requireProfile("buyer");
  const { data: listings } = await supabase
    .from("public_listings")
    .select("id, display_name, allowed_categories")
    .order("display_name")
    .returns<CampaignListing[]>();

  return (
    <AppShell role="buyer" displayName={profile.display_name}>
      <WelcomeBand name={profile.display_name}
        blurb="Campaign Studio — one brief becomes gate-ready scripts for several creators at once." />
      <CampaignStudio listings={listings ?? []} />
    </AppShell>
  );
}
