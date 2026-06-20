"use server";

import { getLinkPreview } from "link-preview-js";

export async function getLinkMetadata(url: string) {
  try {
    const data = await getLinkPreview(url, {
      timeout: 3000,
      headers: {
        "user-agent": "Googlebot/2.1 (+http://www.google.com/bot.html)",
      },
      followRedirects: "follow",
    });
    return data;
  } catch (error) {
    // Graceful fallback if scraping fails
    return null;
  }
}
