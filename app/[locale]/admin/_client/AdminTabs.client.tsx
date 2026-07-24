"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { LucideIcon } from "lucide-react";

export type AdminTabItem = {
  value: string;
  label: string;
  icon: LucideIcon;
};

const scrollbarHideStyles = {
  msOverflowStyle: "none" as const,
  scrollbarWidth: "none" as const,
};

export function AdminTabs(
  props: Readonly<{
    defaultValue: string;
    items: AdminTabItem[];
    children: React.ReactNode;
  }>,
) {
  return (
    <Tabs defaultValue={props.defaultValue} className="w-full">
      <div
        className="w-full overflow-x-auto pb-4 mb-2 -mx-4 px-4 sm:mx-0 sm:px-0 no-scrollbar"
        style={scrollbarHideStyles}
      >
        <TabsList className="flex w-max h-auto bg-transparent p-0 gap-2">
          {props.items.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="flex items-center gap-2 px-4 py-2.5 rounded-full border bg-card data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:border-primary transition-all shadow-sm"
            >
              <tab.icon size={16} />
              <span>{tab.label}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      {props.children}
    </Tabs>
  );
}
