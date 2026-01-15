import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

const CreateChatSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
});

export async function GET() {
  const chats = await prisma.chatSession.findMany({
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      language: true,
    },
    take: 50,
  });

  return NextResponse.json({ chats });
}

export async function POST(req: Request) {
  const json = await req.json().catch(() => ({}));
  const body = CreateChatSchema.parse(json);

  const chat = await prisma.chatSession.create({
    data: {
      title: body.title ?? "Nouveau chat",
    },
    select: {
      id: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      language: true,
    },
  });

  return NextResponse.json({ chat }, { status: 201 });
}
