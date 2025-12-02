import { Fragment } from "react";

import Button from "@/components/ui/shadcn/button";
import {
  ConnectorToBottom,
  ConnectorToLeft,
  ConnectorToRight,
} from "@/components/shared/layout/curvy-rect";
import HeaderGithub from "@/components/shared/header/Github/Github";
import { NAV_ITEMS } from "@/components/shared/header/Nav/Nav";

import HeaderDropdownMobileItem from "./Item/Item";
import Link from "next/link";
import { createWebRoute } from "@/utils/create-web-route";
import UserMenu from "@/components/shared/header/UserMenu/UserMenu";

export default function HeaderDropdownMobile({
  ctaHref = createWebRoute.auth.signin({ view: "signup" }),
  ctaLabel = "Sign up",
  ctaContent,
}: {
  ctaHref?: string;
  ctaLabel?: string;
  ctaContent?: React.ReactNode;
}) {
  return (
    <div className="container relative">
      <div className="overlay border-x pointer-events-none border-border-faint" />
      <ConnectorToBottom className="-top-1 -left-10" />
      <ConnectorToBottom className="-top-1 -right-10" />

      <div>
        {NAV_ITEMS.map((item) => (
          <Fragment key={item.label}>
            <HeaderDropdownMobileItem item={item} />
          </Fragment>
        ))}
      </div>

      <div className="p-24 flex flex-col gap-12 border-b border-border-faint relative -mt-1">
        <HeaderGithub />
        <UserMenu />

        <ConnectorToRight className="left-0 -bottom-11" />
        <ConnectorToLeft className="right-0 -bottom-11" />
      </div>

      <div className="h-36" />
    </div>
  );
}
