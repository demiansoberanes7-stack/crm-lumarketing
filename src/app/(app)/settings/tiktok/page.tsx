import { notFound } from "next/navigation";
import { TikTokClient } from "@/components/settings/tiktok-client";
import { isChannelEnabled } from "@/server/channels/enabled";

export const dynamic = "force-dynamic";

export default function TikTokSettingsPage() {
  if (!isChannelEnabled("tiktok")) notFound();
  return <TikTokClient />;
}
