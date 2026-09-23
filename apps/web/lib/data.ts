export type Sender = "you" | "member" | "ai";

export type Message = {
  id: string;
  sender: Sender;
  author: string;
  body: string;
  time: string;
};

export type Room = {
  id: string;
  name: string;
  members: string[];
  messages: Message[];
};

export const currentUser = {
  name: "Mohit",
  email: "mohit@team.example",
};

export const initialRooms: Room[] = [
  {
    id: "design-crit",
    name: "design-crit",
    members: ["Mohit", "Priya", "Sam"],
    messages: [
      {
        id: "m1",
        sender: "member",
        author: "Priya",
        body: "Pushed the new room shell — sidebar holds, chat is the focus.",
        time: "9:12 AM",
      },
      {
        id: "m2",
        sender: "you",
        author: "Mohit",
        body: "Looks right. Ink for us, ember only when AI answers.",
        time: "9:14 AM",
      },
      {
        id: "m3",
        sender: "member",
        author: "Sam",
        body: "Agreed. No autocomplete on @ai — summon is deliberate.",
        time: "9:15 AM",
      },
      {
        id: "m4",
        sender: "ai",
        author: "Summon AI",
        body: "Noted. I only answer when this room summons me; I am not a member and I do not appear on the roster.",
        time: "9:16 AM",
      },
      {
        id: "m5",
        sender: "you",
        author: "Mohit",
        body: "Good. Next: host admit on the join link.",
        time: "9:18 AM",
      },
    ],
  },
  {
    id: "standup",
    name: "standup",
    members: ["Mohit", "Priya"],
    messages: [
      {
        id: "s1",
        sender: "member",
        author: "Priya",
        body: "Yesterday: foundation scaffold. Today: chat loop.",
        time: "8:58 AM",
      },
      {
        id: "s2",
        sender: "you",
        author: "Mohit",
        body: "Same. Typecheck and tests stay green.",
        time: "9:01 AM",
      },
    ],
  },
  {
    id: "infra",
    name: "infra",
    members: ["Mohit", "Sam"],
    messages: [],
  },
];
