#!/bin/bash

# Visual helper for project checks
# vaehor All-in-One Check

GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color
BOLD='\033[1m'

echo -e "${BLUE}${BOLD}🚀 Starting vaehor Project Health Checks...${NC}\n"

FAIL=0

# 1. Formatting Check (Biome and Prettier for unsupported file types)
echo -ne "  Checking formatting (Biome + Prettier)... "
if pnpm format:check > /dev/null 2>&1; then
    echo -e "${GREEN}✅ PASSED${NC}"
else
    echo -e "${RED}❌ FAILED${NC}"
    FAIL=1
fi

# 2. Linting (Biome)
echo -ne "  Checking linting (Biome)...      "
if pnpm lint > /dev/null 2>&1; then
    echo -e "${GREEN}✅ PASSED${NC}"
else
    echo -e "${RED}❌ FAILED${NC}"
    FAIL=1
fi

# 3. Type Checking (TypeScript)
echo -ne "  Checking types (TypeScript)...   "
if pnpm exec tsc --noEmit > /dev/null 2>&1; then
    echo -e "${GREEN}✅ PASSED${NC}"
else
    echo -e "${RED}❌ FAILED${NC}"
    FAIL=1
fi

echo -e "\n${BOLD}=======================================${NC}"

if [[ $FAIL -eq 0 ]]; then
    echo -e "${GREEN}${BOLD}✨ All checks passed! Ready to push.${NC}"
    exit 0
else
    echo -e "${RED}${BOLD}⚠️  Some checks failed. Please fix before pushing.${NC}"
    echo -e "Tip: Try running 'pnpm fix:all' to fix formatting and lint issues automatically."
    exit 1
fi
