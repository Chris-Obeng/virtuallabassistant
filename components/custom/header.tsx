import { Show, SignInButton, SignUpButton } from "@clerk/nextjs";
import { Button } from "../ui/button";
import { SidebarTrigger } from "../ui/sidebar";

import React from "react";

const Header = () => {
  return (
    <header className="flex justify-between items-center py-4 px-4 sm:px-6 bg-transparent h-14 shrink-0 relative z-10 w-full backdrop-blur-md"> 
      <div className="flex items-center gap-2">
        <SidebarTrigger className="text-gray-600 hover:text-black hover:bg-gray-100 transition-colors" />
      </div>
      <div className="flex items-center">
        <Show when="signed-out">
          <div className="flex items-center gap-2">
            <SignInButton mode="modal">
              <Button variant="ghost" className="rounded-full font-medium text-sm sm:text-base h-9 sm:h-10 px-4 cursor-pointer">
                Sign In
              </Button>
            </SignInButton>
            <SignUpButton mode="modal">
              <Button className="bg-black text-white hover:bg-gray-800 rounded-full font-medium text-sm sm:text-base h-9 sm:h-10 px-4 sm:px-5 shadow-sm transition-all duration-200 cursor-pointer">
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
