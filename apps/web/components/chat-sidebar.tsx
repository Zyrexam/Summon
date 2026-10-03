"use client";

import * as React from "react";
import { Loader2Icon, SendIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SenderRow } from "@/lib/chat-rows";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import {
  Message,
  MessageContent,
  MessageGroup,
  MessageHeader,
} from "@/components/ui/message";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import type { SessionMessage } from "@/lib/session";

function AIEdge() {
  return (
    <span
      aria-hidden="true"
      className="absolute inset-y-0 start-0 w-0.5 rounded-s-xl bg-ember"
    />
  );
}

type ChatSidebarProps = {
  messages: SessionMessage[];
  /** Per-message sender labels, decided once in @/lib/chat-rows. */
  senders: SenderRow[];
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: (event: React.FormEvent) => void;
  summoning?: boolean;
  summonError?: string | null;
  placeholder?: string;
};

export function ChatSidebar({
  messages,
  senders,
  draft,
  onDraftChange,
  onSend,
  summoning = false,
  summonError = null,
  placeholder = "Message — type @ai to summon",
}: ChatSidebarProps) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col border-s bg-card" data-testid="chat-sidebar">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <h2 className="text-sm font-medium">Chat</h2>
        <span className="ms-auto text-xs text-muted-foreground">E2EE</span>
      </header>
      <MessageScrollerProvider autoScroll defaultScrollPosition="end">
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport className="px-3 py-4">
            <MessageScrollerContent className="min-h-full justify-end gap-4 pb-2">
              {messages.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No messages yet. Type @ai to summon help.
                </p>
              )}
              {messages.map((m) => {
                const isYou = Boolean(m.you);
                const isAI = m.kind === "ai";
                const sender = senders.find((row) => row.id === m.id);
                return (
                  <MessageScrollerItem key={m.id}>
                    <MessageGroup>
                      <Message align={isYou ? "end" : "start"}>
                        <MessageContent>
                          {sender?.show && (
                            <MessageHeader
                              className={
                                isAI ? "text-ember-foreground" : undefined
                              }
                            >
                              {sender.text}
                              <span className="ms-2 font-normal text-muted-foreground">
                                {m.time}
                              </span>
                            </MessageHeader>
                          )}
                          <Bubble
                            align={isYou ? "end" : "start"}
                            variant={isAI ? "outline" : "secondary"}
                            className={
                              isAI
                                ? "relative border-ember-ai-border bg-ember-ai-surface text-foreground"
                                : undefined
                            }
                          >
                            {isAI && <AIEdge />}
                            <BubbleContent
                              className={m.readable ? undefined : "italic text-muted-foreground"}
                            >
                              {m.body}
                            </BubbleContent>
                          </Bubble>
                        </MessageContent>
                      </Message>
                    </MessageGroup>
                  </MessageScrollerItem>
                );
              })}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton direction="start" />
          <MessageScrollerButton direction="end" />
        </MessageScroller>
      </MessageScrollerProvider>
      <form
        onSubmit={onSend}
        className="shrink-0 border-t p-3"
        aria-label="Message composer"
      >
        <div aria-live="polite" className="empty:hidden">
          {summoning && (
            <p
              className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground"
              data-testid="summon-pending"
            >
              <Loader2Icon className="size-3 animate-spin" />
              Summon AI is answering
            </p>
          )}
          {summonError && (
            <p
              className="mb-2 text-xs text-destructive"
              role="alert"
              data-testid="summon-error"
            >
              {summonError}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            placeholder={placeholder}
            aria-label="Message"
            maxLength={2000}
            data-testid="chat-composer"
          />
          <Button
            type="submit"
            size="icon"
            disabled={!draft.trim()}
            title="Send"
          >
            <SendIcon />
            <span className="sr-only">Send</span>
          </Button>
        </div>
      </form>
    </div>
  );
}
