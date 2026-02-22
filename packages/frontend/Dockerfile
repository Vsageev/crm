FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/frontend/package.json packages/frontend/
RUN pnpm install --frozen-lockfile

# Build shared + frontend
FROM deps AS build
COPY packages/shared/ packages/shared/
COPY packages/frontend/ packages/frontend/
COPY tsconfig.json ./
RUN pnpm --filter shared build && pnpm --filter frontend build

# Serve with a lightweight static server
FROM node:20-alpine AS runner
RUN npm install -g serve@latest
WORKDIR /app

COPY --from=build /app/packages/frontend/dist ./dist

EXPOSE 5173
CMD ["serve", "-s", "dist", "-l", "5173"]
