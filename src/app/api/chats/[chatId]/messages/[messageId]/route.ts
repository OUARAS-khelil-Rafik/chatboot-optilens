import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

const ParamsSchema = z.object({
  chatId: z.string().min(1),
  messageId: z.string().min(1),
});

const PatchMessageSchema = z.object({
  content: z.string().trim().min(1).max(10_000),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ chatId: string; messageId: string }> }) {
  const params = ParamsSchema.parse(await ctx.params);
  const json = await req.json().catch(() => ({}));
  const body = PatchMessageSchema.parse(json);

  const updated = await prisma.chatMessage.update({
    where: { id: params.messageId },
    data: { content: body.content },
    select: {
      id: true,
      chatId: true,
      role: true,
      content: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (updated.chatId !== params.chatId) {
    return NextResponse.json({ error: "Message/chat mismatch" }, { status: 400 });
  }

  await prisma.chatSession.update({
    where: { id: params.chatId },
    data: { updatedAt: new Date() },
    select: { id: true },
  });

  return NextResponse.json({ message: updated });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ chatId: string; messageId: string }> }) {
  const params = ParamsSchema.parse(await ctx.params);

  const deleted = await prisma.chatMessage.delete({
    where: { id: params.messageId },
    select: { id: true, chatId: true },
  });

  if (deleted.chatId !== params.chatId) {
    return NextResponse.json({ error: "Message/chat mismatch" }, { status: 400 });
  }

  await prisma.chatSession.update({
    where: { id: params.chatId },
    data: { updatedAt: new Date() },
    select: { id: true },
  });

  return NextResponse.json({ ok: true });
}
