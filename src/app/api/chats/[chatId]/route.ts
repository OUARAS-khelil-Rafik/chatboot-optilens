import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

const ParamsSchema = z.object({
  chatId: z.string().min(1),
});

const PatchChatSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
});

export async function GET(_req: Request, ctx: { params: Promise<{ chatId: string }> }) {
  const params = ParamsSchema.parse(await ctx.params);

  const chat = await prisma.chatSession.findUnique({
    where: { id: params.chatId },
    select: {
      id: true,
      title: true,
      summary: true,
      language: true,
      createdAt: true,
      updatedAt: true,
      messages: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          role: true,
          content: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });

  if (!chat) return NextResponse.json({ error: "Chat introuvable" }, { status: 404 });

  return NextResponse.json({ chat });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ chatId: string }> }) {
  const params = ParamsSchema.parse(await ctx.params);
  const json = await req.json().catch(() => ({}));
  const body = PatchChatSchema.parse(json);

  const updated = await prisma.chatSession.update({
    where: { id: params.chatId },
    data: {
      title: body.title,
    },
    select: {
      id: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      language: true,
    },
  });

  return NextResponse.json({ chat: updated });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ chatId: string }> }) {
  const params = ParamsSchema.parse(await ctx.params);

  await prisma.$transaction([
    prisma.chatMemory.deleteMany({ where: { scope: `chat:${params.chatId}` } }),
    prisma.chatSession.delete({ where: { id: params.chatId } }),
  ]);

  return NextResponse.json({ ok: true });
}
