"use client";

import { useState } from "react";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";
import { Skeleton } from "@/components/ui/skeleton";
import { getLinkMetadata } from "@/app/actions/get-link-metadata";
import { cn } from "@/lib/utils";

export function RichLinkPreview({ href, children, className, ...props }: { href: string, children: React.ReactNode, className?: string }) {
  const [metadata, setMetadata] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [hasFetched, setHasFetched] = useState(false);

  const handleOpenChange = async (open: boolean) => {
    if (open && !hasFetched && !loading) {
      setLoading(true);
      const data = await getLinkMetadata(href);
      setMetadata(data);
      setHasFetched(true);
      setLoading(false);
    }
  };

  return (
    <HoverCard onOpenChange={handleOpenChange} openDelay={300}>
      <HoverCardTrigger asChild>
        <a 
          href={href} 
          target="_blank"
          rel="noopener noreferrer"
          className={cn("text-blue-500 hover:text-blue-600 underline font-medium underline-offset-2 transition-colors", className)}
          {...props}
        >
          {children}
        </a>
      </HoverCardTrigger>
      <HoverCardContent 
        className="w-72 p-0 overflow-hidden rounded-xl shadow-lg border-border/50 bg-background z-[100]" 
        align="start"
        sideOffset={8}
      >
        {loading ? (
          <div className="p-4 space-y-3">
            <Skeleton className="h-24 w-full rounded-md" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ) : metadata ? (
            <a href={href} target="_blank" rel="noopener noreferrer" className="flex flex-col group/preview hover:bg-muted/30 transition-colors">
              {metadata.images?.[0] ? (
                <div className="w-full h-32 overflow-hidden bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={metadata.images[0]} alt={metadata.title} className="w-full h-full object-cover transition-transform duration-500 group-hover/preview:scale-105" />
                </div>
              ) : null}
              <div className="p-3">
                <h4 className="font-semibold text-sm line-clamp-1 leading-tight text-foreground">{metadata.title || href}</h4>
                {metadata.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{metadata.description}</p>
                )}
                <div className="flex items-center gap-1.5 mt-2">
                  {metadata.favicons?.[0] && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={metadata.favicons[0]} alt="favicon" className="size-3 rounded-sm" />
                  )}
                  <span className="text-[10px] text-muted-foreground font-medium truncate">
                    {new URL(href).hostname}
                  </span>
                </div>
              </div>
            </a>
        ) : (
          <div className="p-3 text-sm flex flex-col gap-1">
            <h4 className="font-medium text-foreground line-clamp-1">{href}</h4>
            <span className="text-[10px] text-muted-foreground font-medium truncate">
              {new URL(href).hostname}
            </span>
          </div>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}