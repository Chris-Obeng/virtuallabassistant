import Image from "next/image";
import { Show, SignInButton, SignUpButton } from "@clerk/nextjs";
import { Button } from "../ui/button";
import { SidebarTrigger } from "../ui/sidebar";
import { ThemeToggle } from "../theme-toggle";

import React from "react";

const Header = () => {
  return (
    <header className="flex justify-between items-center py-3 px-3 sm:px-6 bg-background/80 backdrop-blur-xl border-b border-border/50 h-14 shrink-0 relative z-10 w-full"> 
      <div className="flex items-center gap-1.5 sm:gap-2">
        <SidebarTrigger className="text-muted-foreground hover:text-foreground hover:bg-accent transition-colors size-8" />
        <Image
          src="/logo.png"
          alt="Virtual Lab Assistant"
          width={24}
          height={24}
          className="rounded-md object-contain sm:size-7"
        />
        <span className="font-semibold text-sm sm:text-base tracking-tight hidden sm:inline text-foreground">
          Virtual Lab Assistant
        </span>
      </div>
      <div className="flex items-center gap-1 sm:gap-2">
        <ThemeToggle />
        <Show when="signed-out">
          <div className="flex items-center gap-1.5 sm:gap-2">
            <SignInButton mode="modal">
              <Button variant="ghost" className="rounded-full font-medium text-xs sm:text-sm h-8 sm:h-9 px-3 sm:px-4 cursor-pointer text-foreground hover:bg-accent">
                Sign In
              </Button>
            </SignInButton>
            <SignUpButton mode="modal">
              <Button className="bg-foreground text-background hover:bg-foreground/90 rounded-full font-medium text-xs sm:text-sm h-8 sm:h-9 px-3 sm:px-4 shadow-sm transition-all duration-200 cursor-pointer">
                Sign Up
              </Button>
            </SignUpButton>
          </div>
        </Show>

      </div>
    </header>
  );
};

export default Header;
