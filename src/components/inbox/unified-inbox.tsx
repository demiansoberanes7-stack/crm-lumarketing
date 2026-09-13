"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Mail } from "lucide-react";
import type { Channel } from "@/lib/channels";
import { CHANNEL_LABEL } from "@/lib/channels";
import { ChannelBadge } from "@/components/channel-badge";
import { EmailClient } from "@/components/email/email-client";
import { InboxClient } from "./inbox-client";
export function UnifiedInbox({ channels }: { channels: readonly Channel[] }) {
  const email = useSearchParams().get("channel") === "email";
  if (!email) return <InboxClient channels={channels} />;
  return <div className="flex h-full min-h-0 flex-col">
    <nav aria-label="Bandejas" className="flex items-center gap-3 border-b p-3">
      <Link href="/inbox">Bandeja</Link>
      {channels.map((channel) => <Link key={channel} href={`/inbox?channel=${channel}`} title={CHANNEL_LABEL[channel]}><ChannelBadge channel={channel} /></Link>)}
      <span className="flex items-center gap-2 rounded-full bg-brand-tint px-3 py-1"><Mail size={16} /> Buzón</span>
    </nav>
    <div className="min-h-0 flex-1"><EmailClient /></div>
  </div>;
}
