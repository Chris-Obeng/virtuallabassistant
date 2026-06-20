import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import dotenv from "dotenv";

dotenv.config();

export async function POST(req: NextRequest) {
  // ── 1. Verify Svix signature ─────────────────────────────────────────────────
  // Clerk signs every payload with HMAC-SHA256 via Svix.
  // verifyWebhook() reads CLERK_WEBHOOK_SIGNING_SECRET automatically and throws
  // if the signature is invalid or the timestamp is older than 5 minutes
  // (protects against replay attacks).
  let evt: Awaited<ReturnType<typeof verifyWebhook>>;

  try {
    evt = await verifyWebhook(req);
  } catch (err) {
    console.error("[Webhook] Signature verification failed:", err);
    // 400 → tells Svix this is a bad request, it will NOT retry
    return new Response("Invalid webhook signature", { status: 400 });
  }

  // ── 2. Idempotency check ─────────────────────────────────────────────────────
  // Svix retries failed deliveries with exponential backoff (up to ~3 days).
  // Every retry carries the SAME svix-id header, so we can deduplicate in the DB.
  // This is the production-safe approach — survives cold starts and deploys.
  const svixId = req.headers.get("svix-id");

  if (!svixId) {
    console.error("[Webhook] Missing svix-id header");
    return new Response("Missing svix-id header", { status: 400 });
  }

  const alreadyProcessed = await db.processedWebhook.findUnique({
    where: { id: svixId },
  });

  if (alreadyProcessed) {
    console.log(`[Webhook] Duplicate skipped — svix-id: ${svixId}`);
    // 200 → tells Svix "received", stops further retries for this event
    return new Response("Already processed", { status: 200 });
  }

  const { type: eventType, data } = evt;
  console.log(`[Webhook] Processing: ${eventType} | svix-id: ${svixId}`);

  // ── 3. Handle events ─────────────────────────────────────────────────────────
  // IMPORTANT: return 500 on DB errors → Svix will retry automatically.
  //            return 200 on success   → Svix marks as delivered, stops retrying.
  try {
    switch (eventType) {
      case "user.created": {
        const primaryEmail = data.email_addresses?.find(
          (e) => e.id === data.primary_email_address_id,
        )?.email_address;

        if (!primaryEmail) {
          // Clerk guarantees an email for standard sign-ups, but guard anyway.
          // Return 200 so Svix doesn't retry — this event is unprocessable as-is.
          console.warn(
            `[Webhook] user.created has no primary email — skipping ${data.id}`,
          );
          break;
        }

        const fullName =
          [data.first_name, data.last_name].filter(Boolean).join(" ") || null;

        // upsert instead of create — handles the edge case where Svix
        // delivers user.created twice before our idempotency row is committed
        await db.user.upsert({
          where: { id: data.id },
          create: {
            id: data.id, // use Clerk's user ID
            email: primaryEmail,
            name: fullName,
            imageUrl: data.image_url ?? null,
          },
          update: {
            // keeps the row in sync if somehow the same event fires again
            email: primaryEmail,
            name: fullName,
            imageUrl: data.image_url ?? null,
          },
        });

        console.log(`[Webhook] user.created → upserted user ${data.id}`);
        break;
      }

      case "user.updated": {
        const primaryEmail = data.email_addresses?.find(
          (e) => e.id === data.primary_email_address_id,
        )?.email_address;

        if (!primaryEmail) {
          console.warn(
            `[Webhook] user.updated has no primary email — skipping ${data.id}`,
          );
          break;
        }

        const fullName =
          [data.first_name, data.last_name].filter(Boolean).join(" ") || null;

        await db.user.update({
          where: { id: data.id },
          data: {
            email: primaryEmail,
            name: fullName,
            imageUrl: data.image_url ?? null,
          },
        });

        console.log(`[Webhook] user.updated → updated user ${data.id}`);
        break;
      }

      case "user.deleted": {
        if (!data.id || !data.deleted) {
          console.warn(
            `[Webhook] user.deleted missing id or deleted=false — skipping`,
          );
          break;
        }

        // deleteMany avoids a crash if the user never made it into the DB
        // (e.g. a previous user.created webhook failed all its retries)
        await db.user.deleteMany({
          where: { id: data.id },
        });

        console.log(`[Webhook] user.deleted → deleted user ${data.id}`);
        break;
      }

      default:
        console.log(`[Webhook] Unhandled event type: ${eventType}`);
    }

    // ── 4. Commit idempotency record ───────────────────────────────────────────
    // Only written after the DB work succeeds. If the handler throws before
    // reaching here, no idempotency row is written → Svix retries → we try again.
    await db.processedWebhook.create({
      data: { id: svixId },
    });

    return new Response("Webhook processed", { status: 200 });
  } catch (err) {
    console.error(`[Webhook] Error processing ${eventType}:`, err);
    // 500 → Svix will retry this event on its backoff schedule
    return new Response("Internal server error", { status: 500 });
  }
}
