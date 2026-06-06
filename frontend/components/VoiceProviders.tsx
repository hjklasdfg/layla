"use client";

import { ConversationProvider } from "@elevenlabs/react";
import type { ReactNode } from "react";

interface VoiceProvidersProps {
  children: ReactNode;
  agentId?: string;
}

export function VoiceProviders({ children, agentId }: VoiceProvidersProps) {
  if (!agentId) return children;

  return <ConversationProvider agentId={agentId}>{children}</ConversationProvider>;
}
