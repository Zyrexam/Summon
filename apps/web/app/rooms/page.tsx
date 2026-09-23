"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  FlameIcon,
  HashIcon,
  LogOutIcon,
  PlusIcon,
  SendIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
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
  MessageAvatar,
  MessageContent,
  MessageGroup,
  MessageHeader,
} from "@/components/ui/message";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Marker, MarkerContent } from "@/components/ui/marker";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { currentUser, initialRooms, type Room } from "@/lib/data";

function initials(name: string) {
  return name
    .split(/[\s-]+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function AIEdge() {
  return (
    <span
      aria-hidden="true"
      className="absolute inset-y-0 start-0 w-0.5 rounded-s-xl bg-ember"
    />
  );
}

export default function RoomsPage() {
  const router = useRouter();
  const [rooms, setRooms] = React.useState<Room[]>(initialRooms);
  const [activeId, setActiveId] = React.useState(initialRooms[0].id);
  const [draft, setDraft] = React.useState("");
  const [newOpen, setNewOpen] = React.useState(false);
  const [newName, setNewName] = React.useState("");

  const active = rooms.find((r) => r.id === activeId);

  function sendMessage(event: React.FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || !active) return;
    const message = {
      id: `t-${Date.now()}`,
      sender: "you" as const,
      author: currentUser.name,
      body,
      time: new Date().toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      }),
    };
    setRooms((prev) =>
      prev.map((r) =>
        r.id === active.id ? { ...r, messages: [...r.messages, message] } : r,
      ),
    );
    setDraft("");
  }

  function createRoom(event: React.FormEvent) {
    event.preventDefault();
    const name = newName
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");
    if (!name) return;
    const room: Room = {
      id: `${name}-${Date.now()}`,
      name,
      members: [currentUser.name],
      messages: [],
    };
    setRooms((prev) => [...prev, room]);
    setActiveId(room.id);
    setNewName("");
    setNewOpen(false);
  }

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <div className="flex items-center gap-2 px-1 py-1.5">
            <span className="flex size-6 items-center justify-center rounded-md bg-ember-muted text-ember">
              <FlameIcon className="size-3.5" />
            </span>
            <span className="font-medium tracking-tight group-data-[collapsible=icon]:hidden">
              Summon
            </span>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Rooms</SidebarGroupLabel>
            <SidebarGroupAction
              title="New room"
              onClick={() => setNewOpen(true)}
            >
              <PlusIcon />
              <span className="sr-only">New room</span>
            </SidebarGroupAction>
            <SidebarGroupContent>
              <SidebarMenu>
                {rooms.map((room) => (
                  <SidebarMenuItem key={room.id}>
                    <SidebarMenuButton
                      isActive={room.id === activeId}
                      onClick={() => setActiveId(room.id)}
                      tooltip={room.name}
                    >
                      <HashIcon />
                      <span>{room.name}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
                {rooms.length === 0 && (
                  <SidebarMenuItem>
                    <span className="px-2 text-sm text-muted-foreground">
                      No rooms yet
                    </span>
                  </SidebarMenuItem>
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <Separator className="mb-2" />
          <div className="flex items-center gap-2 px-1 py-1">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium group-data-[collapsible=icon]:hidden">
              {initials(currentUser.name)}
            </span>
            <div className="flex min-w-0 flex-1 flex-col group-data-[collapsible=icon]:hidden">
              <span className="truncate text-sm font-medium">
                {currentUser.name}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {currentUser.email}
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              className="group-data-[collapsible=icon]:hidden"
              title="Sign out"
              onClick={() => router.push("/")}
            >
              <LogOutIcon />
              <span className="sr-only">Sign out</span>
            </Button>
          </div>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset>
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ms-1" />
          <Separator orientation="vertical" className="me-1 h-5" />
          {active ? (
            <>
              <HashIcon className="size-4 text-muted-foreground" />
              <h1 className="truncate text-sm font-medium">{active.name}</h1>
              <span className="ms-auto text-xs text-muted-foreground">
                {active.members.length} member
                {active.members.length === 1 ? "" : "s"}
                {" · "}
                E2EE
              </span>
            </>
          ) : (
            <span className="text-sm text-muted-foreground">No room</span>
          )}
        </header>

        {!active ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <Empty className="max-w-sm">
              <EmptyHeader>
                <EmptyTitle>No room selected</EmptyTitle>
                <EmptyDescription>
                  Pick a room from the sidebar or create one to start
                  chatting.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        ) : active.messages.length === 0 ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <Empty className="max-w-sm">
              <EmptyHeader>
                <EmptyTitle>No messages yet</EmptyTitle>
                <EmptyDescription>
                  Messages in {active.name} are end-to-end encrypted. Send the
                  first one.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        ) : (
          <MessageScrollerProvider>
            <MessageScroller className="flex-1">
              <MessageScrollerViewport className="px-4 py-6">
                <MessageScrollerContent className="mx-auto w-full max-w-2xl justify-end gap-5">
                  <MessageScrollerItem>
                    <Marker variant="separator">
                      <MarkerContent>Today</MarkerContent>
                    </Marker>
                  </MessageScrollerItem>
                  {active.messages.map((m) => {
                    const isYou = m.sender === "you";
                    const isAI = m.sender === "ai";
                    return (
                      <MessageScrollerItem key={m.id}>
                        <MessageGroup>
                          <Message align={isYou ? "end" : "start"}>
                            {!isYou && (
                              <MessageAvatar
                                className={
                                  isAI
                                    ? "bg-ember-muted text-ember"
                                    : undefined
                                }
                              >
                                {isAI ? (
                                  <FlameIcon className="size-4" />
                                ) : (
                                  <span className="text-[10px] font-medium">
                                    {initials(m.author)}
                                  </span>
                                )}
                              </MessageAvatar>
                            )}
                            <MessageContent>
                              <MessageHeader
                                className={
                                  isAI ? "text-ember-foreground" : undefined
                                }
                              >
                                {isYou ? "You" : m.author}
                                <span className="ms-2 font-normal text-muted-foreground">
                                  {m.time}
                                </span>
                              </MessageHeader>
                              <Bubble
                                align={isYou ? "end" : "start"}
                                variant={isAI ? "outline" : "secondary"}
                                className={
                                  isAI
                                    ? "relative border-ember/30 bg-ember-muted text-foreground"
                                    : undefined
                                }
                              >
                                {isAI && <AIEdge />}
                                <BubbleContent>{m.body}</BubbleContent>
                              </Bubble>
                            </MessageContent>
                          </Message>
                        </MessageGroup>
                      </MessageScrollerItem>
                    );
                  })}
                  <MessageScrollerItem scrollAnchor />
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <MessageScrollerButton direction="start" />
              <MessageScrollerButton direction="end" />
            </MessageScroller>
          </MessageScrollerProvider>
        )}

        <form
          onSubmit={sendMessage}
          className="shrink-0 border-t p-4"
          aria-label="Message composer"
        >
          <div className="mx-auto flex w-full max-w-2xl items-center gap-2">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={
                active
                  ? `Message #${active.name} — type @ai to summon`
                  : "Select a room to message"
              }
              disabled={!active}
              aria-label="Message"
              maxLength={2000}
            />
            <Button
              type="submit"
              size="icon"
              disabled={!active || !draft.trim()}
              title="Send"
            >
              <SendIcon />
              <span className="sr-only">Send</span>
            </Button>
          </div>
        </form>
      </SidebarInset>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New room</DialogTitle>
            <DialogDescription>
              Create a private room. Invites and keys come after foundation
              lands.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={createRoom} className="flex flex-col gap-4">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="product-launch"
              aria-label="Room name"
              autoFocus
            />
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setNewOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!newName.trim()}>
                Create room
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  );
}
