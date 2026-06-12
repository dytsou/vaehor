"use client";

import React from "react";
import type { TreeContextType } from "./types";

export const TreeContext = React.createContext<TreeContextType | null>(null);
